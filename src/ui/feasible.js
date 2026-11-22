// Prompt feasibility: the one place every coach prompt (tray suggestions, Coach's Calls, hero requests,
// the lane-open alert, fight prediction...) asks "can the player afford this, would the sim accept it,
// and can the heroes involved physically do it in time?". Read-only and DOM-free (tools/suggest_test.mjs
// runs it headless). Only uses what team `my` can see: enemy heroes count only while in its vision.
import { CMD, TICK_RATE, PERMIT, MOMENTUM } from '../sim/constants.js';
import { TACTICS } from '../data/tactics.js';

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

// Walking distance along the nav grid (A* polyline), cached per cell pair for one second of game time.
let cache = new Map(), cacheAt = -1, cacheG = null;
export function pathLen(g, a, b) {
  const W = g.world, sec = Math.floor(g.tick / TICK_RATE);
  if (cacheG !== g || sec !== cacheAt) { cache = new Map(); cacheAt = sec; cacheG = g; }
  const k = W.idx(a.x, a.y) * 100003 + W.idx(b.x, b.y);
  let L = cache.get(k);
  if (L === undefined) {
    const p = W.findPath(a.x, a.y, b.x, b.y); L = 0; let x = a.x, y = a.y;
    for (const q of p) { L += Math.sqrt((q.x - x) ** 2 + (q.y - y) ** 2); x = q.x; y = q.y; }
    cache.set(k, L);
  }
  return L;
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
    case 'gank': return !!hero && hero.alive && lanes.includes(cmd.lane);
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
