// Weekly map event: the home-screen card (name, what it changes, countdown to next week's event) and its
// info sheet with the "Classic (no event)" opt-out. Rules live in src/data/events.js.
import { h, mount } from './dom.js';
import { weekEvent, EVENT_BY_ID } from '../data/events.js';
import { audio } from '../audio.js';

export function untilText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m % 60}m` : `${m % 60 || 1}m`;
}
const img = (ev, cls) => h('img', { class: cls, src: `assets/img/${ev.icon}.png`, alt: '' });

// Home card. The countdown ticks once a minute while the card is on screen.
export function eventCard(app) {
  const ev = app.weekEvent(), w = weekEvent(Date.now());
  if (!ev) return null;
  const cd = h('small', { class: 'kick' }, `WEEKLY EVENT · ${untilText(w.ends - Date.now())}`);
  const el = h('button', { class: 'h2card h2event' + (app.eventOff ? ' off' : ''), style: { '--ec': ev.color }, title: `${ev.name}: ${ev.blurb}`,
    onclick: () => { audio.sfx('move', 0.5); showEventInfo(app); } },
    h('span', { class: 'h2h' }, cd, h('b', {}, img(ev, 'evic'), ev.name), h('small', {}, app.eventOff ? 'Off · you play Classic' : ev.short)));
  const iv = setInterval(() => { if (!el.isConnected) { clearInterval(iv); return; } cd.textContent = `WEEKLY EVENT · ${untilText(weekEvent(Date.now()).ends - Date.now())}`; }, 30000);
  return el;
}

// Info sheet: what the event does, where it applies, next week's event, and the opt-out.
export function showEventInfo(app) {
  if (document.querySelector('.modal')) return;
  const ev = app.weekEvent(), w = weekEvent(Date.now()), next = EVENT_BY_ID[w.next.id] === ev ? null : w.next;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc, true); app.menu(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const inner = h('div', { class: 'panel mpanel evpanel', style: { '--ec': ev.color } });
  const render = () => mount(inner,
    h('div', { class: 'mhead' }, img(ev, 'evic big'), h('b', {}, ev.name), h('small', { class: 'muted' }, `Ends in ${untilText(w.ends - Date.now())}`), h('button', { class: 'x', title: 'Close', onclick: close }, 'X')),
    h('p', {}, ev.blurb),
    h('ul', { class: 'evwhere' },
      h('li', {}, 'On in Play vs AI, Casual, private rooms and Watch (5v5 Classic only; Lane Rush and the Cup stay as they are).'),
      h('li', {}, ev.ranked ? 'Ranked plays it too: it is balance-neutral.' : 'Ranked plays Classic this week: the event changes the balance.'),
      next ? h('li', { class: 'muted' }, `Next week: ${next.name} (${next.short}).`) : null),
    h('div', { class: 'seg3 evseg', role: 'radiogroup', 'aria-label': 'Weekly event' },
      ...[[false, `Play ${ev.name}`], [true, 'Classic (no event)']].map(([off, label]) => h('button', { class: 'chip' + (app.eventOff === off ? ' on' : ''), role: 'radio', 'aria-checked': String(app.eventOff === off),
        onclick: () => { app.setEventOff(off); audio.sfx('move', 0.5); render(); } }, label))),
    h('small', { class: 'muted' }, 'Queues ignore this choice so everyone in them plays the same rules.'));
  const wrap = h('div', { class: 'modal', onpointerdown: (e) => { if (e.target === wrap) close(); } }, inner);
  render();
  document.body.append(wrap);
  document.addEventListener('keydown', esc, true);
}
