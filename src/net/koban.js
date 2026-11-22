// Koban client (Worker: worker/koban.js). Signed-in coaches keep their champion ledger on the server: earnings
// are synced as claims, purchases and free picks are validated there (src/unlocks.js decides when to call).
import { API, getAccount } from './online.js';

export const kobanSignedIn = () => !!getAccount();
async function call(path, opts = {}) {
  const a = getAccount(); if (!a) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(API + path, { method: opts.method || 'GET', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.id}.${a.secret}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: data.error || `HTTP ${r.status}`, status: r.status };
    return data;
  } catch { return null; } finally { clearTimeout(t); }
}
export const kobanGet = () => call('/api/koban');
export const kobanSync = (body) => call('/api/koban/sync', { method: 'POST', body });
export const kobanBuy = (hero) => call('/api/koban/buy', { method: 'POST', body: { hero } });
export const kobanPick = (hero) => call('/api/koban/pick', { method: 'POST', body: { hero } });
