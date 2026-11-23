// v26 build types (src/data/items.js: Bloodline, Spellshield, Thorns, Swift, Executioner, Frostbite, Venom, Bulwark,
// Momentum, Nightstalker) and build combos (BUILD_COMBOS). Deterministic sim code called from small Game hooks.
// Every effect reads an item stat or a combo id, so a match where nobody carries them runs exactly as before.
import { sec } from './constants.js';
import { dist2 } from './geom.js';
import { BUILD_COMBOS } from '../data/items.js';

const GLORY_MAX = 6, VENOM_MAX = 5, VENOM_DUR = 4, SHIELD_CD = 10, AURA_R = 450;

// ── build combos: two heroes of one team on the two build types of a combo ──
export function refreshCombos(g, team) {
  const tm = g.teams[team], ids = [];
  for (const h of tm.heroes) h.combos = null;
  for (const c of BUILD_COMBOS) {
    const a = tm.heroes.find((h) => h.build === c.a), b = tm.heroes.find((h) => h.build === c.b && h !== a);
    if (!a || !b) continue;
    ids.push(c.id);
    for (const h of [a, b]) (h.combos || (h.combos = [])).push(c.id);
  }
  const before = (tm.combos || []).join(',');
  tm.combos = ids.length ? ids : null;
  for (const h of tm.heroes) if (h.stats) g.recalc(h);
  const now = ids.join(',');
  if (now !== before) for (const id of ids) if (!before.split(',').includes(id)) g.emit({ type: 'buildCombo', team, combo: id });
}
const hasCombo = (h, id) => !!(h.combos && h.combos.includes(id));

// ── stats (Game.recalc, before power is converted) ──
export function stats(g, h, s) {
  const now = g.tick;
  if (s.roam && now - h.lastCombat > sec(3)) s.msPct += Math.min(0.25, s.roam);
  if (s.stalk && h.unseen && now - h.unseen >= sec(1)) s.msPct += g.living && g.living.night ? 0.2 : 0.1;
  if (s.glory && h.glory) s.power += s.glory * h.glory;
  if (h.combos) for (const c of h.combos) {
    if (c === 'ironwall') { s.armor += 15; s.mr += 15; } else if (c === 'bloodpact') s.omnivamp += 0.04; else if (c === 'packhunt') s.msPct += 0.06;
  }
  if (h.alive) {
    let aura = 0;
    for (const a of g.teams[h.team].heroes) if (a !== h && a.alive && a.stats && a.stats.bulwark && dist2(a, h) < AURA_R * AURA_R) aura += a.stats.bulwark;
    if (aura) s.drPct += Math.min(0.1, aura);
  }
}

// ── damage dealt by a hero (Game.dealDamage) ──
export function outMods(g, src, tgt, amt, flags) {
  const s = src.stats;
  if (s.rage) amt *= 1 + Math.min(0.5, s.rage) * (1 - src.hp / src.maxHp);
  if (tgt.type === 'hero') {
    if (s.frostbite || src.combos) {
      const slowed = tgt.slows.some((x) => x.until > g.tick);
      if (slowed && s.frostbite) amt *= 1 + Math.min(0.25, s.frostbite);
      if (slowed && src.build === 'executioner' && hasCombo(src, 'shatter')) amt *= 1.1;
    }
    if (s.stalk && !flags.dot && src.unseen && g.tick - src.unseen >= sec(1)) {
      amt *= 1 + Math.min(0.5, s.stalk); src.unseen = 0;
      g.fx.push({ kind: 'fx', name: 'smoke', x: tgt.x, y: tgt.y, s: 1.2 });
    }
  }
  if (src.weakUntil > g.tick) amt *= 0.9; // Venom: Weakened
  return amt;
}
// ── damage taken by a hero, after resists ──
export function inMods(g, src, tgt, amt, flags) {
  const s = tgt.stats;
  if (s.spellShield && flags.ability && src && src.type === 'hero' && src.team !== tgt.team && g.tick >= (tgt.ssCd || 0)) {
    amt *= 1 - Math.min(0.6, s.spellShield); tgt.ssCd = g.tick + sec(SHIELD_CD);
    g.fx.push({ kind: 'shield', id: tgt.id }); g.fx.push({ kind: 'cc', id: tgt.id, cc: 'blocked' });
  }
  return amt;
}
// After a hero took ability damage from a hero: Thorns' reflect.
export function afterHit(g, src, tgt, amt, flags) {
  if (flags.ability && tgt.stats.reflect && src.alive) g.dealDamage(tgt, src, amt * Math.min(0.3, tgt.stats.reflect) + 5, 'magic', { thorns: true });
}

// ── on hit: Frostbite chill (abilities), Venom stacks (basic + ability hits on heroes) ──
export function onAbilityHit(g, h, e) {
  if (e.type !== 'hero' || !e.alive) return;
  const s = h.stats;
  if (s.chill) e.slows.push({ pct: Math.min(0.4, s.chill), until: g.tick + sec(1.5) });
  if (s.venom) addVenom(g, h, e);
}
export function onBasicHit(g, h, e) { if (e.type === 'hero' && e.alive && h.stats.venom) addVenom(g, h, e); }
function addVenom(g, h, e) {
  const dps = h.stats.venom * (1 + 0.08 * (h.level - 1)), v = e.venom;
  if (v && v.until > g.tick && v.team === h.team) { v.n = Math.min(VENOM_MAX, v.n + 1); v.dps = Math.max(v.dps, dps); v.src = h.id; v.until = g.tick + sec(VENOM_DUR); }
  else e.venom = { n: 1, dps, src: h.id, team: h.team, until: g.tick + sec(VENOM_DUR) };
  if (e.venom.n >= VENOM_MAX) { if (!(e.weakUntil > g.tick)) g.fx.push({ kind: 'cc', id: e.id, cc: 'weakened' }); e.weakUntil = e.venom.until; }
}

// ── every 10 ticks (Game.step): venom ticks ──
export function tick(g) {
  for (const t of g.teams) for (const e of t.heroes) {
    const v = e.venom; if (!v) continue;
    if (!e.alive || v.until <= g.tick) { e.venom = null; continue; }
    const src = g.teams[v.team].heroes.find((x) => x.id === v.src);
    let d = v.n * v.dps * 0.5;
    if (src && hasCombo(src, 'plague') && e.burns.some((b) => b.until > g.tick)) d *= 1.25;
    g.dealDamage(src || null, e, d, 'magic', { dot: true });
  }
}

// ── after a hero is taken down (Game.kill) ──
export function takedown(g, victim, killer, assists) {
  if (victim.glory) { victim.glory = hasCombo(victim, 'kingmaker') ? victim.glory - 1 : Math.floor(victim.glory / 2); g.recalc(victim); }
  victim.venom = null; victim.weakUntil = 0; victim.unseen = 0;
  const now = g.tick;
  for (const p of killer ? [killer, ...assists] : assists) {
    if (!p.alive || !p.stats) continue;
    const s = p.stats;
    if (s.kheal) { g.heal(p, p.maxHp * Math.min(0.25, s.kheal), null); g.fx.push({ kind: 'fx', name: 'spirit', x: p.x, y: p.y, s: 1.2, follow: p.id }); }
    if (s.reset) { const r = Math.min(0.6, s.reset); for (let i = 0; i < p.cds.length; i++) if (p.cds[i] > now) p.cds[i] = now + Math.round((p.cds[i] - now) * (1 - r)); }
    if (s.glory && (p.glory || 0) < GLORY_MAX) { p.glory = (p.glory || 0) + 1; g.recalc(p); g.fx.push({ kind: 'fx', name: 'boost', x: p.x, y: p.y, s: 1.1, follow: p.id }); }
  }
}

// ── after vision (Game.updateVision): Nightstalker heroes know when the enemy cannot see them ──
export function afterVision(g) {
  for (const t of g.teams) for (const h of t.heroes) {
    if (!h.stats || !h.stats.stalk || !h.alive) { h.unseen = 0; continue; }
    if (g.vision[1 - t.id].has(h.id)) h.unseen = 0; else if (!h.unseen) h.unseen = g.tick;
  }
}
