// ─────────────────────────────────────────────────────────────────────────────
// Hero AI
//   heroMacro (every 0.5s): what am I doing? lane / jungle / recall / calls / help / shrine…
//   heroThink (every tick):  combat brain — dodge, fight or flee, role positioning,
//                            target choice, ability use, kiting, farming, task movement.
// AI only knows what its team can see. All randomness goes through g.rng (deterministic).
// Personality/trust feed in through h.mods (see game.js personalities).
// ─────────────────────────────────────────────────────────────────────────────
import { DT, sec, BLUE, MOMENTUM } from './constants.js';
import { dist2, dist, norm, segDist2 } from './geom.js';

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
  // short memory: an enemy that blinked out of sight <0.75s ago is still "there" (stops fight/flight flicker at vision edges)
  const ls = g.lastSeen[team];
  k.enemies = g.teams[1 - team].heroes.filter((e) => e.alive && (g.vision[team].has(e.id) || (ls[e.id] && g.tick - ls[e.id].t < 15 && !(e.stealthUntil > g.tick))));
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
  let best = -1, towerProg = 0.1, foe = 2;
  for (const u of g.units) {
    if (!u.alive || u.lane !== lane) continue;
    if (u.type === 'minion' || u.type === 'summon') { const p = myProg(g, team, lane, u); if (u.team === team) { if (p > best) best = p; } else if (p < foe) foe = p; }
    else if (u.type === 'tower' && u.team === team) { const p = myProg(g, team, lane, u); if (p > towerProg) towerProg = p; }
  }
  // where the two waves will meet (both march at the same speed); a missing wave counts from its base
  const meet = foe < 2 && best < foe ? ((best >= 0 ? best : 0.03) + foe) / 2 : best >= 0 ? best : towerProg - 0.02;
  return { prog: best >= 0 ? best : towerProg - 0.02, hasWave: best >= 0, towerProg, foe, meet };
}
function safeSpot(g, h) {
  // Retreat *along the lane* toward home: the nearest own tower behind us in this lane, else the base.
  const W = g.world, f = W.fountain[h.team];
  const lane = W.closestLane(h);
  if (W.distToLane(lane, h) < 420) {
    const me = myProg(g, h.team, lane, h);
    let best = null, bp = -1;
    for (const u of g.units) {
      if (u.type !== 'tower' || !u.alive || u.team !== h.team || u.lane !== lane) continue;
      const p = myProg(g, h.team, lane, u);
      if (p < me - 0.02 && p > bp) { bp = p; best = u; }
    }
    if (best) return W.nearestOpen(lanePt(g, h.team, lane, Math.max(0.02, bp - 0.045)));
  }
  return f;
}
// A short step back down our own lane (out of trading range), not the long walk to a tower.
function stepBack(g, h) {
  const W = g.world, lane = W.closestLane(h);
  if (W.distToLane(lane, h) > 420) return safeSpot(g, h);
  return W.nearestOpen(lanePt(g, h.team, lane, Math.max(0.03, myProg(g, h.team, lane, h) - 0.08)));
}
function riskOf(g, h) {
  const plan = g.teams[h.team].plan;
  let r = PLAN_RISK[plan] || 1;
  if (plan === 'scaling' && g.time > 540) r = 1;
  if (plan === 'aggressive' && g.time > 720) r = 0.92;
  r /= mods(h).aggro;
  if (h.task.call && ['gank', 'objective', 'group', 'invade', 'contest', 'defend', 'shrine'].includes(h.task.kind)) r -= 0.12 * mods(h).discipline;
  if (h.task.kind === 'permit') r -= 0.16; // the coach gave the green light
  return r;
}
// Lanchester strength of a group: (sum eHP) × (sum DPS). Ready spells count as extra DPS
// spread over a ~3s skirmish, so a team with ultimates up is rated stronger than one without.
function strength(g, list) { let e = 0, d = 0; for (const u of list) { e += g.ehp(u); d += (u.dps + readyBurst(g, u, null) / 3) * surgeK(g, u); } return { e, d }; }
// A team under Kami Surge hits harder (and is rated so on both sides).
const surgeK = (g, u) => (g.teams[u.team].surgeUntil > g.tick ? 1 + MOMENTUM.dmg : 1);
function readyBurst(g, h, t) {
  let b = 0;
  for (let i = 0; i < 3; i++) { const ab = h.def.abilities[i]; if (ab.dmg && g.abilityReady(h, i)) b += g.abilityDamage(h, ab, t); }
  return b;
}
// Respect the fog: enemies we lost sight of who could plausibly arrive within ~3s count
// (partially) toward the enemy side of a fight.
function fogThreat(g, h, C) {
  const ls = g.lastSeen[h.team], now = g.tick; let e = 0, d = 0;
  for (const x of g.teams[1 - h.team].heroes) {
    if (!x.alive || C.enemies.includes(x)) continue;
    const seen = ls[x.id];
    let w = 0;
    if (seen) {
      const gone = (now - seen.t) / 20, reach = (gone + 3) * x.stats.ms;
      const dd = Math.sqrt((seen.x - h.x) ** 2 + (seen.y - h.y) ** 2);
      if (dd < reach + 300) w = gone < 6 ? 0.6 : 0.35;
    } else w = g.time > 90 ? 0.25 : 0;
    // deeper in enemy territory = more likely to be collapsed on
    if (w && myProgAny(g, h) > 0.55) w += 0.15;
    e += g.ehp(x) * w; d += x.dps * w;
  }
  return { e, d };
}
const myProgAny = (g, h) => { const ln = g.world.closestLane(h); return myProg(g, h.team, ln, h); };

// Tower-dive math: can we (with whoever is committing) kill `t` and walk out alive?
// Value targets (bounties, near-dead carries, Last Stand) justify a thinner safety margin.
function diveOk(g, h, t, allies, near) {
  const tw = enemyTowerAt(g, h.team, t, 0) || enemyTowerAt(g, h.team, h, 0);
  if (!tw) return true;
  const divers = allies.filter((a) => a === h || (dist2(a, t) < 480 * 480 && a.hp / a.maxHp > 0.35));
  let dps = 0, burst = 0;
  for (const a of divers) { dps += a.dps * surgeK(g, a); burst += readyBurst(g, a, t) * surgeK(g, a); }
  const ttk = Math.max(0, g.ehp(t) - burst * 0.9) / Math.max(1, dps);
  if (ttk > 2.6) return false;
  // who eats the tower shots? minions first, then a healthier frontliner
  const cover = minionCover(g, h.team, tw);
  const tank = divers.some((a) => a !== h && FRONT(a) && a.hp > h.hp * 1.1);
  const share = cover >= 3 && !(tw.target === h) ? 0.15 : tank ? 0.45 : 1;
  const towerDps = tw.stats.ad * tw.stats.as * 0.8 * (1 + Math.min(1.2, (tw.streak || 0) * 0.35));
  const exitT = Math.max(0, tw.stats.range + 30 - Math.sqrt(dist2(tw, t))) / Math.max(150, g.moveSpeed(h));
  let enemyDps = 0; for (const e of near) if (dist2(e, t) < 600 * 600) enemyDps += e.dps * surgeK(g, e);
  const exposure = ttk + 0.35 + exitT;
  const taken = towerDps * share * exposure + enemyDps * ttk / Math.max(1, divers.length);
  const value = (t.killStreak >= 3 ? 1 : 0) + (t.hp / t.maxHp < 0.2 ? 0.6 : 0) + (CARRY(t) ? 0.3 : 0) + (g.finalPhase ? 0.4 : 0);
  const margin = Math.max(0.06, 0.32 - 0.1 * value) * h.maxHp;
  return g.ehp(h) - taken > margin;
}

// ─────────────────────────── lane coverage brain ───────────────────────────
// Team-level coordinator (every 0.5s, deterministic). Tracks every lane's wave and tower threat and
// sends the nearest sensible free hero to catch a wave that would otherwise crash into a tower with
// nobody home. Calls, objectives and late grouping keep their heroes (at most one is peeled off a
// 4-5 man group). When a wave is hitting a tower and no hero is there it raises `laneOpen` (UI alert).
const SIEGE_RANGE = 340;
export function laneBrain(g, team) {
  const W = g.world, now = g.tick, T = g.teams[team];
  const L = T.lanes || (T.lanes = {});
  const open = T.laneOpen || (T.laneOpen = {});
  const allies = g.teams[team].heroes;
  for (const lane of W.laneNames) {
    const st = L[lane] || (L[lane] = { need: 0, crash: null, tower: 0, cover: 0, quietAt: 0, openAt: 0 });
    // our outermost standing structure in this lane (tower, then inhibitor)
    let tw = null, twp = -1;
    for (const u of g.units) if (u.alive && u.team === team && u.lane === lane && (u.type === 'tower' || u.type === 'inhib')) { const p = myProg(g, team, lane, u); if (p > twp) { twp = p; tw = u; } }
    // enemy wave in our half: deepest minion, its HP; our minions meeting it
    let deep = null, dp = 2, ehp = 0, ahp = 0, hitting = false;
    for (const u of g.units) {
      if (!u.alive || (u.type !== 'minion' && u.type !== 'summon') || u.lane !== lane) continue;
      const p = myProg(g, team, lane, u);
      if (u.team !== team) {
        if (p > 0.55) continue;
        ehp += u.hp; if (p < dp) { dp = p; deep = u; }
        if (u.target && u.target.structure && u.target.team === team && now - u.animAttack < 40) hitting = true;
      } else if (p < 0.6) ahp += u.hp;
    }
    st.tower = tw ? tw.id : 0; st.hitting = hitting;
    const towerLen = tw ? (dp - twp) * W.laneLen[lane][W.laneLen[lane].length - 1] : 9999;
    const eta = deep ? Math.max(0, towerLen - SIEGE_RANGE) / 72 : 99; // seconds until the wave reaches the tower
    // need: 2 = hitting a structure now, 1 = a winning enemy wave will get there soon with nobody to meet it
    st.need = hitting ? 2 : deep && ehp > ahp * 1.25 + 250 && eta < 14 ? 1 : 0;
    st.crash = deep ? { x: deep.x, y: deep.y } : null;
    if (!st.need) { if (!st.quietAt) st.quietAt = now; if (open[lane] && now - st.quietAt > sec(3)) open[lane] = null; continue; }
    st.quietAt = 0;
    const spot = tw && hitting ? tw : st.crash;
    // who is already on it?
    let present = false, covering = null;
    for (const a of allies) {
      if (!a.alive || a.recallAt) continue;
      if (dist2(a, spot) < 900 * 900) present = true;
      const k = a.task.kind;
      if ((k === 'cover' || k === 'lane' || k === 'split') && a.task.lane === lane) { covering = a; }
    }
    if (present && covering) continue;
    // alert: a wave is hitting our structure and no hero is there
    if (hitting && !present) {
      if (!open[lane]) { open[lane] = { tower: tw ? tw.id : 0, since: now, hero: 0 }; if (now - st.openAt > sec(20)) { st.openAt = now; g.emit({ type: 'laneOpen', team, lane, tower: tw ? tw.id : 0, tier: tw ? tw.tier || 0 : 0, coming: covering ? covering.id : 0 }); } }
    }
    if (covering) { if (open[lane]) open[lane].hero = covering.id; continue; }
    // pick the cheapest free hero (seconds to arrive + what it would give up)
    const grouped = allies.filter((a) => a.alive && a.task.kind === 'group').length;
    let best = null, bc = Infinity, anyBest = null, ac = Infinity;
    for (const a of allies) {
      if (!a.alive || a.recallAt || a.task.kind === 'recall') continue;
      const hp = a.hp / a.maxHp;
      const t = (W.pathDist(a, spot) - 300) / Math.max(200, a.stats.ms);
      if (t < ac) { ac = t; anyBest = a; }
      if (hp < 0.4 || now - a.lastHurtByHero < sec(3) || a.task.kind === 'heal' && hp < 0.85) continue;
      const k = a.task.kind;
      let c = Math.max(0, t);
      if (a.task.call) { if (k === 'group' && grouped >= 4) c += 8; else continue; }
      else if (k === 'objective' || k === 'contest' || k === 'defend' || k === 'gank' || k === 'ambush' || k === 'permit' || k === 'invade' || k === 'cover') continue;
      else if (k === 'lane') { const own = L[a.task.lane]; if (own && own.need) continue; c += 6; }
      else if (k === 'jungle') c += 3;
      else if (k === 'help') c += 5;
      if (a.role === 'support') c += 2;
      if (c < bc) { bc = c; best = a; }
    }
    if (open[lane]) open[lane].hero = (best || anyBest || { id: 0 }).id;
    if (!best || bc > (st.need === 2 ? 30 : 16)) continue;
    best.task = { kind: 'cover', lane, until: now + sec(Math.min(30, 12 + bc)), why: st.need === 2 ? 'wave on tower' : 'wave incoming' };
    best.pendingCall = null;
    st.cover = best.id;
  }
}
// Catch a crashing wave: walk to it, clear it fast, then hand back to normal play.
function doCover(g, h, task) {
  const st = g.teams[h.team].lanes && g.teams[h.team].lanes[task.lane];
  if (!st || (!st.need && !g.grid.query(h.x, h.y, 500).some((u) => u.alive && u.type === 'minion' && u.team !== h.team && u.lane === task.lane))) { h.task = { kind: 'idle' }; h.why = 'wave cleared'; return; }
  const spot = st.crash || lanePt(g, h.team, task.lane, 0.3);
  if (dist2(h, spot) > 420 * 420) { h.why = `cover ${task.lane}: ${task.why}`; walk(g, h, spot); return; }
  h.why = `clear ${task.lane} wave`;
  if (farmAround(g, h, 520, false)) return;
  walk(g, h, spot, true, 60);
}

// ─────────────────────────── macro ───────────────────────────
export function heroMacro(g, h) {
  const now = g.tick, t = h.task;
  if (t.until && now > t.until) h.task = { kind: 'idle' };
  if (t.kind === 'gank' && t.done) h.task = { kind: 'idle' };
  if (t.kind !== 'ambush') h.ambushSet = 0;
  if (t.kind === 'objective') { const ob = g.objectives[t.obj]; if (t.started && (!ob || !ob.alive)) h.task = { kind: 'idle' }; }
  if (t.kind === 'shrine') { const sh = g.shrines[t.shrine]; if (!sh || sh.owner === h.team) h.task = { kind: 'idle' }; }
  if (t.kind === 'permit') { const x = g.byId(t.target); const seen = x && g.lastSeen[h.team][x.id]; if (!x || !x.alive || !seen || now - seen.t > sec(4)) h.task = { kind: 'idle' }; }
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
  if (!atBase && (critical || (calm && !h.task.call && (low || (rich && hpPct < 0.8) || h.gold > nextCost + 1400)))) {
    // shove the wave first when it would otherwise crash into our tower while we are gone
    const L = g.teams[h.team].lanes, own = h.task.kind === 'lane' && L && L[h.task.lane];
    if (!critical && hpPct > 0.3 && own && own.need === 1 && dist2(h, own.crash || h) < 700 * 700) return;
    h.task = { kind: 'recall', why: critical ? 'recall: critical hp' : low ? 'recall: low hp' : 'recall: buy items' }; return;
  }
  if (h.task.call || ['gank', 'contest', 'defend', 'help'].includes(h.task.kind)) return;

  // defend base
  const threat = baseThreat(g, h.team);
  if (threat && W.pathDist(h, threat) < 2400) { h.task = { kind: 'defend', x: threat.x, y: threat.y, until: now + sec(10) }; return; }
  // contest an objective the enemy is visibly taking
  const contest = contestTarget(g, h, C);
  if (contest) { h.task = { kind: 'contest', obj: contest.kind, until: now + sec(22) }; return; }
  if (h.task.kind === 'cover') return; // the lane brain sent us to catch a wave
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
      h.why = task.why || 'recall';
      if (!h.recallAt) { h.recallAt = now + sec(4); h.vx = h.vy = 0; g.fx.push({ kind: 'recall', id: h.id }); }
      return;
    }
    if (threats.length && combat(g, h, C, true)) return;
    if (task.kind === 'heal') { h.why = 'heal at base'; return; }
    h.why = 'walk home: enemies near'; g.moveToward(h, g.world.fountain[h.team]); return;
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
    case 'cover': return doCover(g, h, task);
    case 'ambush': {
      if (dist2(h, task) > 40 * 40) { h.why = 'to ambush spot'; walk(g, h, task); return; }
      h.why = 'ambush: waiting';
      if (!h.ambushSet) { h.ambushSet = task.until; h.stealthUntil = task.until; }
      h.vx = h.vy = 0; return;
    }
    case 'permit': { // green-lit solo play: hunt the target (combat() takes over once in range)
      const x = g.byId(task.target), seen = x && g.lastSeen[h.team][x.id];
      if (!x || !x.alive || !seen) { h.task = { kind: 'idle' }; return; }
      h.why = 'hunt ' + x.def.name; g.moveToward(h, C.enemies.includes(x) ? x : seen, true, h.stats.range * 0.8); return;
    }
    case 'help': { const a = g.byId(task.ally); if (!a || !a.alive || g.tick - a.lastHurtByHero > sec(3)) { h.task = { kind: 'idle' }; h.why = 'help: fight over'; return; } h.why = 'help ' + a.def.name; if (dist2(h, a) > 220 * 220) walk(g, h, a, true, 150); return; }
    case 'defend': {
      const nearIt = dist2(h, task) < (h.defIn ? 480 : 300) ** 2; h.defIn = nearIt;
      if (!nearIt) { h.why = 'defend base'; walk(g, h, task); return; }
      h.why = 'defend: clear'; if (!farmAround(g, h, 520, true)) { h.task.until = Math.min(h.task.until, g.tick + sec(1)); h.vx = h.vy = 0; }
      return;
    }
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
  const fog = fogThreat(g, h, C); E.e += fog.e; E.d += fog.d;
  const ot = ownTowerAt(g, h.team, h);
  if (ot && near.some((e) => dist2(e, ot) < (ot.stats.range + 20) ** 2)) { A.e += 1500; A.d += 160; }
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
    if (h.task.kind === 'permit' && h.task.target === e.id) s += 700;
    if (CARRY(e)) s += h.def.cls === 'assassin' ? 350 : 140;
    if (h.fightTarget === e.id) s += 180;
    // threats on my carries get peeled
    if ((h.role === 'support' || FRONT(h)) && allies.some((a) => CARRY(a) && dist2(a, e) < 220 * 220)) s += 260 * m.peel;
    const tw = enemyTowerAt(g, h.team, e, 0);
    if (tw && !diveOk(g, h, e, allies, near)) s -= 1400;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const killable = best && (h.burst * 0.75 + allyBurst) > g.ehp(best);
  // Their tower joins the fight if we stand in it, or if the fight would be taken under it. Judging by
  // where the target is (not only by our own feet) stops the step-in / step-out wobble at tower range.
  // `ratio` (should I stay?) counts the tower only when we stand in it; `goRatio` (should I go in?)
  // also counts it when the target sits under it.
  const etMe = enemyTowerAt(g, h.team, h, 10), et = etMe || (best && enemyTowerAt(g, h.team, best, 30));
  const ratio = (A.e * A.d) / Math.max(1, (E.e + (etMe ? 1500 : 0)) * (E.d + (etMe ? 160 : 0)));
  const goRatio = et && !etMe ? (A.e * A.d) / Math.max(1, (E.e + 1500) * (E.d + 160)) : ratio;

  // ── flee? ──
  const outnum = Math.max(0, near.length - allies.length);
  const fleeHp = (h.def.cls === 'tank' ? 0.17 : 0.25) * m.discipline * (1 + 0.35 * outnum);
  // Hysteresis: a retreat is committed for ~1.2s, and re-engaging needs a clearly better ratio.
  // (Without it, stepping in and out of tower range flips fight/flight every few ticks.)
  const fleeing = h.fleeUntil > now, beingHit = now - h.lastHurtByHero < sec(1.2);
  const lowHp = hpPct < fleeHp * (fleeing ? 1.15 : 1) && !(killable && hpPct > 0.12);
  const losing = (ratio < 0.55 * risk * (fleeing ? 1.35 : 1) && !killable) || (recalling && ratio < 1.4);
  // Losing the matchup but nobody can reach us yet: keep our distance (task moves are clamped outside
  // their threat range) instead of running home and walking straight back in.
  const exposed = beingHit || etMe || near.some((e) => dist2(e, h) < (e.stats.range + e.radius + h.radius + 150) ** 2);
  if (!lowHp && (losing || fleeing) && !exposed && !(fleeing && killable && hpPct > 0.4)) {
    if (losing) { keepOut(g, h, near); h.fleeUntil = 0; h.why = 'keep distance: losing matchup'; return false; }
  } else if (lowHp || (losing && exposed) || (fleeing && !(killable && hpPct > 0.4))) {
    if (!fleeing) h.fleeUntil = now + sec(1.2);
    if (losing) keepOut(g, h, near);
    h.why = lowHp ? 'retreat: low hp' : 'retreat: losing fight'; return flee(g, h, near, allies);
  }
  // Never take a 2-man-down fight unless the kill is right there; peel off while still healthy.
  if (outnum >= 2 && !killable && !(h.task.kind === 'defend' && hpPct > 0.5)) { if (hpPct < 0.7 || ratio < risk) { h.fleeUntil = now + sec(1); h.why = 'retreat: outnumbered'; return flee(g, h, near, allies); } }
  // Dive abort: their tower is shooting us and the kill no longer pencils out.
  if (et && et.target === h && !(best && diveOk(g, h, best, allies, near))) { h.fleeUntil = now + sec(1); h.why = 'retreat: tower dive fails'; return flee(g, h, near, allies); }
  // Cohesion: when most nearby teammates are pulling back and we aren't clearly winning, go with them.
  const backing = allies.filter((a) => a !== h && a.fleeUntil > now).length;
  if (backing >= 2 && backing * 2 >= allies.length - 1 && ratio < 1.6 * risk && !killable) { h.fleeUntil = now + sec(1); h.why = 'retreat with team'; return flee(g, h, near, allies); }
  if (recalling || !best) return false;

  const laning = h.task.kind === 'lane' || h.task.kind === 'jungle' || (h.task.kind === 'split' && !h.task.call);
  const engageAt = laning ? risk * 1.7 : risk * 1.08;
  let want;
  if (laning) {
    const allIn = (killable && hpPct > 0.35 && best.hp / best.maxHp < 0.5) || goRatio >= engageAt;
    if (h.disengageUntil > now && !allIn) {
      // keep backing off until clearly out of reach (hysteresis stops edge-of-range shuffling)
      const reach = h.backingOff ? 260 : 150;
      if (near.some((e) => dist2(e, h) < (e.stats.range + reach) ** 2)) { h.backingOff = true; h.why = 'lane: back off after trade'; g.moveToward(h, stepBack(g, h)); return true; }
      h.backingOff = false;
      return false;
    }
    if (allIn) want = true;
    else if (beingHit) {
      if (goRatio >= risk * 1.3 && hpPct > 0.55) { want = true; h.tradeStart = h.tradeStart || now; }
      else { h.disengageUntil = now + sec(3); h.why = 'lane: losing trade'; g.moveToward(h, stepBack(g, h)); return true; }
    } else want = false;
    if (want && !allIn && h.tradeStart && now - h.tradeStart > sec(2)) { h.tradeStart = 0; h.disengageUntil = now + sec(4); return false; }
    if (hpPct < (goRatio >= engageAt * 1.3 ? 0.35 : 0.5) && !allIn) { h.disengageUntil = now + sec(4); h.why = 'lane: hp low, no trades'; g.moveToward(h, stepBack(g, h)); return true; }
    if (!want) {
      h.tradeStart = 0;
      // harass: ranged heroes poke when the enemy steps up to last-hit
      if (hpPct > 0.55 && castPoke(g, h, best, m)) { h.why = 'poke ' + best.def.name; return true; }
      if (h.def.ranged && hpPct > 0.6 && goRatio > risk && dist2(h, best) < (h.stats.range + best.radius + h.radius) ** 2 && !enemyTowerAt(g, h.team, h, 0) && g.rng.chance(0.08 * m.aggro)) { g.tryAttack(h, best); return true; }
      return false;
    }
  } else {
    const allInCall = g.teams[h.team].ultMode && g.teams[h.team].ultMode.mode === 'go';
    want = (killable && hpPct > 0.3) || goRatio >= engageAt * (allInCall ? 0.8 : 1) || (beingHit && goRatio >= risk * 0.85)
      || (h.task.kind === 'objective' && goRatio >= risk * 0.85) || (h.fightTarget === best.id && now - h.lastCombat < sec(1.5) && goRatio >= risk * 0.9);
  }
  if (castAllySustain(g, h, allies)) return true;
  if (!want) return false;

  // ── fight ──
  h.fightTarget = best.id;
  h.why = (killable ? 'kill ' : 'fight ') + best.def.name;
  // supports & carries prioritise peel when a diver is on our carry
  if (h.role === 'support') { const diver = near.find((e) => allies.some((a) => CARRY(a) && a !== h && dist2(a, e) < 180 * 180)); if (diver && castPeel(g, h, diver)) return true; }
  if (castCombat(g, h, best, near, allies, killable)) return true;
  return position(g, h, best, near, killable);
}

// Keep-out zones: the threat range of enemies we are losing to. Task movement (walk) and farm targets
// stay outside them for 1.5s after the matchup was last judged a loss.
function keepOut(g, h, near) {
  h.keepOut = { until: g.tick + sec(1.5), z: near.map((e) => ({ x: e.x, y: e.y, r: e.stats.range + e.radius + h.radius + 190 })) };
}
function clampOut(g, h, p) {
  const k = h.keepOut; if (!k || k.until <= g.tick) return p;
  // inside a zone: step straight out of it; a route that would cross a zone: hold where we are
  for (const z of k.z) if (dist2(h, z) < z.r * z.r) { const ux = h.x - z.x, uy = h.y - z.y, l = Math.sqrt(ux * ux + uy * uy) || 1; return g.world.nearestOpen({ x: z.x + ux / l * (z.r + 30), y: z.y + uy / l * (z.r + 30) }); }
  // near the edge, any step with a component toward the threat counts as crossing (routes bend)
  for (const z of k.z) if (segDist2(z, h, p) < z.r * z.r || (dist2(h, z) < (z.r + 80) ** 2 && (p.x - h.x) * (z.x - h.x) + (p.y - h.y) * (z.y - h.y) > 0)) return { x: h.x, y: h.y };
  return p;
}
function outOfReach(g, h, e) {
  const k = h.keepOut; if (!k || k.until <= g.tick) return false;
  for (const z of k.z) if (dist2(e, z) < (z.r - h.stats.range) ** 2) return true;
  return false;
}
// Task-level movement (never used for chasing or fleeing): respects keep-out zones.
function walk(g, h, p, nav = true, stopAt = 0) { g.moveToward(h, clampOut(g, h, p), nav, stopAt); }

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
      if (tw && !diveOk(g, h, t, ctx(g, h.team).allies.filter((a) => dist2(a, h) < 720 * 720), near)) return false;
      if (!chaseOk(g, h, t, killable)) return false;
      g.moveToward(h, t, true, rng * 0.85); return true;
    }
    if (g.tryAttack(h, t)) return true;
    return true;
  }
  if (g.tryAttack(h, t)) return true;
  const tw = enemyTowerAt(g, h.team, t, 0);
  if (tw && !diveOk(g, h, t, ctx(g, h.team).allies.filter((a) => dist2(a, h) < 720 * 720), near)) return false;
  if (!chaseOk(g, h, t, killable)) return false;
  g.moveToward(h, t, true, rng * 0.8);
  return true;
}
function chaseOk(g, h, t, killable) {
  const now = g.tick;
  // Give up a chase the target is winning (gap growing for ~1.5s) unless it's about to die.
  const d = dist2(h, t);
  if (h.chaseId !== t.id || now - h.lastCombat > sec(3)) { h.chaseId = t.id; h.chaseGap = d; h.chaseGrow = 0; }
  else { if (d > h.chaseGap + 400) h.chaseGrow++; else if (d < h.chaseGap) h.chaseGrow = 0; h.chaseGap = d; }
  if (h.chaseGrow > 30 && !(t.hp / t.maxHp < 0.12 && killable)) return false;
  if (!killable && dist2(h, t) > (h.stats.range + 200) ** 2 && h.task.kind !== 'gank' && !(h.task.kind === 'permit' && h.task.target === t.id)) return false;
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
  g.moveToward(h, escapeTarget(g, h, near, allies));
  return true;
}
// Pick a retreat destination we can reach before the enemies can: lane safety, any own tower,
// the nearest group of teammates, or straight away from the threats. Re-evaluated ~2x/s.
function escapeTarget(g, h, near, allies) {
  if (h.escape && g.tick < h.escape.until) return h.escape.p;
  const cands = [safeSpot(g, h)];
  const home = h.task.kind === 'recall' || h.task.kind === 'heal';
  if (home) cands.push(g.world.fountain[h.team]);
  let tw = null, td = Infinity;
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team) { const d = dist2(u, h); if (d < td) { td = d; tw = u; } }
  if (tw) cands.push(g.world.nearestOpen({ x: tw.x + (g.world.fountain[h.team].x - tw.x) * 0.08, y: tw.y + (g.world.fountain[h.team].y - tw.y) * 0.08 }));
  let best = cands[0], bs = -Infinity;
  for (const c of cands) {
    const mine = Math.sqrt(dist2(h, c));
    let margin = Infinity; for (const e of near) margin = Math.min(margin, Math.sqrt(dist2(e, c)) - mine);
    const sc = margin - mine * 0.15 + (home && c === g.world.fountain[h.team] ? 250 : 0);
    if (sc > bs) { bs = sc; best = c; }
  }
  h.escape = { p: best, until: g.tick + 10 };
  return best;
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
      const um = ab.ult && g.teams[h.team].ultMode;
      if (um && um.mode === 'save' && !(u.includes('defend') && h.hp / h.maxHp < 0.4)) continue;
      if (um && um.mode === 'go' && dist2(h, t) < (h.stats.range + 200) ** 2) { g.cast(h, i, null); return true; }
      if ((u.includes('engage') || u.includes('teamfight')) && dist2(h, t) < (h.stats.range + 140) ** 2) { g.cast(h, i, null); return true; }
      if (u.includes('defend') && h.hp / h.maxHp < 0.6 && g.tick - h.lastHurtByHero < sec(1)) { g.cast(h, i, null); return true; }
      continue;
    }
    if (ab.kind === 'dash' && !ab.dmg && !ab.cc) continue; // pure escape
    // don't dash into a fight we're losing or under their tower
    if (ab.kind === 'dash' && enemyTowerAt(g, h.team, t, 0) && !diveOk(g, h, t, allies, near)) continue;
    const dmg = g.abilityDamage(h, ab, t);
    const exec = t.hp < dmg * 1.05 || (u.includes('execute') && t.hp / t.maxHp < 0.4);
    const um = ab.ult && g.teams[h.team].ultMode;
    if (um && um.mode === 'save' && !exec) continue;            // coach: hold ults
    if (um && um.mode === 'go') { if (castAt(g, h, i, t)) return true; continue; } // coach: all-in, fire now
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
  let lastHit = null, soon = null, soonD = Infinity, push = null, pushS = Infinity, tower = null;
  const myDmg = h.stats.ad;
  const pushing = h.task.kind !== 'lane' || g.teams[h.team].plan === 'aggressive';
  const mobs = [];
  for (const e of tmp) {
    if (!e.alive || e.team === h.team) continue;
    if (e.type === 'minion' || e.type === 'summon') {
      if (outOfReach(g, h, e)) continue;
      mobs.push(e);
      // health prediction: count allied minions hitting it
      let incoming = 0; for (const a of tmp) if (a.type === 'minion' && a.team === h.team && a.target === e) incoming += a.stats.ad * 0.4;
      const d = dist2(h, e);
      if (e.hp <= myDmg + 4 + incoming) { if (!lastHit || e.hp < lastHit.hp) lastHit = e; }
      else if (e.hp <= myDmg * 2.4 + incoming * 2 && d < soonD) { soonD = d; soon = e; }
      // pushing: favour the current target, then low HP and close (less walking between swings)
      const sc = e.hp + Math.sqrt(d) * 3 - (e.id === h.farmT ? 400 : 0);
      if (sc < pushS) { pushS = sc; push = e; }
    } else if (includeStructures && e.structure && g.isTargetable(e)) tower = e;
  }
  if (tower && minionCover(g, h.team, tower.type === 'tower' ? tower : { ...tower, stats: { range: 280 } }) >= 1 && (!lastHit || dist2(h, tower) < (h.stats.range + 60) ** 2)) {
    if (!(tower.type === 'tower' && tower.target === h)) { if (!g.tryAttack(h, tower)) walk(g, h, tower, true, h.stats.range * 0.8 + tower.radius); return true; }
  }
  if (castClear(g, h, mobs)) return true;
  const target = lastHit || (pushing ? push : null);
  if (target) {
    const tw = enemyTowerAt(g, h.team, target, -10);
    if (tw && (minionCover(g, h.team, tw) < 1 || tw.target === h)) return false;
    h.farmT = target.id;
    if (!g.tryAttack(h, target)) walk(g, h, target, true, h.stats.range * 0.8 + target.radius);
    return true;
  }
  // a last hit is coming up: stand in range of it (no walking deep into the wave for nothing)
  if (soon && !enemyTowerAt(g, h.team, soon, -10)) {
    if (dist2(h, soon) > (h.stats.range + soon.radius + 30) ** 2) { walk(g, h, soon, true, h.stats.range * 0.9); return true; }
    h.vx = h.vy = 0; return true;
  }
  return false;
}
function minionPressure(g, h) { let n = 0; for (const m of g.grid.query(h.x, h.y, 260)) if (m.alive && m.type === 'minion' && m.team !== h.team && m.target === h) n++; return n; }

// Walk to p; once within `inner` px, stay settled until p drifts beyond `outer`. Returns true when settled.
function arrive(g, h, p, inner, outer) {
  p = clampOut(g, h, p);
  if (dist2(h, p) > (h.settled ? outer * outer : inner * inner)) { h.settled = false; g.moveToward(h, p, true); return false; }
  h.settled = true; return true;
}
// Smoothed lane hold point: follows the wave front at walking pace instead of jumping back and forth
// every time the front minion dies or a new one steps up (that jump was most lane wobble).
function holdProg(g, h, lane, prog) {
  const len = g.world.laneLen[lane][g.world.laneLen[lane].length - 1];
  const hs = h.hold;
  if (!hs || hs.lane !== lane || g.tick - hs.t > 20 || Math.abs(prog - hs.p) * len > 420) { h.hold = { lane, p: prog, t: g.tick }; return prog; }
  const step = 70 * DT / len * (g.tick - hs.t || 1), dead = 45 / len, d = prog - hs.p;
  if (Math.abs(d) > dead) hs.p += Math.max(-step, Math.min(step, d - Math.sign(d) * dead));
  hs.t = g.tick;
  return hs.p;
}
function doLane(g, h, lane, push) {
  const fl = frontline(g, h.team, lane);
  const towerOnMe = g.grid.query(h.x, h.y, 300).find((s) => s.type === 'tower' && s.alive && s.team !== h.team && s.target === h);
  if (towerOnMe || (minionPressure(g, h) >= 3 && h.hp / h.maxHp < 0.7)) {
    h.why = towerOnMe ? 'lane: out of tower aggro' : 'lane: minions on me';
    walk(g, h, lanePt(g, h.team, lane, Math.max(0.04, (fl.hasWave ? fl.prog : fl.towerProg) - 0.09))); return;
  }
  // supports walk with their carry in lane
  if (h.role === 'support' && !push) {
    const carry = g.teams[h.team].heroes.find((a) => a.alive && a.role === 'bot' && a.task.kind === 'lane');
    if (carry && dist2(carry, h) < 900 * 900) {
      // stand beside the carry, a step toward the enemy along the lane (steady: no jumping as foes come and go)
      const dir = g.world.laneDir(lane, g.world.laneProgress(lane, carry)), fw = h.team === BLUE ? 1 : -1;
      const spot = g.world.nearestOpen({ x: carry.x + dir.x * fw * 40 - dir.y * 45, y: carry.y + dir.y * fw * 40 + dir.x * 45 });
      h.why = 'lane: escort ' + carry.def.name;
      if (arrive(g, h, spot, 40, 110)) farmAround(g, h, 300, false) || (h.vx = h.vy = 0);
      return;
    }
  }
  const back = h.def.ranged ? 0.05 : 0.025;
  // stand just behind where the waves will clash (not back at base waiting for our own wave)
  let prog = Math.min(fl.hasWave ? fl.prog : 1, fl.meet) - back;
  if (!fl.hasWave && fl.foe > 1) prog = fl.towerProg - 0.03;
  if (push && fl.hasWave) prog = fl.prog - 0.005;
  prog = holdProg(g, h, lane, Math.max(0.04, prog));
  let hold = lanePt(g, h.team, lane, prog);
  const tw = enemyTowerAt(g, h.team, hold, 40);
  const heroesNear = ctx(g, h.team).enemies.some((e) => dist2(e, h) < 650 * 650);
  if (tw && (minionCover(g, h.team, tw) < 2 || heroesNear)) {
    if (farmAround(g, h, 360, false)) { h.why = 'lane: farm outside tower'; return; }
    hold = lanePt(g, h.team, lane, Math.max(0.04, myProg(g, h.team, lane, tw) - 0.1));
    h.why = 'lane: wait outside tower';
    if (arrive(g, h, hold, 28, 70)) h.vx = h.vy = 0;
    return;
  }
  const inLane = dist2(h, hold) < (h.laneIn ? 620 : 460) ** 2; h.laneIn = inLane;
  if (!inLane) { h.settled = false; h.why = (push ? 'split: walk to ' : 'lane: walk to ') + lane; walk(g, h, hold); return; }
  if (farmAround(g, h, 420, true)) { h.settled = false; h.why = push ? 'split: push wave' : 'lane: farm'; return; }
  // arrive-and-settle: stop inside 28px, only walk again once the spot drifts 70px away
  h.why = fl.hasWave ? 'lane: hold behind wave' : 'lane: wait for wave';
  if (arrive(g, h, hold, 28, 70)) h.vx = h.vy = 0;
}

function doGroup(g, h, lane) {
  const fl = frontline(g, h.team, lane);
  const team = g.teams[h.team].heroes.filter((a) => a.alive && a.task.kind === 'group');
  const lead = fl.hasWave ? fl.prog : fl.towerProg;
  const p = lanePt(g, h.team, lane, Math.max(0.05, lead - (h.def.ranged ? 0.03 : 0.008)));
  const gathered = team.filter((a) => dist2(a, p) < 700 * 700).length;
  if (gathered < Math.min(3, team.length) && dist2(h, p) < 600 * 600) {
    if (farmAround(g, h, 300, false)) { h.why = `group ${lane}: farm while gathering`; return; }
    h.why = `group ${lane}: wait for team`;
    if (arrive(g, h, lanePt(g, h.team, lane, Math.max(0.05, lead - 0.07)), 30, 80)) h.vx = h.vy = 0;
    return;
  }
  const inZone = dist2(h, p) < (h.grpIn ? 560 : 400) ** 2; h.grpIn = inZone;
  if (!inZone) { h.why = `group ${lane}: walk`; walk(g, h, p); return; }
  if (farmAround(g, h, 460, true)) { h.why = `group ${lane}: siege`; return; }
  h.why = `group ${lane}: hold with wave`;
  if (arrive(g, h, p, 30, 80)) h.vx = h.vy = 0;
}

function doJungle(g, h) {
  const here = g.grid.query(h.x, h.y, 260).filter((m) => m.type === 'mob' && m.alive && !m.resetting).sort((a, b) => (b.big - a.big) || a.id - b.id);
  if (here.length) {
    const t = here.find((m) => m.target === h) || here[0];
    h.why = 'jungle: clear camp';
    if (castClear(g, h, [t, ...here.filter((m) => m !== t)])) return;
    if (!g.tryAttack(h, t)) walk(g, h, t, true, h.stats.range * 0.8 + t.radius);
    return;
  }
  // Next camp: one that is up, or will be up by the time we get there. Sticky, so the jungler
  // does not swap between two similar camps and walk back and forth.
  let best = null, bv = Infinity, cur = null, cv = Infinity, next = null, nt = Infinity;
  const ms = Math.max(200, h.stats.ms);
  for (const c of g.camps) {
    if (c.side !== h.team) continue;
    const d = g.world.pathDist(h, c), up = c.mobs.length > 0 && c.mobs.some((m) => !m.resetting || m.hp > m.maxHp * 0.9);
    const wait = up ? 0 : c.respawnAt > 0 ? (c.respawnAt - g.tick) / 20 : Infinity;
    if (wait < nt) { nt = wait; next = c; }
    if (!up && wait > d / ms + 2) continue;
    const v = d / (c.def.buff ? 1.5 : 1) + (up ? 0 : 300);
    if (c.key === h.jgCamp) { cur = c; cv = v; }
    if (v < bv) { bv = v; best = c; }
  }
  if (cur && cv < bv / 0.75) best = cur;
  if (best) { h.jgCamp = best.key; h.why = 'jungle: to ' + best.def.name; walk(g, h, best); return; }
  h.jgCamp = null;
  // nothing up: wait at the camp that comes back first if it is close in time, else help a lane
  if (next && nt < 22) { h.why = 'jungle: wait for ' + next.def.name; if (arrive(g, h, next, 80, 160)) h.vx = h.vy = 0; return; }
  const L = g.teams[h.team].lanes, need = L && g.world.laneNames.find((l) => L[l] && L[l].need);
  doLane(g, h, need || h.lane || (g.time > 540 || g.world.laneNames.length === 1 ? 'mid' : (h.team === BLUE ? 'bot' : 'top')), false);
}

function doGank(g, h, task, C) {
  const lane = task.lane;
  let tgt = null, bd = Infinity;
  for (const e of C.enemies) { if (g.world.distToLane(lane, e) > 350) continue; const d = dist2(h, e); if (d < bd) { bd = d; tgt = e; } }
  if (tgt) {
    const tw = enemyTowerAt(g, h.team, tgt, 0);
    if (tw && minionCover(g, h.team, tw) < 2 && tgt.hp / tgt.maxHp > 0.35) {
      task.done = g.tick - (task.arrived || g.tick) > sec(5);
      h.why = `gank ${lane}: target under tower`;
      if (arrive(g, h, lanePt(g, h.team, lane, myProg(g, h.team, lane, tw) - 0.1), 30, 90)) h.vx = h.vy = 0;
      return;
    }
    // approach through brush/flank: stay out of their vision until close
    h.why = `gank ${lane}: go ${tgt.def.name}`;
    walk(g, h, tgt); return;
  }
  const fl = frontline(g, h.team, lane);
  const p = lanePt(g, h.team, lane, Math.max(0.1, fl.prog - 0.02));
  if (dist2(h, p) < 250 * 250) { task.arrived = task.arrived || g.tick; if (g.tick - task.arrived > sec(6)) task.done = true; h.why = `gank ${lane}: nobody there`; farmAround(g, h, 350, false); return; }
  h.why = `gank ${lane}: walk`;
  walk(g, h, p);
}

function doObjective(g, h, obj, task, contest) {
  const pit = obj === 'dragon' ? g.world.pits.kami : g.world.pits.kraken;
  const ob = g.objectives[obj];
  // contesting non-junglers hold a zone on our side of the pit (vision + threat), they do not wander
  const f = g.world.fountain[h.team], zd = norm(f.x - pit.x, f.y - pit.y);
  const zone = contest && h.role !== 'jungle' ? g.world.nearestOpen({ x: pit.x + zd.x * 230, y: pit.y + zd.y * 230 }) : pit;
  const atPit = dist2(h, zone) < (h.pitIn ? 400 : zone === pit ? 300 : 120) ** 2; h.pitIn = atPit;
  if (!atPit) { h.why = (contest ? 'contest ' : 'take ') + obj; walk(g, h, zone); return; }
  if (!ob || !ob.alive) {
    if (!contest && g.objTimers[obj] && g.objTimers[obj] - g.tick < sec(25)) { h.why = obj + ': wait for spawn'; if (!farmAround(g, h, 260, false)) h.vx = h.vy = 0; return; }
    task.until = Math.min(task.until || Infinity, g.tick + sec(2));
    return;
  }
  task.started = true;
  if (ob.resetting) { h.why = obj + ': resetting'; if (arrive(g, h, pit, 120, 220)) h.vx = h.vy = 0; return; }
  const helpers = g.teams[h.team].heroes.filter((a) => a.alive && dist2(a, pit) < 420 * 420).length;
  if (!contest && helpers < 2 && ob.hp > ob.maxHp * 0.6) { h.why = obj + ': wait for team'; h.vx = h.vy = 0; return; }
  if (contest && h.role !== 'jungle' && ob.hp > ob.maxHp * 0.3) { h.why = 'contest ' + obj + ': zone'; if (!farmAround(g, h, 260, false) && arrive(g, h, zone, 40, 130)) h.vx = h.vy = 0; return; }
  if (contest && h.role === 'jungle' && dist2(h, ob) > 200 * 200) { h.why = 'contest ' + obj + ': smite range'; walk(g, h, ob, true, 150); return; }
  h.why = (contest ? 'steal ' : 'hit ') + obj;
  if (castClear(g, h, [ob])) return;
  if (!g.tryAttack(h, ob)) walk(g, h, ob, true, h.stats.range * 0.8 + ob.radius);
}

function doSafe(g, h) {
  if (h.role === 'jungle') { doJungle(g, h); return; }
  const lane = h.lane || g.laneOf(h);
  let tw = null, bp = -1;
  for (const u of g.units) if (u.type === 'tower' && u.alive && u.team === h.team && u.lane === lane) { const p = myProg(g, h.team, lane, u); if (p > bp) { bp = p; tw = u; } }
  const spot = tw ? lanePt(g, h.team, lane, Math.max(0.03, bp - 0.04)) : g.world.fountain[h.team];
  h.why = 'play safe at tower';
  if (dist2(h, spot) > 140 * 140) { walk(g, h, spot); return; }
  if (tw) for (const e of g.grid.query(tw.x, tw.y, tw.stats.range)) if (e.alive && e.team !== h.team && e.type === 'minion' && e.hp <= h.stats.ad) { if (!g.tryAttack(h, e)) walk(g, h, e, true, h.stats.range * 0.8); return; }
  h.vx = h.vy = 0;
}

function doInvade(g, h, task) {
  const camp = g.camps.find((c) => c.key === task.camp);
  if (!camp || !camp.mobs.length) { h.task = { kind: 'idle' }; h.why = 'invade: camp gone'; return; }
  if (dist2(h, camp) > 220 * 220) { h.why = 'invade ' + camp.def.name; walk(g, h, camp); return; }
  const mobs = camp.mobs.filter((m) => m.alive && !m.resetting);
  const t = mobs.find((m) => m.big) || mobs[0];
  if (!t) { h.why = 'invade: camp resetting'; return; }
  h.why = 'invade: steal ' + camp.def.name;
  if (castClear(g, h, [t])) return;
  if (!g.tryAttack(h, t)) walk(g, h, t, true, h.stats.range * 0.8 + t.radius);
}

function doShrine(g, h, task) {
  const sh = g.shrines[task.shrine];
  if (!sh || sh.owner === h.team) { h.task = { kind: 'idle' }; h.why = 'shrine taken'; return; }
  h.why = 'capture shrine';
  // stand on it (capture radius 120): hit whatever is in range, but never walk off the circle
  if (!arrive(g, h, sh, 50, 95)) return;
  for (const e of g.grid.query(h.x, h.y, h.stats.range + 30)) if (e.alive && e.team !== h.team && (e.type === 'minion' || e.type === 'summon') && g.tryAttack(h, e)) return;
  h.vx = h.vy = 0;
}
