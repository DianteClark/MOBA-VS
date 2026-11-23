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
// v26 stats (src/sim/builds2.js): rage (up to x more damage at 0 HP, scales with missing HP), kheal (heal x max HP
//        on takedown), spellShield (block x of the first enemy ability hit every 10s), reflect (x of hero ability
//        damage taken is reflected), roam (move speed out of combat), reset (takedown: x of current cooldowns
//        refunded), chill (abilities slow heroes hit by x for 2s), frostbite (+x damage to slowed heroes), venom
//        (poison dps per stack, 5 stacks), bulwark (allies near take x less damage), glory (power per Glory stack
//        from takedowns, max 6), stalk (first hit from out of enemy sight deals +x; faster while unseen)
// Guide text per build: desc, goodAt, weakTo, bestOn (shown in the Build Guide).

export const BUILDS = {
  burst: {
    name: 'Burst', icon: 'Explosion', color: '#ff6b5a',
    desc: 'High damage + penetration. Deletes squishy targets, falls off vs tanks.',
    goodAt: 'Picking off squishy mages and marksmen', weakTo: 'Tanks, shields and long fights', bestOn: 'Assassins and burst mages',
    items: [
      { name: 'Ambush Dirk', cost: 1100, icon: 'Cut', stats: { power: 30, pen: 0.1 } },
      { name: "Executioner's Edge", cost: 2800, icon: 'Death', stats: { power: 50, pen: 0.1, execute: 0.15 } },
      { name: 'Shadowfang', cost: 2900, icon: 'BookDarkness', stats: { power: 55, haste: 20 } },
      { name: 'Void Lens', cost: 3000, icon: 'OrbDarkness', stats: { power: 63, pen: 0.15 } },
      { name: 'Deathcap', cost: 3400, icon: 'OrbFire', stats: { power: 45, powerMult: 0.22 } },
    ],
  },
  burn: {
    name: 'Burn', icon: 'BookFire', color: '#ff9a3c',
    desc: 'Damage over time that scales with HP and cuts healing. Melts tanks and sustain.',
    goodAt: 'Tanks, healers and lifesteal', weakTo: 'Burst that kills before the burn ticks', bestOn: 'Mages and bruisers with spammable spells',
    items: [
      { name: 'Ember Charm', cost: 1000, icon: 'Fireball', stats: { power: 18, burn: { b: 10, l: 3, hp: 0.007, dur: 3 } } },
      { name: 'Torment Veil', cost: 2900, icon: 'BookFire', stats: { power: 34, hp: 200, burn: { b: 10, l: 3, hp: 0.009, dur: 3 } } },
      { name: 'Rift Brand', cost: 2800, icon: 'OrbFire', stats: { power: 32, hp: 250, antiheal: 0.4 } },
      { name: 'Blackfire Torch', cost: 2800, icon: 'Alchemy', stats: { power: 40, haste: 15, burn: { b: 10, l: 2, hp: 0.008, dur: 3 } } },
      { name: 'Cinder Plate', cost: 2900, icon: 'DefenseUpgrade', stats: { hp: 350, armor: 35, mr: 25, burnAura: 0.008 } },
    ],
  },
  tank: {
    name: 'Tank', icon: 'DefenseUpgrade', color: '#7fb4ff',
    desc: 'HP and resistances. Absorbs burst, punishes auto-attackers with thorns.',
    goodAt: 'Soaking burst, frontlining, auto-attackers', weakTo: 'Armor shred, % HP damage, burn', bestOn: 'Tanks and engage supports',
    items: [
      { name: 'Ruby Heart', cost: 900, icon: 'Heal', stats: { hp: 250 } },
      { name: 'Thornmail', cost: 2700, icon: 'Counter', stats: { hp: 200, armor: 55, thorns: 0.2 } },
      { name: "Warden's Cowl", cost: 2800, icon: 'Mist', stats: { hp: 300, mr: 60, haste: 10 } },
      { name: 'Titan Plate', cost: 3000, icon: 'Upgrade', stats: { hp: 480, regen: 6, hpPct: 0.05 } },
      { name: 'Unyielding Aegis', cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 260, armor: 35, mr: 35, lowHpShield: 0.18 } },
    ],
  },
  sustain: {
    name: 'Sustain', icon: 'Heal', color: '#6fdc8c',
    desc: 'Lifesteal and survivability. Wins long fights and lanes; weak to burn/anti-heal.',
    goodAt: 'Long lanes, poke, extended fights', weakTo: 'Burn and anti-heal', bestOn: 'Bruisers and drain mages',
    items: [
      { name: 'Vampiric Fang', cost: 1100, icon: 'BookDeath', stats: { power: 24, omnivamp: 0.12 } },
      { name: 'Bloodthirster', cost: 3000, icon: 'Necromancy', stats: { power: 60, omnivamp: 0.12 } },
      { name: "Sterak's Gage", cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 450, lowHpShield: 0.3 } },
      { name: 'Spirit Visage', cost: 2800, icon: 'Heal', stats: { hp: 300, mr: 50, healPower: 0.25, haste: 10 } },
      { name: "Death's Dance", cost: 3100, icon: 'Counter', stats: { power: 50, armor: 40, haste: 15 } },
    ],
  },
  crit: {
    name: 'Crit', icon: 'AttackUpgrade', color: '#ffd84a',
    desc: 'Attack speed and critical strikes. Scales into the strongest late game DPS.',
    goodAt: 'Late-game damage per second', weakTo: 'Early aggression and dive', bestOn: 'Marksmen and attack-speed fighters',
    items: [
      { name: 'Swift Dagger', cost: 1000, icon: 'Cut', stats: { asPct: 0.35 } },
      { name: 'Infinity Edge', cost: 3400, icon: 'MagicWeapon', stats: { power: 65, crit: 0.25, critDmg: 0.45 } },
      { name: 'Phantom Dancer', cost: 2700, icon: 'BookWind', stats: { asPct: 0.45, crit: 0.25, msPct: 0.07 } },
      { name: "Lord's Reminder", cost: 3000, icon: 'Death', stats: { power: 44, crit: 0.25, pen: 0.3 } },
      { name: 'Rapid Cannon', cost: 2700, icon: 'Explosion', stats: { asPct: 0.4, crit: 0.25, range: 30 } },
    ],
  },
  haste: {
    name: 'Haste', icon: 'BookWind', color: '#b48cff',
    desc: 'Ability haste and utility. More spells, more crowd control, more often.',
    goodAt: 'Spamming crowd control and spells', weakTo: 'Hard burst on its user', bestOn: 'Control mages and utility supports',
    items: [
      { name: 'Kindlegem', cost: 900, icon: 'OrbLight', stats: { hp: 200, haste: 10 } },
      { name: 'Lucid Crown', cost: 2800, icon: 'BookLight', stats: { power: 42, haste: 25 } },
      { name: 'Frozen Heart', cost: 2700, icon: 'BookIce', stats: { armor: 60, haste: 20, shredAura: 0.15 } },
      { name: "Rylai's Scepter", cost: 2600, icon: 'BookIce', stats: { power: 40, hp: 300, slowOnHit: 0.2 } },
      { name: 'Cosmic Edge', cost: 3000, icon: 'Permutation', stats: { power: 50, haste: 20, msPct: 0.05 } },
    ],
  },
  guardian: {
    name: 'Guardian', icon: 'Heal', color: '#5fe0d0',
    desc: 'Heal and shield power with team auras. Makes your carries unkillable.',
    goodAt: 'Keeping a fed carry alive', weakTo: 'Anti-heal and diving past the support', bestOn: 'Healers and shield supports',
    items: [
      { name: 'Spellthief Charm', cost: 500, icon: 'LuckUpgrade', stats: { power: 10, haste: 5, regen: 2 } },
      { name: 'Moonstone', cost: 2400, icon: 'OrbWater', stats: { power: 30, hp: 200, healPower: 0.1, haste: 15 } },
      { name: 'Ardent Censer', cost: 2300, icon: 'OrbFire', stats: { power: 30, healPower: 0.12, censer: 0.15 } },
      { name: 'Locket', cost: 2500, icon: 'DefenseUpgrade', stats: { hp: 300, armor: 25, mr: 25, haste: 10 } },
      { name: 'Redemption', cost: 2400, icon: 'Heal', stats: { hp: 250, healPower: 0.15, haste: 15 } },
    ],
  },
  pierce: {
    name: 'Pierce', icon: 'Downgrade', color: '#e4e8f2',
    desc: 'Armor shred and % max HP hits. Cracks open tanks and bruisers.',
    goodAt: 'Killing tanks and stacked armor', weakTo: 'Kiting and poke (needs repeated hits)', bestOn: 'Bruisers and marksmen who hit often',
    items: [
      { name: 'Rending Hook', cost: 1100, icon: 'Cut', stats: { power: 28, sunder: 0.04 } },
      { name: 'Black Cleaver', cost: 3000, icon: 'Downgrade', stats: { power: 40, hp: 250, sunder: 0.04, haste: 10 } },
      { name: 'Giant Slayer', cost: 2900, icon: 'Death', stats: { power: 45, tankBuster: 0.03 } },
      { name: "Sunder's Edge", cost: 3000, icon: 'MagicWeapon', stats: { power: 40, pen: 0.15, crit: 0.15 } },
      { name: 'Titan Breaker', cost: 3100, icon: 'RockSpike', stats: { power: 45, hp: 200, tankBuster: 0.015, slowOnHit: 0.12 } },
    ],
  },
  siege: {
    name: 'Siege', icon: 'RockSpike', color: '#c8955a',
    desc: 'Structure damage, wave clear and toughness when alone. Built to split-push.',
    goodAt: 'Split-pushing, taking towers, clearing waves', weakTo: 'Being caught by a group (low fight damage)', bestOn: 'Duelists and long-range pushers',
    items: [
      { name: 'Ram Horn', cost: 1000, icon: 'RockSpike', stats: { power: 20, siegePct: 0.2, waveClear: 0.15 } },
      { name: 'Hullbreaker', cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 350, power: 28, siegePct: 0.2, lone: 40 } },
      { name: 'Stormrazor', cost: 2800, icon: 'BookThunder', stats: { power: 35, asPct: 0.2, waveClear: 0.2 } },
      { name: 'Tower Breaker', cost: 2900, icon: 'Explosion', stats: { power: 40, siegePct: 0.3, msPct: 0.05 } },
      { name: 'War Banner', cost: 2700, icon: 'Upgrade', stats: { hp: 250, power: 30, siegePct: 0.2, haste: 10 } },
    ],
  },
  spellblade: {
    name: 'Spellblade', icon: 'MagicWeapon', color: '#ff7ad9',
    desc: 'Ability haste. Every spell charges the next attack with bonus damage.',
    goodAt: 'Weaving spells and attacks in skirmishes', weakTo: 'Silence and kiting (needs to stay in reach)', bestOn: 'Fighters with short cooldowns',
    items: [
      { name: 'Sheen Charm', cost: 1000, icon: 'OrbLight', stats: { power: 10, haste: 10, spellblade: 0.6 } },
      { name: 'Trinity Edge', cost: 3200, icon: 'MagicWeapon', stats: { power: 40, asPct: 0.2, haste: 20, spellblade: 0.35, msPct: 0.04 } },
      { name: 'Lich Tome', cost: 3000, icon: 'BookDarkness', stats: { power: 55, haste: 15, spellblade: 0.5 } },
      { name: 'Iceborn Gauntlet', cost: 2900, icon: 'BookIce', stats: { hp: 250, armor: 40, haste: 15, spellblade: 0.3, sbSlow: 0.3 } },
      { name: 'Essence Reaver', cost: 2900, icon: 'Permutation', stats: { power: 45, haste: 20, crit: 0.2 } },
    ],
  },
  warden: {
    name: 'Warden', icon: 'Vision', color: '#a8f06a',
    desc: 'Vision, bodyguard shields and slows on whoever hits your team.',
    goodAt: 'Protecting carries from dive, map vision', weakTo: 'Poke and split-push (needs allies nearby)', bestOn: 'Tanks and engage supports',
    items: [
      { name: 'Watch Lantern', cost: 700, icon: 'Vision', stats: { power: 12, hp: 300, armor: 8, mr: 8, regen: 3, sight: 0.15 } },
      { name: 'Bodyguard Charm', cost: 2500, icon: 'DefenseUpgrade', stats: { power: 20, hp: 300, armor: 30, mr: 20, guard: 0.16 } },
      { name: "Knight's Vow", cost: 2600, icon: 'Counter', stats: { power: 20, hp: 300, armor: 20, mr: 40, haste: 10, peelSlow: 0.35 } },
      { name: 'Seer Stone', cost: 2400, icon: 'OrbLight', stats: { power: 38, hp: 300, haste: 15, sight: 0.1, tenacity: 0.15, healPower: 0.1 } },
      { name: 'Gargoyle Plate', cost: 2900, icon: 'Upgrade', stats: { power: 20, hp: 450, armor: 35, mr: 35, guard: 0.1 } },
    ],
  },
  // ── v26 build types (mechanics: src/sim/builds2.js) ──
  bloodline: {
    name: 'Bloodline', icon: 'Necromancy', color: '#ff3f6a',
    desc: 'Hits harder the more HP it has lost, and heals on every takedown. A brawler who wins ugly fights.',
    goodAt: 'Duels and messy brawls (stronger when hurt)', weakTo: 'Burst, hard CC and anti-heal', bestOn: 'Bruisers and melee carries',
    items: [
      { name: 'Blood Charm', cost: 1000, icon: 'Necromancy', stats: { power: 18, hp: 100, rage: 0.1 } },
      { name: 'Crimson Axe', cost: 2900, icon: 'Cut', stats: { power: 45, asPct: 0.15, rage: 0.15 } },
      { name: 'Bloodline Mail', cost: 2800, icon: 'Armor', stats: { hp: 350, armor: 30, kheal: 0.12 } },
      { name: 'Red Moon Blade', cost: 3000, icon: 'MagicWeapon', stats: { power: 50, rage: 0.15, kheal: 0.06 } },
      { name: 'Last Breath', cost: 2900, icon: 'Heal', stats: { power: 25, hp: 300, mr: 35, lowHpShield: 0.15 } },
    ],
  },
  spellshield: {
    name: 'Spellshield', icon: 'Amulet', color: '#62c6ff',
    desc: 'A spell barrier that blocks most of the first enemy ability every 10s, plus magic resist and tenacity.',
    goodAt: 'Surviving burst mages, assassins and CC chains', weakTo: 'Auto-attack damage, burn and venom', bestOn: 'Carries and divers facing burst',
    items: [
      { name: 'Null Amulet', cost: 900, icon: 'Amulet', stats: { power: 10, mr: 25, hp: 100, spellShield: 0.25 } },
      { name: "Banshee's Veil", cost: 2800, icon: 'OrbWater', stats: { power: 40, mr: 40, spellShield: 0.2 } },
      { name: 'Quicksilver Sash', cost: 2700, icon: 'Ring', stats: { power: 40, mr: 30, tenacity: 0.3 } },
      { name: 'Wardstone Helm', cost: 2900, icon: 'Helmet', stats: { hp: 350, mr: 45, haste: 10 } },
      { name: 'Edge of Night', cost: 3000, icon: 'BookDarkness', stats: { power: 55, hp: 200, spellShield: 0.15 } },
    ],
  },
  thorns: {
    name: 'Thorns', icon: 'Guard', color: '#9ccf6a',
    desc: 'Reflects damage back: basic attacks AND abilities that hit you hurt the attacker.',
    goodAt: 'Punishing divers and focus fire', weakTo: 'Being ignored, % HP damage and burn', bestOn: 'Tanks who get jumped on',
    items: [
      { name: 'Bramble Vest', cost: 900, icon: 'Guard', stats: { hp: 100, armor: 25, thorns: 0.08 } },
      { name: 'Spiked Carapace', cost: 2800, icon: 'Counter', stats: { hp: 300, armor: 45, thorns: 0.15 } },
      { name: 'Mirror Shell', cost: 2800, icon: 'OrbWater', stats: { hp: 300, mr: 45, reflect: 0.12 } },
      { name: 'Briar Crown', cost: 2900, icon: 'Helmet', stats: { hp: 400, armor: 20, mr: 20, thorns: 0.07, reflect: 0.08 } },
      { name: 'Thornwood Aegis', cost: 3000, icon: 'DefenseUpgrade', stats: { hp: 450, armor: 30, mr: 30, hpPct: 0.04 } },
    ],
  },
  swift: {
    name: 'Swift', icon: 'Boot', color: '#e7ff8a',
    desc: 'Move speed everywhere, and much more out of combat. First to every gank, fight and objective.',
    goodAt: 'Roaming, ganks and rotating first', weakTo: 'Tanky front-to-back teamfights', bestOn: 'Junglers, roamers and mobile mids',
    items: [
      { name: 'Swift Boots', cost: 800, icon: 'Boot', stats: { power: 14, msPct: 0.06, roam: 0.06 } },
      { name: 'Windrunner Blade', cost: 2700, icon: 'BookWind', stats: { power: 45, msPct: 0.05, roam: 0.08 } },
      { name: 'Gale Fan', cost: 2800, icon: 'Permutation', stats: { power: 48, haste: 20, msPct: 0.04 } },
      { name: 'Shadowstep Cloak', cost: 2700, icon: 'Mist', stats: { power: 30, hp: 250, msPct: 0.04, tenacity: 0.15 } },
      { name: 'Hurricane Edge', cost: 3000, icon: 'Shuriken', stats: { power: 55, asPct: 0.15, msPct: 0.04 } },
    ],
  },
  executioner: {
    name: 'Executioner', icon: 'Death', color: '#c43a52',
    desc: 'Huge damage to low-HP heroes, and every takedown refunds a third of its cooldowns. Chains kills.',
    goodAt: 'Cleaning up fights and chaining kills', weakTo: 'Tanks, shields and peel', bestOn: 'Assassins and fighters with resets',
    items: [
      { name: "Reaper's Sickle", cost: 1100, icon: 'Cut', stats: { power: 28, execute: 0.12 } },
      { name: 'Guillotine', cost: 3000, icon: 'Death', stats: { power: 60, execute: 0.15, reset: 0.3 } },
      { name: "Headsman's Axe", cost: 2900, icon: 'Downgrade', stats: { power: 48, pen: 0.15, execute: 0.08 } },
      { name: 'Final Verdict', cost: 3000, icon: 'BookLight', stats: { power: 58, haste: 15, reset: 0.3 } },
      { name: 'Death Knell', cost: 2800, icon: 'Explosion', stats: { power: 45, hp: 250, execute: 0.08, msPct: 0.04 } },
    ],
  },
  frostbite: {
    name: 'Frostbite', icon: 'Snow', color: '#bfe6ff',
    desc: 'Abilities chill (slow) every hero they hit, and chilled enemies take more damage from this hero.',
    goodAt: 'Kiting, peel and setting up picks', weakTo: 'Tenacity, cleanse and fast burst', bestOn: 'Control mages, poke marksmen and supports',
    items: [
      { name: 'Frost Shard', cost: 900, icon: 'BookIce', stats: { power: 20, hp: 100, chill: 0.15 } },
      { name: 'Glacial Scepter', cost: 2800, icon: 'Snow', stats: { power: 48, hp: 200, chill: 0.1, frostbite: 0.12 } },
      { name: "Winter's Bite", cost: 2700, icon: 'OrbWater', stats: { power: 53, haste: 15, frostbite: 0.08 } },
      { name: 'Iceheart Mail', cost: 2800, icon: 'Armor', stats: { power: 25, hp: 300, armor: 30, mr: 20, chill: 0.05 } },
      { name: 'Permafrost Orb', cost: 3000, icon: 'OrbLight', stats: { power: 60, haste: 10, frostbite: 0.08 } },
    ],
  },
  venom: {
    name: 'Venom', icon: 'OrbPlant', color: '#5fbf3a',
    desc: 'Every hit stacks poison (up to 5). A target at 5 stacks is Weakened: it deals 10% less damage.',
    goodAt: 'Long fights and wearing down duelists', weakTo: 'Burst (stacks take time) and Spirit Gate resets', bestOn: 'Attack-speed marksmen and fighters',
    items: [
      { name: 'Viper Fang', cost: 1000, icon: 'Kunai', stats: { power: 18, venom: 2.5 } },
      { name: 'Serpent Kris', cost: 2800, icon: 'Cut', stats: { power: 45, asPct: 0.15, venom: 2 } },
      { name: 'Toxin Censer', cost: 2700, icon: 'Alchemy', stats: { power: 35, haste: 15, venom: 1.5 } },
      { name: 'Coilskin Wrap', cost: 2800, icon: 'Armor', stats: { hp: 300, armor: 25, mr: 25, venom: 1.5 } },
      { name: 'Hydra Fang', cost: 3000, icon: 'BookPlant', stats: { power: 50, pen: 0.08, venom: 2 } },
    ],
  },
  bulwark: {
    name: 'Bulwark', icon: 'Helmet', color: '#9fb3d9',
    desc: 'A protective aura: nearby allies take less damage. Makes the whole grouped team tougher.',
    goodAt: 'Grouped teamfights and sieges', weakTo: 'Poke, split-push and pick-offs (needs allies close)', bestOn: 'Tanks and frontline supports',
    items: [
      { name: 'Iron Buckler', cost: 900, icon: 'Guard', stats: { power: 8, hp: 120, armor: 12, bulwark: 0.01 } },
      { name: 'Tower Shield', cost: 2800, icon: 'DefenseUpgrade', stats: { hp: 300, armor: 35, bulwark: 0.015 } },
      { name: 'Rampart Mail', cost: 2800, icon: 'Armor', stats: { hp: 300, mr: 40, bulwark: 0.015 } },
      { name: 'Banner of Iron', cost: 2600, icon: 'Upgrade', stats: { power: 16, hp: 200, armor: 20, mr: 20, haste: 10 } },
      { name: 'Stalwart Plate', cost: 3000, icon: 'Helmet', stats: { hp: 350, armor: 15, hpPct: 0.04 } },
    ],
  },
  momentum: {
    name: 'Momentum', icon: 'Ring', color: '#ffb0f0',
    desc: 'Every takedown adds a Glory stack (power, up to 6). Dying loses half. Snowballs a lead.',
    goodAt: 'Snowballing a lead with a hero who stays alive', weakTo: 'Being caught early (dying halves the stacks)', bestOn: 'Carries who rarely die',
    items: [
      { name: 'Glory Charm', cost: 900, icon: 'Ring', stats: { power: 20, glory: 5 } },
      { name: "Mejai's Tome", cost: 2700, icon: 'BookLight', stats: { power: 35, haste: 10, glory: 6 } },
      { name: "Conqueror's Edge", cost: 2900, icon: 'MagicWeapon', stats: { power: 48, asPct: 0.15, glory: 4 } },
      { name: "Victor's Mantle", cost: 2800, icon: 'Armor', stats: { power: 25, hp: 300, armor: 20, glory: 3 } },
      { name: 'Crown of Ascension', cost: 3000, icon: 'OrbLight', stats: { power: 50, powerMult: 0.1 } },
    ],
  },
  stalker: {
    name: 'Nightstalker', icon: 'Moon', color: '#8a7aff',
    desc: 'Faster while the enemy cannot see it (more at night), and its first hit from the fog lands hard.',
    goodAt: 'Ambushes from the fog and at night, catching lone targets', weakTo: 'Wards, Ward Sweep and Owl Watch (vision)', bestOn: 'Assassins and junglers',
    items: [
      { name: 'Dusk Kunai', cost: 1000, icon: 'Kunai', stats: { power: 22, stalk: 0.1 } },
      { name: 'Moonshadow Blade', cost: 2900, icon: 'Moon', stats: { power: 50, msPct: 0.03, stalk: 0.15 } },
      { name: 'Night Veil', cost: 2700, icon: 'Mist', stats: { power: 35, hp: 200, stalk: 0.1 } },
      { name: 'Umbral Glaive', cost: 3000, icon: 'BookDarkness', stats: { power: 55, pen: 0.12 } },
      { name: 'Eclipse Mask', cost: 2800, icon: 'OrbDarkness', stats: { power: 40, haste: 15, stalk: 0.1 } },
    ],
  },
};

export const BUILD_ORDER = ['burst', 'burn', 'tank', 'sustain', 'crit', 'haste', 'guardian', 'pierce', 'siege', 'spellblade', 'warden',
  'bloodline', 'spellshield', 'thorns', 'swift', 'executioner', 'frostbite', 'venom', 'bulwark', 'momentum', 'stalker'];

// Build combos: two heroes on one team running these two build types get a small bonus (src/sim/builds2.js).
// Simple and readable: shown in prep, the Dojo Build Guide and in the match ticker.
export const BUILD_COMBOS = [
  { id: 'shatter', name: 'Shatter', a: 'frostbite', b: 'executioner', text: 'The Executioner deals 10% more damage to chilled or slowed enemies.' },
  { id: 'ironwall', name: 'Iron Wall', a: 'bulwark', b: 'thorns', text: 'Both heroes gain 15 armor and 15 magic resist.' },
  { id: 'bloodpact', name: 'Blood Pact', a: 'bloodline', b: 'guardian', text: 'Both heroes gain 4% omnivamp.' },
  { id: 'packhunt', name: 'Pack Hunt', a: 'swift', b: 'stalker', text: 'Both heroes gain 6% move speed.' },
  { id: 'plague', name: 'Plague', a: 'venom', b: 'burn', text: 'Venom ticks 25% harder on burning targets.' },
  { id: 'kingmaker', name: 'Kingmaker', a: 'momentum', b: 'bulwark', text: 'The Momentum hero loses only 1 Glory stack on death.' },
];

