// Bosses & Beasts in menus: the map's Kami card (map select, draft, prep, share card) and monster mascots
// (rival coaches, Franchise clubs). Pure DOM helpers; read-only.
import { h, toast } from './dom.js';
import { KAMI } from '../sim/beasts.js';
import { kamiFace, monFace, RIVAL_MASCOT, clubMascot } from '../data/beasts.js';

// A map's Kami: face, name and blessing (mini: one line). Tap: the full blessing in a toast.
export function kamiCard(map, mini = false) {
  const k = map && KAMI[map.kami]; if (!k) return null;
  return h('button', { class: 'kamicard' + (mini ? ' mini' : ''), style: { '--kc': k.color }, title: `${k.name}: ${k.blessing}. ${k.desc}. Its Elder (${k.elder}) lands mid-map at 12:00.`,
    onclick: (e) => { e.stopPropagation(); toast(`${k.name} · ${k.blessing}: ${k.desc}. The ${k.elder} lands at 12:00.`, 3200); } },
  h('img', { src: kamiFace(map.kami), alt: '' }), h('span', { class: 'kt' }, h('b', {}, `${k.name} · ${k.blessing}`), h('small', {}, k.desc)));
}
// Monster mascot portraits
export const rivalMascot = (id, big = false) => (RIVAL_MASCOT[id] ? h('img', { class: 'mascot' + (big ? ' big' : ''), src: monFace(RIVAL_MASCOT[id]), alt: '', title: 'Mascot' }) : null);
export const clubMascotImg = (i, big = false) => h('img', { class: 'mascot' + (big ? ' big' : ''), src: monFace(clubMascot(i)), alt: '', title: 'Mascot' });
