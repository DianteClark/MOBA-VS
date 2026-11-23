// v26 tactic cards (src/data/tactics.js): vision denial and counter-vision, objective setups, comeback cards,
// split-push and wave tempo, jungle raids, engage / disengage, anti-dive and ult cooldowns.
// Deterministic sim code. Game.c2 turns on the first time one of these cards is played, and every hook in
// game.js checks it, so a match where nobody plays them runs exactly as before.
import { sec } from './constants.js';
import { dist2 } from './geom.js';

const CARDS2 = ['blackout', 'owl', 'charge', 'fallback', 'underdog', 'crash', 'escort', 'pit', 'slowpush', 'lone', 'echo', 'raid', 'wardline', 'snipe', 'bounty', 'revive'];
const PIT_R = 420, LONE_R = 900;

const st = (team) => team.c2 || (team.c2 = { waves: {}, charged: [] });
const gold = (g, t) => g.teams[t].heroes.reduce((a, h) => a + h.goldEarned, 0);
export const behind = (g, t) => g.towersStanding(t) < g.towersStanding(1 - t) || gold(g, t) < gold(g, 1 - t) - 1500;
const ultIdx = (h) => h.def.abilities.findIndex((a) => a.ult);

// Why a card cannot be played right now (null: it can). Pure: the HUD and the AI read it too.
export function cardBlock(g, t, id) {
  const tm = g.teams[t], alive = tm.heroes.filter((h) => h.alive), now = g.tick;
  switch (id) {
    case 'underdog': case 'revive':
      if (!behind(g, t)) return 'Only when behind';
      if (id === 'revive' && !tm.heroes.some((h) => !h.alive && h.respawnAt > now + sec(2))) return 'No hero is down';
      return null;
    case 'bounty': return tm.kills < g.teams[1 - t].kills ? null : 'Only when behind on kills';
    case 'snipe': return tm.heroes.some((h) => h.role === 'jungle' && h.alive) ? null : 'Needs a living jungler';
    case 'raid': return tm.heroes.some((h) => h.role === 'jungle' && h.alive) && g.camps.some((c) => c.side !== t && c.mobs.length) ? null : 'No camp to raid';
    case 'echo': return tm.heroes.some((h) => { const i = ultIdx(h); return i >= 0 && h.level >= 5 && h.cds[i] > now + sec(3); }) ? null : 'No ultimate on cooldown';
    case 'charge': case 'fallback': case 'escort': case 'lone': return alive.length ? null : 'No hero alive';
    default: return null;
  }
}

// The objective pit a Pit Trap covers: the live objective nearest our fountain, else the next one to spawn.
function trapPit(g, t) {
  const f = g.world.fountain[t], now = g.tick;
  const keys = Object.keys(g.objectives).filter((k) => k === 'dragon' || k === 'herald' || k === 'baron' || (k === 'boss' && g.beasts && g.living));
  const live = keys.filter((k) => g.objectives[k] && g.objectives[k].alive);
  let k = live.sort((a, b) => dist2(g.objPit(a), f) - dist2(g.objPit(b), f))[0];
  if (!k) k = keys.filter((x) => g.objTimers[x] > now).sort((a, b) => g.objTimers[a] - g.objTimers[b])[0];
  return k ? g.objPit(k) : null;
}

// From Game.playTactic. Returns undefined for cards that are not ours, false when nothing can happen.
export function playCard2(g, c, team, alive) {
  if (!CARDS2.includes(c.card)) return undefined;
  if (cardBlock(g, team.id, c.card)) return false;
  const now = g.tick, S = st(team), lanes = g.world.laneNames, t = team.id;
  const ping = (o) => g.fx.push({ kind: 'card', card: c.card, team: t, ...o });
  switch (c.card) {
    case 'blackout': S.blackoutUntil = now + sec(g.living && g.living.night ? 14 : 10); ping({ until: S.blackoutUntil }); break;
    case 'owl':
      S.owlUntil = now + sec(20);
      if (g.beasts && team.scoutCd > now) team.scoutCd = now;
      for (const h of alive) ping({ id: h.id });
      break;
    case 'charge':
      S.chargeUntil = now + sec(6); S.charged = [];
      for (const h of alive) { g.addBuff(h, { msPct: 0.3 }, 6, 'charge'); ping({ id: h.id }); }
      break;
    case 'fallback':
      for (const h of alive) { h.slows = []; g.addBuff(h, { msPct: 0.35 }, 4, 'fallback'); g.setCallTask(h, { kind: 'safe', until: now + sec(5), call: true }); ping({ id: h.id }); }
      break;
    case 'underdog': for (const h of alive) { g.addBuff(h, { dmgPct: 0.12, drPct: 0.12 }, 15, 'underdog'); ping({ id: h.id }); } break;
    case 'crash': case 'slowpush':
      if (!lanes.includes(c.lane)) return false;
      S.waves[c.lane] = c.card === 'crash' ? { fast: 2 } : { slow: 3 };
      ping({ lane: c.lane });
      break;
    case 'escort': case 'lone': {
      const h = team.heroes.find((x) => x.id === c.hero && x.alive); if (!h) return false;
      if (c.card === 'escort') { S.escort = { id: h.id, until: now + sec(10) }; g.addBuff(h, { drPct: 0.25 }, 10, 'escort'); }
      else { S.lone = { id: h.id, until: now + sec(45) }; g.recalc(h); }
      ping({ id: h.id });
      break;
    }
    case 'pit': {
      const p = trapPit(g, t); if (!p) return false;
      S.pit = { x: p.x, y: p.y, until: now + sec(30) };
      g.fx.push({ kind: 'zone', x: p.x, y: p.y, r: PIT_R, team: t, until: S.pit.until, name: 'rock' });
      ping({ x: p.x, y: p.y });
      break;
    }
    case 'echo':
      for (const h of team.heroes) { const i = ultIdx(h); if (i >= 0 && h.cds[i] > now) h.cds[i] = now + Math.round((h.cds[i] - now) / 2); if (h.alive) ping({ id: h.id }); }
      break;
    case 'raid': {
      const jg = alive.find((h) => h.role === 'jungle');
      const camps = g.camps.filter((cp) => cp.side !== t && cp.mobs.length && !cp.night);
      const camp = (camps.length ? camps : g.camps.filter((cp) => cp.side !== t && cp.mobs.length)).sort((a, b) => dist2(a, jg) - dist2(b, jg))[0];
      const buddy = alive.filter((h) => h !== jg && h.role !== 'bot').sort((a, b) => dist2(a, camp) - dist2(b, camp))[0];
      for (const h of [jg, buddy]) if (h) g.setCallTask(h, { kind: 'invade', camp: camp.key, until: now + sec(30), call: true });
      S.raidUntil = now + sec(40);
      ping({ x: camp.x, y: camp.y });
      break;
    }
    case 'wardline': {
      if (!lanes.includes(c.lane)) return false;
      for (const pr of [0.35, 0.5, 0.65]) {
        const p = g.world.nearestOpen(g.world.lanePoint(c.lane, t === 0 ? pr : 1 - pr));
        g.wards.push({ team: t, x: p.x, y: p.y, until: now + sec(60), owner: 0 });
        g.fx.push({ kind: 'ward', x: p.x, y: p.y, team: t });
      }
      ping({ lane: c.lane });
      break;
    }
    case 'snipe': {
      S.snipeUntil = now + sec(25);
      const jg = alive.find((h) => h.role === 'jungle'); jg.smiteCd = now; ping({ id: jg.id });
      break;
    }
    case 'bounty': {
      let best = null;
      for (const e of g.teams[1 - t].heroes) if (!best || e.kills > best.kills) best = e;
      S.bounty = { id: best.id, until: now + sec(40) };
      best.revealUntil = Math.max(best.revealUntil, S.bounty.until);
      ping({ id: best.id, mark: true });
      break;
    }
    case 'revive':
      for (const h of team.heroes) if (!h.alive && h.respawnAt > now) { h.respawnAt = now + Math.round((h.respawnAt - now) * 0.4); ping({ x: g.world.fountain[t].x, y: g.world.fountain[t].y }); }
      break;
  }
  g.c2 = true;
  return true;
}

// ── hooks (only while Game.c2) ──
// Game.recalc: Lone Wolf.
export function stats(g, h, s) {
  const L = g.teams[h.team].c2 && g.teams[h.team].c2.lone;
  h.loneOn = false;
  if (!L || L.id !== h.id || L.until <= g.tick || !h.alive) return;
  if (g.teams[h.team].heroes.some((a) => a !== h && a.alive && dist2(a, h) < LONE_R * LONE_R)) return;
  s.msPct += 0.2; s.siegePct += 0.3; s.drPct += 0.2; h.loneOn = true;
}
// Game.updateVision: sight radius of team t's heroes, whether their wards see, whether they spot stealth.
export function sightMult(g, t) {
  const me = g.teams[t].c2, foe = g.teams[1 - t].c2, now = g.tick;
  return (foe && foe.blackoutUntil > now ? 0.65 : 1) * (me && me.owlUntil > now ? 1.3 : 1);
}
export const wardsDark = (g, t) => { const foe = g.teams[1 - t].c2; return !!(foe && foe.blackoutUntil > g.tick); };
export const seesStealth = (g, t) => { const me = g.teams[t].c2; return !!(me && me.owlUntil > g.tick); };
// Game.dealDamage, hero source: Jungle Raid on enemy camps.
export function outMods(g, src, tgt, amt) {
  const S = g.teams[src.team].c2;
  if (S && S.raidUntil > g.tick && tgt.type === 'mob' && tgt.camp && !tgt.camp.startsWith(String(src.team) + ':')) amt *= 1.3;
  return amt;
}
export function campGold(g, h, u) {
  const S = g.teams[h.team].c2;
  return S && S.raidUntil > g.tick && u.camp && !u.camp.startsWith(String(h.team) + ':') ? 1.35 : 1;
}
// A hero hit a hero (after the damage): Escort slows the attacker, Charge! slows on the first basic hit.
export function onHeroHit(g, src, tgt, flags) {
  const now = g.tick, E = g.teams[tgt.team].c2, A = g.teams[src.team].c2;
  if (E && E.escort && E.escort.id === tgt.id && E.escort.until > now && !(src.escortCd > now)) {
    src.escortCd = now + sec(1.5); src.slows.push({ pct: 0.45, until: now + sec(1.5) });
    g.fx.push({ kind: 'cc', id: src.id, cc: 'slow' });
  }
  if (flags.basic && A && A.chargeUntil > now && !A.charged.includes(tgt.id)) { A.charged.push(tgt.id); tgt.slows.push({ pct: 0.3, until: now + sec(1.5) }); g.fx.push({ kind: 'cc', id: tgt.id, cc: 'slow' }); }
}
// Game.spawnWaves: the minions just spawned for (team, lane) are units[from..].
export function onWave(g, t, lane, from) {
  const S = g.teams[t].c2, w = S && S.waves[lane]; if (!w) return;
  for (let i = from; i < g.units.length; i++) {
    const m = g.units[i]; if (m.type !== 'minion') continue;
    if (w.slow) { m.stats.ms *= 0.65; m.maxHp *= 1.3; m.hp = m.maxHp; m.stacked = true; } else if (w.fast) { m.stats.ms *= 1.3; m.crash = true; }
  }
  if (w.slow) w.slow--; else if (w.fast) w.fast--;
  if (!w.slow && !w.fast) delete S.waves[lane];
}
// Game.trySmite: Smite Snipe.
export const snipe = (g, h) => { const S = g.teams[h.team].c2; return !!(S && S.snipeUntil > g.tick); };
// Game.kill (hero): Bounty Hunt pays out.
export function takedown(g, victim, killer) {
  const t = 1 - victim.team, S = g.teams[t].c2, B = S && S.bounty;
  if (!B || B.id !== victim.id || B.until <= g.tick) return;
  S.bounty = null;
  for (const h of g.teams[t].heroes) { g.giveGold(h, 250); if (h.alive) g.fx.push({ kind: 'gold', id: h.id, x: h.x, y: h.y, v: 250 }); }
  g.emit({ type: 'bounty', team: t, victim: victim.id, killer: killer ? killer.id : 0 });
}
// Every 10 ticks: the Pit Trap slows and reveals; Lone Wolf re-checks its range.
export function tick(g) {
  const now = g.tick;
  for (const tm of g.teams) {
    const S = tm.c2; if (!S) continue;
    if (S.pit && S.pit.until > now) {
      for (const e of g.teams[1 - tm.id].heroes) if (e.alive && dist2(e, S.pit) < PIT_R * PIT_R) { e.slows.push({ pct: 0.25, until: now + 12 }); e.revealUntil = Math.max(e.revealUntil, now + 12); }
    } else if (S.pit) S.pit = null;
    if (S.lone) { const h = tm.heroes.find((x) => x.id === S.lone.id); if (S.lone.until <= now) { S.lone = null; if (h) g.recalc(h); } else if (h && h.alive) g.recalc(h); }
  }
}

// ── the AI coach (from Coach.useTactics): when to play each card ──
export function aiCard2(co, has, play, x) {
  const g = co.g, t = co.team, me = g.teams[t], k = g.rules.k, now = g.tick, ok = (id) => has(id) && !cardBlock(g, t, id);
  const { fighting, vis, avgHp, obj, alive, dead } = x;
  if (ok('fallback') && fighting >= 2 && avgHp < 0.45 && alive.length <= vis.length && (alive.length < vis.length || alive.length < me.heroes.length)) return play({ card: 'fallback' });
  if (ok('underdog') && fighting >= 3 && vis.length >= 2) return play({ card: 'underdog' });
  if (ok('charge') && fighting >= 2 && vis.length >= 3 && alive.length >= vis.length && avgHp > 0.6) return play({ card: 'charge' });
  if (ok('escort') && fighting >= 2) {
    const carry = alive.filter((h) => h.def.cls === 'marksman' || h.def.cls === 'mage').sort((a, b) => b.goldEarned - a.goldEarned)[0];
    if (carry && now - carry.lastHurtByHero < sec(1) && carry.hp / carry.maxHp < 0.8 && carry.hp / carry.maxHp > 0.3 && vis.some((e) => (e.def.cls === 'assassin' || e.def.cls === 'bruiser') && dist2(e, carry) < 450 * 450)) return play({ card: 'escort', hero: carry.id });
  }
  if (ok('revive') && me.heroes.filter((h) => !h.alive && h.respawnAt - now > sec(12)).length >= 2) return play({ card: 'revive' });
  if (ok('echo') && !fighting && me.heroes.filter((h) => { const i = ultIdx(h); return i >= 0 && h.cds[i] - now > sec(20); }).length >= 3) return play({ card: 'echo' });
  if (ok('snipe') && obj && obj.hp < obj.maxHp * 0.45 && vis.some((e) => dist2(e, obj) < 900 * 900)) {
    const jg = alive.find((h) => h.role === 'jungle'); if (jg && dist2(jg, obj) < 900 * 900) return play({ card: 'snipe' });
  }
  const soon = Object.keys(g.objTimers).some((o) => g.objTimers[o] > now && g.objTimers[o] - now < sec(25));
  if (ok('pit') && ((obj && x.call && x.call.type === 'objective') || (soon && alive.length >= 4 && !fighting))) return play({ card: 'pit' });
  if (ok('blackout') && ((obj && x.call && x.call.type === 'objective') || (g.living && g.living.night && fighting >= 2))) return play({ card: 'blackout' });
  if (ok('owl') && (g.events.some((e) => e.type === 'tactic' && e.team !== t && (e.card === 'smoke' || e.card === 'ambush' || e.card === 'blackout') && now - e.t < sec(3)) || (obj && x.call && x.call.type === 'objective' && !has('blackout')))) return play({ card: 'owl' });
  if (ok('bounty') && g.time > 300 * k) return play({ card: 'bounty' });
  if (ok('lone') && g.time > 420 * k) { const s = alive.find((h) => h.task.kind === 'split' || (h.role === 'top' && h.lane !== 'mid' && h.hp > h.maxHp * 0.6 && !alive.some((a) => a !== h && dist2(a, h) < 1200 * 1200))); if (s) return play({ card: 'lone', hero: s.id }); }
  if (ok('raid') && g.time > 180 * k && g.time < 900 * k) {
    const ej = g.teams[1 - t].heroes.find((h) => h.role === 'jungle');
    if (ej && (!ej.alive || (co.g.vision[t].has(ej.id) && dead === 0 && g.rng.chance(0.3)))) return play({ card: 'raid' });
  }
  if (g.world.laneNames.length && g.time > 300 * k && !fighting) {
    const lane = co.weakestLane();
    if (ok('crash') && g.rng.chance(0.05)) return play({ card: 'crash', lane });
    if (ok('slowpush') && g.time < 780 * k && g.rng.chance(0.05)) return play({ card: 'slowpush', lane });
    if (ok('wardline') && g.time > 420 * k && g.rng.chance(0.05)) return play({ card: 'wardline', lane: g.world.laneNames.length > 1 ? (lane === 'mid' ? 'top' : lane) : lane });
  }
  return false;
}
