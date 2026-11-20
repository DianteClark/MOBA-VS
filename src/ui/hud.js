// In-match HUD: scoreboard, team cards, command bar (calls), analyst feed, controls.
import { h, mount, face, icon, fmtTime, toast } from './dom.js';
import { BUILDS } from '../data/items.js';
import { ROLE_LABEL } from '../data/heroes.js';
import { CMD, DRAGON_INFO, TEAM_NAME, TICK_RATE, T } from '../sim/constants.js';
const LANE_NAMES = ['top', 'mid', 'bot'];
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const OBJ_L = { dragon: 'Dragon', herald: 'Herald', baron: 'Baron' };
const CALLS = [
  { type: 'gank', label: 'Gank', icon: 'Cut', key: 'g' },
  { type: 'objective', label: 'Objective', icon: 'OrbFire', key: 'o' },
  { type: 'group', label: 'Group', icon: 'Upgrade', key: 'r' },
  { type: 'split', label: 'Split', icon: 'BookWind', key: 'p' },
  { type: 'focus', label: 'Focus', icon: 'Death', key: 'f' },
  { type: 'safe', label: 'Play safe', icon: 'DefenseUpgrade', key: 'x' },
  { type: 'reset', label: 'Reset', icon: 'Heal', key: 'b' },
  { type: 'invade', label: 'Invade', icon: 'Camouflage', key: 'i' },
  { type: 'herald', label: 'Herald', icon: 'Counter', key: 'h' },
  { type: 'build', label: 'Build', icon: 'Alchemy', key: 'u' },
  { type: 'cancel', label: 'Cancel', icon: 'Downgrade', key: 'c' },
];

export class Hud {
  constructor(app, game, runner, renderer, minimap, myTeam, mode) {
    this.app = app; this.g = game; this.runner = runner; this.r = renderer; this.mm = minimap;
    this.my = myTeam; this.view = myTeam < 0 ? 0 : myTeam; this.mode = mode;
    this.evIdx = 0; this.picker = null; this.sel = null; this.director = false;
    this.lastDom = 0; this.lastAnalyst = 0; this.cool = {}; this.missing = {}; this.feedItems = [];
    this.firstBlood = false;
    this.el = { score: byId('scorebar'), obj: byId('objtimers'), mine: byId('myteam'), enemy: byId('enemyteam'), feed: byId('feed'), banner: byId('banner'), ctrl: byId('ctrl'), cmd: byId('cmdbar') };
    this.build();
  }

  build() {
    const g = this.g;
    // team cards
    const card = (hero, mine) => {
      const row = h('div', { class: 'hrow', onclick: () => this.selectHero(hero) },
        h('div', { class: 'pf' }, h('img', { src: face(hero.heroId) }), h('div', { class: 'lv' }, '1'), h('div', { class: 'dead hidden' }, '')),
        h('div', { class: 'info2' },
          h('div', { class: 'nm' }, h('span', { style: { color: TEAM_COL[hero.team] } }, hero.def.name), h('span', { class: 'kda' }, '0/0/0')),
          h('div', { class: 'bar' }, h('i', { style: { background: TEAM_COL[hero.team] } })),
          h('div', { class: 'st' }, ''),
          h('div', { class: 'its' })),
        h('div', { class: 'hpmini' }, h('i', { style: { background: TEAM_COL[hero.team] } })),
        mine ? h('div', { class: 'cds' }, h('i'), h('i'), h('i')) : h('div', { class: 'mia hidden' }, 'MIA'));
      row._hero = hero; return row;
    };
    const mineTeam = this.view, enemyTeam = 1 - this.view;
    this.mineRows = g.teams[mineTeam].heroes.map((x) => card(x, true));
    this.enemyRows = g.teams[enemyTeam].heroes.map((x) => card(x, false));
    mount(this.el.mine, this.mineRows);
    mount(this.el.enemy, this.enemyRows);
    // controls
    const ctrl = [];
    if (!this.runner.online) {
      ctrl.push(h('div', { class: 'row', style: { gap: '2px' } }, ...[['II', 0], ['1x', 1], ['2x', 2], ['4x', 4]].map(([l, s]) => {
        const b = h('button', { class: 'btn small spd', onclick: () => { if (s === 0) this.runner.paused = !this.runner.paused; else { this.runner.speed = s; this.runner.paused = false; } this.refreshCtrl(); } }, l); b._s = s; return b;
      })));
    }
    ctrl.push(h('div', { class: 'row', style: { gap: '2px' } },
      this.dirBtn = h('button', { class: 'btn small', onclick: () => this.toggleDirector() }, 'Director'),
      this.my < 0 ? (this.fogBtn = h('button', { class: 'btn small', onclick: () => { this.r.fogOn = !this.r.fogOn; this.refreshCtrl(); } }, 'Fog')) : null,
      h('button', { class: 'btn small', onclick: () => { this.el.enemy.classList.toggle('show'); } }, 'Foes'),
      this.muteBtn = h('button', { class: 'btn small', onclick: () => { audio.toggle(); this.refreshCtrl(); } }, 'Snd'),
      h('button', { class: 'btn small', onclick: () => this.app.quitMatch() }, 'Quit')));
    mount(this.el.ctrl, ctrl);
    this.refreshCtrl();
    this.renderCmd();
  }
  refreshCtrl() {
    for (const b of this.el.ctrl.querySelectorAll('.spd')) b.classList.toggle('on', b._s === 0 ? this.runner.paused : (!this.runner.paused && this.runner.speed === b._s));
    this.dirBtn.classList.toggle('on', this.director);
    if (this.fogBtn) this.fogBtn.classList.toggle('on', this.r.fogOn);
    this.muteBtn.classList.toggle('on', audio.muted); this.muteBtn.textContent = audio.muted ? 'Muted' : 'Snd';
  }
  toggleDirector() { this.director = !this.director; if (this.director) this.r.follow = null; this.refreshCtrl(); }
  selectHero(hero) {
    if (this.r.follow === hero.id) { this.r.follow = null; this.sel = null; }
    else { this.r.follow = hero.id; this.sel = hero.team === this.my ? hero : this.sel; if (!hero.alive) { this.r.cam.x = hero.x; this.r.cam.y = hero.y; } }
    this.director = false; this.refreshCtrl();
  }

  // ── commands ──
  canAfford(type) { return this.my >= 0 && this.g.teams[this.my].charges + 1e-9 >= (CMD.cost[type] ?? 1); }
  send(cmd) {
    if (this.my < 0) return;
    if (!this.canAfford(cmd.type)) { toast('Not enough command charges'); return; }
    this.runner.send(cmd);
    this.picker = null; this.renderCmd();
    audio.sfx('call', 0.8);
    const where = cmd.lane ? LANE_L[cmd.lane] : cmd.obj ? OBJ_L[cmd.obj] : '';
    this.mm.ping(...this.callPoint(cmd), TEAM_COL[this.my]);
    void where;
  }
  callPoint(c) {
    if (c.obj) { const p = c.obj === 'dragon' ? this.g.world.pits.kami : this.g.world.pits.kraken; return [p.x, p.y]; }
    if (c.lane) { const p = c.lane === 'top' ? { x: 300, y: 300 } : c.lane === 'bot' ? { x: 2100, y: 2100 } : { x: 1200, y: 1200 }; return [p.x, p.y]; }
    return [this.r.cam.x, this.r.cam.y];
  }
  openPicker(type) {
    if (this.my < 0) return;
    if (type === 'safe' || type === 'reset' || type === 'invade' || type === 'cancel') { this.send({ type }); return; }
    this.picker = this.picker && this.picker.type === type ? null : { type, hero: null };
    this.renderCmd();
  }
  renderCmd() {
    const g = this.g;
    if (this.my < 0) { mount(this.el.cmd, h('div', { class: 'cmdrow', style: { fontSize: '11px' } }, 'Spectating — drag to look around, tap portraits to follow.')); return; }
    const team = g.teams[this.my];
    const pips = h('div', { class: 'pips' }, ...Array.from({ length: CMD.maxCharges }, () => h('div', { class: 'pip' }, h('i'))));
    this.pips = pips;
    const btns = CALLS.filter((c) => c.type !== 'herald' || team.heraldEye > g.tick).map((c) => {
      const cost = CMD.cost[c.type];
      const b = h('button', { class: 'btn cbtn' + (this.picker && this.picker.type === c.type ? ' on' : ''), onclick: () => this.openPicker(c.type), title: `${c.label} (${cost}) [${c.key.toUpperCase()}]` },
        h('img', { src: icon(c.icon) }), h('span', {}, c.label), h('span', { class: 'c' }, cost ? `${cost} charge${cost > 1 ? 's' : ''}` : 'free'));
      b._type = c.type; return b;
    });
    this.cmdBtns = btns;
    const row = h('div', { class: 'cmdrow' }, h('div', { class: 'meter' }, pips, h('span', {}, 'CALLS')), ...btns);
    mount(this.el.cmd, this.picker ? this.pickerEl() : null, row);
    this.updatePips();
  }
  heroPick(list, onPick, selId, disabled) {
    return h('div', { class: 'opts' }, ...list.map((x) => h('div', { class: 'pf-btn' + (selId === x.id ? ' sel' : '') + (disabled && disabled(x) ? ' dis' : ''), onclick: () => { if (!(disabled && disabled(x))) onPick(x); } },
      h('img', { src: face(x.heroId) }), x.def.name)));
  }
  pickerEl() {
    const g = this.g, p = this.picker, mine = g.teams[this.my].heroes, enemy = g.teams[1 - this.my].heroes;
    const laneBtns = (fn) => h('div', { class: 'opts' }, ...LANE_NAMES.map((l) => h('button', { class: 'btn', onclick: () => fn(l) }, LANE_L[l])));
    const box = (q, ...kids) => h('div', { class: 'picker' }, h('div', { class: 'q' }, q), ...kids);
    switch (p.type) {
      case 'gank': {
        const jg = mine.find((x) => x.role === 'jungle');
        const who = p.hero || (jg && jg.alive ? jg : mine.find((x) => x.alive));
        return box('Who ganks, and which lane?', this.heroPick(mine, (x) => { p.hero = x; this.renderCmd(); }, who && who.id, (x) => !x.alive), laneBtns((l) => this.send({ type: 'gank', lane: l, hero: who && who.id })));
      }
      case 'objective': {
        const opt = (k) => {
          const o = g.objectives[k]; const tmr = g.objTimers[k];
          let st = o && o.alive ? 'UP' : tmr ? fmtTime(Math.max(0, (tmr - g.tick) / TICK_RATE)) : '—';
          if (k === 'herald' && g.time > T.heraldDespawn) st = 'gone';
          if (k === 'baron' && !o && g.time < T.baronFirst) st = fmtTime(T.baronFirst - g.time);
          const name = k === 'dragon' && o ? DRAGON_INFO[o.element].name + ' Drake' : OBJ_L[k];
          return h('button', { class: 'btn', disabled: st === 'gone' || st === '—', onclick: () => this.send({ type: 'objective', obj: k }) }, `${name} · ${st}`);
        };
        return box('Take which objective? (team groups up — 2 charges)', h('div', { class: 'opts' }, opt('dragon'), opt('herald'), opt('baron')));
      }
      case 'group': return box('Group up and push which lane?', laneBtns((l) => this.send({ type: 'group', lane: l })));
      case 'herald': return box('Drop the Herald in which lane?', laneBtns((l) => this.send({ type: 'herald', lane: l })));
      case 'split': {
        if (!p.hero) return box('Who split-pushes?', this.heroPick(mine, (x) => { p.hero = x; this.renderCmd(); }, null, (x) => !x.alive));
        return box(`${p.hero.def.name} splits which lane?`, laneBtns((l) => this.send({ type: 'split', hero: p.hero.id, lane: l })));
      }
      case 'focus': return box('Focus which enemy? (20s)', this.heroPick(enemy, (x) => this.send({ type: 'focus', target: x.id }), null, (x) => !x.alive));
      case 'build': {
        if (!p.hero) return box('Change whose build path?', this.heroPick(mine, (x) => { p.hero = x; this.renderCmd(); }));
        const x = p.hero;
        return box(`${x.def.name}: future items follow…`, h('div', { class: 'opts' }, ...x.def.builds.map((b) => h('button', { class: 'btn' + (x.build === b ? ' on' : ''), disabled: x.build === b, onclick: () => this.send({ type: 'build', hero: x.id, build: b }) }, BUILDS[b].name))));
      }
    }
    return null;
  }
  updatePips() {
    if (!this.pips || this.my < 0) return;
    const c = this.g.teams[this.my].charges;
    [...this.pips.children].forEach((p, i) => { p.firstChild.style.height = Math.max(0, Math.min(1, c - i)) * 100 + '%'; });
    if (this.cmdBtns) for (const b of this.cmdBtns) b.disabled = !this.canAfford(b._type);
  }

  // ── per-frame ──
  update(dt) {
    const g = this.g, now = performance.now();
    this.processEvents();
    this.updatePips();
    if (this.director) this.directorCam(dt);
    if (now - this.lastDom < 120) return;
    this.lastDom = now;
    // herald button appears/disappears
    if (this.my >= 0) { const has = g.teams[this.my].heraldEye > g.tick; if (has !== this._hasEye) { this._hasEye = has; this.renderCmd(); } }
    if (this.picker && this.picker.type === 'objective' && (g.tick % 20 === 0)) this.renderCmd();
    this.updateScore();
    this.updateRows(this.mineRows, true);
    this.updateRows(this.enemyRows, false);
    if (now - this.lastAnalyst > 1000) { this.lastAnalyst = now; this.analyst(); }
    // fade feed
    this.feedItems = this.feedItems.filter((f) => { if (now - f.t > (f.sticky ? 12000 : 7000)) { f.el.remove(); return false; } return true; });
  }

  updateScore() {
    const g = this.g, t0 = g.teams[0], t1 = g.teams[1];
    const gold = (t) => Math.round(t.heroes.reduce((a, x) => a + x.goldEarned, 0) / 100) / 10;
    const pips = (t) => h('span', { class: 'drag-pips' }, ...t.dragons.map((d) => h('i', { style: { background: DRAGON_INFO[d].color } })));
    mount(this.el.score,
      h('div', { class: 'col', style: { gap: '0', alignItems: 'flex-end' } }, h('div', { class: 'meta' }, pips(t0), h('span', {}, `${t0.towers}T`), h('span', { class: 'gold' }, gold(t0) + 'k'))),
      h('div', { class: 'k blue' }, t0.kills),
      h('div', { class: 'clock' }, fmtTime(g.time)),
      h('div', { class: 'k red' }, t1.kills),
      h('div', { class: 'col', style: { gap: '0' } }, h('div', { class: 'meta' }, h('span', { class: 'gold' }, gold(t1) + 'k'), h('span', {}, `${t1.towers}T`), pips(t1))));
    const ot = (k) => {
      const o = g.objectives[k]; const tmr = g.objTimers[k];
      if (k === 'herald' && (g.time > T.heraldDespawn || (g.objectives.baron))) return null;
      if (k === 'baron' && g.time < T.heraldDespawn - 60 && !o) return null;
      const up = o && o.alive;
      const label = k === 'dragon' ? (up ? DRAGON_INFO[o.element].name : DRAGON_INFO[g.nextDragon] ? DRAGON_INFO[this.g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon].name : 'Dragon') : OBJ_L[k];
      const st = up ? 'UP' : tmr ? fmtTime(Math.max(0, (tmr - g.tick) / TICK_RATE)) : '—';
      return h('div', { class: 'ot' + (up ? ' up' : '') }, h('img', { src: `assets/img/${k === 'dragon' ? 'boss/dragon_green_faceset' : k === 'baron' ? 'boss/baron_faceset' : 'boss/herald_faceset'}.png` }), `${label} ${st}`);
    };
    mount(this.el.obj, ot('dragon'), ot('herald'), ot('baron'));
  }

  taskLabel(x) {
    const g = this.g, t = x.task;
    if (!x.alive) return `Respawn ${Math.ceil((x.respawnAt - g.tick) / TICK_RATE)}s`;
    if (x.recallAt) return 'Recalling…';
    if (g.tick - x.lastHitHero < TICK_RATE * 1.5) return 'Fighting!';
    const L = (l) => LANE_L[l] || '';
    switch (t.kind) {
      case 'lane': return `Laning ${L(t.lane)}`;
      case 'jungle': return 'Clearing jungle';
      case 'gank': return `Ganking ${L(t.lane)}`;
      case 'objective': return `${OBJ_L[t.obj]}${t.call ? ' (call)' : ''}`;
      case 'contest': return `Contesting ${OBJ_L[t.obj]}`;
      case 'recall': return 'Heading home';
      case 'heal': return 'At base';
      case 'group': return `Grouping ${L(t.lane)}`;
      case 'split': return `Split-pushing ${L(t.lane)}`;
      case 'safe': return 'Playing safe';
      case 'invade': return 'Invading';
      case 'defend': return 'Defending base';
      default: return '—';
    }
  }
  updateRows(rows, mine) {
    const g = this.g;
    for (const row of rows) {
      const x = row._hero;
      const vis = mine || this.my < 0 || !this.r.fogOn || g.vision[this.view].has(x.id);
      row.classList.toggle('sel', this.r.follow === x.id);
      const pf = row.firstChild;
      pf.children[1].textContent = x.level;
      const dead = pf.children[2];
      if (!x.alive) { dead.classList.remove('hidden'); dead.textContent = Math.ceil((x.respawnAt - g.tick) / TICK_RATE); } else dead.classList.add('hidden');
      const info = row.children[1];
      info.children[0].children[1].textContent = `${x.kills}/${x.deaths}/${x.assists}`;
      const pct = x.alive ? (vis ? x.hp / x.maxHp : null) : 0;
      info.children[1].firstChild.style.width = (pct === null ? 0 : pct * 100) + '%';
      row.children[2].firstChild.style.width = (pct === null ? 0 : pct * 100) + '%';
      info.children[2].textContent = mine || this.my < 0 ? this.taskLabel(x) : (vis ? (x.alive ? 'Visible' : this.taskLabel(x)) : this.missingText(x));
      const its = info.children[3];
      if (its.childElementCount !== x.items.length) mount(its, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
      if (mine && row.children[3]) {
        const cds = row.children[3].children;
        for (let i = 0; i < 3; i++) { const ready = g.abilityReady(x, i); cds[i].className = ready ? (i === 2 ? 'u' : 'r') : ''; }
      } else if (!mine && row.children[3]) {
        row.classList.toggle('mia', !vis && x.alive);
        row.children[3].classList.toggle('hidden', vis || !x.alive);
      }
    }
  }
  missingText(x) {
    const ls = this.g.lastSeen[this.view][x.id];
    if (!ls) return 'Unseen';
    return `Seen ${Math.floor((this.g.tick - ls.t) / TICK_RATE)}s ago`;
  }

  // ── events → feed / banners / audio ──
  name(id) { const u = this.g.byId(id); return u && u.def ? u.def.name : '?'; }
  processEvents() {
    const g = this.g, ev = g.events;
    for (; this.evIdx < ev.length; this.evIdx++) {
      const e = ev[this.evIdx];
      const ours = e.team === this.view;
      switch (e.type) {
        case 'kill': {
          const v = g.byId(e.victim);
          const kt = 1 - v.team;
          this.feed(`${e.killer ? this.name(e.killer) : 'Executed'} ${e.shutdown ? 'shut down' : 'killed'} ${v.def.name}`, kt === 0 ? 'b' : 'r');
          if (!this.firstBlood) { this.firstBlood = true; this.banner('FIRST BLOOD', TEAM_COL[kt]); }
          if (g.teams[v.team].heroes.every((x) => !x.alive)) this.banner('ACE!', TEAM_COL[kt]);
          audio.sfx(kt === this.view || this.my < 0 ? 'impact' : 'death', 0.8);
          break;
        }
        case 'objective': {
          const nm = e.obj === 'dragon' ? `${DRAGON_INFO[e.element].name} Drake` : OBJ_L[e.obj];
          this.feed(`${TEAM_NAME[e.team]} ${e.steal ? 'STOLE' : 'took'} ${nm}${e.killer ? ' (' + this.name(e.killer) + ')' : ''}`, e.team === 0 ? 'b' : 'r', true);
          this.banner(`${e.steal ? 'STOLEN! ' : ''}${nm.toUpperCase()}`, TEAM_COL[e.team]);
          audio.sfx('objective');
          break;
        }
        case 'soul': this.banner(`${TEAM_NAME[e.team].toUpperCase()} ${DRAGON_INFO[e.element].name.toUpperCase()} SOUL`, TEAM_COL[e.team]); break;
        case 'tower': this.feed(`${TEAM_NAME[e.team]} destroyed a ${LANE_L[e.lane] || 'base'} tower`, e.team === 0 ? 'b' : 'r'); audio.sfx('explosion', 0.7); break;
        case 'inhib': this.feed(`${TEAM_NAME[e.team]} destroyed the ${LANE_L[e.lane]} inhibitor!`, e.team === 0 ? 'b' : 'r', true); this.banner('INHIBITOR DESTROYED', TEAM_COL[e.team]); audio.sfx('explosion'); break;
        case 'inhibRespawn': this.feed(`${TEAM_NAME[e.team]} ${LANE_L[e.lane]} inhibitor respawned`, 'n'); break;
        case 'spawn': this.feed(`${e.obj === 'dragon' ? DRAGON_INFO[e.element].name + ' Drake' : OBJ_L[e.obj]} has spawned`, 'n'); audio.sfx('alert', 0.5); break;
        case 'heraldDrop': this.feed(`${TEAM_NAME[e.team]} unleashed the Herald ${LANE_L[e.lane]}!`, e.team === 0 ? 'b' : 'r'); audio.sfx('explosion'); break;
        case 'call': {
          const c = e.call;
          if (c.team !== this.view && this.my >= 0) break; // enemy calls are secret
          const what = c.type === 'gank' ? `${c.hero ? this.name(c.hero) : 'Jungler'} gank ${LANE_L[c.lane]}` : c.type === 'objective' ? `Take ${OBJ_L[c.obj]}` : c.type === 'group' ? `Group ${LANE_L[c.lane]}` :
            c.type === 'split' ? `${this.name(c.hero)} split ${LANE_L[c.lane]}` : c.type === 'focus' ? `Focus ${this.name(c.target)}` : c.type === 'build' ? `${this.name(c.hero)} → ${BUILDS[c.build].name}` :
            c.type === 'herald' ? `Herald ${LANE_L[c.lane]}` : c.type === 'safe' ? 'Play safe' : c.type === 'reset' ? 'Reset' : c.type === 'invade' ? 'Invade' : 'Cancel calls';
          this.feed(`${this.my < 0 ? TEAM_NAME[c.team] + ' call' : 'Call'}: ${what}`, c.team === 0 ? 'b' : 'r');
          break;
        }
        case 'victory': this.banner(this.my < 0 ? `${TEAM_NAME[e.team].toUpperCase()} WINS` : e.team === this.my ? 'VICTORY' : 'DEFEAT', e.team === this.my || this.my < 0 ? TEAM_COL[e.team] : '#ff5a5a', 4000); audio.sfx(e.team === this.my || this.my < 0 ? 'objective' : 'death'); break;
        case 'ultCast': if (ours || this.my < 0) audio.sfx('magic', 0.5, 300); break;
        case 'pivot': if (e.team === this.view) this.feed(`${this.name(e.hero)} will now build ${BUILDS[e.build].name}`, 'n'); break;
        case 'stolenCamp': if (e.team !== this.view) this.feed(`Enemy invaded your jungle!`, 'r'); break;
      }
      void ours;
    }
  }
  feed(text, cls = 'n', sticky, action) {
    const el = h('div', { class: 'fitem ' + cls }, h('span', {}, text), action ? h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); action.fn(); el.remove(); } }, action.label) : null);
    this.el.feed.prepend(el);
    this.feedItems.push({ el, t: performance.now(), sticky });
    while (this.el.feed.childElementCount > 6) { const last = this.el.feed.lastChild; last.remove(); }
  }
  banner(text, color, ms = 2200) {
    const b = h('div', { class: 'big', style: { color } }, text);
    mount(this.el.banner, b);
    clearTimeout(this._bt); this._bt = setTimeout(() => b.remove(), ms);
  }

  // ── analyst suggestions (only uses what your team can see) ──
  analyst() {
    if (this.my < 0) return;
    const g = this.g, me = this.my, vis = g.vision[me], now = g.tick;
    const ready = (k, s) => { if ((this.cool[k] || 0) > now) return false; this.cool[k] = now + s * TICK_RATE; return true; };
    const mine = g.teams[me].heroes, enemy = g.teams[1 - me].heroes;
    const jg = mine.find((x) => x.role === 'jungle');
    const deadEnemies = enemy.filter((x) => !x.alive && x.respawnAt - now > 15 * TICK_RATE);
    // objective spawn warnings
    for (const k of ['dragon', 'baron', 'herald']) {
      const t = g.objTimers[k];
      if (t && t - now > 0 && t - now < 30 * TICK_RATE && ready('spawnwarn' + k + t, 60)) this.feed(`${k === 'dragon' ? DRAGON_INFO[g.teams.some((x) => x.soul) ? 'elder' : g.nextDragon].name + ' Drake' : OBJ_L[k]} spawns in 30s`, 'n');
    }
    // numbers advantage → objective
    if (deadEnemies.length >= 2) {
      const best = g.objectives.baron && g.objectives.baron.alive ? 'baron' : g.objectives.dragon && g.objectives.dragon.alive ? 'dragon' : g.objectives.herald && g.objectives.herald.alive ? 'herald' : null;
      if (best && ready('numbers', 30)) this.feed(`${deadEnemies.length} enemies dead for 15s+`, 's', true, { label: `Take ${OBJ_L[best]}`, fn: () => this.send({ type: 'objective', obj: best }) });
      else if (!best && ready('numbers2', 30)) this.feed(`${deadEnemies.length} enemies dead — push!`, 's', true, { label: 'Group Mid', fn: () => this.send({ type: 'group', lane: 'mid' }) });
    }
    // enemy jungler spotted far from an objective
    const ej = enemy.find((x) => x.role === 'jungle');
    if (ej && ej.alive && vis.has(ej.id)) {
      const side = ej.x + ej.y < 2400 ? 'top' : 'bot';
      const o = side === 'top' ? g.objectives.dragon : (g.objectives.baron || g.objectives.herald);
      if (o && o.alive && ready('ejspot', 40)) this.feed(`Enemy jungler spotted ${side} side`, 's', true, { label: `Take ${OBJ_L[o.kind]}`, fn: () => this.send({ type: 'objective', obj: o.kind }) });
    }
    // overextended enemy laner → gank suggestion
    if (jg && jg.alive && jg.task.kind === 'jungle') {
      for (const e of enemy) {
        if (!e.alive || !vis.has(e.id) || e.role === 'jungle') continue;
        for (const lane of LANE_NAMES) {
          if (g.world.distToLane(lane, e) > 260) continue;
          const pr = g.world.laneProgress(lane, e), deep = me === 0 ? pr : 1 - pr;
          if (deep < 0.47 && ready('gank' + lane, 30)) this.feed(`${e.def.name} is overextended ${LANE_L[lane]}`, 's', true, { label: `Gank ${LANE_L[lane]}`, fn: () => this.send({ type: 'gank', lane, hero: jg.id }) });
        }
      }
    }
    // missing enemies
    for (const e of enemy) {
      if (!e.alive || e.role === 'jungle') { this.missing[e.id] = 0; continue; }
      if (vis.has(e.id)) { this.missing[e.id] = 0; continue; }
      const ls = g.lastSeen[me][e.id];
      if (!ls) continue;
      const gone = (now - ls.t) / TICK_RATE;
      if (gone > 8 && gone < 30 && g.time > 100 && !this.missing[e.id]) { this.missing[e.id] = 1; this.feed(`${e.def.name} is missing!`, 'r'); }
    }
    // enemy on an objective
    for (const k of ['dragon', 'baron', 'herald']) {
      const o = g.objectives[k];
      if (!o || !o.alive || o.hp > o.maxHp * 0.95 || !vis.has(o.id)) continue;
      const on = enemy.filter((e) => e.alive && vis.has(e.id) && (e.x - o.x) ** 2 + (e.y - o.y) ** 2 < 500 * 500);
      if (on.length && ready('contest' + k, 25)) this.feed(`Enemy is taking ${OBJ_L[k]}!`, 'r', true, { label: 'Contest', fn: () => this.send({ type: 'objective', obj: k }) });
    }
  }

  directorCam(dt) {
    const g = this.g;
    if (!this._dirT || performance.now() - this._dirT > 600) {
      this._dirT = performance.now();
      let best = null, bs = 0;
      const heroes = [...g.teams[0].heroes, ...g.teams[1].heroes].filter((x) => x.alive && this.r.visible(x));
      for (const a of heroes) {
        let s = 0;
        for (const b of heroes) if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 600 * 600) s += (g.tick - b.lastCombat < 40 ? 2 : 0.3) + (b.team !== a.team ? 1 : 0);
        for (const k of ['dragon', 'baron', 'herald']) { const o = g.objectives[k]; if (o && o.alive && o.hp < o.maxHp && (a.x - o.x) ** 2 + (a.y - o.y) ** 2 < 500 * 500) s += 3; }
        if (s > bs) { bs = s; best = a; }
      }
      if (best) this._dirTarget = { x: best.x, y: best.y };
    }
    if (this._dirTarget) { const k = Math.min(1, dt * 2.5); this.r.cam.x += (this._dirTarget.x - this.r.cam.x) * k; this.r.cam.y += (this._dirTarget.y - this.r.cam.y) * k; }
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '5') { const x = this.g.teams[this.view].heroes[+k - 1]; if (x) this.selectHero(x); return; }
    if (k === ' ') { e.preventDefault(); this.toggleDirector(); return; }
    if (k === 'escape') { this.picker = null; this.renderCmd(); return; }
    const c = CALLS.find((x) => x.key === k);
    if (c && this.my >= 0) this.openPicker(c.type);
  }
}
function byId(id) { return document.getElementById(id); }
void ROLE_LABEL;
