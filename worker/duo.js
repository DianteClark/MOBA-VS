// 2v2 matchmaking (queue mode `coop2v2`): four real coaches, two a side, never bots.
//
// A ticket is a party of 1 or 2 coaches (the leader polls for both; `members` is the partner's id).
// Every poll first tries to complete a match that includes the poller's own ticket: the oldest waiting
// tickets of the same version whose sizes add up to four (2+2, 2+1+1 or 1+1+1+1). A party of two always
// plays on one side; two solo coaches are paired into a side. The leader of the oldest ticket hosts the
// 4-peer co-op room (src/coop-room.js) under a fresh room code; every ticket of the match gets the same
// `info` { code, host, teams: { playerId: team } } and its leader reads it on the next poll.
// Claiming is one UPDATE … WHERE status = 'waiting' … RETURNING: if another poll took one of the tickets
// first, the ones this poll did take are put back. Casual only: no ladder, no report, no replay upload.
// Cost: one cleanup DELETE + 2–3 small indexed statements per poll (3 s apart, 60 s at most per search).
export const DUO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS duo_queue (id TEXT PRIMARY KEY, leader TEXT, members TEXT, size INTEGER, version INTEGER, status TEXT, info TEXT, created INTEGER, seen INTEGER)`,
  `CREATE INDEX IF NOT EXISTS duo_wait ON duo_queue (status, version, created)`,
  `CREATE INDEX IF NOT EXISTS duo_leader ON duo_queue (leader)`,
];
export const DUO_TABLES = ['duo_queue'];
export const DUO_MODE = 'coop2v2';
const STALE = 15000, MAX_AGE = 180000, POOL = 12;

const playersOf = (t) => [t.leader, ...JSON.parse(t.members || '[]')];
// Pick tickets (oldest first) whose sizes add up to `need`, no coach twice (a party mate may also have a
// solo ticket of their own): a tiny depth-first search over at most POOL rows. taken: coaches already in.
export function pickTickets(rows, need, taken = []) {
  const out = [], used = new Set(taken);
  const dfs = (i, left) => {
    if (left === 0) return true;
    for (let k = i; k < rows.length; k++) {
      const ps = playersOf(rows[k]);
      if (rows[k].size > left || ps.some((x) => used.has(x))) continue;
      out.push(rows[k]); ps.forEach((x) => used.add(x));
      if (dfs(k + 1, left - rows[k].size)) return true;
      out.pop(); ps.forEach((x) => used.delete(x));
    }
    return false;
  };
  return dfs(0, need) ? out.slice() : null;
}
// Sides: parties of two first (each fills a side), then solo coaches in queue order.
export function sidesOf(tickets) {
  const order = [...tickets].sort((a, b) => b.size - a.size || a.created - b.created), teams = {};
  let n = 0;
  for (const t of order) for (const pid of playersOf(t)) teams[pid] = n++ < 2 ? 0 : 1;
  return teams;
}

export function duoApi({ json, bad, body, auth, rand, limited, slow, bumpStmts, dayOf }) {
  const view = (row, me) => { const info = JSON.parse(row.info); return { status: 'matched', role: info.host === me ? 'host' : 'join', code: info.code, host: info.host, teams: info.teams }; };
  return async function route(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/queue2/')) return null;
    if (p === '/api/queue2/find' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('q2:' + me.id, 40)) return slow();
      const b = await body(req);
      const version = Number(b.version) | 0, ticket = b.ticket ? String(b.ticket).slice(0, 16) : null;
      const mate = Array.isArray(b.party) && typeof b.party[0] === 'string' && /^[A-Z0-9]{10}$/.test(b.party[0]) && b.party[0] !== me.id ? b.party[0] : null;
      await db.prepare(`DELETE FROM duo_queue WHERE created < ? OR (status = 'waiting' AND seen < ?)`).bind(now - MAX_AGE, now - STALE).run();
      let mine;
      if (ticket) {
        mine = await db.prepare('SELECT * FROM duo_queue WHERE id = ? AND leader = ?').bind(ticket, me.id).first();
        if (!mine) return json({ status: 'expired' });
        if (mine.status === 'matched') return json(view(mine, me.id));
        await db.prepare('UPDATE duo_queue SET seen = ? WHERE id = ?').bind(now, ticket).run();
      } else {
        mine = { id: rand(12), leader: me.id, members: JSON.stringify(mate ? [mate] : []), size: mate ? 2 : 1, version, status: 'waiting', created: now, seen: now };
        // one search per coach: an older ticket of this leader is replaced
        await db.batch([db.prepare('DELETE FROM duo_queue WHERE leader = ?').bind(me.id),
          db.prepare(`INSERT INTO duo_queue (id, leader, members, size, version, status, created, seen) VALUES (?,?,?,?,?, 'waiting', ?, ?)`).bind(mine.id, me.id, mine.members, mine.size, version, now, now),
          ...bumpStmts(db, dayOf(now), { ['qs:' + DUO_MODE]: 1 })]);
      }
      const rows = ((await db.prepare(`SELECT id, leader, members, size, created FROM duo_queue WHERE status = 'waiting' AND version = ? AND seen >= ? AND id != ? ORDER BY created LIMIT ${POOL}`)
        .bind(mine.version, now - STALE, mine.id).all()).results || []);
      const pick = pickTickets(rows, 4 - mine.size, playersOf(mine));
      if (!pick) return json({ status: 'waiting', ticket: mine.id });
      const all = [mine, ...pick].sort((a, b) => a.created - b.created);
      const info = { code: rand(5).replace(/[^A-Z]/g, 'Q'), host: all[0].leader, teams: sidesOf(all) };
      const ids = all.map((t) => t.id), qs = ids.map(() => '?').join(',');
      const got = (await db.prepare(`UPDATE duo_queue SET status = 'matched', info = ? WHERE status = 'waiting' AND id IN (${qs}) RETURNING id`).bind(JSON.stringify(info), ...ids).all()).results || [];
      if (got.length !== ids.length) { // someone else completed a match with one of these tickets first: put ours back
        if (got.length) await db.prepare(`UPDATE duo_queue SET status = 'waiting', info = NULL WHERE id IN (${got.map(() => '?').join(',')})`).bind(...got.map((r) => r.id)).run();
        return json({ status: 'waiting', ticket: mine.id });
      }
      await db.batch(bumpStmts(db, dayOf(now), { ['qm:' + DUO_MODE]: 1, ['qw:' + DUO_MODE]: Math.max(0, Math.round((now - all[0].created) / 1000)) })); // one match, the longest wait
      return json({ ...view({ info: JSON.stringify(info) }, me.id), ticket: mine.id });
    }
    if (p === '/api/queue2/cancel' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      const b = await body(req);
      const gone = await db.prepare(`DELETE FROM duo_queue WHERE id = ? AND leader = ? RETURNING status`).bind(String(b.ticket || ''), me.id).first();
      if (gone && gone.status === 'waiting') await db.batch(bumpStmts(db, dayOf(now), { ['qc:' + DUO_MODE]: 1 }));
      return json({ ok: true });
    }
    return bad('not found', 404);
  };
}
