// Path-quality benchmark: how smoothly do units actually move?
//   node tools/pathq.mjs [minutes=8] [seeds=2]
// Per map: stuck reports, blocked-move ratio, heading reversals, facing flips, wall scrapes,
// route efficiency for long trips, and A* cost.
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
const CORE = ['bastion','kenshi','varro','brawlo','grok','kaze','leonin','karasu','umbra','gama','ember','raiden','totem','sanguis','hex','fletch','marlowe','shuri','bolt','sling','oak','wu','aurelia','bonehook','frost'];
import { Rng } from '../src/sim/rng.js';
import { World } from '../src/sim/world.js';
import { performance } from 'node:perf_hooks';

const MIN = +(process.argv[2] || 8), SEEDS = +(process.argv[3] || 2);
const fp = World.prototype.findPath; let astar = 0, astarMs = 0;
World.prototype.findPath = function (...a) { const t = performance.now(); const r = fp.apply(this, a); astarMs += performance.now() - t; astar++; return r; };

const tot = {};
for (const map of ['sakura', 'frost', 'ember']) {
  const S = { moveTicks: 0, blocked: 0, reversals: 0, flips: 0, stuck: 0, scrapes: 0, minMove: 0, minBlocked: 0, trips: 0, eff: 0, astar: 0, astarMs: 0, ticks: 0 };
  astar = 0; astarMs = 0;
  for (let sd = 0; sd < SEEDS; sd++) {
    const rng = new Rng(map.length * 77 + sd); const used = new Set();
    const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id) && CORE.includes(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return { id: h.id, role: r }; });
    const g = new Game({ seed: 99 + sd, map, coach: [true, true], teams: [{ heroes: draft() }, { heroes: draft() }] });
    g.navStats = { scrapes: 0 };
    const st = new Map();
    while (g.time < MIN * 60 && !g.over) {
      g.step([]); g.fx.length = 0; S.ticks++;
      for (const u of g.units) {
        if (!u.alive || u.structure || u.boss) continue;
        if (u.type !== 'hero' && u.type !== 'minion') continue;
        let s = st.get(u.id); if (!s) { s = { x: u.x, y: u.y, vx: 0, vy: 0, face: u.facing, trip: null, last: { x: u.x, y: u.y, t: g.tick } }; st.set(u.id, s); }
        const mx = u.x - s.x, my = u.y - s.y; s.x = u.x; s.y = u.y;
        const intent = u.moveIntent >= g.tick - 1 && !u.dash && g.canMove(u);
        if (u.type === 'minion') { if (intent) { S.minMove++; if (Math.sqrt(mx * mx + my * my) < g.moveSpeed(u) / 20 * 0.35) S.minBlocked++; } continue; }
        if (intent) {
          S.moveTicks++;
          const d = Math.sqrt(mx * mx + my * my), exp = g.moveSpeed(u) / 20;
          if (d < exp * 0.35) S.blocked++;
          if (d > 0.5 && (s.vx || s.vy) && (mx * s.vx + my * s.vy) < -0.2 * d * Math.sqrt(s.vx * s.vx + s.vy * s.vy)) { const fight = g.tick - u.lastCombat < 40; if (fight) S.revFight = (S.revFight || 0) + 1; else { S.reversals++; const k = u.task.kind; S.revBy = S.revBy || {}; S.revBy[k] = (S.revBy[k] || 0) + 1; } }
          if (d > 0.5) { s.vx = mx; s.vy = my; }
          if (u.facing !== s.face) S.flips++;
          // long trips: efficiency = straight distance / walked distance over 4s windows of steady intent
          if (!s.trip) s.trip = { x: u.x, y: u.y, walked: 0, n: 0 };
          s.trip.walked += d; s.trip.n++;
          if (s.trip.n >= 80) { const sd2 = Math.sqrt((u.x - s.trip.x) ** 2 + (u.y - s.trip.y) ** 2); if (s.trip.walked > 150) { S.trips++; S.eff += sd2 / s.trip.walked; } s.trip = null; }
        } else s.trip = null;
        s.face = u.facing;
        // stuck: moving intent, no 30px progress in 4s, not fighting
        const busy = !intent || g.tick - u.lastCombat < 40;
        if (busy || Math.sqrt((u.x - s.last.x) ** 2 + (u.y - s.last.y) ** 2) > 30) s.last = { x: u.x, y: u.y, t: g.tick };
        else if (g.tick - s.last.t > 80) { S.stuck++; s.last = { x: u.x, y: u.y, t: g.tick }; if (process.env.V) console.log(`  stuck ${map} ${(g.time / 60).toFixed(1)}m ${u.heroId} ${u.task.kind} @${Math.round(u.x)},${Math.round(u.y)}`); }
      }
    }
    S.scrapes += g.navStats.scrapes;
  }
  S.astar = astar; S.astarMs = astarMs;
  const mins = S.ticks / 20 / 60;
  console.log(`${map.padEnd(7)} stuck ${String(S.stuck).padStart(3)} | blocked ${(100 * S.blocked / S.moveTicks).toFixed(1)}% | reversals/min ${(S.reversals / mins).toFixed(1)} | facing flips/min ${(S.flips / mins).toFixed(0)} | scrapes/min ${(S.scrapes / mins).toFixed(0)} | efficiency ${(100 * S.eff / Math.max(1, S.trips)).toFixed(1)}% | minion blocked ${(100 * S.minBlocked / Math.max(1, S.minMove)).toFixed(1)}% | A* ${(S.astar / mins).toFixed(0)}/min ${(S.astarMs / mins).toFixed(0)}ms/min`);
  if (process.env.V) console.log('   peaceful reversals by task', JSON.stringify(S.revBy), 'in-fight', S.revFight);
  for (const [k, v] of Object.entries(S)) if (typeof v === 'number') tot[k] = (tot[k] || 0) + v;
}
const mins = tot.ticks / 20 / 60;
console.log(`TOTAL   stuck ${tot.stuck} | blocked ${(100 * tot.blocked / tot.moveTicks).toFixed(1)}% | reversals/min ${(tot.reversals / mins).toFixed(1)} | flips/min ${(tot.flips / mins).toFixed(0)} | scrapes/min ${(tot.scrapes / mins).toFixed(0)} | efficiency ${(100 * tot.eff / tot.trips).toFixed(1)}% | minion blocked ${(100 * tot.minBlocked / tot.minMove).toFixed(1)}% | A* ${(tot.astarMs / mins).toFixed(0)}ms/min`);
