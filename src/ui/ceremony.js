// Season-end ceremony: shown once, the first time the game opens after a season rolls over (Profile.rollover
// sets profile.newSeasonNote). Two beats: the season you just finished (peak rank, record, pass, rewards), then
// the new season's reveal in its own art. Respects Reduced effects (no staggered reveals).
import { h, mount } from './dom.js';
import { seasonById, rewardName, TITLES } from '../data/seasons.js';
import { rankOf, MIN_RATED_GAMES } from '../data/ranks.js';
import { CLANS } from '../sim/constants.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { tierBadge } from './badges.js';
import { rewardIcon } from './collection.js';
import { settings } from './settings.js';
import { audio } from '../audio.js';

const screen = () => document.getElementById('screen');
const rname = (r) => (r.kind === 'title' ? `Title “${TITLES[r.id]}”` : rewardName(r));

export function showCeremony(note, done) {
  const from = seasonById(note.from), to = seasonById(note.to), still = !!settings.reducedMotion;
  const peak = rankOf(note.peakElo);
  const step2 = () => {
    audio.sfx('powerup', 0.7);
    mount(screen(), h('div', { class: 'ceremony reveal' + (still ? ' still' : ''), style: { background: to.art ? to.art.bg : to.color, '--sc': to.color } },
      h('div', { class: 'cer-motif m-' + (to.art ? to.art.motif : 'none') }),
      h('div', { class: 'cer-body' },
        h('small', { class: 'cer-kick' }, `SEASON ${to.id} BEGINS`),
        h('h1', { class: 'cer-title' }, to.name),
        h('p', { class: 'cer-blurb' }, to.blurb),
        h('div', { class: 'cer-hl' }, ...[
          `Featured: ${CLANS[to.clan].name} heroes`, `${MAP_BY_ID[to.map] ? MAP_BY_ID[to.map].name : to.map} comes up most`, ...(to.highlights || [])].map((t, i) => h('span', { style: { '--d': i } }, t))),
        h('small', { class: 'cer-reset' }, `Your rating starts at ${note.elo} (${rankOf(note.elo).label}): halfway back toward 1000.`),
        h('button', { class: 'btn big', onclick: () => { audio.sfx('accept', 0.6); done(); } }, `Enter ${to.name}`))));
  };
  audio.sfx('levelup', 0.7);
  mount(screen(), h('div', { class: 'ceremony' + (still ? ' still' : ''), style: { background: from && from.art ? from.art.bg : '#1a1224', '--sc': from ? from.color : '#ffd84a' } },
    h('div', { class: 'cer-motif m-' + (from && from.art ? from.art.motif : 'none') }),
    h('div', { class: 'cer-body' },
      h('small', { class: 'cer-kick' }, `SEASON ${note.from} COMPLETE`),
      h('h1', { class: 'cer-title' }, from ? from.name : `Season ${note.from}`),
      h('div', { class: 'cer-row' },
        h('div', { class: 'cer-badge' }, tierBadge(peak, 88, 'rk-big'), h('b', { style: { color: peak.tier.color } }, note.peak), h('small', {}, 'Peak rank')),
        h('div', { class: 'cer-stats' },
          h('div', {}, h('b', {}, `${note.w}-${note.l}`), h('small', {}, 'Record')),
          h('div', {}, h('b', {}, `${note.pass}/${note.passMax}`), h('small', {}, 'Pass level')),
          h('div', {}, h('b', {}, note.peakElo), h('small', {}, 'Peak rating')))),
      note.eligible ? (note.rewards.length ? h('div', { class: 'cer-rw', 'aria-label': 'Season rewards' }, ...note.rewards.map((r, i) => h('div', { class: 'unlock', style: { '--d': i } }, rewardIcon(r), h('span', {}, rname(r)))))
        : h('small', { class: 'muted' }, 'No new season rewards this time.'))
        : h('small', { class: 'cer-note' }, `Play ${MIN_RATED_GAMES}+ rated matches in a season to earn its rank rewards.`),
      to ? h('button', { class: 'btn big', onclick: step2 }, 'Next season ›') : h('button', { class: 'btn big', onclick: done }, 'Continue'))));
}
