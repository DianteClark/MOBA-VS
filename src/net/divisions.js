// Weekly Divisions client (Worker: worker/divisions.js). Signed-in coaches report each finished match and read
// their group; the answer is folded into the local mirror (src/meta.js adoptDivision). Offline or signed out,
// the division is played locally against the AI seats only.
import { API, getAccount } from './online.js';

async function call(path, opts = {}) {
  const a = getAccount(); if (!a) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(API + path, { method: opts.method || 'GET', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.id}.${a.secret}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
let cache = null, cacheAt = 0;
// The coach's group this week (cached for a minute; null when signed out or offline).
export async function fetchDivision(force = false) {
  if (!force && cache && Date.now() - cacheAt < 60000) return cache;
  const r = await call('/api/div'); if (r) { cache = r; cacheAt = Date.now(); }
  return r;
}
export async function reportDivision(won, calls) {
  const r = await call('/api/div/report', { method: 'POST', body: { won: !!won, calls: calls | 0 } });
  if (r) { cache = r; cacheAt = Date.now(); }
  return r;
}
export const divisionCache = () => cache;
