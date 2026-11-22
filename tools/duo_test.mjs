// 2v2 matchmaking (worker/duo.js) against a local Worker: pairing shapes, sides, host, versions, cancel, expiry.
//   npx --yes wrangler@4 dev --local --port 8858 --ip 127.0.0.1 --persist-to <fresh dir>   (repo root)
//   node tools/duo_test.mjs http://127.0.0.1:8858
// Also unit-checks the pure helpers (pickTickets / sidesOf) without a Worker: node tools/duo_test.mjs --unit
import { pickTickets, sidesOf } from '../worker/duo.js';

let bad = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) bad++; };

// ── pure helpers ──
{
  const T = (id, size, created, leader = id, members = []) => ({ id, size, created, leader, members: JSON.stringify(members) });
  ok(JSON.stringify(pickTickets([T('a', 1, 1), T('b', 2, 2), T('c', 1, 3)], 3).map((t) => t.id)) === '["a","b"]', 'pick: oldest tickets that fill the match (1+2)');
  ok(JSON.stringify(pickTickets([T('a', 2, 1), T('b', 2, 2), T('c', 1, 3)], 2).map((t) => t.id)) === '["a"]', 'pick: a party of two fills an open side');
  ok(JSON.stringify(pickTickets([T('a', 2, 1), T('b', 1, 2)], 1).map((t) => t.id)) === '["b"]', 'pick: skips a party that does not fit');
  ok(pickTickets([T('a', 2, 1)], 3) === null, 'pick: not enough coaches → no match');
  ok(pickTickets([T('p', 2, 1, 'L', ['M']), T('m', 1, 2, 'M')], 3, ['Z']) === null, 'pick: a coach is never counted twice (party mate with a solo ticket)');
  const s = sidesOf([T('s1', 1, 1), T('p', 2, 2, 'L', ['M']), T('s2', 1, 3)]);
  ok(s.L === s.M && s.s1 === s.s2 && s.L !== s.s1, `sides: the party together, the two solo coaches together (${JSON.stringify(s)})`);
  const q = sidesOf([T('a', 1, 1), T('b', 1, 2), T('c', 1, 3), T('d', 1, 4)]);
  ok(q.a === q.b && q.c === q.d && q.a !== q.c, 'sides: four solo coaches paired in queue order');
}
if (process.argv.includes('--unit')) { console.log(bad ? `DUO UNIT FAILED ✘ (${bad})` : 'DUO UNIT OK ✔'); process.exit(bad ? 1 : 0); }

const BASE = (process.argv[2] || 'http://127.0.0.1:8858').replace(/\/$/, '');
const call = async (path, { body, auth } = {}) => {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth.id}.${auth.secret}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const acct = async (name) => (await call('/api/account', { body: { name } })).data;
const V = 900000 + Math.floor(Math.random() * 99999); // a version of our own, so leftovers of other runs never pair with us
const find = (a, extra = {}) => call('/api/queue2/find', { auth: a, body: { version: V, ...extra } }).then((r) => r.data);

const P = await Promise.all(['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'].map(acct));
const [A, B, C, D, E, F, G, H] = P;
ok(P.every((x) => x.id && x.secret), 'eight accounts');

// 2 + 1 + 1: a party (A with B) and two solo coaches
let ra = await find(A, { party: [B.id] });
ok(ra.status === 'waiting' && ra.ticket, 'party ticket waits');
let rc = await find(C);
ok(rc.status === 'waiting', 'a solo coach waits (3 of 4)');
let rd = await find(D);
ok(rd.status === 'matched', 'the fourth coach completes the match');
ra = await find(A, { ticket: ra.ticket }); rc = await find(C, { ticket: rc.ticket });
ok(ra.status === 'matched' && rc.status === 'matched' && ra.code === rd.code && rc.code === rd.code && /^[A-Z]{5}$/.test(rd.code), 'every ticket gets the same room code');
ok(ra.role === 'host' && rc.role === 'join' && rd.role === 'join' && rd.host === A.id, 'the oldest ticket\'s leader hosts');
const t = rd.teams;
ok(t[A.id] === t[B.id] && t[C.id] === t[D.id] && t[A.id] !== t[C.id] && Object.keys(t).length === 4, 'party on one side, solo coaches paired on the other');

// 2 + 2
let re = await find(E, { party: [F.id] });
let rg = await find(G, { party: [H.id] });
ok(re.status === 'waiting' && rg.status === 'matched' && rg.role === 'join', 'two parties of two match at once');
re = await find(E, { ticket: re.ticket });
ok(re.status === 'matched' && re.role === 'host' && re.teams[E.id] === re.teams[F.id] && re.teams[G.id] === re.teams[H.id] && re.teams[E.id] !== re.teams[G.id], 'each party on its own side (2+2)');

// 1 + 1 + 1 + 1, and a different version never pairs
const W = await Promise.all(['W1', 'W2', 'W3', 'W4', 'X1'].map(acct));
const w1 = await find(W[0]), x1 = await call('/api/queue2/find', { auth: W[4], body: { version: V + 1 } }).then((r) => r.data);
const w2 = await find(W[1]), w3 = await find(W[2]);
ok(w1.status === 'waiting' && w2.status === 'waiting' && w3.status === 'waiting' && x1.status === 'waiting', 'three solo coaches wait (another version waits apart)');
const w4 = await find(W[3]);
ok(w4.status === 'matched' && w4.host === W[0].id && w4.teams[W[0].id] === w4.teams[W[1].id] && w4.teams[W[2].id] === w4.teams[W[3].id] && !(W[4].id in w4.teams), 'four solo coaches: two sides in queue order, other version left out');
await call('/api/queue2/cancel', { auth: W[4], body: { ticket: x1.ticket } });

// a party can not queue itself twice / a mate is never matched against their own leader
const Y = await Promise.all(['Y1', 'Y2', 'Y3'].map(acct));
const y1 = await find(Y[0], { party: [Y[1].id] }), y2 = await find(Y[1]), y3 = await find(Y[2]);
ok(y1.status === 'waiting' && y2.status === 'waiting' && y3.status === 'waiting', 'a party mate searching alone is not counted twice with their own party');
for (const [a, r] of [[Y[0], y1], [Y[1], y2], [Y[2], y3]]) await call('/api/queue2/cancel', { auth: a, body: { ticket: r.ticket } });

// cancel, unknown tickets, auth, rate of polls
const z = await acct('Zed');
const z1 = await find(z);
await call('/api/queue2/cancel', { auth: z, body: { ticket: z1.ticket } });
ok((await find(z, { ticket: z1.ticket })).status === 'expired', 'a cancelled ticket is expired');
ok((await call('/api/queue2/find', { body: { version: V } })).status === 401, 'unauthorised search refused');
const h = (await call('/api/health')).data;
ok(h.tables === true && !h.missing.includes('duo_queue'), 'health lists the duo_queue table');

console.log(bad ? `DUO FAILED ✘ (${bad})` : 'DUO OK ✔');
process.exit(bad ? 1 : 0);
