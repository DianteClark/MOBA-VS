// Hero roster. Everything about a hero is data; the sim + AI interpret it.
//
// Ability fields
//   kind:  shot | line | target | circle | nova | dash | self | ally | allynova | hook | zone
//   range, cd, radius, width, speed, delay, pierce, dur (zones)
//   dmg:   { b: base, l: per level, ad, ap: ratios, hp: % of caster max HP, miss: % of target missing HP }
//   type:  phys | magic | true   (defaults to hero dmgType)
//   cc:    { stun, root, knock, slow: [pct, dur] }
//   burn:  { b, l, dur }          damage over time (magic) — reduced healing included via items
//   heal / shield: { b, l, ap, ad, hp, dur }
//   buff:  { dur, stats: {...} }  self (or ally for ally/allynova)
//   use:   AI hints — poke, engage, clear, escape, peel, sustain, teamfight, execute, defend
//   fx / proj: sprite names (render only)

const CLASS = {
  tank:     { hp: 690, hpL: 98, ad: 60, adL: 3.4, armor: 38, armorL: 4.4, mr: 32, mrL: 2.0, as: 0.64, asL: 0.02, range: 55, ms: 100, regen: 2.2 },
  bruiser:  { hp: 650, hpL: 100, ad: 66, adL: 4.0, armor: 34, armorL: 4.2, mr: 32, mrL: 2.0, as: 0.68, asL: 0.025, range: 55, ms: 102, regen: 2.0 },
  assassin: { hp: 590, hpL: 92, ad: 68, adL: 4.2, armor: 30, armorL: 4.0, mr: 30, mrL: 1.6, as: 0.70, asL: 0.03, range: 55, ms: 104, regen: 1.6 },
  mage:     { hp: 560, hpL: 88, ad: 52, adL: 3.0, armor: 22, armorL: 4.0, mr: 30, mrL: 1.4, as: 0.64, asL: 0.02, range: 150, ms: 98, regen: 1.4, ap: 20 },
  marksman: { hp: 570, hpL: 92, ad: 62, adL: 3.6, armor: 26, armorL: 4.0, mr: 30, mrL: 1.3, as: 0.68, asL: 0.035, range: 180, ms: 98, regen: 1.4 },
  support:  { hp: 580, hpL: 90, ad: 52, adL: 3.0, armor: 30, armorL: 4.2, mr: 30, mrL: 1.4, as: 0.62, asL: 0.02, range: 150, ms: 99, regen: 1.6, ap: 10 },
};

export const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'];
export const ROLE_LABEL = { top: 'Top', jungle: 'Jungle', mid: 'Mid', bot: 'Bot', support: 'Support' };

export const HEROES = [
  // ───────────── TOP ─────────────
  { id: 'bastion', clan: 'iron', pers: 'loyal', name: 'Bastion', title: 'The Iron Wall', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'phys', curve: 'mid',
    lore: 'A fortress gate that learned to walk. The Iron clan builds its line around him.',
    tags: ['tank', 'cc', 'engage'], builds: ['tank', 'warden', 'haste'],
    passive: { kind: 'shieldOnHit', name: 'Bulwark', pct: 0.08, cd: 10, desc: 'Taking hero damage grants a shield (8% max HP). 10s cooldown.' },
    abilities: [
      { name: 'Shield Bash', icon: 'DefenseUpgrade', kind: 'dash', range: 220, cd: 11, dmg: { b: 60, l: 15, ad: 0.6, hp: 0.04 }, cc: { stun: 1.0 }, use: ['engage', 'peel'], fx: 'impact' },
      { name: 'Rally', icon: 'Upgrade', kind: 'nova', radius: 140, cd: 9, dmg: { b: 40, l: 10, hp: 0.03 }, cc: { slow: [0.3, 1.5] }, buff: { dur: 4, stats: { armor: 30, mr: 20 } }, use: ['clear', 'engage', 'defend'], fx: 'circle' },
      { name: 'Unbreakable Charge', icon: 'Counter', kind: 'dash', range: 380, radius: 160, cd: 70, dmg: { b: 150, l: 40, hp: 0.06 }, cc: { knock: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'kenshi', clan: 'iron', pers: 'calm', name: 'Kenshi', title: 'Wandering Blade', role: 'top', flex: ['mid'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'A masterless blade who wanders from duel to duel, looking for the one he cannot win.',
    tags: ['dive', 'split', 'burst'], builds: ['spellblade', 'burst', 'sustain'],
    passive: { kind: 'every3', name: 'Way of the Sword', dmg: { b: 20, l: 6, ad: 0.4 }, desc: 'Every third attack deals bonus physical damage.' },
    abilities: [
      { name: 'Iaido', icon: 'Cut', kind: 'line', range: 260, width: 50, cd: 6, dmg: { b: 70, l: 20, ad: 1.0 }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Riposte', icon: 'Counter', kind: 'self', cd: 12, shield: { b: 80, l: 25, ad: 0.5, dur: 2 }, use: ['defend'], fx: 'shield' },
      { name: 'Thousand Cuts', icon: 'Death', kind: 'dash', range: 300, cd: 60, dmg: { b: 200, l: 60, ad: 1.2, miss: 0.2 }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'varro', clan: 'iron', pers: 'hothead', name: 'Varro', title: 'Arena Champion', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'Forty arena seasons, forty crowns. He fights best with his back to the wall.',
    tags: ['tank', 'split', 'sustain'], builds: ['sustain', 'siege', 'tank'],
    passive: { kind: 'lowhpRegen', name: 'Second Wind', pct: 0.026, desc: 'Below 35% HP, regenerates 2.6% max HP per second.' },
    abilities: [
      { name: 'Cleave', icon: 'Cut', kind: 'nova', radius: 160, cd: 6, dmg: { b: 75, l: 22, ad: 1.0 }, heal: { b: 40, l: 10, ad: 0.2 }, use: ['clear', 'engage'], fx: 'circular' },
      { name: 'Crippling Strike', icon: 'Downgrade', kind: 'target', range: 70, cd: 8, dmg: { b: 40, l: 10, ad: 0.5 }, cc: { slow: [0.4, 2] }, use: ['engage', 'poke'], fx: 'cut' },
      { name: 'Champion of the Arena', icon: 'AttackUpgrade', kind: 'self', cd: 80, heal: { hp: 0.15 }, buff: { dur: 6, stats: { power: 40, armor: 30, mr: 30 } }, use: ['teamfight', 'defend'], fx: 'boost', ult: true },
    ] },
  { id: 'brawlo', clan: 'beast', pers: 'reckless', name: 'Brawlo', title: 'Ringside Menace', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: 'A ringside menace who never learned when the bell means stop.',
    tags: ['dive', 'burst', 'early'], builds: ['burst', 'spellblade', 'crit', 'sustain'],
    passive: { kind: 'every3', name: 'Combo', dmg: { b: 30, l: 9, ad: 0.6 }, desc: 'Every third punch lands a heavy hit.' },
    abilities: [
      { name: 'Jab Rush', icon: 'BookWind', kind: 'dash', range: 260, cd: 7, dmg: { b: 60, l: 18, ad: 0.8 }, cc: { mark: [0.25, 3] }, use: ['engage', 'escape'], fx: 'impact' },
      { name: 'Guard Up', icon: 'AttackUpgrade', kind: 'self', cd: 11, buff: { dur: 3, stats: { asPct: 0.4, tenacity: 0.5 } }, shield: { b: 60, l: 20, ad: 0.4, dur: 3 }, use: ['engage', 'defend'], fx: 'aura' },
      { name: 'Knockout', icon: 'Explosion', kind: 'target', range: 70, cd: 55, dmg: { b: 180, l: 50, ad: 1.5 }, cc: { knock: 1.0 }, use: ['execute', 'engage'], fx: 'explosion', ult: true },
    ] },
  { id: 'grok', clan: 'beast', pers: 'cautious', name: 'Grok', title: 'Stoneback', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'phys', curve: 'late',
    lore: 'A caveman with a rock for a head and a bigger rock for everything else.',
    tags: ['tank', 'cc', 'peel'], builds: ['tank', 'warden', 'haste'],
    passive: { kind: 'dr', name: 'Thick Skull', pct: 0.06, desc: 'Takes 6% less damage from all sources.' },
    abilities: [
      { name: 'Boulder Toss', icon: 'BookRock', kind: 'shot', range: 330, speed: 600, width: 34, cd: 8, dmg: { b: 70, l: 20, ad: 0.5, hp: 0.03 }, cc: { slow: [0.3, 1.5] }, use: ['poke', 'engage', 'clear'], proj: 'p_cannon', fx: 'rock' },
      { name: 'Ground Pound', icon: 'RockSpike', kind: 'nova', radius: 170, cd: 12, dmg: { b: 50, l: 12, hp: 0.04 }, cc: { root: 1.0 }, use: ['engage', 'peel'], fx: 'rockspike' },
      { name: 'Stampede', icon: 'Counter', kind: 'dash', range: 420, radius: 180, cd: 85, dmg: { b: 120, l: 35, hp: 0.06 }, cc: { knock: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'yuki', clan: 'shinobi', pers: 'calm', name: 'Yuki', title: 'Snowblade Duelist', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'A northern duelist whose blade leaves frost on everything it touches.',
    tags: ['split', 'cc', 'dps'], builds: ['crit', 'siege', 'spellblade'],
    passive: { kind: 'every3', name: 'Frostbite', dmg: { b: 18, l: 6, ad: 0.35 }, desc: 'Every third strike bites with extra cold damage.' },
    abilities: [
      { name: 'Frost Lunge', icon: 'BookIce', kind: 'dash', range: 260, cd: 7, dmg: { b: 60, l: 18, ad: 0.8 }, cc: { slow: [0.35, 1.5] }, use: ['engage', 'escape'], fx: 'ice' },
      { name: 'Rime Edge', icon: 'MagicWeapon', kind: 'self', cd: 12, buff: { dur: 4, stats: { asPct: 0.45, slowOnHit: 0.25 } }, use: ['engage'], fx: 'ice' },
      { name: 'Glacial Prison', icon: 'BookIce', kind: 'target', range: 200, cd: 65, dmg: { b: 180, l: 55, ad: 1.1, miss: 0.15 }, cc: { stun: 1.25 }, use: ['engage', 'peel'], fx: 'ice', ult: true },
    ] },
  { id: 'akaro', clan: 'beast', pers: 'hothead', name: 'Akaro', title: 'The Red Horn', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: 'A red-horned demon who grows stronger with every drop of blood spilled.',
    tags: ['dive', 'sustain', 'dps'], builds: ['sustain', 'pierce', 'tank'],
    passive: { kind: 'spellVamp', name: 'Bloodlust', pct: 0.10, desc: '10% omnivamp.' },
    abilities: [
      { name: 'Horn Charge', icon: 'Counter', kind: 'dash', range: 280, cd: 9, dmg: { b: 65, l: 18, ad: 0.7 }, cc: { knock: 0.5 }, use: ['engage'], fx: 'impact' },
      { name: 'Ravage', icon: 'Cut', kind: 'nova', radius: 150, cd: 6, dmg: { b: 75, l: 22, ad: 0.9 }, use: ['clear', 'engage'], fx: 'claw' },
      { name: 'Red Fury', icon: 'AttackUpgrade', kind: 'self', cd: 75, heal: { hp: 0.1 }, buff: { dur: 6, stats: { power: 25, asPct: 0.5, omnivamp: 0.15, msPct: 0.15 } }, use: ['teamfight', 'engage'], fx: 'boost', ult: true },
    ] },
  { id: 'monolith', clan: 'iron', pers: 'cautious', name: 'Monolith', title: 'Living Stone', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'magic', curve: 'late',
    lore: 'An ancient statue that wakes when the valley is threatened, and the valley is always threatened.',
    tags: ['tank', 'cc', 'teamfight'], builds: ['tank', 'warden', 'burn'],
    passive: { kind: 'lowhpRegen', name: 'Mending Stone', pct: 0.02, desc: 'Below 35% HP, regenerates 2% max HP per second.' },
    abilities: [
      { name: 'Tremor', icon: 'RockSpike', kind: 'zone', range: 300, radius: 130, dur: 3, cd: 11, dmg: { b: 20, l: 6, hp: 0.01 }, cc: { slow: [0.3, 0.5] }, use: ['clear', 'engage', 'poke'], fx: 'rock' },
      { name: 'Stone Skin', icon: 'DefenseUpgrade', kind: 'self', cd: 14, buff: { dur: 4, stats: { armor: 35, mr: 25, thorns: 0.2 } }, use: ['defend', 'engage'], fx: 'shield' },
      { name: 'Meteor Fall', icon: 'Explosion', kind: 'circle', range: 450, radius: 190, delay: 0.8, cd: 80, dmg: { b: 140, l: 40, hp: 0.05 }, cc: { stun: 1.5 }, use: ['teamfight', 'engage'], fx: 'rock', ult: true },
    ] },

  { id: 'gorath', clan: 'beast', pers: 'hothead', name: 'Gorath', title: 'Tusk Warlord', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: 'A boar chieftain who has never met a wall, or a shield, he could not gore through.',
    tags: ['dive', 'teamfight', 'antitank'], builds: ['pierce', 'sustain', 'tank'],
    passive: { kind: 'shredHits', name: 'Gore', pct: 0.05, cap: 0.2, dur: 4, desc: 'Basic attacks on heroes shred 5% armor and magic resist, stacking to 20% for 4s.' },
    abilities: [
      { name: 'Tusk Toss', icon: 'Cut', kind: 'line', range: 260, width: 60, cd: 7, dmg: { b: 65, l: 20, ad: 0.9 }, cc: { shred: [0.15, 4] }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Bellow', icon: 'Mist', kind: 'nova', radius: 150, cd: 13, dmg: { b: 40, l: 12, ad: 0.4 }, cc: { fear: 0.9 }, use: ['engage', 'peel'], fx: 'circle' },
      { name: 'Warpath', icon: 'Counter', kind: 'dash', range: 400, radius: 150, cd: 70, dmg: { b: 150, l: 45, ad: 1.0 }, cc: { knock: 0.75, shred: [0.25, 5] }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'valka', clan: 'iron', pers: 'loyal', name: 'Valka', title: 'Shieldmaiden', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'phys', curve: 'mid',
    lore: 'She swore to stand in front of whoever stands behind her. She has never broken an oath.',
    tags: ['tank', 'peel', 'shield', 'engage'], builds: ['warden', 'tank', 'haste'],
    passive: { kind: 'aura', name: 'Shieldwall', r: 260, stats: { drPct: 0.08 }, desc: 'Allies within 260 (and Valka) take 8% less damage.' },
    abilities: [
      { name: 'Shield Throw', icon: 'DefenseUpgrade', kind: 'shot', range: 380, speed: 850, width: 34, cd: 9, dmg: { b: 60, l: 18, ad: 0.5, hp: 0.02 }, cc: { silence: 1.25 }, use: ['engage', 'peel', 'poke'], proj: 'p_shuriken', fx: 'impact' },
      { name: 'Intercept', icon: 'Counter', kind: 'ally', allyDash: true, range: 350, cd: 12, shield: { b: 70, l: 25, hp: 0.06, dur: 3 }, use: ['sustain', 'peel'], fx: 'shield' },
      { name: 'Phalanx', icon: 'Upgrade', kind: 'nova', radius: 220, cd: 75, dmg: { b: 120, l: 35, hp: 0.05 }, cc: { silence: 1.5, slow: [0.4, 2] }, allyShield: { b: 80, l: 25, hp: 0.04, dur: 3 }, use: ['teamfight', 'engage'], fx: 'shield_yellow', ult: true },
    ] },
  { id: 'sora', clan: 'shinobi', pers: 'calm', name: 'Sora', title: 'Straw Hat Ronin', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'Kenshi\'s runaway student. Waits, reads, then ends the duel in one draw.',
    tags: ['split', 'pick', 'dive'], builds: ['spellblade', 'crit', 'siege'],
    passive: { kind: 'firstStrike', name: 'Iai Draw', pct: 0.3, cd: 6, desc: 'The first hit on an enemy hero after 6s without hitting heroes deals 30% more damage.' },
    abilities: [
      { name: 'Parry', icon: 'Counter', kind: 'self', cd: 12, parry: { dur: 1.5, stun: 1.0 }, use: ['engage', 'defend'], fx: 'shield' },
      { name: 'Crescent Cut', icon: 'Cut', kind: 'line', range: 280, width: 60, cd: 7, dmg: { b: 70, l: 22, ad: 0.95 }, cc: { mark: [0.15, 3] }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Final Draw', icon: 'Death', kind: 'dash', range: 400, cd: 60, dmg: { b: 180, l: 55, ad: 1.2, miss: 0.15 }, resetOnKill: true, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'tetsu', clan: 'iron', pers: 'cautious', name: 'Tetsu', title: 'Siege Golem', role: 'top', flex: ['jungle'], cls: 'tank', dmgType: 'phys', curve: 'late',
    lore: 'Built to knock down castle gates. Nobody remembered to tell it the war ended.',
    tags: ['siege', 'split', 'tank'], builds: ['siege', 'tank', 'warden'],
    passive: { kind: 'siege', name: 'Demolisher', pct: 0.35, desc: 'Deals 35% bonus damage to structures.' },
    abilities: [
      { name: 'Drill Fist', icon: 'RockSpike', kind: 'target', range: 120, cd: 6, dmg: { b: 70, l: 22, ad: 0.7, hp: 0.04 }, cc: { shred: [0.2, 3], slow: [0.3, 1] }, use: ['engage', 'clear', 'poke'], fx: 'impact' },
      { name: 'Fortress Mode', icon: 'DefenseUpgrade', kind: 'self', cd: 16, selfRoot: 3, buff: { dur: 3, stats: { armor: 40, mr: 30, range: 100, siegePct: 0.5, asPct: 0.3 } }, use: ['siege'], fx: 'shield' },
      { name: 'Seismic Slam', icon: 'Explosion', kind: 'circle', range: 400, radius: 200, delay: 0.8, cd: 75, dmg: { b: 130, l: 40, hp: 0.05 }, cc: { stun: 1.0 }, use: ['teamfight', 'engage'], fx: 'rock', ult: true },
    ] },

  // ───────────── JUNGLE ─────────────
  { id: 'kaze', clan: 'shinobi', pers: 'reckless', name: 'Kaze', title: 'Leaf on the Wind', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'mid',
    lore: 'Loud, fast and gone before you turn around. Leaves a shuriken as a calling card.',
    tags: ['burst', 'dive', 'pick'], builds: ['burst', 'crit', 'spellblade'],
    passive: { kind: 'executer', name: 'Opportunist', pct: 0.12, desc: 'Deals 12% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Shuriken', icon: 'MagicWeapon', kind: 'shot', range: 350, speed: 900, width: 28, cd: 5, dmg: { b: 60, l: 20, ad: 0.8 }, use: ['poke', 'clear'], proj: 'p_shuriken', fx: 'cut' },
      { name: 'Shadow Step', icon: 'Camouflage', kind: 'dash', range: 300, cd: 10, dmg: { b: 40, l: 12, ad: 0.5 }, use: ['engage', 'escape'], fx: 'smoke' },
      { name: 'Death Mark', icon: 'Death', kind: 'target', range: 300, cd: 50, dmg: { b: 220, l: 70, ad: 1.6, miss: 0.25 }, use: ['execute'], fx: 'cutx', ult: true },
    ] },
  { id: 'leonin', clan: 'beast', pers: 'hothead', name: 'Leonin', title: 'Pride Hunter', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: "The pride's hunter. He eats first and he eats well.",
    tags: ['dive', 'sustain', 'early'], builds: ['sustain', 'pierce', 'tank'],
    passive: { kind: 'spellVamp', name: 'Feast', pct: 0.12, desc: '12% omnivamp.' },
    abilities: [
      { name: 'Pounce', icon: 'BookWind', kind: 'dash', range: 300, cd: 8, dmg: { b: 60, l: 18, ad: 0.8 }, cc: { slow: [0.3, 1] }, use: ['engage'], fx: 'claw' },
      { name: 'Roar', icon: 'Mist', kind: 'nova', radius: 180, cd: 12, dmg: { b: 40, l: 12, ad: 0.5 }, cc: { slow: [0.4, 1.5] }, heal: { b: 40, l: 10 }, use: ['clear', 'peel', 'engage'], fx: 'circle' },
      { name: 'King of Beasts', icon: 'AttackUpgrade', kind: 'self', cd: 70, buff: { dur: 6, stats: { power: 40, asPct: 0.4, msPct: 0.2 } }, use: ['teamfight', 'engage'], fx: 'boost', ult: true },
    ] },
  { id: 'karasu', clan: 'spirit', pers: 'loyal', name: 'Karasu', title: 'Crow of the Peaks', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'A crow tengu who rules the mountain winds and swoops on anyone below.',
    tags: ['dive', 'cc', 'engage'], builds: ['burst', 'tank', 'spellblade'],
    passive: { kind: 'shieldOnHit', name: 'Feathered Mantle', pct: 0.07, cd: 12, desc: 'Taking hero damage grants a shield (7% max HP). 12s cooldown.' },
    abilities: [
      { name: 'Wing Slash', icon: 'Cut', kind: 'line', range: 250, width: 70, cd: 6, dmg: { b: 70, l: 20, ad: 0.9 }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Gale', icon: 'BookWind', kind: 'nova', radius: 150, cd: 13, dmg: { b: 45, l: 10, ad: 0.5 }, cc: { knock: 0.5 }, use: ['engage', 'peel'], fx: 'circle' },
      { name: 'Divine Wind', icon: 'OrbLight', kind: 'dash', range: 450, radius: 180, cd: 80, dmg: { b: 150, l: 40, ad: 0.8 }, cc: { knock: 0.8 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'umbra', clan: 'shinobi', pers: 'greedy', name: 'Umbra', title: 'The Unseen', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'late',
    lore: "Nobody has seen Umbra's face. Nobody who saw it is still talking.",
    tags: ['burst', 'dive', 'scaling'], builds: ['burst', 'crit', 'pierce'],
    passive: { kind: 'msOutOfCombat', name: 'Shadowwalk', pct: 0.15, desc: '+15% move speed when out of combat.' },
    abilities: [
      { name: 'Kunai Fan', icon: 'MagicWeapon', kind: 'shot', range: 320, speed: 950, width: 60, pierce: true, cd: 5, dmg: { b: 70, l: 22, ad: 0.8 }, use: ['poke', 'clear'], proj: 'p_kunai', fx: 'cut' },
      { name: 'Smoke Veil', icon: 'Mist', kind: 'self', cd: 14, buff: { dur: 2, stats: { msPct: 0.4 } }, shield: { b: 60, l: 20, dur: 2 }, use: ['escape', 'defend'], fx: 'smoke' },
      { name: 'Assassinate', icon: 'Death', kind: 'dash', range: 450, cd: 55, dmg: { b: 230, l: 80, ad: 1.5, miss: 0.2 }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'gama', clan: 'beast', pers: 'cautious', name: 'Gama', title: 'Swamp King', role: 'jungle', flex: ['support'], cls: 'tank', dmgType: 'magic', curve: 'mid',
    lore: 'The swamp king. His tongue is longer than your escape route.',
    tags: ['tank', 'cc', 'engage'], builds: ['tank', 'warden', 'burn'],
    passive: { kind: 'lowhpRegen', name: 'Amphibious', pct: 0.018, desc: 'Below 35% HP, regenerates 1.8% max HP per second.' },
    abilities: [
      { name: 'Tongue Lash', icon: 'BookPlant', kind: 'hook', range: 330, speed: 900, width: 36, cd: 12, dmg: { b: 60, l: 15, ap: 0.5 }, cc: { stun: 0.5 }, use: ['engage', 'peel'], proj: 'p_plant', fx: 'plant' },
      { name: 'Toxic Belly', icon: 'Alchemy', kind: 'nova', radius: 160, cd: 10, dmg: { b: 30, l: 8, hp: 0.01 }, burn: { b: 25, l: 7, dur: 3 }, cc: { slow: [0.2, 1.5] }, use: ['clear', 'engage'], fx: 'plant' },
      { name: 'Swallow', icon: 'Necromancy', kind: 'target', range: 120, cd: 70, dmg: { b: 150, l: 40, hp: 0.06 }, cc: { stun: 1.5 }, use: ['engage', 'peel', 'execute'], fx: 'water', ult: true },
    ] },
  { id: 'ponta', clan: 'beast', pers: 'reckless', name: 'Ponta', title: 'Masked Trickster', role: 'jungle', flex: ['support'], cls: 'assassin', dmgType: 'phys', curve: 'early',
    lore: 'A raccoon trickster who wears a leaf as a disguise and a grin as armor.',
    tags: ['pick', 'cc', 'early'], builds: ['burst', 'haste', 'warden'],
    passive: { kind: 'msOutOfCombat', name: 'Leaf Disguise', pct: 0.15, desc: '+15% move speed when out of combat — perfect for lurking in brush.' },
    abilities: [
      { name: 'Tanuki Tug', icon: 'BookPlant', kind: 'hook', range: 380, speed: 950, width: 34, cd: 11, dmg: { b: 60, l: 18, ad: 0.6 }, cc: { stun: 0.5 }, use: ['engage'], proj: 'p_plant', fx: 'smoke' },
      { name: 'Tail Whip', icon: 'BookWind', kind: 'nova', radius: 150, cd: 7, dmg: { b: 50, l: 16, ad: 0.6 }, cc: { slow: [0.3, 1.5] }, use: ['clear', 'peel', 'engage'], fx: 'circular' },
      { name: 'Mischief Bomb', icon: 'Explosion', kind: 'target', range: 350, cd: 55, dmg: { b: 180, l: 55, ad: 1.2 }, cc: { stun: 1.0 }, use: ['execute', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'fang', clan: 'beast', pers: 'greedy', name: 'Fang', title: 'Cave Stalker', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'late',
    lore: 'A cave lion that stalks the dark, bleeding its prey slowly.',
    tags: ['dps', 'scaling', 'burn'], builds: ['crit', 'pierce', 'burn'],
    passive: { kind: 'burnHits', name: 'Rending Claws', burn: { b: 6, l: 2, dur: 2 }, desc: 'Basic attacks make enemies bleed for 2s.' },
    abilities: [
      { name: 'Rend', icon: 'Cut', kind: 'line', range: 220, width: 80, cd: 5, dmg: { b: 60, l: 18, ad: 0.8 }, use: ['clear', 'poke', 'engage'], fx: 'claw' },
      { name: 'Stalk', icon: 'Camouflage', kind: 'self', cd: 13, buff: { dur: 4, stats: { asPct: 0.4, msPct: 0.2 } }, use: ['engage'], fx: 'aura' },
      { name: 'Savage Leap', icon: 'Death', kind: 'dash', range: 420, radius: 140, cd: 65, dmg: { b: 150, l: 45, ad: 1.0, miss: 0.12 }, cc: { slow: [0.5, 2] }, use: ['teamfight', 'engage'], fx: 'claw', ult: true },
    ] },
  { id: 'kumo', clan: 'shinobi', pers: 'greedy', name: 'Kumo', title: 'Web Weaver', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'magic', curve: 'mid',
    lore: 'Weaves webs between the trees and waits. Always waits.',
    tags: ['cc', 'pick', 'poke'], builds: ['burst', 'haste', 'spellblade'],
    passive: { kind: 'executer', name: 'Venom Fang', pct: 0.12, desc: 'Deals 12% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Silk Thread', icon: 'Permutation', kind: 'shot', range: 420, speed: 850, width: 30, cd: 8, dmg: { b: 65, l: 22, ap: 0.6 }, cc: { root: 1.0 }, use: ['poke', 'engage', 'clear'], proj: 'p_energy', fx: 'spark' },
      { name: 'Spider Nest', icon: 'OrbPlant', kind: 'zone', range: 380, radius: 120, dur: 3, cd: 12, dmg: { b: 25, l: 8, ap: 0.2 }, cc: { slow: [0.4, 0.5] }, use: ['clear', 'poke', 'peel'], fx: 'plant' },
      { name: 'Cocoon', icon: 'Necromancy', kind: 'target', range: 350, cd: 60, dmg: { b: 180, l: 60, ap: 0.9 }, cc: { stun: 1.5 }, use: ['engage', 'peel'], fx: 'water', ult: true },
    ] },

  { id: 'kaen', clan: 'wild', pers: 'reckless', name: 'Kaen', title: 'Cinder Fang', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'mid',
    lore: 'Ember\'s little brother. Every takedown fans the flame, and he does not know when to stop.',
    tags: ['burst', 'dive', 'pick'], builds: ['burst', 'spellblade', 'crit'],
    passive: { kind: 'onTakedown', name: 'Blaze', ms: 0.3, dur: 3, heal: 0.1, desc: 'Takedowns grant 30% move speed for 3s and heal 10% max HP.' },
    abilities: [
      { name: 'Flare Kunai', icon: 'Fireball', kind: 'shot', range: 380, speed: 950, width: 28, cd: 6, dmg: { b: 60, l: 20, ad: 0.8 }, cc: { mark: [0.2, 3] }, burn: { b: 10, l: 3, dur: 2 }, use: ['poke', 'clear'], proj: 'p_kunai', fx: 'flame' },
      { name: 'Cinder Dash', icon: 'BookFire', kind: 'dash', range: 300, cd: 9, dmg: { b: 55, l: 15, ad: 0.6 }, use: ['engage', 'escape'], fx: 'flame' },
      { name: 'Phoenix Cut', icon: 'OrbFire', kind: 'target', range: 320, cd: 40, dmg: { b: 170, l: 55, ad: 1.3, miss: 0.15 }, resetOnKill: true, use: ['execute'], fx: 'explosion', ult: true },
    ] },
  { id: 'saru', clan: 'beast', pers: 'greedy', name: 'Saru', title: 'Monkey King', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'Stole a cloud, a staff and a crown. Still looking for something worth keeping.',
    tags: ['dive', 'pick', 'teamfight'], builds: ['crit', 'spellblade', 'tank'],
    passive: { kind: 'empowerCC', name: 'Trickster', cd: 8, cc: { knock: 0.4 }, dmg: { b: 20, l: 6, ad: 0.3 }, desc: 'After casting an ability, the next attack within 3s knocks the target up (8s cooldown).' },
    abilities: [
      { name: 'Staff Extend', icon: 'MagicWeapon', kind: 'line', range: 300, width: 40, cd: 7, dmg: { b: 65, l: 20, ad: 0.85 }, use: ['poke', 'clear', 'engage'], fx: 'impact' },
      { name: 'Cloud Vanish', icon: 'Mist', kind: 'self', cd: 15, stealth: 2, buff: { dur: 2, stats: { msPct: 0.35 } }, use: ['escape', 'engage'], fx: 'smoke' },
      { name: 'Thousand Staves', icon: 'Explosion', kind: 'nova', radius: 210, cd: 70, dmg: { b: 160, l: 45, ad: 1.0 }, cc: { knock: 0.8 }, use: ['teamfight', 'engage'], fx: 'circular', ult: true },
    ] },
  { id: 'gaki', clan: 'spirit', pers: 'hothead', name: 'Gaki', title: 'Hungry Ghost', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'magic', curve: 'mid',
    lore: 'Cursed with a hunger nothing fills. He drinks the fear of the living and calls it dinner.',
    tags: ['sustain', 'antiheal', 'dive'], builds: ['sustain', 'burn', 'tank'],
    passive: { kind: 'cruel', name: 'Prey on the Weak', pct: 0.15, desc: 'Deals 15% more damage to stunned, rooted, feared or slowed heroes.' },
    abilities: [
      { name: 'Soul Siphon', icon: 'Necromancy', kind: 'target', range: 200, cd: 7, dmg: { b: 60, l: 20, ap: 0.6 }, heal: { b: 30, l: 10, ap: 0.3 }, cc: { grievous: 3 }, use: ['poke', 'engage'], fx: 'spirit' },
      { name: 'Wail', icon: 'BookDeath', kind: 'nova', radius: 160, cd: 12, dmg: { b: 45, l: 14, ap: 0.4 }, cc: { slow: [0.4, 1.5] }, use: ['clear', 'engage', 'peel'], fx: 'spirit' },
      { name: 'Dread Feast', icon: 'BookDarkness', kind: 'nova', radius: 240, cd: 75, dmg: { b: 140, l: 40, ap: 0.7 }, cc: { fear: 1.25 }, heal: { b: 80, l: 25 }, use: ['teamfight', 'engage'], fx: 'spirit', ult: true },
    ] },
  { id: 'shiro', clan: 'shinobi', pers: 'calm', name: 'Shiro', title: 'Silent Fang', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'late',
    lore: 'Kaze\'s shadow. Where Kaze is loud, Shiro is a held breath in the dark.',
    tags: ['burst', 'pick', 'scaling'], builds: ['burst', 'pierce', 'haste'],
    passive: { kind: 'lone', name: 'Isolation', pct: 0.22, desc: 'Deals 22% more damage to heroes with no ally within 500.' },
    abilities: [
      { name: 'Hush Needle', icon: 'Permutation', kind: 'shot', range: 380, speed: 1000, width: 26, cd: 9, dmg: { b: 55, l: 18, ad: 0.7 }, cc: { silence: 1.5 }, use: ['engage', 'poke'], proj: 'p_kunai', fx: 'cut' },
      { name: 'Shadow Pounce', icon: 'Camouflage', kind: 'dash', range: 320, cd: 8, dmg: { b: 70, l: 22, ad: 0.9 }, use: ['engage', 'escape'], fx: 'cutx' },
      { name: 'Silent Night', icon: 'Death', kind: 'target', range: 300, cd: 60, dmg: { b: 200, l: 65, ad: 1.4 }, cc: { silence: 2, slow: [0.5, 2] }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },

  // ───────────── MID ─────────────
  { id: 'ember', clan: 'wild', pers: 'hothead', name: 'Ember', title: 'Pyromancer', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'A hot-tempered pyromancer who solves every problem with fire.',
    tags: ['burn', 'poke', 'antiheal'], builds: ['burn', 'burst', 'haste'],
    passive: { kind: 'burnAbilities', name: 'Kindling', burn: { b: 5, l: 2, dur: 3 }, desc: 'Ability hits set enemies ablaze.' },
    abilities: [
      { name: 'Fireball', icon: 'Fireball', kind: 'shot', range: 450, speed: 650, width: 30, cd: 5, dmg: { b: 70, l: 25, ap: 0.6 }, use: ['poke', 'clear'], proj: 'p_fireball', fx: 'explosion' },
      { name: 'Flame Pillar', icon: 'BookFire', kind: 'circle', range: 420, radius: 110, delay: 0.6, cd: 11, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { root: 0.75 }, use: ['engage', 'peel', 'clear'], fx: 'flame' },
      { name: 'Wildfire', icon: 'OrbFire', kind: 'circle', range: 450, radius: 170, delay: 0.3, cd: 70, dmg: { b: 140, l: 45, ap: 0.7 }, burn: { b: 20, l: 5, dur: 4 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'raiden', clan: 'shinobi', pers: 'calm', name: 'Raiden', title: 'Storm Caller', role: 'mid', flex: [], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'The storm caller. Calm voice, loud thunder.',
    tags: ['burst', 'poke'], builds: ['burst', 'haste', 'spellblade'],
    passive: { kind: 'every3', name: 'Overcharge', type: 'magic', dmg: { b: 30, l: 8, ap: 0.3 }, desc: 'Every third attack discharges bonus magic damage.' },
    abilities: [
      { name: 'Lightning Bolt', icon: 'BookThunder', kind: 'shot', range: 480, speed: 1000, width: 28, cd: 6, dmg: { b: 80, l: 30, ap: 0.75 }, use: ['poke', 'clear'], proj: 'p_energy', fx: 'thunder' },
      { name: 'Static Field', icon: 'Vision', kind: 'nova', radius: 180, cd: 10, dmg: { b: 50, l: 15, ap: 0.4 }, cc: { slow: [0.3, 1.5] }, use: ['clear', 'peel'], fx: 'thunder' },
      { name: 'Thunder God', icon: 'OrbLight', kind: 'circle', range: 500, radius: 150, delay: 0.4, cd: 60, dmg: { b: 250, l: 80, ap: 1.0 }, cc: { stun: 0.5 }, use: ['execute', 'teamfight'], fx: 'thunder', ult: true },
    ] },
  { id: 'totem', clan: 'spirit', pers: 'cautious', name: 'Totem', title: 'Spirit Speaker', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'late',
    lore: 'Speaks for the ancestors, and the ancestors have a lot to say.',
    tags: ['cc', 'poke', 'scaling'], builds: ['haste', 'burn', 'burst'],
    passive: { kind: 'every3', name: 'Ancestors', type: 'magic', dmg: { b: 20, l: 6, ap: 0.25 }, desc: 'Every third attack calls a spirit for bonus magic damage.' },
    abilities: [
      { name: 'Spirit Bolt', icon: 'OrbWater', kind: 'shot', range: 450, speed: 750, width: 30, cd: 6, dmg: { b: 65, l: 22, ap: 0.6 }, cc: { slow: [0.25, 1.5] }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'spirit' },
      { name: 'Root Snare', icon: 'BookPlant', kind: 'circle', range: 450, radius: 90, delay: 0.5, cd: 12, dmg: { b: 50, l: 15, ap: 0.4 }, cc: { root: 1.5 }, use: ['engage', 'peel'], fx: 'plant' },
      { name: 'Ancestral Storm', icon: 'BookWind', kind: 'zone', range: 450, radius: 220, dur: 4, cd: 75, dmg: { b: 50, l: 15, ap: 0.25 }, cc: { slow: [0.4, 0.5] }, use: ['teamfight'], fx: 'spirit', ult: true },
    ] },
  { id: 'sanguis', clan: 'spirit', pers: 'greedy', name: 'Sanguis', title: 'Crimson Count', role: 'mid', flex: ['top'], cls: 'mage', dmgType: 'magic', curve: 'late',
    lore: 'An old count who stays young by draining everyone else.',
    tags: ['sustain', 'scaling', 'teamfight'], builds: ['sustain', 'burst', 'spellblade'],
    passive: { kind: 'spellVamp', name: 'Thirst', pct: 0.15, desc: '15% omnivamp.' },
    abilities: [
      { name: 'Blood Lance', icon: 'BookDeath', kind: 'target', range: 400, cd: 6, dmg: { b: 70, l: 25, ap: 0.6 }, heal: { b: 30, l: 10, ap: 0.25 }, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Mist Form', icon: 'Mist', kind: 'self', cd: 14, buff: { dur: 1.5, stats: { msPct: 0.3 } }, shield: { b: 80, l: 25, ap: 0.4, dur: 2 }, use: ['escape', 'defend'], fx: 'smoke' },
      { name: 'Hemoplague', icon: 'Necromancy', kind: 'circle', range: 450, radius: 220, delay: 1.0, cd: 70, dmg: { b: 200, l: 60, ap: 0.8 }, heal: { b: 100, l: 30 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'hex', clan: 'shinobi', pers: 'calm', name: 'Hex', title: 'Night Weaver', role: 'mid', flex: ['jungle'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'A night weaver who unravels the unwary with one dark thread.',
    tags: ['burst', 'dive', 'pick'], builds: ['burst', 'spellblade', 'haste'],
    passive: { kind: 'executer', name: 'Malice', pct: 0.12, desc: 'Deals 12% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Dark Orb', icon: 'OrbDarkness', kind: 'shot', range: 420, speed: 800, width: 30, cd: 5, dmg: { b: 85, l: 28, ap: 0.7 }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'spirit' },
      { name: 'Shadow Leap', icon: 'Camouflage', kind: 'dash', range: 340, cd: 10, dmg: { b: 70, l: 20, ap: 0.5 }, use: ['engage', 'escape'], fx: 'smoke' },
      { name: 'Annihilate', icon: 'BookDarkness', kind: 'target', range: 450, cd: 55, dmg: { b: 300, l: 90, ap: 1.2, miss: 0.18 }, use: ['execute'], fx: 'explosion', ult: true },
    ] },
  { id: 'kurai', clan: 'spirit', pers: 'cautious', name: 'Kurai', title: 'Hollow Sage', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'A hollow sage who sees the battlefield as a board of runes.',
    tags: ['cc', 'teamfight', 'poke'], builds: ['haste', 'burst', 'burn'],
    passive: { kind: 'every3', name: 'Echo', type: 'magic', dmg: { b: 20, l: 6, ap: 0.25 }, desc: 'Every third attack echoes for bonus magic damage.' },
    abilities: [
      { name: 'Rune Mine', icon: 'OrbDarkness', kind: 'circle', range: 450, radius: 100, delay: 0.9, cd: 8, dmg: { b: 65, l: 20, ap: 0.55 }, cc: { slow: [0.4, 1.5] }, use: ['poke', 'clear'], fx: 'circle_orange' },
      { name: 'Gloom Field', icon: 'Mist', kind: 'zone', range: 420, radius: 140, dur: 3, cd: 12, dmg: { b: 25, l: 8, ap: 0.2 }, cc: { slow: [0.35, 0.5] }, use: ['peel', 'engage', 'clear'], fx: 'spirit' },
      { name: 'Collapse', icon: 'BookDarkness', kind: 'circle', range: 500, radius: 230, delay: 0.7, cd: 75, dmg: { b: 160, l: 50, ap: 0.7 }, cc: { root: 1.0 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'nami', clan: 'shinobi', pers: 'reckless', name: 'Nami', title: 'Tide Dancer', role: 'mid', flex: ['jungle'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'Dances on the tide and drags whole teams under with it.',
    tags: ['dive', 'teamfight', 'cc'], builds: ['burst', 'spellblade', 'sustain'],
    passive: { kind: 'shieldOnHit', name: 'Bubble Guard', pct: 0.07, cd: 12, desc: 'Taking hero damage wraps her in a bubble shield (7% max HP). 12s cooldown.' },
    abilities: [
      { name: 'Water Whip', icon: 'WaterCanon', kind: 'line', range: 340, width: 60, cd: 6, dmg: { b: 85, l: 28, ap: 0.7 }, cc: { slow: [0.35, 1.5] }, use: ['poke', 'clear', 'engage'], fx: 'water' },
      { name: 'Riptide', icon: 'OrbWater', kind: 'dash', range: 300, cd: 9, dmg: { b: 70, l: 20, ap: 0.5 }, shield: { b: 70, l: 22, ap: 0.35, dur: 2.5 }, use: ['engage', 'escape'], fx: 'water' },
      { name: 'Maelstrom', icon: 'BookWind', kind: 'nova', radius: 230, cd: 70, dmg: { b: 200, l: 60, ap: 0.85 }, cc: { knock: 0.75 }, use: ['teamfight', 'engage'], fx: 'water', ult: true },
    ] },
  { id: 'kitsu', clan: 'wild', pers: 'greedy', name: 'Kitsu', title: 'Foxfire Mystic', role: 'mid', flex: ['bot'], cls: 'mage', dmgType: 'magic', curve: 'late',
    lore: 'A nine-tailed fox spirit who burns slowly, and burns long.',
    tags: ['poke', 'scaling', 'pick'], builds: ['burn', 'burst', 'siege'],
    passive: { kind: 'burnAbilities', name: 'Foxfire', burn: { b: 4, l: 1.5, dur: 3 }, desc: 'Ability hits leave a lingering foxfire burn.' },
    abilities: [
      { name: 'Foxfire Orb', icon: 'OrbFire', kind: 'shot', range: 470, speed: 700, width: 40, pierce: true, cd: 7, dmg: { b: 55, l: 17, ap: 0.5 }, use: ['poke', 'clear'], proj: 'p_fireball', fx: 'flame' },
      { name: 'Nine Tails', icon: 'Permutation', kind: 'self', cd: 15, buff: { dur: 4, stats: { haste: 25, msPct: 0.2 } }, shield: { b: 60, l: 20, ap: 0.3, dur: 2 }, use: ['escape', 'defend'], fx: 'spirit' },
      { name: 'Spirit Lance', icon: 'OrbLight', kind: 'shot', range: 650, speed: 1100, width: 50, pierce: true, cd: 60, dmg: { b: 160, l: 50, ap: 0.75 }, use: ['execute', 'teamfight'], proj: 'p_bigenergy', fx: 'spirit', ult: true },
    ] },

  { id: 'azim', clan: 'wild', pers: 'greedy', name: 'Azim', title: 'Sand Sultan', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'late',
    lore: 'Every fallen rival pays him tribute. The desert remembers every coin.',
    tags: ['scaling', 'poke', 'teamfight'], builds: ['burst', 'haste', 'spellblade'],
    passive: { kind: 'stackOnKill', name: 'Tribute', power: 6, max: 20, desc: 'Each hero takedown permanently grants +6 power (up to 20 takedowns).' },
    abilities: [
      { name: 'Sand Lance', icon: 'BookRock', kind: 'line', range: 420, width: 40, cd: 6, dmg: { b: 75, l: 25, ap: 0.7 }, use: ['poke', 'clear'], fx: 'rock' },
      { name: 'Mirage', icon: 'Mist', kind: 'dash', range: 280, cd: 14, shield: { b: 50, l: 18, ap: 0.3, dur: 2 }, use: ['escape'], fx: 'smoke' },
      { name: 'Sandstorm', icon: 'BookWind', kind: 'zone', range: 450, radius: 210, dur: 4, cd: 75, dmg: { b: 60, l: 18, ap: 0.3 }, cc: { silence: 0.6, slow: [0.3, 0.5] }, use: ['teamfight'], fx: 'smoke', ult: true },
    ] },
  { id: 'mori', clan: 'spirit', pers: 'cautious', name: 'Mori', title: 'Curse Weaver', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'A one-eyed swamp yokai. Her curses do little alone; they are an invitation for others.',
    tags: ['poke', 'cc', 'teamfight', 'antiheal'], builds: ['burn', 'haste', 'burst'],
    passive: { kind: 'markAbilities', name: 'Witch Mark', pct: 0.12, dur: 3, desc: 'Ability hits mark enemies: the next hit from any ally deals 12% more damage.' },
    abilities: [
      { name: 'Hex Bolt', icon: 'OrbDarkness', kind: 'shot', range: 440, speed: 750, width: 30, cd: 6, dmg: { b: 72, l: 24, ap: 0.65 }, cc: { slow: [0.2, 1] }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'spirit' },
      { name: 'Wither', icon: 'Downgrade', kind: 'circle', range: 420, radius: 110, delay: 0.5, cd: 12, dmg: { b: 45, l: 15, ap: 0.4 }, cc: { shred: [0.2, 4], grievous: 4 }, use: ['poke', 'engage', 'clear'], fx: 'plant' },
      { name: 'Doom Circle', icon: 'BookDeath', kind: 'circle', range: 500, radius: 220, delay: 0.8, cd: 75, dmg: { b: 150, l: 45, ap: 0.7 }, cc: { fear: 1.0, shred: [0.25, 5] }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'fujin', clan: 'spirit', pers: 'reckless', name: 'Fujin', title: 'Wind Tengu', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'The wind god\'s youngest servant. Loves nothing more than slamming enemies into cliffs.',
    tags: ['cc', 'peel', 'poke'], builds: ['haste', 'spellblade', 'burst'],
    passive: { kind: 'wallSlam', name: 'Gale Force', stun: 0.9, desc: 'Enemies knocked into a wall are stunned for 0.9s.' },
    abilities: [
      { name: 'Gust', icon: 'BookWind', kind: 'line', range: 340, width: 70, cd: 7, dmg: { b: 80, l: 26, ap: 0.7 }, knockAway: 120, use: ['poke', 'peel', 'engage'], fx: 'smoke' },
      { name: 'Tailwind', icon: 'Upgrade', kind: 'ally', range: 400, cd: 12, buff: { dur: 3, stats: { msPct: 0.3 } }, shield: { b: 50, l: 18, ap: 0.3, dur: 2 }, use: ['sustain'], fx: 'smoke' },
      { name: 'Cyclone', icon: 'Mist', kind: 'zone', range: 450, radius: 200, dur: 3, cd: 65, dmg: { b: 75, l: 25, ap: 0.4 }, pull: true, cc: { slow: [0.3, 0.5] }, use: ['teamfight'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'sumi', clan: 'shinobi', pers: 'calm', name: 'Sumi', title: 'Ink Painter', role: 'mid', flex: ['bot'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'Paints from across the valley. By the time you see the brushstroke, it has already landed.',
    tags: ['poke', 'siege', 'scaling'], builds: ['burst', 'haste', 'siege'],
    passive: { kind: 'longshot', name: 'Long Brush', pct: 0.2, desc: 'Abilities deal up to 20% more damage the farther away the target is (full at 450).' },
    abilities: [
      { name: 'Ink Stroke', icon: 'WaterCanon', kind: 'shot', range: 480, speed: 800, width: 30, cd: 6, dmg: { b: 80, l: 26, ap: 0.7 }, use: ['poke', 'clear'], proj: 'p_energy', fx: 'water' },
      { name: 'Splash', icon: 'OrbWater', kind: 'circle', range: 460, radius: 100, delay: 0.6, cd: 10, dmg: { b: 55, l: 18, ap: 0.5 }, cc: { root: 1.0 }, use: ['engage', 'peel', 'clear'], fx: 'water' },
      { name: 'Masterpiece', icon: 'BookLight', kind: 'shot', range: 650, speed: 900, width: 90, pierce: true, cd: 70, dmg: { b: 180, l: 55, ap: 0.85 }, cc: { mark: [0.2, 4] }, use: ['teamfight', 'execute'], proj: 'p_bigenergy', fx: 'water', ult: true },
    ] },

  // ───────────── BOT ─────────────
  { id: 'fletch', clan: 'wild', pers: 'calm', name: 'Fletch', title: 'Greenwood Archer', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    lore: "The greenwood's best archer. Never misses twice.",
    tags: ['dps', 'scaling', 'poke'], builds: ['crit', 'pierce', 'sustain'], proj: 'p_arrow',
    passive: { kind: 'every3', name: 'Quick Draw', dmg: { b: 15, l: 5, ad: 0.3 }, desc: 'Every third arrow deals bonus damage.' },
    abilities: [
      { name: 'Volley', icon: 'MagicWeapon', kind: 'shot', range: 450, speed: 900, width: 80, pierce: true, cd: 7, dmg: { b: 60, l: 20, ad: 0.8 }, cc: { slow: [0.2, 1] }, use: ['poke', 'clear'], proj: 'p_arrow', fx: 'cut' },
      { name: 'Focus', icon: 'AttackUpgrade', kind: 'self', cd: 12, buff: { dur: 4, stats: { asPct: 0.45 } }, use: ['engage'], fx: 'aura' },
      { name: 'Rain of Arrows', icon: 'BookWind', kind: 'circle', range: 550, radius: 200, delay: 0.5, cd: 60, dmg: { b: 150, l: 50, ad: 1.0 }, cc: { slow: [0.4, 2] }, use: ['teamfight'], fx: 'cut', ult: true },
    ] },
  { id: 'marlowe', clan: 'iron', pers: 'greedy', name: 'Marlowe', title: 'The Inspector', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    lore: 'A detective who closes cases with a very long gun.',
    tags: ['crit', 'scaling', 'pick'], builds: ['crit', 'burst', 'pierce'], proj: 'p_kunai',
    passive: { kind: 'executer', name: 'Case Closed', pct: 0.10, desc: 'Deals 10% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Piercing Shot', icon: 'Cut', kind: 'line', range: 500, width: 40, cd: 7, dmg: { b: 70, l: 25, ad: 1.1 }, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Sidestep', icon: 'BookWind', kind: 'dash', range: 220, cd: 12, buff: { dur: 2, stats: { asPct: 0.3 } }, use: ['escape'], fx: 'smoke' },
      { name: 'Final Verdict', icon: 'Death', kind: 'shot', range: 800, speed: 1400, width: 40, cd: 60, dmg: { b: 250, l: 90, ad: 1.6 }, use: ['execute'], proj: 'p_bigkunai', fx: 'explosion', ult: true },
    ] },
  { id: 'shuri', clan: 'shinobi', pers: 'reckless', name: 'Shuri', title: 'Golden Star', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'A golden star thrower whose poison makes every hit sting longer.',
    tags: ['dps', 'burn', 'teamfight'], builds: ['crit', 'burn', 'siege'], proj: 'p_shuriken',
    passive: { kind: 'burnHits', name: 'Venom Stars', burn: { b: 6, l: 2, dur: 2 }, desc: 'Basic attacks poison for 2s.' },
    abilities: [
      { name: 'Triple Star', icon: 'MagicWeapon', kind: 'shot', range: 400, speed: 900, width: 50, pierce: true, cd: 5, dmg: { b: 50, l: 18, ad: 0.7 }, use: ['poke', 'clear'], proj: 'p_shuriken', fx: 'cut' },
      { name: 'Swift Feet', icon: 'BookWind', kind: 'self', cd: 12, buff: { dur: 3, stats: { msPct: 0.3, asPct: 0.3 } }, use: ['escape', 'engage'], fx: 'aura' },
      { name: 'Shuriken Storm', icon: 'Explosion', kind: 'nova', radius: 260, cd: 55, dmg: { b: 150, l: 50, ad: 1.0 }, use: ['teamfight'], fx: 'circular', ult: true },
    ] },
  { id: 'bolt', clan: 'iron', pers: 'cautious', name: 'Bolt', title: 'Siege Unit', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'A walking siege engine. Towers fear the sound of its gears.',
    tags: ['poke', 'siege'], builds: ['siege', 'burst', 'crit'], proj: 'p_cannon',
    passive: { kind: 'siege', name: 'Demolition', pct: 0.3, desc: 'Deals 30% bonus damage to structures.' },
    abilities: [
      { name: 'Cannon Shot', icon: 'Explosion', kind: 'circle', range: 600, radius: 100, delay: 0.7, cd: 7, dmg: { b: 80, l: 25, ad: 0.8 }, use: ['poke', 'clear'], fx: 'explosion' },
      { name: 'Rocket Jump', icon: 'BookWind', kind: 'dash', range: 260, cd: 14, use: ['escape'], fx: 'smoke_ring' },
      { name: 'Orbital Strike', icon: 'OrbFire', kind: 'circle', range: 900, radius: 200, delay: 1.0, cd: 70, dmg: { b: 220, l: 70, ad: 1.2 }, use: ['teamfight', 'execute'], fx: 'explosion', ult: true },
    ] },
  { id: 'sling', clan: 'wild', pers: 'hothead', name: 'Sling', title: 'Cave Sniper', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'early',
    lore: 'A cave sniper with a sling, a rock and terrible aim at manners.',
    tags: ['poke', 'early', 'cc'], builds: ['burst', 'crit', 'pierce'], proj: 'p_cannon',
    passive: { kind: 'every3', name: 'Heavy Stone', dmg: { b: 20, l: 6, ad: 0.4 }, desc: 'Every third stone hits harder.' },
    abilities: [
      { name: 'Rock Sling', icon: 'BookRock', kind: 'shot', range: 450, speed: 900, width: 30, cd: 5, dmg: { b: 82, l: 25, ad: 1.0 }, use: ['poke', 'clear'], proj: 'p_cannon', fx: 'rock' },
      { name: 'Pebble Trap', icon: 'RockSpike', kind: 'circle', range: 400, radius: 80, delay: 0.4, cd: 12, dmg: { b: 50, l: 14, ad: 0.4 }, cc: { root: 1.25 }, use: ['peel', 'engage'], fx: 'rockspike' },
      { name: 'Landslide', icon: 'Explosion', kind: 'shot', range: 550, speed: 800, width: 120, pierce: true, cd: 60, dmg: { b: 180, l: 50, ad: 1.0 }, cc: { knock: 0.75 }, use: ['teamfight', 'engage'], proj: 'p_cannon', fx: 'rockspike', ult: true },
    ] },
  { id: 'wren', clan: 'wild', pers: 'cautious', name: 'Wren', title: 'Trapwright', role: 'bot', flex: ['support'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'A trapwright who turns every bush into a snare.',
    tags: ['cc', 'peel', 'poke'], builds: ['crit', 'haste', 'warden'], proj: 'p_arrow',
    passive: { kind: 'executer', name: "Hunter's Mark", pct: 0.10, desc: 'Deals 10% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Barbed Shot', icon: 'MagicWeapon', kind: 'shot', range: 450, speed: 950, width: 28, cd: 6, dmg: { b: 70, l: 22, ad: 0.9 }, cc: { slow: [0.25, 1.5] }, use: ['poke', 'clear'], proj: 'p_arrow', fx: 'cut' },
      { name: 'Caltrops', icon: 'Downgrade', kind: 'zone', range: 380, radius: 110, dur: 4, cd: 11, dmg: { b: 25, l: 8, ad: 0.25 }, cc: { slow: [0.45, 0.5] }, use: ['peel', 'poke', 'clear'], fx: 'cutx' },
      { name: 'Snare Net', icon: 'BookPlant', kind: 'circle', range: 600, radius: 200, delay: 0.6, cd: 65, dmg: { b: 150, l: 45, ad: 0.9 }, cc: { root: 1.75 }, use: ['teamfight', 'peel'], fx: 'plant', ult: true },
    ] },
  { id: 'bakuha', clan: 'wild', pers: 'hothead', name: 'Bakuha', title: 'Mad Bomber', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'The mad bomber. Every problem looks like a fuse.',
    tags: ['burst', 'teamfight', 'siege'], builds: ['siege', 'burst', 'burn'], proj: 'p_cannon',
    passive: { kind: 'siege', name: 'Demolitions', pct: 0.25, desc: 'Deals 25% bonus damage to structures.' },
    abilities: [
      { name: 'Sticky Bomb', icon: 'Explosion', kind: 'circle', range: 450, radius: 95, delay: 0.8, cd: 7, dmg: { b: 70, l: 22, ad: 0.7 }, use: ['poke', 'clear'], fx: 'explosion' },
      { name: 'Blast Jump', icon: 'BookWind', kind: 'dash', range: 280, radius: 110, cd: 13, dmg: { b: 40, l: 12, ad: 0.4 }, cc: { knock: 0.4 }, use: ['escape', 'peel'], fx: 'smoke_ring' },
      { name: 'Powder Keg', icon: 'OrbFire', kind: 'circle', range: 550, radius: 220, delay: 0.6, cd: 60, dmg: { b: 160, l: 50, ad: 0.9 }, burn: { b: 15, l: 4, dur: 3 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'tomoe', clan: 'iron', pers: 'greedy', name: 'Tomoe', title: 'Stance Archer', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    lore: 'A stance archer whose arrows fly faster the longer she holds her ground.',
    tags: ['dps', 'scaling', 'teamfight'], builds: ['crit', 'pierce', 'spellblade'], proj: 'p_arrow',
    passive: { kind: 'spellVamp', name: 'Bushido', pct: 0.06, desc: '6% omnivamp.' },
    abilities: [
      { name: 'Piercing Arrow', icon: 'Cut', kind: 'line', range: 480, width: 36, cd: 6, dmg: { b: 70, l: 24, ad: 1.05 }, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Steady Stance', icon: 'Vision', kind: 'self', cd: 14, buff: { dur: 4, stats: { range: 30, asPct: 0.25 } }, use: ['engage'], fx: 'aura' },
      { name: 'Hundred Arrows', icon: 'AttackUpgrade', kind: 'self', cd: 70, buff: { dur: 6, stats: { asPct: 0.5, crit: 0.25, msPct: 0.1 } }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },

  { id: 'voss', clan: 'iron', pers: 'greedy', name: 'Voss', title: 'Dueling Baron', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    lore: 'A nobleman who leaves a calling card on every opponent. He has a lot of cards.',
    tags: ['dps', 'pick', 'scaling'], builds: ['crit', 'pierce', 'spellblade'], proj: 'p_kunai',
    passive: { kind: 'markEvery', name: 'Calling Card', n: 3, pct: 0.25, dur: 3, desc: 'Every 3rd attack marks the target: the next hit from any ally deals 25% more damage.' },
    abilities: [
      { name: 'Ricochet', icon: 'MagicWeapon', kind: 'target', range: 400, cd: 6, dmg: { b: 70, l: 22, ad: 1.0 }, bounce: 2, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Riposte Step', icon: 'BookWind', kind: 'dash', range: 220, cd: 11, buff: { dur: 3, stats: { asPct: 0.35 } }, use: ['escape'], fx: 'smoke' },
      { name: 'Grand Duel', icon: 'AttackUpgrade', kind: 'target', range: 400, cd: 60, dmg: { b: 150, l: 50, ad: 1.1 }, cc: { mark: [0.35, 4] }, buff: { dur: 4, stats: { asPct: 0.5 } }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'morel', clan: 'beast', pers: 'reckless', name: 'Morel', title: 'Spore Toad', role: 'bot', flex: ['support'], cls: 'marksman', dmgType: 'phys', curve: 'early',
    lore: 'A swamp toad grown in the shade of giant mushrooms. Everything it touches stops healing.',
    tags: ['poke', 'antiheal', 'cc'], builds: ['burn', 'haste', 'siege'], proj: 'p_plant',
    passive: { kind: 'grievousHits', name: 'Toxic Spores', dur: 2, desc: 'Basic attacks apply Grievous Wounds (-40% healing) for 2s.' },
    abilities: [
      { name: 'Spore Shot', icon: 'OrbPlant', kind: 'shot', range: 420, speed: 850, width: 32, cd: 7, dmg: { b: 60, l: 20, ad: 0.75 }, burn: { b: 10, l: 3, dur: 3 }, use: ['poke', 'clear'], proj: 'p_plant', fx: 'plant' },
      { name: 'Puffball Trap', icon: 'Alchemy', kind: 'zone', range: 400, radius: 100, dur: 4, cd: 13, dmg: { b: 20, l: 6, ad: 0.2 }, cc: { fear: 0.75 }, use: ['peel', 'poke'], fx: 'plant' },
      { name: 'Mycelium Bloom', icon: 'BookPlant', kind: 'zone', range: 500, radius: 220, dur: 5, cd: 70, dmg: { b: 50, l: 16, ad: 0.35 }, cc: { slow: [0.35, 0.5], grievous: 1 }, use: ['teamfight'], fx: 'plant', ult: true },
    ] },
  { id: 'hachi', clan: 'shinobi', pers: 'hothead', name: 'Hachi', title: 'Hornet', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'Fast, furious and very angry. Each sting comes quicker than the last.',
    tags: ['dps', 'dive', 'crit'], builds: ['crit', 'pierce', 'sustain'], proj: 'p_shuriken',
    passive: { kind: 'frenzy', name: 'Hornet Swarm', pct: 0.1, max: 5, desc: 'Each attack on the same target grants +10% attack speed, up to 5 stacks. Switching targets resets it.' },
    abilities: [
      { name: 'Sting', icon: 'Cut', kind: 'shot', range: 420, speed: 1000, width: 30, cd: 5, dmg: { b: 70, l: 22, ad: 1.0 }, cc: { shred: [0.2, 3] }, use: ['poke', 'clear'], proj: 'p_shuriken', fx: 'cut' },
      { name: 'Swarm Step', icon: 'BookWind', kind: 'dash', range: 260, cd: 10, buff: { dur: 2.5, stats: { asPct: 0.3 } }, use: ['escape'], fx: 'smoke' },
      { name: 'Hive Fury', icon: 'AttackUpgrade', kind: 'self', cd: 65, buff: { dur: 6, stats: { asPct: 0.6, msPct: 0.15, sunder: 0.05 } }, use: ['teamfight', 'engage'], fx: 'boost', ult: true },
    ] },
  { id: 'rekka', clan: 'wild', pers: 'cautious', name: 'Rekka', title: 'Rocket Ninja', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'Traded her sword for black powder. Towers are just big targets that do not dodge.',
    tags: ['siege', 'poke', 'teamfight'], builds: ['siege', 'crit', 'spellblade'], proj: 'p_cannon',
    passive: { kind: 'splashEvery', name: 'Payload', n: 4, r: 90, pct: 0.6, desc: 'Every 4th attack explodes, dealing 60% of its damage around the target.' },
    abilities: [
      { name: 'Rocket Barrage', icon: 'Explosion', kind: 'line', range: 420, width: 80, cd: 8, dmg: { b: 60, l: 20, ad: 0.75 }, use: ['poke', 'clear'], fx: 'explosion' },
      { name: 'Flash Bang', icon: 'Vision', kind: 'circle', range: 400, radius: 120, delay: 0.3, cd: 13, dmg: { b: 30, l: 10, ad: 0.3 }, cc: { silence: 1.0, slow: [0.25, 1] }, use: ['peel', 'engage'], fx: 'thunder' },
      { name: 'Dragon Rocket', icon: 'OrbFire', kind: 'shot', range: 650, speed: 650, width: 60, splash: 160, cd: 65, dmg: { b: 200, l: 60, ad: 1.1 }, use: ['teamfight', 'execute'], proj: 'p_fireball', fx: 'explosion', ult: true },
    ] },

  // ───────────── SUPPORT ─────────────
  { id: 'oak', clan: 'spirit', pers: 'loyal', name: 'Brother Oak', title: 'Temple Healer', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'A gentle temple healer with very strong hands.',
    tags: ['heal', 'peel', 'sustain'], builds: ['guardian', 'warden', 'haste'],
    passive: { kind: 'healAllies', name: 'Blessed Hands', heal: { b: 10, l: 4, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Mending Palm', icon: 'Heal', kind: 'ally', range: 450, cd: 8, heal: { b: 60, l: 20, ap: 0.45 }, use: ['sustain'], fx: 'spirit' },
      { name: 'Chi Burst', icon: 'OrbLight', kind: 'nova', radius: 170, cd: 10, dmg: { b: 40, l: 12, ap: 0.4 }, cc: { slow: [0.3, 1.5] }, use: ['peel', 'clear'], fx: 'circle' },
      { name: 'Sanctuary', icon: 'BookLight', kind: 'allynova', radius: 320, cd: 85, heal: { b: 110, l: 30, ap: 0.5 }, use: ['teamfight', 'sustain'], fx: 'aura', ult: true },
    ] },
  { id: 'wu', clan: 'spirit', pers: 'calm', name: 'Sensei Wu', title: 'Old Master', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'late',
    lore: 'An old master who teaches with shields and palm strikes.',
    tags: ['shield', 'cc', 'peel'], builds: ['guardian', 'warden', 'haste'],
    passive: { kind: 'every3', name: 'Discipline', type: 'magic', dmg: { b: 15, l: 5, ap: 0.2 }, desc: 'Every third strike deals bonus magic damage.' },
    abilities: [
      { name: 'Palm Strike', icon: 'Counter', kind: 'shot', range: 400, speed: 800, width: 34, cd: 9, dmg: { b: 70, l: 22, ap: 0.5 }, cc: { stun: 1.0 }, use: ['engage', 'peel'], proj: 'p_energy', fx: 'spark' },
      { name: 'Iron Ward', icon: 'DefenseUpgrade', kind: 'ally', range: 450, cd: 8, shield: { b: 100, l: 35, ap: 0.6, dur: 3 }, use: ['sustain', 'peel'], fx: 'shield_yellow' },
      { name: 'Inner Peace', icon: 'BookLight', kind: 'allynova', radius: 350, cd: 70, shield: { b: 150, l: 50, ap: 0.7, dur: 3 }, buff: { dur: 4, stats: { armor: 20, mr: 20 } }, use: ['teamfight'], fx: 'shield', ult: true },
    ] },
  { id: 'aurelia', clan: 'wild', pers: 'loyal', name: 'Aurelia', title: 'Sun Princess', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'The sun princess. Her light heals friends and blinds foes.',
    tags: ['heal', 'buff', 'peel'], builds: ['guardian', 'haste', 'burst'],
    passive: { kind: 'healAllies', name: 'Radiance', heal: { b: 8, l: 4, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Starlight', icon: 'OrbLight', kind: 'shot', range: 450, speed: 850, width: 34, cd: 11, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { root: 1.25 }, use: ['engage', 'peel'], proj: 'p_energy', fx: 'spark' },
      { name: 'Grace', icon: 'Heal', kind: 'ally', range: 450, cd: 9, heal: { b: 60, l: 18, ap: 0.35 }, buff: { dur: 3, stats: { msPct: 0.25, asPct: 0.2 } }, use: ['sustain', 'engage'], fx: 'spirit' },
      { name: 'Royal Decree', icon: 'Upgrade', kind: 'allynova', radius: 350, cd: 70, heal: { b: 80, l: 20 }, buff: { dur: 5, stats: { asPct: 0.4, power: 20 } }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },
  { id: 'bonehook', clan: 'spirit', pers: 'reckless', name: 'Bonehook', title: 'Grave Fisher', role: 'support', flex: ['jungle'], cls: 'support', dmgType: 'magic', curve: 'early',
    lore: 'Fishes for souls with a rusty hook. Always gets a bite.',
    tags: ['cc', 'engage', 'pick'], builds: ['tank', 'warden', 'haste'], range: 55,
    passive: { kind: 'shieldOnHit', name: 'Bone Armor', pct: 0.08, cd: 12, desc: 'Taking hero damage grants a shield (8% max HP).' },
    abilities: [
      { name: 'Bone Hook', icon: 'Necromancy', kind: 'hook', range: 450, speed: 1000, width: 40, cd: 12, dmg: { b: 90, l: 30, ap: 0.5 }, cc: { stun: 0.75 }, use: ['engage'], proj: 'p_bigkunai', fx: 'cut' },
      { name: 'Grave Chill', icon: 'BookIce', kind: 'nova', radius: 170, cd: 10, dmg: { b: 40, l: 12, ap: 0.3 }, cc: { slow: [0.4, 2] }, use: ['peel', 'clear'], fx: 'ice' },
      { name: "Death's Embrace", icon: 'BookDeath', kind: 'circle', range: 400, radius: 220, delay: 0.5, cd: 75, dmg: { b: 120, l: 40, ap: 0.4 }, cc: { stun: 1.25 }, use: ['teamfight', 'engage'], fx: 'spirit', ult: true },
    ] },
  { id: 'frost', clan: 'wild', pers: 'loyal', name: 'Frost', title: 'Tundra Guard', role: 'support', flex: ['top'], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'A tundra guard who freezes anything that wanders too close.',
    tags: ['cc', 'engage', 'tank'], builds: ['tank', 'warden', 'haste'], range: 55,
    passive: { kind: 'dr', name: 'Permafrost', pct: 0.06, desc: 'Takes 6% less damage.' },
    abilities: [
      { name: 'Ice Shard', icon: 'BookIce', kind: 'shot', range: 420, speed: 850, width: 30, cd: 7, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { slow: [0.4, 1.5] }, use: ['poke', 'peel'], proj: 'p_icespike', fx: 'ice' },
      { name: 'Glacial Charge', icon: 'BookWind', kind: 'dash', range: 300, cd: 13, dmg: { b: 50, l: 15, ap: 0.3 }, cc: { knock: 0.75 }, use: ['engage'], fx: 'ice' },
      { name: 'Absolute Zero', icon: 'BookIce', kind: 'nova', radius: 280, cd: 75, dmg: { b: 150, l: 40, ap: 0.5 }, cc: { stun: 1.25 }, use: ['teamfight', 'engage'], fx: 'ice', ult: true },
    ] },
  { id: 'gizmo', clan: 'iron', pers: 'loyal', name: 'Gizmo', title: 'Shield Unit', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'A loyal shield robot. Its only program: protect.',
    tags: ['shield', 'peel', 'buff'], builds: ['guardian', 'warden', 'tank'],
    passive: { kind: 'shieldOnHit', name: 'Auto-Barrier', pct: 0.07, cd: 12, desc: 'Taking hero damage grants a shield (7% max HP). 12s cooldown.' },
    abilities: [
      { name: 'Barrier Drone', icon: 'DefenseUpgrade', kind: 'ally', range: 450, cd: 8, shield: { b: 90, l: 30, ap: 0.5, dur: 3 }, use: ['sustain', 'peel'], fx: 'shield' },
      { name: 'Tether Shock', icon: 'BookThunder', kind: 'shot', range: 420, speed: 900, width: 32, cd: 10, dmg: { b: 60, l: 20, ap: 0.45 }, cc: { stun: 0.75 }, use: ['engage', 'peel'], proj: 'p_energy', fx: 'thunder' },
      { name: 'Overclock', icon: 'Upgrade', kind: 'allynova', radius: 350, cd: 70, shield: { b: 120, l: 40, ap: 0.5, dur: 4 }, buff: { dur: 5, stats: { msPct: 0.25, asPct: 0.3, haste: 20 } }, use: ['teamfight'], fx: 'shield_yellow', ult: true },
    ] },
  { id: 'ruga', clan: 'beast', pers: 'hothead', name: 'Ruga', title: 'Drum Shaman', role: 'support', flex: ['top'], cls: 'support', dmgType: 'magic', curve: 'early',
    lore: 'A lion shaman whose war drums make the whole pride braver.',
    tags: ['buff', 'engage', 'heal'], builds: ['guardian', 'tank', 'warden'],
    passive: { kind: 'dr', name: 'Thick Mane', pct: 0.05, desc: 'Takes 5% less damage.' },
    abilities: [
      { name: 'War Drum', icon: 'Counter', kind: 'nova', radius: 180, cd: 9, dmg: { b: 55, l: 16, ap: 0.4 }, cc: { slow: [0.35, 1.5] }, buff: { dur: 3, stats: { msPct: 0.2 } }, use: ['engage', 'peel', 'clear'], fx: 'circle_orange' },
      { name: 'War Paint', icon: 'Upgrade', kind: 'ally', range: 450, cd: 10, heal: { b: 55, l: 16, ap: 0.35 }, buff: { dur: 4, stats: { power: 20, asPct: 0.2 } }, use: ['sustain'], fx: 'boost' },
      { name: 'Pride Chant', icon: 'BookPlant', kind: 'allynova', radius: 380, cd: 75, heal: { b: 70, l: 20, ap: 0.3 }, buff: { dur: 6, stats: { omnivamp: 0.15, msPct: 0.2, power: 15 } }, use: ['teamfight'], fx: 'aura', ult: true },
    ] },
  { id: 'hotaru', clan: 'spirit', pers: 'reckless', name: 'Hotaru', title: 'Lantern Ghost', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'A lantern ghost who guides lost allies and haunts lost enemies.',
    tags: ['cc', 'pick', 'heal'], builds: ['guardian', 'burst', 'haste'],
    passive: { kind: 'healAllies', name: 'Lantern Glow', heal: { b: 8, l: 3, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Haunt', icon: 'Necromancy', kind: 'target', range: 380, cd: 13, dmg: { b: 50, l: 16, ap: 0.35 }, cc: { stun: 0.75 }, use: ['engage', 'peel'], fx: 'spirit' },
      { name: 'Lantern Light', icon: 'Heal', kind: 'ally', range: 450, cd: 9, heal: { b: 50, l: 15, ap: 0.35 }, buff: { dur: 2, stats: { msPct: 0.3 } }, use: ['sustain'], fx: 'spirit' },
      { name: 'Night Parade', icon: 'BookDeath', kind: 'zone', range: 500, radius: 230, dur: 5, cd: 75, dmg: { b: 40, l: 14, ap: 0.25 }, cc: { slow: [0.45, 0.5] }, use: ['teamfight'], fx: 'spirit', ult: true },
    ] },
  { id: 'hoshi', clan: 'spirit', pers: 'calm', name: 'Hoshi', title: 'Star Sage', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'late',
    lore: 'Oak\'s old teacher. Reads the stars, and the stars say: do not let them stun you.',
    tags: ['peel', 'shield', 'cc'], builds: ['warden', 'guardian', 'haste'],
    passive: { kind: 'aura', name: 'Serenity', r: 400, stats: { tenacity: 0.2 }, desc: 'Allies within 400 have 20% tenacity (shorter stuns, roots, silences, fears and slows).' },
    abilities: [
      { name: 'Purify', icon: 'BookLight', kind: 'ally', range: 450, cd: 11, cleanse: true, shield: { b: 70, l: 25, ap: 0.5, dur: 2.5 }, use: ['sustain', 'peel'], fx: 'shield_yellow' },
      { name: 'Star Fall', icon: 'OrbLight', kind: 'circle', range: 440, radius: 100, delay: 0.7, cd: 9, dmg: { b: 65, l: 22, ap: 0.55 }, cc: { stun: 0.75 }, use: ['engage', 'peel', 'poke'], fx: 'spark' },
      { name: 'Celestial Gate', icon: 'Vision', kind: 'allynova', radius: 380, cd: 80, cleanse: true, shield: { b: 130, l: 40, ap: 0.6, dur: 3 }, buff: { dur: 4, stats: { tenacity: 0.5, msPct: 0.15 } }, use: ['teamfight'], fx: 'aura', ult: true },
    ] },
  { id: 'daikoku', clan: 'iron', pers: 'loyal', name: 'Daikoku', title: 'Golden Bell', role: 'support', flex: ['top'], cls: 'support', dmgType: 'magic', curve: 'mid', range: 55,
    lore: 'A temple bell given a body. When he rings, spellcasters forget their words.',
    tags: ['tank', 'engage', 'cc'], builds: ['tank', 'warden', 'haste'],
    passive: { kind: 'tenacity', name: 'Immovable', pct: 0.3, desc: '30% tenacity: stuns, roots, silences, fears and slows on him are 30% shorter.' },
    abilities: [
      { name: 'Bell Toll', icon: 'Counter', kind: 'nova', radius: 170, cd: 11, dmg: { b: 55, l: 16, ap: 0.4, hp: 0.02 }, cc: { silence: 1.25, slow: [0.3, 1.5] }, use: ['engage', 'peel', 'clear'], fx: 'circle_orange' },
      { name: 'Lucky Charm', icon: 'LuckUpgrade', kind: 'ally', range: 450, cd: 10, shield: { b: 60, l: 20, ap: 0.3, hp: 0.03, dur: 3 }, buff: { dur: 3, stats: { armor: 20, mr: 20 } }, use: ['sustain', 'peel'], fx: 'shield_yellow' },
      { name: 'Great Bell', icon: 'Upgrade', kind: 'dash', range: 400, radius: 200, cd: 75, dmg: { b: 130, l: 40, ap: 0.5, hp: 0.04 }, cc: { stun: 1.0, silence: 2.0 }, use: ['teamfight', 'engage'], fx: 'circle_orange', ult: true },
    ] },
  { id: 'kinta', clan: 'beast', pers: 'greedy', name: 'Kinta', title: 'Lucky Scout', role: 'support', flex: ['jungle'], cls: 'support', dmgType: 'magic', curve: 'early',
    lore: 'A golden-masked raccoon who sees everything shiny, including you, hiding in that bush.',
    tags: ['pick', 'poke', 'vision'], builds: ['warden', 'haste', 'burst'],
    passive: { kind: 'sight', name: 'Keen Eyes', pct: 0.25, desc: '+25% vision radius, and places wards twice as often.' },
    abilities: [
      { name: 'Shiny Coin', icon: 'LuckUpgrade', kind: 'shot', range: 450, speed: 950, width: 30, cd: 7, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { mark: [0.25, 4], slow: [0.25, 1.5] }, use: ['poke', 'engage'], proj: 'p_shuriken', fx: 'spark' },
      { name: 'Smoke Lantern', icon: 'Vision', kind: 'circle', range: 450, radius: 140, delay: 0.3, cd: 14, reveal: 4, dmg: { b: 30, l: 10, ap: 0.3 }, cc: { slow: [0.3, 1.5] }, use: ['engage', 'peel'], fx: 'smoke' },
      { name: 'Jackpot', icon: 'Upgrade', kind: 'allynova', radius: 420, cd: 75, buff: { dur: 5, stats: { msPct: 0.25, dmgPct: 0.1 } }, enemyCc: { mark: [0.2, 4] }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },
  { id: 'zahra', clan: 'wild', pers: 'loyal', name: 'Zahra', title: 'Desert Dancer', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'Azim\'s court dancer. Her blessings make blades sing and feet fly.',
    tags: ['buff', 'heal', 'peel'], builds: ['guardian', 'haste', 'spellblade'],
    passive: { kind: 'hasteGift', name: 'Tailwind', ms: 0.2, dur: 2, desc: 'Allies she heals, shields or buffs gain 20% move speed for 2s.' },
    abilities: [
      { name: 'Blessed Blade', icon: 'MagicWeapon', kind: 'ally', range: 450, cd: 9, onHitAlly: { b: 18, l: 6, ap: 0.15, dur: 4 }, buff: { dur: 4, stats: { asPct: 0.15 } }, use: ['sustain', 'engage'], fx: 'boost' },
      { name: 'Sirocco', icon: 'BookWind', kind: 'zone', range: 400, radius: 150, dur: 3, cd: 13, dmg: { b: 25, l: 8, ap: 0.25 }, cc: { slow: [0.4, 0.5] }, use: ['peel', 'clear', 'poke'], fx: 'smoke' },
      { name: 'Desert Bloom', icon: 'BookPlant', kind: 'allynova', radius: 380, cd: 75, heal: { b: 90, l: 25, ap: 0.4 }, buff: { dur: 5, stats: { asPct: 0.3, msPct: 0.2 } }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },
  // ───────────── v24: the HEARTH clan (Hearthfire, src/sim/hearth.js) and ten new heroes for the old clans ─────────────
  // top
  { id: 'daichi', clan: 'hearth', pers: 'loyal', name: 'Daichi', title: 'The Millstone', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'phys', curve: 'mid',
    lore: 'A miller who has carried the valley\'s grain up the mountain every day for thirty years. Now he carries the valley.',
    tags: ['tank', 'cc', 'peel', 'teamfight'], builds: ['tank', 'warden', 'haste'],
    passive: { kind: 'hearthGuard', name: 'Hearthguard', per: 4, desc: '+4 armor and magic resist for every Hearthfire ember.' },
    abilities: [
      { name: 'Millstone Roll', icon: 'BookRock', kind: 'line', range: 300, width: 70, cd: 9, dmg: { b: 60, l: 16, ad: 0.4, hp: 0.03 }, cc: { slow: [0.35, 1.5] }, use: ['poke', 'engage', 'clear'], fx: 'rock' },
      { name: 'Shoulder the Load', icon: 'DefenseUpgrade', kind: 'self', radius: 240, cd: 13, shield: { b: 80, l: 25, hp: 0.05, dur: 3 }, allyShield: { b: 40, l: 12, hp: 0.025, dur: 3 }, buff: { dur: 3, stats: { tenacity: 0.3 } }, use: ['defend', 'engage', 'sustain'], fx: 'shield' },
      { name: 'Millstone Avalanche', icon: 'RockSpike', kind: 'dash', range: 380, radius: 170, cd: 75, dmg: { b: 130, l: 40, hp: 0.05 }, cc: { stun: 1.0 }, use: ['teamfight', 'engage'], fx: 'rockspike', ult: true },
    ] },
  { id: 'tobi', clan: 'hearth', pers: 'hothead', name: 'Tobi', title: 'Woodcutter', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: 'The strongest arm in the valley. He has felled a thousand cedars and he talks to every one of them first.',
    tags: ['split', 'dps', 'antitank'], builds: ['pierce', 'siege', 'sustain'],
    passive: { kind: 'every3', name: 'Timber!', dmg: { b: 18, l: 6, ad: 0.3, hp: 0.02 }, desc: 'Every third swing deals bonus physical damage (plus 2% of his max HP).' },
    abilities: [
      { name: 'Axe Throw', icon: 'MagicWeapon', kind: 'shot', range: 360, speed: 800, width: 40, cd: 7, dmg: { b: 70, l: 20, ad: 0.9 }, cc: { slow: [0.25, 1.5] }, use: ['poke', 'clear', 'engage'], proj: 'p_bigshuriken', fx: 'cut' },
      { name: 'Notch', icon: 'Cut', kind: 'target', range: 80, cd: 8, dmg: { b: 45, l: 12, ad: 0.6 }, cc: { shred: [0.2, 4] }, use: ['engage', 'poke'], fx: 'cut' },
      { name: 'Felling Blow', icon: 'Death', kind: 'line', range: 300, width: 90, cd: 60, dmg: { b: 200, l: 60, ad: 1.2, miss: 0.12 }, cc: { knock: 0.75 }, use: ['execute', 'engage', 'teamfight'], fx: 'slash', ult: true },
    ] },
  { id: 'kuma', clan: 'beast', pers: 'hothead', name: 'Kuma', title: 'Mountain Bear', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    lore: 'Wakes from hibernation hungry and in a terrible mood. The Beast clan schedules its wars around his naps.',
    tags: ['tank', 'dive', 'sustain', 'antiheal'], builds: ['sustain', 'tank', 'pierce'],
    passive: { kind: 'onTakedown', name: 'Feast', heal: 0.1, ms: 0.2, dur: 3, desc: 'Takedowns heal 10% max HP and give +20% move speed for 3s.' },
    abilities: [
      { name: 'Maul', icon: 'Cut', kind: 'target', range: 80, cd: 7, dmg: { b: 70, l: 22, ad: 0.9 }, cc: { grievous: 3 }, use: ['engage', 'poke'], fx: 'claw' },
      { name: 'Bear Hug', icon: 'Counter', kind: 'target', range: 90, cd: 12, dmg: { b: 50, l: 15, ad: 0.5, hp: 0.03 }, cc: { root: 1.25 }, use: ['engage', 'peel'], fx: 'claw_double' },
      { name: 'Avalanche', icon: 'Explosion', kind: 'dash', range: 420, radius: 180, cd: 75, dmg: { b: 150, l: 45, ad: 0.9, hp: 0.05 }, cc: { stun: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'mogura', clan: 'iron', pers: 'cautious', name: 'Mogura', title: 'Tunnel Sapper', role: 'top', flex: ['jungle'], cls: 'tank', dmgType: 'phys', curve: 'late',
    lore: 'The Iron clan\'s tunneller. To him a wall is a suggestion and a tower is a long afternoon.',
    tags: ['tank', 'siege', 'split'], builds: ['siege', 'tank', 'warden'],
    passive: { kind: 'siege', name: 'Undermine', pct: 0.25, desc: 'Deals 25% bonus damage to structures.' },
    abilities: [
      { name: 'Burrow', icon: 'BookRock', kind: 'dash', range: 320, cd: 9, stealth: 1, dmg: { b: 60, l: 18, ad: 0.5, hp: 0.025 }, cc: { knock: 0.5 }, use: ['engage', 'escape'], fx: 'rock' },
      { name: 'Hard Hat', icon: 'DefenseUpgrade', kind: 'self', cd: 13, buff: { dur: 4, stats: { armor: 35, mr: 20, tenacity: 0.3 } }, use: ['defend', 'engage'], fx: 'shield' },
      { name: 'Cave-In', icon: 'RockSpike', kind: 'circle', range: 450, radius: 200, delay: 0.8, cd: 75, dmg: { b: 150, l: 45, hp: 0.05 }, cc: { root: 1.5 }, use: ['teamfight', 'engage'], fx: 'rockspike', ult: true },
    ] },
  // jungle
  { id: 'kenta', clan: 'hearth', pers: 'reckless', name: 'Kenta', title: 'Rooftop Runner', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'early',
    lore: 'The fastest kid in the valley never touches the ground if there is a roof. He carries the news, and lately, the fight.',
    tags: ['dive', 'pick', 'burst', 'early'], builds: ['burst', 'crit', 'spellblade'],
    passive: { kind: 'emberChase', name: 'Light the Way', ms: 0.02, desc: 'His takedowns light 2 Hearthfire embers instead of 1. +2% move speed per ember.' },
    abilities: [
      { name: 'Rooftop Leap', icon: 'BookWind', kind: 'dash', range: 300, cd: 8, dmg: { b: 65, l: 20, ad: 0.8 }, use: ['engage', 'escape'], fx: 'smoke' },
      { name: 'Slingshot', icon: 'BookRock', kind: 'shot', range: 420, speed: 950, width: 30, cd: 7, dmg: { b: 55, l: 18, ad: 0.7 }, cc: { slow: [0.3, 1.5], mark: [0.15, 3] }, use: ['poke', 'engage'], proj: 'p_rock', fx: 'impact' },
      { name: 'Firecracker Dash', icon: 'Explosion', kind: 'dash', range: 400, radius: 140, cd: 60, resetOnKill: true, dmg: { b: 190, l: 58, ad: 1.1, miss: 0.15 }, cc: { knock: 0.5 }, use: ['execute', 'engage'], fx: 'explosion', ult: true },
    ] },
  { id: 'isamu', clan: 'hearth', pers: 'calm', name: 'Isamu', title: 'Ridge Hunter', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'He reads tracks the way monks read scripture. Whatever walks the ridge, Isamu already knows where it sleeps.',
    tags: ['pick', 'cc', 'vision'], builds: ['warden', 'pierce', 'sustain'],
    passive: { kind: 'cruel', name: 'Hunter\'s Patience', pct: 0.12, desc: 'Deals 12% more damage to stunned, rooted, feared or slowed heroes.' },
    abilities: [
      { name: 'Bear Trap', icon: 'RockSpike', kind: 'circle', range: 400, radius: 80, delay: 0.4, cd: 11, dmg: { b: 55, l: 16, ad: 0.5 }, cc: { root: 1.25 }, use: ['engage', 'peel'], fx: 'cutx' },
      { name: 'Tracking Arrow', icon: 'Vision', kind: 'shot', range: 450, speed: 1000, width: 30, cd: 9, reveal: 4, dmg: { b: 60, l: 18, ad: 0.7 }, cc: { slow: [0.2, 1.5] }, use: ['poke', 'engage'], proj: 'p_arrow', fx: 'cut' },
      { name: 'The Great Hunt', icon: 'Upgrade', kind: 'allynova', radius: 420, cd: 65, buff: { dur: 5, stats: { msPct: 0.25, dmgPct: 0.1 } }, enemyCc: { slow: [0.3, 2] }, use: ['teamfight', 'engage'], fx: 'boost', ult: true },
    ] },
  { id: 'hebi', clan: 'shinobi', pers: 'cautious', name: 'Hebi', title: 'Venom Fang', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'mid',
    lore: 'A serpent who sheds a skin for every name she has worn. The Shinobi send her when the target must not get up again.',
    tags: ['pick', 'burst', 'antiheal'], builds: ['burst', 'pierce', 'crit'],
    passive: { kind: 'grievousHits', name: 'Venom', dur: 3, desc: 'Basic attacks apply Grievous Wounds (-40% healing) for 3s.' },
    abilities: [
      { name: 'Fang Strike', icon: 'Cut', kind: 'dash', range: 300, cd: 8, dmg: { b: 70, l: 22, ad: 0.85 }, cc: { slow: [0.3, 1.5] }, use: ['engage', 'escape'], fx: 'claw' },
      { name: 'Shed Skin', icon: 'Camouflage', kind: 'self', cd: 14, stealth: 1.5, cleanse: true, buff: { dur: 2, stats: { msPct: 0.25 } }, use: ['escape', 'defend'], fx: 'smoke' },
      { name: 'Constrict', icon: 'Death', kind: 'target', range: 200, cd: 60, dmg: { b: 210, l: 62, ad: 1.15, miss: 0.15 }, cc: { stun: 1.25 }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'upa', clan: 'wild', pers: 'loyal', name: 'Upa', title: 'Axolotl Tracker', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    lore: 'Lose an arm, grow it back by lunch. Upa guides the Wild clan through the marsh and never seems to stay hurt.',
    tags: ['sustain', 'cc', 'engage'], builds: ['sustain', 'tank', 'spellblade'],
    passive: { kind: 'lowhpRegen', name: 'Regrowth', pct: 0.024, desc: 'Below 35% HP, regenerates 2.4% max HP per second.' },
    abilities: [
      { name: 'Bubble Spit', icon: 'OrbWater', kind: 'shot', range: 400, speed: 800, width: 40, cd: 7, dmg: { b: 65, l: 20, ad: 0.7 }, cc: { slow: [0.35, 1.5] }, use: ['poke', 'clear', 'engage'], proj: 'p_energy', fx: 'water' },
      { name: 'Tail Whip', icon: 'WaterCanon', kind: 'nova', radius: 160, cd: 9, dmg: { b: 60, l: 18, ad: 0.7 }, heal: { b: 35, l: 10, ad: 0.2 }, cc: { slow: [0.3, 1] }, use: ['clear', 'engage'], fx: 'water' },
      { name: 'Flash Flood', icon: 'BookWind', kind: 'line', range: 400, width: 120, cd: 70, dmg: { b: 160, l: 45, ad: 0.9 }, cc: { knock: 0.75 }, use: ['teamfight', 'engage'], fx: 'wave', ult: true },
    ] },
  // mid
  { id: 'taro', clan: 'hearth', pers: 'greedy', name: 'Taro', title: 'Firework Maker', role: 'mid', flex: ['bot'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'He has blown up his own workshop eleven times. He promises the twelfth is for the enemy.',
    tags: ['poke', 'teamfight', 'burst'], builds: ['burst', 'burn', 'haste'],
    passive: { kind: 'every3', name: 'Sparkler', type: 'magic', dmg: { b: 20, l: 6, ap: 0.25 }, desc: 'Every third attack pops a sparkler for bonus magic damage.' },
    abilities: [
      { name: 'Bottle Rocket', icon: 'Fireball', kind: 'shot', range: 450, speed: 900, width: 30, splash: 90, cd: 6, dmg: { b: 78, l: 25, ap: 0.62 }, use: ['poke', 'clear'], proj: 'p_fireball', fx: 'explosion' },
      { name: 'Pinwheel', icon: 'BookThunder', kind: 'zone', range: 400, radius: 120, dur: 3, cd: 12, dmg: { b: 25, l: 8, ap: 0.22 }, cc: { slow: [0.3, 0.5] }, use: ['peel', 'clear', 'poke'], fx: 'spark' },
      { name: 'Grand Finale', icon: 'Explosion', kind: 'circle', range: 550, radius: 220, delay: 1.0, cd: 70, dmg: { b: 220, l: 65, ap: 0.9 }, cc: { stun: 0.75 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'mame', clan: 'hearth', pers: 'hothead', name: 'Mame', title: 'Bean Thrower', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'early',
    lore: 'Every spring the valley throws roasted beans to drive out the oni. Mame never stopped, and the oni have noticed.',
    tags: ['cc', 'poke', 'pick'], builds: ['haste', 'burst', 'spellblade'],
    passive: { kind: 'empowerCC', name: 'Oni Out!', cd: 8, dmg: { b: 20, l: 8, ap: 0.3 }, cc: { fear: 0.6 }, desc: 'After casting, her next basic attack within 3s throws a fistful of beans: bonus magic damage and a 0.6s fear. 8s cooldown.' },
    abilities: [
      { name: 'Bean Volley', icon: 'MagicWeapon', kind: 'shot', range: 420, speed: 850, width: 50, pierce: true, cd: 6, dmg: { b: 70, l: 22, ap: 0.6 }, use: ['poke', 'clear'], proj: 'p_rock', fx: 'spark' },
      { name: 'Paper Ward', icon: 'BookLight', kind: 'circle', range: 400, radius: 110, delay: 0.5, cd: 12, dmg: { b: 40, l: 12, ap: 0.4 }, cc: { silence: 1.0 }, use: ['engage', 'peel'], fx: 'holy' },
      { name: 'Setsubun', icon: 'Mist', kind: 'nova', radius: 260, cd: 70, dmg: { b: 170, l: 50, ap: 0.8 }, cc: { fear: 1.25 }, use: ['teamfight', 'engage', 'peel'], fx: 'circle_orange', ult: true },
    ] },
  { id: 'fukuro', clan: 'spirit', pers: 'calm', name: 'Fukuro', title: 'Night Owl Sage', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'late',
    lore: 'Hoots once for every secret it knows. It has not stopped hooting in three hundred years.',
    tags: ['poke', 'pick', 'vision'], builds: ['burst', 'haste', 'burn'],
    passive: { kind: 'executer', name: 'Night Hunter', pct: 0.1, desc: 'Deals 10% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Moon Feather', icon: 'OrbLight', kind: 'shot', range: 460, speed: 900, width: 32, pierce: true, cd: 6, dmg: { b: 80, l: 26, ap: 0.65 }, use: ['poke', 'clear'], proj: 'p_magicstar', fx: 'spirit' },
      { name: 'Silent Wings', icon: 'Camouflage', kind: 'dash', range: 280, cd: 13, stealth: 1, use: ['escape'], fx: 'smoke' },
      { name: 'All-Seeing', icon: 'Vision', kind: 'circle', range: 600, radius: 220, delay: 0.7, cd: 70, reveal: 5, dmg: { b: 180, l: 55, ap: 0.8 }, cc: { silence: 1.5 }, use: ['teamfight', 'execute'], fx: 'spirit', ult: true },
    ] },
  { id: 'hitotsume', clan: 'iron', pers: 'reckless', name: 'Hitotsume', title: 'Forge Eye', role: 'mid', flex: ['top'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    lore: 'A one-eyed smith who never blinks: not at the forge, not in a fight. Every Iron blade passed through his hands.',
    tags: ['burn', 'teamfight', 'poke'], builds: ['burn', 'burst', 'haste'],
    passive: { kind: 'burnAbilities', name: 'Molten', burn: { b: 5, l: 1.6, dur: 3 }, desc: 'Ability hits leave a molten burn.' },
    abilities: [
      { name: 'Forge Beam', icon: 'OrbFire', kind: 'line', range: 400, width: 40, cd: 6, dmg: { b: 75, l: 25, ap: 0.65 }, use: ['poke', 'clear'], fx: 'flame' },
      { name: 'Slag Pool', icon: 'BookFire', kind: 'zone', range: 420, radius: 130, dur: 3, cd: 12, dmg: { b: 28, l: 9, ap: 0.22 }, cc: { slow: [0.35, 0.5], shred: [0.15, 3] }, use: ['peel', 'clear', 'poke'], fx: 'circle_orange' },
      { name: 'Eye of the Forge', icon: 'Explosion', kind: 'line', range: 600, width: 90, cd: 70, dmg: { b: 200, l: 60, ap: 0.85 }, cc: { stun: 0.75 }, use: ['teamfight', 'poke'], fx: 'explosion', ult: true },
    ] },
  // bot
  { id: 'suzu', clan: 'hearth', pers: 'calm', name: 'Suzu', title: 'Crossbow Tinker', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'late',
    lore: 'Taro\'s twin. He makes things explode; she makes them hit exactly where she meant. Her crossbow has a name, and it is not polite.',
    tags: ['dps', 'siege', 'scaling'], builds: ['crit', 'siege', 'pierce'], proj: 'p_arrow',
    passive: { kind: 'repeater', name: 'Repeater', n: 4, pct: 0.6, desc: 'Every 4th basic attack fires a second bolt for 60% damage.' },
    abilities: [
      { name: 'Bolt Spread', icon: 'MagicWeapon', kind: 'shot', range: 420, speed: 950, width: 70, pierce: true, cd: 7, dmg: { b: 55, l: 20, ad: 0.8 }, use: ['poke', 'clear'], proj: 'p_arrow', fx: 'cut' },
      { name: 'Tune-up', icon: 'AttackUpgrade', kind: 'self', cd: 13, buff: { dur: 4, stats: { asPct: 0.35, range: 25 } }, use: ['engage'], fx: 'boost' },
      { name: 'Ballista', icon: 'Death', kind: 'line', range: 650, width: 60, cd: 60, dmg: { b: 230, l: 72, ad: 1.35 }, use: ['execute', 'teamfight'], fx: 'spark', ult: true },
    ] },
  { id: 'momo', clan: 'hearth', pers: 'cautious', name: 'Momo', title: 'Kite Fighter', role: 'bot', flex: ['support'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'She learned to fight with kites on the festival hill, cutting other children\'s strings. Now she cuts other things.',
    tags: ['poke', 'peel', 'cc'], builds: ['crit', 'haste', 'warden'], proj: 'p_magicstar',
    passive: { kind: 'kiteWind', name: 'Updraft', ms: 0.05, max: 3, dur: 2, desc: 'Basic attacks on heroes give +5% move speed for 2s, stacking 3 times.' },
    abilities: [
      { name: 'Kite String', icon: 'MagicWeapon', kind: 'shot', range: 450, speed: 900, width: 28, cd: 8, dmg: { b: 65, l: 20, ad: 0.8 }, cc: { slow: [0.35, 1.5] }, use: ['poke', 'peel'], proj: 'p_magicstar', fx: 'cut' },
      { name: 'Gust Hop', icon: 'BookWind', kind: 'dash', range: 240, cd: 11, buff: { dur: 2, stats: { asPct: 0.3 } }, use: ['escape'], fx: 'smoke' },
      { name: 'Dragon Kite', icon: 'BookWind', kind: 'shot', range: 650, speed: 700, width: 110, pierce: true, cd: 65, knockAway: 100, dmg: { b: 170, l: 55, ad: 1.0 }, cc: { slow: [0.3, 1.5] }, use: ['teamfight', 'peel'], proj: 'p_bigenergy', fx: 'wave', ult: true },
    ] },
  { id: 'komori', clan: 'shinobi', pers: 'greedy', name: 'Komori', title: 'Echo Archer', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    lore: 'Blind as a bat, and she still never misses. She hears your heartbeat from across the river.',
    tags: ['dps', 'sustain', 'pick'], builds: ['crit', 'sustain', 'burst'], proj: 'p_kunai',
    passive: { kind: 'spellVamp', name: 'Night Thirst', pct: 0.08, desc: '8% omnivamp.' },
    abilities: [
      { name: 'Sonic Bolt', icon: 'BookThunder', kind: 'shot', range: 450, speed: 1000, width: 30, cd: 7, dmg: { b: 70, l: 22, ad: 0.9 }, cc: { silence: 0.75 }, use: ['poke', 'clear', 'peel'], proj: 'p_energy', fx: 'spark' },
      { name: 'Echolocation', icon: 'Vision', kind: 'self', cd: 14, buff: { dur: 4, stats: { asPct: 0.35, msPct: 0.1 } }, use: ['engage'], fx: 'aura' },
      { name: 'Night Swarm', icon: 'BookDarkness', kind: 'zone', range: 500, radius: 200, dur: 4, cd: 65, dmg: { b: 55, l: 18, ad: 0.35 }, cc: { slow: [0.3, 0.5] }, use: ['teamfight'], fx: 'smoke', ult: true },
    ] },
  { id: 'tako', clan: 'wild', pers: 'hothead', name: 'Tako', title: 'Ink Cannon', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'early',
    lore: 'An octopus with eight arms and one opinion: shoot first. The Wild clan keeps him on the river bank, pointed outward.',
    tags: ['poke', 'cc', 'early'], builds: ['burst', 'crit', 'haste'], proj: 'p_bigenergy',
    passive: { kind: 'empowerCC', name: 'Ink Shot', cd: 7, dmg: { b: 15, l: 6, ad: 0.3 }, cc: { slow: [0.35, 1.5] }, desc: 'After casting, his next attack within 3s inks the target: bonus damage and a 35% slow. 7s cooldown.' },
    abilities: [
      { name: 'Ink Jet', icon: 'WaterCanon', kind: 'shot', range: 440, speed: 850, width: 36, cd: 6, dmg: { b: 75, l: 24, ad: 0.9 }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'water' },
      { name: 'Tentacle Slap', icon: 'OrbWater', kind: 'nova', radius: 150, cd: 11, knockAway: 110, dmg: { b: 50, l: 15, ad: 0.5 }, use: ['peel', 'escape'], fx: 'water' },
      { name: 'Ink Tide', icon: 'WaterCanon', kind: 'circle', range: 550, radius: 210, delay: 0.6, cd: 65, dmg: { b: 170, l: 50, ad: 0.95 }, cc: { root: 1.0, grievous: 4 }, use: ['teamfight'], fx: 'wave', ult: true },
    ] },
  // support
  { id: 'ume', clan: 'hearth', pers: 'cautious', name: 'Granny Ume', title: 'Plum Elder', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'late',
    lore: 'She has outlived two husbands, three wars and one dragon. She will outlive you too, dear, if you eat your plums.',
    tags: ['heal', 'peel', 'cc'], builds: ['guardian', 'haste', 'warden'],
    passive: { kind: 'hearthBrew', name: 'Plum Tonic', per: 0.03, desc: 'Her heals and shields gain another +3% per Hearthfire ember (on top of the clan bonus).' },
    abilities: [
      { name: 'Umeboshi', icon: 'Heal', kind: 'ally', range: 450, cd: 8, heal: { b: 65, l: 20, ap: 0.45 }, buff: { dur: 3, stats: { tenacity: 0.2 } }, use: ['sustain'], fx: 'spirit' },
      { name: 'Stern Look', icon: 'Mist', kind: 'target', range: 380, cd: 12, dmg: { b: 45, l: 14, ap: 0.35 }, cc: { fear: 1.0 }, use: ['peel', 'engage'], fx: 'spirit' },
      { name: 'Grandmother\'s Remedy', icon: 'BookPlant', kind: 'allynova', radius: 380, cd: 80, heal: { b: 120, l: 35, ap: 0.5 }, cleanse: true, use: ['teamfight', 'sustain'], fx: 'aura', ult: true },
    ] },
  { id: 'aki', clan: 'hearth', pers: 'loyal', name: 'Aki', title: 'Lantern Keeper', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'Keeper of the valley lantern, lit on the day the first house was built. It has never gone out, and she will not be the one who lets it.',
    tags: ['buff', 'shield', 'peel'], builds: ['guardian', 'warden', 'haste'],
    passive: { kind: 'lanternKeeper', name: 'Eternal Flame', desc: 'While Aki lives, Hearthfire never drops below 1 ember, and it can hold 6.' },
    abilities: [
      { name: 'Guiding Light', icon: 'OrbLight', kind: 'ally', range: 450, cd: 9, shield: { b: 80, l: 26, ap: 0.5, dur: 3 }, buff: { dur: 3, stats: { msPct: 0.2 } }, use: ['sustain', 'peel'], fx: 'shield_yellow' },
      { name: 'Flare', icon: 'Fireball', kind: 'circle', range: 420, radius: 120, delay: 0.4, cd: 11, reveal: 3, dmg: { b: 50, l: 16, ap: 0.45 }, cc: { slow: [0.35, 1.5] }, use: ['poke', 'peel', 'engage'], fx: 'holy' },
      { name: 'Festival of Lights', icon: 'Upgrade', kind: 'allynova', radius: 400, cd: 75, shield: { b: 110, l: 35, ap: 0.5, dur: 4 }, buff: { dur: 5, stats: { dmgPct: 0.1, msPct: 0.15 } }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },
  { id: 'bao', clan: 'beast', pers: 'calm', name: 'Bao', title: 'Bamboo Monk', role: 'support', flex: ['top'], cls: 'support', dmgType: 'magic', curve: 'mid',
    lore: 'Drinks tea, eats bamboo and flattens anyone who interrupts either. The Beast clan\'s only pacifist, technically.',
    tags: ['tank', 'engage', 'cc', 'peel'], builds: ['tank', 'warden', 'guardian'], range: 55,
    passive: { kind: 'tenacity', name: 'Unbothered', pct: 0.25, desc: '+25% tenacity: stuns, roots, fears and slows on him are shorter.' },
    abilities: [
      { name: 'Bamboo Bash', icon: 'Counter', kind: 'dash', range: 300, cd: 11, dmg: { b: 55, l: 16, ap: 0.35, hp: 0.03 }, cc: { stun: 0.75 }, use: ['engage', 'peel'], fx: 'impact' },
      { name: 'Tea Break', icon: 'Heal', kind: 'allynova', radius: 250, cd: 14, heal: { b: 50, l: 15, ap: 0.3, hp: 0.02 }, use: ['sustain'], fx: 'spirit' },
      { name: 'Belly Flop', icon: 'Explosion', kind: 'dash', range: 420, radius: 210, cd: 75, dmg: { b: 120, l: 40, ap: 0.4, hp: 0.04 }, cc: { knock: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'kinoko', clan: 'spirit', pers: 'loyal', name: 'Kinoko', title: 'Glowcap', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'late',
    lore: 'A forest mushroom that glows brighter whenever a friend is hurt. On a bad day the whole wood is lit.',
    tags: ['heal', 'sustain', 'peel'], builds: ['guardian', 'haste', 'warden'],
    passive: { kind: 'healAllies', name: 'Glow Spores', heal: { b: 9, l: 3, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Glowcap', icon: 'Heal', kind: 'ally', range: 450, cd: 8, heal: { b: 60, l: 19, ap: 0.42 }, buff: { dur: 3, stats: { regen: 8 } }, use: ['sustain'], fx: 'spirit' },
      { name: 'Sleepy Spores', icon: 'BookPlant', kind: 'circle', range: 420, radius: 110, delay: 0.5, cd: 13, dmg: { b: 35, l: 10, ap: 0.3 }, cc: { root: 1.0, slow: [0.4, 1.5] }, use: ['peel', 'engage'], fx: 'plant' },
      { name: 'Fairy Ring', icon: 'OrbPlant', kind: 'allynova', radius: 360, cd: 80, heal: { b: 100, l: 30, ap: 0.45 }, cleanse: true, buff: { dur: 4, stats: { tenacity: 0.3 } }, use: ['teamfight', 'sustain'], fx: 'plant', ult: true },
    ] },
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
// Range discipline: basic attacks use the class tiers; abilities are capped so nobody
// fights from off-screen (ults get a little more reach).
const CAP = { normal: 480, ult: 650, dash: 360, ultDash: 450 };
for (const h of HEROES) {
  for (const ab of h.abilities) {
    if (ab.range) ab.range = Math.min(ab.range, ab.kind === 'dash' ? (ab.ult ? CAP.ultDash : CAP.dash) : (ab.ult ? CAP.ult : CAP.normal));
  }
}
for (const h of HEROES) {
  h.base = { ...CLASS[h.cls] };
  if (h.range) h.base.range = h.range;
  h.ranged = h.base.range > 100;
  h.roles = [h.role, ...(h.flex || [])];
  h.rec = h.builds[0];
}

// Simple tag-based matchup heuristic shown in the draft and used by the AI drafter.
// Positive = `hero` is good into `enemies`.
export function matchupScore(hero, enemies) {
  let s = 0; const notes = [];
  const count = (t) => enemies.filter((e) => e.tags.includes(t)).length;
  const tanks = count('tank'), heals = count('heal') + count('sustain'), dives = count('dive'), burst = count('burst'), cc = count('cc');
  const squish = enemies.filter((e) => e.cls === 'marksman' || e.cls === 'mage').length;
  if (hero.tags.includes('burn') && (tanks + heals) > 0) { s += tanks + heals; notes.push('Burn shreds their tanks/healing'); }
  if (hero.tags.includes('antiheal') && heals > 0) { s += heals; notes.push('Anti-heal vs sustain'); }
  if (hero.tags.includes('burst') && squish >= 2 && tanks === 0) { s += 2; notes.push('Burst on a squishy comp'); }
  if (hero.tags.includes('burst') && tanks >= 2) { s -= 2; notes.push('Burst struggles vs tanks'); }
  if (hero.tags.includes('tank') && burst >= 2) { s += 2; notes.push('Tank soaks their burst'); }
  if (hero.tags.includes('peel') && dives >= 2) { s += 2; notes.push('Peel vs divers'); }
  if (hero.tags.includes('cc') && dives >= 2) { s += 1; notes.push('CC catches divers'); }
  if (hero.tags.includes('dive') && cc >= 3) { s -= 2; notes.push('Diving into heavy CC'); }
  if (hero.tags.includes('poke') && count('engage') === 0) { s += 1; notes.push('Free poke: no hard engage'); }
  if (hero.tags.includes('sustain') && count('burn') + count('antiheal') >= 2) { s -= 2; notes.push('Sustain countered by burn'); }
  return { score: s, notes };
}

// Personalities change how a hero plays and how they react to your calls.
export const PERSONALITIES = {
  reckless: { name: 'Reckless', color: '#ff7a5a', desc: 'Fights on thin odds. Breaks off calls late. Big plays, big throws.', mods: { aggro: 1.25, discipline: 0.85, dodge: 0.6, react: 7, greed: 1, peel: 0.8 }, trustGain: 1, delay: 1 },
  cautious: { name: 'Cautious', color: '#7fb4ff', desc: 'Only takes good fights. Dodges well. Slow to commit to risky calls.', mods: { aggro: 0.82, discipline: 1.15, dodge: 0.8, react: 5, greed: 0.9, peel: 1.1 }, trustGain: 1, delay: 1.3 },
  greedy: { name: 'Greedy', color: '#ffd84a', desc: 'Farms hard and stays out longer. Scales well, sometimes too greedy.', mods: { aggro: 0.95, discipline: 0.95, dodge: 0.7, react: 6, greed: 1.35, peel: 0.8 }, trustGain: 0.8, delay: 1.2 },
  loyal: { name: 'Loyal', color: '#6fdc8c', desc: 'Answers calls instantly and trusts you quickly.', mods: { aggro: 1, discipline: 1.1, dodge: 0.7, react: 6, greed: 1, peel: 1.2 }, trustGain: 1.5, delay: 0.4 },
  hothead: { name: 'Hothead', color: '#ff5a8a', desc: 'Tilts after dying (more aggressive, less trusting) but snowballs when ahead.', mods: { aggro: 1.12, discipline: 0.95, dodge: 0.65, react: 6, greed: 1, peel: 0.9 }, trustGain: 1, delay: 1, tilts: true },
  calm: { name: 'Calm', color: '#c7a7ff', desc: 'Reliable. Sharp reactions and steady under pressure.', mods: { aggro: 1, discipline: 1.05, dodge: 0.85, react: 4, greed: 1, peel: 1 }, trustGain: 1.1, delay: 0.8 },
};
