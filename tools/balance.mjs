// Balance scan: AI-vs-AI self-play with balanced hero coverage, run on worker threads.
//   node tools/balance.mjs [games=60] [workers=2] [--seed N] [--smart] [--json out.json] [--log games.jsonl] [--quiet]
//   node tools/balance.mjs --from a.jsonl[,b.jsonl] [--json out.json]   (re-aggregate saved games)
//   --duos P    in a share P of games (default 0.5) one random cross-role duo is put on a random team, so
//               every duo gets measured (reported with its members' overall win rates for comparison)
//   --plans     give every game a pair of different game plans (src/sim/plans.js), cycling evenly through all
//               20 ordered pairs, and report per-plan win rates (overall, by side) and the plan-vs-plan matrix
//   --depth     play with match depth on (cfg.depth: talents, item overrides, ult upgrades, revenge, duo ults)
//               and report per-talent win rates. With --randtal each hero takes random talents (so every
//               option is measured evenly); without it the heroes' own AI picks are used.
//   --nudge K   also move each hero's TUNE multiplier toward 50% (delta = (0.5 - shrunk win rate) * K,
//               max ±6% per pass, clamp 0.8-1.2) and rewrite src/data/tuning.js (same format as tune.mjs)
// Each game draws heroes from shuffled per-role decks so every hero gets the same number of games.
// Builds are random from each hero's list (so every build gets played); --smart uses aiPrep
// (situational builds) instead.
// Reports: per-hero win rate, pick impact, KDA, damage share, basic hits, ability casts and hit
// rates; per-build and per hero-build win rates; static range sanity (heroes vs towers).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAPS = ['sakura', 'frost', 'ember', 'marsh'];
const AREA = new Set(['shot', 'hook', 'line', 'target', 'circle', 'nova', 'dash']);

if (!isMainThread) {
  const { Game } = await import('../src/sim/game.js');
  const { HERO_BY_ID } = await import('../src/data/heroes.js');
  const { aiPrep, defaultPrep } = await import('../src/sim/draft.js');
  if (workerData.tune) { const t = await import('../src/data/tuning.js'); Object.assign(t.TUNE, workerData.tune); }
  // instrumentation: casts, hero hits per cast, basic hits on heroes
  const P = Game.prototype, oCast = P.cast, oHit = P.abilityHit, oBasic = P.basicHit;
  P.cast = function (h, i, t, p) { const s = h._ab || (h._ab = [[0, 0], [0, 0], [0, 0]]); s[i][0]++; h._castSeq = (h._castSeq || 0) + 1; (h._seq || (h._seq = []))[i] = h._castSeq; return oCast.call(this, h, i, t, p); };
  P.abilityHit = function (h, e, ab, type, aoe) {
    if (e.type === 'hero' && h.type === 'hero') { const i = h.def.abilities.indexOf(ab); const hs = h._hitSeq || (h._hitSeq = []); if (i >= 0 && h._seq && hs[i] !== h._seq[i]) { hs[i] = h._seq[i]; h._ab[i][1]++; } }
    return oHit.call(this, h, e, ab, type, aoe);
  };
  P.basicHit = function (a, t) { if (a.type === 'hero' && t.type === 'hero') a._bh = (a._bh || 0) + 1; return oBasic.call(this, a, t); };
  for (const job of workerData.jobs) {
    const [ida, idb] = job.teams;
    const prep = (ids, other, builds) => {
      if (workerData.smart) return aiPrep(ids, other);
      const p = defaultPrep(ids); p.heroes.forEach((x, k) => { x.build = builds[k]; }); return p;
    };
    const teams = [prep(ida, idb, job.builds[0]), prep(idb, ida, job.builds[1])];
    if (job.plans) teams.forEach((t, k) => { t.plan = job.plans[k]; });
    if (job.tal) teams.forEach((t, k) => t.heroes.forEach((x, j) => { x.tal = job.tal[k][j]; }));
    const g = new Game({ seed: job.seed, map: MAPS[job.seed % 4], coach: [true, true], teams, ...(workerData.depth ? { depth: true } : {}) });
    while (!g.over) { g.step([]); g.fx.length = 0; }
    const ev = {}; for (const e of g.events) if (e.type === 'duo' || e.type === 'comp' || e.type === 'reset' || e.type === 'ultUp' || e.type === 'revenge' || e.type === 'duoUlt' || e.type === 'talent') ev[e.type] = (ev[e.type] || 0) + 1;
    const out = { seed: job.seed, winner: g.winner, plans: g.teams.map((t) => g.cfg.teams[t.id].plan || 'balanced'), half: g.events.filter((e) => e.type === 'plan').map((e) => [e.team, e.plan]), min: g.time / 60, timeout: g.events.some((e) => e.type === 'victory' && e.timeout), ev,
      teams: g.teams.map((t) => ({ comp: t.comp && t.comp.active ? t.comp.id : null, heroes: t.heroes.map((h) => ({ id: h.heroId, role: h.role, build: h.build, k: h.kills, d: h.deaths, a: h.assists, dmg: h.dmgHeroes, taken: h.dmgTaken, healed: h.healed, gold: h.goldEarned, bh: h._bh || 0, ab: h._ab || [[0, 0], [0, 0], [0, 0]], ...(h.tal ? { tal: h.tal } : {}) })) })) };
    parentPort.postMessage(out);
  }
  parentPort.postMessage({ done: true });
} else {
  const args = process.argv.slice(2);
  const flag = (k) => args.includes('--' + k);
  const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !['--seed', '--json', '--log', '--from', '--nudge'].includes(args[i - 1]));
  const N = +(pos[0] || 60), NW = +(pos[1] || 2), seed0 = +opt('seed', 9000);
  const { HEROES, ROLES, HERO_BY_ID } = await import('../src/data/heroes.js');
  const { BUILDS } = await import('../src/data/items.js');
  const { Rng } = await import('../src/sim/rng.js');
  const { RANGE } = await import('../src/sim/constants.js');
  const { DUOS } = await import('../src/data/synergy.js');

  // Static range sanity: max basic-attack range (base + self buffs + range items) vs tower reach.
  const cap = RANGE.tower - 45, rangeRows = [];
  for (const h of HEROES) {
    const buff = Math.max(0, ...h.abilities.map((a) => (a.buff && a.buff.stats.range) || 0));
    const items = Math.max(0, ...h.builds.map((b) => BUILDS[b].items.reduce((s, it) => s + (it.stats.range || 0), 0)));
    const raw = h.base.range + buff + items;
    rangeRows.push({ id: h.id, base: h.base.range, max: raw, capped: Math.min(raw, cap) });
  }

  // Jobs: per-role shuffled decks so coverage is even.
  const rng = new Rng(seed0);
  const decks = Object.fromEntries(ROLES.map((r) => [r, []]));
  const draw = (r, used) => {
    for (let tries = 0; tries < 50; tries++) {
      if (!decks[r].length) { const d = HEROES.filter((h) => h.role === r).map((h) => h.id); for (let i = d.length - 1; i > 0; i--) { const j = rng.int(i + 1); [d[i], d[j]] = [d[j], d[i]]; } decks[r] = d; }
      const id = decks[r].pop(); if (!used.has(id)) { used.add(id); return id; } decks[r].unshift(id);
    }
    throw new Error('deck');
  };
  const jobs = [];
  for (let i = 0; i < N; i++) {
    const used = new Set(), a = ROLES.map((r) => draw(r, used)), b = ROLES.map((r) => draw(r, used));
    const crossDuos = DUOS.filter((d) => HERO_BY_ID[d.a].role !== HERO_BY_ID[d.b].role);
    if (rng.next() < +opt('duos', 0.5)) {
      const d = crossDuos[rng.int(crossDuos.length)], [mine, other] = rng.next() < 0.5 ? [a, b] : [b, a];
      if (!other.includes(d.a) && !other.includes(d.b)) for (const id of [d.a, d.b]) mine[ROLES.indexOf(HERO_BY_ID[id].role)] = id;
    }
    const pb = (ids) => ids.map((id) => { const bl = HERO_BY_ID[id].builds; return bl[rng.int(bl.length)]; });
    const job = { seed: seed0 + i, teams: [a, b], builds: [pb(a), pb(b)] };
    if (flag('plans')) { const P = ['aggro', 'scale', 'objective', 'split', 'protect'], pairs = []; for (const x of P) for (const y of P) if (x !== y) pairs.push([x, y]); job.plans = pairs[i % pairs.length]; }
    if (flag('randtal')) job.tal = [0, 1].map(() => ROLES.map(() => [0, 1, 2].map(() => rng.int(2))));
    jobs.push(job);
  }
  const results = [];
  const t0 = Date.now(), log = opt('log', null), from = opt('from', null);
  if (from) for (const f of from.split(',')) for (const line of readFileSync(f, 'utf8').split('\n')) { if (line.trim()) results.push(JSON.parse(line)); }
  else await Promise.all(Array.from({ length: NW }, (_, w) => new Promise((res) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: jobs.filter((_, k) => k % NW === w), smart: flag('smart'), depth: flag('depth') } });
    wk.on('message', (m) => { if (m.done) return res(); results.push(m); if (log) appendFileSync(log, JSON.stringify(m) + '\n'); if (!flag('quiet') && results.length % 10 === 0) console.log(`  ${results.length}/${N} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`); });
    wk.on('error', (e) => { console.error(e); res(); });
  })));

  // Aggregate
  const H = {}, B = {}, HB = {}, C = {}, D = {}, TAL = {}, HT = {};
  const { HERO_TALENTS } = await import('../src/data/talents.js');
  let blue = 0, len = 0, timeouts = 0, kills = 0; const ev = {};
  for (const r of results) {
    if (r.winner === 0) blue++; len += r.min; if (r.timeout) timeouts++;
    for (const k in r.ev) ev[k] = (ev[k] || 0) + r.ev[k];
    r.teams.forEach((t, ti) => {
      const win = r.winner === ti ? 1 : 0, teamDmg = t.heroes.reduce((s, x) => s + x.dmg, 0) || 1;
      if (t.comp) { const c = C[t.comp] || (C[t.comp] = { g: 0, w: 0, ids: [] }); c.g++; c.w += win; c.ids.push(...t.heroes.map((x) => x.id)); }
      const ids = t.heroes.map((x) => x.id);
      for (const du of DUOS) if (ids.includes(du.a) && ids.includes(du.b)) { const c = D[du.id] || (D[du.id] = { g: 0, w: 0 }); c.g++; c.w += win; }
      for (const x of t.heroes) {
        kills += x.k;
        const s = H[x.id] || (H[x.id] = { g: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0, share: 0, taken: 0, healed: 0, gold: 0, bh: 0, min: 0, ab: [[0, 0], [0, 0], [0, 0]] });
        s.g++; s.w += win; s.k += x.k; s.d += x.d; s.a += x.a; s.dmg += x.dmg; s.share += x.dmg / teamDmg; s.taken += x.taken; s.healed += x.healed; s.gold += x.gold; s.bh += x.bh; s.min += r.min;
        x.ab.forEach((v, i) => { s.ab[i][0] += v[0]; s.ab[i][1] += v[1]; });
        const b = B[x.build] || (B[x.build] = { g: 0, w: 0, heroes: new Set() }); b.g++; b.w += win; b.heroes.add(x.id);
        if (x.tal) x.tal.forEach((p, i) => { if (p < 0) return; const key = HERO_TALENTS[x.id][i][p], tk = key.split('.').pop(), k2 = x.id + ':' + i + ':' + p;
          const a = TAL[tk] || (TAL[tk] = { g: 0, w: 0 }); a.g++; a.w += win; const b2 = HT[k2] || (HT[k2] = { g: 0, w: 0 }); b2.g++; b2.w += win; });
        const hb = HB[x.id + ':' + x.build] || (HB[x.id + ':' + x.build] = { g: 0, w: 0 }); hb.g++; hb.w += win;
      }
    });
  }
  const n = results.length;
  console.log(`\n${n} games in ${((Date.now() - t0) / 1000).toFixed(0)}s · blue ${(100 * blue / n).toFixed(0)}% · avg ${(len / n).toFixed(1)}m · on time ${(100 * timeouts / n).toFixed(0)}% · kills/game ${(kills / n).toFixed(1)}`);
  console.log('events/game', Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, +(v / n).toFixed(2)])));
  const pct = (w, g) => (g ? (100 * w / g).toFixed(0) : '-');
  console.log('\nHero        role     g  win%  impact  K/D/A           share  bh/min  abilities (casts/min, hero-hit%)');
  const rows = Object.entries(H).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g);
  for (const [id, s] of rows) {
    const def = HERO_BY_ID[id];
    const abs = s.ab.map((v, i) => `${(v[0] / s.min).toFixed(1)}/${AREA.has(def.abilities[i].kind) ? pct(v[1], v[0]) + '%' : 'n/a'}`).join(' ');
    console.log(`${id.padEnd(10)} ${def.role.padEnd(8)} ${String(s.g).padStart(3)}  ${pct(s.w, s.g).padStart(4)}  ${((s.w / s.g - 0.5) * 100).toFixed(0).padStart(5)}   ${(s.k / s.g).toFixed(1)}/${(s.d / s.g).toFixed(1)}/${(s.a / s.g).toFixed(1)}`.padEnd(60) + `${(100 * s.share / s.g).toFixed(0).padStart(4)}%  ${(s.bh / s.min).toFixed(1).padStart(5)}   ${abs}`);
  }
  console.log('\nBuild        games  win%  heroes');
  for (const [k, b] of Object.entries(B).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)) console.log(`${k.padEnd(12)} ${String(b.g).padStart(5)}  ${pct(b.w, b.g).padStart(4)}  ${b.heroes.size}`);
  if (Object.keys(TAL).length) {
    // talents: per template (all heroes), then each hero's option B minus option A per tier (shrunk toward 0)
    console.log('\nTalent       games  win%');
    for (const [k, t] of Object.entries(TAL).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)) console.log(`${k.padEnd(12)} ${String(t.g).padStart(5)}  ${pct(t.w, t.g).padStart(4)}`);
    const gaps = [];
    for (const id in HERO_TALENTS) for (let i = 0; i < 3; i++) {
      const A = HT[id + ':' + i + ':0'] || { g: 0, w: 0 }, Bq = HT[id + ':' + i + ':1'] || { g: 0, w: 0 };
      if (A.g < 4 || Bq.g < 4) continue;
      const sh = (c) => (c.w + 5) / (c.g + 10); gaps.push({ id, i, d: sh(Bq) - sh(A), A, B: Bq });
    }
    gaps.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    console.log('Largest option gaps (shrunk B-A win rate):', gaps.slice(0, 12).map((x) => `${x.id} t${x.i + 1} ${HERO_TALENTS[x.id][x.i][x.d > 0 ? 1 : 0]} +${Math.abs(x.d * 100).toFixed(0)}% (${x.A.g}/${x.B.g})`).join(', ') || 'n/a');
  }
  // comps / duos next to what their heroes win overall (a duo or comp is only strong if it beats that)
  const wr = (id) => H[id].w / H[id].g;
  const avgWr = (ids) => (100 * ids.reduce((s, id) => s + wr(id), 0) / ids.length).toFixed(0);
  console.log('\nComps (active)', Object.entries(C).map(([k, c]) => `${k} ${pct(c.w, c.g)}% of ${c.g} (its heroes ${avgWr(c.ids)}%)`).join(' · '));
  let dg = 0, dw = 0, dx = 0;
  const duoRows = Object.entries(D).map(([k, c]) => { const du = DUOS.find((x) => x.id === k), base = (wr(du.a) + wr(du.b)) / 2; dg += c.g; dw += c.w; dx += base * c.g; return `${k} ${pct(c.w, c.g)}% of ${c.g} (pair ${(100 * base).toFixed(0)}%)`; });
  console.log(`Duos: all ${pct(dw, dg)}% of ${dg} (their heroes ${(100 * dx / (dg || 1)).toFixed(0)}%) · ${duoRows.join(' · ')}`);
  const over = rangeRows.filter((r) => r.max > cap);
  console.log(`\nRange sanity: hero attack range cap ${cap} (towers ${RANGE.tower}). Would exceed without cap: ${over.map((r) => `${r.id} ${r.max}`).join(', ') || 'none'}`);
  // game plans: overall, by side, the matrix (row plan's win% vs column plan), halftime switches
  if (results.some((r) => r.plans && r.plans[0] !== r.plans[1])) {
    const P = {}, M = {}, sw = {};
    for (const r of results) {
      const [a, b] = r.plans; if (a === b) continue;
      for (let t = 0; t < 2; t++) {
        const me = r.plans[t], op = r.plans[1 - t], w = r.winner === t ? 1 : 0;
        const s = P[me] || (P[me] = { g: 0, w: 0, side: [[0, 0], [0, 0]], min: 0 }); s.g++; s.w += w; s.side[t][0]++; s.side[t][1] += w; s.min += r.min;
        const m = (M[me] || (M[me] = {}))[op] || (M[me][op] = { g: 0, w: 0 }); m.g++; m.w += w;
      }
      for (const [t, p] of r.half || []) { const k = r.plans[t] + '>' + p; sw[k] = (sw[k] || 0) + 1; }
    }
    const ids = Object.keys(P).sort();
    const se = (s) => (100 * Math.sqrt(0.25 / s.g)).toFixed(1);
    console.log('\nGame plans   games  win%  (±1se)  as Blue  as Red  avg min');
    for (const k of ids) { const s = P[k]; console.log(`${k.padEnd(11)} ${String(s.g).padStart(6)}  ${pct(s.w, s.g).padStart(4)}  ±${se(s).padStart(4)}   ${pct(s.side[0][1], s.side[0][0]).padStart(5)}   ${pct(s.side[1][1], s.side[1][0]).padStart(5)}   ${(s.min / s.g).toFixed(1)}`); }
    console.log('Matrix (row win% vs column, games):');
    console.log(''.padEnd(11) + ids.map((k) => k.slice(0, 9).padStart(11)).join(''));
    for (const a of ids) console.log(a.padEnd(11) + ids.map((b) => (a === b ? '-' : M[a][b] ? `${pct(M[a][b].w, M[a][b].g)}% ${M[a][b].g}` : '').padStart(11)).join(''));
    if (Object.keys(sw).length) console.log('Halftime switches:', Object.entries(sw).map(([k, v]) => `${k} ${v}`).join(' · '));
  }
  const out = opt('json', null);
  if (out) writeFileSync(out, JSON.stringify({ n, blue, len, timeouts, ev, H, B: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, { g: v.g, w: v.w, heroes: [...v.heroes] }])), HB, C, D, rangeRows, cap }, null, 1));
  const K = +opt('nudge', 0);
  if (K) {
    const { TUNE } = await import('../src/data/tuning.js');
    const tune = Object.fromEntries(HEROES.map((h) => [h.id, TUNE[h.id] || 1]));
    const moved = [];
    for (const h of HEROES) {
      const s = H[h.id]; if (!s) continue;
      const rate = (s.w + 4) / (s.g + 8), d = Math.max(-0.06, Math.min(0.06, (0.5 - rate) * K));
      const v = Math.max(0.8, Math.min(1.2, +(tune[h.id] * (1 + d)).toFixed(3)));
      if (v !== tune[h.id]) moved.push(`${h.id} ${tune[h.id]}->${v}`); tune[h.id] = v;
    }
    const body = Object.entries(tune).filter(([, v]) => v !== 1).map(([k, v]) => `  ${k}: ${v},`).join('\n');
    writeFileSync(new URL('../src/data/tuning.js', import.meta.url), `// Per-hero power multipliers produced by tools/tune.mjs (self-play balance).\n// 1.00 = untouched. Applied as +/- damage and a little +/- health.\nexport const TUNE = {\n${body}\n};\n`);
    console.log(`\nTUNE nudged (K=${K}): ${moved.join(', ')}`);
  }
}
