// Screen readers and keyboard / gamepad focus.
//   * Dialogs: every overlay (a .modal, or any full-screen fixed layer added to <body>, the scoreboard and halftime)
//     gets role="dialog" + aria-modal + a label from its heading; focus moves into it and returns where it was when
//     it closes; Tab stays inside it. Escape closes it (its ✕ / Close / Resume button) if its own code did not.
//   * Screens: #screen is the main landmark; a new screen moves focus to its heading when the player uses keys or
//     a gamepad (never on touch, so nothing flashes a focus ring on a phone).
//   * Live regions: toasts, the match banner and the decision tray are announced politely.
//   * Spatial focus: moveFocus('up'|'down'|'left'|'right') picks the nearest control in that direction inside the
//     active layer (the top dialog, the HUD in a match, else the screen). Arrow keys use it in menus; the gamepad
//     uses it everywhere.
// dom.js h() gives clickable non-buttons role="button" + tabindex, icon-only buttons an aria-label and images alt="".
import { tr } from '../i18n/i18n.js';
const FOCUSABLE = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
const DIALOG_IDS = new Set(['scoreboard', 'halftime', 'anasheet', 'qchat', 'helpov', 'padradial']);
let kb = false; // the last input came from keys or a gamepad
const stack = []; // open dialogs, oldest first: { el, back }

export const keyMode = () => kb;
export function setKeyMode(on) { if (kb === on) return; kb = on; document.documentElement.classList.toggle('kbnav', on); }

const shown = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
function isDialog(el) {
  if (!el || el.nodeType !== 1 || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.classList.contains('modal') || DIALOG_IDS.has(el.id)) return true;
  if (el.parentElement !== document.body || /^(SCRIPT|CANVAS|VIDEO|A)$/.test(el.tagName) || ['loading', 'fade', 'rotate', 'screen', 'match', 'bg'].includes(el.id)) return false;
  if (el.classList.contains('toast') || el.classList.contains('parade')) return false;
  const s = getComputedStyle(el); if (s.position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width * r.height > innerWidth * innerHeight * 0.55 && !!el.querySelector('button');
}
function label(el) {
  const hd = el.querySelector('h1, h2, h3, .mhead b, .sh-head span, b');
  return hd ? hd.textContent.trim().slice(0, 80) : '';
}
function openDialog(el) {
  if (stack.some((d) => d.el === el)) return;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const l = label(el); if (l && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', l);
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  stack.push({ el, back: document.activeElement });
  requestAnimationFrame(() => {
    if (!el.isConnected || el.contains(document.activeElement)) return;
    const first = kb ? focusables(el)[0] : null;
    (first || el).focus({ preventScroll: true });
  });
}
function closed(d) {
  const i = stack.indexOf(d); if (i >= 0) stack.splice(i, 1);
  const top = stack[stack.length - 1];
  const back = d.back && d.back.isConnected ? d.back : top ? top.el : null;
  if (back && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) back.focus({ preventScroll: true });
}
export const topDialog = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].el.isConnected && shown(stack[i].el)) return stack[i].el; } return null; };
function sweep() { for (const d of stack.slice()) if (!d.el.isConnected || d.el.classList.contains('hidden')) closed(d); }

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((e) => shown(e) && !e.closest('[aria-hidden="true"], .hidden') && e.tabIndex !== -1);
}
// The layer keys and the gamepad act on: the top dialog, else the HUD in a match, else the menu screen.
export function activeLayer() {
  const d = topDialog(); if (d) return d;
  const m = document.getElementById('match');
  if (m && !m.classList.contains('hidden')) return m;
  return document.getElementById('screen');
}

// Nearest control in a direction (beam first: controls overlapping the current one's row / column win).
export function moveFocus(dir, root = activeLayer()) {
  if (!root) return null;
  const all = focusables(root); if (!all.length) return null;
  const cur = root.contains(document.activeElement) && all.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { const f = all.slice().sort((a, b) => { const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(); return (A.top - B.top) * 2 + (A.left - B.left) * 0.5; })[0]; focusEl(f); return f; }
  const c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
  let best = null, bs = Infinity;
  for (const e of all) {
    if (e === cur) continue;
    const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    let main, side, beam;
    if (dir === 'left' || dir === 'right') {
      main = dir === 'left' ? c.left - r.right : r.left - c.right; side = Math.abs(y - cy);
      beam = r.bottom > c.top + 2 && r.top < c.bottom - 2;
      if ((dir === 'left' ? x >= cx : x <= cx)) continue;
    } else {
      main = dir === 'up' ? c.top - r.bottom : r.top - c.bottom; side = Math.abs(x - cx);
      beam = r.right > c.left + 2 && r.left < c.right - 2;
      if ((dir === 'up' ? y >= cy : y <= cy)) continue;
    }
    const s = Math.max(0, main) + side * (beam ? 0.3 : 2) + (beam ? 0 : 40);
    if (s < bs) { bs = s; best = e; }
  }
  if (best) focusEl(best);
  return best;
}
export function focusEl(e) {
  if (!e) return;
  e.focus({ preventScroll: true });
  try { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old browsers */ }
}
// Close the top dialog the way a tap would: its ✕ / Close / Resume / Back button, else a tap on its backdrop.
export function closeTop() {
  const d = topDialog(); if (!d) return false;
  const btns = [...d.querySelectorAll('button')].filter(shown), close = tr('Close');
  const btn = btns.find((b) => b.classList.contains('x') || /^(✕|×|x|X)$/.test(b.textContent.trim()) || b.getAttribute('aria-label') === close)
    || btns.find((b) => b.classList.contains('backbtn') || ['Close', 'Resume', 'Done', 'OK', 'Back', '< Back'].map(tr).includes(b.textContent.trim()));
  if (btn) { btn.click(); return true; }
  d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); d.click();
  return !d.isConnected;
}
// Back on a menu screen: its "< Back" button.
export function screenBack() {
  const b = document.querySelector('#screen .backbtn');
  if (b && shown(b)) { b.click(); return true; }
  return false;
}

export function installA11y() {
  const root = document.documentElement;
  document.getElementById('screen').setAttribute('role', 'main');
  const hud = document.getElementById('hud'); if (hud) hud.setAttribute('aria-label', 'Match');
  for (const id of ['banner', 'ticker']) { const e = document.getElementById(id); if (e) { e.setAttribute('aria-live', 'polite'); e.setAttribute('role', 'status'); } }
  // keys / gamepad vs touch / mouse
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Escape') setKeyMode(true); }, true);
  window.addEventListener('pointerdown', () => setKeyMode(false), true);
  // dialogs come and go
  const scan = (n) => { if (n.nodeType === 1 && (n.parentElement === document.body || DIALOG_IDS.has(n.id)) && isDialog(n)) requestAnimationFrame(() => { if (isDialog(n) && shown(n)) openDialog(n); }); };
  new MutationObserver((list) => {
    let gone = false;
    for (const m of list) { for (const n of m.addedNodes) scan(n); if (m.removedNodes.length) gone = true; }
    if (gone && stack.length) sweep();
  }).observe(document.body, { childList: true, subtree: true });
  for (const n of document.body.children) scan(n);
  // a new menu screen: focus its heading for keyboard and screen-reader users
  const scr = document.getElementById('screen');
  new MutationObserver(() => {
    if (!kb || topDialog()) return;
    requestAnimationFrame(() => {
      const hd = scr.querySelector('h2, h1, .home h1');
      if (hd && !scr.contains(document.activeElement)) { hd.tabIndex = -1; hd.focus({ preventScroll: true }); }
    });
  }).observe(scr, { childList: true });
  // Tab stays inside the top dialog; Enter / Space press role="button" elements
  let topAtDown = null;
  window.addEventListener('keydown', (e) => {
    sweep(); topAtDown = topDialog();
    if (e.key === 'Tab' && topAtDown) {
      const f = focusables(topAtDown); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON') { e.preventDefault(); t.click(); }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (topAtDown) { if (topAtDown.isConnected && shown(topAtDown) && closeTop()) e.preventDefault(); return; } // its own handler may have closed it already
    if (document.getElementById('screen').classList.contains('hidden')) return; // in a match the dock handles Escape
    if (screenBack()) e.preventDefault();
  });
}
