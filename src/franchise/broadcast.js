// Pro League broadcasts: a featured match, played out as a full 5v5 between the AI coaches for the Theater.
// The league result comes from the quick model (src/franchise/pro.js); the broadcast must show the same
// winner, so the official winner's heroes carry a small extra edge and the first broadcast seed (try 0, 1, …)
// whose full sim agrees is used. The search runs off the main thread (broadcast-worker.js) and its answer is
// cached, so everyone who watches sees the same game. Pure + deterministic.
import { aiPrep } from '../sim/draft.js';
import { MAPS } from '../maps/defs.js';
import { ROLES } from '../data/heroes.js';
import { PRO_TEAMS } from './data.js';
import { proWeek } from './pro.js';
import { hseed, clamp } from './model.js';

export const BROADCAST_EDGE = 0.1; // extra edge for the side the league says won
export const MAX_TRIES = 8;
export function broadcastCfg(w, day, idx, tries = 0) {
  const L = proWeek(w), m = L.days[day].matches[idx];
  const ids = [L.lineups[m.a], L.lineups[m.b]], won = m.w;
  const teams = [0, 1].map((s) => {
    const p = aiPrep(ids[s], ids[1 - s]), base = L.str[s === 0 ? m.a : m.b] + (s === won ? BROADCAST_EDGE : 0);
    p.heroes.forEach((hp, i) => { hp.role = ROLES[i]; hp.mod = clamp(Math.round(base * 1000) / 1000, -0.1, 0.1); });
    return { heroes: p.heroes, plan: p.plan, deck: p.deck, name: PRO_TEAMS[s === 0 ? m.a : m.b].name };
  });
  const seed = hseed(m.seed, tries, 0xb40ad) >>> 1;
  return { seed, map: MAPS[seed % MAPS.length].id, teams, coach: [true, true], coachLevel: [2, 2] };
}
