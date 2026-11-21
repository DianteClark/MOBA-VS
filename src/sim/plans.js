// Game plans (v22): one team-wide strategy picked in prep, read as deterministic weights by the hero AI
// (ai.js) and the AI coach (coach.js). No new behaviour trees: a plan only bends risk, lane assignment,
// gank/invade/objective eagerness, ward rate and peel. 'balanced' is the neutral internal plan (old
// configs, side tools): every weight is 1 and nothing changes.
//   aggro      Early Aggression: invade, dive, fight around early objectives; fades late.
//   scale      Scale: farm safe, avoid early fights, play loose once the items are in.
//   objective  Objective Control: vision and setups around Kami / Oni / Kraken.
//   split      Split Push: 1-3-1, side laners push alone while three hold mid.
//   protect    Protect the Carry: the frontline and support group and peel around the best-scaling hero.
import { HALFTIME, sec } from './constants.js';

export const PLAN_IDS = ['aggro', 'scale', 'objective', 'split', 'protect'];
// The intended counters (each plan beats two): shown in prep, and used by AI coaches switching at halftime.
export const PLAN_BEATS = { aggro: ['scale', 'split'], scale: ['split', 'objective'], split: ['objective', 'protect'], objective: ['protect', 'aggro'], protect: ['aggro', 'scale'] };
const LEGACY = { aggressive: 'aggro', scaling: 'scale' };
// Any stored or received plan id → a known one ('balanced' when unknown).
export function normPlan(p) { p = LEGACY[p] || p; return PLAN_IDS.includes(p) ? p : 'balanced'; }

// Counter-plan edge: a team whose plan beats the enemy's (PLAN_BEATS) has read it: +5% damage. Plans are
// revealed at kickoff, so both coaches see it; a halftime switch can take the edge (or lose it).
export const PLAN_EDGE = 0.05;
export function planEdge(g, team) { const a = g.teams[team].plan, b = g.teams[1 - team].plan; return (PLAN_BEATS[a] || []).includes(b) ? PLAN_EDGE : 0; }

// Plan changes are halftime-only (the halftime window), and only the last pick in that window counts.
export function planChangeOk(g, team, plan) {
  const ht = g.halftimeTick, now = g.tick;
  return PLAN_IDS.includes(plan) && ht >= 0 && now >= ht && now <= ht + sec(HALFTIME.window) && !!team;
}

// Timing, in classic-match minutes (g.gameMinute; side modes run their clock faster).
const EARLY = 8, SPIKE = 10;
const CARRY = (d) => d.cls === 'marksman' || d.cls === 'mage';
const FRONT = (d) => d.cls === 'tank' || d.cls === 'bruiser';

// ── who plays which part (chosen once per team, deterministic: ids and data only) ──
// Protect the Carry: the best-scaling marksman/mage (late curve, 'scaling' tag, bot lane first).
export function planCarry(g, team) {
  const T = g.teams[team];
  if (T.planCarry === undefined) {
    let best = null, bs = -1;
    for (const h of T.heroes) {
      const d = h.def; if (h.role === 'support' || h.role === 'jungle') continue;
      const s = (CARRY(d) ? 3 : 0) + (d.curve === 'late' ? 2 : d.curve === 'mid' ? 1 : 0) + (d.tags.includes('scaling') ? 1.5 : 0) + (h.role === 'bot' ? 1 : 0);
      if (s > bs) { bs = s; best = h; }
    }
    T.planCarry = best; // the hero object (heroes stay in g.units for the whole match)
  }
  return T.planCarry;
}
// Split Push: one or two side laners (siege builds and split/siege heroes first; never the support or jungler).
function planSplitters(g, team) {
  const T = g.teams[team];
  if (!T.planSplit) {
    const c = T.heroes.filter((h) => h.role !== 'support' && h.role !== 'jungle').map((h) => {
      const d = h.def;
      return { h, s: (h.build === 'siege' ? 3 : 0) + (d.tags.includes('split') ? 2 : 0) + (d.tags.includes('siege') ? 1 : 0) + (h.role === 'top' ? 1.5 : 0) + (FRONT(d) ? 0.5 : 0) - (h.role === 'bot' ? 1 : 0) };
    }).sort((a, b) => b.s - a.s || a.h.id - b.h.id);
    const out = [];
    if (c[0]) out.push({ id: c[0].h.id, lane: c[0].h.lane === 'mid' ? 'top' : c[0].h.lane });
    if (c[1] && c[1].s >= 3) out.push({ id: c[1].h.id, lane: out[0] && out[0].lane === 'top' ? 'bot' : 'top' });
    T.planSplit = out;
  }
  return T.planSplit;
}

// ── weights ──
// Risk multiplier for fight-or-flight (lower = takes fights more readily). Replaces the old 3-plan table.
export function planRisk(g, h) {
  const plan = g.teams[h.team].plan, m = g.gameMinute;
  switch (plan) {
    case 'aggro': return m < EARLY ? 0.88 : m < SPIKE + 1 ? 0.95 : 0.98;
    case 'scale': return m < EARLY + 1 ? 1.15 : m < SPIKE + 1 ? 1 : 0.93;
    case 'objective': {
      // brave around a live (or waking) objective, normal elsewhere
      const pits = g.world.pits;
      for (const k of ['dragon', 'herald', 'baron']) {
        const o = g.objectives[k]; if (!(o && o.alive) && !(g.objTimers[k] > 0 && g.objTimers[k] - g.tick < sec(20))) continue;
        const p = k === 'dragon' ? pits.kami : pits.kraken;
        if ((h.x - p.x) ** 2 + (h.y - p.y) ** 2 < 900 * 900) return 0.92;
      }
      return 1;
    }
    case 'split': return splitterOf(g, h) ? 1.12 : 1;
    case 'protect': {
      const c = planCarry(g, h.team); if (!c) return 1;
      if (c === h) return 1.05; // the carry stays safe
      return c.alive && (c.x - h.x) ** 2 + (c.y - h.y) ** 2 < 650 * 650 ? 0.9 : 1.04;
    }
    default: return 1;
  }
}
// Tower-dive safety margin multiplier (Early Aggression dives deeper while it is early).
export function diveMul(g, team) { return g.teams[team].plan === 'aggro' && g.gameMinute < SPIKE ? 0.8 : 1; }
// Jungler gank appetite: [score threshold, chance multiplier].
export function gankWeights(g, team) {
  const plan = g.teams[team].plan, m = g.gameMinute;
  if (plan === 'aggro' && m < SPIKE) return [0.75, 1.35];
  if (plan === 'scale' && m < EARLY + 1) return [1.0, 0.55];
  return [0.85, 1];
}
// Ward cooldown multiplier, and whether every hero carries wards (Objective Control).
export function wardWeights(g, team) { return g.teams[team].plan === 'objective' ? [0.65, true] : [1, false]; }
// Extra reach (px) for contesting an objective the enemy is on.
export function contestReach(g, team) { return g.teams[team].plan === 'objective' ? 500 : g.teams[team].plan === 'scale' && g.gameMinute < EARLY ? -400 : 0; }
// Peel weight multiplier (target choice: threats on our carries).
export function peelMul(g, h) { return g.teams[h.team].plan === 'protect' && h !== planCarry(g, h.team) ? 1.8 : 1; }

function splitterOf(g, h) {
  if (g.teams[h.team].plan !== 'split' || g.world.laneNames.length < 3) return null;
  return planSplitters(g, h.team).find((s) => s.id === h.id) || null;
}
// Lane override for the plan's shape (null = the hero's own lane). Split: splitters take their side lane
// from minute 7, the rest (not the jungler) hold mid from minute 9. Protect: the support walks with the carry
// from minute 7, the frontline joins from minute 10.
export function planLane(g, h) {
  const plan = g.teams[h.team].plan, m = g.gameMinute;
  if (g.world.laneNames.length < 3) return null;
  if (plan === 'split') {
    const s = splitterOf(g, h);
    if (s) return m >= 7 ? s.lane : null;
    return m >= EARLY + 1 && h.role !== 'jungle' ? 'mid' : null;
  }
  if (plan === 'protect' && m >= 7) {
    const c = planCarry(g, h.team);
    if (!c || c === h || !c.alive || h.role === 'jungle') return null;
    if (h.role === 'support' || (FRONT(h.def) && m >= SPIKE)) return c.task.lane || c.lane;
  }
  return null;
}
// Split plan: designated splitters push their side lane (as a 'split' task, not a call) from minute 7.
export function planSplits(g, h) { const s = splitterOf(g, h); return !!s && g.gameMinute >= 7 && h.hp / h.maxHp > 0.5; }

// ── team AI (coach.js) ──
// Coach appetite per plan: invade window/cooldown, objective call conditions, gank cooldown and when to group.
export function coachWeights(g, team) {
  const plan = g.teams[team].plan, m = g.gameMinute;
  const w = { invadeFrom: 200, invadeCd: 120, objFree: false, objCd: 40, objWait: false, gankCd: 35, lateAt: 600, groupCd: 40, groupLane: null };
  if (plan === 'aggro') {
    if (m < SPIKE) { w.invadeFrom = 150; w.invadeCd = 100; w.gankCd = 26; w.objFree = true; }
    else w.lateAt = 720;
  } else if (plan === 'scale') {
    if (m < EARLY + 1) { w.invadeFrom = 9999; w.gankCd = 60; w.objWait = true; }
    else { w.lateAt = 540; w.groupCd = 28; }
  } else if (plan === 'objective') {
    w.objFree = true; w.objCd = 30;
  } else if (plan === 'split') {
    w.groupLane = 'mid'; w.lateAt = 600; w.groupCd = 45;
  } else if (plan === 'protect') {
    const c = planCarry(g, team); w.groupLane = c && c.alive ? (c.task.lane || c.lane) : null; w.lateAt = 540; w.groupCd = 32;
  }
  return w;
}
