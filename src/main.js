// App controller: menu → lobby → draft → prep → match → results.
import { loadAssets } from './render/assets.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { bindCamera } from './render/input.js';
import { paintMap } from './render/mapgen.js';
import { Game } from './sim/game.js';
import { World } from './sim/world.js';
import { Coach } from './sim/coach.js';
import { Rng } from './sim/rng.js';
import { MAPS } from './maps/defs.js';
import { newDraft, apply as draftApply, currentTurn, autoChoice, defaultPrep, aiPrep, TURN_SECONDS } from './sim/draft.js';
import { LocalRunner, LockstepRunner } from './net/runner.js';
import { host, join, makeCode } from './net/peer.js';
import { showMenu, showLobby, DraftView, showPrep, showResults } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { toast } from './ui/dom.js';
import { audio } from './audio.js';

const VERSION = 1;
const PREP_SECONDS = 60;

class App {
  constructor() {
    this.name = 'Coach';
    try { this.name = localStorage.getItem('mobavs_name') || 'Coach'; this.aiLevel = +(localStorage.getItem('mobavs_ai') ?? 1); } catch { this.aiLevel = 1; }
    this.session = null; this.net = null; this.match = null; this.mapPref = 'random';
    this.bgCanvas = document.getElementById('bg');
  }
  // Painted map canvases are cached per map id (painting takes a moment on phones).
  mapCanvas(world) {
    this.mapCache = this.mapCache || {};
    if (!this.mapCache[world.def.id]) this.mapCache[world.def.id] = paintMap(world);
    return this.mapCache[world.def.id];
  }
  pickMap(seed) { return this.mapPref && this.mapPref !== 'random' ? this.mapPref : MAPS[seed % MAPS.length].id; }
  setName(n) { this.name = n.slice(0, 12) || 'Coach'; try { localStorage.setItem('mobavs_name', this.name); } catch { /* ignore */ } }

  async boot() {
    audio.init();
    const bar = document.querySelector('#loading .barw i');
    await loadAssets((p) => { bar.style.width = Math.round(p * 100) + '%'; });
    try { await document.fonts.load('12px PixelFont'); } catch { /* ignore */ }
    this.map = this.mapCanvas(new World(MAPS[0]));
    document.getElementById('loading').remove();
    this.startBg();
    const code = new URLSearchParams(location.search).get('join');
    if (code) this.joinScreen(code); else this.menu();
  }
  // Slowly panning painted map behind the menus.
  startBg() {
    const c = this.bgCanvas, ctx = c.getContext('2d');
    let t = 0, last = performance.now();
    const loop = (now) => {
      if (this.match) { requestAnimationFrame(loop); return; }
      const dt = (now - last) / 1000; last = now; t += dt;
      const r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) { c.width = Math.round(r.width); c.height = Math.round(r.height); }
      ctx.imageSmoothingEnabled = false;
      const z = 1.4, vw = c.width / z, vh = c.height / z;
      const cx = 1200 + Math.cos(t * 0.03) * 700, cy = 1200 + Math.sin(t * 0.03) * 700;
      ctx.drawImage(this.map, Math.max(0, cx - vw / 2), Math.max(0, cy - vh / 2), vw, vh, 0, 0, c.width, c.height);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  menu() {
    this.cleanupNet();
    this.session = null;
    this.showScreen(true);
    audio.music('menu');
    showMenu(this);
  }
  showScreen(on) {
    document.getElementById('screen').classList.toggle('hidden', !on);
    document.getElementById('bg').classList.toggle('hidden', !on);
    document.getElementById('match').classList.toggle('hidden', on);
  }

  // ───────────── modes ─────────────
  startVsAI() {
    try { localStorage.setItem('mobavs_ai', String(this.aiLevel)); } catch { /* ignore */ }
    const seed = (Math.random() * 2 ** 31) >>> 0;
    this.session = { mode: 'ai', myTeam: 0, seed, mapId: this.pickMap(seed), names: [this.name, ['Easy', 'Normal', 'Hard'][this.aiLevel] + ' AI'], rng: new Rng(seed ^ 0x5eed) };
    this.startDraft();
  }
  watch() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    this.session = { mode: 'watch', myTeam: -1, seed, mapId: this.pickMap(seed), names: ['Blue AI', 'Red AI'], rng: new Rng(seed) };
    const d = newDraft();
    while (!d.done) { const t = currentTurn(d); draftApply(d, t.team, autoChoice(d, t.team, this.session.rng, 1)); }
    this.session.draft = d;
    this.session.preps = [aiPrep(d.picks[0], d.picks[1]), aiPrep(d.picks[1], d.picks[0])];
    this.startMatch();
  }
  async hostGame() {
    const code = makeCode();
    const cancel = () => this.menu();
    showLobby(this, { code, status: 'Opening room…', onCancel: cancel });
    try {
      const { peer, transport } = await host(code, (s) => showLobby(this, { code, status: s === 'waiting' ? 'Waiting for opponent… (share the code or this link: ' + location.origin + location.pathname + '?join=' + code + ')' : s, onCancel: cancel }));
      this.net = { peer, t: transport };
      const seed = (Math.random() * 2 ** 31) >>> 0;
      this.session = { mode: 'host', myTeam: 0, seed, mapId: this.pickMap(seed), names: [this.name, 'Guest'], rng: new Rng(seed) };
      this.wireNet();
      transport.send({ t: 'hello', v: VERSION, name: this.name, seed });
    } catch (e) {
      showLobby(this, { code, status: 'Could not open room: ' + (e.message || e.type || e), onCancel: cancel });
    }
  }
  joinScreen(prefill) {
    const cancel = () => this.menu();
    const go = async (code) => {
      if (!/^[A-Z]{5}$/.test(code)) { toast('Room codes are 5 letters'); return; }
      showLobby(this, { joining: true, code, status: 'Connecting…', onJoin: go, onCancel: cancel });
      try {
        const { peer, transport } = await join(code);
        this.net = { peer, t: transport };
        this.session = { mode: 'join', myTeam: 1, seed: 0, names: ['Host', this.name], rng: null };
        this.wireNet();
        transport.send({ t: 'hello', v: VERSION, name: this.name });
        showLobby(this, { joining: true, code, status: 'Connected! Waiting for host…', onJoin: go, onCancel: cancel });
      } catch (e) {
        showLobby(this, { joining: true, code, status: 'Failed: ' + (e.message || e.type || e), onJoin: go, onCancel: cancel });
      }
    };
    showLobby(this, { joining: true, code: prefill, status: '', onJoin: go, onCancel: cancel });
    if (prefill) go(prefill.toUpperCase());
  }

  wireNet() {
    const t = this.net.t;
    t.onMessage((m) => this.onNet(m));
    t.onClose(() => this.onDisconnect());
  }
  onNet(m) {
    const s = this.session; if (!s) return;
    switch (m.t) {
      case 'hello':
        if (m.v !== VERSION) { toast('Version mismatch — both players should refresh.'); return; }
        if (s.mode === 'host') { s.names[1] = m.name || 'Guest'; this.net.t.send({ t: 'start', seed: s.seed, names: s.names, map: s.mapId }); this.startDraft(); }
        else if (s.mode === 'join' && m.seed !== undefined) { s.seed = m.seed; }
        break;
      case 'start':
        if (s.mode === 'join') { s.seed = m.seed; s.mapId = m.map; s.names = m.names; s.names[1] = this.name; s.rng = new Rng(s.seed); this.startDraft(); }
        break;
      case 'draft':
        if (s.draft && s.draft.turn === m.turn) { draftApply(s.draft, m.team, m.hero); this.afterDraftAct(); }
        break;
      case 'prep':
        if (s.preps) { s.preps[m.team] = m.prep; s.ready[m.team] = true; this.checkPrepDone(); }
        break;
      case 'in': case 'h':
        if (this.match && this.match.runner.receive) this.match.runner.receive(m);
        break;
      case 'quit':
        toast('Opponent left the match.');
        this.onDisconnect();
        break;
    }
  }
  onDisconnect() {
    if (!this.session || this.session.mode === 'ai' || this.session.mode === 'watch') return;
    if (this.match && !this.match.game.over) {
      // Keep playing: the AI coach takes over the opponent.
      toast('Opponent disconnected — AI coach takes over.', 3500);
      const g = this.match.game, enemy = 1 - this.session.myTeam;
      g.coaches[enemy] = new Coach(g, enemy, 1);
      const r = new LocalRunner(g, this.session.myTeam); r.acc = this.match.runner.acc;
      this.match.runner = r; this.match.hud.runner = r;
      this.session.mode = 'ai';
      this.cleanupNet();
      return;
    }
    toast('Connection lost.');
    this.menu();
  }
  cleanupNet() {
    if (this.net) { try { this.net.t.close(); } catch { /* ignore */ } try { this.net.peer.destroy(); } catch { /* ignore */ } }
    this.net = null;
  }

  // ───────────── draft ─────────────
  startDraft() {
    const s = this.session;
    s.draft = newDraft(); s.turnStart = performance.now(); s.turnLeft = TURN_SECONDS;
    this.showScreen(true);
    audio.music('draft');
    this.draftView = new DraftView(this);
    this.draftView.render();
    clearInterval(this.draftTimer);
    this.draftTimer = setInterval(() => this.draftTick(), 250);
    this.maybeAiDraft();
  }
  draftTick() {
    const s = this.session; if (!s || !s.draft) return;
    if (s.draft.done) { clearInterval(this.draftTimer); return; }
    s.turnLeft = TURN_SECONDS - (performance.now() - s.turnStart) / 1000;
    this.draftView.tickTimer(s.turnLeft);
    const t = currentTurn(s.draft);
    // Timeout: the acting side auto-locks (the local player for their own turns).
    if (s.turnLeft <= 0 && t.team === s.myTeam) this.draftAct(autoChoice(s.draft, t.team, s.rng, 1));
  }
  draftAct(heroId) {
    const s = this.session, t = currentTurn(s.draft);
    if (!t || t.team !== s.myTeam) return;
    const turn = s.draft.turn;
    if (!draftApply(s.draft, s.myTeam, heroId)) return;
    audio.sfx('lockin');
    if (this.net) this.net.t.send({ t: 'draft', team: s.myTeam, hero: heroId, turn });
    this.draftView.sel = null;
    this.afterDraftAct();
  }
  afterDraftAct() {
    const s = this.session;
    s.turnStart = performance.now(); s.turnLeft = TURN_SECONDS;
    if (s.draft.done) { clearInterval(this.draftTimer); setTimeout(() => this.startPrep(), 900); this.draftView.render(); return; }
    this.draftView.render();
    this.maybeAiDraft();
  }
  maybeAiDraft() {
    const s = this.session;
    if (s.mode !== 'ai') return;
    const t = currentTurn(s.draft);
    if (!t || t.team === s.myTeam) return;
    const turn = s.draft.turn;
    setTimeout(() => {
      if (!this.session || this.session !== s || s.draft.turn !== turn) return;
      draftApply(s.draft, t.team, autoChoice(s.draft, t.team, s.rng, this.aiLevel));
      audio.sfx('lockin', 0.6);
      this.afterDraftAct();
    }, 900 + Math.random() * 900);
  }

  // ───────────── prep ─────────────
  startPrep() {
    const s = this.session, me = s.myTeam, d = s.draft;
    s.preps = [null, null]; s.ready = [false, false];
    s.myPrep = defaultPrep(d.picks[me]);
    if (s.mode === 'ai') { s.preps[1 - me] = aiPrep(d.picks[1 - me], d.picks[me]); s.ready[1 - me] = true; }
    s.prepEnd = performance.now() + PREP_SECONDS * 1000;
    const render = () => showPrep(this, s.myPrep, d.picks[1 - me], (s.prepEnd - performance.now()) / 1000, render, () => this.prepReady(), s.ready[me]);
    this.renderPrep = render;
    render();
    clearInterval(this.prepTimer);
    this.prepTimer = setInterval(() => {
      const left = (s.prepEnd - performance.now()) / 1000;
      const el = document.getElementById('ptimer'); if (el) el.textContent = String(Math.max(0, Math.ceil(left)));
      if (left <= 0 && !s.ready[me]) this.prepReady();
    }, 250);
  }
  prepReady() {
    const s = this.session, me = s.myTeam;
    if (s.ready[me]) return;
    s.preps[me] = JSON.parse(JSON.stringify(s.myPrep)); s.ready[me] = true;
    audio.sfx('accept');
    if (this.net) this.net.t.send({ t: 'prep', team: me, prep: s.preps[me] });
    this.renderPrep();
    this.checkPrepDone();
  }
  checkPrepDone() {
    const s = this.session;
    if (s.ready[0] && s.ready[1] && !this.match) { clearInterval(this.prepTimer); this.startMatch(); }
  }

  // ───────────── match ─────────────
  startMatch() {
    const s = this.session;
    const cfg = {
      seed: s.seed, map: s.mapId,
      teams: [0, 1].map((t) => ({ heroes: s.preps[t].heroes, plan: s.preps[t].plan, name: s.names[t] })),
      coach: s.mode === 'ai' ? [s.myTeam !== 0, s.myTeam !== 1] : s.mode === 'watch' ? [true, true] : [false, false],
      coachLevel: [this.aiLevel, this.aiLevel],
    };
    const game = new Game(cfg);
    this.showScreen(false);
    audio.music(Math.random() < 0.5 ? 'match' : 'match2');
    const canvas = document.getElementById('game'), mmc = document.getElementById('mm');
    if (!this.renderer) {
      this.renderer = new Renderer(canvas);
      this.minimap = new Minimap(mmc, this.renderer);
      this.camCtl = bindCamera(this.renderer, canvas, this.minimap, mmc, {
        onKey: (e) => this.match && this.match.hud.onKey(e),
        onClick: (w) => this.clickWorld(w),
      });
      window.addEventListener('resize', () => { this.renderer.resize(); this.minimap.resize(); });
    }
    this.renderer.resize();
    this.renderer.attach(game, s.myTeam, this.mapCanvas(game.world));
    this.minimap.resize();
    this.renderer.fogOn = s.myTeam >= 0;
    const home = game.world.fountain[Math.max(0, s.myTeam)];
    this.renderer.cam.x = home.x + (s.myTeam === 1 ? -300 : 300); this.renderer.cam.y = home.y + (s.myTeam === 1 ? 300 : -300);
    this.renderer.cam.zoom = window.innerWidth < 700 ? 0.9 : 1.25;
    this.renderer.follow = null;
    const runner = this.net ? new LockstepRunner(game, s.myTeam, this.net.t) : new LocalRunner(game, s.myTeam);
    if (runner.online) runner.onDesync = (k) => { console.warn('desync at', k); toast('Warning: games out of sync (tick ' + k + ')', 4000); };
    const hud = new Hud(this, game, runner, this.renderer, this.minimap, s.myTeam, s.mode);
    if (s.mode === 'watch') hud.toggleDirector();
    this.match = { game, runner, hud, ended: false };
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // Hidden tabs stop requestAnimationFrame: keep the lockstep sim ticking so the opponent never stalls.
    clearInterval(this.bgTick);
    this.bgTick = setInterval(() => {
      const m = this.match; if (!m || !document.hidden) return;
      const now = performance.now(), dt = Math.min(1.5, (now - this.lastFrame) / 1000); this.lastFrame = now;
      m.runner.update(dt, () => this.renderer.snapshot(), () => { this.renderer.game.fx.length = 0; });
    }, 100);
  }
  clickWorld(w) {
    // Tap a hero on the map to follow it.
    if (!this.match) return;
    const g = this.match.game; let best = null, bd = 40 * 40;
    for (const t of g.teams) for (const x of t.heroes) if (x.alive && this.renderer.visible(x)) { const d = (x.x - w.x) ** 2 + (x.y - 14 - w.y) ** 2; if (d < bd) { bd = d; best = x; } }
    if (best) this.match.hud.selectHero(best);
  }
  frame(now) {
    const m = this.match; if (!m) return;
    const raw = (now - this.lastFrame) / 1000; this.lastFrame = now;
    const dt = Math.min(0.1, raw);
    const r = this.renderer;
    m.runner.update(m.runner.online ? Math.min(1, raw) : dt, () => r.snapshot(), () => r.consume());
    this.camCtl.update(dt);
    r.draw(m.runner.alpha, dt);
    this.minimap.draw();
    m.hud.update(dt);
    if (m.game.over && !m.ended) {
      m.ended = true;
      const won = this.session.myTeam < 0 || m.game.winner === this.session.myTeam;
      setTimeout(() => this.endMatch(won), 3500);
    }
    if (m.runner.online && m.runner.waiting && performance.now() - m.runner.lastRemote > 5000 && !m.warned) { m.warned = true; toast('Waiting for opponent…', 2500); }
    if (m.runner.online && !m.runner.waiting) m.warned = false;
    requestAnimationFrame((t) => this.frame(t));
  }
  endMatch(won) {
    const m = this.match; if (!m) return;
    this.match = null;
    this.showScreen(true);
    audio.music(won ? 'victory' : 'defeat');
    const s = this.session;
    showResults(this, m.game, s.myTeam,
      s.mode === 'ai' ? () => this.startVsAI() : s.mode === 'watch' ? () => this.watch() : null,
      () => this.menu());
  }
  quitMatch() {
    if (!confirm('Leave this match?')) return;
    if (this.net) this.net.t.send({ t: 'quit' });
    const m = this.match; this.match = null;
    if (m) m.game.over = true;
    this.menu();
  }
}

const app = new App();
window.app = app;
app.boot();
