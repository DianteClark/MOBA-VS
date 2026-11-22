// Champion unlocks at run time: the coach's Koban ledger (profile.d.koban), what they own, the weekly free
// rotation, Try it, loaners, and the draft pool for a role. Rules and prices: src/data/unlocks.js.
//
// Authority: a coach with an online account (every coach who has been online) is server-authoritative. Their
// ledger lives in the Worker (worker/koban.js), every earning is a claim the server re-computes and bounds,
// and purchases / free picks are made there; the local copy is a mirror that shows earnings at once and
// adopts the server's answer. A coach who has never been online keeps a local ledger, which seeds the server
// once (bounded) on their first sync.
//
// Ownership touches the DRAFT only (which heroes a coach may lock in): the match sim never reads it, so
// lockstep and replays are unaffected beyond the picks themselves.
import { ECON, RANKED_OWNED, LOANER_UNTIL, isHero, rotationNow, weekOf, weekEnds,
  freshLedger, cleanLedger, applyClaim, buyIn, pickIn, ownsIn, ownedCountIn, picksLeftIn, allGeneralsOwned } from './data/unlocks.js';
import { HEROES, HERO_BY_ID, ROLES } from './data/heroes.js';
import { coachLevelOf } from './data/meta.js';
import { teamRoles, pickScore } from './presets.js';
import { coopRoles, seatRoles } from './sim/coop.js';
import { kobanGet, kobanSync, kobanBuy, kobanPick, kobanSignedIn } from './net/koban.js';

const PEND_MAX = 80, TRIES_MAX = 100;
const games = (d) => Object.values(d.seasons || {}).reduce((a, s) => a + (s.w || 0) + (s.l || 0), 0);
// profile.d.koban = { ...ledger, tries: [ids tried], trial: id armed for the next vs-AI match, pend: claims not yet
// acknowledged by the server, srv: the server has this coach's ledger }. A profile from before Koban starts with
// the starters, its matches counted (no rookie boost for veterans) and its current level, pass and achievements
// marked as paid (no retroactive payout).
export function normalizeKoban(d) {
  const k = d.koban && typeof d.koban === 'object' ? d.koban : null;
  const banked = typeof d.koban === 'number' ? Math.max(0, Math.min(ECON.campaign, Math.floor(d.koban))) : 0; // the campaign's interim plain total
  let o;
  if (!k) {
    o = freshLedger(Date.now());
    o.g = Math.min(3000, games(d)); o.lv = coachLevelOf((d.meta && d.meta.cxp) || 0).lv;
    o.ach = Object.keys((d.ach && d.ach.got) || {}).slice(0, 120); o.ps = d.lastSeason || 0;
    const s = o.ps && d.seasons && d.seasons[o.ps]; o.pl = s ? 1 + Math.floor((s.xp || 0) / 300) : 1;
    o.bal = o.earned = o.cp = banked;
  } else o = cleanLedger(k);
  o.tries = [...new Set((k && Array.isArray(k.tries) ? k.tries : []).filter(isHero))].slice(0, TRIES_MAX);
  o.trial = k && isHero(k.trial) && !ownsIn(o, k.trial) && !o.tries.includes(k.trial) ? k.trial : null;
  o.pend = (k && Array.isArray(k.pend) ? k.pend : []).filter((c) => c && typeof c === 'object' && typeof c.k === 'string').slice(-PEND_MAX);
  o.srv = !!(k && k.srv);
  d.koban = o;
  return o;
}
export const kb = (P) => P.d.koban;

// ── ownership ──
export const owns = (P, id) => ownsIn(kb(P), id);
export const ownedCount = (P) => ownedCountIn(kb(P));
export const rankedReady = (P) => ownedCount(P) >= RANKED_OWNED;
export const freeRotation = (now = Date.now()) => rotationNow(now);
export const inRotation = (id, now = Date.now()) => rotationNow(now).includes(id);
export const rotationEnds = (now = Date.now()) => weekEnds(weekOf(now));
export const picksLeft = (P) => picksLeftIn(kb(P));
export const nextPickLevel = (P) => { const n = kb(P).picks + 1; return n > ECON.pickCap ? null : n * ECON.pickEvery; };
export const generalsDone = (P) => allGeneralsOwned(kb(P));
// Can this coach try the hero (one vs-AI match each, any champion they don't own)?
export const canTry = (P, id) => isHero(id) && !owns(P, id) && !kb(P).tries.includes(id);

// Does ownership apply to this session? Every real draft except Franchise (club rosters), pass-and-play and
// AI-vs-AI; Mirror Match / All Random / fixed story squads have no draft at all.
// The Coach Academy and story missions with a fixed squad ignore ownership (like loaners); story missions with a
// normal draft respect it.
export const ownershipOn = (s) => !!s && s.myTeam >= 0 && s.mode !== 'watch' && !s.franchise && !s.pnp && !s.tutorial && !(s.draft && (s.draft.mirror || s.draft.random || s.draft.fixed));
// Try it works in a plain match against the AI (Play vs AI, Lane Rush vs AI).
export const trialOn = (s) => !!s && s.mode === 'ai' && !s.cup && !s.franchise && !s.custom && !s.pnp && !s.wasOnline && !s.mission && !s.tutorial;
function trialHero(P, s) { const t = kb(P).trial; return t && trialOn(s) ? t : null; }
// May this coach lock this hero in this session? (owned, this week's rotation, the armed trial, a loaner)
export function usable(P, s, id) {
  if (!ownershipOn(s)) return true;
  return owns(P, id) || inRotation(id) || trialHero(P, s) === id || !!(s.loaners && Object.values(s.loaners).includes(id));
}
// Why a hero is usable, for badges: 'own' | 'free' (rotation) | 'try' | 'loan' | null (locked).
export function access(P, s, id) {
  if (owns(P, id)) return 'own';
  if (s && s.loaners && Object.values(s.loaners).includes(id)) return 'loan';
  if (trialHero(P, s) === id) return 'try';
  if (inRotation(id)) return 'free';
  return null;
}
// The draft pool for one role step: usable heroes that can play it (flex included) and pass `legal`, main role first.
function rolePool(P, s, role, legal) {
  return HEROES.filter((x) => x.roles.includes(role) && usable(P, s, x.id) && legal(x.id))
    .sort((a, b) => (a.role === role ? 0 : 1) - (b.role === role ? 0 : 1)).map((x) => x.id);
}
// Bans (or picks) left this coach nothing usable for `role`: lend a random legal hero of that role for this
// match. Loaners stop at LOANER_UNTIL owned, except as the last resort when no usable hero can fill ANY open
// role (so a draft never locks). Returns the loaner id or null. Local randomness: the pick is sent as a normal
// draft command, the sim never sees how it was chosen. fit(id, role): the hero can be locked for that role now.
export function ensureLoaner(P, s, role, fit, openRoles = [role]) {
  if (!ownershipOn(s)) return null;
  s.loaners = s.loaners || {};
  const legal = (id) => fit(id, role);
  if (s.loaners[role] && legal(s.loaners[role])) return s.loaners[role];
  if (rolePool(P, s, role, legal).length) return null;
  if (ownedCount(P) >= LOANER_UNTIL && openRoles.some((r) => rolePool(P, s, r, (id) => fit(id, r)).length)) return null;
  const L = HEROES.filter((x) => x.role === role && legal(x.id)), any = L.length ? L : HEROES.filter((x) => x.roles.includes(role) && legal(x.id));
  if (!any.length) return null;
  const id = any[Math.floor(Math.random() * any.length)].id;
  s.loaners[role] = id;
  return id;
}

// ── role steps (the draft, Dojo lineups and auto-picks) ──
// My open roles in step order Top, Jungle, Mid, Bot, Support (co-op: my seat's roles only).
export function openRoles(s) {
  const d = s.draft, me = s.myTeam, split = s.mode === 'coop' && s.coop && s.coop[me] && s.coop[me].seats === 2 ? s.coop[me] : null;
  const have = split ? coopRoles(d, me, split.own) : teamRoles(d.picks[me], s.preset, s.pickRoles) || [];
  return (split ? seatRoles(split.own, s.mySeat) : ROLES).filter((r) => !have.includes(r));
}
// Would this hero take `role` in my team if locked now? (legal: the session's draft rule for my turn)
export function fitsRole(s, id, role, legal) {
  if (!HERO_BY_ID[id] || !HERO_BY_ID[id].roles.includes(role) || !legal(id)) return false;
  if (s.mode === 'coop') return true;
  const mine = s.draft.picks[s.myTeam], roles = teamRoles([...mine, id], s.preset, { ...(s.pickRoles || {}), [id]: role });
  return !!roles && roles[roles.length - 1] === role;
}
// A valid current step (the first open role unless `step` is still open), with a loaner lent when needed.
export function stepFor(P, s, step, legal) {
  const need = openRoles(s), cur = need.includes(step) ? step : need[0];
  if (cur) ensureLoaner(P, s, cur, (id, r) => fitsRole(s, id, r, legal), need);
  return cur || null;
}
// Ownership-aware auto choice for my pick (timeouts, a lineup with nothing usable left): the best usable hero
// for the step, then the other open roles, else a loaner. Returns { id, role } or null.
export function ownedAutoPick(P, s, step, legal) {
  const d = s.draft, me = s.myTeam, need = openRoles(s), first = stepFor(P, s, step, legal);
  for (const role of [first, ...need.filter((r) => r !== first)].filter(Boolean)) {
    const pool = rolePool(P, s, role, (id) => fitsRole(s, id, role, legal));
    if (pool.length) return { id: pool.map((id) => [pickScore(d, me, HERO_BY_ID[id]) + (HERO_BY_ID[id].role === role ? 2 : 0), id]).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1))[0][1], role };
  }
  for (const role of need) { const l = ensureLoaner(P, s, role, (id, r) => fitsRole(s, id, r, legal), need); if (l) return { id: l, role }; }
  return null;
}

// ── earning (after every coached match, from Profile.record) ──
// ctx: { won, now, goals: [tier per goal finished], lvAfter, season, passAfter, heroes: my hero ids, trialOk: a
// plain vs-AI match, achKoban: Koban the match's achievements paid (earnAch) }. Applies the claims locally (same
// rules as the server) and queues them for the next sync.
export function earnMatch(P, ctx) {
  const K = kb(P), now = ctx.now || Date.now(), parts = [], claims = [];
  const put = (c) => { const got = applyClaim(K, c, now); parts.push(...got); claims.push(c); };
  put({ k: 'm', won: !!ctx.won, t: now });
  for (const tier of ctx.goals || []) put({ k: 'g', tier, t: now });
  if (ctx.lvAfter > K.lv) put({ k: 'lv', lv: ctx.lvAfter });
  if (ctx.season) put({ k: 'p', s: ctx.season, lv: ctx.passAfter || 1 });
  queue(K, claims);
  if (ctx.achKoban) parts.push(['Achievements', ctx.achKoban]);
  // Try it: used up once the tried hero played a vs-AI match
  let tried = null;
  if (K.trial && ctx.trialOk && (ctx.heroes || []).includes(K.trial)) { tried = K.trial; K.tries.push(K.trial); K.tries = K.tries.slice(-TRIES_MAX); K.trial = null; }
  const total = parts.reduce((a, p) => a + p[1], 0);
  return { total, parts: merge(parts), bal: K.bal, picks: picksLeft(P), tried, rookie: K.g <= ECON.rookieGames ? Math.max(0, ECON.rookieGames - K.g) : 0 };
}
const queue = (K, claims) => { if (K.srv || kobanSignedIn()) { K.pend.push(...claims); K.pend = K.pend.slice(-PEND_MAX); } };
// A story campaign / Coach Academy reward (src/koban.js grantKoban): credited now (within the lifetime cap) and
// queued for the server, which applies the same cap. Returns the Koban credited.
export function earnCampaign(P, n, reason) {
  const K = kb(P), c = { k: 'c', n: Math.max(0, Math.floor(+n || 0)), id: String(reason || '').slice(0, 24) }, got = applyClaim(K, c, Date.now());
  queue(K, [c]);
  return got.reduce((a, p) => a + p[1], 0);
}
// An achievement just earned (Profile.grantAch): its Koban, credited now and queued for the server.
export function earnAch(P, id) {
  const K = kb(P), c = { k: 'a', id }, got = applyClaim(K, c, Date.now());
  queue(K, [c]);
  return got.reduce((a, p) => a + p[1], 0);
}
const merge = (parts) => { const o = new Map(); for (const [l, n] of parts) o.set(l, (o.get(l) || 0) + n); return [...o.entries()]; };

// ── server sync ──
// Adopt the server's ledger (keeps the local-only fields: tries, trial).
function adoptServer(P, st, keepPend = []) {
  const K = kb(P), c = cleanLedger(st);
  P.d.koban = { ...c, tries: K.tries, trial: K.trial && !ownsIn(c, K.trial) ? K.trial : null, pend: keepPend, srv: true };
  P.save();
}
let syncing = null;
// Push queued claims (or seed the server on the first sync) and adopt the answer. Safe to call any time.
export function syncKoban(P) {
  if (!kobanSignedIn()) return Promise.resolve(false);
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const K = kb(P), sent = K.pend.slice();
      // first sync: the local ledger seeds a new server row (claims ignored: the seed already holds them);
      // when the account already has a ledger (another device) the seed is ignored and the claims count
      const r = await kobanSync({ ...(K.srv ? {} : { seed: ledgerOf(K) }), claims: sent });
      if (!r || !r.state) return false;
      adoptServer(P, r.state, kb(P).pend.slice(sent.length)); // claims added while the request was out stay queued
      return true;
    } catch { return false; } finally { syncing = null; }
  })();
  return syncing;
}
const LOCAL_ONLY = new Set(['tries', 'trial', 'pend', 'srv']);
const ledgerOf = (K) => Object.fromEntries(Object.entries(K).filter(([k]) => !LOCAL_ONLY.has(k)));
// Fetch the server ledger (after sign-in on a new device); adopts it when the server has one.
export async function refreshKoban(P) {
  if (!kobanSignedIn()) return false;
  try { const r = await kobanGet(); if (r && r.state) { if (kb(P).pend.length) return syncKoban(P); adoptServer(P, r.state, []); return true; } return syncKoban(P); } catch { return false; }
}

// ── spending ──
// Buy with Koban: through the server when signed in (it checks price and balance), locally otherwise.
// Resolves to null on success or a reason string.
export async function buyChampion(P, id) {
  if (kobanSignedIn()) {
    await syncKoban(P); // earnings first, so the balance is current
    try { const r = await kobanBuy(id); if (r && r.state) { adoptServer(P, r.state, kb(P).pend); return null; } return (r && r.error) || 'Could not reach the shop'; }
    catch (e) { return String(e.message || e) || 'Could not reach the shop'; }
  }
  const err = buyIn(kb(P), id); if (!err) P.save(); return err;
}
export async function useFreePick(P, id) {
  if (kobanSignedIn()) {
    await syncKoban(P);
    try { const r = await kobanPick(id); if (r && r.state) { adoptServer(P, r.state, kb(P).pend); return null; } return (r && r.error) || 'Could not reach the shop'; }
    catch (e) { return String(e.message || e) || 'Could not reach the shop'; }
  }
  const err = pickIn(kb(P), id); if (!err) P.save(); return err;
}
export function armTrial(P, id) { const K = kb(P); K.trial = id && canTry(P, id) ? id : null; P.save({ local: true }); return K.trial; }

// ── shop summaries ──
// Owned / total for each role (flex counts): the Ranked progress card shows the thinnest roles.
export function roleCoverage(P) { return Object.fromEntries(ROLES.map((r) => [r, HEROES.filter((x) => x.roles.includes(r) && owns(P, x.id)).length])); }
export { RANKED_OWNED };
