// Push notifications (Web Push, worker/push.js): opt-in, per-type toggles and the iPhone hint.
//
// Never asked on first launch: the only prompt is a small card on the results screen once the coach has
// finished a few matches (A/B flag push_prompt: after match 3 or 6), at most every 7 days and 3 times in all,
// and only where the browser can actually subscribe. Settings → Notifications has the switch and a toggle per
// type. On iPhone / iPad, Web Push only works for the Home Screen app (iOS 16.4+): Safari shows a hint instead.
import { h, toast } from './dom.js';
import { audio } from '../audio.js';
import { API, getAccount } from '../net/online.js';
import { flag, track } from '../net/ops.js';
import { profile } from '../profile.js';

export const TYPES = [
  ['invite', 1, 'Friend invites', 'A friend invites you to a match'],
  ['rematch', 2, 'Rematch ready', 'Your last online opponent asks for a rematch'],
  ['cup', 4, 'Cup check-ins', 'Your Weekend Cup match is ready: check in in time'],
  ['event', 8, 'New weekly event', 'Monday: the week\'s map event starts'],
  ['division', 16, 'Division results', 'Monday: your Ranked tier and week in rating'],
];
const LS_TYPES = 'mobavs_push_types', LS_PROMPT = 'mobavs_push_prompt';
const ALL = 31;

const isIOS = () => { try { const ua = navigator.userAgent; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch { return false; } };
const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || !!navigator.standalone; } catch { return false; } };
const capable = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window.PushManager === 'function' && typeof window.Notification === 'function';
export const pushTypes = () => { try { const s = localStorage.getItem(LS_TYPES); return s !== null && Number.isFinite(+s) ? +s & ALL : ALL; } catch { return ALL; } };

async function auth(path, body) {
  const a = getAccount(); if (!a) throw new Error('Sign in online first');
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.id}.${a.secret}` }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}
const keyBytes = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, (c) => c.charCodeAt(0)); };
let serverKey; // undefined = not asked yet, null = the server has no VAPID keys
async function getKey() {
  if (serverKey !== undefined) return serverKey;
  try { const d = await (await fetch(API + '/api/push/key')).json(); serverKey = d.key || null; } catch { return null; }
  return serverKey;
}
async function reg() { if (!capable()) return null; try { return await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]); } catch { return null; } }

// 'ios-browser' | 'unsupported' | 'denied' | 'offline' | 'noserver' | 'off' | 'on'
export async function pushState() {
  if (isIOS() && !standalone()) return 'ios-browser';
  if (!capable()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (!getAccount()) return 'offline';
  const r = await reg(); if (!r) return 'unsupported';
  const sub = await r.pushManager.getSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') return 'on';
  return (await getKey()) ? 'off' : 'noserver';
}

export async function enablePush() {
  const key = await getKey(); if (!key) throw new Error('Notifications are not set up on the server yet');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked in your browser settings' : 'Notifications were not allowed');
  const r = await reg(); if (!r) throw new Error('This browser cannot receive notifications here');
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await auth('/api/push/subscribe', { sub: sub.toJSON(), types: pushTypes() });
  track('push_optin');
  return true;
}
export async function disablePush() {
  const r = await reg(), sub = r && await r.pushManager.getSubscription();
  if (!sub) return;
  try { await auth('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* the server forgets dead endpoints anyway */ }
  await sub.unsubscribe().catch(() => {});
}
async function setTypes(v) {
  try { localStorage.setItem(LS_TYPES, String(v & ALL)); } catch { /* ignore */ }
  const r = await reg(), sub = r && await r.pushManager.getSubscription();
  if (sub) await auth('/api/push/subscribe', { sub: sub.toJSON(), types: v & ALL });
}

// Rematch asked on online results: the opponent gets a push if they left the app (the server checks the
// two of you just played that match).
export function pushRematch(to, match) { if (getAccount() && to && match) auth('/api/push/rematch', { to, match }).catch(() => {}); }

// ── Settings group ──
const STATE_TEXT = {
  'ios-browser': 'On iPhone and iPad, notifications work in the Home Screen app: tap Share, then "Add to Home Screen", and open MOBA-VS from there.',
  unsupported: 'This browser cannot show notifications.',
  denied: 'Blocked in your browser settings. Allow notifications for this site there, then come back.',
  offline: 'Available once you are online (an account is made automatically).',
  noserver: 'Not available on this server yet.',
  off: 'Off. Only the types you pick below, never ads.',
  on: 'On for this device.',
};
export function pushSettingsGroup(rerender) {
  const state = h('small', {}, 'Checking…');
  const btn = h('button', { class: 'chip', disabled: true }, '…');
  const tog = (key, bit, label, desc) => {
    const b = h('button', { class: 'tog' + (pushTypes() & bit ? ' on' : ''), role: 'switch', 'aria-checked': pushTypes() & bit ? 'true' : 'false', 'aria-label': label, disabled: true,
      onclick: async () => { const v = pushTypes() ^ bit; try { await setTypes(v); audio.sfx('move', 0.5); } catch (e) { toast(String(e.message || e)); } rerender(); } }, h('i'));
    return { el: h('div', { class: 'srow pushtype' }, h('div', { class: 'slab' }, label, h('small', {}, desc)), h('div', { class: 'sctl' }, b)), b };
  };
  const rows = TYPES.map(([k, bit, l, d]) => tog(k, bit, l, d));
  const el = h('div', { class: 'sgroup pushgroup' }, h('div', { class: 'sgt' }, 'Notifications'),
    h('div', { class: 'srow' }, h('div', { class: 'slab' }, 'Push notifications', state), h('div', { class: 'sctl' }, btn)),
    ...rows.map((r) => r.el));
  pushState().then((st) => {
    state.textContent = STATE_TEXT[st] || '';
    const on = st === 'on';
    for (const r of rows) { r.b.disabled = !on; r.el.classList.toggle('dim', !on); }
    if (st === 'on' || st === 'off') {
      btn.disabled = false; btn.textContent = on ? 'Turn off' : 'Turn on';
      btn.onclick = async () => {
        btn.disabled = true;
        try { if (on) await disablePush(); else { await enablePush(); toast('Notifications on', 1600); } audio.sfx('accept', 0.5); } catch (e) { toast(String(e.message || e), 2800); }
        rerender();
      };
    } else btn.remove();
  });
  return el;
}

// ── results-screen opt-in card ──
function promptMemo() { try { return JSON.parse(localStorage.getItem(LS_PROMPT) || '{}') || {}; } catch { return {}; } }
// Resolves to a card element, or null when it should not show (most of the time).
export async function pushPromptCard() {
  const games = (profile.d.history || []).length;
  if (games < 3 || !getAccount()) return null;
  const memo = promptMemo();
  if ((memo.n || 0) >= 3 || Date.now() - (memo.at || 0) < 7 * 86400000) return null;
  const after = flag('push_prompt', 'm3') === 'm6' ? 6 : 3;
  if (games < after) return null;
  const remember = () => { const m = promptMemo(); m.n = (m.n || 0) + 1; m.at = Date.now(); try { localStorage.setItem(LS_PROMPT, JSON.stringify(m)); } catch { /* ignore */ } };
  // iPhone / iPad in Safari: Web Push needs the Home Screen app, so the card explains how instead
  if (isIOS() && !standalone()) {
    if (!(await getKey())) return null;
    remember();
    const hint = h('div', { class: 'panel pushcard' },
      h('div', { class: 'col' }, h('b', {}, 'Want a ping for invites and cup check-ins?'), h('small', { class: 'muted' }, 'On iPhone, add MOBA-VS to your Home Screen (Share, then "Add to Home Screen"), open it from there and turn notifications on in Settings.')),
      h('button', { class: 'chip', onclick: () => hint.remove() }, 'Got it'));
    return hint;
  }
  if (!capable() || Notification.permission !== 'default') return null;
  if ((await pushState()) !== 'off') return null;
  remember(); track('push_prompt');
  const card = h('div', { class: 'panel pushcard' },
    h('div', { class: 'col' }, h('b', {}, 'Get a ping when it matters?'), h('small', { class: 'muted' }, 'Friend invites, rematches and cup check-ins. Pick the types in Settings.')),
    h('button', { class: 'chip', onclick: () => { card.remove(); } }, 'Not now'),
    h('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      try { await enablePush(); toast('Notifications on. Change them any time in Settings.', 2400); audio.sfx('accept', 0.6); card.remove(); } catch (err) { toast(String(err.message || err), 2800); card.remove(); }
    } }, 'Turn on'));
  return card;
}

// A notification was tapped while the game is open: the service worker hands its url to the page.
export function onPushOpen(fn) {
  if (!capable()) return;
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.t === 'push-open' && typeof e.data.url === 'string') fn(new URL(e.data.url)); });
}
