// Seasons: themes, ranks and the reward track.
// Dates are UTC days. The season balancer (tools/season.mjs + .github/workflows/season.yml)
// re-tunes heroes when a season ends and appends patch notes (src/data/patchnotes.js).
export const SEASONS = [
  { id: 1, name: 'Blossom Rising', start: '2026-11-20', end: '2027-01-31', map: 'sakura', clan: 'shinobi', color: '#ff9ec7',
    blurb: 'The valley wakes. Shinobi heroes earn bonus season XP, and Sakura Valley comes up most in Random.' },
  { id: 2, name: 'Frostfang', start: '2027-02-01', end: '2027-04-15', map: 'frost', clan: 'iron', color: '#8fd3ff',
    blurb: 'Winter holds the pass. Iron heroes earn bonus season XP, and Frostfang Pass comes up most in Random.' },
  { id: 3, name: 'Wildfire', start: '2027-04-16', end: '2027-06-30', map: 'ember', clan: 'wild', color: '#ff9a4a',
    blurb: 'The canyon burns. Wild heroes earn bonus season XP, and Ember Canyon comes up most in Random.' },
  { id: 4, name: 'Spirit Tide', start: '2027-07-01', end: '2027-09-15', map: 'sakura', clan: 'spirit', color: '#b48cff',
    blurb: 'The shrines overflow. Spirit heroes earn bonus season XP.' },
  { id: 5, name: 'Beast Moon', start: '2027-09-16', end: '2027-11-30', map: 'frost', clan: 'beast', color: '#9be36f',
    blurb: 'Something howls in the jungle. Beast heroes earn bonus season XP.' },
];
const day = (s) => Date.parse(s + 'T00:00:00Z');
export function seasonAt(now = Date.now()) {
  let s = SEASONS[0];
  for (const x of SEASONS) if (now >= day(x.start)) s = x;
  return s;
}
export function daysLeft(s, now = Date.now()) { return Math.max(0, Math.ceil((day(s.end) + 86400000 - now) / 86400000)); }

// Ranks (Ranked Points). Each tier has three divisions except the top one.
export const TIERS = [
  { id: 'ronin', name: 'Ronin', min: 0, icon: 'items/BarIron', color: '#b9b2c4' },
  { id: 'samurai', name: 'Samurai', min: 300, icon: 'items/BarSilver', color: '#cfe3ff' },
  { id: 'daimyo', name: 'Daimyo', min: 700, icon: 'items/BarGold', color: '#ffd84a' },
  { id: 'shogun', name: 'Shogun', min: 1200, icon: 'items/GemRed', color: '#ff6b6b' },
  { id: 'kami', name: 'Kami-touched', min: 1800, icon: 'items/GemPurple', color: '#c99bff' },
];
export function rankOf(rp) {
  let i = 0; for (let k = 0; k < TIERS.length; k++) if (rp >= TIERS[k].min) i = k;
  const t = TIERS[i], next = TIERS[i + 1];
  if (!next) return { tier: t, idx: i, div: '', label: t.name, into: rp - t.min, span: 0, next: null };
  const span = next.min - t.min, d = Math.min(2, Math.floor((rp - t.min) / (span / 3)));
  return { tier: t, idx: i, div: ['III', 'II', 'I'][d], label: `${t.name} ${['III', 'II', 'I'][d]}`, into: rp - t.min, span, next };
}
// RP per result: [win, loss]
export const RP = { ai0: [8, -14], ai1: [18, -14], ai2: [26, -12], online: [24, -18], cup: [20, -10] };
// Easy AI can only carry you so far.
export const RP_CAP = { ai0: 299, ai1: 1199 };

// Season pass: XP per match and the reward track.
export const XP_PER_LEVEL = 300;
export const MAX_LEVEL = 20;
export const MATCH_XP = { win: 120, loss: 70, perGoodCall: 15, goodCallCap: 60, featuredHero: 10, cup: 50 };

// Cosmetics. Skins are palette shifts of a hero's sprite (recolor() options).
export const SKINS = {
  base: { name: 'Classic', recolor: null, swatch: '#9a8c7a' },
  spirit: { name: 'Spirit', recolor: { hue: 165, sat: 1.1 }, swatch: '#5ad4c8' },
  shadow: { name: 'Shadow', recolor: { hue: 250, sat: 0.55, light: -0.12 }, swatch: '#4a3f6a' },
  gilded: { name: 'Gilded', recolor: { hue: 35, sat: 1.4, light: 0.05 }, swatch: '#e8b84a' },
  frost: { name: 'Frostbitten', recolor: { hue: 195, sat: 0.45, light: 0.12 }, swatch: '#a8dcf0' },
  crimson: { name: 'Crimson', recolor: { hue: -25, sat: 1.5, light: -0.04 }, swatch: '#d8404a' },
  sakura: { name: 'Sakura', recolor: { hue: 300, sat: 0.9, light: 0.1 }, swatch: '#f4a6d0' },
};
export const BANNERS = {
  plain: { name: 'Wanderer', bg: 'linear-gradient(135deg, #2a2236, #1a1522)' },
  sakura: { name: 'Sakura', bg: 'linear-gradient(135deg, #5a2440, #2a1530 60%, #3a1a2a)' },
  ember: { name: 'Ember', bg: 'linear-gradient(135deg, #6a2a10, #2a1208 60%, #4a1a08)' },
  night: { name: 'Night Sky', bg: 'radial-gradient(circle at 70% 20%, #3a4a8a, #12142a 60%)' },
  jade: { name: 'Jade', bg: 'linear-gradient(135deg, #1a5a44, #0e2a22 60%, #1a3a2a)' },
  gold: { name: 'Golden Cup', bg: 'linear-gradient(135deg, #8a6a1a, #3a2a08 55%, #6a4a10)' },
};
export const TITLES = {
  rookie: 'Rookie Coach', shotcaller: 'Shotcaller', whisperer: 'Kami Whisperer', tamer: 'Oni Tamer', tactician: 'Grand Tactician',
  legend1: 'Legend of Blossom Rising', champ: 'Cup Champion', tripleChamp: 'Three-Cup Dynasty',
};
// Season 1 track: level → reward.
export const TRACK = {
  2: { kind: 'title', id: 'shotcaller' },
  3: { kind: 'skin', id: 'spirit' },
  5: { kind: 'banner', id: 'sakura' },
  6: { kind: 'skin', id: 'sakura' },
  8: { kind: 'title', id: 'whisperer' },
  9: { kind: 'skin', id: 'shadow' },
  11: { kind: 'banner', id: 'ember' },
  12: { kind: 'skin', id: 'frost' },
  14: { kind: 'title', id: 'tamer' },
  15: { kind: 'banner', id: 'night' },
  17: { kind: 'skin', id: 'crimson' },
  18: { kind: 'banner', id: 'jade' },
  19: { kind: 'title', id: 'tactician' },
  20: { kind: 'skin', id: 'gilded', also: { kind: 'title', id: 'legend1' } },
};
export function rewardName(r) {
  if (!r) return '';
  if (r.kind === 'skin') return `${SKINS[r.id].name} skin`;
  if (r.kind === 'banner') return `${BANNERS[r.id].name} banner`;
  if (r.kind === 'title') return `Title: ${TITLES[r.id]}`;
  return '';
}
