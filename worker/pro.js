// Pro League predictions (client: src/ui/franchise-pro.js). The league itself is not stored: it is a pure
// function of the ISO week (src/franchise/pro.js), so the Worker recomputes it (about 2 ms) to check and score picks.
//
// One write per matchday: POST /api/pro/picks { w, day, picks } stores that day's picks once (INSERT OR IGNORE),
// before the day resolves (18:00 UTC), then re-scores the coach's week into pro_scores. GET /api/pro?w= returns
// the week's top 20 and your rank; it re-scores the caller (and up to six other coaches) only when a matchday
// has resolved since their last score (stamp = resolved days), so reads stay cheap. Rows older than 8 weeks are pruned now and then.
import { weekIndex, proWeek, openDay, daysDone, scorePicks } from '../src/franchise/pro.js';

export const PRO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pro_picks (week INTEGER, player TEXT, day INTEGER, picks TEXT, created INTEGER, PRIMARY KEY (week, player, day))`,
  `CREATE TABLE IF NOT EXISTS pro_scores (week INTEGER, player TEXT, name TEXT, pts INTEGER DEFAULT 0, right_n INTEGER DEFAULT 0, made INTEGER DEFAULT 0, stamp INTEGER DEFAULT 0, updated INTEGER, PRIMARY KEY (week, player))`,
  `CREATE INDEX IF NOT EXISTS pro_board ON pro_scores (week, pts DESC)`,
  `CREATE INDEX IF NOT EXISTS pro_stale ON pro_scores (week, stamp)`,
];
export const PRO_TABLES = ['pro_picks', 'pro_scores'];

export function proApi(H) {
  const { json, bad, body, auth, limited, slow } = H;
  async function rescore(db, w, me, now) {
    const rows = (await db.prepare('SELECT day, picks FROM pro_picks WHERE week = ? AND player = ?').bind(w, me.id).all()).results || [];
    const picks = {}; for (const r of rows) { try { picks[r.day] = JSON.parse(r.picks); } catch { /* skip */ } }
    const s = scorePicks(w, picks, now), stamp = daysDone(w, now);
    await db.prepare(`INSERT INTO pro_scores (week, player, name, pts, right_n, made, stamp, updated) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (week, player) DO UPDATE SET name = excluded.name, pts = excluded.pts, right_n = excluded.right_n, made = excluded.made, stamp = excluded.stamp, updated = excluded.updated`)
      .bind(w, me.id, me.name, s.pts, s.right, s.made, stamp, now).run();
    return { ...s, stamp };
  }
  async function route(req, env, db, url, p, M, now) {
    if (p === '/api/pro/picks' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('sign in first', 401);
      if (limited('pro:' + me.id, 12)) return slow();
      const b = await body(req), w = b.w | 0, day = b.day | 0;
      if (w !== weekIndex(now)) return bad('that week is not open');
      const L = proWeek(w), dd = openDay(L, now);
      if (!dd || dd.day !== day) return bad('that matchday is locked');
      const picks = Array.isArray(b.picks) ? b.picks.slice(0, dd.matches.length).map((x) => (x === 0 || x === 1 ? x : -1)) : null;
      if (!picks || picks.length !== dd.matches.length || !picks.some((x) => x >= 0)) return bad('no picks');
      const r = await db.prepare('INSERT OR IGNORE INTO pro_picks (week, player, day, picks, created) VALUES (?,?,?,?,?)').bind(w, me.id, day, JSON.stringify(picks), now).run();
      if (!(r.meta && r.meta.changes)) return bad('already locked in', 409);
      const s = await rescore(db, w, me, now);
      if (Math.random() < 0.02) await db.batch([db.prepare('DELETE FROM pro_picks WHERE week < ?').bind(w - 8), db.prepare('DELETE FROM pro_scores WHERE week < ?').bind(w - 8)]);
      return json({ ok: true, ...s });
    }
    if (p === '/api/pro' && M === 'GET') {
      if (limited('proget:' + ip(req), 30)) return slow();
      const w = Math.min(weekIndex(now), +url.searchParams.get('w') | 0 || weekIndex(now));
      const me = await auth(req, db);
      let mine = null;
      if (me) {
        mine = await db.prepare('SELECT pts, right_n, made, stamp FROM pro_scores WHERE week = ? AND player = ?').bind(w, me.id).first();
        if (mine && mine.stamp < daysDone(w, now)) { const s = await rescore(db, w, me, now); mine = { pts: s.pts, right_n: s.right, made: s.made }; }
      }
      // lazy catch-up: every read re-scores a few coaches who have not been scored since the last matchday resolved
      const stale = (await db.prepare('SELECT player AS id, name FROM pro_scores WHERE week = ? AND stamp < ? LIMIT 6').bind(w, daysDone(w, now)).all()).results || [];
      for (const r of stale) await rescore(db, w, r, now);
      const top = ((await db.prepare('SELECT player, name, pts, right_n, made FROM pro_scores WHERE week = ? ORDER BY pts DESC, updated ASC LIMIT 20').bind(w).all()).results || [])
        .map((r) => ({ id: r.player, name: r.name, pts: r.pts, right: r.right_n, made: r.made }));
      let rank = null;
      if (mine) rank = 1 + ((await db.prepare('SELECT COUNT(*) AS n FROM pro_scores WHERE week = ? AND pts > ?').bind(w, mine.pts).first()) || { n: 0 }).n;
      return json({ w, top, me: mine ? { pts: mine.pts, right: mine.right_n, made: mine.made, rank } : null });
    }
    return null;
  }
  const ip = (req) => req.headers.get('cf-connecting-ip') || 'local';
  return { route };
}
