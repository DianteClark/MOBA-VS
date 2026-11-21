# HUD audit: in a live match, every HUD panel stays inside the safe area and no two panels overlap,
# in every popup state we can trigger (decision tray open, target sheet, ring menu, scoreboard, hero
# popover, Foes panel, Menu, quick chat, banner, settings and halftime overlays).
#   python3 tools/ui_audit.py URL [outdir] [viewports]
# viewports: comma list of WxH or WxH@L/R/T/B (safe-area insets in CSS px), or a preset:
#   iphones   every iPhone of the last 5 years in landscape, full screen (PWA) and Safari with toolbars
#   desktop   1920x1080,1440x900,1366x768,1280x720,1024x768,900x600
#   all       iphones + desktop
# Safe areas are simulated by overriding the --safe-* CSS variables (Chrome cannot fake the notch).
import sys, asyncio
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
          ('tray', '#cmdbar .tray'), ('sheet', '#cmdbar .sheet'), ('cancel', '#cmdbar .cancelpill'), ('meter', '#cmdbar .meter'),
          ('hand', '#cmdbar .hand'), ('stance', '#cmdbar .ultbtn'), ('calls', '#cmdbar .callrow'), ('banner', '#banner*'),
          ('qchatbtn', '#qchatbtn'), ('qchat', '#qchat'), ('qfeed', '#qfeed*'), ('ring', '#ring*')]
# overlays that may cover the HUD on purpose: they only have to fit the safe area
OVERLAYS = [('menu', '#ctrl.open .seg:last-child'), ('scoreboard', '#scoreboard .sbcard'), ('hpop', '#hpop'), ('modal', '.modal .mpanel'), ('halftime', '#halftime .ht-card')]
# pairs that are allowed to touch (one lives inside the other's column / is drawn over the map on purpose)
SKIP = {frozenset(p) for p in [('meter', 'hand'), ('hand', 'stance'), ('meter', 'stance')]}

JS = """([panels, overlays]) => {
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

SETUP = """async () => {
  app.startVsAI();
  const m = await import('./src/sim/draft.js'); const s = app.session;
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); }
  app.afterDraftAct();
}"""
# worst case base state: follow a hero (detail panel), full ticker + kill feed, a Coach's Call card in the
# decision tray (with a request and suggestions queued behind it) and a cancel pill
BASE = """() => { const H = app.match.hud, g = app.match.game; H.selectHero(g.teams[0].heroes[1]); g.teams[0].heroes[0].task = { kind: 'safe', call: true, until: 1e9 };
  H.dock.suggest('t1', 'Mid overextended', 'Gank', { type: 'gank', lane: 'mid' }); H.dock.suggest('t2', 'Shrine is open', 'Capture', { type: 'shrine', shrine: 0 });
  H.dock.request({ hero: g.teams[0].heroes[2], key: 'rq', text: 'I can solo-kill their mid. Go?', cmd: { type: 'permit', kind: 'fight', hero: g.teams[0].heroes[2].id, target: g.teams[1].heroes[2].id } });
  H.dock.coachCall({ key: 'cc', title: 'Ember Kami wakes in 18s', text: 'Set up for it, or trade elsewhere?', opts: [{ label: 'Take Kami', cmd: { type: 'objective', obj: 'dragon' } }, { label: 'Wait & see', cmd: null, sub: 'no call' }, { label: 'Push Mid', cmd: { type: 'group', lane: 'mid' } }] }, { ttl: 600000 });
  for (let i = 0; i < 6; i++) H.ticker('Test ticker line number ' + i + ' with quite a lot of text in it', 'danger', 3);
  for (let i = 0; i < 5; i++) H.killfeed(g.teams[0].heroes[i], g.teams[1].heroes[i], 1);
  H.dock.tick(); }"""
RESET = """() => { const H = app.match.hud; H.dock.close(); H.dock.closeRing(); H.toggleScoreboard(false); H.closePop(); document.getElementById('rightcol').classList.remove('show');
  document.getElementById('ctrl').classList.remove('open'); for (const e of document.querySelectorAll('.modal')) e.remove();
  if (H.chat) H.chat.close(); import('./src/ui/halftime.js').then((m) => m.hideHalftime()); }"""
STATES = [
    ('tray', None),
    ('sheet', "() => app.match.hud.dock.open('gank')"),
    ('objective', "() => app.match.hud.dock.open('objective')"),
    ('ring', "() => { const r = app.renderer, c = r.canvas.getBoundingClientRect(); app.match.hud.dock.ringAt({ x: r.cam.x, y: r.cam.y }, c.left + c.width / 2, c.top + c.height / 2); }"),
    ('banner', "() => { const H = app.match.hud; H.banner('FIRST BLOOD', '#4aa3ff', 60000, 'assets/img/faces/kaze.png', true); }"),
    ('foes', "() => { const b = document.querySelector('.foesbtn'); if (b && b.offsetParent) b.click(); }"),
    ('menu', "() => document.getElementById('ctrl').classList.add('open')"),
    ('quickchat', "() => { const H = app.match.hud; if (H.chat) { H.chat.open(); H.chat.show(0, { line: 'gg' }); H.chat.show(1, { emote: 'up' }); } }"),
    ('scoreboard', "() => app.match.hud.toggleScoreboard(true)"),
    ('hpop', "() => { const H = app.match.hud; H.openPop(H.g.teams[0].heroes[0], H.mineRows[0]); }"),
    ('settings', "() => import('./src/ui/settings.js').then((m) => m.openSettingsModal(app.match.runner))"),
    ('halftime', "() => { const r = app.match.runner; import('./src/ui/halftime.js').then((m) => m.showHalftime(app, app.match.game, 0, r, { end: performance.now() + 60000 })); }"),
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
            await pg.evaluate("app.prepReady()")
            await pg.wait_for_timeout(1500)
            await pg.evaluate("app.match.runner.speed = 30")
            await pg.wait_for_timeout(4000)
            await pg.evaluate("app.match.runner.speed = 0.0001")
            await pg.evaluate(BASE)
            await pg.wait_for_timeout(600)
            issues = []
            tag = f'{w}x{h}' + (f' {name}' if name else '') + (f' safe {sl}/{sr}/{sb}' if sl or sb else '')
            for state, js in STATES:
                await pg.evaluate(RESET); await pg.evaluate(BASE)
                if js: await pg.evaluate(js)
                await pg.wait_for_timeout(450)
                res = await pg.evaluate(JS, [PANELS, OVERLAYS])
                issues += [f'[{state}] ' + x for x in check(res, w, h)]
                if OUT and state in ('tray', 'sheet', 'quickchat', 'halftime', 'ring'):
                    await pg.screenshot(path=f"{OUT}/ui_{w}x{h}{'_' + name.split()[-1] if name else ''}_{state}.png", timeout=20000, animations='disabled')
            issues += [f'JS error: {e}' for e in errs[:3]]
            print(f'{tag}: ' + ('OK' if not issues else f'{len(issues)} issue(s)'), flush=True)
            for s in issues: print('   ', s)
            bad += len(issues)
            await ctx.close()
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
