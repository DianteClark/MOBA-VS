// Detect units that stop making progress outside of combat (pathing bugs).
import { Game } from '../src/sim/game.js';
import { MAPS as CLASSIC } from '../src/maps/defs.js';
const CLASSIC_IDS = CLASSIC.map((m) => m.id); // every classic map (MAPS=id,id env var: only those)
import { HEROES, ROLES } from '../src/data/heroes.js';
import { Rng } from '../src/sim/rng.js';
let total = 0;
for (const map of (process.env.MAPS || CLASSIC_IDS.join(',')).split(',')) {
  const rng = new Rng(map.length * 77); const used = new Set();
  const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return { id: h.id, role: r, build: h.rec }; });
  const g = new Game({ seed: 99, map, coach: [true, true], ...(process.env.LIVING !== '0' ? { living: 1, beasts: 1 } : {}), teams: [{ heroes: draft() }, { heroes: draft() }] }); // Living World unless LIVING=0
  const last = {}; const reports = [];
  while (g.time < 600 && !g.over) {
    g.step([]); g.fx.length = 0;
    if (g.tick % 20) continue;
    for (const t of g.teams) for (const h of t.heroes) {
      const L = last[h.id] || (last[h.id] = { x: h.x, y: h.y, t: g.tick });
      const moved = Math.hypot(h.x - L.x, h.y - L.y) > 30;
      const busy = !h.alive || h.recallAt || g.tick - h.lastCombat < 40 || !(g.tick - (h.moveIntent || -99) < 10) || h.stunUntil > g.tick || h.rootUntil > g.tick;
      if (moved || busy) { last[h.id] = { x: h.x, y: h.y, t: g.tick }; continue; }
      if (g.tick - L.t > 80) { reports.push(`${(g.time / 60).toFixed(1)}m ${h.heroId} ${h.task.kind} at ${Math.round(h.x)},${Math.round(h.y)}`); last[h.id] = { x: h.x, y: h.y, t: g.tick }; }
    }
  }
  console.log(`${map}: ${reports.length} stuck reports`); for (const r of reports.slice(0, 8)) console.log('  ', r);
  total += reports.length;
}
process.exit(total > 15 ? 1 : 0);
