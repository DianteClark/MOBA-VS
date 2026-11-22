// Champion unlocks ("Koban"): price tiers, the 15 starters, the weekly free rotation and the earn rates.
// Pure data + pure functions, shared by the client (src/unlocks.js) and the Worker (worker/koban.js), so the
// server validates purchases, picks and earnings with exactly the rules the client shows.
// Tiers come from the champion scan (tools/scan.mjs → tools/scantiers.mjs → tools/unlocks_gen.mjs).
// Koban buys champions only: cosmetics stay earned, and there is no real money anywhere.
import { HERO_TIER } from './unlocks-tiers.js';

// Bump at a launch wipe (worker POST /api/admin/wipe with the same number): every client then clears its
// local profile, history and account once (src/datareset.js) and starts fresh with the starters.
export const DATA_VERSION = 2;

export const TIERS = {
  G: { id: 'G', name: 'General', price: 1500, color: '#8fd16a', desc: 'Readable kits that do their job without many calls.' },
  S: { id: 'S', name: 'Specialist', price: 3000, color: '#6fb6ff', desc: 'Kits that want a plan, a partner or a sharper read.' },
  E: { id: 'E', name: 'Expert', price: 4500, color: '#c08cff', desc: 'Conditional kits: timing, setups and good calls pay off most.' },
  L: { id: 'L', name: 'Legend', price: 6000, color: '#ffb84a', desc: 'The most demanding kits in the game.' },
};
export const TIER_ORDER = ['G', 'S', 'E', 'L'];
export const tierOf = (id) => (HERO_TIER[id] ? HERO_TIER[id][0] : 'S');
export const priceOf = (id) => TIERS[tierOf(id)].price;
export const ALL_IDS = Object.keys(HERO_TIER);
export const isHero = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(HERO_TIER, id);

// Three Generals per role, picked for different playstyles within the role (see /home/claude/champion-scan.md).
export const STARTERS = ['monolith', 'varro', 'gorath', 'upa', 'leonin', 'isamu', 'hitotsume', 'totem', 'nami', 'fletch', 'sling', 'shuri', 'aurelia', 'frost', 'gizmo'];
export const isStarter = (id) => STARTERS.includes(id);
export const RANKED_OWNED = 25; // online Ranked needs this many owned champions (starters included)
export const LOANER_UNTIL = 25; // below this, a role that bans emptied gets a free loaner for that match

export const ECON = {
  win: 120, loss: 60, firstWin: 200, // match pay; the first win of each UTC day adds firstWin
  goal: [50, 75, 100], // daily goals by tier (easy, medium, hard)
  level: 150, // each coach level-up
  rookieGames: 30, rookieMult: 2, // match pay x2 for the first 30 matches
  ach: 100, // each achievement
  pass: 60, // each season pass level
  campaign: 5600, campaignGrant: 600, // story campaign stars (5,400 in all) + the Coach Academy (200): a lifetime cap, at most 600 a grant
  pickEvery: 4, pickCap: 10, pickKoban: 1500, // a free General every 4 coach levels (10 by level 40); with every General owned, a pick pays 1,500
  dayMatches: 30, minGap: 90000, maxAge: 7 * 86400000, // sync bounds: paid matches per UTC day, seconds between paid matches, oldest claim
};
// Pay for one match (no daily bonus): { base, rookie } with the rookie boost applied.
function matchPay(won, gamesBefore) {
  const base = won ? ECON.win : ECON.loss, rookie = gamesBefore < ECON.rookieGames;
  return { base, rookie, total: rookie ? base * ECON.rookieMult : base };
}
// Free General picks earned at coach level lv (capped).
const picksAt = (lv) => Math.min(ECON.pickCap, Math.floor(Math.max(0, lv) / ECON.pickEvery));
// The coach level the server accepts for g paid matches: at most ~260 coach XP a match (a win with every call,
// goal and story bonus), walked through the same level curve as src/data/meta.js (150 + 25 L per level).
function maxLevelFor(g) {
  let xp = Math.max(0, g) * 260, lv = 1;
  while (lv < 40 && xp >= 150 + 25 * lv) { xp -= 150 + 25 * lv; lv++; }
  return lv;
}
// Ownership value bound for a first sync that seeds the server from an offline (never signed in) profile.
const SEED_CAP = 30000;

// ── weekly free rotation ──
// ISO weeks (Monday 00:00 UTC). 1970-01-05 was a Monday: day 4.
export const dayOf = (now) => Math.floor(now / 86400000);
export const weekOf = (now) => Math.floor((dayOf(now) - 4) / 7);
export const weekEnds = (w) => (w + 1) * 7 * 86400000 + 4 * 86400000;
const ROLE_LIST = ['top', 'jungle', 'mid', 'bot', 'support'];
const hash = (...xs) => { let h = 2166136261; for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; };
// 2 per main role (10), never a starter, the same for everyone. Each role's pair mixes tiers: one cheaper
// (General or Specialist) and one pricier (Specialist, Expert or Legend), rotating which, so every week shows
// a spread of the shop. A hero is not on two weeks in a row when its role has enough choices.
function rawRotation(week, avoid) {
  const out = [];
  ROLE_LIST.forEach((role, ri) => {
    const pool = ALL_IDS.filter((id) => HERO_TIER[id][1] === role && !isStarter(id)).sort(), used = new Set();
    const pick = (tiers, salt) => {
      for (const strict of [true, false]) for (const t of tiers) {
        const L = pool.filter((id) => HERO_TIER[id][0] === t && !used.has(id) && !(strict && avoid.has(id)));
        if (L.length) return L[hash(week, ri, salt) % L.length];
      }
      return null;
    };
    const lo = (week + ri) % 2 ? ['S', 'G'] : ['G', 'S'], hi = [['E', 'L', 'S'], ['S', 'E', 'L'], ['L', 'E', 'S']][((week % 3) + 3 + ri) % 3];
    for (const [tiers, salt] of [[lo, 1], [hi, 2]]) { const id = pick(tiers, salt); if (id) { used.add(id); out.push(id); } }
  });
  return out;
}
// Chained from a fixed start week, so "not two weeks in a row" holds exactly (cheap: one step per week).
const ROT_EPOCH = 2960, rotCache = new Map();
export function rotation(week) {
  if (rotCache.has(week)) return rotCache.get(week);
  if (week <= ROT_EPOCH) { const r = rawRotation(week, new Set()); rotCache.set(week, r); return r; }
  let w = week - 1; while (w > ROT_EPOCH && !rotCache.has(w)) w--;
  let prev = rotation(w);
  for (let x = w + 1; x <= week; x++) { prev = rawRotation(x, new Set(prev)); rotCache.set(x, prev); }
  return prev;
}
export const rotationNow = (now) => rotation(weekOf(now));

// ── the Koban ledger: one set of rules for the client mirror and the Worker ──
// State: { bal, own: [non-starter ids], g: paid matches, fw: day of the last first-win bonus, day/dg/dk: the UTC
// day of the last paid match, paid matches that day, goal tiers paid that day (bits), at: time of the last paid
// match, lv: coach level paid, ach: achievement ids paid, ps/pl/pg: season, pass level paid, paid matches that
// season, picks: free picks used, earned/spent: totals }.
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const ACH_RE = /^[a-z0-9_]{1,24}$/, ACH_MAX = 120;
export function freshLedger(now = 0) {
  return { bal: 0, own: [], g: 0, fw: -1, day: -1, dg: 0, dk: 0, at: 0, lv: 1, ach: [], ps: 0, pl: 1, pg: 0, picks: 0, cp: 0, earned: 0, spent: 0, t0: now };
}
// Sanitize any stored or received ledger (known ids only, bounded lists and numbers).
export function cleanLedger(x) {
  const o = freshLedger(), v = x && typeof x === 'object' ? x : {};
  o.bal = int(v.bal, 0, 1e7); o.g = int(v.g, 0, 1e5); o.fw = int(v.fw, -1, 1e6); o.day = int(v.day, -1, 1e6); o.dg = int(v.dg, 0, 999); o.dk = int(v.dk, 0, 7);
  o.at = int(v.at, 0, 1e14); o.lv = int(v.lv, 1, 40); o.ps = int(v.ps, 0, 999); o.pl = int(v.pl, 1, 99); o.pg = int(v.pg, 0, 1e5); o.picks = int(v.picks, 0, ECON.pickCap); o.cp = int(v.cp, 0, ECON.campaign);
  o.earned = int(v.earned, 0, 1e9); o.spent = int(v.spent, 0, 1e9); o.t0 = int(v.t0, 0, 1e14);
  o.own = [...new Set((Array.isArray(v.own) ? v.own : []).filter((id) => isHero(id) && !isStarter(id)))];
  o.ach = [...new Set((Array.isArray(v.ach) ? v.ach : []).filter((id) => typeof id === 'string' && ACH_RE.test(id)))].slice(0, ACH_MAX);
  return o;
}
export const ownsIn = (st, id) => isStarter(id) || st.own.includes(id);
export const ownedCountIn = (st) => STARTERS.length + st.own.length;
export const picksLeftIn = (st) => Math.max(0, picksAt(st.lv) - st.picks);
// Apply one earning claim. Returns the Koban credited with labelled parts ([] = nothing: refused or capped).
//   { k: 'm', won, t }   a finished match (pay, rookie boost, first win of the day)
//   { k: 'g', tier, t }  a daily goal completed (needs a paid match that UTC day; each tier once a day)
//   { k: 'lv', lv }      coach level reached (bounded by the paid matches)
//   { k: 'a', id }       an achievement (each once)
//   { k: 'p', s, lv }    season pass level reached (at most two levels per paid match that season)
//   { k: 'c', n, id }    story campaign / Coach Academy reward (src/koban.js grantKoban), within the lifetime cap
export function applyClaim(st, c, now) {
  const parts = [], add = (label, n) => { if (n > 0) { parts.push([label, n]); st.bal += n; st.earned += n; } };
  if (!c || typeof c !== 'object') return parts;
  if (c.k === 'm') {
    const t = Number(c.t) || 0;
    if (!(t <= now + 60000 && t >= now - ECON.maxAge && t >= st.at + ECON.minGap)) return parts;
    const day = dayOf(t);
    if (day !== st.day) { st.day = day; st.dg = 0; st.dk = 0; }
    if (st.dg >= ECON.dayMatches) return parts;
    const pay = matchPay(!!c.won, st.g);
    add(c.won ? 'Victory' : 'Played', pay.base); if (pay.rookie) add('Rookie boost', pay.total - pay.base);
    if (c.won && st.fw !== day) { st.fw = day; add('First win of the day', ECON.firstWin); }
    st.g++; st.dg++; st.pg++; st.at = t;
  } else if (c.k === 'g') {
    const tier = int(c.tier, 0, 2), bit = 1 << tier;
    if (dayOf(Number(c.t) || 0) !== st.day || !st.dg || (st.dk & bit)) return parts;
    st.dk |= bit; add('Daily goal', ECON.goal[tier]);
  } else if (c.k === 'lv') {
    const lv = Math.min(int(c.lv, 1, 40), maxLevelFor(st.g));
    if (lv > st.lv) { add(`Coach level ${lv}`, (lv - st.lv) * ECON.level); st.lv = lv; }
  } else if (c.k === 'a') {
    if (typeof c.id !== 'string' || !ACH_RE.test(c.id) || st.ach.includes(c.id) || st.ach.length >= ACH_MAX) return parts;
    st.ach.push(c.id); add('Achievement', ECON.ach);
  } else if (c.k === 'c') {
    const n = Math.min(int(c.n, 0, ECON.campaignGrant), ECON.campaign - st.cp);
    if (n > 0) { st.cp += n; add(String(c.id || '').startsWith('tutorial') ? 'Coach Academy' : 'Story campaign', n); }
  } else if (c.k === 'p') {
    const s = int(c.s, 1, 999);
    if (s !== st.ps) { st.ps = s; st.pl = 1; st.pg = 0; }
    const lv = Math.min(int(c.lv, 1, 99), 1 + st.pg * 2);
    if (lv > st.pl) { add('Season pass', (lv - st.pl) * ECON.pass); st.pl = lv; }
  }
  return parts;
}
// Buy a champion: null on success, else the reason.
export function buyIn(st, id) {
  if (!isHero(id)) return 'Unknown champion';
  if (ownsIn(st, id)) return 'Already owned';
  const price = priceOf(id);
  if (st.bal < price) return `Needs ${price - st.bal} more Koban`;
  st.bal -= price; st.spent += price; st.own.push(id);
  return null;
}
// Use a free pick (Generals only). With every General owned a pick pays ECON.pickKoban instead (id ignored).
export const allGeneralsOwned = (st) => ALL_IDS.every((id) => tierOf(id) !== 'G' || ownsIn(st, id));
export function pickIn(st, id) {
  if (picksLeftIn(st) <= 0) return 'No free pick available';
  if (allGeneralsOwned(st)) { st.picks++; st.bal += ECON.pickKoban; st.earned += ECON.pickKoban; return null; }
  if (!isHero(id) || tierOf(id) !== 'G') return 'Free picks are for Generals';
  if (ownsIn(st, id)) return 'Already owned';
  st.picks++; st.own.push(id);
  return null;
}
// First sync of a profile that earned offline before it had an account: its ledger, bounded. Owned value
// (prices of bought champions) plus balance stays within SEED_CAP, cheapest champions kept first.
export function seedLedger(x, now) {
  const st = cleanLedger(x);
  st.g = Math.min(st.g, 3000); st.lv = Math.min(st.lv, maxLevelFor(st.g)); st.picks = Math.min(st.picks, picksAt(st.lv));
  let room = SEED_CAP; const keep = [];
  for (const id of st.own.slice().sort((a, b) => priceOf(a) - priceOf(b) || (a < b ? -1 : 1))) { if (priceOf(id) <= room) { keep.push(id); room -= priceOf(id); } }
  st.own = keep; st.bal = Math.min(st.bal, room); st.at = Math.min(st.at, now); st.t0 = now;
  return st;
}
