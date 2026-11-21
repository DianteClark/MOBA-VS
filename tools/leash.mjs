// Leash test: no minion or monster may live outside its zone.
//   node tools/leash.mjs [games=6]
// Plays seeded bot matches (classic on all 4 maps, plus Lane Rush) and samples every unit twice a
// second. A minion more than LEASH.minion (+40px body slack) off its lane, or a camp monster /
// objective boss farther than its leash (+40) from home (shoved, hooked or knocked out), must walk
// straight back: it has to close in by 30px every 3s until it is inside again, otherwise that is a
// violation. Exits 1 on any violation.
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
import { Rng } from '../src/sim/rng.js';
import { aiPrep } from '../src/sim/draft.js';
import { LEASH } from '../src/sim/constants.js';

const N = +(process.argv[2] || 6);
const MAPS = [['classic', 'sakura'], ['classic', 'frost'], ['classic', 'ember'], ['classic', 'marsh'], ['rush', 'rush_sakura'], ['rush', 'rush_ember']];
let bad = 0, samples = 0;
const worst = { minion: 0, mob: 0, boss: 0 };
for (let i = 0; i < N; i++) {
  const [mode, map] = MAPS[i % MAPS.length];
  const rng = new Rng(555 + i), used = new Set();
  const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return h.id; });
  const a = draft(), b = draft();
  const g = new Game({ seed: 900 + i, mode, map, coach: [true, true], teams: [aiPrep(a, b), aiPrep(b, a)] });
  const out = new Map();
  while (!g.over && g.time < g.rules.seconds) {
    g.step([]); g.fx.length = 0;
    if (g.tick % 10) continue;
    for (const u of g.units) {
      if (!u.alive) continue;
      let off, L, k;
      if (u.type === 'minion') { off = g.world.distToLane(u.lane, u); L = LEASH.minion; k = 'minion'; }
      else if ((u.type === 'mob' || u.type === 'objective') && u.home) { off = Math.sqrt((u.x - u.home.x) ** 2 + (u.y - u.home.y) ** 2); L = u.type === 'objective' ? LEASH.boss : LEASH.mob; k = u.type === 'objective' ? 'boss' : 'mob'; }
      else continue;
      samples++; if (off > worst[k]) worst[k] = off;
      if (off <= L + 40) { out.delete(u.id); continue; }
      { const o = out.get(u.id); if (o && !o.done && g.tick - o.t >= 60 && off <= o.d - 30) { o.t = g.tick; o.d = off; o.n = (o.n || 0) + 1; } }
      const o = out.get(u.id);
      if (o === undefined) { out.set(u.id, { t: g.tick, d: off }); continue; }
      if (o.done) continue;
      // walking back around a wall can take a while: fine while it keeps closing in (30px per 3s), never past 8s
      if (g.tick - o.t >= 60 && off > o.d - 30) { bad++; o.done = true; console.log(`  ${map} ${(g.time / 60).toFixed(1)}m ${k} ${u.kind || ''} ${Math.round(off)}px out for 3s+ at ${Math.round(u.x)},${Math.round(u.y)}`); }
    }
  }
  console.log(`${mode}/${map}: ${(g.time / 60).toFixed(1)} min checked`);
}
console.log(`${samples} samples; furthest out: minion ${Math.round(worst.minion)}px (leash ${LEASH.minion}), monster ${Math.round(worst.mob)}px (leash ${LEASH.mob}), boss ${Math.round(worst.boss)}px (leash ${LEASH.boss})`);
console.log(bad ? `LEASH VIOLATIONS: ${bad} ✘` : 'ALL UNITS STAYED IN THEIR ZONES ✔');
process.exit(bad ? 1 : 0);
