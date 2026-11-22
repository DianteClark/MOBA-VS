// Coach Academy: the guided first match. Granny Ume's bubble walks a new coach through the draft (bans, one hero
// per role), prep (lineup, plan, deck), then the match: calls, the map ring, the minimap, the scout pet, the Kami
// and its blessing, tactic cards, fight forecasts, the decision tray, the Ults stance, Coach Moments, the Oni, the
// Kraken and the Elder. One lesson at a time; a lesson that asks for an action waits for it (or "Got it"). Short,
// skippable ("Skip tutorial" ends the guide; the match plays on) and resumable (lessons seen are remembered:
// src/campaign.js). The match itself is a scripted mission (src/data/campaign.js TUTORIAL, src/sim/mission.js):
// early Kami / Oni / Kraken / Elder, a weakened rival and a scripted enemy Kami call, so every step happens.
// The bubble sits in a box of the screen chosen per lesson (never over the control it points at), and the
// control it is about glows (the coach-tips highlight). In the match it docks right above the call bar.
import { h } from './dom.js';
import { audio } from '../audio.js';
import { rivalFace } from '../data/rivals.js';
import { currentTurn } from '../sim/draft.js';
import { MOMENT_IDS, momentReady } from '../sim/moments-coach.js';
import { lessonSeen, markLesson, skipTutorial, tutStage, tutorialDone } from '../campaign.js';

// ── the bubble ──
class Bubble {
  constructor() { this.el = null; this.glow = null; }
  show(lesson, n, total, { onOk, onSkip }) {
    this.hide();
    const ok = h('button', { class: 'btn small gdok', onclick: () => { audio.sfx('accept', 0.4); onOk(); } }, lesson.wait ? 'Got it' : lesson.last ? 'Play on' : 'Next');
    this.el = h('div', { class: 'guide', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Coach Academy' },
      h('img', { class: 'gdface', src: rivalFace('ume'), alt: '' }),
      h('div', { class: 'gdbody' }, h('small', { class: 'gdn' }, `COACH ACADEMY ${n}/${total}`), h('p', { class: 'gdtx' }, h('b', {}, lesson.title + ': '), lesson.text),
        h('div', { class: 'gdbtns' }, h('button', { class: 'linkbtn gdskip', title: 'End the guide (the match plays on)', onclick: () => onSkip() }, 'Skip tutorial'), ok)));
    document.body.append(this.el);
    this.lesson = lesson;
    this.place();
    this.target = lesson.target ? document.querySelector(lesson.target) : null;
    if (this.target) this.target.classList.add('tipglow');
    audio.sfx('alert', 0.3);
  }
  // inside the lesson's box: bottom-aligned (or top-aligned), as wide as the box allows
  place() {
    const el = this.el, L = this.lesson; if (!el) return;
    const vw = innerWidth, vh = innerHeight, pad = 8;
    let box = null;
    if (L.box === 'dock') {
      // the open battlefield: between the team columns, under the score, right above the call bar / tray
      const rc = (id) => { const e = document.getElementById(id); if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
      const lc = rc('leftcol'), rr = rc('rightcol'), tc = rc('topcenter'), cmd = document.querySelector('#cmdbar .tray:not(.empty)') || document.querySelector('#cmdbar .handrow') || document.getElementById('cmdbar');
      const cr = cmd ? cmd.getBoundingClientRect() : { top: vh - 80 }, mm = rc('brcol');
      const bn = document.querySelector('#banner > *') ? rc('banner') : null; // a big moment's banner stays readable
      box = { left: (lc ? lc.right : 0) + 6, right: (rr ? rr.left : mm && mm.top > vh / 2 ? mm.left : vw) - 6, top: Math.max(tc ? tc.bottom : 40, bn && bn.bottom < cr.top - 60 ? bn.bottom : 0) + 6, bottom: cr.top - 6 };
    } else {
      const b = L.box && document.querySelector(L.box);
      if (b) { const r = b.getBoundingClientRect(); box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }
    }
    if (!box) box = { left: pad, right: vw - pad, top: pad, bottom: vh - pad };
    const w = Math.max(200, Math.min(L.box === 'dock' ? 380 : 420, box.right - box.left - 8));
    el.style.width = w + 'px';
    const left = Math.max(pad, Math.min(vw - w - pad, (box.left + box.right) / 2 - w / 2));
    el.style.left = left + 'px';
    // short screens (Safari toolbars, the tray open): a one-row bubble without the portrait
    el.classList.remove('tight');
    let hgt = el.offsetHeight;
    if (hgt > box.bottom - box.top - 8) { el.classList.add('tight'); hgt = el.offsetHeight; }
    const top = L.top ? box.top + 4 : box.bottom - hgt - 4;
    el.style.top = Math.max(pad, Math.min(vh - hgt - pad, top)) + 'px';
  }
  hide() {
    if (this.target) this.target.classList.remove('tipglow');
    this.target = null;
    if (this.el) this.el.remove();
    this.el = null; this.lesson = null;
  }
}

// ── draft + prep (the app's own screens, watched while the session lasts) ──
const myTurn = (s, act) => { const t = s.draft && !s.draft.done && currentTurn(s.draft); return !!t && t.team === s.myTeam && t.act === act; };
const SETUP = [
  { id: 'd-intro', title: 'The draft', target: '.draft .dtop', box: '.draft .grid', when: (s) => s.draft && !s.draft.done && !s.draft.fixed,
    text: 'You and Taro take turns: bans first, then picks. A hero can only be taken once per match. No clock today.' },
  { id: 'd-ban', title: 'Ban', target: '.draft .grid', box: '.draft .grid', wait: true, when: (s) => myTurn(s, 'ban'), done: (s) => s.draft.bans[s.myTeam].length >= 1 || s.draft.done,
    text: 'Tap a hero marked BAN?, then the Ban button. A banned hero is out for both teams.' },
  { id: 'd-pick', title: 'Pick', target: '.draft .rtabs', box: '.draft .grid', wait: true, when: (s) => myTurn(s, 'pick'), done: (s) => s.draft.picks[s.myTeam].length >= 1 || s.draft.done,
    text: 'Build one hero per role: Top, Jungle, Mid, Bot and Support. REC marks strong picks. Tap one, then Lock.' },
  { id: 'd-read', title: 'Read their picks', target: '.draft .dteam.t1', box: '.draft .grid', when: (s) => myTurn(s, 'pick') && s.draft.picks[1 - s.myTeam].length >= 2,
    text: 'Their picks show here. Heroes that counter yours get a +N on the prep screen: pick heroes that beat theirs.' },
  { id: 'p-lineup', title: 'Prep', target: '.prep .pminis', box: '.prep .phead', top: true, when: (s, scr) => scr === 'prep',
    text: 'Your lineup: lanes and item builds, set for you. Adjust changes any of it. Enemy threats are marked +N.' },
  { id: 'p-plan', title: 'Game plan', target: '.prep .pplan .pp', box: '.prep .pminis', when: (s, scr) => scr === 'prep',
    text: 'Aggro, Scale, Objective, Split or Protect: how your heroes play all match. The recommended plan fits your team.' },
  { id: 'p-deck', title: 'Tactic deck', target: '.prep .pdeck', box: '.prep .pminis', when: (s, scr) => scr === 'prep',
    text: 'Three one-shot tactic cards come with you. You will play them from the bottom bar.' },
  { id: 'p-ready', title: 'Ready', target: '.prep .readybtn', box: '.prep .pminis', wait: true, when: (s, scr) => scr === 'prep', done: (s) => s.ready[s.myTeam],
    text: 'No clock today either. Tap Ready when you are: the match starts.' },
];

// Watches the tutorial session's draft and prep. Started with the session (src/campaign.js startTutorial).
export function guideSetup(app) {
  const s = app.session, B = new Bubble();
  let cur = null;
  const total = SETUP.length + MATCH.length;
  const stop = () => { clearInterval(iv); B.hide(); window.removeEventListener('resize', onResize); };
  const onResize = () => B.place();
  window.addEventListener('resize', onResize);
  const iv = setInterval(() => {
    if (app.session !== s || app.match || tutorialDone()) { stop(); return; }
    const scr = document.querySelector('#screen .draft') ? 'draft' : document.querySelector('#screen .prep') ? 'prep' : '';
    if (s.draft && s.draft.done && !s.draft.fixed) tutStage(1);
    if (cur) {
      if (!document.body.contains(B.el)) { cur = null; return; }
      if (cur.done && cur.done(s)) { markLesson(cur.id); cur = null; B.hide(); return; }
      if (cur.when && !cur.when(s, scr) && !cur.wait) { cur = null; B.hide(); return; } // the moment passed (a turn ended)
      // screens re-render often: keep the highlight on the live element
      const t = cur.target && document.querySelector(cur.target);
      if (t && t !== B.target) { if (B.target) B.target.classList.remove('tipglow'); B.target = t; t.classList.add('tipglow'); B.place(); }
      return;
    }
    if (!scr) return;
    const next = SETUP.find((l) => !lessonSeen(l.id) && l.when(s, scr) && (l.id[0] === scr[0]));
    if (!next || !document.querySelector(next.box)) return;
    cur = next;
    B.show(next, SETUP.indexOf(next) + 1, total, {
      onOk: () => { markLesson(next.id); cur = null; B.hide(); },
      onSkip: () => { skipTutorial(); stop(); audio.sfx('move', 0.4); },
    });
  }, 200);
}

// ── the match ──
const team = (g, my) => g.teams[my];
const myEv = (g, my, type, pred = () => true) => g.events.some((e) => e.type === type && e.team === my && pred(e));
const trayHas = (hud, cls) => !!(hud.dock && hud.dock.tray && hud.dock.tray.cur && (hud.dock.tray.cur.cls || '').includes(cls));
const MATCH = [
  { id: 'm-welcome', title: 'You are the coach', target: '#myteam', pause: true, when: (g) => g.time > 7, // after the plan reveal
    text: 'Your five heroes lane, farm and fight on their own. You steer them with calls, cards and a game plan.' },
  { id: 'm-calls', title: 'Calls', target: '#cmdbar .callrow', wait: true, after: 'm-welcome', when: () => true, done: (g, my) => myEv(g, my, 'call', (e) => ['gank', 'group', 'objective', 'split', 'invade', 'reset', 'safe', 'shrine', 'focus'].includes(e.call.type)),
    text: 'Calls steer the whole team. Try one now: tap Gank or Push, then a lane. Calls cost charges: +1 every 20s.' },
  { id: 'm-ring', title: 'The map ring', wait: true, after: 'm-calls', when: () => true, done: (g, my, hud) => !!(hud.dock && hud.dock.ring),
    text: 'Tap the battlefield (not a hero): a ring of calls that fit that spot opens. Tapping your own hero follows them.' },
  { id: 'm-minimap', title: 'The minimap', target: '#mm', pause: true, after: 'm-ring', when: () => true,
    text: 'Blue dots are your heroes, red dots the enemies you can see, icons the monsters. Tap it to move the camera there.' },
  { id: 'm-scout', after: 'm-welcome', title: 'Scout pet', target: '#objtimers .ot.scout', wait: true, when: (g, my) => g.beasts && g.tick >= team(g, my).scoutCd && !g.beasts.pet(my),
    done: (g, my) => myEv(g, my, 'scout'), text: 'Your scout is ready, and free. Tap the map where you want eyes, then Scout: it lights the area for 30s.' },
  { id: 'm-kami', after: 'm-welcome', title: 'The Frog Kami', target: '#cmdbar .callrow', wait: true, when: (g) => !!(g.objectives.dragon && g.objectives.dragon.alive),
    done: (g, my) => myEv(g, my, 'call', (e) => e.call.type === 'objective' && e.call.obj === 'dragon') || g.events.some((e) => e.type === 'objective' && e.obj === 'dragon'),
    text: 'It woke in its pit! Each Kami slain gives your team a stack of its blessing for the match (Frog: regen). Call Kami!' },
  { id: 'm-cards', after: 'm-welcome', title: 'Tactic cards', target: '#cmdbar .tcard', wait: true, when: (g) => g.time > 60, done: (g, my) => myEv(g, my, 'tactic'),
    text: 'Your three cards are one-shot plays. Rally Cry before a fight, Second Wind to heal. Tap one now.' },
  { id: 'm-forecast', after: 'm-welcome', title: 'Fight forecast', target: '#cmdbar .tray', when: (g, my, hud) => trayHas(hud, 'fcast'),
    text: 'The analyst sees a fight coming, 5 to 11 seconds ahead, and who is favoured. Join a good one, dodge a bad one.' },
  { id: 'm-tray', after: 'm-welcome', title: 'Decision tray', target: '#cmdbar .tray', when: (g, my, hud) => trayHas(hud, 'ccall') || trayHas(hud, 'req'),
    text: 'Coach\'s Calls and hero requests wait here, one at a time. Gold means act now. Answer, or let it pass.' },
  { id: 'm-stance', after: 'm-welcome', title: 'Ults stance', target: '#cmdbar .ultbtn', wait: true, when: (g, my) => team(g, my).heroes.some((x) => x.level >= 5),
    done: (g, my) => !!team(g, my).ultMode, text: 'Auto: heroes choose. One tap: ALL-IN, ultimates fire together in the next fight. Again: Hold them.' },
  { id: 'm-moments', after: 'm-welcome', title: 'Coach Moments', target: '#cmdbar .momentbtn', wait: true, when: (g, my) => MOMENT_IDS.some((k) => momentReady(g, my, k)),
    done: (g, my) => myEv(g, my, 'moment'), text: 'Timeout, Rally and All-Out Push: each once per match. Save one for a fight that swings.' },
  { id: 'm-oni', after: 'm-welcome', title: 'The Oni', target: '#objtimers', pause: true, when: (g) => !!(g.objectives.herald && g.objectives.herald.alive),
    text: 'The Oni woke by the river, for a short while. Slay it, then unleash it on a lane: it charges their towers.' },
  { id: 'm-kraken', after: 'm-welcome', title: 'The Kraken', target: '#objtimers', pause: true, when: (g) => !!(g.objectives.baron && g.objectives.baron.alive),
    text: 'The toughest monster. Its slayers\' minions push much harder for a while. Fight for it when you are ahead.' },
  { id: 'm-elder', after: 'm-welcome', title: 'The Elder Kami', target: '#objtimers', pause: true, when: (g) => g.events.some((e) => e.type === 'bossSoon') || !!(g.objectives.boss && g.objectives.boss.alive),
    text: 'The Elder Frog lands in the centre. Its blessing and the Elder\'s Push end matches: group up and call it.' },
  { id: 'm-done', title: 'Graduation', last: true, when: (g) => (lessonSeen('m-elder') && lessonSeen('m-kraken')) || g.time > 540,
    text: 'That is the whole toolbox, dear. Now win: push to their Crystal. Skipped lessons come back in Settings > Coach tips.' },
];

// In-match guide (replaces the first-match coach tips in the tutorial). Hud calls tick() every frame.
export class MatchGuide {
  constructor(hud) {
    this.hud = hud; this.B = new Bubble(); this.cur = null; this.lastEnd = -1e9; this.off = tutorialDone(); this.wasPaused = false;
    this.onResize = () => this.B.place(); window.addEventListener('resize', this.onResize);
    tutStage(2);
  }
  tick() {
    const hud = this.hud, g = hud.g, my = hud.my;
    if (this.off) return;
    if (this.cur) {
      if (this.cur.done && this.cur.done(g, my, hud)) { audio.sfx('powerup', 0.4); this.end(); return; }
      if (hud.holding() || g.over) { this.end(true); return; } // halftime / the end: put it away (it comes back)
      if (this.B.el && this.cur.box === 'dock') this.B.place(); // the tray opens and closes under it
      return;
    }
    if (g.over || hud.holding() || hud.dock && hud.dock.sheetId || g.time - this.lastEnd < 4) return;
    const next = MATCH.find((l) => !lessonSeen(l.id) && (!l.after || lessonSeen(l.after)) && l.when(g, my, hud));
    if (next) this.show(next);
  }
  show(l) {
    const R = this.hud.runner, n = SETUP.length + MATCH.indexOf(l) + 1, total = SETUP.length + MATCH.length;
    this.cur = { ...l, box: 'dock' };
    if (l.pause && !R.online) { this.wasPaused = !!R.paused; R.paused = true; this.paused = true; if (this.hud.refreshCtrl) this.hud.refreshCtrl(); }
    this.B.show(this.cur, n, total, { onOk: () => this.end(), onSkip: () => { skipTutorial(); this.end(); this.off = true; } });
  }
  // keep: put it away without marking it seen (halftime): it shows again later
  end(keep) {
    const l = this.cur; if (!l) return;
    if (!keep) markLesson(l.id);
    this.cur = null; this.B.hide(); this.lastEnd = this.hud.g.time;
    if (this.paused) { this.paused = false; this.hud.runner.paused = this.wasPaused; if (this.hud.refreshCtrl) this.hud.refreshCtrl(); }
  }
  destroy() { this.B.hide(); window.removeEventListener('resize', this.onResize); if (this.paused) this.hud.runner.paused = this.wasPaused; }
}
