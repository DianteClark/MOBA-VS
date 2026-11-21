// Hero duos and team-comp archetypes (pure data + helpers; shared by sim, draft and Dojo).
//
// DUOS: two heroes with a story. On the same team and within ~500 of each other they get a
// small passive bonus (`stats`). When both hit the same enemy hero within 2s, the duo combo
// fires (25s cooldown) and the sim emits { type: 'duo', team, a, b, duo, name, combo }:
//   burst  = 5% of the target's max HP as true damage
//   shield = both heroes gain a shield worth 8% of their max HP
//   rush   = both heroes gain +25% move speed and +15% attack speed for 3s
import { HERO_BY_ID } from './heroes.js';

export const COMBO_TEXT = {
  burst: 'Combo: 5% max HP true damage',
  shield: 'Combo: both gain an 8% max HP shield',
  rush: 'Combo: both gain +25% speed, +15% attack speed',
};

export const DUOS = [
  { id: 'twoblades', a: 'kenshi', b: 'sora', name: 'Two Blades', stats: { dmgPct: 0.05 }, combo: 'burst', desc: 'Master and wandering student: one draws, the other finishes.' },
  { id: 'storm', a: 'raiden', b: 'fujin', name: 'Wind and Thunder', stats: { haste: 8 }, combo: 'burst', desc: 'Fujin herds them into the bolt.' },
  { id: 'tanuki', a: 'ponta', b: 'kinta', name: 'Tanuki Gang', stats: { msPct: 0.05 }, combo: 'rush', desc: 'Two masked raccoons, one shiny coin.' },
  { id: 'pride', a: 'leonin', b: 'ruga', name: 'The Pride', stats: { omnivamp: 0.04 }, combo: 'rush', desc: 'The drum sounds and the hunt begins.' },
  { id: 'shieldwall', a: 'bastion', b: 'valka', name: 'Shield Wall', stats: { armor: 10, mr: 10 }, combo: 'shield', desc: 'Two shields locked edge to edge.' },
  { id: 'wildfire', a: 'ember', b: 'kaen', name: 'Wildfire', stats: { dmgPct: 0.05 }, combo: 'burst', desc: 'Sister flame and brother spark.' },
  { id: 'elders', a: 'oak', b: 'hoshi', name: 'Temple Elders', stats: { healPower: 0.1 }, combo: 'shield', desc: 'The temple keeps its own.' },
  { id: 'siegeworks', a: 'bolt', b: 'tetsu', name: 'Siege Works', stats: { siegePct: 0.15 }, combo: 'burst', desc: 'Iron clan engineering: walls come down.' },
  { id: 'nightfeast', a: 'sanguis', b: 'gaki', name: 'Night Feast', stats: { omnivamp: 0.05 }, combo: 'burst', desc: 'The Count hosts, the Ghost eats.' },
  { id: 'greenwood', a: 'fletch', b: 'wren', name: 'Greenwood Hunters', stats: { asPct: 0.08 }, combo: 'rush', desc: 'Trap them, then rain arrows.' },
  { id: 'gentlemen', a: 'marlowe', b: 'voss', name: "Gentlemen's Wager", stats: { crit: 0.05 }, combo: 'burst', desc: 'Detective and duelist, always betting on the kill.' },
  { id: 'deepwinter', a: 'yuki', b: 'frost', name: 'Deep Winter', stats: { slowOnHit: 0.1 }, combo: 'shield', desc: 'Nothing escapes the long cold.' },
  { id: 'shadows', a: 'kaze', b: 'shiro', name: 'Shadow Pair', stats: { dmgPct: 0.05 }, combo: 'burst', desc: 'One is heard, the other is not.' },
  { id: 'lanterns', a: 'kitsu', b: 'hotaru', name: 'Lantern Festival', stats: { haste: 8 }, combo: 'shield', desc: 'Foxfire and ghost-light guide the parade.' },
  { id: 'jungleking', a: 'brawlo', b: 'saru', name: 'Monkey Business', stats: { asPct: 0.08 }, combo: 'rush', desc: 'Cousins who never stop scrapping.' },
  { id: 'caveclan', a: 'grok', b: 'sling', name: 'Cave Clan', stats: { hp: 120 }, combo: 'burst', desc: 'Big rock, small rock, same family.' },
  { id: 'desert', a: 'azim', b: 'zahra', name: 'Desert Court', stats: { power: 10 }, combo: 'shield', desc: 'The sultan never fights without his dancer.' },
];
export const DUO_BY_ID = Object.fromEntries(DUOS.map((d) => [d.id, d]));
export function duosOf(heroId) { return DUOS.filter((d) => d.a === heroId || d.b === heroId).map((d) => ({ ...d, partner: d.a === heroId ? d.b : d.a })); }
export function activeDuos(heroIds) { const s = new Set(heroIds); return DUOS.filter((d) => s.has(d.a) && s.has(d.b)); }
export function duoText(d) { return `${d.name}: ${HERO_BY_ID[d.a].name} + ${HERO_BY_ID[d.b].name}. ${COMBO_TEXT[d.combo]}.`; }

// Team-comp archetypes. A hero counts toward an archetype if it has any of its tags.
// The team's best archetype with `need`+ heroes is active and gives a small team bonus.
export const COMPS = {
  dive: { name: 'Dive', color: '#ff6b5a', tags: ['dive'], need: 3, stats: { msPct: 0.04 }, bonus: '+4% move speed', desc: 'Jump the backline together.' },
  poke: { name: 'Poke', color: '#ffd84a', tags: ['poke'], need: 3, stats: { haste: 10 }, bonus: '+10 ability haste', desc: 'Whittle them down before the fight.' },
  protect: { name: 'Protect', color: '#5fe0d0', tags: ['peel', 'heal', 'shield'], need: 3, stats: { healPower: 0.1, tenacity: 0.1 }, bonus: '+10% heal/shield power, +10% tenacity', desc: 'Keep the carry alive at all costs.' },
  split: { name: 'Split', color: '#8be08b', tags: ['split', 'siege'], need: 3, stats: { siegePct: 0.15 }, bonus: '+15% damage to structures', desc: 'Pressure every lane at once.' },
  teamfight: { name: 'Teamfight', color: '#b48cff', tags: ['teamfight'], need: 3, stats: { resPct: 0.05 }, bonus: '+5% armor and magic resist', desc: 'Five-man fights decide it.' },
  pick: { name: 'Pick', color: '#ff9a3c', tags: ['pick'], need: 3, stats: { execute: 0.05 }, bonus: '+5% damage to low-HP targets', desc: 'Catch one out, then take the map.' },
};
export const COMP_ORDER = ['dive', 'poke', 'protect', 'split', 'teamfight', 'pick'];

// compOf(heroIds) -> { id, name, count, need, active, progress: [{ id, name, count, need, heroes }] }
// `id` is the best archetype (most heroes; ties go by COMP_ORDER). Works for partial drafts.
export function compOf(heroIds) {
  const heroes = heroIds.map((id) => HERO_BY_ID[id]).filter(Boolean);
  const progress = COMP_ORDER.map((k) => {
    const c = COMPS[k], who = heroes.filter((h) => h.tags.some((t) => c.tags.includes(t))).map((h) => h.id);
    return { id: k, name: c.name, count: who.length, need: c.need, heroes: who };
  });
  let best = progress[0];
  for (const p of progress) if (p.count > best.count) best = p;
  return { id: best.id, name: best.name, count: best.count, need: best.need, active: best.count >= best.need, progress };
}
