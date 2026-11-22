# In-match attention audit: plays full vs-AI matches in a real browser (fake clock, so a 15-minute match
# runs in a few minutes) and logs every player-facing message the HUD shows: decision-tray cards, banners,
# ticker lines, edge alerts, the kill feed, toasts and hero chatter bubbles. Then it reports, per game minute:
# prompts shown, how many messages are on screen at once, duplicates (the same news in two places), prompts
# that expire unseen, and the taps the simulated coach needed.
#   python3 tools/attention_audit.py URL [matches=2] [WxH@L/R/T/B=858x396@47/47/0/21] [--passive] [--json=out.json]
# The simulated coach reads a decision card for 2s, then taps its first usable option (--passive: never taps).
# Time is virtual: performance.now, Date.now, timers and requestAnimationFrame are replaced before the app loads
# and stepped in 33ms frames (30 fps), as fast as the CPU allows. CSS animations are switched off so what is on
# screen is measured at once. The map is drawn every 6th frame only (the HUD and the sim run every frame).
import sys, asyncio, json, time, re
from playwright.async_api import async_playwright

args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = {a.split('=')[0]: (a.split('=', 1)[1] if '=' in a else True) for a in sys.argv[1:] if a.startswith('--')}
URL = args[0] if args else 'http://127.0.0.1:8856/'
N = int(args[1]) if len(args) > 1 else 2
VP = args[2] if len(args) > 2 else '858x396@47/47/0/21'
wh, _, ins = VP.partition('@')
W, H = map(int, wh.split('x'))
SL, SR, ST, SB = (list(map(int, ins.split('/'))) + [0, 0, 0, 0])[:4] if ins else (0, 0, 0, 0)
PASSIVE = bool(flags.get('--passive'))
MAPS = ['sakura', 'frost', 'ember', 'marsh', 'oasis', 'ruins']

VCLOCK = """(() => {
  const vt = window.__vt = { now: 0, seq: 1, timers: new Map(), raf: [] }, base = Date.now(), RD = Date;
  performance.now = () => vt.now; Date.now = () => base + vt.now;
  window.setTimeout = (fn, ms = 0, ...a) => { const id = vt.seq++; vt.timers.set(id, { at: vt.now + Math.max(0, +ms || 0), fn, a }); return id; };
  window.setInterval = (fn, ms = 0, ...a) => { const id = vt.seq++; vt.timers.set(id, { at: vt.now + Math.max(1, +ms || 1), fn, a, every: Math.max(1, +ms || 1) }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { vt.timers.delete(id); };
  window.requestAnimationFrame = (fn) => { vt.raf.push(fn); return vt.seq++; };
  window.cancelAnimationFrame = () => {};
  const run = (f, ...a) => { try { typeof f === 'function' ? f(...a) : null; } catch (e) { (vt.errs = vt.errs || []).push(String(e && e.stack || e).slice(0, 300)); } };
  window.__advance = (ms, frame = 33) => {
    const end = vt.now + ms;
    while (vt.now < end) {
      vt.now = Math.min(end, vt.now + frame);
      for (let guard = 0; guard < 500; guard++) {
        let best = null, bid = 0; for (const [id, t] of vt.timers) if (t.at <= vt.now && (!best || t.at < best.at)) { best = t; bid = id; }
        if (!best) break;
        if (best.every) best.at += best.every; else vt.timers.delete(bid);
        run(best.fn, ...best.a);
      }
      const q = vt.raf; vt.raf = []; for (const f of q) run(f, vt.now);
    }
  };
})();"""
NOANIM = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }"

SETUP = """async (map) => {
  const st = await import('./src/ui/settings.js'); st.settings.quality = 'battery';
  app.startVsAI('classic', true);
  const s = app.session; if (map) { s.mapId = map; }
  const m = await import('./src/sim/draft.js');
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); }
  app.afterDraftAct();
}"""

# Instrumentation: wraps the HUD's message homes. Every record: { t: game seconds, w: wall ms, home, act, ... }.
INSTR = r"""async (passive) => {
  const H = app.match.hud, g = app.match.game, D = H.dock, T = D.tray, A = H.alerts, R = app.renderer;
  const { placeName } = await import('./src/ui/moments.js');
  const L = window.__att = { log: [], samples: [], taps: 0, tapsBy: {} };
  const now = () => performance.now(), gt = () => Math.round(g.time * 10) / 10;
  const rec = (o) => { o.t = gt(); o.w = Math.round(now()); L.log.push(o); return o; };
  const evTopic = () => (H.__inEv ? 'ev' + H.evIdx : null);
  const evType = () => (H.__inEv && g.events[H.evIdx] ? g.events[H.evIdx].type : null);
  // ── draw only every 6th frame (speed) ──
  const draw = R.draw.bind(R); let acc = 0, fr = 0;
  R.draw = (a, dt) => { acc += dt; if (++fr % 6) { R.time += dt; return; } draw(a, acc); acc = 0; };
  const mmDraw = app.minimap.draw.bind(app.minimap); let mf = 0; app.minimap.draw = () => { if (++mf % 6 === 0) mmDraw(); };
  // ── events: which sim event a message answers ──
  const pe = H.processEvents.bind(H); H.processEvents = () => { H.__inEv = true; try { pe(); } finally { H.__inEv = false; } };
  // ── ticker ──
  const tk = H.ticker.bind(H); H.ticker = (text, cls = 'n', prio = 1) => { const r = rec({ home: 'ticker', act: 'req', text, cls, prio, topic: evTopic(), ev: evType() }); H.__tkReq = r; return tk(text, cls, prio); };
  const stk = H.showTicker.bind(H); H.showTicker = (it) => { rec({ home: 'ticker', act: 'show', text: it.text, prio: it.prio }); return stk(it); };
  // ── banner ──
  const bn = H.banner.bind(H); H.banner = (text, color, ms, img, urgent, node) => {
    const t = text || (node ? [].concat(node).map((n) => (n && n.textContent) || '').join(' ').trim() : '');
    rec({ home: 'banner', act: 'req', text: t, topic: evTopic(), ev: evType() }); return bn(text, color, ms, img, urgent, node); };
  const nb = H.nextBanner.bind(H); H.nextBanner = () => { const n = H.bq && H.bq[0]; nb(); if (n) rec({ home: 'banner', act: 'show', text: n.text || (n.node ? [].concat(n.node).map((x) => (x && x.textContent) || '').join(' ').trim() : '') }); };
  // ── decision tray ──
  const tp = T.push.bind(T); T.push = (item) => {
    const r = tp(item);
    if (r) { r.__rec = rec({ home: 'tray', act: 'req', key: String(item.key || 'payoff'), prio: item.prio, cls: item.cls || '', at: item.__at || null }); }
    return r; };
  const tt = T.tick.bind(T); T.tick = () => { const before = T.cur; tt(); if (T.cur && T.cur !== before) { T.cur.__shownAt = now(); rec({ home: 'tray', act: 'show', key: String(T.cur.key || 'payoff'), prio: T.cur.prio, cls: T.cur.cls || '' }); } };
  const te = T.end.bind(T); T.end = (item, reason) => { if (T.items.includes(item)) rec({ home: 'tray', act: 'end', key: String(item.key || 'payoff'), reason, shown: !!item.shown, ms: item.__shownAt ? Math.round(now() - item.__shownAt) : 0, cls: item.cls || '' }); return te(item, reason); };
  // where a card is about (Coach's Call, fight forecast): world point
  const cc = D.coachCall.bind(D); D.coachCall = (m, hooks) => { const r = cc(m, hooks); if (r && r.__rec) { r.__rec.at = m.at ? { x: Math.round(m.at.x), y: Math.round(m.at.y) } : null; r.__rec.kind = m.kind; r.__rec.place = m.at ? placeName(g, m.at, H.my) : null; } return r; };
  if (H.depth) { const sf = H.depth.showForecast.bind(H.depth); H.depth.showForecast = (f) => { sf(f); const r = L.log.filter((x) => x.home === 'tray' && x.act === 'req').pop(); if (r) { r.at = { x: Math.round(f.at.x), y: Math.round(f.at.y) }; r.kind = 'forecast'; r.place = placeName(g, f.at, H.my); } }; }
  // ── edge alerts ──
  const live = new Map();
  const sy = A.sync.bind(A); A.sync = (list) => {
    const keys = new Set(list.map((a) => a.key));
    for (const a of list) if (!live.has(a.key)) live.set(a.key, rec({ home: 'edge', act: 'show', key: a.key, kind: a.kind, text: a.label, at: { x: Math.round(a.x), y: Math.round(a.y) }, place: placeName(g, a, H.my) }));
    for (const [k, r] of live) if (!keys.has(k)) { rec({ home: 'edge', act: 'end', key: k, kind: r.kind, ms: Math.round(now() - r.w) }); live.delete(k); }
    return sy(list); };
  // ── kill feed, toasts, chatter ──
  const kf = H.killfeed.bind(H); H.killfeed = (k, v, a) => { rec({ home: 'feed', act: 'show', text: (k ? k.def.name : 'Tower') + ' > ' + v.def.name, topic: evTopic() }); return kf(k, v, a); };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) rec({ home: 'toast', act: 'show', text: n.textContent }); }).observe(document.body, { childList: true });
  const say = R.chatter.say.bind(R.chatter); R.chatter.say = (u, kind, prio, extra) => { const ok = say(u, kind, prio, extra); if (ok) rec({ home: 'world', act: 'show', kind, text: R.chatter.bubbles[R.chatter.bubbles.length - 1].text, topic: evTopic() }); return ok; };
  // ── samples: what is on screen at once (every 500ms) ──
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1; };
  setInterval(() => {
    if (!app.match || app.match.game.over) return;
    const tray = [...document.querySelectorAll('#cmdbar .tray .titem')].filter(vis).length;
    const banner = [...document.querySelectorAll('#banner .big')].filter(vis).length;
    const ticker = vis(document.getElementById('ticker')) && document.querySelector('#ticker .tline') ? 1 : 0;
    const feed = [...document.querySelectorAll('#killfeed .kitem')].filter(vis).length;
    const edge = [...document.querySelectorAll('#alerts .alert')].filter((e) => !e.classList.contains('hidden') && vis(e)).length;
    const toast = [...document.querySelectorAll('.toast')].filter(vis).length;
    const world = R.chatter.bubbles.filter((b) => R.time - b.born < b.dur).length;
    L.samples.push({ t: gt(), tray, banner, ticker, feed, edge, toast, world, slow: app.match.runner.slow < 1 ? 1 : 0, hold: H.holding() ? 1 : 0 });
  }, 500);
  // ── simulated coach: reads a card for 2s, then taps its first usable option ──
  if (!passive) setInterval(() => {
    const it = T.cur; if (!it || !it.el || !it.__shownAt || now() - it.__shownAt < 2000) return;
    const b = [...it.el.querySelectorAll('button.tch')].find((x) => !x.disabled && !x.classList.contains('hidden'));
    if (!b) return;
    L.taps++; const k = String(it.key || '').replace(/[0-9:.]+/g, '') || 'item'; L.tapsBy[k] = (L.tapsBy[k] || 0) + 1;
    b.click();
  }, 250);
  // the AI coach behaviour for charges: when charges are full and nothing is offered, the coach spends one
  if (!passive) setInterval(() => {
    const t = g.teams[H.my]; if (g.over || t.charges < 3 || T.cur) return;
    const hot = D.callBtns.find((b) => b.classList.contains('hot') && !b.disabled);
    if (hot) { L.taps++; L.tapsBy.call = (L.tapsBy.call || 0) + 1; hot.click(); setTimeout(() => { const tile = document.querySelector('#cmdbar .sheet .tile.rec:not([disabled])') || document.querySelector('#cmdbar .sheet .tile:not([disabled])'); if (tile) { L.taps++; L.tapsBy.call++; tile.click(); } }, 300); }
  }, 4000);
}"""

async def run_match(b, i):
    ctx = await b.new_context(viewport={'width': W, 'height': H}, has_touch=True, is_mobile=False)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.add_init_script(VCLOCK)
    await pg.goto(URL)
    await pg.add_style_tag(content=NOANIM)
    adv = lambda ms: pg.evaluate(f"() => __advance({ms})")
    await adv(2500)
    await pg.evaluate(f"() => {{ const s = document.documentElement.style; s.setProperty('--safe-l', '{SL}px'); s.setProperty('--safe-r', '{SR}px'); s.setProperty('--safe-t', '{ST}px'); s.setProperty('--safe-b', '{SB}px'); }}")
    if flags.get('--v'): print('  setup', flush=True)
    await pg.evaluate(SETUP, MAPS[i % len(MAPS)])
    if flags.get('--v'): print('  drafted', flush=True)
    await adv(1500)
    await pg.evaluate("() => app.prepReady && app.prepReady()")
    for _ in range(40):
        await adv(500)
        if await pg.evaluate("() => !!(app.match && app.match.hud && app.match.hud.dock && app.match.hud.dock.tray)"): break
    if flags.get('--v'): print('  instrument', flush=True)
    await pg.evaluate(INSTR, PASSIVE)
    t0 = time.time()
    while True:
        await adv(5000)
        st = await pg.evaluate("() => app.match ? [app.match.game.time, app.match.game.over] : [0, true]")
        if flags.get('--v'): print(f'  t={st[0]:.0f}s real={time.time() - t0:.0f}s', flush=True)
        if st[1] or time.time() - t0 > 900: break
    data = await pg.evaluate("() => ({ log: __att.log, samples: __att.samples, taps: __att.taps, tapsBy: __att.tapsBy, time: app.match ? app.match.game.time : 0, map: app.match ? app.match.cfg.map : '' })")
    data['errors'] = errs + (await pg.evaluate('() => __vt.errs || []'))
    await ctx.close()
    print(f'match {i + 1}: {data["map"]} {data["time"] / 60:.1f} min, {len(data["log"])} records, {round(time.time() - t0)}s real', flush=True)
    return data

# ───────────── analysis ─────────────
def topic_of(r):
    k = r.get('key') or ''
    if r['home'] == 'tray':
        for pre, tp in [('fc', 'fight'), ('brew', 'fight'), ('caught', 'pick'), ('fight', 'pick'), ('contest', 'obj'), ('numbers', 'obj'), ('ejspot', 'obj'), ('wake', 'obj'), ('ej', 'obj'), ('gank', 'gank'), ('lo:', 'laneopen'), ('tower', 'tower'), ('shr', 'shrine'), ('surge', 'surge'), ('tal:', 'talent'), ('tip:', 'tip'), ('payoff', 'payoff'), ('split', 'split')]:
            if k.startswith(pre): return tp
        return 'other'
    if r['home'] == 'edge': return {'bigfight': 'fight', 'laneopen': 'laneopen', 'fight': 'skirmish', 'tower': 'tower', 'obj': 'obj'}.get(r.get('kind'), 'edge')
    return None

def analyse(ms):
    out = {}
    mins = sum(m['time'] for m in ms) / 60
    shows = [r for m in ms for r in m['log'] if r['act'] == 'show']
    reqs = [r for m in ms for r in m['log'] if r['act'] == 'req']
    by = {}
    for r in shows: by[r['home']] = by.get(r['home'], 0) + 1
    out['minutes'] = round(mins, 1)
    out['per_min'] = {k: round(v / mins, 2) for k, v in sorted(by.items())}
    decisions = [r for r in shows if r['home'] == 'tray' and topic_of(r) not in ('payoff', 'tip')]
    big_edges = [r for r in shows if r['home'] == 'edge' and r.get('kind') in ('bigfight', 'laneopen')]
    out['prompts_per_min'] = round((len(decisions) + len(big_edges)) / mins, 2)
    out['decision_cards_per_min'] = round(len(decisions) / mins, 2)
    kinds = {}
    for r in decisions: kinds[topic_of(r)] = kinds.get(topic_of(r), 0) + 1
    out['decision_mix_per_min'] = {k: round(v / mins, 2) for k, v in sorted(kinds.items(), key=lambda x: -x[1])}
    # on screen at once
    S = [s for m in ms for s in m['samples'] if not s['hold']]
    tot = [s['tray'] + s['banner'] + s['ticker'] + s['feed'] + s['edge'] + s['toast'] + s['world'] for s in S]
    tot_s = sorted(tot)
    out['onscreen_mean'] = round(sum(tot) / max(1, len(tot)), 2)
    out['onscreen_p95'] = tot_s[int(len(tot_s) * 0.95)] if tot_s else 0
    out['onscreen_max'] = max(tot) if tot else 0
    out['onscreen_ge5_pct'] = round(100 * sum(1 for x in tot if x >= 5) / max(1, len(tot)), 1)
    homes = ['tray', 'banner', 'ticker', 'feed', 'edge', 'toast', 'world']
    out['onscreen_by_home_mean'] = {h: round(sum(s[h] for s in S) / max(1, len(S)), 2) for h in homes}
    # during a Coach's Call slow-mo: everything else on screen
    sl = [s for s in S if s['slow']]
    out['during_slowmo_other_mean'] = round(sum(s['banner'] + s['ticker'] + s['feed'] + s['edge'] + s['toast'] + s['world'] for s in sl) / max(1, len(sl)), 2)
    out['card_and_banner_pct'] = round(100 * sum(1 for s in S if s['tray'] and s['banner']) / max(1, len(S)), 1)
    # duplicates: (a) one sim event told in 2+ homes (or twice), (b) the same fight / objective in 2+ prompts within a few seconds
    dup_ev = 0; ev_multi = 0
    for m in ms:
        groups = {}
        for r in m['log']:
            if r['act'] in ('req', 'show') and r.get('topic') and r['home'] in ('ticker', 'banner', 'feed'):
                if r['home'] == 'ticker' and r['act'] == 'show': continue
                if r['home'] == 'banner' and r['act'] == 'show': continue
                groups.setdefault(r['topic'], []).append(r)
        for k, g in groups.items():
            if len(g) > 1: dup_ev += len(g) - 1; ev_multi += 1
    out['event_dup_messages_per_min'] = round(dup_ev / mins, 2)
    out['events_told_twice_per_min'] = round(ev_multi / mins, 2)
    near = lambda a, b, d: a and b and (a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2 < d * d
    dup_p = 0; ex = []
    for m in ms:
        P = [r for r in m['log'] if r['act'] == 'show' and r['home'] in ('tray', 'edge') and topic_of(r) in ('fight', 'obj', 'pick', 'laneopen', 'gank')]
        for i, a in enumerate(P):
            for b2 in P[:i]:
                if a['t'] - b2['t'] > 12: continue
                ta, tb = topic_of(a), topic_of(b2)
                same = ta == tb and (near(a.get('at'), b2.get('at'), 900) or (ta == 'obj' and (a.get('key') or '')[-6:] == (b2.get('key') or '')[-6:]) or ta == 'laneopen')
                fightish = {ta, tb} <= {'fight', 'pick'} and near(a.get('at'), b2.get('at'), 900)
                if same or fightish:
                    dup_p += 1
                    if len(ex) < 8: ex.append(f"{b2['t']}s {b2['home']}:{b2.get('key') or b2.get('kind')} + {a['t']}s {a['home']}:{a.get('key') or a.get('kind')}")
                    break
    out['prompt_dups_per_min'] = round(dup_p / mins, 2)
    out['prompt_dup_examples'] = ex
    # expired unseen
    ends = [r for m in ms for r in m['log'] if r['home'] == 'tray' and r['act'] == 'end']
    never = [r for r in ends if not r['shown']]
    glimpse = [r for r in ends if r['shown'] and r['reason'] in ('expired', 'cleared') and r['ms'] < 1500 and topic_of(r) not in ('payoff',)]
    timeout = [r for r in ends if r['shown'] and r['reason'] == 'expired' and topic_of(r) not in ('payoff', 'tip')]
    out['tray_never_shown_per_min'] = round(len(never) / mins, 2)
    out['tray_glimpsed_lt1_5s_per_min'] = round(len(glimpse) / mins, 2)
    out['tray_expired_unanswered_per_min'] = round(len(timeout) / mins, 2)
    tkr = [r for r in reqs if r['home'] == 'ticker']; tks = [r for r in shows if r['home'] == 'ticker']
    out['ticker_lines_dropped_per_min'] = round(max(0, len(tkr) - len(tks)) / mins, 2)
    bnr = [r for r in reqs if r['home'] == 'banner']; bns = [r for r in shows if r['home'] == 'banner']
    out['banners_dropped_per_min'] = round(max(0, len(bnr) - len(bns)) / mins, 2)
    eends = [r for m in ms for r in m['log'] if r['home'] == 'edge' and r['act'] == 'end']
    out['edge_flicker_lt1_5s_per_min'] = round(sum(1 for r in eends if r['ms'] < 1500) / mins, 2)
    out['coach_taps_per_min'] = round(sum(m['taps'] for m in ms) / mins, 2)
    out['errors'] = sorted({e for m in ms for e in m['errors']})[:5]
    return out

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'])
        ms = []
        for i in range(N): ms.append(await run_match(b, i))
        await b.close()
    if flags.get('--json'):
        with open(flags['--json'], 'w') as f: json.dump(ms, f)
    res = analyse(ms)
    for k, v in res.items(): print(f'{k:34s} {v}')

if __name__ == '__main__':
    asyncio.run(main())
