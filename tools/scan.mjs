// Champion scan (unlock price tiers): coaching sensitivity per hero, SHARP coach vs PASSIVE coach.
//   node tools/scan.mjs [pairs=40] [workers=2] [--seed N] [--log games.jsonl] [--duos P] [--quiet] [--noliving]
//   node tools/scan.mjs --from a.jsonl[,b.jsonl] [--json out.json]        (re-aggregate saved games)
//   --focus a,b,c  a focused re-check: every matchup seats the listed heroes in their main role (one per team and
//                  role, rotating through the list); every other seat is a control drawn from the shuffled decks.
//   The summary flags any hero whose SHRUNK sharp win rate is >= 90% or passive win rate <= 12% (--focus: those only).
// Test-only (no gameplay change): every matchup is played TWICE with the same seed, map and heroes,
// once with team A sharp / team B passive and once the other way round, so each hero's coaching gap is a
// paired difference in an identical matchup.
//   SHARP   = the full AI coach (Coach level 2: calls, moments, tactics, ult calls, halftime), aiPrep
//             (counter builds, the recommended plan and its tactic deck), AI talents.
//   PASSIVE = no coach at all (no calls, moments or tactics), defaultPrep (each hero's recommended build,
//             the Balanced plan, the default deck), auto talents (the game's own pick when nobody touches
//             the talent tray). This is a player who drafts and then only watches.
// Matches use the live match settings (match depth on, Living World and Bosses & Beasts on; --noliving: neither).
// Heroes come from shuffled per-role decks (even coverage); in a share P of matchups (default 0.4) one random
// cross-role duo is put on a random team so duo dependence can be measured.
// Report: per hero sharp/passive win rate, both centred on their condition's mean, the gap (sharp - passive,
// centred), the paired change in the hero's share of team gold and hero damage, empirical-Bayes shrinkage of each, the context spread (comp / duo / clan / plan) used for the
// Specialist call, and a relative-KDA impact under each coach.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAPS = ['sakura', 'frost', 'ember', 'marsh'];

if (!isMainThread) {
  const { Game } = await import('../src/sim/game.js');
  const { aiPrep, defaultPrep } = await import('../src/sim/draft.js');
  for (const job of workerData.jobs) {
    const sharp = job.sharp; // sharp: which team (0|1) gets the sharp coach
    const prep = (t) => { const ids = job.teams[t], other = job.teams[1 - t]; return t === sharp ? aiPrep(ids, other) : defaultPrep(ids); };
    const teams = [prep(0), prep(1)];
    const coach = [sharp === 0, sharp === 1];
    const g = new Game({ seed: job.seed, map: MAPS[job.seed % 4], ...(workerData.living ? { living: 1, beasts: 1 } : {}), depth: true, coach, coachLevel: [2, 2], teams });
    while (!g.over) { g.step([]); g.fx.length = 0; }
    const out = { seed: job.seed, sharp, winner: g.winner, min: +(g.time / 60).toFixed(2), plans: g.teams.map((t) => g.cfg.teams[t.id].plan || 'balanced'),
      teams: g.teams.map((t) => ({ comp: t.comp && t.comp.active ? t.comp.id : null, duos: (g.duoLinks && g.duoLinks[t.id] || []).map((l) => l.duo.id),
        heroes: t.heroes.map((h) => ({ id: h.heroId, k: h.kills, d: h.deaths, a: h.assists, dmg: Math.round(h.dmgHeroes), gold: Math.round(h.goldEarned), tal: h.tal })) })) };
    parentPort.postMessage(out);
  }
  parentPort.postMessage({ done: true });
} else {
  const args = process.argv.slice(2);
  const flag = (k) => args.includes('--' + k);
  const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !['--seed', '--json', '--log', '--from', '--duos', '--focus'].includes(args[i - 1]));
  const N = +(pos[0] || 40), NW = +(pos[1] || 2), seed0 = +opt('seed', 50000);
  const { HEROES, ROLES, HERO_BY_ID } = await import('../src/data/heroes.js');
  const { Rng } = await import('../src/sim/rng.js');
  const { DUOS } = await import('../src/data/synergy.js');

  const results = [];
  const t0 = Date.now(), log = opt('log', null), from = opt('from', null);
  if (from) { for (const f of from.split(',')) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.trim()) results.push(JSON.parse(line)); }
  else {
    // matchups from per-role shuffled decks (same scheme as tools/balance.mjs)
    const rng = new Rng(seed0), decks = Object.fromEntries(ROLES.map((r) => [r, []]));
    const fresh = (r) => { const d = HEROES.filter((h) => h.role === r).map((h) => h.id); for (let i = d.length - 1; i > 0; i--) { const j = rng.int(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
    const draw = (r, used) => {
      for (let tries = 0; tries < 50; tries++) {
        if (!decks[r].length) decks[r] = fresh(r);
        for (let k = decks[r].length - 1; k >= 0; k--) { const id = decks[r][k]; if (!used.has(id)) { decks[r].splice(k, 1); used.add(id); return id; } }
        decks[r].unshift(...fresh(r));
      }
      throw new Error('deck');
    };
    const crossDuos = DUOS.filter((d) => HERO_BY_ID[d.a].role !== HERO_BY_ID[d.b].role);
    const jobs = [], focus = (opt('focus', '') || '').split(',').filter((id) => HERO_BY_ID[id]);
    const fRole = Object.fromEntries(ROLES.map((r) => [r, focus.filter((id) => HERO_BY_ID[id].role === r)]));
    for (let i = 0; i < N; i++) {
      const used = new Set(), fixed = [{}, {}];
      for (const r of ROLES) { const L = fRole[r]; if (!L.length) continue; const x = L[(2 * i) % L.length], y = L[(2 * i + 1) % L.length]; fixed[i % 2][r] = x; used.add(x); if (y !== x) { fixed[1 - i % 2][r] = y; used.add(y); } }
      const a = ROLES.map((r) => fixed[0][r] || draw(r, used)), b = ROLES.map((r) => fixed[1][r] || draw(r, used));
      if (!focus.length && rng.next() < +opt('duos', 0.4)) {
        const d = crossDuos[rng.int(crossDuos.length)], [mine, other] = rng.next() < 0.5 ? [a, b] : [b, a];
        if (!other.includes(d.a) && !other.includes(d.b)) for (const id of [d.a, d.b]) mine[ROLES.indexOf(HERO_BY_ID[id].role)] = id;
      }
      for (const sharp of [0, 1]) jobs.push({ seed: seed0 + i, teams: [a, b], sharp });
    }
    // pairs stay on one worker, in order, so a partial log is still (mostly) paired
    await Promise.all(Array.from({ length: NW }, (_, w) => new Promise((res) => {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: jobs.filter((j) => (j.seed - seed0) % NW === w), living: !flag('noliving') } });
      wk.on('message', (m) => { if (m.done) return res(); results.push(m); if (log) appendFileSync(log, JSON.stringify(m) + '\n'); if (!flag('quiet') && results.length % 10 === 0) console.log(`  ${results.length}/${2 * N} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`); });
      wk.on('error', (e) => { console.error(e); res(); });
    })));
  }

  // ── aggregate ──
  const n = results.length;
  let sharpWins = 0, len = 0;
  for (const r of results) { if (r.winner === r.sharp) sharpWins++; len += r.min; }
  const S = sharpWins / n, P = 1 - S; // condition means (every game has one sharp and one passive team)
  // relative KDA impact: (k+a)/(d+1) over the mean of that role under that coach
  const roleKda = {};
  for (const r of results) r.teams.forEach((t, ti) => t.heroes.forEach((x) => { const c = ti === r.sharp ? 's' : 'p', key = HERO_BY_ID[x.id].role + c; const o = roleKda[key] || (roleKda[key] = { n: 0, v: 0 }); o.n++; o.v += (x.k + x.a) / (x.d + 1); }));
  const H = {};
  const ctx = (s, f, lvl, res) => { const o = (s.ctx[f] || (s.ctx[f] = {}))[lvl] || (s.ctx[f][lvl] = { g: 0, r: 0 }); o.g++; o.r += res; };
  const pairs = {}; // seed -> games, for the paired gap
  for (const r of results) (pairs[r.seed] || (pairs[r.seed] = [])).push(r);
  for (const r of results) r.teams.forEach((t, ti) => {
    const isS = ti === r.sharp, win = r.winner === ti ? 1 : 0, res = win - (isS ? S : P);
    const clans = {}; for (const x of t.heroes) { const c = HERO_BY_ID[x.id].clan; clans[c] = (clans[c] || 0) + 1; }
    for (const x of t.heroes) {
      const def = HERO_BY_ID[x.id], s = H[x.id] || (H[x.id] = { sg: 0, sw: 0, pg: 0, pw: 0, sk: 0, pk: 0, pd: 0, pn: 0, ctx: {} });
      const kda = (x.k + x.a) / (x.d + 1) / (roleKda[def.role + (isS ? 's' : 'p')].v / roleKda[def.role + (isS ? 's' : 'p')].n);
      if (isS) { s.sg++; s.sw += win; s.sk += kda; } else { s.pg++; s.pw += win; s.pk += kda; }
      ctx(s, 'comp', t.comp ? 'on' : 'off', res);
      ctx(s, 'duo', t.duos.some((d) => { const du = DUOS.find((q) => q.id === d); return du.a === x.id || du.b === x.id; }) ? 'on' : 'off', res);
      ctx(s, 'clan', clans[def.clan] >= 2 ? 'on' : 'off', res);
      if (isS) ctx(s, 'plan', r.plans[ti], res);
    }
  });
  // paired difference: the same hero on the same team, sharp in one game and passive in the other
  for (const seed in pairs) {
    const g = pairs[seed]; if (g.length !== 2 || g[0].sharp === g[1].sharp) continue;
    const [gs0, gp0] = g[0].sharp === 0 ? [g[0], g[1]] : [g[1], g[0]]; // team 0 sharp in gs0, passive in gp0
    for (let t = 0; t < 2; t++) {
      const sg = t === 0 ? gs0 : gp0, pg = t === 0 ? gp0 : gs0; // the game where team t was sharp / passive
      const d = (sg.winner === t ? 1 : 0) - (pg.winner === t ? 1 : 0);
      for (const x of sg.teams[t].heroes) {
        const s = H[x.id], y = pg.teams[t].heroes.find((q) => q.id === x.id); s.pd += d; s.pd2 = (s.pd2 || 0) + d * d; s.pn++;
        // continuous paired gaps: the hero's share of its team's gold and hero damage, sharp minus passive
        // (a within-team share removes the team's result, which the win gap already counts)
        const share = (team, v, k) => v[k] / (team.heroes.reduce((a, q) => a + q[k], 0) || 1);
        const gs = share(sg.teams[t], x, 'gold') - share(pg.teams[t], y, 'gold'), ds = share(sg.teams[t], x, 'dmg') - share(pg.teams[t], y, 'dmg');
        s.gs = (s.gs || 0) + gs; s.gs2 = (s.gs2 || 0) + gs * gs; s.ds = (s.ds || 0) + ds; s.ds2 = (s.ds2 || 0) + ds * ds;
      }
    }
  }
  // empirical-Bayes shrinkage: between-hero variance tau^2 = observed variance - mean sampling variance
  const ids = Object.keys(H);
  const eb = (vals) => { // vals: [{ v, se2 }] -> shrink factor per item
    const m = vals.reduce((a, x) => a + x.v, 0) / vals.length;
    const varObs = vals.reduce((a, x) => a + (x.v - m) ** 2, 0) / Math.max(1, vals.length - 1), se2 = vals.reduce((a, x) => a + x.se2, 0) / vals.length;
    const tau2 = Math.max(1e-6, varObs - se2);
    return { m, tau2, f: vals.map((x) => tau2 / (tau2 + x.se2)) };
  };
  const rows = ids.map((id) => {
    const s = H[id], ws = s.sw / s.sg, wp = s.pw / s.pg;
    const rs = ws - S, rp = wp - P, gapPair = s.pn ? s.pd / s.pn - (S - P) : rs - rp;
    return { id, s, rs, rp, gap: gapPair, se2s: S * (1 - S) / s.sg, se2p: P * (1 - P) / s.pg, se2g: (s.pn ? Math.max(0.05, s.pd2 / s.pn - (s.pd / s.pn) ** 2) / s.pn : S * (1 - S) / s.sg + P * (1 - P) / s.pg) };
  });
  // continuous gaps, centred on the all-hero mean, with their own sampling variance
  for (const k of ['gs', 'ds']) {
    const m = rows.reduce((a, r) => a + (r.s[k] || 0), 0) / rows.reduce((a, r) => a + r.s.pn, 0);
    for (const r of rows) { const nn = r.s.pn || 1, mu = (r.s[k] || 0) / nn; r[k] = mu - m; r[k + 'Se2'] = Math.max(1e-7, ((r.s[k + '2'] || 0) / nn - mu * mu) / Math.max(1, nn - 1)); }
  }
  const ebS = eb(rows.map((r) => ({ v: r.rs, se2: r.se2s }))), ebP = eb(rows.map((r) => ({ v: r.rp, se2: r.se2p }))), ebG = eb(rows.map((r) => ({ v: r.gap, se2: r.se2g })));
  const ebGs = eb(rows.map((r) => ({ v: r.gs, se2: r.gsSe2 }))), ebDs = eb(rows.map((r) => ({ v: r.ds, se2: r.dsSe2 })));
  rows.forEach((r, i) => {
    r.gsShr = ebGs.m + (r.gs - ebGs.m) * ebGs.f[i]; r.dsShr = ebDs.m + (r.ds - ebDs.m) * ebDs.f[i];
    r.rsShr = ebS.m + (r.rs - ebS.m) * ebS.f[i]; r.rpShr = ebP.m + (r.rp - ebP.m) * ebP.f[i]; r.gapShr = ebG.m + (r.gap - ebG.m) * ebG.f[i];
    r.gapSe = Math.sqrt(ebG.f[i] * r.se2g); r.rpSe = Math.sqrt(ebP.f[i] * r.se2p); // posterior sd
    // context spread: for each factor, between-level variance of the residual beyond sampling noise
    let spread = 0; const why = [];
    for (const [f, lv] of Object.entries(r.s.ctx)) {
      const L = Object.values(lv).filter((o) => o.g >= 3); if (L.length < 2) continue;
      const tot = L.reduce((a, o) => a + o.g, 0), mean = L.reduce((a, o) => a + o.r, 0) / tot;
      const between = L.reduce((a, o) => a + o.g * (o.r / o.g - mean) ** 2, 0) / tot, noise = 0.23 * (L.length - 1) / tot;
      const ex = Math.max(0, between - noise); spread += ex;
      if (ex > 0.004) why.push(f + ' ' + Object.entries(lv).filter(([, o]) => o.g >= 3).map(([k, o]) => `${k} ${(100 * o.r / o.g >= 0 ? '+' : '') + (100 * o.r / o.g).toFixed(0)} (${o.g})`).join('/'));
    }
    r.spread = Math.sqrt(spread); r.ctxWhy = why.join('; ');
    r.kdaS = r.s.sk / r.s.sg; r.kdaP = r.s.pk / r.s.pg;
  });
  console.log(`\n${n} games (${Object.values(pairs).filter((g) => g.length === 2).length} pairs) · sharp coach wins ${(100 * S).toFixed(1)}% · avg ${(len / n).toFixed(1)}m`);
  console.log(`tau (between-hero sd): sharp ${(100 * Math.sqrt(ebS.tau2)).toFixed(1)} · passive ${(100 * Math.sqrt(ebP.tau2)).toFixed(1)} · gap ${(100 * Math.sqrt(ebG.tau2)).toFixed(1)} pts · gold-share gap ${(100 * Math.sqrt(ebGs.tau2)).toFixed(2)} · dmg-share gap ${(100 * Math.sqrt(ebDs.tau2)).toFixed(2)} pts`);
  console.log('\nHero       role     games  sharpWR passWR | resS  resP   gap  (shrunk: resP  gap ±sd)  spread  goldSh dmgSh  kdaS kdaP  context');
  const pc = (v) => (100 * v).toFixed(0).padStart(4), sg = (v) => ((v >= 0 ? '+' : '') + (100 * v).toFixed(1)).padStart(6);
  for (const r of rows.sort((a, b) => HEROES.findIndex((h) => h.id === a.id) - HEROES.findIndex((h) => h.id === b.id)).sort((a, b) => ROLES.indexOf(HERO_BY_ID[a.id].role) - ROLES.indexOf(HERO_BY_ID[b.id].role) || a.gapShr - b.gapShr)) {
    const s = r.s;
    console.log(`${r.id.padEnd(10)} ${HERO_BY_ID[r.id].role.padEnd(7)} ${String(s.sg).padStart(3)}/${String(s.pg).padEnd(3)} ${pc(s.sw / s.sg)}   ${pc(s.pw / s.pg)}   | ${sg(r.rs)} ${sg(r.rp)} ${sg(r.gap)}   ${sg(r.rpShr)} ${sg(r.gapShr)} ±${(100 * r.gapSe).toFixed(1)}   ${(100 * r.spread).toFixed(1).padStart(4)}  ${sg(r.gsShr)} ${sg(r.dsShr)}  ${r.kdaS.toFixed(2)} ${r.kdaP.toFixed(2)}  ${r.ctxWhy}`);
  }
  // bounds check (unlock pricing: no hero far above or below the field, after shrinkage)
  const watch = (opt('focus', '') || '').split(',').filter((id) => H[id]);
  const chk = rows.filter((r) => !watch.length || watch.includes(r.id)).map((r) => ({ id: r.id, s: 100 * (S + r.rsShr), p: 100 * (P + r.rpShr) }));
  console.log('\nShrunk win rates (limits: sharp < 90%, passive > 12%):');
  for (const c of chk.sort((a, b) => b.s - a.s)) if (watch.length || c.s >= 88 || c.p <= 14) console.log(`  ${c.id.padEnd(10)} sharp ${c.s.toFixed(1).padStart(5)}%  passive ${c.p.toFixed(1).padStart(5)}%${c.s >= 90 || c.p <= 12 ? '   OUT OF BOUNDS' : ''}`);
  const outB = chk.filter((c) => c.s >= 90 || c.p <= 12);
  console.log(outB.length ? `  ${outB.length} hero(es) out of bounds` : '  all within bounds');
  const out = opt('json', null);
  if (out) writeFileSync(out, JSON.stringify({ n, S, tau: { s: Math.sqrt(ebS.tau2), p: Math.sqrt(ebP.tau2), g: Math.sqrt(ebG.tau2) }, rows: rows.map((r) => ({ id: r.id, sg: r.s.sg, sw: r.s.sw, pg: r.s.pg, pw: r.s.pw, pn: r.s.pn, rs: r.rs, rp: r.rp, gap: r.gap, rsShr: r.rsShr, rpShr: r.rpShr, gapShr: r.gapShr, gapSe: r.gapSe, rpSe: r.rpSe, spread: r.spread, gs: r.gs, gsShr: r.gsShr, ds: r.ds, dsShr: r.dsShr, ctxWhy: r.ctxWhy, kdaS: r.kdaS, kdaP: r.kdaP, ctx: r.s.ctx })) }, null, 1));
}
