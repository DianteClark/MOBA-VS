// Player settings: volumes, team colours, text size, reduced motion, default speed, chatter.
// Persisted in localStorage. Render/UI read `settings.*` live; `applySettings()` pushes them
// into audio, CSS variables and the shared TEAM_COL palette (mutated in place, so every
// module that imported it sees the change).
import { h, mount } from './dom.js';
import { audio } from '../audio.js';
import { TEAM_COL, TEAM_DARK } from '../render/palette.js';
import { hapticsSupported } from './haptics.js';
import { resetTips, tipsLeft } from './coachtips.js';
import { pushSettingsGroup } from './notify.js';
import { openFeedback } from './feedback.js';

const KEY = 'mobavs_settings';
const PALETTES = {
  classic: { col: ['#4aa3ff', '#ff5a5a'], dark: ['#1d4f8a', '#8a1d27'] },
  // blue / orange: safe for deuteranopia, protanopia and tritanopia
  cb: { col: ['#3d9bff', '#ffa22e'], dark: ['#174a8a', '#8a4d0c'] },
};
const DEFAULTS = { master: 100, music: 70, sfx: 80, ui: 70, colorblind: false, textSize: 'normal', reducedMotion: false, speed: 1, chatter: true, alerts: true, quality: 'auto', haptics: true, chatMute: false, readyCheck: true };
// Phones/tablets: touch-first devices. Used for default render resolution and HUD cadence.
export const isTouch = (() => { try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch { return false; } })();
// Render resolution multiplier (canvas pixels per CSS pixel) for the chosen quality.
export function renderDpr() {
  const d = window.devicePixelRatio || 1;
  if (settings.quality === 'sharp') return Math.min(2, d);
  if (settings.quality === 'battery') return 1;
  return isTouch ? Math.min(1.5, d) : Math.min(2, d);
}
export const fpsCap = () => (settings.quality === 'battery' ? 30 : 0);

function systemReduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }

export const settings = { ...DEFAULTS };
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
  Object.assign(settings, DEFAULTS, saved && typeof saved === 'object' ? saved : { reducedMotion: systemReduced() });
  applySettings();
  return settings;
}
function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
export function setSetting(k, v) { settings[k] = v; saveSettings(); applySettings(); }

const TEXT_SCALE = { small: 0.88, normal: 1, large: 1.16 };
export function textScale() { return TEXT_SCALE[settings.textSize] || 1; }

function applySettings() {
  const p = settings.colorblind ? PALETTES.cb : PALETTES.classic;
  TEAM_COL[0] = p.col[0]; TEAM_COL[1] = p.col[1];
  TEAM_DARK[0] = p.dark[0]; TEAM_DARK[1] = p.dark[1];
  const root = document.documentElement;
  root.style.setProperty('--team0', p.col[0]);
  root.style.setProperty('--team1', p.col[1]);
  root.style.setProperty('--ts', String(textScale()));
  root.classList.toggle('reduce-motion', !!settings.reducedMotion);
  root.classList.toggle('cb', !!settings.colorblind);
  audio.setVolumes({ master: settings.master / 100, music: settings.music / 100 * 0.5, sfx: settings.sfx / 100 * 0.7, ui: settings.ui / 100 * 0.7 });
  for (const f of listeners) f(settings);
}
const listeners = new Set();

// ───────────── UI ─────────────
function slider(label, key, onDone) {
  const val = h('b', { class: 'sval' }, settings[key] + '%');
  const inp = h('input', { type: 'range', min: 0, max: 100, step: 5, value: settings[key],
    oninput: (e) => { settings[key] = +e.target.value; val.textContent = settings[key] + '%'; applySettings(); },
    onchange: () => { saveSettings(); onDone && onDone(); } });
  return h('div', { class: 'srow' }, h('span', { class: 'slab' }, label), h('div', { class: 'sctl' }, inp, val));
}
function seg(label, key, opts, rerender) {
  return h('div', { class: 'srow' }, h('span', { class: 'slab' }, label),
    h('div', { class: 'sctl segctl' }, ...opts.map(([v, l]) => h('button', { class: 'chip' + (settings[key] === v ? ' on' : ''), onclick: () => { setSetting(key, v); audio.sfx('move', 0.5); rerender(); } }, l))));
}
function toggle(label, key, desc, rerender, extra) {
  return h('div', { class: 'srow' }, h('div', { class: 'slab' }, label, desc ? h('small', {}, desc) : null),
    h('div', { class: 'sctl' }, extra || null, h('button', { class: 'tog' + (settings[key] ? ' on' : ''), role: 'switch', 'aria-checked': settings[key] ? 'true' : 'false', onclick: () => { setSetting(key, !settings[key]); audio.sfx('move', 0.5); rerender(); } }, h('i'))));
}
// Notifications (per device, menu only) and "Send feedback". close: closes the in-match overlay before the feedback form opens.
function opsGroups(rerender, close) {
  return [close ? null : pushSettingsGroup(rerender), // in a match only Help: notifications are set from the menu
    h('div', { class: 'sgroup' }, h('div', { class: 'sgt' }, 'Help'),
      h('div', { class: 'srow' }, h('div', { class: 'slab' }, 'Send feedback', h('small', {}, 'A bug, an idea, anything. Version and device are attached.')),
        h('div', { class: 'sctl' }, h('button', { class: 'chip', onclick: () => { audio.sfx('move', 0.5); const runner = close ? close() : null; openFeedback(window.app, { from: close ? 'match' : 'settings', runner }); } }, 'Write'))))];
}
function body(rerender) {
  const sw = h('span', { class: 'swatches' }, h('i', { style: { background: TEAM_COL[0] } }), h('i', { style: { background: TEAM_COL[1] } }));
  return [
    h('div', { class: 'sgroup' }, h('div', { class: 'sgt' }, 'Sound'),
      slider('Master', 'master', () => audio.sfx('coin', 1, 0)),
      slider('Music', 'music'),
      slider('Effects', 'sfx', () => audio.sfx('hit_m1', 1, 0)),
      slider('Menu sounds', 'ui', () => audio.ui('tap')),
      h('div', { class: 'srow' }, h('span', { class: 'slab' }, 'Mute everything'),
        h('div', { class: 'sctl' }, h('button', { class: 'tog' + (audio.muted ? ' on' : ''), role: 'switch', onclick: () => { audio.setMuted(!audio.muted); rerender(); } }, h('i'))))),
    h('div', { class: 'sgroup' }, h('div', { class: 'sgt' }, 'Display'),
      toggle('Colour-blind team colours', 'colorblind', 'Blue vs orange instead of blue vs red', rerender, sw),
      seg('Text size', 'textSize', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], rerender),
      toggle('Reduced effects', 'reducedMotion', 'Fewer particles; no screen shake, hit-stop, slow-mo or flashes', rerender),
      // Auto: full detail, eases off (effects, then resolution) if the device struggles. High: sharpest, full
      // detail. Low: 1x resolution, 30 fps, no ambient life, about a third of the effect particles.
      seg('Graphics', 'quality', [['auto', 'Auto'], ['sharp', 'High'], ['battery', 'Low']], () => { window.dispatchEvent(new Event('resize')); rerender(); })),
    h('div', { class: 'sgroup' }, h('div', { class: 'sgt' }, 'Match'),
      seg('Default speed', 'speed', [[1, '1x'], [2, '2x'], [4, '4x']], rerender),
      toggle('Hero chatter', 'chatter', 'Speech bubbles when heroes react', rerender),
      toggle('Off-screen alerts', 'alerts', 'Edge arrows for fights, towers and objectives', rerender),
      toggle('Haptics', 'haptics', hapticsSupported ? 'Vibrate on kills, objectives and your call results' : 'Not supported by this browser (iPhone Safari has no vibration)', rerender),
      toggle('Mute quick chat', 'chatMute', "Hide your online opponent's quick chat and emotes", rerender),
      toggle('Ready check', 'readyCheck', 'Review your Dojo lineup before Find Match, vs AI and online rooms', rerender),
      h('div', { class: 'srow' }, h('div', { class: 'slab' }, 'Coach tips', h('small', {}, tipsLeft() ? 'Short tips in your next match explain calls, the map, Ults and Moments' : 'Seen. Replay them in your next match')),
        h('div', { class: 'sctl' }, h('button', { class: 'chip', disabled: tipsLeft(), onclick: () => { resetTips(); audio.sfx('accept', 0.5); rerender(); } }, tipsLeft() ? 'On' : 'Replay')))),
  ];
}

// Full screen (from the home menu).
export function showSettings(app) {
  const render = () => mount(document.getElementById('screen'), h('div', { class: 'subscreen settings' },
    h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '< Back'), h('h2', {}, 'Settings'), h('div')),
    h('div', { class: 'panel spanel' }, ...body(render), ...opsGroups(render),
      h('div', { class: 'srow sfoot' }, h('button', { class: 'chip', onclick: () => { Object.assign(settings, DEFAULTS, { reducedMotion: systemReduced() }); saveSettings(); applySettings(); audio.setMuted(false); render(); } }, 'Reset to defaults')))));
  render();
}

// In-match overlay; pauses a local game while open.
export function openSettingsModal(runner) {
  if (document.querySelector('.modal')) return;
  const wasPaused = runner && !runner.online ? runner.paused : null;
  if (wasPaused === false) runner.paused = true;
  const close = () => { wrap.remove(); if (wasPaused === false) runner.paused = false; document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const inner = h('div', { class: 'panel spanel mpanel' });
  const toFeedback = () => { close(); return runner; }; // the feedback form pauses the game again itself
  const render = () => mount(inner, h('div', { class: 'mhead' }, h('b', {}, 'Settings'), wasPaused === false ? h('small', { class: 'muted' }, 'Game paused') : null, h('button', { class: 'x', title: 'Close', onclick: close }, 'X')), ...body(render), ...opsGroups(render, toFeedback),
    h('div', { class: 'srow sfoot' }, h('button', { class: 'btn', onclick: close }, 'Resume')));
  const wrap = h('div', { class: 'modal', onpointerdown: (e) => { if (e.target === wrap) close(); } }, inner);
  render();
  document.body.append(wrap);
  document.addEventListener('keydown', esc, true);
}

loadSettings();
