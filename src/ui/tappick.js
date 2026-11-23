// Map tap picking (UI only, reads the game, never changes it): what did the finger mean?
// The finger is a circle, not a point: anything drawn within FINGER CSS px of where it landed (plus the thing's
// own drawn size) is a candidate, so the radius is the same on screen at every zoom and device pixel ratio
// (r.cam.zoom maps world units to CSS px). Ranked by kind first, then distance:
//   1. heroes (both teams; fogged enemies never),  2. objectives (Kami, Oni, Kraken, the Elder, the Yokai),
//   3. structures (towers, gates, crystals).
// Heroes are measured where they are drawn this frame. The pick's point is the thing's own position, so the call ring opens for exactly that hero / objective / lane.
export const FINGER = { touch: 30, pen: 22, mouse: 14 };
const HERO_BODY = 14, HERO_LIFT = 14; // hero sprites are drawn ~14 world px above their feet

export function pickAt(g, r, w, pointerType = 'touch') {
  const f = (FINGER[pointerType] || FINGER.touch) / Math.max(0.05, r.cam.zoom);
  const best = [null, null, null], bd = [Infinity, Infinity, Infinity];
  const offer = (k, u, d, reach) => { if (d <= reach * reach && d < bd[k]) { bd[k] = d; best[k] = u; } };
  for (const t of g.teams) for (const x of t.heroes) {
    if (!x.alive || !r.visible(x)) continue;
    const d = (r.heroPos && r.heroPos.get(x.id)) || x; // where it is drawn (interpolated between sim ticks)
    offer(0, x, (d.x - w.x) ** 2 + (d.y - HERO_LIFT - w.y) ** 2, f + HERO_BODY);
  }
  for (const k of Object.keys(g.objectives || {})) {
    const o = g.objectives[k]; if (!o || !o.alive || !r.visible(o)) continue;
    offer(1, o, (o.x - w.x) ** 2 + (o.y - 16 - w.y) ** 2, f + Math.max(28, o.radius || 0));
  }
  for (const u of g.units) {
    if (!u.structure || !u.alive) continue;
    offer(2, u, (u.x - w.x) ** 2 + (u.y - w.y) ** 2, f + (u.radius || 30));
  }
  const k = best.findIndex(Boolean);
  return k < 0 ? null : { kind: ['hero', 'objective', 'structure'][k], unit: best[k] };
}
