// The last few matches on this device: replay (config + command log) plus its analytics record.
// Local only (not cloud-saved). A history entry links to its match by `id` (the history entry's time).
// Analytics stay readable after a game update; the replay itself only plays on the same sim VERSION.
const KEY = 'mobavs_replays', LEGACY = 'mobavs_replay', MAX = 8;

export function loadLib() {
  try {
    const lib = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(lib) && lib.length) return lib;
    const old = JSON.parse(localStorage.getItem(LEGACY) || 'null'); // single replay saved by older builds
    return old && old.cfg ? [{ id: old.t, ...old }] : [];
  } catch { return []; }
}
export function storeMatch(entry) {
  const lib = [entry, ...loadLib().filter((e) => e.id !== entry.id)].slice(0, MAX);
  while (lib.length) {
    try { localStorage.setItem(KEY, JSON.stringify(lib)); localStorage.removeItem(LEGACY); return true; } catch { lib.pop(); } // storage full: drop the oldest
  }
  return false;
}
export const findMatch = (id) => (id ? loadLib().find((e) => e.id === id) || null : null);
// Add analytics to a stored match (a replay analysed later in the Theater).
export function addAnalytics(id, A) {
  const lib = loadLib(), e = lib.find((x) => x.id === id); if (!e || e.A) return;
  e.A = A; try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch { /* full: keep it in memory only */ }
}
