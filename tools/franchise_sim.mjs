// Franchise economy and model checks (headless).
//   node tools/franchise_sim.mjs [leagues=40] [seasons=12] [--seed N] [--tank] [--verbose]
//       Plays whole franchise leagues for many seasons with the quick-resolve model. Your franchise is run by the
//       assistant GM (the same rules as the AI GMs), so every team plays by one rulebook. Reports competitive
//       balance (spread of wins, title concentration, how sticky a team's record is from one season to the next),
//       the economy (payroll, budgets, fans), and how fast a bottom team recovers.
//       --tank   your franchise starts with a gutted roster (every hero -12 OVR) to check that a bad season is recoverable.
//   node tools/franchise_sim.mjs --calibrate [games=60] [--mods 0.03,0.06,0.1] [--workers 2]
//       Full 5v5 sims (AI vs AI, random teams, sides alternate): one team gets +mod on every hero. Prints the win rate
//       per mod and the K that the quick model (src/franchise/model.js winProb) implies. Slow: ~15-30 s per game.
//   node tools/franchise_sim.mjs --pro [weeks=20]
//       Pro League: champions, parity and timing of the deterministic weekly league (src/franchise/pro.js).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), flag = (k) => args.includes('--' + k);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !['--seed', '--mods', '--workers'].includes(args[i - 1]));

if (!isMainThread) {
  // calibration worker: full sims
  const { Game } = await import('../src/sim/game.js'); const { aiPrep } = await import('../src/sim/draft.js');
  for (const j of workerData.jobs) {
    const t = [aiPrep(j.a, j.b), aiPrep(j.b, j.a)];
    t[j.side].heroes.forEach((x) => { x.mod = j.d; });
    const g = new Game({ seed: j.seed, map: ['sakura', 'frost', 'ember', 'marsh'][j.seed % 4], coach: [true, true], teams: t });
    while (!g.over) { g.step([]); g.fx.length = 0; }
    parentPort.postMessage({ d: j.d, win: g.winner === j.side ? 1 : 0 });
  }
  parentPort.postMessage({ done: true });
} else if (flag('calibrate')) {
  const { HEROES, ROLES } = await import('../src/data/heroes.js'); const { Rng } = await import('../src/sim/rng.js');
  const N = +(pos[0] || 60), mods = opt('mods', '0.03,0.06,0.1').split(',').map(Number), NW = +opt('workers', 2), rng = new Rng(+opt('seed', 77));
  const jobs = [];
  for (let i = 0; i < N; i++) for (const d of mods) {
    const used = new Set(), pick = () => ROLES.map((r) => { const l = HEROES.filter((h) => h.role === r && !used.has(h.id)); const x = l[rng.int(l.length)].id; used.add(x); return x; });
    jobs.push({ a: pick(), b: pick(), d, side: i % 2, seed: 1000 + jobs.length * 7 });
  }
  const res = {}; const t0 = Date.now();
  await Promise.all(Array.from({ length: NW }, (_, w) => new Promise((done) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: jobs.filter((_, k) => k % NW === w) } });
    wk.on('message', (m) => { if (m.done) return done(); const r = res[m.d] || (res[m.d] = [0, 0]); r[0] += m.win; r[1]++; });
    wk.on('error', (e) => { console.error(e); done(); });
  })));
  console.log(`${jobs.length} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  let num = 0, den = 0;
  for (const d of mods) {
    const [w, n] = res[d] || [0, 0], p = (w + 0.5) / (n + 1), k = Math.log(p / (1 - p)) / d;
    console.log(`mod +${(d * 100).toFixed(0)}%: ${w}/${n} = ${(100 * w / n).toFixed(0)}% (±${(100 * Math.sqrt(p * (1 - p) / n)).toFixed(0)}) → K ≈ ${k.toFixed(1)}`);
    num += k * n * d * d; den += n * d * d;
  }
  console.log(`weighted K ≈ ${(num / den).toFixed(1)}`);
} else if (flag('pro')) {
  const P = await import('../src/franchise/pro.js');
  const W = +(pos[0] || 20), w0 = P.weekIndex(Date.UTC(2026, 10, 23));
  const titles = {}; let upsets = 0, games = 0; const t0 = performance.now();
  for (let w = w0; w < w0 + W; w++) {
    const L = P.proWeek(w);
    for (const md of L.days) for (const m of md.matches) { games++; if ((m.p >= 0.5) !== (m.w === 0)) upsets++; }
    titles[L.champion] = (titles[L.champion] || 0) + 1;
  }
  const ms = performance.now() - t0;
  console.log(`${W} weeks, ${games} matches, upsets ${(100 * upsets / games).toFixed(0)}%, ${(ms / W).toFixed(2)} ms per week`);
  console.log('titles', Object.entries(titles).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${P.PRO_BY_ID[t].abbr} ${n}`).join(' · '));
} else {
  const L = await import('../src/franchise/league.js'); const D = await import('../src/franchise/data.js');
  const N = +(pos[0] || 40), S = +(pos[1] || 12), seed0 = +opt('seed', 1);
  const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
  const corr = (xs, ys) => { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length; let n = 0, a = 0, b = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); a += (x - mx) ** 2; b += (ys[i] - my) ** 2; }); return n / Math.sqrt(a * b); };
  const winSd = [], maxTitles = [], repeat = [], prevW = [], nextW = [], payrolls = [], budgets = [], fans = [], youPlace = [], strGap = Array.from({ length: S }, () => []);
  const recover = []; // seasons until a last-place team makes the playoffs
  let lastPlace = [], champs = 0, myTitles = 0, rosterFails = 0;
  const t0 = performance.now();
  for (let lg = 0; lg < N; lg++) {
    const fr = L.newFranchise({ name: 'You', abbr: 'YOU', c1: '#fff', c2: '#000', p: 0, e: 0, seed: seed0 * 1000 + lg });
    if (flag('tank')) for (const x of L.rosterOf(fr, 0)) x.o = Math.max(42, x.o - 12);
    const titles = new Array(D.LEAGUE_TEAMS).fill(0), wins = []; let prevChamp = -1; const lastSeen = {};
    for (let s = 0; s < S; s++) {
      while (fr.phase !== 'offseason') if (!L.quickFixture(fr)) throw new Error('no fixture');
      const sum = fr.off.sum; wins.push(sum.map((x) => x.w));
      winSd.push(sd(sum.map((x) => x.w)));
      const ch = fr.off.champ; titles[ch]++; if (ch === prevChamp) repeat.push(1); else repeat.push(0); prevChamp = ch; champs++; if (ch === 0) myTitles++;
      youPlace.push(sum[0].place);
      for (let t = 0; t < D.LEAGUE_TEAMS; t++) { budgets.push(fr.teams[t].bud); fans.push(fr.teams[t].fans); }
      const strs = fr.teams.map((_, t) => { const l = L.aiLineup(fr, t); return l ? L.lineupInfo(l).str : 0; });
      strGap[s].push(Math.max(...strs) - Math.min(...strs));
      // recovery: the last-place team, how many seasons until a top-4 finish
      for (const x of sum) { if (lastSeen[x.t] !== undefined && x.place <= 4) { recover.push(s - lastSeen[x.t]); delete lastSeen[x.t]; } }
      const last = sum.slice().sort((a, b) => b.place - a.place)[0]; if (lastSeen[last.t] === undefined) lastSeen[last.t] = s;
      if (s > 0) for (let t = 0; t < D.LEAGUE_TEAMS; t++) { prevW.push(wins[s - 1][t]); nextW.push(wins[s][t]); }
      if (flag('verbose') && lg === 0) console.log(`S${fr.season} champ ${fr.teams[ch].abbr} · wins ${sum.map((x) => x.w).join(' ')} · you ${sum[0].place} · bud ${fr.teams.map((t) => t.bud).join(' ')}`);
      if (!L.assistant(fr)) { rosterFails++; break; }
      for (let t = 0; t < D.LEAGUE_TEAMS; t++) payrolls.push(L.payroll(fr, t));
    }
    maxTitles.push(Math.max(...titles));
    lastPlace.push(...Object.values(lastSeen).map(() => 1));
  }
  const ms = performance.now() - t0;
  const pct = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${N} leagues × ${S} seasons in ${(ms / 1000).toFixed(1)}s (${(ms / N / S).toFixed(1)} ms per season)${flag('tank') ? ' · TANK start' : ''}`);
  console.log(`wins per season: sd ${avg(winSd).toFixed(2)} (pure coin flips ≈ ${Math.sqrt(D.ROUNDS * 0.25).toFixed(2)})`);
  console.log(`season-to-season win correlation: ${corr(prevW, nextW).toFixed(2)} (1 = frozen order, 0 = random)`);
  console.log(`repeat champions: ${(100 * avg(repeat)).toFixed(0)}% (random ≈ ${(100 / D.LEAGUE_TEAMS).toFixed(0)}%) · most titles by one team in ${S} seasons: avg ${avg(maxTitles).toFixed(1)}, max ${Math.max(...maxTitles)}`);
  console.log(`strength gap best-worst lineup: season 1 ${(100 * avg(strGap[0])).toFixed(1)}% → season ${S} ${(100 * avg(strGap[S - 1])).toFixed(1)}%`);
  console.log(`recovery: a last-place team reaches the top 4 after ${avg(recover).toFixed(1)} seasons (median ${pct(recover, 0.5)}, 90% within ${pct(recover, 0.9)}); never within the run: ${lastPlace.length}`);
  console.log(`budgets: ${pct(budgets, 0.1)}-${pct(budgets, 0.9)}k (10-90%) · payroll ${pct(payrolls, 0.1)}-${pct(payrolls, 0.9)}k · fans ${pct(fans, 0.1)}-${pct(fans, 0.9)}`);
  console.log(`your franchise (assistant GM): avg place ${avg(youPlace).toFixed(2)}, titles ${myTitles}/${champs} (fair share ${(100 / D.LEAGUE_TEAMS).toFixed(0)}%) · roster dead-ends ${rosterFails}`);
  const byS = Array.from({ length: S }, (_, s) => avg(youPlace.filter((_, i) => i % S === s)));
  console.log('your average place by season: ' + byS.map((x) => x.toFixed(1)).join(' '));
}
