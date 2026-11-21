// App controller: menu → lobby → draft → prep → match → results.
import { loadAssets, assetsAll, assetsDone } from './render/assets.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { bindCamera } from './render/input.js';
import { onViewport, refit } from './render/viewport.js';
import { paintMap } from './render/mapgen.js';
import { Game } from './sim/game.js';
import { World } from './sim/world.js';
import { Coach } from './sim/coach.js';
import { Rng } from './sim/rng.js';
import { MAPS, RUSH_MAPS } from './maps/defs.js';
import { newDraft, apply as draftApply, currentTurn, autoChoice, aiPrep, TURN_SECONDS } from './sim/draft.js';
import { presetChoice, prepFromPreset } from './presets.js';
import { HERO_BY_ID } from './data/heroes.js';
import { LocalRunner, LockstepRunner } from './net/runner.js';
import { host, join, makeCode, warmNet } from './net/peer.js';
import { showLobby, showPrep, showResults, startParade, stopParade } from './ui/screens.js';
import { DraftView, AUTO_GRACE } from './ui/draftview.js';
import { Hud } from './ui/hud.js';
import { TEAM_COL } from './render/palette.js';
import { toast, h } from './ui/dom.js';
import { audio } from './audio.js';
import { matchAudio } from './audio-match.js';
import { DEFAULT_DECK } from './data/tactics.js';
import { fpsCap } from './ui/settings.js';
import { showHalftime, hideHalftime } from './ui/halftime.js';
import { showHome, showCup, progressPanel } from './ui/home.js';
import { shareMatch } from './ui/share.js';
import { ping, ensureAccount, fetchMe, getAccount, reportMatch, matchStatus, newMatchId, findQueue, cancelQueue } from './net/online.js';
import { showShared, showSearch } from './ui/online.js';
import { startSocial, matchPresence, lobbyInvite, closeInvites, showInviteLink, socialPanel, onRematch, rematchGone } from './ui/social.js';
import { profile } from './profile.js';
import { newCup, recordCup, myMatch } from './cup.js';
import { findPOTG, reportCard } from './ui/moments.js';
import { rankMoment } from './ui/ranks.js';
import { installBuildTips } from './ui/buildguide.js';
import { saveClip, clipSupport } from './ui/clip.js';
import { installPressSounds, confetti } from './ui/juice.js';
import { keepAwake } from './ui/awake.js';
import { MatchRecorder, showAnalysis } from './ui/analytics.js';
import { Theater } from './ui/theater.js';
import { loadLib, storeMatch } from './ui/replays.js';
import { hostCoop, onCoopNet, enterAsGuest, myDraftTurn, applyDraft, draftAuto, aiDraftTurn, coopPrep, myHeroIds, sendPrep, seatReady, flushPendingPreps,
  coopCfg, runnerOpts, startedRunner, soloFallback, historyCoop } from './coop-room.js';
import { coopResults } from './ui/coop.js';

const VERSION = 21; // bump whenever the sim or balance changes (peers must match)
const PREP_SECONDS = 60;

class App {
  constructor() {
    this.name = 'Coach';
    try { this.name = localStorage.getItem('mobavs_name') || 'Coach'; this.aiLevel = +(localStorage.getItem('mobavs_ai') ?? 1); } catch { this.aiLevel = 1; }
    // Online queue: 'ranked' (ladder), 'casual' (5v5, no rating) or 'rush' (Lane Rush, casual)
    try { this.queueMode = ['ranked', 'casual', 'rush'].includes(localStorage.getItem('mobavs_queue')) ? localStorage.getItem('mobavs_queue') : 'ranked'; } catch { this.queueMode = 'ranked'; }
    this.session = null; this.net = null; this.match = null; this.mapPref = 'random'; this.version = VERSION;
    this.bgCanvas = document.getElementById('bg');
  }
  // Painted map canvases are cached per map id (painting takes a moment on phones).
  mapCanvas(world) {
    this.mapCache = this.mapCache || {};
    if (!this.mapCache[world.def.id]) this.mapCache[world.def.id] = paintMap(world);
    return this.mapCache[world.def.id];
  }
  // Random favours the season's featured map (half the time).
  pickMap(seed, mode = 'classic') {
    if (mode === 'rush') return RUSH_MAPS[(seed >>> 1) % RUSH_MAPS.length].id;
    return this.mapPref && this.mapPref !== 'random' ? this.mapPref : seed % 2 === 0 ? profile.season.map : MAPS[(seed >>> 1) % MAPS.length].id;
  }
  setQueueMode(m) { this.queueMode = m; try { localStorage.setItem('mobavs_queue', m); } catch { /* ignore */ } }
  setName(n) { this.name = n.slice(0, 12) || 'Coach'; try { localStorage.setItem('mobavs_name', this.name); } catch { /* ignore */ } }

  async boot() {
    audio.init();
    installPressSounds();
    // Menu transitions: a new screen slides in; re-rendering the same screen (a toggle, a tab, a draft pick) does not.
    const scr = document.getElementById('screen'); let lastView = '';
    new MutationObserver(() => {
      const c = scr.firstElementChild; if (!c) return;
      const t = c.querySelector('h2'), view = c.dataset.view || (c.className.split(' ')[0] + '|' + (t ? t.textContent : ''));
      if (view === lastView) c.classList.add('same');
      lastView = view;
    }).observe(scr, { childList: true });
    installBuildTips();
    const bar = document.querySelector('#loading .barw i');
    await loadAssets((p) => { bar.style.width = Math.round(p * 100) + '%'; }, true);
    try { await document.fonts.load('12px PixelFont'); } catch { /* ignore */ }
    this.map = this.mapCanvas(new World(MAPS[0]));
    document.getElementById('loading').remove();
    this.startBg();
    const q = new URLSearchParams(location.search), code = q.get('join'), shared = q.get('s'), invite = q.get('i');
    if (code) this.joinScreen(code); else if (shared) showShared(this, shared); else if (invite) showInviteLink(this, invite); else this.menu();
    this.connectOnline();
    setTimeout(warmNet, 3000); // PeerJS off the first-paint path, ready before anyone taps Host / Join
  }
  // Online services: create/restore the account, then sync the profile (newest copy wins).
  async connectOnline() {
    if (!(await ping())) return;
    try {
      await ensureAccount(this.name);
      startSocial(this); // friends' presence + invites, polled only while the menu is open
      const me = await fetchMe();
      if (me && me.profile && (me.profileAt || 0) > (profile.d.savedAt || 0)) {
        profile.adopt(me.profile);
        if (me.name && me.name !== this.name) this.setName(me.name);
        if (this.session === null && !this.match) this.menu();
      } else profile.save({ keepTime: true });
    } catch (e) { console.warn('online', e); }
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
      // zoomed enough that the view never runs off the painted map (a big monitor used to show a dark strip)
      const M = this.map, z = Math.max(1.4, c.width / M.width * 1.05, c.height / M.height * 1.05), vw = c.width / z, vh = c.height / z;
      const cx = M.width / 2 + Math.cos(t * 0.03) * 700, cy = M.height / 2 + Math.sin(t * 0.03) * 700;
      const sx = Math.max(0, Math.min(M.width - vw, cx - vw / 2)), sy = Math.max(0, Math.min(M.height - vh, cy - vh / 2));
      ctx.drawImage(M, sx, sy, vw, vh, 0, 0, c.width, c.height);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  menu() {
    keepAwake(false);
    this.lobbyId = (this.lobbyId || 0) + 1;
    this.dropReel();
    clearInterval(this.prepTimer); clearInterval(this.draftTimer);
    if (this.pendingPeer) { try { this.pendingPeer.destroy(); } catch { /* ignore */ } this.pendingPeer = null; }
    closeInvites(this);
    this.cleanupNet();
    this.session = null;
    this.showScreen(true);
    audio.music('menu');
    showHome(this);
    startParade();
    if (this.update) setTimeout(() => this.safeUpdate(), 600);
  }
  // A new build is ready (new service worker waiting, or the cache was refreshed by a deploy):
  // switch only from the menu, with a quick fade, never during a draft, prep or match.
  safeUpdate() {
    const u = this.update;
    if (!u || u.busy || this.match || this.session || document.querySelector('.modal') || !document.querySelector('#screen .home')) return;
    u.busy = true;
    document.getElementById('fade').classList.add('on');
    setTimeout(() => {
      if (u.reg && u.reg.waiting) u.reg.waiting.postMessage({ t: 'skipWaiting' }); // controllerchange reloads
      else location.reload();
    }, 250);
  }
  fade(fn) {
    const f = document.getElementById('fade');
    f.classList.add('on');
    setTimeout(() => { fn(); requestAnimationFrame(() => f.classList.remove('on')); }, 220);
  }
  showScreen(on) {
    document.getElementById('screen').classList.toggle('hidden', !on);
    document.getElementById('bg').classList.toggle('hidden', !on);
    document.getElementById('match').classList.toggle('hidden', on);
  }

  // ───────────── modes ─────────────
  // Phones: going into a match from a tap goes full screen and locks landscape where supported.
  immersive() {
    try {
      if (!matchMedia('(pointer: coarse)').matches) return;
      const el = document.documentElement, d = document;
      const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch { /* ignore */ } };
      if (!(d.fullscreenElement || d.webkitFullscreenElement) && (el.requestFullscreen || el.webkitRequestFullscreen)) {
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        if (p && p.then) p.then(lock, () => {}); else lock();
      } else lock();
    } catch { /* not supported */ }
  }
  // mode: 'classic' (5v5 on the chosen map) or 'rush' (Lane Rush on one of its maps).
  startVsAI(mode = 'classic') {
    this.immersive();
    try { localStorage.setItem('mobavs_ai', String(this.aiLevel)); } catch { /* ignore */ }
    const seed = (Math.random() * 2 ** 31) >>> 0, gameMode = mode === 'rush' ? 'rush' : 'classic';
    this.session = { mode: 'ai', gameMode, myTeam: 0, seed, mapId: this.pickMap(seed, gameMode), aiLevel: this.aiLevel, names: [this.name, ['Easy', 'Normal', 'Hard'][this.aiLevel] + ' AI'], rng: new Rng(seed ^ 0x5eed) };
    this.startDraft();
  }
  newCup() { newCup(this.name); }
  startCupMatch() {
    this.immersive();
    const cup = profile.d.cup, mm = cup && myMatch(cup); if (!mm) { showCup(this); return; }
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const mapId = mm.round === 2 ? profile.season.map : MAPS[seed % MAPS.length].id;
    this.session = { mode: 'ai', cup: true, myTeam: 0, seed, mapId, aiLevel: mm.opp.lvl, names: [this.name, mm.opp.name], rng: new Rng(seed ^ 0xc0ff) };
    this.startDraft();
  }
  watch() {
    this.immersive();
    stopParade(); this.dropReel();
    const seed = (Math.random() * 2 ** 31) >>> 0, gameMode = 'classic';
    this.session = { mode: 'watch', gameMode, myTeam: -1, seed, mapId: this.pickMap(seed, gameMode), names: ['Blue AI', 'Red AI'], rng: new Rng(seed) };
    const d = newDraft();
    while (!d.done) { const t = currentTurn(d); draftApply(d, t.team, autoChoice(d, t.team, this.session.rng, 1)); }
    this.session.draft = d;
    this.session.preps = [aiPrep(d.picks[0], d.picks[1]), aiPrep(d.picks[1], d.picks[0])];
    this.startMatch();
  }
  // Host a room. opts.code/lobbyId/quiet are used by matchmaking (Find Match), which shows its own screen.
  async hostGame(opts = {}) {
    this.immersive();
    const code = opts.code || makeCode();
    const cancel = () => this.menu();
    const id = opts.lobbyId || (this.lobbyId = (this.lobbyId || 0) + 1);
    const live = () => this.lobbyId === id;
    const extra = opts.quiet ? null : lobbyInvite(this, code, opts); // friend invite + shareable invite link
    if (!opts.quiet) showLobby(this, { code, status: 'Opening room…', onCancel: cancel, extra });
    try {
      const { peer, transport } = await host(code, (s) => live() && !opts.quiet && showLobby(this, { code, status: s === 'waiting' ? 'Waiting for opponent…' : s, onCancel: cancel, extra }), (p) => { this.pendingPeer = p; });
      if (!live()) { try { transport.close(); } catch { /* ignore */ } try { peer.destroy(); } catch { /* ignore */ } return; }
      this.pendingPeer = null;
      this.net = { peer, t: transport };
      const seed = (Math.random() * 2 ** 31) >>> 0, gameMode = opts.gameMode || (this.queueMode === 'rush' ? 'rush' : 'classic');
      this.session = { mode: 'host', gameMode, myTeam: 0, seed, mapId: this.pickMap(seed, gameMode), names: [this.name, 'Guest'], rng: new Rng(seed), ranked: !!opts.ranked, queue: opts.queue || 'private' };
      this.wireNet();
      transport.send({ t: 'hello', v: VERSION, name: this.name, seed, pid: getAccount() && getAccount().id, elo: profile.elo });
    } catch (e) {
      if (!live() || opts.quiet) return;
      showLobby(this, { code, status: 'Could not open room: ' + (e.message || e.type || e), onCancel: cancel, extra });
    }
  }
  // Co-op room: two coaches share a team, vs the AI or 2v2 (src/coop-room.js).
  hostCoop(opts = {}) { stopParade(); hostCoop(this, opts); }
  joinScreen(prefill, opts = {}) {
    const cancel = () => this.menu();
    const go = async (code) => {
      if (!/^[A-Z]{5}$/.test(code)) { toast('Room codes are 5 letters'); return; }
      this.immersive();
      if (!opts.quiet) showLobby(this, { joining: true, code, status: 'Connecting…', onJoin: go, onCancel: cancel });
      const id = opts.lobbyId || (this.lobbyId = (this.lobbyId || 0) + 1);
      try {
        const { peer, transport } = await join(code, null, (p) => { this.pendingPeer = p; });
        if (this.lobbyId !== id) { try { transport.close(); } catch { /* ignore */ } try { peer.destroy(); } catch { /* ignore */ } return; }
        this.pendingPeer = null;
        this.net = { peer, t: transport };
        this.session = { mode: 'join', gameMode: 'classic', myTeam: 1, seed: 0, names: ['Host', this.name], rng: null, ranked: !!opts.ranked, queue: opts.queue || 'private' };
        this.wireNet();
        transport.send({ t: 'hello', v: VERSION, name: this.name, pid: getAccount() && getAccount().id, elo: profile.elo, ranked: !!this.session.ranked });
        showLobby(this, { joining: true, code, status: 'Connected! Waiting for host…', onJoin: go, onCancel: cancel });
      } catch (e) {
        if (this.lobbyId !== id) return;
        if (opts.onFail) { opts.onFail(e); return; }
        showLobby(this, { joining: true, code, status: 'Failed: ' + (e.message || e.type || e), onJoin: go, onCancel: cancel });
      }
    };
    if (!opts.quiet) showLobby(this, { joining: true, code: prefill, status: '', onJoin: go, onCancel: cancel });
    if (prefill) go(prefill.toUpperCase());
  }
  // Matchmaking (Ranked / Casual / Lane Rush queues): pair with a real player in the same queue or give up after 60s (no bots fill in).
  async findMatch() {
    this.immersive(); stopParade();
    const id = this.lobbyId = (this.lobbyId || 0) + 1;
    const queue = this.queueMode || 'ranked', ranked = queue === 'ranked', gameMode = queue === 'rush' ? 'rush' : 'classic';
    const live = () => this.lobbyId === id && !this.net;
    const t0 = performance.now(), LIMIT = 60000;
    let ticket = null, hosting = false, joined = false;
    const leave = () => { if (ticket) cancelQueue(ticket); };
    const ui = (status) => showSearch(this, { elapsed: performance.now() - t0, limit: LIMIT, status, queue, onCancel: () => { leave(); this.menu(); } });
    ui('Connecting to the matchmaker…');
    if (!(await ping())) { if (live()) { toast('Online play is unavailable right now.'); this.menu(); } return; }
    try { await ensureAccount(this.name); } catch { if (live()) { toast('Could not reach the matchmaker.'); this.menu(); } return; }
    const tick = setInterval(() => { if (live()) ui(hosting ? 'Waiting for an opponent…' : 'Searching…'); else clearInterval(tick); }, 1000);
    try {
      while (live()) {
        if (performance.now() - t0 > LIMIT) { leave(); toast('No one is online right now. Try again soon!', 3500); this.menu(); return; }
        const r = await findQueue({ version: VERSION, ticket, rating: profile.elo, mode: queue });
        if (!live()) return;
        if (r.status === 'matched' && r.role === 'join' && !joined) {
          joined = true; if (this.pendingPeer) { try { this.pendingPeer.destroy(); } catch { /* ignore */ } this.pendingPeer = null; }
          ticket = null; ui('Opponent found! Connecting…');
          this.joinScreen(r.code, { quiet: true, lobbyId: id, ranked, queue, onFail: () => { joined = false; } });
        } else if (r.status === 'waiting' && !hosting) {
          ticket = r.ticket; hosting = true;
          this.hostGame({ code: r.code, lobbyId: id, quiet: true, ranked, queue, gameMode });
        } else if (r.status === 'expired') { ticket = null; hosting = false; if (this.pendingPeer) { try { this.pendingPeer.destroy(); } catch { /* ignore */ } this.pendingPeer = null; } }
        await new Promise((res) => setTimeout(res, 3000));
      }
    } catch (e) { if (live()) { leave(); toast('Matchmaking failed: ' + (e.message || e)); this.menu(); } }
    finally { clearInterval(tick); if (this.net) leave(); }
  }

  wireNet() {
    const t = this.net.t;
    t.onMessage((m) => this.onNet(m));
    t.onClose(() => this.onDisconnect());
  }
  onNet(m) {
    const s = this.session; if (!s) return;
    if (s.mode === 'coop') { onCoopNet(this, m); return; }
    switch (m.t) {
      case 'room': // the room we joined is a co-op room
        if (s.mode === 'join') enterAsGuest(this, m);
        break;
      case 'closed':
        if (s.mode === 'join') { toast(m.why || 'That room is closed.', 3000); this.menu(); }
        break;
      case 'hello':
        if (m.v !== VERSION) { toast('Version mismatch — both players should refresh.'); return; }
        if (s.mode === 'host') {
          s.names[1] = m.name || 'Guest'; s.oppId = m.pid || null; s.matchId = newMatchId(); s.oppElo = m.elo || null;
          s.ranked = !!(s.ranked && m.ranked); // rated only when both coaches opted in (queue or Ranked invite)
          this.net.t.send({ t: 'start', seed: s.seed, names: s.names, map: s.mapId, mode: s.gameMode, match: s.matchId, pid: getAccount() && getAccount().id, elo: profile.elo, ranked: s.ranked });
          this.startDraft();
        }
        else if (s.mode === 'join' && m.seed !== undefined) { s.seed = m.seed; }
        break;
      case 'start':
        if (s.mode === 'join') { s.seed = m.seed; s.mapId = m.map; s.gameMode = m.mode === 'rush' ? 'rush' : 'classic'; s.names = m.names; s.names[1] = this.name; s.rng = new Rng(s.seed); s.matchId = m.match || null; s.oppId = m.pid || null; s.oppElo = m.elo || null; s.ranked = !!(s.ranked && m.ranked); this.startDraft(); }
        break;
      case 'rm': // rematch asked / accepted on the results screen
        onRematch(this, m);
        break;
      case 'rmstart': {
        const old = this.resultsSession();
        if (old && old.finished && old.mode === 'join') { this.leaveReplay(); this.joinRematch(m, old); }
        break;
      }
      case 'draft':
        if (s.draft && s.draft.turn === m.turn) { draftApply(s.draft, m.team, m.hero); this.afterDraftAct(); }
        break;
      case 'prep':
        if (s.preps) { s.preps[m.team] = m.prep; s.ready[m.team] = true; this.checkPrepDone(); }
        else s.pendingPrep = m; // arrived before our prep screen opened
        break;
      case 'in': case 'h': case 'ht':
        if (this.match && this.match.runner.receive) this.match.runner.receive(m);
        break;
      case 'qc': // quick chat: a side channel, never part of the lockstep command log
        if (this.match && this.match.hud.chat) this.match.hud.chat.receive(m);
        break;
      case 'quit':
        if (s.finished || this.replayFromResults()) { this.cleanupNet(); return; }
        toast('Opponent left the match.');
        this.onDisconnect();
        break;
    }
  }
  onDisconnect() {
    if (this.replayFromResults()) { this.cleanupNet(); return; } // online results' Play of the Game / replay
    if (!this.session || this.session.mode === 'ai' || this.session.mode === 'watch') return;
    if (this.session.finished || (this.match && this.match.game.over)) { this.cleanupNet(); return; }
    if (this.session.mode === 'coop') {
      // a co-op guest lost the host: mid-match, play on alone; before it, the room is gone
      if (this.session.host) return;
      if (this.match) { soloFallback(this, LocalRunner); this.cleanupNet(); return; }
      toast('The host closed the co-op room.', 3000); this.menu(); return;
    }
    if (this.match && !this.match.game.over) {
      // Keep playing: the AI coach takes over the opponent.
      toast('Opponent disconnected — AI coach takes over.', 3500);
      const g = this.match.game, enemy = 1 - this.session.myTeam;
      g.coaches[enemy] = new Coach(g, enemy, 1);
      const old = this.match.runner, r = new LocalRunner(g, this.session.myTeam); r.acc = old.acc;
      r.log = old.log; r.htDone = old.htDone; r.ht = old.ht; if (r.ht) r.ht.them = true; r.onHalftime = old.onHalftime; r.onHalftimeEnd = old.onHalftimeEnd;
      this.match.runner = r; this.match.hud.runner = r; this.match.hud.disableChat();
      this.session.mode = 'ai'; this.session.wasOnline = true;
      this.cleanupNet();
      return;
    }
    toast('Connection lost.');
    this.menu();
  }
  cleanupNet() {
    // leaving online results: tell the opponent (their Rematch button closes) before the connection goes
    const rs = this.resultsSession();
    if (this.net && rs && rs.finished) this.net.t.send({ t: 'quit' });
    if (this.net) rematchGone(this);
    if (this.net) { try { this.net.t.close(); } catch { /* ignore */ } try { this.net.peer.destroy(); } catch { /* ignore */ } }
    this.net = null;
  }

  // ───────────── draft ─────────────
  startDraft() {
    keepAwake(true);
    stopParade(); this.dropReel(); closeInvites(this);
    const s = this.session;
    s.draft = newDraft(); s.turnStart = performance.now(); s.turnLeft = TURN_SECONDS;
    // The active lineup is frozen for this draft (auto-picks, prep builds/plan/deck).
    const pre = profile.activePreset; s.preset = pre && s.mode !== 'coop' ? JSON.parse(JSON.stringify(pre)) : null; // co-op: each coach picks for their roles
    this.showScreen(true);
    audio.music('draft');
    this.draftView = new DraftView(this);
    this.armAutoPick();
    this.draftView.render();
    clearInterval(this.draftTimer);
    this.draftTimer = setInterval(() => this.draftTick(), 100);
    this.maybeAiDraft();
  }
  draftTick() {
    const s = this.session; if (!s || !s.draft) return;
    if (s.draft.done) { clearInterval(this.draftTimer); return; }
    s.turnLeft = TURN_SECONDS - (performance.now() - s.turnStart) / 1000;
    this.draftView.tickTimer(s.turnLeft);
    const t = currentTurn(s.draft);
    // Preset auto-pick lands after a short grace (the coach can tap another hero to override).
    if (s.autoPick && s.autoPick.turn === s.draft.turn && performance.now() >= s.autoPick.at) { this.lockAutoPick(); return; }
    // Timeout: the acting side auto-locks (the local player for their own turns).
    if (s.turnLeft <= 0 && this.myDraftTurn()) this.draftAct(s.mode === 'coop' ? draftAuto(s) : s.pickPrompt && s.pickPrompt.recs[0] || autoChoice(s.draft, t.team, s.rng, 1));
  }
  // Is it this coach's draft turn? (Co-op: the team's turn and this coach's seat.)
  myDraftTurn() { const s = this.session, t = currentTurn(s.draft); return s.mode === 'coop' ? myDraftTurn(s) : !!t && t.team === s.myTeam; }
  // Every local pick/ban (manual, auto-pick, timeout) goes through here, so online drafts stay in lockstep.
  draftAct(heroId) {
    const s = this.session, t = currentTurn(s.draft);
    if (s.mode === 'coop') {
      const turn = s.draft.turn;
      if (!myDraftTurn(s) || !applyDraft(s, s.myTeam, s.mySeat, heroId)) return false;
      audio.sfx('lockin');
      this.net.t.send({ t: 'draft', team: s.myTeam, seat: s.mySeat, hero: heroId, turn, p: s.slot });
      this.draftView.sel = null;
      this.afterDraftAct();
      return true;
    }
    if (!t || t.team !== s.myTeam) return false;
    const turn = s.draft.turn;
    if (!draftApply(s.draft, s.myTeam, heroId)) return false;
    audio.sfx('lockin');
    if (this.net) this.net.t.send({ t: 'draft', team: s.myTeam, hero: heroId, turn });
    this.draftView.sel = null;
    this.afterDraftAct();
    return true;
  }
  afterDraftAct() {
    const s = this.session;
    s.turnStart = performance.now(); s.turnLeft = TURN_SECONDS;
    if (s.draft.done) { s.autoPick = s.pickPrompt = null; clearInterval(this.draftTimer); setTimeout(() => { if (this.session === s) this.startPrep(); }, 900); this.draftView.render(); return; }
    this.armAutoPick();
    this.draftView.render();
    this.maybeAiDraft();
  }
  // On our pick turns, ask the active lineup what to do: auto-pick (main or backup) or prompt for the role.
  armAutoPick() {
    const s = this.session, d = s.draft, t = currentTurn(d);
    s.autoPick = null; s.pickPrompt = null;
    if (!t || t.team !== s.myTeam || t.act !== 'pick' || !s.preset) return;
    const c = presetChoice(d, s.myTeam, s.preset);
    if (!c) return;
    if (c.prompt) s.pickPrompt = c;
    else s.autoPick = { ...c, turn: d.turn, at: performance.now() + AUTO_GRACE * 1000 };
    if (this.draftView) this.draftView.sel = null; // a hero browsed while waiting doesn't count as an override
  }
  lockAutoPick() {
    const s = this.session, a = s.autoPick; if (!a) return;
    s.autoPick = null;
    if (a.turn === s.draft.turn && this.draftAct(a.id)) toast(`Auto-picked ${HERO_BY_ID[a.id].name}${a.backup ? ' (backup)' : ''}`, 1400);
  }
  cancelAutoPick() { const s = this.session; if (s && s.autoPick) { s.autoPick = null; toast('Auto-pick off for this turn: choose your hero', 1600); } }
  maybeAiDraft() {
    const s = this.session;
    if (s.mode === 'coop') { aiDraftTurn(this); return; }
    if (s.mode !== 'ai') return;
    const t = currentTurn(s.draft);
    if (!t || t.team === s.myTeam) return;
    const turn = s.draft.turn;
    setTimeout(() => {
      if (!this.session || this.session !== s || s.draft.turn !== turn) return;
      draftApply(s.draft, t.team, autoChoice(s.draft, t.team, s.rng, s.aiLevel ?? this.aiLevel));
      audio.sfx('lockin', 0.6);
      this.afterDraftAct();
    }, 900 + Math.random() * 900);
  }

  // ───────────── prep ─────────────
  startPrep() {
    const s = this.session, me = s.myTeam, d = s.draft;
    s.preps = [null, null]; s.ready = [false, false];
    const coop = s.mode === 'coop';
    const pp = coop ? { prep: coopPrep(s), fromPreset: [] } : prepFromPreset(d.picks[me], d.picks[1 - me], s.preset);
    s.myPrep = pp.prep; s.prepFromPreset = pp.fromPreset; s.prepAdjust = false;
    s.myPrep.skins = profile.skinsFor(coop ? myHeroIds(s) : d.picks[me]);
    if (s.mode === 'ai') { s.preps[1 - me] = aiPrep(d.picks[1 - me], d.picks[me]); s.ready[1 - me] = true; }
    if (s.pendingPrep) { s.preps[s.pendingPrep.team] = s.pendingPrep.prep; s.ready[s.pendingPrep.team] = true; s.pendingPrep = null; }
    s.prepEnd = performance.now() + PREP_SECONDS * 1000;
    const meReady = () => (coop ? seatReady(s, me, s.mySeat) : s.ready[me]);
    const render = () => showPrep(this, s.myPrep, d.picks[1 - me], (s.prepEnd - performance.now()) / 1000, render, () => this.prepReady(), meReady());
    this.renderPrep = render;
    render();
    if (coop) flushPendingPreps(this);
    clearInterval(this.prepTimer);
    this.prepTimer = setInterval(() => {
      if (this.session !== s) { clearInterval(this.prepTimer); return; }
      const left = (s.prepEnd - performance.now()) / 1000;
      const el = document.getElementById('ptimer'); if (el) el.textContent = String(Math.max(0, Math.ceil(left)));
      if (left <= 0 && !meReady()) this.prepReady();
    }, 250);
  }
  prepReady() {
    const s = this.session, me = s.myTeam;
    if (s.mode === 'coop' ? seatReady(s, me, s.mySeat) : s.ready[me]) return;
    const deck = s.myPrep.deck || (s.myPrep.deck = []);
    for (const id of DEFAULT_DECK) if (deck.length < 3 && !deck.includes(id)) deck.push(id);
    if (s.mode === 'coop') { audio.sfx('accept'); sendPrep(this, JSON.parse(JSON.stringify(s.myPrep))); this.renderPrep(); return; }
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
    keepAwake(true);
    // the match art finishes loading in the background after first paint; on a slow link wait for it here
    if (!assetsDone) { const s0 = this.session; toast('Loading the battlefield…', 1500); assetsAll.then(() => { if (this.session === s0 && !this.match) this.startMatch(); }); return; }
    const s = this.session;
    const cfg = s.replay ? JSON.parse(JSON.stringify(s.replay.cfg)) : {
      seed: s.seed, map: s.mapId, ...(s.gameMode === 'rush' ? { mode: 'rush' } : {}),
      teams: [0, 1].map((t) => ({ heroes: s.preps[t].heroes, plan: s.preps[t].plan, deck: s.preps[t].deck, name: s.names[t] })),
      coach: s.mode === 'coop' ? s.ai.slice() : s.mode === 'ai' ? [s.myTeam !== 0, s.myTeam !== 1] : s.mode === 'watch' ? [true, true] : [false, false],
      coachLevel: [s.aiLevel ?? this.aiLevel, s.aiLevel ?? this.aiLevel],
      ...(s.mode === 'coop' ? { coop: coopCfg(s) } : {}),
    };
    const cfgSaved = JSON.parse(JSON.stringify(cfg));
    const pre = s.prebuilt; s.prebuilt = null; // Play of the Game: a game already fast-forwarded to the highlight
    const game = pre ? pre.game : new Game(cfg);
    this.showScreen(false);
    const canvas = document.getElementById('game'), mmc = document.getElementById('mm');
    if (!this.renderer) {
      this.renderer = new Renderer(canvas);
      this.minimap = new Minimap(mmc, this.renderer);
      this.camCtl = bindCamera(this.renderer, canvas, this.minimap, mmc, {
        onKey: (e) => this.match && this.match.hud.onKey(e),
        onClick: (w, sx, sy) => this.clickWorld(w, sx, sy),
        onManual: () => this.match && this.match.hud.manualCam(),
      });
      onViewport(() => { if (this.match) { this.renderer.resize(); this.minimap.resize(); } });
    }
    this.renderer.resize(true);
    this.renderer.attach(game, s.myTeam, this.mapCanvas(game.world));
    this.renderer.skins = s.replay ? s.replay.skins || [{}, {}] : [0, 1].map((t) => (s.preps[t] && s.preps[t].skins) || {});
    this.minimap.resize();
    refit();
    this.renderer.fogOn = s.myTeam >= 0;
    const home = game.world.fountain[Math.max(0, s.myTeam)];
    this.renderer.cam.x = home.x + (s.myTeam === 1 ? -300 : 300); this.renderer.cam.y = home.y + (s.myTeam === 1 ? 300 : -300);
    // Show a similar slice of the battlefield on every screen: ~620 world px across the short side on phones.
    const short = Math.min(window.innerWidth, window.innerHeight);
    this.renderer.cam.zoom = short < 600 ? Math.max(0.5, Math.min(0.9, short / 620)) : window.innerWidth < 1100 ? 0.95 : 1.25;
    this.renderer.follow = null;
    const runner = pre ? pre.runner : this.net ? new LockstepRunner(game, s.myTeam, this.net.t, s.mode === 'coop' ? runnerOpts(s) : {})
      : new LocalRunner(game, s.myTeam, { noHalftime: s.mode === 'watch', script: s.replay ? s.replay.log : null });
    if (!pre && s.mode === 'coop' && runner.online) startedRunner(this, runner);
    runner.onHalftime = (ht) => showHalftime(this, game, s.myTeam, runner, ht);
    runner.onHalftimeEnd = () => hideHalftime();
    if (runner.online) runner.onDesync = (k) => { console.warn('desync at', k); toast('Warning: games out of sync (tick ' + k + ')', 4000); };
    const hud = new Hud(this, game, runner, this.renderer, this.minimap, s.myTeam, s.mode);
    hud.toggleDirector(); // the auto-camera follows the action until the player drags, pans or picks a hero
    if (s.potg) {
      const p = s.potg; this.renderer.cam.x = p.x; this.renderer.cam.y = p.y; this.renderer.cam.zoom = Math.max(this.renderer.cam.zoom, short < 600 ? 0.8 : 1.3);
      hud.banner('PLAY OF THE GAME', '#ffd84a', 1600, null, true); hud.banner(p.title.toUpperCase(), TEAM_COL[p.team] || '#ffd84a', 1800);
    }
    this.match = { game, runner, hud, ended: false, cfg: cfgSaved };
    matchAudio.attach(game, this.renderer, runner, s.myTeam);
    // post-match analytics are recorded live; a replay (not the Play of the Game) opens in the Theater
    if (!s.replay && !pre) this.match.rec = new MatchRecorder(game);
    if (s.replay && !s.potg) this.match.theater = new Theater(this, this.match, s.replay, { back: s.theaterBack });
    if (!pre && !s.replay && s.myTeam >= 0) matchPresence(); // friends see 'In a match'
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // Hidden tabs stop requestAnimationFrame: keep the lockstep sim ticking so the opponent never stalls.
    clearInterval(this.bgTick);
    this.bgTick = setInterval(() => {
      const m = this.match; if (!m || !document.hidden) return;
      const now = performance.now(), dt = Math.min(1.5, (now - this.lastFrame) / 1000); this.lastFrame = now;
      m.runner.update(dt, () => this.renderer.snapshot(), () => { this.renderer.game.fx.length = 0; if (m.rec) m.rec.step(); });
    }, 100);
  }
  clickWorld(w, sx, sy) {
    // Tap your own hero to follow it; tap anything else for the call ring.
    if (!this.match) return;
    const m = this.match, g = m.game, dock = m.hud.dock;
    if (dock && dock.ring) { dock.closeRing(); return; }
    // finger-sized hit area: ~38 screen px whatever the zoom
    const R = 38 / this.renderer.cam.zoom;
    let best = null, bd = R * R;
    for (const t of g.teams) for (const x of t.heroes) {
      if (!x.alive || !this.renderer.visible(x) || (this.session.myTeam >= 0 && x.team !== this.session.myTeam)) continue;
      const d = (x.x - w.x) ** 2 + (x.y - 14 - w.y) ** 2; if (d < bd) { bd = d; best = x; }
    }
    if (best) { m.hud.selectHero(best); return; }
    if (dock) dock.ringAt(w, sx, sy);
  }
  frame(now) {
    const m = this.match; if (!m) return;
    // Battery mode: draw at most 30 fps (the sim keeps its own fixed rate either way).
    const cap = fpsCap();
    if (cap && now - this.lastFrame < 1000 / cap - 2) { requestAnimationFrame((t) => this.frame(t)); return; }
    const raw = (now - this.lastFrame) / 1000; this.lastFrame = now;
    const dt = Math.min(0.1, raw);
    const r = this.renderer;
    m.runner.update(m.runner.online ? Math.min(1, raw) : dt, () => r.snapshot(), () => { matchAudio.consume(); r.consume(); if (m.rec) m.rec.step(); });
    this.camCtl.update(dt);
    r.draw(m.runner.alpha, dt);
    this.minimap.draw();
    m.hud.update(dt);
    matchAudio.frame();
    if (m.theater) m.theater.frame(raw);
    const potg = this.session && this.session.potg;
    if (potg) {
      if (!m.ended && (m.game.tick >= potg.end || m.game.over)) { m.ended = true; setTimeout(() => { if (this.match === m) this.endPOTG(); }, 1200); }
      requestAnimationFrame((t) => this.frame(t)); return;
    }
    if (m.game.over && !m.ended && !m.theater) {
      m.ended = true;
      // victory camera: fly to the fallen crystal (or the winning side's crystal on time-out)
      const lost = m.game.units.find((u) => u.type === 'nexus' && !u.alive) || m.game.units.find((u) => u.type === 'nexus' && u.team === m.game.winner);
      if (lost) { this.renderer.follow = null; m.hud.director = false; this.renderer.focus = { x: lost.x, y: lost.y - 40, zoom: 1.5 }; }
      const won = this.session.myTeam < 0 || m.game.winner === this.session.myTeam;
      this.session.finished = true;
      setTimeout(() => this.endMatch(won, m), 4800);
    }
    if (m.runner.online && m.runner.waiting && performance.now() - m.runner.lastRemote > 5000 && !m.warned) { m.warned = true; toast(this.session.mode === 'coop' ? 'Waiting for the other coaches…' : 'Waiting for opponent…', 2500); }
    if (m.runner.online && !m.runner.waiting) m.warned = false;
    requestAnimationFrame((t) => this.frame(t));
  }
  // Leaving a match: stop the hidden-tab ticker and tear the HUD down (listeners, alerts, chat, timers).
  teardownMatch(m) {
    clearInterval(this.bgTick);
    matchAudio.detach();
    for (const id of ['scoreboard', 'halftime']) { const el = document.getElementById(id); if (el) el.remove(); }
    if (m && m.hud) m.hud.destroy();
  }
  // The Play of the Game pre-roll fast-forwards a whole match in the background: stop it once the results are left.
  dropReel() { if (this.potgReel) { this.potgReel.stop = true; this.potgReel = null; } }
  endMatch(won, which) {
    const m = this.match; if (!m || (which && m !== which)) return;
    this.match = null;
    this.teardownMatch(m);
    this.fade(() => {
      this.showScreen(true);
      audio.music(won ? 'victory' : 'defeat');
      const s = this.session;
      // Online: both players report (ranked counts for the ladder; casual only feeds hero balance stats)
      const ladder = s.matchId && s.oppId && getAccount() ? this.reportOnline(m, s) : null;
      // Play of the Game: found from the event log, replayed from the saved replay (cfg + command log)
      let potg = null;
      try { potg = findPOTG(m.game); } catch (e) { console.error(e); }
      let sum = null, cupOut = null;
      const analytics = m.rec ? m.rec.finish({ my: s.myTeam, cc: s.myTeam >= 0 ? [m.hud.stats.coachCalls, m.hud.stats.coachAnswered] : null }) : null;
      try {
        profile.lastNames = s.names;
        sum = profile.record({ game: m.game, myTeam: s.myTeam, mode: s.mode === 'ai' && !s.wasOnline ? 'ai' : 'online', aiLevel: s.aiLevel ?? this.aiLevel, cup: !!s.cup,
          ranked: !!s.ranked, oppElo: s.oppElo, potgHero: potg && potg.team === s.myTeam ? potg.heroId : null, analytics,
          coop: s.mode === 'coop' ? { kind: s.kind, heroes: myHeroIds(s), info: historyCoop(s) } : null });
        if (s.cup && profile.d.cup) cupOut = recordCup(profile.d.cup, m.game.winner === s.myTeam);
      } catch (e) { console.error(e); }
      if (!s.replay && m.cfg) this.saveReplay(m, s, analytics, sum && profile.d.history[0] ? profile.d.history[0].t : Date.now());
      if (sum && (sum.promoted || sum.unlocks.length) && !sum.demoted) setTimeout(() => audio.sfx('powerup', 0.8), 700);
      const src = s.replay ? s.replay : m.cfg ? { cfg: m.cfg, log: m.runner.log, skins: this.renderer.skins } : null;
      if (potg && sum && profile.d.history[0]) { profile.d.history[0].potg = potg.title; profile.save(); }
      if (sum && s.oppId && profile.d.history[0]) { profile.d.history[0].opp = s.oppId; profile.save(); } // Friends: Recently played
      this.potgReel = potg && src ? this.prerollPOTG(src, potg) : null;
      const report = s.myTeam >= 0 ? reportCard(m.game, s.myTeam, m.hud.stats) : null;
      const args = [this, m.game, s.myTeam,
        s.cup ? () => showCup(this) : s.mode === 'ai' ? () => this.startVsAI(s.gameMode === 'rush' ? 'rush' : 'classic') : s.mode === 'watch' ? () => this.watch() : null,
        () => this.menu(), { progress: progressPanel(sum, cupOut), ladder, social: s.mode === 'coop' ? coopResults(this, s, m.game) : socialPanel(this, s), againLabel: s.cup ? 'Back to bracket' : null, potg: this.potgReel ? potg : null, report,
          onPOTG: () => this.playPOTG(), onClip: potg && src && clipSupport() ? () => saveClip(src, potg, s.names, this.mapCanvas(m.game.world)) : null,
          analytics, onAnalysis: analytics ? () => showAnalysis(analytics, { title: 'Match analysis', onTheater: this.lastReplay() ? () => this.watchReplay(null, { back: () => this.backToResults() }) : null }) : null,
          onReplay: () => this.watchReplay(null, { back: () => this.backToResults() }), share: sum ? () => shareMatch(profile.d.history[0], { name: this.name, rank: profile.rank.label }, this.lastReplay()) : null }];
      this.lastResults = { args, session: s, src, potg };
      showResults(...args);
      if (s.mode === 'coop') this.cleanupNet(); // no rematch in co-op: the room closes with the results
      if (sum) setTimeout(() => rankMoment(sum), 900);
      // confetti only for a real win of your own (a promotion brings its own with the rank card)
      if (won && s.myTeam >= 0 && !s.replay && !(sum && sum.promoted)) setTimeout(() => confetti(), 350);
    });
  }
  // ───────────── Play of the Game ─────────────
  // A fresh Game is fast-forwarded headlessly to the highlight in small background slices while the
  // results screen is up, so the replay usually starts the moment it is tapped.
  prerollPOTG(src, potg) {
    const game = new Game(JSON.parse(JSON.stringify(src.cfg)));
    const runner = new LocalRunner(game, -1, { noHalftime: true, script: src.log });
    const reel = { game, runner, potg, skins: src.skins || [{}, {}], ready: false, stop: false };
    const slice = (ms) => { const t0 = performance.now(); while (!reel.ready && performance.now() - t0 < ms) reel.ready = runner.skipTo(potg.start, 40); return reel.ready; };
    const bg = () => { if (reel.stop || slice(10)) return; setTimeout(bg, 25); };
    setTimeout(bg, 400);
    reel.slice = slice;
    return reel;
  }
  playPOTG() {
    const reel = this.potgReel; if (!reel || reel.used) return;
    reel.used = true; reel.stop = true;
    const go = () => {
      const prev = this.session;
      this.session = { mode: 'watch', potg: reel.potg, replay: { cfg: reel.game.cfg, skins: reel.skins }, myTeam: -1, seed: prev.seed, mapId: prev.mapId, names: prev.names, rng: new Rng(1),
        prebuilt: { game: reel.game, runner: reel.runner } };
      this.fade(() => this.startMatch());
    };
    if (reel.ready) { go(); return; }
    // still rewinding: show progress and finish at full speed
    const box = h('div', { class: 'potgload' }, h('b', {}, 'Rewinding the tape…'), h('div', { class: 'barw' }, h('i')));
    document.body.append(box);
    const bar = box.querySelector('i');
    const step = () => {
      if (reel.slice(40)) { box.remove(); go(); return; }
      bar.style.width = Math.round(reel.game.tick / Math.max(1, reel.potg.start) * 100) + '%';
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  endPOTG() {
    const m = this.match; if (!m) return;
    this.match = null;
    this.teardownMatch(m);
    const lr = this.lastResults;
    this.fade(() => {
      this.showScreen(true);
      if (!lr) { this.menu(); return; }
      this.session = lr.session;
      if (lr.src && lr.potg) this.potgReel = this.prerollPOTG(lr.src, lr.potg); // ready for "watch again"
      showResults(...lr.args);
    });
  }
  // Rematch (both accepted on online results): the original host starts a fresh match on the same
  // connection with the sides swapped; the guest follows on 'rmstart'. Ranked stays ranked only if it was.
  // The results' session.
  // (Also while the results' Play of the Game or a replay opened from them plays: those run as 'watch' sessions.)
  replayFromResults() { const s = this.session; return !!(s && s.mode === 'watch' && (s.potg || s.theaterBack) && this.lastResults); }
  resultsSession() { return this.replayFromResults() ? this.lastResults.session : this.session; }
  leaveReplay() {
    if (!this.replayFromResults()) return;
    const pm = this.match; this.match = null;
    if (pm && pm.theater) { document.getElementById('thfollow')?.remove(); pm.theater.seeking && pm.theater.seeking.el && pm.theater.seeking.el.remove(); }
    if (pm) this.teardownMatch(pm);
  }
  startRematch(oppElo) {
    const old = this.resultsSession(); if (!this.net || !old || !old.finished || old.mode !== 'host') return;
    this.leaveReplay();
    const myTeam = 1 - old.myTeam, seed = (Math.random() * 2 ** 31) >>> 0, gameMode = old.gameMode === 'rush' ? 'rush' : 'classic';
    const names = [0, 1].map((t) => (t === myTeam ? this.name : old.names[1 - old.myTeam]));
    const s = this.session = { mode: 'host', gameMode, myTeam, seed, mapId: this.pickMap(seed, gameMode), names, rng: new Rng(seed), ranked: !!old.ranked, queue: old.queue,
      oppId: old.oppId, oppElo: oppElo || old.oppElo, matchId: newMatchId() };
    this.net.t.send({ t: 'rmstart', seed, names, map: s.mapId, mode: gameMode, match: s.matchId, team: 1 - myTeam, ranked: s.ranked, elo: profile.elo });
    this.startDraft(); // like a fresh 'start': both drafts open at once, so no draft message can arrive early
  }
  joinRematch(m, old) {
    const myTeam = m.team === 0 ? 0 : 1;
    const s = this.session = { mode: 'join', gameMode: m.mode === 'rush' ? 'rush' : 'classic', myTeam, seed: m.seed, mapId: m.map, names: m.names, rng: new Rng(m.seed),
      ranked: !!(old.ranked && m.ranked), queue: old.queue, oppId: old.oppId, oppElo: m.elo || old.oppElo, matchId: m.match || null };
    s.names[myTeam] = this.name;
    this.startDraft();
  }
  // Online ladder: both players report; the server counts the match when the reports agree.
  async reportOnline(m, s) {
    const g = m.game, season = profile.season.id;
    const body = { match: s.matchId, season, side: s.myTeam, opponent: s.oppId, winner: g.winner, checksum: String(g.checksum()), mode: s.queue === 'ranked' && s.ranked ? 'ranked' : s.gameMode === 'rush' ? 'rush' : 'casual',
      summary: { picks: [0, 1].map((t) => g.teams[t].heroes.map((x) => x.heroId)), kills: [g.teams[0].kills, g.teams[1].kills], len: Math.round(g.time) } };
    try {
      let r = await reportMatch(body);
      for (let i = 0; i < 6 && r && r.status === 'pending'; i++) { await new Promise((res) => setTimeout(res, 2500)); const st = await matchStatus(s.matchId); if (st.status !== 'pending') r = { ...r, ...st }; }
      return r && { ...r, mySide: s.myTeam, casual: body.mode !== 'ranked' };
    } catch (e) { return { status: 'offline', error: String(e.message || e), casual: body.mode !== 'ranked' }; }
  }
  // Replays: config + command log is enough to re-run the whole match deterministically. The last few are kept
  // with their analytics (src/ui/replays.js); `id` links one to its match-history entry.
  saveReplay(m, s, A, id) {
    storeMatch({ id, v: VERSION, t: Date.now(), cfg: m.cfg, log: m.runner.log, names: s.names, mapId: s.mapId,
      myTeam: s.myTeam, winner: m.game.winner, skins: this.renderer.skins, len: Math.round(m.game.time), A });
  }
  lastReplay() { const r = loadLib()[0]; return this.canPlay(r) ? r : null; }
  canPlay(r) { return !!(r && r.cfg && r.v === VERSION); }
  // Watch a replay in the Theater. shared: a replay from a share link; opts.entry: a stored match; opts.back: where Quit goes.
  watchReplay(shared, opts = {}) {
    const r = shared ? (shared.v === VERSION ? { ...shared, A: shared.A ? { ...shared.A, my: -1 } : null, id: null } : null) : opts.entry ? (this.canPlay(opts.entry) ? opts.entry : null) : this.lastReplay();
    if (!r) { toast(shared ? 'That replay is from an older version of the game.' : 'No replay saved yet (or it is from an older version).'); return; }
    stopParade(); this.dropReel();
    this.session = { mode: 'watch', replay: r, theaterBack: opts.back || null, myTeam: -1, seed: r.cfg.seed, mapId: r.mapId || r.cfg.map, names: r.names, rng: new Rng(1) };
    this.fade(() => this.startMatch());
  }
  // Back from the Theater to the results it was opened from.
  backToResults() {
    const lr = this.lastResults; if (!lr) { this.menu(); return; }
    this.session = lr.session;
    if (lr.src && lr.potg && !this.potgReel) this.potgReel = this.prerollPOTG(lr.src, lr.potg);
    showResults(...lr.args);
  }
  quitMatch() {
    if (this.session && this.session.potg) { this.endPOTG(); return; }
    if (this.match && this.match.theater) { this.match.theater.exit(); return; }
    if (!confirm('Leave this match?')) return;
    if (this.net) this.net.t.send(this.session && this.session.mode === 'coop' ? { t: 'quit', p: this.session.slot } : { t: 'quit' });
    const m = this.match; this.match = null;
    if (m) { m.game.over = true; this.teardownMatch(m); }
    this.menu();
  }
}

// Installable app: the service worker (sw.js) serves repeat launches from cache and keeps it fresh.
// A new build is only switched in when it is safe: on the menu, never mid-match (see App.safeUpdate).
function registerSW() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  const sw = navigator.serviceWorker;
  sw.register('sw.js?v=' + VERSION).then((reg) => {
    const waiting = () => { if (reg.waiting && sw.controller) { app.update = { reg }; app.safeUpdate(); } };
    waiting();
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); }); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  sw.addEventListener('message', (e) => { if (e.data && e.data.t === 'sw-updated') { app.update = app.update || {}; app.safeUpdate(); } });
  let reloaded = false;
  sw.addEventListener('controllerchange', () => { if (app.update && !reloaded) { reloaded = true; location.reload(); } });
}
export function toggleFullscreen() {
  const d = document, el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
  } catch { toast('Full screen is not available here. Use "Add to Home Screen" instead.'); }
}
window.toggleFullscreen = toggleFullscreen;
const app = new App();
window.app = app;
app.boot();
registerSW();
