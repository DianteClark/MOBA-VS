// Coach skill tree sidegrades and hero mastery perks (sim side). Everything here is gated by the match config,
// so a match without them runs exactly as before:
//   * tactic cards War Drums / Stone Skin / Foxfire: ordinary deck ids (cfg.teams[t].deck)
//   * Coach Moment variants: cfg.teams[t].mv = { rally: 'bulwark', timeout: 'huddle', push: 'march' } (any subset)
//   * mastery perks: cfg.perks = [{ heroId: perkId }, { ... }], set only for matches against the AI outside
//     ranked online, cups and online casual (src/meta.js perksFor); tools/verify.mjs rejects them in ranked/cup replays.
// Sidegrades trade shape, not strength: each mirrors a classic card or moment with the same overall value.
import { sec } from './constants.js';
import { PERKS } from '../data/meta.js';

export const MOMENT_VARIANTS = {
  huddle: { slot: 'timeout', name: 'Huddle', icon: 'Heal', color: '#7affc8', short: 'Heal 16%, steady 6s',
    desc: 'Everyone heals 16% HP at once, shakes off slows and gains 25% tenacity for 6s. No cooldown reset.' },
  bulwark: { slot: 'rally', name: 'Hold the Line', icon: 'DefenseUpgrade', color: '#8fd3ff', short: '-15% dmg taken, +15% AS 6s',
    desc: 'The whole team takes 15% less damage and attacks 15% faster for 6s, and shakes off slows.' },
  march: { slot: 'push', name: 'Long March', icon: 'Upgrade', color: '#ffb04a', short: 'Side waves empowered x2',
    desc: 'Your next two minion waves in both side lanes march empowered (+50% HP, damage and armor), without a super minion. Pressure the map instead of one push.' },
};
// Sanitized variant map for a team config: only known variants in their own slot.
export function momentVariants(mv) {
  if (!mv || typeof mv !== 'object') return null;
  const out = {};
  for (const [slot, v] of Object.entries(mv)) if (MOMENT_VARIANTS[v] && MOMENT_VARIANTS[v].slot === slot) out[slot] = v;
  return Object.keys(out).length ? out : null;
}
// Display data for a moment slot as a team runs it (base moment or its variant). base: MOMENTS from moments-coach.js.
export const momentAs = (base, team, slot) => (team && team.mv && team.mv[slot] ? MOMENT_VARIANTS[team.mv[slot]] : base[slot]);

// A variant fired from applyMoment (readiness already checked). Returns false if it could not fire.
export function applyVariant(g, team, v, alive) {
  if (v === 'huddle') {
    if (!alive.length) return false;
    for (const h of alive) { g.heal(h, h.maxHp * 0.16, null); h.slows = []; g.addBuff(h, { tenacity: 0.25 }, 6, 'huddle'); g.fx.push({ kind: 'fx', name: 'spirit', x: h.x, y: h.y, s: 1.5, follow: h.id }); }
  } else if (v === 'bulwark') {
    if (!alive.length) return false;
    for (const h of alive) { g.addBuff(h, { drPct: 0.15, asPct: 0.15 }, 6, 'bulwark'); h.slows = []; g.fx.push({ kind: 'shield', id: h.id }); }
  } else if (v === 'march') {
    const L = g.world.laneNames, side = L.length > 1 ? L.filter((ln) => ln !== 'mid') : L; // one-lane maps: that lane
    for (const ln of side) team.siegeWaves[ln] = Math.max(team.siegeWaves[ln] || 0, 2);
    const nx = g.world.nexus[team.id];
    g.fx.push({ kind: 'fx', name: 'boost', x: nx.x, y: nx.y, s: 2.4 });
  } else return false;
  return true;
}

// Skill-tree tactic cards (from Game.playTactic). Returns false for unknown cards or when nothing can happen.
export function playSkillTactic(g, c, team, alive) {
  const now = g.tick;
  switch (c.card) {
    case 'drums':
      if (!alive.length) return false;
      for (const h of alive) { g.addBuff(h, { dmgPct: 0.1, msPct: 0.05 }, 10, 'drums'); g.fx.push({ kind: 'fx', name: 'boost', x: h.x, y: h.y, s: 1.2, follow: h.id }); }
      return true;
    case 'stone':
      if (!alive.length) return false;
      for (const h of alive) { g.addBuff(h, { drPct: 0.15 }, 6, 'stone'); g.fx.push({ kind: 'shield', id: h.id }); }
      return true;
    case 'foxfire':
      for (const e of g.teams[1 - c.team].heroes) if (e.alive) { e.revealUntil = Math.max(e.revealUntil, now + sec(9)); e.stealthUntil = 0; }
      return true;
    default: return false;
  }
}
// The AI coach plays the skill cards in the same spots as their classic twins (from Coach.useTactics).
export function aiSkillTactic(has, play, { fighting, vis, avgHp, obj, call }) {
  if (has('drums') && fighting >= 3 && vis.length >= 3) return play({ card: 'drums' });
  if (has('stone') && fighting >= 3 && avgHp < 0.6) return play({ card: 'stone' });
  if (has('foxfire') && obj && call && call.type === 'objective') return play({ card: 'foxfire' });
  return false;
}

// Mastery perk of a hero in this match (cfg.perks[team][heroId]), or null.
export function perkOf(cfg, team, heroId) {
  const p = cfg.perks && cfg.perks[team] && cfg.perks[team][heroId];
  return p && PERKS[p] ? p : null;
}
// Adds a perk's stats in Game.recalc.
export function addPerk(s, perk) { const st = PERKS[perk].stats; for (const k in st) s[k] = (s[k] || 0) + st[k]; }
