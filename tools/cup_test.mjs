// Weekend Cups + anti-cheat end to end, against a local Worker. Eight (and more) coaches are simulated through
// the API; match results carry real replays produced by the sim, and tools/verify.mjs runs against the
// admin API to catch a tampered one.
//
//   npx --yes wrangler@4 dev --local --port 8845 --ip 127.0.0.1 --persist-to /tmp/cupdb \
//     --var CUP_OPEN:always --var CUP_READY_MS:90000 --var CUP_GRACE_MS:8000 --var CUP_SIGNUP_MS:45000 \
//     --var CUP_SEEN_MS:30000 --var REPLAY_DAYS:0.004 --var MOBAVS_ADMIN:local-test-token-0123456789
//   node tools/cup_test.mjs [http://127.0.0.1:8845]
//
// Covers: a cup that does not fill (called off, no bots) · 8 sign-ups start a cup, a 9th waits for the next ·
// seeding · ready check + no-show forfeit · agreeing reports · a single report after the grace period · a
// dispute replayed once · reports from outsiders rejected · tampered semifinal replay caught by verify.mjs →
// cheater disqualified and replaced in the final before it starts · champion, places, trophies on the
// public profile, history · Ranked: honest replay verified, tampered one flagged and its Elo rolled back,
// coaches marked for review · admin endpoints hidden without the token · verified replays pruned, flagged kept.
import { Game } from '../src/sim/game.js';
import { LocalRunner } from '../src/net/runner.js';
import { aiPrep } from '../src/sim/draft.js';
import { replayDoc } from '../src/net/replaypack.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';

const BASE = (process.argv[2] || 'http://127.0.0.1:8845').replace(/\/$/, '');
const TOKEN = 'local-test-token-0123456789';
const VERSION = Number(/const VERSION = (\d+);/.exec(fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'))[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) bad++; };

async function call(path, { method = 'GET', body, who, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
  if (token) headers.authorization = `Bearer ${token}`;
  let r;
  for (let i = 0; ; i++) { // wrangler dev reloads when files in the worktree change: retry a dropped connection
    try { r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); break; } catch (e) { if (i >= 4) throw e; await sleep(1500); }
  }
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ...data };
}
const coach = async (name) => { const a = await call('/api/account', { method: 'POST', body: { name } }); return { id: a.id, secret: a.secret, name }; };

// ── real replays from the sim (Lane Rush: short), one won by each side; cached between runs ──
const FIX = '/tmp/cup_test_fixtures.json';
function makeReplay(seed) {
  const picks = [['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], ['varro', 'gama', 'hex', 'bolt', 'frost']];
  if (seed % 2) picks.reverse(); // the lineups trade sides so both winners turn up quickly
  const cfg = { seed, map: 'rush_sakura', mode: 'rush', coach: [false, false], coachLevel: [1, 1], teams: [aiPrep(picks[0], picks[1]), aiPrep(picks[1], picks[0])] };
  const g = new Game(JSON.parse(JSON.stringify(cfg))), r = new LocalRunner(g, 0, { noHalftime: true });
  const calls = [{ type: 'moment', id: 'rally' }, { type: 'group', lane: 'mid' }, { type: 'ult', mode: 'go' }, { type: 'objective', obj: 'dragon' }];
  let k = 0;
  while (!g.over) {
    if (g.tick % 240 === 11) r.send(calls[k++ % calls.length]);
    if (g.tick % 300 === 17) { r.myTeam = 1; r.send(calls[(k + seed) % calls.length]); r.myTeam = 0; }
    r.update(0.05);
  }
  return { winner: g.winner, checksum: String(g.checksum()), doc: replayDoc(VERSION, cfg, r.log) };
}
function fixtures() {
  try { const f = JSON.parse(fs.readFileSync(FIX, 'utf8')); if (f.v === VERSION && f.w[0] && f.w[1]) return f.w; } catch { /* make them */ }
  const w = [null, null];
  for (let seed = 101; seed < 121 && !(w[0] && w[1]); seed++) { const r = makeReplay(seed); if (!w[r.winner]) w[r.winner] = r; }
  fs.writeFileSync(FIX, JSON.stringify({ v: VERSION, w }));
  return w;
}
const pack = (doc) => ({ v: VERSION, enc: 'gz64', data: zlib.gzipSync(JSON.stringify(doc)).toString('base64') });
// the cheater's upload: the real winner's log edited after the fact (other seed, team 0's calls dropped)
const tamper = (doc) => { const d = JSON.parse(JSON.stringify(doc)); d.cfg.seed += 1; d.log = d.log.filter((e) => e[1].some((c) => c.team === 1)).map((e) => [e[0], e[1].filter((c) => c.team === 1)]); return d; };

async function main() {
  const h = await call('/api/health');
  if (!h.tables) { console.log('Worker not ready at', BASE, h); process.exit(1); }
  console.log('Making replays with the sim…');
  const W = fixtures();
  ok(W[0].winner === 0 && W[1].winner === 1, `replay fixtures for both winners (${W[0].doc.log.length} / ${W[1].doc.log.length} log entries)`);

  // ── admin endpoints are hidden without the token ──
  ok((await call('/api/admin/replays')).status === 404, 'admin API: 404 without a token');
  ok((await call('/api/admin/replays', { token: 'wrong-token-wrong-token' })).status === 404, 'admin API: 404 with a wrong token');

  // ── a cup that does not fill is called off ──
  const VOID_V = 90001;
  const lone = await Promise.all(['Lone1', 'Lone2', 'Lone3'].map(coach));
  for (const c of lone) await call('/api/cup/join', { method: 'POST', who: c, body: { version: VOID_V } });
  let s = await call(`/api/cup?v=${VOID_V}`, { who: lone[0] });
  ok(s.cup && s.cup.status === 'signup' && s.cup.count === 3, `sign-up list: 3 / 8 (${s.cup && s.cup.count})`);
  const voidAt = Date.now() + (s.cup ? s.cup.closesIn : 0) + 500;

  // ── eight coaches: the cup starts ──
  const V = 90002;
  const C = [];
  for (let i = 0; i < 8; i++) C.push(await coach(`Coach${i + 1}`));
  const nine = await coach('Ninth');
  for (let i = 0; i < 7; i++) { s = await call('/api/cup/join', { method: 'POST', who: C[i], body: { version: V } }); }
  ok(s.cup.status === 'signup' && s.cup.count === 7, 'seven signed up: still waiting');
  const out = await call('/api/match/report', { method: 'POST', who: C[0], body: { match: 'CFAKEMATCHID123', side: 0, opponent: C[1].id, winner: 0, checksum: '1', mode: 'cup' } });
  ok(out.status === 403, 'a cup report for a match you are not in is rejected');
  s = await call('/api/cup/join', { method: 'POST', who: C[7], body: { version: V } });
  ok(s.cup.status === 'live' && s.cup.count === 8 && s.cup.matches.length === 4, 'eighth sign-up starts the cup: 4 quarterfinals');
  const cupId = s.cup.id;
  const seedOf = Object.fromEntries(s.cup.players.map((p) => [p.id, p.seed]));
  ok(C.every((c, i) => seedOf[c.id] === i + 1), 'seeded 1-8 (equal ratings: by sign-up order)');
  const n9 = await call('/api/cup/join', { method: 'POST', who: nine, body: { version: V } });
  ok(n9.cup && n9.cup.status === 'signup' && n9.cup.id !== cupId && n9.cup.count === 1, 'a ninth coach waits on the next cup’s list');
  const S = (n) => C[n - 1];
  const st = async (c) => call(`/api/cup?v=${V}`, { who: c });
  const myMatch = async (c) => (await st(c)).me.match;
  const ready = (c) => call('/api/cup/ready', { method: 'POST', who: c, body: { cup: cupId } });
  const report = (c, m, side, opp, w, replay, claim) => call('/api/match/report', { method: 'POST', who: c, body: { match: m, season: 1, side, opponent: opp.id, winner: claim ? claim.winner : w.winner, checksum: claim ? claim.checksum : w.checksum, mode: 'cup', summary: { len: 300 }, replay } });
  // play a match between host (a, side 0) and guest (b, side 1) with fixture W[win]
  async function play(a, b, win, { reportA = true, reportB = true, replay } = {}) {
    await ready(a); const r = await ready(b);
    const m = r.me.match;
    ok(m && m.status === 'playing' && m.room && m.match, `${a.name} vs ${b.name}: both ready → playing (room ${m && m.room})`);
    const rep = replay || pack(W[win].doc);
    const res = [];
    if (reportA) res.push(await report(a, m.match, 0, b, W[win], rep));
    if (reportB) res.push(await report(b, m.match, 1, a, W[win], rep));
    return { m, res };
  }

  // QF0: 1 v 8, agreeing reports
  const q0 = await play(S(1), S(8), 0);
  ok(q0.res[1].status === 'decided' && q0.res[1].advanced === false && q0.res[0].status === 'pending', 'QF 1v8: second agreeing report decides it (seed 1 advances)');
  // QF1: 4 v 5, only seed 4 checks in → no-show
  await ready(S(4));
  ok((await myMatch(S(5))).status === 'ready', 'QF 4v5: waiting for check-in');
  // QF2: 2 v 7, only seed 7 reports its win → decided after the grace period
  const q2 = await play(S(2), S(7), 1, { reportA: false });
  ok(q2.res[0].status === 'pending', 'QF 2v7: single report waits for the grace period');
  // QF3: 3 v 6, disagreeing reports → replayed once, then seed 6 wins
  await ready(S(3)); const r3 = await ready(S(6));
  const m3 = r3.me.match;
  await report(S(3), m3.match, 0, S(6), W[0], pack(W[0].doc));
  const d3 = await report(S(6), m3.match, 1, S(3), W[1], pack(W[1].doc));
  ok(d3.status === 'replay', 'QF 3v6: disputed → match is replayed');
  const m3b = await myMatch(S(3));
  ok(m3b && m3b.status === 'ready' && m3b.note === 'replay after a dispute', 'QF 3v6: fresh check-in for the replay');
  const outsider = await report(S(3), m3.match, 0, S(6), W[0], null);
  ok(outsider.status === 403, 'a report for the old (disputed) match id is rejected');
  await play(S(3), S(6), 1);
  const left = (await myMatch(S(5))).left;
  console.log(`  … waiting ${Math.ceil(left / 1000)}s for the quarterfinal check-in deadline (and the report grace period)`);
  await sleep(left + 1500);
  s = await st(S(1));
  const qf = s.cup.matches.filter((m) => m.round === 0);
  const W_ = (slot) => qf.find((m) => m.slot === slot);
  ok(W_(1).winner === S(4).id && W_(1).reason === 'no-show', 'QF 4v5: seed 5 did not check in → seed 4 advances (no-show)');
  ok(W_(2).winner === S(7).id && W_(2).reason === 'opponent did not report', 'QF 2v7: seed 7 advances on its single report');
  ok(W_(3).winner === S(6).id, 'QF 3v6: replay decided (seed 6 advances)');
  const places = Object.fromEntries(s.cup.players.map((p) => [p.id, p.place]));
  ok([8, 5, 2, 3].every((n) => places[S(n).id] === 5), 'quarterfinal losers finish 5th');
  const sfs = s.cup.matches.filter((m) => m.round === 1);
  ok(sfs.length === 2 && sfs[0].a === S(1).id && sfs[0].b === S(4).id && sfs[1].a === S(7).id && sfs[1].b === S(6).id, 'semifinals built: 1 v 4, 7 v 6');

  // SF0: 1 v 4 — both clients claim seed 4 won, with a tampered replay (log edited after the fact)
  await play(S(1), S(4), 1, { replay: pack(tamper(W[1].doc)) });
  // SF1: 7 v 6, honest
  await play(S(7), S(6), 0);
  s = await st(S(4));
  const fin = s.cup.matches.find((m) => m.round === 2);
  ok(fin && fin.status === 'ready' && fin.a === S(4).id && fin.b === S(7).id, 'final built: 4 v 7 (check-in open)');

  // ── Ranked: one honest match, one forged result ──
  const R = await Promise.all(['RankA', 'RankB', 'RankC', 'RankD'].map(coach));
  const ranked = (c, m, side, opp, w, claim, replay) => call('/api/match/report', { method: 'POST', who: c, body: { match: m, season: 7, side, opponent: opp.id, winner: claim.winner, checksum: claim.checksum, mode: 'ranked', summary: { picks: [] }, replay } });
  await ranked(R[0], 'MHONESTRANKED01', 0, R[1], W[0], W[0], pack(W[0].doc));
  const hr = await ranked(R[1], 'MHONESTRANKED01', 1, R[0], W[0], W[0], pack(W[0].doc));
  ok(hr.status === 'verified' && hr.delta.blue > 0, `ranked honest: verified (+${hr.delta && hr.delta.blue})`);
  const forged = { winner: 1, checksum: '12345' }; // both clients claim red won; the replay says otherwise
  await ranked(R[2], 'MFORGEDRANKED01', 0, R[3], W[0], forged, pack(W[0].doc));
  const fr = await ranked(R[3], 'MFORGEDRANKED01', 1, R[2], W[0], forged, pack(W[0].doc));
  ok(fr.status === 'verified' && fr.rating.red > 1000, `ranked forged: accepted for now (red ${fr.rating && fr.rating.red})`);
  const lbBefore = await call('/api/leaderboard?season=7');
  const rateOf = (lb, c) => (lb.top.find((r) => r.id === c.id) || {}).rating;
  ok(rateOf(lbBefore, R[3]) > 1000 && rateOf(lbBefore, R[2]) < 1000, 'forged Elo on the ladder before review');

  // ── the verifier (the scheduled GitHub Action) ──
  const q = await call('/api/admin/replays?limit=50', { token: TOKEN });
  ok(q.status === 200 && q.pending >= 7, `admin queue: ${q.pending} replays waiting (decided cup + ranked matches, one copy per distinct log)`);
  console.log('  … running tools/verify.mjs');
  const log = execFileSync('node', ['tools/verify.mjs', '--api', BASE, '--workers', '3'], { env: { ...process.env, MOBAVS_ADMIN: TOKEN }, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  console.log(log.split('\n').filter(Boolean).map((l) => '       ' + l).join('\n'));
  ok(/FLAG cup/.test(log) && /FLAG ranked/.test(log), 'verify.mjs flags the tampered cup replay and the forged ranked result');
  const rv = await call('/api/admin/review', { token: TOKEN });
  const flaggedIds = rv.matches.map((m) => m.id);
  ok(rv.matches.length === 2 && flaggedIds.includes('MFORGEDRANKED01'), `two matches flagged (${flaggedIds.join(', ')})`);
  const reviewIds = rv.players.map((p) => p.id);
  ok([S(1), S(4), R[2], R[3]].every((c) => reviewIds.includes(c.id)) && !reviewIds.includes(S(7).id), 'the coaches who claimed those results are marked for review (soft flag)');
  const lbAfter = await call('/api/leaderboard?season=7');
  ok(rateOf(lbAfter, R[3]) === 1000 && rateOf(lbAfter, R[2]) === 1000 && rateOf(lbAfter, R[0]) > 1000, 'forged Elo rolled back to 1000; the honest match keeps its rating');
  const rd = (lbAfter.top.find((r) => r.id === R[3].id) || {});
  ok(rd.wins === 0 && rd.losses === 0, 'forged win removed from the record');
  s = await st(S(1));
  const fin2 = s.cup.matches.find((m) => m.round === 2);
  const pl2 = Object.fromEntries(s.cup.players.map((p) => [p.id, p.place]));
  ok(fin2.a === S(1).id && fin2.status === 'ready' && pl2[S(4).id] === -1 && pl2[S(1).id] === 0, 'cup: cheater disqualified, seed 1 takes the place in the final');
  ok(s.me.match && s.me.match.opp.id === S(7).id, 'seed 1 now has the final check-in');

  // ── final ──
  const fm = await play(S(1), S(7), 1);
  ok(fm.res[1].status === 'decided' && fm.res[1].advanced === true, 'final decided');
  s = await st(S(7));
  const pl3 = Object.fromEntries(s.cup.players.map((p) => [p.id, p.place]));
  ok(s.cup.status === 'done' && s.cup.champion && s.cup.champion.id === S(7).id, `cup done: champion ${s.cup.champion && s.cup.champion.name}`);
  ok(pl3[S(7).id] === 1 && pl3[S(1).id] === 2 && pl3[S(6).id] === 3 && pl3[S(4).id] === -1, 'places: 1st, 2nd, semifinal 3rd, DQ');
  const prof = await call(`/api/player/${S(7).id}?season=1`);
  ok(prof.cups && prof.cups.wins === 1 && prof.cups.played === 1, 'champion trophy on the public profile');
  const p4 = await call(`/api/player/${S(4).id}?season=1`);
  ok(p4.cups && p4.cups.played === 0, 'a disqualified finish earns no trophy');
  const hs = await call('/api/cup/history', { who: S(1) });
  ok(hs.mine.length === 1 && hs.mine[0].place === 2 && hs.mine[0].champion === 'Coach7' && hs.champions[0].name === 'Coach7', 'cup history: your finish and the latest champions');

  // ── the lone cup is called off ──
  const wait = voidAt - Date.now(); if (wait > 0) { console.log(`  … waiting ${Math.ceil(wait / 1000)}s for the lone cup's sign-up window`); await sleep(wait); }
  s = await call(`/api/cup?v=${VOID_V}`, { who: lone[0] });
  ok(s.cup && s.cup.status === 'void' && /did not start/.test(s.cup.reason) && /No bots/.test(s.cup.reason), `unfilled cup called off: "${s.cup && s.cup.reason}"`);
  ok(s.cup && s.cup.count === 1, 'coaches who closed the Cup screen dropped off the sign-up list');
  const hl = await call('/api/cup/history', { who: lone[0] });
  ok(hl.mine.length === 1 && hl.mine[0].status === 'void', 'called-off cup in the history');

  // ── a second verifier run has nothing to do; the final's replay is verified ──
  const log2 = execFileSync('node', ['tools/verify.mjs', '--api', BASE, '--workers', '2'], { env: { ...process.env, MOBAVS_ADMIN: TOKEN }, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  ok(/verified 1 · mismatched 0/.test(log2), 'second run: only the final, verified');

  // ── storage stays bounded: verified replays are pruned, flagged ones kept ──
  const before = Object.fromEntries((await call('/api/admin/review', { token: TOKEN })).replays.map((r) => [r.status, r.n]));
  console.log('  … waiting for REPLAY_DAYS (0.004 d) to pass');
  await sleep(Math.max(0, 0.004 * 86400000 - 120000));
  for (let i = 0; i < 30; i++) {
    await call('/api/admin/verdicts', { method: 'POST', token: TOKEN, body: { verdicts: [] } });
    const now = Object.fromEntries((await call('/api/admin/review', { token: TOKEN })).replays.map((r) => [r.status, r.n]));
    if (!now.ok) { ok(now.bad === before.bad && before.ok > 0, `pruned ${before.ok} verified replays, kept ${now.bad} flagged`); break; }
    if (i === 29) ok(false, 'verified replays were not pruned');
    await sleep(10000);
  }
  console.log(bad ? `CUP TEST: ${bad} FAILED` : 'CUP TEST OK');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
