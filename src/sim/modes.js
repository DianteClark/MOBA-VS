// Match rules per game mode. The classic 5v5 uses the global constants unchanged; side modes
// override pacing, economy and timers. Everything here is plain data read by the deterministic sim
// (cfg.mode travels inside the match config, so lockstep peers and replays agree on it).
import { T, FINAL, HALFTIME, PACE, MATCH_SECONDS } from './constants.js';
import { EVENT_BY_ID } from '../data/events.js';

export const MODE_INFO = {
  classic: { name: '5v5 Classic', short: '5v5', blurb: 'Three lanes, the full jungle and every objective. 15 minutes.' },
  rush: { name: 'Lane Rush', short: 'Rush', blurb: 'One lane, all ten heroes, fast gold. First Crystal in about 7 minutes.' },
};

const CLASSIC = {
  id: 'classic', seconds: MATCH_SECONDS, halftime: HALFTIME.at, final: FINAL, pace: PACE, T,
  gold: 1, xp: 1, startGold: null, startLevel: 1, respawn: 1, towerHp: 1, minionSiege: 1, timeScale: 1, k: 1,
  // weekly-event knobs (src/data/events.js); 1 / null = Classic
  event: null, killGold: 1, minionGold: 1, vision: 1, heroMs: 1, kamiPower: 1, shrine: null,
};

// Single Lane Rush: 5v5 in one short lane. Faster economy, short respawns, an early Kami and a
// Kraken at 3:00 so games end at a Crystal around 6-8 minutes (tower count decides at 8:00).
const RUSH = {
  id: 'rush', seconds: 480, halftime: null,
  final: { at: 300, gold: 1.5, respawn: 1.8 },
  pace: { rampFrom: 90, rampPer: 110, lateFrom: 300, latePer: 40, siegeAllFrom: 150, wrathFrom: 240, backdoorOffFrom: 300 },
  T: { ...T, firstWave: 5, waveEvery: 16, siegeEvery: 2, dragonFirst: 60, dragonRespawn: 75, elderRespawn: 90, heraldFirst: 0, heraldDespawn: 0,
    baronFirst: 180, baronRespawn: 90, baronBuff: 60, shrineUnlock: 30, inhibRespawn: 120, weatherPhase: 120, campFirst: 20 },
  event: null, killGold: 1, minionGold: 1, vision: 1, heroMs: 1, kamiPower: 1, shrine: null,
  gold: 1.7, xp: 1.6, startGold: 1400, startLevel: 3, respawn: 0.8, towerHp: 0.42, minionSiege: 2, timeScale: 1.9,
  // k: scale for "game clock" thresholds written for a 15-minute match (AI coach timings)
  k: 480 / 900,
};

export const RULES = { classic: CLASSIC, rush: RUSH };
// Weekly events only touch the classic 5v5: their modifiers merge into a copy of its rules (the shared
// CLASSIC object is never changed). An unknown or missing event id plays plain Classic.
export function rulesFor(mode, event) {
  const base = RULES[mode] || CLASSIC, ev = base === CLASSIC && event ? EVENT_BY_ID[event] : null;
  if (!ev || !ev.rules) return ev ? { ...base, event: ev.id } : base;
  const r = ev.rules;
  return { ...base, ...r, event: ev.id, T: r.T ? { ...base.T, ...r.T } : base.T, towerHp: base.towerHp * (r.towerHp || 1) };
}
