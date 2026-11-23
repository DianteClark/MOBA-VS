// Tactic deck building (prep and Dojo lineups): pick 3 of your owned cards, or take a recommended deck for a plan.
// Locked cards show what unlocks them (coach level, achievement, skill tree) and cannot be picked.
import { h, mount, icon } from './dom.js';
import { TACTICS, TACTIC_IDS, COND_TEXT, DEFAULT_DECK } from '../data/tactics.js';
import { PLAN_DECKS } from '../sim/draft.js';
import { PLAN_INFO, PLAN_IDS } from '../data/plans.js';
import { ownsTactic, tacticLock } from '../meta.js';
import { profile } from '../profile.js';

const owned = (id) => ownsTactic(profile.d.meta, id, profile.d);
// The first recommended deck for a plan that you fully own (else the first one, with unowned cards swapped for owned ones).
function recDeck(plan) {
  const list = PLAN_DECKS[plan]; if (!list) return null;
  const full = list.find((d) => d.every(owned));
  if (full) return full.slice();
  const d = list[0].filter(owned);
  for (const id of [...list.flat(), ...DEFAULT_DECK]) if (d.length < 3 && !d.includes(id) && owned(id)) d.push(id);
  return d;
}
// One card button. on: in the deck; lock: why it is locked (null if owned).
function cardButton(id, on, lock, onclick) {
  const t = TACTICS[id];
  return h('button', { class: 'card' + (on ? ' sel' : '') + (lock ? ' lock' : ''), disabled: !!lock, title: `${t.name}: ${t.desc}${t.counter ? ` Countered by: ${t.counter}.` : ''}`, onclick },
    h('img', { src: icon(t.icon), alt: '' }),
    h('div', { class: 'cn' }, t.name, t.cond ? h('span', { class: 'ccond' }, COND_TEXT[t.cond]) : null),
    h('div', { class: 'cs' }, lock || t.short),
    h('div', { class: 'cd' }, t.desc),
    !lock && t.counter ? h('div', { class: 'cc' }, `Countered by: ${t.counter}`) : null,
    on ? h('i', { class: 'tick' }) : null);
}
// The whole picker: recommended decks (one chip per plan) and the card grid. get/set read and write the deck.
// plan: the lineup's plan (its chip is marked).
export function deckPicker({ get, set, plan, onChange }) {
  const box = h('div', { class: 'deckpick' });
  const draw = () => {
    const deck = get(), ids = TACTIC_IDS.filter((id) => owned(id) || deck.includes(id)), locked = TACTIC_IDS.filter((id) => !ids.includes(id));
    const toggle = (id) => { const d = get(); set(d.includes(id) ? d.filter((x) => x !== id) : d.length < 3 ? [...d, id] : [...d.slice(1), id]); draw(); if (onChange) onChange(); };
    const plans = PLAN_IDS.filter((k) => PLAN_DECKS[k]);
    mount(box,
      h('div', { class: 'drec' }, h('small', { class: 'muted' }, 'Recommended:'),
        ...plans.map((k) => { const d = recDeck(k), same = d && d.length === 3 && d.every((x) => deck.includes(x));
          return h('button', { class: 'chip drc' + (same ? ' on' : '') + (k === plan ? ' mine' : ''), style: { '--pc': PLAN_INFO[k].color }, title: `${PLAN_INFO[k].name}: ${d.map((x) => TACTICS[x].name).join(', ')}`,
            onclick: () => { set(d); draw(); if (onChange) onChange(); } }, PLAN_INFO[k].short); })),
      h('div', { class: 'deck' }, ...ids.map((id) => cardButton(id, deck.includes(id), null, () => toggle(id)))),
      locked.length ? h('div', { class: 'dlock' }, h('small', { class: 'muted' }, `Locked (${locked.length}): unlock with coach levels, achievements and the coach skill tree. Same strength as the others, just different.`)) : null,
      locked.length ? h('div', { class: 'deck locked' }, ...locked.map((id) => cardButton(id, false, tacticLock(profile.d.meta, id, profile.d)))) : null);
  };
  draw();
  return box;
}

// Dojo → Cards: every tactic card, what it does, what beats it, which plans recommend it and how to unlock it.
const TARGET_TXT = { none: 'Instant', lane: 'Pick a lane', hero: 'Pick an ally' };
export function cardList() {
  const plansOf = (id) => PLAN_IDS.filter((k) => PLAN_DECKS[k] && PLAN_DECKS[k].some((d) => d.includes(id))).map((k) => PLAN_INFO[k].short);
  const nOwned = TACTIC_IDS.filter(owned).length;
  return h('div', { class: 'col' },
    h('small', { class: 'muted center' }, `${TACTIC_IDS.length} tactic cards, ${nOwned} unlocked. Bring 3 to every match (prep or Lineups); each plays once. Locked cards come with coach levels, achievements and the coach skill tree, and are never stronger than the free ones.`),
    h('div', { class: 'clist' }, ...TACTIC_IDS.map((id) => {
      const t = TACTICS[id], lock = tacticLock(profile.d.meta, id, profile.d), pl = plansOf(id);
      return h('div', { class: 'clcard' + (lock ? ' lock' : '') },
        h('div', { class: 'clhead' }, h('img', { src: icon(t.icon), alt: '' }), h('b', {}, t.name), h('small', {}, TARGET_TXT[t.target] || ''), t.cond ? h('span', { class: 'ccond' }, COND_TEXT[t.cond]) : null),
        h('div', { class: 'cldesc' }, t.desc),
        t.counter ? h('div', { class: 'bgrow bad' }, h('span', {}, 'Countered by'), h('span', {}, t.counter)) : null,
        pl.length ? h('div', { class: 'bgrow' }, h('span', {}, 'Plans'), h('span', {}, pl.join(' · '))) : null,
        h('div', { class: 'bgrow ' + (lock ? '' : 'good') }, h('span', {}, lock ? 'Unlock' : 'Owned'), h('span', {}, lock || (t.alt ? `Skill tree twin of ${TACTICS[t.alt].name}` : t.unlock ? 'Unlocked' : 'Free'))));
    })));
}
