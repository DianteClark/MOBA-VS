# HUD audit: in a live match, every HUD panel stays inside the safe area and no two panels overlap,
# in every popup state we can trigger (decision tray open, target sheet, ring menu, scoreboard, hero
# popover, Foes panel, Menu, quick chat, banner, Coach Moment card, coach tip, settings and halftime overlays).
#   python3 tools/ui_audit.py URL [outdir] [viewports]
# viewports: comma list of WxH or WxH@L/R/T/B (safe-area insets in CSS px), or a preset:
#   iphones   every iPhone of the last 5 years in landscape, full screen (PWA) and Safari with toolbars
#   desktop   1920x1080,1440x900,1366x768,1280x720,1024x768,900x600
#   all       iphones + desktop
# MAP=rush in the environment audits a Lane Rush match instead of a classic one.
# THEATER=1 audits the Replay Theater (a short recorded match played back) instead of a live match.
# COOP=1 audits a co-op HUD (you run bot side, your partner leads): lead badge, ownership marks, a partner
# suggestion in the tray and a partner call on the ticker.
# Safe areas are simulated by overriding the --safe-* CSS variables (Chrome cannot fake the notch).
import sys, asyncio, os
from playwright.async_api import async_playwright

# (name, W, H, side inset (notch / Dynamic Island), bottom inset (home indicator))
IPHONES = [('SE3', 667, 375, 0, 0), ('mini', 812, 375, 50, 21), ('12/13/14/16e', 844, 390, 47, 21), ('14Pro/15/16', 852, 393, 59, 21),
           ('16Pro/17', 874, 402, 62, 21), ('Air', 912, 420, 62, 21), ('13PM/14Plus', 926, 428, 47, 21), ('14PM/15PM/16Plus', 932, 430, 59, 21),
           ('16PM/17PM', 956, 440, 62, 21)]
# Safari landscape with its compact tab bar: about 50-80px shorter; the side insets still apply.
SAFARI_BAR = 62

def presets(name):
    out = []
    if name in ('iphones', 'all'):
        for (n, w, h, s, b) in IPHONES:
            out.append((w, h, s, s, 0, b, n + ' PWA'))
            out.append((w, h - SAFARI_BAR, s, s, 0, b, n + ' Safari'))
    if name in ('desktop', 'all'):
        for w, h in [(1920, 1080), (1440, 900), (1366, 768), (1280, 720), (1024, 768), (900, 600)]: out.append((w, h, 0, 0, 0, 0, ''))
    return out

def parse(spec):
    if spec in ('iphones', 'desktop', 'all'): return presets(spec)
    out = []
    for v in spec.split(','):
        wh, _, ins = v.partition('@')
        w, h = map(int, wh.split('x'))
        l, r, t, b = (list(map(int, ins.split('/'))) + [0, 0, 0, 0])[:4] if ins else (0, 0, 0, 0)
        out.append((w, h, l, r, t, b, ''))
    return out

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
OUT = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
VIEWS = parse(sys.argv[3]) if len(sys.argv) > 3 else presets('all')

# name -> selector; '*' suffix = use the union of the element's visible children
PANELS = [('myteam', '#myteam'), ('scorebar', '#scorebar'), ('objtimers', '#objtimers'), ('ticker', '#ticker'), ('enemyteam', '#enemyteam'),
          ('killfeed', '#killfeed*'), ('mm', '#mm'), ('ctrl', '#ctrl*'), ('detail', '#detail'), ('foestrip', '#foestrip'),
          ('tray', '#cmdbar .tray'), ('sheet', '#cmdbar .sheet'), ('cancel', '#cmdbar .cancelpill'), 
          ('handrow', '#cmdbar .handrow'), ('calls', '#cmdbar .callrow'), ('banner', '#banner*'),
          ('qchatbtn', '#qchatbtn'), ('qfeed', '#qfeed*'), ('ring', '#ring*'), ('theater', '#cmdbar .theaterbar'), ('irchip', '.irchip'), ('irpip', '.irpip')]
# overlays that may cover the HUD on purpose: they only have to fit the safe area
OVERLAYS = [('menu', '#ctrl.open .seg:last-child'), ('qchat', '#qchat'), ('scoreboard', '#scoreboard .sbcard'), ('hpop', '#hpop'), ('modal', '.modal .mpanel'), ('halftime', '#halftime .ht-card'), ('follow', '#thfollow'), ('analysis', '#anasheet')]
# pairs that are allowed to touch (one lives inside the other's column / is drawn over the map on purpose)
# (the hand row's children - meter, each card, Moments, stance - are checked against each other by DOCK_JS)
SKIP = {frozenset(p) for p in [('ctrl', 'qchatbtn')]}

# Dock row stress: every child of the hand row (meter, EACH tactic card, Moments, stance) must not overlap any
# other, in every button state (Moments ready / locked / spent, stances Auto / Hold / ALL-IN, a 4th card), with
# normal fonts and with a wide-glyph override that simulates iOS font metrics and a larger text size.
WIDE_CSS = "#hud, #hud * { letter-spacing: 0.09em !important; font-stretch: expanded !important; } #cmdbar .momentbtn .ml, #cmdbar .ultbtn b, #cmdbar .call .l { font-size: 115% !important; }"
DOCK_JS = """async (wide) => {
  const D = app.match.hud.dock, out = [], st = document.createElement('style'); st.textContent = wide;
  const vis = (e) => e && e.offsetParent && e.getBoundingClientRect().width > 1;
  const kids = () => { const row = document.querySelector('#cmdbar .handrow'); if (!row) return [];
    let c = 0; return [...row.children].map((e) => [e.classList.contains('tcard') ? 'card' + ++c : e.className.split(' ')[0], e]).filter(([, e]) => vis(e)); };
  const measure = (tag) => { const ks = kids(), rs = ks.map(([n, e]) => [n, e.getBoundingClientRect()]);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const [a, A] = rs[i], [c, C] = rs[j];
      const ox = Math.min(A.right, C.right) - Math.max(A.left, C.left), oy = Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top);
      if (ox > 1 && oy > 1) out.push(`${tag}: ${a} x ${c} overlap ${Math.round(ox)}x${Math.round(oy)}`); }
    const cb = document.getElementById('cmdbar').getBoundingClientRect();
    for (const [n, R] of rs) if (R.left < cb.left - 1 || R.right > cb.right + 1) out.push(`${tag}: ${n} leaves the command bar`); };
  const states = [['ready', 3], ['lock', 2], ['spent', 0]], ults = ['auto', 'save', 'go'];
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const font of ['', 'wide']) {
    if (font) document.head.appendChild(st);
    for (let k = 0; k < states.length; k++) {
      const [cls, n] = states[k], b = D.momentBtn; b.classList.remove('ready', 'lock', 'spent'); b.classList.add(cls); D.momentN.textContent = String(n);
      D.ultBtn.className = 'ultbtn ' + ults[k]; D.ultBtn.lastChild.textContent = { auto: 'Auto', save: 'Hold', go: 'ALL-IN' }[ults[k]];
      await frame(); measure(`${font || 'normal'} ${cls}/${ults[k]}`);
    }
    // 2 and 4 cards, as the dock would build them (cards are direct grid items; --cards = their count)
    const row = document.querySelector('#cmdbar .handrow'), cs = [...row.querySelectorAll('.tcard')], n0 = cs.length;
    if (cs.length) {
      const extra = cs[cs.length - 1].cloneNode(true); cs[cs.length - 1].after(extra); row.style.setProperty('--cards', String(n0 + 1));
      await frame(); measure(`${font || 'normal'} ${n0 + 1} cards`); extra.remove();
      const gone = cs[cs.length - 1]; gone.remove(); row.style.setProperty('--cards', String(n0 - 1));
      await frame(); measure(`${font || 'normal'} ${n0 - 1} cards`); cs[cs.length - 2].after(gone); row.style.setProperty('--cards', String(n0));
    }
    st.remove();
  }
  D.ultBtn._m = null; D.tick();
  return out;
}"""

JS = """([panels, overlays]) => {
  // measure the settled layout: finish entry animations (rise / popIn move panels by ~10px for 0.15s, and a busy
  // machine can still be mid-animation when we measure); endless ones (blinks, pulses) are left alone
  for (const a of document.getAnimations()) { try { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); } catch (e) { /* not finishable */ } }
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (e.offsetParent || s.position === 'fixed'); };
  const box = (sel) => { const union = sel.endsWith('*'); const e = document.querySelector(union ? sel.slice(0, -1) : sel); if (!vis(e)) return null;
    // drop-downs (absolutely positioned children, e.g. the open Menu) are overlays, not part of the panel
    const els = union ? [...e.children].filter((k) => vis(k) && getComputedStyle(k).position !== 'absolute') : [e]; if (!els.length) return null;
    const rs = els.map((k) => k.getBoundingClientRect());
    return { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }; };
  const cs = getComputedStyle(document.documentElement), px = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
  // clipped text: a visible button / label whose content is wider than its box (ellipsis is fine)
  const clipped = [...document.querySelectorAll('#hud button, #hud .nm, #hud .st, #hud .tray b, #hud .tray span')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).overflow !== 'visible').slice(0, 4).map((e) => (e.className || e.tagName) + ': ' + e.textContent.trim().slice(0, 30));
  return { panels: panels.map(([n, s]) => [n, box(s)]), overlays: overlays.map(([n, s]) => [n, box(s)]), safe: [px('--safe-l'), px('--safe-r'), px('--safe-t'), px('--safe-b')], clipped };
}"""

def check(res, w, h):
    issues = []
    sl, sr, st, sb = res['safe']
    rects = {n: r for n, r in res['panels'] if r}
    for n, r in list(rects.items()) + [(n, r) for n, r in res['overlays'] if r]:
        if r['l'] < sl - 1 or r['r'] > w - sr + 1 or r['t'] < st - 1 or r['b'] > h - sb + 1:
            issues.append(f"{n} outside safe area ({int(r['l'])},{int(r['t'])})-({int(r['r'])},{int(r['b'])})")
    ks = list(rects)
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            a, c = ks[i], ks[j]
            if frozenset((a, c)) in SKIP: continue
            A, C = rects[a], rects[c]
            ox, oy = min(A['r'], C['r']) - max(A['l'], C['l']), min(A['b'], C['b']) - max(A['t'], C['t'])
            if ox > 2 and oy > 2: issues.append(f'{a} x {c} overlap {int(ox)}x{int(oy)}')
    issues += [f'clipped text {c}' for c in res['clipped']]
    return issues

# MAP=rush audits a Lane Rush match instead of the classic 5v5 map
MAPPREF = 'rush' if os.environ.get('MAP') == 'rush' else 'classic'
SETUP = """async () => {
  app.startVsAI('%s', true);
  const m = await import('./src/sim/draft.js'); const s = app.session;
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); }
  app.afterDraftAct();
}""" % MAPPREF
# worst case base state: follow a hero (detail panel), full ticker + kill feed, a Coach's Call card in the
# decision tray (with a request and suggestions queued behind it), a cancel pill, and the online quick-chat button
BASE = """() => { const H = app.match.hud, g = app.match.game; H.enableChat(() => {}); H.selectHero(g.teams[0].heroes[1]); g.teams[0].heroes[0].task = { kind: 'safe', call: true, until: 1e9 };
  H.dock.suggest('t1', 'Mid overextended', 'Gank', { type: 'gank', lane: 'mid' }); H.dock.suggest('t2', 'Shrine is open', 'Capture', { type: 'shrine', shrine: 0 });
  H.dock.request({ hero: g.teams[0].heroes[2], key: 'rq', text: 'I can solo-kill their mid. Go?', cmd: { type: 'permit', kind: 'fight', hero: g.teams[0].heroes[2].id, target: g.teams[1].heroes[2].id } });
  H.dock.coachCall({ key: 'cc', title: 'Ember Kami wakes in 18s', text: 'Set up for it, or trade elsewhere?', opts: [{ label: 'Take Kami', cmd: { type: 'objective', obj: 'dragon' } }, { label: 'Wait & see', cmd: null, sub: 'no call' }, { label: 'Push Mid', cmd: { type: 'group', lane: 'mid' } }] }, { ttl: 600000 });
  for (let i = 0; i < 6; i++) H.ticker('Test ticker line number ' + i + ' with quite a lot of text in it', 'danger', 3);
  for (let i = 0; i < 5; i++) H.killfeed(g.teams[0].heroes[i], g.teams[1].heroes[i], 1);
  H.dock.tick(); }"""
RESET = """() => { const H = app.match.hud; H.dock.close(); H.dock.closeRing(); H.toggleScoreboard(false); H.closePop(); document.getElementById('rightcol').classList.remove('show');
  document.getElementById('ctrl').classList.remove('open'); for (const e of document.querySelectorAll('.modal')) e.remove();
  if (H.chat) H.chat.close(); if (app.match.instant) app.match.instant.destroy(); import('./src/ui/halftime.js').then((m) => m.hideHalftime()); }"""
INSTANT = "async () => { const i = app.match.instant, g = app.match.game, S = await import('./src/ui/snapshot.js'), x = g.teams[0].heroes[0]; i.snaps = [S.snapshot(g)]; i.offer = { x: x.x, y: x.y, start: g.tick, end: g.tick + 400, prio: 3, until: performance.now() + 600000 }; %s; }"
STATES = [
    ('tray', None),
    ('sheet', "() => app.match.hud.dock.open('gank')"),
    ('objective', "() => app.match.hud.dock.open('objective')"),
    ('moments', "() => app.match.hud.dock.open('moments')"),
    ('ring', "() => { const r = app.renderer, c = r.canvas.getBoundingClientRect(); app.match.hud.dock.ringAt({ x: r.cam.x, y: r.cam.y }, c.left + c.width / 2, c.top + c.height / 2); }"),
    ('banner', "() => { const H = app.match.hud; H.banner('FIRST BLOOD', '#4aa3ff', 60000, 'assets/img/faces/kaze.png', true); }"),
    ('momentcard', "() => import('./src/ui/momentfx.js').then((m) => m.momentFx(app.match.hud, { id: 'push', team: 0 }))"),
    ('tip', "() => { const H = app.match.hud; H.dock.tray.clear(); return import('./src/ui/coachtips.js').then((m) => { const t = new m.CoachTips(H); t.show(m.TIPS[2]); }); }"),
    ('foes', "() => { const b = document.querySelector('.foesbtn'); if (b && b.offsetParent) b.click(); }"),
    ('menu', "() => document.getElementById('ctrl').classList.add('open')"),
    ('quickchat', "() => { const c = app.match.hud.chat; c.open(); c.show(0, { i: 4 }); c.show(1, { e: 'up' }); }"),
    ('scoreboard', "() => app.match.hud.toggleScoreboard(true)"),
    ('hpop', "() => { const H = app.match.hud; H.openPop(H.g.teams[0].heroes[0], H.mineRows[0]); }"),
    ('settings', "() => import('./src/ui/settings.js').then((m) => m.openSettingsModal(app.match.runner))"),
    # v23 match depth: hero sheet with next-item + talent rows, the live talent prompt, a fight forecast
    ('herosheet', "() => { const H = app.match.hud, x = H.g.teams[0].heroes[1]; if (!x.tal) return; x.tal = [0, 1, -1]; x.talAt = [H.g.tick, H.g.tick, 0]; H.dock.open('hero:' + x.id); }"),
    ('talentprompt', "() => { const H = app.match.hud, x = H.g.teams[0].heroes[3]; if (!H.depth) return; H.dock.tray.clear(); x.tal = [1, -1, -1]; x.talAt = [H.g.tick, 0, 0]; H.depth.talentPrompt(x, 0, 1); }"),
    ('forecast', "() => { const H = app.match.hud; if (!H.depth) return; H.dock.tray.clear(); H.depth.showForecast({ at: { x: 649, y: 678 }, where: 'Kraken', obj: 'baron', eta: 8, mine: 4, theirs: 3, unseen: 1, edge: 1 }); }"),
    ('halftime', "() => { const r = app.match.runner; import('./src/ui/halftime.js').then((m) => m.showHalftime(app, app.match.game, 0, r, { end: performance.now() + 60000 })); }"),
    # Instant Replay: the chip by the minimap, then its picture-in-picture panel
    ('replaychip', INSTANT % 'i.showChip()'),
    ('replaypip', INSTANT % 'i.start()'),
]

# Co-op: the same match, seen by the non-lead coach of a shared team (HUD rebuilt with the co-op session)
COOPIFY = None
if os.environ.get('COOP') == '1':
    COOPIFY = """async () => { const m = app.match, s = app.session, g = m.game;
      s.mode = 'coop'; s.mySeat = 1; s.slot = 1; s.players = [{ slot: 0, name: 'Alexandria', team: 0, seat: 0 }, { slot: 1, name: 'Mia', team: 0, seat: 1 }];
      s.coop = [{ seats: 2, own: { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }, lead: 0, coaches: s.players }, null];
      g.teams[0].coop = { seats: 2, lead: 0, left: [false, false], ai: false }; for (const x of g.teams[0].heroes) x.seat = s.coop[0].own[x.role];
      const { Hud } = await import('./src/ui/hud.js'); m.hud.destroy(); m.hud = new Hud(app, g, m.runner, app.renderer, app.minimap, 0, 'coop'); }"""
    BASE = BASE[:-1] + """  H.dock.partnerSuggestion('Alexandria', 0, { type: 'objective', obj: 'dragon' }, 'Take Ember Kami');
  H.ticker('Alexandria: Group Mid', 'mate s0', 4); H.updateCoop(); }"""

# Replay Theater: record ~40s of a match, then watch it back with the Theater bar
if os.environ.get('THEATER') == '1':
    SETUP = SETUP[:-1] + "  await new Promise((r) => setTimeout(r, 1500)); app.prepReady(); }"
    THEATER_GO = """async () => { const m = app.match; m.runner.speed = 30; await new Promise((r) => setTimeout(r, 2500)); m.runner.speed = 1;
      const rep = { cfg: m.cfg, log: m.runner.log, names: app.session.names, myTeam: 0, len: Math.round(m.game.time) };
      app.match = null; app.teardownMatch(m);
      app.session = { mode: 'watch', replay: rep, myTeam: -1, seed: rep.cfg.seed, mapId: rep.cfg.map, names: rep.names };
      app.startMatch(); await new Promise((r) => setTimeout(r, 1500)); app.match.theater.seek(Math.min(20, rep.len - 5), true); }"""
    BASE = "() => { const H = app.match.hud, g = app.match.game; H.selectHero(g.teams[0].heroes[1]); for (let i = 0; i < 6; i++) H.ticker('Test ticker line number ' + i + ' with quite a lot of text in it', 'danger', 3); for (let i = 0; i < 5; i++) H.killfeed(g.teams[0].heroes[i], g.teams[1].heroes[i], 1); }"
    RESET = "() => { const H = app.match.hud; H.toggleScoreboard(false); H.closePop(); document.getElementById('rightcol').classList.remove('show'); document.getElementById('ctrl').classList.remove('open'); for (const e of document.querySelectorAll('.modal, #thfollow, #anasheet')) e.remove(); }"
    STATES = [
        ('bar', None),
        ('follow', "() => document.querySelector('.thfol').click()"),
        ('analysis', "() => { const t = app.match.theater; t.A = t.A || t.scout.rec.finish({ my: 0 }); t.openAnalysis(); }"),
        ('banner', "() => { const H = app.match.hud; H.banner('END OF REPLAY', '#ffd84a', 60000); }"),
        ('foes', "() => { const b = document.querySelector('.foesbtn'); if (b && b.offsetParent) b.click(); }"),
        ('menu', "() => document.getElementById('ctrl').classList.add('open')"),
        ('scoreboard', "() => app.match.hud.toggleScoreboard(true)"),
        ('hpop', "() => { const H = app.match.hud; H.openPop(H.g.teams[0].heroes[0], H.mineRows[0]); }"),
    ]

async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w, h, sl, sr, st, sb, name) in VIEWS:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=w < 1000, is_mobile=w < 1000, device_scale_factor=2 if w < 1000 else 1)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e) + ' ' + str(getattr(e, 'stack', ''))[:300]))
            await pg.goto(URL); await pg.wait_for_timeout(3000)
            await pg.evaluate(f"() => {{ const s = document.documentElement.style; s.setProperty('--safe-l', '{sl}px'); s.setProperty('--safe-r', '{sr}px'); s.setProperty('--safe-t', '{st}px'); s.setProperty('--safe-b', '{sb}px'); }}")
            await pg.evaluate(SETUP)
            await pg.wait_for_timeout(1500)
            if os.environ.get('THEATER') == '1':
                await pg.evaluate(THEATER_GO); await pg.wait_for_timeout(2500)
                await pg.evaluate("app.match.runner.paused = true")
            else:
                await pg.evaluate("app.prepReady()")
                await pg.wait_for_timeout(1500)
                await pg.evaluate("app.match.runner.speed = 30")
                await pg.wait_for_timeout(4000)
                if COOPIFY: await pg.evaluate(COOPIFY)
                await pg.evaluate("app.match.runner.speed = 0.0001")
            await pg.evaluate(BASE)
            await pg.wait_for_timeout(600)
            issues = [] if os.environ.get('THEATER') == '1' else ['[dock] ' + x for x in await pg.evaluate(DOCK_JS, WIDE_CSS)]
            tag = f'{w}x{h}' + (f' {name}' if name else '') + (f' safe {sl}/{sr}/{sb}' if sl or sb else '')
            for state, js in STATES:
                await pg.evaluate(RESET); await pg.evaluate(BASE)
                if js: await pg.evaluate(js)
                await pg.wait_for_timeout(450)
                res = await pg.evaluate(JS, [PANELS, OVERLAYS])
                issues += [f'[{state}] ' + x for x in check(res, w, h)]
                if OUT and COOPIFY and state == 'tray': await pg.screenshot(path=f"{OUT}/ui_coop_{w}x{h}{'_' + name.split()[-1] if name else ''}_tray.png", timeout=20000, animations='disabled')
                elif OUT and state in ('tray', 'sheet', 'quickchat', 'halftime', 'ring', 'momentcard', 'tip', 'bar', 'follow', 'analysis'):
                    await pg.screenshot(path=f"{OUT}/ui_{w}x{h}{'_' + name.split()[-1] if name else ''}_{state}.png", timeout=20000, animations='disabled')
            issues += [f'JS error: {e}' for e in errs[:3]]
            print(f'{tag}: ' + ('OK' if not issues else f'{len(issues)} issue(s)'), flush=True)
            for s in issues: print('   ', s)
            bad += len(issues)
            await ctx.close()
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
