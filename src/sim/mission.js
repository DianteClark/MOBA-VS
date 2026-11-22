// Story campaign and tutorial mission rules (cfg.mission). Plain data in the match config, read by the deterministic
// sim, so lockstep, replays and the Theater reproduce a mission exactly. A match without cfg.mission is bit-identical
// to one from before this file existed (every hook in game.js is gated on it).
//   kami     [s, ...]   base Kami wake times on Living World maps (at most 3; later ones as usual after a kill)
//   elder    s          the Elder Kami lands (Living World maps)
//   oni      s          the Oni wakes          oniEnd  s   the Oni leaves (its despawn time)
//   kraken   s          the Kraken wakes (once no Oni is up)
//   scout    s          scout pets are free from
//   len      s          match length (when the clock runs out, towers decide as usual)
//   mods     [[team, role | 'all', hp, dmg], ...]   stat edges for a story twist (fractions, at most +-0.5)
//   gold     [blue, red]  starting gold added (or taken, down to 0)
//   charges  blue's starting command charges
//   script   [[s, team, command], ...]  scripted calls the story needs (the tutorial's Kami fight): issued for that
//            team at second s, free of charges. Only plain team calls (objective, group, gank, reset, safe).
// The goals and stars of a mission are read from the finished game by src/data/campaign.js (never here).
import { sec, CMD } from './constants.js';

const ROLE_KEYS = ['all', 'top', 'jungle', 'mid', 'bot', 'support'];
const LANES = ['top', 'mid', 'bot'];
const OBJS = ['dragon', 'herald', 'baron', 'boss'];
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

// One scripted command, sanitized (null when not allowed).
function cleanCmd(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.type === 'objective' && OBJS.includes(c.obj)) return { type: 'objective', obj: c.obj };
  if ((c.type === 'group' || c.type === 'gank') && LANES.includes(c.lane)) return { type: c.type, lane: c.lane };
  if (c.type === 'reset' || c.type === 'safe') return { type: c.type };
  return null;
}

// Sanitize a mission rule set (from a stored replay, a share link or the campaign data). Returns null when empty.
export function cleanMission(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  if (Array.isArray(m.kami)) { const k = m.kami.map((x) => num(x, 20, 640)).filter((x) => x !== null).slice(0, 3); if (k.length) out.kami = k; }
  for (const [k, lo, hi] of [['elder', 60, 900], ['oni', 30, 440], ['oniEnd', 60, 900], ['kraken', 60, 900], ['scout', 0, 600], ['len', 180, 900]]) { const v = num(m[k], lo, hi); if (v !== null) out[k] = v; }
  const ch = num(m.charges, 0, CMD.maxCharges); if (ch !== null) out.charges = ch;
  if (Array.isArray(m.mods)) {
    const mods = m.mods.filter((x) => Array.isArray(x) && (x[0] === 0 || x[0] === 1) && ROLE_KEYS.includes(x[1])).slice(0, 10)
      .map((x) => [x[0], x[1], num(x[2], -0.5, 0.5) || 0, num(x[3], -0.5, 0.5) || 0]);
    if (mods.length) out.mods = mods;
  }
  if (Array.isArray(m.gold) && m.gold.some((x) => num(x, -500, 2000))) out.gold = [num(m.gold[0], -500, 2000) || 0, num(m.gold[1], -500, 2000) || 0];
  if (Array.isArray(m.script)) {
    const sc = m.script.filter((x) => Array.isArray(x) && num(x[0], 0, 900) !== null && (x[1] === 0 || x[1] === 1) && cleanCmd(x[2])).slice(0, 24)
      .map((x) => [num(x[0], 0, 900), x[1], cleanCmd(x[2])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (sc.length) out.script = sc;
  }
  return Object.keys(out).length ? out : null;
}

// Game constructor (after the heroes, Bosses & Beasts and the coaches exist).
export function setupMission(g) {
  const m = cleanMission(g.cfg.mission);
  g.mission = m ? { ...m, si: 0 } : null;
  if (!m) return;
  if (m.len) g.rules = { ...g.rules, seconds: m.len }; // a copy: the shared rule tables never change
  const B = g.beasts;
  if (m.kami && B && B.full) { B.at = m.kami.slice(); g.objTimers.dragon = sec(m.kami[0]); }
  if (m.elder && B && B.full) g.objTimers.boss = sec(m.elder);
  if (m.oni) g.objTimers.herald = sec(m.oni);
  if (m.oniEnd) g.T = { ...g.T, heraldDespawn: m.oniEnd }; // a copy (the shared timing table never changes)
  if (m.kraken) g.objTimers.baron = sec(m.kraken);
  if (m.scout !== undefined && B) for (const t of g.teams) t.scoutCd = sec(m.scout);
  if (m.charges !== undefined) g.teams[0].charges = m.charges;
  for (const [t, role, hp, dmg] of m.mods || []) for (const h of g.teams[t].heroes) {
    if (role !== 'all' && h.role !== role) continue;
    const o = h.mmod || [0, 0]; h.mmod = [o[0] + hp, o[1] + dmg];
    g.recalc(h); h.hp = h.maxHp;
  }
  if (m.gold) for (let t = 0; t < 2; t++) if (m.gold[t]) for (const h of g.teams[t].heroes) h.gold = Math.max(0, h.gold + m.gold[t]);
}

// Every tick (after the AI coaches): the story's scripted calls.
export function missionTick(g) {
  const m = g.mission, sc = m.script; if (!sc) return;
  while (m.si < sc.length && sec(sc[m.si][0]) <= g.tick) {
    const [, team, c] = sc[m.si++], tm = g.teams[team], before = tm.charges, cost = CMD.cost[c.type] ?? 1;
    tm.charges = Math.max(tm.charges, cost);
    g.applyCommand({ ...c, team, seq: 0 });
    tm.charges = before; // free: the coach's own charges are untouched
  }
}
