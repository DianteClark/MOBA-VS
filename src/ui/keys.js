// Keyboard shortcuts and the help overlay ([?] anywhere, or Settings > Keys and controller).
//   Menus: arrows move between buttons (nearest in that direction), Enter / Space press, Esc goes back or closes.
//   Match: the dock's keys (src/ui/commands.js CORE + Q E T, M, U, V, C) and the HUD's (1-5, Tab, Space), WASD /
//   arrows pan, the wheel zooms. Nothing here changes what a key does in a match; it only lists them.
import { h } from './dom.js';
import { CORE } from './commands.js';
import { audio } from '../audio.js';
import { moveFocus, topDialog, setKeyMode } from './a11y.js';
import { padConnected } from './gamepad.js';

const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const inMatch = () => { const m = document.getElementById('match'); return m && !m.classList.contains('hidden'); };

function section(title, rows) {
  return h('div', { class: 'kh-sec' }, h('b', { class: 'kh-t' }, title),
    h('dl', {}, rows.map(([k, d]) => [h('dt', {}, ...[].concat(k).map((x) => h('kbd', { translate: /^[A-Z0-9?]$|^(Esc|Tab|Enter|Space|Shift|LB|RB|LT|RT|A|B|X|Y)$/.test(x) ? 'no' : null }, x))), h('dd', {}, d)])));
}
export function openHelp() {
  const old = document.getElementById('helpov'); if (old) { old.remove(); return; }
  const back = document.activeElement;
  const close = () => { el.remove(); document.removeEventListener('keydown', esc, true); if (back && back.isConnected) back.focus({ preventScroll: true }); };
  const esc = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); } };
  const calls = CORE.map((c) => [c.key.toUpperCase(), c.label]);
  const pad = padConnected();
  const el = h('div', { id: 'helpov', class: 'modal', onpointerdown: (e) => { if (e.target === el) close(); } },
    h('div', { class: 'panel mpanel khelp' },
      h('div', { class: 'mhead' }, h('b', {}, 'Keys and controller'), pad ? h('small', { class: 'kh-pad' }, 'Controller connected') : null, h('button', { class: 'x', onclick: close }, '✕')),
      h('div', { class: 'kh-grid' },
        section('Match: calls', [...calls, [['Q', 'E', 'T'], 'Tactic cards'], ['M', 'Coach Moments'], ['U', 'Ult stance'], ['V', 'Kami Surge'], ['C', 'Cancel calls']]),
        section('Match: view', [[['1', '5'], 'Select a hero'], ['Tab', 'Scoreboard'], ['Space', 'Auto-camera'], [['W', 'A', 'S', 'D'], 'Move the camera'], ['Wheel', 'Zoom'], ['Esc', 'Close a panel']]),
        section('Menus', [[['←', '↑', '→', '↓'], 'Move between buttons'], [['Tab'], 'Next button'], [['Enter', 'Space'], 'Press'], ['Esc', 'Back or close'], ['?', 'This help']]),
        section('Controller', [['Left stick / D-pad', 'Move focus; in a match, the camera'], ['A', 'Press'], ['B', 'Back, close or cancel'], ['Y (hold)', 'Call wheel: aim and release'],
          ['X', 'Coach Moments'], [['LB', 'RB'], 'Previous / next hero'], [['LT', 'RT'], 'Zoom out / in'], ['Start', 'Settings (pauses vs AI)'], ['Select', 'Scoreboard']]))));
  document.body.append(el);
  document.addEventListener('keydown', esc, true);
}

export function installKeys() {
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); audio.sfx('move', 0.4); openHelp(); return; }
    // arrows: spatial focus in menus and dialogs (in a match they pan the camera unless a dialog is open)
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (!dir) return;
    if (inMatch() && !topDialog()) return;
    if (e.target && e.target.type === 'range') return; // sliders keep their arrows
    e.preventDefault(); setKeyMode(true);
    if (moveFocus(dir)) audio.sfx('move', 0.25);
  });
}
