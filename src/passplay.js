// Local pass-and-play: two coaches on one tablet.
//  * Draft: whenever the turn passes to the other side, a full-screen "pass the device" card covers the draft
//    (and pauses the turn clock) until the next coach taps in. No auto-picks from this device's lineups.
//  * Prep: Blue prepares, pass, Red prepares (each coach sees only their own lineup editor).
//  * Match: no fog (one shared screen). The coach in control is shown by the colour tab at the top: tap your
//    colour to take the dock (calls, cards, Moments, hero sheets). Commands always act for the side in control.
//  * Halftime: Blue adjusts, pass, Red adjusts (each with the full halftime clock).
// Pass-and-play is never rated and records no progress (an exhibition); its replay is saved like any other.
// The session is a vs-AI session with no AI coach (cfg.coach [false, false]) and `pnp: true`.
import { h } from './ui/dom.js';
import { currentTurn } from './sim/draft.js';
import { TEAM_COL } from './render/palette.js';
import { Hud } from './ui/hud.js';
import { showHalftime, hideHalftime } from './ui/halftime.js';
import { HALFTIME } from './sim/constants.js';
import { audio } from './audio.js';

const SIDE = ['Blue', 'Red'];
// The cover card between turns. onGo runs when the next coach taps in.
export function passCover(app, team, what, onGo) {
  document.querySelector('.pnpcover')?.remove();
  const s = app.session; s.pnpHold = true;
  const el = h('div', { class: 'pnpcover', role: 'dialog', 'aria-label': `Pass the device to the ${SIDE[team]} coach`, style: { '--tc': TEAM_COL[team] } },
    h('div', { class: 'pnpcard' }, h('small', {}, 'PASS THE DEVICE'), h('b', {}, `${s.names[team]} · ${SIDE[team]}`), h('span', { class: 'muted' }, what),
      h('button', { class: 'btn big', onclick: () => { el.remove(); s.pnpHold = false; audio.sfx('accept', 0.6); onGo && onGo(); } }, `I'm the ${SIDE[team]} coach`)));
  document.body.append(el);
}
export const clearCover = () => document.querySelector('.pnpcover')?.remove();
// Draft: hand the device over when the next turn belongs to the other side.
export function pnpTurn(app) {
  const s = app.session, t = currentTurn(s.draft);
  if (!t || (t.team === s.myTeam && s.pnpSeen)) return; // (the very first turn gets a cover too: who starts)
  s.pnpSeen = true; s.myTeam = t.team; s.autoPick = null; s.pickPrompt = null;
  if (app.draftView) { app.draftView.sel = null; app.draftView.render(); }
  passCover(app, t.team, `Your ${t.act === 'ban' ? 'ban' : 'pick'}.`, () => { s.turnStart = performance.now(); if (app.draftView) app.draftView.render(); });
}
// Prep: after Blue's Ready, Red takes the device and preps; returns true when the caller should stop.
export function pnpPrepNext(app) {
  const s = app.session;
  if (s.ready[0] && s.ready[1]) return false;
  const next = s.ready[0] ? 1 : 0;
  s.myTeam = next;
  app.startPrep();
  passCover(app, next, 'Set your lanes, builds, plan and tactic cards.', () => { s.prepEnd = performance.now() + app.prepSeconds * 1000; app.renderPrep && app.renderPrep(); });
  return true;
}
// Match: the colour tab (who has the dock) and the two-step halftime.
export function pnpMatch(app) {
  const m = app.match, s = app.session, g = m.game, runner = m.runner;
  app.renderer.fogOn = false;
  const bar = h('div', { class: 'pnpbar hud', role: 'radiogroup', 'aria-label': 'Coach in control' },
    ...[0, 1].map((t) => h('button', { class: 'pnpt t' + t, role: 'radio', style: { '--tc': TEAM_COL[t] }, onclick: () => take(t) }, SIDE[t])));
  document.getElementById('hud').append(bar);
  const mark = () => { for (const b of bar.children) { const on = b.classList.contains('t' + s.myTeam); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } };
  const take = (t) => {
    if (t === s.myTeam || !app.match) return;
    audio.sfx('move', 0.5);
    const old = m.hud, director = old.director;
    old.destroy();
    s.myTeam = t; runner.myTeam = t; app.renderer.viewTeam = t;
    m.hud = new Hud(app, g, runner, app.renderer, app.minimap, t, s.mode);
    if (director) m.hud.toggleDirector();
    mark();
  };
  m.pnpBar = bar; mark();
  // halftime: Blue then Red, each with the full clock; the runner's hold ends after Red's Ready
  runner.onHalftime = (ht) => {
    const turn = (t) => {
      hideHalftime(); take(t); ht.end = performance.now() + HALFTIME.seconds * 1000;
      const proxy = { send: (c) => { runner.myTeam = t; runner.send(c); }, readyHalftime: () => (t === 0 ? passCover(app, 1, 'Halftime: your adjustments.', () => turn(1)) : (runner.readyHalftime(), hideHalftime())) };
      showHalftime(app, g, t, proxy, { get end() { return ht.end; }, me: false, them: true });
    };
    passCover(app, 0, 'Halftime: your adjustments.', () => turn(0));
  };
}
export function pnpEnd(app) { clearCover(); const m = app.match; if (m && m.pnpBar) m.pnpBar.remove(); document.querySelector('.pnpbar')?.remove(); }
