// Command dock: the coach's controls.
//   six core calls · a hand of tactic cards · one-tap suggestions · a target sheet · a map ring menu.
// Everything here is built once and updated in place (no rebuilds while open = no flicker).
import { h, mount, face, icon, fmtTime, toast } from './dom.js';
import { BUILDS } from '../data/items.js';
import { TACTICS } from '../data/tactics.js';
import { CMD, DRAGON_INFO, TICK_RATE, T, OBJ_NAME } from '../sim/constants.js';
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';

const LANES = ['top', 'mid', 'bot'];
const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const BOSS_FACE = { dragon: 'boss/dragon_green_faceset', herald: 'boss/herald_faceset', baron: 'boss/baron_faceset' };
export const CORE = [
  { id: 'gank', label: 'Gank', icon: 'Cut', key: 'g', tip: 'Your jungler ambushes a lane' },
  { id: 'objective', label: 'Objective', icon: 'OrbFire', key: 'o', tip: 'Team takes the Kami, Oni or Kraken' },
  { id: 'push', label: 'Push', icon: 'Upgrade', key: 'r', tip: 'Group up and push a lane' },
  { id: 'shrine', label: 'Shrine', icon: 'OrbLight', key: 'k', tip: 'Capture a river shrine' },
  { id: 'safe', label: 'Defend', icon: 'DefenseUpgrade', key: 'x', tip: 'Everyone holds under your towers' },
  { id: 'reset', label: 'Regroup', icon: 'Heal', key: 'b', tip: 'Everyone recalls, heals and shops' },
];
const CORE_COST = { gank: 'gank', objective: 'objective', push: 'group', shrine: 'shrine', safe: 'safe', reset: 'reset' };
const CARD_KEYS = ['q', 'e', 't'];

export class Dock {
  constructor(hud) {
    this.hud = hud; this.g = hud.g; this.my = hud.my;
    this.sheetId = null; this.live = []; this.sugs = []; this.ganker = null;
    this.ringEl = document.getElementById('ring');
    this.build();
  }
  get team() { return this.g.teams[this.my]; }
  cost(type) { return CMD.cost[type] ?? 1; }
  afford(type) { return this.team.charges + 1e-9 >= this.cost(type); }
  alive() { return this.team.heroes.filter((x) => x.alive); }

  // ───────────── static layout ─────────────
  build() {
    const el = this.hud.el.cmd;
    if (this.my < 0) { mount(el, h('div', { class: 'spectate' }, 'Spectating · drag to look around · tap a portrait to follow')); return; }
    this.sugEl = h('div', { class: 'sugs' });
    this.sheetEl = h('div', { class: 'sheet hidden' });
    this.cancelEl = h('button', { class: 'cancelpill hidden', onclick: () => this.send({ type: 'cancel' }) }, '✕ Cancel calls');
    this.pips = Array.from({ length: CMD.maxCharges }, () => h('div', { class: 'pip' }, h('i')));
    this.chargeTxt = h('span', { class: 'ctxt' }, '');
    const meter = h('div', { class: 'meter', title: 'Command charges: +1 every 20s' }, h('div', { class: 'pips' }, this.pips), this.chargeTxt);
    this.cards = this.team.deck.map((d, i) => {
      const t = TACTICS[d.id];
      const b = h('button', { class: 'tcard', title: `${t.name}: ${t.desc} [${CARD_KEYS[i].toUpperCase()}]`, onclick: () => this.playCard(d.id) },
        h('img', { src: icon(t.icon) }), h('div', { class: 'tc-t' }, h('b', {}, t.name), h('small', {}, t.short)), h('span', { class: 'key' }, CARD_KEYS[i].toUpperCase()));
      b._d = d; return b;
    });
    this.callBtns = CORE.map((c) => {
      const n = this.cost(CORE_COST[c.id]);
      const b = h('button', { class: 'call', title: `${c.tip} [${c.key.toUpperCase()}]`, onclick: () => this.press(c.id) },
        h('img', { src: icon(c.icon) }), h('span', { class: 'l' }, c.label), h('span', { class: 'cost' }, ...Array.from({ length: n }, () => h('i'))));
      b._id = c.id; return b;
    });
    mount(el, this.sugEl, this.sheetEl, this.cancelEl,
      h('div', { class: 'dock' }, h('div', { class: 'handrow' }, meter, h('div', { class: 'hand' }, this.cards)), h('div', { class: 'callrow' }, this.callBtns)));
    this.tick();
  }

  // ───────────── per HUD tick (~8/s) ─────────────
  tick() {
    if (this.my < 0) return;
    const g = this.g, team = this.team, c = team.charges;
    this.pips.forEach((p, i) => { const f = Math.max(0, Math.min(1, c - i)); p.firstChild.style.height = f * 100 + '%'; p.classList.toggle('full', f >= 1); });
    const nextIn = c >= CMD.maxCharges ? '' : `+1 in ${Math.ceil((1 - (c % 1)) * CMD.regen)}s`;
    if (this.chargeTxt.textContent !== nextIn) this.chargeTxt.textContent = nextIn;
    for (const b of this.callBtns) {
      b.disabled = !this.afford(CORE_COST[b._id]);
      b.classList.toggle('on', this.sheetId === b._id);
      b.classList.toggle('hot', !!this.hotCall(b._id));
    }
    for (const b of this.cards) { b.disabled = b._d.used; b.classList.toggle('used', b._d.used); b.classList.toggle('on', this.sheetId === 'card:' + b._d.id); }
    const active = this.alive().some((x) => (x.task && x.task.call) || x.pendingCall) || (team.focus && team.focus.until > g.tick);
    this.cancelEl.classList.toggle('hidden', !active);
    for (const f of this.live) f();
    const now = performance.now();
    this.sugs = this.sugs.filter((s) => { if (now > s.until || (s.valid && !s.valid())) { s.el.classList.add('out'); setTimeout(() => s.el.remove(), 250); return false; } return true; });
    if (this.ring && now > this.ring.until) this.closeRing();
  }
  // Highlights a call button when there's a good reason to press it now.
  hotCall(id) {
    const g = this.g;
    if (id === 'objective') return ['dragon', 'herald', 'baron'].some((k) => g.objectives[k] && g.objectives[k].alive);
    if (id === 'shrine') return g.time > T.shrineUnlock && g.shrines.some((s) => s.owner !== this.my);
    return false;
  }

  // ───────────── sending ─────────────
  send(cmd) {
    if (this.my < 0) return false;
    if (!this.afford(cmd.type)) { toast('Not enough command charges'); audio.sfx('cancel', 0.6); return false; }
    this.hud.runner.send(cmd);
    this.close(); this.closeRing();
    audio.sfx('call', 0.8);
    const p = this.hud.callPoint(cmd); this.hud.mm.ping(p[0], p[1], TEAM_COL[this.my]);
    return true;
  }
  press(id) {
    if (this.my < 0) return;
    audio.sfx('move', 0.5);
    if (id === 'safe' || id === 'reset') { this.send({ type: id }); return; }
    if (id === 'shrine') {
      const open = this.g.shrines.filter((s) => s.owner !== this.my);
      if (this.g.time < T.shrineUnlock) { toast(`Shrines open at ${fmtTime(T.shrineUnlock)}`); return; }
      if (open.length === 1) { this.send({ type: 'shrine', shrine: open[0].id }); return; }
      if (!open.length) { toast('You already hold both shrines'); return; }
    }
    this.open(id);
  }
  playCard(id) {
    const d = this.team.deck.find((x) => x.id === id); if (!d || d.used) return;
    const t = TACTICS[id];
    if (t.target === 'none') { this.send({ type: 'tactic', card: id }); return; }
    this.open('card:' + id);
  }

  // ───────────── target sheet ─────────────
  close() { if (!this.sheetEl) return; this.sheetId = null; this.live = []; this.sheetEl.classList.add('hidden'); mount(this.sheetEl); document.getElementById('hud').classList.remove('sheeting'); }
  open(id) {
    if (this.sheetId === id) { this.close(); return; }
    this.sheetId = id; this.live = [];
    const body = this.sheetBody(id);
    if (!body) { this.close(); return; }
    mount(this.sheetEl, h('div', { class: 'sh-head' }, h('span', {}, body.title), h('button', { class: 'x', title: 'Close [Esc]', onclick: () => this.close() }, '✕')), body.els);
    this.sheetEl.classList.remove('hidden'); document.getElementById('hud').classList.add('sheeting');
    this.sheetEl.classList.remove('pop'); void this.sheetEl.offsetWidth; this.sheetEl.classList.add('pop');
    for (const f of this.live) f();
  }
  // A big target tile. `sub` and `state` may be functions; they're refreshed in place.
  tile({ img, ico, title, sub, onclick, state, cls }) {
    const subEl = h('small', {}, '');
    const b = h('button', { class: 'tile ' + (cls || ''), onclick: () => { if (!b.disabled) onclick(); } },
      img ? h('img', { src: img }) : ico ? h('img', { src: icon(ico) }) : null, h('div', {}, h('b', {}, title), subEl));
    const upd = () => {
      const s = typeof sub === 'function' ? sub() : sub || '';
      if (subEl.textContent !== s) subEl.textContent = s;
      const st = state ? state() : {};
      b.disabled = !!st.off; b.classList.toggle('rec', !!st.rec);
    };
    this.live.push(upd);
    return b;
  }
  laneInfo(lane) {
    const g = this.g, me = this.my, vis = g.vision[me];
    let n = 0, deep = false;
    for (const e of g.teams[1 - me].heroes) {
      if (!e.alive || !vis.has(e.id) || g.world.distToLane(lane, e) > 260) continue;
      n++; const pr = g.world.laneProgress(lane, e); if ((me === 0 ? pr : 1 - pr) < 0.47) deep = true;
    }
    return { n, deep };
  }
  sheetBody(id) {
    const g = this.g, mine = this.team.heroes;
    const lanes = (fn, sub, state) => h('div', { class: 'tiles' }, ...LANES.map((l) => this.tile({ title: LANE_L[l], sub: () => sub(l), state: () => state ? state(l) : {}, onclick: () => fn(l) })));
    if (id === 'gank') {
      const jg = mine.find((x) => x.role === 'jungle');
      if (!this.ganker || !this.ganker.alive) this.ganker = jg && jg.alive ? jg : this.alive()[0];
      if (!this.ganker) return null;
      const who = h('button', { class: 'whobtn', title: 'Tap to change who ganks', onclick: () => { const a = this.alive(); this.ganker = a[(a.indexOf(this.ganker) + 1) % a.length]; whoImg.src = face(this.ganker.heroId); whoName.textContent = this.ganker.def.name; } });
      const whoImg = h('img', { src: face(this.ganker.heroId) }), whoName = h('span', {}, this.ganker.def.name);
      who.append(whoImg, whoName, h('small', {}, 'change'));
      return { title: 'Gank which lane?', els: [h('div', { class: 'sh-who' }, h('span', { class: 'muted' }, 'Ganker'), who),
        lanes((l) => this.send({ type: 'gank', lane: l, hero: this.ganker.id }),
          (l) => { const i = this.laneInfo(l); return i.deep ? 'Overextended!' : i.n ? `${i.n} enemy seen` : 'No enemy seen'; },
          (l) => { const i = this.laneInfo(l); return { rec: i.deep, off: !this.afford('gank') }; })] };
    }
    if (id === 'objective') {
      const obj = (k) => this.tile({
        img: `assets/img/${BOSS_FACE[k]}.png`,
        title: k === 'dragon' ? DRAGON_INFO[g.objectives.dragon ? g.objectives.dragon.element : g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon].name : OBJ_NAME[k],
        sub: () => this.objStatus(k),
        state: () => ({ off: !g.objAvailable(k) || !this.afford('objective'), rec: !!(g.objectives[k] && g.objectives[k].alive) }),
        onclick: () => this.send({ type: 'objective', obj: k }),
      });
      const list = ['dragon', 'herald', 'baron'].filter((k) => !(k === 'herald' && g.time > T.heraldDespawn) && !(k === 'baron' && g.time < T.heraldDespawn - 90 && !g.objectives.baron));
      return { title: 'Take which objective?', els: [h('div', { class: 'tiles' }, ...list.map(obj),
        this.tile({ ico: 'Camouflage', title: 'Invade', sub: () => `Steal a camp · ${this.cost('invade')} charges`, state: () => ({ off: !this.afford('invade') }), onclick: () => this.send({ type: 'invade' }) }))] };
    }
    if (id === 'push') {
      const els = [lanes((l) => this.send({ type: 'group', lane: l }), (l) => { const i = this.laneInfo(l); return i.n ? `${i.n} enemy defending` : 'Whole team'; }, () => ({ off: !this.afford('group') }))];
      const splitter = this.splitter();
      if (splitter) els.push(h('div', { class: 'sh-row' }, h('span', { class: 'muted' }, `Solo split (${splitter.def.name})`),
        ...['top', 'bot'].map((l) => h('button', { class: 'chip', onclick: () => this.send({ type: 'split', hero: splitter.id, lane: l }) }, LANE_L[l]))));
      if (this.team.heraldEye > g.tick) els.push(h('div', { class: 'sh-row oni' }, h('span', {}, 'Unleash the Oni'), ...LANES.map((l) => h('button', { class: 'chip gold', onclick: () => this.send({ type: 'herald', lane: l }) }, LANE_L[l]))));
      return { title: 'Push which lane?', els };
    }
    if (id === 'shrine') {
      return { title: 'Take which shrine?', els: [h('div', { class: 'tiles' }, ...g.shrines.map((s) => this.tile({ ico: 'OrbLight', title: s.id === this.my ? 'Home shrine' : 'Far shrine',
        sub: () => (s.owner === this.my ? 'Ours' : s.owner < 0 ? 'Neutral' : 'Theirs'), state: () => ({ off: s.owner === this.my || !this.afford('shrine') }), onclick: () => this.send({ type: 'shrine', shrine: s.id }) })))] };
    }
    if (id.startsWith('card:')) {
      const cid = id.slice(5), t = TACTICS[cid];
      if (t.target === 'lane') return { title: `${t.name}: which lane?`, els: [lanes((l) => this.send({ type: 'tactic', card: cid, lane: l }), () => t.short)] };
      return { title: `${t.name}: which hero?`, els: [h('div', { class: 'tiles' }, ...mine.map((x) => this.tile({ img: face(x.heroId), title: x.def.name, sub: () => (x.alive ? `${Math.round(x.hp / x.maxHp * 100)}% HP` : 'Dead'), state: () => ({ off: !x.alive }), onclick: () => this.send({ type: 'tactic', card: cid, hero: x.id }) })))] };
    }
    if (id.startsWith('hero:')) {
      const x = g.byId(+id.slice(5)); if (!x) return null;
      if (x.team !== this.my) return { title: `${x.def.name}`, els: [h('div', { class: 'tiles' }, this.tile({ img: face(x.heroId), title: `Focus ${x.def.name}`, sub: 'Everyone targets them 20s', state: () => ({ off: !x.alive || !this.afford('focus') }), onclick: () => this.send({ type: 'focus', target: x.id }) }))] };
      return { title: `${x.def.name}: build path`, els: [h('div', { class: 'tiles' }, ...x.def.builds.map((b) => this.tile({ ico: BUILDS[b].icon || 'Alchemy', title: BUILDS[b].name, sub: () => (x.build === b ? 'Current' : 'Free'), state: () => ({ off: x.build === b }), onclick: () => this.send({ type: 'build', hero: x.id, build: b }) })))] };
    }
    return null;
  }
  objStatus(k) {
    const g = this.g, o = g.objectives[k], t = g.objTimers[k];
    if (o && o.alive) return o.hp < o.maxHp * 0.98 ? `Under attack ${Math.round(o.hp / o.maxHp * 100)}%` : 'Awake now';
    if (k === 'herald' && g.time > T.heraldDespawn) return 'Gone';
    if (!t) return '—';
    const left = Math.max(0, (t - g.tick) / TICK_RATE);
    return left <= 25 ? `Wakes in ${Math.ceil(left)}s` : `Wakes ${fmtTime(left)}`;
  }
  splitter() {
    const a = this.alive();
    return a.find((x) => x.role === 'top') || a.filter((x) => x.role !== 'support').sort((p, q) => q.level - p.level)[0] || null;
  }

  // ───────────── suggestions (one-tap) ─────────────
  suggest(key, text, label, cmd, opts = {}) {
    if (this.my < 0 || this.sugs.some((s) => s.key === key)) return;
    const el = h('div', { class: 'sug ' + (opts.cls || '') }, h('span', {}, text),
      h('button', { onclick: () => { if (this.send(cmd)) { el.classList.add('out'); setTimeout(() => el.remove(), 250); this.sugs = this.sugs.filter((s) => s.el !== el); } } }, label, ...Array.from({ length: this.cost(cmd.type) }, () => h('i'))),
      h('button', { class: 'no', title: 'Dismiss', onclick: () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); this.sugs = this.sugs.filter((s) => s.el !== el); } }, '✕'),
      h('div', { class: 'ttl' }));
    this.sugEl.prepend(el);
    this.sugs.unshift({ key, el, until: performance.now() + 12000, valid: opts.valid });
    while (this.sugs.length > 2) { const s = this.sugs.pop(); s.el.remove(); }
    audio.sfx('alert', 0.35);
  }

  // ───────────── map ring ─────────────
  ringAt(w, sx, sy) {
    if (this.my < 0) return false;
    const g = this.g, W = g.world, me = this.my, r = this.hud.r;
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const opts = []; let title = '';
    const foe = g.teams[1 - me].heroes.find((x) => x.alive && r.visible(x) && d2(x, { x: w.x, y: w.y + 14 }) < 48 * 48);
    if (foe) { title = foe.def.name; opts.push({ ico: 'Death', label: 'Focus', type: 'focus', cmd: { type: 'focus', target: foe.id } }); }
    else {
      for (const [k, pit] of [['dragon', W.pits.kami], ['baron', W.pits.kraken]]) {
        if (d2(pit, w) > 260 * 260) continue;
        const kk = k === 'baron' && g.time < T.heraldDespawn ? 'herald' : k;
        title = OBJ_NAME[kk];
        opts.push({ ico: 'OrbFire', label: 'Take it', type: 'objective', cmd: { type: 'objective', obj: kk }, off: !g.objAvailable(kk), sub: this.objStatus(kk) });
      }
      for (const s of g.shrines) if (d2(s, w) < 220 * 220) { title = 'Shrine'; opts.push({ ico: 'OrbLight', label: 'Capture', type: 'shrine', cmd: { type: 'shrine', shrine: s.id }, off: s.owner === me || g.time < T.shrineUnlock }); }
      if (!opts.length) {
        const lane = W.closestLane(w);
        if (W.distToLane(lane, w) < 320) {
          title = `${LANE_L[lane]} lane`;
          const jg = this.team.heroes.find((x) => x.role === 'jungle' && x.alive) || this.alive()[0];
          if (jg) opts.push({ ico: 'Cut', label: 'Gank', type: 'gank', cmd: { type: 'gank', lane, hero: jg.id } });
          opts.push({ ico: 'Upgrade', label: 'Push', type: 'group', cmd: { type: 'group', lane } });
          const sp = this.splitter(); if (sp && lane !== 'mid') opts.push({ ico: 'BookWind', label: 'Split', type: 'split', cmd: { type: 'split', hero: sp.id, lane } });
          if (this.team.heraldEye > g.tick) opts.push({ ico: 'Counter', label: 'Oni', type: 'herald', cmd: { type: 'herald', lane } });
        } else {
          const camp = g.camps.filter((c) => c.side !== me && c.mobs.length).sort((a, b) => d2(a, w) - d2(b, w))[0];
          if (camp && d2(camp, w) < 500 * 500) { title = 'Enemy jungle'; opts.push({ ico: 'Camouflage', label: 'Invade', type: 'invade', cmd: { type: 'invade' } }); }
        }
      }
    }
    if (!opts.length) { this.closeRing(); return false; }
    const R = opts.length === 1 ? 0 : 58;
    const items = opts.map((o, i) => {
      const a = -Math.PI / 2 + (i - (opts.length - 1) / 2) * (Math.PI * 2 / Math.max(3, opts.length + 1));
      const off = o.off || !this.afford(o.type);
      return h('button', { class: 'ropt', disabled: off, style: { left: `${Math.cos(a) * R}px`, top: `${Math.sin(a) * R}px` }, onclick: (e) => { e.stopPropagation(); this.send(o.cmd); } },
        h('img', { src: icon(o.ico) }), h('span', {}, o.label), h('span', { class: 'cost' }, ...Array.from({ length: this.cost(o.type) }, () => h('i'))), o.sub ? h('small', {}, o.sub) : null);
    });
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.max(80, Math.min(vw - 80, sx)), y = Math.max(110, Math.min(vh - 90, sy));
    mount(this.ringEl, h('div', { class: 'ringc', style: { left: x + 'px', top: y + 'px' } }, h('div', { class: 'rtitle' }, title), h('div', { class: 'rdot' }), items));
    this.ringEl.classList.remove('hidden');
    this.ring = { until: performance.now() + 5000 };
    audio.sfx('move', 0.5);
    return true;
  }
  closeRing() { if (!this.ring) return; this.ring = null; this.ringEl.classList.add('hidden'); mount(this.ringEl); }

  onKey(k) {
    if (this.my < 0) return false;
    if (k === 'escape') { this.close(); this.closeRing(); return true; }
    const c = CORE.find((x) => x.key === k); if (c) { this.press(c.id); return true; }
    const i = CARD_KEYS.indexOf(k); if (i >= 0 && this.team.deck[i]) { this.playCard(this.team.deck[i].id); return true; }
    if (k === 'c') { this.send({ type: 'cancel' }); return true; }
    return false;
  }
}
