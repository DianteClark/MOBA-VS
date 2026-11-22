// Prompt feasibility: the one place every coach prompt (tray suggestions, Coach's Calls, hero requests,
// the lane-open alert, fight prediction...) asks "can the player afford this, would the sim accept it,
// and can the heroes involved physically do it in time?". Read-only and DOM-free (tools/suggest_test.mjs
// runs it headless). Only uses what team `my` can see: enemy heroes count only while in its vision.
import { CMD, TICK_RATE, PERMIT, MOMENTUM } from '../sim/constants.js';
import { TACTICS } from '../data/tactics.js';
import { N, C } from '../sim/world.js';

// How long a moment stays worth acting on (seconds): a gank on an overextended laner, a carry caught out,
// a shrine capture, the heroes needed on an objective.
export const WINDOW = { gank: 12, caught: 9, shrine: 18, objective: 22, split: 25 };
// An unaffordable option may show greyed with a countdown only when a charge lands this soon (seconds).
export const SOON = 4;

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const costOf = (cmd) => (cmd ? CMD.cost[cmd.type] ?? 1 : 0);
export function affordable(g, my, cmd) { return !cmd || g.teams[my].charges + 1e-9 >= costOf(cmd); }
// Seconds until the team can pay for `cmd` (0 = now). Charges only ever grow on their own.
export function readyIn(g, my, cmd) { return Math.max(0, (costOf(cmd) - g.teams[my].charges) * CMD.regen); }
export const seen = (g, my, u) => !!u && u.alive && (u.team === my || g.vision[my].has(u.id));

// Why a hero can't take on a new job right now ('' = free). `solo`: a one-hero job (gank, split, a hero's
// own request) also needs the hero off other calls; a team call (objective, push, shrine) overrides them.
export function busy(g, h, solo = true) {
  if (!h || !h.alive) return 'dead';
  if (h.recallAt || h.task.kind === 'recall' || h.task.kind === 'heal') return 'recalling';
  if (solo && (h.pendingCall || (h.task.call && !(h.task.until <= g.tick)))) return 'on a call';
  return '';
}

// Walking distance along the nav grid. The grid never changes, so a distance field flooded out from a target
// (8-dir Dijkstra, no corner cutting, like the sim's A*) stays valid for the whole match: one flood answers
// every hero's distance to that spot. Targets share a field per 3x3-cell block (72px, under a second of walking);
// the 40 most recently used fields are kept (pits, shrines and towers stay warm).
const fields = new Map(); let fieldsOf = null;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
function field(g, p) {
  const W = g.world;
  if (fieldsOf !== W) { fields.clear(); fieldsOf = W; }
  const t = W.nearestOpen(p), cx = Math.min(N - 1, Math.max(0, Math.floor(t.x / C))), cy = Math.min(N - 1, Math.max(0, Math.floor(t.y / C)));
  const key = Math.floor(cy / 3) * N + Math.floor(cx / 3);
  let d = fields.get(key);
  if (d) { fields.delete(key); fields.set(key, d); return d; } // most recently used last
  d = new Float32Array(N * N).fill(Infinity);
  const walk = W.walk, start = cy * N + cx, heap = [];
  const push = (v) => { heap.push(v); let k = heap.length - 1; while (k > 0) { const q = (k - 1) >> 1; if (heap[q] <= v) break; heap[k] = heap[q]; k = q; } heap[k] = v; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k, mv = last; if (l < heap.length && heap[l] < mv) { m = l; mv = heap[l]; } if (r < heap.length && heap[r] < mv) m = r; if (m === k) break; heap[k] = heap[m]; k = m; } heap[k] = last; } return top; };
  d[start] = 0; push(start);
  const SH = 16384; // heap value = dist * SH + cell
  while (heap.length) {
    const v = pop(), cur = v % SH, dc = (v - cur) / SH;
    if (dc > d[cur]) continue;
    const x = cur % N, y = (cur / N) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx; if (!walk[ni]) continue;
      if (DX[k] && DY[k] && (!walk[y * N + nx] || !walk[ny * N + x])) continue;
      const nd = dc + (DX[k] && DY[k] ? 14 : 10);
      if (nd < d[ni]) { d[ni] = nd; push(nd * SH + ni); }
    }
  }
  for (let i = 0; i < d.length; i++) d[i] *= C / 10;
  fields.set(key, d);
  if (fields.size > 40) fields.delete(fields.keys().next().value);
  return d;
}
function pathLen(g, a, b) {
  const s = g.world.nearestOpen(a), L = field(g, b)[g.world.idx(s.x, s.y)];
  return L + Math.sqrt(d2(s, a)); // (an unreachable spot stays Infinity)
}
// Seconds for hero `h` to reach point `p`: walking time at its current base speed plus the trust delay
// before it obeys a call (the same delay the sim's setCallTask applies). Dead heroes: Infinity.
export function eta(g, h, p) {
  if (!h || !h.alive) return Infinity;
  const ms = Math.max(1, h.stats.ms * (g.wx ? g.wx.ms : 1) * g.rules.heroMs);
  const base = h.trust >= 70 ? 0 : h.trust >= 45 ? 6 : h.trust >= 25 ? 20 : 34;
  return pathLen(g, h, p) / ms + Math.round(base * ((h.pers && h.pers.delay) || 1)) / TICK_RATE;
}
// Our free heroes sorted by arrival time at `p`: [{ hero, t }].
export function arrivals(g, my, p, filter, solo = true) {
  return g.teams[my].heroes.filter((h) => !busy(g, h, solo) && (!filter || filter(h))).map((h) => ({ hero: h, t: eta(g, h, p) })).sort((a, b) => a.t - b.t);
}
// Time for the n-th fastest hero to answer a team call at `p` (Infinity if fewer than n can).
export function teamEta(g, my, p, n) { const a = arrivals(g, my, p, null, false); return a.length >= n ? a[n - 1].t : Infinity; }

// The hero to send on a gank at point `p` in `lane` within `window` seconds: our jungler when it makes it,
// else the quickest free roamer (mid / support) who isn't already laning there. null = nobody can.
export function bestGanker(g, my, p, lane, window = WINDOW.gank, own) {
  const ok = (h) => (!own || own(h)) && !(h.role !== 'jungle' && h.lane === lane);
  const a = arrivals(g, my, p, ok).filter((x) => x.t <= window);
  const jg = a.find((x) => x.hero.role === 'jungle');
  return jg || a.find((x) => x.hero.role === 'mid' || x.hero.role === 'support') || null;
}

// Objective kill-time estimate from the HP we watched it lose (seconds left; Infinity while untouched).
const hpLog = new WeakMap();
export function objTimeLeft(g, o) {
  if (!o || !o.alive) return 0;
  let s = hpLog.get(o);
  if (!s || o.hp > s.hp + 1) { s = { hp: o.hp, t: g.tick, rate: 0 }; hpLog.set(o, s); }
  const dt = (g.tick - s.t) / TICK_RATE;
  if (dt >= 1.5) { const r = (s.hp - o.hp) / dt; s.rate = s.rate ? s.rate * 0.5 + r * 0.5 : r; s.hp = o.hp; s.t = g.tick; }
  if (o.hp >= o.maxHp) return Infinity;
  const rate = s.rate > 1 ? s.rate : o.maxHp / 30; // no reading yet: assume a ~30s take
  return o.hp / rate;
}

// Would the sim accept `cmd` from team `my` right now? (Mirrors Game.applyCommand's refusals, plus
// "don't send a dead hero" / "don't target what we can't see".)
export function accepted(g, my, cmd) {
  if (!cmd) return true;
  const team = g.teams[my], now = g.tick, alive = team.heroes.filter((h) => h.alive), lanes = g.world.laneNames;
  const hero = cmd.hero !== undefined ? team.heroes.find((h) => h.id === cmd.hero) : null;
  switch (cmd.type) {
    case 'gank': { const x = hero || team.heroes.find((h) => h.role === 'jungle'); return !!x && x.alive && lanes.includes(cmd.lane); } // no hero: the sim sends the jungler
    case 'objective': return g.objAvailable(cmd.obj) && alive.length > 0;
    case 'shrine': return g.time >= g.T.shrineUnlock && g.shrines.some((s) => s.owner !== my) && alive.length > 0;
    case 'group': return lanes.includes(cmd.lane) && alive.length > 0;
    case 'split': return !!hero && hero.alive && lanes.includes(cmd.lane);
    case 'focus': return seen(g, my, g.byId(cmd.target));
    case 'safe': case 'reset': return alive.length > 0;
    case 'invade': { const jg = team.heroes.find((h) => h.role === 'jungle'); return !!jg && jg.alive && g.camps.some((c) => c.side !== my && c.mobs.length); }
    case 'herald': return team.heraldEye > now && lanes.includes(cmd.lane);
    case 'permit': {
      if (!hero || !hero.alive || team.permitCd > now) return false;
      if (cmd.kind === 'split') return lanes.includes(cmd.lane);
      const t = g.byId(cmd.target); return seen(g, my, t) && d2(t, hero) <= PERMIT.range * PERMIT.range;
    }
    case 'surge': return team.momentum >= MOMENTUM.max && !(team.surgeUntil > now) && alive.length > 0;
    case 'tactic': return !!TACTICS[cmd.card] && team.deck.some((d) => d.id === cmd.card && !d.used);
    default: return true;
  }
}
// The one gate: the player can pay for it AND the sim would take it. A prompt whose tap would just fail never shows.
export function canIssue(g, my, cmd) { return affordable(g, my, cmd) && accepted(g, my, cmd); }

// Lane-open alert action: send the hero the lane brain picked (a split call), if that's a real option now.
export function laneOpenSend(g, my, lane, o) {
  const x = o && g.byId(o.hero);
  if (!x || x.team !== my || busy(g, x) || eta(g, x, g.byId(o.tower) || x) > WINDOW.split) return null;
  const cmd = { type: 'split', hero: x.id, lane };
  return canIssue(g, my, cmd) ? { hero: x, cmd } : null;
}
