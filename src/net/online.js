// Online services client: account, cloud save, ladder reports, leaderboards, share links, friends, invites and Weekend Cups.
// Everything degrades gracefully: if the API is unreachable the game keeps working offline.
const WORKER = 'https://moba-vs.chesscomplex.workers.dev';
// Same-origin when served by the Worker; the GitHub Pages mirror talks to the Worker cross-origin.
const override = (() => { try { return localStorage.getItem('mobavs_api'); } catch { return null; } })();
const loc = typeof location !== 'undefined' ? location : { hostname: '', protocol: 'http:', origin: '' };
export const API = override !== null ? override : loc.hostname.endsWith('workers.dev') || loc.hostname.endsWith('pages.dev') || loc.protocol === 'https:' && !loc.hostname.endsWith('github.io') ? '' : WORKER;
const KEY = 'mobavs_account';

let account = null;
try { account = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { account = null; }
export const getAccount = () => account;
function setAccount(a) { account = a; try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* ignore */ } }

async function call(path, { method = 'GET', body, auth = false, timeout = 8000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { 'content-type': 'application/json' };
    if (auth && account) headers.authorization = `Bearer ${account.id}.${account.secret}`;
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  } finally { clearTimeout(t); }
}
export const online = { ok: false };
export async function ping() { try { const h = await call('/api/health', { timeout: 5000 }); online.ok = !!(h.db && h.tables); } catch { online.ok = false; } return online.ok; }

// ── account ──
export async function ensureAccount(name) {
  if (account) return account;
  const a = await call('/api/account', { method: 'POST', body: { name } });
  setAccount({ id: a.id, secret: a.secret, code: a.code });
  return account;
}
export async function recover(code) {
  const a = await call('/api/recover', { method: 'POST', body: { code } });
  setAccount({ id: a.id, secret: a.secret, code: a.code });
  return a; // { name, profile, profileAt }
}
export async function fetchMe() { return account ? call('/api/me', { auth: true }) : null; }

// Cloud save: debounced upload of the whole profile blob (+ coach name).
let saveTimer = 0, pending = null;
export function queueCloudSave(name, profile, at) {
  if (!account) return;
  pending = { name, profile, at };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { const p = pending; pending = null; try { await call('/api/profile', { method: 'PUT', auth: true, body: p }); } catch { /* retry on next save */ } }, 2500);
}

// ── ladder ──
export async function reportMatch(r) { return account ? call('/api/match/report', { method: 'POST', auth: true, body: r }) : null; }
export async function matchStatus(id) { return call(`/api/match/status?id=${encodeURIComponent(id)}`); }
// Pages of 50: pass the previous page's `next` cursor and how many rows are already shown. friends: rank among friends.
export async function leaderboard(season, { after = null, from = 0, friends = false } = {}) {
  const q = `season=${season | 0}${after ? `&after=${encodeURIComponent(after)}&from=${from | 0}` : ''}${friends ? '&friends=1' : ''}`;
  return call(`/api/leaderboard?${q}`, { auth: !!account });
}

// ── share links ──
export async function createShare(kind, data) { return call('/api/share', { method: 'POST', body: { kind, data } }); }
export async function getShare(code) { return call(`/api/share/${encodeURIComponent(code)}`); }
export const shareUrl = (code) => `${API || loc.origin}/s/${code}`;
export const newMatchId = () => { let s = 'M'; const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(15)); for (const x of b) s += a[x % a.length]; return s; };

// ── matchmaking ──
export async function findQueue(body) { return call('/api/queue/find', { method: 'POST', auth: true, body }); }
export async function cancelQueue(ticket) { try { await call('/api/queue/cancel', { method: 'POST', auth: true, body: { ticket } }); } catch { /* best effort */ } }
// 2v2 (worker/duo.js): a party of one or two; party = the partner's player id.
export async function findDuo(body) { return call('/api/queue2/find', { method: 'POST', auth: true, body }); }
export async function cancelDuo(ticket) { try { await call('/api/queue2/cancel', { method: 'POST', auth: true, body: { ticket } }); } catch { /* best effort */ } }

// ── social: friends, presence, invites, public profiles ──
// Friend codes are the public player id shown as XXXXX-XXXXX (never the secret).
export const friendCode = (id) => (id ? `${id.slice(0, 5)}-${id.slice(5)}` : '');
// Heartbeat + inbox (friends with presence, requests, blocks, live invites). status: 'menu' | 'match'.
export async function presence(status = 'menu') { return account ? call('/api/social/presence', { method: 'POST', auth: true, body: { status } }) : null; }
// action: add | accept | decline | remove | block | unblock; id: player id or friend code.
export async function friendAction(action, id) { return call('/api/social/friend', { method: 'POST', auth: true, body: { action, id } }); }
export async function playerProfile(id, season) { return call(`/api/player/${encodeURIComponent(id)}?season=${season | 0}`, { auth: !!account }); }
// to: a friend's id, or null for a shareable link invite. mode: casual | ranked | rush.
export async function createInvite(room, mode, to = null) { return call('/api/invite', { method: 'POST', auth: true, body: { room, mode, to } }); }
export async function getInvite(id) { return call(`/api/invite/${encodeURIComponent(id)}`); }
export async function respondInvite(id, accept) { return call('/api/invite/respond', { method: 'POST', auth: true, body: { id, accept } }); }
export async function cancelInvites(room) { if (!account) return; try { await call('/api/invite/cancel', { method: 'POST', auth: true, body: { room } }); } catch { /* best effort */ } }
export const inviteUrl = (id) => `${API || loc.origin}/i/${id}`;

// ── Weekend Cups (worker/cups.js) ──
// State of your cup (or the open sign-up list for your version); polling it also keeps your sign-up alive.
export async function cupState(version) { return call(`/api/cup?v=${version | 0}`, { auth: true }); }
export async function cupJoin(version) { return call('/api/cup/join', { method: 'POST', auth: true, body: { version } }); }
export async function cupLeave() { try { await call('/api/cup/leave', { method: 'POST', auth: true, body: {} }); } catch { /* best effort */ } }
export async function cupReady(cup) { return call('/api/cup/ready', { method: 'POST', auth: true, body: { cup } }); }
export async function cupHistory() { return call('/api/cup/history', { auth: true }); }
// Pro League predictions (worker/pro.js): the week's board, and locking in one matchday's picks (one write).
export async function proBoard(week) { return call(`/api/pro?w=${week | 0}`, { auth: !!account }); }
export async function proSend(week, day, picks) { return call('/api/pro/picks', { method: 'POST', auth: true, body: { w: week, day, picks } }); }
