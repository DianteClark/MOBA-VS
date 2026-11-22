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

// Every hero can be picked only ONCE per match across both teams (a pick or ban locks it for everyone).
// The Mirror Match event has no draft at all (see mirrorDraft).
export function newDraft() { return { turn: 0, bans: [[], []], picks: [[], []], done: false }; }
// Mirror Match (src/data/events.js): a finished draft where both teams field the same curated lineup.
export function mirrorDraft(lineup) { return { turn: DRAFT_ORDER.length, bans: [[], []], picks: [lineup.heroes.slice(), lineup.heroes.slice()], done: true, mirror: lineup }; }
export function currentTurn(d) { return DRAFT_ORDER[d.turn] || null; }
// Heroes `team` can no longer pick (bans and picks of both teams: no hero is ever picked twice per match).
export function taken(d, team) {
  return new Set([...d.bans[0], ...d.bans[1], ...d.picks[0], ...d.picks[1]]);
}

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
  if (!t || t.team !== team || !HERO_BY_ID[heroId] || taken(d, team).has(heroId)) return false;
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

// AI / timeout pick. Deterministic given state (+ optional rng). pref(heroDef, 'pick'|'ban') adds a rival coach's
// habits (favourite heroes, preferred tags, ban style) to the score.
export function autoChoice(d, team, rng, skill = 1, pref = null) {
  const t = currentTurn(d); if (!t) return null;
  const tk = taken(d, team), avail = HEROES.filter((h) => !tk.has(h.id));
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
    if (pref && s > -Infinity) s += pref(h, t.act);
    return s + (rng ? rng.next() * (skill >= 1 ? 1.5 : 4) : 0);
  };
  let best = null, bs = -Infinity;
  for (const h of avail) { const s = score(h); if (s > bs) { bs = s; best = h; } }
  return best ? best.id : null;
}

// No hero twice per match: why a match config's lineups are not allowed, or null. Each team: 5 distinct heroes.
// Across teams no hero twice, with ONE exception: the Mirror Match event, where both lineups are identical
// (same heroes in the same roles). Pure; tools/verify.mjs uses it for anti-cheat.
export function lineupError(cfg) {
  const teams = cfg && cfg.teams, key = (t) => t.heroes.map((x) => `${x.id}:${x.role || ''}`).sort().join(',');
  for (const t of teams) { const ids = t.heroes.map((x) => x.id); if (new Set(ids).size !== ids.length) return `hero picked twice by one team`; }
  if (cfg.event === 'mirror') return key(teams[0]) === key(teams[1]) ? null : 'Mirror Match lineups differ';
  const a = new Set(teams[0].heroes.map((x) => x.id)), dup = teams[1].heroes.find((x) => a.has(x.id));
  return dup ? `hero ${dup.id} picked twice` : null;
}
// A prep must field exactly the team's drafted heroes (a peer's prep is not trusted to): otherwise its heroes
// are rebuilt from the picks, keeping the prep's builds, plan and deck. Pure + deterministic (both peers agree).
export function fitPrep(prep, picks) {
  const ids = ((prep && prep.heroes) || []).map((x) => x && x.id);
  if (ids.length === picks.length && picks.every((id) => ids.includes(id)) && new Set(ids).size === ids.length) return prep;
  const base = defaultPrep(picks), old = Object.fromEntries(((prep && prep.heroes) || []).filter((x) => x && HERO_BY_ID[x.id]).map((x) => [x.id, x.build]));
  for (const x of base.heroes) if (HERO_BY_ID[x.id].builds.includes(old[x.id])) x.build = old[x.id];
  return { ...base, ...(prep && prep.plan ? { plan: prep.plan } : {}), ...(prep && Array.isArray(prep.deck) ? { deck: prep.deck } : {}) };
}

// Mirror Match: a prep fields exactly the shared lineup in its roles, with the shared deck. The coach keeps
// their builds and plan (that is where the coaching happens).
export function fitMirror(prep, lineup) {
  const old = Object.fromEntries(((prep && prep.heroes) || []).filter((x) => x && HERO_BY_ID[x.id]).map((x) => [x.id, x.build]));
  const heroes = lineup.heroes.map((id, i) => ({ id, role: ROLES[i], build: HERO_BY_ID[id].builds.includes(old[id]) ? old[id] : HERO_BY_ID[id].rec }));
  return { ...(prep || {}), plan: (prep && prep.plan) || 'balanced', heroes, deck: lineup.deck.slice() };
}

// Default prep for a team (roles + recommended builds).
export function defaultPrep(ids) {
  const roles = assignRolesLoose(ids);
  return { plan: 'balanced', deck: ['rally', 'smoke', 'wind'], heroes: ids.map((id, i) => ({ id, role: roles[i], build: HERO_BY_ID[id].rec })) };
}
// AI prep: counter-build vs the enemy picks. mode 'rush' (one lane) never picks Split Push.
export function aiPrep(ids, enemyIds, mode) {
  const p = defaultPrep(ids);
  const enemy = enemyIds.map((id) => HERO_BY_ID[id]);
  for (const h of p.heroes) h.build = chooseBuild(HERO_BY_ID[h.id], enemy).id;
  p.plan = recommendPlan(ids, enemyIds, mode).id;
  p.deck = PLAN_DECK[p.plan].slice();
  return p;
}
// A tactic deck that fits each game plan.
export const PLAN_DECK = { aggro: ['rally', 'ambush', 'smoke'], scale: ['fortify', 'wind', 'pact'], objective: ['eyes', 'pact', 'smoke'], split: ['siege', 'fortify', 'rally'], protect: ['barrier', 'wind', 'rally'] };

// Recommended game plan for a comp vs the enemy comp: { id, why, scores }. Pure + deterministic.
// Reads hero curves (early/late), tags and classes on both sides; the reason names what drove the pick.
// Lane Rush (mode 'rush', one lane) has no side lanes: Split Push is never recommended there.
export function recommendPlan(ids, enemyIds, mode) {
  const mine = ids.map((id) => HERO_BY_ID[id]).filter(Boolean), foe = (enemyIds || []).map((id) => HERO_BY_ID[id]).filter(Boolean);
  const n = (list, f) => list.filter(f).length, tag = (t) => (x) => x.tags.includes(t);
  const early = n(mine, (x) => x.curve === 'early' || x.tags.includes('early')), late = n(mine, (x) => x.curve === 'late') + n(mine, tag('scaling')) * 0.5;
  const fEarly = n(foe, (x) => x.curve === 'early' || x.tags.includes('early')), fLate = n(foe, (x) => x.curve === 'late') + n(foe, tag('scaling')) * 0.5;
  const fDive = n(foe, tag('dive')) + n(foe, tag('pick')) * 0.5 + n(foe, (x) => x.cls === 'assassin') * 0.5;
  const peel = n(mine, tag('peel')) + n(mine, tag('shield')) * 0.5 + n(mine, tag('heal')) * 0.5;
  const carry = Math.max(0, ...mine.filter((x) => x.cls === 'marksman' || x.cls === 'mage').map((x) => (x.curve === 'late' ? 2 : 1) + (x.tags.includes('scaling') ? 1 : 0)));
  const split = n(mine, tag('split')) + n(mine, tag('siege')) * 0.8, fFight = n(foe, tag('teamfight')) + n(foe, tag('engage')) * 0.5;
  const fight = n(mine, tag('teamfight')) * 0.6 + n(mine, tag('cc')) * 0.4 + n(mine, tag('engage')) * 0.4 + n(mine, tag('vision'));
  const sc = {
    aggro: [early * 1.1 + n(mine, tag('dive')) * 0.5 + n(mine, tag('burst')) * 0.3 + fLate * 0.5 - late * 0.4 - 0.3, fLate >= 2 ? 'Punish their late-game picks before they come online' : 'Your early picks win fights before 8:00'],
    scale: [late * 1.0 + n(mine, tag('sustain')) * 0.2 - fEarly * 0.6 + 0.2, fEarly === 0 ? 'They have no early threat: farm up and out-scale' : 'Your comp peaks late'],
    objective: [fight * 0.8 + 0.55 + (fLate >= 2 && early < 2 ? 0.3 : 0), 'Teamfight and control: win the fights at Kami and Kraken'],
    split: [split * 1.0 + 0.45 + n(mine, (x) => x.cls === 'bruiser') * 0.25 - n(foe, tag('split')) * 0.3 + fFight * 0.25, fFight >= 3 ? 'Avoid their teamfight: pressure the side lanes' : 'Your side laners take towers alone'],
    protect: [carry * 0.6 + peel * 0.45 + fDive * 0.3 - 0.45, fDive >= 2 ? 'They dive: peel for your carry' : 'One hero carries late: keep them alive'],
  };
  let id = 'objective', bs = -Infinity;
  for (const k of Object.keys(sc)) if (sc[k][0] > bs && !(mode === 'rush' && k === 'split')) { bs = sc[k][0]; id = k; }
  return { id, why: sc[id][1], scores: Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, Math.round(v[0] * 10) / 10])) };
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

