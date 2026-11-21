// Ability VFX (render-only). Every hero gets a visual profile:
//  * element per ability, from its fx / proj sprite names (fire, frost, water, storm, nature, earth, spirit,
//    shadow, blade, guard): colours, impact bursts, line streaks and zone patterns;
//  * clan motif (iron hex, beast fangs, shinobi star, spirit runes, wild petals) for ult sigils;
//  * a signature colour sampled from the hero's own sprite (projectile glow, trails, dash afterimages, sigils);
//  * pack-sprite variants (cut / cut_double / multi...) picked per hero, so two heroes sharing a sim fx name
//    still look different.
// Sim fx events carry no caster for deferred hits (projectiles, delayed circles, dash arrivals), so the
// caster is matched from what was in flight just before the tick (`snapshot`). Nothing here touches sim state.
import { IMG, PROJ, silhouette } from './assets.js';
import { TEAM_COL, rgba } from './palette.js';
import { P_SQUARE, P_SPARK, P_DEBRIS, P_RING, P_PUFF, P_BEAM, P_BOLT, P_STREAK, P_LEAF, P_GLOW, glowSprite } from './particles.js';
import { DT } from '../sim/constants.js';

export const ELEM = {
  fire: ['#fff1a8', '#ff8a2a', '#b8321e'],
  frost: ['#ffffff', '#9fe8ff', '#3d8fd6'],
  water: ['#e6fbff', '#4fc3f7', '#1f5fa8'],
  storm: ['#ffffff', '#ffe45c', '#8a6cff'],
  nature: ['#f1ffc8', '#86d94f', '#2f7a35'],
  earth: ['#f6dfb0', '#c4874a', '#5e3d22'],
  spirit: ['#f3e6ff', '#b68cff', '#5b36a8'],
  shadow: ['#e9e6f5', '#8f88b0', '#2a2540'],
  blade: ['#ffffff', '#ffe3a3', '#c9973a'],
  guard: ['#ffffff', '#ffe88a', '#d49a1a'],
};
const ELEM_OF = {
  flame: 'fire', explosion: 'fire', circle_orange: 'fire', p_fireball: 'fire', ice: 'frost', p_icespike: 'frost', water: 'water',
  thunder: 'storm', spark: 'storm', p_energy: 'storm', plant: 'nature', p_plant: 'nature', rock: 'earth', rockspike: 'earth', p_cannon: 'earth',
  spirit: 'spirit', p_bigenergy: 'spirit', smoke: 'shadow', smoke_ring: 'shadow', cut: 'blade', cutx: 'blade', slash: 'blade', claw: 'blade',
  circular: 'blade', p_shuriken: 'blade', p_kunai: 'blade', p_bigkunai: 'blade', p_arrow: 'blade',
  shield: 'guard', shield_yellow: 'guard', boost: 'guard', aura: 'guard', circle: 'guard', impact: 'guard',
};
export const elemOf = (name) => ELEM_OF[name] || 'guard';
// Pack-sprite families: a hero picks one member per ability (stable hash of hero id + slot).
const VARIANTS = {
  cut: ['cut', 'cut_double', 'multi'], slash: ['slash', 'slash_curved', 'crescent', 'arc'], cutx: ['cutx', 'multi', 'cut_double'],
  claw: ['claw', 'claw_double'], circular: ['circular', 'slash_double'], spirit: ['spirit', 'spirit_blue', 'spirit_double'],
  spark: ['spark', 'holy'], circle: ['circle', 'ringw', 'holy'], ice: ['ice', 'crystal'], water: ['water', 'pillar', 'wave'], plant: ['plant', 'leafspike'],
  p_shuriken: ['p_shuriken', 'p_bigshuriken', 'p_magicstar'], p_cannon: ['p_cannon', 'p_rock'],
};
const CLAN_SIGIL = { iron: 'hex', beast: 'fang', shinobi: 'star', spirit: 'rune', wild: 'petal' };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

function hsl2hex(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
// Signature colour: the dominant saturated hue of the hero's idle frame (weighted by saturation).
function sigColors(img) {
  let hue = -1;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, bins = new Float32Array(24); let tot = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      if (mx === mn || l < 0.18 || l > 0.88) continue;
      const s = (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn); if (s < 0.3) continue;
      let h = mx === r ? (g - b) / (mx - mn) + (g < b ? 6 : 0) : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h /= 6;
      bins[Math.floor(h * 24) % 24] += s; tot += s;
    }
    if (tot > 2) { let bi = 0; for (let i = 1; i < 24; i++) if (bins[i] > bins[bi]) bi = i; hue = (bi + 0.5) / 24; }
  } catch { /* unreadable image: neutral */ }
  if (hue < 0) return ['#f2f4fa', '#c8d0e0', '#5a6070'];
  return [hsl2hex(hue, 1, 0.86), hsl2hex(hue, 0.85, 0.62), hsl2hex(hue, 0.7, 0.3)];
}

export class Vfx {
  constructor(r) {
    this.r = r; this.prof = new Map(); this.pprev = new Map(); this.trailPos = new Map(); this.trailNext = new Map(); this.seen = new Set();
    this.cands = []; this.dashCast = new Map(); this.ghosts = []; this.cur = null;
  }
  reset() { this.pprev.clear(); this.trailPos.clear(); this.seen.clear(); this.cands = []; this.dashCast.clear(); this.ghosts = []; this.cur = null; }
  // 0 = low, 1 = medium (auto governor), 2 = high: scales particle counts.
  n(k) { return Math.max(1, Math.round(k * [0.35, 0.65, 1][this.r.detail])); }

  profile(u) {
    const id = u.heroId; let p = this.prof.get(id); if (p) return p;
    const img = IMG['hero_' + id], [sl, sm, sd] = img ? sigColors(img) : ['#ffffff', '#dddddd', '#555555'];
    const hs = hash(id);
    const pick = (name, i) => { const v = name && VARIANTS[name]; return v ? v[(hs + i * 7) % v.length] : name; };
    p = {
      sig: sm, sigL: sl, sigD: sd, clan: u.def.clan, sigil: CLAN_SIGIL[u.def.clan] || 'rune', ghost: null,
      abs: u.def.abilities.map((ab, i) => {
        let el = elemOf(ab.fx);
        if ((el === 'blade' || el === 'guard' || el === 'shadow') && ab.proj && ELEM_OF[ab.proj] && ELEM_OF[ab.proj] !== 'blade') el = ELEM_OF[ab.proj];
        if (!ab.fx && ab.proj) el = elemOf(ab.proj);
        return { ab, el, pal: ELEM[el], fx: pick(ab.fx, i), proj: pick(ab.proj, i + 1) };
      }),
    };
    this.prof.set(id, p); return p;
  }
  ghostImg(u) { const p = this.profile(u); return p.ghost || (p.ghost = IMG['hero_' + u.heroId] ? silhouette(IMG['hero_' + u.heroId], p.sigL) : null); }

  // Before each sim tick: remember what is in flight (casters of deferred hits) and projectile positions.
  snapshot(g) {
    this.pprev.clear(); const C = this.cands; C.length = 0;
    for (const p of g.projectiles) {
      this.pprev.set(p.id, { x: p.x, y: p.y });
      if (p.ab && p.src && p.src.type === 'hero') C.push({ x: p.x, y: p.y, reach: p.speed * (p.speedMul || 1) * DT * 1.6 + (p.width || 30) + 40, u: p.src, abi: p.abi });
    }
    for (const q of g.pending) if (q.src && q.src.type === 'hero') C.push({ x: q.x, y: q.y, reach: 6, u: q.src, abi: q.src.def.abilities.indexOf(q.ab) });
    for (const [id, d] of this.dashCast) {
      const h = d.u; if (!h.alive || g.tick > d.until) { this.dashCast.delete(id); continue; }
      C.push({ x: h.x, y: h.y, reach: 240, u: h, abi: d.abi });
    }
  }
  // Caster of an fx event: the cast just before it in the same tick, or something that was in flight.
  owner(f, g, any = false) {
    const c = this.cur;
    if (c && c.tick === g.tick && !c.used && (any || !c.ab.fx || c.ab.fx === f.name)) { c.used = true; return c; }
    if (any) return null;
    let best = null, bd = 1e12;
    for (const q of this.cands) {
      const ab = q.u.def.abilities[q.abi]; if (!ab || (ab.fx && ab.fx !== f.name)) continue;
      const d = (q.x - f.x) ** 2 + (q.y - f.y) ** 2; if (d < q.reach * q.reach && d < bd) { bd = d; best = q; }
    }
    return best ? { u: best.u, abi: best.abi, ab: best.u.def.abilities[best.abi] } : null;
  }
  info(o) { if (!o || !o.u || !o.u.def) return null; const p = this.profile(o.u), a = p.abs[o.abi]; return a ? { p, a } : null; }

  // ── events ──
  cast(f, u, g) {
    const ab = u.def.abilities[f.ab]; if (!ab) return;
    const immediate = ['target', 'nova', 'self', 'allynova', 'line', 'circle', 'zone'].includes(ab.kind) || (ab.kind === 'ally' && !ab.allyDash);
    this.cur = immediate ? { u, abi: f.ab, ab, tick: g.tick, used: false } : null;
    const p = this.profile(u), a = p.abs[f.ab], r = this.r;
    if (ab.kind === 'dash' || ab.allyDash) {
      this.dashCast.set(u.id, { u, abi: f.ab, until: g.tick + 20 });
      if (r.onScreen(u.x, u.y, 60)) for (let k = 0; k < this.n(5); k++) r.puff(u.x + (Math.random() - 0.5) * 16, u.y + 2, 4, 12, 'rgba(225,215,195,0.8)', 0.45, (Math.random() - 0.5) * 50, -10);
    }
    if (!r.onScreen(u.x, u.y, 80)) return;
    // cast glint at the hand: small ring + rising motes in the element colour
    r.ring(u.x, u.y - 14, 4, ab.ult ? 30 : 18, a.pal[1], 0.28, 2);
    for (let k = 0; k < this.n(ab.ult ? 8 : 4); k++) { const q = r.fxp.spawn(P_GLOW, u.x + (Math.random() - 0.5) * 22, u.y - 10 - Math.random() * 16, 0.45); q.vy = -40 - Math.random() * 40; q.c = k % 2 ? a.pal[1] : p.sig; q.s = 5; }
    if (ab.ult) {
      r.effects.push({ kind: 'sigil', id: u.id, x: u.x, y: u.y, shape: p.sigil, col: p.sig, col2: a.pal[1], born: r.time, dur: 1.25 });
      const b = r.fxp.spawn(P_BEAM, u.x, u.y + 2, 0.8); b.s = 30; b.s2 = 130; b.c = rgba(p.sig, 0.9);
      this.burst(a.el, u.x, u.y - 12, 1.3, p.sig);
    }
  }
  // Impact of an ability (an 'fx' event). Returns the sprite to play (the hero's variant).
  // Big areas keep pixel art crisp: the centre sprite is capped at 2x and the true radius is shown by a
  // shockwave ring plus small stamps rippling out around its edge. Returns [sprite, scale] for the centre.
  impact(f, o) {
    const r = this.r, inf = this.info(o), ab = inf && f.name === inf.a.ab.fx ? inf.a.ab : null;
    const name = ab ? inf.a.fx : f.name, el = inf ? inf.a.el : elemOf(f.name), on = r.onScreen(f.x, f.y, 140);
    let s = f.s || 1;
    const R = ab && ab.radius && ['nova', 'circle', 'allynova', 'dash', 'zone'].includes(ab.kind) ? ab.radius : s > 2.2 ? s * 45 : 0;
    if (R > 90 && on) {
      const P = ELEM[el];
      r.ring(f.x, f.y, 10, R, P[1], 0.45, 4); r.ring(f.x, f.y, 10, R * 0.72, P[0], 0.35, 2, 0.06);
      const n = Math.min(8, Math.round(R / 30));
      for (let k = 0; k < n; k++) { const a = k / n * 6.283 + Math.random() * 0.3; r.fxSprite(name, f.x + Math.cos(a) * R * 0.78, f.y + Math.sin(a) * R * 0.66, 0.9, 0, 0.04 + Math.random() * 0.1); }
    }
    s = Math.min(2, s);
    if (on && !f.follow) this.burst(el, f.x, f.y - 6, Math.min(2, s * 0.8), inf ? inf.p.sig : null);
    return [name, s];
  }
  // Code-drawn burst per element. s ~ 1 for a single-target hit, ~2+ for big AoE.
  burst(el, x, y, s, sig) {
    const r = this.r, P = ELEM[el] || ELEM.guard, n = (k) => this.n(Math.round(k * Math.min(1.6, 0.6 + s * 0.4))), R = 14 + s * 16;
    const sq = (c, sp0, sp1, up, g, size, life) => { const a = Math.random() * 6.283, sp = sp0 + Math.random() * (sp1 - sp0), p = r.fxp.spawn(P_SQUARE, x, y, life * (0.7 + Math.random() * 0.6)); p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp * 0.6 - up; p.g = g; p.c = c; p.s = size; return p; };
    const glow = (c, sz, life, vy = 0) => { const p = r.fxp.spawn(P_GLOW, x + (Math.random() - 0.5) * R, y + (Math.random() - 0.5) * R * 0.6, life); p.c = c; p.s = sz; p.vy = vy; return p; };
    switch (el) {
      case 'fire':
        glow(P[1], R * 0.9, 0.3);
        for (let k = 0; k < n(5); k++) r.puff(x + (Math.random() - 0.5) * R, y + (Math.random() - 0.5) * R * 0.5, 3, 9 + s * 4, k % 2 ? 'rgba(255,138,42,0.9)' : 'rgba(255,214,110,0.9)', 0.4, 0, -30);
        for (let k = 0; k < n(8); k++) sq(k % 3 ? P[1] : P[0], 30, 120, 60, -90, 2, 0.7); // embers rise
        break;
      case 'frost':
        r.ring(x, y + 6, 4, R * 1.2, P[1], 0.35, 3);
        for (let k = 0; k < n(8); k++) { const p = sq(k % 2 ? P[0] : P[1], 60, 170, 90, 520, 3, 0.8); p.kind = P_DEBRIS; p.ground = y + 8 + Math.random() * 10; }
        for (let k = 0; k < n(3); k++) { const p = r.fxp.spawn(P_SPARK, x + (Math.random() - 0.5) * R, y - Math.random() * R * 0.6, 0.35); p.c = '#ffffff'; p.s = 0.6; p.t = -k * 0.06; }
        break;
      case 'water':
        r.ring(x, y + 6, 4, R * 1.1, P[1], 0.45, 3); r.ring(x, y + 6, 4, R * 0.7, P[0], 0.4, 2, 0.12);
        for (let k = 0; k < n(10); k++) sq(k % 3 ? P[1] : P[0], 50, 150, 140, 600, 2, 0.6);
        break;
      case 'storm':
        for (let k = 0; k < Math.min(3, n(2)); k++) { const p = r.fxp.spawn(P_BOLT, x + (Math.random() - 0.5) * R * 0.8, y, 0.22); p.c = P[1]; p.s2 = 70 + s * 20; p.s = Math.random() * 10; p.t = -k * 0.07; }
        glow(P[1], R, 0.25); glow(P[2], R * 1.3, 0.35);
        for (let k = 0; k < n(6); k++) { const p = sq(P[0], 90, 220, 20, 0, 2, 0.25); p.kind = P_STREAK; p.s = 8; p.w = 1.5; p.c = k % 2 ? P[1] : '#ffffff'; }
        break;
      case 'nature':
        r.ring(x, y + 6, 4, R * 1.1, P[1], 0.4, 2);
        for (let k = 0; k < n(6); k++) { const p = sq(P[1], 40, 120, 90, 160, 1, 1.0); p.kind = P_LEAF; p.sprite = 'leaf'; p.s = 1.6; p.s2 = Math.random() * 6; }
        break;
      case 'earth':
        for (let k = 0; k < n(8); k++) { const p = sq(k % 2 ? P[1] : P[2], 60, 170, 160, 650, 3 + (k % 3), 1.0); p.kind = P_DEBRIS; p.ground = y + 8 + Math.random() * 12; }
        for (let k = 0; k < n(4); k++) r.puff(x + (Math.random() - 0.5) * R, y + 4, 4, 12 + s * 4, 'rgba(200,170,130,0.75)', 0.6, (Math.random() - 0.5) * 60, -8);
        break;
      case 'spirit':
        r.ring(x, y + 4, 4, R * 1.2, P[1], 0.45, 2);
        for (let k = 0; k < n(7); k++) glow(k % 2 ? P[1] : (sig || P[0]), 5 + Math.random() * 4, 0.7, -50 - Math.random() * 50);
        break;
      case 'shadow':
        for (let k = 0; k < n(6); k++) r.puff(x + (Math.random() - 0.5) * R, y + (Math.random() - 0.5) * R * 0.5, 4, 12 + s * 5, k % 2 ? 'rgba(60,52,84,0.8)' : 'rgba(143,136,176,0.7)', 0.5, (Math.random() - 0.5) * 50, -15);
        break;
      case 'blade':
        for (let k = 0; k < n(6); k++) { const p = sq('#ffffff', 140, 300, 0, 0, 2, 0.18); p.kind = P_STREAK; p.s = 12 + s * 4; p.w = 2; p.c = k % 2 ? P[1] : (sig || '#ffffff'); }
        glow('#ffffff', R * 0.6, 0.15);
        break;
      default: // guard / holy
        r.ring(x, y + 4, 4, R * 1.1, P[1], 0.4, 3);
        for (let k = 0; k < n(5); k++) glow(k % 2 ? P[1] : '#ffffff', 4 + Math.random() * 3, 0.6, -60 - Math.random() * 40);
    }
  }
  // Instant 'line' ability: element streak along the line + stamps of the hero's sprite variant.
  line(f, o) {
    const r = this.r, inf = this.info(o), el = inf ? inf.a.el : elemOf(f.name), P = ELEM[el];
    const L = { ...f, el, pal: P, sig: inf ? inf.p.sig : P[1], born: r.time, w: inf && inf.a.ab.width ? inf.a.ab.width : 50 };
    r.lines.push(L);
    const name = inf && f.name === inf.a.ab.fx ? inf.a.fx : f.name;
    const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1), k = Math.max(1, Math.min(4, Math.round(len / 80)));
    for (let i = 1; i <= k; i++) { const t = i / (k + 0.5); r.fxSprite(name, f.x1 + (f.x2 - f.x1) * t, f.y1 + (f.y2 - f.y1) * t - 6, 1.05, 0, (i - 1) * 0.04); }
    if (r.onScreen(f.x2, f.y2, 60)) this.burst(el, f.x2, f.y2 - 6, 0.8, L.sig);
  }
  // The ability profile behind a zone or telegraph event (for its pattern and sprite).
  ground(e, o) {
    const inf = this.info(o); e.el = inf ? inf.a.el : elemOf(e.name); e.sig = inf ? inf.p.sig : null;
    if (inf && e.name === inf.a.ab.fx) e.name = inf.a.fx;
    e.seed = Math.random() * 1000; e.next = this.r.time;
  }

  // ── drawing ──
  rel(team) { const v = this.r.viewTeam; return v < 0 || team === v ? TEAM_COL[team] || '#ffffff' : '#ff4a3d'; }
  drawGround(e) {
    const r = this.r, ctx = r.ctx, now = r.time, k = Math.max(0, Math.min(1, (now - e.born) / e.dur)), col = this.rel(e.team);
    const enemy = r.viewTeam >= 0 && e.team !== r.viewTeam, P = ELEM[e.el] || ELEM.guard;
    if (e.kind === 'lane') {
      const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9, a = fade * (enemy ? 0.28 : 0.18);
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(e.dy, e.dx));
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(0, -e.w / 2, e.len, e.w);
      ctx.globalAlpha = fade * 0.6; ctx.fillRect(0, -e.w / 2, e.len, 1.5); ctx.fillRect(0, e.w / 2 - 1.5, e.len, 1.5);
      ctx.beginPath(); ctx.moveTo(e.len, -e.w / 2 - 4); ctx.lineTo(e.len + 12, 0); ctx.lineTo(e.len, e.w / 2 + 4); ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1; return;
    }
    if (e.kind === 'sigil') return this.drawSigil(e, k);
    ctx.save();
    if (e.kind === 'tele') {
      const pulse = enemy ? 0.5 + 0.5 * Math.sin(now * 18) : 1;
      ctx.globalAlpha = 0.1 + 0.22 * k; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * k, e.r * k * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.16; ctx.fillStyle = P[1]; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.stroke();
      ctx.globalAlpha = 0.65 + 0.35 * pulse; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineWidth = 4; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
      // crosshair ticks
      ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath();
      for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a) * 0.85; ctx.moveTo(e.x + c * e.r * 0.82, e.y + s * e.r * 0.82); ctx.lineTo(e.x + c * e.r * 1.0, e.y + s * e.r * 1.0); }
      ctx.stroke();
    } else { // zone
      const fade = Math.min(1, (now - e.born) / 0.2, (e.dur - (now - e.born)) / 0.25);
      ctx.globalAlpha = 0.14 * fade; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.18 * fade; ctx.fillStyle = P[1]; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * 0.92, e.r * 0.78, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.4 * fade; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.85 * fade; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -now * 30; ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = fade; this.zonePattern(ctx, e, P, now);
      if (now >= e.next && e.name) { e.next = now + (r.detail ? 0.24 : 0.5); r.fxSprite(e.name, e.x + (Math.random() - 0.5) * e.r * 1.3, e.y + (Math.random() - 0.5) * e.r * 1.1, 0.8); }
    }
    ctx.restore();
  }
  zonePattern(ctx, e, P, now) {
    const R = e.r, s = e.seed, pt = (i, f = 0.75) => { const a = s + i * 2.39996, d = R * f * Math.sqrt(((i * 0.618 + s) % 1)); return [e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.85]; };
    const a0 = ctx.globalAlpha;
    switch (e.el) {
      case 'fire': for (let i = 0; i < 9; i++) { const [x, y] = pt(i); const f = Math.sin(now * 9 + i * 1.7); ctx.globalAlpha = a0 * (0.5 + 0.5 * f); ctx.fillStyle = i % 2 ? P[1] : P[0]; ctx.fillRect(x - 2, y - 2 - (now * 30 + i * 7) % 12, 3, 3); } break;
      case 'frost': ctx.strokeStyle = P[0]; ctx.lineWidth = 1.5; for (let i = 0; i < 8; i++) { const [x, y] = pt(i); const tw = Math.max(0, Math.sin(now * 4 + i * 2.1)); ctx.globalAlpha = a0 * tw; const l = 2 + tw * 4; ctx.beginPath(); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); ctx.moveTo(x, y - l); ctx.lineTo(x, y + l); ctx.stroke(); } break;
      case 'water': ctx.strokeStyle = P[0]; ctx.lineWidth = 1.5; for (let i = 0; i < 2; i++) { const t = (now * 0.7 + i * 0.5) % 1; ctx.globalAlpha = a0 * (1 - t) * 0.7; ctx.beginPath(); ctx.ellipse(e.x, e.y, R * t, R * t * 0.85, 0, 0, Math.PI * 2); ctx.stroke(); } break;
      case 'storm': if (Math.random() < 0.06) { const [x, y] = pt((now * 10) | 0); const p = this.r.fxp.spawn(P_BOLT, x, y, 0.16); p.c = P[1]; p.s2 = 40; p.s = Math.random() * 9; } break;
      case 'nature': {
        const im = IMG.ambient; if (!im) break;
        for (let i = 0; i < 6; i++) { const a = now * 0.9 + i * 1.047, x = e.x + Math.cos(a) * R * 0.78, y = e.y + Math.sin(a) * R * 0.66; ctx.drawImage(im, ((now * 8 + i) | 0) % 6 * 12, 64, 12, 7, Math.round(x - 9), Math.round(y - 5), 18, 10); }
        break;
      }
      case 'spirit': case 'guard': {
        ctx.strokeStyle = P[1]; ctx.lineWidth = 1.5; ctx.globalAlpha = a0 * 0.7; ctx.beginPath(); ctx.ellipse(e.x, e.y, R * 0.66, R * 0.56, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = P[0]; for (let i = 0; i < 6; i++) { const a = (e.el === 'spirit' ? -now : now) * 1.2 + i * 1.047; ctx.fillRect(Math.round(e.x + Math.cos(a) * R * 0.66) - 2, Math.round(e.y + Math.sin(a) * R * 0.56) - 2, 4, 4); }
        break;
      }
      case 'shadow': ctx.fillStyle = P[2]; ctx.globalAlpha = a0 * 0.25; ctx.beginPath(); ctx.ellipse(e.x, e.y, R * 0.8, R * 0.68, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P[0]; ctx.globalAlpha = a0 * 0.6; for (let i = 0; i < 8; i++) { const a = now * 2 + i * 0.785, d = R * (0.3 + 0.4 * ((i * 0.37) % 1)); ctx.fillRect(e.x + Math.cos(a) * d - 1, e.y + Math.sin(a) * d * 0.85 - 1, 3, 3); } break;
      case 'earth': ctx.strokeStyle = P[2]; ctx.lineWidth = 2; ctx.globalAlpha = a0 * 0.7; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = s + i * 1.047; let x = e.x, y = e.y; ctx.moveTo(x, y); for (let q = 1; q <= 3; q++) { x = e.x + Math.cos(a + Math.sin(s + q * i) * 0.4) * R * 0.28 * q; y = e.y + Math.sin(a + Math.sin(s + q * i) * 0.4) * R * 0.24 * q; ctx.lineTo(x, y); } }
        ctx.stroke(); break;
      case 'blade': ctx.strokeStyle = P[0]; ctx.lineWidth = 2.5; for (let i = 0; i < 3; i++) { const a = now * 5 + i * 2.094; ctx.globalAlpha = a0 * 0.8; ctx.beginPath(); ctx.ellipse(e.x, e.y, R * 0.7, R * 0.6, 0, a, a + 0.9); ctx.stroke(); } break;
    }
    ctx.globalAlpha = a0;
  }
  drawSigil(e, k) {
    const r = this.r, ctx = r.ctx, d = r.heroPos.get(e.id); if (d) { e.x = d.x; e.y = d.y; }
    const a = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88, R = 34 + 22 * (1 - (1 - Math.min(1, k * 2)) ** 3), rot = r.motion ? r.time * 1.6 : 0;
    ctx.save(); ctx.translate(e.x, e.y + 2);
    ctx.globalAlpha = a * 0.55; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite(e.col), -R * 1.3, -R * 0.8, R * 2.6, R * 1.6); ctx.globalCompositeOperation = 'source-over';
    ctx.scale(1, 0.6); ctx.rotate(rot); ctx.globalAlpha = a * 0.9; ctx.strokeStyle = e.col; ctx.fillStyle = e.col; ctx.lineWidth = 3;
    const poly = (n, rad, off = 0) => { ctx.beginPath(); for (let i = 0; i <= n; i++) { const t = off + i / n * Math.PI * 2; i ? ctx.lineTo(Math.cos(t) * rad, Math.sin(t) * rad) : ctx.moveTo(Math.cos(t) * rad, Math.sin(t) * rad); } ctx.stroke(); };
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    switch (e.shape) {
      case 'hex': poly(6, R * 0.82); poly(6, R * 0.55, Math.PI / 6); for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; ctx.fillRect(Math.cos(t) * R * 0.82 - 3, Math.sin(t) * R * 0.82 - 3, 6, 6); } break;
      case 'fang': for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); ctx.beginPath(); ctx.moveTo(c * R + -s * 5, s * R + c * 5); ctx.lineTo(c * (R + 12), s * (R + 12)); ctx.lineTo(c * R + s * 5, s * R - c * 5); ctx.fill(); }
        ctx.lineWidth = 4; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.45 + i * 12, -R * 0.5); ctx.quadraticCurveTo(i * 12, 0, R * 0.45 + i * 12, R * 0.5); ctx.stroke(); } break;
      case 'star': ctx.beginPath(); for (let i = 0; i <= 8; i++) { const t = i / 8 * Math.PI * 2, rad = i % 2 ? R * 0.28 : R * 0.9; i ? ctx.lineTo(Math.cos(t) * rad, Math.sin(t) * rad) : ctx.moveTo(Math.cos(t) * rad, Math.sin(t) * rad); }
        ctx.globalAlpha = a * 0.3; ctx.fill(); ctx.globalAlpha = a * 0.9; ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.stroke(); break;
      case 'petal': for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate(i / 6 * Math.PI * 2); ctx.beginPath(); ctx.ellipse(R * 0.5, 0, R * 0.34, R * 0.13, 0, 0, Math.PI * 2); ctx.globalAlpha = a * 0.3; ctx.fill(); ctx.globalAlpha = a * 0.9; ctx.stroke(); ctx.restore(); } break;
      default: // rune
        ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.stroke(); poly(3, R * 0.78, -Math.PI / 2); poly(3, R * 0.78, Math.PI / 2);
        for (let i = 0; i < 8; i++) { const t = i / 8 * Math.PI * 2; ctx.fillRect(Math.cos(t) * R * 0.9 - 2, Math.sin(t) * R * 0.9 - 2, 4, 4); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  // Projectiles, interpolated between ticks, with element glow and a distance-based trail.
  drawProjectiles(g, alpha, inView, visiblePoint) {
    const r = this.r, ctx = r.ctx, next = this.trailNext; next.clear();
    for (const p of g.projectiles) {
      const q = this.pprev.get(p.id); let x = p.x, y = p.y;
      if (q) { x = q.x + (p.x - q.x) * alpha; y = q.y + (p.y - q.y) * alpha; }
      if (!inView(x, y) || !visiblePoint(x, y)) continue;
      const last = this.trailPos.get(p.id); next.set(p.id, { x, y });
      const moved = last ? Math.hypot(x - last.x, y - last.y) : 0;
      if (p.sprite === 'tower') {
        const c = TEAM_COL[p.team] || '#fff';
        ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite(c), x - 15, y - 15, 30, 30); ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
        if (moved > 6) for (let k = 0; k < Math.min(3, moved / 12); k++) { const t = r.fxp.spawn(P_GLOW, x - (x - last.x) * k / 3, y - (y - last.y) * k / 3, 0.22); t.c = c; t.s = 6; }
        continue;
      }
      if (p.sprite === 'p_energy_small') {
        const c = TEAM_COL[p.team] || '#fff';
        ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite(c), x - 7, y - 7, 14, 14); ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 3, 3);
        continue;
      }
      let sprite = p.sprite, pal = null, sig = null, ult = false;
      if (p.ab && p.src && p.src.def) {
        const pr = this.profile(p.src), a = pr.abs[p.abi]; if (a) { sprite = a.proj || sprite; pal = a.pal; sig = pr.sig; ult = !!p.ab.ult; }
        if (!this.seen.has(p.id) && !p.homing) {
          this.seen.add(p.id);
          const len = Math.max(0, (p.max || 0) - (p.trav || 0));
          if (len > 40) r.effects.push({ kind: 'lane', x: p.x, y: p.y + 6, dx: p.dx, dy: p.dy, len, w: p.width || 30, team: p.team, born: r.time, dur: len / (p.speed || 800) + 0.2 });
        }
      }
      if (pal) { ctx.globalCompositeOperation = 'lighter'; const R = ult ? 24 : 15; ctx.globalAlpha = 0.85; ctx.drawImage(glowSprite(pal[1]), x - R, y - R, R * 2, R * 2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      const def = PROJ[sprite], img = IMG['fx_' + sprite];
      if (!def || !img) { ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 2, 4, 4); }
      else {
        const fw = img.width / def.frames, fh = img.height, f = Math.floor(r.time * 14) % def.frames;
        const sc = (ult ? 2.6 : p.ab ? 2 : 1.6) * (fh > 20 && sprite !== 'p_bigenergy' ? 0.75 : 1);
        ctx.save(); ctx.translate(x, y);
        if (!def.round) ctx.rotate(Math.atan2(p.dy || 0, p.dx || 1)); else if (sprite === 'p_bigshuriken' || sprite === 'p_shuriken' || sprite === 'p_magicstar') ctx.rotate(r.time * 18);
        ctx.drawImage(img, f * fw, 0, fw, fh, -fw * sc / 2, -fh * sc / 2, fw * sc, fh * sc);
        ctx.restore();
      }
      if (pal && last && moved > 3) {
        const steps = Math.min(4, Math.ceil(moved / (r.detail ? 9 : 18)));
        for (let k = 0; k < steps; k++) {
          const t = r.fxp.spawn(k % 2 ? P_GLOW : P_SQUARE, x - (x - last.x) * k / steps + (Math.random() - 0.5) * 4, y - (y - last.y) * k / steps + (Math.random() - 0.5) * 4, 0.3);
          t.c = k % 2 ? pal[1] : (k % 3 ? sig : pal[0]); t.s = k % 2 ? (ult ? 9 : 6) : 2;
        }
      }
      if (p.hook && p.src) this.drawChain(p.src, x, y);
    }
    // swap trail maps; forget projectiles that are gone
    const t = this.trailPos; this.trailPos = next; this.trailNext = t;
    if (this.seen.size > 400) { const live = new Set(g.projectiles.map((p) => p.id)); for (const id of this.seen) if (!live.has(id)) this.seen.delete(id); }
  }
  drawChain(src, x, y) {
    const ctx = this.r.ctx, d = this.r.heroPos.get(src.id) || src, sx = d.x, sy = d.y - 12, L = Math.hypot(x - sx, y - sy), n = Math.floor(L / 9);
    ctx.fillStyle = '#2b2b33';
    for (let i = 1; i < n; i++) { const t = i / n, px = sx + (x - sx) * t, py = sy + (y - sy) * t; ctx.fillRect(Math.round(px) - 3, Math.round(py) - 2, i % 2 ? 6 : 3, i % 2 ? 3 : 5); }
    ctx.fillStyle = '#c9ccd6';
    for (let i = 1; i < n; i++) { const t = i / n, px = sx + (x - sx) * t, py = sy + (y - sy) * t; ctx.fillRect(Math.round(px) - 2, Math.round(py) - 1, i % 2 ? 4 : 1, i % 2 ? 1 : 3); }
  }
  // Instant line abilities: element-coloured streak, fading in 0.35 s.
  drawLines() {
    const r = this.r, ctx = r.ctx;
    r.lines = r.lines.filter((l) => r.time - l.born < 0.35);
    for (const l of r.lines) {
      const t = (r.time - l.born) / 0.35, P = l.pal || ELEM.blade, y1 = l.y1 - 12, y2 = l.y2 - 12;
      ctx.lineCap = 'round';
      ctx.globalAlpha = (1 - t) * 0.35; ctx.strokeStyle = this.rel(l.team); ctx.lineWidth = l.w;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.globalAlpha = 1 - t; ctx.strokeStyle = P[1]; ctx.lineWidth = 12 * (1 - t) + 2;
      ctx.beginPath(); ctx.moveTo(l.x1, y1); ctx.lineTo(l.x2, y2); ctx.stroke();
      ctx.strokeStyle = P[0]; ctx.lineWidth = 4 * (1 - t) + 1; ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalAlpha = 1;
  }
  // Dash afterimages in the hero's signature colour.
  afterimage(u, x, y, col, row, scale) {
    const r = this.r, last = this.ghosts.length ? this.ghosts[this.ghosts.length - 1] : null;
    if (last && last.id === u.id && r.time - last.born < (r.detail ? 0.03 : 0.06)) return;
    const img = this.ghostImg(u); if (!img) return;
    this.ghosts.push({ id: u.id, img, x, y, col, row, scale, born: r.time });
    if (this.ghosts.length > 40) this.ghosts.shift();
  }
  drawGhosts() {
    const r = this.r; if (!this.ghosts.length) return;
    this.ghosts = this.ghosts.filter((q) => r.time - q.born < 0.28);
    for (const q of this.ghosts) { r.ctx.globalAlpha = 0.55 * (1 - (r.time - q.born) / 0.28); r.drawSheetFrame(q.img, 16, 16, q.col, q.row, q.x, q.y, q.scale); }
    r.ctx.globalAlpha = 1;
  }
}
