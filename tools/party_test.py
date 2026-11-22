# Parties end to end with real tabs (src/party.js, src/ui/party.js).
#  local  (?local=1 BroadcastChannel, no Worker; one browser context, several tabs):
#         Join by party code (the link is handed to the party) → panel on both Homes → quick chat → leader Start
#         waits for Ready → Co-op vs AI auto-starts → match → results (Play again / Back to party) → Play again →
#         back to the party → private 2v2 room (partner on blue, two more coaches join red) → partner's link
#         drops and comes back → partner leaves → leader disbands.
#  worker (wrangler dev --local, four browser profiles bridged as in social_test.py):
#         friends → party invite from the invite dialog → invite card → in the party → Find Match 2v2 as a party
#         + two solo coaches (2+1+1) → everyone in one 2v2 room on the sides the server chose → draft starts;
#         back to the party → a second party formed from an invite link → 2+2 → match start. No one else
#         searching → "no one online" within the time limit is covered by tools/duo_test.mjs (API level).
#   python3 tools/party_test.py local  http://127.0.0.1:8867/ [shots]
#   python3 tools/party_test.py worker http://127.0.0.1:8858/ [shots]   (npx --yes wrangler@4 dev --local --port 8858 --ip 127.0.0.1 --persist-to <fresh dir>)
import sys, asyncio, os, json
from playwright.async_api import async_playwright
PART = sys.argv[1] if len(sys.argv) > 1 else 'local'
BASE = (sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8867/').rstrip('/')
SHOTS = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
DRAFT = """async () => { const m = await import('./src/coop-room.js'); const s = app.session;
  if (!s || !s.draft) return 'wait'; if (s.draft.done) return 'done';
  if (app.myDraftTurn()) app.draftAct(m.draftAuto(s)); return 'drafting'; }"""
PARTY = "(async () => { const m = await import('./src/party.js'); const P = m.party(); return P ? JSON.stringify({ code: P.code, leader: P.leader, mode: P.mode, want: P.want, members: P.members.map((x) => ({ name: x.name, ready: x.ready, busy: x.busy, lost: x.lost, leader: x.leader })) }) : 'null'; })()"
BRIDGE = """(() => {
  const chans = {};
  class BridgeBC { constructor(name) { this.name = name; this.onmessage = null; (chans[name] = chans[name] || new Set()).add(this); }
    postMessage(data) { window.__bcSend(this.name, JSON.stringify(data)); }
    close() { if (chans[this.name]) chans[this.name].delete(this); } }
  window.__bcRecv = (name, s) => { const data = JSON.parse(s); for (const c of chans[name] || []) if (c.onmessage) c.onmessage({ data }); };
  window.BroadcastChannel = BridgeBC;
})();"""

bad = 0
def ok(c, msg):
    global bad
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True); bad += 0 if c else 1
async def shot(pg, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); await pg.screenshot(path=os.path.join(SHOTS, name + '.png'))
async def until(pg, js, ms=8000):
    for _ in range(ms // 100):
        try:
            if await pg.evaluate(js): return True
        except Exception: pass
        await pg.wait_for_timeout(100)
    return False
async def party(pg): return json.loads(await pg.evaluate(PARTY))
async def draft(pages):
    for _ in range(500):
        st = [await pg.evaluate(DRAFT) for pg in pages]
        if all(x == 'done' for x in st): return True
        await pages[0].wait_for_timeout(120)
    return False
async def play_to_results(pages):
    ok(await draft(pages), 'co-op draft finished')
    await pages[0].wait_for_timeout(1300)
    for pg in pages: await pg.evaluate("app.prepReady()")
    inm = True
    for pg in pages: inm = inm and await until(pg, "!!(app.match && app.match.runner.online)", 10000)
    ok(inm, 'everyone is in the co-op match')
    await pages[0].wait_for_timeout(1500)
    for pg in pages: await pg.evaluate("app.match.game.over = true; app.match.game.winner = 0")
    res = True
    for pg in pages: res = res and await until(pg, "!!document.querySelector('.results')", 12000)
    ok(res, 'results on every tab')

async def local(b):
    errors = []
    ctx = await b.new_context(viewport={'width': 667, 'height': 375})
    await ctx.add_init_script("localStorage.setItem('mobavs_api', 'http://127.0.0.1:9'); localStorage.setItem('mobavs_tips', '{\"done\":true}');")
    async def tab(name):
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        await pg.goto(BASE + '/index.html?local=1'); await pg.wait_for_timeout(2200)
        await pg.evaluate(f"() => {{ app.setName('{name}'); window.confirm = () => true; app.menu(); }}")
        return pg
    A = await tab('Ana'); B = await tab('Mia')
    print('— party by code —')
    await A.click('.partychip')
    ok(await until(A, "!!document.querySelector('.pinvite')"), 'Party opens the invite dialog (party created)')
    code = (await A.inner_text('.pinvite .pcode b')).strip()
    ok(len(code) == 5, f'party code shown ({code})')
    await shot(A, 'party_invite_dialog')
    await A.click('.pinvite .x')
    ok(await until(A, "!!document.querySelector('.ppanel')"), "leader's Home shows the party panel")
    await B.evaluate(f"app.joinScreen('{code}', {{ checked: true }})")
    ok(await until(A, "document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 2"), 'partner joined by typing the party code into Join')
    ok(await until(B, "!!document.querySelector('.ppanel') && document.querySelectorAll('.ppanel .pmem').length === 2"), "partner's Home shows the same party panel")
    pa, pb = await party(A), await party(B)
    ok(pa['code'] == pb['code'] == code and [m['name'] for m in pa['members']] == [m['name'] for m in pb['members']] == ['Ana', 'Mia'], 'both see the same members')
    ok(not pb['leader'] and pa['leader'], 'Ana leads, Mia is the partner')
    ok(await B.evaluate("!document.querySelector('.ppanel .pmodes') && !!document.querySelector('.ppanel .pgo')"), 'partner sees the mode, not the mode switch')
    # quick chat
    await B.click('.ppanel .pchatbtn'); await B.click('.pchat .chip:nth-child(3)')
    ok(await until(A, "(document.querySelector('.ppanel .psay') || {}).textContent === 'One more?'", 3000), 'partner quick chat shows on the leader panel')
    await shot(A, 'party_panel_leader'); await shot(B, 'party_panel_partner')
    # Start waits for Ready, then Co-op vs AI starts by itself
    await A.click('.ppanel .pgo', force=True)
    ok(await until(B, "!!document.querySelector('.ppanel .pgo.nudge')", 3000), "leader's Start nudges the partner's Ready")
    ok(await A.evaluate("!app.session"), 'nothing launches before the partner is ready')
    await shot(B, 'party_nudge_partner')
    await B.click('.ppanel .pgo', force=True)  # (it pulses)
    ok(await until(A, "!!(app.session && app.session.draft)", 10000) and await until(B, "!!(app.session && app.session.draft)", 10000), 'Ready → Co-op vs AI starts on both (auto room)')
    s = json.loads(await B.evaluate("JSON.stringify({ mode: app.session.mode, kind: app.session.kind, team: app.session.myTeam, seat: app.session.mySeat, ai: app.session.ai })"))
    ok(s['mode'] == 'coop' and s['kind'] == 'ai' and s['team'] == 0 and s['seat'] == 1 and s['ai'] == [False, True], f'partner is blue seat B vs the AI ({s})')
    ok(await until(A, "import('./src/party.js').then((m) => m.party().members[1].busy)", 4000), 'leader sees the partner as in a match')
    await play_to_results([A, B])
    ok(await A.evaluate("[...document.querySelectorAll('.results button')].some((b) => b.textContent.trim() === 'Play again')"), 'leader results: Play again')
    ok(await B.evaluate("[...document.querySelectorAll('.results button')].some((b) => b.textContent.trim() === 'Back to party')"), 'partner results: Back to party')
    ok(len((await party(B))['members']) == 2, 'party survives the match')
    await shot(B, 'party_results_partner')
    await A.evaluate("[...document.querySelectorAll('.results button')].find((b) => b.textContent.trim() === 'Play again').click()")
    ok(await until(B, "!!(app.session && app.session.draft && app.session.mode === 'coop')", 10000), 'Play again: the partner follows into the next co-op draft')
    for pg in (A, B): await pg.evaluate("app.menu()")
    ok(await until(B, "!!document.querySelector('.ppanel')") and len((await party(A))['members']) == 2, 'back to the party on Home')
    print('— private 2v2 room from the party —')
    await A.click(".ppanel .pmodes .chip:nth-child(3)")
    ok(await until(B, "(document.querySelector('.ppanel .pt-desc') || {}).textContent?.includes('Private 2v2')", 3000), 'mode change reaches the partner')
    await B.click('.ppanel .pgo', force=True); await A.wait_for_timeout(300); await A.click('.ppanel .pgo', force=True)
    ok(await until(A, "!!(app.session && app.session.room && app.session.room.players.length === 2)", 10000), 'leader hosts the 2v2 room, partner seated')
    room = await A.evaluate("app.session.room.code")
    C = await tab('Cy'); D = await tab('Dee')
    for pg in (C, D): await pg.evaluate(f"app.joinScreen('{room}', {{ checked: true }})")
    ok(await until(A, "app.session.room.players.length === 4"), 'another pair joins by the room code')
    seats = await A.evaluate("JSON.stringify(app.session.room.players.map((p) => [p.name, p.team, p.seat]))")
    ok(json.loads(seats) == [['Ana', 0, 0], ['Mia', 0, 1], ['Cy', 1, 0], ['Dee', 1, 1]], f'party on blue, the others on red ({seats})')
    await shot(C, 'party_room2_guest')
    await A.click('.cbtns .btn.big', force=True)
    ok(await until(D, "!!(app.session && app.session.draft)"), 'all four in the 2v2 draft')
    for pg in (A, B, C, D): await pg.evaluate("app.menu()")
    await C.close(); await D.close()
    print('— link drop, leave, disband —')
    ok(await until(B, "!!document.querySelector('.ppanel')"), 'party still there')
    await B.evaluate("(async () => { const m = await import('./src/party.js'); const l = m.party().link; l.close(); for (const h of l.closeHandlers) h(); })()")
    ok(await until(A, "(document.querySelector('.ppanel .pst.lost') || null) !== null", 4000), 'leader sees the partner reconnecting')
    ok(await until(A, "!document.querySelector('.ppanel .pst.lost') && document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 2", 9000), 'the partner is back in the party by itself')
    await B.click('.ppanel .pleave')
    ok(await until(A, "document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 1"), 'partner left: leader keeps the party alone')
    ok(await until(B, "!document.querySelector('.ppanel') && !!document.querySelector('.h2rush')"), "partner's Home is back to normal")
    await B.evaluate(f"app.joinScreen('{code}', {{ checked: true }})")
    ok(await until(A, "document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 2"), 'partner rejoins with the code')
    await A.click('.ppanel .pleave')
    ok(await until(B, "!document.querySelector('.ppanel')", 4000) and await until(A, "!document.querySelector('.ppanel')"), 'leader disbands: both Homes drop the panel')
    ok(await B.evaluate(PARTY) == 'null', 'no party left on the partner')
    for e in errors: print('  JS error:', e)
    ok(not errors, 'no page errors')
    await ctx.close()

async def worker(b):
    pages = {}
    errors = []
    async def ctx_for(name, w=844, h=390):
        ctx = await b.new_context(viewport={'width': w, 'height': h})
        await ctx.add_init_script(f"localStorage.setItem('mobavs_api', ''); localStorage.setItem('mobavs_tips', '{{\"done\":true}}'); if (!localStorage.getItem('mobavs_name')) localStorage.setItem('mobavs_name', '{name}');" + BRIDGE)
        async def send(source, chan, data):
            for k, other in list(pages.items()):
                if other is not source['page']: asyncio.ensure_future(other.evaluate('([n, d]) => window.__bcRecv && window.__bcRecv(n, d)', [chan, data]))
        await ctx.expose_binding('__bcSend', send)
        pg = await ctx.new_page(); pages[name] = pg
        pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        return pg
    A = await ctx_for('Alice'); B = await ctx_for('Bob'); C = await ctx_for('Cy', 667, 375); D = await ctx_for('Dee', 667, 375)
    for pg in (A, B, C, D): await pg.goto(BASE + '/?local=1', wait_until='domcontentloaded', timeout=90000)  # (wrangler dev serves the assets slowly)
    for pg in (A, B, C, D): await until(pg, "!!(window.app && document.querySelector('#screen .home2'))", 60000)
    await A.wait_for_timeout(2500)
    for pg in (A, B, C, D): await pg.evaluate("window.confirm = () => true")
    acc = True
    for pg in (A, B, C, D):
        if not await until(pg, "!!localStorage.getItem('mobavs_account')", 15000): await pg.evaluate("app.connectOnline()")  # a slow first health check leaves a tab offline
        acc = acc and await until(pg, "!!localStorage.getItem('mobavs_account')", 20000)
    ok(acc, 'accounts created')
    ids = {}
    for n, pg in (('A', A), ('B', B), ('C', C), ('D', D)): ids[n] = await pg.evaluate("JSON.parse(localStorage.getItem('mobavs_account')).id")
    fa = "(id) => import('./src/net/online.js').then((m) => m.friendAction('add', id))"
    await A.evaluate(fa, ids['B']); await B.evaluate(fa, ids['A'])
    print('— party invite from the invite dialog —')
    await A.evaluate("import('./src/ui/social.js').then((m) => m.refreshSocial())"); await A.wait_for_timeout(1500)
    await A.click('.partychip')
    ok(await until(A, "!!document.querySelector('.pinvite .frow')", 9000), 'online friends listed in the party invite dialog')
    await shot(A, 'party_invite_friends')
    await A.click('.pinvite .frow .btn')
    ok(await until(A, "(document.querySelector('.pinvite .frow .btn') || {}).textContent === 'Sent'", 5000), 'party invite sent to Bob')
    await A.click('.pinvite .x')
    await B.evaluate("app.menu(); import('./src/ui/social.js').then((m) => m.refreshSocial())")
    await B.wait_for_selector('.invpop', timeout=9000)
    ok('PARTY INVITE' in (await B.inner_text('.invpop')).upper(), 'Bob gets a party invite card')
    await shot(B, 'party_invite_card')
    await B.click('.invpop .btn.big')
    ok(await until(A, "document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 2", 9000), 'Bob is in Alice\'s party')
    print('— Find Match 2v2: party + two solo coaches —')
    await B.click('.ppanel .pgo', force=True)  # ready
    await A.click(".ppanel .pmodes .chip:nth-child(2)")
    ok(await until(A, "(document.querySelector('.ppanel .pgo') || {}).textContent === 'Find 2v2'", 3000), 'mode Find Match 2v2')
    for pg in (C, D): await pg.evaluate("import('./src/party.js').then((m) => { m.setQueueSize('2v2'); app.menu(); })")
    ok(await C.evaluate("(document.querySelector('.h2online .h2go') || {}).textContent === 'Find 2v2'"), 'Home Find Match is set to 2v2')
    await shot(C, 'home_2v2_solo')
    await until(B, "document.querySelector('.ppanel .pst.ready') !== null", 3000)
    await A.click('.ppanel .pgo', force=True)
    ok(await until(B, "!!document.getElementById('mmsearch')", 6000), "partner sees the leader's search")
    await shot(B, 'party_search_partner')
    await C.click('.h2online .h2go'); await D.click('.h2online .h2go')
    started = True
    for pg in (A, B, C, D): started = started and await until(pg, "!!(app.session && app.session.draft && app.session.mode === 'coop')", 30000)
    ok(started, 'all four coaches in the 2v2 draft')
    if started:
        t = {n: json.loads(await pg.evaluate("JSON.stringify([app.session.myTeam, app.session.kind])")) for n, pg in (('A', A), ('B', B), ('C', C), ('D', D))}
        ok(t['A'][0] == t['B'][0] and t['C'][0] == t['D'][0] and t['A'][0] != t['C'][0] and all(v[1] == '2v2' for v in t.values()), f'party on one side, the two solo coaches paired on the other ({t})')
        await shot(C, 'party_mm_draft')
    for pg in (A, B, C, D): await pg.evaluate("app.menu()")
    print('— second party from an invite link, then 2+2 —')
    ok(await until(B, "!!document.querySelector('.ppanel')") and len((await party(A))['members']) == 2, 'Alice and Bob are still a party')
    url = await D.evaluate("import('./src/party.js').then((m) => m.inviteToParty(app, null)).then((r) => r.url)")
    ok('/i/' in url, f'party invite link ({url})')
    loc = await C.evaluate("(u) => fetch(u, { redirect: 'manual' }).then((r) => r.type === 'opaqueredirect' || r.status === 302)", url)
    ok(loc, 'the /i/ link redirects into the game')
    await C.goto(BASE + '/?local=1&i=' + url.rsplit('/', 1)[1], wait_until='domcontentloaded', timeout=90000); await until(C, "!!document.querySelector('.invland .btn.big')", 30000)  # (?local=1 keeps the test's tab transport)
    ok('party' in (await C.inner_text('.invland')).lower(), 'link landing names the party')
    await C.click('.invland .btn.big')
    joined = await until(D, "document.querySelectorAll('.ppanel .pmem:not(.pinv)').length === 2", 9000)
    ok(joined, 'Cy joined Dee\'s party from the link')
    if not joined: print('   Cy:', await C.evaluate(PARTY), '| Dee:', await D.evaluate(PARTY)); await shot(C, 'fail_link_cy'); await shot(D, 'fail_link_dee')
    await C.evaluate("window.confirm = () => true")
    for leader, mate in ((A, B), (D, C)):
        await mate.click('.ppanel .pgo', force=True)
        await leader.click(".ppanel .pmodes .chip:nth-child(2)")
        await until(leader, "document.querySelector('.ppanel .pst.ready') !== null", 3000)
    await A.click('.ppanel .pgo', force=True); await D.click('.ppanel .pgo', force=True)
    started = True
    for pg in (A, B, C, D): started = started and await until(pg, "!!(app.session && app.session.draft && app.session.mode === 'coop')", 30000)
    ok(started, '2+2: both parties in one 2v2 draft')
    if started:
        t = {n: await pg.evaluate("app.session.myTeam") for n, pg in (('A', A), ('B', B), ('C', C), ('D', D))}
        ok(t['A'] == t['B'] and t['C'] == t['D'] and t['A'] != t['C'], f'each party on its own side ({t})')
    print('— nobody else searching: 60 s, then back to Home —')
    for pg in (A, B, C, D): await pg.evaluate("app.menu()")
    await D.evaluate("import('./src/party.js').then((m) => m.leaveParty(app, true))")
    await until(C, "!document.querySelector('.ppanel')", 5000)
    await C.click('.h2online .h2go')
    ok(await until(C, "!!document.getElementById('mmsearch')", 5000), 'a solo coach searches 2v2 alone')
    ok(await until(C, "[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('No one is online for 2v2'))", 75000) and await until(C, "!!document.querySelector('#screen .home2')", 3000),
       '"no one online" after the time limit, back to Home (no bots)')
    for e in errors: print('  JS error:', e)
    ok(not errors, 'no page errors')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        if PART == 'local': await local(b)
        else: await worker(b)
        await b.close()
    print('PARTY OK ✔' if not bad else f'PARTY FAILED ✘ ({bad})')
    sys.exit(1 if bad else 0)
asyncio.run(main())
