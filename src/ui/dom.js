// Tiny DOM helpers.
import { tr } from '../i18n/i18n.js';
import { DRAGON_INFO, OBJ_NAME } from '../sim/constants.js';
import { KAMI, elderName } from '../sim/beasts.js';
import { kamiFace } from '../data/beasts.js';
const TR_ATTR = { title: 1, 'aria-label': 1, placeholder: 1, alt: 1 };
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : TR_ATTR[k] ? tr(v) : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(attrs && attrs.translate === 'no' ? String(c) : tr(String(c))));
  a11y(el, tag, attrs || {});
  return el;
}
// Screen readers / keys: clickable non-buttons act as buttons, icon-only buttons get a name, images are decorative
// unless given an alt.
const NATIVE = /^(button|a|input|select|textarea|label|option|summary)$/;
function a11y(el, tag, attrs) {
  if (tag === 'img') { if (attrs.alt === undefined) el.alt = ''; return; }
  if (attrs.onclick && !NATIVE.test(tag) && !attrs.role && !/\b(modal|overlay|backdrop)\b/.test(attrs.class || '') && !attrs.id) { el.setAttribute('role', 'button'); if (attrs.tabindex === undefined) el.tabIndex = 0; }
  if (tag === 'button' && attrs['aria-label'] === undefined) {
    const tx = el.textContent.trim();
    if (/^(✕|×|X)$/.test(tx)) el.setAttribute('aria-label', tr('Close'));
    else if (!tx && attrs.title) el.setAttribute('aria-label', el.getAttribute('title'));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export function mount(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(Boolean)); return el; }
export function toast(msg, ms = 2200) {
  const t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, msg); document.body.append(t); setTimeout(() => t.remove(), ms);
}
// Empty state: an icon, a short headline, one line of help and (optionally) the next step.
export function emptyState(img, title, text, action) {
  return h('div', { class: 'empty-state' }, img ? h('img', { src: img, alt: '' }) : null, h('b', {}, title), text ? h('p', {}, text) : null,
    action ? h('button', { class: 'btn', onclick: action.onclick }, action.label) : null);
}
// Portraits: during a match (and its results) a hero in a skin shows its skinned face (data URL, set by setFaceSkins).
const FACE_SKIN = {};
export const face = (id) => FACE_SKIN[id] || `assets/img/faces/${id}.png`;
export function setFaceSkins(map) { for (const k of Object.keys(FACE_SKIN)) delete FACE_SKIN[k]; Object.assign(FACE_SKIN, map || {}); }
// Boss portraits: every Kami element has its own face; the Oni and the Kraken have one each. Bosses & Beasts:
// each map's Kami species and its Elder (the world boss, 'boss'), and the rare Oni / Kraken recolors.
const KAMI_FACE = { infernal: 'kami_infernal', ocean: 'kami_ocean', mountain: 'kami_mountain', cloud: 'kami_cloud', elder: 'kami_elder' };
export const bossFace = (k, el, rare) => (k === 'dragon' && KAMI[el] ? kamiFace(el) : k === 'boss' ? kamiFace(KAMI[el] ? el : 'frog', true)
  : `assets/img/boss/${k === 'dragon' ? KAMI_FACE[el] || 'kami_elder' : k === 'herald' ? (rare ? 'oni_rare_faceset' : 'herald_faceset') : k === 'yokai' ? 'yokai_faceset' : rare ? 'kraken_rare_faceset' : 'baron_faceset'}.png`);
// The Kami that is up, or the one that wakes next (Bosses & Beasts: the map's species).
export const kamiNow = (g) => (g.beasts && g.beasts.full ? g.beasts.species : g.objectives.dragon ? g.objectives.dragon.element : g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon);
// An objective's name as players see it: this map's Kami and Elder, a rare Oni / Kraken.
export const objLabel = (g, k) => (k === 'dragon' ? DRAGON_INFO[kamiNow(g)].name : k === 'boss' && g.beasts && g.beasts.full ? elderName(g.beasts.species) : (g.objectives[k] && g.objectives[k].rare ? 'Rare ' : '') + OBJ_NAME[k]);
export const icon = (name) => `assets/img/icons/${name}.png`;
// Per-tick HUD writes: touch the DOM only when a value really changes (no style recalc / mutations for nothing).
export const setText = (el, v) => { v = tr(String(v)); if (el.textContent !== v) el.textContent = v; };
export const setCss = (el, k, v) => { const c = el._css || (el._css = {}); if (c[k] !== v) { c[k] = v; if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v; } };
// Shrink one-line labels until they fit their box (long translations, narrow phones). Re-fits on resize.
const FIT = new Set(); let fitHooked = false;
function fitOne(e) {
  e.style.fontSize = ''; const box = e.parentElement; if (!box || !e.isConnected) return;
  let fs = parseFloat(getComputedStyle(e).fontSize); const w = box.clientWidth - 4;
  while (e.scrollWidth > w && fs > 6) { fs -= 0.5; e.style.fontSize = fs + 'px'; }
}
export function fitText(els) {
  if (!fitHooked) {
    fitHooked = true;
    addEventListener('resize', () => requestAnimationFrame(() => { for (const e of FIT) if (e.isConnected) fitOne(e); else FIT.delete(e); }));
  }
  for (const e of els) if (e) FIT.add(e);
  requestAnimationFrame(() => { for (const e of els) if (e) fitOne(e); });
}
export const setOff = (el, off) => { if (el.disabled !== off) el.disabled = off; };
// History / share-card label for a profile history `mode` key.
export const MODE_LABEL = { ai0: 'vs Easy AI', ai1: 'vs Normal AI', ai2: 'vs Hard AI', online: 'Online Ranked', casual: 'Online Casual', rush: 'Lane Rush vs AI', rushOnline: 'Lane Rush Online', cup: 'Season Cup', coop: 'Co-op vs AI', coop2: 'Co-op 2v2', fr: 'Franchise', story: 'Campaign' };
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
