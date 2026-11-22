// Fight forecast check (src/ui/forecast.js): how often a forecast fight really happens, and that the
// forecast never reads hidden enemies.
//   node tools/forecast.mjs [games=4] [--seed N]
// Precision: a forecast at time T with eta E is a hit when heroes of both teams (2+ each) trade hero
// damage within 700 of the spot between T+E-4s and T+E+5s. Fog: each forecast is recomputed with every
// unseen enemy moved to a far corner; the answer must not change.
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
import { defaultPrep } from '../src/sim/draft.js';
import { Rng } from '../src/sim/rng.js';
import { TICK_RATE } from '../src/sim/constants.js';
import { forecastFight } from '../src/ui/forecast.js';

const args = process.argv.slice(2), N = +(args.find((a) => !a.startsWith('--')) || 4);
const si = args.indexOf('--seed'), seed0 = si >= 0 ? +args[si + 1] : 4200;
let shown = 0, hits = 0, leaks = 0, samples = 0;
for (let n = 0; n < N; n++) {
  const rng = new Rng(seed0 + n), used = new Set();
  const team = () => ROLES.map((r) => { const c = HEROES.filter((x) => x.role === r && !used.has(x.id)); const x = c[rng.int(c.length)]; used.add(x.id); return x.id; });
  const g = new Game({ seed: seed0 + n, map: ['sakura', 'frost', 'ember', 'marsh'][n % 4], depth: true, coach: [true, true], teams: [defaultPrep(team()), defaultPrep(team())] });
  const mem = {}, open = [];
  let cool = 0;
  const hurt = new Map(); // hero id → ticks of hero damage dealt
  while (!g.over) {
    g.step([]); g.fx.length = 0;
    for (const t of g.teams) for (const x of t.heroes) if (x.lastHitHero >= g.tick - 1 && x.lastHitHero !== x._fcLast && (x._fcLast = x.lastHitHero) >= 0) (hurt.get(x.id) || hurt.set(x.id, []).get(x.id)).push({ t: g.tick, x: x.x, y: x.y });
    if (g.tick % TICK_RATE) continue;
    samples++;
    // fog check: the same forecast with every hidden enemy moved to a far corner
    const mem2 = { pos: new Map(mem.pos || []) };
    const f = forecastFight(g, 0, mem);
    const hidden = g.teams[1].heroes.filter((x) => x.alive && !g.vision[0].has(x.id)), saved = hidden.map((x) => [x.x, x.y]);
    for (const x of hidden) { x.x = 300; x.y = 300; }
    const f2 = forecastFight(g, 0, mem2);
    hidden.forEach((x, i) => { [x.x, x.y] = saved[i]; });
    if (JSON.stringify(f) !== JSON.stringify(f2)) leaks++;
    if (!f || g.tick < cool) continue;
    cool = g.tick + 20 * TICK_RATE; shown++;
    open.push({ ...f, t: g.tick });
  }
  for (const f of open) {
    const t0 = f.t + (f.eta - 4) * TICK_RATE, t1 = f.t + (f.eta + 5) * TICK_RATE;
    const side = (team) => g.teams[team].heroes.filter((x) => (hurt.get(x.id) || []).some((q) => q.t >= t0 && q.t <= t1 && Math.hypot(q.x - f.at.x, q.y - f.at.y) < 700)).length;
    const ok = side(0) >= 2 && side(1) >= 2; if (ok) hits++;
    if (args.includes('--v')) console.log(`  ${(f.t / TICK_RATE / 60).toFixed(1)}m ${f.mine}v${f.theirs} at ${f.where} in ${f.eta}s (unseen ${f.unseen}) → ${ok ? 'fight' : `no fight (${side(0)}/${side(1)})`}`);
  }
  console.log(`game ${n + 1}: ${open.length} forecasts, ${(g.time / 60).toFixed(1)}m`);
}
console.log(`\n${shown} forecasts (1 per 20s max) over ${samples} samples · fights happened for ${shown ? Math.round(hits / shown * 100) : 0}% · fog leaks ${leaks}`);
if (leaks) { console.log('FOG LEAK ✘'); process.exit(1); }
