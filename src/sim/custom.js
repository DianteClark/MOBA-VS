// Custom games (private rooms, pass-and-play, practice vs AI): rule toggles that travel in the match config as
// `cfg.custom`, so both lockstep peers, replays and tools/verify.mjs play exactly the same rules. Plain data read
// by the deterministic sim; a match without cfg.custom is bit-identical to one from before this file existed.
// Custom games are never rated, never reported to a ladder and never count for divisions, clubs or goals.
//   gold2    Double gold: every gold source pays twice.
//   respawn  Fast respawns: death timers are halved.
//   backdoor No backdoor protection: towers take full damage without minions from the start.
//   random   All Random: no draft, each side gets a seeded random lineup (one hero per role).
//   single   Single lane: the match plays on a Lane Rush map (all ten heroes in one lane, mid only).
// The map and the weekly event are chosen in the room and ride in cfg.map / cfg.event as usual.
import { Rng } from './rng.js';
import { HEROES, ROLES } from '../data/heroes.js';
import { DRAFT_ORDER } from './draft.js';

export const CUSTOM_RULES = [
  { id: 'random', name: 'All Random', short: 'Random', desc: 'No draft: each side gets a random lineup, one hero per role.' },
  { id: 'single', name: 'Single lane', short: 'One lane', desc: 'All ten heroes in one lane (Lane Rush maps and pacing).' },
  { id: 'gold2', name: 'Double gold', short: '2x gold', desc: 'Every gold source pays twice: big items early.' },
  { id: 'respawn', name: 'Fast respawns', short: 'Fast spawn', desc: 'Death timers are halved.' },
  { id: 'backdoor', name: 'No backdoor guard', short: 'Backdoor', desc: 'Towers take full damage even without your minions.' },
];
const IDS = CUSTOM_RULES.map((r) => r.id);

// Sanitize a toggle set (from a peer, a share link or the room screen): known ids only, booleans.
export function cleanCustom(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const id of IDS) if (c[id] === true) out[id] = true;
  return out;
}
// The sim's rules with the toggles applied (a copy: the shared rule tables are never changed).
export function customRules(rules, c) {
  if (!c) return rules;
  const r = { ...rules };
  if (c.gold2) r.gold = rules.gold * 2;
  if (c.respawn) r.respawn = rules.respawn * 0.5;
  if (c.backdoor) r.pace = { ...rules.pace, backdoorOffFrom: 0 };
  return r;
}
// All Random: a finished draft with a seeded lineup per side (same seed → same lineups on every peer).
export function randomDraft(seed) {
  const rng = new Rng((seed ^ 0x52a7d0) >>> 0), used = new Set(), picks = [[], []];
  for (const role of ROLES) for (let t = 0; t < 2; t++) {
    const pool = HEROES.filter((x) => x.role === role && !used.has(x.id));
    const any = pool.length ? pool : HEROES.filter((x) => x.roles.includes(role) && !used.has(x.id));
    const x = any[rng.int(any.length)]; used.add(x.id); picks[t].push(x.id);
  }
  return { turn: DRAFT_ORDER.length, bans: [[], []], picks, done: true, random: true };
}
// Human-readable list for lobbies, results and the replay hub.
export const customLabel = (c) => (c ? CUSTOM_RULES.filter((r) => c[r.id]).map((r) => r.short).join(' · ') : '') || 'Standard rules';
