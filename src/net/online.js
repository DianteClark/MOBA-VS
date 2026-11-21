// Online services client: account, cloud save, ladder reports, leaderboards, share links.
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
export async function leaderboard(season) { return call(`/api/leaderboard?season=${season | 0}`, { auth: !!account }); }

// ── share links ──
export async function createShare(kind, data) { return call('/api/share', { method: 'POST', body: { kind, data } }); }
export async function getShare(code) { return call(`/api/share/${encodeURIComponent(code)}`); }
export const shareUrl = (code) => `${API || loc.origin}/s/${code}`;
export const newMatchId = () => { let s = 'M'; const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(15)); for (const x of b) s += a[x % a.length]; return s; };

// ── matchmaking ──
export async function findQueue(body) { return call('/api/queue/find', { method: 'POST', auth: true, body }); }
export async function cancelQueue(ticket) { try { await call('/api/queue/cancel', { method: 'POST', auth: true, body: { ticket } }); } catch { /* best effort */ } }
