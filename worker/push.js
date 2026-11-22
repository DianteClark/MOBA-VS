// Web Push (VAPID + aes128gcm payload encryption, RFC 8291 / RFC 8292) for MOBA-VS notifications.
//
// Types (bit flags, chosen per device in Settings → Notifications):
//   invite 1 (a friend invites you to a room), rematch 2 (your last opponent asks for a rematch),
//   cup 4 (your Weekend Cup match is ready: check in), event 8 (a new weekly event started),
//   division 16 (your weekly ranked result: tier / division and rating change).
//
// Sending model (Cloudflare free plan: ~10 ms CPU per invocation):
//   * Event-driven pushes (invite, rematch, cup) are queued in push_outbox inside the request that causes
//     them (one INSERT … SELECT that only queues for players who have a matching subscription and are not
//     active in the app right now), then drained right after the response (ctx.waitUntil, DRAIN_PER_CALL
//     rows = at most 6 messages) and by the 5-minute cron. Encrypting one message costs ~0.6 ms of CPU and a
//     VAPID signature ~0.1 ms (cached ~11 h per push service), measured by tools/push_bench.mjs, so a drain
//     stays around 4 ms of the 10 ms budget.
//   * Broadcasts (weekly event, division results) go to every opted-in device, which does not fit a Worker
//     invocation: tools/push.mjs sends them from a scheduled GitHub Action (.github/workflows/push.yml), with
//     this same module running on Node's WebCrypto, through the token-protected /api/admin/push/* endpoints.
//
// The module is plain WebCrypto (no Worker-only APIs), so Node 20+ can import it as is.

export const PUSH_TYPES = { invite: 1, rematch: 2, cup: 4, event: 8, division: 16 };
export const PUSH_ALL = 31;
export const MAX_SUBS = 3; // devices per coach
export const DRAIN_PER_CALL = 2; // outbox rows per invocation: ≤ 2 x MAX_SUBS = 6 messages ≈ 4 ms CPU
const OUTBOX_TTL = 10 * 60000;
const ACTIVE_MS = 45000; // the app polls presence every 30 s on the menu: a coach seen this recently gets the in-app card instead

export const PUSH_SCHEMA = [
  // one row per browser subscription. types: PUSH_TYPES bits. fails: consecutive failed sends (pruned at 3).
  // wk: last weekly ranked rating sent with a division result (tools/push.mjs), for the weekly change.
  `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, player TEXT, p256dh TEXT, auth TEXT, types INTEGER DEFAULT ${PUSH_ALL}, created INTEGER, seen INTEGER, fails INTEGER DEFAULT 0, wk INTEGER)`,
  `CREATE INDEX IF NOT EXISTS push_subs_player ON push_subs (player)`,
  `CREATE TABLE IF NOT EXISTS push_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT, type INTEGER, msg TEXT, created INTEGER)`,
];
export const PUSH_TABLES = ['push_subs', 'push_outbox'];

// ── base64url ──
export const b64u = (buf) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => { const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; };
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// ── VAPID ──
// Keys: VAPID_PUBLIC = base64url of the 65-byte uncompressed P-256 point, VAPID_PRIVATE = base64url of the
// 32-byte private scalar (tools/push.mjs --keys prints a fresh pair). VAPID_SUBJECT: mailto: or https: contact.
export async function generateVapidKeys() {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle().exportKey('jwk', kp.privateKey), raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  return { publicKey: b64u(raw), privateKey: jwk.d };
}
const keyCache = new Map();
async function vapidKey(pub, priv) {
  const k = pub + '|' + priv;
  if (!keyCache.has(k)) {
    const p = unb64u(pub); if (p.length !== 65 || p[0] !== 4) throw new Error('VAPID_PUBLIC must be a 65-byte uncompressed P-256 key');
    keyCache.set(k, subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: priv, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']));
  }
  return keyCache.get(k);
}
// JWTs are reused per push service origin for ~11 hours (they are valid for 12): one ECDSA signature per
// origin per isolate, not per message.
const jwtCache = new Map();
export async function vapidAuth(endpoint, vapid, nowMs = Date.now()) {
  const aud = new URL(endpoint).origin, ck = aud + '|' + vapid.publicKey;
  const hit = jwtCache.get(ck);
  if (hit && hit.until > nowMs) return hit.header;
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), body = b64u(te.encode(JSON.stringify({ aud, exp, sub: vapid.subject || 'mailto:owner@example.invalid' })));
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(vapid.publicKey, vapid.privateKey), te.encode(head + '.' + body));
  const header = `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
  if (jwtCache.size > 50) jwtCache.clear();
  jwtCache.set(ck, { header, until: nowMs + 11 * 3600 * 1000 });
  return header;
}

// ── aes128gcm payload encryption (RFC 8291) ──
async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
// → the encrypted body (salt | rs | idlen | keyid | ciphertext) for one subscription { p256dh, auth }.
export async function encryptPayload(sub, plaintext) {
  const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  if (uaPub.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const as = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await subtle().exportKey('raw', as.publicKey));
  const uaKey = await subtle().importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const data = typeof plaintext === 'string' ? te.encode(plaintext) : plaintext;
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(data, new Uint8Array([2])))); // 0x02: last (only) record, no padding
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([65]), asPub, ct);
}

// One push. → { ok, gone, status }. gone: the subscription is dead (404 / 410) and should be deleted.
export async function sendPush(sub, payload, vapid, opts = {}) {
  const bodyBytes = await encryptPayload(sub, JSON.stringify(payload));
  const headers = { TTL: String(opts.ttl ?? 3600), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: opts.urgency || 'normal', Authorization: await vapidAuth(sub.endpoint, vapid) };
  if (opts.topic) headers.Topic = String(opts.topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const fetchFn = opts.fetch || fetch;
  const r = await fetchFn(sub.endpoint, { method: 'POST', headers, body: bodyBytes });
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}

export const vapidOf = (env) => (env && env.VAPID_PUBLIC && env.VAPID_PRIVATE ? { publicKey: String(env.VAPID_PUBLIC).trim(), privateKey: String(env.VAPID_PRIVATE).trim(), subject: env.VAPID_SUBJECT || 'mailto:owner@example.invalid' } : null);

// Only push services browsers really use (an endpoint is an outbound fetch target: never an arbitrary URL).
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|push\.services\.mozilla\.com)$/;
export function cleanSub(s, allowAny = false) {
  if (!s || typeof s !== 'object') return null;
  const endpoint = String(s.endpoint || ''), k = s.keys || {};
  let u; try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || endpoint.length > 600 || (!allowAny && !PUSH_HOSTS.test(u.hostname))) return null;
  const p256dh = String(k.p256dh || ''), auth = String(k.auth || '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// Messages. Short, and every one says what tapping it does. url is relative to the app's scope (the Worker
// origin or a mirror's sub-path).
export function message(type, x = {}) {
  switch (type) {
    case 'invite': return { t: 'invite', title: `${x.from || 'A friend'} invites you`, body: `${x.mode === 'ranked' ? 'Ranked' : x.mode === 'rush' ? 'Lane Rush' : x.mode === 'coop' ? 'Co-op' : 'Casual'} match. Tap to join (3 minutes).`, url: x.id ? `./?i=${x.id}` : './', tag: 'invite' };
    case 'rematch': return { t: 'rematch', title: 'Rematch ready', body: `${x.from || 'Your opponent'} wants a rematch, sides swapped.`, url: './', tag: 'rematch' };
    case 'cup': return { t: 'cup', title: 'Weekend Cup: check in now', body: `Your ${x.round === 2 ? 'final' : x.round === 1 ? 'semifinal' : 'quarterfinal'} is ready. Tap Ready within 3 minutes or it is a no-show.`, url: './?go=cup', tag: 'cup' };
    case 'event': return { t: 'event', title: `This week: ${x.name || 'a new event'}`, body: x.blurb || 'A new weekly event is live.', url: './', tag: 'event' };
    case 'division': return { t: 'division', title: x.title || 'Your week in Ranked', body: x.body || '', url: './', tag: 'division' };
    default: return { t: 'info', title: x.title || 'MOBA-VS', body: x.body || '', url: x.url || './', tag: 'info' };
  }
}

// A statement that queues `type` for `player` only when they have a device subscribed to that type and are
// not active in the app right now (skipped with active=false: cup check-ins always go out).
export function enqueueStmt(db, player, type, msg, now, active = true) {
  const bit = PUSH_TYPES[type] || 0, binds = [player, bit, JSON.stringify(message(type, msg)), now, player, bit];
  let sql = 'INSERT INTO push_outbox (player, type, msg, created) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM push_subs WHERE player = ? AND (types & ?) != 0)';
  if (active) { sql += ' AND COALESCE((SELECT seen FROM players WHERE id = ?), 0) < ?'; binds.push(player, now - ACTIVE_MS); }
  return db.prepare(sql).bind(...binds);
}

// Send up to `limit` queued messages (oldest first). Stale ones are dropped. Returns how many were sent.
export async function drainOutbox(db, env, now = Date.now(), limit = DRAIN_PER_CALL) {
  if (!(await db.prepare('SELECT 1 AS x FROM push_outbox LIMIT 1').first())) return 0; // the common case: one cheap read
  const vapid = vapidOf(env); if (!vapid) return 0;
  // claim: delete-returning, so two concurrent drains never send the same row twice
  const rows = (await db.prepare(`DELETE FROM push_outbox WHERE id IN (SELECT id FROM push_outbox ORDER BY id LIMIT ?) RETURNING id, player, type, msg, created`).bind(limit).all()).results || [];
  let sent = 0;
  const stmts = [];
  for (const r of rows) {
    if (now - r.created > OUTBOX_TTL) continue;
    const subs = (await db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE player = ? AND (types & ?) != 0 LIMIT ?').bind(r.player, r.type, MAX_SUBS).all()).results || [];
    let msg; try { msg = JSON.parse(r.msg); } catch { continue; }
    for (const s of subs) {
      try {
        const out = await sendPush(s, msg, vapid, { ttl: 600, urgency: 'high', topic: msg.tag });
        if (out.gone) stmts.push(db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint));
        else if (out.ok) { sent++; stmts.push(db.prepare('UPDATE push_subs SET fails = 0 WHERE endpoint = ? AND fails != 0').bind(s.endpoint)); }
        else stmts.push(db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(s.endpoint));
      } catch { stmts.push(db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(s.endpoint)); }
    }
  }
  stmts.push(db.prepare('DELETE FROM push_subs WHERE fails >= 3'));
  stmts.push(db.prepare('DELETE FROM push_outbox WHERE created < ?').bind(now - OUTBOX_TTL));
  await db.batch(stmts);
  return sent;
}

// ── HTTP API ──
export function pushApi(H) {
  const { json, bad, body, auth, limited, slow, tokenOk, sha } = H;
  return async function push(req, env, db, url, p, M, now) {
    if (p === '/api/push/key' && M === 'GET') { const v = vapidOf(env); return json({ key: v ? v.publicKey : null }); }
    // Subscribe this device (or update its types). One coach keeps at most MAX_SUBS devices (oldest dropped).
    if (p === '/api/push/subscribe' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('ps:' + me.id, 10)) return slow();
      if (!vapidOf(env)) return bad('Notifications are not set up on this server yet', 503);
      const b = await body(req), s = cleanSub(b.sub, env.PUSH_ANY_HOST === '1'), types = (Number(b.types) | 0) & PUSH_ALL;
      if (!s) return bad('bad subscription');
      await db.batch([
        db.prepare(`INSERT INTO push_subs (endpoint, player, p256dh, auth, types, created, seen, fails) VALUES (?,?,?,?,?,?,?,0)
          ON CONFLICT(endpoint) DO UPDATE SET player = excluded.player, p256dh = excluded.p256dh, auth = excluded.auth, types = excluded.types, seen = excluded.seen, fails = 0`).bind(s.endpoint, me.id, s.p256dh, s.auth, types, now, now),
        db.prepare(`DELETE FROM push_subs WHERE player = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE player = ? ORDER BY seen DESC LIMIT ${MAX_SUBS})`).bind(me.id, me.id),
      ]);
      return json({ ok: true, types });
    }
    if (p === '/api/push/unsubscribe' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      if (limited('ps:' + me.id, 10)) return slow();
      const b = await body(req);
      await db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND player = ?').bind(String(b.endpoint || '').slice(0, 600), me.id).run();
      return json({ ok: true });
    }
    // Rematch asked on the results screen: ping the opponent of a match you both just reported.
    if (p === '/api/push/rematch' && M === 'POST') {
      const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
      const b = await body(req), match = String(b.match || '').slice(0, 40), to = String(b.to || '');
      if (!/^[A-Z0-9]{10}$/.test(to) || !/^[A-Za-z0-9-]{8,40}$/.test(match)) return bad('bad rematch');
      if (limited('pr:' + me.id + ':' + match, 1, 10 * 60000) || limited('prm:' + me.id, 6)) return json({ ok: true, queued: false });
      const rep = await db.prepare('SELECT 1 AS ok FROM reports WHERE match = ? AND player = ? AND opponent = ? AND created > ?').bind(match, me.id, to, now - 30 * 60000).first();
      if (!rep) return json({ ok: true, queued: false });
      await enqueueStmt(db, to, 'rematch', { from: me.name }, now, false).run();
      return json({ ok: true, queued: true });
    }
    if (!p.startsWith('/api/admin/push/')) return null;
    if (!(await tokenOk(req, env, sha))) return bad('not found', 404);
    // Broadcast pages for tools/push.mjs: subscriptions opted into `type`, keyset by endpoint, with the
    // coach's current ranked rating (season) for division results.
    if (p === '/api/admin/push/subs' && M === 'GET') {
      const bit = PUSH_TYPES[url.searchParams.get('type')] || 0, after = String(url.searchParams.get('after') || ''), season = Number(url.searchParams.get('season')) | 0;
      if (!bit) return bad('bad type');
      const rows = (await db.prepare(`SELECT s.endpoint, s.p256dh, s.auth, s.player, s.wk, l.rating, l.wins, l.losses FROM push_subs s LEFT JOIN ladder l ON l.season = ? AND l.player = s.player
        WHERE (s.types & ?) != 0 AND s.endpoint > ? ORDER BY s.endpoint LIMIT 200`).bind(season, bit, after).all()).results || [];
      return json({ subs: rows, next: rows.length === 200 ? rows[rows.length - 1].endpoint : null });
    }
    // Results of a broadcast batch: dead endpoints are deleted, division snapshots stored.
    if (p === '/api/admin/push/done' && M === 'POST') {
      const b = await body(req), gone = (Array.isArray(b.gone) ? b.gone : []).slice(0, 500), wk = (Array.isArray(b.wk) ? b.wk : []).slice(0, 500);
      const stmts = [...gone.map((e) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(e))), ...wk.map((x) => db.prepare('UPDATE push_subs SET wk = ? WHERE player = ?').bind(Number(x.rating) | 0, String(x.player)))];
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true, deleted: gone.length, snapshots: wk.length });
    }
    // Owner test from the dashboard: one push to every device of one coach, sent right now.
    if (p === '/api/admin/push/test' && M === 'POST') {
      const vapid = vapidOf(env); if (!vapid) return bad('VAPID keys are not set (see notes: wrangler secret put VAPID_PRIVATE)', 503);
      const b = await body(req), id = String(b.player || '');
      if (!/^[A-Z0-9]{10}$/.test(id)) return bad('bad player');
      const subs = (await db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE player = ? LIMIT ?').bind(id, MAX_SUBS).all()).results || [];
      const out = [];
      for (const s of subs) { try { out.push(await sendPush(s, message('info', { title: 'MOBA-VS test', body: b.body ? String(b.body).slice(0, 120) : 'Notifications work on this device.' }), vapid, { ttl: 300 })); } catch (e) { out.push({ ok: false, error: String(e.message || e) }); } }
      return json({ devices: subs.length, results: out });
    }
    return bad('not found', 404);
  };
}
