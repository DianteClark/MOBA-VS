// Online quick chat: eight preset lines and a few emotes. Sent as plain network messages beside the
// lockstep stream (never through the sim command log), shown briefly near the top, rate-limited on
// both ends, and mutable (Settings → Mute quick chat, or the toggle in the panel).
import { h, mount, toast } from './dom.js';
import { settings, setSetting } from './settings.js';
import { audio } from '../audio.js';
import { EMOTE_IDS, EMOTES, emoteSrc } from '../data/cosmetics.js';
import { profile } from '../profile.js';

export const LINES = ['GG', 'Nice call', 'Watch Oni', 'Push now', 'Well played', 'Oops', 'Thanks', 'Hold up'];
const SHOW_MS = 3500, GAP_MS = 1500, BURST = 4, BURST_MS = 12000;

// Allows one message per GAP_MS and BURST per BURST_MS (the same rule guards what we receive).
class RateLimit {
  constructor() { this.t = []; }
  ok(now = performance.now()) {
    this.t = this.t.filter((x) => now - x < BURST_MS);
    if (this.t.length && now - this.t[this.t.length - 1] < GAP_MS) return false;
    if (this.t.length >= BURST) return false;
    this.t.push(now); return true;
  }
}
// A message is only ever an index into LINES or a known emote key (src/data/cosmetics.js): nothing free-form crosses the wire.
// You send the emotes you own; you see any known emote the opponent owns.
function validMsg(m) {
  return m && m.t === 'qc' && ((Number.isInteger(m.i) && m.i >= 0 && m.i < LINES.length && m.e === undefined) || (m.i === undefined && EMOTE_IDS.includes(m.e)));
}

export class QuickChat {
  constructor(hud, send) {
    this.hud = hud; this.send = send; this.out = new RateLimit(); this.inn = new RateLimit();
    this.btn = h('button', { id: 'qchatbtn', class: 'btn small', title: 'Quick chat', onclick: (e) => { e.stopPropagation(); this.toggle(); } }, h('img', { src: 'assets/img/emote/ok.png', alt: '' }), h('span', {}, 'Chat'));
    this.feed = h('div', { id: 'qfeed', class: 'hud' });
    this.panel = null;
    document.getElementById('ctrl').append(this.btn);
    document.getElementById('hud').append(this.feed);
    this._outside = (e) => { if (this.panel && !this.panel.contains(e.target) && e.target !== this.btn && !this.btn.contains(e.target)) this.close(); };
    window.addEventListener('pointerdown', this._outside, true);
  }
  toggle() { if (this.panel) this.close(); else this.open(); }
  open() {
    if (this.panel) return;
    audio.sfx('move', 0.4);
    const pick = (m) => () => this.say(m);
    this.panel = h('div', { id: 'qchat', class: 'hud' },
      h('div', { class: 'qlines' }, ...LINES.map((l, i) => h('button', { class: 'chip', onclick: pick({ i }) }, l))),
      h('div', { class: 'qemotes' }, ...EMOTE_IDS.filter((e) => profile.hasEmote(e)).map((e) => h('button', { class: 'qemo', title: EMOTES[e].name, 'aria-label': EMOTES[e].name, onclick: pick({ e }) }, h('img', { src: emoteSrc(e), alt: e })))),
      h('button', { class: 'chip qmute' + (settings.chatMute ? ' on' : ''), onclick: () => { setSetting('chatMute', !settings.chatMute); this.close(); toast(settings.chatMute ? 'Opponent quick chat muted' : 'Opponent quick chat on', 1400); } },
        settings.chatMute ? 'Muted: tap to unmute' : 'Mute opponent'));
    document.getElementById('hud').append(this.panel);
    // beside the button: below it if there is room, else above; clamped inside the safe area
    const b = this.btn.getBoundingClientRect(), pw = this.panel.offsetWidth, ph = this.panel.offsetHeight, W = innerWidth, H = innerHeight;
    const top = b.bottom + 6 + ph <= H - 8 ? b.bottom + 6 : Math.max(8, b.top - ph - 6);
    this.panel.style.left = Math.max(8, Math.min(W - pw - 8, b.right - pw)) + 'px'; this.panel.style.top = top + 'px';
  }
  close() { if (this.panel) { this.panel.remove(); this.panel = null; } }
  say(m) {
    if (!this.out.ok()) { toast('Easy there: one message at a time', 1200); return; }
    this.close();
    this.send({ t: 'qc', ...m });
    this.show(this.hud.my, m);
  }
  // Incoming from the network (already known to be { t: 'qc' }).
  receive(m) {
    if (!validMsg(m) || !this.inn.ok() || settings.chatMute) return;
    audio.sfx('move', 0.5);
    this.show(1 - this.hud.my, m);
  }
  show(team, m) {
    const mine = team === this.hud.my;
    const el = h('div', { class: 'qmsg ' + (mine ? 'me' : 'them'), style: { borderColor: `var(--team${team})` } },
      h('b', { style: { color: `var(--team${team})` } }, mine ? 'You' : (this.hud.app.session && this.hud.app.session.names[team]) || 'Rival'),
      m.e ? h('img', { src: emoteSrc(m.e), alt: EMOTES[m.e].name }) : h('span', {}, LINES[m.i]));
    this.place();
    this.feed.prepend(el);
    while (this.feed.childElementCount > 2) this.feed.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, SHOW_MS);
  }
  // Between the team column and the score block when there is room; otherwise centred under the
  // objective timers, below the ticker's slot (narrow desktop windows).
  place() {
    const lc = document.getElementById('leftcol').getBoundingClientRect(), sb = document.getElementById('scorebar').getBoundingClientRect();
    const ob = document.getElementById('objtimers').getBoundingClientRect();
    const room = sb.left - lc.right - 16, under = room < 120;
    this.feed.classList.toggle('under', under);
    this.feed.style.top = under ? Math.round(Math.max(sb.bottom, ob.bottom) + 30) + 'px' : '';
    this.feed.style.maxWidth = under ? '' : Math.round(room) + 'px'; // never reaches under the score block
  }
  destroy() { this.close(); this.btn.remove(); this.feed.remove(); window.removeEventListener('pointerdown', this._outside, true); }
}
