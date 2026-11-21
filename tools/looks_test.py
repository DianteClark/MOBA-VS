# Cosmetics over a real online session: two tabs with ?local=1 (BroadcastChannel transport).
# Tab A owns and equips unique skins, a signature emote and a border; tab B has the defaults. Checks that
#   * A's equipped skins reach B through the session metadata (hello/start + prep) and show on A's heroes there,
#   * skins never enter the sim config or the lockstep command log,
#   * forged looks are cleaned (unknown heroes/skins, a skin on the wrong hero, bad emotes),
#   * A's owned emotes are in A's quick chat, and B sees A's signature emote for the results,
#   * achievements stay bounded and the profile survives a JSON round trip (cloud save).
#   python3 tools/looks_test.py http://127.0.0.1:8834/
import sys, asyncio
from playwright.async_api import async_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8834/').rstrip('/') + '/index.html?local=1'
DRAFT = """async () => { const m = await import('./src/sim/draft.js'); const s = app.session;
  if (!s || !s.draft || s.draft.done) return s && s.draft ? 'done' : 'wait';
  const t = m.currentTurn(s.draft); if (t.team === s.myTeam) app.draftAct(m.autoChoice(s.draft, t.team, s.rng, 1)); return 'drafting'; }"""
EQUIP = """async () => { const P = (await import('./src/profile.js')).profile; const { HEROES } = await import('./src/data/heroes.js'); const { SKINS } = await import('./src/data/seasons.js');
  for (const h of HEROES) { if (SKINS['leg_' + h.id]) { P.d.unlocked.skins.push('leg_' + h.id); P.d.equip.skins[h.id] = 'leg_' + h.id; } else { P.d.mastery[h.id] = { pts: 800 }; P.d.equip.skins[h.id] = 'sig_' + h.id; } }
  P.d.unlocked.emotes.push('smug'); P.d.equip.emote = 'smug'; P.d.unlocked.borders.push('phoenix'); P.d.equip.border = 'phoenix'; P.save({ local: true }); }"""

async def main():
    bad = 0
    def ok(c, msg):
        nonlocal bad
        print(('  ok   ' if c else '  FAIL ') + msg, flush=True); bad += 0 if c else 1
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}) # one context: the local transport is a BroadcastChannel
        A = await ctx.new_page(); B = await ctx.new_page()
        for pg in (A, B):
            pg.on('pageerror', lambda e: print('  JS error:', e))
            await pg.goto(URL); await pg.wait_for_timeout(2500)
        await A.evaluate(EQUIP) # B loaded first: its in-memory profile keeps the defaults
        await A.evaluate("() => { app.hostGame({ code: 'LOOKS' }); }"); await A.wait_for_timeout(300)
        await B.evaluate("() => { app.joinScreen('LOOKS'); }")
        for _ in range(240):
            sa = await A.evaluate(DRAFT); sb = await B.evaluate(DRAFT)
            if sa == 'done' and sb == 'done': break
            await A.wait_for_timeout(150)
        ok(sa == 'done' and sb == 'done', 'online draft finished on both tabs')
        ok(await B.evaluate("!!(app.session.oppLooks && app.session.oppLooks.emote === 'smug' && app.session.oppLooks.border === 'phoenix')"), 'B got A\'s looks in the hello/start metadata')
        await A.wait_for_timeout(1500)
        for pg in (A, B): await pg.evaluate("app.prepReady()")
        await A.wait_for_timeout(2500)
        ok(await A.evaluate("!!(app.match && app.match.runner.online)") and await B.evaluate("!!(app.match && app.match.runner.online)"), 'both tabs are in an online match')
        mine = await A.evaluate("JSON.stringify(app.renderer.skins[app.session.myTeam])")
        seen = await B.evaluate("JSON.stringify(app.renderer.skins[1 - app.session.myTeam])")
        ok(mine == seen and len(mine) > 20, f'B renders A\'s heroes in A\'s skins ({seen[:80]}…)')
        ok(await B.evaluate("Object.keys(app.renderer.skins[app.session.myTeam]).length === 0"), 'B\'s own heroes stay classic (nothing equipped)')
        ok(await B.evaluate("(() => { const t = 1 - app.session.myTeam, x = app.match.game.teams[t].heroes[0]; return app.renderer.heroImg(x) !== null && app.renderer.heroImg(x) !== undefined && !!app.renderer.heroImg(x)._fk; })()"), 'B draws a skinned sheet for A\'s hero')
        for pg, n in ((A, 'A'), (B, 'B')):
            cfg = await pg.evaluate("JSON.stringify(app.match.game.cfg || {}) + JSON.stringify(app.match.runner.log || [])")
            ok('leg_' not in cfg and 'sig_' not in cfg and 'skins' not in cfg, f'{n}: no skin in the sim config or command log')
        # forged looks are cleaned
        res = await B.evaluate("""async () => { const L = await import('./src/looks.js');
          const x = L.cleanLooks({ skins: { kaze: 'leg_bastion', bastion: 'leg_bastion', nobody: 'sig_kaze', yuki: 'nope', kenshi: 'shadow', __proto__: 'x' }, emote: '<img src=x>', banner: 'toString', border: 'kami' });
          return JSON.stringify(x); }""")
        ok(res == '{"skins":{"bastion":"leg_bastion","kenshi":"shadow"},"emote":null,"banner":null,"border":"kami"}', f'forged looks cleaned: {res}')
        # quick chat: owned emotes only; the opponent sees a new emote
        n = await A.evaluate("() => { app.match.hud.chat.open(); const n = document.querySelectorAll('#qchat .qemo').length; app.match.hud.chat.close(); return n; }")
        ok(n == 9, f'A\'s quick chat offers the 9 owned emotes ({n})')
        await A.evaluate("app.match.hud.chat.say({ e: 'smug' })"); await B.wait_for_timeout(600)
        ok(await B.evaluate("!!document.querySelector('#qfeed .qmsg img[src*=\"smug\"]')"), 'B sees the smug emote')
        ok(await B.evaluate("""async () => { const C = await import('./src/ui/collection.js'); const e = C.resultEmotes(app.session); return !!(e[1 - app.session.myTeam] && e[1 - app.session.myTeam].src.includes('smug')); }"""), 'B shows A\'s signature emote on the results')
        # profile: bounded achievements, JSON round trip (cloud save) keeps everything
        r = await A.evaluate("""async () => { const P = (await import('./src/profile.js')).profile; const before = JSON.stringify(P.d);
          P.d.ach.got.fake = 1; P.d.ach.roles = ['top','top','top','top','top','top','top']; P.adopt(JSON.parse(JSON.stringify(P.d)));
          return [Object.keys(P.d.ach.got).includes('fake'), P.d.ach.roles.length, P.d.equip.emote, P.border, P.hasSkin('bastion', 'leg_bastion'), P.hasSkin('kaze', 'leg_bastion')]; }""")
        ok(r == [False, 5, 'smug', 'phoenix', True, False], f'profile round trip + bounds: {r}')
        await b.close()
    print('LOOKS ' + ('OK' if not bad else f'{bad} FAILURE(S)'))
    sys.exit(1 if bad else 0)
asyncio.run(main())
