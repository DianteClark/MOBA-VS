// Clip sharing: re-simulates the Play of the Game from the match replay (config + command log)
// on an offscreen canvas and records it with MediaRecorder (MP4 where the browser can, else WebM).
// Without MediaRecorder it falls back to a filmstrip image (12 frames on one PNG); without either
// the button explains why. The result goes to the system share sheet or downloads.
import { tr } from '../i18n/i18n.js';
import { h, mount, toast } from './dom.js';
import { Game } from '../sim/game.js';
import { LocalRunner } from '../net/runner.js';
import { DT, TICK_RATE } from '../sim/constants.js';
import { Renderer } from '../render/renderer.js';
import { paintMap } from '../render/mapgen.js';
import { TEAM_COL } from '../render/palette.js';

const W = 640, H = 360;
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
};
export const clipSupport = () => (pickMime() ? 'video' : typeof HTMLCanvasElement !== 'undefined' ? 'frames' : null);

// The heroes in the thick of it: centre of mass of heroes that fought in the last second (else the highlight spot).
function director(g, potg) {
  let x = 0, y = 0, n = 0;
  for (const t of g.teams) for (const u of t.heroes) if (u.alive && g.tick - u.lastCombat < TICK_RATE && (u.x - potg.x) ** 2 + (u.y - potg.y) ** 2 < 1100 * 1100) { x += u.x; y += u.y; n++; }
  return n ? { x: x / n, y: y / n - 20 } : { x: potg.x, y: potg.y };
}
function overlay(ctx, potg, k, names) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const col = TEAM_COL[potg.team] || '#ffd84a';
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, W, 30);
  ctx.fillStyle = col; ctx.fillRect(0, 30, W * k, 3);
  ctx.font = '12px PixelFont, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; // the renderer leaves it centred
  const potgL = tr('PLAY OF THE GAME');
  ctx.fillStyle = '#ffd84a'; ctx.fillText(potgL, 10, 15);
  ctx.fillStyle = '#f3ead8'; ctx.fillText(tr(potg.title).toUpperCase(), 22 + ctx.measureText(potgL).width, 15);
  ctx.textAlign = 'right'; ctx.fillStyle = '#a99fb3'; ctx.fillText(`${names[0]} vs ${names[1]} · ${potg.at}`, W - 10, 15); ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 82, H - 22, 76, 16);
  ctx.fillStyle = '#ffd84a'; ctx.fillText('MOBA-VS', W - 76, H - 14);
}

async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'MOBA-VS Play of the Game' }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'downloaded';
}

// src: { cfg, log, skins }, potg: { start, end, x, y, title, team, at }
// pre: { game, runner } already fast-forwarded to the highlight (the results' Play of the Game reel), so the clip starts
// recording at once instead of rewinding the whole match again; onDone: the clip no longer needs it (done or cancelled).
export function saveClip(src, potg, names = ['Blue', 'Red'], mapCanvas = null, pre = null, onDone = null) {
  const mode = clipSupport();
  if (!src || !potg || !mode) { toast('Clips are not supported in this browser.'); return; }
  const canvas = h('canvas', { width: W, height: H, class: 'clipcanvas' });
  const bar = h('i'), status = h('b', {}, 'Rewinding the tape…');
  let cancelled = false, rec = null;
  const done = () => { const f = onDone; onDone = null; if (f) f(); };
  const wrap = h('div', { class: 'clipwrap' }, h('div', { class: 'clipbox' }, status, canvas, h('div', { class: 'barw' }, bar), h('small', { class: 'clipstat' }, mode === 'video' ? 'Recording in real time. Keep this tab open.' : 'Your browser cannot record video: saving a filmstrip image instead.'),
    h('button', { class: 'btn', onclick: () => { cancelled = true; try { rec && rec.state !== 'inactive' && rec.stop(); } catch { /* ignore */ } wrap.remove(); done(); } }, 'Cancel')));
  document.body.append(wrap);

  const game = pre ? pre.game : new Game(JSON.parse(JSON.stringify(src.cfg)));
  const runner = pre ? pre.runner : new LocalRunner(game, -1, { noHalftime: true, script: src.log });
  const r = new Renderer(canvas);
  // an offscreen-sized renderer: fixed resolution, no DOM measuring
  r.resize = () => {}; r.dpr = 1; canvas.width = W; canvas.height = H; r.fog.width = W; r.fog.height = H; r.W = W; r.H = H;
  r.attach(game, -1, mapCanvas || paintMap(game.world)); r.fogOn = false; r.skins = src.skins || [{}, {}];
  r.cam.x = potg.x; r.cam.y = potg.y; r.cam.zoom = 0.95;
  // 1) fast-forward headlessly to the highlight in small slices (keeps the page responsive)
  const ff = () => {
    if (cancelled) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 12) if (runner.skipTo(potg.start, 40)) { r.attach(game, -1, r.map); r.fogOn = false; start(); return; }
    bar.style.width = Math.round(game.tick / Math.max(1, potg.start) * 100) + '%';
    setTimeout(ff, 0);
  };
  // 2) play the highlight in real time, drawing every frame; record it (or grab frames)
  const frames = [];
  let chunks = [], mime = pickMime();
  const start = () => {
    status.textContent = mode === 'video' ? 'Recording the Play of the Game…' : 'Capturing frames…';
    if (mode === 'video') {
      const stream = canvas.captureStream(30);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => { if (!cancelled) finish(); };
      rec.start(250);
    }
    let last = performance.now(), grab = 0;
    const span = Math.max(1, potg.end - potg.start);
    const loop = (now) => {
      if (cancelled) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      runner.update(dt, () => r.snapshot(), () => r.consume());
      const c = director(game, potg); r.focus = { x: c.x, y: c.y, zoom: 1.05 };
      r.draw(runner.alpha, dt);
      const k = Math.min(1, (game.tick - potg.start) / span);
      overlay(r.ctx, potg, k, names);
      bar.style.width = Math.round(k * 100) + '%';
      if (mode === 'frames' && (grab += dt) >= span * DT / 12) { grab = 0; if (frames.length < 12) frames.push(snapshotFrame(canvas)); }
      if (game.tick >= potg.end || game.over) { if (mode === 'video') { try { rec.requestData(); } catch { /* ignore */ } setTimeout(() => rec.state !== 'inactive' && rec.stop(), 300); } else finish(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  const finish = async () => {
    done();
    let blob, name;
    if (mode === 'video') {
      blob = new Blob(chunks, { type: mime.split(';')[0] });
      name = `mobavs-play-of-the-game.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
      const v = h('video', { src: URL.createObjectURL(blob), controls: true, autoplay: true, loop: true, muted: true, playsinline: true });
      mount(wrap.firstChild, h('b', { class: 'gold' }, 'Clip ready!'), v, h('small', { class: 'clipstat' }, `${(blob.size / 1e6).toFixed(1)} MB · ${name.split('.').pop().toUpperCase()}`), actions(blob, name));
    } else {
      blob = await filmstrip(frames, potg, names); name = 'mobavs-play-of-the-game.png';
      const img = h('img', { src: frames[0] || '' }); let i = 0;
      const anim = setInterval(() => { if (!img.isConnected) { clearInterval(anim); return; } i = (i + 1) % Math.max(1, frames.length); img.src = frames[i]; }, 160);
      mount(wrap.firstChild, h('b', { class: 'gold' }, 'Filmstrip ready'), img, h('small', { class: 'clipstat' }, '12 frames on one image (your browser cannot record video).'), actions(blob, name));
    }
  };
  const actions = (blob, name) => h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } },
    h('button', { class: 'btn big', onclick: async () => { const r2 = await deliver(blob, name); if (r2 === 'downloaded') toast('Clip saved to your downloads'); } }, navigator.canShare ? 'Share' : 'Download'),
    h('button', { class: 'btn big', onclick: () => wrap.remove() }, 'Close'));
  setTimeout(pre ? () => { r.attach(game, -1, r.map); r.fogOn = false; start(); } : ff, 30);
}
function snapshotFrame(canvas) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  c.getContext('2d').drawImage(canvas, 0, 0, 320, 180); return c.toDataURL('image/jpeg', 0.8);
}
async function filmstrip(frames, potg, names) {
  const cols = 4, rows = Math.ceil(Math.max(1, frames.length) / cols), fw = 320, fh = 180, pad = 4, head = 28;
  const c = document.createElement('canvas'); c.width = cols * (fw + pad) + pad; c.height = rows * (fh + pad) + pad + head;
  const x = c.getContext('2d'); x.fillStyle = '#14121c'; x.fillRect(0, 0, c.width, c.height);
  x.font = '14px PixelFont, monospace'; x.textBaseline = 'middle'; x.fillStyle = '#ffd84a'; x.fillText(`MOBA-VS · ${tr('PLAY OF THE GAME')} · ${tr(potg.title)} · ${names[0]} vs ${names[1]}`, 8, head / 2);
  const imgs = await Promise.all(frames.map((s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = s; })));
  imgs.forEach((im, k) => { if (im) x.drawImage(im, pad + (k % cols) * (fw + pad), head + pad + Math.floor(k / cols) * (fh + pad)); });
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
