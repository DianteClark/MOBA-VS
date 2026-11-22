# Tap audit: every visible tappable element (buttons, links, inputs, chips, hero rows, cards, anything with a
# pointer cursor) in every HUD state of tools/ui_audit.py and every menu screen of tools/screen_audit.py must
#   * receive the tap: document.elementFromPoint at its centre and 4 inner points returns the element (or a
#     descendant), not an invisible / decorative layer on top (overlay, ticker, chat feed, banner, toast, tray...).
#     A real overlay that covers the HUD on purpose (Menu, scoreboard, hero popover, a modal...) is not a failure.
#   * have a finger-sized hit area: probing outward from its centre, the element (its padding / ::before / ::after
#     included, as the browser hit-tests them) answers for 44 CSS px across in both directions, or at least 28px
#     where the next thing out on a side (past at most a 4px hairline gap) is another tap target: dense rows and
#     grids, where a bigger box would steal the neighbour's taps.
#   python3 tools/tap_audit.py URL [viewports] [hud|menus|both]
# viewports as tools/ui_audit.py (default: the iPhone presets, PWA and Safari, with their safe-area insets).
# The page runs with touch emulation (hasTouch, isMobile, DPR 2 on phones). Exit code 1 if anything fails.
# API=<base> also audits the online screens (parties, clubs, friends) against a Worker, as tools/screen_audit.py.
# VERBOSE=1 prints every failure (default: the first 6 per state); ONLY=<state,...> limits the states run.
import sys, os, re, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8891/'
SPEC = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else 'iphones'
WHAT = sys.argv[3] if len(sys.argv) > 3 else 'both'
_argv = sys.argv; sys.argv = [_argv[0], URL, '', SPEC]  # the audit modules read their own argv at import
import ui_audit as UA, screen_audit as SA  # noqa: E402
sys.argv = _argv
from playwright.async_api import async_playwright  # noqa: E402

ONLY = set(filter(None, os.environ.get('ONLY', '').split(',')))
VERBOSE = os.environ.get('VERBOSE') == '1'
# overlays that cover the HUD / screen on purpose while open: what they cover is not a failure
COVER = '#ctrl.open .seg, #qchat, #scoreboard, #hpop, .hpop, .modal, #halftime, #thfollow, #anasheet, #helpov, .bgpop, .ringc .ropt'

AUDIT = r"""([cover, scope]) => {
  const W = innerWidth, H = innerHeight;
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, label[for], [role=button], [role=tab], [onclick], [tabindex]:not([tabindex="-1"]), .chip, .btn, .tcard, .hrow, .frhero, .scard';
  const alive = (e) => { for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; } return true; };
  const ptr = (e) => getComputedStyle(e).cursor === 'pointer';
  let root = document.querySelector(scope) || document.body;
  // a modal on top: only what is inside the topmost one can be tapped
  const modals = [...document.querySelectorAll('.modal')].filter(alive); if (modals.length) root = modals[modals.length - 1];
  const cand = new Set([...root.querySelectorAll(SEL)]);
  for (const e of root.querySelectorAll('div, span, li, img, canvas, b, i')) if (ptr(e) && !(e.parentElement && ptr(e.parentElement))) cand.add(e);
  // the clipped visible rect: viewport and every overflow-clipping ancestor
  const clip = (e) => { let r = e.getBoundingClientRect(), l = Math.max(0, r.left), t = Math.max(0, r.top), rr = Math.min(W, r.right), b = Math.min(H, r.bottom);
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const q = p.getBoundingClientRect(), ql = q.left + p.clientLeft, qt = q.top + p.clientTop; // content clips at the padding box
        l = Math.max(l, ql); t = Math.max(t, qt); rr = Math.min(rr, ql + p.clientWidth); b = Math.min(b, qt + p.clientHeight); } }
    return { l, t, r: rr, b, w: rr - l, h: b - t, full: r }; };
  const name = (e) => { const tx = (e.getAttribute('aria-label') || e.title || e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (tx ? ` "${tx}"` : ''); };
  const owns = (e, hit) => hit && (hit === e || e.contains(hit) || (hit.tagName === 'LABEL' && hit.contains(e)) || (e.labels && [...e.labels].includes(hit)));
  const isTarget = (x) => { for (let p = x; p && p !== document.body; p = p.parentElement) if (cand.has(p) || p.matches(SEL)) return true; return false; };
  const out = { fail: [], small: [], n: 0 };
  // a scrolled list: bring an element into view the way a player would, then test it
  const scrolled = new Map();
  for (const e of cand) {
    if (!alive(e) || e.closest('[aria-hidden=true]') && !e.closest('.modal')) continue;
    let c = clip(e); if (c.full.width < 4 || c.full.height < 4) continue;
    if (c.w < c.full.width - 1 || c.h < c.full.height - 1) { // partly scrolled away: scroll it into view first
      let sp = null; for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) { sp = p; break; } }
      if (!sp) { if (c.w < Math.min(12, c.full.width * 0.6) || c.h < Math.min(12, c.full.height * 0.6)) continue; } // clipped on purpose (collapsed panel, off-screen slot)
      else {
      if (!scrolled.has(sp)) scrolled.set(sp, [sp.scrollLeft, sp.scrollTop]);
      e.scrollIntoView({ block: 'center', inline: 'center' }); c = clip(e);
      if (c.w < 6 || c.h < 6) continue; }
    }
    out.n++;
    const cx = (c.l + c.r) / 2, cy = (c.t + c.b) / 2;
    const pts = [[cx, cy], [cx - c.w * 0.3, cy], [cx + c.w * 0.3, cy], [cx, cy - c.h * 0.3], [cx, cy + c.h * 0.3]];
    let bad = null, covered = false;
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (owns(e, hit)) continue;
      if (hit && hit.closest(cover) && !e.closest(cover)) { covered = true; continue; } // a real overlay is open on top
      // a sticky / fixed bar of the same screen (the results footer) covers content scrolling under it by design
      const fix = (n) => { for (let p = n; p; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'sticky') return p; } return null; };
      if (hit && fix(hit) && fix(hit) !== fix(e)) { covered = true; continue; }
      const hs = hit ? getComputedStyle(hit) : null;
      bad = `${name(e)} at (${Math.round(x)},${Math.round(y)}) -> ${hit ? name(hit) + (hs && (+hs.opacity < 0.05 || hs.backgroundColor === 'rgba(0, 0, 0, 0)' && !hit.textContent.trim()) ? ' [invisible]' : '') : 'nothing'}`;
      break;
    }
    if (bad) { out.fail.push(bad); continue; }
    if (e.disabled || covered) continue;
    // hit size: how far from the centre the element still answers, along each axis (capped at 22px)
    const reach = (dx, dy) => { let d = 0; for (let k = 1; k <= 22; k++) { const x = cx + dx * k, y = cy + dy * k; if (x < 0 || y < 0 || x >= W || y >= H) return [d, 'edge'];
        const hit = document.elementFromPoint(x, y); if (owns(e, hit)) { d = k; continue; }
        if (hit && isTarget(hit)) return [d, 'next'];
        // a hairline gap (<= 4px) before the neighbour still counts as dense: the finger lands on one or the other
        for (let j = 1; j <= 4; j++) { const q = document.elementFromPoint(x + dx * j, y + dy * j); if (q && isTarget(q) && !owns(e, q)) return [d, 'next']; }
        return [d, 'gap']; } return [d, 'ok']; };
    const ax = [[reach(-1, 0), reach(1, 0)], [reach(0, -1), reach(0, 1)]];
    const msg = [];
    for (const [i, [a, b]] of ax.entries()) {
      const span = a[0] + b[0] + 1, dense = [a[1], b[1]].includes('next');
      if (span >= 43 || (dense && span >= 28)) continue; // 43: the probe steps whole pixels from a fractional centre
      msg.push(`${i ? 'tall' : 'wide'} ${span}px (${a[1]}/${b[1]})`);
    }
    if (msg.length) out.small.push(`${name(e)} ${Math.round(c.w)}x${Math.round(c.h)}: ${msg.join(', ')}`);
  }
  for (const [sp, [x, y]] of scrolled) { sp.scrollLeft = x; sp.scrollTop = y; }
  return out;
}"""


async def audit(pg, tag, state, scope, tot):
    if ONLY and state not in ONLY: return
    await pg.wait_for_timeout(120)
    res = await pg.evaluate(AUDIT, [COVER, scope])
    tot['n'] += res['n']; tot['fail'] += len(res['fail']); tot['small'] += len(res['small'])
    items = [('STOLEN ', x) for x in res['fail']] + [('SMALL  ', x) for x in res['small']]
    for _, x in items: tot['uniq'].add(re.sub(r' at \(.*| \d+x\d+: .*', '', x))  # one element, wherever it fails
    if items:
        print(f'  {tag} [{state}] {res["n"]} targets, {len(res["fail"])} stolen, {len(res["small"])} small', flush=True)
        for kind, x in items[: (999 if VERBOSE else 6)]: print('     ', kind, x)
        if len(items) > 6 and not VERBOSE: print(f'      ... {len(items) - 6} more')


async def run_hud(pg, tag, tot):
    await pg.evaluate(UA.SETUP)
    await pg.wait_for_timeout(1500)
    await pg.evaluate("app.prepReady()")
    await pg.wait_for_timeout(1500)
    await pg.evaluate("app.match.runner.speed = 30")
    await pg.wait_for_timeout(4000)
    await pg.evaluate("app.match.runner.speed = 0.0001")
    for state, js in UA.STATES:
        await pg.evaluate(UA.RESET); await pg.evaluate(UA.BASE)
        if js: await pg.evaluate(js)
        await pg.wait_for_timeout(450)
        await pg.evaluate(UA.SETTLE)
        await audit(pg, tag, 'hud:' + state, '#match', tot)
    await pg.evaluate(UA.RESET)
    await pg.evaluate("() => { app.match.runner.speed = 0; app.match.ended = true; app.teardownMatch && app.teardownMatch(app.match); app.match = null; app.session = null; app.menu(); }")


async def run_menus(pg, tag, tot, errs):
    for scr, js in SA.SCREENS:
        if os.environ.get('API') is None and (scr in ('club-mine', 'profile-friends') or scr.startswith('home-party') or scr == 'party-invite'): continue  # need the API worker
        try:
            await pg.evaluate(f"async () => {{ {SA.M} {js}; }}")
        except Exception as e:
            print(f'  {tag} {scr}: navigation failed: {str(e)[:120]}'); tot['nav'] += 1; continue
        await pg.wait_for_timeout(600)
        await pg.evaluate(UA.SETTLE)
        await audit(pg, tag, scr, 'body', tot)


async def main():
    tot = {'n': 0, 'fail': 0, 'small': 0, 'nav': 0, 'uniq': set()}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w, h, sl, sr, st, sb, name) in UA.parse(SPEC):
            mob = w < 1000
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=mob, is_mobile=mob, device_scale_factor=2 if mob else 1)
            await ctx.add_init_script(UA.PREFS)
            if os.environ.get('API') is not None: await ctx.add_init_script(f"localStorage.setItem('mobavs_api', {os.environ['API']!r})")
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(3000)
            await pg.evaluate(f"() => {{ const s = document.documentElement.style; s.setProperty('--safe-l', '{sl}px'); s.setProperty('--safe-r', '{sr}px'); s.setProperty('--safe-t', '{st}px'); s.setProperty('--safe-b', '{sb}px'); }}")
            tag = f'{w}x{h}' + (f' {name}' if name else '')
            before = dict(tot)
            if WHAT in ('hud', 'both'): await run_hud(pg, tag, tot)
            if WHAT in ('menus', 'both'): await run_menus(pg, tag, tot, errs)
            for e in errs[:3]: print(f'  {tag} JS error: {e[:200]}')
            tot['nav'] += len(errs)
            print(f"{tag}: {tot['fail'] - before['fail']} stolen, {tot['small'] - before['small']} small", flush=True)
            await ctx.close()
        await b.close()
    print(f"TOTAL: {tot['n']} target checks, {tot['fail']} stolen, {tot['small']} small, {tot['nav']} errors; {len(tot['uniq'])} distinct problems")
    sys.exit(1 if tot['fail'] or tot['small'] or tot['nav'] else 0)

asyncio.run(main())
