// Draft rules (pure + deterministic, shared by vs-AI and peer-to-peer).
import { HEROES, HERO_BY_ID, ROLES, matchupScore } from '../data/heroes.js';
import { BLUE, RED } from './constants.js';

// Tournament draft order.
export const DRAFT_ORDER = [
  { team: BLUE, act: 'ban' }, { team: RED, act: 'ban' }, { team: BLUE, act: 'ban' }, { team: RED, act: 'ban' },
  { team: BLUE, act: 'pick' }, { team: RED, act: 'pick' }, { team: RED, act: 'pick' }, { team: BLUE, act: 'pick' }, { team: BLUE, act: 'pick' }, { team: RED, act: 'pick' },
  { team: RED, act: 'ban' }, { team: BLUE, act: 'ban' },
  { team: RED, act: 'pick' }, { team: BLUE, act: 'pick' }, { team: BLUE, act: 'pick' }, { team: RED, act: 'pick' },
];
export const TURN_SECONDS = 30;

export function newDraft() { return { turn: 0, bans: [[], []], picks: [[], []], done: false }; }
export function currentTurn(d) { return DRAFT_ORDER[d.turn] || null; }
export function taken(d) { return new Set([...d.bans[0], ...d.bans[1], ...d.picks[0], ...d.picks[1]]); }

// Can `ids` be assigned to 5 distinct roles (partial teams: each hero to a distinct role)?
export function assignRoles(ids) {
  const heroes = ids.map((id) => HERO_BY_ID[id]);
  let best = null;
  const used = new Set(), cur = [];
  (function go(i) {
    if (best) return;
    if (i === heroes.length) { best = cur.slice(); return; }
    // prefer primary role
    for (const r of heroes[i].roles) if (!used.has(r)) { used.add(r); cur.push(r); go(i + 1); cur.pop(); used.delete(r); if (best) return; }
  })(0);
  return best; // array of roles aligned with ids, or null
}
// Fallback when someone forces a weird comp: allow off-role (any role) so the game can still start.
export function assignRolesLoose(ids) {
  const strict = assignRoles(ids); if (strict) return strict;
  const out = [], used = new Set();
  for (const id of ids) { const h = HERO_BY_ID[id]; const r = h.roles.find((x) => !used.has(x)) || ROLES.find((x) => !used.has(x)); used.add(r); out.push(r); }
  return out;
}

export function legal(d, team, heroId) {
  const t = currentTurn(d);
  if (!t || t.team !== team || !HERO_BY_ID[heroId] || taken(d).has(heroId)) return false;
  if (t.act === 'pick') return !!assignRoles([...d.picks[team], heroId]);
  return true;
}
export function apply(d, team, heroId) {
  if (!legal(d, team, heroId)) return false;
  const t = currentTurn(d);
  (t.act === 'ban' ? d.bans : d.picks)[team].push(heroId);
  d.turn++;
  if (d.turn >= DRAFT_ORDER.length) d.done = true;
  return true;
}

// AI / timeout pick. Deterministic given state (+ optional rng).
export function autoChoice(d, team, rng, skill = 1) {
  const t = currentTurn(d); if (!t) return null;
  const avail = HEROES.filter((h) => !taken(d).has(h.id));
  const enemy = d.picks[1 - team].map((id) => HERO_BY_ID[id]);
  const mine = d.picks[team];
  const score = (h) => {
    let s = matchupScore(h, enemy).score * 2;
    if (t.act === 'pick') {
      if (!assignRoles([...mine, h.id])) return -Infinity;
      // fill a role we don't have yet with a primary pick
      const roles = assignRoles(mine) || [];
      if (!roles.includes(h.role)) s += 3;
    } else {
      // ban: strong into my picks / popular
      const myHeroes = mine.map((id) => HERO_BY_ID[id]);
      s = matchupScore(h, myHeroes).score * 2 + (h.tags.includes('scaling') ? 1 : 0) + (h.tags.includes('burst') ? 0.5 : 0);
      if (!assignRoles([...d.picks[1 - team], h.id])) s -= 4; // they can't use it anyway
    }
    return s + (rng ? rng.next() * (skill >= 1 ? 1.5 : 4) : 0);
  };
  let best = null, bs = -Infinity;
  for (const h of avail) { const s = score(h); if (s > bs) { bs = s; best = h; } }
  return best ? best.id : null;
}

// Default prep for a team (roles + recommended builds).
export function defaultPrep(ids) {
  const roles = assignRolesLoose(ids);
  return { plan: 'balanced', deck: ['rally', 'smoke', 'wind'], heroes: ids.map((id, i) => ({ id, role: roles[i], build: HERO_BY_ID[id].rec })) };
}
// AI prep: counter-build vs the enemy picks.
export function aiPrep(ids, enemyIds) {
  const p = defaultPrep(ids);
  const enemy = enemyIds.map((id) => HERO_BY_ID[id]);
  const tanks = enemy.filter((e) => e.tags.includes('tank')).length;
  const heals = enemy.filter((e) => e.tags.includes('heal') || e.tags.includes('sustain')).length;
  const burst = enemy.filter((e) => e.tags.includes('burst')).length;
  for (const h of p.heroes) {
    const def = HERO_BY_ID[h.id];
    if ((tanks >= 2 || heals >= 2) && def.builds.includes('burn')) h.build = 'burn';
    else if (burst >= 3 && def.builds.includes('tank') && def.cls !== 'marksman') h.build = 'tank';
  }
  const early = ids.filter((id) => HERO_BY_ID[id].curve === 'early').length, late = ids.filter((id) => HERO_BY_ID[id].curve === 'late').length;
  p.plan = early >= 2 ? 'aggressive' : late >= 3 ? 'scaling' : 'balanced';
  // tactic deck that fits the plan
  p.deck = p.plan === 'aggressive' ? ['rally', 'ambush', 'smoke'] : p.plan === 'scaling' ? ['fortify', 'wind', 'pact'] : ['rally', 'wind', 'pact'];
  return p;
}
