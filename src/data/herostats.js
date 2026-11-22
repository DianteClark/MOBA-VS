// Hero ratings (0-10) computed from hero data, so new heroes get bars automatically.
// Raw numbers are taken at a reference point (level 9, first three items of the recommended
// build), then spread across the roster: mostly by rank (percentile) with a bit of the raw
// distance, so the bars use the whole 1-10 range and still show big gaps.
// Pure + deterministic: no DOM, no sim state.
import { HEROES, HERO_BY_ID, matchupScore } from './heroes.js';
import { BUILDS } from './items.js';

export const RATING_KEYS = ['damage', 'toughness', 'control', 'mobility', 'range', 'sustain', 'difficulty'];
export const RATING_LABEL = { damage: 'Damage', toughness: 'Toughness', control: 'Control', mobility: 'Mobility', range: 'Range', sustain: 'Sustain', difficulty: 'Difficulty' };
export const RATING_COLOR = { damage: '#ff6b5a', toughness: '#7fb4ff', control: '#b48cff', mobility: '#5fe0d0', range: '#ffd84a', sustain: '#6fdc8c', difficulty: '#ff9a3c' };

const REF_LEVEL = 9, REF_ITEMS = 3, REF_TARGET_HP = 1500;
const CC_WEIGHT = { stun: 1, knock: 1, root: 0.8, fear: 0.9, silence: 0.6 };
const AREA_KINDS = new Set(['nova', 'circle', 'zone', 'allynova']);
const SKILLSHOT_KINDS = new Set(['shot', 'line', 'hook']);

// Stats at the reference point (a light copy of Game.recalc without buffs, clans or tuning).
function refStats(x) {
  const b = x.base, L = REF_LEVEL - 1, s = { power: 0, powerMult: 0, hp: 0, hpPct: 0, armor: 0, mr: 0, asPct: 0, crit: 0, haste: 0, msPct: 0, omnivamp: 0, regen: 0 };
  for (const it of BUILDS[x.rec].items.slice(0, REF_ITEMS)) for (const k in it.stats) if (typeof it.stats[k] === 'number') s[k] = (s[k] || 0) + it.stats[k];
  const pw = s.power * (1 + s.powerMult);
  let ad = b.ad + b.adL * L, ap = b.ap || 0;
  if (x.dmgType === 'phys') ad = (ad + pw) * (1 + s.powerMult * 0.5); else ap = (ap + pw) * (1 + s.powerMult);
  return {
    ad, ap, maxHp: (b.hp + b.hpL * L + s.hp) * (1 + s.hpPct), armor: b.armor + b.armorL * L + s.armor, mr: b.mr + b.mrL * L + s.mr,
    as: Math.min(2.5, b.as * (1 + b.asL * L + s.asPct)), crit: Math.min(1, s.crit), ms: b.ms, range: b.range, regen: b.regen + s.regen,
    cdMult: 100 / (100 + s.haste), L,
  };
}
const scale = (v, st) => (v ? (v.b || 0) + (v.l || 0) * st.L + (v.ad || 0) * st.ad + (v.ap || 0) * st.ap + (v.hp || 0) * st.maxHp : 0);
const abDamage = (ab, st) => (ab.dmg ? scale(ab.dmg, st) + (ab.dmg.miss || 0) * REF_TARGET_HP * 0.5 : 0) + (ab.burn ? scale(ab.burn, st) : 0);
const ccSeconds = (cc) => (cc ? (cc.stun || 0) * CC_WEIGHT.stun + (cc.knock || 0) * CC_WEIGHT.knock + (cc.root || 0) * CC_WEIGHT.root + (cc.fear || 0) * CC_WEIGHT.fear
  + (cc.silence || 0) * CC_WEIGHT.silence + (cc.slow ? cc.slow[0] * cc.slow[1] * 0.5 : 0) + (cc.shred ? cc.shred[0] * 1.5 : 0) + (cc.mark ? cc.mark[0] * 1.5 : 0) : 0);

// Raw (unnormalised) numbers for one hero.
export function rawRatings(x) {
  const st = refStats(x), p = x.passive, abs = x.abilities;
  const cd = (ab) => Math.max(4, ab.cd * st.cdMult);
  // Damage: burst (everything at once) + sustained damage per second.
  const p3 = p.kind === 'every3' ? scale(p.dmg, st) : 0, pBurn = p.kind === 'burnHits' ? scale(p.burn, st) : 0;
  const burst = abs.reduce((a, ab) => a + abDamage(ab, st), 0) + st.ad * 2 + p3;
  const rep = p.kind === 'repeater' ? st.ad * st.as * p.pct / p.n : 0; // v24 Suzu: every nth bolt twice
  const dps = st.ad * st.as * (1 + st.crit * 0.75) + st.as * (p3 / 3 + pBurn * 0.5) + rep + abs.reduce((a, ab) => a + abDamage(ab, st) / cd(ab), 0);
  const execute = p.kind === 'executer' ? 1 + p.pct * 0.5 : ['lone', 'cruel', 'firstStrike', 'longshot'].includes(p.kind) ? 1 + p.pct * 0.5
    : p.kind === 'shredHits' ? 1 + p.cap * 0.4 : p.kind === 'frenzy' ? 1 + p.pct * p.max * 0.4 : p.kind === 'stackOnKill' ? 1.06 : 1;
  // Toughness: effective HP plus self shields, damage reduction and defensive buffs.
  let selfShield = p.kind === 'shieldOnHit' ? p.pct * st.maxHp * 1.5 : 0, resBuff = 0;
  for (const ab of abs) {
    const self = !['ally', 'allynova'].includes(ab.kind);
    if (ab.shield && self) selfShield += scale(ab.shield, st) * Math.min(1, 12 / ab.cd) * (ab.ult ? 0.6 : 1);
    if (ab.buff && (self || ab.kind === 'allynova')) { const bs = ab.buff.stats; resBuff += ((bs.armor || 0) + (bs.mr || 0)) * Math.min(1, ab.buff.dur * 1.5 / ab.cd) + (bs.thorns || 0) * 60; }
    if (ab.heal && ab.heal.hp && self) selfShield += ab.heal.hp * st.maxHp * 0.5;
  }
  for (const ab of abs) if (ab.parry) selfShield += st.ad * 2.5;
  const dr = p.kind === 'dr' ? p.pct : p.kind === 'aura' && p.stats.drPct ? p.stats.drPct : p.kind === 'tenacity' ? p.pct * 0.15 : 0;
  const lowRegen = p.kind === 'lowhpRegen' ? p.pct * st.maxHp * 4 : 0;
  if (p.kind === 'hearthGuard') resBuff += p.per * 2 * 2.5; // v24: Hearthfire embers (about 2.5 lit on average)
  const toughness = (st.maxHp * (1 + (st.armor + st.mr + resBuff) / 200) + selfShield + lowRegen) / (1 - dr);
  // Control: crowd-control seconds, weighted by how often they come up and whether they hit an area.
  let control = 0, hooks = 0;
  for (const ab of abs) {
    const c = ccSeconds(ab.cc) + ccSeconds(ab.enemyCc) + (ab.kind === 'hook' ? 0.6 : 0) + (ab.knockAway ? 0.5 : 0) + (ab.pull ? 0.8 : 0) + (ab.buff && ab.buff.stats.slowOnHit ? ab.buff.stats.slowOnHit * ab.buff.dur * 0.5 : 0);
    if (ab.kind === 'hook') hooks++;
    if (!c) continue;
    control += c * (1 + 24 / cd(ab)) * (AREA_KINDS.has(ab.kind) || ab.radius ? 1.25 : 1) * (ab.ult ? 0.7 : 1);
  }
  // Mobility: base move speed, dashes (reach x frequency) and speed buffs.
  let mobility = (st.ms - 95) * 0.6;
  for (const ab of abs) {
    if (ab.stealth) mobility += ab.stealth * 1.2;
    if (ab.allyDash) mobility += (ab.range || 250) / 100 * 0.6;
    if (ab.kind === 'dash') mobility += (ab.range || 250) / 100 * (1 + 20 / cd(ab)) * (ab.ult ? 0.6 : 1);
    if (ab.buff && ab.buff.stats.msPct && ab.kind !== 'ally') mobility += ab.buff.stats.msPct * ab.buff.dur * 30 / cd(ab) * (ab.ult ? 0.6 : 1);
  }
  if (p.kind === 'msOutOfCombat') mobility += p.pct * 20;
  if (p.kind === 'onTakedown') mobility += p.ms * 6;
  if (p.kind === 'emberChase') mobility += p.ms * 2.5 * 20;
  if (p.kind === 'kiteWind') mobility += p.ms * p.max * 12;
  // Range: basic-attack reach (most important) plus how far the damaging/cc spells reach.
  const reach = abs.filter((ab) => ab.dmg || ab.cc).map((ab) => (ab.kind === 'nova' ? ab.radius || 120 : ab.kind === 'dash' ? (ab.range || 200) * 0.6 : ab.range || 150) * (ab.ult ? 0.6 : 1));
  const rangeBuff = abs.reduce((a, ab) => a + (ab.buff && ab.buff.stats.range ? ab.buff.stats.range * 0.5 : 0), 0);
  const range = st.range * 1.6 + rangeBuff + (reach.length ? reach.reduce((a, v) => a + v, 0) / reach.length : 0);
  // Sustain: heals (own and team) per second, lifesteal, regen.
  let heals = 0;
  for (const ab of abs) if (ab.heal) heals += scale(ab.heal, st) / cd(ab) * (ab.kind === 'allynova' ? 1.5 : 1);
  const vamp = (p.kind === 'spellVamp' ? p.pct : 0) + abs.reduce((a, ab) => a + (ab.buff && ab.buff.stats.omnivamp ? ab.buff.stats.omnivamp * ab.buff.dur / ab.cd : 0), 0);
  const allyHeal = p.kind === 'healAllies' ? scale(p.heal, st) * st.as * 0.6 : p.kind === 'onTakedown' ? p.heal * st.maxHp / 30 : 0;
  const sustain = (heals + vamp * dps + allyHeal + st.regen + (p.kind === 'lowhpRegen' ? p.pct * st.maxHp * 0.25 : 0)) * (p.kind === 'hearthBrew' ? 1 + p.per * 2.5 : 1);
  // Difficulty: how much the kit depends on timing, aim and target choice.
  const tags = new Set(x.tags);
  let diff = 2;
  if (x.cls === 'assassin') diff += 2.5;
  for (const t of ['dive', 'pick']) if (tags.has(t)) diff += 1.5;
  if (tags.has('burst')) diff += 0.8;
  diff += hooks * 1.5;
  for (const ab of abs) {
    if (SKILLSHOT_KINDS.has(ab.kind) || (ab.kind === 'circle' && ab.delay >= 0.6)) diff += 0.5;
    if (ab.kind === 'dash') diff += 0.5;
    if (ab.use && ab.use.includes('execute')) diff += 0.6;
    if (ab.parry || ab.resetOnKill || ab.knockAway || ab.allyDash || ab.selfRoot) diff += 1;
  }
  if (['firstStrike', 'frenzy', 'wallSlam', 'empowerCC', 'lone', 'longshot'].includes(p.kind)) diff += 0.8;
  if (tags.has('tank')) diff -= 1; if (tags.has('sustain')) diff -= 0.5;
  if (abs.filter((ab) => ['self', 'ally', 'allynova'].includes(ab.kind)).length >= 2) diff -= 0.6;
  return { damage: { burst: burst * execute, dps: dps * execute }, toughness, control, mobility, range, sustain, difficulty: diff };
}

// Rank-based spread (ties share their average rank) mixed with min-max distance.
function spread(vals) {
  const n = vals.length, order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const pct = new Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && order[j + 1][0] === order[i][0]) j++; const r = (i + j) / 2 / Math.max(1, n - 1); for (let k = i; k <= j; k++) pct[order[k][1]] = r; i = j + 1; }
  const lo = order[0][0], hi = order[n - 1][0], span = hi - lo || 1;
  return vals.map((v, i) => Math.max(0, Math.min(10, Math.round((0.65 * pct[i] + 0.35 * (v - lo) / span) * 9 + 1))));
}

let cache = null;
function build() {
  const raws = HEROES.map(rawRatings);
  const med = (k) => { const v = raws.map((r) => r.damage[k]).sort((a, b) => a - b); return v[v.length >> 1] || 1; };
  const mb = med('burst'), md = med('dps');
  const cols = {
    damage: raws.map((r) => r.damage.burst / mb + r.damage.dps / md),
    ...Object.fromEntries(RATING_KEYS.filter((k) => k !== 'damage').map((k) => [k, raws.map((r) => r[k])])),
  };
  const spreadCols = Object.fromEntries(RATING_KEYS.map((k) => [k, spread(cols[k])]));
  cache = Object.fromEntries(HEROES.map((x, i) => [x.id, Object.fromEntries(RATING_KEYS.map((k) => [k, spreadCols[k][i]]))]));
}
export function heroRatings(id) { if (!cache) build(); return cache[id]; }

// Head-to-head lean of `id` against each other hero (positive = good into them).
// matchupScore counts enemy tags, so each foe stands in for a team of heroes like it.
const lean = (a, b) => matchupScore(a, [b, b, b]).score - matchupScore(b, [a, a, a]).score;
export function matchups(id, n = 3) {
  const x = HERO_BY_ID[id], r = heroRatings(id);
  const rows = HEROES.filter((e) => e.id !== id).map((e) => {
    const re = heroRatings(e.id), v = lean(x, e);
    // tiebreak: our damage/control into their toughness/mobility
    const tb = (r.damage + r.control - re.toughness - re.mobility) * 0.01;
    return { id: e.id, v, s: v + tb, note: (v >= 0 ? matchupScore(x, [e, e, e]) : matchupScore(e, [x, x, x])).notes[0] || '' };
  });
  const strong = rows.filter((q) => q.v > 0).sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1)).slice(0, n);
  const weak = rows.filter((q) => q.v < 0).sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1)).slice(0, n);
  return { strong, weak };
}
