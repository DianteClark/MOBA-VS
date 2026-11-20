// AI coach: makes calls for a team (used for the opponent in vs-AI mode and for headless sims).
// It only uses information its own team can see.
import { sec } from './constants.js';
import { dist2 } from './geom.js';
const LANE_NAMES = ['top', 'mid', 'bot'];

export class Coach {
  constructor(g, team, level = 1) {
    this.g = g; this.team = team; this.level = level; // 0 easy, 1 normal, 2 hard
    this.next = sec(20) + team * 7;
    this.cooldown = { gank: 0, objective: 0, reset: 0, group: 0, focus: 0, herald: 0, build: 0, invade: 0, shrine: 0 };
  }
  issue(c) { c.team = this.team; return this.g.applyCommand(c); }

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
    const deadEnemies = them.heroes.filter((h) => !h.alive && h.respawnAt - now > sec(12)).length;

    // Drop herald as soon as we have it
    if (me.heraldEye > now) {
      const lane = this.pickHeraldLane();
      if (lane && this.issue({ type: 'herald', lane })) return;
    }
    // Build pivots vs comp (once per hero)
    if (ready('build') && g.time > 240) {
      cd('build', 60);
      const tanks = them.heroes.filter((h) => h.items.filter((i) => i.stats.armor || i.stats.mr).length >= 2).length;
      for (const h of me.heroes) if (h.build === 'burst' && tanks >= 2 && h.def.builds.includes('burn') && h.items.length < 4) { this.issue({ type: 'build', hero: h.id, build: 'burn' }); break; }
    }
    // Objectives
    const takeObj = (obj, minAlive, extra) => {
      const o = g.objectives[obj];
      const spawnSoon = !o && g.objTimers[obj] && g.objTimers[obj] - now < sec(20) && g.objTimers[obj] > 0;
      if (!(o && o.alive) && !spawnSoon) return false;
      if (charges < 2 || !ready('objective')) return false;
      const pit = obj === 'dragon' ? g.world.pits.kami : g.world.pits.kraken;
      const enemiesNearPit = near(pit, 1100, visibleEnemies);
      if (alive.length < minAlive) return false;
      if (enemiesNearPit > 1 && deadEnemies === 0) return false;
      if (!extra) return false;
      if (this.issue({ type: 'objective', obj })) { cd('objective', 40); return true; }
      return false;
    };
    if (takeObj('baron', 4, deadEnemies >= 2 || (g.time > 1050 && alive.length >= enemyAlive.length + 1))) return;
    const jg = me.heroes.find((h) => h.role === 'jungle');
    const enemyJgVisibleTop = them.heroes.some((h) => h.role === 'jungle' && vis.has(h.id) && h.x + h.y < 2400 && h.alive);
    const botAlive = me.heroes.filter((h) => (h.role === 'bot' || h.role === 'support') && h.alive).length;
    if (takeObj('dragon', 3, jg && jg.alive && (botAlive >= 1) && (deadEnemies >= 1 || enemyJgVisibleTop || this.level >= 1 && g.rng.chance(0.25)))) return;
    if (takeObj('herald', 3, jg && jg.alive && (deadEnemies >= 1 || g.rng.chance(0.2)))) return;

    // Shrines: grab one when it's quiet
    if (ready('shrine') && charges >= 1 && g.time > 70) {
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
            if (ally && this.issue({ type: 'gank', lane })) { cd('gank', 35); return; }
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
    if (ready('group') && g.time > 720 && charges >= 2 && alive.length >= 4 && (deadEnemies >= 2 || alive.length > enemyAlive.length)) {
      if (this.issue({ type: 'group', lane: 'mid' })) { cd('group', 50); return; }
    }
    // Invade when enemy jungler seen far away
    if (this.level >= 1 && ready('invade') && charges >= 2 && g.time > 200 && g.time < 900) {
      const ej = them.heroes.find((h) => h.role === 'jungle');
      if (ej && (!ej.alive || (vis.has(ej.id) && jg && dist2(ej, jg) > 1600 * 1600))) { if (this.issue({ type: 'invade' })) { cd('invade', 120); return; } }
    }
  }

  pickHeraldLane() {
    const g = this.g;
    let best = null, bs = -1;
    for (const lane of LANE_NAMES) {
      const towers = g.units.filter((u) => u.type === 'tower' && u.team !== this.team && u.lane === lane && u.alive).length;
      if (towers > bs) { bs = towers; best = lane; }
    }
    return best;
  }
}
