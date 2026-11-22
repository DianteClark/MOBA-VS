// Live-ops client: crash reports, sim desync reports, launch "hello" (activity + A/B flags), match events and
// feedback (worker/ops.js). Everything is fire-and-forget and silent when offline.
//
// Privacy: reports carry the account id (when signed in), the game version and a coarse device class such as
// "phone-ios-safari-app". No user agent string, no names, no location, no free text except feedback the player writes.
//
// Flags are for UI / UX only. Never read a flag inside src/sim, and never let one change a lockstep match: an
// experiment that must change the sim has to travel in the match cfg from the host (both peers then agree,
// and replays / tools/verify.mjs see it). tools/ops_test.mjs checks that src/sim never imports this file.
import { API, getAccount } from './online.js';

const SESSION_CAP = 8;     // crash reports per launch
const LS_FLAGS = 'mobavs_flags', LS_RATE = 'mobavs_crash_rate';
let version = 0, lastErr = null, sentN = 0;
const sentHashes = new Set();

export function deviceClass() {
  try {
    const ua = navigator.userAgent || '', touch = navigator.maxTouchPoints > 1;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
    const os = ios ? 'ios' : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'win' : /Mac OS X/.test(ua) ? 'mac' : /CrOS/.test(ua) ? 'chromeos' : /Linux/.test(ua) ? 'linux' : 'other';
    const br = /Edg\//.test(ua) ? 'edge' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /SamsungBrowser/.test(ua) ? 'samsung' : /Chrome\/|CriOS/.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
    const short = Math.min(screen.width, screen.height);
    const form = !touch && !matchMedia('(pointer: coarse)').matches ? 'desktop' : short < 600 ? 'phone' : 'tablet';
    const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '-app' : '';
    return `${form}-${os}-${br}${app}`;
  } catch { return 'other'; }
}

function post(path, body, authed = true) {
  try {
    const headers = { 'content-type': 'application/json' }, a = getAccount();
    if (authed && a) headers.authorization = `Bearer ${a.id}.${a.secret}`;
    return fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body), keepalive: JSON.stringify(body).length < 60000 })
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'HTTP ' + r.status))), () => Promise.reject(new Error('HTTP ' + r.status))));
  } catch (e) { return Promise.reject(e); }
}

// ── crashes ──
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const groupKey = (kind, msg, stack) => fnv(kind + String(msg).replace(/\d+/g, 'N') + String(stack || '').split('\n').slice(0, 4).join('|').replace(/:\d+(?=\D*$)/gm, ''));
function rates() { try { return JSON.parse(localStorage.getItem(LS_RATE) || '{}'); } catch { return {}; } }
function report(kind, msg, stack) {
  msg = String(msg || '').slice(0, 300); stack = String(stack || '').slice(0, 2000);
  if (!msg && !stack) return;
  if (/^Script error\.?$/.test(msg) && !stack) return; // cross-origin noise, nothing to act on
  if (/ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|webkit-masked-url/.test(msg + stack)) return;
  const key = groupKey(kind, msg, stack);
  lastErr = { msg, key, at: Date.now() };
  if (sentHashes.has(key) || sentN >= SESSION_CAP) return;
  sentHashes.add(key);
  // a busy group is sampled: the server says so, and the 1-in-N report that does go out counts N times
  const r = rates(), rate = r[key] && r[key].until > Date.now() ? r[key].rate : 1;
  if (rate < 1 && Math.random() >= rate) return;
  sentN++;
  post('/api/ops/crash', { kind, msg, stack, v: version, dev: deviceClass(), w: Math.round(1 / rate) }).then((d) => {
    lastErr.hash = d.hash;
    const all = rates(); all[key] = { rate: d.sample < 1 ? d.sample : 1, until: Date.now() + 86400000 };
    for (const k of Object.keys(all)) if (all[k].until < Date.now()) delete all[k];
    try { localStorage.setItem(LS_RATE, JSON.stringify(all)); } catch { /* ignore */ }
  }, () => {});
}
export function installCrashReporter(v) {
  version = v;
  window.addEventListener('error', (e) => { try { if (e.error || e.message) report('error', e.message || String(e.error), (e.error && e.error.stack) || (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : '')); } catch { /* never throw from the reporter */ } });
  window.addEventListener('unhandledrejection', (e) => { try { const r = e.reason; report('rejection', r && r.message ? r.message : String(r), r && r.stack ? r.stack : ''); } catch { /* ignore */ } });
}
// Lockstep checksums disagreed: grouped by mode, map and event (the tick number is kept in the message).
export function reportDesync({ tick, mode, map, event }) { report('desync', `Desync at tick ${tick}`, `desync ${mode || 'online'} ${map || '?'} ${event || 'classic'} v${version}`); }
export const lastError = () => lastErr;

// ── launch hello: activity + flags ──
let flags = (() => { try { return JSON.parse(localStorage.getItem(LS_FLAGS) || '{}') || {}; } catch { return {}; } })();
const exposed = new Set(), pendingExpo = {};
let expoTimer = 0;
export async function opsHello(v) {
  version = v || version;
  try {
    const d = await post('/api/ops/hello', { v: version, dev: deviceClass() });
    flags = d.flags && typeof d.flags === 'object' ? d.flags : {};
    try { localStorage.setItem(LS_FLAGS, JSON.stringify(flags)); } catch { /* ignore */ }
  } catch { /* offline: keep the last assignment */ }
}
// The variant this player is in (or `fallback` when the flag is off / unknown). The first use per launch logs
// an exposure, so the dashboard compares only players who actually saw a variant.
export function flag(key, fallback) {
  const f = flags[key]; if (!f || typeof f.v !== 'string') return fallback;
  if (f.log && !exposed.has(key) && getAccount()) {
    exposed.add(key); pendingExpo[key] = f.v;
    clearTimeout(expoTimer);
    expoTimer = setTimeout(() => { const b = { ...pendingExpo }; for (const k of Object.keys(pendingExpo)) delete pendingExpo[k]; post('/api/ops/expose', { flags: b }).catch(() => {}); }, 1500);
  }
  return f.v;
}

// ── events ──
// The dashboard's mode names for a session (src/main.js App.session).
export function modeKey(s) {
  if (!s) return null;
  if (s.mode === 'watch') return 'watch';
  if (s.mode === 'coop') return 'coop';
  if (s.mode === 'ai' && !s.wasOnline) return s.cup ? 'cup_ai' : s.gameMode === 'rush' ? 'rush_ai' : 'ai';
  if (s.wcup) return 'cup';
  if (s.queue === 'ranked' && s.ranked) return 'ranked';
  if (s.queue === 'private' || !s.queue) return 'private';
  return s.gameMode === 'rush' ? 'rush' : 'casual';
}
export function track(ev, data = {}) { if (getAccount()) post('/api/ops/track', { ev, ...data }).catch(() => {}); }

// ── feedback ──
export function sendFeedback({ text, shot, meta }) {
  return post('/api/ops/feedback', { text, shot: shot || null, meta: { v: version, dev: deviceClass(), ...meta, err: lastErr ? lastErr.msg : null, errHash: lastErr && lastErr.hash ? lastErr.hash : null } });
}
export const opsVersion = () => version;
