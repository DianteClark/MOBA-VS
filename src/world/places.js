// Places: the ONE answer to "where is this?" for every alert, forecast, Coach's Call, ticker line,
// minimap ping and analytics label. Read-only on a built World (src/sim/world.js): every area derives
// from the map def (lane paths, river, pits, shrines, camps, bases, structures), so it is right on every
// classic map and both Lane Rush maps, and follows any map revamp automatically.
//
//   placeAt(world, p)            → a place: { key, area, lane, team, tier, side, camp }
//   placeText(place, opts)       → { short, name, tag, detail, where } words for it (opts: { my, g })
//   placeName(world, p, opts)    → shorthand: placeText(placeAt(world, p), opts)
//   towerName(world, structure)  → "top outer tower", "mid gate" (ticker lines)
//   fightClusters(g, see)        → live fights: [{ x, y, r, n, ids }] (centroid of the heroes in it)
//   followFight(cam, g, ids, see, dt) → eases a camera onto that fight as it moves (the fight cam)
//
// Keys are stable strings (analytics records store them): 'kami', 'kraken', 'base0', 'shrine1', 'top',
// 'top.0.1' (top lane by Blue's outer tower; .2 inner, .3 base tower, .4 gate), 'river.top', 'jungle0.bot', 'jungle1.top.wolf'.
import { S, T_RIVER } from '../sim/world.js';
import { TICK_RATE } from '../sim/constants.js';

export const PLACE_R = {
  pit: 185,     // the pit floor is carved at 150: a hero standing on its rim still counts
  shrine: 130,  // shrine pad 96
  camp: 175,    // camp clearing 104
  arena: 220,   // the World Boss (Tengu) landing spot in the map centre
  tower: 300,   // "by X tower": within this many units of it along the lane
  laneExtra: 60, // a hero this far beyond the lane's carved half-width is still "in lane"
  bank: 34,     // river banks count as river
};
const TIER_W = { 1: 'outer tower', 2: 'inner tower', 3: 'base tower', 4: 'gate' };
const CAMP_W = { bluebuff: 'Sentinel', redbuff: 'Brambleback', wolf: 'Wolves', raptor: 'Raptors', gromp: 'Gromp', krug: 'Krugs' };
const LANE_W = { top: 'top', mid: 'mid', bot: 'bot' };
const TEAM_W = ['Blue', 'Red'];
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Per-world cache of the static bits (structure progress along each lane).
const CACHE = new WeakMap();
function info(W) {
  let c = CACHE.get(W);
  if (c) return c;
  c = { towers: {} };
  for (const ln of W.laneNames) {
    const len = W.laneLen[ln][W.laneLen[ln].length - 1];
    // rank: 1 outer, 2 inner, 3 base tower (counted from the owner's far end, so a Lane Rush lane with only
    // two towers before its gate reads the same), 4 the gate (inhibitor)
    const list = [];
    for (let t = 0; t < 2; t++) {
      const own = W.structures.filter((s) => s.lane === ln && s.team === t && (s.kind === 'tower' || s.kind === 'inhib'))
        .map((s) => ({ team: t, x: s.x, y: s.y, gate: s.kind === 'inhib', at: W.laneProgress(ln, s) * len }));
      own.filter((s) => !s.gate).sort((a, b) => (t === 0 ? b.at - a.at : a.at - b.at)).forEach((s, i) => { s.tier = Math.min(3, i + 1); });
      for (const s of own) { if (s.gate) s.tier = 4; list.push(s); }
    }
    c.towers[ln] = list;
  }
  CACHE.set(W, c);
  return c;
}
// Which side of a polyline p is on (sign of the cross product with its nearest segment).
function sideOf(pts, p) {
  let best = Infinity, s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby || 1;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + abx * t, qy = a.y + aby * t, dd = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (dd < best) { best = dd; s = abx * (p.y - a.y) - aby * (p.x - a.x); }
  }
  return s >= 0 ? 1 : -1;
}
function polyDist(pts, p) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby || 1;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, (p.x - a.x - abx * t) ** 2 + (p.y - a.y - aby * t) ** 2);
  }
  return Math.sqrt(best);
}
// 'top' / 'bot' half of the map for river and jungle points: the side of mid lane the top lane is on.
function halfOf(W, p) {
  const mid = W.lanes.mid, ref = W.pits.kraken; // the Kraken pit is on the top side on every map
  return sideOf(mid, p) === sideOf(mid, ref) ? 'top' : 'bot';
}

// The named area a world point is in.
// g (optional, the live game): the World Boss arena only counts while the boss is up or about to land.
export function placeAt(W, p, g) {
  const d = W.def;
  // 1) objective pits, only inside the pit itself
  for (const k of ['kami', 'kraken']) if (W.pits[k] && d2(W.pits[k], p) <= PLACE_R.pit ** 2) return { key: k, area: 'pit', pit: k };
  // 2) the World Boss arena (Living World: the Tengu's landing spot), while the boss is up or due
  const ar = g && g.living && g.living.bossSpot, bo = g && g.objectives.boss, wake = g && g.objTimers.boss;
  if (ar && ((bo && bo.alive) || (wake && wake - g.tick < 30 * TICK_RATE)) && d2(ar, p) <= PLACE_R.arena ** 2) return { key: 'arena', area: 'arena' };
  // 3) bases (the carved base disc around the Crystal, plus the fountain)
  const baseR = d.baseR || 360;
  for (let t = 0; t < 2; t++) if (d2(W.baseCenter[t], p) <= baseR ** 2 || d2(W.fountain[t], p) <= 150 ** 2) return { key: 'base' + t, area: 'base', team: t };
  // 4) shrines
  for (let t = 0; t < W.shrines.length; t++) if (d2(W.shrines[t], p) <= PLACE_R.shrine ** 2) return { key: 'shrine' + t, area: 'shrine', team: t };
  // 5) lanes: within the carved lane (plus a margin), split by the tower zone along it
  const laneW = (d.laneW || 64) + PLACE_R.laneExtra;
  let lane = null, ld = Infinity;
  for (const ln of W.laneNames) { const dd = W.distToLane(ln, p); if (dd < ld) { ld = dd; lane = ln; } }
  if (lane && ld <= laneW) {
    const len = W.laneLen[lane][W.laneLen[lane].length - 1], at = W.laneProgress(lane, p) * len;
    let tw = null, td = PLACE_R.tower;
    for (const s of info(W).towers[lane]) { const dd = Math.abs(s.at - at); if (dd < td) { td = dd; tw = s; } }
    const one = d.single ? { single: true } : {}; // Lane Rush: the one lane is just "the lane"
    return tw ? { key: `${lane}.${tw.team}.${tw.tier}`, area: 'lane', lane, team: tw.team, tier: tw.tier, at: { x: tw.x, y: tw.y }, ...one } : { key: lane, area: 'lane', lane, ...one };
  }
  // 6) the river (and its banks; a central lake counts too)
  const t = W.type[W.idx(p.x, p.y)];
  const riverW = d.riverW || 60;
  const side = d.single ? null : halfOf(W, p);
  if (t === T_RIVER || polyDist(W.river, p) <= riverW + PLACE_R.bank || (d.lake && Math.hypot(p.x - S / 2, p.y - S / 2) <= d.lake + PLACE_R.bank)) {
    return { key: side ? 'river.' + side : 'river', area: 'river', side };
  }
  // 7) jungle: whose half (side of the river), which quadrant (side of mid), and the camp if at one
  const team = sideOf(W.river, p) === sideOf(W.river, W.fountain[0]) ? 0 : 1;
  let camp = null, cd = PLACE_R.camp ** 2;
  for (const c of W.camps) { const dd = d2(c, p); if (dd < cd) { cd = dd; camp = c; } }
  const q = side ? '.' + side : '';
  if (camp) return { key: `jungle${camp.side}${q}.${camp.kind}`, area: 'jungle', team: camp.side, side, camp: camp.kind };
  return { key: `jungle${team}${q}`, area: 'jungle', team, side };
}

// "top outer tower", "mid gate", "base tower" for a structure (x, y, lane), ranked as placeAt ranks them.
export function towerName(W, s) {
  const t = (info(W).towers[s.lane] || []).find((q) => q.x === s.x && q.y === s.y);
  if (!t) return 'base tower';
  return W.def.single ? TIER_W[t.tier] : `${LANE_W[s.lane]} ${TIER_W[t.tier]}`;
}

// Parse a stored key back into a place (analytics records keep only the key).
export function placeFromKey(key) {
  if (key === 'kami' || key === 'kraken') return { key, area: 'pit', pit: key };
  if (key === 'arena') return { key, area: 'arena' };
  let m;
  if ((m = /^base([01])$/.exec(key))) return { key, area: 'base', team: +m[1] };
  if ((m = /^shrine([01])$/.exec(key))) return { key, area: 'shrine', team: +m[1] };
  if ((m = /^(top|mid|bot)(?:\.([01])\.([1-4]))?$/.exec(key))) return m[2] ? { key, area: 'lane', lane: m[1], team: +m[2], tier: +m[3] } : { key, area: 'lane', lane: m[1] };
  if ((m = /^river(?:\.(top|bot))?$/.exec(key))) return { key, area: 'river', side: m[1] || null };
  if ((m = /^jungle([01])(?:\.(top|bot))?(?:\.(\w+))?$/.exec(key))) return { key, area: 'jungle', team: +m[1], side: m[2] || null, camp: m[3] || null };
  if (key === 'jungle') return { key, area: 'jungle', team: -1, side: null }; // records from before v24
  return null;
}

// Words for a place. opts.my: the coach's team (0/1) for "your"/"enemy"; -1 / undefined: Blue/Red.
// opts.g: the live game (the Kraken pit is the Oni's while the Oni is around).
//   short  "KAMI", "TOP LANE", "YOUR JUNGLE", "ENEMY BASE", "BOT RIVER" (alert titles: upper case, short)
//   name   the same in sentence case: "Kami", "Top lane", "Your jungle" (tray titles)
//   tag    one word: "Kami", "Top", "River", "Jungle", "Base" (hero rows)
//   detail "by your outer tower", "at their Wolves", "top side" ('' when nothing to add)
//   where  a phrase with its preposition: "at the Kami pit", "in top lane by your outer tower",
//          "in your top jungle", "at their Wolves camp", "in the Blue base"
export function placeText(pl, opts = {}) {
  const my = opts.my === 0 || opts.my === 1 ? opts.my : -1, g = opts.g;
  const own = (t) => (my < 0 ? TEAM_W[t] : t === my ? 'your' : 'enemy');
  const poss = (t) => (my < 0 ? TEAM_W[t] + '\'s' : t === my ? 'your' : 'their');
  const the = (t, w) => (my < 0 ? `the ${TEAM_W[t]} ${w}` : `${own(t)} ${w}`);
  const mk = (name, tag, detail, where) => ({ short: name.toUpperCase(), name: name[0].toUpperCase() + name.slice(1), tag, detail, where });
  switch (pl && pl.area) {
    case 'pit': {
      const oni = pl.pit === 'kraken' && g && g.T && g.time < g.T.heraldDespawn && !g.objectives.baron;
      const n = pl.pit === 'kami' ? 'Kami' : oni ? 'Oni' : 'Kraken';
      return mk(n, n, 'pit', `at the ${n} pit`);
    }
    case 'arena': return mk('Tengu', 'Tengu', 'World Boss', 'at the Tengu');
    case 'base': return mk(`${own(pl.team)} base`, 'Base', '', `in ${the(pl.team, 'base')}`);
    case 'shrine': return mk(`${own(pl.team)} shrine`, 'Shrine', '', `at ${the(pl.team, 'shrine')}`);
    case 'lane': {
      const ln = LANE_W[pl.lane] || pl.lane, detail = pl.tier ? `by ${poss(pl.team)} ${TIER_W[pl.tier]}` : '';
      if (pl.single) return mk('the lane', 'Lane', detail, `in the lane${detail ? ' ' + detail : ''}`);
      return mk(`${ln} lane`, ln[0].toUpperCase() + ln.slice(1), detail, `in ${ln} lane${detail ? ' ' + detail : ''}`);
    }
    case 'river': return mk(pl.side ? `${pl.side} river` : 'river', 'River', '', pl.side ? `in the ${pl.side} river` : 'in the river');
    case 'jungle': {
      if (!(pl.team >= 0)) return mk('jungle', 'Jungle', '', 'in the jungle');
      const camp = pl.camp ? CAMP_W[pl.camp] || pl.camp : '';
      const detail = camp ? `at ${poss(pl.team)} ${camp}` : pl.side ? `${pl.side} side` : '';
      const where = camp ? `at ${poss(pl.team)} ${camp} camp` : `in ${the(pl.team, (pl.side ? pl.side + ' ' : '') + 'jungle')}`;
      return mk(`${own(pl.team)} jungle`, 'Jungle', detail, where);
    }
  }
  return mk('map', 'Map', '', 'on the map');
}
export const placeName = (W, p, opts = {}) => placeText(placeAt(W, p, opts.g), opts);

// ───────────── live fights ─────────────
// A fight: heroes that traded hero damage in the last `sec` seconds, linked when within LINK of each
// other (single linkage, so a fight strung along a lane stays one fight). see(x): whether this viewer can
// see x (fog); omit for everyone. Each fight: centroid (x, y), radius r (furthest member from the
// centroid), n heroes, both teams' counts, and the hero ids (the fight cam tracks them).
export const FIGHT = { link: 560, sec: 2, minR: 260 };
export function fightClusters(g, see, sec = FIGHT.sec) {
  const now = g.tick, win = sec * TICK_RATE;
  const xs = [];
  for (const t of g.teams) for (const x of t.heroes) {
    if (!x.alive || !(now - x.lastHitHero < win || now - x.lastHurtByHero < win)) continue;
    if (see && !see(x)) continue;
    xs.push(x);
  }
  const grp = xs.map((_, i) => i);
  const root = (i) => { while (grp[i] !== i) i = grp[i] = grp[grp[i]]; return i; };
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (d2(xs[i], xs[j]) < FIGHT.link ** 2) { const a = root(i), b = root(j); if (a !== b) grp[Math.max(a, b)] = Math.min(a, b); }
  const by = new Map();
  for (let i = 0; i < xs.length; i++) { const k = root(i); (by.get(k) || by.set(k, []).get(k)).push(xs[i]); }
  const out = [];
  for (const hs of by.values()) {
    const x = hs.reduce((s, q) => s + q.x, 0) / hs.length, y = hs.reduce((s, q) => s + q.y, 0) / hs.length;
    const r = Math.max(FIGHT.minR, ...hs.map((q) => Math.sqrt(d2(q, { x, y }))));
    out.push({ x, y, r, n: hs.length, teams: [hs.filter((q) => q.team === 0).length, hs.filter((q) => q.team === 1).length], ids: hs.map((q) => q.id), heroes: hs });
  }
  return out.sort((a, b) => b.n - a.n || a.ids[0] - b.ids[0]);
}
// One fight-cam step: ease `cam` ({x, y}) toward the fight as it is now: the live fight that shares the
// most heroes with `ids` (heroes join and leave; a hero who runs off no longer drags the camera away).
// Returns { x, y, r, ids } (keep the new ids for the next step), or null once that fight is over.
export function followFight(cam, g, ids, see, dt) {
  let best = null, bn = 0;
  for (const f of fightClusters(g, see)) { const n = f.ids.filter((id) => ids.includes(id)).length; if (n > bn) { bn = n; best = f; } }
  if (!best) return null;
  const k = Math.min(1, dt * 4);
  cam.x += (best.x - cam.x) * k; cam.y += (best.y - cam.y) * k;
  return { x: best.x, y: best.y, r: best.r, ids: best.ids };
}

// Where a lane call happens: the point on `lane` where `team`'s wave meets the enemy's (no wave: just in
// front of its furthest tower). Minimap pings for gank / push / split calls go here, not to mid-lane.
export function laneFront(g, team, lane) {
  const W = g.world, prog = (u) => { const p = W.laneProgress(lane, u); return team === 0 ? p : 1 - p; };
  let mine = -1, foe = 2, tower = 0.1;
  for (const u of g.units) {
    if (!u.alive || u.lane !== lane) continue;
    if (u.type === 'minion' || u.type === 'summon') { const p = prog(u); if (u.team === team) mine = Math.max(mine, p); else if (u.team === 1 - team) foe = Math.min(foe, p); }
    else if (u.type === 'tower' && u.team === team) tower = Math.max(tower, prog(u));
  }
  const at = mine >= 0 && foe < 2 ? (mine + foe) / 2 : mine >= 0 ? mine : foe < 2 ? Math.max(tower, foe - 0.03) : tower + 0.03;
  return W.lanePoint(lane, team === 0 ? at : 1 - at);
}
