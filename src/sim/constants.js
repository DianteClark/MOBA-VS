export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const sec = (s) => Math.round(s * TICK_RATE);

export const BLUE = 0, RED = 1, NEUTRAL = 2;
export const TEAM_NAME = ['Blue', 'Red', 'Neutral'];

export const T = {
  firstWave: 15, waveEvery: 25, siegeEvery: 3,
  campFirst: 40, campRespawn: 60, buffRespawn: 100,
  dragonFirst: 150, dragonRespawn: 150, elderRespawn: 180,
  heraldFirst: 240, heraldRespawn: 200, heraldDespawn: 570,
  baronFirst: 570, baronRespawn: 240,
  inhibRespawn: 150,
  heraldEye: 150, baronBuff: 90, elderBuff: 90,
  recallChannel: 4, gankTimeout: 26, objectiveTimeout: 50, groupTimeout: 45, safeTimeout: 25,
};

export const GOLD = {
  passive: 4.0, start: 500,
  melee: 38, caster: 26, siege: 90, super: 70,
  kill: 400, assist: 200, shutdownPerStreak: 120,
  tower: 250, inhib: 100, objectiveTeam: 120,
};
export const XP = { melee: 34, caster: 24, siege: 70, super: 60, killBase: 80, killPerLevel: 22, maxLevel: 15 };
export const xpNeeded = (lvl) => 200 + 105 * (lvl - 1);

export const VISION = { hero: 380, minion: 280, tower: 450, ward: 320, summon: 300, fountain: 650, objective: 0 };

export const CMD = {
  maxCharges: 3, regen: 20, // seconds per charge
  cost: { gank: 1, objective: 2, group: 1, split: 1, focus: 1, safe: 1, reset: 1, invade: 2, herald: 0, build: 0, cancel: 0, ping: 0 },
};

export const DRAGONS = ['infernal', 'ocean', 'mountain', 'cloud'];
export const DRAGON_INFO = {
  infernal: { name: 'Infernal', color: '#ff6a3d', desc: '+5% damage per stack' },
  ocean: { name: 'Ocean', color: '#3db6ff', desc: 'Regenerate 0.5% max HP/s per stack' },
  mountain: { name: 'Mountain', color: '#c99a5b', desc: '+6% armor & MR per stack' },
  cloud: { name: 'Cloud', color: '#d8f0ff', desc: '+3% move speed per stack' },
  elder: { name: 'Elder', color: '#e9d7ff', desc: 'Execute enemies below 20% HP' },
};
