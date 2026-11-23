// Build Guide (Dojo tab) and one-line build descriptions on every build chip.
// Reads BUILDS generically: name, icon, color, desc, items; optional goodAt / weakTo / bestOn text.
import { h, face, icon } from './dom.js';
import { BUILDS, BUILD_ORDER, BUILD_COMBOS } from '../data/items.js';
import { HEROES, ROLE_LABEL } from '../data/heroes.js';

// Build combos active for a list of build ids (one hero each).
export function combosOf(builds) {
  return BUILD_COMBOS.filter((c) => { const i = builds.indexOf(c.a); return i >= 0 && builds.some((b, j) => j !== i && b === c.b); });
}

// One line about a build (chip popovers, tooltips).
export function buildLine(id) {
  const b = BUILDS[id]; if (!b) return '';
  return [b.desc, b.goodAt ? `Good at: ${b.goodAt}.` : '', b.weakTo ? `Beaten by: ${b.weakTo}.` : ''].filter(Boolean).join(' ');
}

// ───────────── chip popovers: tap (info-only chips) or long-press (chips that also select) ─────────────
// Any element with data-build="<id>" gets them. Installed once (main.js).
let pop = null, popT = 0, lpT = 0, lpEl = null, swallow = false, sx = 0, sy = 0;
function show(el) {
  const id = el.getAttribute('data-build'), b = BUILDS[id]; if (!b) return;
  hide();
  pop = h('div', { class: 'bdesc-pop', role: 'tooltip', style: { '--bc': b.color } }, h('b', {}, b.name + ': '), buildLine(id));
  document.body.append(pop);
  const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const x = Math.max(6, Math.min(window.innerWidth - pw - 6, r.left + r.width / 2 - pw / 2));
  const y = r.top - ph - 6 >= 4 ? r.top - ph - 6 : Math.min(window.innerHeight - ph - 4, r.bottom + 6);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  clearTimeout(popT); popT = setTimeout(hide, 3200);
}
function hide() { if (pop) { pop.remove(); pop = null; } }
export function installBuildTips() {
  if (installBuildTips.done) return; installBuildTips.done = true;
  document.addEventListener('pointerdown', (e) => {
    hide();
    const el = e.target.closest && e.target.closest('[data-build]'); if (!el) return;
    sx = e.clientX; sy = e.clientY; lpEl = el; swallow = false;
    clearTimeout(lpT); lpT = setTimeout(() => { if (lpEl === el) { show(el); swallow = true; } }, 420);
  }, true);
  document.addEventListener('pointermove', (e) => { if (lpEl && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(lpT); lpEl = null; } }, true);
  document.addEventListener('pointerup', () => { clearTimeout(lpT); }, true);
  document.addEventListener('pointercancel', () => { clearTimeout(lpT); lpEl = null; }, true);
  // a long-press must not also select the build; a tap on an info-only chip shows the line
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-build]'); if (!el) return;
    if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; return; }
    if (el.hasAttribute('data-build-info')) show(el);
  }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-build]')) e.preventDefault(); }, true);
  window.addEventListener('scroll', hide, true);
}

// ───────────── Dojo → Builds ─────────────
export function buildGuide(openHero) {
  const ids = BUILD_ORDER.filter((id) => BUILDS[id]);
  return h('div', { class: 'col' },
    h('small', { class: 'muted center' }, `${ids.length} builds. Each hero can take 2 to 4 of them. Heroes buy the items left to right. Glowing faces: the build is that hero's default. Tap a face to open the hero. Long-press any build chip in the game for a one-line summary.`),
    h('div', { class: 'bcombos' }, h('b', {}, 'Build combos'), h('small', { class: 'muted' }, 'Two heroes on one team running these two builds get a small bonus. Prep shows the ones your lineup has.'),
      ...BUILD_COMBOS.map((c) => h('div', { class: 'bgrow combo' }, h('span', {}, c.name), h('span', {}, h('i', { style: { color: BUILDS[c.a].color } }, BUILDS[c.a].name), ' + ', h('i', { style: { color: BUILDS[c.b].color } }, BUILDS[c.b].name), `: ${c.text}`)))),
    h('div', { class: 'bguide' }, ...ids.map((id) => {
      const b = BUILDS[id];
      const can = HEROES.filter((x) => x.builds.includes(id)), rec = can.filter((x) => x.rec === id);
      const total = b.items.reduce((a, it) => a + it.cost, 0);
      const facesOf = (list, best) => h('div', { class: 'bgfaces' }, ...list.map((x) => h('button', { class: best && best.includes(x) ? 'best' : '', title: `${x.name} · ${ROLE_LABEL[x.role]}${x.rec === id ? ' (default build)' : ''}`, onclick: () => openHero(x.id) }, h('img', { src: face(x.id), alt: x.name }))));
      const row = (label, text, cls) => (text ? h('div', { class: 'bgrow ' + (cls || '') }, h('span', {}, label), h('span', {}, text)) : null);
      return h('div', { class: 'bgcard', style: { '--bc': b.color } },
        h('div', { class: 'bghead' }, h('img', { src: icon(b.icon || 'Alchemy') }), h('b', {}, b.name), h('small', {}, `${can.length} heroes · ${(total / 1000).toFixed(1)}k gold`)),
        h('div', { class: 'bgdesc' }, b.desc),
        h('div', { class: 'bgpath' }, ...b.items.flatMap((it, i) => [i ? h('span', { class: 'arr' }, '›') : null,
          h('span', { class: 'bgitem', title: `${it.name} · ${it.cost}g` }, h('img', { src: icon(it.icon) }), it.name, h('small', {}, ` ${it.cost}`))])),
        row('Good at', b.goodAt, 'good'), row('Beaten by', b.weakTo, 'bad'), row('Best on', b.bestOn),
        row('Combo', BUILD_COMBOS.filter((c) => c.a === id || c.b === id).map((c) => `${c.name} with ${BUILDS[c.a === id ? c.b : c.a].name}`).join(' · ')),
        rec.length ? h('div', { class: 'bgrow' }, h('span', {}, 'Default for'), facesOf(rec, rec)) : null,
        h('div', { class: 'bgrow' }, h('span', {}, 'Can take it'), can.length ? facesOf(can, rec) : h('small', { class: 'muted' }, 'No hero yet')));
    })));
}
