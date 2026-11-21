// AI decision quality: how often do heroes die to avoidable mistakes?
//   node tools/aiq.mjs [games=8] [minutes=15]
// Classifies every hero death:
//   dive-fail   died inside an enemy tower's range without getting a kill in the last 4s
//   dive-trade  died under an enemy tower but traded for a kill (acceptable)
//   outnumbered died with 2+ more visible enemies than allies nearby
//   other       everything else (normal skirmish losses)
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
import { Rng } from '../src/sim/rng.js';
import { aiPrep } from '../src/sim/draft.js';

const N = +(process.argv[2] || 8), MIN = +(process.argv[3] || 15);
const why = {};
const tot = { dives: 0, diveDie: 0, diveWin: 0, diveTradeX: 0, diveOut: 0, deaths: 0, diveFail: 0, diveTrade: 0, outnumbered: 0, kills: 0, blue: 0, games: 0, mins: 0 };
for (let i = 0; i < N; i++) {
  const rng = new Rng(777 + i), used = new Set();
  const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return h.id; });
  const a = draft(), b = draft();
  const g = new Game({ seed: 31337 + i, map: ['sakura', 'frost', 'ember', 'marsh'][i % 4], coach: [true, true], coachLevel: [2, 2], teams: [aiPrep(a, b), aiPrep(b, a)] });
  const lastKill = {}, dives = {};
  let ev = 0;
  while (!g.over && g.time < MIN * 60) {
    // snapshot context before the step so we see the scene at the moment of death
    const snap = new Map();
    for (const t of g.teams) for (const h of t.heroes) if (h.alive && h.hp < h.maxHp * 0.25) {
      const tower = g.units.find((s) => s.type === 'tower' && s.alive && s.team !== h.team && (s.x - h.x) ** 2 + (s.y - h.y) ** 2 < (s.stats.range + 20) ** 2);
      const foes = g.teams[1 - h.team].heroes.filter((e) => e.alive && (e.x - h.x) ** 2 + (e.y - h.y) ** 2 < 700 * 700).length;
      const pals = t.heroes.filter((x) => x.alive && (x.x - h.x) ** 2 + (x.y - h.y) ** 2 < 700 * 700).length;
      snap.set(h.id, { tower: !!tower, foes, pals, task: h.task.kind + (h.task.call ? '*' : ''), fleeing: h.fleeUntil > g.tick, hp: Math.round(100 * h.hp / h.maxHp) });
    }
    g.step([]); g.fx.length = 0;
    // dive tracking: entering enemy tower range while fighting an enemy hero (not a minion wave push)
    for (const t of g.teams) for (const h of t.heroes) {
      const inT = h.alive && g.units.some((s) => s.type === 'tower' && s.alive && s.team !== h.team && (s.x - h.x) ** 2 + (s.y - h.y) ** 2 < s.stats.range ** 2);
      const D = dives[h.id] || (dives[h.id] = { in: false });
      if (inT && !D.in && h.fightTarget && g.tick - h.lastCombat < 20) { D.in = true; D.t = g.tick; D.k = h.kills + h.assists; D.dead = h.deaths; tot.dives++; }
      if (D.in && (g.tick - D.t > 160 || !inT && h.alive)) {
        const killed = h.kills + h.assists > D.k, died = h.deaths > D.dead;
        if (died && !killed) tot.diveDie++; else if (killed && !died) tot.diveWin++; else if (killed && died) tot.diveTradeX++; else tot.diveOut++;
        D.in = false;
      }
    }
    for (; ev < g.events.length; ev++) {
      const e = g.events[ev]; if (e.type !== 'kill') continue;
      tot.deaths++; if (e.killer) lastKill[e.killer] = g.tick;
      for (const id of e.assists || []) lastKill[id] = g.tick;
      const s = snap.get(e.victim); if (!s) continue;
      const traded = (lastKill[e.victim] || -1e9) > g.tick - 80;
      if (s.tower) { if (traded) tot.diveTrade++; else { tot.diveFail++; const k = 'DIVE ' + s.task + (s.fleeing ? '/fleeing' : '/fighting') + ' hp' + (s.hp < 10 ? '<10' : '<25'); why[k] = (why[k] || 0) + 1; } }
      else if (s.foes >= s.pals + 2) { tot.outnumbered++; const k = s.task + (s.fleeing ? '/fleeing' : '/fighting'); why[k] = (why[k] || 0) + 1; }
    }
  }
  tot.games++; tot.mins += g.time / 60; if (g.winner === 0) tot.blue++;
  tot.kills += g.teams[0].kills + g.teams[1].kills;
}
const pm = (x) => (x / tot.mins).toFixed(2);
console.log(`dives ${tot.dives}: won ${tot.diveWin}, traded ${tot.diveTradeX}, backed out ${tot.diveOut}, died for nothing ${tot.diveDie} (${(100 * tot.diveDie / Math.max(1, tot.dives)).toFixed(0)}%)`);
console.log(`${tot.games} games (${tot.mins.toFixed(0)} min): kills/min ${pm(tot.kills)} | dive-fail/min ${pm(tot.diveFail)} | dive-trade/min ${pm(tot.diveTrade)} | outnumbered deaths/min ${pm(tot.outnumbered)} | mistake share ${(100 * (tot.diveFail + tot.outnumbered) / Math.max(1, tot.deaths)).toFixed(1)}% | blue wins ${tot.blue}/${tot.games}`);
if (process.env.V) console.log('outnumbered deaths by task/state', JSON.stringify(Object.entries(why).sort((a, b) => b[1] - a[1])));
