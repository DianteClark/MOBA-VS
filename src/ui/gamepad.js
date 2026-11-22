// Gamepad (standard mapping: Xbox / PlayStation / Switch Pro pads in any current browser).
//   Menus and dialogs: left stick or D-pad moves focus (nearest button that way), A presses, B goes back / closes,
//   left / right on a slider or a drop-down changes it, the right stick scrolls.
//   Match: sticks move the camera, LT / RT zoom, D-pad moves focus over the HUD (calls, cards, Coach's Calls,
//   target tiles) and A presses it, B closes a panel or cancels, Y (hold) opens the call wheel (aim, release to
//   call), X opens Coach Moments, LB / RB pick the previous / next hero, Start opens Settings, Select the scoreboard.
// Polling runs only while a pad is connected. The pad only presses the same buttons a tap would: nothing reaches
// the sim except through the dock's normal commands.
import { h, icon, toast } from './dom.js';
import { CORE } from './commands.js';
import { audio } from '../audio.js';
import { moveFocus, activeLayer, closeTop, screenBack, topDialog, setKeyMode, focusables, focusEl } from './a11y.js';

const DEAD = 0.28, FIRST = 320, REPEAT = 130;
let raf = 0, last = 0, prevB = [], held = { dir: null, next: 0 }, wheel = null;
export const padConnected = () => { try { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean); } catch { return false; } };

const inMatch = () => { const m = document.getElementById('match'); return m && !m.classList.contains('hidden') && window.app && window.app.match; };
const app = () => window.app;

// Sliders and drop-downs: left / right change the value (as a drag or a pick would).
function nudge(el, d) {
  if (el.tagName === 'SELECT') { const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d)); if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); } return true; }
  if (el.type === 'range') { if (d > 0) el.stepUp(); else el.stepDown(); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  return false;
}
function navigate(dir) {
  const a = document.activeElement;
  if ((dir === 'left' || dir === 'right') && a && (a.tagName === 'SELECT' || a.type === 'range') && activeLayer() && activeLayer().contains(a)) { nudge(a, dir === 'right' ? 1 : -1); return; }
  if (moveFocus(dir)) audio.sfx('move', 0.25);
}
function press() {
  const a = document.activeElement, layer = activeLayer();
  if (a && layer && layer.contains(a) && a !== layer && a !== document.body && (a.tagName !== 'H2')) { a.click(); return; }
  const f = layer ? focusables(layer)[0] : null; if (f) focusEl(f);
}
function back() {
  if (wheel) { closeWheel(false); return; }
  if (topDialog()) { closeTop(); return; }
  const m = inMatch();
  if (m) {
    const H = m.hud, D = H.dock;
    if (document.getElementById('match').contains(document.activeElement)) document.activeElement.blur();
    if (D && D.sheetId) { D.close(); return; }
    if (D && D.ring) { D.closeRing(); return; }
    if (D && D.my >= 0) D.send({ type: 'cancel' });
    return;
  }
  screenBack();
}

// ── the call wheel (hold Y) ──
const WHEEL = () => [...CORE.map((c) => ({ id: c.id, label: c.label, ico: c.icon })), { id: 'moments', label: 'Moments', ico: 'BookThunder' }, { id: 'ult', label: 'Ults', ico: 'Death' }];
function openWheel() {
  const m = inMatch(); if (!m || !m.hud.dock || m.hud.dock.my < 0) return;
  const items = WHEEL();
  const el = h('div', { id: 'padradial', class: 'hud', 'aria-hidden': 'true' }, h('div', { class: 'pr-ring' },
    items.map((it, i) => { const a = -Math.PI / 2 + i * (Math.PI * 2 / items.length);
      return h('div', { class: 'pr-it', style: { left: `calc(50% + ${Math.cos(a) * 41}%)`, top: `calc(50% + ${Math.sin(a) * 41}%)` } }, h('img', { src: icon(it.ico) }), h('span', {}, it.label)); }),
    h('div', { class: 'pr-mid' }, h('b', {}, 'Calls'), h('small', {}, 'Aim, then release Y'))));
  document.getElementById('match').append(el);
  wheel = { el, items, sel: -1 };
  audio.sfx('move', 0.5);
}
function aimWheel(x, y) {
  if (!wheel) return;
  let sel = wheel.sel;
  if (Math.hypot(x, y) > 0.5) { const n = wheel.items.length; sel = ((Math.round((Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2 / n)) % n) + n) % n; }
  if (sel === wheel.sel) return;
  wheel.sel = sel;
  [...wheel.el.querySelectorAll('.pr-it')].forEach((e, i) => e.classList.toggle('on', i === sel));
  audio.sfx('move', 0.2);
}
function closeWheel(go) {
  if (!wheel) return;
  const w = wheel; wheel = null; w.el.remove();
  const m = inMatch(); if (!go || !m || w.sel < 0) return;
  const D = m.hud.dock, it = w.items[w.sel];
  if (it.id === 'moments') D.open('moments'); else if (it.id === 'ult') D.cycleUlt(); else D.press(it.id);
  // a target sheet opened: put focus on its first tile so A picks it
  requestAnimationFrame(() => { if (D.sheetEl && !D.sheetEl.classList.contains('hidden')) { const f = focusables(D.sheetEl).find((e) => !e.classList.contains('x')); if (f) focusEl(f); } });
}

function cycleHero(d) {
  const m = inMatch(); if (!m) return;
  const H = m.hud, list = H.g.teams[H.view].heroes, cur = list.findIndex((x) => x.id === H.r.follow);
  const next = list[((cur < 0 ? (d > 0 ? -1 : 0) : cur) + d + list.length) % list.length];
  if (next) { if (H.r.follow === next.id) return; H.selectHero(next); audio.sfx('move', 0.3); }
}
function camera(m, x, y, z, dt) {
  const r = m.renderer || app().renderer; if (!r) return;
  if (x || y) { r.panTo = null; r.follow = null; m.hud.manualCam(); const sp = 900 / r.cam.zoom * dt; r.cam.x += x * sp; r.cam.y += y * sp; }
  if (z) r.cam.zoom = Math.max(0.45, Math.min(3, r.cam.zoom * (1 + z * dt * 1.6)));
}

function poll(now) {
  raf = 0;
  let pads = []; try { pads = [...navigator.getGamepads()].filter((p) => p && p.connected !== false); } catch { /* no API */ }
  if (!pads.length) { prevB = []; return; }
  const p = pads.find((q) => q.mapping === 'standard') || pads[0];
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  const btn = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
  const cur = p.buttons.map((_, i) => btn(i));
  const down = (i) => cur[i] && !prevB[i], up = (i) => !cur[i] && prevB[i];
  const ax = (i) => { const v = p.axes[i] || 0; return Math.abs(v) < DEAD ? 0 : v; };
  if (cur.some(Boolean) || p.axes.some((v) => Math.abs(v) > 0.5)) setKeyMode(true);
  const m = inMatch(), dlg = topDialog();
  // direction: D-pad always; the left stick only outside a match
  let dir = cur[12] ? 'up' : cur[13] ? 'down' : cur[14] ? 'left' : cur[15] ? 'right' : null;
  if (!dir && (!m || dlg) && !wheel) { const x = ax(0), y = ax(1); if (Math.abs(x) > 0.55 || Math.abs(y) > 0.55) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up'); }
  if (dir) { if (dir !== held.dir) { held = { dir, next: now + FIRST }; navigate(dir); } else if (now >= held.next) { held.next = now + REPEAT; navigate(dir); } } else held.dir = null;
  if (down(0)) press();
  if (down(1)) back();
  if (m && !dlg) {
    if (down(3)) openWheel();
    if (wheel) aimWheel(ax(0) || ax(2), ax(1) || ax(3));
    if (up(3)) closeWheel(true);
    if (!wheel) camera(m, ax(0) || ax(2), ax(1) || ax(3), ((p.buttons[7] && p.buttons[7].value) || 0) - ((p.buttons[6] && p.buttons[6].value) || 0), dt);
    if (down(2) && m.hud.dock && m.hud.dock.my >= 0) m.hud.dock.open('moments');
    if (down(4)) cycleHero(-1);
    if (down(5)) cycleHero(1);
    if (down(8)) m.hud.toggleScoreboard();
    if (down(9)) import('./settings.js').then((s) => s.openSettingsModal(m.runner));
  } else {
    if (wheel) closeWheel(false);
    const y = ax(3); if (y) { const s = scroller(document.activeElement) || scroller(activeLayer()); if (s) s.scrollTop += y * 14; }
  }
  prevB = cur;
  raf = requestAnimationFrame(poll);
}
function scroller(e) { for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n; } return null; }

export function installGamepad() {
  if (!('getGamepads' in navigator)) return;
  const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(poll); } };
  window.addEventListener('gamepadconnected', () => { start(); toast('Controller connected. Press ? or open Settings for the buttons.', 2600); });
  window.addEventListener('gamepaddisconnected', () => { if (wheel) closeWheel(false); });
  if (padConnected()) start();
}
