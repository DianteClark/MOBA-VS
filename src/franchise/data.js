// Franchise mode: fixed data (names, colours, crest parts) and the economy constants.
// Pure data, shared by the game, the Worker (Pro League) and tools/franchise_sim.mjs.

// ── league shape ──
export const LEAGUE_TEAMS = 8;          // you + 7 AI franchises
export const ROUNDS = 14;               // double round robin
export const PLAYOFF_TEAMS = 4;         // semis 1v4, 2v3, then the final
export const ROSTER_MIN = 6;            // 5 starters + at least one to rotate in
export const ROSTER_MAX = 9;
export const TRADE_DEADLINE = 10;       // no trades after round 10 (signings stay open)

// ── money (in k) ──
export const CAP = 110;                 // hard salary cap for every franchise
export const BUDGET_MIN = 90;           // owner budget floor: a bad season is always recoverable
export const BUDGET_BASE = 84;          // budget = base + fans * BUDGET_PER_FAN, clamped to [min, cap]
export const BUDGET_PER_FAN = 0.4;
export const FANS_START = 50;
export const PRIZE = [22, 14, 9, 9, 5, 4, 3, 2]; // season prize by final place (champion, finalist, semis, ...)
export const ROOKIE_SAL = [8, 7, 7, 6, 6, 5, 5, 4]; // rookie-scale salary by draft slot (3-season deal)

// ── roster effects → small stat edges in the sim (cfg.teams[t].heroes[i].mod, clamped ±10% in game.js) ──
export const MOD = {
  ovr: 0.0025,      // per OVR point away from 70 (OVR 90 = +5%)
  morale: 0.03,     // morale 100 = +3%, 20 = -3% (60 is neutral)
  form: 0.0075,     // form -2..+2 = ∓1.5%
  tired: -0.015,    // fatigue 4-5
  exhausted: -0.03, // fatigue 6+
  chem: 0.025,      // full team chemistry (all starters bonded) = +2.5%
  duo: 0.005,       // each bonded duo among the starters
  cap: 0.1,
};
export const FATIGUE = { tired: 4, exhausted: 6, injured: 7 };
export const BOND_MAX = 10;

// ── identities ──
export const COLORS = ['#e0453a', '#f08a24', '#f2c12e', '#7cc242', '#2fa36b', '#2bb3b1', '#3b82d6', '#5a5fd6', '#9b59d0', '#d64f9c', '#f4f1e8', '#2b2b3a'];
export const PATTERNS = ['plain', 'split', 'band', 'chevron', 'quarters'];
export const EMBLEMS = ['katana', 'axe', 'lance', 'hammer', 'sai', 'bigsword', 'magicwand', 'shuriken', 'bomb', 'key', 'kunai', 'rapier', 'club', 'onigiri', 'fish', 'gourd', 'heart'];
export const emblemSrc = (i) => `assets/img/crest/${EMBLEMS[((i % EMBLEMS.length) + EMBLEMS.length) % EMBLEMS.length]}.png`;

// AI franchises in your league (seven are drawn at founding).
export const FR_NAMES = [
  ['Sakura Kitsune', 'SAK'], ['Frostfang Wolves', 'FRO'], ['Ember Oni', 'EMB'], ['Moonlit Ravens', 'MOO'], ['Tidewater Koi', 'TID'], ['Iron Peak Rams', 'IRN'],
  ['Jade Cranes', 'JAD'], ['Storm Tengu', 'STO'], ['Lotus Lanterns', 'LOT'], ['Kumo Spiders', 'KUM'], ['Raijin Thunder', 'RAI'], ['Hollow Ronin', 'HOL'],
  ['Copper Tanuki', 'COP'], ['Mist Serpents', 'MIS'], ['Golden Shogun', 'GLD'], ['Bamboo Pandas', 'BAM'],
];
// AI general managers: how each franchise builds (shown on the Market screen so their moves read as logical).
export const GM_STYLES = {
  contender: { name: 'Win now', blurb: 'Pays for proven stars', ovrW: 1.2, potW: 0.4, ageW: 0.6 },
  builder: { name: 'Youth movement', blurb: 'Loves prospects with upside', ovrW: 0.8, potW: 1.2, ageW: 1.3 },
  balanced: { name: 'Balanced', blurb: 'Fair value, steady hands', ovrW: 1, potW: 0.8, ageW: 1 },
  thrifty: { name: 'Moneyball', blurb: 'Hunts cheap value contracts', ovrW: 1, potW: 0.7, ageW: 1, salW: 1.6 },
};
export const GM_ORDER = ['contender', 'builder', 'balanced', 'thrifty'];

// Pro League: 16 fixed AI teams in two divisions (same for every player).
export const PRO_TEAMS = [
  { id: 'akane', name: 'Akane Dragons', abbr: 'AKD', c1: '#e0453a', c2: '#f2c12e', p: 3, e: 1, base: 78, sig: ['kenshi', 'raiden', 'ember', 'fletch', 'hoshi', 'sora', 'kaen', 'oak'] },
  { id: 'kuro', name: 'Kuro Shadows', abbr: 'KUR', c1: '#2b2b3a', c2: '#9b59d0', p: 1, e: 7, base: 76, sig: ['kaze', 'shiro', 'gaki', 'sanguis', 'yuki', 'wren', 'frost', 'marlowe'] },
  { id: 'umi', name: 'Umi Tide', abbr: 'UMI', c1: '#3b82d6', c2: '#f4f1e8', p: 2, e: 14, base: 74, sig: [] },
  { id: 'yama', name: 'Yama Titans', abbr: 'YAM', c1: '#7cc242', c2: '#2b2b3a', p: 4, e: 3, base: 73, sig: ['bastion', 'valka', 'bolt', 'tetsu'] },
  { id: 'hikari', name: 'Hikari Phoenix', abbr: 'HIK', c1: '#f08a24', c2: '#f4f1e8', p: 3, e: 6, base: 75, sig: [] },
  { id: 'fuyu', name: 'Fuyu Frost', abbr: 'FUY', c1: '#2bb3b1', c2: '#f4f1e8', p: 0, e: 4, base: 71, sig: ['yuki', 'frost'] },
  { id: 'tora', name: 'Tora Tigers', abbr: 'TOR', c1: '#f2c12e', c2: '#2b2b3a', p: 2, e: 0, base: 72, sig: ['leonin', 'ruga'] },
  { id: 'hana', name: 'Hana Blossom', abbr: 'HAN', c1: '#d64f9c', c2: '#f4f1e8', p: 1, e: 16, base: 70, sig: [] },
  { id: 'ishi', name: 'Ishi Golems', abbr: 'ISH', c1: '#5a5fd6', c2: '#f2c12e', p: 4, e: 12, base: 69, sig: [] },
  { id: 'kaminari', name: 'Kaminari Bolts', abbr: 'KAM', c1: '#5a5fd6', c2: '#2bb3b1', p: 3, e: 8, base: 74, sig: ['raiden', 'fujin'] },
  { id: 'mori', name: 'Mori Wardens', abbr: 'MOR', c1: '#2fa36b', c2: '#f08a24', p: 0, e: 2, base: 70, sig: ['fletch', 'wren', 'oak'] },
  { id: 'kaze', name: 'Kaze Runners', abbr: 'KZR', c1: '#f4f1e8', c2: '#3b82d6', p: 1, e: 10, base: 71, sig: [] },
  { id: 'tetsu', name: 'Tetsu Forge', abbr: 'TET', c1: '#2b2b3a', c2: '#f08a24', p: 2, e: 4, base: 72, sig: ['bolt', 'tetsu'] },
  { id: 'kiri', name: 'Kiri Mist', abbr: 'KIR', c1: '#9b59d0', c2: '#2bb3b1', p: 3, e: 11, base: 68, sig: [] },
  { id: 'sango', name: 'Sango Reef', abbr: 'SAN', c1: '#e0453a', c2: '#2bb3b1', p: 0, e: 15, base: 69, sig: [] },
  { id: 'ryu', name: 'Ryu Ascent', abbr: 'RYU', c1: '#2fa36b', c2: '#f2c12e', p: 4, e: 5, base: 73, sig: [] },
];
export const PRO_DIVS = ['East', 'West']; // teams 0-7 East, 8-15 West
