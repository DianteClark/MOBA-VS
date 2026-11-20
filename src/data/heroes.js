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
    tags: ['tank', 'cc', 'engage'], builds: ['tank', 'burn', 'haste'],
    passive: { kind: 'shieldOnHit', name: 'Bulwark', pct: 0.08, cd: 10, desc: 'Taking hero damage grants a shield (8% max HP). 10s cooldown.' },
    abilities: [
      { name: 'Shield Bash', icon: 'DefenseUpgrade', kind: 'dash', range: 220, cd: 11, dmg: { b: 60, l: 15, ad: 0.6, hp: 0.04 }, cc: { stun: 1.0 }, use: ['engage', 'peel'], fx: 'impact' },
      { name: 'Rally', icon: 'Upgrade', kind: 'nova', radius: 140, cd: 9, dmg: { b: 40, l: 10, hp: 0.03 }, cc: { slow: [0.3, 1.5] }, buff: { dur: 4, stats: { armor: 30, mr: 20 } }, use: ['clear', 'engage', 'defend'], fx: 'circle' },
      { name: 'Unbreakable Charge', icon: 'Counter', kind: 'dash', range: 380, radius: 160, cd: 70, dmg: { b: 150, l: 40, hp: 0.06 }, cc: { knock: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'kenshi', clan: 'iron', pers: 'calm', name: 'Kenshi', title: 'Wandering Blade', role: 'top', flex: ['mid'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    tags: ['dive', 'split', 'burst'], builds: ['burst', 'sustain', 'tank'],
    passive: { kind: 'every3', name: 'Way of the Sword', dmg: { b: 20, l: 6, ad: 0.4 }, desc: 'Every third attack deals bonus physical damage.' },
    abilities: [
      { name: 'Iaido', icon: 'Cut', kind: 'line', range: 260, width: 50, cd: 6, dmg: { b: 70, l: 20, ad: 1.0 }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Riposte', icon: 'Counter', kind: 'self', cd: 12, shield: { b: 80, l: 25, ad: 0.5, dur: 2 }, use: ['defend'], fx: 'shield' },
      { name: 'Thousand Cuts', icon: 'Death', kind: 'dash', range: 300, cd: 60, dmg: { b: 200, l: 60, ad: 1.2, miss: 0.2 }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'varro', clan: 'iron', pers: 'hothead', name: 'Varro', title: 'Arena Champion', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    tags: ['tank', 'split', 'sustain'], builds: ['sustain', 'tank', 'burn'],
    passive: { kind: 'lowhpRegen', name: 'Second Wind', pct: 0.026, desc: 'Below 35% HP, regenerates 2% max HP per second.' },
    abilities: [
      { name: 'Cleave', icon: 'Cut', kind: 'nova', radius: 160, cd: 6, dmg: { b: 75, l: 22, ad: 1.0 }, heal: { b: 40, l: 10, ad: 0.2 }, use: ['clear', 'engage'], fx: 'circular' },
      { name: 'Crippling Strike', icon: 'Downgrade', kind: 'target', range: 70, cd: 8, dmg: { b: 40, l: 10, ad: 0.5 }, cc: { slow: [0.4, 2] }, use: ['engage', 'poke'], fx: 'cut' },
      { name: 'Champion of the Arena', icon: 'AttackUpgrade', kind: 'self', cd: 80, heal: { hp: 0.15 }, buff: { dur: 6, stats: { power: 40, armor: 30, mr: 30 } }, use: ['teamfight', 'defend'], fx: 'boost', ult: true },
    ] },
  { id: 'brawlo', clan: 'beast', pers: 'reckless', name: 'Brawlo', title: 'Ringside Menace', role: 'top', flex: ['jungle'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    tags: ['dive', 'burst', 'early'], builds: ['burst', 'crit', 'sustain'],
    passive: { kind: 'every3', name: 'Combo', dmg: { b: 30, l: 9, ad: 0.6 }, desc: 'Every third punch lands a heavy hit.' },
    abilities: [
      { name: 'Jab Rush', icon: 'BookWind', kind: 'dash', range: 260, cd: 7, dmg: { b: 60, l: 18, ad: 0.8 }, use: ['engage', 'escape'], fx: 'impact' },
      { name: 'Counterpunch', icon: 'AttackUpgrade', kind: 'self', cd: 10, buff: { dur: 3, stats: { asPct: 0.5 } }, use: ['engage'], fx: 'aura' },
      { name: 'Knockout', icon: 'Explosion', kind: 'target', range: 70, cd: 55, dmg: { b: 180, l: 50, ad: 1.5 }, cc: { knock: 1.0 }, use: ['execute', 'engage'], fx: 'explosion', ult: true },
    ] },
  { id: 'grok', clan: 'beast', pers: 'cautious', name: 'Grok', title: 'Stoneback', role: 'top', flex: ['support'], cls: 'tank', dmgType: 'phys', curve: 'late',
    tags: ['tank', 'cc', 'peel'], builds: ['tank', 'haste', 'burn'],
    passive: { kind: 'dr', name: 'Thick Skull', pct: 0.06, desc: 'Takes 6% less damage from all sources.' },
    abilities: [
      { name: 'Boulder Toss', icon: 'BookRock', kind: 'shot', range: 330, speed: 600, width: 34, cd: 8, dmg: { b: 70, l: 20, ad: 0.5, hp: 0.03 }, cc: { slow: [0.3, 1.5] }, use: ['poke', 'engage', 'clear'], proj: 'p_cannon', fx: 'rock' },
      { name: 'Ground Pound', icon: 'RockSpike', kind: 'nova', radius: 170, cd: 12, dmg: { b: 50, l: 12, hp: 0.04 }, cc: { root: 1.0 }, use: ['engage', 'peel'], fx: 'rockspike' },
      { name: 'Stampede', icon: 'Counter', kind: 'dash', range: 420, radius: 180, cd: 85, dmg: { b: 120, l: 35, hp: 0.06 }, cc: { knock: 1.0 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },

  // ───────────── JUNGLE ─────────────
  { id: 'kaze', clan: 'shinobi', pers: 'reckless', name: 'Kaze', title: 'Leaf on the Wind', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'mid',
    tags: ['burst', 'dive', 'pick'], builds: ['burst', 'crit', 'haste'],
    passive: { kind: 'executer', name: 'Opportunist', pct: 0.12, desc: 'Deals 12% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Shuriken', icon: 'MagicWeapon', kind: 'shot', range: 350, speed: 900, width: 28, cd: 5, dmg: { b: 60, l: 20, ad: 0.8 }, use: ['poke', 'clear'], proj: 'p_shuriken', fx: 'cut' },
      { name: 'Shadow Step', icon: 'Camouflage', kind: 'dash', range: 300, cd: 10, dmg: { b: 40, l: 12, ad: 0.5 }, use: ['engage', 'escape'], fx: 'smoke' },
      { name: 'Death Mark', icon: 'Death', kind: 'target', range: 300, cd: 50, dmg: { b: 220, l: 70, ad: 1.6, miss: 0.25 }, use: ['execute'], fx: 'cutx', ult: true },
    ] },
  { id: 'leonin', clan: 'beast', pers: 'hothead', name: 'Leonin', title: 'Pride Hunter', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'early',
    tags: ['dive', 'sustain', 'early'], builds: ['sustain', 'tank', 'burst'],
    passive: { kind: 'spellVamp', name: 'Feast', pct: 0.12, desc: '12% omnivamp.' },
    abilities: [
      { name: 'Pounce', icon: 'BookWind', kind: 'dash', range: 300, cd: 8, dmg: { b: 60, l: 18, ad: 0.8 }, cc: { slow: [0.3, 1] }, use: ['engage'], fx: 'claw' },
      { name: 'Roar', icon: 'Mist', kind: 'nova', radius: 180, cd: 12, dmg: { b: 40, l: 12, ad: 0.5 }, cc: { slow: [0.4, 1.5] }, heal: { b: 40, l: 10 }, use: ['clear', 'peel', 'engage'], fx: 'circle' },
      { name: 'King of Beasts', icon: 'AttackUpgrade', kind: 'self', cd: 70, buff: { dur: 6, stats: { power: 40, asPct: 0.4, msPct: 0.2 } }, use: ['teamfight', 'engage'], fx: 'boost', ult: true },
    ] },
  { id: 'karasu', clan: 'spirit', pers: 'loyal', name: 'Karasu', title: 'Crow of the Peaks', role: 'jungle', flex: ['top'], cls: 'bruiser', dmgType: 'phys', curve: 'mid',
    tags: ['dive', 'cc', 'engage'], builds: ['burst', 'tank', 'haste'],
    passive: { kind: 'shieldOnHit', name: 'Feathered Mantle', pct: 0.07, cd: 12, desc: 'Taking hero damage grants a shield (7% max HP). 12s cooldown.' },
    abilities: [
      { name: 'Wing Slash', icon: 'Cut', kind: 'line', range: 250, width: 70, cd: 6, dmg: { b: 70, l: 20, ad: 0.9 }, use: ['poke', 'clear', 'engage'], fx: 'slash' },
      { name: 'Gale', icon: 'BookWind', kind: 'nova', radius: 150, cd: 13, dmg: { b: 45, l: 10, ad: 0.5 }, cc: { knock: 0.5 }, use: ['engage', 'peel'], fx: 'circle' },
      { name: 'Divine Wind', icon: 'OrbLight', kind: 'dash', range: 450, radius: 180, cd: 80, dmg: { b: 150, l: 40, ad: 0.8 }, cc: { knock: 0.8 }, use: ['teamfight', 'engage'], fx: 'smoke_ring', ult: true },
    ] },
  { id: 'umbra', clan: 'shinobi', pers: 'greedy', name: 'Umbra', title: 'The Unseen', role: 'jungle', flex: ['mid'], cls: 'assassin', dmgType: 'phys', curve: 'late',
    tags: ['burst', 'dive', 'scaling'], builds: ['burst', 'crit'],
    passive: { kind: 'msOutOfCombat', name: 'Shadowwalk', pct: 0.15, desc: '+15% move speed when out of combat.' },
    abilities: [
      { name: 'Kunai Fan', icon: 'MagicWeapon', kind: 'shot', range: 320, speed: 950, width: 60, pierce: true, cd: 5, dmg: { b: 70, l: 22, ad: 0.8 }, use: ['poke', 'clear'], proj: 'p_kunai', fx: 'cut' },
      { name: 'Smoke Veil', icon: 'Mist', kind: 'self', cd: 14, buff: { dur: 2, stats: { msPct: 0.4 } }, shield: { b: 60, l: 20, dur: 2 }, use: ['escape', 'defend'], fx: 'smoke' },
      { name: 'Assassinate', icon: 'Death', kind: 'dash', range: 450, cd: 55, dmg: { b: 230, l: 80, ad: 1.5, miss: 0.2 }, use: ['execute', 'engage'], fx: 'cutx', ult: true },
    ] },
  { id: 'gama', clan: 'beast', pers: 'cautious', name: 'Gama', title: 'Swamp King', role: 'jungle', flex: ['support'], cls: 'tank', dmgType: 'magic', curve: 'mid',
    tags: ['tank', 'cc', 'engage'], builds: ['tank', 'burn', 'haste'],
    passive: { kind: 'lowhpRegen', name: 'Amphibious', pct: 0.018, desc: 'Below 35% HP, regenerates 1.8% max HP per second.' },
    abilities: [
      { name: 'Tongue Lash', icon: 'BookPlant', kind: 'hook', range: 330, speed: 900, width: 36, cd: 12, dmg: { b: 60, l: 15, ap: 0.5 }, cc: { stun: 0.5 }, use: ['engage', 'peel'], proj: 'p_plant', fx: 'plant' },
      { name: 'Toxic Belly', icon: 'Alchemy', kind: 'nova', radius: 160, cd: 10, dmg: { b: 30, l: 8, hp: 0.01 }, burn: { b: 25, l: 7, dur: 3 }, cc: { slow: [0.2, 1.5] }, use: ['clear', 'engage'], fx: 'plant' },
      { name: 'Swallow', icon: 'Necromancy', kind: 'target', range: 120, cd: 70, dmg: { b: 150, l: 40, hp: 0.06 }, cc: { stun: 1.5 }, use: ['engage', 'peel', 'execute'], fx: 'water', ult: true },
    ] },

  // ───────────── MID ─────────────
  { id: 'ember', clan: 'wild', pers: 'hothead', name: 'Ember', title: 'Pyromancer', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    tags: ['burn', 'poke', 'antiheal'], builds: ['burn', 'burst', 'haste'],
    passive: { kind: 'burnAbilities', name: 'Kindling', burn: { b: 5, l: 2, dur: 3 }, desc: 'Ability hits set enemies ablaze.' },
    abilities: [
      { name: 'Fireball', icon: 'Fireball', kind: 'shot', range: 450, speed: 650, width: 30, cd: 5, dmg: { b: 70, l: 25, ap: 0.6 }, use: ['poke', 'clear'], proj: 'p_fireball', fx: 'explosion' },
      { name: 'Flame Pillar', icon: 'BookFire', kind: 'circle', range: 420, radius: 110, delay: 0.6, cd: 11, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { root: 0.75 }, use: ['engage', 'peel', 'clear'], fx: 'flame' },
      { name: 'Wildfire', icon: 'OrbFire', kind: 'circle', range: 450, radius: 170, delay: 0.3, cd: 70, dmg: { b: 140, l: 45, ap: 0.7 }, burn: { b: 20, l: 5, dur: 4 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'raiden', clan: 'shinobi', pers: 'calm', name: 'Raiden', title: 'Storm Caller', role: 'mid', flex: [], cls: 'mage', dmgType: 'magic', curve: 'mid',
    tags: ['burst', 'poke'], builds: ['burst', 'haste'],
    passive: { kind: 'every3', name: 'Overcharge', type: 'magic', dmg: { b: 30, l: 8, ap: 0.3 }, desc: 'Every third attack discharges bonus magic damage.' },
    abilities: [
      { name: 'Lightning Bolt', icon: 'BookThunder', kind: 'shot', range: 480, speed: 1000, width: 28, cd: 6, dmg: { b: 80, l: 30, ap: 0.75 }, use: ['poke', 'clear'], proj: 'p_energy', fx: 'thunder' },
      { name: 'Static Field', icon: 'Vision', kind: 'nova', radius: 180, cd: 10, dmg: { b: 50, l: 15, ap: 0.4 }, cc: { slow: [0.3, 1.5] }, use: ['clear', 'peel'], fx: 'thunder' },
      { name: 'Thunder God', icon: 'OrbLight', kind: 'circle', range: 500, radius: 150, delay: 0.4, cd: 60, dmg: { b: 250, l: 80, ap: 1.0 }, cc: { stun: 0.5 }, use: ['execute', 'teamfight'], fx: 'thunder', ult: true },
    ] },
  { id: 'totem', clan: 'spirit', pers: 'cautious', name: 'Totem', title: 'Spirit Speaker', role: 'mid', flex: ['support'], cls: 'mage', dmgType: 'magic', curve: 'late',
    tags: ['cc', 'poke', 'scaling'], builds: ['haste', 'burn', 'burst'],
    passive: { kind: 'every3', name: 'Ancestors', type: 'magic', dmg: { b: 20, l: 6, ap: 0.25 }, desc: 'Every third attack calls a spirit for bonus magic damage.' },
    abilities: [
      { name: 'Spirit Bolt', icon: 'OrbWater', kind: 'shot', range: 450, speed: 750, width: 30, cd: 6, dmg: { b: 65, l: 22, ap: 0.6 }, cc: { slow: [0.25, 1.5] }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'spirit' },
      { name: 'Root Snare', icon: 'BookPlant', kind: 'circle', range: 450, radius: 90, delay: 0.5, cd: 12, dmg: { b: 50, l: 15, ap: 0.4 }, cc: { root: 1.5 }, use: ['engage', 'peel'], fx: 'plant' },
      { name: 'Ancestral Storm', icon: 'BookWind', kind: 'zone', range: 450, radius: 220, dur: 4, cd: 75, dmg: { b: 50, l: 15, ap: 0.25 }, cc: { slow: [0.4, 0.5] }, use: ['teamfight'], fx: 'spirit', ult: true },
    ] },
  { id: 'sanguis', clan: 'spirit', pers: 'greedy', name: 'Sanguis', title: 'Crimson Count', role: 'mid', flex: ['top'], cls: 'mage', dmgType: 'magic', curve: 'late',
    tags: ['sustain', 'scaling', 'teamfight'], builds: ['sustain', 'burst', 'tank'],
    passive: { kind: 'spellVamp', name: 'Thirst', pct: 0.15, desc: '15% omnivamp.' },
    abilities: [
      { name: 'Blood Lance', icon: 'BookDeath', kind: 'target', range: 400, cd: 6, dmg: { b: 70, l: 25, ap: 0.6 }, heal: { b: 30, l: 10, ap: 0.25 }, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Mist Form', icon: 'Mist', kind: 'self', cd: 14, buff: { dur: 1.5, stats: { msPct: 0.3 } }, shield: { b: 80, l: 25, ap: 0.4, dur: 2 }, use: ['escape', 'defend'], fx: 'smoke' },
      { name: 'Hemoplague', icon: 'Necromancy', kind: 'circle', range: 450, radius: 220, delay: 1.0, cd: 70, dmg: { b: 200, l: 60, ap: 0.8 }, heal: { b: 100, l: 30 }, use: ['teamfight'], fx: 'explosion', ult: true },
    ] },
  { id: 'hex', clan: 'shinobi', pers: 'reckless', name: 'Hex', title: 'Night Weaver', role: 'mid', flex: ['jungle'], cls: 'mage', dmgType: 'magic', curve: 'mid',
    tags: ['burst', 'dive', 'pick'], builds: ['burst', 'haste'],
    passive: { kind: 'executer', name: 'Malice', pct: 0.12, desc: 'Deals 12% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Dark Orb', icon: 'OrbDarkness', kind: 'shot', range: 420, speed: 800, width: 30, cd: 5, dmg: { b: 85, l: 28, ap: 0.7 }, use: ['poke', 'clear'], proj: 'p_bigenergy', fx: 'spirit' },
      { name: 'Shadow Leap', icon: 'Camouflage', kind: 'dash', range: 340, cd: 10, dmg: { b: 70, l: 20, ap: 0.5 }, use: ['engage', 'escape'], fx: 'smoke' },
      { name: 'Annihilate', icon: 'BookDarkness', kind: 'target', range: 450, cd: 55, dmg: { b: 300, l: 90, ap: 1.2, miss: 0.18 }, use: ['execute'], fx: 'explosion', ult: true },
    ] },

  // ───────────── BOT ─────────────
  { id: 'fletch', clan: 'wild', pers: 'calm', name: 'Fletch', title: 'Greenwood Archer', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    tags: ['dps', 'scaling', 'poke'], builds: ['crit', 'sustain', 'haste'], proj: 'p_arrow',
    passive: { kind: 'every3', name: 'Quick Draw', dmg: { b: 15, l: 5, ad: 0.3 }, desc: 'Every third arrow deals bonus damage.' },
    abilities: [
      { name: 'Volley', icon: 'MagicWeapon', kind: 'shot', range: 450, speed: 900, width: 80, pierce: true, cd: 7, dmg: { b: 60, l: 20, ad: 0.8 }, cc: { slow: [0.2, 1] }, use: ['poke', 'clear'], proj: 'p_arrow', fx: 'cut' },
      { name: 'Focus', icon: 'AttackUpgrade', kind: 'self', cd: 12, buff: { dur: 4, stats: { asPct: 0.45 } }, use: ['engage'], fx: 'aura' },
      { name: 'Rain of Arrows', icon: 'BookWind', kind: 'circle', range: 550, radius: 200, delay: 0.5, cd: 60, dmg: { b: 150, l: 50, ad: 1.0 }, cc: { slow: [0.4, 2] }, use: ['teamfight'], fx: 'cut', ult: true },
    ] },
  { id: 'marlowe', clan: 'iron', pers: 'greedy', name: 'Marlowe', title: 'The Inspector', role: 'bot', flex: [], cls: 'marksman', dmgType: 'phys', curve: 'late',
    tags: ['crit', 'scaling', 'pick'], builds: ['crit', 'burst'], proj: 'p_kunai',
    passive: { kind: 'executer', name: 'Case Closed', pct: 0.10, desc: 'Deals 10% more damage to targets below 35% HP.' },
    abilities: [
      { name: 'Piercing Shot', icon: 'Cut', kind: 'line', range: 500, width: 40, cd: 7, dmg: { b: 70, l: 25, ad: 1.1 }, use: ['poke', 'clear'], fx: 'spark' },
      { name: 'Sidestep', icon: 'BookWind', kind: 'dash', range: 220, cd: 12, buff: { dur: 2, stats: { asPct: 0.3 } }, use: ['escape'], fx: 'smoke' },
      { name: 'Final Verdict', icon: 'Death', kind: 'shot', range: 800, speed: 1400, width: 40, cd: 60, dmg: { b: 250, l: 90, ad: 1.6 }, use: ['execute'], proj: 'p_bigkunai', fx: 'explosion', ult: true },
    ] },
  { id: 'shuri', clan: 'shinobi', pers: 'reckless', name: 'Shuri', title: 'Golden Star', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    tags: ['dps', 'burn', 'teamfight'], builds: ['crit', 'burn', 'sustain'], proj: 'p_shuriken',
    passive: { kind: 'burnHits', name: 'Venom Stars', burn: { b: 6, l: 2, dur: 2 }, desc: 'Basic attacks poison for 2s.' },
    abilities: [
      { name: 'Triple Star', icon: 'MagicWeapon', kind: 'shot', range: 400, speed: 900, width: 50, pierce: true, cd: 5, dmg: { b: 50, l: 18, ad: 0.7 }, use: ['poke', 'clear'], proj: 'p_shuriken', fx: 'cut' },
      { name: 'Swift Feet', icon: 'BookWind', kind: 'self', cd: 12, buff: { dur: 3, stats: { msPct: 0.3, asPct: 0.3 } }, use: ['escape', 'engage'], fx: 'aura' },
      { name: 'Shuriken Storm', icon: 'Explosion', kind: 'nova', radius: 260, cd: 55, dmg: { b: 150, l: 50, ad: 1.0 }, use: ['teamfight'], fx: 'circular', ult: true },
    ] },
  { id: 'bolt', clan: 'iron', pers: 'cautious', name: 'Bolt', title: 'Siege Unit', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'mid',
    tags: ['poke', 'siege'], builds: ['burst', 'crit', 'haste'], proj: 'p_cannon',
    passive: { kind: 'siege', name: 'Demolition', pct: 0.3, desc: 'Deals 30% bonus damage to structures.' },
    abilities: [
      { name: 'Cannon Shot', icon: 'Explosion', kind: 'circle', range: 600, radius: 100, delay: 0.7, cd: 7, dmg: { b: 80, l: 25, ad: 0.8 }, use: ['poke', 'clear'], fx: 'explosion' },
      { name: 'Rocket Jump', icon: 'BookWind', kind: 'dash', range: 260, cd: 14, use: ['escape'], fx: 'smoke_ring' },
      { name: 'Orbital Strike', icon: 'OrbFire', kind: 'circle', range: 900, radius: 200, delay: 1.0, cd: 70, dmg: { b: 220, l: 70, ad: 1.2 }, use: ['teamfight', 'execute'], fx: 'explosion', ult: true },
    ] },
  { id: 'sling', clan: 'wild', pers: 'hothead', name: 'Sling', title: 'Cave Sniper', role: 'bot', flex: ['mid'], cls: 'marksman', dmgType: 'phys', curve: 'early',
    tags: ['poke', 'early', 'cc'], builds: ['burst', 'sustain', 'crit'], proj: 'p_cannon',
    passive: { kind: 'every3', name: 'Heavy Stone', dmg: { b: 20, l: 6, ad: 0.4 }, desc: 'Every third stone hits harder.' },
    abilities: [
      { name: 'Rock Sling', icon: 'BookRock', kind: 'shot', range: 450, speed: 900, width: 30, cd: 5, dmg: { b: 82, l: 25, ad: 1.0 }, use: ['poke', 'clear'], proj: 'p_cannon', fx: 'rock' },
      { name: 'Pebble Trap', icon: 'RockSpike', kind: 'circle', range: 400, radius: 80, delay: 0.4, cd: 12, dmg: { b: 50, l: 14, ad: 0.4 }, cc: { root: 1.25 }, use: ['peel', 'engage'], fx: 'rockspike' },
      { name: 'Landslide', icon: 'Explosion', kind: 'shot', range: 550, speed: 800, width: 120, pierce: true, cd: 60, dmg: { b: 180, l: 50, ad: 1.0 }, cc: { knock: 0.75 }, use: ['teamfight', 'engage'], proj: 'p_cannon', fx: 'rockspike', ult: true },
    ] },

  // ───────────── SUPPORT ─────────────
  { id: 'oak', clan: 'spirit', pers: 'loyal', name: 'Brother Oak', title: 'Temple Healer', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    tags: ['heal', 'peel', 'sustain'], builds: ['guardian', 'haste', 'tank'],
    passive: { kind: 'healAllies', name: 'Blessed Hands', heal: { b: 10, l: 4, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Mending Palm', icon: 'Heal', kind: 'ally', range: 450, cd: 8, heal: { b: 60, l: 20, ap: 0.45 }, use: ['sustain'], fx: 'spirit' },
      { name: 'Chi Burst', icon: 'OrbLight', kind: 'nova', radius: 170, cd: 10, dmg: { b: 40, l: 12, ap: 0.4 }, cc: { slow: [0.3, 1.5] }, use: ['peel', 'clear'], fx: 'circle' },
      { name: 'Sanctuary', icon: 'BookLight', kind: 'allynova', radius: 320, cd: 85, heal: { b: 110, l: 30, ap: 0.5 }, use: ['teamfight', 'sustain'], fx: 'aura', ult: true },
    ] },
  { id: 'wu', clan: 'spirit', pers: 'calm', name: 'Sensei Wu', title: 'Old Master', role: 'support', flex: ['mid'], cls: 'support', dmgType: 'magic', curve: 'late',
    tags: ['shield', 'cc', 'peel'], builds: ['guardian', 'haste'],
    passive: { kind: 'every3', name: 'Discipline', type: 'magic', dmg: { b: 15, l: 5, ap: 0.2 }, desc: 'Every third strike deals bonus magic damage.' },
    abilities: [
      { name: 'Palm Strike', icon: 'Counter', kind: 'shot', range: 400, speed: 800, width: 34, cd: 9, dmg: { b: 70, l: 22, ap: 0.5 }, cc: { stun: 1.0 }, use: ['engage', 'peel'], proj: 'p_energy', fx: 'spark' },
      { name: 'Iron Ward', icon: 'DefenseUpgrade', kind: 'ally', range: 450, cd: 8, shield: { b: 100, l: 35, ap: 0.6, dur: 3 }, use: ['sustain', 'peel'], fx: 'shield_yellow' },
      { name: 'Inner Peace', icon: 'BookLight', kind: 'allynova', radius: 350, cd: 70, shield: { b: 150, l: 50, ap: 0.7, dur: 3 }, buff: { dur: 4, stats: { armor: 20, mr: 20 } }, use: ['teamfight'], fx: 'shield', ult: true },
    ] },
  { id: 'aurelia', clan: 'wild', pers: 'loyal', name: 'Aurelia', title: 'Sun Princess', role: 'support', flex: [], cls: 'support', dmgType: 'magic', curve: 'mid',
    tags: ['heal', 'buff', 'peel'], builds: ['guardian', 'haste', 'burst'],
    passive: { kind: 'healAllies', name: 'Radiance', heal: { b: 8, l: 4, ap: 0.1 }, desc: 'Basic attacks on heroes heal the lowest-HP nearby ally.' },
    abilities: [
      { name: 'Starlight', icon: 'OrbLight', kind: 'shot', range: 450, speed: 850, width: 34, cd: 11, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { root: 1.25 }, use: ['engage', 'peel'], proj: 'p_energy', fx: 'spark' },
      { name: 'Grace', icon: 'Heal', kind: 'ally', range: 450, cd: 10, heal: { b: 50, l: 15, ap: 0.3 }, buff: { dur: 3, stats: { msPct: 0.25, asPct: 0.2 } }, use: ['sustain', 'engage'], fx: 'spirit' },
      { name: 'Royal Decree', icon: 'Upgrade', kind: 'allynova', radius: 350, cd: 70, heal: { b: 80, l: 20 }, buff: { dur: 5, stats: { asPct: 0.4, power: 20 } }, use: ['teamfight'], fx: 'boost', ult: true },
    ] },
  { id: 'bonehook', clan: 'spirit', pers: 'reckless', name: 'Bonehook', title: 'Grave Fisher', role: 'support', flex: ['jungle'], cls: 'support', dmgType: 'magic', curve: 'early',
    tags: ['cc', 'engage', 'pick'], builds: ['tank', 'haste'], range: 55,
    passive: { kind: 'shieldOnHit', name: 'Bone Armor', pct: 0.08, cd: 12, desc: 'Taking hero damage grants a shield (8% max HP).' },
    abilities: [
      { name: 'Bone Hook', icon: 'Necromancy', kind: 'hook', range: 450, speed: 1000, width: 40, cd: 12, dmg: { b: 90, l: 30, ap: 0.5 }, cc: { stun: 0.75 }, use: ['engage'], proj: 'p_bigkunai', fx: 'cut' },
      { name: 'Grave Chill', icon: 'BookIce', kind: 'nova', radius: 170, cd: 10, dmg: { b: 40, l: 12, ap: 0.3 }, cc: { slow: [0.4, 2] }, use: ['peel', 'clear'], fx: 'ice' },
      { name: "Death's Embrace", icon: 'BookDeath', kind: 'circle', range: 400, radius: 220, delay: 0.5, cd: 75, dmg: { b: 120, l: 40, ap: 0.4 }, cc: { stun: 1.25 }, use: ['teamfight', 'engage'], fx: 'spirit', ult: true },
    ] },
  { id: 'frost', clan: 'wild', pers: 'loyal', name: 'Frost', title: 'Tundra Guard', role: 'support', flex: ['top'], cls: 'support', dmgType: 'magic', curve: 'mid',
    tags: ['cc', 'engage', 'tank'], builds: ['tank', 'haste'], range: 55,
    passive: { kind: 'dr', name: 'Permafrost', pct: 0.06, desc: 'Takes 6% less damage.' },
    abilities: [
      { name: 'Ice Shard', icon: 'BookIce', kind: 'shot', range: 420, speed: 850, width: 30, cd: 7, dmg: { b: 60, l: 20, ap: 0.5 }, cc: { slow: [0.4, 1.5] }, use: ['poke', 'peel'], proj: 'p_icespike', fx: 'ice' },
      { name: 'Glacial Charge', icon: 'BookWind', kind: 'dash', range: 300, cd: 13, dmg: { b: 50, l: 15, ap: 0.3 }, cc: { knock: 0.75 }, use: ['engage'], fx: 'ice' },
      { name: 'Absolute Zero', icon: 'BookIce', kind: 'nova', radius: 280, cd: 75, dmg: { b: 150, l: 40, ap: 0.5 }, cc: { stun: 1.25 }, use: ['teamfight', 'engage'], fx: 'ice', ult: true },
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
