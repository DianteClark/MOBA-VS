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
export const face = (id) => `assets/img/faces/${id}.png`;
// Boss portraits: every Kami element has its own face; the Oni and the Kraken have one each.
export const KAMI_FACE = { infernal: 'kami_infernal', ocean: 'kami_ocean', mountain: 'kami_mountain', cloud: 'kami_cloud', elder: 'kami_elder' };
export const bossFace = (k, el) => `assets/img/boss/${k === 'dragon' ? KAMI_FACE[el] || 'kami_elder' : k === 'herald' ? 'herald_faceset' : 'baron_faceset'}.png`;
// The Kami that is up, or the one that wakes next.
export const kamiNow = (g) => (g.objectives.dragon ? g.objectives.dragon.element : g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon);
export const icon = (name) => `assets/img/icons/${name}.png`;
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
