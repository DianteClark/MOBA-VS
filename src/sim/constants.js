export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const sec = (s) => Math.round(s * TICK_RATE);

export const BLUE = 0, RED = 1, NEUTRAL = 2;
export const TEAM_NAME = ['Blue', 'Red', 'Neutral'];

// Match length: when the clock hits 0, the team with more towers standing wins
// (tiebreaks: Shrine Crystal HP, then kills, then total gold).
export const MATCH_SECONDS = 15 * 60;

// All timers in seconds of game time (tuned for 15-minute matches).
export const T = {
  firstWave: 12, waveEvery: 22, siegeEvery: 3,
  campFirst: 30, campRespawn: 50, buffRespawn: 80,
  dragonFirst: 90, dragonRespawn: 120, elderRespawn: 150,
  heraldFirst: 180, heraldRespawn: 150, heraldDespawn: 450,
  baronFirst: 450, baronRespawn: 180,
  shrineUnlock: 60, shrineCapture: 5,
  inhibRespawn: 210,
  heraldEye: 120, baronBuff: 75, elderBuff: 75,
  recallChannel: 4, gankTimeout: 24, objectiveTimeout: 45, groupTimeout: 40, safeTimeout: 22,
  weatherPhase: 150,
};

export const GOLD = {
  passive: 5.0, start: 500,
  melee: 34, caster: 24, siege: 80, super: 60,
  kill: 350, assist: 180, shutdownPerStreak: 110,
  tower: 220, inhib: 100, objectiveTeam: 120,
};
export const XP = { melee: 36, caster: 26, siege: 75, super: 60, killBase: 90, killPerLevel: 24, maxLevel: 15 };
export const xpNeeded = (lvl) => 150 + 80 * (lvl - 1);

export const VISION = { hero: 400, minion: 300, tower: 460, ward: 340, summon: 300, fountain: 650, shrine: 420 };

// Range tiers (centre-to-edge attack range). Towers out-range every hero.
export const RANGE = { melee: 55, short: 150, long: 180, tower: 255 };

// Final phase ("Last Stand"): the last 3 minutes pay more and respawns get longer.
// Match pacing: the game escalates so most matches end at a Crystal between 12:00 and 15:00.
//   structures take more damage over time (+1x per 5 min from 4:00, plus +1x per 75s from 11:00:
//   about 5.4x by 15:00), waves get siege minions every wave from 8:00 and a super minion per lane
//   from 10:00 ("Kami's Wrath"), and backdoor protection fades from 11:30.
export const PACE = { rampFrom: 240, rampPer: 300, lateFrom: 660, latePer: 75, siegeAllFrom: 480, wrathFrom: 600, backdoorOffFrom: 690 };
export const FINAL = { at: 720, gold: 1.5, respawn: 1.5 };
// Halftime (runner-level pause at 7:30) and the window for halftime-only commands.
export const HALFTIME = { at: 450, seconds: 20, window: 8 };
// Momentum: fills from paid-off calls, kills, objectives, towers and shrines; a full meter buys one Kami Surge.
export const MOMENTUM = { max: 100, call: 14, kill: 4, objective: 18, tower: 10, shrine: 8, surgeSec: 8, dmg: 0.1, ms: 0.05 };
// Hero requests ("can I go?"): a 'permit' is a short solo task; one per team every 20s.
export const PERMIT = { fight: 12, split: 60, range: 1500, cooldown: 20 };
export const CMD = {
  maxCharges: 3, regen: 20, // seconds per charge
  cost: { ult: 0, plan: 0, redraw: 0, surge: 0, permit: 0, moment: 0, gank: 1, objective: 2, shrine: 1, group: 1, split: 1, focus: 1, safe: 1, reset: 1, invade: 2, herald: 0, build: 0, cancel: 0, tactic: 0, talent: 0, item: 0, scout: 0 },
};

// Internal ids keep their old names (dragon/herald/baron); these are the names players see.
export const OBJ_NAME = { dragon: 'Kami', herald: 'Oni', baron: 'Kraken', shrine: 'Shrine', boss: 'Tengu', yokai: 'Yokai Parade' }; // boss / yokai: Living World
export const DRAGONS = ['infernal', 'ocean', 'mountain', 'cloud'];
export const DRAGON_INFO = {
  infernal: { name: 'Ember Kami', short: 'Ember', color: '#ff6a3d', desc: '+5% damage per blessing' },
  ocean: { name: 'Tide Kami', short: 'Tide', color: '#3db6ff', desc: 'Regenerate 0.5% max HP/s per blessing' },
  mountain: { name: 'Stone Kami', short: 'Stone', color: '#c99a5b', desc: '+6% armor & MR per blessing' },
  cloud: { name: 'Gale Kami', short: 'Gale', color: '#d8f0ff', desc: '+3% move speed per blessing' },
  elder: { name: 'Ancient Kami', short: 'Ancient', color: '#e9d7ff', desc: 'Execute enemies below 20% HP' },
};

// Clans: team bonuses at 2 and 3+ heroes of the same clan.
export const CLANS = {
  shinobi: { name: 'Shinobi', color: '#7fd0ff', icon: 'Camouflage', tiers: [{ n: 2, stats: { msPct: 0.05 }, text: '+5% move speed' }, { n: 3, stats: { msPct: 0.05, crit: 0.1, haste: 8 }, text: '+10% crit, +8 haste' }] },
  beast: { name: 'Beast', color: '#ffb35a', icon: 'BookPlant', tiers: [{ n: 2, stats: { omnivamp: 0.05 }, text: '+5% omnivamp' }, { n: 3, stats: { omnivamp: 0.05, regen: 4, hpPct: 0.05 }, text: '+5% omnivamp, +5% HP' }] },
  spirit: { name: 'Spirit', color: '#c7a7ff', icon: 'OrbLight', tiers: [{ n: 2, stats: { healPower: 0.1 }, text: '+10% heal & shield power' }, { n: 3, stats: { healPower: 0.1, haste: 12 }, text: '+12 ability haste' }] },
  iron: { name: 'Iron', color: '#c8c8d8', icon: 'DefenseUpgrade', tiers: [{ n: 2, stats: { armor: 8, mr: 8 }, text: '+8 armor & MR' }, { n: 3, stats: { armor: 8, mr: 8, siegePct: 0.15 }, text: '+15% damage to towers' }] },
  wild: { name: 'Wild', color: '#8be08b', icon: 'BookWind', tiers: [{ n: 2, stats: { dmgPct: 0.04 }, text: '+4% damage' }, { n: 3, stats: { dmgPct: 0.06, msPct: 0.04 }, text: '+6% damage, +4% speed' }] },
};

// Weather: each map cycles through its list, one phase every T.weatherPhase seconds.
export const WEATHER = {
  clear: { name: 'Clear', vision: 1, ms: 1, burn: 1, regen: 1, proj: 1 },
  rain: { name: 'Rain', vision: 0.85, ms: 0.97, burn: 0.7, regen: 1, proj: 1, desc: 'Vision -15%, burns -30%' },
  fog: { name: 'Fog', vision: 0.7, ms: 1, burn: 1, regen: 1, proj: 1, desc: 'Vision -30%' },
  wind: { name: 'Gale', vision: 1, ms: 1.05, burn: 1, regen: 1, proj: 1.2, desc: 'Move +5%, projectiles +20%' },
  snow: { name: 'Snow', vision: 0.9, ms: 0.95, burn: 1, regen: 1, proj: 1, desc: 'Move -5%, vision -10%' },
  blizzard: { name: 'Blizzard', vision: 0.65, ms: 0.92, burn: 0.8, regen: 1, proj: 0.9, desc: 'Vision -35%, move -8%' },
  heat: { name: 'Heatwave', vision: 1, ms: 1, burn: 1.35, regen: 0.6, proj: 1, desc: 'Burns +35%, regen -40%' },
  dust: { name: 'Dust Storm', vision: 0.78, ms: 0.98, burn: 1, regen: 1, proj: 1, desc: 'Vision -22%' },
};

// Leashes: how far units may stray from their zone before they give up and walk back.
//   minion: px off the lane centre line; mob: px from its camp spot; boss: px from its pit centre.
// Monsters that reset walk home healing fast (hits barely land), then sit at full HP.
export const LEASH = { minion: 160, mob: 240, boss: 300 };
