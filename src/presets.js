// Lineup presets: data model, validation, and the draft/prep helpers that use them.
// Stored in profile.d.presets (versioned). Everything here is pure except the profile accessors.
import { HEROES, HERO_BY_ID, ROLES, matchupScore } from './data/heroes.js';
import { TACTIC_IDS, DEFAULT_DECK } from './data/tactics.js';
import { taken, legal, currentTurn, aiPrep } from './sim/draft.js';

export const PRESET_VERSION = 1;
export const PRESET_SLOTS = 5;
export const PLANS = { aggressive: ['Aggressive', 'Trade often, roam early, chase further.'], balanced: ['Balanced', 'Default risk. Adapt to the game.'], scaling: ['Scaling', 'Farm safely; avoid even fights before ~10 min.'] };

const emptyRoles = () => Object.fromEntries(ROLES.map((r) => [r, null]));
export function newPreset(name) { return { name, main: emptyRoles(), backup: emptyRoles(), builds: {}, plan: 'balanced', deck: DEFAULT_DECK.slice() }; }
const STARTER = { name: 'Starter', main: { top: 'bastion', jungle: 'kaze', mid: 'ember', bot: 'fletch', support: 'oak' },
  backup: { top: 'grok', jungle: 'leonin', mid: 'raiden', bot: 'marlowe', support: 'wu' } };
export function freshPresets() {
  const slots = Array.from({ length: PRESET_SLOTS }, (_, i) => newPreset(`Lineup ${i + 1}`));
  Object.assign(slots[0], { name: STARTER.name, main: { ...STARTER.main }, backup: { ...STARTER.backup } });
  return { v: PRESET_VERSION, active: 0, slots: slots.map(sanitize) };
}

// Clean up anything stored (old data, removed heroes/cards): heroes must fit their role, no hero twice,
// builds must be one of the hero's builds, exactly three distinct known cards.
export function sanitize(p) {
  const out = newPreset(String(p && p.name || 'Lineup').slice(0, 16));
  if (!p) return out;
  const used = new Set();
  for (const kind of ['main', 'backup']) for (const r of ROLES) {
    const id = p[kind] && p[kind][r];
    if (id && HERO_BY_ID[id] && HERO_BY_ID[id].roles.includes(r) && !used.has(id)) { out[kind][r] = id; used.add(id); }
  }
  for (const id of used) { const b = p.builds && p.builds[id]; out.builds[id] = HERO_BY_ID[id].builds.includes(b) ? b : HERO_BY_ID[id].rec; }
  out.plan = PLANS[p.plan] ? p.plan : 'balanced';
  const deck = [...new Set((p.deck || []).filter((c) => TACTIC_IDS.includes(c)))].slice(0, 3);
  for (const c of DEFAULT_DECK) if (deck.length < 3 && !deck.includes(c)) deck.push(c);
  out.deck = deck;
  return out;
}
export function loadPresets(raw) {
  if (!raw || raw.v !== PRESET_VERSION || !Array.isArray(raw.slots)) return freshPresets();
  const slots = Array.from({ length: PRESET_SLOTS }, (_, i) => sanitize(raw.slots[i] || newPreset(`Lineup ${i + 1}`)));
  const active = Number.isInteger(raw.active) && raw.active >= -1 && raw.active < PRESET_SLOTS ? raw.active : -1;
  return { v: PRESET_VERSION, active, slots };
}

// Problems shown in the editor (sanitize() already prevents the hard errors on save).
export function presetIssues(p) {
  const out = [], seen = {};
  for (const kind of ['main', 'backup']) for (const r of ROLES) { const id = p[kind][r]; if (id) (seen[id] = seen[id] || []).push(r); }
  for (const [id, rs] of Object.entries(seen)) if (rs.length > 1) out.push(`${HERO_BY_ID[id].name} is in two slots`);
  const missing = ROLES.filter((r) => !p.main[r]);
  if (missing.length) out.push(`No hero for ${missing.join(', ')}: you'll pick those yourself`);
  return out;
}
export const presetHeroes = (p) => (p ? ROLES.flatMap((r) => [p.main[r], p.backup[r]]).filter(Boolean) : []);
// Which role a hero was meant for in this preset (main or backup), or null.
export function presetRole(p, id) { if (!p) return null; for (const r of ROLES) if (p.main[r] === id || p.backup[r] === id) return r; return null; }

// Role assignment that keeps each hero in its preferred role when the team allows it
// (same rules as draft.assignRoles, which only guarantees *some* valid assignment).
export function assignPreferred(ids, prefer = []) {
  const heroes = ids.map((id) => HERO_BY_ID[id]);
  const used = new Set(), cur = []; let best = null;
  (function go(i) {
    if (best) return;
    if (i === heroes.length) { best = cur.slice(); return; }
    const want = prefer[i], order = want && heroes[i].roles.includes(want) ? [want, ...heroes[i].roles.filter((r) => r !== want)] : heroes[i].roles;
    for (const r of order) if (!used.has(r)) { used.add(r); cur.push(r); go(i + 1); cur.pop(); used.delete(r); if (best) return; }
  })(0);
  return best;
}
export const teamRoles = (ids, preset) => assignPreferred(ids, ids.map((id) => presetRole(preset, id)));

// ── draft helpers ──
// How good a pick is for `team` right now (matchups, a missing role, clan synergy).
export function pickScore(d, team, x) {
  const enemy = d.picks[1 - team].map((id) => HERO_BY_ID[id]);
  const have = teamRoles(d.picks[team], null) || [], need = ROLES.filter((r) => !have.includes(r));
  const clanN = {}; for (const id of d.picks[team]) { const c = HERO_BY_ID[id].clan; clanN[c] = (clanN[c] || 0) + 1; }
  return matchupScore(x, enemy).score * 2 + (x.roles.some((r) => need.includes(r)) ? 3 : -4) + (need.includes(x.role) ? 1 : 0) + (clanN[x.clan] || 0) * 1.5;
}
// The 3 best open heroes for one role (shown when the preset hero and its backup are gone).
export function recommendForRole(d, team, role, n = 3) {
  const tk = taken(d), mine = d.picks[team];
  return HEROES.filter((x) => x.roles.includes(role) && !tk.has(x.id) && legal(d, team, x.id) && assignPreferred([...mine, x.id], [...mine.map(() => null), role]))
    .map((x) => [pickScore(d, team, x) + (x.role === role ? 2 : 0), x.id]).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1)).slice(0, n).map((q) => q[1]);
}
// Threats worth banning: strong into your lineup (preset + picks so far), never your own preset heroes.
export function suggestedBans(d, team, preset, n = 3) {
  const tk = taken(d), own = new Set(presetHeroes(preset));
  const mine = [...new Set([...d.picks[team], ...(preset ? ROLES.map((r) => preset.main[r]).filter(Boolean) : [])])].map((id) => HERO_BY_ID[id]);
  if (!mine.length) return [];
  return HEROES.filter((x) => !tk.has(x.id) && !own.has(x.id))
    .map((x) => [matchupScore(x, mine).score * 2 + (x.tags.includes('scaling') ? 1 : 0) + (x.tags.includes('burst') ? 0.5 : 0), x.id])
    .filter((q) => q[0] > 0).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1)).slice(0, n).map((q) => q[1]);
}
// What the active preset wants on this pick turn:
//   { id, role, backup }    auto-pick this hero (main, or backup when the main is gone)
//   { prompt: role, recs }  both are gone: ask the coach, with 3 recommendations
//   null                    the preset has nothing left to say (pick manually)
export function presetChoice(d, team, preset) {
  const t = currentTurn(d);
  if (!preset || !t || t.team !== team || t.act !== 'pick') return null;
  const mine = d.picks[team], have = teamRoles(mine, preset) || [];
  for (const role of ROLES) {
    if (have.includes(role) || (!preset.main[role] && !preset.backup[role])) continue;
    for (const [id, backup] of [[preset.main[role], false], [preset.backup[role], true]]) {
      if (!id || !legal(d, team, id)) continue;
      const roles = teamRoles([...mine, id], preset);
      if (roles && roles[roles.length - 1] === role) return { id, role, backup };
    }
    return { prompt: role, recs: recommendForRole(d, team, role) };
  }
  return null;
}

// ── prep ──
// Builds, lanes, plan and deck from the preset for heroes that came from it; recommended defaults otherwise.
export function prepFromPreset(ids, enemyIds, preset) {
  const rec = aiPrep(ids, enemyIds), roles = teamRoles(ids, preset);
  const fromPreset = ids.filter((id) => presetRole(preset, id));
  const prep = { plan: rec.plan, deck: DEFAULT_DECK.slice(), heroes: rec.heroes.map((hp, i) => {
    const b = preset && preset.builds[hp.id];
    return { id: hp.id, role: roles ? roles[i] : hp.role, build: presetRole(preset, hp.id) && HERO_BY_ID[hp.id].builds.includes(b) ? b : hp.build };
  }) };
  if (preset) { prep.plan = preset.plan; prep.deck = preset.deck.slice(0, 3); } else prep.deck = rec.deck.slice(0, 3);
  return { prep, fromPreset };
}
