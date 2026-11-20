// Run many AI-vs-AI games with random drafts and report balance stats.
//   node tools/balance.mjs [games=50] [maxMinutes=35]
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
import { Rng } from '../src/sim/rng.js';
const N = +(process.argv[2] || 50), MAXM = +(process.argv[3] || 35);
const rng = new Rng(12345);
const heroStats = {}; let blueWins = 0, redWins = 0, draws = 0, totalLen = 0, totalKills = 0, totalTowers = 0, objectives = { dragon: 0, herald: 0, baron: 0 };
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const used = new Set();
  const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return { id: h.id, role: r, build: h.builds[rng.int(h.builds.length)] }; });
  const a = draft(), b = draft();
  const g = new Game({ seed: 1000 + i, coach: [true, true], teams: [{ heroes: a, plan: 'balanced' }, { heroes: b, plan: 'balanced' }] });
  while (!g.over && g.time < MAXM * 60) { g.step([]); g.fx.length = 0; }
  const w = g.winner;
  if (w === 0) blueWins++; else if (w === 1) redWins++; else draws++;
  totalLen += g.time; totalKills += g.teams[0].kills + g.teams[1].kills; totalTowers += g.teams[0].towers + g.teams[1].towers;
  for (const e of g.events) if (e.type === 'objective') objectives[e.obj]++;
  for (const t of [0, 1]) for (const h of g.teams[t].heroes) {
    const s = heroStats[h.heroId] || (heroStats[h.heroId] = { g: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0 });
    s.g++; if (w === t) s.w++; s.k += h.kills; s.d += h.deaths; s.a += h.assists; s.dmg += h.dmgHeroes;
  }
  process.stdout.write(`game ${i + 1}: ${w === 0 ? 'BLUE' : w === 1 ? 'RED' : 'DRAW'} ${(g.time / 60).toFixed(1)}m kills ${g.teams[0].kills}-${g.teams[1].kills} towers ${g.teams[0].towers}-${g.teams[1].towers}\n`);
}
console.log(`\n${N} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Blue ${blueWins}  Red ${redWins}  Unfinished ${draws}`);
console.log(`Avg length ${(totalLen / N / 60).toFixed(1)}m, kills/game ${(totalKills / N).toFixed(1)}, towers/game ${(totalTowers / N).toFixed(1)}`);
console.log('Objectives/game', Object.fromEntries(Object.entries(objectives).map(([k, v]) => [k, (v / N).toFixed(2)])));
console.log('\nHero            games  win%   K/D/A        dmg/game');
for (const [id, s] of Object.entries(heroStats).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)) {
  console.log(`${id.padEnd(14)} ${String(s.g).padStart(5)}  ${(100 * s.w / s.g).toFixed(0).padStart(4)}%  ${(s.k / s.g).toFixed(1)}/${(s.d / s.g).toFixed(1)}/${(s.a / s.g).toFixed(1)}  ${Math.round(s.dmg / s.g)}`);
}
