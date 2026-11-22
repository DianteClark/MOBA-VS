// Koban purchases and the launch wipe against a real local Worker (wrangler dev + local D1):
//   npx --yes wrangler@4 dev --local --port 8846 --ip 127.0.0.1 --persist-to /tmp/kobandb --var MOBAVS_ADMIN:local-test-token-0123456789
//   node tools/koban_wrangler.mjs [http://127.0.0.1:8846]
// Use a fresh --persist-to dir. The full rule matrix (claim bounds, races, seeds) is tools/koban_test.mjs.
import assert from 'node:assert/strict';
import { ECON, STARTERS, ALL_IDS, tierOf, priceOf, RANKED_OWNED } from '../src/data/unlocks.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8846', TOKEN = 'local-test-token-0123456789';
const api = async (path, { method = 'GET', body, who, token } = {}) => {
  for (let i = 0; ; i++) {
    try {
      const headers = { 'content-type': 'application/json' };
      if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
      if (token) headers.authorization = `Bearer ${token}`;
      const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    } catch (e) { if (i > 4) throw e; await new Promise((res) => setTimeout(res, 800)); } // wrangler reloads drop connections
  }
};
const ok = (label) => console.log('  ✔ ' + label);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let r = await api('/api/health'); assert.equal(r.data.tables, true, JSON.stringify(r.data)); ok(`health (dv ${r.data.dv})`);
const A = (await api('/api/account', { method: 'POST', body: { name: 'Ann' } })).data, B = (await api('/api/account', { method: 'POST', body: { name: 'Ben' } })).data;
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: 'morel' } }); assert.equal(r.status, 409); ok('buy before the ledger exists: refused');
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [] } }); assert.equal(r.data.fresh, true); assert.equal(r.data.state.bal, 0);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: Date.now() }] } });
assert.equal(r.data.state.bal, ECON.win * 2 + ECON.firstWin); ok(`a won match pays ${r.data.state.bal} (rookie x2 + first win), computed by the server`);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: Date.now() }] } }); assert.equal(r.data.credited, 0); ok('a second claim within 90 s pays nothing');
const gen = ALL_IDS.find((id) => tierOf(id) === 'G' && !STARTERS.includes(id));
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: gen } }); assert.equal(r.status, 400); assert.match(r.data.error, /more Koban/); ok(`buy ${gen} (${priceOf(gen)}) with ${ECON.win * 2 + ECON.firstWin}: refused`);
// a forged client-side balance in a sync body is ignored (claims only, no seed on an existing ledger)
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { seed: { bal: 99999, own: ALL_IDS }, claims: [{ k: 'm', won: true, t: Date.now() + 3600000 }] } });
assert.equal(r.data.state.bal, ECON.win * 2 + ECON.firstWin); assert.equal(r.data.state.own.length, 0); ok('a forged seed / future claim on an existing ledger changes nothing');
// earn enough the honest way: an offline coach seeds a new account once (bounded)
r = await api('/api/koban/sync', { method: 'POST', who: B, body: { seed: { bal: 5000, own: [], g: 40, lv: 6 }, claims: [] } });
assert.equal(r.data.state.bal, 5000);
r = await api('/api/koban/buy', { method: 'POST', who: B, body: { hero: gen } }); assert.equal(r.status, 200); assert.equal(r.data.state.bal, 5000 - priceOf(gen)); assert.ok(r.data.state.own.includes(gen));
r = await api('/api/koban/buy', { method: 'POST', who: B, body: { hero: gen } }); assert.equal(r.status, 400); ok('buy: balance and ownership checked, no double buy');
const spec = ALL_IDS.find((id) => tierOf(id) === 'S');
r = await api('/api/koban/pick', { method: 'POST', who: B, body: { hero: spec } }); assert.equal(r.status, 400);
const gen2 = ALL_IDS.find((id) => tierOf(id) === 'G' && !STARTERS.includes(id) && id !== gen);
r = await api('/api/koban/pick', { method: 'POST', who: B, body: { hero: gen2 } }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.state.picks, 1);
r = await api('/api/koban/pick', { method: 'POST', who: B, body: { hero: gen2 } }); assert.equal(r.status, 400); ok('free pick: a General at coach level 4+, not a Specialist, once per pick');
r = await api('/api/queue/find', { method: 'POST', who: B, body: { version: 1, mode: 'ranked' } }); assert.equal(r.status, 403); assert.match(r.data.error, new RegExp(String(RANKED_OWNED)));
ok('Ranked queue refused below 25 owned');
// wipe
r = await api('/api/admin/wipe', { method: 'POST', body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 404);
let calls = 0;
do { r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 200, JSON.stringify(r.data)); calls++; await sleep(100); } while (!r.data.done && calls < 20);
r = await api('/api/admin/wipe', { token: TOKEN }); assert.equal(r.data.dv, 2); assert.equal(r.data.counts.players, 0); assert.equal(r.data.counts.koban, 0);
r = await api('/api/koban', { who: B }); assert.equal(r.status, 401);
r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.data.done, true);
ok(`wipe on D1: ${calls} calls, tables emptied (archived to *_beta), old accounts gone, re-run is a no-op`);
console.log('KOBAN WRANGLER TEST OK');
