// Weekly Divisions: groups of 30 coaches per league, one UTC week at a time (rules: src/data/divisions.js).
//
// Lazy and cheap: there is no cron and nothing is written until a coach reports their first match of the week.
// Joining computes last week's finish from that group's stored points (+ the seeded AI seats the game shows),
// moves the coach up or down a league, and seats them in the newest group of that league with room (groups
// fill in join order). Every later match is one conditional UPDATE. Reading the group is one indexed query of
// at most 30 rows. Rows older than four weeks are swept now and then.
//
// Points come from the coach's own client (matches vs the AI cannot be verified), so the server bounds them:
// it computes the points itself from (won, calls) with the per-match cap, accepts at most one match per
// MIN_GAP and MAX_GAMES a week. Divisions give cosmetics and pass XP only, never rating.
import { GROUP, LEAGUES, weekOf, weekStart, WEEK_MS, matchPts, finalPlace, moveOf } from '../src/data/divisions.js';

export const DIV_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS div_members (week INTEGER, player TEXT, league INTEGER, grp INTEGER, name TEXT, pts INTEGER DEFAULT 0, g INTEGER DEFAULT 0, at INTEGER,
    last_place INTEGER, last_move INTEGER, last_league INTEGER, PRIMARY KEY (week, player))`,
  `CREATE INDEX IF NOT EXISTS div_group ON div_members (week, league, grp)`,
  `CREATE INDEX IF NOT EXISTS div_me ON div_members (player, week)`,
];
export const DIV_TABLES = ['div_members'];
export const MIN_GAP = 150000, MAX_GAMES = 100, KEEP_WEEKS = 4;

export function divApi(H) {
  const { json, bad, body, auth, limited, slow } = H;
  // Last week's finish and this week's league for a coach who has not joined this week yet.
  async function standing(db, me, w) {
    const prev = await db.prepare('SELECT week, league, grp, pts, g FROM div_members WHERE player = ? AND week < ? ORDER BY week DESC LIMIT 1').bind(me, w).first();
    if (!prev) return { league: 0, last: null };
    if (prev.week !== w - 1 || !prev.g) return { league: prev.league, last: null }; // a week off keeps the league
    const rows = (await db.prepare('SELECT player, pts FROM div_members WHERE week = ? AND league = ? AND grp = ?').bind(prev.week, prev.league, prev.grp).all()).results || [];
    const place = finalPlace(prev.week, prev.league, prev.grp, prev.pts, rows.filter((r) => r.player !== me).map((r) => r.pts));
    const move = moveOf(place, prev.league);
    return { league: Math.max(0, Math.min(LEAGUES.length - 1, prev.league + move)), last: { week: prev.week, place, move, league: prev.league } };
  }
  async function view(db, me, w, row) {
    const rows = (await db.prepare('SELECT player, name, pts, g FROM div_members WHERE week = ? AND league = ? AND grp = ? ORDER BY pts DESC LIMIT ?').bind(w, row.league, row.grp, GROUP).all()).results || [];
    return { week: w, ends: weekStart(w) + WEEK_MS, joined: true, league: row.league, grp: row.grp,
      last: row.last_place ? { week: w - 1, place: row.last_place, move: row.last_move, league: row.last_league } : null,
      members: rows.map((r) => ({ name: r.name, pts: r.pts, g: r.g, ...(r.player === me ? { me: true } : {}) })) };
  }
  return async function route(req, env, db, url, p, M, now) {
    if (p !== '/api/div' && p !== '/api/div/report') return null;
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('div:' + me.id, 20)) return slow();
    const w = weekOf(now);
    let row = await db.prepare('SELECT * FROM div_members WHERE week = ? AND player = ?').bind(w, me.id).first();
    if (p === '/api/div' && M === 'GET') {
      if (row) return json(await view(db, me.id, w, row));
      const st = await standing(db, me.id, w);
      return json({ week: w, ends: weekStart(w) + WEEK_MS, joined: false, league: st.league, last: st.last, members: [] });
    }
    if (p === '/api/div/report' && M === 'POST') {
      const b = await body(req);
      const pts = matchPts(!!b.won, Math.min(9, Math.max(0, Number(b.calls) | 0)));
      if (row) {
        const r = await db.prepare('UPDATE div_members SET pts = pts + ?, g = g + 1, at = ?, name = ? WHERE week = ? AND player = ? AND at <= ? AND g < ?')
          .bind(pts, now, me.name, w, me.id, now - MIN_GAP, MAX_GAMES).run();
        const ok = !!(r.meta && r.meta.changes);
        if (ok && H.onPoints) await db.batch(H.onPoints(db, me.id, pts, !!b.won, now)); // club points (worker/clubs.js)
        row = await db.prepare('SELECT * FROM div_members WHERE week = ? AND player = ?').bind(w, me.id).first();
        return json({ ok, ...(await view(db, me.id, w, row)) });
      }
      // first match of the week: settle last week, then take a seat in this week's league
      const st = await standing(db, me.id, w);
      const top = await db.prepare('SELECT grp, COUNT(*) AS n FROM div_members WHERE week = ? AND league = ? GROUP BY grp ORDER BY grp DESC LIMIT 1').bind(w, st.league).first();
      const grp = top ? (top.n < GROUP ? top.grp : top.grp + 1) : 0;
      const stmts = [db.prepare(`INSERT OR IGNORE INTO div_members (week, player, league, grp, name, pts, g, at, last_place, last_move, last_league) VALUES (?,?,?,?,?,?,1,?,?,?,?)`)
        .bind(w, me.id, st.league, grp, me.name, pts, now, st.last ? st.last.place : null, st.last ? st.last.move : null, st.last ? st.last.league : null)];
      if (now % 32 === 0) stmts.push(db.prepare('DELETE FROM div_members WHERE week < ?').bind(w - KEEP_WEEKS));
      if (H.onPoints) stmts.push(...H.onPoints(db, me.id, pts, !!b.won, now)); // club points (worker/clubs.js)
      await db.batch(stmts);
      row = await db.prepare('SELECT * FROM div_members WHERE week = ? AND player = ?').bind(w, me.id).first();
      return json({ ok: true, ...(await view(db, me.id, w, row)) });
    }
    return bad('not found', 404);
  };
}
