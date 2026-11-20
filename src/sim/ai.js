// Hero AI. Two layers:
//   heroMacro – every 0.5s: which task am I doing (lane / jungle / recall / call tasks ...)
//   heroThink – every tick: fight, flee, farm, cast, move.
// AI only reacts to enemies its team can see (fog of war).
import { DT, sec, BLUE } from './constants.js';
import { dist2, dist, norm } from './geom.js';
// Current world (set on entry; the sim is single-threaded and maps are immutable).
let W = null;
const laneProgress = (l, p) => W.laneProgress(l, p), lanePoint = (l, p) => W.lanePoint(l, p), distToLane = (l, p) => W.distToLane(l, p), pathDist = (a, b) => W.pathDist(a, b);
const FOUNTAIN = new Proxy([], { get: (_, k) => W.fountain[k] });
const PITS = { get dragon() { return W.pits.kami; }, get baron() { return W.pits.kraken; } };
const LANE_NAMES = ['top', 'mid', 'bot'];

const PLAN_RISK = { aggressive: 0.82, balanced: 1.0, scaling: 1.18 };

// ─────────────────────────── helpers ───────────────────────────
function enemiesNear(g, h, r) {
  const out = [];
  for (const e of g.grid.query(h.x, h.y, r)) if (e.type === 'hero' && e.alive && e.team !== h.team && g.vision[h.team].has(e.id)) out.push(e);
  return out;
}
function alliesNear(g, h, r) {
  const out = [];
  for (const e of g.grid.query(h.x, h.y, r)) if (e.type === 'hero' && e.alive && e.team === h.team) out.push(e);
  return out;
}
function enemyTowerCovering(g, p, pad = 0) {
  for (const s of g.grid.query(p.x, p.y, 300 + pad)) {
    if (s.type === 'tower' && s.alive && s.team !== undefined && s.stats.range && dist2(s, p) < (s.stats.range + 20 + pad) ** 2) return s;
  }
  return null;
}
function towerOf(g, team, p, pad) {
  const t = enemyTowerCovering(g, p, pad);
  return t && t.team !== team ? t : null;
}
function ownTowerCovering(g, team, p) {
  for (const s of g.grid.query(p.x, p.y, 300)) if (s.type === 'tower' && s.alive && s.team === team && dist2(s, p) < (s.stats.range + 20) ** 2) return s;
  return null;
}
function minionCover(g, team, tower) {
  let n = 0;
  for (const u of g.grid.query(tower.x, tower.y, tower.stats.range + 10)) if ((u.type === 'minion' || u.type === 'summon') && u.team === team && u.alive) n++;
  return n;
}
function power(g, list) {
  let e = 0, d = 0;
  for (const h of list) { e += g.ehp(h); d += h.dps; }
  return e * d;
}
function riskFactor(g, h) {
  const plan = g.teams[h.team].plan;
  let r = PLAN_RISK[plan] || 1;
  if (plan === 'scaling' && g.time > 600) r = 1.0;
  if (plan === 'aggressive' && g.time > 900) r = 0.92;
  if (h.task.call && ['gank', 'objective', 'group', 'invade', 'contest', 'defend'].includes(h.task.kind)) r -= 0.15;
  return r;
}
function predict(g, t, speed, from) {
  if (!t.vx && !t.vy) return { x: t.x, y: t.y };
  const d = dist(from, t);
  const time = speed ? d / speed : 0.4;
  const ticks = time / DT;
  return { x: t.x + t.vx * ticks, y: t.y + t.vy * ticks };
}
function teamSidePoint(team, lane, prog) {
  return lanePoint(lane, team === BLUE ? prog : 1 - prog);
}
// My progress along a lane measured from MY base (0) to enemy base (1).
function myProg(team, lane, p) { const pr = laneProgress(lane, p); return team === BLUE ? pr : 1 - pr; }

function frontline(g, team, lane) {
  // Furthest allied minion along lane (from own base); fallback: outermost own tower.
  let best = -1;
  for (const u of g.units) if (u.alive && u.team === team && (u.type === 'minion' || u.type === 'summon') && u.lane === lane) {
    const p = myProg(team, lane, u); if (p > best) best = p;
  }
  let towerProg = 0.12;
  for (const u of g.units) if (u.alive && u.type === 'tower' && u.team === team && u.lane === lane) { const p = myProg(team, lane, u); if (p > towerProg) towerProg = p; }
  return { prog: best >= 0 ? best : towerProg - 0.02, hasWave: best >= 0, towerProg };
}

// ─────────────────────────── macro ───────────────────────────
export function heroMacro(g, h) {
  W = g.world;
  const now = g.tick;
  const t = h.task;
  // Expire timed tasks.
  if (t.until && now > t.until) h.task = { kind: 'idle' };
  if (t.kind === 'gank' && t.done) h.task = { kind: 'idle' };
  if (t.kind === 'objective') {
    const ob = g.objectives[t.obj];
    if (t.started && (!ob || !ob.alive)) h.task = { kind: 'idle' };
  }
  const hpPct = h.hp / h.maxHp;
  const atFountain = dist2(h, FOUNTAIN[h.team]) < 380 * 380;
  const enemiesClose = enemiesNear(g, h, 900).length;

  // Wards (supports & junglers drop wards near key spots they pass)
  if ((h.role === 'support' || h.role === 'jungle') && now >= h.wardCd) {
    for (const s of g.wardSpots(h.team)) if (dist2(h, s) < 220 * 220 && !g.wards.some((w) => w.team === h.team && dist2(w, s) < 200 * 200 && w.until > now)) {
      g.placeWard(h, s); h.wardCd = now + sec(h.role === 'support' ? 25 : 45); break;
    }
  }

  if (h.task.kind === 'recall') { if (atFountain) h.task = { kind: 'heal' }; return; }
  if (h.task.kind === 'heal') { if (hpPct > 0.95 || !atFountain) h.task = { kind: 'idle' }; else return; }
  if (atFountain && hpPct < 0.75) { h.task = { kind: 'heal' }; return; }

  // Autonomous recall (not during calls unless critical)
  const critical = hpPct < 0.18;
  const lowish = hpPct < 0.38;
  const rich = h.gold >= g.nextItemCost(h) + (h.role === 'jungle' ? 100 : 350);
  if (!atFountain && (critical || ((lowish || (rich && hpPct < 0.85) || (h.gold > g.nextItemCost(h) + 1200)) && !h.task.call && now - h.lastCombat > sec(3) && enemiesClose === 0))) {
    if (!h.task.call || critical) { h.task = { kind: 'recall' }; return; }
  }
  if (h.task.call || ['gank', 'contest', 'defend'].includes(h.task.kind)) return;

  // Defend base / structures under siege
  const threat = baseThreat(g, h.team);
  if (threat && pathDist(h, threat) < 2600) { h.task = { kind: 'defend', x: threat.x, y: threat.y, until: now + sec(12) }; return; }

  // Contest an objective the enemy is taking (only if we can see it).
  const contest = contestTarget(g, h);
  if (contest) { h.task = { kind: 'contest', obj: contest.kind, until: now + sec(25) }; return; }

  // Grab a nearby shrine when it's safe and on the way.
  if ((h.role === 'jungle' || h.role === 'support' || g.time > 480) && g.time >= 60 && hpPct > 0.5 && (now + h.id * 3) % 40 === 0) {
    for (const sh of g.shrines) {
      if (sh.owner === h.team || pathDist(h, sh) > 650) continue;
      if (enemiesNear(g, { x: sh.x, y: sh.y, team: h.team }, 700).length) continue;
      h.task = { kind: 'shrine', shrine: sh.id, until: now + sec(14) }; return;
    }
  }
  if (h.task.kind === 'shrine' && !(h.task.until < now)) return;
  if (h.role === 'jungle') {
    // Autonomous gank: only near-certain opportunities. Most good ganks come from calls.
    if ((now + h.id * 7) % 100 === 0) {
      const lane = gankOpportunity(g, h);
      if (lane) { h.task = { kind: 'gank', lane, until: now + sec(20) }; return; }
    }
    if (h.task.kind !== 'jungle') h.task = { kind: 'jungle' };
    return;
  }
  if (h.task.kind !== 'lane' || h.task.lane !== h.lane) h.task = { kind: 'lane', lane: h.lane };
}

function baseThreat(g, team) {
  // Enemy heroes near our tier 3 / base structures.
  for (const s of g.units) {
    if (!s.alive || s.team !== team || !s.structure) continue;
    if (s.type === 'tower' && s.tier < 3) continue;
    let n = 0;
    for (const e of g.grid.query(s.x, s.y, 500)) if (e.alive && e.team !== team && (e.type === 'hero' || e.type === 'summon' || (e.type === 'minion' && e.kind === 'super')) && g.canSee(team, e)) n += e.type === 'hero' ? 1 : 0.5;
    if (n >= 1) return s;
  }
  return null;
}

function contestTarget(g, h) {
  for (const k of ['dragon', 'baron', 'herald']) {
    const o = g.objectives[k];
    if (!o || !o.alive || o.hp > o.maxHp * 0.92) continue;
    if (!g.vision[h.team].has(o.id) && dist2(h, o) > 900 * 900) continue;
    // enemy team is on it and we can see them
    const enemies = g.grid.query(o.x, o.y, 600).filter((e) => e.type === 'hero' && e.alive && e.team !== h.team && g.vision[h.team].has(e.id));
    if (!enemies.length) continue;
    const d = pathDist(h, o);
    if (d > (h.role === 'jungle' ? 2200 : 1500)) continue;
    const allies = g.teams[h.team].heroes.filter((a) => a.alive && pathDist(a, o) < 1800);
    if (allies.length >= enemies.length - 1 || h.role === 'jungle') return o;
  }
  return null;
}

function gankOpportunity(g, h) {
  let best = null, bs = 0;
  for (const lane of LANE_NAMES) {
    for (const e of g.teams[1 - h.team].heroes) {
      if (!e.alive || !g.vision[h.team].has(e.id)) continue;
      if (distToLane(lane, e) > 300) continue;
      const overext = myProg(h.team, lane, e); // low = deep in our half
      if (overext > 0.52) continue;
      const d = pathDist(h, e); if (d > 1300) continue;
      const ally = g.teams[h.team].heroes.find((a) => a.alive && a.lane === lane && dist2(a, e) < 700 * 700);
      if (!ally) continue;
      const eh = e.hp / e.maxHp;
      const score = (1 - eh) * 2 + (0.52 - overext) * 3 + (ally.hp / ally.maxHp) - d / 2000;
      if (score > bs && eh < 0.7) { bs = score; best = lane; }
    }
  }
  return bs > 0.9 && g.rng.chance(0.6) ? best : null;
}

// ─────────────────────────── micro ───────────────────────────
export function heroThink(g, h) {
  W = g.world;
  const now = g.tick;
  if (h.castLock > now) return;
  g.trySmite(h);
  const task = h.task;
  const hpPct = h.hp / h.maxHp;
  const enemies = enemiesNear(g, h, 700);
  const allies = alliesNear(g, h, 750);
  const focus = g.teams[h.team].focus;

  // ── Recall
  if (task.kind === 'recall' || task.kind === 'heal') {
    const threats = enemies.filter((e) => dist2(e, h) < 650 * 650);
    if (task.kind === 'recall' && !threats.length && now - h.lastCombat > sec(2)) {
      if (!h.recallAt) { h.recallAt = now + sec(4); h.vx = h.vy = 0; g.fx.push({ kind: 'recall', id: h.id }); }
      return;
    }
    if (threats.length) { if (fightOrFlight(g, h, enemies, allies, true)) return; }
    if (task.kind === 'heal') return;
    g.moveToward(h, FOUNTAIN[h.team]);
    return;
  }

  // ── Fight / flee evaluation (applies to every task)
  if (enemies.length && fightOrFlight(g, h, enemies, allies, false, focus)) return;

  // ── Task behaviour
  switch (task.kind) {
    case 'lane': return doLane(g, h, task.lane, false);
    case 'split': return doLane(g, h, task.lane, true);
    case 'group': return doGroup(g, h, task.lane);
    case 'jungle': return doJungle(g, h);
    case 'gank': return doGank(g, h, task);
    case 'objective': return doObjective(g, h, task.obj, task);
    case 'contest': return doObjective(g, h, task.obj, task, true);
    case 'safe': return doSafe(g, h);
    case 'shrine': {
      const sh = g.shrines[task.shrine];
      if (!sh || sh.owner === h.team) { h.task = { kind: 'idle' }; return; }
      if (dist2(h, sh) > 60 * 60) g.moveToward(h, sh); else { h.vx = h.vy = 0; }
      return;
    }
    case 'invade': return doInvade(g, h, task);
    case 'defend': {
      if (dist2(h, task) > 250 * 250) g.moveToward(h, task); else farmAround(g, h, 400, true);
      return;
    }
    default: return doLane(g, h, h.lane || 'mid', false);
  }
}

// Returns true if the hero did something combat related this tick.
function fightOrFlight(g, h, enemies, allies, recalling, focus) {
  const now = g.tick;
  const hpPct = h.hp / h.maxHp;
  let near = enemies.filter((e) => dist2(e, h) < 620 * 620);
  if (!near.length) return false;
  const nearAllies = allies.filter((a) => dist2(a, h) < 700 * 700);
  // Lanchester-style strength: (sum of effective HP) x (sum of DPS). Towers join a side
  // only when they can actually shoot someone in this fight.
  let mE = 0, mD = 0, eE = 0, eD = 0;
  for (const a of nearAllies) { mE += g.ehp(a); mD += a.dps; }
  for (const e of near) { eE += g.ehp(e); eD += e.dps; }
  const et = towerOf(g, h.team, h, 10);
  if (et) { eE += 1500; eD += 160; } // hitting a hero under their tower draws its fire
  const ot = ownTowerCovering(g, h.team, h);
  if (ot && near.some((e) => dist2(e, ot) < (ot.stats.range + 20) ** 2)) { mE += 1500; mD += 160; }
  const my = mE * mD, en = eE * eD;
  const ratio = my / Math.max(1, en);
  const risk = riskFactor(g, h);

  // killable target?
  let best = null, bestScore = -Infinity;
  for (const e of near) {
    const d = dist(h, e);
    if (d > h.stats.range + 420) continue;
    const ehp = g.ehp(e);
    const killable = (h.burst * 0.7 + nearAllies.filter((a) => a !== h && dist2(a, e) < 500 * 500).reduce((s, a) => s + a.burst * 0.4, 0)) > ehp;
    let s = 1000 - d * 0.8 + (1 - e.hp / e.maxHp) * 400 + (killable ? 500 : 0);
    if (focus && focus.id === e.id) s += 900;
    if (e.def.cls === 'marksman' || e.def.cls === 'mage') s += 120;
    if (h.task.kind === 'gank' && e.lane === h.task.lane) s += 200;
    const tw = towerOf(g, h.team, e, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && !(killable && hpPct > 0.5)) s -= 900;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const killable = best && (h.burst * 0.7 + nearAllies.filter((a) => a !== h && dist2(a, best) < 500 * 500).reduce((s, a) => s + a.burst * 0.4, 0)) > g.ehp(best);

  // Flee?
  const fleeHp = h.def.cls === 'tank' ? 0.18 : 0.26;
  const mustFlee = (hpPct < fleeHp && !(killable && hpPct > 0.12)) || ratio < 0.55 * risk && !killable || (recalling && ratio < 1.4);
  if (mustFlee) {
    // Flash: every hero carries one emergency blink.
    if (now >= h.flashCd && hpPct < 0.3 && near.some((e) => dist2(e, h) < 260 * 260)) {
      const away = fleePoint(g, h, near); const d = norm(away.x - h.x, away.y - h.y);
      h.flashCd = now + sec(110); g.fx.push({ kind: 'flash', id: h.id, x: h.x, y: h.y });
      h.x = Math.max(30, Math.min(2370, h.x + d.x * 170)); h.y = Math.max(30, Math.min(2370, h.y + d.y * 170));
      return true;
    }
    // escape tools
    for (let i = 0; i < 3; i++) {
      const ab = h.def.abilities[i];
      if (!g.abilityReady(h, i) || !ab.use.includes('escape') && !(ab.use.includes('defend') && ab.kind === 'self')) continue;
      const away = fleePoint(g, h, near);
      if (ab.kind === 'dash') { g.cast(h, i, null, away); return true; }
      if (ab.kind === 'self') { g.cast(h, i, null, null); return true; }
    }
    // peel / cc the closest chaser
    const chaser = near.reduce((a, b) => (dist2(a, h) < dist2(b, h) ? a : b));
    if (castPeel(g, h, chaser)) return true;
    if (castAllySustain(g, h, nearAllies)) return true;
    // ranged heroes shoot while backing if chaser is on top of them
    g.moveToward(h, retreatTarget(g, h));
    return true;
  }
  if (recalling) return false;

  // Decide to engage. Laning needs a clear edge; committed calls fight on smaller edges;
  // anyone fights back when they are being hit and it's roughly even.
  const laning = h.task.kind === 'lane' || h.task.kind === 'jungle' || h.task.kind === 'split';
  const engageAt = laning ? risk * 1.7 : risk * 1.1;
  const beingHit = now - h.lastHurtByHero < sec(1.2);
  if (!best) return false;
  let want;
  if (laning) {
    // Lane trades: short exchanges, then back off. All-in only with a clear edge or a kill.
    const allIn = (killable && hpPct > 0.35 && best.hp / best.maxHp < 0.5) || ratio >= engageAt;
    if (h.disengageUntil > now && !allIn) {
      const threat = near.find((e) => dist2(e, h) < (e.stats.range + 140) ** 2);
      if (threat) { g.moveToward(h, retreatTarget(g, h)); return true; }
      return false;
    }
    if (allIn) want = true;
    else if (beingHit) {
      if (ratio >= risk * 1.3 && hpPct > 0.55) { want = true; h.tradeStart = h.tradeStart || now; }
      else { h.disengageUntil = now + sec(3); g.moveToward(h, retreatTarget(g, h)); return true; }
    } else want = false;
    if (want && !allIn && h.tradeStart && now - h.tradeStart > sec(2)) { h.tradeStart = 0; h.disengageUntil = now + sec(4); return false; }
    if (hpPct < 0.5 && !allIn) { h.disengageUntil = now + sec(4); g.moveToward(h, retreatTarget(g, h)); return true; }
    if (!want) h.tradeStart = 0;
  } else {
    want = (killable && hpPct > 0.3) || ratio >= engageAt || (beingHit && ratio >= risk * 0.85)
      || (h.task.kind === 'objective' && ratio >= risk * 0.85) || (h.fightTarget === best.id && now - h.lastCombat < sec(1.5) && ratio >= risk * 0.9);
  }
  // Supports & sustain: heal allies during fights
  if (castAllySustain(g, h, nearAllies)) return true;

  if (!want) {
    // Poke only, keep distance
    if (h.task.kind === 'lane' || h.task.kind === 'split') {
      // Poke occasionally (stands in for mana management), only when healthy.
      if (hpPct > 0.5 && g.rng.chance(0.015) && castPoke(g, h, best)) return true;
      // too close to an enemy that outclasses us: step back
      if (dist2(h, best) < (best.stats.range + 120) ** 2 && ratio < risk * 0.8) { g.moveToward(h, retreatTarget(g, h)); return true; }
    }
    return false;
  }
  // Fight!
  h.fightTarget = best.id;
  if (castCombat(g, h, best, near, nearAllies, killable)) return true;
  if (!g.tryAttack(h, best)) {
    // chase only what we can catch: killable targets, or targets nearly in range
    if (!killable && dist2(h, best) > (h.stats.range + 160) ** 2 && h.task.kind !== 'gank') return false;
    if (!h.chaseFrom || now - h.lastCombat > sec(3)) h.chaseFrom = { x: h.x, y: h.y };
    if (dist2(h, h.chaseFrom) > 750 * 750 && !(killable && best.hp / best.maxHp < 0.15)) return false;
    // chase — but not deep into enemy towers without cover
    const tw = towerOf(g, h.team, best, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && !(killable && hpPct > 0.45)) return false;
    g.moveToward(h, best, false, h.stats.range * 0.85 + best.radius);
  } else {
    // ranged kiting: step back if a melee is on us
    if (h.def.ranged) {
      const mel = near.find((e) => !e.def.ranged && dist2(e, h) < 70 * 70);
      if (mel && now % 6 < 3 && h.attackCd - now > 3) { const d = norm(h.x - mel.x, h.y - mel.y); g.moveToward(h, { x: h.x + d.x * 40, y: h.y + d.y * 40 }, false); }
    }
  }
  return true;
}

function fleePoint(g, h, threats) {
  let ax = 0, ay = 0;
  for (const e of threats) { const d = norm(h.x - e.x, h.y - e.y); ax += d.x; ay += d.y; }
  const home = norm(FOUNTAIN[h.team].x - h.x, FOUNTAIN[h.team].y - h.y);
  const d = norm(ax + home.x * 1.2, ay + home.y * 1.2);
  return { x: h.x + d.x * 300, y: h.y + d.y * 300 };
}
function retreatTarget(g, h) {
  // nearest own tower behind us, else fountain
  let best = FOUNTAIN[h.team], bd = Infinity;
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team) {
    const dd = dist2(u, h); const towardHome = dist2(u, FOUNTAIN[h.team]) < dist2(h, FOUNTAIN[h.team]);
    if (towardHome && dd < bd) { bd = dd; best = u; }
  }
  return best;
}

// ─────────────────────────── casting ───────────────────────────
function inRange(h, t, r) { return dist2(h, t) <= (r + (t.radius || 0)) ** 2; }

function castAt(g, h, i, t) {
  const ab = h.def.abilities[i];
  switch (ab.kind) {
    case 'shot': case 'hook': {
      if (!inRange(h, t, ab.range * 0.92)) return false;
      g.cast(h, i, t, predict(g, t, ab.speed || 800, h)); return true;
    }
    case 'line': if (!inRange(h, t, ab.range * 0.95)) return false; g.cast(h, i, t, predict(g, t, 0, h)); return true;
    case 'target': if (!inRange(h, t, ab.range + 10)) return false; g.cast(h, i, t); return true;
    case 'circle': case 'zone': {
      if (!inRange(h, t, ab.range)) return false;
      const p = predict(g, t, ab.delay ? 1 / Math.max(0.05, ab.delay) * 1 : 0, h);
      const p2 = ab.delay ? { x: t.x + t.vx * (ab.delay / DT) * 0.6, y: t.y + t.vy * (ab.delay / DT) * 0.6 } : p;
      g.cast(h, i, t, p2); return true;
    }
    case 'nova': if (!inRange(h, t, ab.radius * 0.9)) return false; g.cast(h, i, t); return true;
    case 'dash': if (!inRange(h, t, ab.range + (ab.radius ? ab.radius * 0.5 : 0))) return false; g.cast(h, i, t); return true;
    case 'self': g.cast(h, i, null); return true;
  }
  return false;
}

function countIn(g, h, p, r) {
  let n = 0;
  for (const e of g.grid.query(p.x, p.y, r)) if (e.type === 'hero' && e.alive && e.team !== h.team && g.vision[h.team].has(e.id)) n++;
  return n;
}

function castCombat(g, h, t, near, allies, killable) {
  const now = g.tick;
  const fight = near.length + allies.length;
  for (let i = 2; i >= 0; i--) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i], u = ab.use;
    if (ab.kind === 'ally' || ab.kind === 'allynova') continue;
    if (ab.kind === 'self') {
      if (u.includes('engage') || u.includes('teamfight')) { if (dist2(h, t) < (h.stats.range + 120) ** 2) { g.cast(h, i, null); return true; } }
      if (u.includes('defend') && h.hp / h.maxHp < 0.6 && now - h.lastHurtByHero < sec(1)) { g.cast(h, i, null); return true; }
      continue;
    }
    if (u.includes('escape') && !u.includes('engage') && !(ab.dmg)) continue;
    const dmg = g.abilityDamage(h, ab, t);
    const exec = t.hp < dmg * 1.05 || (u.includes('execute') && t.hp / t.maxHp < 0.4);
    let ok = false;
    if (u.includes('execute') && exec) ok = true;
    if (u.includes('engage')) ok = true;
    if (u.includes('poke') && !ab.ult) ok = true;
    if (u.includes('teamfight')) {
      const r = ab.radius || 150;
      const at = ab.kind === 'nova' ? h : t;
      const n = countIn(g, h, at, r);
      if (n >= 2 || (fight >= 4 && n >= 1) || killable || t.hp / t.maxHp < 0.45) ok = true;
      else if (u.includes('execute')) ok = exec;
      else ok = false;
    } else if (ab.ult && u.includes('execute') && !exec && !killable) ok = false;
    if (u.includes('peel') && !u.includes('engage') && !u.includes('poke')) ok = ok || dist2(t, h) < 160 * 160;
    if (ok && ab.kind === 'dash' && !ab.dmg && !ab.cc) ok = false; // pure escape dash
    if (ok && castAt(g, h, i, t)) return true;
  }
  return false;
}
function castPoke(g, h, t) {
  for (let i = 0; i < 2; i++) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i];
    if (!ab.use.includes('poke') || ab.kind === 'dash' || ab.kind === 'nova') continue;
    if (towerOf(g, h.team, t, 0) && ab.kind === 'target') continue;
    if (castAt(g, h, i, t)) return true;
  }
  return false;
}
function castPeel(g, h, t) {
  for (let i = 0; i < 3; i++) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i];
    if (!ab.use.includes('peel') || !ab.cc) continue;
    if (castAt(g, h, i, t)) return true;
  }
  return false;
}
function castAllySustain(g, h, allies) {
  for (let i = 0; i < 3; i++) {
    const ab = h.def.abilities[i];
    if (ab.kind !== 'ally' && ab.kind !== 'allynova') continue;
    if (!g.abilityReady(h, i)) continue;
    if (ab.kind === 'ally') {
      let best = null, bv = 0.72;
      for (const a of allies) { const v = a.hp / a.maxHp; if (v < bv && dist2(a, h) < (ab.range + 10) ** 2 && g.tick - a.lastCombat < sec(4)) { bv = v; best = a; } }
      if (best) { g.cast(h, i, best); return true; }
    } else {
      const inR = allies.filter((a) => dist2(a, h) < ab.radius ** 2);
      const hurt = inR.filter((a) => a.hp / a.maxHp < 0.55 && g.tick - a.lastCombat < sec(3)).length;
      if (hurt >= 2 || (inR.length >= 3 && g.tick - h.lastCombat < sec(2)) || inR.some((a) => a.hp / a.maxHp < 0.25 && g.tick - a.lastHurtByHero < sec(2))) { g.cast(h, i, null); return true; }
    }
  }
  return false;
}
function castClear(g, h, mobs) {
  if (!mobs.length) return false;
  for (let i = 0; i < 2; i++) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i];
    if (!ab.use.includes('clear') || !ab.dmg) continue;
    if (ab.cd > 13) continue;
    const t = mobs[0];
    const r = ab.radius || ab.width || 60;
    const n = mobs.filter((m) => dist2(m, t) < (r + 30) ** 2).length;
    const isMonster = t.type === 'mob' || t.type === 'objective';
    if (n >= 3 || isMonster) { if (castAt(g, h, i, t)) return true; }
  }
  return false;
}

// ─────────────────────────── task behaviours ───────────────────────────
function farmAround(g, h, r, includeStructures) {
  const now = g.tick;
  const tmp = g.grid.query(h.x, h.y, r);
  let lastHit = null, low = null, lowHp = Infinity, any = null, tower = null;
  const myDmg = h.stats.ad;
  const mobs = [];
  for (const e of tmp) {
    if (!e.alive || e.team === h.team) continue;
    if (e.type === 'minion' || e.type === 'summon') {
      mobs.push(e);
      if (e.hp <= myDmg * 1.0 + 4) { if (!lastHit || e.hp < lastHit.hp) lastHit = e; }
      if (e.hp < lowHp) { lowHp = e.hp; low = e; }
      any = any || e;
    } else if (includeStructures && e.structure && g.isTargetable(e)) {
      tower = e;
    }
  }
  if (tower && minionCover(g, h.team, tower.type === 'tower' ? tower : { ...tower, stats: { range: 260 } }) >= 1 && (!low || dist2(h, tower) < (h.stats.range + 60) ** 2)) {
    if (!g.tryAttack(h, tower)) g.moveToward(h, tower, false, h.stats.range * 0.8 + tower.radius);
    return true;
  }
  if (castClear(g, h, mobs)) return true;
  const target = lastHit || (low && low.hp > myDmg * 2.2 ? low : null) || (g.teams[h.team].plan === 'aggressive' || h.task.kind !== 'lane' ? low : null);
  if (target) {
    // don't farm under enemy tower without cover
    const tw = towerOf(g, h.team, target, -10);
    if (tw && minionCover(g, h.team, tw) < 1) return false;
    if (!g.tryAttack(h, target)) g.moveToward(h, target, false, h.stats.range * 0.8 + target.radius);
    return true;
  }
  if (low) {
    // wait near the wave for last hits
    if (dist2(h, low) > (h.stats.range + 30) ** 2) { g.moveToward(h, low, false, h.stats.range * 0.9); return true; }
    h.vx = h.vy = 0;
    return true;
  }
  void now; void any;
  return false;
}

function minionPressure(g, h) {
  let n = 0;
  for (const m of g.grid.query(h.x, h.y, 260)) if (m.alive && (m.type === 'minion') && m.team !== h.team && m.target === h) n++;
  return n;
}
function doLane(g, h, lane, push) {
  const fl = frontline(g, h.team, lane);
  // Getting focused by the enemy wave: back off behind our own wave/tower.
  if (minionPressure(g, h) >= 3 && h.hp / h.maxHp < 0.7) {
    g.moveToward(h, teamSidePoint(h.team, lane, Math.max(0.04, (fl.hasWave ? fl.prog : fl.towerProg) - 0.08))); return;
  }
  // Stand slightly behind our wave (ranged further back).
  const back = h.def.ranged ? 0.05 : 0.025;
  let prog = fl.hasWave ? fl.prog - back : fl.towerProg - 0.03;
  if (push && fl.hasWave) prog = fl.prog - 0.005;
  prog = Math.max(0.04, prog);
  const hold = teamSidePoint(h.team, lane, prog);
  // Avoid standing inside enemy tower range without minion cover
  const tw = towerOf(g, h.team, hold, 40);
  const heroesNear = enemiesNear(g, h, 650).length > 0;
  if (tw && (minionCover(g, h.team, tw) < 2 || heroesNear)) {
    const safe = teamSidePoint(h.team, lane, Math.max(0.04, myProg(h.team, lane, tw) - 0.09));
    if (farmAround(g, h, 360, false)) return;
    g.moveToward(h, safe); return;
  }
  if (dist2(h, hold) > 520 * 520) { g.moveToward(h, hold); return; }
  if (farmAround(g, h, 420, true)) return;
  if (dist2(h, hold) > 30 * 30) g.moveToward(h, hold, false);
  else { h.vx = h.vy = 0; }
}

function doGroup(g, h, lane) {
  // Everyone moves with the most advanced allied hero/wave and sieges together.
  const fl = frontline(g, h.team, lane);
  const team = g.teams[h.team].heroes.filter((a) => a.alive && a.task.kind === 'group');
  const lead = fl.hasWave ? fl.prog : fl.towerProg;
  const p = teamSidePoint(h.team, lane, Math.max(0.05, lead - (h.def.ranged ? 0.025 : 0.005)));
  // Gather: the first arrivals wait a little behind the wave for the others.
  const gathered = team.filter((a) => dist2(a, p) < 700 * 700).length;
  if (gathered < Math.min(3, team.length) && dist2(h, p) < 600 * 600) {
    const wait = teamSidePoint(h.team, lane, Math.max(0.05, lead - 0.07));
    if (farmAround(g, h, 300, false)) return;
    g.moveToward(h, wait, false); return;
  }
  if (dist2(h, p) > 450 * 450) { g.moveToward(h, p); return; }
  if (farmAround(g, h, 450, true)) return;
  g.moveToward(h, p, false);
}

function campValue(g, h, c) {
  const d = pathDist(h, c);
  return d / (c.def.buff ? 1.5 : 1);
}
function doJungle(g, h) {
  // Fight monsters in reach first.
  const mobsHere = g.grid.query(h.x, h.y, 260).filter((m) => m.type === 'mob' && m.alive).sort((a, b) => (b.big - a.big) || a.id - b.id);
  if (mobsHere.length) {
    const t = mobsHere.find((m) => m.target === h) || mobsHere[0];
    if (castClear(g, h, [t, ...mobsHere.filter((m) => m !== t)])) return;
    if (!g.tryAttack(h, t)) g.moveToward(h, t, false, h.stats.range * 0.8 + t.radius);
    return;
  }
  let best = null, bv = Infinity;
  for (const c of g.camps) {
    if (c.side !== h.team) continue;
    const alive = c.mobs.length > 0;
    const soon = !alive && c.respawnAt > 0 && c.respawnAt - g.tick < sec(8);
    if (!alive && !soon) continue;
    const v = campValue(g, h, c) + (soon ? 400 : 0);
    if (v < bv) { bv = v; best = c; }
  }
  if (best) { g.moveToward(h, best); return; }
  // Nothing up: shadow the lane with the most action on our side.
  const lane = h.team === BLUE ? 'bot' : 'top';
  doLane(g, h, g.time > 600 ? 'mid' : lane, false);
}

function doGank(g, h, task) {
  const lane = task.lane;
  // Find a visible enemy in that lane
  let tgt = null, bd = Infinity;
  for (const e of g.teams[1 - h.team].heroes) {
    if (!e.alive || !g.vision[h.team].has(e.id)) continue;
    if (distToLane(lane, e) > 350) continue;
    const d = dist2(h, e); if (d < bd) { bd = d; tgt = e; }
  }
  if (tgt) {
    // Don't walk under their tower for it
    const tw = towerOf(g, h.team, tgt, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && tgt.hp / tgt.maxHp > 0.35) { task.done = g.tick - (task.arrived || g.tick) > sec(5); g.moveToward(h, teamSidePoint(h.team, lane, myProg(h.team, lane, tw) - 0.1)); return; }
    g.moveToward(h, tgt);
    return;
  }
  const fl = frontline(g, h.team, lane);
  const p = teamSidePoint(h.team, lane, Math.max(0.1, fl.prog - 0.02));
  if (dist2(h, p) < 250 * 250) { task.arrived = task.arrived || g.tick; if (g.tick - task.arrived > sec(6)) task.done = true; farmAround(g, h, 350, false); return; }
  g.moveToward(h, p);
}

function doObjective(g, h, obj, task, contest) {
  const pit = obj === 'dragon' ? PITS.dragon : PITS.baron;
  const ob = g.objectives[obj];
  if (dist2(h, pit) > 330 * 330) { g.moveToward(h, pit); return; }
  if (!ob || !ob.alive) {
    // waiting for spawn / it's gone
    if (!task.waitStart) task.waitStart = g.tick;
    if (!contest && g.objTimers[obj] && g.objTimers[obj] - g.tick < sec(25)) { h.vx = h.vy = 0; return; }
    task.until = Math.min(task.until || Infinity, g.tick + sec(2));
    return;
  }
  task.started = true;
  // wait for a buddy before starting (unless it's already low)
  const helpers = g.teams[h.team].heroes.filter((a) => a.alive && dist2(a, pit) < 420 * 420).length;
  if (!contest && helpers < 2 && ob.hp > ob.maxHp * 0.6 && h.role !== 'jungle') { h.vx = h.vy = 0; return; }
  if (!contest && helpers < 2 && ob.hp > ob.maxHp * 0.6 && h.role === 'jungle' && obj !== 'dragon' && g.time < 400) { h.vx = h.vy = 0; return; }
  // Contesting: junglers hover for smite; others hit it too (to secure)
  if (contest && h.role !== 'jungle' && ob.hp > ob.maxHp * 0.3) { farmAround(g, h, 300, false); return; }
  if (contest && h.role === 'jungle' && dist2(h, ob) > 200 * 200) { g.moveToward(h, ob, false, 150); return; }
  if (castClear(g, h, [ob])) return;
  if (!g.tryAttack(h, ob)) g.moveToward(h, ob, false, h.stats.range * 0.8 + ob.radius);
}

function doSafe(g, h) {
  const lane = h.lane || g.laneOf(h);
  // stand behind our outermost tower in that lane
  let tw = null, bp = -1;
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team && u.lane === lane) { const p = myProg(h.team, lane, u); if (p > bp) { bp = p; tw = u; } }
  const spot = tw ? teamSidePoint(h.team, lane, Math.max(0.03, bp - 0.04)) : FOUNTAIN[h.team];
  if (h.role === 'jungle') { doJungle(g, h); return; }
  if (dist2(h, spot) > 140 * 140) { g.moveToward(h, spot); return; }
  if (tw) {
    // farm only what's inside our tower range
    for (const e of g.grid.query(tw.x, tw.y, tw.stats.range)) if (e.alive && e.team !== h.team && (e.type === 'minion') && e.hp <= h.stats.ad) { if (!g.tryAttack(h, e)) g.moveToward(h, e, false, h.stats.range * 0.8); return; }
  }
  h.vx = h.vy = 0;
}

function doInvade(g, h, task) {
  const camp = g.camps.find((c) => c.key === task.camp);
  if (!camp || !camp.mobs.length) { h.task = { kind: 'idle' }; return; }
  if (dist2(h, camp) > 220 * 220) { g.moveToward(h, camp); return; }
  const mobs = camp.mobs.filter((m) => m.alive);
  const t = mobs.find((m) => m.big) || mobs[0];
  if (!t) return;
  if (castClear(g, h, [t])) return;
  if (!g.tryAttack(h, t)) g.moveToward(h, t, false, h.stats.range * 0.8 + t.radius);
}
