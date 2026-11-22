// AI coach: makes calls for a team (used for the opponent in vs-AI mode and for headless sims).
// It only uses information its own team can see.
import { sec } from './constants.js';
import { dist2 } from './geom.js';
import { aiMoment } from './moments-coach.js';
import { aiSkillTactic } from './sidegrades.js';
import { aiCard2 } from './cards2.js';
import { coachWeights, PLAN_IDS, PLAN_BEATS } from './plans.js';
import { openCrystal } from './endgame.js';
import { KAMI_VALUE } from './beasts.js';

export class Coach {
  // style (rival coaches, part of the match cfg): { moment: 'early'|'late', backup: plan id for halftime }
  constructor(g, team, level = 1, style = null) {
    this.g = g; this.team = team; this.level = level; // 0 easy, 1 normal, 2 hard
    this.style = style || {};
    this.next = sec(20) + team * 7;
    this.cooldown = { surge: 0, ult: 0, gank: 0, objective: 0, reset: 0, group: 0, focus: 0, herald: 0, build: 0, invade: 0, shrine: 0 };
  }
  issue(c) { c.team = this.team; return this.g.applyCommand(c); }
  // Living World (src/sim/living.js): the Elder Kami breaks stalemates (Bosses & Beasts), the Yokai Parade is
  // worth a detour, and at night the enemy's Moon Spirits are worth stealing.
  livingCalls(takeObj, s) {
    const g = this.g, me = g.teams[this.team], jg = me.heroes.find((h) => h.role === 'jungle'), y = g.objectives.yokai;
    // The Elder Kami breaks stalemates: whoever can, takes it (its Push is how a late lead becomes a Crystal)
    if (takeObj('boss', 3, s.deadEnemies >= 1 || s.alive.length >= s.enemyAlive.length + (this.level >= 1 ? 0 : 1))) return true;
    // the parade on our half of the map (closer to our fountain), or an enemy down; late on, charges go to pushes
    const f = g.world.fountain[this.team], o = g.world.fountain[1 - this.team];
    const ours = y && y.alive && dist2(y, f) < dist2(y, o);
    if (g.time < 600 * g.rules.k && takeObj('yokai', 3, jg && jg.alive && (s.deadEnemies >= 1 || ours))) return true;
    // stealing Moon Spirits only with charges to spare (a full bar)
    if (g.living.night && this.level >= 1 && s.ready('invade') && s.charges >= 3 && jg && jg.alive && jg.hp > jg.maxHp * 0.6) {
      const camp = g.camps.find((c) => c.night && c.side !== this.team && c.mobs.length);
      const theirJg = g.teams[1 - this.team].heroes.find((h) => h.role === 'jungle');
      if (camp && !(theirJg && theirJg.alive && s.visibleEnemies.includes(theirJg) && dist2(theirJg, camp) < 900 * 900) && dist2(jg, camp) < 1300 * 1300) {
        if (this.issue({ type: 'invade', camp: camp.key })) { s.cd('invade', 40); return true; }
      }
    }
    return false;
  }
  // Bosses & Beasts: the scout pet (a free call). Eyes on an objective about to be fought where we have no
  // sight; otherwise (Normal/Hard) a peek into the enemy jungle when their jungler has been missing a while.
  scoutCall(vis) {
    const g = this.g, me = g.teams[this.team], now = g.tick, W = g.world;
    if (now < me.scoutCd || g.beasts.pet(this.team) || now < this.scoutNext) return;
    this.scoutNext = now + sec(4);
    const dark = (p) => !g.visGrid[this.team][W.idx(p.x, p.y)];
    const send = (p) => this.issue({ type: 'scout', x: Math.round(p.x), y: Math.round(p.y) });
    for (const k of ['boss', 'baron', 'dragon', 'herald']) {
      const o = g.objectives[k], t = g.objTimers[k];
      if (!(o && o.alive) && !(t && t - now < sec(30))) continue;
      const p = g.objPit(k);
      if (dark(p) && (this.level >= 1 || g.rng.chance(0.3))) { send(p); return; }
    }
    if (this.level < 1 || g.time < 240) return;
    const ej = g.teams[1 - this.team].heroes.find((h) => h.role === 'jungle'), seen = ej && g.lastSeen[this.team][ej.id];
    if (!ej || !ej.alive || vis.has(ej.id) || (seen && now - seen.t < sec(15))) return;
    const camps = g.camps.filter((c) => c.side !== this.team && !c.night && dark(c));
    if (!camps.length) return;
    const near = seen ? camps.sort((a, b) => dist2(a, seen) - dist2(b, seen))[0] : camps[g.rng.int(camps.length)];
    send(near);
  }

  update() {
    const g = this.g, now = g.tick;
    if (now < this.next) return;
    this.next = now + sec([4, 2.5, 1.5][this.level]);
    const me = g.teams[this.team], them = g.teams[1 - this.team];
    const alive = me.heroes.filter((h) => h.alive);
    const enemyAlive = them.heroes.filter((h) => h.alive);
    const vis = g.vision[this.team];
    const visibleEnemies = enemyAlive.filter((h) => vis.has(h.id));
    const charges = me.charges;
    const ready = (k) => now >= this.cooldown[k];
    const cd = (k, s) => { this.cooldown[k] = now + sec(s); };
    const near = (p, r, list) => list.filter((h) => dist2(h, p) < r * r).length;
    const deadEnemies = them.heroes.filter((h) => !h.alive && h.respawnAt - now > sec(12 * Math.max(0.6, g.rules.respawn))).length;
    const k = g.rules.k, LANE_NAMES = g.world.laneNames; // k: clock scale for short modes (thresholds below are for a 15-minute match)

    if (g.beasts) this.scoutCall(vis); // free: never takes the coach's turn
    if (this.useTactics(me, them, alive, visibleEnemies, deadEnemies)) return;
    if (me.momentum >= 100 && ready('surge') && this.useSurge(me, alive, visibleEnemies)) { cd('surge', 10); return; }
    if (aiMoment(this, { alive, visibleEnemies, deadEnemies })) return;
    // Halftime adjustments: behind on towers (or gold), switch plan: the rival's backup plan, or (Normal/Hard)
    // one that beats the enemy's plan; swap a weak card
    if (g.halftimeTick >= 0 && now >= g.halftimeTick && now < g.halftimeTick + sec(6) && !this.didHalftime) {
      this.didHalftime = true;
      const diff = g.towersStanding(this.team) - g.towersStanding(1 - this.team);
      const gold = (t) => g.teams[t].heroes.reduce((a, h) => a + h.goldEarned, 0), behind = diff < 0 || (diff === 0 && gold(this.team) < gold(1 - this.team) - 1500);
      if (behind && PLAN_IDS.includes(me.plan)) {
        const counter = PLAN_IDS.find((p) => p !== me.plan && (PLAN_BEATS[p] || []).includes(them.plan));
        const plan = this.style.backup && this.style.backup !== me.plan && (this.level < 1 || !counter) ? this.style.backup : this.level >= 1 ? counter : this.style.backup;
        if (plan && plan !== me.plan) this.issue({ type: 'plan', plan });
      }
      const unused = me.deck.find((d) => !d.used && (d.id === 'sweep' || d.id === 'swap'));
      if (unused) for (const to of ['rally', 'wind', 'smoke', 'siege']) if (!me.deck.some((d) => d.id === to)) { this.issue({ type: 'redraw', card: unused.id, to }); break; }
    }
    // Ult calls (Normal/Hard): all-in when most ults are up and a fight is brewing; else let heroes choose
    if (this.level >= 1 && ready('ult')) {
      const ultsUp = alive.filter((h) => h.level >= 5 && g.abilityReady(h, 2)).length;
      const brawl = visibleEnemies.filter((e) => alive.some((a) => dist2(a, e) < 700 * 700)).length;
      if (ultsUp >= 3 && brawl >= 3 && alive.length >= visibleEnemies.length && !me.ultMode) { this.issue({ type: 'ult', mode: 'go' }); cd('ult', 45); return; }
    }
    // Drop herald as soon as we have it
    if (me.heraldEye > now) {
      const lane = this.pickHeraldLane();
      if (lane && this.issue({ type: 'herald', lane })) return;
    }
    // Build pivots vs comp (once per hero)
    if (ready('build') && g.time > 240 * k) {
      cd('build', 60);
      const tanks = them.heroes.filter((h) => h.items.filter((i) => i.stats.armor || i.stats.mr).length >= 2).length;
      const healers = them.heroes.filter((h) => h.healed > 800 || h.items.some((i) => i.stats.omnivamp || i.stats.healPower)).length;
      const fed = them.heroes.filter((h) => h.kills >= h.deaths + 4 && (h.def.tags.includes('dive') || h.def.tags.includes('burst'))).length;
      const fedMage = them.heroes.some((h) => h.kills >= h.deaths + 4 && h.def.dmgType === 'magic');
      for (const h of me.heroes) {
        if (h.items.length >= 4) continue;
        const want = tanks >= 2 && (h.build === 'burst' || h.build === 'crit') ? (h.def.builds.includes('pierce') ? 'pierce' : h.def.builds.includes('burn') ? 'burn' : null)
          : healers >= 2 && h.build !== 'burn' && h.def.builds.includes('burn') ? 'burn'
          : fed >= 1 && (h.def.cls === 'support' || h.def.cls === 'tank') && h.build !== 'warden' && h.def.builds.includes('warden') ? 'warden'
          : fed >= 1 && h.def.cls === 'tank' && h.build !== 'thorns' && h.def.builds.includes('thorns') ? 'thorns' // v26: punish the fed diver
          : fedMage && (h.def.cls === 'marksman' || h.def.cls === 'mage' || h.def.cls === 'bruiser') && h.build !== 'spellshield' && h.def.builds.includes('spellshield') ? 'spellshield' : null;
        if (want && want !== h.build) { this.issue({ type: 'build', hero: h.id, build: want }); break; }
      }
    }
    // Objectives (the plan bends how eager: Objective Control and early Aggression call them more freely,
    // early Scale only with an enemy down)
    const W = coachWeights(g, this.team);
    const takeObj = (obj, minAlive, extra) => {
      const o = g.objectives[obj];
      const spawnSoon = !o && g.objTimers[obj] && g.objTimers[obj] - now < sec(20) && g.objTimers[obj] > 0;
      if (!(o && o.alive) && !spawnSoon) return false;
      if (charges < 2 || !ready('objective')) return false;
      const pit = g.objPit(obj);
      const enemiesNearPit = near(pit, LANE_NAMES.length === 1 || obj === 'boss' ? 650 : 1100, visibleEnemies); // (the Elder Kami sits on mid lane: only count those right on it)
      if (alive.length < minAlive) return false;
      if (enemiesNearPit > 1 && deadEnemies === 0) return false;
      if (W.objWait && deadEnemies < 1) return false;
      if (!extra && !(W.objFree && obj !== 'baron' && obj !== 'boss' && alive.length >= enemyAlive.length && enemiesNearPit === 0)) return false;
      if (this.issue({ type: 'objective', obj })) { cd('objective', W.objCd); return true; }
      return false;
    };
    if (g.living && this.livingCalls(takeObj, { alive, enemyAlive, deadEnemies, visibleEnemies, charges, ready, cd })) return;
    if (takeObj('baron', 4, deadEnemies >= 2 || (g.time > 1050 * k && alive.length >= enemyAlive.length + 1) || (LANE_NAMES.length === 1 && alive.length >= enemyAlive.length + 1))) return;
    const jg = me.heroes.find((h) => h.role === 'jungle');
    const enemyJgVisibleTop = them.heroes.some((h) => h.role === 'jungle' && vis.has(h.id) && h.x + h.y < 2400 && h.alive);
    const botAlive = me.heroes.filter((h) => (h.role === 'bot' || h.role === 'support') && h.alive).length;
    // (Bosses & Beasts: how much this map's blessing is worth, more so when it would be their second)
    const kamiK = g.beasts ? KAMI_VALUE[g.beasts.species] * (them.dragons.length ? 1.4 : 1) : 1;
    if (takeObj('dragon', 3, jg && jg.alive && (botAlive >= 1) && (deadEnemies >= 1 || enemyJgVisibleTop || this.level >= 1 && g.rng.chance(0.25 * kamiK)))) return;
    if (takeObj('herald', 3, jg && jg.alive && (deadEnemies >= 1 || g.rng.chance(0.2)))) return;

    // Shrines: grab one when it's quiet
    if (ready('shrine') && charges >= 1 && g.time > g.T.shrineUnlock + 10) {
      const sh = g.shrines.filter((x) => x.owner !== this.team).sort((a, b) => (a.id === this.team ? -1 : 1) - (b.id === this.team ? -1 : 1))[0];
      if (sh && near(sh, 900, visibleEnemies) === 0 && alive.length >= 4) { if (this.issue({ type: 'shrine', shrine: sh.id })) { cd('shrine', 50); return; } }
    }
    // Gank: enemy laner overextended & low
    if (ready('gank') && charges >= 1 && jg && jg.alive && jg.task.kind === 'jungle') {
      for (const e of visibleEnemies) {
        for (const lane of LANE_NAMES) {
          if (g.world.distToLane(lane, e) > 300) continue;
          const pr = g.world.laneProgress(lane, e), mine = this.team === 0 ? pr : 1 - pr;
          if (mine < 0.48 && e.hp / e.maxHp < 0.8) {
            const ally = me.heroes.find((a) => a.alive && a.lane === lane);
            if (ally && this.issue({ type: 'gank', lane })) { cd('gank', W.gankCd); return; }
          }
        }
      }
    }
    // Focus the fed carry when a fight is on
    if (ready('focus') && charges >= 1 && visibleEnemies.length >= 3) {
      const fight = alive.filter((h) => now - h.lastCombat < sec(2)).length >= 3;
      if (fight) {
        const fed = visibleEnemies.slice().sort((a, b) => (b.kills * 2 + b.items.length) - (a.kills * 2 + a.items.length))[0];
        if (fed && this.issue({ type: 'focus', target: fed.id })) { cd('focus', 25); return; }
      }
    }
    // Reset when team is low and nothing is going on
    if (ready('reset') && charges >= 1 && alive.length >= 4) {
      const avg = alive.reduce((a, h) => a + h.hp / h.maxHp, 0) / alive.length;
      if (avg < 0.45 && alive.every((h) => now - h.lastCombat > sec(3))) { if (this.issue({ type: 'reset' })) { cd('reset', 60); return; } }
    }
    // Mid/late: group to push where the enemy is missing
    // Late game: close it out. Group on the lane where the enemy base is most open.
    // (Split Push groups mid, Protect the Carry groups where the carry is; both start earlier.)
    // (an open enemy Crystal counts as late: group up and finish it, src/sim/endgame.js)
    const late = g.time > W.lateAt * k || (LANE_NAMES.length === 1 && deadEnemies >= 2) || !!openCrystal(g, this.team); // one lane: every won fight is a push
    // (Bosses & Beasts: with the Elder Kami up or about to land, keep two charges for it rather than another push call)
    const elder = g.beasts && g.beasts.full && me.elderPush <= now && ((g.objectives.boss && g.objectives.boss.alive) || (g.objTimers.boss && g.objTimers.boss - now < sec(25)));
    if (ready('group') && late && charges >= (elder ? 3 : 1) && alive.length >= 3 && (deadEnemies >= 1 || alive.length >= enemyAlive.length || g.time > 780 * k)) {
      const lane = W.groupLane && LANE_NAMES.includes(W.groupLane) && g.time < 780 * k ? W.groupLane : this.weakestLane();
      if (this.issue({ type: 'group', lane })) { cd('group', g.time > 780 * k ? 25 : W.groupCd); return; }
    }
    // Invade when enemy jungler seen far away
    // (Early Aggression invades sooner.)
    if (this.level >= 1 && ready('invade') && charges >= 2 && g.camps.length && g.time > W.invadeFrom * k && g.time < 900 * k) {
      const ej = them.heroes.find((h) => h.role === 'jungle');
      if (ej && (!ej.alive || (vis.has(ej.id) && jg && dist2(ej, jg) > 1600 * 1600))) { if (this.issue({ type: 'invade' })) { cd('invade', W.invadeCd); return; } }
    }
  }

  useTactics(me, them, alive, vis, dead) {
    const g = this.g, now = g.tick;
    if (now < (this.tacticCd || 0)) return false;
    const has = (id) => me.deck.some((d) => d.id === id && !d.used);
    const play = (c) => { if (this.issue({ type: 'tactic', ...c })) { this.tacticCd = now + sec(25); return true; } return false; };
    const fighting = alive.filter((h) => now - h.lastCombat < sec(2)).length;
    const avgHp = alive.reduce((a, h) => a + h.hp / h.maxHp, 0) / Math.max(1, alive.length);
    if (has('wind') && fighting >= 3 && avgHp < 0.5) return play({ card: 'wind' });
    if (has('rally') && fighting >= 3 && vis.length >= 3) return play({ card: 'rally' });
    const obj = ['baron', 'dragon', 'herald'].map((k) => g.objectives[k]).find((o) => o && o.alive);
    if (obj && dead >= 2) { if (has('pact')) return play({ card: 'pact' }); if (has('smoke')) return play({ card: 'smoke' }); }
    if (obj && has('sweep') && me.call && me.call.type === 'objective') return play({ card: 'sweep' });
    const sieged = g.units.some((u) => u.type === 'tower' && u.team === this.team && u.alive && u.hp < u.maxHp * 0.6 && g.grid.query(u.x, u.y, 400).some((e) => e.type === 'hero' && e.team !== this.team && e.alive));
    if (has('fortify') && sieged) return play({ card: 'fortify' });
    const k = g.rules.k;
    if (has('siege') && g.time > 480 * k && alive.length >= 4 && dead >= 1) return play({ card: 'siege', lane: 'mid' });
    if (has('ambush') && g.time > 200 * k && g.time < 700 * k && g.rng.chance(0.02)) return play({ card: 'ambush', lane: g.world.laneNames[g.rng.int(g.world.laneNames.length)] });
    if (has('swap') && g.world.laneNames.length > 1 && g.time > 240 && g.time < 600) {
      const top = me.heroes.find((h) => h.homeLane === 'top');
      if (top && top.deaths >= 3 && top.kills === 0) return play({ card: 'swap' });
    }
    if (has('barrier') && fighting >= 3 && avgHp < 0.6) return play({ card: 'barrier' });
    if (has('council') && me.charges < 0.5 && g.time > 300 * k) return play({ card: 'council' });
    if (has('eyes') && obj && !fighting) return play({ card: 'eyes' });
    if (has('gate') && avgHp < 0.45 && !fighting && g.time > 300 * k) return play({ card: 'gate' });
    if (aiSkillTactic(has, play, { fighting, vis, avgHp, obj, call: me.call })) return true;
    if (aiCard2(this, has, play, { fighting, vis, avgHp, obj, call: me.call, alive, dead })) return true; // v26 cards
    if (has('bait') && fighting >= 2) { const tank = alive.find((h) => h.def.cls === 'tank' && h.hp / h.maxHp > 0.6); if (tank) return play({ card: 'bait', hero: tank.id }); }
    return false;
  }

  // Kami Surge: spend a full meter when it swings something: an even-or-better fight on open ground, an objective race,
  // or a late base siege that can end the game.
  useSurge(me, alive, vis) {
    const g = this.g, now = g.tick;
    if (alive.length < 3) return false;
    const close = vis.filter((e) => alive.some((a) => (a.x - e.x) ** 2 + (a.y - e.y) ** 2 < 750 * 750));
    const fighters = alive.filter((h) => now - h.lastCombat < sec(2) && close.some((e) => (h.x - e.x) ** 2 + (h.y - e.y) ** 2 < 700 * 700));
    const hp = fighters.reduce((a, h) => a + h.hp / h.maxHp, 0) / Math.max(1, fighters.length);
    // never into their towers: the fight has to be on open ground
    const underTower = fighters.some((h) => g.units.some((u) => u.type === 'tower' && u.alive && u.team !== this.team && (u.x - h.x) ** 2 + (u.y - h.y) ** 2 < (u.stats.range + 60) ** 2));
    const brawl = fighters.length >= 3 && close.length >= 2 && fighters.length >= close.length && hp > 0.45 && !underTower;
    const objRace = ['dragon', 'baron', 'herald'].some((k) => { const o = g.objectives[k]; return o && o.alive && o.hp < o.maxHp * 0.7 && close.length >= 1 && alive.filter((a) => (a.x - o.x) ** 2 + (a.y - o.y) ** 2 < 600 * 600).length >= 3; });
    // late close-out: grouped on their base (gate / base towers / Crystal) with at most one defender in sight
    const closeOut = g.time > 660 * g.rules.k && me.call && me.call.type === 'group' && close.length <= 1 && g.units.some((u) => u.alive && u.team !== this.team && (u.type === 'inhib' || u.type === 'nexus' || (u.type === 'tower' && u.tier >= 3))
      && g.isTargetable(u) && alive.filter((a) => (a.x - u.x) ** 2 + (a.y - u.y) ** 2 < 600 * 600).length >= 3);
    if (!brawl && !objRace && !closeOut) return false;
    return this.issue({ type: 'surge' });
  }

  // The enemy lane with the fewest structures left standing (ties: mid).
  weakestLane() {
    const g = this.g; let best = 'mid', bs = Infinity;
    for (const ln of ['mid', 'top', 'bot'].filter((x) => g.world.laneNames.includes(x))) {
      let n = 0; for (const u of g.units) if (u.alive && u.team !== this.team && (u.type === 'tower' || u.type === 'inhib') && u.lane === ln) n += u.type === 'inhib' ? 2 : 1;
      if (n < bs) { bs = n; best = ln; }
    }
    return best;
  }
  pickHeraldLane() {
    const g = this.g;
    let best = null, bs = -1;
    for (const lane of g.world.laneNames) {
      const towers = g.units.filter((u) => u.type === 'tower' && u.team !== this.team && u.lane === lane && u.alive).length;
      if (towers > bs) { bs = towers; best = lane; }
    }
    return best;
  }
}
