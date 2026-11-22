// Coach profiles upgrade (the public profile modal, src/ui/social.js showPlayer): the coach's club, a trophy cabinet
// (Season Cup trophies, Weekend Cups, Club Wars, best division league, prestige, achievements), signature heroes
// (most played, with win rate) and the highlight reel (their replays published to the Replay Hub).
import { h, face } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { LEAGUES } from '../data/divisions.js';
import { ROLES as CLUB_ROLES } from '../data/clubs.js';
import { clubCrest } from './clubs.js';
import { watchHub } from './hub.js';

const shelf = (img, n, label, title) => h('div', { class: 'tshelf' + (n ? '' : ' none'), title: title || label }, img, h('b', {}, String(n)), h('small', {}, label));
const icon = (src) => h('img', { src, alt: '' });

export function profileExtras(app, r, close) {
  const pub = r.pub, c = r.club, cups = r.cups || {};
  const cabinet = pub ? h('div', { class: 'tcab' }, h('small', { class: 'muted' }, 'Trophy cabinet'), h('div', { class: 'tshelves' },
    shelf(icon('assets/img/items/GoldCup.png'), pub.trophies.gold, 'Season Cups', `${pub.trophies.gold} Golden Cup${pub.trophies.gold === 1 ? '' : 's'}, ${pub.trophies.silver} Silver`),
    shelf(icon('assets/img/items/SilverCup.png'), cups.wins || 0, 'Weekend Cups', `Weekend Cups won (${cups.finals || 0} finals, ${cups.played || 0} played)`),
    shelf(icon('assets/img/crest/katana.png'), c ? c.wars : 0, 'Club Wars', 'Weekend Club Wars won by their club'),
    shelf(h('i', { class: 'lgdot', style: { background: LEAGUES[pub.league || 0].color } }), pub.league || 0, LEAGUES[pub.league || 0].name.replace(' League', ''), 'Best Weekly Division league'),
    pub.prestige ? shelf(h('i', { class: 'lgdot pst' }), pub.prestige, 'Prestige') : null,
    shelf(icon('assets/img/items/Scroll.png'), pub.ach || 0, 'Achievements'))) : null;
  const sig = pub && pub.sig && pub.sig.length ? h('div', { class: 'psig' }, h('small', { class: 'muted' }, 'Signature heroes'), h('div', { class: 'psigl' },
    ...pub.sig.filter(([id]) => HERO_BY_ID[id]).map(([id, g, w]) => h('div', { class: 'psh', title: `${HERO_BY_ID[id].name}: ${g} games, ${w} wins` }, h('img', { src: face(id), alt: '' }),
      h('div', { class: 'col' }, h('b', {}, HERO_BY_ID[id].name), h('small', { class: 'muted' }, `${g} games · ${Math.round(w / Math.max(1, g) * 100)}% wins`)))))) : null;
  const reel = r.reel && r.reel.length ? h('div', { class: 'preel' }, h('small', { class: 'muted' }, 'Highlight reel'), h('div', { class: 'preell' },
    ...r.reel.map((x) => h('button', { class: 'reelit', title: 'Watch this replay', onclick: () => { close(); watchHub(app, x.code, () => app.menu()); } },
      h('span', { class: 'reelf' }, ...((x.picks && x.picks[x.winner === 1 ? 1 : 0]) || []).slice(0, 3).filter((id) => HERO_BY_ID[id]).map((id) => h('img', { src: face(id), alt: '' }))),
      h('span', { class: 'reelt' }, x.title || `${(x.names || [])[0] || 'Blue'} vs ${(x.names || [])[1] || 'Red'}`), h('small', { class: 'muted' }, `▲ ${x.votes}`))))) : null;
  const club = c ? h('div', { class: 'pclub' }, clubCrest(c, 22), h('b', {}, c.name), h('small', { class: 'gold' }, `[${c.tag}]`), h('small', { class: 'muted' }, CLUB_ROLES[c.role] || '')) : null;
  if (!club && !cabinet && !sig && !reel) return null;
  return h('div', { class: 'col pextra' }, club, cabinet, sig, reel);
}
