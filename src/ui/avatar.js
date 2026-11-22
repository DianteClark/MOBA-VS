// Profile pictures (data: src/data/portraits.js): the round coach portrait shown on the coach card, the
// profile, the leaderboard, friends, the party panel and the results; and the picker (owned champions plus
// earned monster portraits, with the locked ones showing how to earn them).
import { h, toast } from './dom.js';
import { HEROES, ROLES } from '../data/heroes.js';
import { PORTRAITS, PORTRAIT_IDS, pfpSrc, pfpName, myPfp, canWear, portraitProgress } from '../data/portraits.js';
import { profile } from '../profile.js';
import { owns } from '../unlocks.js';
import { audio } from '../audio.js';

// <img> of any coach's picture id (unknown or missing ids show the default).
export function avatar(pfp, cls = '') { return h('img', { class: 'pfp' + (cls ? ' ' + cls : ''), src: pfpSrc(pfp), alt: '', title: pfpName(pfp), loading: 'lazy' }); }
export const myAvatar = (cls = '') => avatar(myPfp(profile), cls);
// Results: [blue, red] pictures (mine, and an online opponent's from their looks).
export function resultAvatars(s) {
  const out = [null, null];
  if (!s || s.myTeam < 0) return out;
  out[s.myTeam] = myAvatar('rpfp');
  if (s.oppLooks && s.oppLooks.pfp) out[1 - s.myTeam] = avatar(s.oppLooks.pfp, 'rpfp');
  return out;
}

// The picker: champions you own (by role), then monster portraits (earned ones first; locked ones with progress).
export function pickPortrait(onDone) {
  const close = () => m.remove();
  const cur = myPfp(profile);
  const choose = (id) => { if (!canWear(profile, id)) return; profile.d.equip.pfp = id; profile.save(); audio.sfx('accept', 0.6); toast(`Profile picture: ${pfpName(id)}`, 1600); close(); if (onDone) onDone(); };
  const champs = ROLES.flatMap((r) => HEROES.filter((x) => x.role === r && owns(profile, x.id))).map((x) => `h:${x.id}`);
  const mons = PORTRAIT_IDS.map((k) => `m:${k}`).sort((a, b) => (canWear(profile, b) ? 1 : 0) - (canWear(profile, a) ? 1 : 0));
  const cell = (id) => {
    const ok = canWear(profile, id), g = id[0] === 'm' ? portraitProgress(profile, id.slice(2)) : null;
    return h('button', { class: 'pfpcell' + (id === cur ? ' on' : '') + (ok ? '' : ' locked'), disabled: !ok, title: ok ? pfpName(id) : `${pfpName(id)}: ${PORTRAITS[id.slice(2)].how}`, onclick: () => choose(id) },
      h('img', { src: pfpSrc(id), alt: '' }), h('small', {}, ok ? pfpName(id) : g && g.n > 1 ? `${g.have}/${g.n}` : 'Locked'));
  };
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel pfppick' }, h('div', { class: 'mhead' }, h('b', {}, 'Profile picture'), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, 'X')),
      h('small', { class: 'muted' }, 'Any champion you own, or a monster portrait earned in play.'),
      h('div', { class: 'dsh' }, 'Your champions'), h('div', { class: 'pfpgrid' }, ...champs.map(cell)),
      h('div', { class: 'dsh' }, 'Monsters & bosses'), h('div', { class: 'pfpgrid' }, ...mons.map(cell))));
  document.body.append(m);
}
