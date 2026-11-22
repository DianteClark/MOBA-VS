// First-match coach tips: four short, dismissible cards that explain calls, the map ring and minimap,
// the Ults stance and Coach Moments. Each shows once, in the decision tray (so it never stacks with
// another card: a Coach's Call or a hero request always goes first), highlights the control it is
// about, and is remembered in the profile. "Skip tips" turns the rest off; Settings can replay them.
import { h } from './dom.js';
import { PRIO } from './tray.js';
import { MOMENT_IDS, momentReady } from '../sim/moments-coach.js';
import { profile } from '../profile.js';
import { audio } from '../audio.js';

export const TIPS = [
  { id: 'calls', sel: '#cmdbar .callrow', title: 'Make the calls', text: 'Your heroes play on their own. Tap a call to steer them. Calls cost ◆ charges: +1 every 20s.',
    when: (g) => g.time > 3 },
  { id: 'ring', sel: '#mm', title: 'Tap the map', text: 'Tap the battlefield for a ring of calls that fit that spot. Tap the minimap to jump the camera.',
    when: (g, t) => g.time > 22 && t.gap(10) },
  { id: 'stance', sel: '#cmdbar .ultbtn', title: 'Ults stance', text: 'Auto: heroes choose. One tap: ALL-IN, ultimates fire in the next fight. Tap again: Hold them. Free.',
    when: (g, t, my) => t.gap(20) && (g.teams[my].heroes.some((x) => x.level >= 5) || g.time > 150) },
  { id: 'moments', sel: '#cmdbar .momentbtn', title: 'Coach Moments', text: 'Three once-per-match plays: Timeout, Rally and All-Out Push. Save them for a swing.',
    when: (g, t, my) => t.gap(20) && MOMENT_IDS.some((k) => momentReady(g, my, k)) },
];
const seen = () => profile.d.tips || (profile.d.tips = {});
export const tipsLeft = () => TIPS.some((t) => !seen()[t.id]);
export function resetTips() { profile.d.tips = {}; profile.save(); }

export class CoachTips {
  constructor(hud) { this.hud = hud; this.cur = null; this.lastEnd = -1e9; this.off = false; }
  // seconds of game time since the last tip closed
  gap(s) { return this.hud.g.time - this.lastEnd > s; }
  tick() {
    const hud = this.hud, g = hud.g;
    // the highlight follows the card: off while a Coach's Call or a request holds the slot
    const now = performance.now(), dt = Math.min(1000, now - (this.lastTick || now)); this.lastTick = now;
    if (this.cur && hud.dock.tray.cur === this.cur) this.cur.seenMs = (this.cur.seenMs || 0) + dt;
    if (this.cur && this.target) this.target.classList.toggle('tipglow', hud.dock.tray.cur === this.cur);
    if (this.off || this.cur || !hud.dock || !hud.dock.tray || hud.holding()) return;
    const next = TIPS.find((t) => !seen()[t.id]);
    if (!next) { this.off = true; return; }
    if (next.when(g, this, hud.my)) this.show(next);
  }
  show(tip) {
    const tray = this.hud.dock.tray, n = TIPS.indexOf(tip) + 1;
    this.cur = tray.push({ key: 'tip:' + tip.id, prio: PRIO.tip, ttl: 22000, cls: 'tip',
      build: (it) => [h('span', { class: 'tipn' }, `TIP ${n}/${TIPS.length}`), h('span', { class: 'tx' }, h('b', {}, tip.title + ': '), tip.text),
        h('button', { class: 'tch', onclick: () => { audio.sfx('accept', 0.4); tray.end(it, 'ok'); } }, 'Got it'),
        h('button', { class: 'tx-x tskip', title: 'Turn the coach tips off', onclick: () => { this.skipAll(); tray.end(it, 'skip'); } }, 'Skip tips')],
      onShow: () => { audio.sfx('alert', 0.3); this.target = document.querySelector(tip.sel); if (this.target) this.target.classList.add('tipglow'); },
      // remembered once read: dismissed, or on screen for 6s+ (a tip pushed aside by a Coach's Call comes back later)
      onEnd: (why) => {
        if (why === 'ok' || why === 'skip' || (this.cur && this.cur.seenMs > 6000)) { seen()[tip.id] = 1; profile.save(); }
        if (this.target) this.target.classList.remove('tipglow'); this.target = null; this.cur = null; this.lastEnd = this.hud.g.time;
      } });
  }
  skipAll() { for (const t of TIPS) seen()[t.id] = 1; profile.save(); this.off = true; }
  destroy() { for (const e of document.querySelectorAll('.tipglow')) e.classList.remove('tipglow'); }
}
