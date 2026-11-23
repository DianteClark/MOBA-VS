// Tactic cards: pick 3 before the match. Each can be played once.
//   target: none | lane | hero (ally)
export const TACTICS = {
  smoke: { short: 'Team invisible 8s', name: 'Smoke Bomb', icon: 'Mist', target: 'none', counter: 'Owl Watch, Ward Sweep, Foxfire', desc: 'Whole team turns invisible for 8s (until they attack) and moves 10% faster. Sneak an objective or a flank.' },
  ambush: { short: 'Hide in lane brush', name: 'Ambush', icon: 'Camouflage', target: 'lane', counter: 'Owl Watch, wards in the brush', desc: 'Jungler + 2 nearest hide in the brush by a lane for 20s. First strike from hiding deals +25% damage.' },
  rally: { short: '+15% speed 12s', name: 'Rally Cry', icon: 'Upgrade', target: 'none', counter: 'Fall Back, Kami Barrier', desc: 'Team gains +15% move speed and +15% attack speed for 12s.' },
  wind: { short: 'Heal 25%, cleanse', name: 'Second Wind', icon: 'Heal', target: 'none', counter: 'Burst before it lands', desc: 'All your heroes heal 25% max HP and shake off slows.' },
  siege: { short: 'Empower 2 waves', name: 'Siege Formation', icon: 'Explosion', target: 'lane', counter: 'Fortify, wave clear', desc: 'Next 2 waves in a lane are empowered, and your heroes deal +25% damage to towers for 30s.' },
  sweep: { short: 'Clear wards, reveal', name: 'Ward Sweep', icon: 'Vision', target: 'none', counter: 'Re-warding after it', desc: 'Destroys all enemy wards and reveals every enemy hero for 4s.' },
  bait: { short: 'Shield one hero', name: 'Bait', icon: 'DefenseUpgrade', target: 'hero', counter: 'Ignoring the bait', desc: 'One hero gets a 30% max HP shield for 6s; allies within range rush to them.' },
  swap: { short: 'Swap top & bot 90s', name: 'Lane Swap', icon: 'Permutation', target: 'none', counter: 'Following the swap with your own', desc: 'Your top laner and bot duo trade lanes for 90s. Dodge a losing matchup.' },
  fortify: { short: 'Towers -40% dmg', name: 'Fortify', icon: 'DefenseUpgrade', target: 'none', counter: 'Splitting the map, waiting it out', desc: 'Your towers and Crystal take 40% less damage for 25s.' },
  pact: { short: 'Free objective call', name: 'Ancient Pact', icon: 'OrbFire', target: 'none', counter: 'Pit Trap, Smite Snipe', desc: 'Free objective call on the closest live Kami/Oni/Kraken, and +30% damage to it for 20s.' },
  eyes: { short: '3 wards for 90s', name: 'Spirit Eyes', icon: 'Vision', target: 'none', counter: 'Ward Sweep, Blackout', desc: 'Kami spirits watch both objective pits and the far shrine for 90s.' },
  council: { short: 'Refill all charges', name: 'War Council', icon: 'BookLight', target: 'none', counter: 'Forcing fights while charges are low', desc: 'Instantly refill your command charges to full.' },
  barrier: { short: 'Team shield 4s', name: 'Kami Barrier', icon: 'DefenseUpgrade', target: 'none', counter: 'Burn and venom (outlast the shield)', desc: 'Every hero gains a shield worth 20% of max HP for 4s. Turn a losing fight.' },
  gate: { short: 'Team to base, healed', name: 'Spirit Gate', icon: 'Permutation', target: 'none', counter: 'Hard CC interrupts the channel', desc: 'After a 1.5s channel, every living hero returns to base fully healed. A free, instant reset.' },
  // Coach skill tree sidegrades (src/data/meta.js TREE, effects in src/sim/sidegrades.js): `alt` is the card each mirrors.
  drums: { short: '+10% dmg 10s', name: 'War Drums', icon: 'AttackUpgrade', target: 'none', counter: 'Fall Back, Stone Skin', alt: 'rally', desc: 'Team gains +10% damage and +5% move speed for 10s. Rally Cry\'s twin: hit harder instead of faster.' },
  stone: { short: '-15% dmg taken 6s', name: 'Stone Skin', icon: 'DefenseUpgrade', target: 'none', counter: 'Waiting 6s', alt: 'barrier', desc: 'Every hero takes 15% less damage for 6s. Kami Barrier\'s twin: longer, and it never breaks.' },
  foxfire: { short: 'Reveal enemies 9s', name: 'Foxfire', icon: 'Vision', target: 'none', counter: 'Fighting inside your wards', alt: 'sweep', desc: 'Foxfire marks every enemy hero for 9s (wards stay). Ward Sweep\'s twin: longer sight, no ward clear.' },
  // v26 cards (effects in src/sim/cards2.js). cond: only playable when your team is behind ('behind': fewer towers or
  // 1,500+ gold down; 'behindKills': fewer kills). unlock: { lv } coach level or { ach } achievement (src/meta.js).
  blackout: { short: 'Enemy sight -35% 10s', name: 'Blackout', icon: 'BookDarkness', target: 'none', counter: 'Owl Watch, Ward Sweep, Foxfire',
    desc: 'Enemy heroes see 35% less far and their wards go dark for 10s (14s at night). Move unseen, flank, start a fight from the fog.' },
  owl: { short: 'Sight +30%, see stealth 20s', name: 'Owl Watch', icon: 'OrbLight', target: 'none', counter: 'Fighting where your heroes are not',
    desc: 'For 20s your heroes see 30% farther and spot stealthed enemies (Smoke Bomb, Ambush, Nightstalker) in their sight. Readies your scout pet.' },
  charge: { short: '+30% speed, slowing hits', name: 'Charge!', icon: 'Punch', target: 'none', counter: 'Fall Back, Second Wind',
    desc: 'For 6s your heroes move 30% faster, and the first basic hit on each enemy hero slows it 30% for 1.5s. Start the fight on your terms.' },
  fallback: { short: 'Disengage: +35% speed 4s', name: 'Fall Back', icon: 'Boot', target: 'none', counter: 'CC landed before the call',
    desc: 'Every hero breaks off, shakes off slows and retreats to the nearest tower with +35% move speed for 4s. Lose the fight, keep the heroes.' },
  underdog: { short: 'Behind: +12% dmg, -12% taken', name: 'Underdog', icon: 'LuckUpgrade', target: 'none', cond: 'behind', counter: 'Staying ahead: it cannot be played from the front',
    desc: 'Only when your team is behind (fewer towers, or 1,500+ gold down): for 15s your heroes deal 12% more damage and take 12% less.' },
  crash: { short: '2 fast waves', name: 'Crash Wave', icon: 'WaterCanon', target: 'lane', unlock: { lv: 3 }, counter: 'A hero with wave clear',
    desc: 'Your next 2 waves in a lane march 30% faster: they hit the tower early while your heroes rotate somewhere else.' },
  escort: { short: 'Anti-dive on one hero 10s', name: 'Escort', icon: 'Guard', target: 'hero', unlock: { lv: 5 }, counter: 'Poke from range, Second Wind',
    desc: 'For 10s one ally takes 25% less damage, and every enemy who hits them is slowed 45% for 1.5s. Keep the carry alive against divers.' },
  pit: { short: 'Slow & reveal at pit 30s', name: 'Pit Trap', icon: 'BookRock', target: 'none', unlock: { lv: 7 }, counter: 'Waiting it out, Second Wind',
    desc: 'Traps the nearest objective pit (live, or next to spawn) for 30s: enemies inside are slowed 25% and revealed. Set up the Kami before it spawns.' },
  slowpush: { short: 'Stack 3 big waves', name: 'Slow Push', icon: 'Harvest', target: 'lane', unlock: { lv: 9 }, counter: 'Clearing the stack early',
    desc: 'Your next 3 waves in a lane walk 35% slower with +30% HP: they stack into one huge wave that hits the tower together.' },
  lone: { short: 'Split-pusher buff 45s', name: 'Lone Wolf', icon: 'Cut', target: 'hero', unlock: { lv: 11 }, counter: 'Sending two to catch them',
    desc: 'One hero, for 45s: while no ally is near, +20% move speed, +30% damage to structures and 20% less damage taken. Built for a split push.' },
  echo: { short: 'Ult cooldowns halved', name: 'Echo Scroll', icon: 'Scroll', target: 'none', unlock: { lv: 13 }, counter: 'Fighting before ults are spent',
    desc: 'Every ultimate on cooldown in your team gets half its remaining time back. Win the next fight on a second round of ults.' },
  raid: { short: 'Invade: +30% vs camps 40s', name: 'Jungle Raid', icon: 'OrbPlant', target: 'none', unlock: { lv: 15 }, counter: 'Wards in your jungle, Owl Watch',
    desc: 'A free invade call for your jungler and the nearest ally. For 40s your heroes deal 30% more to enemy camps and take 35% more gold from them.' },
  wardline: { short: '3 wards on a lane 60s', name: 'Ward Line', icon: 'Vision', target: 'lane', unlock: { lv: 17 }, counter: 'Ward Sweep, Blackout',
    desc: 'Three spirit wards light up a lane for 60s, from your side to theirs: safe vision for a split push, a freeze or a flank.' },
  snipe: { short: 'Double smite 25s', name: 'Smite Snipe', icon: 'BookThunder', target: 'none', unlock: { ach: 'steal' }, counter: 'Killing or zoning their jungler',
    desc: 'Your jungler\'s smite is ready now, and for 25s it hits twice as hard and reaches farther. Steal the objective from under them.' },
  bounty: { short: 'Behind: bounty on their star', name: 'Bounty Hunt', icon: 'Money', target: 'none', cond: 'behindKills', unlock: { ach: 'calls5' }, counter: 'Hiding the carry',
    desc: 'Only when behind on kills: their top killer is revealed for 40s, and taking them down pays every one of your heroes 250 gold.' },
  revive: { short: 'Behind: respawn 60% sooner', name: 'Spirit Return', icon: 'Necromancy', target: 'none', cond: 'behind', unlock: { ach: 'first_win' }, counter: 'Pushing before they are back',
    desc: 'Only when behind, with a hero down: your dead heroes\' respawn timers drop by 60%. Turn a lost fight into a defense.' },
};
// Cards unlocked in the coach skill tree; cards with `unlock` come with coach levels or achievements; every other card
// is owned from the start (src/meta.js ownsTactic). All of them are sidegrades: none is stronger, so ranked stays fair.
export const SKILL_TACTICS = Object.keys(TACTICS).filter((k) => TACTICS[k].alt);
export const COND_TEXT = { behind: 'Only when behind', behindKills: 'Only when behind on kills' };
export const TACTIC_IDS = Object.keys(TACTICS);
export const DEFAULT_DECK = ['rally', 'smoke', 'wind'];
