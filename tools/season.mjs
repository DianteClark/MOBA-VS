// Season balancer. Run daily by .github/workflows/season.yml; does real work only when a new
// season has started (or with --force):
//   1. plays self-play matches across all maps (tools/tune.mjs) and measures every legend
//   2. moves each hero's power multiplier toward a 50% win rate, capped at ±5% per season
//   3. writes src/data/tuning.js, prepends patch notes, bumps the netcode VERSION
//   node tools/season.mjs [--force] [--rounds 2] [--games 150] [--workers 4]
//   node tools/season.mjs --check [--at 2027-02-01]   (print the rollover's patch-note entry, no self-play, no writes)
// A season's `highlights` (its pass, story weeks, new skins: src/data/seasons.js) lead its patch notes.
// Real-player results (future shared backend) can be dropped in data/matches/*.json; each
// record { picks: [[5 ids],[5 ids]], winner } counts 3x a self-play game.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const root = new URL('../', import.meta.url);
const P = (f) => new URL(f, root);

const { seasonAt } = await import(P('src/data/seasons.js'));
const { PATCHES } = await import(P('src/data/patchnotes.js'));
const { TUNE: OLD } = await import(P('src/data/tuning.js') + '?old');
const { HEROES, HERO_BY_ID } = await import(P('src/data/heroes.js'));

const atDay = arg('at', null), check = process.argv.includes('--check');
const season = seasonAt(atDay ? Date.parse(atDay + 'T12:00:00Z') : Date.now());
const lastBalanced = PATCHES[0].season;
// The season's patch-note entry (balance changes are appended below).
const seasonNotes = () => [`Season ${season.id} begins: ${season.blurb}`, ...(season.highlights || []).map((x) => `Season ${season.id}: ${x}.`)];
if (check) { console.log(JSON.stringify({ season: season.id, title: `Season ${season.id}: ${season.name}`, highlights: season.highlights || null, notes: seasonNotes() }, null, 2)); process.exit(0); }
if (!force && season.id <= lastBalanced) { console.log(`Season ${season.id} already balanced (last patch for season ${lastBalanced}). Nothing to do.`); process.exit(0); }

const rounds = +arg('rounds', 2), games = +arg('games', 150), workers = +arg('workers', Math.max(1, Math.min(4, cpus().length)));
console.log(`Balancing for Season ${season.id} (${season.name}): ${rounds} x ${games} self-play games on ${workers} workers…`);
const out = execFileSync(process.execPath, [new URL('tune.mjs', import.meta.url).pathname, String(rounds), String(games), String(workers)], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit'] });
process.stdout.write(out);

// Win rates from the final round (id  Ng  W% -> mult)
const wr = {};
for (const line of out.trim().split('\n').reverse()) {
  const m = line.match(/^(\w+)\s+(\d+)g\s+(\d+)%/); if (!m) { if (Object.keys(wr).length) break; continue; }
  wr[m[1]] = { g: +m[2], w: Math.round(+m[2] * +m[3] / 100) };
}
// Real matches (optional)
const dir = P('data/matches/');
if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  try {
    for (const r of JSON.parse(readFileSync(new URL(f, dir), 'utf8'))) {
      if (r.season !== undefined && r.season !== season.id - 1) continue;
      r.picks.forEach((ids, t) => ids.forEach((id) => { const s = wr[id] || (wr[id] = { g: 0, w: 0 }); s.g += 3; if (r.winner === t) s.w += 3; }));
    }
  } catch (e) { console.warn('skip', f, e.message); }
}

// Real online matches from the live API (verified ladder games), weighted 3x a self-play game.
const api = process.env.MOBAVS_API;
if (api) {
  try {
    const r = await fetch(`${api}/api/balance?season=${season.id - 1}`); const d = await r.json();
    for (const x of d.heroes || []) { const s = wr[x.hero] || (wr[x.hero] = { g: 0, w: 0 }); s.g += x.games * 3; s.w += x.wins * 3; }
    console.log(`Online results: ${(d.heroes || []).reduce((a, x) => a + x.games, 0)} hero-games from season ${season.id - 1}`);
  } catch (e) { console.warn('online results unavailable:', e.message); }
}
// New multipliers: tuner result, clamped to ±5% of last season.
const { TUNE: NEW } = await import(P('src/data/tuning.js') + '?new');
const final = {}, changes = [];
for (const h of HEROES) {
  const old = OLD[h.id] || 1, raw = NEW[h.id] || 1;
  let v = Math.max(old * 0.95, Math.min(old * 1.05, raw));
  // Real-match nudge: blend toward what the combined win rate says.
  const s = wr[h.id];
  if (s && s.g >= 20) { const rate = (s.w + 4) / (s.g + 8); v = Math.max(old * 0.95, Math.min(old * 1.05, v * (1 + (0.5 - rate) * 0.1))); }
  v = Math.max(0.75, Math.min(1.25, +v.toFixed(3)));
  final[h.id] = v;
  const pct = Math.round((v / old - 1) * 100);
  if (Math.abs(pct) >= 1) changes.push({ id: h.id, dir: pct > 0 ? 1 : -1, text: `Power ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%${s && s.g ? ` (won ${Math.round(100 * s.w / s.g)}% of ${s.g} games last season)` : ''}.` });
}
changes.sort((a, b) => b.dir - a.dir || a.id.localeCompare(b.id));
writeFileSync(P('src/data/tuning.js'), `// Per-hero power multipliers produced by tools/tune.mjs (self-play balance).\n// 1.00 = untouched. Applied as +/- damage and a little +/- health.\nexport const TUNE = {\n${Object.entries(final).map(([k, v]) => `  ${k}: ${v},`).join('\n')}\n};\n`);

// Patch notes
const [maj, min] = PATCHES[0].version.split('.').map(Number);
const version = `${maj}.${min + 1}`;
const entry = { version, season: season.id, date: new Date().toISOString().slice(0, 10), title: `Season ${season.id}: ${season.name}`, ...(season.highlights ? { highlights: season.highlights.slice(0, 4) } : {}),
  notes: [...seasonNotes(), `Automatic balance pass from ${rounds * games} self-play matches${existsSync(dir) ? ' and real match reports' : ''}; each legend moves at most 5%.`],
  heroes: changes.map((c) => ({ ...c, text: c.text })) };
const pn = readFileSync(P('src/data/patchnotes.js'), 'utf8');
const at = pn.indexOf('export const PATCHES = [') + 'export const PATCHES = ['.length;
writeFileSync(P('src/data/patchnotes.js'), pn.slice(0, at) + '\n  ' + JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ') + ',' + pn.slice(at));

// Netcode version: peers on different balance must not match.
const mainF = P('src/main.js'), main = readFileSync(mainF, 'utf8');
writeFileSync(mainF, main.replace(/const VERSION = (\d+);/, (_, n) => `const VERSION = ${+n + 1};`));
console.log(`\nPatch ${version}: ${changes.length} hero changes.`);
for (const c of changes) console.log(`  ${HERO_BY_ID[c.id].name.padEnd(12)} ${c.text}`);
