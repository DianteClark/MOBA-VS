// Hero Mastery in the UI: results row, Profile → Mastery tab, and the Dojo hero-page panel.
import { h, face, toast } from './dom.js';
import { HEROES } from '../data/heroes.js';
import { SKINS } from '../data/seasons.js';
import { profile, titleName } from '../profile.js';
import { MASTERY_MAX, MASTERY_AT, MASTERY_TITLES, MASTERY_TINTS, MASTERY_PTS, masteryColor, masteryTitleKey } from '../mastery.js';
import { masteryBadge } from './badges.js';
import { audio } from '../audio.js';

const bar = (frac, color) => h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color } }));

// Results: the five heroes with their mastery gain; level-ups glow.
export function masteryRow(sum) {
  if (!sum || !sum.mastery || !sum.mastery.length) return null;
  return h('div', { class: 'prow mrow' }, ...sum.mastery.map((m) => {
    const up = m.after > m.before;
    return h('div', { class: 'mres' + (up ? ' up' : ''), title: m.parts.map(([l, v]) => `${l} +${v}`).join(' · ') },
      h('img', { src: face(m.id) }), masteryBadge(m.after, { always: true, cls: 'mini' }),
      h('small', {}, up ? `Mastery ${m.after}!` : `+${m.gain}`),
      bar(m.info.into, masteryColor(m.after)),
      m.rewards.length ? h('small', { class: 'gold' }, m.rewards.map((r) => (r.kind === 'title' ? 'Title' : 'Tint')).join(' + ')) : null);
  }));
}

function rewardsList(id, lv) {
  const rows = [];
  for (let l = 2; l <= MASTERY_MAX; l++) {
    const parts = [];
    if (l === 2) parts.push('Mastery badge on draft cards');
    if (MASTERY_TITLES[l]) parts.push(`Title “${titleName(masteryTitleKey(id, l))}”`);
    if (MASTERY_TINTS[l]) parts.push(`${SKINS[MASTERY_TINTS[l]].name} tint`);
    if (parts.length) rows.push(h('div', { class: 'mrw' + (lv >= l ? ' got' : '') }, masteryBadge(l, { always: true, cls: 'mini' }), h('span', {}, parts.join(' · '))));
  }
  return rows;
}

// Dojo hero page section.
export function masteryPanel(id) {
  const m = profile.mastery(id);
  return h('div', { class: 'dsec mpanel2' },
    h('div', { class: 'dsh' }, 'Mastery'),
    h('div', { class: 'mhead2' }, masteryBadge(m.lv, { always: true, cls: 'big' }),
      h('div', { class: 'col', style: { gap: '3px', flex: 1 } },
        h('b', { style: { color: masteryColor(m.lv) } }, m.max ? 'Mastery 10 · Sensei' : `Mastery ${m.lv}`),
        bar(m.into, masteryColor(m.lv)),
        h('small', { class: 'muted' }, m.max ? `${m.pts} points` : `${m.pts} / ${MASTERY_AT[m.lv + 1]} points to Mastery ${m.lv + 1}`))),
    h('small', { class: 'muted' }, `Earn points coaching this hero: played +${MASTERY_PTS.play}, win +${MASTERY_PTS.win}, MVP +${MASTERY_PTS.mvp}, Play of the Game +${MASTERY_PTS.potg}, +${MASTERY_PTS.call} per call it answered that paid off.`),
    h('div', { class: 'mrws' }, ...rewardsList(id, m.lv)));
}

// Profile → Mastery: every hero you have played, best first; tap to equip a mastery title.
export function masteryTab() {
  const list = HEROES.map((x) => ({ x, m: profile.mastery(x.id) })).filter((o) => o.m.pts > 0).sort((a, b) => b.m.pts - a.m.pts);
  if (!list.length) return h('p', { class: 'muted center' }, 'Play matches to level up your heroes: every hero you coach earns mastery (1-10), with badges, titles and tints.');
  const total = list.reduce((a, o) => a + o.m.lv, 0);
  return h('div', { class: 'col' },
    h('small', { class: 'muted center' }, `${list.length} heroes played · total mastery ${total}`),
    h('div', { class: 'mgrid' }, ...list.map(({ x, m }) => h('button', { class: 'mcard', style: { '--mc': masteryColor(m.lv) }, onclick: () => {
      const best = [10, 7, 4].find((l) => m.lv >= l);
      if (!best) { toast(`${x.name}: Mastery 4 unlocks a title`); return; }
      const key = masteryTitleKey(x.id, best); profile.equip('title', key); audio.sfx('accept', 0.5); toast(`Title equipped: ${titleName(key)}`);
    } },
      h('img', { src: face(x.id) }), masteryBadge(m.lv, { always: true, cls: 'mini' }), h('b', {}, x.name),
      bar(m.into, masteryColor(m.lv)), h('small', { class: 'muted' }, m.max ? 'Max' : `${m.toNext} to ${m.lv + 1}`)))));
}
