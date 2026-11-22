// Replay verification (anti-cheat) for Ranked and Weekend Cup results.
//
// With every ranked / cup report the client uploads its command log (+ match config): gzip+base64 when the
// browser can compress, capped at REPLAY_MAX. The Worker cannot re-simulate (free plan: ~10 ms CPU per
// request), so it only stores the blob (one copy per distinct hash per match) and queues the match.
// A scheduled GitHub Actions job (.github/workflows/verify.yml → tools/verify.mjs) pulls queued replays from
// the token-protected admin API, re-simulates each with the repo's deterministic sim at the matching VERSION
// and posts the outcome back. The Worker then decides:
//   - a replay is 'ok' when the re-simulated winner and final checksum equal its uploader's report;
//   - the match is 'ok' when an ok replay backs the accepted result; uploaders of bad replays get a soft flag;
//   - otherwise the match is 'flagged': its rating change (or cup result) is rolled back and the coaches who
//     claimed that result are marked for review (players.review; never an automatic ban);
//   - replays for an unknown VERSION are 'skip' (match 'unverifiable', nobody is flagged).
// Storage stays bounded: verified/skipped replays are pruned after REPLAY_DAYS (default 14), unverified ones
// after the same time; flagged ('bad') replays are kept for review.
import { overturnCup, cupTimes } from './cups.js';

export const REPLAY_MAX = 64 * 1024;
export const REPLAY_SCHEMA = [
  // status: new → ok | bad | skip. data is NULL for a second upload with the same hash (the two peers' logs match).
  `CREATE TABLE IF NOT EXISTS replays (match TEXT, player TEXT, v INTEGER, mode TEXT, hash TEXT, enc TEXT, data TEXT, status TEXT, reason TEXT, created INTEGER, checked INTEGER, PRIMARY KEY (match, player))`,
  `CREATE INDEX IF NOT EXISTS replays_todo ON replays (status, created)`,
];
export const REPLAY_TABLES = ['replays'];
export const REPLAY_MIGRATIONS = [
  `ALTER TABLE matches ADD COLUMN mode TEXT`,
  `ALTER TABLE matches ADD COLUMN dblue INTEGER`,
  `ALTER TABLE matches ADD COLUMN dred INTEGER`,
  `ALTER TABLE matches ADD COLUMN verify TEXT`,
  `CREATE INDEX IF NOT EXISTS matches_verify ON matches (verify, created)`,
  `ALTER TABLE players ADD COLUMN review INTEGER DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN review_at INTEGER`,
];

// Validated replay upload → an INSERT for the report's batch (null when absent / malformed / too big).
export async function replayStmt(db, sha, match, player, mode, r, now) {
  if (!r || typeof r !== 'object') return null;
  const enc = r.enc === 'gz64' ? 'gz64' : r.enc === 'json' ? 'json' : null, data = typeof r.data === 'string' ? r.data : '';
  if (!enc || !data || data.length > REPLAY_MAX || (enc === 'gz64' && !/^[A-Za-z0-9+/=]+$/.test(data))) return null;
  const hash = (await sha(data)).slice(0, 32);
  const dup = await db.prepare('SELECT 1 AS x FROM replays WHERE match = ? AND hash = ? AND data IS NOT NULL').bind(match, hash).first();
  return db.prepare(`INSERT OR IGNORE INTO replays (match, player, v, mode, hash, enc, data, status, created) VALUES (?,?,?,?,?,?,?, 'new', ?)`)
    .bind(match, player, Number(r.v) | 0, mode, hash, enc, dup ? null : data, now);
}

export function pruneStmts(db, env, now) {
  const days = Number(env && env.REPLAY_DAYS) > 0 ? Number(env.REPLAY_DAYS) : 14, cut = now - days * 86400000;
  return [db.prepare(`DELETE FROM replays WHERE status IN ('ok', 'skip', 'new') AND created < ?`).bind(cut)];
}

export const tokenOk = async (req, env, sha) => {
  const tok = env && env.MOBAVS_ADMIN;
  if (!tok || String(tok).length < 16) return false;
  const m = (req.headers.get('authorization') || '').match(/^Bearer (\S{16,200})$/);
  return !!m && (await sha(m[1])) === (await sha(String(tok)));
};

// Roll back a flagged match: ranked rating change (exact applied deltas, win/loss counts) or cup result.
async function rollback(db, env, m, now) {
  if (m.mode === 'ranked' && m.status === 'verified' && (m.dblue !== null || m.dred !== null)) {
    const blueWon = m.winner === 0;
    const back = (pid, d, won) => db.prepare('UPDATE ladder SET rating = MAX(0, rating - ?), wins = MAX(0, wins - ?), losses = MAX(0, losses - ?), updated = ? WHERE season = ? AND player = ?')
      .bind(d || 0, won ? 1 : 0, won ? 0 : 1, now, m.season, pid);
    await db.batch([back(m.blue, m.dblue, blueWon), back(m.red, m.dred, !blueWon)]);
  } else if (m.mode === 'cup') await overturnCup(db, m.id, now, cupTimes(env).ready);
}

async function finalize(db, env, matchId, now) {
  const m = await db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
  if (!m || m.verify !== 'pending') return null;
  const rows = (await db.prepare(`SELECT r.player, r.status, r.reason, rep.winner FROM replays r LEFT JOIN reports rep ON rep.match = r.match AND rep.player = r.player WHERE r.match = ?`).bind(matchId).all()).results || [];
  if (!rows.length || rows.some((r) => r.status === 'new')) return null;
  const flag = (ids, note) => ids.length ? db.batch(ids.map((id) => db.prepare('UPDATE players SET review = COALESCE(review, 0) + 1, review_at = ? WHERE id = ?').bind(now, id))) : null;
  const bad = rows.filter((r) => r.status === 'bad').map((r) => r.player);
  let verdict;
  if (rows.some((r) => r.status === 'ok' && r.winner === m.winner)) verdict = 'ok';
  else if (rows.every((r) => r.status === 'skip')) verdict = 'unverifiable';
  else verdict = 'flagged';
  const done = await db.prepare('UPDATE matches SET verify = ? WHERE id = ? AND verify = ? RETURNING id').bind(verdict, matchId, 'pending').first();
  if (!done) return null;
  if (verdict === 'ok') await flag(bad);
  if (verdict === 'flagged') {
    await rollback(db, env, m, now);
    // the coaches who claimed the accepted result (every bad uploader too)
    const claimed = rows.filter((r) => r.winner === m.winner).map((r) => r.player);
    await flag([...new Set([...claimed, ...bad])]);
  }
  return verdict;
}

export function adminApi(H) {
  const { json, bad, body, sha } = H;
  return async function admin(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/admin/')) return null;
    if (!(await tokenOk(req, env, sha))) return bad('not found', 404); // hidden unless the owner set MOBAVS_ADMIN
    // Queued replays of counted ranked/cup matches, with each uploader's own claim.
    if (p === '/api/admin/replays' && M === 'GET') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      const [rows, cnt] = await db.batch([
        db.prepare(`SELECT r.match, r.player, r.v, r.enc, r.data, r.hash, r.created, rep.winner, rep.checksum, rep.side, m.mode, m.winner AS mwin FROM replays r
          JOIN matches m ON m.id = r.match LEFT JOIN reports rep ON rep.match = r.match AND rep.player = r.player
          WHERE r.status = 'new' AND r.data IS NOT NULL AND m.verify = 'pending' ORDER BY r.created LIMIT ?`).bind(limit),
        db.prepare(`SELECT COUNT(*) AS n FROM replays r JOIN matches m ON m.id = r.match WHERE r.status = 'new' AND r.data IS NOT NULL AND m.verify = 'pending'`),
      ]);
      return json({ replays: (rows.results || []).map((r) => ({ match: r.match, player: r.player, v: r.v, enc: r.enc, data: r.data, hash: r.hash, mode: r.mode,
        claim: { winner: r.winner, checksum: r.checksum, side: r.side } })), pending: ((cnt.results || [])[0] || {}).n || 0 });
    }
    // Verdicts: [{ match, hash, kind: 'sim' | 'invalid' | 'unknown', winner, checksum, tick, reason }].
    if (p === '/api/admin/verdicts' && M === 'POST') {
      const b = await body(req), list = Array.isArray(b.verdicts) ? b.verdicts.slice(0, 50) : [];
      const out = [];
      for (const v of list) {
        const match = String(v.match || ''), hash = String(v.hash || '');
        const rows = (await db.prepare(`SELECT r.player, rep.winner, rep.checksum FROM replays r LEFT JOIN reports rep ON rep.match = r.match AND rep.player = r.player
          WHERE r.match = ? AND r.hash = ? AND r.status = 'new'`).bind(match, hash).all()).results || [];
        const stmts = rows.map((r) => {
          const okSim = v.kind === 'sim' && r.winner === v.winner && String(r.checksum) === String(v.checksum);
          const st = v.kind === 'unknown' ? 'skip' : okSim ? 'ok' : 'bad';
          const why = v.kind === 'sim' ? (okSim ? null : `re-simulated winner ${v.winner} checksum ${v.checksum} at tick ${v.tick}; reported winner ${r.winner} checksum ${r.checksum}`) : String(v.reason || v.kind).slice(0, 200);
          return db.prepare('UPDATE replays SET status = ?, reason = ?, checked = ? WHERE match = ? AND player = ?').bind(st, why, now, match, r.player);
        });
        if (stmts.length) await db.batch(stmts);
        out.push({ match, hash, updated: stmts.length, verdict: await finalize(db, env, match, now) });
      }
      await db.batch(pruneStmts(db, env, now));
      return json({ ok: true, results: out });
    }
    // Review list: flagged matches and coaches with a soft flag.
    if (p === '/api/admin/review' && M === 'GET') {
      const [fm, fp, st] = await db.batch([
        db.prepare(`SELECT m.id, m.mode, m.season, m.blue, m.red, m.winner, m.status, m.created, (SELECT GROUP_CONCAT(r.player || ': ' || COALESCE(r.reason, r.status), ' | ') FROM replays r WHERE r.match = m.id) AS replays
          FROM matches m WHERE m.verify = 'flagged' ORDER BY m.created DESC LIMIT 100`),
        db.prepare('SELECT id, name, review, review_at FROM players WHERE review > 0 ORDER BY review_at DESC LIMIT 100'),
        db.prepare('SELECT status, COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM replays GROUP BY status'),
      ]);
      return json({ matches: fm.results || [], players: fp.results || [], replays: st.results || [] });
    }
    if (p === '/api/admin/review' && M === 'POST') {
      const b = await body(req), id = String(b.player || '');
      if (!/^[A-Z0-9]{10}$/.test(id)) return bad('bad player');
      await db.prepare('UPDATE players SET review = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    return bad('not found', 404);
  };
}
