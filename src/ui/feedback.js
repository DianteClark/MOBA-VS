// "Send feedback": a short text, an optional screenshot of the game canvas (shown before sending, JPEG,
// at most ~100 KB) and, attached automatically and listed in the form, the version, device class and the
// last error this launch. Opened from Settings (menu and in match) and from the results screen.
import { h, toast } from './dom.js';
import { audio } from '../audio.js';
import { sendFeedback, deviceClass, lastError, opsVersion, track } from '../net/ops.js';
import { getAccount } from '../net/online.js';

const SHOT_MAX = 100 * 1024;

// A downscaled JPEG of the game canvas, or null when there is no frame to show.
export function canvasShot(canvas) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return null;
    for (const [w, q] of [[640, 0.6], [560, 0.5], [480, 0.42], [400, 0.35]]) {
      const s = Math.min(1, w / canvas.width), c = document.createElement('canvas');
      c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(canvas, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', q);
      if (url.startsWith('data:image/jpeg') && url.length <= SHOT_MAX) return url;
    }
  } catch { /* tainted or unsupported */ }
  return null;
}

export function openFeedback(app, { from = 'menu', runner = null } = {}) {
  document.querySelector('.modal.fbmodal')?.remove();
  const wasPaused = runner && !runner.online ? runner.paused : null;
  if (wasPaused === false) runner.paused = true;
  const inMatch = !!(app && app.match);
  const shot = app && app.renderer ? canvasShot(app.renderer.canvas || document.getElementById('game')) : null;
  let withShot = !!shot;
  const err = lastError();
  const meta = { screen: from, size: `${innerWidth}x${innerHeight}`, mode: app && app.session ? String(app.session.mode || '') : '' };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc, true); if (wasPaused === false) runner.paused = false; };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const ta = h('textarea', { class: 'fbtext', maxlength: 1000, rows: 4, placeholder: 'What happened, or what would make the game better?', oninput: () => { count.textContent = `${ta.value.length}/1000`; send.disabled = ta.value.trim().length < 3; } });
  const count = h('small', { class: 'muted' }, '0/1000');
  const send = h('button', { class: 'btn', disabled: true, onclick: async () => {
    send.disabled = true; send.textContent = 'Sending…';
    try {
      await sendFeedback({ text: ta.value.trim(), shot: withShot ? shot : null, meta });
      track('feedback');
      audio.sfx('accept', 0.6); toast('Thanks! Your feedback was sent.', 2200); close();
    } catch (e) { send.disabled = false; send.textContent = 'Send'; toast(String(e.message || e).includes('Too many') ? 'Feedback was just sent: try again in a few minutes.' : 'Could not send right now. Check your connection.', 2600); }
  } }, 'Send');
  const shotRow = shot ? h('label', { class: 'fbshot' },
    h('input', { type: 'checkbox', checked: true, onchange: (e) => { withShot = e.target.checked; img.classList.toggle('off', !withShot); } }),
    h('span', {}, inMatch ? 'Attach a screenshot of the match' : 'Attach a screenshot of the last match view'),
    h('img', { src: shot, alt: 'Screenshot preview' })) : null;
  const img = shotRow ? shotRow.querySelector('img') : null;
  const info = `Also sent: version ${opsVersion()} · ${deviceClass()} · ${err ? 'last error: ' + err.msg.slice(0, 60) : 'no errors this session'}${getAccount() ? ' · your account id' : ''}.`;
  const inner = h('div', { class: 'panel mpanel fbpanel' },
    h('div', { class: 'mhead' }, h('b', {}, 'Send feedback'), h('button', { class: 'x', title: 'Close', 'aria-label': 'Close', onclick: close }, 'X')),
    ta, h('div', { class: 'fbrow' }, count),
    shotRow,
    h('small', { class: 'muted fbinfo' }, info),
    h('div', { class: 'srow sfoot' }, h('button', { class: 'chip', onclick: close }, 'Cancel'), send));
  const wrap = h('div', { class: 'modal fbmodal', onpointerdown: (e) => { if (e.target === wrap) close(); } }, inner);
  document.body.append(wrap);
  document.addEventListener('keydown', esc, true);
  setTimeout(() => ta.focus(), 50);
}
