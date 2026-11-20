// In-match HUD. Layout is built from columns so panels never overlap:
//   #leftcol  (my team + analyst feed)      #topcenter (score + objectives)      #rightcol (enemies + kill feed)
//   #detail   (followed hero)               #cmdbar    (tactic cards + calls)    #brcol    (controls + minimap)
import { h, mount, face, icon, fmtTime, toast } from './dom.js';
import { BUILDS } from '../data/items.js';
import { PERSONALITIES } from '../data/heroes.js';
import { TACTICS } from '../data/tactics.js';
import { CMD, DRAGON_INFO, TEAM_NAME, TICK_RATE, T, OBJ_NAME, WEATHER, CLANS, xpNeeded } from '../sim/constants.js';
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';

const LANES = ['top', 'mid', 'bot'];
const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const OBJ_L = OBJ_NAME;
const BOSS_FACE = { dragon: 'boss/dragon_green_faceset', herald: 'boss/herald_faceset', baron: 'boss/baron_faceset' };
const CALLS = [
  { type: 'gank', label: 'Gank', icon: 'Cut', key: 'g', tip: 'Send a hero (default: jungler) to gank a lane' },
  { type: 'objective', label: 'Objective', icon: 'OrbFire', key: 'o', tip: 'Team groups to take Kami, Oni or Kraken' },
  { type: 'shrine', label: 'Shrine', icon: 'OrbLight', key: 'k', tip: 'Capture a river shrine' },
  { type: 'group', label: 'Group', icon: 'Upgrade', key: 'r', tip: 'Group up and push a lane' },
  { type: 'split', label: 'Split', icon: 'BookWind', key: 'p', tip: 'One hero split-pushes a lane' },
  { type: 'focus', label: 'Focus', icon: 'Death', key: 'f', tip: 'Everyone targets one enemy for 20s' },
  { type: 'safe', label: 'Safe', icon: 'DefenseUpgrade', key: 'x', tip: 'Hold under towers for 22s' },
  { type: 'reset', label: 'Reset', icon: 'Heal', key: 'b', tip: 'Everyone recalls and shops' },
  { type: 'invade', label: 'Invade', icon: 'Camouflage', key: 'i', tip: 'Jungler + 1 steal an enemy camp' },
  { type: 'herald', label: 'Oni', icon: 'Counter', key: 'h', tip: 'Unleash the Oni in a lane' },
  { type: 'build', label: 'Build', icon: 'Alchemy', key: 'u', tip: 'Change a hero\'s future items' },
  { type: 'cancel', label: 'Cancel', icon: 'Downgrade', key: 'c', tip: 'Cancel active calls' },
];
const byId = (id) => document.getElementById(id);

export class Hud {
  constructor(app, game, runner, renderer, minimap, myTeam, mode) {
    this.app = app; this.g = game; this.runner = runner; this.r = renderer; this.mm = minimap;
    this.my = myTeam; this.view = myTeam < 0 ? 0 : myTeam; this.mode = mode;
    this.evIdx = 0; this.picker = null; this.director = false; this.sel = null;
    this.lastDom = 0; this.lastAnalyst = 0; this.cool = {}; this.missing = {}; this.feedItems = []; this.kfItems = [];
    this.firstBlood = false;
    this.el = { score: byId('scorebar'), obj: byId('objtimers'), mine: byId('myteam'), enemy: byId('enemyteam'), feed: byId('feed'), kf: byId('killfeed'),
      banner: byId('banner'), ctrl: byId('ctrl'), cmd: byId('cmdbar'), detail: byId('detail') };
    mount(this.el.feed); mount(this.el.kf); mount(this.el.banner);
    byId('rightcol').classList.remove('show');
    this.build();
  }

  // ───────────────────────── build ─────────────────────────
  build() {
    const g = this.g;
    const card = (hero, mine) => {
      const pers = PERSONALITIES[hero.def.pers];
      const row = h('div', { class: 'hrow' + (mine ? ' mine' : ''), onclick: () => this.selectHero(hero), title: `${hero.def.name} · ${pers.name}` },
        h('div', { class: 'pf' }, h('img', { src: face(hero.heroId) }), h('div', { class: 'lv' }, '1'), h('div', { class: 'dead hidden' }, ''), h('div', { class: 'ultdot hidden', title: 'Ultimate ready' })),
        h('div', { class: 'info2' },
          h('div', { class: 'nm' }, h('span', { style: { color: TEAM_COL[hero.team] } }, hero.def.name), h('span', { class: 'kda' }, '0/0/0')),
          h('div', { class: 'bar' }, h('i', { style: { background: TEAM_COL[hero.team] } })),
          mine ? h('div', { class: 'trust', title: 'Trust in your calls' }, h('i')) : null,
          h('div', { class: 'st' }, ''),
          h('div', { class: 'its' })),
        h('div', { class: 'hpmini' }, h('i', { style: { background: TEAM_COL[hero.team] } })),
        mine ? null : h('div', { class: 'mia hidden' }, 'MIA'));
      row._hero = hero;
      row._q = { lv: row.querySelector('.lv'), dead: row.querySelector('.dead'), kda: row.querySelector('.kda'), bar: row.querySelector('.bar i'), mini: row.querySelector('.hpmini i'),
        trust: row.querySelector('.trust i'), st: row.querySelector('.st'), its: row.querySelector('.its'), mia: row.querySelector('.mia'), ult: row.querySelector('.ultdot') };
      return row;
    };
    this.mineRows = g.teams[this.view].heroes.map((x) => card(x, true));
    this.enemyRows = g.teams[1 - this.view].heroes.map((x) => card(x, false));
    const clanTags = (t) => h('div', { class: 'clantags' }, ...(g.teams[t].clans || []).map((c) => h('span', { style: { borderColor: CLANS[c.clan].color, color: CLANS[c.clan].color }, title: c.text }, `${CLANS[c.clan].name} ${c.n}`)));
    mount(this.el.mine, clanTags(this.view), this.mineRows);
    mount(this.el.enemy, clanTags(1 - this.view), this.enemyRows);
    const ctrl = [];
    if (!this.runner.online) {
      ctrl.push(h('div', { class: 'seg' }, ...[['II', 0], ['1x', 1], ['2x', 2], ['4x', 4]].map(([l, s]) => {
        const b = h('button', { class: 'btn small spd', onclick: () => { if (s === 0) this.runner.paused = !this.runner.paused; else { this.runner.speed = s; this.runner.paused = false; } this.refreshCtrl(); } }, l); b._s = s; return b;
      })));
    }
    ctrl.push(h('div', { class: 'seg' },
      this.dirBtn = h('button', { class: 'btn small', title: 'Auto-camera follows the action [Space]', onclick: () => this.toggleDirector() }, 'Cam'),
      this.my < 0 ? (this.fogBtn = h('button', { class: 'btn small', onclick: () => { this.r.fogOn = !this.r.fogOn; this.refreshCtrl(); } }, 'Fog')) : null,
      h('button', { class: 'btn small foesbtn', onclick: () => byId('rightcol').classList.toggle('show') }, 'Foes'),
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
    this.muteBtn.classList.toggle('on', audio.muted); this.muteBtn.textContent = audio.muted ? 'Mute' : 'Snd';
  }
  toggleDirector() { this.director = !this.director; if (this.director) this.r.follow = null; this.refreshCtrl(); }
  selectHero(hero) {
    if (this.r.follow === hero.id) { this.r.follow = null; this.sel = null; }
    else { this.r.follow = hero.id; this.sel = hero; if (!hero.alive) { this.r.cam.x = hero.x; this.r.cam.y = hero.y; } }
    this.director = false; this.refreshCtrl(); this.renderDetail(true);
  }

  // ───────────────────────── commands ─────────────────────────
  canAfford(type) { return this.my >= 0 && this.g.teams[this.my].charges + 1e-9 >= (CMD.cost[type] ?? 1); }
  send(cmd) {
    if (this.my < 0) return;
    if (!this.canAfford(cmd.type)) { toast('Not enough command charges'); audio.sfx('cancel', 0.6); return; }
    this.runner.send(cmd);
    this.picker = null; this.renderCmd();
    audio.sfx('call', 0.8);
    const p = this.callPoint(cmd); this.mm.ping(p[0], p[1], TEAM_COL[this.my]);
  }
  callPoint(c) {
    const W = this.g.world;
    if (c.obj) { const p = c.obj === 'dragon' ? W.pits.kami : W.pits.kraken; return [p.x, p.y]; }
    if (c.type === 'shrine' && c.shrine !== undefined) { const s = W.shrines[c.shrine]; return [s.x, s.y]; }
    if (c.lane) { const p = W.lanePoint(c.lane, 0.5); return [p.x, p.y]; }
    return [this.r.cam.x, this.r.cam.y];
  }
  openPicker(type) {
    if (this.my < 0) return;
    if (['safe', 'reset', 'invade', 'cancel'].includes(type)) { this.send({ type }); return; }
    this.picker = this.picker && this.picker.type === type ? null : { type, hero: null };
    audio.sfx('move', 0.5);
    this.renderCmd();
  }
  renderCmd() {
    const g = this.g;
    if (this.my < 0) { mount(this.el.cmd, h('div', { class: 'cmdrow spectate' }, 'Spectating — drag to look around, tap a portrait to follow.')); return; }
    const team = g.teams[this.my];
    const pips = h('div', { class: 'pips' }, ...Array.from({ length: CMD.maxCharges }, () => h('div', { class: 'pip' }, h('i'))));
    this.pips = pips;
    const btns = CALLS.filter((c) => c.type !== 'herald' || team.heraldEye > g.tick).map((c) => {
      const cost = CMD.cost[c.type];
      const b = h('button', { class: 'btn cbtn' + (this.picker && this.picker.type === c.type ? ' on' : ''), onclick: () => this.openPicker(c.type), title: `${c.tip} [${c.key.toUpperCase()}]` },
        h('img', { src: icon(c.icon) }), h('span', { class: 'l' }, c.label), h('span', { class: 'cost' }, ...Array.from({ length: cost }, () => h('i'))));
      b._type = c.type; return b;
    });
    this.cmdBtns = btns;
    const cards = h('div', { class: 'cardrow' }, ...team.deck.map((d) => {
      const t = TACTICS[d.id];
      return h('button', { class: 'tcard' + (d.used ? ' used' : '') + (this.picker && this.picker.type === 'tactic' && this.picker.card === d.id ? ' on' : ''), disabled: d.used, title: t.desc,
        onclick: () => { if (t.target === 'none') this.send({ type: 'tactic', card: d.id }); else { this.picker = { type: 'tactic', card: d.id }; this.renderCmd(); } } },
        h('img', { src: icon(t.icon) }), h('span', {}, t.name));
    }));
    this._deckSig = team.deck.map((d) => d.used ? 1 : 0).join('');
    this._hasEye = team.heraldEye > g.tick;
    const row = h('div', { class: 'cmdrow' }, h('div', { class: 'meter', title: '+1 charge every 20s' }, pips, h('span', {}, 'CALLS')), ...btns);
    mount(this.el.cmd, this.picker ? this.pickerEl() : null, cards, row);
    this.updatePips();
  }
  heroPick(list, onPick, selId, disabled) {
    return h('div', { class: 'opts' }, ...list.map((x) => h('div', { class: 'pf-btn' + (selId === x.id ? ' sel' : '') + (disabled && disabled(x) ? ' dis' : ''), onclick: () => { if (!(disabled && disabled(x))) onPick(x); } },
      h('img', { src: face(x.heroId) }), x.def.name)));
  }
  pickerEl() {
    const g = this.g, p = this.picker, mine = g.teams[this.my].heroes, enemy = g.teams[1 - this.my].heroes;
    const laneBtns = (fn) => h('div', { class: 'opts' }, ...LANES.map((l) => h('button', { class: 'btn', onclick: () => fn(l) }, LANE_L[l])));
    const box = (q, ...kids) => h('div', { class: 'picker' }, h('div', { class: 'q' }, h('span', {}, q), h('button', { class: 'x', title: 'Close', onclick: () => { this.picker = null; this.renderCmd(); } }, 'x')), ...kids);
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
          const name = k === 'dragon' && o ? DRAGON_INFO[o.element].name : OBJ_L[k];
          return h('button', { class: 'btn objbtn', disabled: st === 'gone' || st === '—' || !g.objAvailable(k), title: g.objAvailable(k) ? '' : 'Available 0:25 before it spawns', onclick: () => this.send({ type: 'objective', obj: k }) }, h('img', { src: `assets/img/${BOSS_FACE[k]}.png` }), h('span', {}, `${name} · ${st}`));
        };
        return box('Take which objective? (team groups up · 2 charges)', h('div', { class: 'opts' }, opt('dragon'), opt('herald'), opt('baron')));
      }
      case 'shrine': {
        const opt = (sh) => h('button', { class: 'btn', disabled: sh.owner === this.my || g.time < T.shrineUnlock, onclick: () => this.send({ type: 'shrine', shrine: sh.id }) },
          `${sh.id === this.my ? 'Home' : 'Far'} shrine · ${sh.owner === this.my ? 'ours' : sh.owner < 0 ? 'neutral' : 'theirs'}`);
        return box('Capture which shrine? (+5% team damage, vision, healing)', h('div', { class: 'opts' }, ...g.shrines.map(opt)));
      }
      case 'group': return box('Group up and push which lane?', laneBtns((l) => this.send({ type: 'group', lane: l })));
      case 'herald': return box('Unleash the Oni in which lane?', laneBtns((l) => this.send({ type: 'herald', lane: l })));
      case 'split': {
        if (!p.hero) return box('Who split-pushes?', this.heroPick(mine, (x) => { p.hero = x; this.renderCmd(); }, null, (x) => !x.alive));
        return box(`${p.hero.def.name} splits which lane?`, laneBtns((l) => this.send({ type: 'split', hero: p.hero.id, lane: l })));
      }
      case 'tactic': {
        const t = TACTICS[p.card];
        if (t.target === 'lane') return box(`${t.name}: which lane?`, laneBtns((l) => this.send({ type: 'tactic', card: p.card, lane: l })));
        return box(`${t.name}: which hero?`, this.heroPick(mine, (x) => this.send({ type: 'tactic', card: p.card, hero: x.id }), null, (x) => !x.alive));
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
    [...this.pips.children].forEach((p, i) => { const f = Math.max(0, Math.min(1, c - i)); p.firstChild.style.height = f * 100 + '%'; p.classList.toggle('full', f >= 1); });
    if (this.cmdBtns) for (const b of this.cmdBtns) b.disabled = !this.canAfford(b._type);
  }

  // ───────────────────────── per frame ─────────────────────────
  update(dt) {
    const g = this.g, now = performance.now();
    this.processEvents();
    this.updatePips();
    if (this.director) this.directorCam(dt);
    if (now - this.lastDom < 120) return;
    this.lastDom = now;
    if (this.my >= 0) {
      const team = g.teams[this.my];
      if ((team.heraldEye > g.tick) !== this._hasEye || team.deck.map((d) => d.used ? 1 : 0).join('') !== this._deckSig) this.renderCmd();
      if (this.picker && this.picker.type === 'objective' && g.tick % 20 < 3) this.renderCmd();
    }
    this.updateScore();
    this.updateRows(this.mineRows, true);
    this.updateRows(this.enemyRows, false);
    this.renderDetail(false);
    if (now - this.lastAnalyst > 1000) { this.lastAnalyst = now; this.analyst(); }
    const fade = (list, ttl) => list.filter((f) => { if (now - f.t > (f.sticky ? 12000 : ttl)) { f.el.classList.add('out'); setTimeout(() => f.el.remove(), 300); return false; } return true; });
    this.feedItems = fade(this.feedItems, 7000);
    this.kfItems = fade(this.kfItems, 9000);
  }

  updateScore() {
    const g = this.g, t0 = g.teams[0], t1 = g.teams[1];
    const pips = (t) => h('span', { class: 'drag-pips' }, ...t.dragons.map((d) => h('i', { style: { background: DRAGON_INFO[d].color }, title: DRAGON_INFO[d].name })));
    const left = g.timeLeft, late = left < 60;
    const wx = g.weatherList[Math.max(0, g.weatherIdx)];
    const sig = [g.towersStanding(0), g.towersStanding(1), t0.kills, t1.kills, Math.floor(left), wx, t0.dragons.length, t1.dragons.length].join(',');
    if (sig !== this._scoreSig) {
      this._scoreSig = sig;
      mount(this.el.score,
        h('div', { class: 'side blue' }, h('div', { class: 'tw', title: 'Towers standing' }, h('i', { class: 'ticon' }), g.towersStanding(0)), h('div', { class: 'meta' }, h('b', {}, t0.kills), h('span', {}, 'kills'), pips(t0))),
        h('div', { class: 'mid' }, h('div', { class: 'clock' + (late ? ' late' : '') }, fmtTime(left)), h('div', { class: 'wx', title: WEATHER[wx].desc || '' }, WEATHER[wx].name)),
        h('div', { class: 'side red' }, h('div', { class: 'tw', title: 'Towers standing' }, g.towersStanding(1), h('i', { class: 'ticon' })), h('div', { class: 'meta' }, pips(t1), h('span', {}, 'kills'), h('b', {}, t1.kills))));
    }
    const ot = (k) => {
      const o = g.objectives[k]; const tmr = g.objTimers[k];
      if (k === 'herald' && (g.time > T.heraldDespawn || g.objectives.baron)) return null;
      if (k === 'baron' && g.time < T.heraldDespawn - 60 && !o) return null;
      const up = o && o.alive;
      const label = k === 'dragon' ? (up ? DRAGON_INFO[o.element].short : DRAGON_INFO[g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon].short) : OBJ_L[k];
      const st = up ? 'UP' : tmr ? fmtTime(Math.max(0, (tmr - g.tick) / TICK_RATE)) : '—';
      return h('div', { class: 'ot' + (up ? ' up' : '') }, h('img', { src: `assets/img/${BOSS_FACE[k]}.png` }), h('span', {}, label), h('b', {}, st));
    };
    const shr = g.shrines.map((sh) => h('div', { class: 'ot', title: 'River shrine' }, h('span', { class: 'shr', style: { background: sh.owner >= 0 ? TEAM_COL[sh.owner] : '#ffe9a8' } }), h('b', {}, sh.owner < 0 ? '—' : sh.owner === this.view ? 'Ours' : 'Theirs')));
    mount(this.el.obj, ot('dragon'), ot('herald'), ot('baron'), ...shr);
  }

  taskLabel(x) {
    const g = this.g, t = x.task;
    if (!x.alive) return `Respawn ${Math.ceil((x.respawnAt - g.tick) / TICK_RATE)}s`;
    if (x.recallAt) return 'Recalling…';
    if (x.pendingCall) return x.trust < 30 ? 'Hesitating…' : 'Got it…';
    if (g.tick - x.lastHitHero < TICK_RATE * 1.5) return 'Fighting!';
    const L = (l) => LANE_L[l] || '';
    switch (t.kind) {
      case 'lane': return x.role === 'support' ? `Escorting ${L(t.lane) || 'carry'}` : `Laning ${L(t.lane)}`;
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
      case 'ambush': return 'Lying in ambush';
      case 'shrine': return 'Taking shrine';
      case 'help': { const a = g.byId(t.ally); return a ? `Helping ${a.def.name}` : 'Helping'; }
      default: return '—';
    }
  }
  updateRows(rows, mine) {
    const g = this.g;
    for (const row of rows) {
      const x = row._hero, q = row._q;
      const vis = mine || this.my < 0 || !this.r.fogOn || g.vision[this.view].has(x.id);
      row.classList.toggle('sel', this.r.follow === x.id);
      row.classList.toggle('isdead', !x.alive);
      q.lv.textContent = x.level;
      if (!x.alive) { q.dead.classList.remove('hidden'); q.dead.textContent = Math.ceil((x.respawnAt - g.tick) / TICK_RATE); } else q.dead.classList.add('hidden');
      q.kda.textContent = `${x.kills}/${x.deaths}/${x.assists}`;
      const pct = x.alive ? (vis ? x.hp / x.maxHp : 0) : 0;
      q.bar.style.width = pct * 100 + '%'; q.mini.style.width = pct * 100 + '%';
      if (q.trust) { q.trust.style.width = x.trust + '%'; q.trust.style.background = x.trust >= 70 ? 'var(--green)' : x.trust <= 30 ? 'var(--red)' : 'var(--gold)'; }
      q.st.textContent = mine ? this.taskLabel(x) : (vis ? (x.alive ? this.taskLabelEnemy(x) : this.taskLabel(x)) : this.missingText(x));
      if (q.its.childElementCount !== x.items.length) mount(q.its, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
      if (q.mia) { row.classList.toggle('mia', !vis && x.alive); q.mia.classList.toggle('hidden', vis || !x.alive); }
      q.ult.classList.toggle('hidden', !(mine && x.alive && x.level >= 5 && g.abilityReady(x, 2)));
    }
  }
  taskLabelEnemy(x) { return this.g.tick - x.lastHitHero < TICK_RATE * 1.5 ? 'Fighting!' : `Seen ${LANE_L[this.g.world.closestLane(x)]}`; }
  missingText(x) {
    const ls = this.g.lastSeen[this.view][x.id];
    if (!ls) return 'Unseen';
    return `Seen ${Math.floor((this.g.tick - ls.t) / TICK_RATE)}s ago`;
  }

  // Detail panel for the hero being followed.
  renderDetail(force) {
    const x = this.sel && this.r.follow === this.sel.id ? this.sel : null;
    if (!x) { if (this.el.detail.childElementCount) mount(this.el.detail); this.el.detail.classList.add('hidden'); this._det = null; return; }
    this.el.detail.classList.remove('hidden');
    const g = this.g, s = x.stats;
    if (force || !this._det || this._det.id !== x.id) {
      const pers = PERSONALITIES[x.def.pers];
      const abl = x.def.abilities.map((ab, i) => h('div', { class: 'abl', title: `${ab.name}${ab.ult ? ' (ultimate)' : ''}` }, h('img', { src: icon(ab.icon) }), h('div', { class: 'cd' }), h('span', { class: 'k' }, ['Q', 'W', 'R'][i])));
      this._det = { id: x.id, abl, xp: h('i'), hp: h('i'), stats: h('div', { class: 'stats' }), info: h('div', { class: 'dinfo' }), items: h('div', { class: 'its' }) };
      mount(this.el.detail,
        h('div', { class: 'dhead' }, h('img', { class: 'dface', src: face(x.heroId) }),
          h('div', { class: 'dcol' },
            h('div', { class: 'dname' }, h('span', { style: { color: TEAM_COL[x.team] } }, x.def.name), h('span', { class: 'muted' }, ` ${x.def.title}`)),
            h('div', { class: 'dtags' }, h('span', { style: { color: CLANS[x.def.clan].color } }, CLANS[x.def.clan].name), h('span', { style: { color: pers.color } }, pers.name), h('span', { style: { color: BUILDS[x.build].color } }, BUILDS[x.build].name)),
            h('div', { class: 'dbar hp' }, this._det.hp), h('div', { class: 'dbar xp' }, this._det.xp))),
        h('div', { class: 'ablrow' }, ...abl, this._det.items), this._det.stats, this._det.info);
    }
    const d = this._det;
    d.hp.style.width = (x.alive ? x.hp / x.maxHp * 100 : 0) + '%';
    d.xp.style.width = Math.min(100, x.xp / xpNeeded(x.level) * 100) + '%';
    x.def.abilities.forEach((ab, i) => {
      const el = d.abl[i].children[1];
      const locked = ab.ult && x.level < 5;
      const left = Math.max(0, (x.cds[i] - g.tick) / TICK_RATE);
      el.textContent = locked ? 'L5' : left > 0 ? Math.ceil(left) : '';
      d.abl[i].classList.toggle('cool', locked || left > 0);
    });
    if (d.items.childElementCount !== x.items.length) mount(d.items, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
    d.stats.textContent = `AD ${Math.round(s.ad)}  AP ${Math.round(s.ap)}  AR ${Math.round(s.armor)}  MR ${Math.round(s.mr)}  AS ${s.as.toFixed(2)}  MS ${Math.round(g.moveSpeed(x))}`;
    d.info.textContent = `Lv ${x.level} · ${x.kills}/${x.deaths}/${x.assists} · ${x.cs} CS · ${Math.round(x.goldEarned / 100) / 10}k` + (x.team === this.my ? ` · Trust ${Math.round(x.trust)}${x.tiltUntil > g.tick ? ' (tilted)' : ''}` : '') + ` · ${this.taskLabel(x)}`;
  }

  // ───────────────────────── events → feeds / banners / audio ─────────────────────────
  name(id) { const u = this.g.byId(id); return u && u.def ? u.def.name : '?'; }
  processEvents() {
    const g = this.g, ev = g.events;
    for (; this.evIdx < ev.length; this.evIdx++) {
      const e = ev[this.evIdx];
      switch (e.type) {
        case 'kill': {
          const v = g.byId(e.victim); const killer = e.killer ? g.byId(e.killer) : null;
          const kt = 1 - v.team;
          this.killfeed(killer, v, e.assists.length);
          if (!this.firstBlood) { this.firstBlood = true; this.banner('FIRST BLOOD', TEAM_COL[kt], 1800, killer ? face(killer.heroId) : null); }
          else if (e.shutdown) this.banner('SHUT DOWN', TEAM_COL[kt], 1500, killer ? face(killer.heroId) : null);
          if (g.teams[v.team].heroes.every((x) => !x.alive)) this.banner('ACE!', TEAM_COL[kt], 2000);
          audio.sfx(kt === this.view || this.my < 0 ? 'impact' : 'death', 0.8);
          break;
        }
        case 'objective': {
          const nm = e.obj === 'dragon' ? DRAGON_INFO[e.element].name : OBJ_L[e.obj];
          this.feed(`${TEAM_NAME[e.team]} ${e.steal ? 'STOLE' : 'took'} ${nm}${e.killer ? ' (' + this.name(e.killer) + ')' : ''}`, e.team === 0 ? 'b' : 'r', true);
          this.banner(`${e.steal ? 'STOLEN! ' : ''}${nm.toUpperCase()}`, TEAM_COL[e.team], 2200, `assets/img/${BOSS_FACE[e.obj]}.png`);
          audio.sfx('objective');
          break;
        }
        case 'soul': this.banner(`${DRAGON_INFO[e.element].short.toUpperCase()} BLESSING`, TEAM_COL[e.team], 2400); break;
        case 'shrine': this.feed(`${TEAM_NAME[e.team]} captured a shrine`, e.team === 0 ? 'b' : 'r', true); audio.sfx('powerup', 0.6); break;
        case 'weather': if (g.tick > 5) { const W_ = WEATHER[e.weather]; this.feed(`Weather: ${W_.name}${W_.desc ? ' — ' + W_.desc : ''}`, 'n'); } break;
        case 'tower': this.feed(`${TEAM_NAME[e.team]} destroyed a ${LANE_L[e.lane] || 'base'} tower`, e.team === 0 ? 'b' : 'r'); audio.sfx('explosion', 0.7); break;
        case 'inhib': this.feed(`${TEAM_NAME[e.team]} broke the ${LANE_L[e.lane]} gate!`, e.team === 0 ? 'b' : 'r', true); this.banner('GATE DESTROYED', TEAM_COL[e.team]); audio.sfx('explosion'); break;
        case 'inhibRespawn': this.feed(`${TEAM_NAME[e.team]} ${LANE_L[e.lane]} gate restored`, 'n'); break;
        case 'spawn': this.feed(`${e.obj === 'dragon' ? DRAGON_INFO[e.element].name : OBJ_L[e.obj]} has awakened`, 'n'); audio.sfx('alert', 0.5); break;
        case 'heraldDrop': this.feed(`${TEAM_NAME[e.team]} unleashed the Oni ${LANE_L[e.lane]}!`, e.team === 0 ? 'b' : 'r'); audio.sfx('explosion'); break;
        case 'call': {
          const c = e.call;
          if ((c.team !== this.view && this.my >= 0) || c.type === 'tactic') break;
          const what = c.type === 'gank' ? `${c.hero ? this.name(c.hero) : 'Jungler'} gank ${LANE_L[c.lane]}` : c.type === 'objective' ? `Take ${OBJ_L[c.obj]}` : c.type === 'group' ? `Group ${LANE_L[c.lane]}` :
            c.type === 'split' ? `${this.name(c.hero)} split ${LANE_L[c.lane]}` : c.type === 'focus' ? `Focus ${this.name(c.target)}` : c.type === 'build' ? `${this.name(c.hero)} → ${BUILDS[c.build].name}` :
            c.type === 'herald' ? `Oni ${LANE_L[c.lane]}` : c.type === 'shrine' ? 'Capture shrine' : c.type === 'safe' ? 'Play safe' : c.type === 'reset' ? 'Reset' : c.type === 'invade' ? 'Invade' : 'Cancel calls';
          this.feed(`${this.my < 0 ? TEAM_NAME[c.team] + ' call' : 'Call'}: ${what}`, c.team === 0 ? 'b' : 'r');
          break;
        }
        case 'victory':
          if (e.timeout) this.banner(`TIME!  ${e.towers[0]} - ${e.towers[1]} TOWERS`, '#ffd84a', 1500);
          setTimeout(() => this.banner(this.my < 0 ? `${TEAM_NAME[e.team].toUpperCase()} WINS` : e.team === this.my ? 'VICTORY' : 'DEFEAT', e.team === this.my || this.my < 0 ? TEAM_COL[e.team] : '#ff5a5a', 4000), e.timeout ? 1600 : 0);
          audio.sfx(e.team === this.my || this.my < 0 ? 'objective' : 'death');
          break;
        case 'ultCast': if (e.team === this.view || this.my < 0) audio.sfx('magic', 0.5, 300); break;
        case 'pivot': if (e.team === this.view) this.feed(`${this.name(e.hero)} will now build ${BUILDS[e.build].name}`, 'n'); break;
        case 'trust': if (e.team === this.view && this.my >= 0) { const x = g.byId(e.hero); this.feed(e.tier === 2 ? `${x.def.name} is Inspired by your calls!` : e.tier === 0 ? `${x.def.name} is losing faith in your calls` : `${x.def.name} trusts you again`, e.tier === 0 ? 'r' : 's'); } break;
        case 'tactic': if (e.team === this.view || this.my < 0) { this.banner(TACTICS[e.card].name.toUpperCase(), TEAM_COL[e.team], 1500); audio.sfx('powerup', 0.7); } break;
        case 'stolenCamp': if (e.big && e.team !== this.view) this.feed('Enemy invaded your jungle!', 'r'); break;
      }
    }
  }
  feed(text, cls = 'n', sticky, action) {
    const el = h('div', { class: 'fitem ' + cls }, h('span', {}, text), action ? h('button', { class: 'btn', onclick: (ev) => { ev.stopPropagation(); action.fn(); el.remove(); } }, action.label) : null);
    this.el.feed.prepend(el);
    this.feedItems.push({ el, t: performance.now(), sticky });
    while (this.el.feed.childElementCount > 5) this.el.feed.lastChild.remove();
  }
  killfeed(killer, victim, assists) {
    if (!this.el.kf.offsetParent) { this.feed(`${killer ? killer.def.name : 'Tower'} › ${victim.def.name}`, victim.team === 1 ? 'b' : 'r'); return; }
    const side = (u) => u ? h('img', { src: face(u.heroId), style: { borderColor: TEAM_COL[u.team] } }) : h('span', { class: 'exec' }, 'Tower');
    const el = h('div', { class: 'kitem ' + (victim.team === 1 ? 'b' : 'r') }, side(killer), h('span', { class: 'sw' }, assists ? `+${assists}` : '›'), side(victim));
    this.el.kf.prepend(el); this.kfItems.push({ el, t: performance.now() });
    while (this.el.kf.childElementCount > 5) this.el.kf.lastChild.remove();
  }
  banner(text, color, ms = 2200, img) {
    const b = h('div', { class: 'big', style: { color } }, img ? h('img', { src: img }) : null, h('span', {}, text));
    mount(this.el.banner, b);
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.add('out'), ms);
  }

  // ───────────────────────── analyst ─────────────────────────
  analyst() {
    if (this.my < 0) return;
    const g = this.g, me = this.my, vis = g.vision[me], now = g.tick;
    const ready = (k, s) => { if ((this.cool[k] || 0) > now) return false; this.cool[k] = now + s * TICK_RATE; return true; };
    const mine = g.teams[me].heroes, enemy = g.teams[1 - me].heroes;
    const jg = mine.find((x) => x.role === 'jungle');
    const deadEnemies = enemy.filter((x) => !x.alive && x.respawnAt - now > 15 * TICK_RATE);
    for (const k of ['dragon', 'baron', 'herald']) {
      const t = g.objTimers[k];
      if (t && t - now > 0 && t - now < 30 * TICK_RATE && ready('spawnwarn' + k + t, 60)) this.feed(`${k === 'dragon' ? DRAGON_INFO[g.teams.some((x) => x.soul) ? 'elder' : g.nextDragon].name : OBJ_L[k]} awakens in 30s`, 'n');
    }
    if (deadEnemies.length >= 2) {
      const best = ['baron', 'dragon', 'herald'].find((k) => g.objectives[k] && g.objectives[k].alive);
      if (best && ready('numbers', 30)) this.feed(`${deadEnemies.length} enemies dead for 15s+`, 's', true, { label: `Take ${OBJ_L[best]}`, fn: () => this.send({ type: 'objective', obj: best }) });
      else if (!best && ready('numbers2', 30)) this.feed(`${deadEnemies.length} enemies dead — push!`, 's', true, { label: 'Group Mid', fn: () => this.send({ type: 'group', lane: 'mid' }) });
    }
    const ej = enemy.find((x) => x.role === 'jungle');
    if (ej && ej.alive && vis.has(ej.id)) {
      const W = g.world, nearKraken = (ej.x - W.pits.kraken.x) ** 2 + (ej.y - W.pits.kraken.y) ** 2 < (ej.x - W.pits.kami.x) ** 2 + (ej.y - W.pits.kami.y) ** 2;
      const o = nearKraken ? g.objectives.dragon : (g.objectives.baron || g.objectives.herald);
      if (o && o.alive && ready('ejspot', 40)) this.feed(`Enemy jungler is far from ${OBJ_L[o.kind]}`, 's', true, { label: `Take ${OBJ_L[o.kind]}`, fn: () => this.send({ type: 'objective', obj: o.kind }) });
    }
    if (jg && jg.alive && jg.task.kind === 'jungle') {
      for (const e of enemy) {
        if (!e.alive || !vis.has(e.id) || e.role === 'jungle') continue;
        for (const lane of LANES) {
          if (g.world.distToLane(lane, e) > 260) continue;
          const pr = g.world.laneProgress(lane, e), deep = me === 0 ? pr : 1 - pr;
          if (deep < 0.47 && ready('gank' + lane, 30)) this.feed(`${e.def.name} is overextended ${LANE_L[lane]}`, 's', true, { label: `Gank ${LANE_L[lane]}`, fn: () => this.send({ type: 'gank', lane, hero: jg.id }) });
        }
      }
    }
    for (const e of enemy) {
      if (!e.alive || e.role === 'jungle' || vis.has(e.id)) { this.missing[e.id] = 0; continue; }
      const ls = g.lastSeen[me][e.id]; if (!ls) continue;
      const gone = (now - ls.t) / TICK_RATE;
      if (gone > 8 && gone < 30 && g.time > 100 && !this.missing[e.id]) { this.missing[e.id] = 1; this.feed(`${e.def.name} is missing!`, 'r'); }
    }
    for (const k of ['dragon', 'baron', 'herald']) {
      const o = g.objectives[k];
      if (!o || !o.alive || o.hp > o.maxHp * 0.95 || !vis.has(o.id)) continue;
      const on = enemy.filter((e) => e.alive && vis.has(e.id) && (e.x - o.x) ** 2 + (e.y - o.y) ** 2 < 500 * 500);
      if (on.length && ready('contest' + k, 25)) this.feed(`Enemy is taking ${OBJ_L[k]}!`, 'r', true, { label: 'Contest', fn: () => this.send({ type: 'objective', obj: k }) });
    }
    for (const sh of g.shrines) if (sh.owner !== me && g.time > T.shrineUnlock && !enemy.some((e) => e.alive && vis.has(e.id) && (e.x - sh.x) ** 2 + (e.y - sh.y) ** 2 < 800 * 800) && ready('shr' + sh.id, 70))
      this.feed(`${sh.id === me ? 'Home' : 'Far'} shrine is open`, 's', true, { label: 'Take it', fn: () => this.send({ type: 'shrine', shrine: sh.id }) });
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
