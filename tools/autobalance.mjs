// Weekly auto-balance from real players. Pulls the last week's hero results from verified online matches
// (worker/ops.js /api/admin/ops/heroes), proposes small capped TUNE nudges for heroes far from 50% with
// enough games, and writes them plus a patch-notes entry. .github/workflows/autobalance.yml runs it every
// Monday and opens a pull request (never a push to main): the owner approves it with one tap (Merge).
//
//   MOBAVS_API=https://… MOBAVS_ADMIN=<token> node tools/autobalance.mjs [--days 7] [--min 60] [--cap 0.02] [--max 6]
//   node tools/autobalance.mjs --file results.json [--dry]         (offline: { matches, heroes: [{ hero, games, wins, bans }] })
//   --body FILE   also write the pull-request description (markdown) to FILE
//   --dry         print the proposal, change nothing
//
// Rules (simple on purpose, so a bad week can never swing the game):
//   * only heroes with ≥ --min games this week, judged on a shrunk win rate (wins + 10) / (games + 20)
//   * a dead zone: within 47.5%–52.5% nothing moves
//   * nudge = (50% − rate) × 0.25, capped at ±cap (default ±2%) per week, multipliers kept in 0.75–1.25
//   * at most --max heroes per patch, the furthest from 50% first
// A change bumps the netcode VERSION in src/main.js (peers on different balance must never match) and
// prepends a patch-notes entry, like tools/season.mjs. Exit code 0 always; "changed=true|false" goes to
// $GITHUB_OUTPUT when set.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes('--dry');
const days = +arg('days', 7), MIN = +arg('min', 60), CAP = Math.min(0.05, +arg('cap', 0.02)), MAX = +arg('max', 6), DEAD = 0.025;
const root = new URL('../', import.meta.url), P = (f) => new URL(f, root);
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

const { TUNE } = await import(P('src/data/tuning.js'));
const { HEROES, HERO_BY_ID } = await import(P('src/data/heroes.js'));
const { PATCHES } = await import(P('src/data/patchnotes.js'));
const { seasonAt } = await import(P('src/data/seasons.js'));

async function results() {
  const file = arg('file', null);
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const api = (process.env.MOBAVS_API || '').replace(/\/$/, ''), tok = process.env.MOBAVS_ADMIN;
  if (!api || !tok) throw new Error('set MOBAVS_API and MOBAVS_ADMIN (or pass --file)');
  const r = await fetch(`${api}/api/admin/ops/heroes?days=${days}`, { headers: { authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error(`hero results: HTTP ${r.status}`);
  return r.json();
}

// → [{ id, old, mult, pct, games, rate, raw }] sorted by distance from 50%
function propose(data, tune = TUNE, { min = MIN, cap = CAP, max = MAX } = {}) {
  const rows = [];
  for (const x of data.heroes || []) {
    if (!HERO_BY_ID[x.hero] || !(x.games >= min)) continue;
    const rate = (x.wins + 10) / (x.games + 20);
    if (Math.abs(rate - 0.5) < DEAD) continue;
    const old = tune[x.hero] || 1, nudge = Math.max(-cap, Math.min(cap, (0.5 - rate) * 0.25));
    const mult = Math.max(0.75, Math.min(1.25, +(old * (1 + nudge)).toFixed(3)));
    const pct = Math.round((mult / old - 1) * 1000) / 10;
    if (mult === old || Math.abs(pct) < 0.5) continue;
    rows.push({ id: x.hero, old, mult, pct, games: x.games, wins: x.wins, rate, raw: x.wins / x.games });
  }
  return rows.sort((a, b) => Math.abs(b.rate - 0.5) - Math.abs(a.rate - 0.5)).slice(0, max);
}

const data = await results();
const changes = propose(data);
const name = (id) => HERO_BY_ID[id].name;
console.log(`Real-player results, last ${days} days: ${data.matches || 0} verified matches, ${(data.heroes || []).reduce((a, x) => a + x.games, 0)} hero-games.`);
console.log(`Eligible (≥ ${MIN} games): ${(data.heroes || []).filter((x) => x.games >= MIN).length} of ${HEROES.length} heroes.`);
if (!changes.length) { console.log('No hero is far enough from 50% with enough games: no patch this week.'); out('changed', 'false'); process.exit(0); }
for (const c of changes) console.log(`  ${name(c.id).padEnd(12)} ${(100 * c.raw).toFixed(1)}% of ${c.games}  →  power ${c.pct > 0 ? '+' : ''}${c.pct}%  (${c.old} → ${c.mult})`);
if (dry) { out('changed', 'false'); process.exit(0); }

// tuning.js: replace only the changed lines (a small, reviewable diff)
let tune = readFileSync(P('src/data/tuning.js'), 'utf8');
for (const c of changes) {
  const re = new RegExp(`^(\\s*${c.id}:\\s*)[0-9.]+,`, 'm');
  tune = re.test(tune) ? tune.replace(re, `$1${c.mult},`) : tune.replace(/\n};\s*$/, `\n  ${c.id}: ${c.mult},\n};\n`);
}
writeFileSync(P('src/data/tuning.js'), tune);

// patch notes
const [maj, min] = PATCHES[0].version.split('.').map(Number);
const version = `${maj}.${min + 1}`, season = seasonAt();
const heroes = changes.map((c) => ({ id: c.id, dir: c.pct > 0 ? 1 : -1, text: `Power ${c.pct > 0 ? '+' : '−'}${Math.abs(c.pct)}% (won ${Math.round(100 * c.raw)}% of ${c.games} online games last week).` }))
  .sort((a, b) => b.dir - a.dir || a.id.localeCompare(b.id));
const entry = { version, season: season.id, date: new Date().toISOString().slice(0, 10), title: 'Weekly balance',
  notes: [`Small balance update from ${data.matches} real online matches last week. Each legend moves at most ${Math.round(CAP * 100)}%.`], heroes };
const pn = readFileSync(P('src/data/patchnotes.js'), 'utf8'), at = pn.indexOf('export const PATCHES = [') + 'export const PATCHES = ['.length;
writeFileSync(P('src/data/patchnotes.js'), pn.slice(0, at) + '\n  ' + JSON.stringify(entry, null, 2).replace(/\n/g, '\n  ') + ',' + pn.slice(at));

// netcode VERSION
const mainF = P('src/main.js'), main = readFileSync(mainF, 'utf8');
let newV = 0;
writeFileSync(mainF, main.replace(/const VERSION = (\d+);/, (_, n) => `const VERSION = ${(newV = +n + 1)};`));

const body = arg('body', null);
if (body) {
  writeFileSync(body, [
    `Weekly balance proposal from **${data.matches}** verified online matches (last ${days} days).`, '',
    '| Hero | Games | Win rate | Change | Multiplier |', '|---|---:|---:|---:|---:|',
    ...changes.map((c) => `| ${name(c.id)} | ${c.games} | ${(100 * c.raw).toFixed(1)}% | ${c.pct > 0 ? '+' : ''}${c.pct}% | ${c.old} → ${c.mult} |`), '',
    `Rules: heroes with at least ${MIN} games, shrunk win rate outside 47.5–52.5%, nudge (50% − rate) × 0.25 capped at ±${Math.round(CAP * 100)}%, at most ${MAX} heroes.`,
    `Patch notes: v${version} "Weekly balance". Netcode VERSION → ${newV} (players on the old build will not be matched with the new one; replays verify by version).`, '',
    'Checked by the workflow: tools/determinism.mjs, tools/lockstep.mjs, tools/replay.mjs.', '',
    '**Merge to ship it. Close to skip this week.**',
  ].join('\n'));
}
console.log(`\nPatch ${version}: ${changes.length} hero changes, VERSION ${newV}.`);
out('changed', 'true'); out('version', version);
