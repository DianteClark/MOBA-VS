// Hero interplay (v23, cfg.depth): ultimate upgrades, revenge and duo combo ultimates.
// Deterministic sim code called through the depth hooks in src/sim/talents.js; no Math.random / Date.
//
// Ultimate upgrade: a 3-kill streak (Overdrive talent: 2) or a team objective taken nearby empowers the
//   hero's NEXT ultimate: +25% damage, +15% area, crowd control +20%, heals/shields +25%. Lost on death.
//   Events: { type: 'ultUp', hero, team, why: 'streak' | 'objective' }.
// Revenge: a hero killed by an enemy hero holds a grudge for 90s: +8% damage to that hero, and taking
//   them down (kill or assist) pays REVENGE.gold. Event: { type: 'revenge', hero, team, victim }.
// Duo ult: when both partners of a duo (src/data/synergy.js) cast their ultimates within 2s of each
//   other (and within 900 of each other), a combined effect fires once per 60s per duo:
//   burst  = enemy heroes within 340 of the second caster take 7% max HP true damage and a 30% slow (1.5s)
//   shield = allies within 450 get a shield of 12% of their max HP (3s)
//   rush   = allies within 450 get +20% move speed and +15% attack speed (4s)
//   Event: { type: 'duoUlt', team, a, b, duo, name, combo, x, y }.
import { sec } from './constants.js';
import { dist2 } from './geom.js';

export const ULT_UP = { streak: 3, dmg: 1.25, area: 1.15, cc: 1.2, heal: 1.25, objR: 1000 }; // objR: heroes this close to the boss when it falls
export const REVENGE = { dur: 90, dmg: 0.08, gold: 60 };
export const DUO_ULT = { window: 2, range: 900, cd: 60, burstR: 340, burstPct: 0.07, allyR: 450 };
export const DUO_ULT_TEXT = {
  burst: 'Duo ult: 7% max HP true damage + slow around them',
  shield: 'Duo ult: allies nearby get a 12% max HP shield',
  rush: 'Duo ult: allies nearby get +20% speed, +15% attack speed',
};

// ── ultimate upgrades ──
function grantUlt(g, h, why) {
  if (!h.alive || h.ultUp) return;
  h.ultUp = why;
  g.emit({ type: 'ultUp', hero: h.id, team: h.team, why });
  g.fx.push({ kind: 'ultUp', id: h.id });
}
export function interplayTakedown(g, victim, killer, assists) {
  const now = g.tick;
  victim.ultUp = null;
  // revenge pays out first (the victim may be someone's grudge), then the victim takes one
  for (const h of killer ? [killer, ...assists] : assists) {
    const r = h.revenge;
    if (!r || r.id !== victim.id || r.until <= now) continue;
    h.revenge = null;
    g.giveGold(h, REVENGE.gold * g.rules.killGold);
    g.emit({ type: 'revenge', hero: h.id, team: h.team, victim: victim.id });
    g.fx.push({ kind: 'revenge', id: h.id });
  }
  victim.revenge = killer ? { id: killer.id, until: now + sec(REVENGE.dur) } : null;
  if (killer && killer.alive && (killer.killStreak || 0) >= (killer.talUlt && killer.talUlt.streak || ULT_UP.streak)) grantUlt(g, killer, 'streak');
}
export function interplayObjective(g, team, u) {
  if (team < 0 || team > 1) return;
  for (const h of g.teams[team].heroes) if (h.alive && dist2(h, u) < ULT_UP.objR * ULT_UP.objR) grantUlt(g, h, 'objective');
}
export const revengeMult = (g, src, tgt) => (src.revenge && src.revenge.id === tgt.id && src.revenge.until > g.tick ? 1 + REVENGE.dmg : 1);

// ── duo ultimates ──
export function duoUltCheck(g, h) {
  const links = g.duoLinks && g.duoLinks[h.team]; if (!links) return;
  const now = g.tick;
  for (const L of links) {
    if (L.a !== h && L.b !== h) continue;
    const mate = L.a === h ? L.b : L.a;
    if (!mate.alive || !(mate.lastUlt >= now - sec(DUO_ULT.window)) || (L.ultAt || 0) > now || dist2(h, mate) > DUO_ULT.range * DUO_ULT.range) continue;
    L.ultAt = now + sec(DUO_ULT.cd);
    const d = L.duo, x = (h.x + mate.x) / 2, y = (h.y + mate.y) / 2;
    if (d.combo === 'burst') {
      for (const e of g.grid.query(h.x, h.y, DUO_ULT.burstR + 20)) {
        if (e.type !== 'hero' || !e.alive || e.team === h.team || dist2(e, h) > DUO_ULT.burstR * DUO_ULT.burstR) continue;
        g.dealDamage(h, e, e.maxHp * DUO_ULT.burstPct, 'true', { proc: true, ability: true });
        if (e.alive) g.applyCC(e, { slow: [0.3, 1.5] }, h);
      }
    } else {
      for (const a of g.grid.query(h.x, h.y, DUO_ULT.allyR + 20)) {
        if (a.type !== 'hero' || !a.alive || a.team !== h.team || dist2(a, h) > DUO_ULT.allyR * DUO_ULT.allyR) continue;
        if (d.combo === 'shield') g.addShield(a, a.maxHp * 0.12, 3, null);
        else g.addBuff(a, { msPct: 0.2, asPct: 0.15 }, 4, 'duoUlt');
      }
    }
    g.fx.push({ kind: 'duoUlt', a: L.a.id, b: L.b.id, x, y, name: d.name, combo: d.combo, team: h.team });
    g.emit({ type: 'duoUlt', team: h.team, a: L.a.id, b: L.b.id, duo: d.id, name: d.name, combo: d.combo, x: Math.round(x), y: Math.round(y) });
  }
}
// AI: a duo partner just fired their ultimate nearby, so fire ours too (ai.js castCombat).
export function duoUltWant(g, h) {
  const links = g.duoLinks && g.duoLinks[h.team]; if (!links) return false;
  const now = g.tick;
  for (const L of links) {
    if (L.a !== h && L.b !== h || (L.ultAt || 0) > now) continue;
    const mate = L.a === h ? L.b : L.a;
    if (mate.alive && mate.lastUlt >= now - sec(1.5) && dist2(h, mate) < DUO_ULT.range * DUO_ULT.range) return true;
  }
  return false;
}
