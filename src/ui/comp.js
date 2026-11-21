// Team comps and hero duos in the UI (draft header, Dojo hero page).
// The data lives in src/data/synergy.js (DUOS, duosOf, COMPS, compOf, COMBO_TEXT). It is loaded
// with a dynamic import so this UI degrades gracefully (hidden) if that module is absent.
import { h, face } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';

let SYN = null;
export const synergyLoaded = import('../data/synergy.js').then((m) => { SYN = m; return m; }).catch(() => null);
export const hasSynergy = () => !!SYN;

const known = (id) => !!HERO_BY_ID[id];
// Normalised comp state for a (partial) team: { id, name, color, count, need, active, bonus, desc }
export function compState(ids) {
  if (!SYN || !SYN.compOf || !ids.length) return null;
  let c; try { c = SYN.compOf(ids.filter(known)); } catch { return null; }
  if (Array.isArray(c)) c = c[0];
  if (!c) return null;
  const def = (SYN.COMPS && SYN.COMPS[c.id]) || {};
  const need = c.need || def.need || 3, count = c.count ?? (c.heroes ? c.heroes.length : 0);
  return { id: c.id, name: c.name || def.name || c.id, color: def.color || '#ffd84a', count, need, active: c.active ?? count >= need, bonus: def.bonus || '', desc: def.desc || '' };
}
// Duos with both heroes on the roster.
function allDuos() { return SYN && Array.isArray(SYN.DUOS) ? SYN.DUOS.filter((d) => known(d.a) && known(d.b)) : []; }
export function duosFor(id) { return allDuos().filter((d) => d.a === id || d.b === id).map((d) => ({ ...d, partner: d.a === id ? d.b : d.a })); }
export function activeDuos(ids) { const s = new Set(ids); return allDuos().filter((d) => s.has(d.a) && s.has(d.b)); }
// Duos still possible: one hero picked, partner not taken (for the "+1 for a duo" hint).
export function openDuos(ids, takenSet) { const s = new Set(ids); return allDuos().filter((d) => (s.has(d.a) !== s.has(d.b)) && !takenSet.has(s.has(d.a) ? d.b : d.a)); }
const comboText = (d) => (SYN && SYN.COMBO_TEXT && SYN.COMBO_TEXT[d.combo]) || '';

// Draft header: archetype + progress bar, then active duos (gold) and one open duo (purple).
export function compLine(ids, takenSet) {
  const c = compState(ids); if (!c) return null;
  const act = activeDuos(ids), open = takenSet ? openDuos(ids, takenSet).slice(0, act.length ? 0 : 1) : [];
  const chip = (d, live) => h('span', { class: 'duochip' + (live ? ' live' : ''), title: `${d.name}: ${HERO_BY_ID[d.a].name} + ${HERO_BY_ID[d.b].name}${live ? ' (active)' : ' (pick the partner)'}. ${d.desc || ''} ${comboText(d)}` },
    h('img', { src: face(d.a) }), h('img', { src: face(d.b) }), ' ', d.name);
  return h('div', { class: 'compbar', style: { '--cc': c.color }, title: `${c.name}${c.active ? ' active' : ''}: ${c.desc} ${c.bonus ? '(' + c.bonus + ')' : ''}` },
    h('b', {}, `${c.name} ${Math.min(c.count, c.need)}/${c.need}`),
    h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.min(1, c.count / c.need) * 100) + '%' } })),
    act.length || open.length ? h('div', { class: 'duochips' }, ...act.map((d) => chip(d, true)), ...open.map((d) => chip(d, false))) : null);
}

// Dojo hero page: duo partners (tap to open the partner).
export function duoSection(id, open) {
  const list = duosFor(id); if (!list.length) return null;
  return h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Duo partners'),
    h('div', { class: 'dduos' }, ...list.map((d) => h('button', { class: 'dduo', onclick: () => open(d.partner) },
      h('img', { src: face(d.partner) }), h('div', {}, h('b', {}, `${d.name} · with ${HERO_BY_ID[d.partner].name}`), h('small', {}, `${d.desc || ''} ${comboText(d)}`.trim()))))));
}
