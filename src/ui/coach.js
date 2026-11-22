// Coach progression UI: Profile → Coach (coach level, the skill tree, the Coach Moment loadout), the results
// row for coach XP, and where the progression rewards come from (for the Collection's "how to earn").
import { h, icon, toast } from './dom.js';
import { TACTICS } from '../data/tactics.js';
import { rewardName, TITLES } from '../data/seasons.js';
import { BRANCHES, TREE, COACH_XP, STREAK_REWARDS, PRESTIGE_REWARDS, PRESTIGE } from '../data/meta.js';
import { LEAGUES, LEAGUE_REWARDS } from '../data/divisions.js';
import { STORY } from '../data/goals.js';
import { MOMENTS } from '../sim/moments-coach.js';
import { MOMENT_VARIANTS } from '../sim/sidegrades.js';
import { coachOf, nodeBlock, buyNode, ownsVariant, setVariant } from '../meta.js';
import { profile } from '../profile.js';
import { rewardIcon } from './collection.js';
import { audio } from '../audio.js';

const bar = (frac, color) => h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color || 'var(--gold)' } }));
const rname = (r) => (r.kind === 'title' ? `“${TITLES[r.id]}”` : rewardName(r));

// Plain-language source of a progression reward (or null): skill tree, goal streaks, Prestige, leagues, story weeks.
export function metaSource(same) {
  const n = TREE.find((x) => x.reward && same(x.reward));
  if (n) return `Coach skill tree: ${BRANCHES[n.branch].name} (coach level ${n.lv})`;
  const st = Object.entries(STREAK_REWARDS).find(([, r]) => same(r));
  if (st) return `Daily goals: a ${st[0]}-day streak`;
  const pr = Object.entries(PRESTIGE_REWARDS).find(([, r]) => same(r));
  if (pr) return `Reach Prestige ${pr[0]} (rating ${PRESTIGE.from + (pr[0] - 1) * PRESTIGE.step}+)`;
  const lg = Object.entries(LEAGUE_REWARDS).find(([, r]) => same(r));
  if (lg) return `Weekly Divisions: reach the ${LEAGUES[lg[0]].name}`;
  const ev = STORY.find((e) => same(e.reward));
  if (ev) return `Story week: ${ev.name}`;
  return null;
}

// What a node gives, in a few words.
function nodeInfo(n) {
  if (n.tactic) { const t = TACTICS[n.tactic]; return { name: t.name, img: icon(t.icon), what: `Tactic card · twin of ${TACTICS[n.alt].name}`, desc: t.desc }; }
  if (n.moment) { const v = MOMENT_VARIANTS[n.moment]; return { name: v.name, img: icon(v.icon), what: `Coach Moment · replaces ${MOMENTS[v.slot].name} when equipped`, desc: v.desc }; }
  return { name: rewardName(n.reward).replace('Title: ', ''), reward: n.reward, what: 'Look', desc: [n.reward, n.reward.also].filter(Boolean).map(rname).join(' + ') };
}

// Profile → Coach
export function coachTab(refresh, sel = null) {
  const P = profile, M = P.d.meta, c = coachOf(M);
  const pick = sel && TREE.find((n) => n.id === sel);
  const node = (n) => {
    const own = M.tree.includes(n.id), why = nodeBlock(M, n), I = nodeInfo(n);
    return h('button', { class: 'cnode' + (own ? ' own' : why ? ' locked' : ' ready') + (pick === n ? ' on' : ''), style: { '--bc': BRANCHES[n.branch].color },
      'aria-label': `${I.name}: ${own ? 'unlocked' : why || 'ready to unlock'}`, onclick: () => { audio.sfx('move', 0.4); refresh(n.id); } },
      I.img ? h('img', { src: I.img, alt: '' }) : rewardIcon(I.reward), h('b', {}, I.name), h('small', {}, own ? 'Unlocked' : `Lv ${n.lv} · ${n.cost} pt${n.cost > 1 ? 's' : ''}`));
  };
  const detail = pick ? (() => {
    const I = nodeInfo(pick), own = M.tree.includes(pick.id), why = nodeBlock(M, pick);
    return h('div', { class: 'panel cdetail', style: { '--bc': BRANCHES[pick.branch].color } },
      h('div', { class: 'col', style: { gap: '2px', flex: 1, minWidth: 0 } }, h('b', {}, I.name), h('small', { class: 'muted' }, I.what), h('small', {}, I.desc)),
      own ? h('span', { class: 'chip on' }, 'Unlocked')
        : h('button', { class: 'btn', disabled: !!why, onclick: () => { const got = buyNode(P, pick.id); if (got) { audio.sfx('accept', 0.7); toast(`${I.name} unlocked!`); refresh(pick.id); } } }, why || `Unlock · ${pick.cost} pt${pick.cost > 1 ? 's' : ''}`));
  })() : h('small', { class: 'muted center' }, 'Tap a node to see what it does.');
  const slot = (id) => {
    const vs = Object.entries(MOMENT_VARIANTS).filter(([k, v]) => v.slot === id && ownsVariant(M, k));
    const cur = M.mv[id] || null;
    return h('div', { class: 'mvslot' }, h('small', { class: 'muted' }, MOMENTS[id].name + ' slot'),
      h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
        h('button', { class: 'chip' + (!cur ? ' on' : ''), title: MOMENTS[id].desc, onclick: () => { setVariant(P, id, null); refresh(sel); } }, MOMENTS[id].name),
        ...vs.map(([k, v]) => h('button', { class: 'chip' + (cur === k ? ' on' : ''), title: v.desc, onclick: () => { setVariant(P, id, k); audio.sfx('accept', 0.4); refresh(sel); } }, v.name))));
  };
  const anyVariant = Object.keys(MOMENT_VARIANTS).some((k) => ownsVariant(M, k));
  return h('div', { class: 'col coachtab' },
    h('div', { class: 'panel crow' },
      h('div', { class: 'clv' }, h('small', {}, 'COACH'), h('b', {}, c.lv)),
      h('div', { class: 'col', style: { gap: '3px', flex: 1, minWidth: 0 } },
        h('b', {}, c.max ? `Coach level ${c.lv} · max` : `Coach level ${c.lv}`), bar(c.into),
        h('small', { class: 'muted' }, `${c.max ? 'Max level' : `${Math.round(c.need - c.left)} XP to level ${c.lv + 1}`} · win +${COACH_XP.win}, loss +${COACH_XP.loss}, calls, daily goals and story weeks`)),
      h('div', { class: 'cpts' + (c.points > 0 ? ' has' : '') }, h('b', {}, c.points), h('small', {}, 'skill pts'))),
    h('div', { class: 'ctree' }, ...Object.entries(BRANCHES).map(([k, b]) => h('div', { class: 'cbranch', style: { '--bc': b.color } },
      h('div', { class: 'cbh' }, h('b', {}, b.name), h('small', { class: 'muted' }, b.desc)),
      h('div', { class: 'cnodes' }, ...TREE.filter((n) => n.branch === k).map(node))))),
    detail,
    anyVariant ? h('div', { class: 'panel col', style: { gap: '6px' } }, h('b', {}, 'Coach Moment loadout'), h('div', { class: 'mvslots' }, ...Object.keys(MOMENTS).filter((id) => Object.values(MOMENT_VARIANTS).some((v) => v.slot === id)).map(slot))) : null,
    h('small', { class: 'muted center' }, 'Sidegrades, never upgrades: every card and moment here trades shape, not strength, with the classic one it mirrors, so they are allowed in Ranked and Cups. Unlocked cards show up in Prep and in Dojo lineups.'));
}

// Results: coach XP, level-ups and today's goal ticks.
export function coachRow(meta) {
  if (!meta) return null;
  const c = coachOf(profile.d.meta), up = meta.lvAfter > meta.lvBefore;
  return h('div', { class: 'prow crow2' }, h('div', { class: 'lvb clvb' }, `C${meta.lvAfter}`),
    h('div', { class: 'col', style: { gap: '3px', flex: 1, minWidth: 0 } },
      h('div', { class: 'xps' }, h('span', {}, `Coach +${meta.cxp}`), ...meta.goals.map((g) => h('span', { class: g.done ? 'gdone' : '' }, `${g.done ? '✓ ' : ''}${g.text} ${g.prog}/${g.n}`)),
        meta.div && meta.div.pts ? h('span', {}, `Division +${meta.div.pts}`) : null),
      bar(c.into, '#8fd3ff')),
    up ? h('b', { class: 'gold' }, `Coach level ${meta.lvAfter}!`) : null);
}
