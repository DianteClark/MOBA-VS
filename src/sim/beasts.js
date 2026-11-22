// Bosses & Beasts (classic 5v5 maps, cfg.beasts with the Living World): the battlefield's creatures.
//   Kami      one species per map (map def `kami`), each with its own team blessing. Base Kami wake in the
//             Kami pit at 3:00 and 7:30 (90s after the first falls, if later). Each one slain is a stack of
//             the map's blessing for the slayers (kept for the match).
//   Elder     the species' official recolor lands in the centre arena at 12:00 (30s warning) and every 3:00
//             after it falls. Its slayers get the blessing at Elder strength for 150s, plus the Elder's Push
//             for 90s (All-Out waves: a super minion per lane and stronger, faster minions; +60% structure
//             damage, +6% speed): the stalemate breaker that ends games at the Crystal.
//   Rare      the Oni and the Kraken each have a seeded 15% chance to wake as their rare recolor: bonus gold
//             for the slayers and a slightly bigger buff (a tougher Oni charge, a longer, stronger Kraken).
//   Scout     each team has one scout animal (a free call from 3:00, 75s cooldown, one on the map per team).
//             Sent to a spot, it runs there from the nearest ally and reveals the area for 30s. Any 3 hits
//             kill it. Its look (which animal) is a coach cosmetic: never in the sim.
//   Night     a jungle camp that respawns at night wakes in its night form (yokai monsters): +25% gold and XP.
// Deterministic: plain data on units / teams (snapshot-safe, no closures), the game's rng, tick timers.
// Without cfg.beasts none of this exists.
import { sec, NEUTRAL, BLUE, DRAGON_INFO } from './constants.js';
import { dist2 } from './geom.js';

export const BEASTS = {
  kamiAt: [180, 450], kamiGap: 90, kamiLast: 640,
  elderAt: 720, elderWarn: 30, elderRespawn: 180, elderBuff: 150, elderPower: 3,
  push: 90, pushSiege: 0.6, pushMs: 0.06,
  rare: 0.15, rareGold: 90, rareBaronPower: 20, rareBaronSec: 20, rareOni: 1.3,
  nightCamp: 1.25,
  scoutFrom: 180, scoutCd: 75, scoutLife: 30, scoutRun: 14, scoutSight: 520, scoutRunSight: 260, scoutMs: 270, scoutHits: 3, scoutGold: 40,
};
// The six Kami species (one per classic map). Each blessing scales with power p: one per base Kami slain,
// plus BEASTS.elderPower while the Elder's blessing lasts.
export const KAMI = {
  frog: { name: 'Frog Kami', elder: 'Elder Frog', short: 'Frog', color: '#7fdc6a', blessing: 'Spring Water', desc: 'Out of combat: regenerate 0.8% max HP/s and recall 12% faster per blessing' },
  slime: { name: 'Slime Kami', elder: 'Elder Slime', short: 'Slime', color: '#6fd3e8', blessing: 'Sticky Ooze', desc: 'Basic attacks on heroes slow them by 5% for 1.5s per blessing' },
  bamboo: { name: 'Bamboo Kami', elder: 'Elder Bamboo', short: 'Bamboo', color: '#a6d65a', blessing: 'Bamboo Grove', desc: 'Your towers take 7% less damage and heroes near an ally get +5% armor & MR per blessing' },
  racoon: { name: 'Racoon Kami', elder: 'Golden Racoon', short: 'Racoon', color: '#ffc94a', blessing: 'Racoon\'s Purse', desc: 'Takedowns pay 12% more, and the team shares a 25 gold bounty per blessing' },
  tengu: { name: 'Tengu Kami', elder: 'Elder Tengu', short: 'Tengu', color: '#bfe3ff', blessing: 'Mountain Gale', desc: '+2.5% move speed, +3% more out of combat, per blessing' },
  samurai: { name: 'Samurai Kami', elder: 'Blue Samurai', short: 'Samurai', color: '#ff7a5a', blessing: 'Samurai\'s Edge', desc: '+6% attack speed and +3% armor pen per blessing' },
};
export const KAMI_IDS = Object.keys(KAMI);
// A base Kami's element is its species: the shared Kami info (names, colours) knows them all.
for (const [k, v] of Object.entries(KAMI)) DRAGON_INFO[k] = { name: v.name, short: v.short, color: v.color, desc: v.desc, species: true };
// The world boss's name: the map's Elder Kami.
export const elderName = (sp) => (KAMI[sp] ? KAMI[sp].elder : 'Elder Kami');
// What a coach should know about a blessing (AI value per stack, roughly "gold-equivalent per hero").
export const KAMI_VALUE = { frog: 0.8, slime: 1, bamboo: 1.1, racoon: 0.9, tengu: 0.9, samurai: 1.1 };

export class Beasts {
  constructor(g) {
    this.g = g;
    const W = g.world, d = W.def;
    this.species = KAMI[d.kami] ? d.kami : 'frog';
    this.kamiN = 0; // base Kami spawned so far
    this.landed = false;
    g.objTimers.dragon = sec(BEASTS.kamiAt[0]);
    g.objectives.boss = null; g.objTimers.boss = sec(BEASTS.elderAt);
    this.arena = g.living ? g.living.bossSpot : W.nearestOpen({ x: 1200, y: 1200 });
    for (const t of g.teams) { t.kamiElder = 0; t.elderPush = 0; t.rareBaron = 0; t.rareOni = false; t.scoutCd = sec(BEASTS.scoutFrom); t.scout = 0; }
  }

  // Blessing power of a team (0 = none).
  power(team) { const t = this.g.teams[team]; return t.dragons.length + (t.kamiElder > this.g.tick ? BEASTS.elderPower : 0); }

  update() {
    const g = this.g, now = g.tick;
    if (g.objTimers.boss && now === g.objTimers.boss - sec(BEASTS.elderWarn)) g.emit({ type: 'bossSoon', x: this.arena.x, y: this.arena.y, kami: this.species });
    if (!g.objectives.boss && g.objTimers.boss && now >= g.objTimers.boss) this.spawnElder();
    // Spring Water: out-of-combat regen (every half second)
    if (this.species === 'frog' && now % 10 === 0) for (let t = 0; t < 2; t++) {
      const p = this.power(t); if (!p) continue;
      for (const h of g.teams[t].heroes) if (h.alive && now - h.lastCombat > sec(4) && h.hp < h.maxHp) g.heal(h, h.maxHp * 0.008 * p * 0.5, null, true);
    }
    for (const u of g.units) if (u.type === 'pet' && u.alive) this.updatePet(u);
  }

  // ───────── Kami ─────────
  // The base Kami that wakes now (game.updateObjectivesSpawn): this map's species.
  kamiSpawned() { this.kamiN++; }
  // Next base Kami after one falls (or none: two per match, never after 10:40).
  nextKami() {
    const g = this.g;
    if (this.kamiN >= BEASTS.kamiAt.length) return 0;
    const at = Math.max(sec(BEASTS.kamiAt[this.kamiN]), g.tick + sec(BEASTS.kamiGap));
    return at > sec(BEASTS.kamiLast) ? 0 : at;
  }
  spawnElder() {
    const g = this.g, gm = g.gameMinute, p = this.arena;
    const hp = 9000 + Math.max(0, gm - 12) * 500;
    g.objectives.boss = g.addUnit({ type: 'objective', kind: 'boss', element: this.species, elder: true, team: NEUTRAL, x: p.x, y: p.y, home: { ...p },
      maxHp: hp, hp, radius: 34, big: true, boss: true, slam: 0, stats: { ad: 150 + gm * 5, ap: 0, armor: 50, mr: 50, as: 0.75, range: 220, ms: 0, pen: 0 } });
    g.objTimers.boss = 0;
    const first = !this.landed; this.landed = true;
    g.emit({ type: 'spawn', obj: 'boss', element: this.species, x: p.x, y: p.y, first });
    if (first && g.living) g.living.quake(); // the landing shakes every wall still standing down
  }

  // ───────── rare Oni / Kraken ─────────
  // A fresh Oni / Kraken: a seeded 15% roll for its rare recolor. Returns extra fields for its spawn event.
  rare(u) {
    if (!this.g.rng.chance(BEASTS.rare)) return {};
    u.rare = true; u.maxHp *= 1.1; u.hp = u.maxHp;
    return { rare: true };
  }

  // game.kill, objective case (after the shared rewards).
  onObjective(u, team) {
    const g = this.g, tm = g.teams[team], now = g.tick;
    if (u.kind === 'dragon') g.objTimers.dragon = this.nextKami();
    if (u.kind === 'boss') {
      tm.kamiElder = now + sec(BEASTS.elderBuff); tm.elderPush = now + sec(BEASTS.push);
      for (const h of tm.heroes) if (h.alive) g.addBuff(h, { siegePct: BEASTS.pushSiege, msPct: BEASTS.pushMs }, BEASTS.push, 'elder');
      for (const h of tm.heroes) g.recalc(h);
      g.objTimers.boss = now + sec(BEASTS.elderRespawn);
    }
    if (u.rare) {
      for (const h of tm.heroes) if (h.alive) g.giveGold(h, BEASTS.rareGold * g.finalMult);
      if (u.kind === 'herald') tm.rareOni = true;
      if (u.kind === 'baron') {
        tm.rareBaron = now + sec(g.T.baronBuff + BEASTS.rareBaronSec); tm.baronUntil = tm.rareBaron;
        for (const h of tm.heroes) if (h.alive) { h.baronUntil = tm.rareBaron; g.recalc(h); }
      }
    }
  }
  // The Oni charge a team unleashes (game.dropHerald): a rare Oni's is tougher.
  oniMult(team) { const t = this.g.teams[team]; if (!t.rareOni) return 1; t.rareOni = false; return BEASTS.rareOni; }

  // ───────── blessings (hooks) ─────────
  // game.recalc: stat blessings.
  stats(h, s) {
    const g = this.g, p = this.power(h.team), now = g.tick, t = g.teams[h.team];
    if (t.rareBaron > now && h.baronUntil > now) s.power += BEASTS.rareBaronPower;
    if (!p) return;
    switch (this.species) {
      case 'tengu': s.msPct += 0.025 * p + (now - h.lastCombat > sec(4) ? 0.03 * p : 0); break;
      case 'samurai': s.asPct += 0.06 * p; s.pen += 0.03 * p; break;
      case 'bamboo': if (g.grid.query(h.x, h.y, 600).some((a) => a !== h && a.type === 'hero' && a.alive && a.team === h.team)) s.resPct += 0.05 * p; break;
    }
  }
  // game.dealDamage: Bamboo Grove (structures of a blessed team take less).
  structMult(tgt) {
    if (this.species !== 'bamboo' || tgt.team > 1) return 1;
    return 1 - Math.min(0.4, 0.07 * this.power(tgt.team));
  }
  // game.basicHit (a hero's basic attack on a hero): Sticky Ooze.
  onBasic(att, tgt) {
    if (this.species !== 'slime') return;
    const p = this.power(att.team); if (!p) return;
    tgt.slows.push({ pct: Math.min(0.3, 0.05 * p), until: this.g.tick + sec(1.5) });
  }
  // game.kill, hero case: Racoon's Purse (killer and assists).
  onTakedown(victim, killer, assists) {
    if (this.species !== 'racoon' || !killer) return;
    const g = this.g, p = this.power(killer.team); if (!p) return;
    g.giveGold(killer, 350 * 0.12 * p * g.rules.killGold);
    for (const a of assists) g.giveGold(a, 60 * 0.12 * p * g.rules.killGold);
    for (const h of g.teams[killer.team].heroes) if (h.alive) g.giveGold(h, 25 * p);
  }
  // Recall channel multiplier (Spring Water).
  recallMult(h) { return this.species === 'frog' ? Math.max(0.4, 1 - 0.12 * this.power(h.team)) : 1; }

  // ───────── Scout pet ─────────
  // The 'scout' command { x, y }: free, from 3:00, one per team on the map, 75s cooldown.
  scout(c) {
    const g = this.g, tm = g.teams[c.team], now = g.tick;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.y < 0 || c.x > 2400 || c.y > 2400) return false;
    if (now < tm.scoutCd || this.pet(c.team)) return false;
    const W = g.world, goal = W.nearestOpen({ x: c.x, y: c.y }), ef = W.fountain[1 - c.team];
    if (dist2(goal, ef) < 700 * 700) return false; // never into the enemy fountain
    let from = W.fountain[c.team], bd = dist2(from, goal);
    for (const h of tm.heroes) if (h.alive) { const d = dist2(h, goal); if (d < bd) { bd = d; from = h; } }
    const st = W.nearestOpen(from);
    const u = g.addUnit({ type: 'pet', kind: 'scout', team: c.team, x: st.x, y: st.y, goal: { x: goal.x, y: goal.y }, arrived: 0, born: now, expireAt: now + sec(BEASTS.scoutRun + BEASTS.scoutLife),
      maxHp: BEASTS.scoutHits, hp: BEASTS.scoutHits, radius: 9, stats: { ad: 0, ap: 0, armor: 0, mr: 0, as: 1, range: 0, ms: BEASTS.scoutMs, pen: 0 } });
    tm.scout = u.id; tm.scoutCd = now + sec(BEASTS.scoutCd);
    g.emit({ type: 'scout', team: c.team, id: u.id, x: goal.x, y: goal.y });
    return true;
  }
  pet(team) { const id = this.g.teams[team].scout; if (!id) return null; const u = this.g.byId(id); return u && u.alive ? u : null; }
  updatePet(u) {
    const g = this.g, now = g.tick;
    if (now >= u.expireAt) { u.alive = false; g.fx.push({ kind: 'death', id: u.id, x: u.x, y: u.y, type: u.type, team: u.team }); g.emit({ type: 'scoutEnd', team: u.team, id: u.id }); return; }
    if (u.arrived) { u.vx = u.vy = 0; return; }
    if (dist2(u, u.goal) < 26 * 26 || now - u.born > sec(BEASTS.scoutRun)) {
      u.arrived = now; u.expireAt = now + sec(BEASTS.scoutLife); u.path = null;
      return;
    }
    g.moveToward(u, u.goal, true);
  }
  // game.updateVision: a scout's sight (keen: the night does not shrink it).
  sight(team, src) {
    for (const u of this.g.units) if (u.type === 'pet' && u.alive && u.team === team) src.push({ x: u.x, y: u.y, r: u.arrived ? BEASTS.scoutSight : BEASTS.scoutRunSight });
  }
  // game.dealDamage on a scout: every hit counts as one (damage over time does not).
  hitPet(u, src, flags) {
    const g = this.g;
    if (flags.dot || !src || src.team === u.team) return 0;
    u.hp -= 1; u.lastCombat = g.tick;
    g.fx.push({ kind: 'dmg', id: u.id, v: 1, t: 'true' });
    if (u.hp <= 0) g.kill(u, src);
    return 1;
  }
  // game.kill, pet case.
  onPetDie(u, src) {
    const g = this.g;
    if (src && src.type === 'hero') g.giveGold(src, BEASTS.scoutGold);
    g.emit({ type: 'scoutDown', team: u.team, id: u.id, killer: src && src.type === 'hero' ? src.id : 0, x: u.x, y: u.y });
  }
  // ai.heroThink: a hero with nothing better to do swats an enemy scout in reach (never mid-fight).
  swat(h) {
    const g = this.g, now = g.tick;
    if (now - h.lastHitHero < sec(2) || now - h.lastHurtByHero < sec(2)) return false;
    const e = this.pet(1 - h.team); if (!e || !g.vision[h.team].has(e.id)) return false;
    const reach = h.stats.range + h.radius + e.radius;
    if (dist2(h, e) > (reach + 140) ** 2) return false;
    h.why = 'swat their scout';
    if (!g.tryAttack(h, e)) g.moveToward(h, e, true, reach * 0.8);
    return true;
  }
}
