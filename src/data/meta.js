// Long-term coach progression (data only): coach levels and the coach skill tree, hero mastery perks, Prestige
// looks, daily-goal streak rewards, and the cosmetics these bring (merged into the shared cosmetic tables).
//
// Fairness: the skill tree unlocks SIDEGRADES only. Its tactic cards and Coach Moment variants are alternatives
// to the base ones with the same overall strength (src/sim/sidegrades.js), so ranked and cups stay fair and any
// unlocked variant may be brought there. Mastery perks are small stat bonuses and are applied ONLY in matches
// against the AI outside ranked online, cups and online casual (src/meta.js perksFor).

// ── coach levels ──
const COACH_MAX = 40;
// XP to go from level L to L+1: 150 + 25 L (level 10 ≈ 30 matches, level 24 (whole tree) ≈ 130).
const coachStep = (lv) => 150 + 25 * lv;
export function coachLevelOf(xp = 0) {
  let lv = 1, need = coachStep(1), left = Math.max(0, xp);
  while (lv < COACH_MAX && left >= need) { left -= need; lv++; need = coachStep(lv); }
  return { lv, into: lv >= COACH_MAX ? 1 : left / need, left, need, max: lv >= COACH_MAX };
}
// Skill points: one per level after the first.
export const coachPoints = (lv) => Math.max(0, lv - 1);
export const COACH_XP = { win: 60, loss: 35, perCall: 5, callCap: 20, goal: 40, story: 60 };

// ── coach skill tree ──
// Three branches of four nodes; each node needs the one before it, a coach level, and skill points.
export const BRANCHES = {
  tactics: { name: 'Tactician', color: '#ffd84a', desc: 'New tactic cards: sidegrades of the classic ones.' },
  moments: { name: 'Motivator', color: '#ff8a5a', desc: 'Coach Moment variants: same once-per-match swing, a different shape.' },
  style: { name: 'Showman', color: '#b9a2ff', desc: 'Looks for your coach card and quick chat.' },
};
export const TREE = [
  { id: 't1', branch: 'tactics', lv: 2, cost: 1, tactic: 'drums', alt: 'rally' },
  { id: 't2', branch: 'tactics', lv: 6, cost: 2, tactic: 'stone', alt: 'barrier' },
  { id: 't3', branch: 'tactics', lv: 10, cost: 2, tactic: 'foxfire', alt: 'sweep' },
  { id: 't4', branch: 'tactics', lv: 16, cost: 3, reward: { kind: 'title', id: 'grandStrategist', also: { kind: 'banner', id: 'tacticsBoard' } } },
  { id: 'm1', branch: 'moments', lv: 3, cost: 1, moment: 'bulwark' },
  { id: 'm2', branch: 'moments', lv: 7, cost: 2, moment: 'huddle' },
  { id: 'm3', branch: 'moments', lv: 12, cost: 2, moment: 'march' },
  { id: 'm4', branch: 'moments', lv: 18, cost: 3, reward: { kind: 'border', id: 'whistle', also: { kind: 'title', id: 'headCoach' } } },
  { id: 's1', branch: 'style', lv: 4, cost: 1, reward: { kind: 'emote', id: 'bang' } },
  { id: 's2', branch: 'style', lv: 8, cost: 1, reward: { kind: 'emote', id: 'poker' } },
  { id: 's3', branch: 'style', lv: 14, cost: 2, reward: { kind: 'banner', id: 'spotlight' } },
  { id: 's4', branch: 'style', lv: 20, cost: 3, reward: { kind: 'skin', id: 'tracksuit' } },
];
export const TREE_BY_ID = Object.fromEntries(TREE.map((n) => [n.id, n]));
export const nodeReq = (n) => { const b = TREE.filter((x) => x.branch === n.branch); const i = b.indexOf(n); return i > 0 ? b[i - 1].id : null; };

// ── hero mastery perks (vs AI only) ──
// One equipped per hero; each unlocks at a mastery level with that hero. Small on purpose.
export const PERKS = {
  grit: { name: 'Grit', lv: 3, stats: { hpPct: 0.04 }, short: '+4% max HP', icon: 'DefenseUpgrade' },
  edge: { name: 'Edge', lv: 5, stats: { dmgPct: 0.03 }, short: '+3% damage', icon: 'AttackUpgrade' },
  stride: { name: 'Stride', lv: 7, stats: { msPct: 0.04 }, short: '+4% move speed', icon: 'Upgrade' },
  focus: { name: 'Focus', lv: 9, stats: { haste: 8 }, short: '+8 ability haste', icon: 'BookLight' },
};
export const PERK_IDS = Object.keys(PERKS);

// ── Prestige: past Kami I, every 100 rating is a Prestige rank (online ranked only climbs that high) ──
export const PRESTIGE = { from: 2050, step: 100, max: 10 };
export const PRESTIGE_REWARDS = {
  1: { kind: 'border', id: 'prestige' },
  3: { kind: 'banner', id: 'prestigeSky' },
  5: { kind: 'skin', id: 'eternal' },
  10: { kind: 'title', id: 'eternal' },
};

// ── daily goals: streak rewards (days in a row with all three goals done) ──
export const STREAK_REWARDS = {
  3: { kind: 'emote', id: 'plus' },
  7: { kind: 'banner', id: 'daybreak' },
  14: { kind: 'border', id: 'dawn' },
  30: { kind: 'title', id: 'ironWill' },
};

// ── cosmetics added by the above (merged into SKINS / BANNERS / BORDERS / TITLES) ──
export const META_SKINS = {
  tracksuit: { name: 'Head Coach', recolor: { hue: 210, sat: 1.2, light: 0.02 }, swatch: '#4a8aff' },
  eternal: { name: 'Eternal', recolor: { hue: 40, sat: 0.5, light: 0.22 }, swatch: 'linear-gradient(135deg, #fff6dc, #ff9ab0 50%, #b9a2ff)' },
};
export const META_BANNERS = {
  tacticsBoard: { name: 'Tactics Board', bg: 'repeating-linear-gradient(0deg, transparent 0 15px, #ffffff14 15px 16px), repeating-linear-gradient(90deg, transparent 0 15px, #ffffff14 15px 16px), linear-gradient(135deg, #1a3a2a, #0e2018)' },
  spotlight: { name: 'Spotlight', bg: 'radial-gradient(ellipse at 50% -10%, #fff2c8 0 12%, #ffd84a55 30%, transparent 60%), linear-gradient(#2a1d3a, #120c1a)' },
  prestigeSky: { name: 'Prestige Sky', bg: 'radial-gradient(circle at 30% 25%, #fff6dc, #ff9ab0 25%, #6a1030 55%, #1a0610 85%)' },
  daybreak: { name: 'Daybreak', bg: 'linear-gradient(180deg, #2a2a6a, #ff8a5a 55%, #ffd84a 75%, #3a1a2a 76%)' },
};
export const META_BORDERS = {
  whistle: { name: 'Coach\'s Whistle', c1: '#ff8a5a', c2: '#3a1208', shine: true },
  prestige: { name: 'Prestige', c1: '#fff6dc', c2: '#ff7a9a', shine: true },
  dawn: { name: 'Dawn Streak', c1: '#ffd84a', c2: '#ff5a3a' },
  kamiLeague: { name: 'Kami League', c1: '#ff7a9a', c2: '#2a0a18', shine: true },
};
export const META_TITLES = {
  grandStrategist: 'Grand Strategist', headCoach: 'Head Coach', eternal: 'Eternal Kami', ironWill: 'Iron Will',
  leagueJade: 'Jade Leaguer', leagueKami: 'Kami Leaguer',
};
