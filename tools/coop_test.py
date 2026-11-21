# Co-op coaching end to end, with real tabs on ?local=1 (BroadcastChannel transport, the host relays).
#  1) Two coaches vs the AI (844x390): lobby + role swap, seat-alternating draft, split prep, the match:
#     ownership marks, a partner's suggestion confirmed by the lead, partner calls on the ticker, quick chat,
#     passing the lead, the partner leaving mid-match (their heroes go to the host), results credit + history.
#  2) 2v2 with four tabs (667x375): everyone in sync, a red coach leaves (partner takes over), then the host
#     leaves (each guest plays on alone with the AI filling the other seats).
#   python3 tools/coop_test.py http://127.0.0.1:8831/  [shots dir]
import sys, asyncio, os
from playwright.async_api import async_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8831/').rstrip('/') + '/index.html?local=1'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
# Mia (the partner) owns and equips skins on every hero and a signature emote (as in looks_test.py)
EQUIP = """async () => { const P = (await import('./src/profile.js')).profile; const { HEROES } = await import('./src/data/heroes.js'); const { SKINS } = await import('./src/data/seasons.js');
  for (const h of HEROES) { if (SKINS['leg_' + h.id]) { P.d.unlocked.skins.push('leg_' + h.id); P.d.equip.skins[h.id] = 'leg_' + h.id; } else { P.d.mastery[h.id] = { pts: 800 }; P.d.equip.skins[h.id] = 'sig_' + h.id; } }
  P.d.unlocked.emotes.push('smug'); P.d.equip.emote = 'smug'; P.save({ local: true }); }"""
DRAFT = """async () => { const m = await import('./src/coop-room.js'); const s = app.session;
  if (!s || !s.draft) return 'wait'; if (s.draft.done) return 'done';
  if (app.myDraftTurn()) app.draftAct(m.draftAuto(s)); return 'drafting'; }"""

async def main():
    bad = 0
    def ok(c, msg):
        nonlocal bad
        print(('  ok   ' if c else '  FAIL ') + msg, flush=True); bad += 0 if c else 1
    async def shot(pg, name):
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); await pg.screenshot(path=os.path.join(SHOTS, name + '.png'))
    async def draft(pages):
        for _ in range(400):
            st = [await pg.evaluate(DRAFT) for pg in pages]
            if all(x == 'done' for x in st): return True
            await pages[0].wait_for_timeout(120)
        return False
    async def until(pg, js, ms=8000):
        for _ in range(ms // 100):
            if await pg.evaluate(js): return True
            await pg.wait_for_timeout(100)
        return False
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        errors = []
        async def tab(ctx, name):
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
            await pg.goto(URL); await pg.wait_for_timeout(2200)
            await pg.evaluate(f"() => {{ app.setName('{name}'); localStorage.setItem('mobavs_tips', '{{\"done\":true}}'); window.confirm = () => true; }}")
            return pg

        print('— co-op vs AI —')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390})
        A = await tab(ctx, 'Ana'); B = await tab(ctx, 'Mia')
        await B.evaluate(EQUIP)
        await A.evaluate("app.hostCoop({ code: 'COOPA' })"); await A.wait_for_timeout(400)
        await B.evaluate("app.joinScreen('COOPA')")
        ok(await until(A, "app.session.room.players.length === 2"), 'partner joined the room by code')
        ok(await until(B, "!!document.querySelector('.coop .cseat.me')"), 'the guest sees the co-op lobby with their seat')
        ok(await until(A, "!!document.querySelector('.cseat .cemo[src*=smug]')"), "the host's lobby shows the partner's signature emote (looks)")
        await shot(A, 'coop_lobby_host'); await shot(B, 'coop_lobby_guest')
        # the guest moves Mid to themselves (role chips), the host sees it
        await B.click(".crole:nth-child(3)")
        ok(await until(A, "app.session.room.own[0].mid === 1"), 'role swap from the guest reaches the host (Mid -> seat B)')
        ok(await until(B, "app.session.room.own[0].mid === 1"), 'and comes back to the guest')
        await A.click(".cbtns .btn.big", force=True)
        ok(await until(B, "!!(app.session && app.session.draft)"), 'start: both tabs open the draft')
        # first ban is the lead's; the guest waits and sees who acts
        what = await B.evaluate("document.querySelector('.dturn .what').textContent")
        ok('Ana' in what, f'guest sees the lead banning first ({what!r})')
        await shot(B, 'coop_draft_guest')
        ok(await draft([A, B]), 'seat-alternating draft finished (AI side drafted by the host)')
        seats = await A.evaluate("JSON.stringify(app.session.draft.seats[0])")
        ok(seats.count('0') == 2 and seats.count('1') == 3, f'each coach picked for their own roles (seats {seats})')
        same = await A.evaluate("JSON.stringify(app.session.draft.picks)") == await B.evaluate("JSON.stringify(app.session.draft.picks)")
        ok(same, 'both tabs agree on the draft')
        await A.wait_for_timeout(1500)
        await shot(B, 'coop_prep_guest')
        ok(await B.evaluate("document.querySelectorAll('.pmini.cs').length === 5"), 'prep shows all five heroes with their coach colour')
        await A.evaluate("app.prepReady()")
        ok(await until(B, "!!app.session.seatPreps[0][0]"), "the lead's prep reaches the partner")
        await B.evaluate("app.prepReady()")
        ok(await until(A, "!!(app.match && app.match.runner.online)") and await until(B, "!!(app.match && app.match.runner.online)"), 'both tabs are in the co-op match')
        own = await B.evaluate("JSON.stringify(app.match.game.teams[0].heroes.map((x) => x.seat))")
        ok(own == await A.evaluate("JSON.stringify(app.match.game.teams[0].heroes.map((x) => x.seat))") and own.count('1') == 3, f'hero ownership in the sim ({own})')
        sk = await A.evaluate("""() => { const g = app.match.game, k = app.renderer.skins[0]; return JSON.stringify({ mate: g.teams[0].heroes.filter((x) => x.seat === 1).every((x) => !!k[x.heroId]), mine: g.teams[0].heroes.filter((x) => x.seat === 0).some((x) => !!k[x.heroId]) }); }""")
        ok(sk == '{"mate":true,"mine":false}', f"the lead sees the partner's skins on the partner's heroes only ({sk})")
        ok(await A.evaluate("JSON.stringify(app.renderer.skins)") == await B.evaluate("JSON.stringify(app.renderer.skins)"), 'both coaches see the same skins')
        ok(await B.evaluate("JSON.stringify(app.match.cfg).indexOf('leg_') < 0 && JSON.stringify(app.match.cfg).indexOf('sig_') < 0"), 'skins stay out of the sim config')
        ok(await B.evaluate("document.querySelectorAll('#myteam .hrow .own').length === 5 && document.querySelectorAll('#myteam .hrow.mate').length === 2"), "HUD marks your heroes and your partner's")
        ok(await B.evaluate("document.querySelector('.coopbar').textContent.includes('Ana')"), 'the lead badge names the lead')
        await A.wait_for_timeout(4000)
        await shot(B, 'coop_hud_guest'); await shot(A, 'coop_hud_host')
        # the partner taps a team call: it becomes a suggestion in the lead's tray; Go makes the call
        await B.evaluate("app.match.game.teams[0].charges = 3; app.match.hud.send({ type: 'group', lane: 'mid' })")
        ok(await until(A, "!!document.querySelector('.titem.mate')"), "partner's team call arrives as a suggestion for the lead")
        await shot(A, 'coop_suggestion_lead')
        nlog = await B.evaluate("app.match.runner.log.flat(2).filter((c) => c && c.type === 'group').length")
        ok(nlog == 0, 'the suggestion itself is not a command')
        await A.click(".titem.mate .tch:not(.no)")
        ok(await until(B, "app.match.game.callLog.some((c) => c.type === 'group' && c.seat === 0)"), "the lead's Go becomes a real call for the team")
        ok(await until(B, "(document.getElementById('ticker').textContent || '').includes('Ana')", 4000), "the partner reads the lead's call on the ticker")
        # partner builds for their own hero: allowed; for the lead's hero: refused in the UI and in the sim
        r = await B.evaluate("""() => { const g = app.match.game, mine = g.teams[0].heroes.find((x) => x.seat === app.session.mySeat), theirs = g.teams[0].heroes.find((x) => x.seat !== app.session.mySeat);
          const b1 = mine.def.builds.find((b) => b !== mine.build), b2 = theirs.def.builds.find((b) => b !== theirs.build);
          const a = app.match.hud.send({ type: 'build', hero: mine.id, build: b1 }), c = app.match.hud.send({ type: 'build', hero: theirs.id, build: b2 });
          app.match.runner.send({ type: 'build', hero: theirs.id, build: b2 }); // a forged command still dies in the sim
          return JSON.stringify({ a, c, mine: mine.id, theirs: theirs.id, b1, b2 }); }""")
        import json; rr = json.loads(r)
        ok(rr['a'] and not rr['c'], 'UI: own hero build sent, partner hero build refused')
        await A.wait_for_timeout(1500)
        ok(await A.evaluate(f"app.match.game.byId({rr['mine']}).build === '{rr['b1']}' && app.match.game.byId({rr['theirs']}).build !== '{rr['b2']}'"), 'sim: only the owner can change a build (same on the lead\'s tab)')
        # quick chat between partners
        await B.evaluate("app.match.hud.chat.say({ i: 1 })")
        ok(await until(A, "(document.getElementById('qfeed') || {}).textContent?.includes('Mia')", 3000), 'quick chat reaches the partner with their name')
        # pass the lead (two taps on the badge)
        await A.click('.coopbar'); await A.click('.coopbar')
        ok(await until(B, "app.match.game.teams[0].coop.lead === 1"), 'the lead passed to the partner')
        ok(await until(B, "document.querySelector('.coopbar').textContent.includes('You')", 3000), "the partner's badge now says they lead")
        await until(A, "app.match.runner.hashes.size >= 1", 30000)
        hs = await A.evaluate("[...app.match.runner.hashes.keys()].slice(-1)[0]")
        await until(B, f"app.match.runner.hashes.has({hs})", 15000)
        same = await A.evaluate(f"app.match.runner.hashes.get({hs})") == await B.evaluate(f"app.match.runner.hashes.get({hs})")
        ok(same, f'both tabs have the same checksum at tick {hs}')
        # the partner leaves mid-match: the host's coach runs all five
        await B.evaluate("app.quitMatch()")
        ok(await until(A, "app.match.game.teams[0].heroes.every((x) => x.seat === 0) && app.match.game.teams[0].coop.left[1]", 6000), "partner left: their heroes are the host's now")
        ok(await until(A, "app.match.runner.update(0.05) >= 0 && app.match.game.tick > 0 && !app.match.runner.waiting", 3000), 'the host keeps playing (no stall on the missing partner)')
        await shot(A, 'coop_partner_left')
        # finish: results credit both coaches, history records co-op, no rating change
        elo = await A.evaluate("async () => (await import('./src/profile.js')).profile.elo")
        await A.evaluate("app.match.game.over = true; app.match.game.winner = 0")
        ok(await until(A, "!!document.querySelector('.results .coopres')", 9000), 'results show the co-op credit panel')
        await shot(A, 'coop_results')
        h = await A.evaluate("async () => { const { profile } = await import('./src/profile.js'); return JSON.stringify({ mode: profile.d.history[0].mode, coop: profile.d.history[0].coop, names: profile.d.history[0].names, elo: profile.elo }); }")
        hh = json.loads(h)
        ok(hh['mode'] == 'coop' and hh['coop'] and hh['coop']['mates'][0]['name'] == 'Mia', f"history: co-op vs AI with Mia ({hh['mode']})")
        ok('Ana & Mia' in hh['names'][0], f"team credited to both coaches ({hh['names'][0]})")
        ok(hh['elo'] == elo, 'casual: no rating change')
        await ctx.close()

        print('— co-op 2v2 (four tabs) —')
        ctx = await b.new_context(viewport={'width': 667, 'height': 375})
        T = [await tab(ctx, n) for n in ('Ana', 'Ben', 'Cy', 'Dee')]
        await T[0].evaluate("app.hostCoop({ code: 'COOPB', kind: '2v2' })"); await T[0].wait_for_timeout(400)
        for k in (1, 2, 3):
            await T[k].evaluate("app.joinScreen('COOPB')")
            ok(await until(T[0], f"app.session.room.players.length === {k + 1}"), f'coach {k + 1} joined')
        teams = await T[0].evaluate("JSON.stringify(app.session.room.players.map((p) => [p.team, p.seat]))")
        ok(teams == '[[0,0],[0,1],[1,0],[1,1]]', f'seats filled blue A/B, red A/B ({teams})')
        await shot(T[2], 'coop2_lobby')
        await T[0].click(".cbtns .btn.big", force=True)
        ok(await until(T[3], "!!(app.session && app.session.draft)"), 'all four in the draft')
        ok(await draft(T), '2v2 draft finished on all four tabs')
        await T[0].wait_for_timeout(1500)
        for pg in T: await pg.evaluate("app.prepReady()")
        okm = True
        for pg in T: okm = okm and await until(pg, "!!(app.match && app.match.runner.online)")
        ok(okm, 'all four tabs are in the 2v2 match')
        await T[0].wait_for_timeout(5000)
        await shot(T[2], 'coop2_hud_red')
        await until(T[0], "app.match.runner.hashes.size >= 1", 30000)
        k = await T[0].evaluate("[...app.match.runner.hashes.keys()][0]")
        for pg in T: await until(pg, f"app.match.runner.hashes.has({k})", 15000)
        hv = [await pg.evaluate(f"app.match.runner.hashes.get({k})") for pg in T]
        ok(len(set(hv)) == 1 and hv[0] is not None, f'four peers in sync at tick {k}')
        # team-private traffic: red's quick chat reaches red's partner, and blue never even receives it
        for pg in (T[1], T[0]): await pg.evaluate("window.__qc = 0; const o = app.onNet.bind(app); app.onNet = (m) => { if (m.t === 'qc' || m.t === 'sug') window.__qc++; o(m); }; 1")
        await T[2].evaluate("app.match.hud.chat.say({ i: 0 })")
        ok(await until(T[3], "(document.getElementById('qfeed') || {}).textContent?.includes('Cy')", 3000), 'red quick chat reaches the red partner')
        await T[1].wait_for_timeout(600)
        ok(await T[1].evaluate("window.__qc") == 0 and await T[0].evaluate("window.__qc") == 0, 'blue coaches never receive red team messages')
        # a red coach leaves: the red partner runs all five
        await T[3].evaluate("app.quitMatch()")
        ok(await until(T[2], "app.match.game.teams[1].heroes.every((x) => x.seat === 0) && app.match.game.teams[1].coop.left[1]", 6000), 'red partner left: red lead runs all five')
        ok(await until(T[1], "app.match.game.teams[1].coop.left[1]", 3000), 'blue guest saw it in sync')
        # the host leaves: each guest plays on alone (the AI takes the other seats, through logged commands)
        await T[0].evaluate("app.quitMatch()")
        ok(await until(T[1], "app.match && !app.match.runner.online && app.match.game.teams[0].heroes.every((x) => x.seat === 1)", 6000), 'blue guest plays on alone after the host left')
        ok(await until(T[2], "app.match && !app.match.runner.online && app.match.game.teams[1].coop.left[1] && !!app.match.game.coaches[0]", 6000), 'red coach plays on vs the AI (blue now AI-coached)')
        t0 = await T[1].evaluate("app.match.game.tick"); await T[1].wait_for_timeout(1200)
        ok(await T[1].evaluate(f"app.match.game.tick > {t0}"), 'the solo game keeps running')
        await ctx.close()
        await b.close()
        for e in errors: print('  JS error:', e)
        ok(not errors, 'no page errors')
    print('CO-OP OK ✔' if not bad else f'CO-OP FAILED ✘ ({bad})')
    sys.exit(1 if bad else 0)
asyncio.run(main())
