# Offline play test: first load online (the service worker caches the offline pack), then the network goes
# away: the game must open from the cache, show the offline state, and play a vs-AI match to a running HUD.
#   python3 tools/offline_test.py http://localhost:<port>/   (localhost: service workers need https or localhost)
# GAME_LANG=ja also checks that the language pack is cached and used offline.
import sys, os, asyncio
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8853/'
LANG = os.environ.get('GAME_LANG', 'en')
SETUP = """async () => { app.startVsAI('classic', true); const m = await import('./src/sim/draft.js'); const s = app.session;
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); } app.afterDraftAct(); }"""
async def main():
    bad = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390})
        await ctx.add_init_script(f"try {{ localStorage.setItem('mobavs_lang', '{LANG}'); }} catch (e) {{}}")
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller", timeout=20000)
        # the page asks for the offline pack ~6s after boot; wait until the worker reports it
        await pg.wait_for_function("localStorage.getItem('mobavs_offline_ready')", timeout=90000)
        n = await pg.evaluate("caches.keys().then(async (ks) => { let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return n; })")
        print('cached files:', n)
        if n < 300: bad.append(f'only {n} files cached')
        await ctx.set_offline(True)
        await pg.reload(); await pg.wait_for_timeout(4000)
        ok = await pg.evaluate("!!window.app && !!document.querySelector('#screen .home2')")
        if not ok: bad.append('home screen did not open offline')
        off = await pg.evaluate("document.documentElement.classList.contains('is-offline')")
        if not off: bad.append('no offline indicator')
        if LANG != 'en':
            l = await pg.evaluate("document.documentElement.lang")
            if not l.startswith(LANG): bad.append(f'language pack not used offline ({l})')
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await pg.evaluate("app.prepReady()"); await pg.wait_for_timeout(1500)
        await pg.evaluate("app.match.runner.speed = 8"); await pg.wait_for_timeout(4000)
        t = await pg.evaluate("app.match ? app.match.game.tick : -1")
        print('match tick offline:', t)
        if t < 200: bad.append(f'match did not run offline (tick {t})')
        # a tap on an online-only button explains instead of hanging
        await pg.evaluate("app.quitMatch = app.quitMatch; app.match.game.over = true; app.match = null; app.menu()")
        await pg.wait_for_timeout(800)
        await pg.click('.h2online .h2go', force=True); await pg.wait_for_timeout(300)
        toast = await pg.evaluate("[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')")
        if not toast: bad.append('no toast for an online button offline')
        await ctx.set_offline(False)
        bad += [f'JS error: {e}' for e in errs[:3]]
        await b.close()
    print('OK' if not bad else '\n'.join('FAIL ' + x for x in bad))
    sys.exit(1 if bad else 0)
asyncio.run(main())
