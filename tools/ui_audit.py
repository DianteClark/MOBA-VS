# Checks that HUD panels never overlap and stay on screen, across many viewports.
#   python3 tools/ui_audit.py http://localhost:8765/index.html [outdir]
import sys, asyncio, json
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
OUT = sys.argv[2] if len(sys.argv) > 2 else None
VIEWS = [tuple(map(int, v.split('x'))) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [(1920, 1080), (1440, 900), (1366, 768), (1280, 720), (1024, 768), (900, 600), (844, 390), (667, 375), (390, 844), (768, 1024)]
IDS = ['myteam', 'ticker', 'scorebar', 'objtimers', 'enemyteam', 'killfeed', 'mm', 'ctrl', 'cmdbar', 'detail', 'foestrip']
PAIRS_SKIP = {('leftcol', 'myteam'), ('topcenter', 'scorebar'), ('topcenter', 'objtimers'), ('topcenter', 'ticker'), ('rightcol', 'enemyteam'), ('rightcol', 'killfeed'), ('brcol', 'mm'), ('brcol', 'ctrl')}
JS = """(ids) => ids.map(id => { const e = document.getElementById(id); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return [id, null];
  // use the union of visible children so empty space in a column doesn't count
  const kids = [...e.querySelectorAll(':scope > *')].filter(k => k.offsetParent);
  const rects = (kids.length && ['cmdbar','killfeed','ctrl'].includes(id)) ? kids.map(k => k.getBoundingClientRect()) : [e.getBoundingClientRect()];
  const r = rects.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 });
  if (r.right < r.left) return [id, null];
  return [id, { l: r.left, t: r.top, r: r.right, b: r.bottom }]; })"""
def check(rects, w, h):
    issues = []
    for id_, r in rects.items():
        if not r: continue
        if r['l'] < -1 or r['t'] < -1 or r['r'] > w + 1 or r['b'] > h + 1: issues.append(f'{id_} off-screen {r}')
    ks = [k for k in IDS if rects.get(k)]
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            a, c = ks[i], ks[j]
            if (a, c) in PAIRS_SKIP or (c, a) in PAIRS_SKIP: continue
            A, C = rects[a], rects[c]
            ov = min(A['r'], C['r']) - max(A['l'], C['l']), min(A['b'], C['b']) - max(A['t'], C['t'])
            if ov[0] > 2 and ov[1] > 2: issues.append(f'{a} x {c} overlap {int(ov[0])}x{int(ov[1])}')
    return issues
async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w, h) in VIEWS:
            pg = await b.new_page(viewport={'width': w, 'height': h})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e) + ' ' + str(getattr(e, 'stack', ''))[:400]))
            await pg.goto(URL); await pg.wait_for_timeout(3500)
            await pg.evaluate("app.watchFast = true; app.startVsAI(); (async () => { const m = await import('./src/sim/draft.js'); const s = app.session; while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); } app.afterDraftAct(); })()")
            await pg.wait_for_timeout(1500)
            await pg.evaluate("app.prepReady()")
            await pg.wait_for_timeout(1500)
            await pg.evaluate("app.match.runner.speed = 30")
            await pg.wait_for_timeout(5000)
            await pg.evaluate("app.match.runner.speed = 0.0001")
            # worst case: follow a hero (detail panel), fill the ticker + kill feed, a Coach's Call card in the
            # decision tray (with a request and suggestions queued behind it) and a cancel pill; then the same with a picker open
            await pg.evaluate("const H = app.match.hud, g = app.match.game; H.selectHero(g.teams[0].heroes[1]); g.teams[0].heroes[0].task = { kind: 'safe', call: true, until: 1e9 }; H.dock.suggest('t1', 'Mid overextended', 'Gank', { type: 'gank', lane: 'mid' }); H.dock.suggest('t2', 'Shrine is open', 'Capture', { type: 'shrine', shrine: 0 }); H.dock.request({ hero: g.teams[0].heroes[2], key: 'rq', text: 'I can solo-kill their mid. Go?', cmd: { type: 'permit', kind: 'fight', hero: g.teams[0].heroes[2].id, target: g.teams[1].heroes[2].id } }); H.dock.coachCall({ key: 'cc', title: 'Ember Kami wakes in 18s', text: 'Set up for it, or trade elsewhere?', opts: [{ label: 'Take Kami', cmd: { type: 'objective', obj: 'dragon' } }, { label: 'Wait & see', cmd: null, sub: 'no call' }, { label: 'Push Mid', cmd: { type: 'group', lane: 'mid' } }] }, { ttl: 60000 }); for (let i = 0; i < 6; i++) H.ticker('Test ticker line number ' + i + ' with quite a lot of text in it', 'danger', 3); for (let i = 0; i < 5; i++) H.killfeed(g.teams[0].heroes[i], g.teams[1].heroes[i], 1); H.dock.tick()")
            await pg.wait_for_timeout(700)
            issues = []
            for state in ('tray', 'sheet'):
                if state == 'sheet':
                    await pg.evaluate("app.match.hud.dock.open('gank')"); await pg.wait_for_timeout(400)
                rects = dict(await pg.evaluate(JS, IDS))
                issues += [f'[{state}] ' + x for x in check(rects, w, h)]
            issues += [f'JS error: {e}' for e in errs[:3]]
            print(f'{w}x{h}: ' + ('OK' if not issues else f'{len(issues)} issue(s)'), flush=True)
            for s in issues: print('   ', s)
            bad += len(issues)
            if OUT: await pg.screenshot(path=f'{OUT}/ui_{w}x{h}.png', timeout=20000, animations='disabled')
            await pg.close()
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
