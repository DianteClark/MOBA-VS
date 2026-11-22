# Menu / scene audit: visits every screen (home, dojo, draft, prep, results + its Analysis sheet, history, ladder,
# season, Today, season-end ceremony, settings, profile + coach + career, cup, matchmaking, lobby, how-to-play, patch notes), screenshots it and checks
#   * no horizontal overflow (nothing pushes the page sideways),
#   * every button / input sits inside the safe area (notch / Dynamic Island, home indicator),
#   * no two buttons overlap (buttons under a sticky bar, e.g. the results footer, are scrolled content), and no button label is clipped.
#   python3 tools/screen_audit.py URL [outdir] [viewports]
# viewports: as tools/ui_audit.py (WxH, WxH@L/R/T/B, or the presets iphones / desktop / all).
# Default: 844x390 and 1366x768 plus the notched iPhone sizes.
# API=<base> (e.g. API= for a same-origin `wrangler dev`) sets localStorage.mobavs_api, so the online screens
# (ladder, Friends tab, public profile) are audited with real data: two friends are seeded through the API.
import sys, os, asyncio
from playwright.async_api import async_playwright
# GAME_LANG=<code> audits in that language, HAND=left|right in one-handed mode, HC=1 in high contrast,
# MISS=<file> appends every UI string missing from the i18n catalog (src/i18n/en.json) to <file>
PREFS = ("try { localStorage.setItem('mobavs_i18n_miss', '1'); } catch (e) {}" if os.environ.get('MISS') else '') + "try { localStorage.setItem('mobavs_lang', %r); localStorage.setItem('mobavs_settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('mobavs_settings') || '{}'), %s))); } catch (e) {}" % (
    os.environ.get('GAME_LANG') or 'en', '{' + ', '.join(x for x in [("hand: '%s'" % os.environ['HAND']) if os.environ.get('HAND') else '', 'contrast: true' if os.environ.get('HC') == '1' else ''] if x) + '}')
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
OUT = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

def parse(specs):
    # same viewport syntax as ui_audit.py (kept here so importing it doesn't run its audit)
    IPH = [('SE3', 667, 375, 0, 0), ('mini', 812, 375, 50, 21), ('12-16e', 844, 390, 47, 21), ('14Pro-16', 852, 393, 59, 21), ('16Pro-17', 874, 402, 62, 21),
           ('Air', 912, 420, 62, 21), ('13PM-14Plus', 926, 428, 47, 21), ('14PM-16Plus', 932, 430, 59, 21), ('16PM-17PM', 956, 440, 62, 21)]
    out = []
    for v in specs.split(','):
        if v in ('iphones', 'all'):
            for (n, w, h, s, b) in IPH: out += [(w, h, s, s, 0, b, n + '-PWA'), (w, h - 62, s, s, 0, b, n + '-Safari')]
        if v in ('desktop', 'all'):
            out += [(w, h, 0, 0, 0, 0, '') for (w, h) in [(1920, 1080), (1366, 768), (1280, 720), (1024, 768)]]
        if v in ('iphones', 'desktop', 'all'): continue
        wh, _, ins = v.partition('@')
        w, h = map(int, wh.split('x'))
        l, r, t, b = (list(map(int, ins.split('/'))) + [0, 0, 0, 0])[:4] if ins else (0, 0, 0, 0)
        out.append((w, h, l, r, t, b, ''))
    return out
VIEWS = parse(sys.argv[3] if len(sys.argv) > 3 else '844x390,1366x768,844x390@47/47/0/21,956x440@62/62/0/21,667x313')

M = "const H = await import('./src/ui/home.js'), S = await import('./src/ui/screens.js'), O = await import('./src/ui/online.js'), D = await import('./src/ui/dojo.js'), ST = await import('./src/ui/settings.js'), SO = await import('./src/ui/social.js'), N = await import('./src/net/online.js'), RV = await import('./src/ui/rivals.js');"
# Friends tab data (API mode only): one friend online, one pending request. Offline it is a no-op.
SEED = """if (!window.__seeded) { window.__seeded = 1; try {
  await N.ensureAccount(app.name); const me = N.getAccount(), post = (a, path, body) => fetch(N.API + path, { method: 'POST', headers: a ? { authorization: `Bearer ${a.id}.${a.secret}` } : {}, body: JSON.stringify(body) }).then((r) => r.json());
  const x = await post(null, '/api/account', { name: 'Kenji' }), y = await post(null, '/api/account', { name: 'Yumiko Takeda' });
  await post(x, '/api/social/friend', { action: 'add', id: me.id }); await post(y, '/api/social/friend', { action: 'add', id: me.id });
  await N.friendAction('accept', x.id); await post(x, '/api/social/presence', { status: 'menu' });
} catch (e) { /* offline */ } }"""
SCREENS = [
    ('home', 'app.menu()'),
    # social v2: custom game, clubs (with API=: a club of your own), the Watch / Replay Hub screen
    ('custom', "(await import('./src/ui/custom.js')).showCustom(app)"),
    ('club', "(await import('./src/ui/clubs.js')).showClub(app); await new Promise((r) => setTimeout(r, 1500))"),
    ('club-mine', "{ const n = await import('./src/net/social2.js'); try { await n.createClub('Audit Club', 'AUD', '1.1.2.3'); await n.clubChat(0); } catch { /* offline */ } (await import('./src/ui/clubs.js')).showClub(app); await new Promise((r) => setTimeout(r, 1500)); }"),
    ('hub', "(await import('./src/ui/hub.js')).showHub(app); await new Promise((r) => setTimeout(r, 1500))"),
    ('season', 'H.showSeason(app)'),
    ('today', "(await import('./src/ui/today.js')).showToday(app)"),
    ('profile-coach', "H.showProfile(app, 'coach', 't1')"),
    ('ceremony', "(await import('./src/ui/ceremony.js')).showCeremony({ from: 1, to: 2, peak: 'Diamond II', peakElo: 1530, tier: 'diamond', eligible: true, pass: 15, passMax: 20, w: 9, l: 5, elo: 1210, rewards: [{ kind: 'title', id: 'rankSilver' }, { kind: 'banner', id: 'jade' }, { kind: 'skin', id: 'platinum' }, { kind: 'border', id: 'moon' }] }, () => app.menu())"),
    ('ceremony-next', "document.querySelector('.ceremony .btn').click()"),
    ('profile', 'H.showProfile(app)'),
    ('profile-mastery', "H.showProfile(app, 'mastery')"),
    ('profile-banners', "H.showProfile(app, 'banners')"),
    ('profile-achievements', "H.showProfile(app, 'achievements')"),
    ('profile-collection', "H.showProfile(app, 'collection')"),
    ('profile-emotes', "H.showProfile(app, 'emotes')"),
    ('profile-borders', "H.showProfile(app, 'borders')"),
    ('profile-pets', "H.showProfile(app, 'pets')"),
    ('profile-troops', "H.showProfile(app, 'troops')"),
    ('home-casual-rush', "app.queueMode = 'casual'; app.mapPref = 'frost'; app.menu()"),
    # parties (src/party.js): the leader's panel with a partner (2v2 toggle on), its chat lines, the invite dialog,
    # the partner's panel, then the party is left and Home is back to normal
    ('home-party', "const PT = await import('./src/party.js'); app.queueMode = 'ranked'; await PT.createParty(app); PT.party().members.push({ id: 'mate0001', self: false, leader: false, name: 'Benedikt', elo: 1320, ready: true, busy: false, lost: false, said: { i: 1, t: Date.now() + 60000 } }); PT.setQueueSize('2v2'); app.menu()"),
    ('home-party-chat', "document.querySelector('.ppanel .pchatbtn').click()"),
    ('party-invite', "(await import('./src/ui/party.js')).openInvite(app); await new Promise((r) => setTimeout(r, 400))"),
    ('home-party-partner', "for (const e of document.querySelectorAll('.modal')) e.remove(); const PT = await import('./src/party.js'), P = PT.party(); P.leader = false; P.link = { send() {}, close() {} }; P.want = true; P.mode = 'mm2'; P.members = [{ id: 'lead0001', self: false, leader: true, name: 'Alexandria', elo: 1600, ready: true }, { id: 'mate0001', self: true, leader: false, name: app.name, elo: 1000, ready: false }]; app.menu()"),
    ('home-after-party', "const PT = await import('./src/party.js'); PT.leaveParty(app, true); PT.setQueueSize('1v1'); app.menu()"),
    ('cup', 'H.showCup(app)'),
    ('franchise-found', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); (await import('./src/profile.js')).profile.d.fr = null; F.showFranchise(app, 'team')"),
    ('franchise-team', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); FP.foundFranchise({ name: 'Moonlit Kitsune FC', abbr: 'MKF', c1: '#e0453a', c2: '#f4f1e8', p: 2, e: 3, diff: 1 }); for (let i = 0; i < 4; i++) FP.simFixture(); F.showFranchise(app, 'team')"),
    ('franchise-card', "document.querySelector('.frlineup .frhero').click()"),
    ('franchise-market', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); document.querySelector('.modal')?.remove(); F.showFranchise(app, 'market')"),
    ('franchise-trade', "[...document.querySelectorAll('.frseg .chip')][1].click(); await new Promise((r) => setTimeout(r, 200)); document.querySelector('.frtrcols .frhero').click()"),
    ('franchise-league', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); F.showFranchise(app, 'league')"),
    ('franchise-club', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); F.showFranchise(app, 'club')"),
    ('franchise-pro', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); F.showFranchise(app, 'pro')"),
    ('franchise-offseason', "const F = await import('./src/ui/franchise.js'), FP = await import('./src/franchise/play.js'); for (let i = 0; i < 20; i++) FP.simFixture(); const fr = FP.getFr(); fr.off.step = 'contracts'; FP.saveFr(fr); F.showFranchise(app, 'team')"),
    ('rivals', 'app.aiLevel = 1; RV.showRivals(app)'),
    ('rivals-hard', "app.aiLevel = 2; RV.showRivals(app, 'kin')"),
    ('patch', 'H.showPatch(app)'),
    ('history-empty', 'H.showHistory(app)'),
    ('ladder', 'await O.showLeaderboard(app)'),
    ('ladder-friends', "await O.showLeaderboard(app, 'friends')"),
    ('profile-friends', SEED + "; H.showProfile(app, 'friends'); await new Promise((r) => setTimeout(r, 1500))"),
    ('settings', 'ST.showSettings(app)'),
    ('howto', 'S.showHowTo(app)'),
    ('dojo', "D.showDojo(app, { tab: 'heroes', hero: null })"),
    ('dojo-hero', "D.showDojo(app, { tab: 'heroes', hero: 'kaze' })"),
    ('dojo-talents', "document.querySelector('.tal-list').scrollIntoView({ block: 'center' })"),
    ('dojo-hearth', "D.showDojo(app, { tab: 'heroes', hero: 'aki', page: 'info' })"),
    ('dojo-lore', "D.showDojo(app, { tab: 'heroes', hero: 'mame', page: 'lore' }); await new Promise((r) => setTimeout(r, 300))"),
    ('dojo-lore-graph', "document.querySelector('.lgraph').scrollIntoView({ block: 'center' })"),
    ('dojo-skinviewer', "(await import('./src/ui/collection.js')).skinViewer('bastion', null, 'leg_bastion'); await new Promise((r) => setTimeout(r, 400))"),
    ('dojo-lineups', "document.querySelector('.svmodal')?.remove(); D.showDojo(app, { tab: 'lineups' })"),
    ('dojo-lineup-talents', "document.querySelector('.ltal').click(); await new Promise((r) => setTimeout(r, 300))"),
    ('dojo-builds', "for (const e of document.querySelectorAll('.modal')) e.remove(); D.showDojo(app, { tab: 'builds' })"),
    ('lobby-host', "S.showLobby(app, { code: 'KAZEX', status: 'Waiting for opponent…', onCancel: () => app.menu() })"),
    ('lobby-invite', "S.showLobby(app, { code: 'KAZEX', status: 'Waiting for opponent…', onCancel: () => app.menu(), extra: SO.lobbyInvite(app, 'KAZEX', { gameMode: 'classic' }) })"),
    ('lobby-join', "S.showLobby(app, { joining: true, code: '', status: '', onJoin() {}, onCancel: () => app.menu() })"),
    ('coop-lobby-host', "const C = await import('./src/ui/coop.js'); app.session = { mode: 'coop', lobby: true, host: true, slot: 0, room: { code: 'COOPX', kind: '2v2', aiLevel: 1, own: [{ top: 0, jungle: 0, mid: 1, bot: 1, support: 1 }, { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }], players: [{ slot: 0, name: 'Alexandria', team: 0, seat: 0 }, { slot: 1, name: 'Benedikt', team: 0, seat: 1 }, { slot: 2, name: 'Cy', team: 1, seat: 0 }], status: 'Room open: share the code or invite a friend.' } }; app.session.inviteEl = SO.lobbyInvite(app, 'COOPX', { mode: 'coop' }); C.showCoopLobby(app)"),
    ('coop-lobby-guest', "const C = await import('./src/ui/coop.js'); app.session = { mode: 'coop', lobby: true, host: false, slot: 1, room: { code: 'COOPX', kind: 'ai', aiLevel: 2, own: [{ top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }, { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }], players: [{ slot: 0, name: 'Alexandria', team: 0, seat: 0 }, { slot: 1, name: 'Benedikt', team: 0, seat: 1 }], status: '' } }; C.showCoopLobby(app)"),
    # ready check before a match (src/ui/readycheck.js): the active lineup, then a lineup with problems, then the Dojo's way back
    ('readycheck', "app.session = null; app.menu(); app.findMatch()"),
    ('readycheck-problems', "document.querySelector('.rcmodal')?.remove(); const PR = (await import('./src/profile.js')).profile; const P = PR.d.presets; app._rcKeep = JSON.parse(JSON.stringify(P.slots[P.active])); const q = JSON.parse(JSON.stringify(app._rcKeep)); q.main.mid = null; q.backup.top = null; q.backup.bot = null; q.name = 'Mmmmmmmmmmmmmmmm'; P.slots[P.active] = q; app.startVsAI('classic')"),
    ('dojo-return', "document.querySelector('.rcmodal .rcfoot .btn:not(.big)').click(); const PR = (await import('./src/profile.js')).profile; PR.d.presets.slots[PR.d.presets.active] = app._rcKeep"),
    ('matchmaking', "app.dojoReturn = null; app.session = null; app.menu(); O.showSearch(app, { elapsed: 12000, limit: 60000, status: 'Searching…', onCancel: () => app.menu() })"),
    ('draft', "app.queueMode = 'ranked'; app.mapPref = 'random'; app.startVsAI('classic', true); await new Promise((r) => setTimeout(r, 2500))"),
    ('prep', "const m = await import('./src/sim/draft.js'); const s = app.session; while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); } app.afterDraftAct(); await new Promise((r) => setTimeout(r, 1500))"),
    ('prep-adjust', "app.session.prepAdjust = true; app.renderPrep(); document.querySelector('.prep .plans').scrollIntoView({ block: 'center' })"),
    ('prep-talents', "document.querySelector('.prep .tal-pick').scrollIntoView({ block: 'center' })"),
    ('results', "app.prepReady(); await new Promise((r) => setTimeout(r, 1200)); app.match.runner.speed = 40; await new Promise((r) => setTimeout(r, 3000)); const g = app.match.game; g.over = true; g.winner = 0; app.endMatch(true); await new Promise((r) => setTimeout(r, 1500))"),
    ('results-story', "document.querySelector('.acard').scrollIntoView({ block: 'center' })"),
    ('analysis', "document.querySelector('.anbtn').click()"),
    ('analysis-damage', "document.querySelector('.astabs .chip:nth-child(2)').click()"),
    ('analysis-calls', "document.querySelector('.astabs .chip:nth-child(3)').click()"),
    ('history', "document.getElementById('anasheet')?.remove(); H.showHistory(app)"),
    ('profile-career', "H.showProfile(app, 'career')"),
    ('public-profile', "app.menu(); await new Promise((r) => setTimeout(r, 300)); await SO.showPlayer(app, (N.getAccount() || { id: 'AAAAAAAAAA' }).id, { name: app.name })"),
    # co-op results: a vs-AI match recorded as a co-op one (two coaches on blue; the credit panel under the progress)
    ('results-coop', "for (const e of document.querySelectorAll('.modal')) e.remove(); app.startVsAI('classic', true); const m = await import('./src/sim/draft.js'); const s = app.session; while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); } app.afterDraftAct(); await new Promise((r) => setTimeout(r, 1500)); app.prepReady(); await new Promise((r) => setTimeout(r, 1200)); app.match.runner.speed = 40; await new Promise((r) => setTimeout(r, 2500)); s.mode = 'coop'; s.kind = 'ai'; s.mySeat = 0; s.slot = 0; s.players = [{ slot: 0, name: app.name, team: 0, seat: 0 }, { slot: 1, name: 'Benedikt', team: 0, seat: 1, pid: 'BBBBBBBBBB' }]; s.coop = [{ seats: 2, own: { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }, lead: 0, coaches: s.players }, null]; s.draft.seats = [[0, 1, 0, 1, 0], []]; s.names = [app.name + ' & Benedikt', 'Normal AI']; const g = app.match.game; g.over = true; g.winner = 0; app.endMatch(true); await new Promise((r) => setTimeout(r, 1800)); document.querySelector('.coopres').scrollIntoView({ block: 'center' })"),
    # story campaign (src/ui/campaign.js): the chapter map, the chapter story, a mission briefing, the first-launch offer
    ('campaign', "for (const e of document.querySelectorAll('.modal')) e.remove(); (await import('./src/ui/campaign.js')).showCampaign(app, 1, { noStory: true })"),
    ('campaign-locked', "(await import('./src/ui/campaign.js')).showCampaign(app, 6, { noStory: true })"),
    ('campaign-story', "(await import('./src/ui/campaign.js')).showStory((await import('./src/data/campaign.js')).CHAPTERS[0].intro, 'Chapter 1: Embers of the Hearth', () => {})"),
    ('campaign-brief', "for (const e of document.querySelectorAll('.modal')) e.remove(); const C = await import('./src/ui/campaign.js'); C.showBriefing(app, (await import('./src/data/campaign.js')).MISSIONS[6])"),
    ('campaign-offer', "for (const e of document.querySelectorAll('.modal')) e.remove(); app.menu(); await new Promise((r) => setTimeout(r, 300)); (await import('./src/ui/campaign.js')).tutorialOffer(app)"),
]
CHECK = """([sl, sr]) => {
  const W = innerWidth, sc = document.getElementById('screen');
  const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const out = [];
  if (sc.scrollWidth > sc.clientWidth + 1) out.push(`horizontal overflow ${sc.scrollWidth - sc.clientWidth}px`);
  // the Analysis sheet covers the screen when it is open: audit it instead
  const sheet = document.querySelector('#anasheet .asbody'); if (sheet && sheet.scrollWidth > sheet.clientWidth + 1) out.push(`analysis overflow ${sheet.scrollWidth - sheet.clientWidth}px`);
  const els = [...document.querySelectorAll(sheet ? '#anasheet button' : '#screen button, #screen input, #screen a, #screen select, .smodal button, .svmodal button, .rcmodal button, .rcmodal input, .cpmodal button')].filter(vis);
  for (const e of els) {
    const r = e.getBoundingClientRect(), name = (e.textContent || e.value || e.className || e.tagName).trim().slice(0, 24);
    if (r.left < sl - 1 || r.right > W - sr + 1) out.push(`outside safe area: ${name} (${Math.round(r.left)}-${Math.round(r.right)})`);
    const st = getComputedStyle(e);
    if (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 2 && st.textOverflow !== 'ellipsis' && st.overflow !== 'visible') out.push(`clipped label: ${name}`);
  }
  // a sticky bar (the results footer) covers content scrolling under it by design: only compare buttons on the same layer
  const stuck = (e) => { for (let p = e; p && p !== sc; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'sticky' || ps === 'fixed') return true; } return false; };
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a) || stuck(a) !== stuck(b)) continue;
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left), oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (ox > 3 && oy > 3) out.push(`overlap: ${(a.textContent || a.className).trim().slice(0, 16)} x ${(b.textContent || b.className).trim().slice(0, 16)}`);
  }
  return [...new Set(out)].slice(0, 12);
}"""

async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w, h, sl, sr, st, sb, name) in VIEWS:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=w < 1000, is_mobile=w < 1000, device_scale_factor=2 if w < 1000 else 1)
            await ctx.add_init_script(PREFS)  # GAME_LANG=de / HAND=left / HC=1: audit a language or an accessibility layout
            if os.environ.get('API') is not None: await ctx.add_init_script(f"localStorage.setItem('mobavs_api', {os.environ['API']!r})")
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(3000)
            await pg.evaluate(f"() => {{ const s = document.documentElement.style; s.setProperty('--safe-l', '{sl}px'); s.setProperty('--safe-r', '{sr}px'); s.setProperty('--safe-t', '{st}px'); s.setProperty('--safe-b', '{sb}px'); }}")
            tag = f'{w}x{h}' + (f' {name}' if name else '') + (f' safe {sl}/{sr}/{sb}' if sl or sb else '')
            for scr, js in SCREENS:
                try:
                    await pg.evaluate(f"async () => {{ {M} {js}; }}")
                except Exception as e:
                    print(f'  {tag} {scr}: navigation failed: {str(e)[:160]}'); bad += 1; continue
                await pg.wait_for_timeout(700)
                issues = await pg.evaluate(CHECK, [sl, sr])
                if OUT: await pg.screenshot(path=f"{OUT}/scr_{w}x{h}{'_' + name if name else ''}_{scr}.png", animations='disabled')
                if issues: print(f'  {tag} {scr}: ' + '; '.join(issues)); bad += len(issues)
            if os.environ.get('MISS'):  # i18n coverage: UI strings that are not in src/i18n/en.json
                miss = await pg.evaluate("[...(window.__i18nMiss || [])]")
                with open(os.environ['MISS'], 'a') as f: f.write('\n'.join(miss) + '\n')
                print(f'  {tag}: {len(miss)} strings missing from the i18n catalog -> {os.environ["MISS"]}')
            for e in errs[:3]: print(f'  {tag} JS error: {e[:200]}'); bad += 1
            print(f'{tag}: done', flush=True)
            await ctx.close()
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
