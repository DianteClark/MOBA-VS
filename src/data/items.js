// Build paths. "power" is adaptive: it adds AD to physical heroes and AP to magic heroes.
// Stats: power, powerMult, hp, armor, mr, asPct, crit, critDmg, pen (% armor+MR pen), haste,
//        msPct, range, omnivamp, burn {b,l,dur} (on ability + basic hits), antiheal,
//        thorns (% of basic dmg taken reflected), healPower, execute, slowOnHit, regen, hpPct,
//        lowHpShield (shield as % max HP once per 60s), shredAura,
//        sunder (armor+MR shred per hero hit, stacks, 3s), tankBuster (% target max HP on hit),
//        siegePct (structure dmg), waveClear (dmg to minions/monsters), lone (armor+MR with no ally near),
//        spellblade (after a cast, next attack deals x AD/AP bonus), sbSlow, guard (shield a low ally
//        nearby for x of own max HP, 18s cd), sight (vision radius %), peelSlow (slow enemies who just
//        hit an ally), tenacity (shorter CC)
// Guide text per build: desc, goodAt, weakTo, bestOn (shown in the Build Guide).

export const BUILDS = {
  burst: {
    name: 'Burst', icon: 'Explosion', color: '#ff6b5a',
    desc: 'High damage + penetration. Deletes squishy targets, falls off vs tanks.',
    goodAt: 'Picking off squishy mages and marksmen', weakTo: 'Tanks, shields and long fights', bestOn: 'Assassins and burst mages',
    items: [
      { name: 'Ambush Dirk', cost: 1100, icon: 'Cut', stats: { power: 25, pen: 0.08 } },
      { name: "Executioner's Edge", cost: 2800, icon: 'Death', stats: { power: 45, pen: 0.1, execute: 0.15 } },
      { name: 'Shadowfang', cost: 2900, icon: 'BookDarkness', stats: { power: 50, haste: 20 } },
      { name: 'Void Lens', cost: 3000, icon: 'OrbDarkness', stats: { power: 55, pen: 0.15 } },
      { name: 'Deathcap', cost: 3400, icon: 'OrbFire', stats: { power: 40, powerMult: 0.2 } },
    ],
  },
  burn: {
    name: 'Burn', icon: 'BookFire', color: '#ff9a3c',
    desc: 'Damage over time that scales with HP and cuts healing. Melts tanks and sustain.',
    goodAt: 'Tanks, healers and lifesteal', weakTo: 'Burst that kills before the burn ticks', bestOn: 'Mages and bruisers with spammable spells',
    items: [
      { name: 'Ember Charm', cost: 1000, icon: 'Fireball', stats: { power: 20, burn: { b: 10, l: 3, hp: 0.008, dur: 3 } } },
      { name: 'Torment Veil', cost: 2900, icon: 'BookFire', stats: { power: 40, hp: 200, burn: { b: 10, l: 3, hp: 0.012, dur: 3 } } },
      { name: 'Rift Brand', cost: 2800, icon: 'OrbFire', stats: { power: 35, hp: 250, antiheal: 0.4 } },
      { name: 'Blackfire Torch', cost: 2800, icon: 'Alchemy', stats: { power: 45, haste: 15, burn: { b: 10, l: 2, hp: 0.008, dur: 3 } } },
      { name: 'Cinder Plate', cost: 2900, icon: 'DefenseUpgrade', stats: { hp: 350, armor: 35, mr: 25, burnAura: 0.01 } },
    ],
  },
  tank: {
    name: 'Tank', icon: 'DefenseUpgrade', color: '#7fb4ff',
    desc: 'HP and resistances. Absorbs burst, punishes auto-attackers with thorns.',
    goodAt: 'Soaking burst, frontlining, auto-attackers', weakTo: 'Armor shred, % HP damage, burn', bestOn: 'Tanks and engage supports',
    items: [
      { name: 'Ruby Heart', cost: 900, icon: 'Heal', stats: { hp: 250 } },
      { name: 'Thornmail', cost: 2700, icon: 'Counter', stats: { hp: 200, armor: 60, thorns: 0.25 } },
      { name: "Warden's Cowl", cost: 2800, icon: 'Mist', stats: { hp: 300, mr: 60, haste: 10 } },
      { name: 'Titan Plate', cost: 3000, icon: 'Upgrade', stats: { hp: 550, regen: 6, hpPct: 0.06 } },
      { name: 'Unyielding Aegis', cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 300, armor: 40, mr: 40, lowHpShield: 0.2 } },
    ],
  },
  sustain: {
    name: 'Sustain', icon: 'Heal', color: '#6fdc8c',
    desc: 'Lifesteal and survivability. Wins long fights and lanes; weak to burn/anti-heal.',
    goodAt: 'Long lanes, poke, extended fights', weakTo: 'Burn and anti-heal', bestOn: 'Bruisers and drain mages',
    items: [
      { name: 'Vampiric Fang', cost: 1100, icon: 'BookDeath', stats: { power: 20, omnivamp: 0.08 } },
      { name: 'Bloodthirster', cost: 3000, icon: 'Necromancy', stats: { power: 50, omnivamp: 0.1 } },
      { name: "Sterak's Gage", cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 400, lowHpShield: 0.25 } },
      { name: 'Spirit Visage', cost: 2800, icon: 'Heal', stats: { hp: 300, mr: 50, healPower: 0.25, haste: 10 } },
      { name: "Death's Dance", cost: 3100, icon: 'Counter', stats: { power: 45, armor: 40, haste: 15 } },
    ],
  },
  crit: {
    name: 'Crit', icon: 'AttackUpgrade', color: '#ffd84a',
    desc: 'Attack speed and critical strikes. Scales into the strongest late game DPS.',
    goodAt: 'Late-game damage per second', weakTo: 'Early aggression and dive', bestOn: 'Marksmen and attack-speed fighters',
    items: [
      { name: 'Swift Dagger', cost: 1000, icon: 'Cut', stats: { asPct: 0.3 } },
      { name: 'Infinity Edge', cost: 3400, icon: 'MagicWeapon', stats: { power: 60, crit: 0.25, critDmg: 0.35 } },
      { name: 'Phantom Dancer', cost: 2700, icon: 'BookWind', stats: { asPct: 0.4, crit: 0.25, msPct: 0.07 } },
      { name: "Lord's Reminder", cost: 3000, icon: 'Death', stats: { power: 35, crit: 0.25, pen: 0.3 } },
      { name: 'Rapid Cannon', cost: 2700, icon: 'Explosion', stats: { asPct: 0.35, crit: 0.25, range: 30 } },
    ],
  },
  haste: {
    name: 'Haste', icon: 'BookWind', color: '#b48cff',
    desc: 'Ability haste and utility. More spells, more crowd control, more often.',
    goodAt: 'Spamming crowd control and spells', weakTo: 'Hard burst on its user', bestOn: 'Control mages and utility supports',
    items: [
      { name: 'Kindlegem', cost: 900, icon: 'OrbLight', stats: { hp: 200, haste: 10 } },
      { name: 'Lucid Crown', cost: 2800, icon: 'BookLight', stats: { power: 45, haste: 25 } },
      { name: 'Frozen Heart', cost: 2700, icon: 'BookIce', stats: { armor: 60, haste: 20, shredAura: 0.15 } },
      { name: "Rylai's Scepter", cost: 2600, icon: 'BookIce', stats: { power: 40, hp: 300, slowOnHit: 0.2 } },
      { name: 'Cosmic Edge', cost: 3000, icon: 'Permutation', stats: { power: 55, haste: 20, msPct: 0.05 } },
    ],
  },
  guardian: {
    name: 'Guardian', icon: 'Heal', color: '#5fe0d0',
    desc: 'Heal and shield power with team auras. Makes your carries unkillable.',
    goodAt: 'Keeping a fed carry alive', weakTo: 'Anti-heal and diving past the support', bestOn: 'Healers and shield supports',
    items: [
      { name: 'Spellthief Charm', cost: 500, icon: 'LuckUpgrade', stats: { power: 10, haste: 5, regen: 2 } },
      { name: 'Moonstone', cost: 2400, icon: 'OrbWater', stats: { power: 30, hp: 200, healPower: 0.15, haste: 15 } },
      { name: 'Ardent Censer', cost: 2300, icon: 'OrbFire', stats: { power: 30, healPower: 0.12, censer: 0.2 } },
      { name: 'Locket', cost: 2500, icon: 'DefenseUpgrade', stats: { hp: 300, armor: 30, mr: 30, haste: 10 } },
      { name: 'Redemption', cost: 2400, icon: 'Heal', stats: { hp: 250, healPower: 0.2, haste: 15 } },
    ],
  },
  pierce: {
    name: 'Pierce', icon: 'Downgrade', color: '#e4e8f2',
    desc: 'Armor shred and % max HP hits. Cracks open tanks and bruisers.',
    goodAt: 'Killing tanks and stacked armor', weakTo: 'Kiting and poke (needs repeated hits)', bestOn: 'Bruisers and marksmen who hit often',
    items: [
      { name: 'Rending Hook', cost: 1100, icon: 'Cut', stats: { power: 20, sunder: 0.04 } },
      { name: 'Black Cleaver', cost: 3000, icon: 'Downgrade', stats: { power: 40, hp: 250, sunder: 0.04, haste: 10 } },
      { name: 'Giant Slayer', cost: 2900, icon: 'Death', stats: { power: 35, tankBuster: 0.025 } },
      { name: "Sunder's Edge", cost: 3000, icon: 'MagicWeapon', stats: { power: 40, pen: 0.15, crit: 0.15 } },
      { name: 'Titan Breaker', cost: 3100, icon: 'RockSpike', stats: { power: 45, hp: 200, tankBuster: 0.015, slowOnHit: 0.12 } },
    ],
  },
  siege: {
    name: 'Siege', icon: 'RockSpike', color: '#c8955a',
    desc: 'Structure damage, wave clear and toughness when alone. Built to split-push.',
    goodAt: 'Split-pushing, taking towers, clearing waves', weakTo: 'Being caught by a group (low fight damage)', bestOn: 'Duelists and long-range pushers',
    items: [
      { name: 'Ram Horn', cost: 1000, icon: 'RockSpike', stats: { power: 20, siegePct: 0.2, waveClear: 0.25 } },
      { name: 'Hullbreaker', cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 350, power: 25, siegePct: 0.2, lone: 35 } },
      { name: 'Stormrazor', cost: 2800, icon: 'BookThunder', stats: { power: 40, asPct: 0.2, waveClear: 0.3 } },
      { name: 'Tower Breaker', cost: 2900, icon: 'Explosion', stats: { power: 40, siegePct: 0.3, msPct: 0.05 } },
      { name: 'War Banner', cost: 2700, icon: 'Upgrade', stats: { hp: 250, power: 30, siegePct: 0.2, haste: 10 } },
    ],
  },
  spellblade: {
    name: 'Spellblade', icon: 'MagicWeapon', color: '#ff7ad9',
    desc: 'Ability haste. Every spell charges the next attack with bonus damage.',
    goodAt: 'Weaving spells and attacks in skirmishes', weakTo: 'Silence and kiting (needs to stay in reach)', bestOn: 'Fighters with short cooldowns',
    items: [
      { name: 'Sheen Charm', cost: 1000, icon: 'OrbLight', stats: { haste: 10, spellblade: 0.5 } },
      { name: 'Trinity Edge', cost: 3200, icon: 'MagicWeapon', stats: { power: 35, asPct: 0.2, haste: 20, spellblade: 0.4, msPct: 0.04 } },
      { name: 'Lich Tome', cost: 3000, icon: 'BookDarkness', stats: { power: 55, haste: 15, spellblade: 0.4 } },
      { name: 'Iceborn Gauntlet', cost: 2900, icon: 'BookIce', stats: { hp: 250, armor: 40, haste: 15, spellblade: 0.3, sbSlow: 0.3 } },
      { name: 'Essence Reaver', cost: 2900, icon: 'Permutation', stats: { power: 45, haste: 20, crit: 0.2 } },
    ],
  },
  warden: {
    name: 'Warden', icon: 'Vision', color: '#a8f06a',
    desc: 'Vision, bodyguard shields and slows on whoever hits your team.',
    goodAt: 'Protecting carries from dive, map vision', weakTo: 'Poke and split-push (needs allies nearby)', bestOn: 'Tanks and engage supports',
    items: [
      { name: 'Watch Lantern', cost: 700, icon: 'Vision', stats: { hp: 150, regen: 2, sight: 0.15 } },
      { name: 'Bodyguard Charm', cost: 2500, icon: 'DefenseUpgrade', stats: { hp: 300, armor: 30, guard: 0.1 } },
      { name: "Knight's Vow", cost: 2600, icon: 'Counter', stats: { hp: 300, mr: 40, haste: 10, peelSlow: 0.3 } },
      { name: 'Seer Stone', cost: 2400, icon: 'OrbLight', stats: { power: 20, hp: 250, haste: 15, sight: 0.1, tenacity: 0.15 } },
      { name: 'Gargoyle Plate', cost: 2900, icon: 'Upgrade', stats: { hp: 400, armor: 30, mr: 30, guard: 0.06 } },
    ],
  },
};

export const BUILD_ORDER = ['burst', 'burn', 'tank', 'sustain', 'crit', 'haste', 'guardian', 'pierce', 'siege', 'spellblade', 'warden'];
