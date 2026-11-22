// Franchise mode: the numbers behind a hero's career (salary, value, roster edges) and the quick-resolve
// match model. Pure and deterministic (seeded Rng only), shared by the game, the Worker and the tools.
import { HERO_BY_ID, ROLES } from '../data/heroes.js';
import { DUOS, compOf } from '../data/synergy.js';
import { Rng } from '../sim/rng.js';
import { MOD, FATIGUE, BOND_MAX, GM_STYLES } from './data.js';

// A contracted hero ("career"): { id, t: team (-1 free agent, -2 draft prospect), o: OVR 40-99, p: potential,
//   a: seasons in the league, y: contract seasons left, s: salary (k), m: morale 0-100, f: fatigue 0-10,
//   fo: form -2..2, b: bond with the team 0-10, inj: sits the next match, g/w: games/wins this season }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const roleOf = (id) => HERO_BY_ID[id].role;

// Deterministic seeds from a few integers (FNV-1a).
export function hseed(...vals) {
  let h = 2166136261 >>> 0;
  for (const v of vals) { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return h >>> 0;
}
export const rngOf = (...vals) => new Rng(hseed(...vals));
export function strSeed(s) { let h = 0; for (const c of String(s)) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return h; }

// What a hero asks for (k per season). Stars ~25, solid starters ~14, depth ~6; young upside costs a little extra.
export function salaryFor(o, p, a) {
  const base = Math.max(3, (o - 45) * 0.6), upside = a <= 2 ? Math.max(0, p - o) * 0.12 : 0, vet = a >= 7 ? -2 : 0;
  return Math.round(clamp(base + upside + vet, 3, 30));
}
// How good a hero is likely to be next season (for valuations): young heroes grow toward potential, veterans fade.
export function outlook(x) { return x.a <= 2 ? Math.min(x.p, x.o + 4) : x.a >= 7 ? x.o - 3 : x.o; }

// Trade/market value (higher = better). `style` is an AI GM style id (src/franchise/data.js GM_STYLES).
export function valueOf(x, style = 'balanced') {
  const st = GM_STYLES[style] || GM_STYLES.balanced;
  const ovr = Math.max(0, x.o - 48) ** 1.35 * 0.5 * st.ovrW;
  const up = Math.max(0, x.p - x.o) * (x.a <= 3 ? 0.55 : 0.15) * st.potW;
  const age = Math.max(0, x.a - 5) * 2.2 * st.ageW;
  const deal = (salaryFor(x.o, x.p, x.a) - x.s) * Math.min(2, Math.max(1, x.y)) * 0.45 * (st.salW || 1);
  return Math.round((ovr + up - age + deal) * 10) / 10;
}

// ── roster effects ──
export const isTired = (x) => x.f >= FATIGUE.tired;
export function moraleMod(m) { return clamp((m - 60) / 40, -1, 1) * MOD.morale; }
export function fatigueMod(f) { return f >= FATIGUE.exhausted ? MOD.exhausted : f >= FATIGUE.tired ? MOD.tired : 0; }
// Team chemistry for a set of starters: average bond, plus every duo whose two heroes both have bond 4+.
export function chemistry(starters) {
  const avg = starters.reduce((s, x) => s + Math.min(BOND_MAX, x.b || 0), 0) / Math.max(1, starters.length) / BOND_MAX;
  const ids = starters.map((x) => x.id), duos = [];
  for (const d of DUOS) if (ids.includes(d.a) && ids.includes(d.b)) {
    const a = starters.find((x) => x.id === d.a), b = starters.find((x) => x.id === d.b);
    duos.push({ id: d.id, name: d.name, bonded: a.b >= 4 && b.b >= 4 });
  }
  const comp = compOf(ids);
  return { pct: Math.round(avg * 100), duos, comp: comp.active ? comp.name : null, mod: avg * MOD.chem + duos.filter((d) => d.bonded).length * MOD.duo };
}
// One hero's edge in the sim (cfg mod): OVR + morale + form + fatigue + the lineup's chemistry, clamped.
export function heroMod(x, chemMod = 0) {
  return clamp((x.o - 70) * MOD.ovr + moraleMod(x.m) + (x.fo || 0) * MOD.form + fatigueMod(x.f) + chemMod, -MOD.cap, MOD.cap);
}
export function heroModParts(x, chemMod = 0) {
  return [['OVR', (x.o - 70) * MOD.ovr], ['Morale', moraleMod(x.m)], ['Form', (x.fo || 0) * MOD.form], ['Fatigue', fatigueMod(x.f)], ['Chemistry', chemMod]];
}
// Lineup strength = average hero edge (same units as the cfg mods, e.g. 0.03 = +3%).
export function lineupMods(starters) {
  const ch = chemistry(starters);
  return { mods: starters.map((x) => Math.round(heroMod(x, ch.mod) * 1000) / 1000), chem: ch };
}
export const strengthOf = (mods) => mods.reduce((a, b) => a + b, 0) / Math.max(1, mods.length);

// ── quick-resolve model ──
// Win chance from the strength gap, calibrated against full 5v5 sims (tools/franchise_sim.mjs --calibrate):
// equal teams are a coin flip; every 1% of average stat edge is worth about K/4 percentage points.
export const K = 14;
export const winProb = (sa, sb) => 1 / (1 + Math.exp(-K * (sa - sb)));
// A believable box score for a quick-resolved match. rng: Rng; sa/sb strengths; returns
// { w: 0|1, k: [kills a, kills b], tw: [towers destroyed by a, by b], len: seconds, crystal: bool }.
export function quickScore(rng, sa, sb, pA = winProb(sa, sb)) {
  const w = rng.next() < pA ? 0 : 1, close = 1 - Math.abs(pA - 0.5) * 2;
  const stomp = rng.next() < 0.35 * (1 - close * 0.5);
  const kw = 14 + rng.int(14) + (stomp ? 6 : 0), kl = Math.max(2, Math.round(kw * (stomp ? 0.35 : 0.55 + rng.next() * 0.35)));
  const crystal = stomp || rng.next() < 0.45;
  const len = crystal ? 600 + rng.int(300) : 900;
  const tww = crystal ? 7 + rng.int(4) : 4 + rng.int(4), twl = crystal ? rng.int(4) : Math.max(0, tww - 1 - rng.int(3));
  return { w, k: w === 0 ? [kw, kl] : [kl, kw], tw: w === 0 ? [tww, twl] : [twl, tww], len, crystal };
}

// Best 5 starters (one per role) from a roster by edge, skipping injured heroes; exhausted heroes only when no one
// else can play that role. Returns hero records in ROLES order, or null if the roles cannot be filled.
export function bestLineup(roster, hurtOk = false) {
  const ok = roster.filter((x) => hurtOk || !x.inj), score = (x) => heroMod(x) - (x.f >= FATIGUE.exhausted ? 0.05 : 0);
  const byRole = ROLES.map((r) => ok.filter((x) => HERO_BY_ID[x.id].roles.includes(r)).sort((a, b) => score(b) - score(a)));
  let best = null, bs = -Infinity;
  const used = new Set(), cur = [];
  (function go(i, s) {
    if (i === ROLES.length) { if (s > bs) { bs = s; best = cur.slice(); } return; }
    for (const x of byRole[i].slice(0, 4)) {
      if (used.has(x.id)) continue;
      used.add(x.id); cur.push(x);
      go(i + 1, s + score(x) + (HERO_BY_ID[x.id].role === ROLES[i] ? 0.004 : 0));
      cur.pop(); used.delete(x.id);
    }
  })(0, 0);
  return best || (hurtOk ? null : bestLineup(roster, true)); // nobody healthy for a role: the strained hero plays
}
// Can this roster field all five roles (ignoring injuries)?
export function coversRoles(roster) { return !!bestLineup(roster.map((x) => ({ ...x, inj: 0 }))); }
