// Share cards: a 1200x630 image of a match for bragging rights (social-preview size).
import { IMG } from '../render/assets.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { mapThumb } from './screens.js';
import { toast, fmtTime } from './dom.js';
import { createShare, shareUrl } from '../net/online.js';

const MODE = { ai0: 'vs Easy AI', ai1: 'vs Normal AI', ai2: 'vs Hard AI', online: 'Online match', cup: 'Season Cup' };
const BLUE = '#4aa3ff', RED = '#ff5a5a', GOLD = '#ffd84a', INK = '#f3ead8', MUTED = '#a99fb3';

export async function drawShareCard(m, coach) {
  try { await document.fonts.load('32px PixelFont'); } catch { /* fallback font */ }
  const W = 1200, H = 630, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const me = m.side, them = 1 - me, won = m.won;
  // backdrop: the map, dimmed, with a team-coloured glow
  x.fillStyle = '#120e18'; x.fillRect(0, 0, W, H);
  try { const t = mapThumb(m.map); x.globalAlpha = 0.28; x.drawImage(t, 0, -285, W, W); x.globalAlpha = 1; } catch { /* no thumb */ }
  const gl = x.createRadialGradient(260, 220, 20, 260, 220, 700); gl.addColorStop(0, won ? 'rgba(255,216,74,0.30)' : 'rgba(255,90,90,0.25)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gl; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(10,8,14,0.55)'; x.fillRect(0, H - 250, W, 250);
  x.strokeStyle = won ? GOLD : '#7a3a3a'; x.lineWidth = 8; x.strokeRect(4, 4, W - 8, H - 8);
  const T = (s, px, py, size, col, align = 'left', shadow = true) => {
    x.font = `${size}px PixelFont, monospace`; x.textAlign = align; x.textBaseline = 'alphabetic';
    const str = String(s).replace(/ /g, ' ');
    if (shadow) { x.fillStyle = '#000'; x.fillText(str, px + size / 12, py + size / 10); }
    x.fillStyle = col; x.fillText(str, px, py);
  };
  T('MOBA-VS', 40, 70, 34, '#ffe3a3');
  T(`${MODE[m.mode] || 'Match'}${m.cup ? ' · ' + m.cup : ''} · ${(MAP_BY_ID[m.map] || {}).name || ''}`, W - 40, 62, 20, MUTED, 'right');
  T(new Date(m.t).toLocaleDateString(), W - 40, 92, 18, MUTED, 'right');
  T(won ? 'VICTORY' : 'DEFEAT', 40, 190, 104, won ? GOLD : RED);
  const how = m.crystal ? `${won ? 'Crystal destroyed' : 'Crystal lost'} at ${fmtTime(m.len)}` : `Decided on towers at 15:00 (${m.towers[me]}-${m.towers[them]})`;
  T(how, 44, 236, 24, INK);
  // score block
  T(`${m.kills[me]}`, 760, 170, 72, me === 0 ? BLUE : RED, 'right');
  T('-', 800, 165, 56, MUTED, 'center');
  T(`${m.kills[them]}`, 840, 170, 72, them === 0 ? BLUE : RED, 'left');
  T('KILLS', 800, 205, 18, MUTED, 'center');
  T(`${m.towers[me]} towers standing`, 800, 236, 18, MUTED, 'center');
  // coach line
  T(coach.name, 40, 300, 30, INK);
  T(`${m.rank || coach.rank}${m.rpDelta ? `  ${m.rpDelta > 0 ? '+' : ''}${m.rpDelta} RP` : ''}${m.calls ? `  ·  ${m.calls} calls paid off` : ''}`, 40, 334, 20, GOLD);
  if (m.potg) T(`POTG: ${m.potg}`, 40, 368, 20, '#ffe3a3');
  // your five heroes
  const picks = m.picks[me], kda = (m.kda && m.kda[me]) || [];
  const sz = 120, gap = 26, x0 = (W - (sz * 5 + gap * 4)) / 2, y0 = H - 230;
  picks.forEach((id, i) => {
    const px = x0 + i * (sz + gap), mvp = m.mvp && m.mvp.id === id && m.mvp.team === me;
    x.fillStyle = '#1e1928'; x.fillRect(px - 6, y0 - 6, sz + 12, sz + 12);
    x.strokeStyle = mvp ? GOLD : me === 0 ? BLUE : RED; x.lineWidth = mvp ? 6 : 3; x.strokeRect(px - 6, y0 - 6, sz + 12, sz + 12);
    const img = IMG['face_' + id]; if (img) x.drawImage(img, px, y0, sz, sz);
    if (mvp) { x.fillStyle = GOLD; x.fillRect(px + sz / 2 - 34, y0 - 22, 68, 26); T('MVP', px + sz / 2, y0 - 2, 20, '#2a1608', 'center', false); }
    T((HERO_BY_ID[id] || { name: id }).name, px + sz / 2, y0 + sz + 34, 20, INK, 'center');
    const k = kda[i]; if (k) T(`${k[0]}/${k[1]}/${k[2]}`, px + sz / 2, y0 + sz + 62, 22, GOLD, 'center');
  });
  T('MOBA-VS · coach your team · play free in your browser', W / 2, H - 18, 16, MUTED, 'center');
  return c;
}

// Share: upload a short link (card + replay when available) and hand it to the system share
// sheet together with the image; offline, fall back to just the image.
export async function shareMatch(m, coach, replay) {
  const c = await drawShareCard(m, coach);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) { toast('Could not make the share card.'); return; }
  let link = location.origin + location.pathname;
  try {
    const okReplay = replay && replay.cfg && replay.t && Math.abs(replay.t - m.t) < 120000 ? replay : null;
    const r = await createShare('card', { match: m, coach, replay: okReplay });
    link = shareUrl(r.code);
  } catch { /* offline: image only */ }
  const name = `moba-vs-${m.won ? 'victory' : 'match'}-${new Date(m.t).toISOString().slice(0, 10)}.png`;
  const text = `${m.won ? 'VICTORY' : 'GG'} in MOBA-VS: ${m.kills[m.side]}-${m.kills[1 - m.side]}${m.crystal ? `, Crystal down at ${fmtTime(m.len)}` : ''}! ${link}`;
  try {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: 'MOBA-VS' }); return; }
    if (navigator.share) { await navigator.share({ text, url: link, title: 'MOBA-VS' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  try { await navigator.clipboard.writeText(link); toast('Card saved · link copied'); } catch { toast('Share card saved'); }
}
