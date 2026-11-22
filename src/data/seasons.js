// Seasons: themes, ranks and the reward track.
import { HERO_SKINS, legKey } from './skins.js';
import { EMOTES, BANNERS_EXTRA, BORDERS } from './cosmetics.js';
import { S2_SKINS, S2_TITLES, TRACK2 } from './season2.js';
import { META_TITLES, META_SKINS } from './meta.js';
// Dates are UTC days. The season balancer (tools/season.mjs + .github/workflows/season.yml)
// re-tunes heroes when a season ends and appends patch notes (src/data/patchnotes.js).
// art: the season's look in menus (Today panel, pass, ceremony): a backdrop gradient, an accent and a motif.
// pass: the reward track it uses (TRACKS below); a season without its own reuses the newest one.
export const SEASONS = [
  { id: 1, name: 'Blossom Rising', start: '2026-11-20', end: '2027-01-31', map: 'sakura', clan: 'shinobi', color: '#ff9ec7', pass: 1,
    art: { bg: 'linear-gradient(135deg, #5a2440, #2a1530 60%, #3a1a2a)', motif: 'petals' },
    blurb: 'The valley wakes. Shinobi heroes earn bonus season XP, and Sakura Valley comes up most in Random.' },
  { id: 2, name: 'Yokai Moon', start: '2027-02-01', end: '2027-04-15', map: 'marsh', clan: 'spirit', color: '#b9a2ff', pass: 2,
    art: { bg: 'radial-gradient(circle at 84% 22%, #fff6dc 0 7%, #c9b8ff 9%, #3a2470 30%, #140c2a 75%)', motif: 'lanterns' },
    blurb: 'A pale moon rises over the marsh and the night parade begins. Spirit heroes earn bonus season XP, Moonlit Marsh comes up most in Random, and three story weeks bring the yokai out.',
    highlights: ['A 30-tier Yokai Moon pass', 'Three story weeks with their own rewards', 'Four new Legendary skins'] },
  { id: 3, name: 'Wildfire', start: '2027-04-16', end: '2027-06-30', map: 'ember', clan: 'wild', color: '#ff9a4a',
    art: { bg: 'linear-gradient(135deg, #6a2a10, #2a1208 60%, #4a1a08)', motif: 'embers' },
    blurb: 'The canyon burns. Wild heroes earn bonus season XP, and Ember Canyon comes up most in Random.' },
  { id: 4, name: 'Frostfang', start: '2027-07-01', end: '2027-09-15', map: 'frost', clan: 'iron', color: '#8fd3ff',
    art: { bg: 'linear-gradient(135deg, #1c3a7a, #0c1430 60%, #3a6ac0)', motif: 'snow' },
    blurb: 'Winter holds the pass. Iron heroes earn bonus season XP, and Frostfang Pass comes up most in Random.' },
  { id: 5, name: 'Beast Hunt', start: '2027-09-16', end: '2027-11-30', map: 'ruins', clan: 'beast', color: '#9be36f',
    art: { bg: 'linear-gradient(135deg, #1a5a44, #0e2a22 60%, #1a3a2a)', motif: 'leaves' },
    blurb: 'Something howls in the ruins. Beast heroes earn bonus season XP, and Mossgate Ruins comes up most in Random.' },
];
const day = (s) => Date.parse(s + 'T00:00:00Z');
export function seasonAt(now = Date.now()) {
  let s = SEASONS[0];
  for (const x of SEASONS) if (now >= day(x.start)) s = x;
  return s;
}
export const seasonById = (id) => SEASONS.find((x) => x.id === id) || null;
export function daysLeft(s, now = Date.now()) { return Math.max(0, Math.ceil((day(s.end) + 86400000 - now) / 86400000)); }

// Ranked tiers (Bronze → Kami) are derived from the season Elo rating: see ranks.js.
export { TIERS, rankOf } from './ranks.js';

// Season pass: XP per match and the reward tracks (Season 1: 20 tiers, Season 2 on: 30).
export const XP_PER_LEVEL = 300;
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
  // ranked season rewards
  platinum: { name: 'Platinum', recolor: { hue: 150, sat: 0.7, light: 0.08 }, swatch: '#5fe0c8' },
  master: { name: 'Master', recolor: { hue: 260, sat: 1.2, light: 0.02 }, swatch: '#b48cff' },
  kami: { name: 'Kami Radiance', recolor: { hue: -15, sat: 1.25, light: 0.14 }, swatch: '#ff9ab0' },
  ...S2_SKINS, ...META_SKINS, // Season 2 pass tints, prestige and coach skill tree tints
  // hero mastery tints (per hero: Mastery 6 and 10, see src/mastery.js)
  mastery: { name: 'Mastery Jade', recolor: { hue: 120, sat: 1.15, light: 0.04 }, swatch: '#6fdc8c', mastery: 6 },
  sensei: { name: 'Sensei Gold', recolor: { hue: 45, sat: 1.5, light: 0.12 }, swatch: '#ffe08a', mastery: 10 },
};
// Unique hero skins (Signature: hero mastery; Legendary: achievements, pass, rank): src/data/skins.js
Object.assign(SKINS, HERO_SKINS);
export const BANNERS = {
  plain: { name: 'Wanderer', bg: 'linear-gradient(135deg, #2a2236, #1a1522)' },
  sakura: { name: 'Sakura', bg: 'linear-gradient(135deg, #5a2440, #2a1530 60%, #3a1a2a)' },
  ember: { name: 'Ember', bg: 'linear-gradient(135deg, #6a2a10, #2a1208 60%, #4a1a08)' },
  night: { name: 'Night Sky', bg: 'radial-gradient(circle at 70% 20%, #3a4a8a, #12142a 60%)' },
  jade: { name: 'Jade', bg: 'linear-gradient(135deg, #1a5a44, #0e2a22 60%, #1a3a2a)' },
  gold: { name: 'Golden Cup', bg: 'linear-gradient(135deg, #8a6a1a, #3a2a08 55%, #6a4a10)' },
  rankGold: { name: 'Gold Ascent', bg: 'linear-gradient(160deg, #6a4a10, #2a1d06 50%, #8a6a1a 90%)' },
  rankDiamond: { name: 'Diamond Sky', bg: 'linear-gradient(160deg, #1c3a7a, #0c1430 55%, #3a6ac0)' },
  rankKami: { name: 'Kami Ascendant', bg: 'radial-gradient(circle at 30% 20%, #ff9ab0, #6a1030 45%, #1a0610 80%)' },
};
Object.assign(BANNERS, BANNERS_EXTRA); // achievement banners (src/data/cosmetics.js)
export const TITLES = {
  rookie: 'Rookie Coach', shotcaller: 'Shotcaller', whisperer: 'Kami Whisperer', tamer: 'Oni Tamer', tactician: 'Grand Tactician',
  legend1: 'Legend of Blossom Rising', champ: 'Cup Champion', tripleChamp: 'Three-Cup Dynasty',
  rankSilver: 'Silver Strategist', rankDiamond: 'Diamond Mind', rankMaster: 'Master Coach', rankKami: 'Kami Ascendant',
  ...S2_TITLES, ...META_TITLES,
};
// Season 1 track: level → reward.
const TRACK = {
  2: { kind: 'title', id: 'shotcaller' },
  3: { kind: 'skin', id: 'spirit' },
  4: { kind: 'skin', id: legKey('kaze') },
  5: { kind: 'banner', id: 'sakura' },
  6: { kind: 'skin', id: 'sakura' },
  7: { kind: 'emote', id: 'wink' },
  8: { kind: 'title', id: 'whisperer' },
  9: { kind: 'skin', id: 'shadow' },
  10: { kind: 'skin', id: legKey('sling') },
  11: { kind: 'banner', id: 'ember' },
  12: { kind: 'skin', id: 'frost' },
  13: { kind: 'emote', id: 'smug' },
  14: { kind: 'title', id: 'tamer' },
  15: { kind: 'banner', id: 'night' },
  16: { kind: 'skin', id: legKey('brawlo') },
  17: { kind: 'skin', id: 'crimson' },
  18: { kind: 'banner', id: 'jade' },
  19: { kind: 'title', id: 'tactician' },
  20: { kind: 'skin', id: 'gilded', also: { kind: 'title', id: 'legend1' } },
};
export const TRACKS = { 1: TRACK, 2: TRACK2 };
// The pass of a season: { id, track, max } (a season without a track of its own reuses the newest one).
export function passOf(s) {
  const ids = Object.keys(TRACKS).map(Number), id = s && TRACKS[s.pass] ? s.pass : Math.max(...ids.filter((k) => !s || k <= s.id));
  const track = TRACKS[id]; return { id, track, max: Math.max(...Object.keys(track).map(Number)) };
}
// Where a reward comes from on a pass: 'Season 2 Pass level 12' (or null).
export function passSource(same) {
  for (const [sid, t] of Object.entries(TRACKS)) { const l = Object.entries(t).find(([, r]) => same(r)); if (l) return `Season ${sid} Pass level ${l[0]}`; }
  return null;
}
export function rewardName(r) {
  if (!r) return '';
  if (r.kind === 'skin') return SKINS[r.id].hero ? `${SKINS[r.id].name} (${SKINS[r.id].tier === 'legendary' ? 'Legendary' : 'Signature'} skin)` : `${SKINS[r.id].name} skin`;
  if (r.kind === 'emote') return `${(EMOTES[r.id] || { name: r.id }).name} emote`;
  if (r.kind === 'banner') return `${BANNERS[r.id].name} banner`;
  if (r.kind === 'title') return `Title: ${TITLES[r.id] || r.name || r.id}`;
  if (r.kind === 'border') return `${BORDERS[r.id] ? BORDERS[r.id].name : r.id[0].toUpperCase() + r.id.slice(1)} border`;
  return '';
}
