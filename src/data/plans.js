// Game plans: the player-facing side (names, one-liners, strengths and counters). The sim weights live in
// src/sim/plans.js; the recommendation in src/sim/draft.js (recommendPlan).
import { PLAN_IDS, PLAN_BEATS, PLAN_EDGE } from '../sim/plans.js';

export { PLAN_IDS };
export const PLAN_INFO = {
  aggro: { name: 'Early Aggression', short: 'Aggression', icon: 'Cut', color: '#ff7a4a',
    desc: 'Invade, dive and fight around the first objectives.', strong: 'Snowballs before 10:00', weak: 'Fades if the early lead never comes' },
  scale: { name: 'Scale', short: 'Scale', icon: 'Upgrade', color: '#7fb4ff',
    desc: 'Farm safe, skip early fights, take over once the items are in.', strong: 'Strongest after 10:00', weak: 'Gives up the early map' },
  objective: { name: 'Objective Control', short: 'Objectives', icon: 'Vision', color: '#5fe0c8',
    desc: 'Wards and setups around Kami, Oni and Kraken; fights at the pits.', strong: 'Stacks Kami and Kraken', weak: 'Side lanes get less attention' },
  split: { name: 'Split Push', short: 'Split', icon: 'Explosion', color: '#8be08b',
    desc: '1-3-1: side laners push alone from 7:00 while three hold mid.', strong: 'Takes side towers', weak: 'Loses 5v4 fights' },
  protect: { name: 'Protect the Carry', short: 'Protect', icon: 'DefenseUpgrade', color: '#ffd84a',
    desc: 'Frontline and support peel and group around your best-scaling hero.', strong: 'Beats dives and picks', weak: 'Slow on the map' },
};
// Plans this one beats / loses to (the intended counters; see tools/balance.mjs --plans for the numbers).
export const beats = (id) => PLAN_BEATS[id] || [];
export const losesTo = (id) => PLAN_IDS.filter((p) => (PLAN_BEATS[p] || []).includes(id));
// The counter-plan edge as shown to players ("+5% damage").
export const EDGE_TEXT = `+${Math.round(PLAN_EDGE * 100)}% damage`;
export const planName = (id) => (PLAN_INFO[id] ? PLAN_INFO[id].name : 'Balanced');
export const planLine = (id) => (PLAN_INFO[id] ? `Beats ${beats(id).map((p) => PLAN_INFO[p].short).join(' & ')} · weak to ${losesTo(id).map((p) => PLAN_INFO[p].short).join(' & ')}` : '');
