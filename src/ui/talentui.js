// Talent views (v23): the Dojo's full talent list, the compact pickers in prep and the Dojo lineups,
// and the small taken-talent icons on the in-match hero card. Data: src/data/talents.js.
import { h, icon } from './dom.js';
import { heroTalents, TALENT_LEVELS } from '../data/talents.js';
import { audio } from '../audio.js';

// Full list (Dojo hero page): three tiers, two cards each; tapping a card makes it the default,
// tapping it again hands that tier back to the hero ("Auto").
export function talentList(heroId, prefs, onPick) {
  const tiers = heroTalents(heroId);
  return h('div', { class: 'tal-list' }, ...tiers.map((opts, i) => h('div', { class: 'tal-tier' },
    h('span', { class: 'tal-lv', title: `Level ${TALENT_LEVELS[i]}` }, 'L' + TALENT_LEVELS[i], h('small', {}, prefs[i] < 0 ? 'Auto' : 'Set')),
    ...opts.map((t, k) => h('button', { class: 'tal-opt' + (prefs[i] === k ? ' on' : ''), title: prefs[i] === k ? 'Tap again: let the hero decide' : 'Tap: always take this one',
      onclick: () => { audio.sfx('move', 0.4); onPick(i, prefs[i] === k ? -1 : k); } },
      h('img', { src: icon(t.icon), alt: '' }), h('div', {}, h('b', {}, t.name), h('small', {}, t.text)))))));
}

// Compact picker (prep cards, lineups): one segmented row per tier: Auto | A | B.
export function talentPicker(heroId, prefs, onPick, disabled) {
  const tiers = heroTalents(heroId);
  return h('div', { class: 'tal-pick' }, ...tiers.map((opts, i) => h('div', { class: 'tal-seg' },
    h('span', { class: 'tal-lv' }, 'L' + TALENT_LEVELS[i]),
    h('button', { class: 'tal-b auto' + (prefs[i] < 0 ? ' on' : ''), disabled, title: 'The hero picks for the game it is having', onclick: () => { audio.sfx('move', 0.4); onPick(i, -1); } }, 'Auto'),
    ...opts.map((t, k) => h('button', { class: 'tal-b' + (prefs[i] === k ? ' on' : ''), disabled, title: t.text, onclick: () => { audio.sfx('move', 0.4); onPick(i, k); } },
      h('img', { src: icon(t.icon), alt: '' }), h('span', {}, t.name))))));
}

// Short summary for a lineup row: "Auto" or the chosen names, e.g. "Iron Skin · Auto · Aftershock".
export function talentSummary(heroId, prefs) {
  if (prefs.every((p) => p < 0)) return 'Talents: Auto';
  const tiers = heroTalents(heroId);
  return prefs.map((p, i) => (p < 0 ? 'Auto' : tiers[i][p].name)).join(' · ');
}

// Taken talents of a live hero (hero card / detail panel): up to three small icons, the rest as dots.
export function talentIcons(x) {
  if (!x.tal) return null;
  const tiers = heroTalents(x.heroId);
  return h('div', { class: 'tal-ic' }, ...x.tal.map((p, i) => (p < 0
    ? h('i', { class: 'tal-dot', title: `Talent at level ${TALENT_LEVELS[i]}` })
    : h('img', { src: icon(tiers[i][p].icon), title: `L${TALENT_LEVELS[i]} ${tiers[i][p].name}: ${tiers[i][p].text}` }))));
}
export const talentKey = (x) => (x.tal ? x.tal.join(',') : '');
