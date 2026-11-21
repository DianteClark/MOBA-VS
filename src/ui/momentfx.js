// Coach Moment presentation: a big title card (in the banner slot) with a ring burst, a screen tint, shake and punch,
// a sound sting, and a ticker line for the other side. Purely cosmetic (reads the 'moment' event).
import { h } from './dom.js';
import { MOMENTS } from '../sim/moments-coach.js';
import { TEAM_NAME } from '../sim/constants.js';
import { audio } from '../audio.js';

const SFX = { timeout: ['heal', 'levelup'], rally: ['wings', 'powerup'], push: ['tower', 'explosion'] };
export function momentFx(hud, e) {
  const m = MOMENTS[e.id]; if (!m) return;
  const mine = e.team === hud.view || hud.my < 0;
  if (!mine) {
    hud.ticker(`Enemy ${m.name}! ${m.short}`, 'danger', 3);
    audio.sfx('alert2', 0.6);
    return;
  }
  // the title card takes the banner slot (front of the queue): one big centred message at a time
  hud.banner(null, m.color, 1900, null, false, [h('i', { class: 'mring' }),
    h('small', {}, hud.my < 0 ? `${TEAM_NAME[e.team].toUpperCase()} COACH MOMENT` : 'COACH MOMENT'), h('b', {}, m.name.toUpperCase()), h('span', {}, m.short)]);
  const [a, b] = SFX[e.id] || ['powerup', 'objective'];
  audio.sfx(a, 0.9); setTimeout(() => audio.sfx(b, 0.7), 180);
  const r = hud.r; if (r) { r.screenTint(m.color, 0.22, 0.7); r.shakeBy(e.id === 'push' ? 0.6 : 0.35); r.punchBy(0.06); }
  if (hud.my >= 0) hud.ticker(e.id === 'push' ? 'All-Out Push: the next wave marches with super minions!' : `${m.name}: ${m.short}`, 'act', 2);
}
