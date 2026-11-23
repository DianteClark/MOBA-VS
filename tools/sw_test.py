# Service worker test: offline relaunch, deploy pick-up, VERSION bump, "never reload mid-match", a deploy
# picked up by a resumed (not relaunched) app, and the "Update ready" chip.
#   python3 tools/sw_test.py
# Serves a temporary copy of the game on an ephemeral localhost port (service workers need a secure
# origin; localhost counts), edits files in that copy to simulate deploys, and drives Chrome.
import asyncio, os, re, shutil, sys, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()

def serve(d):
    srv = ThreadingHTTPServer(('localhost', 0), functools.partial(Quiet, directory=d))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

async def main():
    tmp = tempfile.mkdtemp(prefix='mobavs-sw-')
    site = os.path.join(tmp, 'site')
    shutil.copytree(ROOT, site, ignore=lambda d, names: [n for n in names if d == ROOT and n in ('.git', '.base', 'node_modules', 'data', 'tools', 'worker')])
    srv = serve(site); url = f'http://localhost:{srv.server_address[1]}/index.html'
    bad = 0
    async def until(pg, js, ms=15000):  # poll (navigations in between are fine)
        for _ in range(ms // 250):
            try:
                if await pg.evaluate(js): return True
            except Exception: pass
            await pg.wait_for_timeout(250)
        return False
    def ok(cond, msg):
        nonlocal bad
        print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
        if not cond: bad += 1
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390})
        pg = await ctx.new_page()
        await pg.goto(url); await pg.wait_for_timeout(3500)
        await pg.evaluate("Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))])")
        await pg.reload(); await pg.wait_for_timeout(3500)
        ok(await pg.evaluate("!!navigator.serviceWorker.controller"), 'page is controlled by the service worker')
        keys = await pg.evaluate("caches.keys()")
        ok(any(k.startswith('mobavs-v') for k in keys), f'versioned cache present {keys}')

        # 1) weak signal: a fully offline relaunch still reaches the menu
        await ctx.set_offline(True)
        await pg.reload(); await pg.wait_for_timeout(4000)
        ok(await pg.evaluate("!!document.querySelector('#screen .home2')"), 'offline relaunch shows the menu')
        await ctx.set_offline(False)

        # 2) a deploy without a VERSION bump: code is network-first (sw.js r3), so the very next launch runs it
        p_dom = os.path.join(site, 'src/ui/dom.js'); p_pn = os.path.join(site, 'src/data/patchnotes.js')
        with open(p_dom, 'a') as f: f.write('\n// deploy marker 1\n')
        await pg.reload(); await pg.wait_for_timeout(1500)
        ok(await until(pg, "!!window.app && !!document.querySelector('#screen .home2')") and 'deploy marker 1' in (await pg.evaluate("fetch('src/ui/dom.js').then((r) => r.text())")), 'the next launch runs the deploy (no stale first launch)')
        txt = await pg.evaluate("caches.match('src/ui/dom.js').then((r) => r && r.text())")
        ok(bool(txt) and 'deploy marker 1' in txt, 'cache now holds the new build')

        # 3) never mid-match: a deploy lands during a match, the reload waits for the menu
        await pg.wait_for_timeout(1500)
        await until(pg, "!!window.app && !!document.querySelector('#screen .home2')")
        await pg.evaluate("app.watch()"); await pg.wait_for_timeout(2500)
        await pg.evaluate("window.__mark = 2")
        await pg.wait_for_timeout(1100)  # (Last-Modified has 1 s resolution on the test server)
        with open(p_dom, 'a') as f: f.write('\n// deploy marker 2\n')
        with open(p_pn, 'a') as f: f.write('\n// release marker 2\n')  # a release always edits the patch notes
        # simulate the next background check (the page re-fetches main.js and the patch notes through the worker)
        await pg.evaluate("fetch('src/data/patchnotes.js')")
        await pg.wait_for_timeout(4000)
        ok(await pg.evaluate("window.__mark === 2 && !!app.match"), 'no reload while the match is running')
        await pg.evaluate("app.match.game.over = true; app.match = null; app.menu()")
        ok(await until(pg, "window.__mark !== 2 && !!window.app"), 'reloaded once back on the menu')

        # 4) VERSION bump: a new worker + cache, old cache deleted
        p_main = os.path.join(site, 'src/main.js')
        src = open(p_main).read(); m = re.search(r'const VERSION = (\d+);', src); v = int(m.group(1))
        open(p_main, 'w').write(src.replace(m.group(0), f'const VERSION = {v + 1};'))
        await pg.reload()
        # the cached v28 page notices the changed main.js, refreshes, reloads on the menu, then registers the
        # v29 worker, which waits and is switched in on the menu (a second quick reload): settle, then check
        keys = []
        for _ in range(40):
            await pg.wait_for_timeout(500)
            try:
                if await pg.evaluate(f"!!(navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('v={v + 1}') && document.querySelector('#screen .home2'))"): break
            except Exception: pass
        await pg.wait_for_timeout(1500)
        keys = await pg.evaluate("caches.keys()")
        ok(any(k.startswith(f'mobavs-v{v + 1}-') for k in keys) and not any(k.startswith(f'mobavs-v{v}-') for k in keys), f'cache bumped to v{v + 1}: {keys}')
        ok(await pg.evaluate(f"navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('v={v + 1}')"), 'new worker controls the page')
        ok(await pg.evaluate("!!document.querySelector('#screen .home2')"), 'menu up after the switch')

        # 5) a resumed (not relaunched) Home Screen app: no page load at all, only a visibilitychange. The deploy
        #    must still arrive on the menu, and on another menu screen as an "Update ready" chip.
        await pg.evaluate("window.__mark = 5")
        # (a release always edits src/data/patchnotes.js, one of the files a resume re-checks; dom.js changes too)
        await pg.wait_for_timeout(1100)
        with open(p_dom, 'a') as f: f.write('\n// deploy marker 5\n')
        with open(p_pn, 'a') as f: f.write('\n// release marker 5\n')
        await pg.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))")
        ok(await until(pg, "window.__mark !== 5 && !!window.app && !!document.querySelector('#screen .home2')", 20000), 'resume only (visibilitychange) picks up a deploy and reloads on the menu')
        await pg.wait_for_timeout(1000)
        txt = await pg.evaluate("caches.match('src/ui/dom.js').then((r) => r && r.text())")
        ok(bool(txt) and 'deploy marker 5' in txt, 'cache holds the resumed deploy')
        # off the home screen: the chip shows, tapping it reloads
        await pg.evaluate("window.__mark = 6; document.querySelector('#screen .home2').classList.replace('home2', 'elsewhere'); app.update = {}; app.safeUpdate()")
        ok(await pg.evaluate("!!document.getElementById('updchip')"), 'update chip shown off the home screen')
        await pg.click('#updchip')
        ok(await until(pg, "window.__mark !== 6 && !!window.app && !document.getElementById('updchip')"), 'tapping the chip reloads')
        await until(pg, "!!document.querySelector('#screen .home2')")
        await pg.evaluate("app.watch()"); await pg.wait_for_timeout(1500)
        await pg.evaluate("app.update = {}; app.safeUpdate()")
        ok(await pg.evaluate("!document.getElementById('updchip') && !!app.match"), 'no chip and no reload in a match')
        await b.close()
    srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print('SERVICE WORKER ' + ('OK' if not bad else f'{bad} FAILURE(S)'))
    sys.exit(1 if bad else 0)
asyncio.run(main())
