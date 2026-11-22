// Clubs (rules: src/data/clubs.js): up to 30 coaches, owner / officers / members, a 5-letter club code (also sent
// through the friends invite system as mode 'club'), preset-only chat, a weekly club ladder, weekend Club Wars and
// weekly goals.
//
// Cheap by design (Cloudflare free plan):
//  * Points ride on the Weekly Divisions report (worker/divisions.js calls onPoints when it accepts a match), so a
//    match costs no extra request: two indexed writes that touch nothing when the coach has no club.
//  * The club page is two batched round trips (club + members/chat/week/war), polled only while it is open.
//  * Wars are paired by the daily cron (Saturday and Sunday: active clubs by weekly points, neighbours meet) and
//    settled by Monday's run. Nothing else runs on a schedule.
//  * Chat keeps the newest 40 lines per club (pruned now and then), and every write is rate limited.
import { MAX_MEMBERS, ROLE_RANK, CHAT, CODE_RE, weekOf, warOpen, warEnd, cleanCrest, cleanClubName, cleanTag, clubPts } from '../src/data/clubs.js';

export const CLUB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS clubs (id TEXT PRIMARY KEY, name TEXT, tag TEXT, crest TEXT, owner TEXT, code TEXT, members INTEGER DEFAULT 1, wars INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clubs_code ON clubs (code)`,
  `CREATE TABLE IF NOT EXISTS club_members (player TEXT PRIMARY KEY, club TEXT, role TEXT, joined INTEGER, wk INTEGER DEFAULT -1, wpts INTEGER DEFAULT 0, wg INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS club_m ON club_members (club)`,
  `CREATE TABLE IF NOT EXISTS club_week (club TEXT, week INTEGER, pts INTEGER DEFAULT 0, g INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, war INTEGER DEFAULT 0, PRIMARY KEY (club, week))`,
  `CREATE INDEX IF NOT EXISTS club_week_rank ON club_week (week, pts DESC)`,
  `CREATE TABLE IF NOT EXISTS club_chat (club TEXT, at INTEGER, player TEXT, line INTEGER)`,
  `CREATE INDEX IF NOT EXISTS club_chat_at ON club_chat (club, at)`,
  `CREATE TABLE IF NOT EXISTS club_wars (week INTEGER, a TEXT, b TEXT, win TEXT, PRIMARY KEY (week, a))`,
  `CREATE INDEX IF NOT EXISTS club_wars_b ON club_wars (week, b)`,
];
export const CLUB_TABLES = ['clubs', 'club_members', 'club_week', 'club_chat', 'club_wars'];
export const CHAT_KEEP = 40, LADDER = 50, PAIR_MAX = 400;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code5 = () => { const b = crypto.getRandomValues(new Uint8Array(5)); let s = ''; for (const x of b) s += LETTERS[x % LETTERS.length]; return s; };

// Statements for one accepted match (called by worker/divisions.js inside the same request).
export function clubPointStmts(db, player, pts, won, now) {
  const w = weekOf(now), war = warOpen(now) ? pts : 0;
  return [
    db.prepare('UPDATE club_members SET wpts = CASE WHEN wk = ? THEN wpts + ? ELSE ? END, wg = CASE WHEN wk = ? THEN wg + 1 ELSE 1 END, wk = ? WHERE player = ?').bind(w, pts, pts, w, w, player),
    db.prepare(`INSERT INTO club_week (club, week, pts, g, wins, war) SELECT club, ?, ?, 1, ?, ? FROM club_members WHERE player = ?
      ON CONFLICT(club, week) DO UPDATE SET pts = pts + excluded.pts, g = g + 1, wins = wins + excluded.wins, war = war + excluded.war`).bind(w, pts, won ? 1 : 0, war, player),
  ];
}
export { clubPts };

// Daily cron: Saturday / Sunday pair this week's active clubs that have no opponent yet; Monday settles last weekend.
export async function clubCron(db, now) {
  const day = new Date(now).getUTCDay(), w = weekOf(now);
  if (day === 6 || day === 0) {
    const rows = (await db.prepare(`SELECT k.club FROM club_week k WHERE k.week = ? AND k.g > 0
      AND NOT EXISTS (SELECT 1 FROM club_wars x WHERE x.week = k.week AND (x.a = k.club OR x.b = k.club)) ORDER BY k.pts DESC LIMIT ${PAIR_MAX}`).bind(w).all()).results || [];
    const st = [];
    for (let i = 0; i + 1 < rows.length; i += 2) st.push(db.prepare('INSERT OR IGNORE INTO club_wars (week, a, b) VALUES (?,?,?)').bind(w, rows[i].club, rows[i + 1].club));
    if (st.length) await db.batch(st);
    return { paired: st.length };
  }
  if (day === 1) {
    const lw = w - 1;
    const wars = (await db.prepare(`SELECT x.a, x.b, COALESCE(ka.war, 0) AS sa, COALESCE(kb.war, 0) AS sb FROM club_wars x LEFT JOIN club_week ka ON ka.club = x.a AND ka.week = x.week
      LEFT JOIN club_week kb ON kb.club = x.b AND kb.week = x.week WHERE x.week = ? AND x.win IS NULL LIMIT ${PAIR_MAX}`).bind(lw).all()).results || [];
    const st = [];
    for (const r of wars) {
      const win = r.sa > r.sb ? r.a : r.sb > r.sa ? r.b : '-'; // '-' a draw
      st.push(db.prepare('UPDATE club_wars SET win = ? WHERE week = ? AND a = ?').bind(win, lw, r.a));
      if (win !== '-') st.push(db.prepare('UPDATE clubs SET wars = wars + 1 WHERE id = ?').bind(win));
    }
    st.push(db.prepare('DELETE FROM club_week WHERE week < ?').bind(w - 6), db.prepare('DELETE FROM club_wars WHERE week < ?').bind(w - 6));
    await db.batch(st);
    return { settled: wars.length };
  }
  return null;
}

export function clubApi(H) {
  const { json, bad, body, auth, limited, slow } = H;
  const clubRow = (c) => (c ? { id: c.id, name: c.name, tag: c.tag, crest: c.crest, members: c.members, wars: c.wars || 0 } : null);
  // The whole club page for a member: club, members (with presence), chat, this week, the weekend war, last war.
  async function view(db, me, now) {
    const mine = await db.prepare('SELECT m.role, c.* FROM club_members m JOIN clubs c ON c.id = m.club WHERE m.player = ?').bind(me.id).first();
    if (!mine) return { club: null, week: weekOf(now) };
    const w = weekOf(now), id = mine.id;
    const [mem, chat, wk, war, last] = await db.batch([
      db.prepare(`SELECT m.player, p.name, p.seen, p.status, p.elo, m.role, m.joined, CASE WHEN m.wk = ? THEN m.wpts ELSE 0 END AS pts, CASE WHEN m.wk = ? THEN m.wg ELSE 0 END AS g
        FROM club_members m JOIN players p ON p.id = m.player WHERE m.club = ? LIMIT ${MAX_MEMBERS + 5}`).bind(w, w, id),
      db.prepare('SELECT c.at, c.player, p.name, c.line FROM club_chat c LEFT JOIN players p ON p.id = c.player WHERE c.club = ? ORDER BY c.at DESC LIMIT 25').bind(id),
      db.prepare('SELECT pts, g, wins, war, (SELECT COUNT(*) FROM club_week o WHERE o.week = k.week AND o.pts > k.pts) AS above FROM club_week k WHERE k.club = ? AND k.week = ?').bind(id, w),
      db.prepare(`SELECT x.a, x.b, c.id, c.name, c.tag, c.crest, c.members, COALESCE(o.war, 0) AS theirs FROM club_wars x JOIN clubs c ON c.id = CASE WHEN x.a = ? THEN x.b ELSE x.a END
        LEFT JOIN club_week o ON o.club = c.id AND o.week = x.week WHERE x.week = ? AND (x.a = ? OR x.b = ?)`).bind(id, w, id, id),
      db.prepare(`SELECT x.win, c.name, c.tag FROM club_wars x JOIN clubs c ON c.id = CASE WHEN x.a = ? THEN x.b ELSE x.a END WHERE x.week = ? AND (x.a = ? OR x.b = ?)`).bind(id, w - 1, id, id),
    ]);
    const k = (wk.results || [])[0] || { pts: 0, g: 0, wins: 0, war: 0, above: null };
    const wr = (war.results || [])[0], lr = (last.results || [])[0];
    const presence = (r) => (r.status === 'match' && now - (r.seen || 0) < 25 * 60000 ? 'match' : now - (r.seen || 0) < 120000 ? 'online' : 'offline');
    return {
      week: w, warOpen: warOpen(now), warEnds: warEnd(w) - now, role: mine.role,
      club: { ...clubRow(mine), code: mine.code, owner: mine.owner },
      members: (mem.results || []).map((r) => ({ id: r.player, name: r.name, elo: r.elo, role: r.role, joined: r.joined, pts: r.pts, g: r.g, presence: presence(r) }))
        .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.pts - a.pts),
      chat: (chat.results || []).map((r) => ({ at: r.at, id: r.player, name: r.name || 'Coach', line: r.line })).reverse(),
      stats: { pts: k.pts, g: k.g, wins: k.wins, war: k.war, rank: k.above === null || k.above === undefined ? null : k.above + 1 },
      war: wr ? { opp: clubRow(wr), ours: k.war, theirs: wr.theirs } : null,
      lastWar: lr ? { opp: { name: lr.name, tag: lr.tag }, result: lr.win === null ? 'pending' : lr.win === '-' ? 'draw' : lr.win === id ? 'won' : 'lost' } : null,
    };
  }
  const recount = (db, id) => db.prepare('UPDATE clubs SET members = (SELECT COUNT(*) FROM club_members WHERE club = ?) WHERE id = ?').bind(id, id);

  return async function route(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/club')) return null;
    // public preview by code (the join screen, invite cards)
    const cm = p.match(/^\/api\/club\/code\/([A-Z]{5})$/);
    if (cm && M === 'GET') {
      const who = await auth(req, db);
      if (limited('cc:' + (who ? who.id : H.ip(req)), 30)) return slow();
      const c = await db.prepare('SELECT * FROM clubs WHERE code = ?').bind(cm[1]).first();
      if (!c) return bad('No club has that code', 404);
      const k = await db.prepare('SELECT pts FROM club_week WHERE club = ? AND week = ?').bind(c.id, weekOf(now)).first();
      return json({ ...clubRow(c), code: c.code, pts: k ? k.pts : 0, full: c.members >= MAX_MEMBERS });
    }
    if (p === '/api/club/ladder' && M === 'GET') {
      const who = await auth(req, db);
      if (limited('cl:' + (who ? who.id : H.ip(req)), 30)) return slow();
      const w = weekOf(now);
      const stmts = [db.prepare(`SELECT k.club, k.pts, k.g, c.name, c.tag, c.crest, c.members, c.wars FROM club_week k JOIN clubs c ON c.id = k.club WHERE k.week = ? ORDER BY k.pts DESC LIMIT ${LADDER}`).bind(w)];
      if (who) stmts.push(db.prepare(`SELECT m.club, k.pts, (SELECT COUNT(*) FROM club_week o WHERE o.week = ? AND o.pts > COALESCE(k.pts, 0)) AS above
        FROM club_members m LEFT JOIN club_week k ON k.club = m.club AND k.week = ? WHERE m.player = ?`).bind(w, w, who.id));
      const [top, me] = await db.batch(stmts);
      const mine = me && (me.results || [])[0];
      return json({ week: w, top: (top.results || []).map((r, i) => ({ rank: i + 1, id: r.club, name: r.name, tag: r.tag, crest: r.crest, members: r.members, wars: r.wars, pts: r.pts, g: r.g })),
        me: mine ? { id: mine.club, pts: mine.pts || 0, rank: mine.above + 1 } : null });
    }
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (p === '/api/club' && M === 'GET') {
      if (limited('cv:' + me.id, 30)) return slow();
      return json(await view(db, me, now));
    }
    if (M !== 'POST') return bad('not found', 404);
    if (limited('cw:' + me.id, 20)) return slow();
    const b = await body(req);
    const mine = await db.prepare('SELECT m.role, m.club, c.owner, c.members FROM club_members m JOIN clubs c ON c.id = m.club WHERE m.player = ?').bind(me.id).first();
    if (p === '/api/club/create') {
      if (mine) return bad('Leave your club first');
      const name = cleanClubName(b.name), tag = cleanTag(b.tag);
      if (name.length < 3) return bad('Club names need at least 3 letters');
      if (tag.length < 2) return bad('Tags are 2-4 letters or digits');
      const id = 'C' + code5() + code5().slice(0, 4);
      let code = code5();
      for (let i = 0; i < 3 && await db.prepare('SELECT 1 FROM clubs WHERE code = ?').bind(code).first(); i++) code = code5();
      await db.batch([
        db.prepare('INSERT INTO clubs (id, name, tag, crest, owner, code, members, wars, created) VALUES (?,?,?,?,?,?,1,0,?)').bind(id, name, tag, cleanCrest(b.crest), me.id, code, now),
        db.prepare("INSERT INTO club_members (player, club, role, joined) VALUES (?, ?, 'owner', ?)").bind(me.id, id, now),
      ]);
      return json(await view(db, me, now));
    }
    if (p === '/api/club/join') {
      const code = String(b.code || '').toUpperCase();
      if (!CODE_RE.test(code)) return bad('Club codes are 5 letters');
      if (mine) return bad('Leave your club first');
      const c = await db.prepare('SELECT id, members FROM clubs WHERE code = ?').bind(code).first();
      if (!c) return bad('No club has that code', 404);
      if (c.members >= MAX_MEMBERS) return bad(`That club is full (${MAX_MEMBERS})`);
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO club_members (player, club, role, joined) SELECT ?, id, 'member', ? FROM clubs WHERE id = ? AND members < ${MAX_MEMBERS}`).bind(me.id, now, c.id),
        recount(db, c.id),
      ]);
      return json(await view(db, me, now));
    }
    if (!mine) return bad('You are not in a club', 404);
    const id = mine.club;
    if (p === '/api/club/leave') {
      const st = [db.prepare('DELETE FROM club_members WHERE player = ?').bind(me.id)];
      if (mine.role === 'owner') {
        const heir = await db.prepare(`SELECT player FROM club_members WHERE club = ? AND player != ? ORDER BY CASE role WHEN 'officer' THEN 0 ELSE 1 END, joined LIMIT 1`).bind(id, me.id).first();
        if (heir) st.push(db.prepare("UPDATE club_members SET role = 'owner' WHERE player = ?").bind(heir.player), db.prepare('UPDATE clubs SET owner = ? WHERE id = ?').bind(heir.player, id));
        else st.push(db.prepare('DELETE FROM clubs WHERE id = ?').bind(id), db.prepare('DELETE FROM club_chat WHERE club = ?').bind(id));
      }
      st.push(recount(db, id));
      await db.batch(st);
      return json({ club: null, week: weekOf(now) });
    }
    if (p === '/api/club/chat') {
      const line = Number(b.line);
      if (!Number.isInteger(line) || line < 0 || line >= CHAT.length) return bad('bad line');
      if (limited('ch:' + me.id, 6)) return slow();
      const st = [db.prepare('INSERT INTO club_chat (club, at, player, line) VALUES (?,?,?,?)').bind(id, now, me.id, line)];
      if (now % 8 === 0) st.push(db.prepare(`DELETE FROM club_chat WHERE club = ? AND at < COALESCE((SELECT at FROM club_chat WHERE club = ? ORDER BY at DESC LIMIT 1 OFFSET ${CHAT_KEEP}), 0)`).bind(id, id));
      await db.batch(st);
      return json(await view(db, me, now));
    }
    if (p === '/api/club/edit') {
      if (ROLE_RANK[mine.role] < 1) return bad('Only the owner and officers can do that', 403);
      if (b.newCode) {
        let code = code5();
        for (let i = 0; i < 3 && await db.prepare('SELECT 1 FROM clubs WHERE code = ?').bind(code).first(); i++) code = code5();
        await db.prepare('UPDATE clubs SET code = ? WHERE id = ?').bind(code, id).run();
      }
      if (b.crest !== undefined) await db.prepare('UPDATE clubs SET crest = ? WHERE id = ?').bind(cleanCrest(b.crest), id).run();
      return json(await view(db, me, now));
    }
    if (p === '/api/club/member') {
      const other = String(b.id || ''), act = b.action;
      if (!/^[A-Z0-9]{10}$/.test(other) || other === me.id) return bad('bad member');
      const them = await db.prepare('SELECT role FROM club_members WHERE player = ? AND club = ?').bind(other, id).first();
      if (!them) return bad('Not in your club', 404);
      const owner = mine.role === 'owner';
      if (act === 'kick') {
        if (!(owner || (mine.role === 'officer' && them.role === 'member'))) return bad('You cannot remove this coach', 403);
        await db.batch([db.prepare('DELETE FROM club_members WHERE player = ?').bind(other), recount(db, id)]);
      } else if (act === 'promote' || act === 'demote') {
        if (!owner) return bad('Only the owner can change roles', 403);
        await db.prepare('UPDATE club_members SET role = ? WHERE player = ?').bind(act === 'promote' ? 'officer' : 'member', other).run();
      } else if (act === 'owner') {
        if (!owner) return bad('Only the owner can hand the club over', 403);
        await db.batch([db.prepare("UPDATE club_members SET role = 'owner' WHERE player = ?").bind(other), db.prepare("UPDATE club_members SET role = 'officer' WHERE player = ?").bind(me.id),
          db.prepare('UPDATE clubs SET owner = ? WHERE id = ?').bind(other, id)]);
      } else return bad('bad action');
      return json(await view(db, me, now));
    }
    return bad('not found', 404);
  };
}
// The club line on a public profile.
export const clubOfStmt = (db, player) => db.prepare('SELECT c.name, c.tag, c.crest, c.wars, m.role FROM club_members m JOIN clubs c ON c.id = m.club WHERE m.player = ?').bind(player);
