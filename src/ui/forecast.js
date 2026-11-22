// Fight forecast (v23): spots a fight that is about to happen, ~6-11s ahead, from what this coach can see.
// Pure read-only code on the live game (no DOM), so tools can measure it headless.
// Fog: enemy heroes count only while they are in this team's vision (g.vision[me]); their velocity is
// remembered only between two sightings. Unseen enemies are reported as "unseen", never placed.
// Hotspots: the Kami / Oni-Kraken pits while their boss is up (or wakes within 10s), plus the point where
// the two closest visible groups would meet.
import { TICK_RATE, OBJ_NAME } from '../sim/constants.js';
import { placeAt, placeText } from '../world/places.js';

export const FORECAST = { min: 5, max: 11, r: 320, need: 2 };

// mem: per-coach memory between samples ({ pos: Map(id → {x, y, t}) }). Returns null or
// { at: {x, y}, where, obj, eta, mine, theirs, unseen, edge } (edge = mine - theirs).
export function forecastFight(g, me, mem) {
  const now = g.tick, vis = g.vision[me], W = g.world;
  const pos = mem.pos || (mem.pos = new Map());
  const vel = new Map();
  const mine = g.teams[me].heroes.filter((x) => x.alive), foes = g.teams[1 - me].heroes.filter((x) => x.alive && vis.has(x.id));
  for (const x of [...mine, ...foes]) {
    // smoothed velocity between two sightings (heroes stop and start: one sample alone is noisy)
    const p = pos.get(x.id), dt = p ? (now - p.t) / TICK_RATE : 0;
    const v = p && dt > 0.3 && dt < 3 ? { x: (x.x - p.x) / dt, y: (x.y - p.y) / dt } : { x: 0, y: 0 };
    const sv = p && p.vx !== undefined && dt < 3 ? { x: p.vx * 0.4 + v.x * 0.6, y: p.vy * 0.4 + v.y * 0.6 } : v;
    vel.set(x.id, sv);
    pos.set(x.id, { x: x.x, y: x.y, t: now, vx: sv.x, vy: sv.y });
  }
  for (const id of [...pos.keys()]) { const u = g.byId(id); if (!u || !u.alive || (u.team !== me && !vis.has(id))) pos.delete(id); } // lose sight → forget
  const unseen = g.teams[1 - me].heroes.filter((x) => x.alive && !vis.has(x.id)).length;
  if (mine.length < FORECAST.need || foes.length < FORECAST.need) return null;
  // seconds until x is within `r` of point p, at its current speed toward p (Infinity if moving away / idle far)
  const eta = (x, p, r = FORECAST.r) => {
    const dx = p.x - x.x, dy = p.y - x.y, d = Math.hypot(dx, dy);
    if (d <= r) return 0;
    const v = vel.get(x.id), toward = (v.x * dx + v.y * dy) / d;
    return toward > 35 ? (d - r) / toward : Infinity;
  };
  const spots = [];
  if (W.pits) for (const [k, pit] of [['dragon', W.pits.kami], ['baron', W.pits.kraken]]) {
    if (!pit) continue;
    const kk = k === 'baron' && !(g.objectives.baron && g.objectives.baron.alive) && g.objectives.herald && g.objectives.herald.alive ? 'herald' : k;
    const o = g.objectives[kk], wake = g.objTimers[kk];
    if ((o && o.alive) || (wake && wake > now && wake - now < 10 * TICK_RATE)) spots.push({ x: pit.x, y: pit.y, obj: kk });
  }
  // the two groups' meeting point: centroids of my heroes and the visible enemies that are near each other
  const cen = (a) => ({ x: a.reduce((s, q) => s + q.x, 0) / a.length, y: a.reduce((s, q) => s + q.y, 0) / a.length });
  const ce = cen(foes), near = mine.filter((x) => Math.hypot(x.x - ce.x, x.y - ce.y) < 2200);
  if (near.length >= FORECAST.need) { const cm = cen(near); spots.push({ x: (cm.x + ce.x) / 2, y: (cm.y + ce.y) / 2, obj: null }); }
  let best = null;
  for (const s of spots) {
    const a = mine.map((x) => eta(x, s)).filter((t) => t <= FORECAST.max), b = foes.map((x) => eta(x, s)).filter((t) => t <= FORECAST.max);
    if (a.length < FORECAST.need || b.length < FORECAST.need) continue;
    // the fight starts when the second side arrives in numbers: the later of the two sides' 2nd arrival
    const ta = a.sort((p, q) => p - q)[FORECAST.need - 1], tb = b.sort((p, q) => p - q)[FORECAST.need - 1], t = Math.max(ta, tb);
    if (t < FORECAST.min || t > FORECAST.max) continue;
    // someone has to be on the way: two groups already standing in place are not a forecast
    if (a.every((q) => q === 0) && b.every((q) => q === 0)) continue;
    const sc = a.length + b.length + (s.obj ? 1.5 : 0);
    if (!best || sc > best.sc) best = { sc, s, t, a: a.length, b: b.length };
  }
  if (!best) return null;
  // named by the area the meeting point is in (src/world/places.js), an objective by its boss
  const s = best.s, pl = placeAt(W, s);
  const where = s.obj ? OBJ_NAME[s.obj] : pl.area === 'pit' || pl.area === 'arena' ? placeText(pl, { my: me, g }).name : placeText(pl, { my: me, g }).name.toLowerCase();
  return { at: { x: s.x, y: s.y }, where, obj: s.obj, lane: pl.area === 'lane' ? pl.lane : null, eta: Math.round(best.t), mine: best.a, theirs: best.b, unseen, edge: best.a - best.b };
}
