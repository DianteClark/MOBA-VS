// Coach Moments: three dramatic, once-per-match calls (sim side + the AI coach's use of them).
// They travel as ordinary deterministic commands ({ type: 'moment', id }), cost no charges,
// and share a short lockout so a team cannot chain all three into one fight.
import { sec } from './constants.js';

export const MOMENTS = {
  timeout: { name: 'Timeout', icon: 'Heal', color: '#5fe0d0', short: 'Reset basics, heal up',
    desc: 'Everyone\'s basic ability cooldowns reset, the team heals 24% HP over 4s, and anyone at base is fully healed.' },
  rally: { name: 'Rally', icon: 'AttackUpgrade', color: '#ffd84a', short: '+15% dmg & speed 6s',
    desc: 'The whole team gets +15% damage and +15% move speed for 6s and shakes off slows.' },
  push: { name: 'All-Out Push', icon: 'Explosion', color: '#ff8a3a', short: 'Next wave: super minions',
    desc: 'Your next minion wave marches empowered: +60% HP and damage, faster, led by a super minion.' },
};
export const MOMENT_IDS = Object.keys(MOMENTS);
export const MOMENT = { lockout: 30, openAt: 75, rallySec: 6, rally: 0.15, healSec: 4, heal: 0.24 };

// When a team may use one (UI greys buttons with the same rule). k scales the opening time for short modes.
export function momentReady(g, team, id) {
  const t = g.teams[team];
  return !!MOMENTS[id] && !t.moments[id] && t.momentCd <= g.tick && g.time >= MOMENT.openAt * g.rules.k && !g.over;
}

export function applyMoment(g, c) {
  const team = g.teams[c.team], id = c.id;
  if (!momentReady(g, c.team, id)) return false;
  const alive = team.heroes.filter((h) => h.alive);
  const now = g.tick;
  if (id === 'timeout') {
    if (!alive.length) return false;
    const base = g.world.baseCenter[c.team];
    for (const h of alive) {
      h.cds[0] = Math.min(h.cds[0], now); h.cds[1] = Math.min(h.cds[1], now);
      g.addBuff(h, { regen: h.maxHp * MOMENT.heal / MOMENT.healSec }, MOMENT.healSec, 'timeout');
      if ((h.x - base.x) ** 2 + (h.y - base.y) ** 2 < 420 * 420) h.hp = h.maxHp;
      g.fx.push({ kind: 'fx', name: 'spirit', x: h.x, y: h.y, s: 1.5, follow: h.id });
    }
  } else if (id === 'rally') {
    if (!alive.length) return false;
    for (const h of alive) {
      g.addBuff(h, { dmgPct: MOMENT.rally, msPct: MOMENT.rally }, MOMENT.rallySec, 'rallyMoment'); h.slows = [];
      g.fx.push({ kind: 'fx', name: 'boost', x: h.x, y: h.y, s: 1.7, follow: h.id });
    }
  } else if (id === 'push') {
    team.allOut = 1;
    const nx = g.world.nexus[c.team];
    g.fx.push({ kind: 'fx', name: 'boost', x: nx.x, y: nx.y, s: 2.4 });
  } else return false;
  team.moments[id] = now + 1; // tick+1 so "used at tick 0" is still truthy
  team.momentCd = now + sec(MOMENT.lockout);
  g.emit({ type: 'moment', team: c.team, id });
  return true;
}

// AI coach: spend moments where they swing the game. Returns true when one was used.
export function aiMoment(coach, ctx) {
  const g = coach.g, me = coach.team, now = g.tick;
  if (coach.level === 0 && g.rng.chance(0.5)) return false; // Easy coaches forget about them half the time
  const { alive, visibleEnemies, deadEnemies } = ctx;
  // Rival coaches have a habit: 'early' fires them on the first decent fight, 'late' saves them for the second half
  const habit = (coach.style && coach.style.moment) || '';
  if (habit === 'late' && g.time < 450 * g.rules.k && deadEnemies < 3) return false;
  const minFight = habit === 'early' ? 2 : 3;
  const use = (id) => momentReady(g, me, id) && coach.issue({ type: 'moment', id });
  const near = (h, list, r) => list.filter((e) => (e.x - h.x) ** 2 + (e.y - h.y) ** 2 < r * r);
  const fighters = alive.filter((h) => now - h.lastCombat < sec(2) && near(h, visibleEnemies, 700).length);
  const foes = visibleEnemies.filter((e) => fighters.some((h) => (e.x - h.x) ** 2 + (e.y - h.y) ** 2 < 750 * 750));
  const avgHp = fighters.reduce((a, h) => a + h.hp / h.maxHp, 0) / Math.max(1, fighters.length);
  const underTheirTower = fighters.some((h) => g.units.some((u) => u.type === 'tower' && u.alive && u.team !== me && (u.x - h.x) ** 2 + (u.y - h.y) ** 2 < (u.stats.range + 60) ** 2));
  // Rally: an even-or-better teamfight in the open
  if (fighters.length >= minFight && foes.length >= 2 && fighters.length >= foes.length && avgHp > 0.4 && !underTheirTower && use('rally')) return true;
  // Timeout: a drawn-out fight where the team is worn down but nobody has died yet
  const worn = alive.length >= 3 && alive.reduce((a, h) => a + h.hp / h.maxHp, 0) / alive.length < 0.45;
  const spent = alive.filter((h) => h.cds[0] > now + sec(3) && h.cds[1] > now + sec(3)).length;
  if (worn && (fighters.length >= 2 || spent >= 3) && alive.length >= visibleEnemies.length && use('timeout')) return true;
  // All-Out Push: after winning a fight (2+ enemies dead for a while) or to close out late
  const late = g.time > 600 * g.rules.k;
  if ((deadEnemies >= 2 || (late && deadEnemies >= 1 && alive.length >= 4)) && alive.length >= 3 && use('push')) return true;
  // Use-it-or-lose-it: last minutes of the match, push when ahead on towers or desperate
  if (g.timeLeft < 75 && use('push')) return true;
  return false;
}
