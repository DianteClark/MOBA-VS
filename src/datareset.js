// Launch data reset: runs before anything else loads (the first import of src/main.js). When the code's
// DATA_VERSION (src/data/unlocks.js) is newer than this browser's, the local profile, match history, replays,
// Franchise save and account are cleared once, so the coach starts fresh with the 15 starters (the Worker's
// matching wipe archives the server tables: worker/koban.js). Device settings (language, sound, display,
// queue choices, notification opt-ins) and the coach name are kept. A browser that never stored a version
// counts as version 1 (the beta), so nothing is cleared until the launch bumps the number.
import { DATA_VERSION } from './data/unlocks.js';

const KEY = 'mobavs_dv';
const KEEP = new Set(['mobavs_settings', 'mobavs_lang', 'mobavs_muted', 'mobavs_name', 'mobavs_queue', 'mobavs_qsize', 'mobavs_ai', 'mobavs_noevent',
  'mobavs_push_types', 'mobavs_push_prompt', 'mobavs_offline_ready', 'mobavs_api', 'mobavs_admin', 'mobavs_i18n_miss', 'mobavs_crash_rate', 'mobavs_spec', 'mobavs_bcast', KEY]);
function resetIfNeeded(ls = globalThis.localStorage) {
  try {
    if (!ls) return false;
    const have = Number(ls.getItem(KEY)) || 1;
    if (have >= DATA_VERSION) { if (!ls.getItem(KEY)) ls.setItem(KEY, String(DATA_VERSION)); return false; }
    const keys = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith('mobavs_') && !KEEP.has(k)) keys.push(k); }
    for (const k of keys) ls.removeItem(k);
    ls.setItem(KEY, String(DATA_VERSION));
    // a one-time welcome note (src/main.js), only for a coach who really had beta data (a brand-new player gets the Coach Academy card instead)
    if (keys.length) try { sessionStorage.setItem('mobavs_reset', '1'); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}
resetIfNeeded();
