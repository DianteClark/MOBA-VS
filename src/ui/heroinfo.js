// Hero info sheet (v25.1): every champion's stats, owned or not, from anywhere a hero face shows up — the
// draft (picks, bans, locked heroes), the Shop, the in-match hero card, rivals and profile screens.
// One modal: ratings, passive + abilities, talents, builds, lore, and a way to the full Dojo page.
import { h, face, icon } from './dom.js';
import { HERO_BY_ID, ROLE_LABEL, PERSONALITIES } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';
import { BUILDS } from '../data/items.js';
import { heroTalents, TALENT_LEVELS } from '../data/talents.js';
import { heroRatings } from '../data/herostats.js';
import { TIERS, tierOf } from '../data/unlocks.js';
import { profile } from '../profile.js';
import { owns, inRotation } from '../unlocks.js';
import { statBars } from './heroui.js';
import { abilitySentence } from './herotext.js';
import { buildLine } from './buildguide.js';
import { audio } from '../audio.js';

const CURVE = { early: 'Strong early', mid: 'Mid-game peak', late: 'Scales late' };
let openEl = null;
export function closeHeroInfo() { if (openEl) { openEl.remove(); openEl = null; } }

// opts: { app } adds "Full hero page" (the Dojo; left out in a match), { note } one extra line under the head
// (e.g. the role a draft pick plays), { onClose }.
export function heroInfo(id, opts = {}) {
  const x = HERO_BY_ID[id]; if (!x) return null;
  closeHeroInfo();
  audio.sfx('move', 0.4);
  const pers = PERSONALITIES[x.pers], clan = CLANS[x.clan], t = TIERS[tierOf(id)];
  const own = owns(profile, id), status = own ? 'Owned' : inRotation(id) ? 'Free this week' : 'Not owned';
  const close = () => { if (openEl === m) openEl = null; m.remove(); if (opts.onClose) opts.onClose(); };
  const sec = (title, ...kids) => h('div', { class: 'hisec' }, h('div', { class: 'dsh' }, title), ...kids);
  const tal = heroTalents(id);
  const m = h('div', { class: 'modal hinfo', role: 'dialog', 'aria-label': `${x.name} hero info`, onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel hipanel', style: { '--cc': clan.color } },
      h('div', { class: 'mhead' }, h('b', {}, x.name), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, 'X')),
      h('div', { class: 'hihead' }, h('img', { class: 'hiface', src: face(id), alt: '' }),
        h('div', { class: 'col hicol' },
          h('div', { class: 'gold' }, x.title),
          h('div', { class: 'muted small' }, `${ROLE_LABEL[x.role]}${x.flex.length ? ' · flex ' + x.flex.map((q) => ROLE_LABEL[q]).join('/') : ''} · ${x.ranged ? 'Ranged' : 'Melee'} · ${CURVE[x.curve] || ''} · Difficulty ${heroRatings(id).difficulty}`),
          h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': clan.color } }, clan.name), h('span', { class: 'chipx', style: { '--cc': pers.color }, title: pers.desc }, pers.name),
            h('span', { class: 'chipx plain hiown' + (own ? ' own' : '') }, h('span', { class: 'tierc', style: { '--tc': t.color } }, t.name), ' ', status)))),
      opts.note ? h('div', { class: 'hinote' }, opts.note) : null,
      sec('Ratings', statBars(id, true)),
      sec('Abilities',
        h('div', { class: 'dab' }, h('img', { src: icon('LuckUpgrade'), alt: '' }), h('div', {}, h('b', {}, x.passive.name, h('small', {}, 'Passive')), h('p', {}, x.passive.desc))),
        ...x.abilities.map((a) => { const s = abilitySentence(a, x); return h('div', { class: 'dab' + (a.ult ? ' ult' : '') }, h('img', { src: icon(a.icon), alt: '' }),
          h('div', {}, h('b', {}, a.name, h('small', {}, a.ult ? 'Ultimate · level 5' : s.meta.split(' · ')[0])), h('p', {}, s.text))); })),
      tal.length ? sec('Talents', h('div', { class: 'hital' }, ...tal.map((opt, i) => h('div', { class: 'hitier' }, h('span', { class: 'tal-lv' }, 'L' + TALENT_LEVELS[i]),
        ...opt.map((q) => h('div', { class: 'hitopt' }, h('img', { src: icon(q.icon), alt: '' }), h('div', {}, h('b', {}, q.name), h('small', {}, q.text)))))))) : null,
      sec('Builds', h('div', { class: 'chips' }, ...x.builds.map((b) => h('span', { class: 'chipx', style: { '--cc': BUILDS[b].color }, title: buildLine(b), 'data-build': b, 'data-build-info': true }, BUILDS[b].name + (b === x.rec ? ' ★' : '')))),
        h('small', { class: 'muted' }, '★ recommended. ' + buildLine(x.rec))),
      x.lore ? sec('Lore', h('p', { class: 'small hilore' }, x.lore)) : null,
      opts.app ? h('button', { class: 'btn hifull', onclick: async () => { close(); const { showDojo } = await import('./dojo.js'); showDojo(opts.app, { tab: 'heroes', hero: id, page: 'info' }); } }, 'Full hero page: matchups, skins, mastery ›') : null));
  document.body.append(m);
  openEl = m;
  return m;
}
// A hero face that opens the info sheet (rivals, profile, results lists).
export function heroFaceBtn(id, opts = {}, ...kids) {
  return h('button', { class: 'hifacebtn' + (opts.cls ? ' ' + opts.cls : ''), title: `${HERO_BY_ID[id] ? HERO_BY_ID[id].name : id}: stats and abilities`, 'aria-label': `${HERO_BY_ID[id] ? HERO_BY_ID[id].name : id} info`,
    onclick: (e) => { e.stopPropagation(); heroInfo(id, opts); } }, h('img', { src: face(id), alt: '' }), ...kids);
}
