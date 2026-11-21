# Service worker test: offline relaunch, deploy pick-up, VERSION bump, and "never reload mid-match".
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
        ok(await pg.evaluate("!!document.querySelector('#screen .home')"), 'offline relaunch shows the menu')
        await ctx.set_offline(False)

        # 2) a deploy without a VERSION bump: stale first, then refreshed and reloaded on the menu
        p_dom = os.path.join(site, 'src/ui/dom.js')
        with open(p_dom, 'a') as f: f.write('\n// deploy marker 1\n')
        await pg.reload(); await pg.wait_for_timeout(500)
        await pg.evaluate("window.__mark = 1")
        await pg.wait_for_timeout(5000)
        ok(await pg.evaluate("window.__mark !== 1"), 'page reloaded itself after the deploy (on the menu)')
        txt = await pg.evaluate("caches.match('src/ui/dom.js').then((r) => r && r.text())")
        ok(bool(txt) and 'deploy marker 1' in txt, 'cache now holds the new build')

        # 3) never mid-match: a deploy lands during a match, the reload waits for the menu
        await pg.wait_for_timeout(1500)
        await pg.evaluate("app.watch()"); await pg.wait_for_timeout(2500)
        await pg.evaluate("window.__mark = 2")
        with open(p_dom, 'a') as f: f.write('\n// deploy marker 2\n')
        # simulate the next background check (the worker revalidates what it serves)
        await pg.evaluate("fetch('src/ui/dom.js')")
        await pg.wait_for_timeout(4000)
        ok(await pg.evaluate("window.__mark === 2 && !!app.match"), 'no reload while the match is running')
        await pg.evaluate("app.match.game.over = true; app.match = null; app.menu()")
        await pg.wait_for_timeout(3000)
        ok(await pg.evaluate("window.__mark !== 2"), 'reloaded once back on the menu')

        # 4) VERSION bump: a new worker + cache, old cache deleted
        p_main = os.path.join(site, 'src/main.js')
        src = open(p_main).read(); m = re.search(r'const VERSION = (\d+);', src); v = int(m.group(1))
        open(p_main, 'w').write(src.replace(m.group(0), f'const VERSION = {v + 1};'))
        await pg.reload(); await pg.wait_for_timeout(9000)
        keys = await pg.evaluate("caches.keys()")
        ok(f'mobavs-v{v + 1}' in keys and f'mobavs-v{v}' not in keys, f'cache bumped to v{v + 1}: {keys}')
        ok(await pg.evaluate(f"navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('v={v + 1}')"), 'new worker controls the page')
        ok(await pg.evaluate("!!document.querySelector('#screen .home')"), 'menu up after the switch')
        await b.close()
    srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print('SERVICE WORKER ' + ('OK' if not bad else f'{bad} FAILURE(S)'))
    sys.exit(1 if bad else 0)
asyncio.run(main())
