// Geometry helpers. Only + - * / and sqrt: these are exactly specified by IEEE-754,
// so results are bit-identical across browsers (Math.hypot / trig are not).
export const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
export const dist = (a, b) => Math.sqrt(dist2(a, b));
export const len = (x, y) => Math.sqrt(x * x + y * y);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function norm(x, y) {
  const l = Math.sqrt(x * x + y * y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

// Distance from point p to segment ab.
export function segDist2(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y;
  return x * x + y * y;
}

export const r2 = (v) => Math.round(v * 100) | 0;
