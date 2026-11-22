// Match depth (v23): talents, item overrides and the hooks for hero interplay (src/sim/interplay.js).
// Everything runs only when the match cfg has `depth` (Game.depth); without it no hook runs and the
// game is bit-identical to v22. Deterministic: no Math.random / Date; choices are cfg data or commands.
//
// Talents (data: src/data/talents.js). At levels 4, 8 and 12 a hero takes 1 of 2 talents:
//   * the coach's preference from prep (cfg.teams[t].heroes[k].tal = [0|1|-1, x3]), else
//   * the AI's pick (aiTalent: reads the enemy comp and how the hero's game is going).
//   The pick applies at once; for TALENT_WINDOW seconds a `talent` command { hero, tier, pick } may
//   swap it (the HUD's 5s decision-tray prompt). Before the level a `talent` command sets the preference.
//   Talent effects are applied to a per-hero view of the hero's data: h.def = Object.create(baseDef) with
//   its own `abilities` array, so ability modifiers need no changes in the AI or the cast code.
// Item override: an `item` command { hero, item } makes a hero buy that item next (one of itemOptions:
//   the next item on its path, or the next item of one of its other builds). Auto stays the default.
import { sec } from './constants.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { BUILDS } from '../data/items.js';
import { TALENT_LEVELS, TALENT_WINDOW, HERO_TALENTS, parseTalent, cleanPrefs } from '../data/talents.js';
import { ULT_UP, interplayTakedown, interplayObjective, revengeMult, duoUltCheck } from './interplay.js';

// ── ability modifiers: a modified copy of one ability ──
const scale = (o, k, keys) => { if (!o) return o; const c = { ...o }; for (const q of keys) if (typeof c[q] === 'number') c[q] *= k; return c; };
const DMG_KEYS = ['b', 'l', 'ad', 'ap', 'hp', 'miss'], HEAL_KEYS = ['b', 'l', 'ad', 'ap', 'hp'];
function ccScale(cc, k) {
  if (!cc) return cc;
  const c = { ...cc };
  for (const q of ['stun', 'root', 'silence', 'fear', 'grievous']) if (c[q]) c[q] *= k;
  if (c.knock) c.knock *= 1 + (k - 1) / 2;
  if (c.slow) c.slow = [c.slow[0], c.slow[1] * k];
  for (const q of ['shred', 'mark']) if (c[q]) c[q] = [c[q][0], c[q][1] * k];
  return c;
}
export function modAbility(ab, m, slot) {
  const a = { ...ab, slot };
  if (m.dmg && a.dmg) a.dmg = scale(a.dmg, m.dmg, DMG_KEYS);
  if (m.cd) a.cd *= m.cd;
  if (m.area) { if (a.radius) a.radius *= m.area; if (a.width) a.width *= m.area; }
  if (m.range && a.range) a.range *= m.range;
  if (m.ccDur) { a.cc = ccScale(a.cc, m.ccDur); a.enemyCc = ccScale(a.enemyCc, m.ccDur); }
  if (m.heal) { a.heal = scale(a.heal, m.heal, HEAL_KEYS); a.shield = scale(a.shield, m.heal, HEAL_KEYS); a.allyShield = scale(a.allyShield, m.heal, HEAL_KEYS); }
  if (m.buffDur) {
    if (a.buff) a.buff = { ...a.buff, dur: a.buff.dur * m.buffDur };
    if (a.shield) a.shield = { ...a.shield, dur: (a.shield.dur || 2) * m.buffDur };
    if (a.stealth) a.stealth *= m.buffDur;
    if (a.parry) a.parry = { ...a.parry, dur: a.parry.dur * m.buffDur };
  }
  if (m.add) {
    const c = { ...(a.cc || {}) };
    for (const [k, v] of Object.entries(m.add)) {
      if (k === 'slow' && c.slow) c.slow = [Math.min(0.6, c.slow[0] + 0.1), Math.max(c.slow[1], v[1])];
      else if (Array.isArray(v) && c[k]) c[k] = [c[k][0] + v[0], Math.max(c[k][1], v[1])];
      else if (typeof v === 'number' && c[k]) c[k] = Math.max(c[k], v);
      else c[k] = v;
    }
    a.cc = c;
  }
  if (m.burn) a.burn = a.burn ? scale(a.burn, 1.3, DMG_KEYS) : { ...m.burn };
  return a;
}

// ── setup ──
export function setupDepth(g) {
  for (let t = 0; t < 2; t++) {
    const specs = g.cfg.teams[t].heroes;
    g.teams[t].heroes.forEach((h, k) => {
      const base = HERO_BY_ID[h.heroId];
      h.def = Object.create(base); h.def.abilities = base.abilities.slice();
      h.talPref = cleanPrefs(specs[k] && specs[k].tal);
      h.tal = [-1, -1, -1]; h.talAt = [0, 0, 0];
      h.ultUp = null; h.revenge = null; h.lastUlt = -9999; h.itemPick = null;
    });
  }
}

// Recompute a hero's talent effects from its picks (idempotent).
function rebuild(g, h) {
  const base = HERO_BY_ID[h.heroId], abs = base.abilities.slice(), stats = {};
  let cond = null, vs = null, kill = null, ult = null;
  (HERO_TALENTS[h.heroId] || []).forEach((tier, i) => {
    const pick = h.tal[i]; if (pick < 0) return;
    const t = parseTalent(tier[pick]); if (!t) return;
    const T = t.tpl;
    if (T.ab && t.slot >= 0) abs[t.slot] = modAbility(abs[t.slot], T.ab(!!abs[t.slot].ult), t.slot);
    if (T.stat) for (const k in T.stat) stats[k] = (stats[k] || 0) + T.stat[k];
    if (T.cond) (cond || (cond = [])).push(T.cond);
    if (T.vs) (vs || (vs = {}))[T.vs.when] = (vs[T.vs.when] || 0) + T.vs.pct;
    if (T.kill) kill = { ...(kill || {}), ...T.kill };
    if (T.ult) ult = { ...(ult || {}), ...T.ult };
  });
  h.def.abilities = abs;
  h.talStats = Object.keys(stats).length ? stats : null;
  h.talCond = cond; h.talVs = vs; h.talKill = kill; h.talUlt = ult;
  if (!cond) h.buffs = h.buffs.filter((b) => b.key !== 'talc');
  g.recalc(h);
}

// ── the AI's pick: enemy comp + how this hero's game is going (deterministic, from public info) ──
export function aiTalent(g, h, tier) {
  const opts = (HERO_TALENTS[h.heroId] || [])[tier]; if (!opts) return 0;
  const foes = g.teams[1 - h.team].heroes.map((x) => HERO_BY_ID[x.heroId]);
  const n = (f) => foes.filter(f).length;
  const tanks = n((x) => x.cls === 'tank' || x.tags.includes('tank')), heal = n((x) => x.tags.includes('heal') || x.tags.includes('sustain') || x.passive.kind === 'healAllies' || x.passive.kind === 'spellVamp');
  const cc = n((x) => x.tags.includes('cc')), burst = n((x) => x.cls === 'assassin' || x.tags.includes('burst'));
  const lead = h.kills + h.assists * 0.5 - h.deaths, ahead = lead >= 2, behind = h.deaths - h.kills >= 2;
  const score = (key, i) => {
    const tags = parseTalent(key).tpl.tags; let s = i === 0 ? 0.1 : 0;
    for (const t of tags) {
      if (t === 'vsTank') s += 0.5 * tanks; else if (t === 'vsHeal') s += 0.6 * heal; else if (t === 'vsCC') s += 0.35 * cc; else if (t === 'vsBurst') s += 0.3 * burst;
      else if (t === 'snowball') s += ahead ? 0.8 : behind ? -0.4 : 0; else if (t === 'safe') s += behind ? 0.8 : 0;
      else if (t === 'team') s += h.role === 'support' ? 0.6 : 0; else if (t === 'split') s += h.role === 'top' ? 0.4 : 0;
    }
    return s;
  };
  return score(opts[1], 1) > score(opts[0], 0) ? 1 : 0;
}

// Level-up hook (Game.giveXp): talents at 4, 8 and 12.
export function talentLevel(g, h) {
  const tier = TALENT_LEVELS.indexOf(h.level); if (tier < 0 || h.tal[tier] >= 0) return;
  const pref = h.talPref[tier], pick = pref >= 0 ? pref : aiTalent(g, h, tier);
  h.tal[tier] = pick; h.talAt[tier] = g.tick;
  rebuild(g, h);
  g.emit({ type: 'talent', hero: h.id, team: h.team, tier, pick, key: HERO_TALENTS[h.heroId][tier][pick], auto: pref < 0 });
  g.fx.push({ kind: 'talent', id: h.id, tier });
}

// ── commands ──
// talent { hero, tier, pick }: before the level, set the preference; within the window, swap the pick.
export function cmdTalent(g, c) {
  const h = g.teams[c.team].heroes.find((x) => x.id === c.hero), tier = c.tier, pick = c.pick;
  if (!h || !h.tal || !(tier === 0 || tier === 1 || tier === 2) || !(pick === 0 || pick === 1)) return false;
  if (h.tal[tier] < 0) { if (h.talPref[tier] === pick) return false; h.talPref[tier] = pick; return true; }
  if (h.tal[tier] === pick || g.tick > h.talAt[tier] + sec(TALENT_WINDOW)) return false;
  h.tal[tier] = pick; rebuild(g, h);
  g.emit({ type: 'talent', hero: h.id, team: h.team, tier, pick, key: HERO_TALENTS[h.heroId][tier][pick], live: true });
  g.fx.push({ kind: 'talent', id: h.id, tier });
  return true;
}
const owns = (h, it) => h.items.some((o) => o.name === it.name);
// The next-item choices for a hero: [auto (next on its path), up to 2 from its other builds]. Read-only.
export function itemOptions(h) {
  if (!h.def || h.items.length >= 6) return [];
  const next = BUILDS[h.build].items.find((it) => !owns(h, it));
  const out = next ? [next] : [];
  for (const b of h.def.builds) {
    if (b === h.build || out.length >= 3) continue;
    const it = BUILDS[b].items.find((x) => !owns(h, x) && !out.some((o) => o.name === x.name));
    if (it) out.push(it);
  }
  return out;
}
// item { hero, item }: buy this one next (the auto item clears the override).
export function cmdItem(g, c) {
  const h = g.teams[c.team].heroes.find((x) => x.id === c.hero); if (!h) return false;
  const opts = itemOptions(h), it = opts.find((o) => o.name === c.item); if (!it) return false;
  const pick = it === opts[0] ? null : it;
  if ((h.itemPick && h.itemPick.name) === (pick && pick.name)) return false;
  h.itemPick = pick;
  g.emit({ type: 'itemPick', hero: h.id, team: h.team, item: it.name, auto: !pick });
  return true;
}
// The item a hero buys next (Game.buyItems / nextItemCost).
export function nextBuy(h) {
  if (h.itemPick && !owns(h, h.itemPick)) return h.itemPick;
  h.itemPick = null;
  return BUILDS[h.build].items.find((it) => !owns(h, it));
}

// ── combat hooks ──
const ccd = (g, u) => u.stunUntil > g.tick || u.rootUntil > g.tick || u.fearUntil > g.tick || u.slows.some((s) => s.until > g.tick);
// Hero-vs-hero damage modifiers (Game.dealDamage, before resists).
export function depthDamage(g, src, tgt, amt, flags) {
  if (tgt.type !== 'hero' || flags.dot || flags.thorns) return amt;
  amt *= revengeMult(g, src, tgt);
  const v = src.talVs;
  if (v) {
    if (v.cc && ccd(g, tgt)) amt *= 1 + v.cc;
    if (v.first && !flags.proc && !(src.lastHitHero > g.tick - sec(5))) amt *= 1 + v.first;
  }
  return amt;
}
// Before and after Game.cast: an upgraded ultimate casts as an empowered copy; ult side effects after.
export function castHook(g, h, i, before) {
  const ab = h.def.abilities[i]; if (!ab || !ab.ult) return;
  if (before) {
    if (!h.ultUp) return;
    const k = 1 + (h.talUlt && h.talUlt.extra || 0);
    h._ultBase = ab;
    h.def.abilities[i] = modAbility(ab, { dmg: ULT_UP.dmg * k, area: ULT_UP.area, ccDur: ULT_UP.cc, heal: ULT_UP.heal }, i);
    return;
  }
  if (h._ultBase) {
    h.def.abilities[i] = h._ultBase; h._ultBase = null; h.ultUp = null;
    g.fx.push({ kind: 'ultEmp', id: h.id });
  }
  if (h.talUlt && h.talUlt.shield) g.addShield(h, h.maxHp * h.talUlt.shield, 3, null);
  h.lastUlt = g.tick;
  duoUltCheck(g, h);
}
// Hero takedown (Game.kill): talent on-takedown effects, ult upgrades, revenge.
export function depthTakedown(g, victim, killer, assists) {
  for (const h of killer ? [killer, ...assists] : assists) {
    const k = h.talKill; if (!k || !h.alive) continue;
    if (k.heal) g.heal(h, h.maxHp * k.heal, null, true);
    if (k.ms) g.addBuff(h, { msPct: k.ms }, k.dur || 3, 'talk');
    if (k.cdr) for (let i = 0; i < 2; i++) h.cds[i] = Math.max(g.tick, h.cds[i] - sec(k.cdr));
  }
  interplayTakedown(g, victim, killer, assists);
}
export const depthObjective = interplayObjective;
// Every 10 ticks: conditional talent stats.
export function depthTick(g) {
  for (const t of g.teams) for (const h of t.heroes) {
    if (!h.talCond || !h.alive) continue;
    const st = {};
    for (const c of h.talCond) {
      const on = c.when === 'lowHp' ? h.hp < h.maxHp * 0.4
        : g.grid.query(h.x, h.y, c.when === 'ally' ? 500 : 800).some((a) => a !== h && a.type === 'hero' && a.alive && a.team === h.team) === (c.when === 'ally');
      if (on) for (const k in c.stat) st[k] = (st[k] || 0) + c.stat[k];
    }
    if (Object.keys(st).length) g.addBuff(h, st, 0.75, 'talc');
  }
}
