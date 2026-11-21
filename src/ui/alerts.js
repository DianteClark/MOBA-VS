// Off-screen alert arrows: fights involving your heroes, your structures under attack,
// objectives being attacked. Arrows sit on the screen edge (never over HUD panels);
// tap one to pan the camera there. Read-only on the game.
import { h, face } from './dom.js';
import { TICK_RATE } from '../sim/constants.js';
import { settings } from './settings.js';

const PANEL_IDS = ['myteam', 'feed', 'topcenter', 'rightcol', 'brcol', 'cmdbar', 'detail'];
const BOSS_FACE = { dragon: 'boss/dragon_green_faceset', herald: 'boss/herald_faceset', baron: 'boss/baron_faceset' };
const SIZE = 46, EDGE = 8;

export class Alerts {
  constructor(hud) {
    this.hud = hud; this.g = hud.g; this.r = hud.r;
    this.el = h('div', { id: 'alerts', class: 'hud' });
    document.getElementById('hud').append(this.el);
    this.items = new Map(); // key → { el, x, y, kind, born }
    this.rects = []; this.rectsAt = 0;
  }
  destroy() { this.el.remove(); }
  // Collect alert sources (called on the HUD tick, ~8/s).
  scan() {
    const g = this.g, r = this.r, my = this.hud.my, view = this.hud.view, now = g.tick, out = [];
    if (!settings.alerts || g.over) { this.sync(out); return; }
    const recent = (t, s) => t !== undefined && now - t < s * TICK_RATE;
    // fights: a cluster around each hero of ours (or anyone, when spectating) trading with enemy heroes
    const mine = my >= 0 ? g.teams[my].heroes : [...g.teams[0].heroes, ...g.teams[1].heroes];
    const fights = [];
    for (const x of mine) {
      if (!x.alive || !(recent(x.lastHitHero, 2) || recent(x.lastHurtByHero, 2))) continue;
      if (my >= 0 && !r.visible(x)) continue;
      const f = fights.find((q) => (q.x - x.x) ** 2 + (q.y - x.y) ** 2 < 500 * 500);
      if (f) { f.n++; f.x = (f.x * (f.n - 1) + x.x) / f.n; f.y = (f.y * (f.n - 1) + x.y) / f.n; } else fights.push({ x: x.x, y: x.y, n: 1, hero: x });
    }
    for (const f of fights) out.push({ key: 'fight' + f.hero.id, kind: 'fight', x: f.x, y: f.y, img: face(f.hero.heroId), label: f.n > 1 ? `${f.n}` : '', team: f.hero.team });
    // structures under attack (ours)
    for (const u of g.units) {
      if (!u.structure || !u.alive || (my >= 0 && u.team !== my) || (my < 0 && u.team > 1)) continue;
      if (recent(u.lastHurt, 2.5) && u.hp < u.maxHp) out.push({ key: 'st' + u.id, kind: 'tower', x: u.x, y: u.y - 30, img: null, label: Math.round(u.hp / u.maxHp * 100) + '%', team: u.team });
    }
    // objectives being attacked (only if someone can see them)
    for (const k of ['dragon', 'herald', 'baron']) {
      const o = g.objectives[k];
      if (!o || !o.alive || o.hp >= o.maxHp || !recent(o.lastHurt, 2.5)) continue;
      if (my >= 0 && !g.vision[view].has(o.id)) continue;
      out.push({ key: 'obj' + k, kind: 'obj', x: o.x, y: o.y, img: `assets/img/${BOSS_FACE[k]}.png`, label: Math.round(o.hp / o.maxHp * 100) + '%' });
    }
    out.sort((a, b) => (a.kind === 'fight' ? 0 : 1) - (b.kind === 'fight' ? 0 : 1));
    this.sync(out.slice(0, 5));
  }
  sync(list) {
    const keep = new Set();
    for (const a of list) {
      keep.add(a.key);
      let it = this.items.get(a.key);
      if (!it) {
        const img = h('img', { src: a.img || 'assets/img/icons/DefenseUpgrade.png' }), lab = h('b', {});
        const el = h('button', { class: 'alert ' + a.kind, title: a.kind === 'fight' ? 'Fight! Tap to look' : a.kind === 'tower' ? 'Tower under attack' : 'Objective under attack',
          onclick: (e) => { e.stopPropagation(); this.go(it); } }, h('i', { class: 'arw' }), h('span', { class: 'ic' }, img), lab);
        this.el.append(el);
        it = { el, lab, img, born: performance.now() };
        this.items.set(a.key, it);
      }
      it.x = a.x; it.y = a.y; it.kind = a.kind;
      if (it.lab.textContent !== a.label) it.lab.textContent = a.label;
    }
    for (const [k, it] of this.items) if (!keep.has(k)) { it.el.remove(); this.items.delete(k); }
  }
  go(it) {
    const r = this.r; r.follow = null; r.panTo = { x: it.x, y: it.y }; this.hud.director = false; this.hud.refreshCtrl();
    it.el.classList.add('hidden');
  }
  panelRects() {
    const now = performance.now(); if (now - this.rectsAt < 400) return this.rects;
    this.rectsAt = now; const rs = [];
    for (const id of PANEL_IDS) {
      const e = document.getElementById(id); if (!e || !e.offsetParent) continue;
      const kids = ['cmdbar', 'feed', 'brcol'].includes(id) ? [...e.children].filter((k) => k.offsetParent) : [e];
      for (const k of kids) { const b = k.getBoundingClientRect(); if (b.width > 0 && b.height > 0) rs.push({ l: b.left - 4, t: b.top - 4, r: b.right + 4, b: b.bottom + 4 }); }
    }
    this.rects = rs; return rs;
  }
  // Per frame: place arrows on the screen edge, pushed inward until clear of HUD panels.
  place() {
    if (!this.items.size) return;
    const r = this.r, W = window.innerWidth, H = window.innerHeight, rects = this.panelRects();
    const cx = W / 2, cy = H / 2, half = SIZE / 2;
    for (const it of this.items.values()) {
      const s = r.w2s(it.x, it.y), px = s.x / r.dpr, py = s.y / r.dpr;
      const on = px > 30 && px < W - 30 && py > 30 && py < H - 30;
      if (on) { it.el.classList.add('hidden'); continue; }
      const dx = px - cx, dy = py - cy;
      // intersection with the inset screen rectangle
      const ex = W / 2 - half - EDGE, ey = H / 2 - half - EDGE;
      const k0 = Math.min(Math.abs(dx) > 1e-6 ? ex / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? ey / Math.abs(dy) : 1e9);
      let k = k0, x = cx + dx * k, y = cy + dy * k, ok = false;
      for (let step = 0; step < 40; step++) {
        const hit = rects.some((q) => x + half > q.l && x - half < q.r && y + half > q.t && y - half < q.b);
        if (!hit) { ok = true; break; }
        k *= 0.94; x = cx + dx * k; y = cy + dy * k;
      }
      if (!ok || k < k0 * 0.35) { it.el.classList.add('hidden'); continue; }
      it.el.classList.remove('hidden');
      const ang = Math.atan2(dy, dx);
      it.el.style.transform = `translate(${Math.round(x - half)}px, ${Math.round(y - half)}px)`;
      it.el.firstChild.style.transform = `rotate(${ang}rad) translateX(${half + 2}px)`;
    }
  }
}
