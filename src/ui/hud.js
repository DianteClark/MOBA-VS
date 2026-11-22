// In-match HUD. Layout is built from columns so panels never overlap:
//   #leftcol  (my team)                     #topcenter (score + objectives + one-line ticker)   #rightcol (enemies + kill feed)
//   #detail   (followed hero)               #cmdbar    (decision tray + tactic cards + calls)  #brcol    (controls + minimap)
import { h, mount, face, icon, fmtTime, toast, bossFace, kamiNow, setText, setCss, setOff } from './dom.js';
import { BUILDS } from '../data/items.js';
import { PERSONALITIES } from '../data/heroes.js';
import { TACTICS } from '../data/tactics.js';
import { CMD, DRAGON_INFO, TEAM_NAME, TICK_RATE, OBJ_NAME, WEATHER, CLANS, xpNeeded } from '../sim/constants.js';
import { MOMENTS } from '../sim/moments-coach.js';
import { momentFx } from './momentfx.js';
import { coachMoment, heroRequests, ASK_WEIGHT } from './moments.js';
import { PRIO } from './tray.js';
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';
import { Dock } from './commands.js';
import { Alerts } from './alerts.js';
import { analystSuggestions } from './suggest.js';
import { settings, openSettingsModal, isTouch } from './settings.js';
import { Caster } from './caster.js';
import { buzz } from './haptics.js';
import { QuickChat } from './quickchat.js';
import { tweenNumber, pop } from './juice.js';
import { CoachTips, tipsLeft } from './coachtips.js';
import { planReveal, planSwitch } from './plans.js';
import { planName } from '../data/plans.js';
import { EVENT_BY_ID } from '../data/events.js';
import { canCommand, HERO_CMDS } from '../sim/coop.js';
import { COOP_COL, coachOf } from '../coop-room.js';
import { Depth } from './depth.js';
import { placeName, fightClusters, followFight, laneFront, towerName } from '../world/places.js';
import { talentIcons, talentKey } from './talentui.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const OBJ_L = OBJ_NAME;
const byId = (id) => document.getElementById(id);

export class Hud {
  constructor(app, game, runner, renderer, minimap, myTeam, mode) {
    this.app = app; this.g = game; this.runner = runner; this.r = renderer; this.mm = minimap;
    this.my = myTeam; this.view = myTeam < 0 ? 0 : myTeam; this.mode = mode;
    // co-op: this coach's seat on a shared team (hero ownership and the lead live in the sim: team.coop)
    const ses = app.session;
    this.coop = ses && ses.mode === 'coop' && myTeam >= 0 && ses.coop && ses.coop[myTeam] ? ses : null;
    this.seat = this.coop ? ses.mySeat : 0;
    this.evIdx = 0; this.director = false; this.sel = null;
    this.lastDom = 0; this.lastAnalyst = 0; this.cool = {}; this.missing = {}; this.kfItems = []; this.tk = null; this.tkq = [];
    this.slows = {}; this.cc = { n: 0, last: -1e9, keys: new Set() }; this.rq = { n: 0, last: -1e9 }; this.fightCam = null;
    this.stats = { shrineOpen: 0, fullCharge: 0, coachCalls: 0, coachAnswered: 0, requests: 0, requestsYes: 0, lastTick: 0 };
    this.firstBlood = false;
    this.caster = new Caster(game, this.view);
    this.el = { score: byId('scorebar'), obj: byId('objtimers'), mine: byId('myteam'), enemy: byId('enemyteam'), ticker: byId('ticker'), kf: byId('killfeed'),
      banner: byId('banner'), ctrl: byId('ctrl'), cmd: byId('cmdbar'), detail: byId('detail') };
    mount(this.el.ticker); mount(this.el.kf); mount(this.el.banner); this.el.ticker.classList.add('hidden');
    byId('rightcol').classList.remove('show');
    if (Hud.current && Hud.current !== this) Hud.current.destroy();
    Hud.current = this;
    if (!runner.online && mode !== 'watch') runner.speed = settings.speed || 1;
    this.depth = game.depth ? new Depth(this) : null; // v23 match depth: talents, item override, forecasts
    this.build();
    // joining a game already in progress (Play of the Game): skip its history, keep its tallies
    if (game.tick > 0) {
      this.evIdx = game.events.length;
      for (const e of game.events) { if (e.type === 'kill') this.firstBlood = true; if (e.type === 'objective' && e.team >= 0 && e.team < 2) this.objTaken[e.team][e.obj]++; }
    }
    this.alerts = new Alerts(this);
    // first matches: a few one-time coach tips in the tray (not for spectators or the Play of the Game)
    if (myTeam >= 0 && mode !== 'watch' && tipsLeft()) this.tips = new CoachTips(this);
    if (runner.online && myTeam >= 0 && this.coop) {
      // co-op quick chat: between partners only (in 2v2 the other side never sees it)
      const s = this.coop;
      this.enableChat((m) => app.net && app.net.t.send(m), { extra: { team: myTeam, p: s.slot }, accept: (m) => m.team === myTeam && m.p !== s.slot,
        who: (m) => { const p = s.players.find((x) => x.slot === m.p); return { name: p ? p.name : 'Partner', color: COOP_COL[p ? p.seat : 1] }; },
        me: { name: 'You', color: COOP_COL[this.seat] }, mute: 'partner' });
    } else if (runner.online && myTeam >= 0) this.enableChat((m) => app.net && app.net.t.send(m));
    this._popClose = (e) => { if (this.pop && !this.pop.el.contains(e.target)) this.closePop(); };
    window.addEventListener('pointerdown', this._popClose, true);
  }

  // ───────────────────────── build ─────────────────────────
  build() {
    const g = this.g;
    const card = (hero, mine) => {
      const pers = PERSONALITIES[hero.def.pers], tc = `var(--team${hero.team})`;
      const ultAb = hero.def.abilities.find((a) => a.ult) || hero.def.abilities[2];
      const row = h('div', { class: 'hrow' + (mine ? ' mine' : ''), title: `${hero.def.name} · ${pers.name} (hold or right-click for details)` },
        h('div', { class: 'pf' }, h('img', { class: 'fc', src: face(hero.heroId) }), h('div', { class: 'lv' }, '1'),
          mine && this.coopTeam() && this.coopTeam().seats === 2 ? h('i', { class: 'own' }) : null,
          h('div', { class: 'dead hidden' }, h('span', { class: 'skull' }), h('b', {}, '')),
          h('div', { class: 'ultdot hidden', title: 'Ultimate ready' }, h('img', { src: icon(ultAb.icon) })),
          h('img', { class: 'stb hidden', src: 'assets/img/emote/up.png' })),
        h('div', { class: 'info2' },
          h('div', { class: 'nm' }, h('span', { style: { color: tc } }, hero.def.name), h('span', { class: 'kda' }, '0/0/0')),
          h('div', { class: 'bar' }, h('i', { class: 'tr' }), h('i', { class: 'hp', style: { background: tc } })),
          mine ? h('div', { class: 'trust', title: 'Trust in your calls' }, h('i')) : null,
          h('div', { class: 'st' }, ''),
          h('div', { class: 'its' })),
        h('div', { class: 'hpmini' }, h('i', { class: 'tr' }), h('i', { class: 'hp', style: { background: tc } })),
        mine ? null : h('div', { class: 'mia hidden' }, 'MIA'));
      row._hero = hero;
      row._q = { lv: row.querySelector('.lv'), dead: row.querySelector('.dead'), deadT: row.querySelector('.dead b'), kda: row.querySelector('.kda'), bar: row.querySelector('.bar .hp'), barT: row.querySelector('.bar .tr'),
        mini: row.querySelector('.hpmini .hp'), miniT: row.querySelector('.hpmini .tr'),
        trust: row.querySelector('.trust i'), st: row.querySelector('.st'), own: row.querySelector('.own'), its: row.querySelector('.its'), mia: row.querySelector('.mia'), ult: row.querySelector('.ultdot'), stb: row.querySelector('.stb'), last: 1 };
      // tap: follow (tap again: build sheet / focus) · hold or right-click: details popover
      let lpT = 0, sx = 0, sy = 0;
      row.addEventListener('click', () => {
        if (row._lp) { row._lp = false; return; }
        this.selectHero(hero); if (this.my >= 0) { if (this.r.follow === hero.id) this.dock.open('hero:' + hero.id); else this.dock.close(); }
      });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.openPop(hero, row); });
      row.addEventListener('pointerdown', (e) => { if (e.button) return; sx = e.clientX; sy = e.clientY; clearTimeout(lpT); lpT = setTimeout(() => { row._lp = true; this.openPop(hero, row); audio.sfx('move', 0.4); }, 430); });
      row.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) clearTimeout(lpT); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(ev, () => clearTimeout(lpT));
      return row;
    };
    this.mineRows = g.teams[this.view].heroes.map((x) => card(x, true));
    this.enemyRows = g.teams[1 - this.view].heroes.map((x) => card(x, false));
    const clanTags = (t) => h('div', { class: 'clantags' }, ...(g.teams[t].clans || []).map((c) => h('span', { style: { borderColor: CLANS[c.clan].color, color: CLANS[c.clan].color }, title: c.text }, `${CLANS[c.clan].name} ${c.n}`)));
    this.leadEl = this.coopTeam() && this.coopTeam().seats === 2 ? h('button', { class: 'coopbar', onclick: () => this.tapLead() }) : null;
    mount(this.el.mine, this.leadEl, clanTags(this.view), this.mineRows);
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
      h('button', { class: 'btn small', title: 'Settings (pauses vs AI)', onclick: () => openSettingsModal(this.runner) }, 'Opt'),
      (document.fullscreenEnabled || document.webkitFullscreenEnabled) ? h('button', { class: 'btn small fullbtn', title: 'Full screen', onclick: () => window.toggleFullscreen() }, 'Full') : null,
      h('button', { class: 'btn small', onclick: () => this.app.quitMatch() }, 'Quit')));
    // Phones: one Menu button reveals the controls (CSS decides when it shows).
    ctrl.unshift(h('button', { class: 'btn small menubtn', onclick: () => { this.el.ctrl.classList.toggle('open'); audio.sfx('move', 0.4); } }, 'Menu'));
    mount(this.el.ctrl, ctrl);
    // #ctrl and #scorebar outlive a match: assign (not add) their handlers so an old HUD never answers a tap
    this.el.ctrl.onclick = (e) => { if (e.target.closest('.seg') && this.el.ctrl.classList.contains('open')) setTimeout(() => this.el.ctrl.classList.remove('open'), 150); };
    this.refreshCtrl();
    this.dock = new Dock(this);
    this.objTaken = [{ dragon: 0, herald: 0, baron: 0 }, { dragon: 0, herald: 0, baron: 0 }];
    this.el.score.onclick = () => this.toggleScoreboard();
    this.el.score.title = 'Tap for the scoreboard [Tab]';
    this.buildFoeStrip();
    this.buildObjBar();
  }
  refreshCtrl() {
    for (const b of this.el.ctrl.querySelectorAll('.spd')) b.classList.toggle('on', b._s === 0 ? this.runner.paused : (!this.runner.paused && this.runner.speed === b._s));
    this.dirBtn.classList.toggle('on', this.director);
    if (this.fogBtn) this.fogBtn.classList.toggle('on', this.r.fogOn);
  }
  toggleDirector() { this.director = !this.director; if (this.director) this.r.follow = null; this.refreshCtrl(); }
  manualCam() { if (this.fightCam) this.fightCam.track = false; if (this.director) { this.director = false; this.refreshCtrl(); } }
  selectHero(hero) {
    if (this.r.follow === hero.id) { this.r.follow = null; this.sel = null; }
    else { this.r.follow = hero.id; this.sel = hero; if (!hero.alive) { this.r.cam.x = hero.x; this.r.cam.y = hero.y; } }
    this.director = false; this.refreshCtrl(); this.renderDetail(true);
  }

  // ───────────────────────── co-op ─────────────────────────
  coopTeam() { return this.coop ? this.g.teams[this.my].coop || null : null; }
  ownHero(x) { const ct = this.coopTeam(); return !ct || ct.ai || x.seat === this.seat; }
  isLead() { const ct = this.coopTeam(); return !ct || ct.ai || ct.lead === this.seat; }
  coachName(seat) { const c = this.coop && coachOf(this.coop, this.my, seat); return c ? c.name : 'Partner'; }
  // Could this coach issue it (no side effects)?
  mayCommand(cmd) { const ct = this.coopTeam(); return !ct || ct.ai || canCommand(this.g, this.my, this.seat, cmd); }
  // Gate for every outgoing call: true = send it; 'sug' = it went to the lead as a suggestion; false = not ours.
  coopGate(cmd) {
    if (this.mayCommand(cmd)) return true;
    const ct = this.coopTeam();
    if (HERO_CMDS.has(cmd.type)) {
      const x = this.g.byId(cmd.hero) || this.g.teams[this.my].heroes.find((y) => y.role === 'jungle');
      toast(`${x ? x.def.name : 'That hero'} is ${this.coachName(1 - this.seat)}'s hero`, 1600); audio.sfx('cancel', 0.5); return false;
    }
    const now = performance.now();
    if (now - (this._sugAt || 0) < 2500) { toast('Suggestion sent: give the lead a moment', 1400); return false; }
    this._sugAt = now;
    this.app.net && this.app.net.t.send({ t: 'sug', team: this.my, cmd, p: this.coop.slot });
    toast(`Suggested to ${this.coachName(ct.lead)}: ${this.callText({ ...cmd, team: this.my })}`, 1800);
    const p = this.callPoint(cmd); this.mm.ping(p[0], p[1], COOP_COL[this.seat]);
    return 'sug';
  }
  // The lead hears a partner's suggestion: one tap to make the call.
  coopSuggest(m) {
    const cmd = m.cmd, ct = this.coopTeam();
    if (!ct || ct.ai || ct.lead !== this.seat || !cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string' || HERO_CMDS.has(cmd.type) || cmd.type === 'lead' || cmd.type === 'leave' || cmd.sys) return;
    const p = this.coop.players.find((x) => x.slot === m.p); if (!p || p.team !== this.my) return;
    const c = { ...cmd }; delete c.team; delete c.seat; delete c.seq;
    this.dock.partnerSuggestion(p.name, p.seat, c, this.callText({ ...c, team: this.my }));
    const pt = this.callPoint(c); this.mm.ping(pt[0], pt[1], COOP_COL[p.seat]);
  }
  // The lead badge above your portraits: who makes team calls. The lead taps it twice to hand the calls over.
  updateCoop() {
    const ct = this.coopTeam(); if (!ct || !this.leadEl) return;
    const solo = ct.ai || ct.left[0] || ct.left[1], lead = ct.lead === this.seat, arm = this._passArm && performance.now() < this._passArm;
    const key = `${solo}|${ct.lead}|${arm}`;
    if (this._leadKey === key) return;
    this._leadKey = key;
    this.leadEl.style.setProperty('--sc', COOP_COL[ct.lead]);
    this.leadEl.classList.toggle('solo', solo); this.leadEl.classList.toggle('arm', !!arm);
    this.leadEl.title = solo ? 'Your partner left: you run all five heroes' : lead ? `You make the team calls. Tap twice to hand them to ${this.coachName(1 - this.seat)}` : `${this.coachName(ct.lead)} makes the team calls: tap a team call to suggest it`;
    mount(this.leadEl, h('i', { class: 'sl' }, solo ? '5' : 'L'), h('span', { class: 'cl' }, solo ? 'Solo' : lead ? 'You' : this.coachName(ct.lead)), h('small', {}, solo ? 'all yours' : arm ? 'Pass?' : 'lead'));
  }
  tapLead() {
    const ct = this.coopTeam(); if (!ct || ct.ai || ct.left[0] || ct.left[1]) return;
    if (ct.lead !== this.seat) { toast(`${this.coachName(ct.lead)} leads: tap a team call to suggest it`, 1800); return; }
    if (this._passArm && performance.now() < this._passArm) { this._passArm = 0; this.dock.send({ type: 'lead' }); this._leadKey = null; return; }
    this._passArm = performance.now() + 2500; this._leadKey = null; audio.sfx('move', 0.4);
    setTimeout(() => { this._leadKey = null; }, 2600);
  }

  // ───────────────────────── commands (see commands.js) ─────────────────────────
  send(cmd) { return this.dock.send(cmd); }
  callPoint(c) {
    const W = this.g.world;
    if (c.obj) { const p = c.obj === 'dragon' ? W.pits.kami : W.pits.kraken; return [p.x, p.y]; }
    if (c.type === 'shrine' && c.shrine !== undefined) { const s = this.g.shrines[c.shrine]; return [s.x, s.y]; }
    if (c.type === 'focus' || (c.type === 'permit' && c.target)) { const u = this.g.byId(c.target); if (u) return [u.x, u.y]; }
    if (c.lane && W.laneNames.includes(c.lane)) { // where the call plays out: the wave front (a gank: the enemy laner we can see there)
      const team = c.team === 0 || c.team === 1 ? c.team : Math.max(0, this.my), vis = this.g.vision[team];
      const foe = c.type === 'gank' && this.g.teams[1 - team].heroes.filter((e) => e.alive && vis && vis.has(e.id) && W.distToLane(c.lane, e) < 350)
        .sort((a, b) => W.laneProgress(c.lane, a) * (team ? -1 : 1) - W.laneProgress(c.lane, b) * (team ? -1 : 1))[0]; // the deepest one
      const p = foe || laneFront(this.g, team, c.lane); return [p.x, p.y];
    }
    return [this.r.cam.x, this.r.cam.y];
  }

  // ───────────────────────── per frame ─────────────────────────
  update(dt) {
    const g = this.g, now = performance.now();
    this.processEvents();
    if (!this.planShown) planReveal(this); // both game plans, revealed at kickoff
    if (this.director) this.directorCam(dt);
    this.trackFight(dt);
    this.applySlow();
    this.alerts.place();
    this.r.avoid = this.alerts.panelRects(); // cached 250 ms: callouts and chat bubbles keep clear of the HUD
    if (now - this.lastDom < (isTouch ? 180 : 120)) return;
    this.lastDom = now;
    this.dock.tick();
    this.updateCoop();
    this.updateScore();
    this.updateRows(this.mineRows, true);
    this.updateRows(this.enemyRows, false);
    this.updateFoeStrip();
    if (this.sbEl && now - (this._sbT || 0) > 500) { this._sbT = now; this.renderScoreboard(); }
    this.renderDetail(false);
    this.alerts.scan();
    if (this.pop) this.pop.upd();
    if (now - this.lastAnalyst > 1000) { this.lastAnalyst = now; this.analyst(); }
    this.tickTicker();
    if (this.tips) this.tips.tick();
    // halftime: decisions wait until play resumes
    if (this.holding() && this.my >= 0) { this.dock.tray.clear((it) => it.prio >= PRIO.request); this.unslow('call'); }
    this.kfItems = this.kfItems.filter((f) => { if (now - f.t > 9000) { f.el.classList.add('out'); setTimeout(() => f.el.remove(), 300); return false; } return true; });
  }

  // Score bar: built once, then every number / mark is patched in place (rebuilding the DOM every
  // second made the objective portraits flicker on phones).
  buildScore() {
    const side = (t) => {
      const tw = h('b', {}), kills = h('b', {}), pips = h('span', { class: 'drag-pips' });
      const twEl = h('div', { class: 'tw', title: 'Towers standing' }, ...(t ? [tw, h('i', { class: 'ticon' })] : [h('i', { class: 'ticon' }), tw]));
      const meta = h('div', { class: 'meta' }, ...(t ? [pips, h('span', {}, 'kills'), kills] : [kills, h('span', {}, 'kills'), pips]));
      return { el: h('div', { class: 'side ' + (t ? 'red' : 'blue') }, twEl, meta), tw, kills, pips, marks: h('div', { class: 'omarks ' + (t ? 'red' : 'blue') }), sig: '' };
    };
    this.sc = { sides: [side(0), side(1)], clock: h('div', { class: 'clock' }), wx: h('div', { class: 'wx' }), kk: h('span', { class: 'kk' }) };
    const c = this.sc, ev = this.g.event && EVENT_BY_ID[this.g.event];
    // weekly map event: a tiny icon beside the weather (tap/hover for what it changes)
    const evi = ev ? h('img', { class: 'evi', src: `assets/img/${ev.icon}.png`, alt: ev.name, title: `${ev.name}: ${ev.short}`, onclick: () => toast(`${ev.name}: ${ev.blurb}`, 3500) }) : null;
    mount(this.el.score, c.sides[0].el, h('div', { class: 'mid' }, c.clock, evi ? h('div', { class: 'wxrow' }, c.wx, evi) : c.wx), c.sides[1].el, h('div', { class: 'markrow' }, c.sides[0].marks, c.kk, c.sides[1].marks));
  }
  updateScore() {
    const g = this.g, set = setText;
    if (!this.sc) this.buildScore();
    const c = this.sc, left = g.timeLeft, wx = g.weatherList[Math.max(0, g.weatherIdx)], ot = this.objTaken || [{}, {}];
    set(c.clock, fmtTime(left)); c.clock.classList.toggle('late', left < 60);
    set(c.wx, WEATHER[wx].name); if (c.wx.title !== (WEATHER[wx].desc || '')) c.wx.title = WEATHER[wx].desc || '';
    set(c.kk, `${g.teams[0].kills} - ${g.teams[1].kills}`);
    for (let t = 0; t < 2; t++) {
      const sd = c.sides[t], team = g.teams[t];
      // a changed tally counts over and pops (juice; Reduced effects: plain update)
      const tw = g.towersStanding(t);
      if (sd.twV !== undefined && sd.twV !== tw) { tweenNumber(sd.tw, sd.twV, tw, 350); pop(sd.tw); } else if (sd.twV === undefined) set(sd.tw, tw);
      if (sd.kV !== undefined && sd.kV !== team.kills) { tweenNumber(sd.kills, sd.kV, team.kills, 350); pop(sd.kills); pop(c.kk); } else if (sd.kV === undefined) set(sd.kills, team.kills);
      sd.twV = tw; sd.kV = team.kills;
      // objective marks only change when something is taken: rebuild just this row, and only then
      const sig = team.dragons.join() + '|' + ot[t].herald + '|' + ot[t].baron + '|' + g.shrines.map((x) => x.owner === t ? 1 : 0).join('');
      if (sig === sd.sig) continue;
      sd.sig = sig;
      mount(sd.pips, team.dragons.map((d) => h('i', { style: { background: DRAGON_INFO[d].color }, title: DRAGON_INFO[d].name })));
      const omi = (k, n, title) => (n ? h('span', { class: 'omi', title }, h('img', { src: bossFace(k) }), n > 1 ? n : null) : null);
      mount(sd.marks, team.dragons.map((d) => h('span', { class: 'omi kami', title: DRAGON_INFO[d].name, style: { color: DRAGON_INFO[d].color } }, h('img', { src: bossFace('dragon', d) }))),
        omi('herald', ot[t].herald, 'Oni taken'), omi('baron', ot[t].baron, 'Kraken taken'),
        g.shrines.filter((x) => x.owner === t).map(() => h('i', { class: 'oms', title: 'Shrine held' })));
    }
    this.updateObjBar();
  }

  // Compact screens: every hero's portrait stays visible (enemies show only death timers).
  buildFoeStrip() {
    const el = document.getElementById('foestrip'); if (!el) return;
    this.foeCells = this.g.teams[1 - this.view].heroes.map((x) => {
      const t = h('b', {}); const c = h('div', { class: 'foe', title: x.def.name }, h('img', { src: face(x.heroId) }), t);
      c._x = x; c._t = t; return c;
    });
    mount(el, this.foeCells);
  }
  updateFoeStrip() {
    if (!this.foeCells) return;
    for (const c of this.foeCells) {
      const x = c._x, dead = !x.alive;
      c.classList.toggle('dead', dead);
      const v = dead ? String(Math.max(0, Math.ceil((x.respawnAt - this.g.tick) / TICK_RATE))) : '';
      if (c._t.textContent !== v) c._t.textContent = v;
    }
  }
  // Scoreboard: both teams' KDA, CS, gold and items. Tap the score (or hold Tab).
  toggleScoreboard(force) {
    const open = force !== undefined ? force : !this.sbEl;
    if (!open) { if (this.sbEl) { this.sbEl.remove(); this.sbEl = null; } return; }
    if (this.sbEl) return;
    this.sbEl = h('div', { id: 'scoreboard', onclick: () => this.toggleScoreboard(false) });
    document.getElementById('hud').append(this.sbEl);
    this.renderScoreboard();
  }
  renderScoreboard() {
    if (!this.sbEl) return;
    const g = this.g;
    const row = (x) => h('div', { class: 'sbr' + (x.alive ? '' : ' dead') },
      h('img', { class: 'sbf', src: face(x.heroId) }), h('span', { class: 'sbn' }, x.def.name), h('span', { class: 'sbl' }, x.level),
      h('span', { class: 'sbk' }, `${x.kills}/${x.deaths}/${x.assists}`), h('span', { class: 'sbc' }, x.cs), h('span', { class: 'sbg' }, `${(x.goldEarned / 1000).toFixed(1)}k`),
      h('span', { class: 'sbi' }, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name }))),
      x.alive ? null : h('b', { class: 'sbd' }, Math.ceil((x.respawnAt - g.tick) / TICK_RATE)));
    const team = (t) => h('div', { class: 'sbt ' + (t ? 'red' : 'blue') },
      h('div', { class: 'sbh' }, h('b', {}, `${TEAM_NAME[t]}${t === this.my ? ' (you)' : ''}`), h('span', {}, `${g.teams[t].kills} kills · ${g.towersStanding(t)} towers`)),
      h('div', { class: 'sbr sbhead' }, h('span', { class: 'sbf' }), h('span', { class: 'sbn' }, 'Hero'), h('span', { class: 'sbl' }, 'Lv'), h('span', { class: 'sbk' }, 'K/D/A'), h('span', { class: 'sbc' }, 'CS'), h('span', { class: 'sbg' }, 'Gold'), h('span', { class: 'sbi' }, 'Items')),
      ...g.teams[t].heroes.map(row));
    mount(this.sbEl, h('div', { class: 'sbcard' }, team(0), team(1), h('small', { class: 'muted center' }, 'Tap anywhere to close')));
  }

  // Objective / shrine timers: built once, updated in place (no image reloads, no flicker).
  buildObjBar() {
    const g = this.g;
    this.objCells = ['dragon', 'herald', 'baron'].map((k) => {
      const img = h('img', { src: bossFace(k, kamiNow(g)) }), lab = h('span', {}), val = h('b', {});
      const el = h('div', { class: 'ot', title: OBJ_L[k], onclick: () => this.my >= 0 && this.dock.open('objective') }, img, lab, val);
      return { k, el, img, lab, val };
    });
    this.shrCells = g.shrines.map((sh) => { const dot = h('span', { class: 'shr' }), val = h('b', {}); return { sh, dot, val, el: h('div', { class: 'ot', title: 'River shrine', onclick: () => this.my >= 0 && this.dock.press('shrine') }, dot, val) }; });
    mount(this.el.obj, this.objCells.map((c) => c.el), this.shrCells.map((c) => c.el));
  }
  updateObjBar() {
    const g = this.g, set = setText;
    for (const c of this.objCells) {
      const k = c.k, o = g.objectives[k], tmr = g.objTimers[k];
      const hide = (k === 'herald' && (g.time > g.T.heraldDespawn || g.objectives.baron)) || (k === 'baron' && g.time < g.T.heraldDespawn - 60 && !o);
      c.el.classList.toggle('hidden', !!hide); if (hide) continue;
      const up = !!(o && o.alive);
      if (k === 'dragon') { const el = kamiNow(g), src = bossFace(k, el); set(c.lab, DRAGON_INFO[el].short); if (c.img.getAttribute('src') !== src) c.img.setAttribute('src', src); }
      else set(c.lab, OBJ_L[k]);
      set(c.val, up ? 'UP' : tmr ? fmtTime(Math.max(0, (tmr - g.tick) / TICK_RATE)) : '—');
      c.el.classList.toggle('up', up);
      c.el.classList.toggle('soon', !up && !!tmr && tmr - g.tick < 30 * TICK_RATE);
    }
    for (const c of this.shrCells) {
      const bg = c.sh.owner >= 0 ? TEAM_COL[c.sh.owner] : '#ffe9a8';
      setCss(c.dot, 'background', bg); // (style.background reads back as rgb(): compare with the cached value)
      set(c.val, c.sh.owner < 0 ? '—' : c.sh.owner === this.view ? 'Ours' : 'Theirs');
    }
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
      case 'cover': return `Covering ${L(t.lane)}`;
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
      setText(q.lv, x.level);
      q.dead.classList.toggle('hidden', x.alive);
      if (!x.alive) setText(q.deadT, Math.max(0, Math.ceil((x.respawnAt - g.tick) / TICK_RATE)));
      setText(q.kda, `${x.kills}/${x.deaths}/${x.assists}`);
      const pct = x.alive ? (vis ? x.hp / x.maxHp : 0) : 0, w = Math.round(pct * 200) / 2 + '%';
      setCss(q.bar, 'width', w); setCss(q.mini, 'width', w); setCss(q.barT, 'width', w); setCss(q.miniT, 'width', w);
      // juice: hit flash on a big chunk of damage, pulse when low
      if (x.alive && vis && pct < q.last - 0.07) { row.classList.remove('hit'); void row.offsetWidth; row.classList.add('hit'); }
      q.last = pct;
      row.classList.toggle('low', x.alive && vis && pct < 0.3);
      if (q.own) { const seat = x.seat === 1 ? 1 : 0; if (q.seat !== seat) { q.seat = seat; setCss(q.own, '--sc', COOP_COL[seat]); row.style.setProperty('--sc-mate', COOP_COL[seat]); q.own.title = seat === this.seat ? 'Your hero' : `${this.coachName(seat)}'s hero`; row.classList.toggle('mate', seat !== this.seat); } }
      if (q.trust) { setCss(q.trust, 'width', Math.round(x.trust) + '%'); setCss(q.trust, 'background', x.trust >= 70 ? 'var(--green)' : x.trust <= 30 ? 'var(--red)' : 'var(--gold)'); }
      setText(q.st, mine ? this.taskLabel(x) : (vis ? (x.alive ? this.taskLabelEnemy(x) : this.taskLabel(x)) : this.missingText(x)));
      if (q.its.childElementCount !== x.items.length) mount(q.its, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
      if (q.mia) { row.classList.toggle('mia', !vis && x.alive); q.mia.classList.toggle('hidden', vis || !x.alive); }
      const ultUp = mine && x.alive && x.level >= 5 && g.abilityReady(x, 2);
      if (ultUp && q.ult.classList.contains('hidden')) { row.classList.remove('ultpop'); void row.offsetWidth; row.classList.add('ultpop'); }
      q.ult.classList.toggle('hidden', !ultUp); q.ult.classList.toggle('emp', !!(ultUp && x.ultUp));
      // mood badge (your heroes only): tilted > inspired > doubtful
      const mood = !mine || this.my < 0 || !x.alive ? null : x.tiltUntil > g.tick ? 'tilt' : x.trust >= 70 ? 'up' : x.trust <= 30 ? 'doubt' : null;
      if (mood !== q.mood) {
        q.mood = mood; q.stb.classList.toggle('hidden', !mood);
        if (mood) { q.stb.src = `assets/img/emote/${mood}.png`; q.stb.title = { tilt: 'Tilted', up: 'Inspired', doubt: 'Doubtful' }[mood]; }
        row.dataset.mood = mood || '';
      }
    }
  }
  // ── press-and-hold / right-click details popover ──
  openPop(x, row) {
    if (this.pop && this.pop.id === x.id) return;
    this.closePop();
    const g = this.g, pers = PERSONALITIES[x.def.pers], mine = x.team === this.view && this.my >= 0;
    const abl = x.def.abilities.map((ab, i) => h('div', { class: 'abl', title: ab.name }, h('img', { src: icon(ab.icon) }), h('div', { class: 'cd' }), h('span', { class: 'k' }, ab.ult ? 'R' : ['Q', 'W'][i])));
    const els = { hp: h('i'), trust: h('i'), trustL: h('small', {}), stats: h('div', { class: 'pstats' }), task: h('div', { class: 'ptask' }), why: h('div', { class: 'pwhy' }), items: h('div', { class: 'its' }), tal: h('div', { class: 'ptal' }) };
    const el = h('div', { id: 'hpop', class: 'hpop' },
      h('div', { class: 'phead' }, h('img', { class: 'pface', src: face(x.heroId), style: { borderColor: `var(--team${x.team})` } }),
        h('div', { class: 'pcol' }, h('b', { style: { color: `var(--team${x.team})` } }, x.def.name), h('small', { class: 'muted' }, x.def.title),
          h('div', { class: 'pchips' }, h('span', { class: 'pchip', style: { color: CLANS[x.def.clan].color, borderColor: CLANS[x.def.clan].color } }, CLANS[x.def.clan].name),
            h('span', { class: 'pchip', style: { color: pers.color, borderColor: pers.color } }, pers.name),
            h('span', { class: 'pchip', style: { color: BUILDS[x.build].color, borderColor: BUILDS[x.build].color } }, BUILDS[x.build].name))),
        h('button', { class: 'x', onclick: () => this.closePop() }, 'X')),
      h('div', { class: 'pdesc' }, pers.desc),
      h('div', { class: 'pbarrow' }, h('span', {}, 'HP'), h('div', { class: 'pbar hp' }, els.hp)),
      mine ? h('div', { class: 'pbarrow' }, h('span', {}, 'Trust'), h('div', { class: 'pbar tr' }, els.trust), els.trustL) : null,
      h('div', { class: 'ablrow' }, ...abl, els.items), x.tal ? els.tal : null, els.stats, els.task, els.why);
    document.body.append(el);
    const upd = () => {
      const vis = mine || this.my < 0 || !this.r.fogOn || g.vision[this.view].has(x.id);
      els.hp.style.width = (x.alive && vis ? x.hp / x.maxHp * 100 : 0) + '%';
      if (mine) {
        els.trust.style.width = x.trust + '%'; els.trust.style.background = x.trust >= 70 ? 'var(--green)' : x.trust <= 30 ? 'var(--red)' : 'var(--gold)';
        els.trustL.textContent = (x.tiltUntil > g.tick ? 'Tilted · ' : '') + (x.trust >= 70 ? 'Inspired' : x.trust <= 30 ? 'Doubtful' : 'Steady');
      }
      x.def.abilities.forEach((ab, i) => {
        const c = abl[i].children[1], locked = ab.ult && x.level < 5, left = Math.max(0, (x.cds[i] - g.tick) / TICK_RATE);
        const t = !mine && this.my >= 0 ? '' : locked ? 'L5' : left > 0 ? String(Math.ceil(left)) : '';
        if (c.textContent !== t) c.textContent = t; abl[i].classList.toggle('cool', mine || this.my < 0 ? (locked || left > 0) : false);
      });
      if (els.items.childElementCount !== x.items.length) mount(els.items, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
      if (x.tal && els.tal._k !== talentKey(x) + x.ultUp) { els.tal._k = talentKey(x) + x.ultUp; mount(els.tal, h('span', { class: 'muted' }, 'Talents'), talentIcons(x), x.ultUp ? h('b', { class: 'pemp' }, 'Ult empowered') : null); }
      els.stats.textContent = `Lv ${x.level}  ·  ${x.kills}/${x.deaths}/${x.assists}  ·  ${x.cs} CS  ·  ${Math.round(x.goldEarned / 100) / 10}k gold`;
      els.task.textContent = !x.alive ? this.taskLabel(x) : mine ? this.taskLabel(x) : vis ? this.taskLabelEnemy(x) : this.missingText(x);
      setText(els.why, this.whyText(x));
    };
    upd();
    // place beside the card, clamped to the viewport
    const rb = row.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let left = rb.left + rb.width / 2 < W / 2 ? rb.right + 6 : rb.left - pw - 6;
    left = Math.max(6, Math.min(W - pw - 6, left));
    const top = Math.max(6, Math.min(H - ph - 6, rb.top));
    el.style.left = left + 'px'; el.style.top = top + 'px';
    this.pop = { id: x.id, el, upd };
  }
  closePop() { if (this.pop) { this.pop.el.remove(); this.pop = null; } }
  // Online quick chat (non-sim messages; see quickchat.js).
  enableChat(send, opts) { if (!this.chat) this.chat = new QuickChat(this, send, opts); return this.chat; }
  disableChat() { if (this.chat) { this.chat.destroy(); this.chat = null; } }
  destroy() { if (Hud.current === this) Hud.current = null; this.closePop(); if (this.tips) this.tips.destroy(); this.alerts.destroy(); this.disableChat(); clearTimeout(this._bt); document.getElementById('hud').classList.remove('bannering'); window.removeEventListener('pointerdown', this._popClose, true); }
  // The AI's own short reason for what it is doing (hero.why, e.g. "lane: hold behind wave"), for your own
  // heroes and spectators only: an enemy's reason would leak what the fog hides.
  whyText(x) {
    if (!x.alive || !x.why || (this.my >= 0 && x.team !== this.my)) return '';
    const w = String(x.why).replace(/\bhp\b/g, 'HP');
    return 'Why: ' + w[0].toUpperCase() + w.slice(1);
  }
  taskLabelEnemy(x) { return this.g.tick - x.lastHitHero < TICK_RATE * 1.5 ? 'Fighting!' : `Seen ${placeName(this.g.world, x, { my: this.my, g: this.g }).tag}`; }
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
      this._det = { id: x.id, abl, xp: h('i'), hp: h('i'), stats: h('div', { class: 'stats' }), info: h('div', { class: 'dinfo' }), why: h('div', { class: 'dwhy' }), items: h('div', { class: 'its' }), tal: h('div', { class: 'dtal' }) };
      mount(this.el.detail,
        h('div', { class: 'dhead' }, h('img', { class: 'dface', src: face(x.heroId) }),
          h('div', { class: 'dcol' },
            h('div', { class: 'dname' }, h('span', { style: { color: TEAM_COL[x.team] } }, x.def.name), h('span', { class: 'muted' }, ` ${x.def.title}`)),
            h('div', { class: 'dtags' }, h('span', { style: { color: CLANS[x.def.clan].color } }, CLANS[x.def.clan].name), h('span', { style: { color: pers.color } }, pers.name), h('span', { style: { color: BUILDS[x.build].color } }, BUILDS[x.build].name)),
            h('div', { class: 'dbar hp' }, this._det.hp), h('div', { class: 'dbar xp' }, this._det.xp))),
        h('div', { class: 'ablrow' }, ...abl, this._det.items, x.tal ? this._det.tal : null), this._det.stats, this._det.info, this._det.why);
    }
    const d = this._det;
    setCss(d.hp, 'width', Math.round(x.alive ? x.hp / x.maxHp * 200 : 0) / 2 + '%');
    setCss(d.xp, 'width', Math.round(Math.min(100, x.xp / xpNeeded(x.level) * 100)) + '%');
    x.def.abilities.forEach((ab, i) => {
      const el = d.abl[i].children[1];
      const locked = ab.ult && x.level < 5;
      const left = Math.max(0, (x.cds[i] - g.tick) / TICK_RATE);
      setText(el, locked ? 'L5' : left > 0 ? Math.ceil(left) : '');
      d.abl[i].classList.toggle('cool', locked || left > 0);
    });
    if (d.items.childElementCount !== x.items.length) mount(d.items, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name })));
    if (x.tal && d.tal._k !== talentKey(x)) { d.tal._k = talentKey(x); mount(d.tal, talentIcons(x)); }
    d.abl[2].classList.toggle('emp', !!x.ultUp);
    setText(d.stats, `AD ${Math.round(s.ad)}  AP ${Math.round(s.ap)}  AR ${Math.round(s.armor)}  MR ${Math.round(s.mr)}  AS ${s.as.toFixed(2)}  MS ${Math.round(g.moveSpeed(x))}`);
    setText(d.info, `Lv ${x.level} · ${x.kills}/${x.deaths}/${x.assists} · ${x.cs} CS · ${Math.round(x.goldEarned / 100) / 10}k` + (x.team === this.my ? ` · Trust ${Math.round(x.trust)}${x.tiltUntil > g.tick ? ' (tilted)' : ''}` : '') + ` · ${this.taskLabel(x)}`);
    const why = this.whyText(x); setText(d.why, why); d.why.classList.toggle('hidden', !why);
  }

  // ───────────────── events → feeds / banners (match sounds: src/audio-match.js) ─────────────────
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
          this.cast(e, kt);
          if (this.my >= 0) buzz(g.teams[v.team].heroes.every((x) => !x.alive) ? 'big' : kt === this.my ? 'kill' : 'death');
          break;
        }
        case 'objective': {
          if (e.team === 0 || e.team === 1) this.objTaken[e.team][e.obj]++;
          const nm = e.obj === 'dragon' ? DRAGON_INFO[e.element].name : OBJ_L[e.obj];
          this.ticker(`${TEAM_NAME[e.team]} ${e.steal ? 'STOLE' : 'took'} ${nm}${e.killer ? ' (' + this.name(e.killer) + ')' : ''}`, e.team === 0 ? 'b' : 'r', 3);
          this.banner(`${e.steal ? 'STOLEN! ' : ''}${nm.toUpperCase()}`, TEAM_COL[e.team], 2200, bossFace(e.obj, e.element));
          this.cast(e, e.team);
          if (this.my >= 0 && (e.team === 0 || e.team === 1)) buzz(e.team === this.my ? 'objective' : 'objectiveLost');
          break;
        }
        case 'soul': this.banner(`${DRAGON_INFO[e.element].short.toUpperCase()} BLESSING`, TEAM_COL[e.team], 2400); this.cast(e, e.team); break;
        case 'shrine': this.ticker(`${TEAM_NAME[e.team]} captured a shrine`, e.team === 0 ? 'b' : 'r', 2); break;
        case 'weather': if (g.tick <= 5 && g.event && EVENT_BY_ID[g.event]) { const ev = EVENT_BY_ID[g.event]; this.ticker(`Weekly event · ${ev.name}: ${ev.short}`, 'n', 0); }
          if (g.tick > 5) { const W_ = WEATHER[e.weather]; this.ticker(`Weather: ${W_.name}${W_.desc ? ' — ' + W_.desc : ''}`, 'n', 0); } break;
        case 'tower': this.ticker(`${TEAM_NAME[e.team]} destroyed the ${towerName(g.world, e)}`, e.team === 0 ? 'b' : 'r', 2); break;
        case 'inhib': this.ticker(`${TEAM_NAME[e.team]} broke the ${LANE_L[e.lane]} gate!`, e.team === 0 ? 'b' : 'r', 3); this.banner('GATE DESTROYED', TEAM_COL[e.team]); break;
        case 'inhibRespawn': this.ticker(`${TEAM_NAME[e.team]} ${LANE_L[e.lane]} gate restored`, 'n', 0); break;
        case 'spawn': this.ticker(`${e.obj === 'dragon' ? DRAGON_INFO[e.element].name : OBJ_L[e.obj]} has awakened`, 'act', 2); break;
        case 'heraldDrop': this.ticker(`${TEAM_NAME[e.team]} unleashed the Oni ${LANE_L[e.lane]}!`, e.team === 0 ? 'b' : 'r', 2); break;
        case 'call': {
          const c = e.call;
          if (c.type === 'ult' && c.mode === 'go' && (c.team === this.view || this.my < 0)) this.banner('ALL-IN!', TEAM_COL[c.team], 1200);
          // co-op: your partner's calls read on the ticker in their colour (with a ping where it lands)
          if (this.coop && c.team === this.my && c.seat !== undefined && c.seat !== this.seat) {
            this.ticker(`${this.coachName(c.seat)}: ${this.callText(c)}`, c.seat === 1 ? 'mate s1' : 'mate s0', 1);
            const pt = this.callPoint(c); this.mm.ping(pt[0], pt[1], COOP_COL[c.seat]);
            break;
          }
          // spectators read both coaches' calls on the ticker; a coach sees their own call on the map (ping + emotes)
          if (this.my >= 0 || c.type === 'tactic') break;
          this.ticker(`${TEAM_NAME[c.team]} call: ${this.callText(c)}`, c.team === 0 ? 'b' : 'r', 0);
          break;
        }
        case 'callResult': if (e.team === this.my) { this.payoff(e); buzz(e.result === 'success' ? 'callWin' : 'callFail'); } break;
        case 'momentumFull': if (e.team === this.my && this.isLead()) this.dock.surgeOffer(); break;
        case 'coop': {
          // the lead changed hands, or a coach left (their heroes go to the partner, or to the AI coach)
          if (!this.coop) break;
          const name = (t, seat) => { const c = coachOf(this.coop, t, seat); return c ? c.name : 'A coach'; };
          if (e.team !== this.my) { if (e.what === 'leave') this.ticker(`${name(e.team, e.seat)} (${TEAM_NAME[e.team]}) left: ${e.to >= 0 ? 'their partner runs it all' : 'the AI coach takes over'}`, 'n', 1); break; }
          if (e.what === 'lead') { this.ticker(e.seat === this.seat ? 'You lead the team calls now' : `${name(e.team, e.seat)} leads the team calls now`, 'act', 2); this._leadKey = null; }
          else if (e.what === 'leave' && e.seat !== this.seat) { this.ticker(`${name(e.team, e.seat)} left: ${e.to === this.seat ? 'their heroes are yours now' : 'the AI coach takes over'}`, 'danger', 3); this._leadKey = null; }
          break;
        }
        case 'moment': momentFx(this, e); break;
        case 'plan': planSwitch(this, e); break;
        case 'surge':
          if (e.team === this.view || this.my < 0) { this.banner('KAMI SURGE', TEAM_COL[e.team], 1500); }
          else this.ticker('Enemy Kami Surge! +10% damage for 8s', 'danger', 3);
          break;
        case 'victory':
          if (e.timeout) this.banner(`TIME!  ${e.towers[0]} - ${e.towers[1]} TOWERS`, '#ffd84a', 1500, null, true);
          this.banner(this.my < 0 ? `${TEAM_NAME[e.team].toUpperCase()} WINS` : e.team === this.my ? 'VICTORY' : 'DEFEAT', e.team === this.my || this.my < 0 ? TEAM_COL[e.team] : '#ff5a5a', 4000, null, !e.timeout);
          if (this.my >= 0) buzz(e.team === this.my ? 'big' : 'objectiveLost');
          break;
        case 'ultCast': {
          // fight cam: the first big ultimate after cutting to a fight plays in brief slow motion
          const fc = this.fightCam, x = g.byId(e.hero);
          if (fc && !fc.slowed && performance.now() < fc.until && x && (x.x - fc.x) ** 2 + (x.y - fc.y) ** 2 < 800 * 800 && !settings.reducedMotion) { fc.slowed = true; this.slow('fight', 0.35, 1300); }
          break;
        }
        case 'pivot': if (e.team === this.view) this.ticker(`${this.name(e.hero)} will now build ${BUILDS[e.build].name}`, 'n', 0); break;
        case 'trust': if (e.team === this.view && this.my >= 0) { const x = g.byId(e.hero); this.ticker(e.tier === 2 ? `${x.def.name} is Inspired by your calls!` : e.tier === 0 ? `${x.def.name} is losing faith in your calls` : `${x.def.name} trusts you again`, e.tier === 0 ? 'danger' : 'n', 1); } break;
        case 'tactic': if (e.team === this.view || this.my < 0) { this.banner(TACTICS[e.card].name.toUpperCase(), TEAM_COL[e.team], 1500); } break;
        case 'finalPhase': this.banner('LAST STAND', '#ff8a3a', 2200, null); this.ticker(`Final ${Math.round(g.timeLeft / 60)} minutes: gold ×1.5, longer respawns. Every tower counts!`, 'act', 3); break;
        case 'stolenCamp': if (e.big && e.team !== this.view) this.ticker('Enemy invaded your jungle!', 'danger', 2); break;
      }
      if (this.depth) this.depth.event(e);
    }
  }
  // A call in words (spectator ticker, a co-op partner's calls and suggestions).
  callText(c) {
    return c.type === 'gank' ? `${c.hero ? this.name(c.hero) : 'Jungler'} gank ${LANE_L[c.lane]}` : c.type === 'objective' ? `Take ${OBJ_L[c.obj]}` : c.type === 'group' ? `Group ${LANE_L[c.lane]}` :
      c.type === 'split' ? `${this.name(c.hero)} split ${LANE_L[c.lane]}` : c.type === 'focus' ? `Focus ${this.name(c.target)}` : c.type === 'build' ? `${this.name(c.hero)} → ${(BUILDS[c.build] || {}).name || 'new build'}` :
      c.type === 'herald' ? `Oni ${LANE_L[c.lane]}` : c.type === 'shrine' ? 'Capture shrine' : c.type === 'safe' ? 'Play safe' : c.type === 'reset' ? 'Reset' : c.type === 'invade' ? 'Invade' :
      c.type === 'permit' ? `${this.name(c.hero)} green-lit` : c.type === 'talent' ? `${this.name(c.hero)} talent` : c.type === 'item' ? `${this.name(c.hero)} item swap` : c.type === 'surge' ? 'Kami Surge' : c.type === 'moment' ? (MOMENTS[c.id] || {}).name || 'Coach Moment' :
      c.type === 'tactic' ? `${(TACTICS[c.card] || {}).name || 'Tactic card'}${c.lane ? ' ' + LANE_L[c.lane] : c.hero ? ' on ' + this.name(c.hero) : ''}` :
      c.type === 'ult' ? ({ go: 'ALL-IN, ultimates fire next fight!', save: 'Hold ultimates', free: 'Ults: heroes choose' })[c.mode] || 'Ult stance' : c.type === 'plan' ? `Plan: ${planName(c.plan)}` : c.type === 'redraw' ? 'Swapped a tactic card' : 'Cancel calls';
  }
  // One-line priority ticker under the score. A more important line holds the slot for 2.5s;
  // lesser lines queue briefly and are dropped if they go stale.
  // Caster line for a big moment (one ticker line; a multi-kill of 3+ also gets a banner).
  cast(e, team) {
    const l = this.caster.line(e); if (!l) return;
    // a big kill (multi-kill, shutdown, ace) on screen: a beat of hit-stop and a camera punch
    if (e.type === 'kill' && l.prio >= 4 && this.r.onScreen(e.x, e.y, 60) && this.r.visiblePoint(e.x, e.y)) this.r.impact(l.prio >= 6 ? 0.2 : 0.14, l.prio >= 6 ? 0.06 : 0.04);
    this.ticker(l.text, 'cast', l.prio);
    if (l.big) this.banner(l.big + '!', TEAM_COL[team] || '#ffd84a', 1500);
  }
  ticker(text, cls = 'n', prio = 1) {
    const now = performance.now(), it = { text, cls, prio, t: now };
    if (this.tk && now - this.tk.t < 2500 && this.tk.prio > prio) { this.tkq.push(it); if (this.tkq.length > 4) this.tkq.shift(); return; }
    this.showTicker(it);
  }
  showTicker(it) {
    it.shown = performance.now(); this.tk = it;
    mount(this.el.ticker, h('div', { class: 'tline ' + it.cls }, it.text));
    this.el.ticker.classList.remove('hidden');
  }
  tickTicker() {
    if (!this.tk) return;
    const now = performance.now();
    this.tkq = this.tkq.filter((q) => now - q.t < 6000);
    if (now - this.tk.shown > 2500 && this.tkq.length) { const nx = this.tkq.sort((a, b) => b.prio - a.prio || a.t - b.t).shift(); this.showTicker(nx); return; }
    if (now - this.tk.shown > 6000) { this.tk = null; this.el.ticker.classList.add('hidden'); }
  }
  // ── call payoffs ──
  payoff(e) {
    const g = this.g, c = g.callLog[e.i]; if (!c) return;
    const nm = (id) => this.name(id);
    const what = { gank: 'Gank', objective: OBJ_L[c.obj] || 'Objective', group: `Push ${LANE_L[c.lane] || ''}`.trim(), shrine: 'Shrine', invade: 'Invade', permit: c.kind === 'split' ? `${nm(c.hero)}'s split` : `${nm(c.hero)}'s play` }[e.call] || 'Call';
    const WHY = { stolen: 'stolen by their jungler', lostTower: 'we lost a tower there', lostHero: `we lost ${nm(c.lost)}`, died: `${nm(c.hero)} died`, gankerDied: `${nm(c.heroes[0])} died first`,
      flashed: 'enemy flashed', recalled: 'target recalled', escaped: 'target escaped', empty: 'no one in lane', pickedOff: 'team got picked off', slow: 'ran out of time',
      notStarted: 'team never got there', contested: 'shrine was contested', noTower: 'no tower fell', fizzled: 'it fizzled' };
    const x = g.byId(e.hero), ok = e.result === 'success';
    const p = ok ? { ok, head: 'CALL PAID OFF', text: `${what} · +${e.delta} trust`, img: x && x.heroId ? face(x.heroId) : null }
      : { ok, head: `${what} failed:`, text: WHY[e.why] || e.result, img: null };
    this.dock.payoff(p, (q) => this.ticker(`${q.head} ${q.text}`, q.ok ? 'act' : 'danger', 2));
  }
  // ── slow motion (vs AI only: runner speed; online: render-only for the fight cam) ──
  slow(tag, k, ms) {
    if (this.runner.online) { if (tag === 'fight') this.r.visSlow = { k, until: performance.now() + ms }; return; }
    this.slows[tag] = { k, until: performance.now() + ms }; this.applySlow();
  }
  unslow(tag) { if (this.slows[tag]) { delete this.slows[tag]; this.applySlow(); } }
  applySlow() {
    if (this.runner.online) return;
    const now = performance.now(); let k = 1;
    for (const t in this.slows) { if (now > this.slows[t].until) delete this.slows[t]; else k = Math.min(k, this.slows[t].k); }
    this.runner.slow = k;
  }
  holding() { const R = this.runner, g = this.g; return !!(R.ht && !R.htDone) || (g.halftimeTick >= 0 && g.tick >= g.halftimeTick - TICK_RATE * 4 && g.tick <= g.halftimeTick + TICK_RATE * 2); }
  // ── fight cam: cut straight to a fight from its edge prompt ──
  // ids: the heroes in the fight. The camera keeps on their centroid while the fight moves (7s, or until the
  // player pans, follows a hero or the fight ends).
  watchFight(x, y, ids) {
    const r = this.r; r.follow = null; r.panTo = null; r.cam.x = x; r.cam.y = y; r.clampCam();
    this.director = false; this.refreshCtrl();
    this.fightCam = { x, y, ids: ids || [], track: !!(ids && ids.length), until: performance.now() + 7000, slowed: false };
    audio.sfx('move', 0.6);
  }
  trackFight(dt) {
    const fc = this.fightCam, r = this.r;
    if (!fc || !fc.track) return;
    if (r.follow || r.panTo || performance.now() > fc.until) { fc.track = false; return; }
    const c = followFight(r.cam, this.g, fc.ids, this.my >= 0 ? (u) => r.visible(u) : null, dt);
    if (!c) { fc.track = false; return; }
    fc.x = c.x; fc.y = c.y; fc.ids = c.ids; r.clampCam();
  }
  killfeed(killer, victim, assists) {
    if (!this.el.kf.offsetParent) { this.ticker(`${killer ? killer.def.name : 'Tower'} › ${victim.def.name}`, victim.team === 1 ? 'b' : 'r', 1); return; }
    const side = (u) => u ? h('img', { src: face(u.heroId), style: { borderColor: TEAM_COL[u.team] } }) : h('span', { class: 'exec' }, 'Tower');
    const el = h('div', { class: 'kitem ' + (victim.team === 1 ? 'b' : 'r') }, side(killer), h('span', { class: 'sw' }, assists ? `+${assists}` : '›'), side(victim));
    this.el.kf.prepend(el); this.kfItems.push({ el, t: performance.now() });
    while (this.el.kf.childElementCount > 5) this.el.kf.lastChild.remove();
  }
  // Banners queue up so a new one never cuts an old one off mid-animation.
  // node: a custom card (Coach Moments) that jumps the queue without dropping the others.
  banner(text, color, ms = 2200, img, urgent, node) {
    this.bq = this.bq || [];
    if (urgent) this.bq.length = 0;
    const it = { text, color, ms, img, node };
    if (node) this.bq.unshift(it); else this.bq.push(it);
    if (this.bq.length > 3) { if (node) this.bq.splice(3); else this.bq.splice(0, this.bq.length - 3); }
    if (!this._bannerBusy || urgent || node) this.nextBanner();
  }
  nextBanner() {
    clearTimeout(this._bt);
    const n = this.bq.shift();
    const hud = document.getElementById('hud');
    if (!n) { this._bannerBusy = false; hud.classList.remove('bannering'); mount(this.el.banner); return; }
    this._bannerBusy = true;
    // phones: the banner takes the ticker's slot right under the objective timers (CSS reads --banner-top)
    const ob = this.el.obj.getBoundingClientRect();
    if (ob.height) hud.style.setProperty('--banner-top', Math.round(ob.bottom + 3) + 'px');
    hud.classList.add('bannering');
    const b = n.node ? h('div', { class: 'big mfxb', style: { '--mc': n.color } }, n.node)
      : h('div', { class: 'big', style: { color: n.color } }, n.img ? h('img', { src: n.img }) : null, h('span', {}, n.text));
    mount(this.el.banner, b);
    const ms = this.bq.length ? Math.min(n.ms, 1300) : n.ms;
    this._bt = setTimeout(() => { b.classList.add('out'); this._bt = setTimeout(() => this.nextBanner(), 380); }, ms);
  }

  // ───────────────────────── analyst ─────────────────────────
  analyst() {
    if (this.my < 0) return;
    const g = this.g, me = this.my, vis = g.vision[me], now = g.tick;
    const ready = (k, s) => { if ((this.cool[k] || 0) > now) return false; this.cool[k] = now + s * TICK_RATE; return true; };
    const enemy = g.teams[1 - me].heroes;
    if (g.teams[me].charges >= CMD.maxCharges) this.stats.fullCharge += Math.max(0, now - this.stats.lastTick) / TICK_RATE;
    this.stats.lastTick = now;
    this.moments();
    if (this.depth) this.depth.tick(); // fight forecast
    const carding = this.dock.tray.items.some((i) => i.prio >= PRIO.request);
    for (const k of ['dragon', 'baron', 'herald']) {
      const t = g.objTimers[k];
      if (t && t - now > 0 && t - now < 30 * TICK_RATE && ready('spawnwarn' + k + t, 60)) this.ticker(`${k === 'dragon' ? DRAGON_INFO[g.teams.some((x) => x.soul) ? 'elder' : g.nextDragon].name : OBJ_L[k]} awakens in 30s`, 'act', 1);
    }
    for (const s of analystSuggestions(g, me, { cool: this.cool, carding, own: (x) => this.ownHero(x) })) {
      if (s.shrine) this.stats.shrineOpen++;
      this.dock.suggest(s.key, s.text, s.label, s.cmd, { cls: s.cls, valid: s.valid });
    }
    for (const e of enemy) {
      if (!e.alive || e.role === 'jungle' || vis.has(e.id)) { this.missing[e.id] = 0; continue; }
      const ls = g.lastSeen[me][e.id]; if (!ls) continue;
      const gone = (now - ls.t) / TICK_RATE;
      if (gone > 8 && gone < 30 && g.time > 100 && !this.missing[e.id]) { this.missing[e.id] = 1; this.ticker(`${e.def.name} is missing!`, 'danger', 2); }
    }
  }
  // Coach's Call moments and hero requests (rate-limited; never around halftime or with a sheet open).
  moments() {
    const g = this.g, me = this.my, now = g.tick, tray = this.dock.tray;
    if (g.over || this.holding() || this.dock.sheetId || g.time < 75) return;
    const cc = this.cc;
    if (cc.n < 8 && now - cc.last >= 45 * TICK_RATE && this.isLead() && !tray.items.some((i) => i.prio >= PRIO.call)) {
      const m = coachMoment(g, me, (x) => this.ownHero(x));
      if (m && !cc.keys.has(m.key)) {
        cc.keys.add(m.key); cc.last = now; cc.n++; this.stats.coachCalls++;
        this.dock.coachCall(m, {
          ttl: this.runner.online ? 7000 : 8000,
          onShow: () => { this.slow('call', 0.25, 3000); this.mm.ping(m.at.x, m.at.y, '#ffd84a'); audio.sfx('alert', 0.7); },
          onPick: () => { this.stats.coachAnswered++; },
          onEnd: () => this.unslow('call'),
        });
        return;
      }
    }
    const rq = this.rq;
    if (rq.n < 10 && now - rq.last >= 40 * TICK_RATE && g.time > 120 && !tray.items.some((i) => i.prio >= PRIO.request)) {
      for (const r of heroRequests(g, me)) {
        if (!this.ownHero(r.hero)) continue; // co-op: a hero asks its own coach
        if (Math.random() >= 0.12 * (ASK_WEIGHT[r.hero.def.pers] || 1)) continue;
        rq.last = now; rq.n++; this.stats.requests++;
        this.dock.request(r, { onYes: () => { this.stats.requestsYes++; } });
        break;
      }
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
      // a live fight: frame the middle of everyone in it, not one hero at its edge
      const f = best && fightClusters(g, (x) => this.r.visible(x)).find((q) => q.n >= 2 && (q.x - best.x) ** 2 + (q.y - best.y) ** 2 < 700 * 700);
      if (f) this._dirTarget = { x: f.x, y: f.y };
      else if (best) this._dirTarget = { x: best.x, y: best.y };
    }
    if (this._dirTarget) { const k = Math.min(1, dt * 2.5); this.r.cam.x += (this._dirTarget.x - this.r.cam.x) * k; this.r.cam.y += (this._dirTarget.y - this.r.cam.y) * k; }
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '5') { const x = this.g.teams[this.view].heroes[+k - 1]; if (x) this.selectHero(x); return; }
    if (k === ' ') { e.preventDefault(); this.toggleDirector(); return; }
    if (k === 'tab') { e.preventDefault(); this.toggleScoreboard(); return; }
    this.dock.onKey(k);
  }
}
