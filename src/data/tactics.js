// Tactic cards: pick 3 before the match. Each can be played once.
//   target: none | lane | hero (ally)
export const TACTICS = {
  smoke: { short: 'Team invisible 8s', name: 'Smoke Bomb', icon: 'Mist', target: 'none', desc: 'Whole team turns invisible for 8s (until they attack) and moves 10% faster. Sneak an objective or a flank.' },
  ambush: { short: 'Hide in lane brush', name: 'Ambush', icon: 'Camouflage', target: 'lane', desc: 'Jungler + 2 nearest hide in the brush by a lane for 20s. First strike from hiding deals +25% damage.' },
  rally: { short: '+15% speed 12s', name: 'Rally Cry', icon: 'Upgrade', target: 'none', desc: 'Team gains +15% move speed and +15% attack speed for 12s.' },
  wind: { short: 'Heal 25%, cleanse', name: 'Second Wind', icon: 'Heal', target: 'none', desc: 'All your heroes heal 25% max HP and shake off slows.' },
  siege: { short: 'Empower 2 waves', name: 'Siege Formation', icon: 'Explosion', target: 'lane', desc: 'Next 2 waves in a lane are empowered, and your heroes deal +25% damage to towers for 30s.' },
  sweep: { short: 'Clear wards, reveal', name: 'Ward Sweep', icon: 'Vision', target: 'none', desc: 'Destroys all enemy wards and reveals every enemy hero for 4s.' },
  bait: { short: 'Shield one hero', name: 'Bait', icon: 'DefenseUpgrade', target: 'hero', desc: 'One hero gets a 30% max HP shield for 6s; allies within range rush to them.' },
  swap: { short: 'Swap top & bot 90s', name: 'Lane Swap', icon: 'Permutation', target: 'none', desc: 'Your top laner and bot duo trade lanes for 90s. Dodge a losing matchup.' },
  fortify: { short: 'Towers -40% dmg', name: 'Fortify', icon: 'DefenseUpgrade', target: 'none', desc: 'Your towers and Crystal take 40% less damage for 25s.' },
  pact: { short: 'Free objective call', name: 'Ancient Pact', icon: 'OrbFire', target: 'none', desc: 'Free objective call on the closest live Kami/Oni/Kraken, and +30% damage to it for 20s.' },
  eyes: { short: '3 wards for 90s', name: 'Spirit Eyes', icon: 'Vision', target: 'none', desc: 'Kami spirits watch both objective pits and the far shrine for 90s.' },
  council: { short: 'Refill all charges', name: 'War Council', icon: 'BookLight', target: 'none', desc: 'Instantly refill your command charges to full.' },
  barrier: { short: 'Team shield 4s', name: 'Kami Barrier', icon: 'DefenseUpgrade', target: 'none', desc: 'Every hero gains a shield worth 20% of max HP for 4s. Turn a losing fight.' },
  gate: { short: 'Team to base, healed', name: 'Spirit Gate', icon: 'Permutation', target: 'none', desc: 'After a 1.5s channel, every living hero returns to base fully healed. A free, instant reset.' },
};
export const TACTIC_IDS = Object.keys(TACTICS);
export const DEFAULT_DECK = ['rally', 'smoke', 'wind'];
