// Bosses & Beasts visuals (render-only; Math.random is fine here). Read-only on the game.
//  - Kami bodies: each map's species (base) and its Elder recolor (the world boss), from one atlas per species,
//    with a soft colour aura; the Elder wears a slow crown of light. Rare Oni / Kraken: their recolor plus a
//    shiny sparkle, and a shiny spawn moment.
//  - Minion families: a team's cosmetic family (session looks, never the sim) draws its monster sheets, with a
//    team-coloured ground ring so both sides read apart even in the same family.
//  - Jungle camps in each map's theme, their night forms, the Yokai Parade band per map.
//  - Scout pets: the coach's animal (looks), a running dust trail, a sight ring while it watches.
// Reduced effects: no sparkle motion, no trail.
import { IMG, flashOf } from './assets.js';
import { TEAM_COL } from './palette.js';
import { glowSprite } from './particles.js';
import { DRAGON_INFO } from '../sim/constants.js';
import { BEASTS } from '../sim/beasts.js';
import { KAMI_ART, KAMI_SCALE, familySheet, campSprite, NIGHT_LOOK, PARADE_LOOK, PETS, MAP_FAMILY, EVENT_FAMILY } from '../data/beasts.js';

const RARE_COL = { herald: '#7dffb2', baron: '#7dffb2' };
export class BeastsFx {
  constructor(r) { this.r = r; this.looks = [{}, {}]; }
  attach(game) {
    this.g = game; this.map = game.world.def.id; this.on = !!game.beasts;
    this.shine = new Map();
  }
  // Session looks per team: { troop: family id, pet: animal id } (validated by src/looks.js).
  setLooks(looks) { this.looks = looks || [{}, {}]; }
  family(team) {
    const g = this.g, L = this.looks[team] || {};
    if (L.troop) return L.troop;
    return (g && g.event && EVENT_FAMILY[g.event]) || MAP_FAMILY[this.map] || 'spirits';
  }

  // ── minions ──
  // { key, img, fam } for a minion: its team's family sheet, or the classic team sprite.
  minion(u) {
    const sheet = familySheet(this.family(u.team), u.kind);
    if (sheet && IMG['mon_' + sheet]) return { key: 'mon_' + sheet, img: IMG['mon_' + sheet], fam: true };
    const key = `minion_${u.team ? 'red' : 'blue'}_${u.kind === 'super' ? 'siege' : u.kind}`;
    return { key, img: IMG[key], fam: false };
  }
  // a small team ring under a family minion (both teams may share a family)
  minionRing(u, x, y) {
    const ctx = this.r.ctx, rx = u.kind === 'super' ? 13 : u.kind === 'siege' ? 11 : 8;
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y + 2, rx, rx * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = TEAM_COL[u.team]; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
  }

  // ── jungle mobs ──
  mob(u) {
    let key = u.kind;
    if (u.nf && u.camp) { const kind = u.kind.replace(/^camp_/, ''); if (NIGHT_LOOK[kind]) key = 'mon_' + NIGHT_LOOK[kind]; }
    else if (u.parade) { const P = PARADE_LOOK[this.map]; if (P) key = u.kind === 'yokai_skull' ? P[1] : u.kind === 'yokai_kappa' ? P[2] : key; }
    else if (/^camp_(bluebuff|redbuff|wolf|raptor|gromp|krug)$/.test(u.kind)) key = campSprite(this.map, u.kind);
    const img = IMG[key] || IMG[u.kind];
    return { key: IMG[key] ? key : u.kind, img };
  }
  // tamed yokai and the parade leader
  paradeKey(look) { const P = PARADE_LOOK[this.map]; if (!P) return look; const i = ['yokai_lantern', 'yokai_skull', 'yokai_kappa'].indexOf(look); return i >= 0 && IMG[P[i]] ? P[i] : look; }
  // night forms glow a little
  nightGlow(u, x, y) {
    if (!u.nf) return;
    const ctx = this.r.ctx; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 + 0.1 * Math.sin(this.r.time * 3 + u.id);
    const s = u.big ? 64 : 40; ctx.drawImage(glowSprite('#b48cff'), x - s / 2, y - s * 0.75, s, s); ctx.restore();
  }

  // ── bosses ──
  drawBoss(u, x, y, flashing, attacking) {
    const r = this.r, ctx = r.ctx;
    const sp = u.kind === 'dragon' && DRAGON_INFO[u.element] && DRAGON_INFO[u.element].species ? u.element : u.kind === 'boss' && u.elder ? u.element : null;
    if (sp && KAMI_ART[sp]) {
      const elder = u.kind === 'boss', A = KAMI_ART[sp][elder ? 1 : 0], img = IMG['kami_' + sp]; if (!img) return true;
      const row = attacking ? A.atk : A.idle, [ry, fw, fh, n] = row, f = Math.floor(r.time * (attacking ? 12 : 7) + u.id) % n;
      const sc = KAMI_SCALE[sp] * (elder ? 1.35 : 1), col = DRAGON_INFO[sp].color;
      // aura
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (elder ? 0.42 : 0.28) + 0.08 * Math.sin(r.time * 3);
      const gs = (elder ? 230 : 160); ctx.drawImage(glowSprite(col), x - gs / 2, y - gs * 0.72, gs, gs * 0.9); ctx.restore();
      if (elder) this.crown(x, y - fh * sc * 0.55, col);
      const bob = r.motion ? Math.sin(r.time * 2.4 + u.id) * 3 : 0, w = fw * sc, h = fh * sc;
      const src = flashing ? flashOf(`kami_${sp}_${elder ? 1 : 0}_${attacking ? 'a' : 'i'}`, this.strip(sp, row)) : this.strip(sp, row);
      const flip = sp === 'samurai' && attacking && u.facing === 2;
      if (flip) { ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1); ctx.drawImage(src, f * fw, 0, fw, fh, -w / 2, Math.round(y + 14 + bob - h), w, h); ctx.restore(); }
      else ctx.drawImage(src, f * fw, 0, fw, fh, Math.round(x - w / 2), Math.round(y + 14 + bob - h), w, h);
      return true;
    }
    if ((u.kind === 'herald' || u.kind === 'baron') && u.rare) {
      const k = u.kind === 'herald';
      const img = k ? (flashing ? IMG.oni_rare_hit : IMG.oni_rare_idle) : (attacking ? IMG.kraken_rare_attack : IMG.kraken_rare_idle); if (!img) return false;
      const frames = k ? (flashing ? 3 : 5) : (attacking ? 6 : 4), f = Math.floor(r.time * 8) % frames;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.1 * Math.sin(r.time * 4); ctx.drawImage(glowSprite(RARE_COL[u.kind]), x - 80, y - 110, 160, 130); ctx.restore();
      if (k) r.drawSheetFrame(img, 50, 50, f, 0, x, y + 10, 2.0);
      else r.drawSheetFrame(flashing ? flashOf(attacking ? 'krare_a' : 'krare_i', img) : img, 76, 79, f, 0, x, y + 16, 1.8);
      this.sparkle(u, x, y - (k ? 60 : 90));
      return true;
    }
    return false;
  }
  // one animation row of a species atlas as its own canvas (cached; flashOf needs a whole image)
  strip(sp, row) {
    const key = sp + ':' + row[0]; let c = this.stripC && this.stripC.get(key); if (c) return c;
    const img = IMG['kami_' + sp]; c = document.createElement('canvas'); c.width = row[1] * row[3]; c.height = row[2];
    c.getContext('2d').drawImage(img, 0, row[0], c.width, c.height, 0, 0, c.width, c.height);
    (this.stripC || (this.stripC = new Map())).set(key, c); return c;
  }
  crown(x, y, col) {
    const ctx = this.r.ctx, t = this.r.motion ? this.r.time : 0;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) { const a = t * 0.9 + k * Math.PI / 3, px = x + Math.cos(a) * 34, py = y + Math.sin(a) * 9; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(a * 2); ctx.drawImage(glowSprite(k % 2 ? '#ffffff' : col), px - 7, py - 7, 14, 14); }
    ctx.restore();
  }
  sparkle(u, x, y) {
    const ctx = this.r.ctx, t = this.r.time;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const ph = (t * 0.7 + k * 0.25 + u.id * 0.13) % 1, a = k * 1.9 + u.id, px = x + Math.cos(a) * 40, py = y + Math.sin(a) * 22 - (this.r.motion ? ph * 30 : 0);
      ctx.globalAlpha = Math.sin(ph * Math.PI); ctx.fillStyle = '#eaffef';
      ctx.fillRect(Math.round(px) - 1, Math.round(py) - 4, 2, 8); ctx.fillRect(Math.round(px) - 4, Math.round(py) - 1, 8, 2);
    }
    ctx.restore();
  }

  // ── scout pets ──
  petId(team) { const p = (this.looks[team] || {}).pet; return PETS[p] ? p : 'dog'; }
  drawPet(u, x, y, moving) {
    const r = this.r, ctx = r.ctx, img = IMG.pets; if (!img) return;
    const row = PETS[this.petId(u.team)].row, f = moving ? Math.floor(r.time * 10 + u.id) % 2 : Math.floor(r.time * 2) % 2;
    // sight ring while watching
    if (u.arrived) {
      const k = r.motion ? (r.time * 0.5) % 1 : 0.5, R = BEASTS.scoutSight;
      ctx.save(); ctx.globalAlpha = 0.18 * (1 - k); ctx.strokeStyle = TEAM_COL[u.team]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, R * (0.35 + 0.65 * k), R * 0.8 * (0.35 + 0.65 * k), 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else if (moving && r.motion && Math.random() < 0.3) r.puff && r.puff(x - (u.facing === 2 ? -8 : 8), y, 4, 10, 'rgba(220,205,170,0.7)', 0.5, 0, -10);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = TEAM_COL[u.team]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 2, 11, 4.6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    const bob = moving ? -Math.abs(Math.sin(r.time * 14 + u.id)) * 2 : 0, s = 1.8, w = 24 * s;
    const left = u.facing === 2 || (u.facing !== 3 && u.goal && u.goal.x < u.x);
    ctx.save(); ctx.translate(Math.round(x), Math.round(y + 4 + bob - w)); if (!left) { ctx.scale(-1, 1); }
    ctx.drawImage(img, f * 24, row * 24, 24, 24, -w / 2, 0, w, w); ctx.restore();
    // three hit pips over its head
    for (let i = 0; i < u.maxHp; i++) { ctx.fillStyle = '#000'; ctx.fillRect(Math.round(x - 10 + i * 7) - 1, Math.round(y - 40) - 1, 6, 5); ctx.fillStyle = i < u.hp ? TEAM_COL[u.team] : '#333'; ctx.fillRect(Math.round(x - 10 + i * 7), Math.round(y - 40), 4, 3); }
  }
}
