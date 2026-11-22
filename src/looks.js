// A coach's "looks" for online sessions: equipped hero skins, signature emote, banner and border, plus the
// Bosses & Beasts choices: minion family (troop) and scout animal (pet).
// Sent in the hello / start / rematch metadata (never through the sim or its command log) so the opponent
// sees your skins in the match and your emote on the results. Everything received is re-validated here.
import { HERO_BY_ID } from './data/heroes.js';
import { SKINS, BANNERS } from './data/seasons.js';
import { EMOTES, BORDERS } from './data/cosmetics.js';
import { profile } from './profile.js';
import { skinFor, skinFaceUrl } from './render/skins.js';
import { FAMILIES, PETS, hasPet, hasFamily, aiPet, RIVAL_PET } from './data/beasts.js';

export function myLooks() {
  const p = profile;
  return { skins: p.skinsFor(Object.keys(p.d.equip.skins)), emote: p.emote, banner: p.d.equip.banner, border: p.border, ...myBeasts() };
}
// The equipped scout animal and minion family (only ones the profile owns; no family = the map's own).
export function myBeasts(event) {
  const e = profile.d.equip;
  return { pet: hasPet(profile, e.pet) ? e.pet : 'dog', troop: e.troop && hasFamily(profile, e.troop, event) ? e.troop : null };
}
// Hero → skin map with only known heroes and skins that fit them.
export function cleanSkins(x) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  for (const [id, k] of Object.entries(x).slice(0, 80)) if (HERO_BY_ID[id] && typeof k === 'string' && SKINS[k] && skinFor(id, k)) out[id] = k;
  return out;
}
export function cleanLooks(x) {
  if (!x || typeof x !== 'object') return null;
  const key = (v, table) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(table, v) ? v : null);
  return { skins: cleanSkins(x.skins), emote: key(x.emote, EMOTES), banner: key(x.banner, BANNERS), border: key(x.border, BORDERS), ...cleanBeasts(x) };
}
// The skins each team shows in a match: own team from the profile (via its prep); the other side from its prep,
// else its hello looks. Restricted to the heroes actually in the match.
export function matchSkins(s) {
  return [0, 1].map((t) => {
    const prep = s.preps && s.preps[t], picks = (prep && prep.heroes ? prep.heroes.map((x) => x.id || x.heroId || x) : []).filter((id) => typeof id === 'string');
    const src = cleanSkins(prep && prep.skins), fb = t !== s.myTeam && s.oppLooks ? s.oppLooks.skins : {};
    const out = {};
    for (const id of picks.length ? picks : Object.keys(src)) { const k = src[id] || fb[id]; if (k) out[id] = k; }
    return out;
  });
}
// Portrait overrides for every skinned hero in the match (both teams' heroes are distinct).
export function faceMap(skinsByTeam) {
  const out = {};
  for (const m of skinsByTeam || []) for (const [id, k] of Object.entries(m || {})) { const u = skinFaceUrl(id, k); if (u) out[id] = u; }
  return out;
}
// { pet, troop } with known ids only.
export function cleanBeasts(x) {
  const key = (v, table) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(table, v) ? v : null);
  return { pet: x && key(x.pet, PETS), troop: x && key(x.troop, FAMILIES) };
}
// Each team's beast looks in a match: mine from the profile; an online opponent's from their looks; an AI coach
// (or a rival) brings a fixed animal and the map's own family.
export function matchBeasts(s) {
  return [0, 1].map((t) => {
    if (t === s.myTeam) return myBeasts(s.event);
    if (s.oppLooks && (s.oppLooks.pet || s.oppLooks.troop)) return cleanBeasts(s.oppLooks);
    return { pet: (s.rival && RIVAL_PET[s.rival]) || aiPet(s.seed || 0, t), troop: null };
  });
}
