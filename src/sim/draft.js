// Draft rules (pure + deterministic, shared by vs-AI and peer-to-peer).
import { HEROES, HERO_BY_ID, ROLES, matchupScore } from '../data/heroes.js';
import { BLUE, RED } from './constants.js';
import { DUOS, compOf } from '../data/synergy.js';

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
      s += synergyScore(mine, h.id);
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
  for (const h of p.heroes) h.build = chooseBuild(HERO_BY_ID[h.id], enemy).id;
  const early = ids.filter((id) => HERO_BY_ID[id].curve === 'early').length, late = ids.filter((id) => HERO_BY_ID[id].curve === 'late').length;
  p.plan = early >= 2 ? 'aggressive' : late >= 3 ? 'scaling' : 'balanced';
  // tactic deck that fits the plan
  p.deck = p.plan === 'aggressive' ? ['rally', 'ambush', 'smoke'] : p.plan === 'scaling' ? ['fortify', 'wind', 'pact'] : ['rally', 'wind', 'pact'];
  return p;
}

// Draft synergy: picking a duo partner or pushing toward a team-comp archetype.
export function synergyScore(mine, id) {
  let s = 0;
  for (const d of DUOS) if ((d.a === id && mine.includes(d.b)) || (d.b === id && mine.includes(d.a))) s += 1.5;
  if (mine.length >= 2) { const before = compOf(mine), after = compOf([...mine, id]); if (after.count > before.count && after.count <= after.need + 1) s += 0.6; }
  return s;
}

// Situational build choice: score each of the hero's builds against the enemy team.
// Returns { id, why } (why = short reason for the UI). Pure + deterministic.
export function chooseBuild(def, enemy) {
  const n = (f) => enemy.filter(f).length, tag = (t) => (e) => e.tags.includes(t);
  const tanks = n((e) => e.cls === 'tank' || e.tags.includes('tank')), heals = n(tag('heal')) + n(tag('sustain'));
  const burst = n(tag('burst')), dive = n(tag('dive')) + n(tag('pick')), poke = n(tag('poke'));
  const squish = n((e) => e.cls === 'mage' || e.cls === 'marksman' || e.cls === 'support');
  const front = def.cls === 'tank' || def.cls === 'support' || def.cls === 'bruiser';
  const score = {
    burst: [squish * 0.5 - tanks * 0.7, 'Squishy targets'],
    burn: [heals * 0.9 + tanks * 0.5, 'Burns through healing and tanks'],
    tank: [(burst * 0.7 + dive * 0.3) * (def.cls === 'marksman' ? 0 : 1), 'Soaks their burst'],
    sustain: [poke * 0.5 - heals * 0 - n(tag('antiheal')) * 0.8 - n(tag('burn')) * 0.5, 'Outlasts their poke'],
    crit: [squish * 0.3 - dive * 0.2, 'Out-damages a soft frontline'],
    haste: [0.4, 'More spells, more control'],
    guardian: [burst * 0.3 + dive * 0.3, 'Keeps the carry alive'],
    pierce: [tanks * 1.1, 'Shreds their tanks'],
    siege: [(enemy.length ? 0.6 - n(tag('split')) * 0.2 - dive * 0.15 : 0), 'Pressures their towers'],
    spellblade: [0.5 - n(tag('cc')) * 0.1, 'Spell-and-hit skirmishing'],
    warden: [(dive * 0.6 + burst * 0.2) * (front ? 1 : 0.4), 'Guards the backline from divers'],
  };
  let best = def.rec, bs = -Infinity, why = 'Recommended';
  for (const b of def.builds) {
    const [v, w] = score[b] || [0, ''];
    const s = v + (b === def.rec ? 1.6 : 0);
    if (s > bs) { bs = s; best = b; why = b === def.rec && v < 1.2 ? 'Recommended' : w; }
  }
  return { id: best, why };
}

