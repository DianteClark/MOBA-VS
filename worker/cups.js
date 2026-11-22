// Weekend Cups: 8-coach single-elimination brackets between real players (no bots).
//
// Sign-ups open Friday 00:00 to Sunday 24:00 UTC. "Join the next cup" puts you on the sign-up list of the
// open cup for your game version; the cup starts the moment 8 coaches are on it. A coach stays on the list
// only while their Cup screen is open (it polls every few seconds); a cup that does not fill within the
// sign-up window is called off with a clear message. Nothing is ever filled with bots.
//
// Bracket: seeded by rating (1v8, 4v5, 2v7, 3v6). Every match opens with a ready check: both coaches tap
// Ready within READY_MS, or the one who did wins by no-show (neither: both are out, and the next round's
// opponent gets a walkover). Matches are played over the normal PeerJS lockstep flow (the higher seed hosts
// the server-chosen room) and both clients report through /api/match/report with mode 'cup'. Agreeing
// reports decide the match; a single report decides it GRACE_MS after it lands (the other coach left); a
// dispute is replayed once, then the higher seed advances. Every decided cup match is also queued for
// replay verification (worker/anticheat.js), which can overturn it.
//
// There is no cron: the bracket advances lazily whenever a coach polls, readies or reports. Every state
// change is a conditional UPDATE (… WHERE status = old), so concurrent polls never double-apply.

export const CUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cups (id TEXT PRIMARY KEY, version INTEGER, status TEXT, created INTEGER, started INTEGER, ended INTEGER, winner TEXT, reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS cups_open ON cups (status, version, created)`,
  // place: 0 = still in / signed up, 1 champion, 2 finalist, 3 semifinal, 5 quarterfinal, -1 disqualified
  `CREATE TABLE IF NOT EXISTS cup_players (cup TEXT, player TEXT, name TEXT, seed INTEGER DEFAULT 0, rating INTEGER DEFAULT 1000, joined INTEGER, seen INTEGER, place INTEGER DEFAULT 0, PRIMARY KEY (cup, player))`,
  `CREATE INDEX IF NOT EXISTS cup_players_me ON cup_players (player, joined)`,
  // status: ready (check-in) → playing → done | void. winner: a player id. deadline: check-in or play deadline.
  `CREATE TABLE IF NOT EXISTS cup_matches (cup TEXT, round INTEGER, slot INTEGER, a TEXT, b TEXT, room TEXT, match TEXT, status TEXT, a_ready INTEGER DEFAULT 0, b_ready INTEGER DEFAULT 0,
    deadline INTEGER, winner TEXT, reason TEXT, tries INTEGER DEFAULT 0, created INTEGER, PRIMARY KEY (cup, round, slot))`,
  `CREATE INDEX IF NOT EXISTS cup_matches_match ON cup_matches (match)`,
];
export const CUP_TABLES = ['cups', 'cup_players', 'cup_matches'];

export const SIZE = 8, ROUNDS = 3;
const PLACE = [5, 3, 2]; // where the loser of each round finishes
const SEEDS = [[1, 8], [4, 5], [2, 7], [3, 6]];
const mins = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };

// Timings (ms). Overridable with Worker vars for local tests only (wrangler dev --var CUP_READY_MS:20000 …).
export function cupTimes(env) {
  const n = (k, d) => (Number(env && env[k]) > 0 ? Number(env[k]) : d);
  return { signup: n('CUP_SIGNUP_MS', 20 * 60000), seen: n('CUP_SEEN_MS', 45000), ready: n('CUP_READY_MS', 3 * 60000), grace: n('CUP_GRACE_MS', 2 * 60000), play: n('CUP_PLAY_MS', 45 * 60000) };
}
// Fri, Sat, Sun (UTC). CUP_OPEN=always opens sign-ups every day (local tests).
export function cupWindow(env, now) {
  const d = new Date(now), day = d.getUTCDay(), midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (env && env.CUP_OPEN === 'always') return { open: true, closesIn: null, opensIn: 0 };
  const open = day === 5 || day === 6 || day === 0;
  const toMon = ((8 - day) % 7 || 7) * 86400000, toFri = (((5 - day) + 7) % 7) * 86400000;
  return open ? { open, closesIn: midnight + toMon - now, opensIn: 0 } : { open, closesIn: null, opensIn: midnight + toFri - now };
}

export function cupApi(H) {
  const { json, bad, body, auth, rand, limited, slow } = H;
  const checkin = (db, pairs, now) => (H.checkin ? H.checkin(db, pairs, now) : null); // push both coaches (worker/push.js)
  const room = () => rand(5).replace(/[^A-Z]/g, 'Q');
  const matchId = () => 'C' + rand(15);

  // ── bracket mechanics ──
  const newMatch = (db, cup, round, slot, a, b, now, T) => {
    if (!a || !b) { // walkover (one side empty) or void (both empty)
      return db.prepare(`INSERT OR IGNORE INTO cup_matches (cup, round, slot, a, b, status, winner, reason, created, deadline) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(cup, round, slot, a, b, a || b ? 'done' : 'void', a || b || null, a || b ? 'walkover' : 'no players', now, now);
    }
    return db.prepare(`INSERT OR IGNORE INTO cup_matches (cup, round, slot, a, b, room, match, status, deadline, created) VALUES (?,?,?,?,?,?,?, 'ready', ?, ?)`)
      .bind(cup, round, slot, a, b, room(), matchId(), now + T.ready, now);
  };
  // Decide one match (from 'ready' or 'playing'). Returns true when this call made the change.
  async function decide(db, cm, winner, reason, now) {
    const r = await db.prepare(`UPDATE cup_matches SET status = ?, winner = ?, reason = ? WHERE cup = ? AND round = ? AND slot = ? AND status IN ('ready', 'playing') RETURNING a, b`)
      .bind(winner ? 'done' : 'void', winner, reason, cm.cup, cm.round, cm.slot).first();
    if (!r) return false;
    const out = [r.a, r.b].filter((p) => p && p !== winner);
    if (out.length) await db.batch(out.map((p) => db.prepare('UPDATE cup_players SET place = ? WHERE cup = ? AND player = ? AND place = 0').bind(PLACE[cm.round], cm.cup, p)));
    return true;
  }
  const seedOf = (players, id) => { const p = players.find((x) => x.player === id); return p ? p.seed : 99; };
  const higherSeed = (players, cm) => (seedOf(players, cm.a) <= seedOf(players, cm.b) ? cm.a : cm.b);

  // Build every next-round match whose two feeders are decided; finish the cup after the final.
  async function progress(db, cupId, now, T) {
    for (let guard = 0; guard < 4; guard++) {
      const ms = (await db.prepare('SELECT * FROM cup_matches WHERE cup = ?').bind(cupId).all()).results || [];
      const at = (r, s) => ms.find((m) => m.round === r && m.slot === s);
      const decided = (m) => m && (m.status === 'done' || m.status === 'void');
      const stmts = [], pairs = [];
      for (let r = 0; r < ROUNDS - 1; r++) for (let s = 0; s < (4 >> r) / 2; s++) {
        const m1 = at(r, 2 * s), m2 = at(r, 2 * s + 1);
        if (decided(m1) && decided(m2) && !at(r + 1, s)) {
          const a = m1.status === 'done' ? m1.winner : null, b = m2.status === 'done' ? m2.winner : null;
          stmts.push(newMatch(db, cupId, r + 1, s, a, b, now, T));
          if (a && b) pairs.push({ a, b, round: r + 1, i: stmts.length - 1 });
        }
      }
      if (stmts.length) {
        const res = await db.batch(stmts);
        // only the matches this call created (INSERT OR IGNORE: a concurrent poll may have made them first)
        await checkin(db, pairs.filter((x) => res[x.i] && res[x.i].meta && res[x.i].meta.changes), now);
        continue;
      }
      const fin = at(ROUNDS - 1, 0);
      if (decided(fin)) {
        const w = fin.status === 'done' ? fin.winner : null;
        const done = await db.prepare(`UPDATE cups SET status = 'done', ended = ?, winner = ?, reason = ? WHERE id = ? AND status = 'live' RETURNING id`).bind(now, w, w ? null : 'No champion: the final was not played', cupId).first();
        if (done && w) await db.prepare('UPDATE cup_players SET place = 1 WHERE cup = ? AND player = ? AND place = 0').bind(cupId, w).run();
      }
      return;
    }
  }

  // A cup match's reports: 2 agreeing → decided; 2 disagreeing → one replay, then the higher seed;
  // 1 report older than the grace period → that report decides (the other coach left).
  async function fromReports(db, cm, reps, now, T, players) {
    const side = (p) => (p === cm.a ? 0 : p === cm.b ? 1 : -1);
    const writeMatch = (status, winTeam, mode) => db.prepare(`INSERT OR IGNORE INTO matches (id, season, blue, red, winner, status, summary, created, mode, verify) VALUES (?,?,?,?,?,?,?,?,?,
      CASE WHEN ? = 'disputed' OR NOT EXISTS (SELECT 1 FROM replays WHERE match = ?) THEN 'none' ELSE 'pending' END)`)
      .bind(cm.match, reps[0].season, cm.a, cm.b, winTeam, status, reps[0].summary, now, mode, status, cm.match);
    if (reps.length >= 2) {
      const [x, y] = reps;
      const agree = x.winner === y.winner && x.checksum === y.checksum && x.side !== y.side && side(x.player) === x.side && side(y.player) === y.side;
      if (agree) {
        const w = x.winner === 0 ? cm.a : cm.b;
        if (await decide(db, cm, w, 'played', now)) await writeMatch('verified', x.winner, 'cup').run();
        return;
      }
      await writeMatch('disputed', -1, 'cup').run();
      if ((cm.tries || 0) < 1) { // replay the match once, on a fresh room and match id
        await db.prepare(`UPDATE cup_matches SET status = 'ready', a_ready = 0, b_ready = 0, room = ?, match = ?, deadline = ?, tries = tries + 1, reason = 'replay after a dispute' WHERE cup = ? AND round = ? AND slot = ? AND status = 'playing' AND match = ?`)
          .bind(room(), matchId(), now + T.ready, cm.cup, cm.round, cm.slot, cm.match).run();
        return;
      }
      await decide(db, cm, higherSeed(players, cm), 'disputed twice: higher seed advances', now);
      return;
    }
    const r = reps[0];
    if (r && now - r.created >= T.grace && side(r.player) >= 0) {
      // The reporter's side is the one the bracket gave them (the host is always `a`, side 0).
      const w = r.winner === side(r.player) ? r.player : r.player === cm.a ? cm.b : cm.a;
      if (await decide(db, cm, w, 'opponent did not report', now)) await writeMatch('single', side(w), 'cup').run();
    }
  }

  // Lazy clock: check-in timeouts, report grace, play deadline, then next rounds.
  async function advance(db, cup, now, T) {
    if (cup.status !== 'live') return;
    const [mr, pr, rr] = await db.batch([
      db.prepare('SELECT * FROM cup_matches WHERE cup = ?').bind(cup.id),
      db.prepare('SELECT player, seed FROM cup_players WHERE cup = ?').bind(cup.id),
      db.prepare(`SELECT r.match, r.player, r.side, r.winner, r.checksum, r.created, r.season, r.summary FROM reports r JOIN cup_matches m ON m.match = r.match WHERE m.cup = ? AND m.status = 'playing'`).bind(cup.id),
    ]);
    const players = pr.results || [], reps = rr.results || [];
    for (const cm of mr.results || []) {
      if (cm.status === 'ready' && now > cm.deadline) {
        if (cm.a_ready && !cm.b_ready) await decide(db, cm, cm.a, 'no-show', now);
        else if (cm.b_ready && !cm.a_ready) await decide(db, cm, cm.b, 'no-show', now);
        else if (!cm.a_ready && !cm.b_ready) await decide(db, cm, null, 'no-show', now);
      } else if (cm.status === 'playing') {
        const mine = reps.filter((r) => r.match === cm.match);
        if (mine.length) await fromReports(db, cm, mine, now, T, players);
        else if (now > cm.deadline) await decide(db, cm, higherSeed(players, cm), 'no result reported: higher seed advances', now);
      }
    }
    await progress(db, cup.id, now, T);
  }

  // Sign-up list upkeep: drop coaches whose Cup screen closed, call the cup off when the window ends.
  async function upkeep(db, cup, now, T, keep) {
    if (cup.status !== 'signup') return cup;
    await db.prepare('DELETE FROM cup_players WHERE cup = ? AND seen < ? AND player != ?').bind(cup.id, now - T.seen, keep || '').run();
    const n = await db.prepare('SELECT COUNT(*) AS n FROM cup_players WHERE cup = ?').bind(cup.id).first();
    if (n.n >= SIZE) { await start(db, cup.id, now, T); return db.prepare('SELECT * FROM cups WHERE id = ?').bind(cup.id).first(); }
    if (now - cup.created > T.signup) {
      const v = await db.prepare(`UPDATE cups SET status = 'void', ended = ?, reason = ? WHERE id = ? AND status = 'signup' RETURNING *`)
        .bind(now, `Only ${n.n} of ${SIZE} coaches signed up in ${mins(T.signup)}, so this cup did not start. No bots fill in.`, cup.id).first();
      return v || db.prepare('SELECT * FROM cups WHERE id = ?').bind(cup.id).first();
    }
    return cup;
  }
  async function start(db, cupId, now, T) {
    const go = await db.prepare(`UPDATE cups SET status = 'live', started = ? WHERE id = ? AND status = 'signup' RETURNING id, version`).bind(now, cupId).first();
    if (!go) return;
    const all = (await db.prepare('SELECT * FROM cup_players WHERE cup = ? AND seen >= ? ORDER BY joined, player').bind(cupId, now - T.seen).all()).results || [];
    if (all.length < SIZE) { await db.prepare(`UPDATE cups SET status = 'signup', started = NULL WHERE id = ?`).bind(cupId).run(); return; }
    const in8 = all.slice(0, SIZE), extra = all.slice(SIZE);
    const seeded = in8.slice().sort((a, b) => b.rating - a.rating || a.joined - b.joined || (a.player < b.player ? -1 : 1));
    const stmts = [db.prepare('DELETE FROM cup_players WHERE cup = ? AND seen < ?').bind(cupId, now - T.seen)];
    seeded.forEach((p, i) => stmts.push(db.prepare('UPDATE cup_players SET seed = ? WHERE cup = ? AND player = ?').bind(i + 1, cupId, p.player)));
    if (extra.length) { // a ninth coach who joined in the same instant goes to the next cup's list
      const nid = rand(10);
      stmts.push(db.prepare(`INSERT INTO cups (id, version, status, created) VALUES (?,?, 'signup', ?)`).bind(nid, go.version, now));
      for (const p of extra) stmts.push(db.prepare('UPDATE cup_players SET cup = ? WHERE cup = ? AND player = ?').bind(nid, cupId, p.player));
    }
    SEEDS.forEach(([x, y], slot) => stmts.push(newMatch(db, cupId, 0, slot, seeded[x - 1].player, seeded[y - 1].player, now, T)));
    await db.batch(stmts);
    await checkin(db, SEEDS.map(([x, y]) => ({ a: seeded[x - 1].player, b: seeded[y - 1].player, round: 0 })), now);
  }

  // The cup a coach is in now (or just finished, for an hour), else the open sign-up list for their version.
  async function current(db, me, version, now) {
    const mine = await db.prepare(`SELECT c.* FROM cup_players cp JOIN cups c ON c.id = cp.cup WHERE cp.player = ? ORDER BY cp.joined DESC LIMIT 1`).bind(me.id).first();
    if (mine && (mine.status === 'signup' || mine.status === 'live' || now - (mine.ended || 0) < 3600000)) return { cup: mine, member: true };
    const open = await db.prepare(`SELECT * FROM cups WHERE status = 'signup' AND version = ? ORDER BY created LIMIT 1`).bind(version).first();
    return { cup: open || null, member: false };
  }

  async function view(db, env, me, version, now, T) {
    let { cup, member } = await current(db, me, version, now);
    if (cup && member && cup.status === 'signup') await db.prepare('UPDATE cup_players SET seen = ? WHERE cup = ? AND player = ?').bind(now, cup.id, me.id).run();
    if (cup && cup.status === 'signup') cup = await upkeep(db, cup, now, T, member ? me.id : null);
    if (cup && cup.status === 'live') { await advance(db, cup, now, T); cup = await db.prepare('SELECT * FROM cups WHERE id = ?').bind(cup.id).first(); }
    const win = cupWindow(env, now);
    if (cup && cup.status === 'signup' && !member && cup.version !== version) cup = null;
    if (!cup) return { ...win, cup: null, me: null };
    const [pr, mr] = await db.batch([
      db.prepare('SELECT player, name, seed, place, rating FROM cup_players WHERE cup = ? ORDER BY seed, joined').bind(cup.id),
      db.prepare('SELECT round, slot, a, b, room, match, status, a_ready, b_ready, deadline, winner, reason FROM cup_matches WHERE cup = ? ORDER BY round, slot').bind(cup.id),
    ]);
    const players = pr.results || [], matches = mr.results || [];
    const amIn = players.some((p) => p.player === me.id);
    const name = (id) => (players.find((p) => p.player === id) || {}).name || null;
    let my = null;
    if (amIn && cup.status === 'live') {
      const live = matches.find((m) => (m.a === me.id || m.b === me.id) && (m.status === 'ready' || m.status === 'playing'));
      if (live) {
        const host = live.a === me.id, opp = host ? live.b : live.a;
        my = { round: live.round, slot: live.slot, status: live.status, role: host ? 'host' : 'join', room: live.status === 'playing' ? live.room : null, match: live.status === 'playing' ? live.match : null,
          opp: { id: opp, name: name(opp) }, ready: !!(host ? live.a_ready : live.b_ready), oppReady: !!(host ? live.b_ready : live.a_ready), left: Math.max(0, live.deadline - now), note: live.reason || null };
      }
    }
    const meRow = players.find((p) => p.player === me.id);
    return {
      ...win,
      cup: { id: cup.id, status: cup.status, version: cup.version, size: SIZE, count: players.length, reason: cup.reason || null, closesIn: cup.status === 'signup' ? Math.max(0, cup.created + T.signup - now) : null,
        champion: cup.winner ? { id: cup.winner, name: name(cup.winner) } : null, started: cup.started || null, ended: cup.ended || null,
        players: players.map((p) => ({ id: p.player, name: p.name, seed: p.seed, place: p.place })),
        matches: matches.map((m) => ({ round: m.round, slot: m.slot, a: m.a, b: m.b, status: m.status, winner: m.winner, reason: m.reason, ready: [!!m.a_ready, !!m.b_ready], left: m.status === 'ready' ? Math.max(0, m.deadline - now) : null })) },
      me: amIn ? { id: me.id, place: meRow.place, seed: meRow.seed, out: meRow.place !== 0 || (cup.status !== 'live' && cup.status !== 'signup'), match: my } : null,
    };
  }

  // A cup report landed (/api/match/report, mode 'cup'): settle the match if it can be, then the bracket.
  async function onReport(db, env, match, me, now) {
    const T = cupTimes(env);
    let cm = await db.prepare('SELECT * FROM cup_matches WHERE match = ?').bind(match).first();
    if (!cm) return { status: 'pending', cup: true };
    if (cm.status === 'playing') {
      const [rr, pr] = await db.batch([db.prepare('SELECT * FROM reports WHERE match = ?').bind(match), db.prepare('SELECT player, seed FROM cup_players WHERE cup = ?').bind(cm.cup)]);
      await fromReports(db, cm, rr.results || [], now, T, pr.results || []);
      await progress(db, cm.cup, now, T);
      cm = await db.prepare('SELECT * FROM cup_matches WHERE cup = ? AND round = ? AND slot = ?').bind(cm.cup, cm.round, cm.slot).first();
    }
    const replay = cm.status === 'ready' && cm.match !== match; // disputed: the match is played again
    return { status: cm.status === 'done' || cm.status === 'void' ? 'decided' : replay ? 'replay' : 'pending', cup: true, round: cm.round, advanced: cm.status === 'done' ? cm.winner === me : null };
  }

  const route = async function cups(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/cup')) return null;
    const T = cupTimes(env);
    if (p === '/api/cup' && M === 'GET') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('cs:' + me.id, 40)) return slow();
      return json(await view(db, env, me, Number(url.searchParams.get('v')) | 0, now, T));
    }
    if (p === '/api/cup/join' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('cj:' + me.id, 10)) return slow();
      const b = await body(req), version = Number(b.version) | 0;
      if (!cupWindow(env, now).open) return bad('Weekend Cup sign-ups open on Friday (UTC).', 403);
      const cur = await current(db, me, version, now);
      const busy = cur.member && cur.cup && (cur.cup.status === 'signup' || (cur.cup.status === 'live' && await db.prepare('SELECT place FROM cup_players WHERE cup = ? AND player = ?').bind(cur.cup.id, me.id).first().then((r) => r && r.place === 0)));
      if (!busy) {
        let open = await db.prepare(`SELECT * FROM cups WHERE status = 'signup' AND version = ? ORDER BY created LIMIT 1`).bind(version).first();
        if (open && now - open.created > T.signup) { await upkeep(db, open, now, T, null); open = null; }
        if (!open) { open = { id: rand(10), version, status: 'signup', created: now }; await db.prepare(`INSERT INTO cups (id, version, status, created) VALUES (?,?, 'signup', ?)`).bind(open.id, version, now).run(); }
        const pl = await db.prepare('SELECT elo FROM players WHERE id = ?').bind(me.id).first();
        await db.prepare('INSERT OR IGNORE INTO cup_players (cup, player, name, rating, joined, seen) VALUES (?,?,?,?,?,?)').bind(open.id, me.id, me.name, (pl && pl.elo) || 1000, now, now).run();
        await upkeep(db, open, now, T, me.id);
      }
      return json(await view(db, env, me, version, now, T));
    }
    if (p === '/api/cup/leave' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      await db.prepare(`DELETE FROM cup_players WHERE player = ? AND cup IN (SELECT id FROM cups WHERE status = 'signup')`).bind(me.id).run();
      return json({ ok: true });
    }
    // Check in for your current match. When both coaches are in, the match goes live: the host opens the room.
    if (p === '/api/cup/ready' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('cr:' + me.id, 20)) return slow();
      const b = await body(req), cupId = String(b.cup || '');
      const cup = await db.prepare('SELECT * FROM cups WHERE id = ?').bind(cupId).first();
      if (!cup) return bad('Cup not found', 404);
      await advance(db, cup, now, T); // a late check-in after the deadline loses to the clock, not to a race
      const cm = await db.prepare(`UPDATE cup_matches SET a_ready = CASE WHEN a = ? THEN 1 ELSE a_ready END, b_ready = CASE WHEN b = ? THEN 1 ELSE b_ready END
        WHERE cup = ? AND status = 'ready' AND (a = ? OR b = ?) AND deadline >= ? RETURNING *`).bind(me.id, me.id, cupId, me.id, me.id, now).first();
      if (cm && cm.a_ready && cm.b_ready) {
        await db.prepare(`UPDATE cup_matches SET status = 'playing', deadline = ? WHERE cup = ? AND round = ? AND slot = ? AND status = 'ready'`).bind(now + T.play, cupId, cm.round, cm.slot).run();
      }
      return json(await view(db, env, me, cup.version, now, T));
    }
    // Your cups and the latest champions.
    if (p === '/api/cup/history' && M === 'GET') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('ch:' + me.id, 20)) return slow();
      const [mine, champs, tr] = await db.batch([
        db.prepare(`SELECT c.id, c.status, c.started, c.ended, c.reason, cp.place, w.name AS champ FROM cup_players cp JOIN cups c ON c.id = cp.cup LEFT JOIN cup_players w ON w.cup = c.id AND w.player = c.winner
          WHERE cp.player = ? AND c.status IN ('done', 'void') ORDER BY c.ended DESC LIMIT 10`).bind(me.id),
        db.prepare(`SELECT c.id, c.ended, c.winner, w.name FROM cups c JOIN cup_players w ON w.cup = c.id AND w.player = c.winner WHERE c.status = 'done' ORDER BY c.ended DESC LIMIT 5`),
        trophiesStmt(db, me.id),
      ]);
      return json({ mine: (mine.results || []).map((r) => ({ id: r.id, status: r.status, ended: r.ended, place: r.place, champion: r.champ || null, reason: r.reason || null })),
        champions: (champs.results || []).map((r) => ({ id: r.id, ended: r.ended, player: r.winner, name: r.name })), trophies: trophyRow((tr.results || [])[0]) });
    }
    return null;
  };
  return { route, onReport };
}

// Trophies for the public profile: cups won / final reached / played (finished cups; a DQ never counts).
export const trophiesStmt = (db, id) => db.prepare(`SELECT SUM(CASE WHEN cp.place = 1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN cp.place = 2 THEN 1 ELSE 0 END) AS finals,
  COUNT(*) AS played FROM cup_players cp JOIN cups c ON c.id = cp.cup WHERE cp.player = ? AND c.status = 'done' AND cp.place > 0`).bind(id);
export const trophyRow = (r) => ({ wins: (r && r.wins) || 0, finals: (r && r.finals) || 0, played: (r && r.played) || 0 });

// A cup report must come from one of the two coaches of a live cup match with that match id.
export async function cupMatchFor(db, match, player) {
  const cm = await db.prepare('SELECT * FROM cup_matches WHERE match = ?').bind(match).first();
  if (!cm || (cm.a !== player && cm.b !== player)) return null;
  return cm;
}

// Replay review overturned a decided cup match: the flagged winner is disqualified. If their next match has not
// started yet (or this was the final), the opponent they beat takes their place; otherwise the DQ stands alone
// and a disqualified champion's title is vacated.
export async function overturnCup(db, matchId, now, readyMs) {
  const cm = await db.prepare('SELECT * FROM cup_matches WHERE match = ?').bind(matchId).first();
  if (!cm || cm.status !== 'done' || !cm.winner) return;
  const cheat = cm.winner, other = cm.a === cheat ? cm.b : cm.a;
  const next = await db.prepare('SELECT * FROM cup_matches WHERE cup = ? AND round = ? AND slot = ?').bind(cm.cup, cm.round + 1, cm.slot >> 1).first();
  const cup = await db.prepare('SELECT * FROM cups WHERE id = ?').bind(cm.cup).first();
  const stmts = [db.prepare('UPDATE cup_players SET place = -1 WHERE cup = ? AND player = ?').bind(cm.cup, cheat)];
  const swap = cm.round === ROUNDS - 1 || !next || next.status === 'ready';
  if (swap && other) {
    stmts.push(db.prepare(`UPDATE cup_matches SET winner = ?, reason = 'overturned by replay review' WHERE cup = ? AND round = ? AND slot = ?`).bind(other, cm.cup, cm.round, cm.slot));
    stmts.push(db.prepare('UPDATE cup_players SET place = 0 WHERE cup = ? AND player = ?').bind(cm.cup, other));
    if (next) {
      const col = next.a === cheat ? 'a' : 'b';
      stmts.push(db.prepare(`UPDATE cup_matches SET ${col} = ?, a_ready = 0, b_ready = 0, deadline = ?, reason = 'opponent disqualified' WHERE cup = ? AND round = ? AND slot = ? AND status = 'ready'`)
        .bind(other, now + readyMs, next.cup, next.round, next.slot));
    }
    if (cm.round === ROUNDS - 1 && cup && cup.winner === cheat) {
      stmts.push(db.prepare('UPDATE cups SET winner = ?, reason = ? WHERE id = ?').bind(other, 'Champion decided by replay review', cm.cup));
      stmts.push(db.prepare('UPDATE cup_players SET place = 1 WHERE cup = ? AND player = ?').bind(cm.cup, other));
    }
  } else if (cup && cup.winner === cheat) {
    stmts.push(db.prepare('UPDATE cups SET winner = NULL, reason = ? WHERE id = ?').bind('Title vacated: the champion was disqualified after replay review', cm.cup));
  }
  await db.batch(stmts);
}
