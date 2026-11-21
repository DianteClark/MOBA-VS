# Quick chat over a real online session: two tabs with ?local=1 (BroadcastChannel transport).
# Host + join, auto-draft, ready up, then check that quick chat
#   * arrives on the other side and shows near the top,
#   * never enters the lockstep command log,
#   * is rate-limited, and
#   * respects the mute setting.
#   python3 tools/chat_test.py http://127.0.0.1:8811/
import sys, asyncio
from playwright.async_api import async_playwright
URL = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8811/').rstrip('/') + '/index.html?local=1'
DRAFT = """async () => { const m = await import('./src/sim/draft.js'); const s = app.session;
  if (!s || !s.draft || s.draft.done) return s && s.draft ? 'done' : 'wait';
  const t = m.currentTurn(s.draft); if (t.team === s.myTeam) app.draftAct(m.autoChoice(s.draft, t.team, s.rng, 1)); return 'drafting'; }"""

async def main():
    bad = 0
    def ok(c, msg):
        nonlocal bad
        print(('  ok   ' if c else '  FAIL ') + msg, flush=True); bad += 0 if c else 1
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390})
        A = await ctx.new_page(); B = await ctx.new_page()
        for pg in (A, B):
            pg.on('pageerror', lambda e: print('  JS error:', e))
            await pg.goto(URL); await pg.wait_for_timeout(2500)
            await pg.evaluate("() => { localStorage.setItem('mobavs_settings', JSON.stringify({ chatMute: false })); }")
        await A.evaluate("() => { app.hostGame({ code: 'QCHAT' }); }"); await A.wait_for_timeout(300)
        await B.evaluate("() => { app.joinScreen('QCHAT'); }")
        for _ in range(240):
            sa = await A.evaluate(DRAFT); sb = await B.evaluate(DRAFT)
            if sa == 'done' and sb == 'done': break
            await A.wait_for_timeout(150)
        ok(sa == 'done' and sb == 'done', 'online draft finished on both tabs')
        await A.wait_for_timeout(1500)
        for pg in (A, B): await pg.evaluate("app.prepReady()")
        await A.wait_for_timeout(2500)
        ok(await A.evaluate("!!(app.match && app.match.runner.online)") and await B.evaluate("!!(app.match && app.match.runner.online)"), 'both tabs are in an online match')
        ok(await A.evaluate("!!document.getElementById('qchatbtn')"), 'quick chat button is shown online')
        # open the panel and tap a line, like a player would
        await A.click('#qchatbtn'); await A.wait_for_timeout(200)
        await A.click("#qchat .qlines .chip:nth-child(1)")
        await B.wait_for_timeout(600)
        txt = await B.evaluate("document.getElementById('qfeed') ? document.getElementById('qfeed').textContent : ''")
        ok('GG' in txt, f'opponent sees the line near the top ({txt!r})')
        log = await A.evaluate("JSON.stringify(app.match.runner.log)")
        ok('qc' not in log and 'GG' not in log, 'quick chat is not in the lockstep command log')
        # spam: only one more gets through within the 1.5s gap
        await B.evaluate("document.getElementById('qfeed').replaceChildren()")
        await A.evaluate("() => { for (let i = 0; i < 6; i++) app.match.hud.chat.say({ e: 'up' }); }")
        await B.wait_for_timeout(600)
        n = await B.evaluate("document.querySelectorAll('#qfeed .qmsg').length")
        ok(n == 0, f'rate limit: nothing within 1.5s of the last message ({n} shown)')
        await A.wait_for_timeout(1600)
        await A.evaluate("() => { for (let i = 0; i < 6; i++) app.match.hud.chat.say({ e: 'up' }); }")
        await B.wait_for_timeout(600)
        n = await B.evaluate("document.querySelectorAll('#qfeed .qmsg').length")
        ok(n == 1, f'rate limit: a burst of 6 delivers 1 ({n} shown)')
        # receiver-side guard: forged spam straight down the wire is dropped too
        await B.evaluate("document.getElementById('qfeed').replaceChildren()")
        await A.evaluate("() => { for (let i = 0; i < 6; i++) app.net.t.send({ t: 'qc', i: 1 }); app.net.t.send({ t: 'qc', i: 99 }); app.net.t.send({ t: 'qc', text: 'free text' }); }")
        await B.wait_for_timeout(600)
        n = await B.evaluate("document.querySelectorAll('#qfeed .qmsg').length")
        ok(n <= 1, f'receiver drops floods and invalid messages ({n} shown)')
        # mute
        await B.evaluate("document.getElementById('qfeed').replaceChildren()")
        await B.evaluate("async () => { const s = await import('./src/ui/settings.js'); s.setSetting('chatMute', true); }")
        await A.wait_for_timeout(13000)
        await A.evaluate("app.match.hud.chat.say({ i: 6 })")
        await B.wait_for_timeout(600)
        n = await B.evaluate("document.querySelectorAll('#qfeed .qmsg').length")
        ok(n == 0, 'muted: the opponent line is hidden')
        ok(await A.evaluate("app.match.game.checksum()") is not None, 'match still running')
        await b.close()
    print('QUICK CHAT ' + ('OK' if not bad else f'{bad} FAILURE(S)'))
    sys.exit(1 if bad else 0)
asyncio.run(main())
