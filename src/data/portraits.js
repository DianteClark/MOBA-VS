// Profile pictures: any owned champion's portrait, or a monster / boss portrait earned in play.
// Stored as d.equip.pfp = 'h:<heroId>' | 'm:<portraitId>' (null = the default). Tallies for the monster
// portraits live in d.pfp.c (known keys only, bounded numbers) and ride along with the cloud save.
// Shown on the coach card, the profile, the leaderboard, friends, the party panel and the results.
import { kamiFace, monFace, unlocked } from './beasts.js';
import { KAMI, KAMI_IDS } from '../sim/beasts.js';
import { HERO_BY_ID } from './heroes.js';
import { ownsIn } from './unlocks.js';

export const PFP_N = 10; // tallies needed for a Kami / Elder / Oni / Kraken portrait
const boss = (k) => `assets/img/boss/${k}_faceset.png`;
// unlock: { tally: key, n } (a counter in d.pfp.c), { win: key } (a flag), or a beasts.js unlock ({ pass }, { ach }, { mastery }, { club })
export const PORTRAITS = {
  ...Object.fromEntries(KAMI_IDS.map((sp) => [`kami_${sp}`, { name: KAMI[sp].name, src: kamiFace(sp), unlock: { tally: `k:${sp}`, n: PFP_N }, how: `Take ${PFP_N} ${KAMI[sp].name}` }])),
  ...Object.fromEntries(KAMI_IDS.map((sp) => [`elder_${sp}`, { name: KAMI[sp].elder, src: kamiFace(sp, true), unlock: { tally: `e:${sp}`, n: PFP_N }, how: `Slay the ${KAMI[sp].elder} ${PFP_N} times` }])),
  oni: { name: 'Oni', src: boss('herald'), unlock: { tally: 'oni', n: PFP_N }, how: `Take the Oni ${PFP_N} times` },
  kraken: { name: 'Kraken', src: boss('baron'), unlock: { tally: 'kraken', n: PFP_N }, how: `Slay the Kraken ${PFP_N} times` },
  oni_rare: { name: 'Crimson Oni', src: boss('oni_rare'), unlock: { win: 'oniRare' }, how: 'Win a match where a rare Oni woke' },
  kraken_rare: { name: 'Abyssal Kraken', src: boss('kraken_rare'), unlock: { win: 'krakenRare' }, how: 'Win a match where a rare Kraken woke' },
  yokai: { name: 'Night Yokai', src: boss('yokai'), unlock: { win: 'night' }, how: 'Win a match that ends at night' },
  mascot: { name: 'Club Mascot', src: monFace('Beast'), unlock: { club: true }, how: 'Club goals or a Club War win' },
  dragon: { name: 'Mastery Dragon', src: monFace('Dragon'), unlock: { mastery: 3 }, how: '3 heroes at Mastery 5' },
  owl: { name: 'Pass Owl', src: monFace('Owl'), unlock: { pass: 20 }, how: 'Season Pass level 20' },
};
export const PORTRAIT_IDS = Object.keys(PORTRAITS);
export const DEFAULT_PFP = 'h:upa';
const TALLY_KEYS = new Set(PORTRAIT_IDS.map((k) => PORTRAITS[k].unlock.tally).filter(Boolean)), WIN_KEYS = new Set(PORTRAIT_IDS.map((k) => PORTRAITS[k].unlock.win).filter(Boolean));

// Sanitize d.pfp and the equipped picture (it must still be owned / earned).
export function cleanPfp(d) {
  const v = d.pfp && typeof d.pfp === 'object' ? d.pfp : {}, c = {}, w = {};
  for (const [k, n] of Object.entries(v.c && typeof v.c === 'object' ? v.c : {})) if (TALLY_KEYS.has(k)) c[k] = Math.max(0, Math.min(9999, Math.round(Number(n) || 0)));
  for (const k of Object.keys(v.w && typeof v.w === 'object' ? v.w : {})) if (WIN_KEYS.has(k) && v.w[k]) w[k] = 1;
  d.pfp = { c, w };
  if (d.equip && d.equip.pfp !== undefined && !validPfp(d.equip.pfp)) delete d.equip.pfp;
}
const validPfp = (id) => typeof id === 'string' && (/^h:/.test(id) ? !!HERO_BY_ID[id.slice(2)] : /^m:/.test(id) && !!PORTRAITS[id.slice(2)]);
// Tally progress toward a monster portrait: { have, n } (flags: 0/1 of 1; profile unlocks: 0/1 of 1).
export function portraitProgress(P, id) {
  const u = PORTRAITS[id] && PORTRAITS[id].unlock, d = P.d.pfp || { c: {}, w: {} };
  if (!u) return { have: 0, n: 1 };
  if (u.tally) return { have: Math.min(u.n, d.c[u.tally] || 0), n: u.n };
  if (u.win) return { have: d.w[u.win] ? 1 : 0, n: 1 };
  return { have: unlocked(P, u) ? 1 : 0, n: 1 };
}
export const hasPortrait = (P, id) => { const g = portraitProgress(P, id); return g.have >= g.n; };
// Can this coach wear the picture? Champions they own; monster portraits they earned.
export function canWear(P, pfp) {
  if (!validPfp(pfp)) return false;
  return pfp[0] === 'h' ? ownsIn(P.d.koban, pfp.slice(2)) : hasPortrait(P, pfp.slice(2));
}
export const myPfp = (P) => { const e = P.d.equip.pfp; return e && canWear(P, e) ? e : DEFAULT_PFP; };
// Image of any picture id (from another coach too: unknown ids fall back to the default).
export function pfpSrc(pfp) {
  const id = validPfp(pfp) ? pfp : DEFAULT_PFP;
  return id[0] === 'h' ? `assets/img/faces/${id.slice(2)}.png` : PORTRAITS[id.slice(2)].src;
}
export const pfpName = (pfp) => (validPfp(pfp) ? (pfp[0] === 'h' ? HERO_BY_ID[pfp.slice(2)].name : PORTRAITS[pfp.slice(2)].name) : 'Coach');
export const cleanPfpId = (pfp) => (validPfp(pfp) ? pfp : null);

// After a coached match (Profile.record): Kami / Elder / Oni / Kraken tallies for my team; rare-spawn and night
// wins. Returns the portraits newly earned by this match.
export function trackPortraits(P, game, my, won) {
  const before = new Set(PORTRAIT_IDS.filter((id) => hasPortrait(P, id)));
  const d = P.d.pfp || (P.d.pfp = { c: {}, w: {} }), add = (k) => { if (TALLY_KEYS.has(k)) d.c[k] = Math.min(9999, (d.c[k] || 0) + 1); };
  for (const e of game.events) {
    if (e.type !== 'objective' || e.team !== my) continue;
    if (e.obj === 'dragon' && KAMI[e.element]) add(`k:${e.element}`);
    else if (e.obj === 'boss' && KAMI[e.element]) add(`e:${e.element}`);
    else if (e.obj === 'herald') add('oni');
    else if (e.obj === 'baron') add('kraken');
  }
  if (won) {
    if (game.events.some((e) => e.type === 'spawn' && e.obj === 'herald' && e.rare)) d.w.oniRare = 1;
    if (game.events.some((e) => e.type === 'spawn' && e.obj === 'baron' && e.rare)) d.w.krakenRare = 1;
    if (game.living && game.living.night) d.w.night = 1;
  }
  return PORTRAIT_IDS.filter((id) => !before.has(id) && hasPortrait(P, id));
}
