// Command dock: the coach's controls.
//   six core calls (context-aware: relevant ones glow gold, red when defending, irrelevant ones dim)
//   · a hand of tactic cards · the decision tray (one slot) · a target sheet · a map ring menu
//   · the charge + momentum meter (tap it when full for Kami Surge).
// Everything here is built once and updated in place (no rebuilds while open = no flicker).
import { h, mount, face, icon, fmtTime, toast, bossFace, kamiNow, setText, setCss, setOff } from './dom.js';
import { BUILDS } from '../data/items.js';
import { TACTICS } from '../data/tactics.js';
import { CMD, DRAGON_INFO, TICK_RATE, OBJ_NAME, MOMENTUM } from '../sim/constants.js';
import { Tray, PRIO } from './tray.js';
import { MOMENTS, MOMENT_IDS, MOMENT, momentReady } from '../sim/moments-coach.js';
import { momentAs } from '../sim/sidegrades.js';
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';
import { COOP_COL } from '../coop-room.js';
import { canIssue, readyIn, bestGanker, busy } from './feasible.js';
import { pips, paintPips, shortBy } from './cost.js';
import { LIVING } from '../sim/living.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
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
const STANCES = ['auto', 'go', 'save'];
const STANCE_TIP = { auto: 'Ults: Auto (heroes choose). Tap for ALL-IN in the next fight [U]', go: 'Ults: ALL-IN, fired in the next fight. Tap for Hold [U]', save: 'Ults: Hold, saved for a kill or self-defence. Tap for Auto [U]' };

export class Dock {
  constructor(hud) {
    this.hud = hud; this.g = hud.g; this.my = hud.my;
    this.sheetId = null; this.live = []; this.ganker = null;
    this.ringEl = document.getElementById('ring');
    this.build();
  }
  get team() { return this.g.teams[this.my]; }
  cost(type) { return type === 'lead' ? 0 : CMD.cost[type] ?? 1; } // co-op: passing the lead is free
  afford(type) { return this.team.charges + 1e-9 >= this.cost(type); }
  alive() { return this.team.heroes.filter((x) => x.alive); }
  // co-op: the living heroes this coach runs (all of them otherwise)
  ownAlive() { return this.alive().filter((x) => this.hud.ownHero(x)); }

  // ───────────── static layout ─────────────
  build() {
    const el = this.hud.el.cmd;
    const potg = this.hud.app.session && this.hud.app.session.potg;
    if (potg) { mount(el, h('div', { class: 'spectate potgbar' }, h('b', {}, 'PLAY OF THE GAME'), h('span', {}, potg.title), h('button', { class: 'btn small', onclick: () => this.hud.app.endPOTG() }, 'Skip'))); return; }
    if (this.my < 0) { mount(el, h('div', { class: 'spectate' }, 'Spectating · drag to look around · tap a portrait to follow')); return; }
    this.trayEl = h('div', { class: 'tray empty' });
    this.tray = new Tray(this.trayEl);
    this.sheetEl = h('div', { class: 'sheet hidden' });
    this.cancelEl = h('button', { class: 'cancelpill hidden', title: 'Cancel your calls (free) [C]', onclick: () => this.send({ type: 'cancel' }) }, h('b', {}, '✕'), this.cancelPill = h('span', {}, 'Cancel calls'));
    this.pips = Array.from({ length: CMD.maxCharges }, () => h('div', { class: 'pip' }, h('i')));
    this.chargeTxt = h('span', { class: 'ctxt' }, '');
    this.momFill = h('i');
    this.meterEl = h('button', { class: 'meter', title: 'Command charges (+1 every 20s) and momentum. When momentum is full, tap for Kami Surge [V]', onclick: () => this.surge() },
      h('div', { class: 'pips' }, this.pips), h('div', { class: 'mom' }, this.momFill), this.chargeTxt);
    this.cards = this.team.deck.map((d, i) => {
      const t = TACTICS[d.id];
      const b = h('button', { class: 'tcard', title: `${t.name}: ${t.desc} [${CARD_KEYS[i].toUpperCase()}]`, onclick: () => this.playCard(d.id) },
        h('img', { src: icon(t.icon) }), h('div', { class: 'tc-t' }, h('b', {}, t.name), h('small', {}, t.short)), h('span', { class: 'key' }, CARD_KEYS[i].toUpperCase()));
      b._d = d; return b;
    });
    this.callBtns = CORE.map((c) => {
      const n = this.cost(CORE_COST[c.id]);
      const pp = pips(n), b = h('button', { class: 'call', title: `${c.tip} [${c.key.toUpperCase()}]`, onclick: () => this.press(c.id) },
        h('img', { src: icon(c.icon) }), h('span', { class: 'l' }, c.label), pp);
      b._id = c.id; b._pips = pp; return b;
    });
    // Coach Moments: one compact button; the sheet lists the three once-per-match calls.
    this.momentBtn = h('button', { class: 'momentbtn', title: 'Coach Moments: Timeout, Rally, All-Out Push. Each once per match [M]', onclick: () => { audio.sfx('move', 0.5); this.open('moments'); } },
      h('img', { src: icon('BookThunder') }), h('span', { class: 'ml' }, 'Moments'), this.momentN = h('b', { class: 'mn' }, '3'));
    mount(el, this.trayEl, this.sheetEl, this.cancelEl,
      h('div', { class: 'dock' }, this.handRow = h('div', { class: 'handrow' }, this.meterEl, ...this.cards, this.momentBtn, this.ultBtn = h('button', { class: 'ultbtn', title: 'Ult stance: Auto (heroes choose) → Hold → ALL-IN now [U]', onclick: () => this.cycleUlt() }, h('img', { src: icon('Death') }), h('span', { class: 'ul' }, 'Ults'), h('span', { class: 'ust' }, h('i'), h('i'), h('i')), h('b', {}, 'Auto'))),
        h('div', { class: 'callrow' }, this.callBtns)));
    // the cards are direct grid items of the hand row, one explicit track each (css .handrow): no nested
    // intrinsic sizing that WebKit could get wrong, so the cards can never slide under Moments
    this.handRow.style.setProperty('--cards', String(this.cards.length));
    this.tick();
  }

  // ───────────── per HUD tick (~8/s) ─────────────
  tick() {
    if (this.my < 0) return;
    const g = this.g, team = this.team, c = team.charges;
    this.pips.forEach((p, i) => { const f = Math.max(0, Math.min(1, c - i)); setCss(p.firstChild, 'height', Math.round(f * 50) * 2 + '%'); p.classList.toggle('full', f >= 1); });
    const mom = Math.min(1, team.momentum / MOMENTUM.max), surging = team.surgeUntil > g.tick, full = mom >= 1 && !surging;
    setCss(this.momFill, '--m', String(Math.round((surging ? Math.max(0, (team.surgeUntil - g.tick) / (MOMENTUM.surgeSec * TICK_RATE)) : mom) * 100) / 100));
    this.meterEl.classList.toggle('full', full); this.meterEl.classList.toggle('surging', surging);
    const nextIn = full ? 'SURGE!' : surging ? 'Surging' : c >= CMD.maxCharges ? '' : `+1 in ${Math.ceil((1 - (c % 1)) * CMD.regen)}s`;
    setText(this.chargeTxt, nextIn);
    for (const b of this.callBtns) {
      const off = !this.afford(CORE_COST[b._id]);
      if (b.classList.contains('off') !== off) { b.classList.toggle('off', off); b.setAttribute('aria-disabled', String(off)); }
      paintPips(b._pips, c);
      b.classList.toggle('on', this.sheetId === b._id);
      const rel = this.relevance(b._id);
      b.classList.toggle('hot', rel === 'hot'); b.classList.toggle('danger', rel === 'danger'); b.classList.toggle('dim', rel === 'dim');
    }
    for (const b of this.cards) { b.classList.toggle('used', b._d.used); b.setAttribute('aria-disabled', String(!!b._d.used)); b.classList.toggle('on', this.sheetId === 'card:' + b._d.id); }
    const left = MOMENT_IDS.filter((k) => !team.moments[k]).length, anyReady = MOMENT_IDS.some((k) => momentReady(g, this.my, k));
    if (this.momentN.textContent !== String(left)) this.momentN.textContent = String(left);
    this.momentBtn.classList.toggle('spent', !left); this.momentBtn.classList.toggle('ready', anyReady); this.momentBtn.classList.toggle('lock', !!left && !anyReady);
    const um = team.ultMode && team.ultMode.until > g.tick ? team.ultMode.mode : 'auto';
    if (this.ultBtn._m !== um) {
      this.ultBtn._m = um; this.ultBtn.className = 'ultbtn ' + um;
      [...this.ultBtn.querySelector('.ust').children].forEach((d, i) => d.classList.toggle('on', i === STANCES.indexOf(um)));
      this.ultBtn.title = STANCE_TIP[um];
    }
    // the stance shows its seconds left (ALL-IN 20s, Hold 45s), then falls back to Auto by itself
    setText(this.ultBtn.lastChild, um === 'auto' ? 'Auto' : `${um === 'go' ? 'ALL-IN' : 'Hold'} ${Math.max(0, Math.ceil((team.ultMode.until - g.tick) / TICK_RATE))}`);
    const active = this.alive().some((x) => (x.task && x.task.call) || x.pendingCall) || (team.focus && team.focus.until > g.tick);
    this.cancelEl.classList.toggle('hidden', !active);
    // the pill names what your team is doing on your call (tap: cancel it)
    if (active) setText(this.cancelPill, this.activeCallText());
    for (const f of this.live) f();
    this.tray.tick();
    if (this.ring && performance.now() > this.ring.until) this.closeRing();
  }
  // Context: 'hot' (gold, act now), 'danger' (red), 'dim' (not useful right now) or ''.
  relevance(id) {
    const g = this.g, me = this.my, now = g.tick, alive = this.alive();
    if (id === 'objective') {
      const ks = g.living ? ['dragon', 'herald', 'baron', 'boss', 'yokai'] : ['dragon', 'herald', 'baron'];
      if (ks.some((k) => g.objectives[k] && g.objectives[k].alive)) return 'hot';
      return ks.some((k) => g.objAvailable(k)) ? '' : 'dim';
    }
    if (id === 'shrine') return g.time < g.T.shrineUnlock || !g.shrines.some((s) => s.owner !== me) ? 'dim' : 'hot';
    if (id === 'gank') {
      const jg = alive.find((x) => x.role === 'jungle');
      if (!jg) return 'dim';
      return g.world.laneNames.some((l) => this.laneInfo(l).deep) ? 'hot' : '';
    }
    if (id === 'safe') {
      const hit = g.units.some((u) => u.structure && u.alive && u.team === me && u.lastHurt > now - TICK_RATE * 2 && g.grid.query(u.x, u.y, 500).some((e) => e.type === 'hero' && e.alive && e.team !== me));
      return hit ? 'danger' : '';
    }
    if (id === 'reset') {
      const avg = alive.reduce((a, x) => a + x.hp / x.maxHp, 0) / Math.max(1, alive.length);
      return alive.length >= 3 && avg < 0.45 && alive.every((x) => now - x.lastCombat > TICK_RATE * 3) ? 'hot' : avg > 0.8 ? 'dim' : '';
    }
    if (id === 'push') {
      const dead = g.teams[1 - me].heroes.filter((x) => !x.alive && x.respawnAt - now > TICK_RATE * 12).length;
      return dead >= 2 && alive.length >= 3 ? 'hot' : alive.length < 3 ? 'dim' : '';
    }
    return '';
  }
  // The call your heroes are on right now, in words ("Take Ember Kami", "Kaito: gank Bot", "Focus Mia").
  activeCallText() {
    const g = this.g, t = this.team, hud = this.hud;
    if (t.call && t.call.until > g.tick) return hud.callText({ ...t.call, team: this.my });
    if (t.focus && t.focus.until > g.tick && t.focus.target) return `Focus ${hud.name(t.focus.target)}`;
    const x = this.alive().find((y) => y.task && y.task.call);
    if (x) { const k = x.task.kind, L = LANE_L[x.task.lane] || ''; return k === 'gank' ? `${x.def.name}: gank ${L}`.trim() : k === 'split' ? `${x.def.name}: split ${L}`.trim() : k === 'invade' ? 'Invade' : k === 'shrine' ? 'Take shrine' : k === 'safe' || k === 'defend' ? 'Defend' : k === 'group' ? `Push ${L}`.trim() : k === 'objective' ? `Take ${OBJ_NAME[x.task.obj] || 'objective'}` : `${x.def.name}: on your call`; }
    return 'Cancel calls';
  }
  // Why a call can't be paid for right now (a tap on a greyed control says so instead of doing nothing).
  whyNot(type, label) {
    const n = this.cost(type);
    if (shortBy(this.team.charges, n) <= 0) return null;
    return `${label} needs ${n} ◆ · next ◆ in ${Math.ceil((1 - (this.team.charges % 1)) * CMD.regen)}s`;
  }
  surge() {
    const t = this.team;
    if (t.surgeUntil > this.g.tick) return;
    if (t.momentum < MOMENTUM.max) { toast(`Momentum ${Math.floor(t.momentum)}%: paid-off calls, kills and objectives fill it`); return; }
    this.send({ type: 'surge' });
  }

  // ───────────── sending ─────────────
  send(cmd) {
    if (this.my < 0) return false;
    if (!this.afford(cmd.type)) { toast(this.whyNot(cmd.type, this.hud.callText({ ...cmd, team: this.my })) || 'Not enough command charges', 1800); audio.sfx('cancel', 0.6); return false; }
    // co-op: a team call from the partner goes to the lead as a suggestion; another coach's hero is off limits
    const gate = this.hud.coopGate(cmd);
    if (gate === 'sug') { this.close(); this.closeRing(); audio.sfx('call', 0.5); return true; }
    if (!gate) return false;
    this.hud.runner.send(cmd);
    this.close(); this.closeRing();
    audio.sfx('call', 0.8);
    const p = this.hud.callPoint(cmd); this.hud.mm.ping(p[0], p[1], TEAM_COL[this.my]);
    return true;
  }
  press(id) {
    if (this.my < 0) return;
    const btn = this.callBtns.find((b) => b._id === id), why = this.whyNot(CORE_COST[id], CORE.find((c) => c.id === id).label);
    if (why) { toast(why, 1800); audio.sfx('cancel', 0.5); return; }
    audio.sfx('move', 0.5);
    if (btn) { btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent'); }
    if (id === 'safe' || id === 'reset') { this.send({ type: id }); return; }
    // one awake objective: one tap takes it (like a single open shrine); otherwise the sheet picks
    if (id === 'objective') {
      const g = this.g, up = ['dragon', 'herald', 'baron'].filter((k) => g.objectives[k] && g.objectives[k].alive && g.objAvailable(k));
      if (up.length === 1) { this.send({ type: 'objective', obj: up[0] }); return; }
    }
    if (id === 'shrine') {
      const open = this.g.shrines.filter((s) => s.owner !== this.my);
      if (this.g.time < this.g.T.shrineUnlock) { toast(`Shrines open at ${fmtTime(this.g.T.shrineUnlock)}`); return; }
      if (open.length === 1) { this.send({ type: 'shrine', shrine: open[0].id }); return; }
      if (!open.length) { toast('You already hold both shrines'); return; }
    }
    this.open(id);
  }
  // Ult stance (free): Auto → ALL-IN (the common one: one tap) → Hold → Auto. ALL-IN lasts 20s, Hold 45s.
  cycleUlt() {
    const t = this.team, cur = t.ultMode && t.ultMode.until > this.g.tick ? t.ultMode.mode : 'auto';
    const next = cur === 'auto' ? 'go' : cur === 'go' ? 'save' : 'free';
    if (this.send({ type: 'ult', mode: next }) && next !== 'go') toast({ save: 'Hold: heroes save ultimates (45s)', free: 'Auto: heroes choose when to ult' }[next], 1400); // (ALL-IN has its banner)
  }
  playCard(id) {
    const d = this.team.deck.find((x) => x.id === id); if (!d) return;
    if (d.used) { toast(`${TACTICS[id].name} is already played: each card once per match`, 1600); audio.sfx('cancel', 0.4); return; }
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
  // A big target tile. `img`, `sub` and `state` may be functions; they're refreshed in place.
  // cost: the command type it pays for (its charge pips, painted live).
  tile({ img, ico, title, sub, onclick, state, cls, cost }) {
    const subEl = h('small', {}, ''), imgOf = () => (typeof img === 'function' ? img() : img);
    const imEl = img ? h('img', { src: imgOf() }) : ico ? h('img', { src: icon(ico) }) : null;
    const pp = cost && this.cost(cost) ? pips(this.cost(cost)) : null;
    const b = h('button', { class: 'tile ' + (cls || ''), onclick: () => { if (!b.disabled) onclick(); } }, imEl, h('div', {}, h('b', {}, title), subEl), pp);
    const upd = () => {
      if (pp) paintPips(pp, this.team.charges);
      if (typeof img === 'function') { const src = imgOf(); if (imEl.getAttribute('src') !== src) imEl.setAttribute('src', src); }
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
    const LANES = g.world.laneNames;
    const lanes = (fn, sub, state, cost) => h('div', { class: 'tiles' }, ...LANES.map((l) => this.tile({ title: LANE_L[l], sub: () => sub(l), state: () => state ? state(l) : {}, onclick: () => fn(l), cost })));
    if (id === 'gank') {
      const jg = mine.find((x) => x.role === 'jungle' && this.hud.ownHero(x));
      const free = (x) => x && !busy(g, x) && this.hud.ownHero(x); // not dead, recalling or on another call
      if (!free(this.ganker)) this.ganker = free(jg) ? jg : this.ownAlive().find(free) || (jg && jg.alive ? jg : this.ownAlive()[0]);
      if (!this.ganker) { toast('None of your heroes can gank right now'); return null; }
      const who = h('button', { class: 'whobtn', title: 'Tap to change who ganks', onclick: () => { const a = this.ownAlive(); this.ganker = a[(a.indexOf(this.ganker) + 1) % a.length]; whoImg.src = face(this.ganker.heroId); whoName.textContent = this.ganker.def.name; } });
      const whoImg = h('img', { src: face(this.ganker.heroId) }), whoName = h('span', {}, this.ganker.def.name);
      who.append(whoImg, whoName, h('small', {}, 'change'));
      return { title: 'Gank which lane?', els: [h('div', { class: 'sh-who' }, h('span', { class: 'muted' }, 'Ganker'), who),
        lanes((l) => this.send({ type: 'gank', lane: l, hero: this.ganker.id }),
          (l) => { const i = this.laneInfo(l); return i.deep ? 'Overextended!' : i.n ? `${i.n} enemy seen` : 'No enemy seen'; },
          (l) => { const i = this.laneInfo(l); return { rec: i.deep, off: !this.afford('gank') }; }, 'gank')] };
    }
    if (id === 'objective') {
      const obj = (k) => this.tile({
        img: () => bossFace(k, kamiNow(g)),
        title: k === 'dragon' ? DRAGON_INFO[kamiNow(g)].name : OBJ_NAME[k],
        sub: () => this.objStatus(k),
        state: () => ({ off: !g.objAvailable(k) || !this.afford('objective'), rec: !!(g.objectives[k] && g.objectives[k].alive) }),
        onclick: () => this.send({ type: 'objective', obj: k }), cost: 'objective',
      });
      const list = ['dragon', 'herald', 'baron'].filter((k) => !(k === 'herald' && g.time > g.T.heraldDespawn) && !(k === 'baron' && g.time < g.T.heraldDespawn - 90 && !g.objectives.baron));
      // Living World: the Yokai Parade while it roams (or wakes soon), the Tengu from 10:00
      if (g.living) { if (g.objAvailable('yokai')) list.push('yokai'); if (g.objectives.boss || g.time >= LIVING.bossAt - 120) list.push('boss'); }
      return { title: 'Take which objective?', els: [h('div', { class: 'tiles' }, ...list.map(obj),
        !g.camps.length ? null : this.tile({ ico: 'Camouflage', title: 'Invade', sub: 'Steal a camp', state: () => ({ off: !this.afford('invade') }), onclick: () => this.send({ type: 'invade' }), cost: 'invade' }))] };
    }
    if (id === 'push') {
      const els = [lanes((l) => this.send({ type: 'group', lane: l }), (l) => { const i = this.laneInfo(l); return i.n ? `${i.n} enemy defending` : 'Whole team'; }, () => ({ off: !this.afford('group') }), 'group')];
      const splitter = this.splitter();
      if (splitter && LANES.length > 1) els.push(h('div', { class: 'sh-row' }, h('span', { class: 'muted' }, `Solo split (${splitter.def.name})`),
        ...['top', 'bot'].map((l) => h('button', { class: 'chip', onclick: () => this.send({ type: 'split', hero: splitter.id, lane: l }) }, LANE_L[l]))));
      if (this.team.heraldEye > g.tick) els.push(h('div', { class: 'sh-row oni' }, h('span', {}, 'Unleash the Oni'), ...LANES.map((l) => h('button', { class: 'chip gold', onclick: () => this.send({ type: 'herald', lane: l }) }, LANE_L[l]))));
      return { title: 'Push which lane?', els };
    }
    if (id === 'shrine') {
      return { title: 'Take which shrine?', els: [h('div', { class: 'tiles' }, ...g.shrines.map((s) => this.tile({ ico: 'OrbLight', title: s.id === this.my ? 'Home shrine' : 'Far shrine',
        sub: () => (s.owner === this.my ? 'Ours' : s.owner < 0 ? 'Neutral' : 'Theirs'), state: () => ({ off: s.owner === this.my || !this.afford('shrine') }), onclick: () => this.send({ type: 'shrine', shrine: s.id }), cost: 'shrine' })))] };
    }
    if (id === 'moments') {
      const team = this.team;
      return { title: 'Coach Moments · once per match', els: [h('div', { class: 'tiles' }, ...MOMENT_IDS.map((k) => {
        const m = momentAs(MOMENTS, team, k); // a coach skill tree variant shows its own name
        const b = this.tile({ ico: m.icon, title: m.name, cls: 'moment', sub: () => (team.moments[k] ? 'Used' : g.time < MOMENT.openAt * g.rules.k ? `Opens at ${fmtTime(MOMENT.openAt * g.rules.k)}` : team.momentCd > g.tick ? `Ready in ${Math.ceil((team.momentCd - g.tick) / TICK_RATE)}s` : m.short),
          state: () => ({ off: !momentReady(g, this.my, k), rec: momentReady(g, this.my, k) }), onclick: () => this.send({ type: 'moment', id: k }) });
        b.style.setProperty('--mc', m.color); b.title = m.desc;
        return b;
      }))] };
    }
    if (id.startsWith('card:')) {
      const cid = id.slice(5), t = TACTICS[cid];
      if (t.target === 'lane') return { title: `${t.name}: which lane?`, els: [lanes((l) => this.send({ type: 'tactic', card: cid, lane: l }), () => t.short)] };
      return { title: `${t.name}: which hero?`, els: [h('div', { class: 'tiles' }, ...mine.map((x) => this.tile({ img: face(x.heroId), title: x.def.name, sub: () => (x.alive ? `${Math.round(x.hp / x.maxHp * 100)}% HP` : 'Dead'), state: () => ({ off: !x.alive }), onclick: () => this.send({ type: 'tactic', card: cid, hero: x.id }) })))] };
    }
    if (id.startsWith('hero:')) {
      const x = g.byId(+id.slice(5)); if (!x) return null;
      if (x.team !== this.my) return { title: `${x.def.name}`, els: [h('div', { class: 'tiles' }, this.tile({ img: face(x.heroId), title: `Focus ${x.def.name}`, sub: 'Everyone targets them 20s', state: () => ({ off: !x.alive || !this.afford('focus') }), onclick: () => this.send({ type: 'focus', target: x.id }), cost: 'focus' }))] };
      const theirs = !this.hud.ownHero(x), owner = theirs ? this.hud.coachName(x.seat) : '';
      return { title: `${x.def.name}: ${this.hud.depth && x.tal ? 'build & talents' : 'build path'}${theirs ? ` (${owner}'s hero)` : ''}`, els: [h('div', { class: 'tiles' }, ...x.def.builds.map((b) => { const t = this.tile({ ico: BUILDS[b].icon || 'Alchemy', title: BUILDS[b].name, sub: () => (x.build === b ? 'Current' : theirs ? `${owner} decides` : 'Free'), state: () => ({ off: x.build === b || theirs }), onclick: () => this.send({ type: 'build', hero: x.id, build: b }) }); t.setAttribute('data-build', b); t.title = BUILDS[b].desc; return t; })),
        ...(this.hud.depth && x.tal ? this.hud.depth.sheetRows(x, theirs) : [])] }; // v23: next item + talents
    }
    return null;
  }
  objStatus(k) {
    const g = this.g, o = g.objectives[k], t = g.objTimers[k];
    if (o && o.alive) return o.hp < o.maxHp * 0.98 ? `Under attack ${Math.round(o.hp / o.maxHp * 100)}%` : 'Awake now';
    if (k === 'herald' && g.time > g.T.heraldDespawn) return 'Gone';
    if (!t) return '—';
    const left = Math.max(0, (t - g.tick) / TICK_RATE);
    return left <= 25 ? `Wakes in ${Math.ceil(left)}s` : `Wakes ${fmtTime(left)}`;
  }
  splitter() {
    const a = this.ownAlive();
    return a.find((x) => x.role === 'top') || a.filter((x) => x.role !== 'support').sort((p, q) => q.level - p.level)[0] || null;
  }

  // ───────────── decision tray items ─────────────
  costPips(n) { return pips(n); }
  // A choice button: label (+ small sub line) and the call's cost pips. Options with a live state (Coach's
  // Calls) refresh in place: 'go' tappable, 'soon' greyed with a "ready in Ns" countdown, 'no' hidden.
  choice(o, item, after) {
    const n = o.cmd ? this.cost(o.cmd.type) : 0, sub = o.sub ? h('small', {}, o.sub) : o.state ? h('small', {}, '') : null;
    const b = h('button', { class: 'tch' + (o.cmd ? '' : ' no'), onclick: () => { if (b.disabled || (o.cmd && !this.send(o.cmd))) return; after && after(o); this.tray.end(item, 'chosen'); } },
      h('span', { class: 'tl' }, o.label), sub, n ? this.costPips(n) : null);
    const pp = n ? b.lastChild : null;
    b._upd = () => {
      if (pp) paintPips(pp, this.team.charges);
      const st = o.state ? o.state() : o.cmd && !canIssue(this.g, this.my, o.cmd) ? 'no' : 'go';
      setOff(b, st !== 'go'); b.classList.toggle('hidden', st === 'no' && !!o.state);
      if (sub && o.state) { const t = st === 'soon' ? `ready in ${Math.ceil(readyIn(this.g, this.my, o.cmd))}s` : o.sub || ''; if (sub.textContent !== t) sub.textContent = t; }
    };
    b._upd();
    return b;
  }
  // One-tap analyst suggestion (lowest priority). Only when the tap would work (affordable, accepted, and
  // the caller's own physical check); it leaves the tray the moment that stops being true.
  suggest(key, text, label, cmd, opts = {}) {
    if (this.my < 0 || this.tray.has(key) || !this.hud.mayCommand(cmd)) return; // co-op: only what this coach can call
    const valid = () => canIssue(this.g, this.my, cmd) && (!opts.valid || opts.valid());
    if (!valid()) return;
    this.tray.push({ key, prio: opts.cls === 'bad' ? PRIO.danger : PRIO.sug, ttl: 12000, cls: 'sug ' + (opts.cls === 'bad' ? 'danger' : 'act'), valid, topic: opts.topic,
      build: (it) => [h('span', { class: 'tx' }, text), this.choice({ label, cmd }, it), h('button', { class: 'tx-x', title: 'Dismiss', onclick: () => this.tray.end(it, 'dismissed') }, 'x')],
      onShow: () => audio.sfx('alert', 0.35) });
  }
  // Coach's Call: a decision card with 2-3 concrete options, each kept honest live (see moments.js finish).
  coachCall(m, hooks = {}) {
    return this.tray.push({ key: m.key, prio: PRIO.call, ttl: hooks.ttl || 8000, cls: 'ccall ' + (m.danger ? 'danger' : 'act'), valid: m.valid, topic: m.topic, at: m.at,
      build: (it) => { const tt = h('span', {}, m.title), btns = m.opts.map((o) => this.choice(o, it, hooks.onPick));
        it.upd = () => { if (m.liveTitle) { const v = m.liveTitle(); if (tt.textContent !== v) tt.textContent = v; } for (const b of btns) b._upd(); };
        return [h('div', { class: 'tc-head' }, h('b', {}, "COACH'S CALL"), tt), h('div', { class: 'tc-text' }, m.text), h('div', { class: 'tc-opts' }, ...btns)]; },
      onShow: hooks.onShow, onEnd: hooks.onEnd });
  }
  // A hero asks for the green light: Yes sends the request's command, No costs nothing.
  request(r, hooks = {}) {
    return this.tray.push({ key: r.key, prio: PRIO.request, ttl: 9000, cls: 'req mine', valid: r.valid, topic: r.target ? 'pick:' + r.target.id : undefined,
      build: (it) => [h('img', { class: 'tface', src: face(r.hero.heroId) }), h('span', { class: 'tx' }, h('b', {}, r.hero.def.name + ': '), r.text),
        this.choice({ label: 'Yes', cmd: r.cmd }, it, hooks.onYes), this.choice({ label: 'No', cmd: null }, it, hooks.onNo)],
      onShow: () => audio.sfx('alert2', 0.45), onEnd: hooks.onEnd });
  }
  // Co-op: the partner suggested a team call; the lead makes it with one tap (No just dismisses it).
  partnerSuggestion(name, seat, cmd, text) {
    this.tray.push({ key: 'psug' + performance.now(), prio: PRIO.request, ttl: 9000, cls: 'req mate',
      build: (it) => [h('i', { class: 'sl', style: { '--sc': COOP_COL[seat] } }, seat ? 'B' : 'A'), h('span', { class: 'tx' }, h('b', {}, name + ': '), text),
        this.choice({ label: 'Go', cmd }, it), this.choice({ label: 'No', cmd: null }, it)],
      onShow: () => audio.sfx('alert2', 0.45) });
  }
  surgeOffer() {
    const t = this.team;
    this.tray.push({ key: 'surge' + this.g.tick, prio: PRIO.surge, ttl: 14000, cls: 'act surgeoffer', valid: () => t.momentum >= MOMENTUM.max && !(t.surgeUntil > this.g.tick),
      build: (it) => [h('span', { class: 'tx' }, h('b', {}, 'Momentum full! '), `Kami Surge: +${Math.round(MOMENTUM.dmg * 100)}% damage, +${Math.round(MOMENTUM.ms * 100)}% speed, ${MOMENTUM.surgeSec}s`),
        this.choice({ label: 'SURGE', cmd: { type: 'surge' } }, it), h('button', { class: 'tx-x', title: 'Later (tap the meter any time)', onclick: () => this.tray.end(it, 'dismissed') }, 'x')],
      onShow: () => audio.sfx('powerup', 0.5) });
  }
  // A call resolved: a crisp payoff line (no buttons). Falls back to the ticker if it never gets the slot.
  payoff(p, onStale) {
    this.tray.push({ prio: PRIO.payoff, ttl: 3200, staleMs: 4500, cls: 'payoff ' + (p.ok ? 'win' : 'danger'),
      build: () => [p.img ? h('img', { class: 'tface', src: p.img }) : null, h('b', { class: 'pbig' }, p.head), h('span', { class: 'tx' }, p.text)],
      onShow: () => audio.sfx(p.ok ? 'coin' : 'cancel', 0.6), onEnd: (why) => { if (why === 'stale' && onStale) onStale(p); } });
  }

  // ───────────── map ring ─────────────
  ringAt(w, sx, sy) {
    if (this.my < 0) return false;
    const g = this.g, W = g.world, me = this.my, r = this.hud.r;
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const opts = []; let title = '';
    const foe = g.teams[1 - me].heroes.find((x) => x.alive && r.visible(x) && d2(x, { x: w.x, y: w.y + 14 }) < (44 / r.cam.zoom) ** 2);
    if (foe) { title = foe.def.name; opts.push({ ico: 'Death', label: 'Focus', type: 'focus', cmd: { type: 'focus', target: foe.id } }); }
    else {
      for (const [k, pit] of [['dragon', W.pits.kami], ['baron', W.pits.kraken]]) {
        if (d2(pit, w) > 260 * 260) continue;
        const kk = k === 'baron' && g.time < g.T.heraldDespawn ? 'herald' : k;
        title = OBJ_NAME[kk];
        opts.push({ ico: 'OrbFire', label: 'Take it', type: 'objective', cmd: { type: 'objective', obj: kk }, off: !g.objAvailable(kk), sub: this.objStatus(kk) });
      }
      if (g.living) for (const k of ['boss', 'yokai']) {
        const o = g.objectives[k], at = o && o.alive ? o : k === 'boss' && g.time >= LIVING.bossAt - 120 ? g.objPit(k) : null;
        if (!at || d2(at, w) > 220 * 220 || (k === 'yokai' && !r.visible(o))) continue;
        title = OBJ_NAME[k];
        opts.push({ ico: 'OrbFire', label: 'Take it', type: 'objective', cmd: { type: 'objective', obj: k }, off: !g.objAvailable(k), sub: this.objStatus(k) });
      }
      for (const s of g.shrines) if (d2(s, w) < 220 * 220) { title = 'Shrine'; opts.push({ ico: 'OrbLight', label: 'Capture', type: 'shrine', cmd: { type: 'shrine', shrine: s.id }, off: s.owner === me || g.time < g.T.shrineUnlock, sub: s.owner === me ? 'Ours' : g.time < g.T.shrineUnlock ? `Opens ${fmtTime(g.T.shrineUnlock)}` : null }); }
      if (!opts.length) {
        const lane = W.closestLane(w);
        if (W.distToLane(lane, w) < 320) {
          title = `${LANE_L[lane]} lane`;
          // the ganker who gets there first (jungler preferred), never one dead, recalling or on another call
          const gk = bestGanker(g, me, W.laneSnap(lane, w), lane, Infinity, (x) => this.hud.ownHero(x));
          if (gk) opts.push({ ico: 'Cut', label: 'Gank', type: 'gank', cmd: { type: 'gank', lane, hero: gk.hero.id }, sub: `${gk.hero.def.name} ${Math.max(1, Math.round(gk.t))}s` });
          opts.push({ ico: 'Upgrade', label: 'Push', type: 'group', cmd: { type: 'group', lane } });
          const sp = this.splitter(); if (sp && lane !== 'mid' && W.laneNames.length > 1) opts.push({ ico: 'BookWind', label: 'Split', type: 'split', cmd: { type: 'split', hero: sp.id, lane } });
          if (this.team.heraldEye > g.tick) opts.push({ ico: 'Counter', label: 'Oni', type: 'herald', cmd: { type: 'herald', lane } });
        } else {
          const camp = g.camps.filter((c) => c.side !== me && c.mobs.length).sort((a, b) => d2(a, w) - d2(b, w))[0];
          if (camp && d2(camp, w) < 500 * 500) { title = camp.night ? 'Moon Spirits' : 'Enemy jungle'; opts.push({ ico: 'Camouflage', label: 'Invade', type: 'invade', cmd: camp.night ? { type: 'invade', camp: camp.key } : { type: 'invade' } }); }
        }
      }
    }
    if (!opts.length) { this.closeRing(); return false; }
    const R = opts.length === 1 ? 0 : 58;
    const items = opts.map((o, i) => {
      const a = -Math.PI / 2 + (i - (opts.length - 1) / 2) * (Math.PI * 2 / Math.max(3, opts.length + 1));
      const off = o.off || !this.afford(o.type);
      return h('button', { class: 'ropt', disabled: off, style: { left: `${Math.cos(a) * R}px`, top: `${Math.sin(a) * R}px` }, onclick: (e) => { e.stopPropagation(); this.send(o.cmd); } },
        h('img', { src: icon(o.ico) }), h('span', {}, o.label), paintPips(pips(this.cost(o.type)), this.team.charges), o.sub ? h('small', {}, o.sub) : null);
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
    if (k === 'u') { this.cycleUlt(); return true; }
    if (k === 'v') { this.surge(); return true; }
    if (k === 'm') { this.open('moments'); return true; }
    return false;
  }
}
