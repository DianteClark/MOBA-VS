# Weekend Cup in the browser: two coaches in two browser profiles plus six API coaches, against a local Worker.
# The ?local=1 BroadcastChannel transport is bridged between the two profiles (as in social_test.py).
#   sign up through the UI (A first = seed 1, B last = seed 8, so they meet in quarterfinal 1) → live bracket →
#   check-in → both connect to the server's room → draft → match (sped up) → both reports agree → the browser's
#   uploaded replay is re-simulated by tools/verify.mjs and verified → A wins the semifinal and the final by
#   no-show (the API coaches never check in) → champion screen → Weekend Cup trophy on the public profile.
#   npx --yes wrangler@4 dev --local --port 8845 --ip 127.0.0.1 --persist-to <fresh dir> \
#     --var CUP_OPEN:always --var CUP_READY_MS:90000 --var MOBAVS_ADMIN:local-test-token-0123456789
#   python3 tools/cup_test.py http://127.0.0.1:8845/ [shots-dir]
import sys, asyncio, json, os, subprocess, urllib.request
from playwright.async_api import async_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8845/').rstrip('/')
SHOTS = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
TOKEN = 'local-test-token-0123456789'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
  m.runner.speed = 25;
  if (!(m.game.tick < (m.nextCall || 0))) { m.nextCall = m.game.tick + 500; const l = ['top', 'mid', 'bot'][(m.game.tick / 500 | 0) % 3]; m.runner.send(m.game.tick % 1000 < 500 ? { type: 'group', lane: l } : { type: 'gank', lane: l }); } if (m.runner.ht && !m.runner.ht.me) m.runner.readyHalftime(); return m.game.over ? 'over' : String(m.game.tick); }"""
CUP = "import('./src/ui/cups.js').then((m) => m.showWeekendCup(app))"

def api(path, body=None, who=None, token=None):
    req = urllib.request.Request(BASE + path, method='POST' if body is not None else 'GET', data=json.dumps(body).encode() if body is not None else None)
    req.add_header('content-type', 'application/json')
    if who: req.add_header('authorization', f"Bearer {who['id']}.{who['secret']}")
    if token: req.add_header('authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return {'status': e.code, **json.loads(e.read() or b'{}')}

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
        A = await ctx_for('Alice'); B = await ctx_for('Bob')
        for pg in (A, B): await pg.goto(URL)
        await A.wait_for_timeout(4500)
        acct = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('mobavs_account') || 'null')")
        aA, aB = await acct(A), await acct(B)
        ok(bool(aA and aB and aA['id'] != aB['id']), 'two accounts')
        V = await A.evaluate('app.version')
        # ── the Cup tile → Weekend Cup tab ──
        await A.evaluate("import('./src/ui/home.js').then((m) => m.showCup(app))"); await A.wait_for_timeout(500)
        await A.locator('.cuptabs .chip', has_text='Weekend Cup').click(); await A.wait_for_timeout(1500)
        ok(await A.locator('.wcup .btn', has_text='Join the next cup').count() == 1, 'Weekend Cup screen: Join button')
        await shot(A, 'cup-lobby')
        await A.locator('.wcup .btn', has_text='Join the next cup').click(); await A.wait_for_timeout(1200)
        ok('1' in await A.inner_text('.wccount') and await A.locator('.wcpips i.on').count() == 1, 'signed up: 1 / 8')
        bots = []
        for i in range(6):
            a = api('/api/account', {'name': f'Bot{i + 1}'}); bots.append({'id': a['id'], 'secret': a['secret']})
            api('/api/cup/join', {'version': V}, who=bots[-1])
        await A.wait_for_timeout(9000)
        ok('7' in await A.inner_text('.wccount') and await A.locator('.wcnames .chip').count() == 7, 'sign-up list updates live: 7 / 8')
        await shot(A, 'cup-signup')
        await B.evaluate(CUP); await B.wait_for_timeout(1500)
        ok('filling up: 7 / 8' in await B.inner_text('.wcup'), 'Bob sees the cup filling up')
        await B.locator('.wcup .btn', has_text='Join the next cup').click(); await B.wait_for_timeout(1500)
        ok(await B.locator('.wcbracket').count() == 1, 'eighth sign-up: the bracket is live')
        await A.wait_for_timeout(9000)
        ok(await A.locator('.wcmatch.hot .btn', has_text='Ready').count() == 1 and 'Bob' in await A.inner_text('.wcmatch'), 'Alice: quarterfinal check-in vs Bob')
        await shot(A, 'cup-checkin')
        st = api(f'/api/cup?v={V}', who=bots[0]); cup = st['cup']['id']
        seed = {p['id']: p['seed'] for p in st['cup']['players']}
        ok(seed[aA['id']] == 1 and seed[aB['id']] == 8, 'seeds: Alice 1, Bob 8')
        # the other quarterfinals: the API coaches (seeds 2-7) check in and agree on a result right away
        for slot in (1, 2, 3):
            m = [x for x in st['cup']['matches'] if x['round'] == 0 and x['slot'] == slot][0]
            ba = next(x for x in bots if x['id'] == m['a']); bb = next(x for x in bots if x['id'] == m['b'])
            api('/api/cup/ready', {'cup': cup}, who=ba); r = api('/api/cup/ready', {'cup': cup}, who=bb)
            mid = r['me']['match']['match']
            for who, side, opp in ((ba, 0, bb), (bb, 1, ba)):
                api('/api/match/report', {'match': mid, 'season': 1, 'side': side, 'opponent': opp['id'], 'winner': 0, 'checksum': '42', 'mode': 'cup'}, who=who)
        # ...and the semifinal between two of them (it exists as soon as its two quarterfinals are decided)
        st = api(f'/api/cup?v={V}', who=bots[0])
        m = [x for x in st['cup']['matches'] if x['round'] == 1 and x['slot'] == 1][0]
        ba = next(x for x in bots if x['id'] == m['a']); bb = next(x for x in bots if x['id'] == m['b'])
        api('/api/cup/ready', {'cup': cup}, who=ba); r = api('/api/cup/ready', {'cup': cup}, who=bb)
        for who, side, opp in ((ba, 0, bb), (bb, 1, ba)):
            api('/api/match/report', {'match': r['me']['match']['match'], 'season': 1, 'side': side, 'opponent': opp['id'], 'winner': 1, 'checksum': '43', 'mode': 'cup'}, who=who)
        await A.locator('.wcmatch .btn', has_text='Ready').click(); await A.wait_for_timeout(800)
        ok('Waiting for Bob' in await A.inner_text('.wcmatch'), 'Alice ready, waiting for Bob')
        await B.locator('.wcmatch .btn', has_text='Ready').click()
        for _ in range(60):
            if await A.evaluate("!!(app.session && app.session.draft)") and await B.evaluate("!!(app.session && app.session.draft)"): break
            await A.wait_for_timeout(500)
        sA = await A.evaluate("app.session && { q: app.session.queue, m: app.session.matchId, w: app.session.wcup && app.session.wcup.match, map: app.session.mapId, team: app.session.myTeam }")
        sB = await B.evaluate("app.session && { q: app.session.queue, m: app.session.matchId, w: app.session.wcup && app.session.wcup.match, map: app.session.mapId, team: app.session.myTeam }")
        ok(bool(sA and sB and sA['q'] == 'cup' and sA['m'] == sB['m'] == sA['w'] and sA['team'] == 0 and sB['team'] == 1), f'both drafting the cup match (same server match id) {sA} {sB}')
        # play it out fast
        for _ in range(300):
            da = await A.evaluate(DRAFT); db = await B.evaluate(DRAFT)
            if da == 'done' and db == 'done': break
            await A.wait_for_timeout(120)
        await A.wait_for_timeout(1500)
        for pg in (A, B): await pg.evaluate("app.prepReady()")
        await A.wait_for_timeout(2000)
        for i in range(900):
            fa = await A.evaluate(FAST); fb = await B.evaluate(FAST)
            if fa == 'over' and fb == 'over': break
            await A.wait_for_timeout(200)
        await A.wait_for_timeout(9000)
        txtA, txtB = await A.inner_text('.ladderres'), await B.inner_text('.ladderres')
        ok('Cup result confirmed' in txtA and 'Cup result confirmed' in txtB, f'results: cup result confirmed on both ("{txtA}" / "{txtB}")')
        ok(await A.locator('.rmatch').count() == 0, 'no rematch panel in a cup')
        await shot(A, 'cup-results')
        st = api(f'/api/cup?v={V}', who=bots[0])
        q0 = [m for m in st['cup']['matches'] if m['round'] == 0 and m['slot'] == 0][0]
        alice_won = q0['winner'] == aA['id']
        ok(q0['status'] == 'done' and q0['reason'] == 'played', f"quarterfinal 1 decided ({'Alice' if alice_won else 'Bob'} advances)")
        W, Wp, L = (aA, A, B) if alice_won else (aB, B, A)
        # back to the bracket: the winner checks in for the semifinal; the bot never does → no-show win
        await Wp.locator('.results .btn', has_text='Back to bracket').click(); await Wp.wait_for_timeout(5000)
        ok(await Wp.locator('.wcmatch .btn', has_text='Ready').count() == 1 and 'Semifinal' in await Wp.inner_text('.wcmatch'), 'back to bracket: semifinal check-in')
        await shot(Wp, 'cup-semi')
        await L.evaluate(CUP); await L.wait_for_timeout(2000)
        ok('Knocked out' in await L.inner_text('.wcup'), 'the loser sees they are out and can follow the bracket')
        await shot(L, 'cup-out')
        await L.set_viewport_size({'width': 667, 'height': 375}); await L.wait_for_timeout(500); await shot(L, 'cup-out-667')
        await Wp.locator('.wcmatch .btn', has_text='Ready').click(); await Wp.wait_for_timeout(1000)
        await shot(Wp, 'cup-semi-ready')
        # ── the browser's replay is re-simulated and verified ──
        q = api('/api/admin/replays?limit=50', token=TOKEN)
        mine = [r for r in q['replays'] if r['match'] == sA['m']]
        ok(len(mine) == 1 and mine[0]['enc'] == 'gz64' and 300 < len(mine[0]['data']) < 20000, f"one gzipped replay queued for the match ({len(mine[0]['data']) if mine else 0} bytes; the two clients' logs are identical)")
        out = subprocess.run(['node', 'tools/verify.mjs', '--api', BASE, '--workers', '2'], cwd=ROOT, env={**os.environ, 'MOBAVS_ADMIN': TOKEN}, capture_output=True, text=True).stdout
        print('\n'.join('       ' + l for l in out.strip().split('\n')))
        ok(f"{sA['m']}: ok" in out and 'mismatched 0' in out, 'browser replay re-simulated: verified')
        # semifinal, then final: the API coach never checks in
        for rnd in (1, 2):
            if rnd == 2: await Wp.locator('.wcmatch .btn', has_text='Ready').click(); await Wp.wait_for_timeout(1000)
            print(f'  … waiting for the {"semifinal" if rnd == 1 else "final"} check-in deadline (90 s)', flush=True)
            for _ in range(60):
                await Wp.wait_for_timeout(2500)
                t = await Wp.inner_text('.wcup')
                if ('Final' in t and 'Ready' in t and rnd == 1) or 'won the Weekend Cup' in t: break
        await Wp.wait_for_timeout(1000)
        ok('You won the Weekend Cup!' in await Wp.inner_text('.wcup'), 'champion screen')
        await shot(Wp, 'cup-champion')
        await Wp.evaluate("document.querySelector('.wchist').open = true"); await Wp.wait_for_timeout(300)
        await Wp.evaluate("document.querySelector('.wchist').scrollIntoView()"); await shot(Wp, 'cup-history')
        await Wp.evaluate(CUP); await Wp.wait_for_timeout(2500)
        ok('1 won' in await Wp.inner_text('.wchist summary'), 'trophies: 1 cup won')
        await Wp.evaluate(f"import('./src/ui/social.js').then((m) => m.showPlayer(app, '{W['id']}', {{ name: 'Champ' }}))"); await Wp.wait_for_timeout(1500)
        ok('1 Weekend Cup' in await Wp.inner_text('.pprof'), 'public profile: Weekend Cup trophy')
        await shot(Wp, 'cup-profile')
        await b.close()
    print('CUP UI OK' if not bad else f'CUP UI: {bad} FAILED')
    sys.exit(1 if bad else 0)

asyncio.run(main())
