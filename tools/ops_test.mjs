// Live-ops end to end, against a local Worker, plus static guards.
//
//   npx --yes wrangler@4 dev --local --port 8846 --ip 127.0.0.1 --persist-to /tmp/opsdb \
//     --var MOBAVS_ADMIN:local-test-token-0123456789 --var PUSH_ANY_HOST:1 \
//     --var VAPID_PUBLIC:<pub> --var VAPID_PRIVATE:<priv> --var VAPID_SUBJECT:mailto:test@example.invalid
//   node tools/ops_test.mjs [http://127.0.0.1:8846] [--static]
// (node tools/ops_test.mjs --print-keys prints a VAPID pair for the command above; --static runs only the guards.)
//
// Static: src/sim never imports the live-ops client or reads a flag; the service worker keeps admin pages out
// of the cache and keeps the r2 redirect fixes. Unit: crash grouping, flag buckets, match counters.
// Worker: activity + flags (hello), exposure, client events, crash grouping + sampling hint, feedback with a
// screenshot, the admin API hidden without the token, summary numbers, rollup (DAU / retention), hero results
// for tools/autobalance.mjs, flag CRUD, a verified casual match feeding hero / plan / map / ban counters, queue
// counters, and Web Push: subscribe, a friend invite queued and delivered to a local push endpoint (decrypted
// here like a browser would), the in-app skip, unsubscribe, and the admin test push.
import fs from 'node:fs';
import http from 'node:http';
import { normCrash, assign, matchCounters, fnv } from '../worker/ops.js';
import { generateVapidKeys, b64u, unb64u, cleanSub } from '../worker/push.js';

let bad = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) bad++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const walk = (d) => fs.readdirSync(new URL('../' + d, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]));

if (process.argv.includes('--print-keys')) { const k = await generateVapidKeys(); console.log(`--var VAPID_PUBLIC:${k.publicKey} --var VAPID_PRIVATE:${k.privateKey}`); process.exit(0); }

console.log('Static guards');
const simFiles = walk('src/sim').filter((f) => f.endsWith('.js'));
ok(simFiles.length > 10 && simFiles.every((f) => !/net\/ops\.js|ui\/notify\.js|ui\/feedback\.js|\bflag\(/.test(read(f))), `src/sim (${simFiles.length} files) never imports live-ops or reads a flag`);
const sw = read('sw.js');
ok(/const PRIVATE = \/.*admin\\\.html/.test(sw) && /!PRIVATE\.test\(url\.pathname\)/.test(sw), 'sw.js never caches admin.html / admin.js / admin.css');
ok(!/'\.\/index\.html'/.test(sw.split('const SHELL')[1].split(']')[0]) || /REV/.test(sw), 'sw.js shell list unchanged by live-ops');
ok(/notificationclick/.test(sw) && /push-open/.test(sw), 'sw.js handles push + notification taps');
ok(!/serviceWorker/.test(read('admin.html')) && !/serviceWorker\.register/.test(read('src/ui/admin.js')), 'the dashboard registers no service worker');
ok(/\.\.\/net\/ops\.js/.test(read('src/ui/notify.js')) && /installCrashReporter\(VERSION\)/.test(read('src/main.js')), 'crash reporter installed at startup');

console.log('Unit');
const a = normCrash('Cannot read properties of undefined (reading \'hp\') at 1234', 'TypeError: x\n    at Hud.update (https://moba.example/src/ui/hud.js?v=24:120:17)\n    at App.frame (https://moba.example/src/main.js:700:9)');
const b = normCrash('Cannot read properties of undefined (reading \'hp\') at 99', 'TypeError: x\n    at Hud.update (https://other.example/src/ui/hud.js?v=25:120:3)\n    at App.frame (https://other.example/src/main.js:700:11)');
ok(a.m === b.m && a.frames.join() === b.frames.join(), 'crash grouping ignores numbers, hosts, query strings and columns');
ok(normCrash('x', 'at f (src/ui/hud.js:121:1)').frames.join() !== normCrash('x', 'at f (src/ui/hud.js:120:1)').frames.join(), 'a different line is a different group');
const flag = { key: 'push_prompt', status: 'on', variants: JSON.stringify([{ id: 'm3', w: 50 }, { id: 'm6', w: 50 }]) };
const ids = Array.from({ length: 2000 }, (_, i) => 'P' + String(i).padStart(9, '0'));
const split = ids.map((p) => assign(flag, p)), m6 = split.filter((v) => v === 'm6').length;
ok(split.every((v, i) => v === assign(flag, ids[i])), 'flag buckets are stable per player');
ok(m6 > 900 && m6 < 1100, `50/50 flag splits evenly (${m6} of 2000 in m6)`);
ok(assign({ ...flag, status: 'off' }, ids[0]) === null && assign({ ...flag, status: 'ship', ship: 'm6' }, ids[0]) === 'm6', 'off → default, ship → everyone');
ok(fnv('a') !== fnv('b'), 'fnv hash');
const mc = matchCounters({ picks: [['bastion', 'kaze'], ['varro', 'BAD ID!']], bans: [['gama'], []], plans: ['aggro', 'scale'], map: 'sakura' }, 1, 'casual');
ok(mc.vm === 1 && mc['vm:casual'] === 1 && mc['hg:bastion'] === 1 && !mc['hw:bastion'] && mc['hw:varro'] === 1 && mc['hb:gama'] === 1 && mc['pw:scale'] === 1 && !mc['pw:aggro'] && mc['vmap:sakura'] === 1 && Object.keys(mc).every((k) => !k.includes('BAD')), 'match counters (picks, wins, bans, plans, map; junk ignored)');

const goodKeys = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
ok(cleanSub({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: goodKeys }) && cleanSub({ endpoint: 'https://web.push.apple.com/x', keys: goodKeys }), 'real push services accepted');
ok(!cleanSub({ endpoint: 'https://evil.example/x', keys: goodKeys }) && !cleanSub({ endpoint: 'http://fcm.googleapis.com/x', keys: goodKeys }) && !cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'x', auth: 'y' } }), 'other hosts, plain http and bad keys rejected (no open fetch proxy)');

if (process.argv.includes('--static')) { console.log(bad ? `\n${bad} FAILED` : '\nall ok'); process.exit(bad ? 1 : 0); }

// ── Worker ──
const BASE = (process.argv.slice(2).find((x) => x.startsWith('http')) || 'http://127.0.0.1:8846').replace(/\/$/, '');
const TOKEN = 'local-test-token-0123456789';
const VERSION = Number(/const VERSION = (\d+);/.exec(read('src/main.js'))[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = 'GET', body, who, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
  if (token) headers.authorization = `Bearer ${token}`;
  let r;
  for (let i = 0; ; i++) { try { r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); break; } catch (e) { if (i >= 4) throw e; await sleep(1500); } }
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ...data };
}
const coach = async (name) => { const x = await call('/api/account', { method: 'POST', body: { name } }); return { id: x.id, secret: x.secret, name }; };
const admin = (path, body) => call(path, { method: body ? 'POST' : 'GET', body, token: TOKEN });

console.log(`\nWorker at ${BASE}`);
const A = await coach('Opsa'), B = await coach('Opsb');
ok(A.id && B.id, 'two coaches');

// admin hidden
ok((await call('/api/admin/ops/summary')).status === 404 && (await call('/api/admin/ops/summary', { token: 'wrong-token-but-long-enough' })).status === 404, 'admin API is 404 without the token');
ok((await call('/api/admin/push/subs?type=event')).status === 404, 'admin push API is 404 without the token');

// flags
ok((await admin('/api/admin/ops/flag', { key: 'push_prompt', variants: [{ id: 'm3', w: 50 }, { id: 'm6', w: 50 }], status: 'on', note: 'when to ask for notifications' })).ok, 'flag created');
ok((await admin('/api/admin/ops/flag', { key: 'bad key', variants: [] })).status === 400, 'bad flag rejected');
const hA = await call('/api/ops/hello', { method: 'POST', who: A, body: { v: VERSION, dev: 'phone-ios-safari-app' } });
const hB = await call('/api/ops/hello', { method: 'POST', who: B, body: { v: VERSION, dev: 'desktop-win-chrome' } });
ok(hA.flags && hA.flags.push_prompt && ['m3', 'm6'].includes(hA.flags.push_prompt.v) && hA.flags.push_prompt.log, `hello assigns flags (A: ${hA.flags && hA.flags.push_prompt && hA.flags.push_prompt.v})`);
ok((await call('/api/ops/hello', { method: 'POST', body: {} })).status === 401, 'hello needs an account');
const ex = await call('/api/ops/expose', { method: 'POST', who: A, body: { flags: { push_prompt: hA.flags.push_prompt.v } } });
const exWrong = await call('/api/ops/expose', { method: 'POST', who: B, body: { flags: { push_prompt: hB.flags.push_prompt.v === 'm3' ? 'm6' : 'm3' } } });
ok(ex.logged === 1 && exWrong.logged === 0, 'exposure logged only for the assigned variant');

// events
for (const ev of [{ ev: 'match_start', mode: 'ai', map: 'sakura' }, { ev: 'match_done', mode: 'ai', map: 'sakura', event: 'golden', len: 900 }, { ev: 'match_done', mode: 'rush_ai', map: 'rush_sakura', len: 300 }])
  await call('/api/ops/track', { method: 'POST', who: A, body: ev });
ok((await call('/api/ops/track', { method: 'POST', who: A, body: { ev: 'nope' } })).status === 400, 'unknown event rejected');

// crashes
const c1 = await call('/api/ops/crash', { method: 'POST', who: A, body: { kind: 'error', msg: 'x is undefined at 12', stack: 'at f (http://h/src/ui/hud.js?v=1:10:5)', v: VERSION, dev: 'phone-ios-safari-app' } });
const c2 = await call('/api/ops/crash', { method: 'POST', who: B, body: { kind: 'error', msg: 'x is undefined at 99', stack: 'at f (http://other/src/ui/hud.js:10:9)', v: VERSION, dev: 'desktop-win-chrome' } });
const c3 = await call('/api/ops/crash', { method: 'POST', body: { kind: 'desync', msg: 'Desync at tick 400', stack: `desync casual sakura classic v${VERSION}`, v: VERSION, dev: 'other' } });
ok(c1.hash && c1.hash === c2.hash && c3.hash && c3.hash !== c1.hash, 'crashes grouped by stack hash (and desyncs apart)');
ok(c1.sample === 1, 'not sampled while the group is quiet');
ok((await call('/api/ops/crash', { method: 'POST', who: A, body: { kind: 'error' } })).status === 400, 'empty crash rejected');

// feedback
const shot = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg'.repeat(20)).toString('base64');
ok((await call('/api/ops/feedback', { method: 'POST', who: A, body: { text: 'The minimap hides my hero on small phones', shot, meta: { screen: 'results', size: '844x390', mode: 'ai', err: 'x is undefined', errHash: c1.hash } } })).ok, 'feedback with a screenshot');
ok((await call('/api/ops/feedback', { method: 'POST', who: B, body: { text: 'no' } })).status === 400, 'too-short feedback rejected');

// a verified casual match → hero / plan / map / ban counters
const mid = 'OPS' + Date.now().toString(36).toUpperCase().slice(-8);
const summary = { picks: [['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], ['varro', 'gama', 'hex', 'bolt', 'frost']], bans: [['kenshi'], ['yuki']], plans: ['aggro', 'scale'], map: 'sakura', kills: [10, 5], len: 800 };
const rep = (who, side, opp) => call('/api/match/report', { method: 'POST', who, body: { match: mid, season: 1, side, opponent: opp.id, winner: 0, checksum: '123', mode: 'casual', summary } });
await rep(A, 0, B); const v = await rep(B, 1, A);
ok(v.status === 'verified', 'casual match verified');

// queue counters: A searches, B joins
const qa = await call('/api/queue/find', { method: 'POST', who: A, body: { version: VERSION, mode: 'casual', rating: 1000 } });
const qb = await call('/api/queue/find', { method: 'POST', who: B, body: { version: VERSION, mode: 'casual', rating: 1000 } });
ok(qa.status === 'waiting' && qb.status === 'matched', 'queue match');

// summary
const ru = await admin('/api/admin/ops/rollup', {});
ok(ru.days === 14 && ru.statements > 80, 'rollup ran (DAU / WAU / cohorts / retention + pruning)');
const S = await admin('/api/admin/ops/summary?days=7&season=1');
ok(S.live && S.live.dau >= 2 && S.live.new >= 2, `live DAU / new (${S.live && S.live.dau} / ${S.live && S.live.new})`);
ok(S.sums['ev:match_done:ai'] >= 1 && S.sums['map:sakura'] >= 1 && S.sums['event:golden'] >= 1 && S.sums['len:ai'] >= 900, 'matches by mode / map / event / length');
ok(S.sums['hg:bastion'] >= 1 && S.sums['hw:bastion'] >= 1 && S.sums['hb:kenshi'] >= 1 && S.sums['pw:aggro'] >= 1 && S.sums['vm:casual'] >= 1, 'hero picks / wins / bans and plan wins from verified matches');
ok(S.sums['qs:casual'] >= 2 && S.sums['qm:casual'] >= 1, 'queue searches and matches');
ok(S.sums['dev:phone-ios'] >= 1 && S.sums[`ver:${VERSION}`] >= 2, 'device classes and versions');
const grp = S.crashes.find((c) => c.hash === c1.hash);
ok(grp && grp.n >= 2 && /v\d+=/.test(grp.tags) && /phone-ios-safari-app/.test(grp.tags), 'crash group with counts and version / device tags');
const fb = S.feedback.find((f) => f.player === A.id);
ok(fb && fb.shot && fb.meta.screen === 'results' && fb.meta.errHash === c1.hash && fb.meta.dev, 'feedback listed with its meta (screenshot fetched separately)');
ok(S.flags.some((f) => f.key === 'push_prompt') && S.exposures.some((e) => e.flag === 'push_prompt' && e.n >= 1), 'flag and exposures in the summary');
ok(S.sums[`fx:push_prompt:${hA.flags.push_prompt.v}:match_done`] >= 2, 'events counted per flag variant of exposed players');
const det = await admin('/api/admin/ops/crash?hash=' + c1.hash);
ok(det.stack && det.tags.length >= 2 && det.daily.length >= 1, 'crash detail: stack, tags, daily counts');
const fbd = await admin('/api/admin/ops/feedback?id=' + fb.id);
ok(fbd.shot === shot, 'screenshot served to the owner');
ok((await admin('/api/admin/ops/feedback', { id: fb.id, status: 'done' })).ok, 'feedback marked done');
const H = await admin('/api/admin/ops/heroes?days=7');
ok(H.matches >= 1 && H.heroes.find((x) => x.hero === 'bastion' && x.games >= 1 && x.wins >= 1) && H.heroes.find((x) => x.hero === 'kenshi' && x.bans >= 1), 'hero results for the weekly balance job');

// ── Web Push ──
const key = (await call('/api/push/key')).key;
if (!key) console.log('  skip push: the Worker has no VAPID keys (see the header for the command)');
else {
  const subtle = globalThis.crypto.subtle, te = new TextEncoder();
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey)), authS = crypto.getRandomValues(new Uint8Array(16));
  const got = [];
  const srv = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: new Uint8Array(Buffer.concat(ch)) }); res.writeHead(req.url.includes('gone') ? 410 : 201); res.end(); }); });
  await new Promise((r) => srv.listen(8899, '127.0.0.1', r));
  const hk = async (salt, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const cat = (...p) => { const o = new Uint8Array(p.reduce((x, y) => x + y.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  async function decrypt(body) {
    const salt = body.slice(0, 16), asPub = body.slice(21, 86), ct = body.slice(86);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, ua.privateKey, 256));
    const ikm = await hk(authS, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
    const k = await subtle.importKey('raw', await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
    const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12) }, k, ct));
    return JSON.parse(new TextDecoder().decode(pt.slice(0, pt.length - 1)));
  }
  const sub = { endpoint: 'http://127.0.0.1:8899/push/' + B.id, keys: { p256dh: b64u(uaPub), auth: b64u(authS) } };
  ok(unb64u(key).length === 65, 'server VAPID key');
  const s1 = await call('/api/push/subscribe', { method: 'POST', who: B, body: { sub, types: 1 | 2 | 4 } });
  ok(s1.ok && s1.types === 7, 'B subscribed (invites, rematch, cup)');
  // friends, then an invite while B is away
  await call('/api/social/friend', { method: 'POST', who: A, body: { id: B.id, action: 'add' } });
  await call('/api/social/friend', { method: 'POST', who: B, body: { id: A.id, action: 'accept' } });
  const inv = await call('/api/invite', { method: 'POST', who: A, body: { to: B.id, room: 'ABCDE', mode: 'ranked' } });
  ok(inv.id, 'invite sent');
  for (let i = 0; i < 20 && !got.length; i++) await sleep(250);
  ok(got.length === 1, 'invite push delivered right after the response');
  if (got[0]) {
    const m = await decrypt(got[0].body);
    ok(got[0].headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=/.test(got[0].headers.authorization) && got[0].headers.urgency === 'high', 'aes128gcm + VAPID headers');
    ok(m.title === 'Opsa invites you' && m.url === `./?i=${inv.id}` && /Ranked/.test(m.body), `payload decrypts: "${m.title}" → ${m.url}`);
  }
  // B is in the app now: the next invite shows in-app only
  await call('/api/social/presence', { method: 'POST', who: B, body: {} });
  got.length = 0;
  await call('/api/invite', { method: 'POST', who: A, body: { to: B.id, room: 'ABCDF', mode: 'casual' } });
  await sleep(1500);
  ok(got.length === 0, 'no push while the coach is in the app');
  // rematch only for a match the two of them just played
  const rm = await call('/api/push/rematch', { method: 'POST', who: A, body: { to: B.id, match: mid } });
  const rmBad = await call('/api/push/rematch', { method: 'POST', who: A, body: { to: B.id, match: 'NOTAMATCH123' } });
  ok(rm.queued === true && rmBad.queued === false, 'rematch push only for a real shared match');
  for (let i = 0; i < 20 && !got.length; i++) await sleep(250);
  ok(got.length === 1 && (await decrypt(got[0].body)).t === 'rematch', 'rematch push delivered');
  // admin: broadcast pages, test push, dead endpoints
  const subs = await admin('/api/admin/push/subs?type=rematch&season=1');
  ok(subs.subs.some((x) => x.player === B.id), 'broadcast page lists opted-in devices');
  ok((await admin('/api/admin/push/subs?type=event&season=1')).subs.every((x) => x.player !== B.id), 'types respected (B is not opted into events)');
  got.length = 0;
  const t = await admin('/api/admin/push/test', { player: B.id });
  ok(t.devices === 1 && t.results[0].ok && got.length === 1, 'owner test push');
  const S2 = await admin('/api/admin/ops/summary?days=7&season=1');
  ok(S2.push.n >= 1 && S2.push.invite >= 1 && S2.push.rematch >= 1, 'push numbers in the summary');
  ok((await call('/api/push/unsubscribe', { method: 'POST', who: B, body: { endpoint: sub.endpoint } })).ok, 'unsubscribe');
  ok((await admin('/api/admin/push/subs?type=invite&season=1')).subs.every((x) => x.player !== B.id), 'unsubscribed device gone');
  srv.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
