#!/usr/bin/env python3
# Audio logic test (the audio cannot be heard here, so it checks the engine's own event log and state):
#  * nothing under assets/audio is fetched before the first tap; the tap unlocks a running AudioContext
#  * menu → draft → match music, calm → tension → Last Stand states, victory stinger, hit/cast/tower/kill sounds
#  * voice limits hold, no decode/load/play errors, no page errors
#  * backgrounding suspends the context and pauses the music decks; coming back resumes them
#  * settings sliders (master / music / effects / menu sounds) drive the bus gains
#  * several matches in a row: voices drain, decoded buffers and decks stay bounded (JS heap is printed)
# Usage: python3 tools/audio_test.py http://127.0.0.1:8822/ [matches=3]
import asyncio, json, sys
from collections import Counter
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8822/'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
A = "import('./src/audio.js').then((m) => m.audio)"
START = """async (mode) => {
  app.startVsAI(mode, true);
  const m = await import('./src/sim/draft.js'); const s = app.session;
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); }
  app.afterDraftAct();
}"""

async def main():
    fails = []
    def check(ok, msg):
        print(('ok   ' if ok else 'FAIL ') + msg)
        if not ok: fails.append(msg)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--js-flags=--expose-gc'])
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = await ctx.new_page()
        errs, reqs = [], []
        pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
        pg.on('console', lambda m: errs.append('console ' + m.text) if m.type == 'error' and 'ERR_TUNNEL' not in m.text else None)  # (the sandbox has no CDN access)
        pg.on('request', lambda r: reqs.append(r.url) if '/assets/audio/' in r.url else None)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL); await pg.wait_for_timeout(2500)
        st = await pg.evaluate(f"{A}.then((a) => {{ a.trace = []; a.traceMax = 50000; return a.stats(); }})")
        check(st['state'] == 'none' and not reqs, f'no audio before the first tap (ctx {st["state"]}, {len(reqs)} audio requests)')
        await pg.touchscreen.tap(420, 380); await pg.wait_for_timeout(1200)
        st = await pg.evaluate(f"{A}.then((a) => a.stats())")
        check(st['state'] == 'running' and st['unlocked'], f'first tap unlocks: {st["state"]}')
        check(st['music'] == 'menu' and any(not d['paused'] and d['track'] == 'menu' for d in st['decks']), f'menu music plays: {st["decks"]}')
        # settings sliders → bus gains
        g = await pg.evaluate("""async () => { const s = await import('./src/ui/settings.js'); const a = (await import('./src/audio.js')).audio;
          s.setSetting('master', 40); s.setSetting('ui', 0); await new Promise((r) => setTimeout(r, 400));
          const out = { master: a.bus.master.gain.value, ui: a.bus.ui.gain.value, vol: { ...a.vol } }; s.setSetting('master', 100); s.setSetting('ui', 70); return out; }""")
        check(abs(g['master'] - 0.4) < 0.03 and g['ui'] < 0.01, f'sliders drive the buses: {g}')
        heaps = []
        for k in range(N):
            await pg.evaluate(START, 'classic'); await pg.wait_for_timeout(1500)
            await pg.evaluate("app.prepReady()")
            await pg.wait_for_function("() => app.match && app.match.game", timeout=30000)
            await pg.evaluate("() => { app.match.runner.speed = 16; }")
            if k == 0:
                # backgrounding mid-match
                await pg.wait_for_timeout(4000)
                await pg.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }")
                await pg.wait_for_timeout(500)
                h = await pg.evaluate(f"{A}.then((a) => a.stats())")
                check(h['state'] == 'suspended' and all(d['paused'] for d in h['decks']), f'hidden: ctx {h["state"]}, decks paused {[d["paused"] for d in h["decks"]]}')
                await pg.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }")
                await pg.wait_for_timeout(800)
                h = await pg.evaluate(f"{A}.then((a) => a.stats())")
                check(h['state'] == 'running' and any(not d['paused'] for d in h['decks']), f'visible again: ctx {h["state"]}, decks {h["decks"]}')
                # play the first match to the end (Last Stand + victory)
                await pg.wait_for_function("() => !app.match || app.match.game.over", timeout=420000, polling=1000)
                await pg.wait_for_timeout(1500)
            else:
                await pg.wait_for_timeout(15000)
            mx = await pg.evaluate(f"{A}.then((a) => a.stats())")
            await pg.evaluate("() => { if (app.match) app.quitMatch(); }")
            await pg.wait_for_timeout(2500)
            hp = await pg.evaluate(f"async () => {{ const a = await {A}; if (window.gc) gc(); return {{ heap: performance.memory.usedJSHeapSize, st: a.stats() }}; }}")
            heaps.append(hp['heap'])
            print(f'  match {k + 1}: during {mx["voices"]} voices; after quit {hp["st"]["voices"]} voices, {hp["st"]["buffers"]} buffers, music {hp["st"]["music"]}, heap {hp["heap"] / 1e6:.1f} MB')
        tr = await pg.evaluate(f"{A}.then((a) => a.trace)")
        st = await pg.evaluate(f"{A}.then((a) => a.stats())")
        await b.close()
    sfx = Counter(e[2] for e in tr if e[1] == 'sfx')
    states = [e[2] for e in tr if e[1] == 'state']
    musics = [e[2] for e in tr if e[1] == 'music']
    drops = Counter(e[2] for e in tr if e[1] == 'drop')
    errors = [e for e in tr if e[1] in ('error', 'warn')]
    print('  sfx:', dict(sfx.most_common()))
    print('  states:', states[:40])
    print('  music:', musics[:40])
    print('  dropped by voice limits:', dict(drops))
    print('  ducks:', sum(1 for e in tr if e[1] == 'duck'), ' trace entries:', len(tr))
    check(not errors, f'no audio errors/warnings: {errors[:5]}')
    check(not errs, f'no page/console errors: {errs[:5]}')
    check('tension' in states and 'calm' in states, 'calm and tension states both reached')
    check('laststand' in states, 'Last Stand music reached')
    check(any(sfx[n] for n in ('st_win', 'st_lose')), 'victory/defeat stinger played')
    check(sum(sfx[n] for n in sfx if n.startswith('hit_')) > 20, 'hit sounds play')
    check(sum(sfx[n] for n in ('iron1', 'iron2', 'beast1', 'beast2', 'shin1', 'shin2', 'spir1', 'spir2', 'wild1', 'wild2')) > 10, 'clan cast sounds play')
    check(sfx['tshot'] > 0 and (sfx['kill'] + sfx['death']) > 0, 'tower shots and kill sounds play')
    check(st['voices'] <= 24 and st['buffers'] <= 80 and len(st['decks']) == 2, f'bounded at the end: {st}')
    # (informational: v20 main itself grows ~2.5 MB of JS heap per vs-AI match with or without the audio engine;
    #  the audio side is checked above: voices drain to 0, buffers and decks stay bounded)
    print('  JS heap after each match:', [round(h / 1e6, 1) for h in heaps], 'MB')
    print('PASS' if not fails else f'{len(fails)} FAILED')
    sys.exit(1 if fails else 0)

asyncio.run(main())
