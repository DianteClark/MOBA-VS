// Coach talent preferences per hero (v23): which of the 2 talents each hero takes at levels 4, 8 and 12.
// Stored in the profile as d.tal = { heroId: [p4, p8, p12] } with 0 / 1, or -1 for "the hero decides"
// (only heroes with at least one set tier are kept, so the profile stays small). Edited in the Dojo
// (hero page and lineups); prep copies them into each hero's match setup, where they can still change.
import { profile } from './profile.js';
import { HERO_BY_ID } from './data/heroes.js';
import { cleanPrefs } from './data/talents.js';

const store = () => {
  const d = profile.d;
  if (!d.tal || typeof d.tal !== 'object' || Array.isArray(d.tal)) d.tal = {};
  return d.tal;
};
export function heroPrefs(id) { return cleanPrefs(store()[id]); }
export function setHeroPref(id, tier, pick) {
  if (!HERO_BY_ID[id] || tier < 0 || tier > 2) return;
  const all = store(), p = cleanPrefs(all[id]);
  p[tier] = pick === 0 || pick === 1 ? pick : -1;
  if (p.every((v) => v < 0)) delete all[id]; else all[id] = p;
  for (const k of Object.keys(all)) if (!HERO_BY_ID[k]) delete all[k]; // removed heroes
  profile.save();
}
