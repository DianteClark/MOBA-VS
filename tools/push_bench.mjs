// Web Push crypto check + CPU benchmark (worker/push.js on Node's WebCrypto).
//   node tools/push_bench.mjs [--n 200]
// 1. Round trip: a fake browser subscription (P-256 key + auth secret) receives an aes128gcm message from
//    encryptPayload(), and this script decrypts it as a browser would (RFC 8291 receiver side). The VAPID JWT
//    is verified against the public key.
// 2. CPU per message: encryption alone, VAPID signing (cold, once per push service per ~11 h), and a full
//    sendPush() with a stubbed fetch. The Worker free plan allows ~10 ms CPU per invocation; worker/push.js
//    drains at most DRAIN_PER_CALL messages per invocation, and this prints the head-room.
// Exits non-zero if the round trip fails or one message costs more than 2 ms of CPU.
import { encryptPayload, sendPush, vapidAuth, generateVapidKeys, b64u, unb64u, DRAIN_PER_CALL } from '../worker/push.js';

const subtle = globalThis.crypto.subtle, te = new TextEncoder();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('n', 200);
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
const cat = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// a browser's side of a subscription
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', p256dh: b64u(uaPub), auth: b64u(authSecret) };

async function decrypt(body) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  if (rs !== 4096 || idlen !== 65) throw new Error('bad header');
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--;
  if (pt[end] !== 2) throw new Error('missing last-record delimiter');
  return new TextDecoder().decode(pt.slice(0, end));
}

console.log('Round trip');
const msg = { t: 'invite', title: 'Alice invites you', body: 'Casual match. Tap to join (3 minutes).', url: '/?i=ABCDEFGH', tag: 'invite' };
const enc = await encryptPayload(sub, JSON.stringify(msg));
let back = null; try { back = JSON.parse(await decrypt(enc)); } catch (e) { console.log('   ', e.message); }
ok(back && back.title === msg.title && back.url === msg.url, `payload decrypts (${enc.length} bytes on the wire)`);
const two = await encryptPayload(sub, JSON.stringify(msg));
ok(b64u(two) !== b64u(enc), 'fresh salt and key per message');

const vapid = { ...(await generateVapidKeys()), subject: 'mailto:test@example.invalid' };
ok(unb64u(vapid.publicKey).length === 65 && unb64u(vapid.privateKey).length === 32, 'VAPID key pair shape (65-byte public, 32-byte private)');
const hdr = await vapidAuth(sub.endpoint, vapid);
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(hdr);
ok(!!m && m[4] === vapid.publicKey, 'Authorization: vapid t=…, k=…');
if (m) {
  const pub = await subtle.importKey('raw', unb64u(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), te.encode(m[1] + '.' + m[2]));
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  ok(valid, 'VAPID JWT signature verifies');
  ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 + 11 * 3600 && claims.sub.startsWith('mailto:'), 'JWT claims (aud = push origin, exp ≤ 24 h, sub)');
}
let seen = null;
const stub = async (url, init) => { seen = { url, init }; return { status: 201 }; };
const res = await sendPush(sub, msg, vapid, { fetch: stub, topic: 'invite', urgency: 'high', ttl: 600 });
ok(res.ok && seen && seen.init.headers['Content-Encoding'] === 'aes128gcm' && seen.init.headers.TTL === '600' && seen.init.headers.Topic === 'invite', 'sendPush headers (aes128gcm, TTL, Urgency, Topic)');
ok(JSON.parse(await decrypt(seen.init.body)).body === msg.body, 'sendPush body decrypts');
const gone = await sendPush(sub, msg, vapid, { fetch: async () => ({ status: 410 }) });
ok(gone.gone && !gone.ok, '410 → subscription gone');

// ── CPU ──
const cpu = async (fn, n) => { const t = process.cpuUsage(); for (let i = 0; i < n; i++) await fn(i); const d = process.cpuUsage(t); return (d.user + d.system) / 1000 / n; };
for (let i = 0; i < 20; i++) await encryptPayload(sub, JSON.stringify(msg)); // warm up
const encMs = await cpu(() => encryptPayload(sub, JSON.stringify(msg)), N);
const fresh = { ...(await generateVapidKeys()), subject: 'mailto:x@example.invalid' };
const signMs = await cpu((i) => vapidAuth(`https://push${i}.example.invalid/x`, fresh), Math.min(N, 100));
const fullMs = await cpu(() => sendPush(sub, msg, vapid, { fetch: stub }), N);
console.log('\nCPU per message (Node WebCrypto, this machine)');
console.log(`  encrypt (ECDH + 3 HKDF + AES-GCM)      ${encMs.toFixed(3)} ms`);
console.log(`  VAPID JWT sign (cold, per push origin)  ${signMs.toFixed(3)} ms`);
console.log(`  sendPush, warm JWT cache                ${fullMs.toFixed(3)} ms`);
console.log(`  worst case per Worker drain: ${DRAIN_PER_CALL} x ${(fullMs + signMs).toFixed(2)} ms = ${(DRAIN_PER_CALL * (fullMs + signMs)).toFixed(2)} ms of the ~10 ms budget`);
ok(fullMs < 2, 'one message < 2 ms CPU');
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
