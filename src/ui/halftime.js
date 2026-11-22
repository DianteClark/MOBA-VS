// Halftime (7:30): the match holds while both coaches adjust: plan, builds and one card swap.
// Changes go out as ordinary commands and apply the moment play resumes.
import { h, mount, face, icon } from './dom.js';
import { TACTICS, TACTIC_IDS } from '../data/tactics.js';
import { ownsTactic } from '../meta.js';
import { profile } from '../profile.js';
import { BUILDS } from '../data/items.js';
import { audio } from '../audio.js';
import { PLAN_IDS, PLAN_INFO, planName, beats, EDGE_TEXT } from '../data/plans.js';

let el = null, timer = 0;

export function showHalftime(app, g, my, runner, ht) {
  hideHalftime();
  audio.sfx('alert', 0.7);
  el = h('div', { id: 'halftime' });
  document.getElementById('hud').append(el);
  const pick = { swapFrom: null, swapped: false, plan: my >= 0 ? g.teams[my].plan : null, builds: {} };
  const render = () => {
    if (!el) return;
    const left = Math.max(0, Math.ceil((ht.end - performance.now()) / 1000));
    const t0 = g.teams[0], t1 = g.teams[1];
    const score = h('div', { class: 'ht-score' },
      h('div', { class: 'blue' }, h('b', {}, g.towersStanding(0)), h('small', {}, 'towers'), h('span', {}, `${t0.kills} kills`)),
      h('div', { class: 'ht-clock' }, h('small', {}, 'HALFTIME'), h('b', { id: 'ht-left' }, left)),
      h('div', { class: 'red' }, h('b', {}, g.towersStanding(1)), h('small', {}, 'towers'), h('span', {}, `${t1.kills} kills`)));
    if (my < 0) { mount(el, h('div', { class: 'ht-card' }, score, h('p', { class: 'muted center' }, 'Both coaches are adjusting…'))); return; }
    const team = g.teams[my];
    // one plan change per match, here: the last pick before play resumes stands (both sides see it at the restart)
    // co-op: the lead sets the plan and swaps the card; each coach adjusts their own heroes' builds
    const ct = app.session && app.session.mode === 'coop' ? team.coop : null, seat = app.session.mySeat || 0;
    const lead = !ct || ct.ai || ct.lead === seat, own = (x) => !ct || ct.ai || x.seat === seat;
    const leadName = ct && !lead ? ((app.session.coop[my].coaches.find((c) => c.seat === ct.lead) || {}).name || 'The lead') : '';
    const enemyPlan = g.teams[1 - my].plan;
    const plan = !lead ? h('div', { class: 'ht-sec' }, h('div', { class: 'ht-h' }, 'Game plan'), h('small', { class: 'muted' }, `${leadName} leads: plan ${planName(team.plan)}, and they may swap a card.`)) : h('div', { class: 'ht-sec' }, h('div', { class: 'ht-h' }, `Game plan · yours ${PLAN_INFO[pick.plan] ? PLAN_INFO[pick.plan].short : planName(pick.plan)} · theirs ${PLAN_INFO[enemyPlan] ? PLAN_INFO[enemyPlan].short : planName(enemyPlan)}`),
      h('div', { class: 'ht-row htplans' }, ...PLAN_IDS.map((id) => { const P = PLAN_INFO[id];
        return h('button', { class: 'tile' + (pick.plan === id ? ' rec' : ''), title: `${P.desc} Strong: ${P.strong}. Weak: ${P.weak}.`, style: { '--pc': P.color },
          onclick: () => { if (pick.plan === id) return; pick.plan = id; runner.send({ type: 'plan', plan: id }); audio.sfx('move', 0.5); render(); } },
          h('div', {}, h('b', {}, P.short), h('small', { class: beats(id).includes(enemyPlan) ? 'htedge' : beats(enemyPlan).includes(id) ? 'htbad' : '' },
            beats(id).includes(enemyPlan) ? `Counters theirs: ${EDGE_TEXT}` : beats(enemyPlan).includes(id) ? 'Countered by theirs' : P.strong))); })));
    const unused = team.deck.filter((d) => !d.used);
    const swap = !lead ? null : h('div', { class: 'ht-sec' }, h('div', { class: 'ht-h' }, pick.swapped ? 'Card swapped' : pick.swapFrom ? `Swap ${TACTICS[pick.swapFrom].name} for…` : 'Swap one unused card (optional)'),
      pick.swapped ? null : pick.swapFrom
        ? h('div', { class: 'ht-row wrap' }, ...TACTIC_IDS.filter((id) => !team.deck.some((d) => d.id === id) && ownsTactic(profile.d.meta, id, profile.d)).map((id) => h('button', { class: 'tcard', title: TACTICS[id].desc, onclick: () => { runner.send({ type: 'redraw', card: pick.swapFrom, to: id }); pick.swapped = true; audio.sfx('accept', 0.6); render(); } }, h('img', { src: icon(TACTICS[id].icon) }), h('div', { class: 'tc-t' }, h('b', {}, TACTICS[id].name), h('small', {}, TACTICS[id].short)))))
        : h('div', { class: 'ht-row wrap' }, ...(unused.length ? unused.map((d) => h('button', { class: 'tcard', onclick: () => { pick.swapFrom = d.id; render(); } }, h('img', { src: icon(TACTICS[d.id].icon) }), h('div', { class: 'tc-t' }, h('b', {}, TACTICS[d.id].name), h('small', {}, 'tap to swap'))))
          : [h('small', { class: 'muted' }, 'All cards played.')])));
    const builds = h('div', { class: 'ht-sec' }, h('div', { class: 'ht-h' }, 'Builds (future items)'),
      h('div', { class: 'ht-builds' }, ...team.heroes.filter(own).map((x) => h('div', { class: 'ht-hero' }, h('img', { src: face(x.heroId) }),
        h('div', { class: 'ht-row' }, ...x.def.builds.map((b) => { const cur = (pick.builds[x.id] || x.build) === b; return h('button', { class: 'chip' + (cur ? ' on' : ''), style: { color: cur ? BUILDS[b].color : '' }, onclick: () => { if (cur) return; pick.builds[x.id] = b; runner.send({ type: 'build', hero: x.id, build: b }); render(); } }, BUILDS[b].name); }))))));
    mount(el, h('div', { class: 'ht-card' }, score, plan, swap, builds,
      h('button', { class: 'btn big', disabled: ht.me, onclick: () => { runner.readyHalftime(); audio.sfx('accept', 0.7); render(); } }, ht.me ? (ht.them ? 'Resuming…' : ct ? 'Waiting for the other coaches…' : 'Waiting for opponent…') : 'Ready')));
  };
  render();
  clearInterval(timer);
  timer = setInterval(() => { const n = document.getElementById('ht-left'); if (!el) return clearInterval(timer); if (n) n.textContent = Math.max(0, Math.ceil((ht.end - performance.now()) / 1000)); }, 250);
}
export function hideHalftime() { clearInterval(timer); if (el) { el.remove(); el = null; } }
