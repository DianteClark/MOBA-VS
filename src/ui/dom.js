// Tiny DOM helpers.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export function mount(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(Boolean)); return el; }
export function toast(msg, ms = 2200) {
  const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), ms);
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
// Boss portraits: every Kami element has its own face; the Oni and the Kraken have one each.
const KAMI_FACE = { infernal: 'kami_infernal', ocean: 'kami_ocean', mountain: 'kami_mountain', cloud: 'kami_cloud', elder: 'kami_elder' };
export const bossFace = (k, el) => `assets/img/boss/${k === 'dragon' ? KAMI_FACE[el] || 'kami_elder' : k === 'herald' ? 'herald_faceset' : k === 'boss' ? 'tengu_faceset' : k === 'yokai' ? 'yokai_faceset' : 'baron_faceset'}.png`;
// The Kami that is up, or the one that wakes next.
export const kamiNow = (g) => (g.objectives.dragon ? g.objectives.dragon.element : g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon);
export const icon = (name) => `assets/img/icons/${name}.png`;
// Per-tick HUD writes: touch the DOM only when a value really changes (no style recalc / mutations for nothing).
export const setText = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
export const setCss = (el, k, v) => { const c = el._css || (el._css = {}); if (c[k] !== v) { c[k] = v; if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v; } };
export const setOff = (el, off) => { if (el.disabled !== off) el.disabled = off; };
// History / share-card label for a profile history `mode` key.
export const MODE_LABEL = { ai0: 'vs Easy AI', ai1: 'vs Normal AI', ai2: 'vs Hard AI', online: 'Online Ranked', casual: 'Online Casual', rush: 'Lane Rush vs AI', rushOnline: 'Lane Rush Online', cup: 'Season Cup', coop: 'Co-op vs AI', coop2: 'Co-op 2v2', fr: 'Franchise' };
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
