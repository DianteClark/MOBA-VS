# Social v2 end to end: three coaches in three browser profiles against a local Worker (wrangler dev), with the
# ?local=1 BroadcastChannel transport bridged between the profiles (as in tools/social_test.py).
#   friends → club: create, invite through the friends system, join from the invite card, preset chat, ladder →
#   custom room (Double gold + Fast respawns on a chosen map) hosted by Alice, Bob joins by code →
#   Carol watches Alice's match live from her friends list (10 s delay, exact sim), Broadcast mode on →
#   the match ends: no rating change, Publish to the Replay Hub → Carol upvotes, Featured card on Home →
#   Alice's public profile (club, reel, cabinet) → pass-and-play on one device (covers, colour tab, results).
#   npx --yes wrangler@4 dev --local --port 8835 --ip 127.0.0.1 --persist-to <fresh dir>   (repo root)
#   python3 tools/social2_test.py http://127.0.0.1:8835/ [shots-dir]
import sys, asyncio
from playwright.async_api import async_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8835/').rstrip('/')
SHOTS = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
URL = BASE + '/?local=1'
ONLY_PNP = len(sys.argv) > 3 and sys.argv[3] == 'pnp'  # just the pass-and-play part
BRIDGE = """(() => {
  const chans = {};
  class BridgeBC { constructor(name) { this.name = name; this.onmessage = null; (chans[name] = chans[name] || new Set()).add(this); }
    postMessage(data) { window.__bcSend(this.name, JSON.stringify(data)); }
    close() { if (chans[this.name]) chans[this.name].delete(this); } }
  window.__bcRecv = (name, s) => { const data = JSON.parse(s); for (const c of chans[name] || []) if (c.onmessage) c.onmessage({ data }); };
  window.BroadcastChannel = BridgeBC;
})();"""
DRAFT = """async () => { const m = await import('./src/sim/draft.js'); const s = app.session;
  if (!s || !s.draft) return 'wait'; if (s.draft.done) return 'done';
  const c = document.querySelector('.pnpcover .btn'); if (c) { c.click(); return 'cover'; }
  const t = m.currentTurn(s.draft); if (t.team === s.myTeam) app.draftAct(m.autoChoice(s.draft, t.team, s.rng, 1)); return 'drafting'; }"""
PREP = """() => { const c = document.querySelector('.pnpcover .btn'); if (c) { c.click(); return 'cover'; }
  if (app.match) return 'match'; const s = app.session; if (s && s.preps && !s.ready[s.myTeam]) app.prepReady(); return 'prep'; }"""

async def pnp(C, ok, shot):
    # ── pass-and-play on one device ──
    await C.evaluate("app.menu()"); await C.evaluate("app.playCustom({ rules: {}, map: 'sakura', event: null }, 'pnp')")
    await C.wait_for_selector('.pnpcover', timeout=15000); await shot(C, 'pnp-cover')
    covers = 0
    for _ in range(400):
        if await C.locator('.pnpcover').count(): covers += 1
        r = await C.evaluate(DRAFT)
        if r == 'done': break
        await C.wait_for_timeout(120)
    ok(covers >= 8, f'draft passes the device between sides ({covers} covers)')
    for _ in range(200):
        if await C.evaluate(PREP) == 'match': break
        await C.wait_for_timeout(200)
    ok(await C.evaluate("JSON.stringify(app.match.cfg.coach)") == '[false,false]', 'two human coaches')
    await C.click('.pnpt.t1'); await C.wait_for_timeout(400)
    ok(await C.evaluate("app.match.runner.myTeam === 1 && app.match.hud.my === 1"), 'colour tab hands the dock to Red'); await shot(C, 'pnp-match')
    await C.evaluate("app.match.hud.dock && app.match.runner.send({ type: 'safe' })"); await C.wait_for_timeout(300)
    ok(await C.evaluate("app.match.runner.log.some(([, c]) => c.some((x) => x.team === 1))"), 'commands act for the side in control')
    await C.evaluate("app.match.runner.speed = 25")
    sawHt = False
    for _ in range(4000):
        if await C.locator('.pnpcover').count(): sawHt = True; await C.click('.pnpcover .btn')
        await C.evaluate("document.querySelector('#halftime .btn.big') && document.querySelector('#halftime .btn.big').click()")
        if await C.evaluate("!!(app.session && app.session.finished && !app.match)"): break
        await C.wait_for_timeout(300)
    ok(sawHt, 'halftime: Blue then Red adjust')
    await C.wait_for_selector('.results', timeout=30000); await C.wait_for_timeout(1200)
    v = await C.inner_text('.verdict')
    ok('wins' in v, f'pass-and-play results ({v.strip()})'); await shot(C, 'pnp-results')

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
        async def shot(pg, n):
            if SHOTS: await pg.screenshot(path=f'{SHOTS}/{n}.png')
        if ONLY_PNP:
            C = await ctx_for('Carol'); await C.goto(URL, timeout=300000); await C.wait_for_function("window.app && document.querySelector('#screen .home2')", timeout=300000)
            await pnp(C, ok, shot); await b.close(); print('SOCIAL2 E2E OK' if not bad else f'SOCIAL2 E2E FAILED ({bad})'); sys.exit(1 if bad else 0)
        A = await ctx_for('Alice'); B = await ctx_for('Bob'); C = await ctx_for('Carol')
        for pg in (A, B, C): await pg.goto(URL, timeout=120000)
        for pg in (A, B, C): await pg.wait_for_function("window.app && JSON.parse(localStorage.getItem('mobavs_account') || 'null')", timeout=300000)
        acct = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('mobavs_account'))")
        aA, aB, aC = await acct(A), await acct(B), await acct(C)
        # friends: Bob and Carol befriend Alice (API, the UI is covered by tools/social_test.py)
        fa = "(id) => import('./src/net/online.js').then((m) => m.friendAction('add', id))"
        for pg in (B, C): await pg.evaluate(fa, aA['id'])
        for x in (aB, aC): await A.evaluate("(id) => import('./src/net/online.js').then((m) => m.friendAction('accept', id))", x['id'])
        refresh = "import('./src/ui/social.js').then((m) => m.refreshSocial())"
        for pg in (A, B, C): await pg.evaluate("app.menu()"); await pg.evaluate(refresh)
        await A.wait_for_timeout(2500)
        ok(await A.evaluate("import('./src/ui/social.js').then((m) => m.socialData().friends.length)") == 2, 'Alice has two friends')

        # ── clubs ──
        await A.click('.h2nav button:has-text("Club")'); await A.wait_for_selector('.clubpick', timeout=15000)
        await A.click('.clubpick .btn:has-text("Create club")')
        await A.fill('.cfields .acin >> nth=0', 'Sakura Foxes'); await A.fill('.cfields .ctag', 'sak')
        await A.click('.ccyc >> nth=0 >> .chip >> nth=1'); await shot(A, 'club-create')
        await A.click('.clubedit .btn.big'); await A.wait_for_selector('.clubhead', timeout=15000)
        ok('Sakura Foxes' in await A.inner_text('.clubhead') and '[SAK]' in await A.inner_text('.clubhead'), 'club created (name, tag, crest)')
        code = (await A.inner_text('.cjcode b')).strip()
        await A.click('.cjcode .chip:has-text("Invite")'); await A.wait_for_selector('.mpanel .frow')
        await A.locator('.mpanel .frow', has_text='Bob').locator('.btn').click(); await A.wait_for_timeout(1500)
        await A.click('.mpanel .x')
        await B.evaluate("app.menu()"); await B.evaluate(refresh)
        await B.wait_for_selector('.invpop', timeout=15000)
        ok('CLUB INVITE' in await B.inner_text('.invpop'), 'Bob gets a club invite card')
        await shot(B, 'club-invite')
        await B.click('.invpop .btn.big'); await B.wait_for_selector('.clubjoin', timeout=15000)
        await shot(B, 'club-join')
        await B.click('.clubjoin .btn.big'); await B.wait_for_selector('.clubhead', timeout=15000)
        ok(await B.locator('.clubmem .cmem').count() == 2, 'Bob joined: two members')
        await B.click('.cclines .chip >> nth=0'); await B.wait_for_timeout(1500)
        await A.evaluate("import('./src/ui/clubs.js').then((m) => m.showClub(app))"); await A.wait_for_selector('.clubhead', timeout=15000)
        ok('Hi club!' in await A.inner_text('.cclog'), 'preset chat reaches the club')
        await A.click('.cmem:has-text("Bob") .chip:has-text("Officer")'); await A.wait_for_timeout(1500)
        ok('Officer' in await A.inner_text('.cmem:has-text("Bob")'), 'owner makes Bob an officer')
        await shot(A, 'club-page')
        await A.click('.clubfoot .chip:has-text("Club ladder")'); await A.wait_for_timeout(1500); await shot(A, 'club-ladder')

        # ── custom room + spectating ──
        await A.evaluate("app.menu()"); await A.wait_for_timeout(300)
        await A.evaluate("app.playCustom({ rules: { gold2: true, respawn: true, single: true }, map: 'rush_ember', event: null }, 'host')")
        await A.wait_for_selector('.lobby .code', timeout=20000); await A.wait_for_timeout(800)
        room = (await A.inner_text('.lobby .code')).strip()
        ok('Custom game' in await A.inner_text('.lobby'), f'custom lobby shows the rules (room {room})')
        await shot(A, 'custom-lobby')
        await B.evaluate("app.menu()"); await B.evaluate(f"app.joinScreen('{room}', {{ checked: true }})")
        for _ in range(240):
            r = [await pg.evaluate(DRAFT) for pg in (A, B)]
            if r == ['done', 'done']: break
            await A.wait_for_timeout(150)
        sB = await B.evaluate("({ c: app.session.custom, map: app.session.mapId, ranked: app.session.ranked })")
        ok(sB['c'] == {'gold2': True, 'respawn': True, 'single': True} and sB['map'] == 'rush_ember' and not sB['ranked'], f'guest got the custom rules {sB}')
        for _ in range(200):
            r = [await pg.evaluate(PREP) for pg in (A, B)]
            if r == ['match', 'match']: break
            await A.wait_for_timeout(200)
        cfg = await A.evaluate("app.match && app.match.cfg.custom")
        ok(cfg == {'gold2': True, 'respawn': True, 'single': True}, 'match config carries cfg.custom')
        ok(await A.evaluate("app.match.cfg.mode") == 'rush', 'Single lane plays Lane Rush')
        await A.wait_for_timeout(4000)
        await C.evaluate("app.menu()")
        for _ in range(12):  # the relay announces itself through the (rate-limited) presence call
            await C.evaluate("import('./src/ui/home.js').then((m) => m.showProfile(app, 'friends'))"); await C.wait_for_timeout(5000)
            if await C.locator('.frow', has_text='Alice').locator('.watchbtn').count(): break
        ok(await C.locator('.frow', has_text='Alice').locator('.watchbtn').count() == 1, 'Carol sees Watch next to Alice')
        await shot(C, 'friends-watch')
        # speed the players up a little so the spectator has history to catch up on
        for pg in (A, B): await pg.evaluate("app.match.runner.speed = 3")
        await A.wait_for_timeout(6000)
        await C.locator('.frow', has_text='Alice').locator('.watchbtn').click()
        await C.wait_for_function("app.match && app.session && app.session.spectate", timeout=60000)
        ok(True, 'Carol is watching live')
        await C.wait_for_timeout(3000)
        st = await C.evaluate("({ t: app.match.game.tick, sum: app.match.game.checksum() })")
        at = await A.evaluate("app.match.game.tick")
        ok(st['t'] <= at - 200, f'spectator is at least 10 s behind (spec {st["t"]}, live {at})')
        # exact: replay the players' log on a fresh game to the spectator's tick
        same = await A.evaluate("""(t) => import('./src/sim/game.js').then(({ Game }) => { const m = app.match, g = new Game(JSON.parse(JSON.stringify(m.cfg))), log = m.runner.log; let i = 0;
          while (g.tick < t) { const c = []; while (i < log.length && log[i][0] === g.tick) c.push(...log[i++][1]); g.step(c); g.fx.length = 0; } return g.checksum(); })""", st['t'])
        ok(same == st['sum'], 'spectator sim is exact')
        ok(await C.locator('.speclive').count() == 1, 'LIVE tag on the spectator screen')
        await C.evaluate("app.match.bcast.set('on', true)"); await C.wait_for_timeout(1500)
        ok(await C.locator('.bcstats:not(.hidden)').count() == 1, 'Broadcast mode: stats overlay')
        await C.click('#ctrl .menubtn'); await C.click('.bcbtn'); await C.wait_for_selector('.bcsheet'); await shot(C, 'spectate-broadcast')
        await C.evaluate("app.match.bcast.menu(); app.match.bcast.set('clean', true)"); await C.wait_for_timeout(800)
        ok(await C.evaluate("document.body.classList.contains('bclean')"), 'clean HUD for capture'); await shot(C, 'spectate-clean')
        await C.evaluate("app.match.bcast.set('clean', false)"); await C.evaluate("app.menu()") # stop watching (saves CPU for the fast-forward)
        # play it out fast
        elo0 = await A.evaluate("import('./src/profile.js').then((m) => m.profile.elo)")
        hist0 = await A.evaluate("import('./src/profile.js').then((m) => m.profile.d.history.length)")
        for pg in (A, B): await pg.evaluate("app.match.runner.speed = 25")
        for _ in range(2400):
            done = [await pg.evaluate("!!(app.session && app.session.finished && !app.match)") for pg in (A, B)]
            if all(done): break
            for pg in (A, B): await pg.evaluate("app.match && app.match.runner.ht && !app.match.runner.ht.me && app.match.runner.readyHalftime()")
            await A.wait_for_timeout(500)
        await A.wait_for_selector('.results', timeout=30000); await A.wait_for_timeout(1500)
        ok('Custom game' in await A.inner_text('.rfoot'), 'results: custom note')
        ok(await A.evaluate("import('./src/profile.js').then((m) => m.profile.elo)") == elo0 and await A.evaluate("import('./src/profile.js').then((m) => m.profile.d.history.length)") == hist0, 'no rating change, no history entry')
        await shot(A, 'custom-results')
        await A.click('.pubbtn'); await A.wait_for_timeout(2500)
        ok('Published' in await A.inner_text('.pubbtn'), 'published to the Replay Hub')
        await C.wait_for_timeout(1000); await C.evaluate("app.menu()")
        await C.evaluate("import('./src/ui/hub.js').then((m) => m.showHub(app))"); await C.wait_for_selector('.hubrow', timeout=15000)
        await C.click('.hubrow .hubvote'); await C.wait_for_timeout(1500)
        ok('▲ 1' in await C.inner_text('.hubrow .hubvote'), 'Carol upvotes')
        await shot(C, 'hub')
        await C.evaluate("app.menu()"); await C.wait_for_selector('.h2feat:not(.hidden)', timeout=20000)
        ok(True, 'Featured card on Home'); await shot(C, 'home-featured')
        await C.click('.hubrow .btn' if await C.locator('.hubrow').count() else '.h2feat'); await C.wait_for_selector('.hubrow', timeout=15000)
        await C.click('.hubrow .btn:has-text("Watch")'); await C.wait_for_function("app.match && app.match.theater", timeout=30000)
        ok(True, 'hub replay opens in the Theater'); await C.wait_for_timeout(1500); await shot(C, 'hub-theater')
        await C.evaluate("app.match.theater.exit()"); await C.wait_for_timeout(1000)
        # public profile
        await C.evaluate("app.menu()")
        await C.evaluate(f"import('./src/ui/social.js').then((m) => m.showPlayer(app, '{aA['id']}', {{ name: 'Alice' }}))"); await C.wait_for_selector('.pextra', timeout=15000)
        txt = await C.inner_text('.pextra')
        ok('Sakura Foxes' in txt and 'Highlight reel' in txt and 'Trophy cabinet' in txt, 'public profile: club, cabinet, reel')
        await shot(C, 'profile-upgrade')
        await C.keyboard.press('Escape')

        await pnp(C, ok, shot)
        await b.close()
    print('SOCIAL2 E2E OK' if not bad else f'SOCIAL2 E2E FAILED ({bad})')
    sys.exit(1 if bad else 0)
asyncio.run(main())
