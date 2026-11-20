// ─────────────────────────────────────────────────────────────────────────────
// Hero AI
//   heroMacro (every 0.5s): what am I doing? lane / jungle / recall / calls / help / shrine…
//   heroThink (every tick):  combat brain — dodge, fight or flee, role positioning,
//                            target choice, ability use, kiting, farming, task movement.
// AI only knows what its team can see. All randomness goes through g.rng (deterministic).
// Personality/trust feed in through h.mods (see game.js personalities).
// ─────────────────────────────────────────────────────────────────────────────
import { DT, sec, BLUE } from './constants.js';
import { dist2, dist, norm } from './geom.js';

const LANES = ['top', 'mid', 'bot'];
const PLAN_RISK = { aggressive: 0.84, balanced: 1.0, scaling: 1.16 };
const CARRY = (h) => h.def.cls === 'marksman' || h.def.cls === 'mage';
const FRONT = (h) => h.def.cls === 'tank' || h.def.cls === 'bruiser';

// ── per-tick team context cache ──
function ctx(g, team) {
  const c = g._ai || (g._ai = [{ t: -1 }, { t: -1 }]);
  const k = c[team];
  if (k.t === g.tick) return k;
  k.t = g.tick;
  k.enemies = g.teams[1 - team].heroes.filter((e) => e.alive && g.vision[team].has(e.id));
  k.allies = g.teams[team].heroes.filter((a) => a.alive);
  k.projectiles = g.projectiles.filter((p) => !p.homing && p.team !== team);
  k.pending = g.pending.filter((p) => p.team !== team);
  return k;
}
const mods = (h) => h.mods || DEFAULT_MODS;
const DEFAULT_MODS = { aggro: 1, discipline: 1, dodge: 0.7, react: 6, greed: 1, peel: 1 };

// ── geometry helpers ──
const myProg = (g, team, lane, p) => { const pr = g.world.laneProgress(lane, p); return team === BLUE ? pr : 1 - pr; };
const lanePt = (g, team, lane, prog) => g.world.lanePoint(lane, team === BLUE ? prog : 1 - prog);
function enemyTowerAt(g, team, p, pad = 0) {
  for (const s of g.grid.query(p.x, p.y, 320 + pad)) if (s.type === 'tower' && s.alive && s.team !== team && dist2(s, p) < (s.stats.range + 18 + pad) ** 2) return s;
  return null;
}
function ownTowerAt(g, team, p) {
  for (const s of g.grid.query(p.x, p.y, 320)) if (s.type === 'tower' && s.alive && s.team === team && dist2(s, p) < (s.stats.range + 18) ** 2) return s;
  return null;
}
function minionCover(g, team, tower) {
  let n = 0;
  for (const u of g.grid.query(tower.x, tower.y, tower.stats.range)) if ((u.type === 'minion' || u.type === 'summon') && u.team === team && u.alive) n++;
  return n;
}
function frontline(g, team, lane) {
  let best = -1, towerProg = 0.1;
  for (const u of g.units) {
    if (!u.alive || u.team !== team) continue;
    if ((u.type === 'minion' || u.type === 'summon') && u.lane === lane) { const p = myProg(g, team, lane, u); if (p > best) best = p; }
    else if (u.type === 'tower' && u.lane === lane) { const p = myProg(g, team, lane, u); if (p > towerProg) towerProg = p; }
  }
  return { prog: best >= 0 ? best : towerProg - 0.02, hasWave: best >= 0, towerProg };
}
function safeSpot(g, h) {
  // nearest own tower that is closer to home than we are; else fountain
  const f = g.world.fountain[h.team];
  let best = f, bd = Infinity; const myHome = dist2(h, f);
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team && dist2(u, f) < myHome) {
    const d = dist2(u, h); if (d < bd) { bd = d; best = u; }
  }
  if (best === f) return f;
  // stand behind the tower, not inside it
  const d = norm(f.x - best.x, f.y - best.y);
  return g.world.nearestOpen({ x: best.x + d.x * 70, y: best.y + d.y * 70 });
}
function riskOf(g, h) {
  const plan = g.teams[h.team].plan;
  let r = PLAN_RISK[plan] || 1;
  if (plan === 'scaling' && g.time > 540) r = 1;
  if (plan === 'aggressive' && g.time > 720) r = 0.92;
  r /= mods(h).aggro;
  if (h.task.call && ['gank', 'objective', 'group', 'invade', 'contest', 'defend', 'shrine'].includes(h.task.kind)) r -= 0.12 * mods(h).discipline;
  return r;
}
// Lanchester strength of a group: (sum eHP) × (sum DPS). Towers count only if engaged.
function strength(g, list) { let e = 0, d = 0; for (const u of list) { e += g.ehp(u); d += u.dps; } return { e, d }; }

// ─────────────────────────── macro ───────────────────────────
export function heroMacro(g, h) {
  const now = g.tick, t = h.task;
  if (t.until && now > t.until) h.task = { kind: 'idle' };
  if (t.kind === 'gank' && t.done) h.task = { kind: 'idle' };
  if (t.kind !== 'ambush') h.ambushSet = 0;
  if (t.kind === 'objective') { const ob = g.objectives[t.obj]; if (t.started && (!ob || !ob.alive)) h.task = { kind: 'idle' }; }
  if (t.kind === 'shrine') { const sh = g.shrines[t.shrine]; if (!sh || sh.owner === h.team) h.task = { kind: 'idle' }; }
  const hpPct = h.hp / h.maxHp;
  const W = g.world, fountain = W.fountain[h.team];
  const atBase = dist2(h, fountain) < 360 * 360;
  const C = ctx(g, h.team);
  const enemiesClose = C.enemies.filter((e) => dist2(e, h) < 900 * 900).length;

  // wards: supports & junglers drop wards near key spots they pass
  if ((h.role === 'support' || h.role === 'jungle') && now >= h.wardCd) {
    for (const s of g.wardSpots(h.team)) if (dist2(h, s) < 240 * 240 && !g.wards.some((w) => w.team === h.team && dist2(w, s) < 220 * 220 && w.until > now)) {
      g.placeWard(h, s); h.wardCd = now + sec(h.role === 'support' ? 22 : 40); break;
    }
  }

  if (h.task.kind === 'recall') { if (atBase) h.task = { kind: 'heal' }; return; }
  if (h.task.kind === 'heal') { if (hpPct > 0.95 || !atBase) h.task = { kind: 'idle' }; else return; }
  if (atBase && hpPct < 0.75) { h.task = { kind: 'heal' }; return; }

  // recall logic (greedy heroes stay longer; calls hold unless critical)
  const critical = hpPct < 0.16;
  const low = hpPct < 0.34 / mods(h).greed;
  const nextCost = g.nextItemCost(h);
  const rich = h.gold >= nextCost + (h.role === 'jungle' ? 100 : 300) * mods(h).greed;
  const calm = now - h.lastCombat > sec(3) && enemiesClose === 0;
  if (!atBase && (critical || (calm && !h.task.call && (low || (rich && hpPct < 0.8) || h.gold > nextCost + 1400)))) { h.task = { kind: 'recall' }; return; }
  if (h.task.call || ['gank', 'contest', 'defend', 'help'].includes(h.task.kind)) return;

  // defend base
  const threat = baseThreat(g, h.team);
  if (threat && W.pathDist(h, threat) < 2400) { h.task = { kind: 'defend', x: threat.x, y: threat.y, until: now + sec(10) }; return; }
  // contest an objective the enemy is visibly taking
  const contest = contestTarget(g, h, C);
  if (contest) { h.task = { kind: 'contest', obj: contest.kind, until: now + sec(22) }; return; }
  // help a nearby ally who is fighting
  const help = helpTarget(g, h, C);
  if (help) { h.task = { kind: 'help', ally: help.id, until: now + sec(8) }; return; }
  // opportunistic shrine
  if (g.time >= 60 && hpPct > 0.5 && (h.role === 'jungle' || h.role === 'support' || g.time > 480) && (now + h.id * 3) % 40 === 0) {
    for (const sh of g.shrines) {
      if (sh.owner === h.team || W.pathDist(h, sh) > 700) continue;
      if (C.enemies.some((e) => dist2(e, sh) < 750 * 750)) continue;
      h.task = { kind: 'shrine', shrine: sh.id, until: now + sec(14) }; return;
    }
  }
  if (h.task.kind === 'shrine' && h.task.until > now) return;

  if (h.role === 'jungle') {
    if ((now + h.id * 7) % 80 === 0) { const lane = gankOpportunity(g, h, C); if (lane) { h.task = { kind: 'gank', lane, until: now + sec(18) }; return; } }
    if (h.task.kind !== 'jungle') h.task = { kind: 'jungle' };
    return;
  }
  if (h.task.kind !== 'lane' || h.task.lane !== h.lane) h.task = { kind: 'lane', lane: h.lane };
}

function baseThreat(g, team) {
  for (const s of g.units) {
    if (!s.alive || s.team !== team || !s.structure) continue;
    if (s.type === 'tower' && s.tier < 3) continue;
    let n = 0;
    for (const e of g.grid.query(s.x, s.y, 520)) if (e.alive && e.team !== team && g.canSee(team, e) && (e.type === 'hero' || e.type === 'summon' || (e.type === 'minion' && e.kind === 'super'))) n += e.type === 'hero' ? 1 : 0.5;
    if (n >= 1) return s;
  }
  return null;
}
function contestTarget(g, h, C) {
  for (const k of ['dragon', 'baron', 'herald']) {
    const o = g.objectives[k];
    if (!o || !o.alive || o.hp > o.maxHp * 0.92) continue;
    const on = C.enemies.filter((e) => dist2(e, o) < 650 * 650);
    if (!on.length) continue;
    const d = g.world.pathDist(h, o);
    if (d > (h.role === 'jungle' ? 2300 : 1600)) continue;
    const coming = C.allies.filter((a) => g.world.pathDist(a, o) < 1900).length;
    if (coming >= on.length - 1 || h.role === 'jungle') return o;
  }
  return null;
}
function helpTarget(g, h, C) {
  if (h.hp / h.maxHp < 0.45) return null;
  const range = h.role === 'jungle' ? 1100 : h.role === 'support' ? 900 : 650;
  let best = null, bs = 0;
  for (const a of C.allies) {
    if (a === h || g.tick - a.lastHurtByHero > sec(1.5)) continue;
    const d = dist(a, h); if (d > range) continue;
    const foes = C.enemies.filter((e) => dist2(e, a) < 600 * 600);
    if (!foes.length || foes.length > 3) continue;
    const s = (1 - a.hp / a.maxHp) + 1 - d / range;
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}
function gankOpportunity(g, h, C) {
  let best = null, bs = 0;
  for (const e of C.enemies) {
    if (e.role === 'jungle') continue;
    for (const lane of LANES) {
      if (g.world.distToLane(lane, e) > 300) continue;
      const deep = myProg(g, h.team, lane, e);
      if (deep > 0.54) continue;
      const d = g.world.pathDist(h, e); if (d > 1400) continue;
      const ally = C.allies.find((a) => a.lane === lane && dist2(a, e) < 750 * 750);
      if (!ally) continue;
      const eh = e.hp / e.maxHp;
      const score = (1 - eh) * 2 + (0.54 - deep) * 3 + ally.hp / ally.maxHp - d / 2000 + (e.flashCd > g.tick ? 0.4 : 0);
      if (score > bs) { bs = score; best = lane; }
    }
  }
  return bs > 0.85 && g.rng.chance(0.55 * mods(h).aggro) ? best : null;
}

// ─────────────────────────── micro ───────────────────────────
export function heroThink(g, h) {
  const now = g.tick;
  if (h.castLock > now) return;
  g.trySmite(h);
  const C = ctx(g, h.team);
  if (dodge(g, h, C)) return;
  const task = h.task;

  if (task.kind === 'recall' || task.kind === 'heal') {
    const threats = C.enemies.filter((e) => dist2(e, h) < 700 * 700);
    if (task.kind === 'recall' && !threats.length && now - h.lastCombat > sec(2)) {
      if (!h.recallAt) { h.recallAt = now + sec(4); h.vx = h.vy = 0; g.fx.push({ kind: 'recall', id: h.id }); }
      return;
    }
    if (threats.length && combat(g, h, C, true)) return;
    if (task.kind === 'heal') return;
    g.moveToward(h, g.world.fountain[h.team]); return;
  }
  if (combat(g, h, C, false)) return;

  switch (task.kind) {
    case 'lane': return doLane(g, h, task.lane, false);
    case 'split': return doLane(g, h, task.lane, true);
    case 'group': return doGroup(g, h, task.lane);
    case 'jungle': return doJungle(g, h);
    case 'gank': return doGank(g, h, task, C);
    case 'objective': return doObjective(g, h, task.obj, task, false);
    case 'contest': return doObjective(g, h, task.obj, task, true);
    case 'safe': return doSafe(g, h);
    case 'invade': return doInvade(g, h, task);
    case 'shrine': return doShrine(g, h, task);
    case 'ambush': {
      if (dist2(h, task) > 40 * 40) { g.moveToward(h, task); return; }
      if (!h.ambushSet) { h.ambushSet = task.until; h.stealthUntil = task.until; }
      h.vx = h.vy = 0; return;
    }
    case 'help': { const a = g.byId(task.ally); if (!a || !a.alive) { h.task = { kind: 'idle' }; return; } g.moveToward(h, a, true, 90); return; }
    case 'defend': { if (dist2(h, task) > 260 * 260) g.moveToward(h, task); else farmAround(g, h, 420, true); return; }
    default: return doLane(g, h, h.lane || 'mid', false);
  }
}

// Sidestep incoming skillshots and telegraphed ground AoEs.
function dodge(g, h, C) {
  if (h.stunUntil > g.tick || h.rootUntil > g.tick) return false;
  const m = mods(h);
  for (const p of C.pending) {
    if (dist2(p, h) > (p.r + h.radius) ** 2) continue;
    if (p.at - g.tick < 2) continue;
    if (!rollOnce(g, h, p, m.dodge * 0.9)) continue;
    const d = norm(h.x - p.x, h.y - p.y);
    const dd = d.x || d.y ? d : { x: 1, y: 0 };
    g.moveToward(h, { x: h.x + dd.x * (p.r + 30), y: h.y + dd.y * (p.r + 30) }, true);
    return true;
  }
  for (const p of C.projectiles) {
    if (!p.ab || !p.dx) continue;
    const rx = h.x - p.x, ry = h.y - p.y;
    const along = rx * p.dx + ry * p.dy; if (along < 0 || along > 420) continue;
    const perp = rx * p.dy - ry * p.dx; const hitW = p.width / 2 + h.radius + 4;
    if (Math.abs(perp) > hitW) continue;
    const eta = along / (p.speed * (p.speedMul || 1));
    if (eta < m.react * DT) continue; // too late to react
    if (!rollOnce(g, h, p, m.dodge)) continue;
    const side = perp >= 0 ? 1 : -1;
    g.moveToward(h, { x: h.x + p.dy * side * 60, y: h.y - p.dx * side * 60 }, true);
    return true;
  }
  return false;
}
function rollOnce(g, h, p, chance) {
  const key = p.id || (p.id = g.nextId++);
  h._dodged = h._dodged || {};
  if (h._dodged.k !== key) { h._dodged = { k: key, v: g.rng.chance(chance) }; }
  return h._dodged.v;
}

// The combat brain. Returns true if it controlled the hero this tick.
function combat(g, h, C, recalling) {
  const now = g.tick, hpPct = h.hp / h.maxHp, m = mods(h);
  const near = C.enemies.filter((e) => dist2(e, h) < 680 * 680);
  if (!near.length) { h.fightTarget = 0; return false; }
  const allies = C.allies.filter((a) => dist2(a, h) < 720 * 720);
  const A = strength(g, allies), E = strength(g, near);
  const et = enemyTowerAt(g, h.team, h, 10);
  if (et) { E.e += 1500; E.d += 160; }
  const ot = ownTowerAt(g, h.team, h);
  if (ot && near.some((e) => dist2(e, ot) < (ot.stats.range + 20) ** 2)) { A.e += 1500; A.d += 160; }
  const ratio = (A.e * A.d) / Math.max(1, E.e * E.d);
  const risk = riskOf(g, h);
  const focus = g.teams[h.team].focus;

  // ── target choice (sticky) ──
  let best = null, bestScore = -Infinity;
  const allyBurst = allies.filter((a) => a !== h).reduce((s, a) => s + a.burst * 0.45, 0);
  for (const e of near) {
    const d = dist(h, e);
    if (d > h.stats.range + 480) continue;
    const ehp = g.ehp(e);
    const killable = h.burst * 0.75 + allyBurst > ehp;
    let s = 1000 - d * 0.9 + (1 - e.hp / e.maxHp) * 450 + (killable ? 500 : 0);
    if (focus && focus.id === e.id) s += 900;
    if (CARRY(e)) s += h.def.cls === 'assassin' ? 350 : 140;
    if (h.fightTarget === e.id) s += 180;
    // threats on my carries get peeled
    if ((h.role === 'support' || FRONT(h)) && allies.some((a) => CARRY(a) && dist2(a, e) < 220 * 220)) s += 260 * m.peel;
    const tw = enemyTowerAt(g, h.team, e, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && !(killable && hpPct > 0.5)) s -= 900;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const killable = best && (h.burst * 0.75 + allyBurst) > g.ehp(best);

  // ── flee? ──
  const fleeHp = (h.def.cls === 'tank' ? 0.17 : 0.25) * m.discipline;
  const mustFlee = (hpPct < fleeHp && !(killable && hpPct > 0.12)) || (ratio < 0.55 * risk && !killable) || (recalling && ratio < 1.4);
  if (mustFlee) return flee(g, h, near, allies);
  if (recalling || !best) return false;

  const laning = h.task.kind === 'lane' || h.task.kind === 'jungle' || h.task.kind === 'split';
  const engageAt = laning ? risk * 1.7 : risk * 1.08;
  const beingHit = now - h.lastHurtByHero < sec(1.2);
  let want;
  if (laning) {
    const allIn = (killable && hpPct > 0.35 && best.hp / best.maxHp < 0.5) || ratio >= engageAt;
    if (h.disengageUntil > now && !allIn) {
      if (near.some((e) => dist2(e, h) < (e.stats.range + 150) ** 2)) { g.moveToward(h, safeSpot(g, h)); return true; }
      return false;
    }
    if (allIn) want = true;
    else if (beingHit) {
      if (ratio >= risk * 1.3 && hpPct > 0.55) { want = true; h.tradeStart = h.tradeStart || now; }
      else { h.disengageUntil = now + sec(3); g.moveToward(h, safeSpot(g, h)); return true; }
    } else want = false;
    if (want && !allIn && h.tradeStart && now - h.tradeStart > sec(2)) { h.tradeStart = 0; h.disengageUntil = now + sec(4); return false; }
    if (hpPct < 0.5 && !allIn) { h.disengageUntil = now + sec(4); g.moveToward(h, safeSpot(g, h)); return true; }
    if (!want) {
      h.tradeStart = 0;
      // harass: ranged heroes poke when the enemy steps up to last-hit
      if (hpPct > 0.55 && castPoke(g, h, best, m)) return true;
      if (h.def.ranged && hpPct > 0.6 && ratio > risk && dist2(h, best) < (h.stats.range + best.radius + h.radius) ** 2 && !enemyTowerAt(g, h.team, h, 0) && g.rng.chance(0.08 * m.aggro)) { g.tryAttack(h, best); return true; }
      return false;
    }
  } else {
    want = (killable && hpPct > 0.3) || ratio >= engageAt || (beingHit && ratio >= risk * 0.85)
      || (h.task.kind === 'objective' && ratio >= risk * 0.85) || (h.fightTarget === best.id && now - h.lastCombat < sec(1.5) && ratio >= risk * 0.9);
  }
  if (castAllySustain(g, h, allies)) return true;
  if (!want) return false;

  // ── fight ──
  h.fightTarget = best.id;
  // supports & carries prioritise peel when a diver is on our carry
  if (h.role === 'support') { const diver = near.find((e) => allies.some((a) => CARRY(a) && a !== h && dist2(a, e) < 180 * 180)); if (diver && castPeel(g, h, diver)) return true; }
  if (castCombat(g, h, best, near, allies, killable)) return true;
  return position(g, h, best, near, killable);
}

// Role-aware positioning + attacking with kiting for ranged heroes.
function position(g, h, t, near, killable) {
  const now = g.tick;
  const rng = h.stats.range + h.radius + t.radius;
  const d = dist(h, t);
  if (h.def.ranged) {
    // keep the closest enemy at arm's length; attack when ready, step back between attacks
    let closest = null, cd = Infinity; for (const e of near) { const x = dist(h, e); if (x < cd) { cd = x; closest = e; } }
    const threatened = closest && !closest.def.ranged && cd < closest.stats.range + 70;
    if (d <= rng && now >= h.attackCd) { g.tryAttack(h, t); return true; }
    if (threatened && h.attackCd - now > 3) {
      const away = norm(h.x - closest.x, h.y - closest.y);
      g.moveToward(h, { x: h.x + away.x * 60, y: h.y + away.y * 60 }, true); return true;
    }
    if (d > rng * 0.95) {
      const tw = enemyTowerAt(g, h.team, t, 0);
      if (tw && minionCover(g, h.team, tw) < 2 && !(killable && h.hp / h.maxHp > 0.45)) return false;
      if (!chaseOk(g, h, t, killable)) return false;
      g.moveToward(h, t, true, rng * 0.85); return true;
    }
    if (g.tryAttack(h, t)) return true;
    return true;
  }
  if (g.tryAttack(h, t)) return true;
  const tw = enemyTowerAt(g, h.team, t, 0);
  if (tw && minionCover(g, h.team, tw) < 2 && !(killable && h.hp / h.maxHp > 0.45)) return false;
  if (!chaseOk(g, h, t, killable)) return false;
  g.moveToward(h, t, true, rng * 0.8);
  return true;
}
function chaseOk(g, h, t, killable) {
  const now = g.tick;
  if (!killable && dist2(h, t) > (h.stats.range + 200) ** 2 && h.task.kind !== 'gank') return false;
  if (!h.chaseFrom || now - h.lastCombat > sec(3)) h.chaseFrom = { x: h.x, y: h.y };
  return dist2(h, h.chaseFrom) < 800 * 800 || (killable && t.hp / t.maxHp < 0.15);
}

function flee(g, h, near, allies) {
  const now = g.tick, hpPct = h.hp / h.maxHp;
  // Flash (one emergency blink per ~110s)
  if (now >= h.flashCd && hpPct < 0.3 && near.some((e) => dist2(e, h) < 260 * 260)) {
    const away = fleePoint(g, h, near), dd = norm(away.x - h.x, away.y - h.y);
    const end = g.rayEnd(h, { x: h.x + dd.x * 175, y: h.y + dd.y * 175 });
    if (dist2(end, h) > 70 * 70) { h.flashCd = now + sec(110); g.fx.push({ kind: 'flash', id: h.id, x: h.x, y: h.y }); h.x = end.x; h.y = end.y; return true; }
  }
  for (let i = 0; i < 3; i++) {
    const ab = h.def.abilities[i];
    if (!g.abilityReady(h, i)) continue;
    if (ab.use.includes('escape') && ab.kind === 'dash') { g.cast(h, i, null, fleePoint(g, h, near)); return true; }
    if ((ab.use.includes('escape') || ab.use.includes('defend')) && ab.kind === 'self') { g.cast(h, i, null, null); return true; }
  }
  const chaser = near.reduce((a, b) => (dist2(a, h) < dist2(b, h) ? a : b));
  if (dist2(chaser, h) < 250 * 250 && castPeel(g, h, chaser)) return true;
  if (castAllySustain(g, h, allies)) return true;
  // ranged heroes shoot a chaser that's already in range while backing off
  if (h.def.ranged && g.tick >= h.attackCd && dist2(chaser, h) < (h.stats.range + chaser.radius + h.radius) ** 2 && hpPct > 0.15) { g.tryAttack(h, chaser); return true; }
  g.moveToward(h, safeSpot(g, h));
  return true;
}
function fleePoint(g, h, threats) {
  let ax = 0, ay = 0;
  for (const e of threats) { const d = norm(h.x - e.x, h.y - e.y); ax += d.x; ay += d.y; }
  const home = norm(g.world.fountain[h.team].x - h.x, g.world.fountain[h.team].y - h.y);
  const d = norm(ax + home.x * 1.3, ay + home.y * 1.3);
  return g.rayEnd(h, { x: h.x + d.x * 320, y: h.y + d.y * 320 });
}

// ─────────────────────────── casting ───────────────────────────
const inRange = (h, t, r) => dist2(h, t) <= (r + (t.radius || 0)) ** 2;
function lead(t, time) { return { x: t.x + (t.vx || 0) / DT * time, y: t.y + (t.vy || 0) / DT * time }; }
function castAt(g, h, i, t) {
  const ab = h.def.abilities[i];
  switch (ab.kind) {
    case 'shot': case 'hook': {
      if (!inRange(h, t, ab.range * 0.9)) return false;
      const time = dist(h, t) / ((ab.speed || 800) * g.wx.proj);
      g.cast(h, i, t, lead(t, time * 0.85)); return true;
    }
    case 'line': if (!inRange(h, t, ab.range * 0.92)) return false; g.cast(h, i, t, lead(t, 0.1)); return true;
    case 'target': if (!inRange(h, t, ab.range + 8)) return false; g.cast(h, i, t); return true;
    case 'circle': case 'zone': {
      if (!inRange(h, t, ab.range)) return false;
      g.cast(h, i, t, lead(t, (ab.delay || 0.4) * 0.6)); return true;
    }
    case 'nova': if (!inRange(h, t, ab.radius * 0.88)) return false; g.cast(h, i, t); return true;
    case 'dash': {
      if (!inRange(h, t, ab.range + (ab.radius ? ab.radius * 0.5 : 0))) return false;
      if (!g.world.los(h.x, h.y, t.x, t.y)) return false;
      g.cast(h, i, t); return true;
    }
    case 'self': g.cast(h, i, null); return true;
  }
  return false;
}
function countIn(g, h, p, r) { let n = 0; for (const e of g.grid.query(p.x, p.y, r)) if (e.type === 'hero' && e.alive && e.team !== h.team && g.vision[h.team].has(e.id)) n++; return n; }

function castCombat(g, h, t, near, allies, killable) {
  const fight = near.length + allies.length;
  for (let i = 2; i >= 0; i--) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i], u = ab.use;
    if (ab.kind === 'ally' || ab.kind === 'allynova') continue;
    if (ab.kind === 'self') {
      if ((u.includes('engage') || u.includes('teamfight')) && dist2(h, t) < (h.stats.range + 140) ** 2) { g.cast(h, i, null); return true; }
      if (u.includes('defend') && h.hp / h.maxHp < 0.6 && g.tick - h.lastHurtByHero < sec(1)) { g.cast(h, i, null); return true; }
      continue;
    }
    if (ab.kind === 'dash' && !ab.dmg && !ab.cc) continue; // pure escape
    // don't dash into a fight we're losing or under their tower
    if (ab.kind === 'dash' && enemyTowerAt(g, h.team, t, 0) && !killable) continue;
    const dmg = g.abilityDamage(h, ab, t);
    const exec = t.hp < dmg * 1.05 || (u.includes('execute') && t.hp / t.maxHp < 0.4);
    let ok = false;
    if (u.includes('execute') && exec) ok = true;
    if (u.includes('engage')) ok = true;
    if (u.includes('poke') && !ab.ult) ok = true;
    if (u.includes('teamfight')) {
      const at = ab.kind === 'nova' ? h : t;
      const n = countIn(g, h, at, ab.radius || 150);
      ok = n >= 2 || (fight >= 5 && n >= 1) || killable || t.hp / t.maxHp < 0.4 || (u.includes('execute') && exec);
    } else if (ab.ult && u.includes('execute') && !exec && !killable) ok = false;
    if (u.includes('peel') && !u.includes('engage') && !u.includes('poke')) ok = ok || dist2(t, h) < 170 * 170;
    if (ok && castAt(g, h, i, t)) return true;
  }
  return false;
}
function castPoke(g, h, t, m) {
  if (!g.rng.chance(0.02 * m.aggro)) return false; // stands in for mana: occasional pokes
  for (let i = 0; i < 2; i++) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i];
    if (!ab.use.includes('poke') || ab.kind === 'dash' || ab.kind === 'nova') continue;
    if (ab.kind === 'target' && enemyTowerAt(g, h.team, t, 0)) continue;
    if (castAt(g, h, i, t)) return true;
  }
  return false;
}
function castPeel(g, h, t) {
  for (let i = 0; i < 3; i++) {
    if (!g.abilityReady(h, i)) continue;
    const ab = h.def.abilities[i];
    if (!ab.cc || !(ab.use.includes('peel') || ab.use.includes('engage'))) continue;
    if (ab.ult && t.hp / t.maxHp > 0.5) continue;
    if (castAt(g, h, i, t)) return true;
  }
  return false;
}
function castAllySustain(g, h, allies) {
  for (let i = 0; i < 3; i++) {
    const ab = h.def.abilities[i];
    if ((ab.kind !== 'ally' && ab.kind !== 'allynova') || !g.abilityReady(h, i)) continue;
    if (ab.kind === 'ally') {
      let best = null, bv = 0.7;
      for (const a of allies) { const v = a.hp / a.maxHp - (CARRY(a) ? 0.08 : 0); if (v < bv && dist2(a, h) < (ab.range + 10) ** 2 && g.tick - a.lastCombat < sec(4)) { bv = v; best = a; } }
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
    if (!ab.use.includes('clear') || !ab.dmg || ab.cd > 13) continue;
    const t = mobs[0];
    const r = ab.radius || ab.width || 60;
    const n = mobs.filter((m) => dist2(m, t) < (r + 30) ** 2).length;
    if (n >= 3 || t.type === 'mob' || t.type === 'objective') { if (castAt(g, h, i, t)) return true; }
  }
  return false;
}

// ─────────────────────────── behaviours ───────────────────────────
function farmAround(g, h, r, includeStructures) {
  const tmp = g.grid.query(h.x, h.y, r);
  let lastHit = null, low = null, lowHp = Infinity, tower = null;
  const myDmg = h.stats.ad;
  const mobs = [];
  for (const e of tmp) {
    if (!e.alive || e.team === h.team) continue;
    if (e.type === 'minion' || e.type === 'summon') {
      mobs.push(e);
      // health prediction: count allied minions hitting it
      let incoming = 0; for (const a of tmp) if (a.type === 'minion' && a.team === h.team && a.target === e) incoming += a.stats.ad * 0.4;
      if (e.hp <= myDmg + 4 + incoming) { if (!lastHit || e.hp < lastHit.hp) lastHit = e; }
      if (e.hp < lowHp) { lowHp = e.hp; low = e; }
    } else if (includeStructures && e.structure && g.isTargetable(e)) tower = e;
  }
  if (tower && minionCover(g, h.team, tower.type === 'tower' ? tower : { ...tower, stats: { range: 280 } }) >= 1 && (!lastHit || dist2(h, tower) < (h.stats.range + 60) ** 2)) {
    if (!(tower.type === 'tower' && tower.target === h)) { if (!g.tryAttack(h, tower)) g.moveToward(h, tower, true, h.stats.range * 0.8 + tower.radius); return true; }
  }
  if (castClear(g, h, mobs)) return true;
  const pushing = h.task.kind !== 'lane' || g.teams[h.team].plan === 'aggressive';
  const target = lastHit || (low && (low.hp > myDmg * 2.4 || pushing) ? low : null);
  if (target) {
    const tw = enemyTowerAt(g, h.team, target, -10);
    if (tw && (minionCover(g, h.team, tw) < 1 || tw.target === h)) return false;
    if (!g.tryAttack(h, target)) g.moveToward(h, target, true, h.stats.range * 0.8 + target.radius);
    return true;
  }
  if (low) { if (dist2(h, low) > (h.stats.range + 40) ** 2) { g.moveToward(h, low, true, h.stats.range * 0.9); return true; } h.vx = h.vy = 0; return true; }
  return false;
}
function minionPressure(g, h) { let n = 0; for (const m of g.grid.query(h.x, h.y, 260)) if (m.alive && m.type === 'minion' && m.team !== h.team && m.target === h) n++; return n; }

function doLane(g, h, lane, push) {
  const fl = frontline(g, h.team, lane);
  const towerOnMe = g.grid.query(h.x, h.y, 300).find((s) => s.type === 'tower' && s.alive && s.team !== h.team && s.target === h);
  if (towerOnMe || (minionPressure(g, h) >= 3 && h.hp / h.maxHp < 0.7)) {
    g.moveToward(h, lanePt(g, h.team, lane, Math.max(0.04, (fl.hasWave ? fl.prog : fl.towerProg) - 0.09))); return;
  }
  // supports walk with their carry in lane
  if (h.role === 'support' && !push) {
    const carry = g.teams[h.team].heroes.find((a) => a.alive && a.role === 'bot' && a.task.kind === 'lane');
    if (carry && dist2(carry, h) < 900 * 900) {
      const C = ctx(g, h.team);
      const foe = C.enemies.find((e) => dist2(e, carry) < 500 * 500);
      const toward = foe ? norm(foe.x - carry.x, foe.y - carry.y) : { x: 0, y: 0 };
      const spot = g.world.nearestOpen({ x: carry.x + toward.x * 50 - toward.y * 40, y: carry.y + toward.y * 50 + toward.x * 40 });
      if (dist2(h, spot) > 40 * 40) g.moveToward(h, spot, true); else farmAround(g, h, 300, false) || (h.vx = h.vy = 0);
      return;
    }
  }
  const back = h.def.ranged ? 0.05 : 0.025;
  let prog = fl.hasWave ? fl.prog - back : fl.towerProg - 0.03;
  if (push && fl.hasWave) prog = fl.prog - 0.005;
  prog = Math.max(0.04, prog);
  let hold = lanePt(g, h.team, lane, prog);
  const tw = enemyTowerAt(g, h.team, hold, 40);
  const heroesNear = ctx(g, h.team).enemies.some((e) => dist2(e, h) < 650 * 650);
  if (tw && (minionCover(g, h.team, tw) < 2 || heroesNear)) {
    if (farmAround(g, h, 360, false)) return;
    hold = lanePt(g, h.team, lane, Math.max(0.04, myProg(g, h.team, lane, tw) - 0.1));
    g.moveToward(h, hold); return;
  }
  if (dist2(h, hold) > 520 * 520) { g.moveToward(h, hold); return; }
  if (farmAround(g, h, 420, true)) return;
  if (dist2(h, hold) > 30 * 30) g.moveToward(h, hold, true); else { h.vx = h.vy = 0; }
}

function doGroup(g, h, lane) {
  const fl = frontline(g, h.team, lane);
  const team = g.teams[h.team].heroes.filter((a) => a.alive && a.task.kind === 'group');
  const lead = fl.hasWave ? fl.prog : fl.towerProg;
  const p = lanePt(g, h.team, lane, Math.max(0.05, lead - (h.def.ranged ? 0.03 : 0.008)));
  const gathered = team.filter((a) => dist2(a, p) < 700 * 700).length;
  if (gathered < Math.min(3, team.length) && dist2(h, p) < 600 * 600) {
    if (farmAround(g, h, 300, false)) return;
    g.moveToward(h, lanePt(g, h.team, lane, Math.max(0.05, lead - 0.07))); return;
  }
  if (dist2(h, p) > 450 * 450) { g.moveToward(h, p); return; }
  if (farmAround(g, h, 460, true)) return;
  g.moveToward(h, p, true);
}

function doJungle(g, h) {
  const here = g.grid.query(h.x, h.y, 260).filter((m) => m.type === 'mob' && m.alive).sort((a, b) => (b.big - a.big) || a.id - b.id);
  if (here.length) {
    const t = here.find((m) => m.target === h) || here[0];
    if (castClear(g, h, [t, ...here.filter((m) => m !== t)])) return;
    if (!g.tryAttack(h, t)) g.moveToward(h, t, true, h.stats.range * 0.8 + t.radius);
    return;
  }
  let best = null, bv = Infinity;
  for (const c of g.camps) {
    if (c.side !== h.team) continue;
    const alive = c.mobs.length > 0;
    const soon = !alive && c.respawnAt > 0 && c.respawnAt - g.tick < sec(8);
    if (!alive && !soon) continue;
    const v = g.world.pathDist(h, c) / (c.def.buff ? 1.5 : 1) + (soon ? 400 : 0);
    if (v < bv) { bv = v; best = c; }
  }
  if (best) { g.moveToward(h, best); return; }
  // nothing up: hover the lane most likely to need help
  doLane(g, h, g.time > 540 ? 'mid' : (h.team === BLUE ? 'bot' : 'top'), false);
}

function doGank(g, h, task, C) {
  const lane = task.lane;
  let tgt = null, bd = Infinity;
  for (const e of C.enemies) { if (g.world.distToLane(lane, e) > 350) continue; const d = dist2(h, e); if (d < bd) { bd = d; tgt = e; } }
  if (tgt) {
    const tw = enemyTowerAt(g, h.team, tgt, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && tgt.hp / tgt.maxHp > 0.35) { task.done = g.tick - (task.arrived || g.tick) > sec(5); g.moveToward(h, lanePt(g, h.team, lane, myProg(g, h.team, lane, tw) - 0.1)); return; }
    // approach through brush/flank: stay out of their vision until close
    g.moveToward(h, tgt); return;
  }
  const fl = frontline(g, h.team, lane);
  const p = lanePt(g, h.team, lane, Math.max(0.1, fl.prog - 0.02));
  if (dist2(h, p) < 250 * 250) { task.arrived = task.arrived || g.tick; if (g.tick - task.arrived > sec(6)) task.done = true; farmAround(g, h, 350, false); return; }
  g.moveToward(h, p);
}

function doObjective(g, h, obj, task, contest) {
  const pit = obj === 'dragon' ? g.world.pits.kami : g.world.pits.kraken;
  const ob = g.objectives[obj];
  if (dist2(h, pit) > 320 * 320) { g.moveToward(h, pit); return; }
  if (!ob || !ob.alive) {
    if (!contest && g.objTimers[obj] && g.objTimers[obj] - g.tick < sec(25)) { h.vx = h.vy = 0; return; }
    task.until = Math.min(task.until || Infinity, g.tick + sec(2));
    return;
  }
  task.started = true;
  const helpers = g.teams[h.team].heroes.filter((a) => a.alive && dist2(a, pit) < 420 * 420).length;
  if (!contest && helpers < 2 && ob.hp > ob.maxHp * 0.6) { h.vx = h.vy = 0; return; }
  if (contest && h.role !== 'jungle' && ob.hp > ob.maxHp * 0.3) { farmAround(g, h, 300, false); return; }
  if (contest && h.role === 'jungle' && dist2(h, ob) > 200 * 200) { g.moveToward(h, ob, true, 150); return; }
  if (castClear(g, h, [ob])) return;
  if (!g.tryAttack(h, ob)) g.moveToward(h, ob, true, h.stats.range * 0.8 + ob.radius);
}

function doSafe(g, h) {
  if (h.role === 'jungle') { doJungle(g, h); return; }
  const lane = h.lane || g.laneOf(h);
  let tw = null, bp = -1;
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team && u.lane === lane) { const p = myProg(g, h.team, lane, u); if (p > bp) { bp = p; tw = u; } }
  const spot = tw ? lanePt(g, h.team, lane, Math.max(0.03, bp - 0.04)) : g.world.fountain[h.team];
  if (dist2(h, spot) > 140 * 140) { g.moveToward(h, spot); return; }
  if (tw) for (const e of g.grid.query(tw.x, tw.y, tw.stats.range)) if (e.alive && e.team !== h.team && e.type === 'minion' && e.hp <= h.stats.ad) { if (!g.tryAttack(h, e)) g.moveToward(h, e, true, h.stats.range * 0.8); return; }
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
  if (!g.tryAttack(h, t)) g.moveToward(h, t, true, h.stats.range * 0.8 + t.radius);
}

function doShrine(g, h, task) {
  const sh = g.shrines[task.shrine];
  if (!sh || sh.owner === h.team) { h.task = { kind: 'idle' }; return; }
  if (dist2(h, sh) > 70 * 70) g.moveToward(h, sh); else { if (!farmAround(g, h, 200, false)) { h.vx = h.vy = 0; } }
}
