// Status effects, on-hit procs, auras, hero duos and team comps (v20 content).
// Everything here is deterministic sim code called from Game hooks; no Math.random / Date.
//
// Status effects (ability `cc` fields, see heroes.js):
//   silence: s        no abilities (attacks and Flash still work)
//   fear: s           runs away from the source, can't act (minions/mobs: brief stun)
//   shred: [pct, s]   armor AND magic resist reduced by pct (all sources, capped)
//   mark: [pct, s]    the next hit from the marker's team deals +pct damage, then pops
//   grievous: s       healing and regen received -40%
//   (stun, root, knock, slow exist in game.js; root = can't move or dash, can still attack)
// Tenacity (stat) shortens stun/root/silence/fear/slow.
import { sec } from './constants.js';
import { dist2, dist, norm } from './geom.js';
import { DUOS, COMPS, compOf } from '../data/synergy.js';

export const SHRED_CAP = 0.4;
const TEN_CAP = 0.6;

// ── status helpers ──
export const tenacity = (u) => (u.type === 'hero' && u.stats ? 1 - Math.min(TEN_CAP, u.stats.tenacity || 0) : 1);
export function shredOf(g, u) { return u.shredUntil > g.tick ? u.shred : 0; }
export function addShred(g, u, pct, dur, stack, cap = SHRED_CAP) {
  if (!u.alive || u.structure || pct <= 0) return;
  const cur = shredOf(g, u), next = stack ? Math.min(cap, cur + pct) : pct;
  u.shred = Math.min(SHRED_CAP, Math.max(cur, next));
  u.shredUntil = Math.max(cur > 0 ? u.shredUntil : 0, g.tick + sec(dur));
}
export function addMark(g, u, pct, dur, src) {
  if (!u.alive || u.structure || !src) return;
  const m = u.mark;
  if (m && m.until > g.tick && m.team === src.team && m.pct > pct) { m.until = Math.max(m.until, g.tick + sec(dur)); return; }
  u.mark = { pct, until: g.tick + sec(dur), team: src.team };
  g.fx.push({ kind: 'cc', id: u.id, cc: 'mark' });
}
// Extra CC kinds (game.applyCC handles stun/knock/root/slow and calls this).
export function applyExtraCC(g, u, cc, src, ten) {
  const now = g.tick;
  if (cc.silence) { u.silenceUntil = Math.max(u.silenceUntil || 0, now + sec(cc.silence * ten)); if (u.type === 'hero') g.fx.push({ kind: 'cc', id: u.id, cc: 'silence' }); }
  if (cc.fear) {
    if (u.type === 'hero') {
      u.fearUntil = Math.max(u.fearUntil || 0, now + sec(cc.fear * ten));
      u.fearFrom = src ? { x: src.x, y: src.y } : { x: u.x, y: u.y - 1 };
      u.recallAt = 0; if (u.dash && !u.dash.pulled) u.dash = null;
      g.fx.push({ kind: 'cc', id: u.id, cc: 'fear' });
    } else u.stunUntil = Math.max(u.stunUntil, now + sec(cc.fear * 0.5));
  }
  if (cc.shred) addShred(g, u, cc.shred[0], cc.shred[1], false);
  if (cc.mark) addMark(g, u, cc.mark[0], cc.mark[1], src);
  if (cc.grievous) u.grievousUntil = Math.max(u.grievousUntil || 0, now + sec(cc.grievous));
}
export function isCCd(g, u) {
  const t = g.tick;
  return u.stunUntil > t || u.rootUntil > t || u.fearUntil > t || u.silenceUntil > t;
}
export function cleanse(g, u) {
  u.stunUntil = Math.min(u.stunUntil, g.tick); u.rootUntil = 0; u.knockUntil = 0; u.silenceUntil = 0; u.fearUntil = 0;
  u.slows = []; u.shred = 0; u.shredUntil = 0; u.mark = null; u.grievousUntil = 0;
  u.burns = [];
  g.fx.push({ kind: 'fx', name: 'shield_yellow', x: u.x, y: u.y, s: 1.1, follow: u.id });
}
// Feared heroes stumble away from the source. Returns true while feared.
export function fearStep(g, h) {
  if (!(h.fearUntil > g.tick)) return false;
  const f = h.fearFrom || h, d = norm(h.x - f.x, h.y - f.y), dd = d.x || d.y ? d : { x: 0, y: 1 };
  if (!h.slows.some((s) => s.fear && s.until > g.tick)) h.slows.push({ pct: 0.35, until: h.fearUntil, fear: true });
  g.moveToward(h, { x: h.x + dd.x * 120, y: h.y + dd.y * 120 }, false);
  return true;
}

// ── stats from passives, duos ──
export function passiveStats(g, h, s) {
  const p = h.def.passive;
  if (p.kind === 'tenacity') s.tenacity += p.pct;
  else if (p.kind === 'sight') s.sight += p.pct;
  else if (p.kind === 'stackOnKill' && h.tribute) s.power += p.power * h.tribute;
  if (h.duoStats) for (const k in h.duoStats) s[k] = (s[k] || 0) + h.duoStats[k];
}

// ── damage pipeline hooks ──
// Parry: the next hero hit is negated and the attacker is stunned.
export function tryParry(g, src, tgt, flags) {
  if (!(tgt.parryUntil > g.tick) || !src || src.type !== 'hero' || src.team === tgt.team || flags.dot || flags.thorns || flags.proc) return false;
  tgt.parryUntil = 0;
  g.applyCC(src, { stun: tgt.parryStun || 1 }, tgt);
  g.fx.push({ kind: 'fx', name: 'shield_yellow', x: tgt.x, y: tgt.y, s: 1.4, follow: tgt.id });
  g.fx.push({ kind: 'cc', id: tgt.id, cc: 'parry' });
  return true;
}
// Hero -> anything damage modifiers (before resists).
export function heroDamageMods(g, src, tgt, amt, flags) {
  const now = g.tick;
  if (flags.dot || flags.thorns) return amt;
  const m = tgt.mark;
  if (m && m.until > now && m.team === src.team && !flags.proc) { amt *= 1 + m.pct; tgt.mark = null; g.fx.push({ kind: 'fx', name: 'cutx', x: tgt.x, y: tgt.y - 8, s: 1.1 }); }
  if (tgt.type !== 'hero') return amt;
  const p = src.def.passive;
  switch (p.kind) {
    case 'firstStrike': if (!(src.lastHitHero > now - sec(p.cd))) { amt *= 1 + p.pct; g.fx.push({ kind: 'fx', name: 'slash', x: tgt.x, y: tgt.y, s: 1.2 }); } break;
    case 'lone': if (!g.grid.query(tgt.x, tgt.y, 500).some((a) => a !== tgt && a.type === 'hero' && a.alive && a.team === tgt.team)) amt *= 1 + p.pct; break;
    case 'cruel': if (tgt.stunUntil > now || tgt.rootUntil > now || tgt.fearUntil > now || tgt.slows.some((s) => s.until > now)) amt *= 1 + p.pct; break;
    case 'longshot': if (flags.ability) amt *= 1 + p.pct * Math.min(1, Math.max(0, (dist(src, tgt) - 150) / 300)); break;
  }
  return amt;
}
// Damage reduction on hero targets (aura dr stat).
export const drMult = (tgt) => 1 - Math.min(0.3, tgt.stats.drPct || 0);
// Hero hurt by hero (after damage): warden guard shields and duo combos.
export function onHeroHurt(g, src, tgt) {
  const now = g.tick;
  if (tgt.alive && tgt.hp > 0 && tgt.hp < tgt.maxHp * 0.4) {
    for (const w of g.grid.query(tgt.x, tgt.y, 450)) {
      if (w === tgt || w.type !== 'hero' || !w.alive || w.team !== tgt.team || !(w.stats.guard > 0) || now < (w.guardCd || 0)) continue;
      g.addShield(tgt, w.maxHp * w.stats.guard, 3, w); w.guardCd = now + sec(18);
      g.fx.push({ kind: 'fx', name: 'shield', x: tgt.x, y: tgt.y, s: 1.3, follow: tgt.id });
      break;
    }
  }
  const links = g.duoLinks && g.duoLinks[src.team];
  if (!links) return;
  for (const L of links) {
    if (!L.active || now < L.readyAt || (L.a !== src && L.b !== src)) continue;
    const mate = L.a === src ? L.b : L.a;
    if (!(tgt.dmgBy[mate.id] > now - sec(2))) continue;
    L.readyAt = now + sec(25);
    const d = L.duo;
    if (d.combo === 'burst' && tgt.alive) g.dealDamage(src, tgt, tgt.maxHp * 0.05, 'true', { proc: true, ability: true });
    else if (d.combo === 'shield') for (const x of [L.a, L.b]) if (x.alive) g.addShield(x, x.maxHp * 0.08, 2.5, null);
    else if (d.combo === 'rush') for (const x of [L.a, L.b]) if (x.alive) g.addBuff(x, { msPct: 0.25, asPct: 0.15 }, 3, 'duoRush');
    g.fx.push({ kind: 'duo', a: L.a.id, b: L.b.id, x: tgt.x, y: tgt.y, name: d.name });
    g.emit({ type: 'duo', team: src.team, a: L.a.id, b: L.b.id, duo: d.id, name: d.name, combo: d.combo });
  }
}

// ── on-hit procs ──
// Extra damage folded into a hero's basic attack (pierce item), returns the new raw amount.
export function basicBonus(g, att, tgt, dmg) {
  const s = att.stats;
  if (s.tankBuster && tgt.type === 'hero') dmg += tgt.maxHp * s.tankBuster;
  return dmg;
}
// Everything else a hero's basic hit triggers (after the hit itself).
export function onBasicHit(g, att, tgt) {
  const now = g.tick, s = att.stats, p = att.def.passive, hero = tgt.type === 'hero';
  if (!tgt.alive) return;
  if (att.sbArm > now && s.spellblade) {
    att.sbArm = 0; att.sbCd = now + sec(1.5);
    const base = att.def.dmgType === 'phys' ? s.ad : Math.max(s.ad, s.ap * 0.8);
    g.dealDamage(att, tgt, base * s.spellblade, att.def.dmgType, { ability: true, proc: true });
    if (s.sbSlow && tgt.alive) tgt.slows.push({ pct: s.sbSlow, until: now + sec(1.5) });
    g.fx.push({ kind: 'fx', name: 'spark', x: tgt.x, y: tgt.y, s: 1.1 });
  }
  if (!tgt.alive) return;
  if (s.onHit) g.dealDamage(att, tgt, s.onHit, 'magic', { proc: true });
  if (att.empArm > now && p.kind === 'empowerCC' && !tgt.structure) {
    att.empArm = 0; att.empCd = now + sec(p.cd);
    if (p.dmg) g.dealDamage(att, tgt, g.scaleVal(att, p.dmg), att.def.dmgType, { ability: true, proc: true });
    if (tgt.alive) g.applyCC(tgt, p.cc, att);
  }
  if (!tgt.alive || tgt.structure) return;
  if (hero && s.sunder) addShred(g, tgt, s.sunder, 3, true);
  if (hero && s.peelSlow && tgt.lastHitHero > now - sec(2)) tgt.slows.push({ pct: s.peelSlow, until: now + sec(1) });
  switch (p.kind) {
    case 'shredHits': if (hero) addShred(g, tgt, p.pct, p.dur, true, p.cap); break;
    case 'grievousHits': tgt.grievousUntil = Math.max(tgt.grievousUntil || 0, now + sec(p.dur)); break;
    case 'markEvery': if (hero && att.every3 % p.n === 0) addMark(g, tgt, p.pct, p.dur, att); break;
    case 'frenzy': {
      att.frenzy = att.frenzyT === tgt.id ? Math.min(p.max, (att.frenzy || 0) + 1) : 1; att.frenzyT = tgt.id;
      g.addBuff(att, { asPct: p.pct * att.frenzy }, 2.5, 'frenzy'); break;
    }
    case 'splashEvery': if (att.every3 % p.n === 0) {
      for (const e of g.grid.query(tgt.x, tgt.y, p.r + 20)) if (e !== tgt && g.isEnemyHittable(att, e) && dist2(e, tgt) <= (p.r + e.radius) ** 2) g.dealDamage(att, e, s.ad * p.pct, 'phys', { aoe: true, proc: true });
      g.fx.push({ kind: 'fx', name: 'explosion', x: tgt.x, y: tgt.y, s: 1.2 });
      break;
    }
  }
}
// Ability hit extras (after damage + standard cc).
export function onAbilityHit(g, h, e, ab) {
  const now = g.tick, s = h.stats, p = h.def.passive, hero = e.type === 'hero';
  if (!e.alive) return;
  if (hero && s.sunder) addShred(g, e, s.sunder, 3, true);
  if (hero && s.peelSlow && e.lastHitHero > now - sec(2)) e.slows.push({ pct: s.peelSlow, until: now + sec(1) });
  if (p.kind === 'markAbilities' && hero) addMark(g, e, p.pct, p.dur, h);
  if (ab.reveal && hero) { e.revealUntil = now + sec(ab.reveal); e.stealthUntil = 0; }
  if (ab.resetOnKill && hero) e.resetBy = { id: h.id, i: h.def.abilities.indexOf(ab), until: now + sec(3) };
  if (ab.knockAway && !e.boss && !e.structure) {
    const d = norm(e.x - h.x, e.y - h.y), want = { x: e.x + d.x * ab.knockAway, y: e.y + d.y * ab.knockAway };
    const end = g.rayEnd(e, want), short = dist(end, want);
    if (hero) { e.dash = { x: end.x, y: end.y, speed: 900, until: now + sec(0.4), pulled: true }; e.recallAt = 0; } else { e.x = end.x; e.y = end.y; }
    if (p.kind === 'wallSlam' && short > 24) { g.applyCC(e, { stun: p.stun }, h); g.fx.push({ kind: 'fx', name: 'impact', x: end.x, y: end.y, s: 1.4 }); }
  }
}
// Called at the end of Game.cast (all ability kinds).
export function onCast(g, h, ab, tgt, aim) {
  const now = g.tick, s = h.stats, p = h.def.passive;
  if (s.spellblade && now >= (h.sbCd || 0)) h.sbArm = now + sec(4);
  if (p.kind === 'empowerCC' && now >= (h.empCd || 0)) h.empArm = now + sec(3);
  if (ab.stealth) { h.stealthUntil = now + sec(ab.stealth); g.fx.push({ kind: 'fx', name: 'smoke', x: h.x, y: h.y, s: 1.4 }); }
  if (ab.parry) { h.parryUntil = now + sec(ab.parry.dur); h.parryStun = ab.parry.stun; }
  if (ab.selfRoot) { h.rootUntil = Math.max(h.rootUntil, now + sec(ab.selfRoot)); h.path = null; }
  if (ab.cleanse && ab.kind === 'self') cleanse(g, h);
  if (ab.allyShield) {
    for (const a of g.grid.query(h.x, h.y, ab.radius || 300)) if (a.type === 'hero' && a.alive && a.team === h.team) g.addShield(a, g.scaleVal(h, ab.allyShield), ab.allyShield.dur || 2, h);
  }
  if (ab.enemyCc) {
    for (const e of g.grid.query(h.x, h.y, ab.radius || 300)) if (e.type === 'hero' && e.alive && e.team !== h.team && g.canSee(h.team, e)) g.applyCC(e, ab.enemyCc, h);
  }
  if (ab.bounce && tgt && tgt.alive !== undefined && tgt.team !== h.team) {
    const others = g.grid.query(tgt.x, tgt.y, 230).filter((e) => e !== tgt && g.isEnemyHittable(h, e) && (e.type === 'hero' || e.type === 'minion' || e.type === 'mob'))
      .sort((a, b) => (b.type === 'hero') - (a.type === 'hero') || dist2(a, tgt) - dist2(b, tgt) || a.id - b.id).slice(0, ab.bounce);
    const dmg = g.abilityDamage(h, ab, null) * 0.6;
    for (const o of others) { g.dealDamage(h, o, dmg, ab.type || h.def.dmgType, { ability: true, aoe: true }); g.fx.push({ kind: 'line', x1: tgt.x, y1: tgt.y, x2: o.x, y2: o.y, name: ab.fx || 'spark', team: h.team }); }
  }
}
// Shot with a splash: blow up around the first target hit.
export function splashHit(g, p, e) {
  const ab = p.ab;
  for (const o of g.grid.query(e.x, e.y, ab.splash + 20)) {
    if (o === e || p.hit.includes(o.id) || !g.isEnemyHittable(p.src, o) || dist2(o, e) > (ab.splash + o.radius) ** 2) continue;
    p.hit.push(o.id); g.abilityHit(p.src, o, ab, p.type, true);
  }
  g.fx.push({ kind: 'fx', name: ab.fx || 'explosion', x: e.x, y: e.y, s: ab.splash / 45 });
}
// Ally-targeted extras (Game.applyAllyEffects).
export function onAllyEffect(g, h, a, ab) {
  if (ab.cleanse) cleanse(g, a);
  if (ab.onHitAlly) g.addBuff(a, { onHit: g.scaleVal(h, ab.onHitAlly) }, ab.onHitAlly.dur || 4, 'onhit' + h.id);
  if (h.def.passive.kind === 'hasteGift') g.addBuff(a, { msPct: h.def.passive.ms }, h.def.passive.dur, 'gift');
}
// Lingering zones: extra CC (stun/root/fear apply once per unit per zone; the rest refresh) and pulls.
export function zoneTick(g, z, e) {
  const cc = z.ab.cc;
  if (cc) {
    const once = z.once || (z.once = new Set());
    const extra = {};
    if (cc.silence) extra.silence = 0.6;
    if (cc.shred) extra.shred = cc.shred;
    if (cc.mark) extra.mark = cc.mark;
    if (cc.grievous) extra.grievous = Math.max(0.6, cc.grievous);
    if (!once.has(e.id) && (cc.stun || cc.root || cc.fear)) { once.add(e.id); if (cc.stun) extra.stun = cc.stun; if (cc.root) extra.root = cc.root; if (cc.fear) extra.fear = cc.fear; }
    if (Object.keys(extra).length) g.applyCC(e, extra, z.src);
  }
  if (z.ab.pull && !e.boss && !e.dash) {
    const d = dist(e, z); if (d > 20) { const end = g.rayEnd(e, { x: e.x + (z.x - e.x) / d * Math.min(45, d - 10), y: e.y + (z.y - e.y) / d * Math.min(45, d - 10) }); e.x = end.x; e.y = end.y; }
  }
}

// ── kills ──
export function onTakedown(g, victim, killer, assists) {
  if (victim.type !== 'hero') return;
  const now = g.tick;
  for (const h of killer ? [killer, ...assists] : assists) {
    const p = h.def.passive;
    if (p.kind === 'stackOnKill' && (h.tribute || 0) < p.max) { h.tribute = (h.tribute || 0) + 1; g.recalc(h); }
    if (p.kind === 'onTakedown' && h.alive) { g.addBuff(h, { msPct: p.ms }, p.dur, 'blaze'); g.heal(h, h.maxHp * p.heal, h); }
  }
  const r = victim.resetBy;
  if (r && r.until > now) {
    const h = g.byId(r.id);
    if (h && h.alive && h.team !== victim.team) { h.cds[r.i] = now; g.fx.push({ kind: 'fx', name: 'boost', x: h.x, y: h.y, s: 1.3, follow: h.id }); g.emit({ type: 'reset', hero: h.id, team: h.team }); }
  }
  victim.resetBy = null;
}

// ── periodic: auras, solo-resist, duo proximity (every 10 ticks) ──
export function updateEffects(g) {
  if (g.tick % 10) return;
  for (const t of g.teams) for (const h of t.heroes) {
    if (!h.alive) continue;
    const p = h.def.passive;
    if (p.kind === 'aura') for (const a of g.grid.query(h.x, h.y, p.r)) if (a.type === 'hero' && a.alive && a.team === h.team) g.addBuff(a, p.stats, 0.75, 'aura' + h.id);
    if (h.stats.lone) {
      const alone = !g.grid.query(h.x, h.y, 800).some((a) => a !== h && a.type === 'hero' && a.alive && a.team === h.team);
      if (alone) g.addBuff(h, { armor: h.stats.lone, mr: h.stats.lone }, 0.75, 'lone');
    }
  }
  if (!g.duoLinks) return;
  for (const links of g.duoLinks) for (const L of links) {
    const on = L.a.alive && L.b.alive && dist2(L.a, L.b) < 520 * 520;
    if (on === L.active) continue;
    L.active = on;
    for (const x of [L.a, L.b]) {
      const st = {};
      for (const M of links) if (M.active && (M.a === x || M.b === x)) for (const k in M.duo.stats) st[k] = (st[k] || 0) + M.duo.stats[k];
      x.duoStats = Object.keys(st).length ? st : null;
      g.recalc(x);
    }
  }
}

// ── setup: team comp bonus + duo links (constructor, before the first recalc) ──
export function setupSynergy(g) {
  g.duoLinks = [[], []];
  for (let t = 0; t < 2; t++) {
    const tm = g.teams[t], ids = tm.heroes.map((h) => h.heroId);
    const comp = compOf(ids);
    tm.comp = comp;
    if (comp.active) {
      const st = g.clanStats[t];
      for (const [k, v] of Object.entries(COMPS[comp.id].stats)) st[k] = (st[k] || 0) + v;
      g.emit({ type: 'comp', team: t, comp: comp.id, name: COMPS[comp.id].name, text: COMPS[comp.id].bonus });
    }
    for (const d of DUOS) {
      const a = tm.heroes.find((h) => h.heroId === d.a), b = tm.heroes.find((h) => h.heroId === d.b);
      if (a && b) { g.duoLinks[t].push({ duo: d, a, b, active: false, readyAt: 0 }); g.emit({ type: 'duoReady', team: t, a: a.id, b: b.id, duo: d.id, name: d.name }); }
    }
  }
}
