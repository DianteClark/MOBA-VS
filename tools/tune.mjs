// Self-play balance tuner. Runs AI-vs-AI games with random drafts on all maps,
// nudges each hero's power multiplier toward a 50% win rate, writes src/data/tuning.js.
//   node tools/tune.mjs [rounds=2] [gamesPerRound=80] [workers=2]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!isMainThread) {
  const { Game } = await import('../src/sim/game.js');
  const { HEROES, ROLES } = await import('../src/data/heroes.js');
  const { Rng } = await import('../src/sim/rng.js');
  const { aiPrep } = await import('../src/sim/draft.js');
  const tuneMod = await import('../src/data/tuning.js');
  Object.assign(tuneMod.TUNE, workerData.tune);
  for (const i of workerData.seeds) {
    const rng = new Rng(i * 7919 + 3); const used = new Set();
    const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return h.id; });
    const a = draft(), b = draft();
    const g = new Game({ seed: i * 104729 + 11, map: ['sakura', 'frost', 'ember'][i % 3], coach: [true, true], teams: [aiPrep(a, b), aiPrep(b, a)] });
    while (!g.over) { g.step([]); g.fx.length = 0; }
    parentPort.postMessage({ teams: [a, b], winner: g.winner, kills: g.teams[0].kills + g.teams[1].kills, timeout: g.events.some((e) => e.type === 'victory' && e.timeout), towers: g.teams[0].towers + g.teams[1].towers });
  }
  parentPort.postMessage({ done: true });
} else {
  const rounds = +(process.argv[2] || 2), per = +(process.argv[3] || 80), nw = +(process.argv[4] || 2);
  const { TUNE } = await import('../src/data/tuning.js');
  const { HEROES } = await import('../src/data/heroes.js');
  const tune = Object.fromEntries(HEROES.map((h) => [h.id, TUNE[h.id] || 1]));
  let seedBase = 5000;
  for (let r = 0; r < rounds; r++) {
    const stats = Object.fromEntries(HEROES.map((h) => [h.id, { g: 0, w: 0 }]));
    let blue = 0, games = 0, kills = 0, timeouts = 0, towers = 0;
    const seeds = Array.from({ length: per }, (_, k) => seedBase + k); seedBase += per;
    await Promise.all(Array.from({ length: nw }, (_, w) => new Promise((res) => {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds: seeds.filter((_, k) => k % nw === w), tune } });
      wk.on('message', (m) => {
        if (m.done) { res(); return; }
        games++; if (m.winner === 0) blue++; kills += m.kills; timeouts += m.timeout ? 1 : 0; towers += m.towers;
        m.teams.forEach((ids, t) => ids.forEach((id) => { stats[id].g++; if (m.winner === t) stats[id].w++; }));
        if (games % 10 === 0) process.stdout.write(`  round ${r + 1}: ${games}/${per}\n`);
      });
      wk.on('error', (e) => { console.error(e); res(); });
    })));
    console.log(`Round ${r + 1}: blue ${(100 * blue / games).toFixed(0)}%, kills/game ${(kills / games).toFixed(1)}, towers/game ${(towers / games).toFixed(1)}, on time ${(100 * timeouts / games).toFixed(0)}%`);
    const rows = [];
    for (const h of HEROES) {
      const s = stats[h.id]; const wr = (s.w + 4) / (s.g + 8);
      const delta = Math.max(-0.05, Math.min(0.05, (0.5 - wr) * 0.35));
      tune[h.id] = Math.max(0.8, Math.min(1.2, +(tune[h.id] * (1 + delta)).toFixed(3)));
      rows.push([h.id, s.g, (100 * s.w / Math.max(1, s.g)).toFixed(0), tune[h.id]]);
    }
    rows.sort((a, b) => b[2] - a[2]);
    console.log(rows.map((r) => `${r[0].padEnd(9)} ${String(r[1]).padStart(3)}g ${String(r[2]).padStart(3)}% -> ${r[3]}`).join('\n'));
    const body = Object.entries(tune).filter(([, v]) => v !== 1).map(([k, v]) => `  ${k}: ${v},`).join('\n');
    writeFileSync(new URL('../src/data/tuning.js', import.meta.url), `// Per-hero power multipliers produced by tools/tune.mjs (self-play balance).\n// 1.00 = untouched. Applied as +/- damage and a little +/- health.\nexport const TUNE = {\n${body}\n};\n`);
  }
}
