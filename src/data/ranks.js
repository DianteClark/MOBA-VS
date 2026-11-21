// Ranked tiers: Bronze → Kami, three divisions each, read straight off the per-season Elo rating.
// Every coach starts a season at 1000 (Silver III). Vs AI the AI team has a fixed rating, so the
// Elo math itself caps how far an easy opponent can carry you; online ranked uses the same formula
// as the ladder server (worker/index.js). Casual and Lane Rush never touch the rating.
export const START_ELO = 1000;
export const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, color: '#d08a4e', dark: '#6a3a1c', gem: '#f2b27a' },
  { id: 'silver', name: 'Silver', min: 1000, color: '#c9d6e6', dark: '#4e5a6c', gem: '#ffffff' },
  { id: 'gold', name: 'Gold', min: 1150, color: '#ffd84a', dark: '#7a5410', gem: '#fff2a8' },
  { id: 'platinum', name: 'Platinum', min: 1300, color: '#5fe0c8', dark: '#145a52', gem: '#c8fff4' },
  { id: 'diamond', name: 'Diamond', min: 1450, color: '#7fb4ff', dark: '#1c3a7a', gem: '#e2f0ff' },
  { id: 'master', name: 'Master', min: 1600, color: '#c99bff', dark: '#46207a', gem: '#f0e0ff' },
  { id: 'kami', name: 'Kami', min: 1750, color: '#ff7a9a', dark: '#6a1030', gem: '#fff0c0' },
];
export const DIVS = ['III', 'II', 'I'];
const BRONZE_FLOOR = 850; // Bronze divisions span 850-999 like every other tier (below 850 is still Bronze III)
const KAMI_STEP = 100;    // Kami divisions are wider: 1750, 1850, 1950+

export function rankOf(elo = START_ELO) {
  let i = 0; for (let k = 0; k < TIERS.length; k++) if (elo >= TIERS[k].min) i = k;
  const t = TIERS[i], next = TIERS[i + 1] || null;
  const lo = i === 0 ? BRONZE_FLOOR : t.min, step = next ? (next.min - lo) / 3 : KAMI_STEP;
  const d = Math.max(0, Math.min(2, Math.floor((elo - lo) / step)));
  const divLo = lo + d * step, divHi = d < 2 || next ? lo + (d + 1) * step : Infinity;
  return {
    tier: t, idx: i, div: DIVS[d], d, label: `${t.name} ${DIVS[d]}`, elo: Math.round(elo),
    // progress inside the current division (Kami I keeps counting up)
    into: Math.max(0, elo - divLo), span: divHi === Infinity ? KAMI_STEP : divHi - divLo, next, step: i * 3 + d,
    nextLabel: d < 2 ? `${t.name} ${DIVS[d + 1]}` : next ? `${next.name} III` : null, toNext: divHi === Infinity ? 0 : Math.ceil(divHi - elo),
  };
}
// Elo with a floor; K shrinks a little for established players (same as worker/index.js).
export function eloDelta(mine, theirs, won, games) {
  const k = games < 10 ? 40 : 28, e = 1 / (1 + 10 ** ((theirs - mine) / 400));
  return Math.round(k * ((won ? 1 : 0) - e));
}
// Fixed ratings of the AI coaches, and where each stops paying out.
export const AI_ELO = [920, 1180, 1420];
export const AI_CAP = [1149, 1449, 1749]; // Easy tops out at Silver I, Normal at Platinum I, Hard at Master I (Kami is online only)
export const CUP_ELO = [1000, 1250, 1500];
// Which results move the rating.
export const RATED = { ai0: true, ai1: true, ai2: true, cup: true, online: true, casual: false, rush: false, rushOnline: false };

// End-of-season rewards: reaching a tier (peak rating, 5+ rated matches) earns every reward up to it.
export const MIN_RATED_GAMES = 5;
export const SEASON_REWARDS = {
  bronze: [{ kind: 'border', id: 'bronze' }],
  silver: [{ kind: 'border', id: 'silver' }, { kind: 'title', id: 'rankSilver' }],
  gold: [{ kind: 'border', id: 'gold' }, { kind: 'banner', id: 'rankGold' }],
  platinum: [{ kind: 'border', id: 'platinum' }, { kind: 'skin', id: 'platinum' }],
  diamond: [{ kind: 'border', id: 'diamond' }, { kind: 'banner', id: 'rankDiamond' }, { kind: 'title', id: 'rankDiamond' }],
  master: [{ kind: 'border', id: 'master' }, { kind: 'skin', id: 'master' }, { kind: 'title', id: 'rankMaster' }],
  kami: [{ kind: 'border', id: 'kami' }, { kind: 'banner', id: 'rankKami' }, { kind: 'skin', id: 'kami' }, { kind: 'title', id: 'rankKami' }],
};
// Older profiles stored borders with the previous tier names.
export const OLD_TIER = { ronin: 'bronze', samurai: 'silver', daimyo: 'gold', shogun: 'diamond' };
export const tierById = (id) => TIERS.find((t) => t.id === (OLD_TIER[id] || id)) || TIERS[0];
