// Replay verification (anti-cheat). Pulls queued Ranked / Weekend Cup replays from the Worker's admin API,
// re-simulates each with the deterministic sim at the replay's VERSION, and posts the verdicts back
// (worker/anticheat.js decides: ok, or flag + roll back + soft review flag on the coaches who claimed it).
//
//   MOBAVS_ADMIN=<token> node tools/verify.mjs [--api URL] [--workers 4] [--budget 40] [--limit 20] [--dry]
//   node tools/verify.mjs --file replay.json [--claim WINNER,CHECKSUM]     (one replay, no server)
//
// VERSION → sim source: the working tree when it is at that VERSION, else the newest git commits whose
// src/main.js has `const VERSION = N` (up to 3 distinct sim trees, extracted with `git archive`; the
// workflow checks out with fetch-depth 0). A replay that no source reproduces gets the newest one's result.
// Run by .github/workflows/verify.yml every hour.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const MAX_TICKS = 20 * 60 * 40; // nothing runs 40 minutes: a cap for hostile logs
const TYPE = /^[A-Za-z]{1,16}$/;

// ── replay documents ──
export function decode(rep) {
  if (rep && rep.cfg && rep.log) return rep; // already a document
  const text = rep.enc === 'gz64' ? zlib.gunzipSync(Buffer.from(rep.data, 'base64'), { maxOutputLength: 4 << 20 }).toString('utf8') : rep.enc === 'json' ? rep.data : null;
  if (text === null) throw new Error('unknown encoding');
  return JSON.parse(text);
}

// Structural checks before simulating: a log that no honest client could produce is 'invalid'.
export function validate(doc, heroIds) {
  const int = (x) => Number.isInteger(x) && x >= 0;
  if (!doc || typeof doc !== 'object' || !doc.cfg || !Array.isArray(doc.log)) return 'not a replay document';
  const c = doc.cfg;
  if (!int(c.seed) || typeof c.map !== 'string') return 'bad seed or map';
  if (!Array.isArray(c.teams) || c.teams.length !== 2) return 'bad teams';
  // weekly map event (src/data/events.js): an id or absent; Mirror Draft lets both teams field the same hero
  if (c.event !== undefined && (typeof c.event !== 'string' || !/^[a-z]{1,16}$/.test(c.event))) return 'bad event';
  // hero mastery perks are vs-AI only (src/meta.js perksFor): never in a ranked or cup match
  if (c.perks !== undefined && c.perks !== null) return 'mastery perks in a ranked or cup match';
  // coach skill tree Moment variants: a small { slot: variant } map (the sim ignores unknown ones)
  for (const t of c.teams) if (t && t.mv !== undefined && (!t.mv || typeof t.mv !== 'object' || Array.isArray(t.mv) || JSON.stringify(t.mv).length > 120)) return 'bad moment variants';
  const mirror = c.event === 'mirror';
  let seen = new Set();
  for (const t of c.teams) {
    if (!t || !Array.isArray(t.heroes) || t.heroes.length !== 5) return 'a team does not have 5 heroes';
    if (mirror) seen = new Set();
    for (const x of t.heroes) {
      if (!x || !heroIds.has(x.id)) return `unknown hero ${x && x.id}`;
      if (seen.has(x.id)) return `hero ${x.id} picked twice`;
      seen.add(x.id);
    }
  }
  if (doc.log.length > 30000) return 'log too long';
  let last = -1, total = 0;
  for (const e of doc.log) {
    if (!Array.isArray(e) || e.length !== 2 || !int(e[0]) || !Array.isArray(e[1]) || !e[1].length) return 'bad log entry';
    if (e[0] <= last) return 'log ticks out of order';
    last = e[0];
    const per = [0, 0];
    for (const cmd of e[1]) {
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return 'bad command';
      if (cmd.team !== 0 && cmd.team !== 1) return `command for team ${cmd.team}`;
      if (typeof cmd.type !== 'string' || !TYPE.test(cmd.type)) return 'bad command type';
      if (cmd.seq !== undefined && !int(cmd.seq)) return 'bad command sequence';
      if (JSON.stringify(cmd).length > 400) return 'oversized command';
      if (++per[cmd.team] > 16) return `more than 16 commands in one tick (tick ${e[0]})`;
      total++;
    }
  }
  if (total > 40000) return 'too many commands';
  if (doc.ai !== undefined) {
    if (!Array.isArray(doc.ai) || doc.ai.length > 2 || doc.ai.some((a) => !Array.isArray(a) || !int(a[0]) || (a[1] !== 0 && a[1] !== 1))) return 'bad AI takeover list';
  }
  return null;
}

const mods = new Map();
async function simFor(dir) {
  if (!mods.has(dir)) {
    const u = (f) => pathToFileURL(path.join(dir, f)).href;
    const [{ Game }, { Coach }, { HEROES }] = await Promise.all([import(u('src/sim/game.js')), import(u('src/sim/coach.js')), import(u('src/data/heroes.js'))]);
    mods.set(dir, { Game, Coach, heroIds: new Set(HEROES.map((x) => x.id)) });
  }
  return mods.get(dir);
}
// Re-run one replay with the sim in `dir`. → { kind: 'sim', winner, checksum, tick } | { kind: 'invalid', reason }
export async function simulate(dir, doc) {
  const { Game, Coach, heroIds } = await simFor(dir);
  const why = validate(doc, heroIds); if (why) return { kind: 'invalid', reason: why };
  let g;
  try { g = new Game({ ...JSON.parse(JSON.stringify(doc.cfg)), coach: [false, false], coachLevel: [1, 1] }); } catch (e) { return { kind: 'invalid', reason: 'config rejected: ' + String(e.message || e).slice(0, 80) }; }
  const ai = (doc.ai || []).slice().sort((a, b) => a[0] - b[0]);
  let li = 0, ai_i = 0;
  while (!g.over && g.tick < MAX_TICKS) {
    while (ai_i < ai.length && ai[ai_i][0] <= g.tick) { const t = ai[ai_i++][1]; g.coaches[t] = new Coach(g, t, 1); }
    const cmds = li < doc.log.length && doc.log[li][0] === g.tick ? JSON.parse(JSON.stringify(doc.log[li++][1])) : [];
    g.step(cmds); g.fx.length = 0;
  }
  if (!g.over) return { kind: 'invalid', reason: 'the match never ended' };
  if (li < doc.log.length) return { kind: 'invalid', reason: `commands after the end (tick ${doc.log[li][0]} > ${g.tick})` };
  return { kind: 'sim', winner: g.winner, checksum: String(g.checksum()), tick: g.tick };
}

// ── worker thread: { id, dirs, rep } → { id, result } ──
if (!isMainThread) {
  parentPort.on('message', async ({ id, dirs, rep }) => {
    let result;
    try {
      const doc = decode(rep);
      for (const dir of dirs) {
        const r = await simulate(dir, doc);
        if (!result) result = r;
        if (r.kind === 'sim' && rep.claim && r.winner === rep.claim.winner && r.checksum === String(rep.claim.checksum)) { result = r; break; }
      }
    } catch (e) { result = { kind: 'invalid', reason: 'unreadable replay: ' + String(e.message || e).slice(0, 80) }; }
    parentPort.postMessage({ id, result });
  });
}

// ── sim sources by VERSION ──
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim();
const versionIn = (src) => { const m = /const VERSION = (\d+);/.exec(src); return m ? Number(m[1]) : null; };
const sources = new Map();
export function sourcesFor(v) {
  if (sources.has(v)) return sources.get(v);
  const out = [];
  if (versionIn(fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8')) === v) out.push(ROOT);
  try {
    const head = out.length ? git('rev-parse', 'HEAD:src/sim', 'HEAD:src/data', 'HEAD:src/maps').replace(/\s+/g, ' ') : null;
    const trees = new Set(head ? [head] : []);
    for (const c of git('rev-list', '--max-count=400', 'HEAD', '--', 'src/sim', 'src/data', 'src/maps', 'src/main.js').split('\n').filter(Boolean)) {
      if (out.length >= 3) break;
      let ver; try { ver = versionIn(git('show', `${c}:src/main.js`)); } catch { continue; }
      if (ver !== v) continue;
      const tree = git('rev-parse', `${c}:src/sim`, `${c}:src/data`, `${c}:src/maps`).replace(/\s+/g, ' ');
      if (trees.has(tree)) continue;
      trees.add(tree);
      const dir = path.join(os.tmpdir(), 'mobavs-verify', c.slice(0, 12));
      if (!fs.existsSync(path.join(dir, 'src/sim/game.js'))) {
        fs.mkdirSync(dir, { recursive: true });
        execFileSync('sh', ['-c', `git archive ${c} src package.json | tar -x -C "${dir}"`], { cwd: ROOT, stdio: 'ignore' });
      }
      out.push(dir);
    }
  } catch { /* no git history: working tree only */ }
  sources.set(v, out);
  return out;
}

// ── main ──
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]; };

function pool(n) {
  const ws = Array.from({ length: n }, () => new Worker(SELF)), wait = new Map(), free = [...ws], queue = [];
  let seq = 0;
  const pump = () => { while (free.length && queue.length) { const w = free.pop(), job = queue.shift(); wait.set(job.id, job); w.once('message', (m) => { wait.get(m.id).resolve(m.result); wait.delete(m.id); free.push(w); pump(); }); w.postMessage({ id: job.id, dirs: job.dirs, rep: job.rep }); } };
  return {
    run: (dirs, rep) => new Promise((resolve) => { queue.push({ id: ++seq, dirs, rep, resolve }); pump(); }),
    close: () => Promise.all(ws.map((w) => w.terminate())),
  };
}

async function api(base, token, p, body) {
  const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${data.error || ''}`);
  return data;
}

async function main() {
  if (arg('file')) { // one local replay: print what the server would be told
    const rep = JSON.parse(fs.readFileSync(arg('file'), 'utf8')), doc = decode(rep);
    const v = Number(doc.v ?? rep.v), dirs = sourcesFor(v);
    if (!dirs.length) { console.log(JSON.stringify({ kind: 'unknown', reason: `no sim source for VERSION ${v}` })); return; }
    const claim = typeof arg('claim') === 'string' ? arg('claim').split(',') : null;
    const r = await simulate(dirs[0], doc);
    console.log(JSON.stringify(r));
    if (claim) { const ok = r.kind === 'sim' && r.winner === Number(claim[0]) && r.checksum === claim[1]; console.log(ok ? 'MATCHES CLAIM ✔' : 'DOES NOT MATCH CLAIM ✘'); process.exit(ok ? 0 : 1); }
    return;
  }
  const base = String(arg('api', process.env.MOBAVS_API || 'https://moba-vs.chesscomplex.workers.dev')).replace(/\/$/, '');
  const token = process.env.MOBAVS_ADMIN;
  if (!token) { console.error('MOBAVS_ADMIN is not set (the admin token, also set as a Worker secret).'); process.exit(2); }
  const workers = Math.max(1, Number(arg('workers', 2)) | 0), limit = Math.max(1, Math.min(50, Number(arg('limit', workers * 4)) | 0));
  const until = Date.now() + Number(arg('budget', 40)) * 60000, dry = !!arg('dry', false);
  const P = pool(workers);
  const tally = { ok: 0, mismatch: 0, invalid: 0, unknown: 0 };
  const flagged = [], memo = new Map();
  try {
    while (Date.now() < until) {
      const { replays, pending } = await api(base, token, '/api/admin/replays?limit=' + limit);
      if (!replays.length) break;
      console.log(`${replays.length} of ${pending} queued replay(s)…`);
      const verdicts = await Promise.all(replays.map(async (rep) => {
        const dirs = sourcesFor(rep.v);
        if (!dirs.length) { tally.unknown++; return { match: rep.match, hash: rep.hash, kind: 'unknown', reason: `no sim source for VERSION ${rep.v}` }; }
        const key = `${rep.v}:${rep.hash}:${rep.claim.winner}:${rep.claim.checksum}`; // the same log is only simulated once per run
        const r = await (memo.get(key) || memo.set(key, P.run(dirs, rep)).get(key));
        const ok = r.kind === 'sim' && r.winner === rep.claim.winner && r.checksum === String(rep.claim.checksum);
        tally[r.kind === 'invalid' ? 'invalid' : ok ? 'ok' : 'mismatch']++;
        if (!ok) flagged.push(`${rep.mode} ${rep.match} (${rep.player}): ${r.kind === 'invalid' ? r.reason : `sim says winner ${r.winner} / ${r.checksum}, report says ${rep.claim.winner} / ${rep.claim.checksum}`}`);
        return { match: rep.match, hash: rep.hash, ...r };
      }));
      if (dry) { console.log(JSON.stringify(verdicts, null, 1)); break; }
      const res = await api(base, token, '/api/admin/verdicts', { verdicts });
      for (const x of res.results) if (x.verdict) console.log(`  ${x.match}: ${x.verdict}`);
      if (!res.results.some((x) => x.updated)) break; // nothing moved: do not loop on the same rows
    }
  } finally { await P.close(); }
  console.log(`verified ${tally.ok} · mismatched ${tally.mismatch} · invalid ${tally.invalid} · unknown version ${tally.unknown}`);
  for (const f of flagged) console.log('  FLAG ' + f);
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(e.message || e); process.exit(1); });
