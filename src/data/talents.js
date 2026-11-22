// Hero talents (v23): at levels 4, 8 and 12 every hero picks 1 of 2 talents.
// Pure data + text helpers, shared by the sim (src/sim/talents.js), the Dojo, prep and the HUD.
//
// A talent is a reusable EFFECT TEMPLATE plus (for ability talents) a slot:
//   'q.dmg'  = template `dmg` on ability slot 0 (q = 0, w = 1, r = 2, the ultimate)
//   'vamp'   = a hero-wide template
// Template fields:
//   name(abName) / text(abName)  display strings
//   ab:   ability modifier (multipliers on a per-hero copy of the ability)
//         { dmg, cd, area, range, ccDur, heal, buffDur, add: { cc riders }, burn }
//   stat: permanent stats (any Game STAT_KEYS key, e.g. armor, omnivamp, haste)
//   cond: { when: 'lowHp' | 'ally' | 'alone', stat }          conditional stats (refreshed every 0.5s)
//   vs:   { when: 'cc' | 'first', pct }                         damage vs heroes in a state
//   kill: { heal, ms, dur, cdr }                                on takedown (kill or assist)
//   ult:  { streak, shield }                                    ultimate-upgrade tweaks (src/sim/talents.js)
//   tags: hints for the AI's pick (vsTank, vsHeal, vsCC, vsBurst, snowball, safe, team, split)
// Every hero lists 3 tiers x 2 options: [[t1a, t1b], [t2a, t2b], [t3a, t3b]].
// Tier 1 (level 4) shapes a basic ability, tier 2 (level 8) the hero's style, tier 3 (level 12) the ultimate.
import { HEROES, HERO_BY_ID } from './heroes.js';

export const TALENT_LEVELS = [4, 8, 12];
export const TALENT_WINDOW = 6; // seconds after the level-up in which a coach may swap the pick

const pct = (v) => Math.round(v * 100) + '%';
const TEMPLATES = {
  // ── ability modifiers (need a slot) ──
  dmg: { name: (a) => `Honed ${a}`, text: (a, r) => `${a} deals +${pct(r ? 0.1 : 0.12)} damage.`, ab: (r) => ({ dmg: r ? 1.1 : 1.12 }), tags: [] },
  cd: { name: (a) => `Swift ${a}`, text: (a, r) => `${a} cooldown -${pct(r ? 0.18 : 0.16)}.`, ab: (r) => ({ cd: r ? 0.82 : 0.84 }), tags: [] },
  area: { name: (a) => `Vast ${a}`, text: (a) => `${a} hits a 22% bigger area.`, ab: () => ({ area: 1.22 }), tags: ['team'] },
  reach: { name: (a) => `Far ${a}`, text: (a) => `${a} reaches 15% farther.`, ab: () => ({ range: 1.15 }), tags: [] },
  hold: { name: (a) => `Binding ${a}`, text: (a) => `${a}'s crowd control lasts 35% longer, and it cools down 6% faster.`, ab: () => ({ ccDur: 1.35, cd: 0.94 }), tags: ['team'] },
  mend: { name: (a) => `Blessed ${a}`, text: (a) => `${a} heals and shields 30% more.`, ab: () => ({ heal: 1.3 }), tags: ['team', 'safe'] },
  buff: { name: (a) => `Lasting ${a}`, text: (a) => `${a}'s effect lasts 40% longer, and it cools down 6% faster.`, ab: () => ({ buffDur: 1.4, cd: 0.94 }), tags: [] },
  chill: { name: (a) => `Frosted ${a}`, text: (a) => `${a} also slows by 25% for 1.5s.`, ab: () => ({ add: { slow: [0.25, 1.5] } }), tags: ['team'] },
  shred: { name: (a) => `Rending ${a}`, text: (a) => `${a} shreds 15% armor and magic resist for 3s.`, ab: () => ({ add: { shred: [0.15, 3] } }), tags: ['vsTank'] },
  mark: { name: (a) => `Hunter's ${a}`, text: (a) => `${a} marks its target: the next ally hit deals +15%.`, ab: () => ({ add: { mark: [0.15, 3] } }), tags: ['team'] },
  wound: { name: (a) => `Cursed ${a}`, text: (a) => `${a} applies Grievous Wounds (-40% healing) for 4s and deals +6% damage.`, ab: () => ({ add: { grievous: 4 }, dmg: 1.06 }), tags: ['vsHeal'] },
  burn: { name: (a) => `Searing ${a}`, text: (a) => `${a} sets the target ablaze for 3s.`, ab: () => ({ burn: { b: 14, l: 5, ad: 0.08, ap: 0.08, dur: 3 } }), tags: ['vsHeal'] },
  // ── hero-wide ──
  armor: { name: () => 'Iron Skin', text: () => '+12 armor and +12 magic resist.', stat: { armor: 12, mr: 12 }, tags: ['safe', 'vsBurst'] },
  vital: { name: () => 'Vitality', text: () => '+10% max HP.', stat: { hpPct: 0.1 }, tags: ['safe', 'vsBurst'] },
  vamp: { name: () => 'Bloodthirst', text: () => '+12% omnivamp (heal from all damage) and +4% max HP.', stat: { omnivamp: 0.12, hpPct: 0.04 }, tags: ['safe'] },
  swift: { name: () => 'Fleet Foot', text: () => '+8% move speed and +8% attack speed.', stat: { msPct: 0.08, asPct: 0.08 }, tags: [] },
  fury: { name: () => 'Fury', text: () => '+16% attack speed.', stat: { asPct: 0.16 }, tags: [] },
  focus: { name: () => 'Focus', text: () => '+14 ability haste (faster cooldowns).', stat: { haste: 14 }, tags: [] },
  crit: { name: () => 'Precision', text: () => '+12% critical strike chance.', stat: { crit: 0.12 }, tags: [] },
  pierce: { name: () => 'Armor Breaker', text: () => '+10% armor and magic penetration.', stat: { pen: 0.1 }, tags: ['vsTank'] },
  tenacity: { name: () => 'Unshakable', text: () => '+25% tenacity (shorter stuns, roots and slows).', stat: { tenacity: 0.25 }, tags: ['vsCC'] },
  healer: { name: () => 'Gentle Hands', text: () => '+15% heal and shield power.', stat: { healPower: 0.15 }, tags: ['team'] },
  guard: { name: () => 'Guardian Spirit', text: () => 'A hurt ally nearby (below 50%) gets a shield of 10% of your max HP. 18s cooldown. +5 armor.', stat: { guard: 0.1, armor: 5 }, tags: ['team'] },
  siege: { name: () => 'Siege Breaker', text: () => '+20% damage to towers, gates and the Crystal.', stat: { siegePct: 0.2 }, tags: ['split'] },
  sight: { name: () => 'Keen Eyes', text: () => '+20% vision range and +3% move speed.', stat: { sight: 0.2, msPct: 0.03 }, tags: ['team'] },
  thorns: { name: () => 'Spiked Hide', text: () => 'Reflect 12% of basic-attack damage taken. +6 armor.', stat: { thorns: 0.12, armor: 6 }, tags: ['safe'] },
  power: { name: () => 'Raw Power', text: () => '+12 attack or ability power.', stat: { power: 12 }, tags: [] },
  execute: { name: () => 'Executioner', text: () => '+10% damage to targets below 35% HP.', stat: { execute: 0.1 }, tags: ['snowball'] },
  laststand: { name: () => 'Last Stand', text: () => 'Below 50% HP: +16% damage, +20% tenacity and +8% omnivamp.', cond: { when: 'lowHp', stat: { dmgPct: 0.16, tenacity: 0.2, omnivamp: 0.08 } }, tags: ['safe'] },
  pack: { name: () => 'Pack Tactics', text: () => 'With an ally within 500: +5% damage.', cond: { when: 'ally', stat: { dmgPct: 0.05 } }, tags: ['team'] },
  lone: { name: () => 'Lone Wolf', text: () => 'No ally within 800: +18 armor and magic resist.', stat: { lone: 18 }, tags: ['split', 'safe'] },
  bully: { name: () => 'Bully', text: () => '+10% damage to stunned, rooted, feared or slowed heroes.', vs: { when: 'cc', pct: 0.1 }, tags: [] },
  ambush: { name: () => 'Opening Strike', text: () => 'The first hit on a hero after 5s out of combat deals +20%.', vs: { when: 'first', pct: 0.2 }, tags: ['snowball'] },
  rampage: { name: () => 'Rampage', text: () => 'Takedowns heal 5% max HP and give +20% move speed for 3s.', kill: { heal: 0.05, ms: 0.2, dur: 3 }, tags: ['snowball'] },
  reset: { name: () => 'Momentum', text: () => 'Takedowns cut your basic ability cooldowns by 3s.', kill: { cdr: 3 }, tags: ['snowball'] },
  // ── ultimate specials (tier 3) ──
  overdrive: { name: () => 'Overdrive', text: () => 'Your ultimate empowers after a 2-kill streak (not 3), and empowered ults hit 3% harder.', ult: { streak: 2, extra: 0.03 }, tags: ['snowball'] },
  aftershock: { name: () => 'Aftershock', text: () => 'Casting your ultimate grants a shield of 10% max HP for 3s.', ult: { shield: 0.1 }, tags: ['safe', 'vsBurst'] },
};

// Per-hero tiers. Ability names fill in the template text (q/w/r = the hero's 1st, 2nd and ultimate ability).
export const HERO_TALENTS = {
  // top
  bastion: [['q.hold', 'w.buff'], ['armor', 'guard'], ['r.area', 'aftershock']],
  kenshi: [['q.cd', 'w.mend'], ['rampage', 'pierce'], ['r.dmg', 'overdrive']],
  varro: [['q.mend', 'w.hold'], ['laststand', 'vamp'], ['r.buff', 'r.cd']],
  brawlo: [['q.cd', 'w.buff'], ['fury', 'rampage'], ['r.dmg', 'r.cd']],
  grok: [['q.reach', 'w.area'], ['armor', 'vital'], ['r.area', 'aftershock']],
  yuki: [['q.hold', 'w.buff'], ['crit', 'lone'], ['r.hold', 'r.cd']],
  akaro: [['q.cd', 'w.dmg'], ['vamp', 'laststand'], ['r.buff', 'r.mend']],
  monolith: [['q.area', 'w.buff'], ['thorns', 'vital'], ['r.hold', 'r.area']],
  gorath: [['q.dmg', 'w.hold'], ['bully', 'armor'], ['r.cd', 'aftershock']],
  valka: [['q.hold', 'w.mend'], ['guard', 'tenacity'], ['r.area', 'r.hold']],
  sora: [['q.cd', 'w.dmg'], ['crit', 'ambush'], ['r.dmg', 'r.cd']],
  tetsu: [['q.dmg', 'w.buff'], ['siege', 'armor'], ['r.area', 'r.hold']],
  // jungle
  kaze: [['q.dmg', 'w.cd'], ['ambush', 'rampage'], ['r.dmg', 'overdrive']],
  leonin: [['q.reach', 'w.mend'], ['vamp', 'fury'], ['r.buff', 'r.cd']],
  karasu: [['q.dmg', 'w.area'], ['swift', 'pack'], ['r.area', 'r.cd']],
  umbra: [['q.dmg', 'w.cd'], ['execute', 'ambush'], ['r.dmg', 'r.cd']],
  gama: [['q.reach', 'w.wound'], ['vital', 'thorns'], ['r.hold', 'r.cd']],
  ponta: [['q.reach', 'w.dmg'], ['swift', 'rampage'], ['r.hold', 'r.dmg']],
  fang: [['q.shred', 'w.buff'], ['vamp', 'execute'], ['r.dmg', 'r.cd']],
  kumo: [['q.hold', 'w.area'], ['bully', 'power'], ['r.hold', 'r.cd']],
  kaen: [['q.burn', 'w.cd'], ['rampage', 'execute'], ['r.dmg', 'overdrive']],
  saru: [['q.reach', 'w.buff'], ['fury', 'swift'], ['r.area', 'r.dmg']],
  gaki: [['q.mend', 'w.area'], ['vamp', 'laststand'], ['r.hold', 'r.mend']],
  shiro: [['q.hold', 'w.cd'], ['lone', 'ambush'], ['r.dmg', 'r.hold']],
  // mid
  ember: [['q.dmg', 'w.hold'], ['focus', 'power'], ['r.area', 'r.cd']],
  raiden: [['q.cd', 'w.area'], ['pierce', 'focus'], ['r.hold', 'r.dmg']],
  totem: [['q.dmg', 'w.hold'], ['focus', 'pack'], ['r.area', 'r.dmg']],
  sanguis: [['q.mend', 'w.cd'], ['vamp', 'vital'], ['r.dmg', 'r.area']],
  hex: [['q.dmg', 'w.cd'], ['execute', 'pierce'], ['r.dmg', 'overdrive']],
  kurai: [['q.area', 'w.wound'], ['focus', 'bully'], ['r.hold', 'r.area']],
  nami: [['q.hold', 'w.mend'], ['swift', 'power'], ['r.area', 'r.cd']],
  kitsu: [['q.dmg', 'w.buff'], ['power', 'focus'], ['r.dmg', 'r.cd']],
  azim: [['q.reach', 'w.mend'], ['power', 'vital'], ['r.area', 'r.hold']],
  mori: [['q.mark', 'w.area'], ['focus', 'bully'], ['r.hold', 'r.area']],
  fujin: [['q.dmg', 'w.mend'], ['healer', 'focus'], ['r.area', 'r.dmg']],
  sumi: [['q.reach', 'w.hold'], ['power', 'pierce'], ['r.dmg', 'r.cd']],
  // bot
  fletch: [['q.cd', 'w.buff'], ['crit', 'fury'], ['r.area', 'r.dmg']],
  marlowe: [['q.dmg', 'w.cd'], ['crit', 'pierce'], ['r.dmg', 'overdrive']],
  shuri: [['q.dmg', 'w.buff'], ['fury', 'swift'], ['r.area', 'r.dmg']],
  bolt: [['q.area', 'w.cd'], ['siege', 'crit'], ['r.dmg', 'r.cd']],
  sling: [['q.dmg', 'w.hold'], ['fury', 'execute'], ['r.dmg', 'r.area']],
  wren: [['q.wound', 'w.area'], ['crit', 'bully'], ['r.hold', 'r.area']],
  bakuha: [['q.dmg', 'w.cd'], ['siege', 'power'], ['r.area', 'r.dmg']],
  tomoe: [['q.dmg', 'w.buff'], ['crit', 'vamp'], ['r.buff', 'r.cd']],
  voss: [['q.dmg', 'w.cd'], ['crit', 'lone'], ['r.dmg', 'r.buff']],
  morel: [['q.dmg', 'w.area'], ['fury', 'vital'], ['r.area', 'r.cd']],
  hachi: [['q.cd', 'w.buff'], ['fury', 'vamp'], ['r.buff', 'r.cd']],
  rekka: [['q.dmg', 'w.hold'], ['crit', 'siege'], ['r.dmg', 'r.cd']],
  // support
  oak: [['q.mend', 'w.area'], ['healer', 'guard'], ['r.mend', 'r.cd']],
  wu: [['q.hold', 'w.mend'], ['healer', 'tenacity'], ['r.mend', 'r.cd']],
  aurelia: [['q.hold', 'w.mend'], ['healer', 'guard'], ['r.buff', 'r.cd']],
  bonehook: [['q.reach', 'w.area'], ['armor', 'bully'], ['r.hold', 'r.area']],
  frost: [['q.hold', 'w.cd'], ['armor', 'guard'], ['r.area', 'r.hold']],
  gizmo: [['q.mend', 'w.hold'], ['healer', 'guard'], ['r.buff', 'r.mend']],
  ruga: [['q.buff', 'w.mend'], ['healer', 'pack'], ['r.buff', 'r.cd']],
  hotaru: [['q.hold', 'w.mend'], ['healer', 'focus'], ['r.area', 'r.dmg']],
  hoshi: [['q.mend', 'w.area'], ['healer', 'focus'], ['r.mend', 'r.cd']],
  daikoku: [['q.area', 'w.mend'], ['armor', 'guard'], ['r.hold', 'r.cd']],
  kinta: [['q.reach', 'w.area'], ['sight', 'swift'], ['r.buff', 'r.cd']],
  zahra: [['q.buff', 'w.area'], ['healer', 'swift'], ['r.mend', 'r.cd']],
  // v24
  daichi: [['q.hold', 'w.mend'], ['armor', 'guard'], ['r.area', 'aftershock']],
  tobi: [['q.dmg', 'w.hold'], ['pierce', 'siege'], ['r.dmg', 'r.cd']],
  kuma: [['q.cd', 'w.hold'], ['vamp', 'laststand'], ['r.area', 'aftershock']],
  mogura: [['q.cd', 'w.buff'], ['siege', 'lone'], ['r.hold', 'r.area']],
  kenta: [['q.cd', 'w.dmg'], ['rampage', 'ambush'], ['r.dmg', 'overdrive']],
  isamu: [['q.hold', 'w.reach'], ['bully', 'sight'], ['r.buff', 'r.cd']],
  hebi: [['q.dmg', 'w.cd'], ['execute', 'ambush'], ['r.dmg', 'r.hold']],
  upa: [['q.hold', 'w.mend'], ['vamp', 'armor'], ['r.area', 'r.cd']],
  taro: [['q.dmg', 'w.area'], ['power', 'focus'], ['r.area', 'r.dmg']],
  mame: [['q.cd', 'w.hold'], ['focus', 'bully'], ['r.hold', 'r.area']],
  fukuro: [['q.dmg', 'w.cd'], ['execute', 'power'], ['r.hold', 'overdrive']],
  hitotsume: [['q.reach', 'w.area'], ['power', 'pierce'], ['r.dmg', 'r.hold']],
  suzu: [['q.dmg', 'w.buff'], ['crit', 'siege'], ['r.dmg', 'r.cd']],
  momo: [['q.hold', 'w.cd'], ['swift', 'fury'], ['r.area', 'r.dmg']],
  komori: [['q.hold', 'w.buff'], ['crit', 'vamp'], ['r.area', 'r.dmg']],
  tako: [['q.dmg', 'w.cd'], ['fury', 'bully'], ['r.hold', 'r.area']],
  ume: [['q.mend', 'w.hold'], ['healer', 'tenacity'], ['r.mend', 'r.cd']],
  aki: [['q.mend', 'w.area'], ['healer', 'guard'], ['r.buff', 'r.mend']],
  bao: [['q.hold', 'w.mend'], ['armor', 'guard'], ['r.area', 'r.hold']],
  kinoko: [['q.mend', 'w.hold'], ['healer', 'focus'], ['r.mend', 'r.cd']],
};

const SLOT = { q: 0, w: 1, r: 2 };
// Parse 'q.dmg' / 'vamp' → { key, tpl, slot (or -1) }.
export function parseTalent(key) {
  const i = key.indexOf('.');
  const slot = i < 0 ? -1 : SLOT[key.slice(0, i)], tpl = TEMPLATES[i < 0 ? key : key.slice(i + 1)];
  return tpl ? { key, tpl, slot } : null;
}
// Display info for one talent of a hero: { key, name, text, icon, tags, slot }.
function talentInfo(heroId, key) {
  const def = HERO_BY_ID[heroId], t = parseTalent(key); if (!def || !t) return null;
  const ab = t.slot >= 0 ? def.abilities[t.slot] : null, an = ab ? ab.name : '', ult = !!(ab && ab.ult);
  return { key, slot: t.slot, name: t.tpl.name(an), text: t.tpl.text(an, ult), icon: ab ? ab.icon : TALENT_ICON[key] || 'LuckUpgrade', tags: t.tpl.tags };
}
const TALENT_ICON = { armor: 'DefenseUpgrade', vital: 'Heal', vamp: 'Heal', swift: 'BookWind', fury: 'AttackUpgrade', focus: 'BookThunder', crit: 'Cut', pierce: 'Downgrade',
  tenacity: 'Counter', healer: 'Heal', guard: 'DefenseUpgrade', siege: 'Explosion', sight: 'OrbLight', thorns: 'Counter', power: 'Upgrade', execute: 'Death', laststand: 'Counter',
  pack: 'Upgrade', lone: 'DefenseUpgrade', bully: 'Downgrade', ambush: 'Camouflage', rampage: 'BookWind', reset: 'BookThunder', overdrive: 'Death', aftershock: 'DefenseUpgrade' };
// All three tiers of a hero as display info: [[a, b], [a, b], [a, b]].
export function heroTalents(heroId) { return (HERO_TALENTS[heroId] || []).map((tier) => tier.map((k) => talentInfo(heroId, k))); }
// A clean preference list: three entries of 0, 1 or -1 (-1 = the hero decides).
export function cleanPrefs(p) { return [0, 1, 2].map((i) => (Array.isArray(p) && (p[i] === 0 || p[i] === 1) ? p[i] : -1)); }

// Load-time check: every hero has 3 tiers of 2 valid talents (a typo fails loudly in the tools).
for (const h of HEROES) {
  const tiers = HERO_TALENTS[h.id];
  if (!tiers || tiers.length !== 3 || tiers.some((t) => t.length !== 2 || t.some((k) => !parseTalent(k)))) throw new Error('talents: bad tiers for ' + h.id);
}
