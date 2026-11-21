# Co-op friend invite against a local Worker (wrangler dev): two browser profiles (BroadcastChannel bridged
# between them, as in social_test.py) become friends, Alice invites Bob to Co-op from the Friends tab, Bob
# accepts the invite card and lands in Alice's co-op room, Alice starts and both open the co-op draft.
#   npx --yes wrangler@4 dev --local --port 18831 --ip 127.0.0.1 --persist-to <fresh dir>   (repo root)
#   python3 tools/coop_invite_test.py http://127.0.0.1:18831/ [shots-dir]
import sys, asyncio
from playwright.async_api import async_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:18831/').rstrip('/')
SHOTS = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
URL = BASE + '/?local=1'
BRIDGE = """(() => {
  const chans = {};
  class BridgeBC { constructor(name) { this.name = name; this.onmessage = null; (chans[name] = chans[name] || new Set()).add(this); }
    postMessage(data) { window.__bcSend(this.name, JSON.stringify(data)); }
    close() { if (chans[this.name]) chans[this.name].delete(this); } }
  window.__bcRecv = (name, s) => { const data = JSON.parse(s); for (const c of chans[name] || []) if (c.onmessage) c.onmessage({ data }); };
  window.BroadcastChannel = BridgeBC;
})();"""

async def main():
    bad = 0
    def ok(c, msg):
        nonlocal bad
        print(('  ok   ' if c else '  FAIL ') + msg, flush=True); bad += 0 if c else 1
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pages = {}
        async def ctx_for(name):
            ctx = await b.new_context(viewport={'width': 844, 'height': 390})
            await ctx.add_init_script(f"localStorage.setItem('mobavs_api', ''); if (!localStorage.getItem('mobavs_name')) localStorage.setItem('mobavs_name', '{name}');" + BRIDGE)
            async def send(source, chan, data):
                for k, other in pages.items():
                    if other is not source['page']: asyncio.ensure_future(other.evaluate('([n, d]) => window.__bcRecv && window.__bcRecv(n, d)', [chan, data]))
            await ctx.expose_binding('__bcSend', send)
            pg = await ctx.new_page(); pages[name] = pg
            pg.on('pageerror', lambda e: print(f'  JS error ({name}):', e))
            return pg
        A = await ctx_for('Alice'); B = await ctx_for('Bob')
        for pg in (A, B): await pg.goto(URL)
        await A.wait_for_timeout(4500)
        friends = lambda pg: pg.evaluate("import('./src/ui/home.js').then((m) => m.showProfile(app, 'friends'))")
        await friends(A); await friends(B); await A.wait_for_timeout(1200)
        code = (await A.inner_text('.fcode b')).strip()
        await B.fill('.fcode input', code); await B.click('.fcode .btn'); await B.wait_for_timeout(1200)
        await friends(A); await A.wait_for_timeout(1500)
        await A.locator('.frow', has_text='Bob').locator('.btn', has_text='Accept').click(); await A.wait_for_timeout(1500)
        ok(await A.locator('.frow.p-online', has_text='Bob').count() == 1, 'Alice and Bob are friends, Bob online')
        await A.locator('.frow', has_text='Bob').locator('.btn', has_text='Invite').click(); await A.wait_for_timeout(300)
        ok(await A.locator('.invmodes .btn', has_text='Co-op').count() == 1, 'invite modes include Co-op')
        if SHOTS: await A.screenshot(path=f'{SHOTS}/coop_invite_modes.png')
        await A.locator('.invmodes .btn', has_text='Co-op').click(); await A.wait_for_timeout(2000)
        ok(await A.locator('.coop').count() == 1 and 'Invite sent to Bob' in await A.inner_text('.coop .lobbyinv'), 'co-op room opened with the invite sent')
        await B.evaluate("app.menu()"); await B.wait_for_timeout(500)
        await B.evaluate("import('./src/ui/social.js').then((m) => m.refreshSocial())")
        await B.wait_for_selector('.invpop', timeout=8000)
        ok('Co-op' in await B.inner_text('.invpop'), 'Bob gets a Co-op invite card')
        if SHOTS: await B.screenshot(path=f'{SHOTS}/coop_invite_card.png')
        await B.click('.invpop .btn'); await B.wait_for_timeout(3000)
        ok(await B.locator('.coop .cseat.me').count() == 1, 'Bob is seated in the co-op room')
        ok(await A.evaluate("app.session.room.players.length === 2"), "Alice's room has both coaches")
        await A.click('.cbtns .btn.big', force=True); await A.wait_for_timeout(1500)
        ok(await A.evaluate("!!app.session.draft") and await B.evaluate("!!app.session.draft && app.session.mode === 'coop'"), 'both open the co-op draft')
        await b.close()
    print('CO-OP INVITE OK ✔' if not bad else f'CO-OP INVITE FAILED ✘ ({bad})')
    sys.exit(1 if bad else 0)
asyncio.run(main())
