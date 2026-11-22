// Champion scan, step 2: unlock price tiers from a tools/scan.mjs result plus the static kit data.
//   node tools/scantiers.mjs scan.json [--ex 0.55] [--ge 0.1] [--out tiers.json]
// Signals (all z-scored across the roster):
//   coaching sensitivity CS = paired sharp-minus-passive gaps: win 50%, gold 30%, hero damage 20%
//   (CS and PF use empirical-Bayes shrunk values over the sd of the raw values, so a measure that is mostly
//   noise at this sample size carries little weight; the static signals are plain z-scores)
//   skill load SK         = Difficulty rating (src/data/herostats.js) 60%, kit complexity (conditional mechanics) 40%
//   passive floor PF      = shrunk passive-coach win rate (centred)
//   context dependence CD = measured context spread (comp / duo / clan / plan) 60%, static plan dependence 40%
// Tiers: Expert = high CS+SK; General = solid PF with low CS+SK; everyone else is a Specialist (plus anyone
// whose CD stands out). Borderline: within 0.25 of a cut.
import { readFileSync, writeFileSync } from 'node:fs';
const { HEROES, ROLES, HERO_BY_ID } = await import('../src/data/heroes.js');
const { heroRatings } = await import('../src/data/herostats.js');
const { DUOS } = await import('../src/data/synergy.js');

// Conditional mechanics: things that only pay off when timed, aimed, sequenced or set up.
const PASSIVE_CX = { every3: 0.5, executer: 1, lowhpRegen: 0.5, firstStrike: 1, empowerCC: 1, cruel: 1, lone: 1, stackOnKill: 1, markAbilities: 1, wallSlam: 1.5, longshot: 1, markEvery: 0.5,
  frenzy: 0.5, splashEvery: 0.5, kiteWind: 1, emberChase: 1, repeater: 0.5, hearthBrew: 0.5, lanternKeeper: 1, hearthGuard: 1, onTakedown: 0.5, msOutOfCombat: 0.5 };
const AB_CX = { parry: 1.5, resetOnKill: 1, selfRoot: 1, allyDash: 1, knockAway: 1, stealth: 1, pull: 1, bounce: 0.5, enemyCc: 0.5, onHitAlly: 0.5, cleanse: 0.5, reveal: 0.5 };
export function complexity(h) {
  let c = PASSIVE_CX[h.passive.kind] || 0; const notes = [];
  if (c) notes.push(h.passive.name);
  for (const a of h.abilities) {
    let x = 0;
    if (a.kind === 'hook') x += 1; else if (a.kind === 'shot' || a.kind === 'line') x += 0.25;
    if (a.kind === 'dash') x += 0.5;
    if (a.delay >= 0.6) x += 0.5;
    if (a.use.includes('execute')) x += 0.5;
    for (const k in AB_CX) if (a[k]) x += AB_CX[k];
    if (x >= 1) notes.push(a.name);
    c += x;
  }
  return { c, notes };
}
// Static plan / comp dependence: kits that need a plan (split, siege, scaling), a carry to protect, or a partner.
function staticDep(h) {
  const t = new Set(h.tags); let d = 0;
  if (t.has('split')) d += 1; if (t.has('siege')) d += 0.7; if (t.has('vision')) d += 0.5;
  if (h.curve === 'late' || t.has('scaling')) d += 0.6; if (h.curve === 'early' || t.has('early')) d += 0.4;
  if (['heal', 'shield', 'buff'].some((k) => t.has(k)) && h.cls === 'support') d += 0.6;
  if (t.has('engage') && t.has('pick')) d += 0.4;
  d += 0.3 * DUOS.filter((x) => x.a === h.id || x.b === h.id).length;
  return d;
}

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
const scan = JSON.parse(readFileSync(file, 'utf8'));
const R = Object.fromEntries(scan.rows.map((r) => [r.id, r]));
const z = (vals) => { const m = vals.reduce((a, v) => a + v, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length) || 1; return vals.map((v) => (v - m) / sd); };
const H = HEROES.filter((h) => R[h.id]);
const col = (f) => z(H.map(f));
// shrunk measures are scaled by the sd of their RAW values (not z-scored): when shrinkage says a measure is
// mostly noise its spread collapses, and so does its weight in the score
const zs = (shr, raw) => { const v = H.map((h) => R[h.id][raw]), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1;
  const w = H.map((h) => R[h.id][shr]), ms = w.reduce((a, x) => a + x, 0) / w.length; return w.map((x) => (x - ms) / sd); };
const zGap = zs('gapShr', 'gap'), zGold = zs('lgShr', 'lg'), zDmg = zs('ldShr', 'ld');
const zDiff = col((h) => heroRatings(h.id).difficulty), zCx = col((h) => complexity(h).c);
const zPass = zs('rpShr', 'rp');
const zSpread = col((h) => R[h.id].spread), zDep = col((h) => staticDep(h));
const rows = H.map((h, i) => {
  const r = R[h.id], CS = 0.5 * zGap[i] + 0.3 * zGold[i] + 0.2 * zDmg[i], SK = 0.6 * zDiff[i] + 0.4 * zCx[i];
  const PF = zPass[i], CD = 0.6 * zSpread[i] + 0.4 * zDep[i];
  const E = 0.5 * CS + 0.5 * SK, G = 0.45 * PF - 0.3 * CS - 0.25 * SK - 0.15 * CD;
  return { h, r, CS, SK, PF, CD, E, G, diff: heroRatings(h.id).difficulty, cx: complexity(h) };
});
// cuts: Expert = E >= EX; General = G >= GE (and not Expert, and PF not clearly weak); the rest Specialist
const EX = +opt('ex', 0.55), GE = +opt('ge', 0.1);
for (const x of rows) {
  // General must also be straightforward: Difficulty 7+ or a 2.5+ complexity kit never prices as General
  x.tier = x.E >= EX ? 'Expert' : x.G >= GE && x.PF > -0.6 && x.CD < 1.2 && x.diff < 7 && x.cx.c < 2.5 ? 'General' : 'Specialist';
  x.border = Math.abs(x.E - EX) < 0.25 || (x.tier !== 'Expert' && Math.abs(x.G - GE) < 0.25);
}
const PRICE = { General: 1500, Specialist: 3000, Expert: 4500 };
const counts = {}; for (const x of rows) counts[x.tier] = (counts[x.tier] || 0) + 1;
console.log(`n=${scan.n} games · sharp ${(100 * scan.S).toFixed(1)}% · tiers`, counts, 'per role', Object.fromEntries(ROLES.map((ro) => [ro, ['General', 'Specialist', 'Expert'].map((t) => rows.filter((x) => x.h.role === ro && x.tier === t).length).join('/')])));
console.log('id         role    tier        E      G     CS    SK    PF    CD   diff  cx   passWR sharpWR gap(sh) gold% games');
for (const ro of ROLES) for (const x of rows.filter((q) => q.h.role === ro).sort((a, b) => b.G - a.G)) {
  const r = x.r, f = (v) => v.toFixed(2).padStart(5);
  console.log(`${x.h.id.padEnd(10)} ${ro.padEnd(7)} ${(x.tier + (x.border ? '?' : '')).padEnd(11)} ${f(x.E)} ${f(x.G)} ${f(x.CS)} ${f(x.SK)} ${f(x.PF)} ${f(x.CD)}  ${String(x.diff).padStart(2)}  ${x.cx.c.toFixed(1)}   ${(100 * r.pw / r.pg).toFixed(0).padStart(3)}    ${(100 * r.sw / r.sg).toFixed(0).padStart(3)}   ${(100 * r.gapShr).toFixed(1).padStart(5)}  ${(100 * r.lgShr).toFixed(1).padStart(5)}  ${r.sg + r.pg}`);
}
const out = opt('out', null);
if (out) writeFileSync(out, JSON.stringify(rows.map((x) => ({ id: x.h.id, tier: x.tier, border: x.border, E: x.E, G: x.G, CS: x.CS, SK: x.SK, PF: x.PF, CD: x.CD, diff: x.diff, cx: x.cx, price: PRICE[x.tier] })), null, 1));
