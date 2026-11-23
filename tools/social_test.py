# Social end to end: two coaches in two browser profiles against a local Worker (wrangler dev), with the
# ?local=1 BroadcastChannel transport bridged between the two profiles (they cannot share a channel).
#   friend code add → request → accept → presence → Ranked friend invite → invite card → join →
#   both rated (ranked AND-handshake) → match (sped up) → results: ladder verified, Rematch both accept →
#   sides swapped → second match → leaving closes the other's Rematch → friends ladder, public profile,
#   history opponent → link invite (/i/CODE) → block.
#   npx --yes wrangler@4 dev --local --port 8834 --ip 127.0.0.1    (from the repo root, fresh --persist-to dir)
#   python3 tools/social_test.py http://127.0.0.1:8834/ [shots-dir] [quick]
import sys, asyncio, json
from playwright.async_api import async_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8834/').rstrip('/')
SHOTS = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
QUICK = len(sys.argv) > 3 and sys.argv[3] == 'quick'  # skip the two played matches (rematch); everything else runs
URL = BASE + '/?local=1'
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
  const t = m.currentTurn(s.draft); if (t.team === s.myTeam) app.draftAct(m.autoChoice(s.draft, t.team, s.rng, 1)); return 'drafting'; }"""
FAST = """() => { const m = app.match; if (!m) return app.session && app.session.finished ? 'over' : 'none';
  m.runner.speed = 25; if (m.runner.ht && !m.runner.ht.me) m.runner.readyHalftime(); return m.game.over ? 'over' : String(m.game.tick); }"""

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
        acct = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('mobavs_account') || 'null')")
        aA, aB = await acct(A), await acct(B)
        ok(bool(aA and aB and aA['id'] != aB['id']), 'two accounts')
        async def shot(pg, n):
            if SHOTS: await pg.screenshot(path=f'{SHOTS}/{n}.png')
        friends = lambda pg: pg.evaluate("import('./src/ui/home.js').then((m) => m.showProfile(app, 'friends'))")
        # ── friend request by code, through the UI ──
        await friends(A); await friends(B); await A.wait_for_timeout(1200)
        code = (await A.inner_text('.fcode b')).strip()
        ok(code.replace('-', '') == aA['id'], f'friend code shown ({code})')
        await B.fill('.fcode input', code.lower()); await B.click('.fcode .btn'); await B.wait_for_timeout(1200)
        await friends(A); await A.wait_for_timeout(1500)
        ok(await A.locator('.flist .frow', has_text='Bob').count() == 1, 'Alice sees Bob\'s request')
        await shot(A, 'friends-request')
        await A.locator('.frow', has_text='Bob').locator('.btn', has_text='Accept').click(); await A.wait_for_timeout(1500)
        ok(await A.locator('.frow.p-online', has_text='Bob').count() == 1, 'Alice: Bob is a friend and online')
        await shot(A, 'friends-list')
        # ── Ranked friend invite ──
        await A.locator('.frow', has_text='Bob').locator('.btn', has_text='Invite').click(); await A.wait_for_timeout(300)
        await shot(A, 'invite-modes')
        await A.locator('.invmodes .btn', has_text='Ranked').click(); await A.wait_for_timeout(1500)
        ok('Invite sent to Bob' in await A.inner_text('.lobbyinv'), 'lobby: invite sent')
        await shot(A, 'lobby-invite')
        await B.evaluate("app.menu()"); await B.wait_for_timeout(500)
        await B.evaluate("import('./src/ui/social.js').then((m) => m.refreshSocial())")
        await B.wait_for_selector('.invpop', timeout=8000)
        ok('Alice invites you' in await B.inner_text('.invpop') and 'Ranked' in await B.inner_text('.invpop'), 'Bob gets the Ranked invite card')
        await shot(B, 'invite-card')
        await B.click('.invpop .btn'); await B.wait_for_timeout(2500)
        sA = await A.evaluate("app.session && { ranked: app.session.ranked, queue: app.session.queue, team: app.session.myTeam, opp: app.session.oppId }")
        sB = await B.evaluate("app.session && { ranked: app.session.ranked, queue: app.session.queue, team: app.session.myTeam, opp: app.session.oppId }")
        ok(bool(sA and sB and sA['ranked'] and sB['ranked'] and sA['opp'] == aB['id'] and sB['opp'] == aA['id']), f'both in a rated private match {sA} {sB}')
        # ── play it out fast ──
        async def play(tag):
            for _ in range(300):
                da = await A.evaluate(DRAFT); db = await B.evaluate(DRAFT)
                if da == 'done' and db == 'done': break
                await A.wait_for_timeout(120)
            await A.wait_for_timeout(1500)
            for pg in (A, B): await pg.wait_for_function("!!(app.session && app.session.ready && app.session.myPrep)", timeout=20000); await pg.evaluate("app.prepReady()")
            await A.wait_for_timeout(2000)
            for i in range(900):
                fa = await A.evaluate(FAST); fb = await B.evaluate(FAST)
                if fa == 'over' and fb == 'over': break
                await A.wait_for_timeout(200)
            await A.wait_for_timeout(6500)
            ok(await A.locator('.results').count() == 1 and await B.locator('.results').count() == 1, f'{tag}: both on results')
        if QUICK:
            await A.evaluate("app.menu()"); await B.evaluate("app.menu()")
        else:
          await play('match 1')
          await A.wait_for_timeout(5000)
          ok('verified' in (await A.inner_text('.ladderres')).lower(), 'match 1: ranked result verified on the ladder')
          ok(await A.locator('.rmatch').count() == 1 and await B.locator('.rmatch').count() == 1, 'results: opponent/rematch panel on both')
          await B.locator('.rmatch .btn', has_text='Rematch').click(); await A.wait_for_timeout(800)
          ok(await A.locator('.rmatch .btn.hot', has_text='Accept rematch').count() == 1, 'Alice sees "Accept rematch"')
          await A.locator('.rmatch').scroll_into_view_if_needed(); await shot(A, 'results-rematch')
          await A.locator('.rmatch .btn', has_text='Accept rematch').click(force=True); await A.wait_for_timeout(1500)
          s2A = await A.evaluate("app.session && { team: app.session.myTeam, ranked: app.session.ranked, draft: !!app.session.draft, m: app.session.matchId }")
          s2B = await B.evaluate("app.session && { team: app.session.myTeam, ranked: app.session.ranked, draft: !!app.session.draft, m: app.session.matchId }")
          ok(bool(s2A and s2B and s2A['draft'] and s2B['draft'] and s2A['team'] == 1 - sA['team'] and s2B['team'] == 1 - sB['team'] and s2A['m'] == s2B['m'] and s2A['ranked'] and s2B['ranked']),
             f'rematch: both drafting, sides swapped, same match id, still ranked {s2A} {s2B}')
          await play('match 2 (rematch)')
          await A.wait_for_timeout(5000)
          ok('verified' in (await B.inner_text('.ladderres')).lower(), 'rematch: verified (sides swapped, reports agree)')
          await A.evaluate("app.menu()"); await B.wait_for_timeout(1500)
          ok('left' in await B.inner_text('.rmatch') and await B.locator('.rmatch .btn[disabled]').count() == 1, 'leaving closes the opponent\'s Rematch')
        await B.evaluate("app.menu()")
        # ── leaderboard: friends filter, pin, row → profile ──
        await A.evaluate("import('./src/ui/online.js').then((m) => m.showLeaderboard(app, 'friends'))"); await A.wait_for_timeout(2000)
        ok(QUICK or await A.locator('.lblist button.lbr').count() == 2, 'friends ladder lists the two friends')
        await shot(A, 'ladder-friends')
        if QUICK: await A.evaluate(f"import('./src/ui/social.js').then((m) => m.showPlayer(app, '{aB['id']}', {{ name: 'Bob' }}))")
        else: await A.locator('.lblist button.lbr', has_text='Bob').click()
        await A.wait_for_timeout(1500)
        txt = await A.inner_text('.pprof')
        if not QUICK: ok('online ladder' in txt and 'Recent results' in txt and 'Top heroes' in txt, 'public profile: ladder line, recent results, top heroes')
        await shot(A, 'profile-bob')
        await A.click('.smodal .x')
        await A.evaluate("import('./src/ui/home.js').then((m) => m.showHistory(app, 0))"); await A.wait_for_timeout(500)
        if not QUICK: ok(await A.locator('.hd .btn', has_text='Opponent').count() == 1, 'history: opponent profile button')
        # ── link invite: /i/CODE ──
        await A.evaluate("() => { app.hostGame({ checked: true }); }"); await A.wait_for_timeout(800)
        inv = await A.evaluate("""(async () => { const o = await import('./src/net/online.js'); const code = document.querySelector('.lobby .code').textContent; const r = await o.createInvite(code, 'casual', null); app.inviteRoom = code; return r; })()""")
        resp = await B.goto(BASE + '/i/' + inv['id']); await B.wait_for_timeout(500)
        ok(resp.url.endswith('/?i=' + inv['id']) and resp.request.redirected_from is not None, f'/i/CODE redirects into the game ({resp.url})')
        await B.goto(BASE + '/?local=1&i=' + inv['id']); await B.wait_for_timeout(4000)
        ok('Alice' in await B.inner_text('.invland'), 'invite landing shows the host')
        await shot(B, 'invite-landing')
        await B.locator('.invland .btn', has_text='Join').click(); await B.wait_for_timeout(2500)
        ok(await A.evaluate("!!(app.session && app.session.draft)") and await B.evaluate("!!(app.session && app.session.draft && app.session.ranked === false)"), 'link invite: joined the room (casual)')
        st = await A.evaluate(f"(async () => (await import('./src/net/online.js')).getInvite('{inv['id']}'))()")
        ok(st['status'] == 'cancelled', 'room started: its link invite is closed')
        await A.evaluate("app.menu()"); await B.evaluate("app.menu()"); await A.wait_for_timeout(800)
        # ── block from the public profile ──
        B.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await B.evaluate(f"import('./src/ui/social.js').then((m) => m.showPlayer(app, '{aA['id']}', {{ name: 'Alice' }}))"); await B.wait_for_timeout(1500)
        await B.locator('.pact .chip', has_text='Block').click(); await B.wait_for_timeout(2500)
        ok(await B.locator('.pact .chip', has_text='Unblock').count() == 1, 'blocked from the profile')
        await B.click('.smodal .x'); await friends(B); await B.wait_for_timeout(1500)
        ok(await B.locator('.frow', has_text='Alice').count() == 1 and await B.locator('details.flist').count() == 1, 'Alice moved to Blocked')
        await friends(A); await A.wait_for_timeout(1500)
        # (Bob may still show under Recently played: that row has no presence class)
        ok(await A.locator('.frow.p-online, .frow.p-match, .frow.p-offline', has_text='Bob').count() == 0, 'Alice no longer has Bob as a friend')
        await b.close()
    print('SOCIAL OK' if not bad else f'SOCIAL: {bad} FAILED')
    sys.exit(1 if bad else 0)
asyncio.run(main())
