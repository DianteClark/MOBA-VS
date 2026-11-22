// Public Replay Hub: coaches publish a replay from their results; everyone can watch and upvote (one vote per
// account). The week's top replays are listed, and the best one is the Home screen's small "Featured" card.
//
// Storage reuses the share links: a published replay is a `shares` row (kind 'replay', the usual /s/CODE link)
// plus a small `hub` row (meta for the list, vote count). Replays are size-capped (HUB_MAX), each coach can
// publish HUB_DAY a day, and entries older than KEEP_DAYS go (with their share rows and votes) in an occasional
// sweep on publish. Listing is one indexed query (week, votes) plus one for your own votes.
import { weekOf } from '../src/data/divisions.js';

export const HUB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hub (code TEXT PRIMARY KEY, author TEXT, name TEXT, week INTEGER, created INTEGER, votes INTEGER DEFAULT 0, meta TEXT)`,
  `CREATE INDEX IF NOT EXISTS hub_week ON hub (week, votes DESC)`,
  `CREATE INDEX IF NOT EXISTS hub_author ON hub (author, created)`,
  `CREATE TABLE IF NOT EXISTS hub_votes (code TEXT, player TEXT, PRIMARY KEY (code, player))`,
];
export const HUB_TABLES = ['hub', 'hub_votes'];
export const HUB_MAX = 96 * 1024, HUB_DAY = 3, KEEP_DAYS = 28, LIST = 20;

const HID = /^[a-z0-9_]{1,20}$/;
const num = (v, lo = 0, hi = 1e6) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const str = (v, n) => String(v || '').replace(/[^\p{L}\p{N} _.,!?'·:-]/gu, '').trim().slice(0, n);
// A replay worth storing: a match config with two teams of five known-looking heroes and a command log.
function cleanReplay(r) {
  if (!r || typeof r !== 'object' || !r.cfg || typeof r.cfg !== 'object' || !Array.isArray(r.log)) return null;
  const c = r.cfg;
  if (!Number.isInteger(r.v) || !Number.isInteger(c.seed) || typeof c.map !== 'string' || !Array.isArray(c.teams) || c.teams.length !== 2) return null;
  if (c.teams.some((t) => !t || !Array.isArray(t.heroes) || t.heroes.length !== 5 || t.heroes.some((x) => !x || !HID.test(String(x.id))))) return null;
  return { v: r.v, cfg: c, log: r.log, names: Array.isArray(r.names) ? r.names.slice(0, 2).map((n) => str(n, 16)) : ['Blue', 'Red'], mapId: str(r.mapId || c.map, 20),
    winner: r.winner === 1 ? 1 : r.winner === 0 ? 0 : -1, skins: Array.isArray(r.skins) ? r.skins.slice(0, 2) : undefined, len: num(r.len, 0, 3600), myTeam: -1 };
}
export function metaOf(rep, m = {}) {
  return { names: rep.names, map: rep.mapId, len: rep.len, winner: rep.winner, picks: rep.cfg.teams.map((t) => t.heroes.map((x) => x.id)),
    kills: Array.isArray(m.kills) ? m.kills.slice(0, 2).map((k) => num(k, 0, 999)) : [0, 0], title: str(m.title, 48) || null, potg: str(m.potg, 48) || null,
    ev: typeof rep.cfg.event === 'string' ? str(rep.cfg.event, 16) : null, custom: !!rep.cfg.custom, mode: rep.cfg.mode === 'rush' ? 'rush' : 'classic', v: rep.v };
}
const row = (r, voted) => { let meta = null; try { meta = JSON.parse(r.meta); } catch { meta = null; } return { code: r.code, author: { id: r.author, name: r.name }, week: r.week, created: r.created, votes: r.votes, meta, voted: !!voted }; };

export function hubApi(H) {
  const { json, bad, body, auth, limited, slow, rand, ip } = H;
  return async function route(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/hub')) return null;
    if (p === '/api/hub' && M === 'GET') {
      const who = await auth(req, db);
      if (limited('hb:' + (who ? who.id : ip(req)), 40)) return slow();
      const w = weekOf(now), fresh = url.searchParams.get('list') === 'new';
      const [top, last, recent] = await db.batch([
        db.prepare(`SELECT * FROM hub WHERE week = ? ORDER BY votes DESC, created DESC LIMIT ${LIST}`).bind(w),
        db.prepare('SELECT * FROM hub WHERE week = ? ORDER BY votes DESC, created DESC LIMIT 1').bind(w - 1),
        fresh ? db.prepare(`SELECT * FROM hub WHERE created > ? ORDER BY created DESC LIMIT ${LIST}`).bind(now - KEEP_DAYS * 86400000) : db.prepare('SELECT 1 WHERE 0'),
      ]);
      const list = fresh ? recent.results || [] : top.results || [];
      const first = (top.results || [])[0];
      const feat = first && first.votes > 0 ? first : (last.results || [])[0] || first || null;
      let mine = new Set();
      const codes = [...new Set([...list.map((r) => r.code), ...(feat ? [feat.code] : [])])];
      if (who && codes.length) mine = new Set(((await db.prepare(`SELECT code FROM hub_votes WHERE player = ? AND code IN (${codes.map(() => '?').join(',')})`).bind(who.id, ...codes).all()).results || []).map((r) => r.code));
      return json({ week: w, list: list.map((r) => row(r, mine.has(r.code))), featured: feat ? row(feat, mine.has(feat.code)) : null });
    }
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (p === '/api/hub/publish' && M === 'POST') {
      if (limited('hp:' + me.id, 6)) return slow();
      const b = await body(req), rep = cleanReplay(b.replay);
      if (!rep) return bad('That replay cannot be published');
      const data = JSON.stringify({ replay: rep });
      if (data.length > HUB_MAX) return bad('This replay is too long to publish', 413);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM hub WHERE author = ? AND created > ?').bind(me.id, now - 86400000).first();
      if (n && n.n >= HUB_DAY) return bad(`You can publish ${HUB_DAY} replays a day`, 429);
      let code = rand(7);
      for (let i = 0; i < 3 && await db.prepare('SELECT 1 FROM shares WHERE code = ?').bind(code).first(); i++) code = rand(7);
      const old = now - KEEP_DAYS * 86400000;
      const st = [db.prepare('INSERT INTO shares (code, kind, data, created) VALUES (?,?,?,?)').bind(code, 'replay', data, now),
        db.prepare('INSERT INTO hub (code, author, name, week, created, votes, meta) VALUES (?,?,?,?,?,0,?)').bind(code, me.id, me.name, weekOf(now), now, JSON.stringify(metaOf(rep, b.meta || {})))];
      if (code.charCodeAt(1) % 8 === 0) st.push( // occasional sweep: old hub replays, their share rows and votes
        db.prepare('DELETE FROM shares WHERE code IN (SELECT code FROM hub WHERE created < ?)').bind(old),
        db.prepare('DELETE FROM hub_votes WHERE code IN (SELECT code FROM hub WHERE created < ?)').bind(old),
        db.prepare('DELETE FROM hub WHERE created < ?').bind(old));
      await db.batch(st);
      return json({ code, url: `${url.origin}/s/${code}` });
    }
    if (p === '/api/hub/vote' && M === 'POST') {
      if (limited('hv:' + me.id, 30)) return slow();
      const b = await body(req), code = String(b.code || '');
      if (!/^[A-Z0-9]{7}$/.test(code)) return bad('bad replay');
      const r = await db.prepare('SELECT author, votes FROM hub WHERE code = ?').bind(code).first();
      if (!r) return bad('That replay is gone', 404);
      if (r.author === me.id) return bad('You cannot vote for your own replay');
      const ins = await db.prepare('INSERT OR IGNORE INTO hub_votes (code, player) VALUES (?,?)').bind(code, me.id).run();
      const added = !!(ins.meta && ins.meta.changes);
      if (added) await db.prepare('UPDATE hub SET votes = votes + 1 WHERE code = ?').bind(code).run();
      return json({ code, votes: r.votes + (added ? 1 : 0), voted: true });
    }
    return bad('not found', 404);
  };
}
// The highlight reel on a public profile: a coach's newest published replays.
export const reelStmt = (db, player) => db.prepare('SELECT code, votes, created, meta FROM hub WHERE author = ? ORDER BY created DESC LIMIT 6').bind(player);
export const reelRow = (r) => { let m = null; try { m = JSON.parse(r.meta); } catch { m = null; } return { code: r.code, votes: r.votes, created: r.created, title: m && (m.title || m.potg), picks: m && m.picks, winner: m && m.winner, names: m && m.names, len: m && m.len }; };
