// Champion unlocks (Koban) test: the economy model against the scan's milestones, the weekly rotation, and
// draft ownership (role steps, rotation, Try it, loaners and their cut-off, co-op seats, an online lockstep
// draft where each peer filters by its own ownership, and the sim staying identical).
//   node tools/unlocks_test.mjs [--econ]      (--econ: print the full economy table only)
import assert from 'node:assert/strict';
import { ECON, STARTERS, ALL_IDS, TIERS, tierOf, priceOf, rotation, weekOf, freshLedger, applyClaim, buyIn, pickIn, ownedCountIn, picksLeftIn, RANKED_OWNED, LOANER_UNTIL } from '../src/data/unlocks.js';
import { coachLevelOf, COACH_XP } from '../src/data/meta.js';
import { XP_PER_LEVEL, MATCH_XP } from '../src/data/seasons.js';
import { HEROES, HERO_BY_ID, ROLES } from '../src/data/heroes.js';
import { newDraft, apply as draftApply, currentTurn, legal, autoChoice, DRAFT_ORDER, assignRoles } from '../src/sim/draft.js';
import { coopLegal, DEFAULT_OWN, coopRoles } from '../src/sim/coop.js';
import { teamRoles } from '../src/presets.js';
import { Rng } from '../src/sim/rng.js';

const U = await import('../src/unlocks.js');
const ok = (label) => console.log('  ✔ ' + label);
const fakeP = (own = [], extra = {}) => ({ d: { koban: { ...freshLedger(), own: own.slice(), tries: [], trial: null, pend: [], srv: false, ...extra } }, save() {} });

// ── 1. economy model ──
// 50% wins (alternating), ~3 good calls a match, three daily goals (easy at the day's 1st match, medium at the
// 3rd, hard every other day at the 4th), coach XP and pass XP from the real tables. Buys the cheapest champion
// first; free picks take the cheapest General. full: also the season pass and a few early achievements.
function econ(perDay = 4, wr = 0.5, full = false, maxM = 3000) {
  const st = freshLedger(), D0 = Date.UTC(2026, 11, 1), ms = {}; let cxp = 0, pxp = 0, season = 1, achs = 0;
  const left = ALL_IDS.filter((id) => !STARTERS.includes(id)).sort((a, b) => priceOf(a) - priceOf(b) || (a < b ? -1 : 1));
  const mark = (m) => { const n = ownedCountIn(st); for (const k of [16, 20, 25, 40, 60, ALL_IDS.length]) if (n >= k && !ms[k]) ms[k] = m; };
  let m = 0;
  while (ownedCountIn(st) < ALL_IDS.length && m < maxM) {
    const day = Math.floor(m / perDay), slot = m % perDay, t = D0 + day * 86400000 + slot * 1800000; m++;
    const won = Math.floor(m * wr) > Math.floor((m - 1) * wr), now = t + 60000;
    applyClaim(st, { k: 'm', won, t }, now);
    cxp += (won ? COACH_XP.win : COACH_XP.loss) + 15; pxp += (won ? MATCH_XP.win : MATCH_XP.loss) + 45;
    const goal = (tier) => { applyClaim(st, { k: 'g', tier, t }, now); cxp += COACH_XP.goal; pxp += 100; };
    if (slot === 0) goal(0); if (slot === Math.min(2, perDay - 1)) goal(1); if (slot === perDay - 1 && day % 2 === 0) goal(2);
    applyClaim(st, { k: 'lv', lv: coachLevelOf(cxp).lv }, now);
    if (full) {
      if (Math.floor(day / 60) + 1 !== season) { season = Math.floor(day / 60) + 1; pxp = 0; }
      applyClaim(st, { k: 'p', s: season, lv: Math.min(30, 1 + Math.floor(pxp / XP_PER_LEVEL)) }, now);
      if (achs < 12 && (m === 1 || m % 8 === 0)) { applyClaim(st, { k: 'a', id: 'a' + achs++ }, now); }
    }
    while (picksLeftIn(st) > 0) { const g = left.find((id) => tierOf(id) === 'G'); if (pickIn(st, g || null)) break; if (g) left.splice(left.indexOf(g), 1); mark(m); }
    while (left.length && st.bal >= priceOf(left[0])) { buyIn(st, left.shift()); mark(m); }
  }
  return { ms, m, lv: st.lv, picks: st.picks };
}
const row = (label, e) => `  ${label.padEnd(26)} ${[16, 20, 25, 40, 60, ALL_IDS.length].map((k) => String(e.ms[k] || '-').padStart(5)).join(' ')}   (coach Lv ${e.lv}, ${e.picks} free picks)`;
console.log(`economy (matches to own N champions; ${ALL_IDS.length} heroes, ${STARTERS.length} starters, prices ${Object.values(TIERS).map((t) => t.price).join('/')}):`);
console.log('  ' + ''.padEnd(26) + [16, 20, 25, 40, 60, ALL_IDS.length].map((k) => String(k).padStart(5)).join(' '));
const base = econ(4, 0.5);
for (const [l, e] of [['4/day, 50% (scan model)', base], ['3/day, 50%', econ(3, 0.5)], ['6/day, 50%', econ(6, 0.5)], ['4/day, 40%', econ(4, 0.4)], ['4/day, 50% + pass, ach.', econ(4, 0.5, true)]]) console.log(row(l, e));
if (process.argv.includes('--econ')) process.exit(0);
assert.ok(base.ms[16] >= 3 && base.ms[16] <= 7, '16th champion at about match 5: ' + base.ms[16]);
assert.ok(base.ms[25] >= 36 && base.ms[25] <= 48, '25 owned (Ranked) at about match 42: ' + base.ms[25]);
ok(`economy: 16th champion at match ${base.ms[16]}, Ranked (25) at match ${base.ms[25]}, all ${ALL_IDS.length} at ${base.ms[ALL_IDS.length]}`);

// ── 2. weekly rotation ──
const w0 = weekOf(Date.UTC(2026, 10, 23, 12)); let prev = null; const seen = {};
for (let w = w0 - 5; w < w0 + 60; w++) {
  const r = rotation(w);
  assert.equal(r.length, 10); assert.equal(new Set(r).size, 10);
  for (const role of ROLES) assert.equal(r.filter((id) => HERO_BY_ID[id].role === role).length, 2, `2 ${role} in week ${w}`);
  assert.ok(r.every((id) => !STARTERS.includes(id)), 'no starters');
  if (prev) assert.ok(r.every((id) => !prev.includes(id)), 'never two weeks in a row');
  for (const id of r) seen[tierOf(id)] = (seen[tierOf(id)] || 0) + 1;
  assert.deepEqual(rotation(w), r, 'deterministic'); prev = r;
}
assert.ok(Object.keys(seen).length === 4, 'every tier shows up');
assert.equal(weekOf(Date.UTC(2026, 10, 23, 0, 0, 1)), weekOf(Date.UTC(2026, 10, 29, 23, 59)), 'ISO week: Monday to Sunday');
assert.notEqual(weekOf(Date.UTC(2026, 10, 22, 23, 59)), weekOf(Date.UTC(2026, 10, 23, 0, 0, 1)));
ok(`rotation: 2 per role, no starters, deterministic, no repeats week to week, tiers ${JSON.stringify(seen)}`);

// ── 3. vs-AI drafts with ownership ──
const NOW = Date.now(), ROT = new Set(rotation(weekOf(NOW)));
// An AI side that bans what the coach owns (the hard case) and picks by the classic auto choice.
function aiAct(d, team, rng, P, mine) {
  const t = currentTurn(d);
  if (t.act === 'ban') { const target = HEROES.find((x) => !d.bans.flat().includes(x.id) && !d.picks.flat().includes(x.id) && U.owns(P, x.id) && x.roles.includes(ROLES.find((r) => !(teamRoles(d.picks[mine], null) || []).includes(r)) || 'bot')); if (target) return target.id; }
  return autoChoice(d, team, rng, 1);
}
function draftVsAI(P, { seed = 1, trial = null, aiBansOwned = true } = {}) {
  const s = { mode: 'ai', myTeam: 0, draft: newDraft(), pickRoles: {}, loaners: {}, preset: null };
  if (trial) P.d.koban.trial = trial;
  const rng = new Rng(seed); let step = null; const steps = [];
  while (!s.draft.done) {
    const t = currentTurn(s.draft);
    if (t.team === 0 && t.act === 'pick') {
      const c = U.ownedAutoPick(P, s, step, (id) => legal(s.draft, 0, id)); assert.ok(c, 'always a pick');
      assert.ok(U.usable(P, s, c.id), `${c.id} usable`); s.pickRoles[c.id] = c.role; steps.push(c.role); step = null;
      assert.ok(draftApply(s.draft, 0, c.id));
    } else if (t.team === 0) assert.ok(draftApply(s.draft, 0, autoChoice(s.draft, 0, rng, 1))); // bans: full roster
    else assert.ok(draftApply(s.draft, 1, aiBansOwned ? aiAct(s.draft, 1, rng, P, 0) : autoChoice(s.draft, 1, rng, 1)));
  }
  const roles = teamRoles(s.draft.picks[0], null, s.pickRoles);
  assert.ok(roles && new Set(roles).size === 5, 'five distinct roles');
  s.draft.picks[0].forEach((id, i) => assert.equal(roles[i], s.pickRoles[id], 'each hero plays the role it was picked for'));
  return { s, steps, roles };
}
// starters only: role steps run Top → Support, every pick usable, loaners fill roles the bans emptied
let loans = 0, games = 0;
for (let seed = 1; seed <= 40; seed++) {
  const P = fakeP();
  const { s, steps } = draftVsAI(P, { seed });
  assert.deepEqual(steps, ROLES, 'role steps in order');
  for (const id of s.draft.picks[0]) assert.ok(U.owns(P, id) || ROT.has(id) || Object.values(s.loaners).includes(id));
  for (const [role, id] of Object.entries(s.loaners)) { loans++; assert.ok(!U.owns(P, id)); assert.ok(HERO_BY_ID[id].roles.includes(role)); }
  games++;
}
ok(`starters only, AI banning owned heroes: ${games} drafts, role steps in order, every pick owned / free / loaned (${loans} loaners)`);
// a loaner appears ONLY when the step has no usable hero
{
  const P = fakeP(), s = { mode: 'ai', myTeam: 0, draft: newDraft(), pickRoles: {}, loaners: {}, preset: null };
  const fit = (ss) => (id, r) => U.fitsRole(ss, id, r, (q) => legal(ss.draft, 0, q));
  assert.equal(U.ensureLoaner(P, s, 'top', fit(s)), null, 'no loaner while Top has usable heroes');
  // ban every usable Top hero
  const usableTop = HEROES.filter((x) => x.roles.includes('top') && U.usable(P, s, x.id)).map((x) => x.id);
  s.draft.bans[1].push(...usableTop);
  const l = U.ensureLoaner(P, s, 'top', fit(s));
  assert.ok(l && HERO_BY_ID[l].role === 'top' && !U.owns(P, l), 'a Top loaner'); assert.ok(U.usable(P, s, l));
  assert.equal(U.access(P, s, l), 'loan');
  // 25+ owned: no loaner while another open role still has usable heroes
  const P25 = fakeP(ALL_IDS.filter((id) => !STARTERS.includes(id) && !HERO_BY_ID[id].roles.includes('top')).slice(0, LOANER_UNTIL - STARTERS.length));
  assert.ok(U.ownedCount(P25) >= LOANER_UNTIL);
  const s2 = { mode: 'ai', myTeam: 0, draft: newDraft(), pickRoles: {}, loaners: {}, preset: null };
  s2.draft.bans[1].push(...HEROES.filter((x) => x.roles.includes('top') && U.usable(P25, s2, x.id)).map((x) => x.id));
  assert.equal(U.ensureLoaner(P25, s2, 'top', fit(s2), ROLES), null, 'no loaners at 25 owned');
  const c = U.ownedAutoPick(P25, s2, 'top', (id) => legal(s2.draft, 0, id)); assert.ok(c && c.role !== 'top' && U.owns(P25, c.id) || ROT.has(c.id), 'the auto pick moves to another open role');
  ok('loaners: only when a role step has nothing usable, never once 25 are owned (unless no role can be filled)');
}
// Try it: the armed trial hero is usable in a plain vs-AI match only
{
  const id = ALL_IDS.find((x) => !STARTERS.includes(x) && !ROT.has(x) && tierOf(x) === 'L'), P = fakeP([], { trial: id });
  assert.ok(U.usable(P, { mode: 'ai', myTeam: 0 }, id)); assert.equal(U.access(P, { mode: 'ai', myTeam: 0 }, id), 'try');
  for (const s of [{ mode: 'host', myTeam: 0 }, { mode: 'ai', myTeam: 0, cup: true }, { mode: 'coop', myTeam: 0 }, { mode: 'ai', myTeam: 0, custom: {} }]) assert.ok(!U.usable(P, s, id), 'no trial in ' + JSON.stringify(s));
  const Pe = { ...P, d: { ...P.d, koban: { ...P.d.koban } }, save() {} };
  const r = U.earnMatch(Pe, { won: true, heroes: [id], trialOk: true, season: 1, passAfter: 1, lvAfter: 1 });
  assert.equal(r.tried, id); assert.equal(Pe.d.koban.trial, null); assert.ok(Pe.d.koban.tries.includes(id)); assert.ok(!U.canTry(Pe, id));
  assert.ok(!U.usable({ d: { koban: { ...Pe.d.koban } } }, { mode: 'ai', myTeam: 0 }, id), 'a used trial is gone');
  ok('Try it: one vs-AI match (not online, cups, co-op or custom), then used up');
}
// sessions without ownership: Franchise, pass-and-play, AI vs AI
for (const s of [{ mode: 'ai', myTeam: 0, franchise: true }, { mode: 'ai', myTeam: 0, pnp: true }, { mode: 'watch', myTeam: -1 }]) assert.ok(!U.ownershipOn(s));
ok('Franchise, pass-and-play and AI-vs-AI drafts are unaffected');

// ── 4. co-op: each coach uses their own ownership for their own roles ──
{
  const own = DEFAULT_OWN, mk = (seat) => ({ mode: 'coop', myTeam: 0, mySeat: seat, coop: [{ seats: 2, own, lead: 0 }, null], draft: null, pickRoles: {}, loaners: {}, preset: null });
  const PA = fakeP(), PB = fakeP(ALL_IDS.filter((id) => tierOf(id) === 'L')); // B owns the Legends
  const d = newDraft(); d.seats = [[], []];
  const sA = mk(0), sB = mk(1); sA.draft = sB.draft = d;
  const rng = new Rng(7);
  const whoSeat = () => { const t = currentTurn(d); const rolesLeft = (seat) => ROLES.filter((r) => own[r] === seat && !(coopRoles(d, 0, own) || []).includes(r)); return t.team === 0 && t.act === 'pick' ? (rolesLeft(0).length && (d.picks[0].length % 2 === 0 || !rolesLeft(1).length) ? 0 : 1) : 0; };
  while (!d.done) {
    const t = currentTurn(d);
    if (t.team === 0 && t.act === 'pick') {
      const seat = whoSeat(), P = seat ? PB : PA, s = seat ? sB : sA;
      const c = U.ownedAutoPick(P, s, null, (id) => coopLegal(d, 0, seat, id, own));
      assert.ok(c && U.usable(P, s, c.id)); assert.equal(own[c.role], seat, 'a coach picks only their own roles');
      d.picks[0].push(c.id); d.seats[0].push(seat); d.turn++; if (d.turn >= DRAFT_ORDER.length) d.done = true;
    } else assert.ok(draftApply(d, t.team, autoChoice(d, t.team, rng, 1)));
  }
  const bPicks = d.picks[0].filter((_, i) => d.seats[0][i] === 1), aPicks = d.picks[0].filter((_, i) => d.seats[0][i] === 0);
  assert.ok(aPicks.every((id) => U.usable(PA, sA, id)), 'seat 0 used its own pool'); assert.ok(bPicks.every((id) => U.usable(PB, sB, id)), 'seat 1 used its own pool');
  ok(`co-op: seat 0 (starters) picked ${aPicks.join(', ')}; seat 1 (owns Legends) picked ${bPicks.join(', ')}`);
}

// ── 5. online lockstep: each peer filters its own picks; both apply the same commands; the sim never sees ownership ──
{
  const { Game } = await import('../src/sim/game.js');
  const { aiPrep } = await import('../src/sim/draft.js');
  const PA = fakeP(), PB = fakeP(ALL_IDS.filter((id) => tierOf(id) !== 'G').slice(0, 20));
  const peers = [0, 1].map((me) => ({ mode: me ? 'join' : 'host', myTeam: me, draft: newDraft(), pickRoles: {}, loaners: {}, preset: null, P: me ? PB : PA, rng: new Rng(100 + me) }));
  while (!peers[0].draft.done) {
    const t = currentTurn(peers[0].draft), s = peers[t.team];
    const id = t.act === 'pick' ? U.ownedAutoPick(s.P, s, null, (x) => legal(s.draft, t.team, x)).id : autoChoice(s.draft, t.team, s.rng, 1);
    for (const p of peers) assert.ok(draftApply(p.draft, t.team, id), 'the command applies on both peers'); // the 'draft' message
  }
  assert.deepEqual(peers[0].draft, peers[1].draft, 'identical drafts on both peers');
  for (const [t, p] of [[0, peers[0]], [1, peers[1]]]) assert.ok(p.draft.picks[t].every((id) => U.usable(p.P, p, id)), `peer ${t} picked only what it may use`);
  const cfg = { seed: 4242, map: 'sakura', teams: [aiPrep(peers[0].draft.picks[0], peers[0].draft.picks[1]), aiPrep(peers[0].draft.picks[1], peers[0].draft.picks[0])] };
  assert.ok(!/koban|loan|trial|own/.test(JSON.stringify(cfg)), 'no ownership data in the match config');
  const run = () => { const g = new Game(JSON.parse(JSON.stringify(cfg))); for (let i = 0; i < 2400 && !g.over; i++) g.step([]); return g.checksum(); };
  assert.equal(run(), run(), 'same checksum');
  ok('online lockstep: per-peer ownership filters picks only; identical drafts, no ownership in cfg, identical sim');
}
// ranked readiness and rookie boost bookkeeping
{
  const P = fakeP(ALL_IDS.filter((id) => !STARTERS.includes(id)).slice(0, RANKED_OWNED - STARTERS.length - 1));
  assert.ok(!U.rankedReady(P)); P.d.koban.own.push(ALL_IDS.find((id) => !STARTERS.includes(id) && !P.d.koban.own.includes(id))); assert.ok(U.rankedReady(P));
  ok(`Ranked readiness at ${RANKED_OWNED} owned`);
}
console.log('unlocks tests passed');
