// Broadcast mode (spectating a friend, the Replay Theater, AI vs AI): a streamer's layer over a watch session.
//  * AI caster: a lower-third line for the big moments (the HUD caster's lines plus towers, gates, the finish and
//    a periodic read of the gold race), with an optional voice (Web Speech API, off by default).
//  * Fight cam: a picture-in-picture view of a fight the main camera is not showing (6 s per fight).
//  * Stats overlay: a gold-lead graph, team gold and kills, and a KDA ticker cycling through all ten heroes.
//  * Clean HUD: hides every HUD panel for capture (the overlays stay; a faint button brings the HUD back).
// Render-side only: reads the game and its events, never touches the sim. Respects Reduced effects (no slides,
// no PiP motion smoothing). Settings persist on this device (mobavs_bcast).
import { h, mount } from './dom.js';
import { Caster } from './caster.js';
import { TEAM_NAME, TICK_RATE } from '../sim/constants.js';
import { TEAM_COL } from '../render/palette.js';
import { settings } from './settings.js';

const KEY = 'mobavs_bcast';
const DEF = { on: false, caster: true, voice: false, pip: true, stats: true, clean: false };
const LANE = { top: 'top', mid: 'mid', bot: 'bottom' };
function load() { let v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { v = null; } return { ...DEF, ...(v && typeof v === 'object' ? v : {}), clean: false }; }
const k = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
export const speechOk = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

export class Broadcast {
  constructor(app, m, opts = {}) {
    this.app = app; this.m = m; this.g = m.game; this.r = app.renderer; this.o = load();
    this.caster = new Caster(this.g, 0); this.ev = this.g.events.length;
    this.gold = []; this.lastSample = -1; this.lastRead = this.g.tick; this.lastDom = 0; this.kdaI = 0; this.lastKda = 0; this.pip = null; this.pipFrame = 0; this.line = null;
    this.root = h('div', { id: 'bcast', class: 'hud' });
    this.castEl = h('div', { class: 'bccast hidden', 'aria-live': 'polite' });
    this.graph = h('canvas', { class: 'bcgraph', width: 120, height: 34, 'aria-hidden': 'true' });
    this.goldEl = h('div', { class: 'bcgold' }); this.kdaEl = h('div', { class: 'bckda' });
    this.statsEl = h('div', { class: 'bcstats hidden' }, this.graph, h('div', { class: 'col' }, this.goldEl, this.kdaEl));
    this.pipC = h('canvas', { class: 'bcpip' }); this.pipEl = h('div', { class: 'bcpipw hidden' }, this.pipC, h('small', {}, 'FIGHT CAM'));
    this.exitEl = h('button', { class: 'bcexit hidden', title: 'Show the HUD again', 'aria-label': 'Show the HUD', onclick: () => this.set('clean', false) }, 'HUD');
    this.live = opts.live || null;
    this.root.append(this.castEl, this.statsEl, this.pipEl, this.exitEl, ...(this.live ? [this.live] : []));
    document.getElementById('hud').append(this.root);
    // the toggle lives with the HUD's watch controls
    const seg = m.hud.el.ctrl.querySelectorAll('.seg'); const host = seg[seg.length - 1];
    this.btn = h('button', { class: 'btn small bcbtn', title: 'Broadcast mode: caster, fight cam, stats, clean HUD', onclick: (e) => { e.stopPropagation(); this.menu(); } }, 'Cast');
    if (host) host.insertBefore(this.btn, host.firstChild);
    this.apply();
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ ...this.o, clean: false })); } catch { /* ignore */ } }
  set(key, v) { this.o[key] = v; if (key === 'voice' && !v && speechOk()) speechSynthesis.cancel(); if (key === 'clean' || key === 'on') this.o.clean = key === 'clean' ? v && this.o.on : false; this.save(); this.apply(); if (this.sheet) this.menu(true); }
  apply() {
    const o = this.o;
    this.btn.classList.toggle('on', o.on);
    document.body.classList.toggle('bclean', !!(o.on && o.clean));
    this.exitEl.classList.toggle('hidden', !(o.on && o.clean));
    this.statsEl.classList.toggle('hidden', !(o.on && o.stats));
    if (!(o.on && o.caster)) this.castEl.classList.add('hidden');
    if (!(o.on && o.pip)) this.closePip();
    this.root.classList.toggle('still', !!settings.reducedMotion);
  }
  // The settings sheet (a small popover over the HUD).
  menu(rerender = false) {
    if (this.sheet && !rerender) { this.sheet.remove(); this.sheet = null; return; }
    if (this.sheet) this.sheet.remove();
    const o = this.o, row = (key, label, sub, dis) => h('button', { class: 'bcopt' + (o[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!o[key]), disabled: !!dis, onclick: () => this.set(key, !o[key]) },
      h('i', {}), h('span', {}, h('b', {}, label), sub ? h('small', {}, sub) : null));
    this.sheet = h('div', { class: 'bcsheet panel', role: 'dialog', 'aria-label': 'Broadcast mode' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, 'Broadcast mode'), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => this.menu() }, 'X')),
      row('on', 'Broadcast overlays', 'For streaming and capture'),
      row('caster', 'AI caster', 'Play-by-play lines', !o.on),
      row('voice', 'Caster voice', speechOk() ? 'Reads the big lines aloud' : 'Not available in this browser', !o.on || !o.caster || !speechOk()),
      row('pip', 'Fight cam', 'Picture-in-picture of off-screen fights', !o.on),
      row('stats', 'Stats overlay', 'Gold graph and KDA ticker', !o.on),
      row('clean', 'Clean HUD', 'Hide the HUD panels for capture', !o.on));
    document.getElementById('hud').append(this.sheet);
  }
  destroy() {
    if (speechOk()) speechSynthesis.cancel();
    document.body.classList.remove('bclean');
    this.root.remove(); if (this.sheet) this.sheet.remove(); this.btn.remove();
  }
  // ───────── caster ─────────
  say(text, prio, team) {
    if (!this.o.on || !this.o.caster) return;
    const now = performance.now();
    if (this.line && now - this.line.t < 2500 && this.line.prio > prio) return; // a bigger line holds the slot
    this.line = { text, prio, t: now };
    mount(this.castEl, h('b', { class: 'bcmic' }, 'CASTER'), h('span', { style: team === 0 || team === 1 ? { '--tc': TEAM_COL[team] } : null }, text));
    this.castEl.classList.remove('hidden', 'in'); void this.castEl.offsetWidth; this.castEl.classList.add('in');
    if (this.o.voice && prio >= 3 && speechOk()) {
      try {
        if (speechSynthesis.pending || speechSynthesis.speaking) { if (prio < 5) return; speechSynthesis.cancel(); }
        const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N} ,.!?'-]/gu, ' ')); u.rate = 1.08; u.volume = Math.min(1, (settings.master ?? 100) / 100);
        speechSynthesis.speak(u);
      } catch { /* no voice */ }
    }
  }
  events() {
    const g = this.g, E = g.events;
    if (this.ev > E.length) this.ev = E.length; // the Theater seeked back (a new event list)
    for (; this.ev < E.length; this.ev++) {
      const e = E[this.ev];
      const l = this.caster.line(e);
      if (l) this.say(l.text, l.prio, e.type === 'kill' ? 1 - e.team : e.team);
      if (e.type === 'tower') this.say(`${TEAM_NAME[e.team]} take down a ${LANE[e.lane] || 'base'} tower${e.tier >= 2 ? ': the base is open' : ''}.`, 2, e.team);
      else if (e.type === 'inhib') this.say(`The ${LANE[e.lane] || ''} gate falls! ${TEAM_NAME[e.team]} will get super minions.`, 4, e.team);
      else if (e.type === 'finalPhase') this.say('Last Stand! Gold is up, respawns are long: every fight decides it now.', 4);
      else if (e.type === 'victory') this.say(e.timeout ? `Time! ${TEAM_NAME[e.team]} win it on towers.` : `The Crystal shatters! ${TEAM_NAME[e.team]} win the game!`, 7, e.team);
      if (e.type === 'kill' && this.o.on && this.o.pip) this.fight(e.x, e.y);
    }
    // a read of the gold race every ~50 s of game time
    if (g.tick - this.lastRead > 50 * TICK_RATE && g.time > 90) {
      this.lastRead = g.tick;
      const d = this.goldOf(0) - this.goldOf(1), lead = d > 0 ? 0 : 1, kk = [g.teams[0].kills, g.teams[1].kills];
      if (Math.abs(d) > 1500) this.say(`${TEAM_NAME[lead]} lead by ${k(Math.abs(d))} gold${kk[lead] >= kk[1 - lead] ? '' : ' despite trailing on kills'}.`, 1, lead);
      else this.say(`Dead even: ${k(Math.abs(d))} gold between them, ${kk[0]}-${kk[1]} on kills.`, 1);
    }
  }
  goldOf(t) { return this.g.teams[t].heroes.reduce((a, x) => a + x.goldEarned, 0); }
  // ───────── fight cam ─────────
  fight(x, y) {
    if (this.r.onScreen(x, y, 60)) return;
    const now = performance.now();
    if (this.pip && now < this.pip.until - 4500) return; // the fight cam stays on one fight for a moment
    this.pip = { x, y, cx: x, cy: y, until: now + 6000 };
    this.pipEl.classList.remove('hidden');
  }
  closePip() { this.pip = null; this.pipEl.classList.add('hidden'); }
  drawPip(alpha) {
    const p = this.pip, r = this.r, g = this.g;
    if (!p || !r.game) return;
    if (performance.now() > p.until || g.over) { this.closePip(); return; }
    // follow the fight: the heroes still standing near it
    let sx = 0, sy = 0, n = 0;
    for (const t of g.teams) for (const x of t.heroes) if (x.alive && (x.x - p.x) ** 2 + (x.y - p.y) ** 2 < 420 * 420) { sx += x.x; sy += x.y; n++; }
    if (n) { const kk = settings.reducedMotion ? 1 : 0.08; p.cx += (sx / n - p.cx) * kk; p.cy += (sy / n - p.cy) * kk; }
    if (++this.pipFrame % 2) return; // ~30 fps is plenty for a small window
    const c = this.pipC, cw = c.clientWidth, ch = c.clientHeight; if (!cw || !ch) return;
    const dpr = r.dpr, w = Math.round(cw * dpr), hh = Math.round(ch * dpr);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    if (!this.pctx) this.pctx = c.getContext('2d');
    if (!this.fogDummy) this.fogDummy = document.createElement('canvas');
    // draw the same renderer into the small canvas with its own camera (saved and restored around the call)
    const keep = { canvas: r.canvas, ctx: r.ctx, W: r.W, H: r.H, cssW: r.cssW, cssH: r.cssH, cam: r.cam, trauma: r.trauma, focus: r.focus, follow: r.follow, panTo: r.panTo, fogOn: r.fogOn, fog: r.fog,
      callouts: r.callouts, hitStop: r.hitStop, punch: r.punch, tint: r.tint, placed: r.placed, heroPos: r.heroPos, avoid: r.avoid };
    Object.assign(r, { canvas: c, ctx: this.pctx, W: w, H: hh, cssW: cw, cssH: ch, cam: { x: p.cx, y: p.cy, zoom: 0.9 }, trauma: 0, focus: null, follow: null, panTo: null, fogOn: false, fog: this.fogDummy,
      callouts: [], hitStop: 0, punch: 0, tint: null, heroPos: new Map(), avoid: [], pip: true });
    const lw = r.lw, lwKeep = lw ? { nc: lw.nc, nx: lw.nx } : null; // Living World's night buffer: the PiP keeps its own (no resize thrash)
    if (lw) { if (!this.lwNc) { this.lwNc = document.createElement('canvas'); this.lwNx = this.lwNc.getContext('2d'); } lw.nc = this.lwNc; lw.nx = this.lwNx; }
    try { r.draw(alpha, 0); } catch (e) { console.warn('fight cam', e); this.closePip(); } finally { Object.assign(r, keep); r.pip = false; if (lw) Object.assign(lw, lwKeep); }
  }
  // ───────── stats overlay ─────────
  stats(now) {
    const g = this.g;
    if (g.tick - this.lastSample >= 5 * TICK_RATE || this.lastSample < 0 || g.tick < this.lastSample) {
      if (g.tick < this.lastSample) this.gold = []; // seeked back
      this.lastSample = g.tick; this.gold.push(this.goldOf(0) - this.goldOf(1)); if (this.gold.length > 240) this.gold.splice(0, this.gold.length - 240);
    }
    if (now - this.lastDom < 250) return; this.lastDom = now;
    const g0 = this.goldOf(0), g1 = this.goldOf(1);
    mount(this.goldEl, h('b', { style: { color: TEAM_COL[0] } }, `${k(g0)}`), h('small', {}, ` ${g.teams[0].kills} – ${g.teams[1].kills} `), h('b', { style: { color: TEAM_COL[1] } }, `${k(g1)}`));
    if (now - this.lastKda > 2200) { // KDA ticker: two heroes at a time, cycling through all ten
      this.lastKda = now;
      const all = [...g.teams[0].heroes, ...g.teams[1].heroes], a = all[this.kdaI % all.length], b = all[(this.kdaI + 5) % all.length]; this.kdaI++;
      mount(this.kdaEl, ...[a, b].map((x) => h('span', { style: { color: TEAM_COL[x.team] } }, `${x.def.name} ${x.kills}/${x.deaths}/${x.assists}`)));
      if (!settings.reducedMotion) { this.kdaEl.classList.remove('in'); void this.kdaEl.offsetWidth; this.kdaEl.classList.add('in'); }
    }
    const c = this.graph, x = c.getContext('2d'), W = c.width, H = c.height, d = this.gold;
    x.clearRect(0, 0, W, H);
    const max = Math.max(1000, ...d.map(Math.abs)), mid = H / 2;
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, mid, W, 1);
    const n = d.length; if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const px = Math.floor(i / (n - 1) * (W - 1)), v = d[i] / max * (mid - 2);
      x.fillStyle = v >= 0 ? TEAM_COL[0] : TEAM_COL[1];
      x.fillRect(px, v >= 0 ? mid - v : mid, Math.max(1, Math.ceil(W / n)), Math.abs(v) || 1);
    }
  }
  frame(raw, alpha) {
    if (this.r.game !== this.g) { this.g = this.m.game; this.caster = new Caster(this.g, 0); this.ev = this.g.events.length; this.gold = []; } // Theater seek: a restored game
    this.events();
    if (!this.o.on) return;
    if (this.o.stats) this.stats(performance.now());
    if (this.o.pip && this.pip) this.drawPip(alpha);
    if (this.castEl && this.line && performance.now() - this.line.t > 5500 && !this.castEl.classList.contains('hidden')) this.castEl.classList.add('hidden');
  }
}
