// Off-screen alert arrows (the one arrow system): fights involving your heroes, big fights
// anywhere you can see ("FIGHT AT KAMI - tap to watch": the fight cam), your structures under
// attack, objectives being attacked, a lane left open to a minion wave (tap sends a hero). Arrows sit on the screen edge (never over HUD panels);
// tap one to look there (big fights cut the camera straight in). Read-only on the game.
import { h, face, bossFace } from './dom.js';
import { TICK_RATE } from '../sim/constants.js';
import { settings } from './settings.js';
import { placeName } from './moments.js';
import { onViewport } from '../render/viewport.js';
import { laneOpenSend } from './feasible.js';

const PANEL_IDS = ['banner', 'myteam', 'topcenter', 'rightcol', 'foestrip', 'brcol', 'cmdbar', 'detail', 'qfeed'];
const SIZE = 46, EDGE = 8, DEF_IMG = 'assets/img/icons/DefenseUpgrade.png';

export class Alerts {
  constructor(hud) {
    this.hud = hud; this.g = hud.g; this.r = hud.r;
    this.el = h('div', { id: 'alerts', class: 'hud' });
    document.getElementById('hud').append(this.el);
    this.items = new Map(); // key → { el, x, y, kind, born }
    this.rects = []; this.rectsAt = 0;
    // rotation / toolbar / text-size changes: re-measure panels and prompt sizes
    this.offVp = onViewport(() => { this.rectsAt = 0; for (const it of this.items.values()) it.w = 0; });
  }
  destroy() { this.el.remove(); this.offVp(); }
  // Collect alert sources (called on the HUD tick, ~8/s).
  scan() {
    const g = this.g, r = this.r, my = this.hud.my, view = this.hud.view, now = g.tick, out = [];
    if (!settings.alerts || g.over) { this.sync(out); return; }
    const recent = (t, s) => t !== undefined && now - t < s * TICK_RATE;
    // fights: clusters of heroes we can see trading blows. 3+ heroes = a big fight (fight cam prompt);
    // smaller ones only matter when one of ours is in it.
    const fights = [];
    for (const x of [...g.teams[0].heroes, ...g.teams[1].heroes]) {
      if (!x.alive || !(recent(x.lastHitHero, 2) || recent(x.lastHurtByHero, 2))) continue;
      if (my >= 0 && !r.visible(x)) continue;
      const f = fights.find((q) => (q.x - x.x) ** 2 + (q.y - x.y) ** 2 < 600 * 600);
      const ours = my < 0 || x.team === my;
      if (f) { f.n++; f.x = (f.x * (f.n - 1) + x.x) / f.n; f.y = (f.y * (f.n - 1) + x.y) / f.n; if (ours && !f.hero) f.hero = x; } else fights.push({ x: x.x, y: x.y, n: 1, hero: ours ? x : null, any: x });
    }
    for (const f of fights) {
      const lead = f.hero || f.any;
      if (f.n >= 3) out.push({ key: 'big' + lead.id, kind: 'bigfight', x: f.x, y: f.y, img: face(lead.heroId), label: `FIGHT AT ${placeName(g, f, view)}`, team: lead.team });
      else if (f.hero) out.push({ key: 'fight' + f.hero.id, kind: 'fight', x: f.x, y: f.y, img: face(f.hero.heroId), label: f.n > 1 ? `${f.n}` : '', team: f.hero.team });
    }
    // structures under attack (ours)
    for (const u of g.units) {
      if (!u.structure || !u.alive || (my >= 0 && u.team !== my) || (my < 0 && u.team > 1)) continue;
      if (recent(u.lastHurt, 2.5) && u.hp < u.maxHp) out.push({ key: 'st' + u.id, kind: 'tower', x: u.x, y: u.y - 30, img: null, label: Math.round(u.hp / u.maxHp * 100) + '%', team: u.team });
    }
    // objectives being attacked (only if someone can see them)
    for (const k of ['dragon', 'herald', 'baron', 'boss', 'yokai']) {
      const o = g.objectives[k];
      if (!o || !o.alive || o.hp >= o.maxHp || !recent(o.lastHurt, 2.5)) continue;
      if (my >= 0 && !g.vision[view].has(o.id)) continue;
      out.push({ key: 'obj' + k, kind: 'obj', x: o.x, y: o.y, img: bossFace(k, o.element), label: Math.round(o.hp / o.maxHp * 100) + '%' });
    }
    // a lane left open: an enemy wave is hitting our structure and nobody is there (sim: team.laneOpen).
    // Tap: send the hero the lane brain suggests (a split call to that lane), and look there.
    // The send action only appears when it would work: a charge to pay for it and a hero free to go in time.
    if (my >= 0) for (const [lane, o] of Object.entries(g.teams[my].laneOpen || {})) {
      const tw = o && g.byId(o.tower);
      if (!tw || !tw.alive) continue;
      const s = laneOpenSend(g, my, lane, o), x = s && this.hud.mayCommand(s.cmd) ? s.hero : null;
      const L = lane[0].toUpperCase() + lane.slice(1);
      out.push({ key: 'open' + lane, kind: 'laneopen', x: tw.x, y: tw.y - 30, img: x ? face(x.heroId) : null, label: `${L} lane open: wave hitting tower`, sub: x ? `tap: send ${x.def.name}` : 'tap to look',
        cmd: x ? s.cmd : null, who: x ? x.def.name : null });
    }
    const rank = { bigfight: 0, laneopen: 1, fight: 2, tower: 3, obj: 4 };
    for (const a of out.slice()) if (a.kind === 'laneopen') { const i = out.findIndex((b) => b.kind === 'tower' && b.x === a.x); if (i >= 0) out.splice(i, 1); }
    out.sort((a, b) => rank[a.kind] - rank[b.kind]);
    this.sync(out.slice(0, 5));
  }
  sync(list) {
    const keep = new Set();
    for (const a of list) {
      keep.add(a.key);
      let it = this.items.get(a.key);
      if (!it) {
        const img = h('img', { src: a.img || DEF_IMG }), lab = h('b', {}), sub = h('small', {}, a.sub || 'tap to watch');
        const big = a.kind === 'bigfight' || a.kind === 'laneopen';
        const el = h('button', { class: 'alert fresh ' + a.kind, title: big ? 'Big fight! Tap to watch' : a.kind === 'fight' ? 'Fight! Tap to look' : a.kind === 'tower' ? 'Tower under attack' : 'Objective under attack',
          onclick: (e) => { e.stopPropagation(); this.go(it); } }, h('i', { class: 'arw' }), h('span', { class: 'ic' }, img), big ? h('span', { class: 'bl' }, lab, sub) : lab);
        if (a.kind === 'laneopen') { el.classList.add('bigfight'); el.style.setProperty('--ac', '#ff3b3b'); el.style.borderColor = '#ff3b3b'; el.title = a.label; }
        this.el.append(el);
        it = { el, lab, img, sub, born: performance.now(), w: 0, hh: 0 };
        this.items.set(a.key, it);
      }
      it.x = a.x; it.y = a.y; it.kind = a.kind; it.cmd = a.cmd; it.key = a.key; it.label = a.label; it.who = a.who;
      if (it.lab.textContent !== a.label) it.lab.textContent = a.label;
      if (a.kind === 'laneopen') { // the send option comes and goes with charges / the hero's state
        const t = a.sub || 'tap to watch', src = a.img || DEF_IMG;
        if (it.sub.textContent !== t) it.sub.textContent = t;
        if (it.img.getAttribute('src') !== src) it.img.setAttribute('src', src);
        if (!a.cmd) it.offered = false; // offer the tray card again once a send is possible
      }
    }
    for (const [k, it] of this.items) if (!keep.has(k)) { it.el.remove(); this.items.delete(k); }
  }
  go(it) {
    if (it.kind === 'laneopen' && it.cmd) this.hud.send(it.cmd);
    if (it.kind === 'bigfight') this.hud.watchFight(it.x, it.y);
    else { const r = this.r; r.follow = null; r.panTo = { x: it.x, y: it.y }; this.hud.director = false; this.hud.refreshCtrl(); }
    it.el.classList.add('hidden');
  }
  // A lane-open prompt with no edge to sit on (the tower is on screen, or a short phone has no free edge):
  // the same one-tap "send" goes to the decision tray instead, so it is never lost and never overlaps.
  trayFallback(it) {
    const d = this.hud.dock;
    if (it.kind !== 'laneopen' || !it.cmd || !d || !d.tray || this.hud.my < 0 || it.offered) return;
    it.offered = true; // once per open lane (a dismissed card stays dismissed until the lane opens again)
    d.suggest('lo:' + it.key, it.label, `Send ${it.who}`, it.cmd, { cls: 'bad', valid: () => this.items.has(it.key) && !!it.cmd });
  }
  panelRects() {
    const now = performance.now(); if (now - this.rectsAt < 250) return this.rects;
    this.rectsAt = now; const rs = [];
    for (const id of PANEL_IDS) {
      const e = document.getElementById(id); if (!e || !e.offsetParent) continue;
      const kids = ['cmdbar', 'topcenter', 'brcol', 'banner', 'qfeed'].includes(id) ? [...e.children].filter((k) => k.offsetParent) : [e];
      for (const k of kids) { const b = k.getBoundingClientRect(); if (b.width > 0 && b.height > 0) rs.push({ l: b.left - 4, t: b.top - 4, r: b.right + 4, b: b.bottom + 4 }); }
    }
    this.rects = rs; return rs;
  }
  // Per frame: place arrows on the screen edge, pushed inward until clear of HUD panels.
  place() {
    if (!this.items.size) return;
    const r = this.r, W = r.cssW || window.innerWidth, H = r.cssH || window.innerHeight, rects = this.panelRects().slice();
    const cx = W / 2, cy = H / 2;
    for (const it of this.items.values()) {
      // each prompt keeps its own size (a big-fight prompt is wider than a plain arrow)
      if (!it.w && it.el.offsetWidth) { it.w = Math.max(SIZE, it.el.offsetWidth); it.hh = Math.max(SIZE, it.el.offsetHeight) / 2; }
      const half = (it.w || SIZE) / 2, halfH = it.hh || SIZE / 2;
      const s = r.w2s(it.x, it.y), px = s.x / r.dpr, py = s.y / r.dpr;
      const on = px > 30 && px < W - 30 && py > 30 && py < H - 30;
      if (on) { it.el.classList.add('hidden'); this.trayFallback(it); continue; }
      const dx = px - cx, dy = py - cy;
      // intersection with the inset screen rectangle
      const ex = W / 2 - half - EDGE, ey = H / 2 - halfH - EDGE;
      const k0 = Math.min(Math.abs(dx) > 1e-6 ? ex / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? ey / Math.abs(dy) : 1e9);
      let k = k0, x = cx + dx * k, y = cy + dy * k, ok = false;
      for (let step = 0; step < 60; step++) {
        const hit = rects.some((q) => x + half > q.l && x - half < q.r && y + halfH > q.t && y - halfH < q.b);
        if (!hit) { ok = true; break; }
        k *= 0.94; x = cx + dx * k; y = cy + dy * k;
      }
      if (!ok || k < k0 * (it.kind === 'bigfight' || it.kind === 'laneopen' ? 0.12 : 0.35)) { it.el.classList.add('hidden'); this.trayFallback(it); continue; } // wide prompts may sit further in
      it.el.classList.remove('hidden', 'fresh');
      rects.push({ l: x - half - 3, t: y - halfH - 3, r: x + half + 3, b: y + halfH + 3 }); // later prompts keep clear of this one
      const ang = Math.atan2(dy, dx), ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
      const edge = Math.min(ca > 1e-3 ? half / ca : 1e9, sa > 1e-3 ? halfH / sa : 1e9); // arrow sits on the box edge
      it.el.style.transform = `translate(${Math.round(x - half)}px, ${Math.round(y - halfH)}px)`;
      it.el.firstChild.style.transform = `rotate(${ang}rad) translateX(${Math.round(edge) + 2}px)`;
    }
  }
}
