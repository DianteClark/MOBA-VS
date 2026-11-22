// Web Push broadcasts and VAPID keys (worker/push.js on Node's WebCrypto).
//
//   node tools/push.mjs --keys                       print a fresh VAPID key pair and the setup commands
//   node tools/push.mjs --event [--dry]              "This week: <event>" to every device opted into weekly events
//   node tools/push.mjs --division [--dry]           each Ranked coach's week: tier, division and rating change
//   env: MOBAVS_API, MOBAVS_ADMIN, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
//
// Broadcasts go to every opted-in device, which does not fit a free-plan Worker invocation (~10 ms CPU,
// ~0.6 ms per encrypted message), so .github/workflows/push.yml runs this every Monday instead. Subscriptions
// come in pages of 200 from the token-protected /api/admin/push/subs; dead endpoints (404 / 410) and the
// coaches' weekly rating snapshots go back to /api/admin/push/done.
import { generateVapidKeys, sendPush, message } from '../worker/push.js';
import { weekEvent } from '../src/data/events.js';
import { seasonAt, rankOf } from '../src/data/seasons.js';

const has = (k) => process.argv.includes('--' + k);
const dry = has('dry');

if (has('keys')) {
  const k = await generateVapidKeys();
  console.log(`VAPID_PUBLIC=${k.publicKey}\nVAPID_PRIVATE=${k.privateKey}\n`);
  console.log('Worker (from the repo root):');
  console.log('  npx wrangler secret put VAPID_PUBLIC      # paste VAPID_PUBLIC');
  console.log('  npx wrangler secret put VAPID_PRIVATE     # paste VAPID_PRIVATE');
  console.log('  npx wrangler secret put VAPID_SUBJECT     # mailto:you@yourdomain or https://your-site');
  console.log('GitHub: Settings → Secrets and variables → Actions → the same three as repository secrets.');
  console.log('Keep VAPID_PRIVATE secret. Changing the pair later silently breaks every existing subscription.');
  process.exit(0);
}

const API = (process.env.MOBAVS_API || '').replace(/\/$/, ''), TOKEN = (process.env.MOBAVS_ADMIN || '').trim();
const vapid = { publicKey: (process.env.VAPID_PUBLIC || '').trim(), privateKey: (process.env.VAPID_PRIVATE || '').trim(), subject: process.env.VAPID_SUBJECT || 'mailto:owner@example.invalid' };
if (!API || !TOKEN) { console.error('set MOBAVS_API and MOBAVS_ADMIN'); process.exit(2); }
if (!dry && (!vapid.publicKey || !vapid.privateKey)) { console.error('set VAPID_PUBLIC and VAPID_PRIVATE (node tools/push.mjs --keys)'); process.exit(2); }
const api = async (path, body) => {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

// One message per subscription, 8 at a time. msgFor(sub) → payload or null (skip).
async function broadcast(type, msgFor, { season = 0, snapshot = false } = {}) {
  let after = '', pages = 0, sent = 0, skipped = 0, failed = 0;
  const byPlayer = new Map(); // one decision per coach: devices on later pages must not see this run's snapshot
  do {
    const page = await api(`/api/admin/push/subs?type=${type}&season=${season}&after=${encodeURIComponent(after)}`);
    const gone = [], wk = new Map();
    const subs = page.subs, q = subs.slice();
    const run = async () => {
      for (let s; (s = q.shift());) {
        if (!byPlayer.has(s.player)) byPlayer.set(s.player, msgFor(s));
        const msg = byPlayer.get(s.player);
        if (!msg) { skipped++; continue; }
        if (snapshot && s.rating !== null && s.rating !== undefined) wk.set(s.player, s.rating);
        if (dry) { sent++; continue; }
        try { const r = await sendPush(s, msg, vapid, { ttl: 86400, topic: msg.tag }); if (r.ok) sent++; else { failed++; if (r.gone) gone.push(s.endpoint); } } catch { failed++; }
      }
    };
    await Promise.all(Array.from({ length: 8 }, run));
    if (!dry && (gone.length || wk.size)) await api('/api/admin/push/done', { gone, wk: [...wk].map(([player, rating]) => ({ player, rating })) });
    after = page.next; pages++;
  } while (after && pages < 500);
  console.log(`${type}: ${dry ? 'would send' : 'sent'} ${sent}, skipped ${skipped}, failed ${failed}`);
}

if (has('event')) {
  const { ev } = weekEvent(Date.now());
  await broadcast('event', () => message('event', { name: ev.name, blurb: `${ev.short}. ${ev.ranked ? 'Ranked plays it too.' : 'Ranked stays Classic.'}` }));
}
if (has('division')) {
  // Monday morning: last week's season (a season can roll over on Monday itself)
  const season = seasonAt(Date.now() - 86400000).id;
  await broadcast('division', (s) => {
    if (s.rating === null || s.rating === undefined) return null; // no Ranked games this season
    if (s.wk !== null && s.wk !== undefined && s.wk === s.rating) return null; // nothing changed this week: no ping
    const r = rankOf(s.rating), d = s.wk === null || s.wk === undefined ? null : s.rating - s.wk;
    const was = d === null ? null : rankOf(s.wk);
    const moved = was && was.label !== r.label ? (s.rating > s.wk ? ` Up to ${r.label}!` : ` Down to ${r.label}.`) : '';
    return message('division', { title: `Your week in Ranked: ${r.label}`, body: `${d === null ? `Rating ${r.elo}` : `${d > 0 ? '+' : ''}${d} rating this week (now ${r.elo})`}.${moved} Season record ${s.wins || 0}W ${s.losses || 0}L.` });
  }, { season, snapshot: true });
}
if (!has('event') && !has('division')) { console.error('nothing to do: pass --keys, --event or --division'); process.exit(2); }
