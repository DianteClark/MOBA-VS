// Clubs and the Replay Hub: the Worker client (worker/clubs.js, worker/hub.js). Like src/net/divisions.js it
// has its own small fetch helper (errors carry the server's message), so src/net/online.js stays untouched.
import { API, getAccount } from './online.js';

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const a = getAccount();
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (auth && a) headers.authorization = `Bearer ${a.id}.${a.secret}`;
    const r = await fetch(API + path, { method, signal: ctl.signal, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  } finally { clearTimeout(t); }
}
// ── clubs ──
export const myClub = () => call('/api/club');
export const clubByCode = (code) => call(`/api/club/code/${encodeURIComponent(code)}`);
export const clubLadder = () => call('/api/club/ladder');
export const createClub = (name, tag, crest) => call('/api/club/create', { method: 'POST', body: { name, tag, crest } });
export const joinClub = (code) => call('/api/club/join', { method: 'POST', body: { code } });
export const leaveClub = () => call('/api/club/leave', { method: 'POST', body: {} });
export const clubChat = (line) => call('/api/club/chat', { method: 'POST', body: { line } });
export const clubEdit = (b) => call('/api/club/edit', { method: 'POST', body: b });
export const clubMember = (id, action) => call('/api/club/member', { method: 'POST', body: { id, action } });
// ── Replay Hub ──
export const hubList = (list = 'week') => call(`/api/hub${list === 'new' ? '?list=new' : ''}`);
export const hubPublish = (replay, meta) => call('/api/hub/publish', { method: 'POST', body: { replay, meta } });
export const hubVote = (code) => call('/api/hub/vote', { method: 'POST', body: { code } });
