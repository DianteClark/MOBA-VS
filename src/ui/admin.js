// Owner dashboard (/admin.html): live-ops numbers from worker/ops.js behind the MOBAVS_ADMIN token.
// The token is pasted once and kept in this browser's localStorage ('mobavs_admin'); every call sends it as
// a Bearer header and the Worker answers 404 to anything without it. Reads one summary (a single D1 batch
// of aggregate queries over daily rollups), then draws light SVG charts and tables. Never cached by sw.js.
import { h, mount } from './dom.js';
import { API } from '../net/online.js';
import { HEROES } from '../data/heroes.js';
import { PLAN_INFO } from '../data/plans.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { EVENT_BY_ID } from '../data/events.js';
import { seasonAt } from '../data/seasons.js';

const LS = 'mobavs_admin';
const HERO = Object.fromEntries(HEROES.map((x) => [x.id, x.name]));
const MODE = { ai: 'vs AI', rush_ai: 'Lane Rush vs AI', cup_ai: 'Season Cup vs AI', coop: 'Co-op', ranked: 'Ranked', casual: 'Casual', rush: 'Lane Rush online', private: 'Private room', cup: 'Weekend Cup', watch: 'Watch' };
const QUEUES = ['ranked', 'casual', 'rush', 'coop'];
const PUSH_T = [['invite', 'Invites'], ['rematch', 'Rematch'], ['cup', 'Cup check-ins'], ['event', 'Weekly event'], ['division', 'Division results']];
// chart colors: categorical slots 1 and 2 of the dashboard palette (dark surface), validated with the dataviz checks
const C1 = '#3987e5', C2 = '#d95926';

let token = null; try { token = localStorage.getItem(LS); } catch { /* private mode */ }
const app = document.getElementById('app');
const state = { days: 30, tab: 'overview', data: null, heroSort: 'games', fbShow: 'new', err: null };

async function call(path, opts = {}) {
  const r = await fetch(API + path, { method: opts.method || 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && path.startsWith('/api/admin/ops/summary')) throw Object.assign(new Error('Token not accepted'), { auth: true });
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

// ── formatting ──
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
const pct1 = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '–');
const num = (n) => (n === undefined || n === null ? '–' : n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.round(n)));
const dayLabel = (d) => new Date(d * 86400000).toISOString().slice(5, 10);
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const sumsBy = (sums, prefix) => Object.entries(sums).filter(([k]) => k.startsWith(prefix)).map(([k, n]) => [k.slice(prefix.length), n]);

// ── tiny SVG charts ──
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v); for (const c of kids.flat()) if (c) el.append(c); return el; }
const tip = h('div', { class: 'tip', role: 'tooltip' });
document.body.append(tip);
function showTip(e, html) { tip.innerHTML = html; tip.classList.add('on'); const r = tip.getBoundingClientRect(); tip.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, e.clientX - r.width / 2)) + 'px'; tip.style.top = Math.max(4, e.clientY - r.height - 14) + 'px'; }
const hideTip = () => tip.classList.remove('on');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// days: [d...]; series: [{ name, color, v: {day: n}, bars? }]. One y-axis, a crosshair + tooltip on hover.
function timeChart(days, series, { bars = false, fmt = num, height = 120 } = {}) {
  const W = 600, H = height, L = 34, R = 8, T = 10, B = 20, n = days.length;
  const max = Math.max(1, ...series.flatMap((x) => days.map((d) => x.v[d] || 0)));
  const nice = (() => { const m = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / m) * m; })();
  const X = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1)), Y = (v) => T + (H - T - B) * (1 - v / nice);
  const bw = Math.max(2, (W - L - R) / n - 2);
  const BX = (i) => L + (i * (W - L - R)) / n + 1;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': series.map((x) => x.name).join(', ') + ' by day' });
  for (const f of [0, 0.5, 1]) { const y = Y(nice * f); svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }), s('text', { x: L - 4, y: y + 3, class: 'ax', 'text-anchor': 'end' }, document.createTextNode(fmt(nice * f)))); }
  const step = Math.max(1, Math.ceil(n / 6));
  days.forEach((d, i) => { if (i % step === 0 || i === n - 1) svg.append(s('text', { x: bars ? BX(i) + bw / 2 : X(i), y: H - 5, class: 'ax', 'text-anchor': 'middle' }, document.createTextNode(dayLabel(d)))); });
  if (bars) {
    const x = series[0];
    days.forEach((d, i) => { const v = x.v[d] || 0; if (!v) return; const y = Y(v), hh = Y(0) - y; svg.append(s('path', { d: `M${BX(i)},${Y(0)} V${y + Math.min(3, hh)} q0,-${Math.min(3, hh)} ${Math.min(3, bw / 2)},-${Math.min(3, hh)} H${BX(i) + bw - Math.min(3, bw / 2)} q${Math.min(3, bw / 2)},0 ${Math.min(3, bw / 2)},${Math.min(3, hh)} V${Y(0)} Z`, fill: x.color })); });
  } else {
    for (const x of series) {
      const pts = days.map((d, i) => [X(i), Y(x.v[d] || 0)]);
      svg.append(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: x.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const last = pts[pts.length - 1];
      if (last && series.length > 1) svg.append(s('text', { x: Math.min(last[0], W - R - 2), y: last[1] - 6, class: 'dl', 'text-anchor': 'end' }, document.createTextNode(x.name)));
    }
  }
  const cross = s('line', { y1: T, y2: H - B, class: 'cross' }), dots = series.map((x) => s('circle', { r: 4, fill: x.color, class: 'dot' }));
  if (!bars) svg.append(cross, ...dots);
  const hit = s('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
  const at = (e) => { const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; return Math.max(0, Math.min(n - 1, bars ? Math.floor(((px - L) * n) / (W - L - R)) : Math.round(((px - L) * (n - 1)) / (W - L - R)))); };
  hit.addEventListener('pointermove', (e) => {
    const i = at(e), d = days[i];
    if (!bars) { cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.classList.add('on'); series.forEach((x, k) => { dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(x.v[d] || 0)); dots[k].classList.add('on'); }); }
    showTip(e, `<b>${dayLabel(d)}</b>` + series.map((x) => `<div><i style="background:${x.color}"></i>${esc(x.name)} <span>${fmt(x.v[d] || 0)}</span></div>`).join(''));
  });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.classList.remove('on'); dots.forEach((d) => d.classList.remove('on')); });
  svg.append(hit);
  const legend = series.length > 1 ? h('div', { class: 'legend' }, series.map((x) => h('span', {}, h('i', { style: { background: x.color } }), x.name))) : null;
  return h('div', { class: 'chartw' }, legend, svg);
}
// A horizontal meter for a share (0-1), with a 50% tick for win rates.
const meter = (f, mid) => h('span', { class: 'meter' + (mid ? ' mid' : '') }, h('i', { style: { width: Math.max(0, Math.min(100, f * 100)) + '%' } }));

// ── layout helpers ──
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...kids);
const tile = (label, value, sub) => h('div', { class: 'tile' }, h('small', {}, label), h('b', {}, value), sub ? h('em', {}, sub) : null);
function table(cols, rows, { sort, onSort, empty = 'Nothing yet.' } = {}) {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'tablew' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: (c.num ? 'n' : '') + (sort === c.key ? ' sorted' : ''), onclick: onSort && c.key ? () => onSort(c.key) : null }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: c.num ? 'n' : '' }, c.get(r))))))));
}
async function act(btn, fn) { btn.disabled = true; try { await fn(); } catch (e) { alert(e.message || e); } btn.disabled = false; }

// ── sections ──
function overview(D) {
  const days = []; for (let d = D.from; d <= D.today; d++) days.push(d);
  const ser = (k) => Object.fromEntries(D.series.filter((r) => r.k === k).map((r) => [r.day, r.n]));
  const dau = ser('dau'), wau = ser('wau'); dau[D.today] = D.live.dau; wau[D.today] = D.live.wau;
  const done = ser('ev:match_done'), S = D.sums;
  const byMode = sumsBy(S, 'ev:match_done:').sort((a, b) => b[1] - a[1]);
  const total = byMode.reduce((a, x) => a + x[1], 0);
  const maps = sumsBy(S, 'map:').sort((a, b) => b[1] - a[1]), events = sumsBy(S, 'event:').sort((a, b) => b[1] - a[1]);
  const coh = ser('coh'), r1 = ser('r1'), r7 = ser('r7');
  const sumOver = (o, f) => days.filter(f).reduce((a, d) => a + (o[d] || 0), 0);
  const c1 = sumOver(coh, (d) => d + 1 < D.today), c7 = sumOver(coh, (d) => d + 7 < D.today);
  const devs = sumsBy(S, 'dev:').sort((a, b) => b[1] - a[1]), vers = sumsBy(S, 'ver:').sort((a, b) => b[0] - a[0]);
  return [
    h('div', { class: 'tiles' },
      tile('Players today', num(D.live.dau), `${num(D.live.wau)} this week`),
      tile('New today', num(D.live.new), `${num(D.players.n)} accounts`),
      tile('Matches', num(total), `last ${D.days} days`),
      tile('D1 retention', pct(sumOver(r1, (d) => d + 1 < D.today), c1), `${num(c1)} new players`),
      tile('D7 retention', pct(sumOver(r7, (d) => d + 7 < D.today), c7), `${num(c7)} new players`)),
    card('Active players', timeChart(days, [{ name: 'Daily', color: C1, v: dau }, { name: 'Weekly', color: C2, v: wau }])),
    card('Matches finished per day', timeChart(days, [{ name: 'Matches', color: C1, v: done }], { bars: true })),
    h('div', { class: 'cols' },
      card('Matches by mode', table([{ label: 'Mode', get: (r) => MODE[r[0]] || r[0] }, { label: 'Matches', num: 1, get: (r) => num(r[1]) }, { label: 'Share', num: 1, get: (r) => h('span', {}, meter(r[1] / total), pct(r[1], total)) },
        { label: 'Avg length', num: 1, get: (r) => (S['len:' + r[0]] ? Math.round(S['len:' + r[0]] / r[1] / 60) + ' min' : '–') }], byMode)),
      card('Matches by map', table([{ label: 'Map', get: (r) => (MAP_BY_ID[r[0]] ? MAP_BY_ID[r[0]].name : r[0]) }, { label: 'Matches', num: 1, get: (r) => num(r[1]) }, { label: 'Share', num: 1, get: (r) => pct(r[1], total) }], maps)),
      card('Matches by weekly event', table([{ label: 'Event', get: (r) => (EVENT_BY_ID[r[0]] ? EVENT_BY_ID[r[0]].name : r[0] === 'classic' ? 'Classic' : r[0]) }, { label: 'Matches', num: 1, get: (r) => num(r[1]) }], events))),
    card('Queues (online matchmaking)', table([{ label: 'Queue', get: (q) => MODE[q] || q }, { label: 'Searches', num: 1, get: (q) => num(S['qs:' + q] || 0) }, { label: 'Matched', num: 1, get: (q) => num(S['qm:' + q] || 0) },
      { label: 'Fill rate', num: 1, get: (q) => pct(Math.min(S['qs:' + q] || 0, 2 * (S['qm:' + q] || 0)), S['qs:' + q] || 0) }, { label: 'Avg wait', num: 1, get: (q) => (S['qm:' + q] ? Math.round(S['qw:' + q] / S['qm:' + q]) + ' s' : '–') },
      { label: 'Gave up', num: 1, get: (q) => num(S['qc:' + q] || 0) }], QUEUES.filter((q) => S['qs:' + q]), { empty: 'No online searches in this window.' }),
      h('p', { class: 'muted small' }, 'Fill rate: searches that found an opponent (each match is two searches). Wait: how long the first coach waited.')),
    card('Retention by signup day', table([{ label: 'Day', get: (d) => dayLabel(d) }, { label: 'New', num: 1, get: (d) => num(coh[d] || 0) }, { label: 'D1', num: 1, get: (d) => (d + 1 < D.today ? pct(r1[d] || 0, coh[d]) : '…') }, { label: 'D7', num: 1, get: (d) => (d + 7 < D.today ? pct(r7[d] || 0, coh[d]) : '…') }],
      days.slice().reverse().filter((d) => coh[d]).slice(0, 21), { empty: 'Retention appears after the first nightly rollup (or tap Roll up now).' })),
    h('div', { class: 'cols' },
      card('Devices (launches)', table([{ label: 'Device', get: (r) => r[0] }, { label: 'Launches', num: 1, get: (r) => num(r[1]) }], devs.slice(0, 10))),
      card('Versions (launches)', table([{ label: 'Version', get: (r) => 'v' + r[0] }, { label: 'Launches', num: 1, get: (r) => num(r[1]) }], vers.slice(0, 8))),
      card('Cups', D.cups.byStatus.length ? h('div', { class: 'tiles small' }, D.cups.byStatus.map((r) => tile(r.status, num(r.n))), tile('Coach entries', num(D.cups.n || 0), `${num(D.cups.coaches || 0)} coaches`)) : h('p', { class: 'muted' }, 'No cups in this window.'))),
  ];
}

function heroes(D) {
  const S = D.sums, vm = S.vm || 0, season = Object.fromEntries(D.heroes.map((r) => [r.hero, r]));
  const rows = HEROES.map((x) => ({ id: x.id, name: x.name, role: x.role, g: S['hg:' + x.id] || 0, w: S['hw:' + x.id] || 0, b: S['hb:' + x.id] || 0, sg: (season[x.id] || {}).games || 0, sw: (season[x.id] || {}).wins || 0 }));
  const key = state.heroSort, by = { games: (r) => r.g, win: (r) => (r.g >= 5 ? r.w / r.g : -1), ban: (r) => r.b, name: (r) => r.name, season: (r) => r.sg };
  rows.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name) : by[key](b) - by[key](a)));
  const plans = Object.keys(PLAN_INFO).concat(['balanced']).map((id) => ({ id, g: S['pg:' + id] || 0, w: S['pw:' + id] || 0 })).filter((p) => p.g);
  const sortBy = (k) => { state.heroSort = k; render(); };
  return [
    card(`Heroes in verified online matches (${num(vm)} matches, last ${D.days} days)`,
      table([{ key: 'name', label: 'Hero', get: (r) => h('span', { class: 'hero' }, h('img', { src: `assets/img/faces/${r.id}.png`, alt: '', loading: 'lazy' }), r.name) },
        { key: 'games', label: 'Picks', num: 1, get: (r) => `${num(r.g)} · ${pct(r.g, vm)}` },
        { key: 'ban', label: 'Bans', num: 1, get: (r) => `${num(r.b)} · ${pct(r.b, vm)}` },
        { key: 'win', label: 'Win rate', num: 1, get: (r) => (r.g ? h('span', {}, meter(r.w / r.g, true), pct1(r.w, r.g)) : '–') },
        { key: 'season', label: 'Season', num: 1, get: (r) => (r.sg ? `${pct(r.sw, r.sg)} of ${num(r.sg)}` : '–') }], rows, { sort: key, onSort: sortBy }),
      h('p', { class: 'muted small' }, 'Pick and ban rates: share of matches. Tap a column to sort. Win rates under 30 games are noise; tools/autobalance.mjs only nudges heroes with enough games.')),
    card('Game plans', table([{ label: 'Plan', get: (p) => (PLAN_INFO[p.id] ? PLAN_INFO[p.id].name : 'Balanced') }, { label: 'Teams', num: 1, get: (p) => num(p.g) }, { label: 'Win rate', num: 1, get: (p) => h('span', {}, meter(p.w / p.g, true), pct1(p.w, p.g)) }], plans, { empty: 'No plan data yet.' })),
  ];
}

function health(D) {
  const ver = Object.fromEntries(D.verify.map((r) => [r.verify, r.n]));
  return [
    card('Anti-cheat', h('div', { class: 'tiles small' }, tile('Verified', num(ver.ok || 0)), tile('Flagged', num(ver.flagged || 0)), tile('Waiting', num(ver.pending || 0)), tile('Under review', num(D.players.review || 0), 'coaches')),
      table([{ label: 'When', get: (m) => ago(m.created) }, { label: 'Match', get: (m) => h('span', {}, h('b', {}, `${m.bname || m.blue} vs ${m.rname || m.red}`), h('small', { class: 'muted block' }, `${m.mode || 'ranked'} · ${m.id}`)) },
        { label: 'Why', get: (m) => h('small', {}, m.reasons || '') },
        { label: '', get: (m) => (m.blobs ? h('a', { class: 'chip', href: `./?ar=${encodeURIComponent(m.id)}`, target: '_blank', rel: 'noopener' }, 'Theater') : h('small', { class: 'muted' }, 'no replay')) }], D.flagged, { empty: 'No flagged matches.' }),
      h('p', { class: 'muted small' }, 'Theater opens the game in a new tab with the uploaded command log (needs the same game version). Flagged results were already rolled back.')),
    card('Crashes and desyncs', crashList(D)),
  ];
}
function crashList(D) {
  return table([{ label: 'Seen', num: 1, get: (c) => h('span', {}, h('b', {}, num(c.n)), h('small', { class: 'muted block' }, `${c.players} reports`)) },
    { label: 'Problem', get: (c) => h('button', { class: 'linkish', onclick: (e) => crashDetail(c, e.currentTarget) }, h('span', { class: 'kind k-' + c.kind }, c.kind), ' ', c.msg) },
    { label: 'Where', get: (c) => h('small', { class: 'muted' }, (c.tags || '').split(' ').slice(0, 4).join(' ')) },
    { label: 'Last', num: 1, get: (c) => ago(c.last) }], D.crashes, { empty: 'No crashes reported. Lovely.' });
}
async function crashDetail(c, btn) {
  const row = btn.closest('tr'); if (row.nextSibling && row.nextSibling.classList.contains('detail')) { row.nextSibling.remove(); return; }
  try {
    const d = await call('/api/admin/ops/crash?hash=' + c.hash);
    const days = []; for (let k = state.data.today - 29; k <= state.data.today; k++) days.push(k);
    const cell = h('td', { colspan: 4 }, h('pre', {}, d.stack || '(no stack)'), h('p', { class: 'small muted' }, `First ${when(d.first)} · last ${when(d.last)} · ${d.tags.map((t) => `${t.tag} ${t.n}`).join(' · ')}`),
      timeChart(days, [{ name: 'Reports', color: C2, v: Object.fromEntries(d.daily.map((x) => [x.day, x.n])) }], { bars: true, height: 80 }),
      h('button', { class: 'chip', onclick: (e) => act(e.currentTarget, async () => { await call('/api/admin/ops/crash', { method: 'POST', body: { hash: c.hash } }); await load(); }) }, 'Resolve (forget until it happens again)'));
    row.after(h('tr', { class: 'detail' }, cell));
  } catch (e) { alert(e.message); }
}

function feedback(D) {
  const by = Object.fromEntries(D.feedbackBy.map((r) => [r.status, r.n]));
  const list = D.feedback.filter((f) => state.fbShow === 'all' || f.status === state.fbShow);
  const pick = (k, l) => h('button', { class: 'chip' + (state.fbShow === k ? ' on' : ''), onclick: () => { state.fbShow = k; render(); } }, l);
  return [card(`Feedback (${num(by.new || 0)} new)`, h('div', { class: 'row' }, pick('new', 'New'), pick('done', 'Done'), pick('all', 'All')),
    list.length ? h('div', { class: 'fblist' }, list.map((f) => h('article', { class: 'fb' + (f.status === 'done' ? ' done' : '') },
      h('header', {}, h('b', {}, f.name || 'Guest'), h('small', { class: 'muted' }, ` ${ago(f.created)} · v${f.meta.v} · ${f.meta.dev} · ${f.meta.screen}${f.meta.size ? ' · ' + f.meta.size : ''}${f.meta.mode ? ' · ' + f.meta.mode : ''}`)),
      h('p', {}, f.text),
      f.meta.err ? h('p', { class: 'small err' }, 'Last error: ' + f.meta.err) : null,
      h('div', { class: 'row' },
        f.shot ? h('button', { class: 'chip', onclick: (e) => act(e.currentTarget, async () => { const d = await call('/api/admin/ops/feedback?id=' + f.id); e.target.closest('article').append(h('img', { class: 'shot', src: d.shot, alt: 'Screenshot' })); e.target.remove(); }) }, 'Screenshot') : null,
        h('button', { class: 'chip', onclick: (e) => act(e.currentTarget, async () => { await call('/api/admin/ops/feedback', { method: 'POST', body: { id: f.id, status: f.status === 'done' ? 'new' : 'done' } }); await load(); }) }, f.status === 'done' ? 'Reopen' : 'Done'),
        h('button', { class: 'chip', onclick: (e) => { if (confirm('Delete this feedback?')) act(e.currentTarget, async () => { await call('/api/admin/ops/feedback', { method: 'POST', body: { id: f.id, status: 'deleted' } }); await load(); }); } }, 'Delete'))))) : h('p', { class: 'muted' }, 'Nothing here.'))];
}

function flags(D) {
  const ex = (k, v) => (D.exposures.find((x) => x.flag === k && x.variant === v) || {}).n || 0;
  const d1 = (k, v) => D.d1.find((x) => x.flag === k && x.variant === v) || { n: 0, back: 0 };
  const fx = (k, v, ev) => D.sums[`fx:${k}:${v}:${ev}`] || 0;
  return [
    D.flags.length ? D.flags.map((f) => card(`${f.key} · ${f.status === 'on' ? 'running' : f.status === 'ship' ? 'shipped: ' + f.ship : 'off'}`,
      f.note ? h('p', { class: 'muted small' }, f.note) : null,
      table([{ label: 'Variant', get: (v) => `${v.id} (${v.w})` }, { label: 'Players', num: 1, get: (v) => num(ex(f.key, v.id)) },
        { label: 'Came back next day', num: 1, get: (v) => { const x = d1(f.key, v.id); return x.n ? `${pct1(x.back, x.n)} of ${num(x.n)}` : '–'; } },
        { label: 'Matches / player', num: 1, get: (v) => (ex(f.key, v.id) ? (fx(f.key, v.id, 'match_done') / ex(f.key, v.id)).toFixed(2) : '–') },
        { label: 'Push opt-ins', num: 1, get: (v) => pct1(fx(f.key, v.id, 'push_optin'), ex(f.key, v.id)) },
        { label: 'Feedback', num: 1, get: (v) => num(fx(f.key, v.id, 'feedback')) }], f.variants),
      h('div', { class: 'row' }, h('button', { class: 'chip', onclick: () => flagForm(f) }, 'Edit'),
        h('button', { class: 'chip', onclick: (e) => { if (confirm(`Delete flag ${f.key} and its exposure log?`)) act(e.currentTarget, async () => { await call('/api/admin/ops/flag', { method: 'POST', body: { key: f.key, delete: true } }); await load(); }); } }, 'Delete')))) : card('A/B flags', h('p', { class: 'muted' }, 'No flags yet.')),
    card('New flag', h('p', { class: 'muted small' }, 'UI-only experiments: the client reads them with flag(key, default) from src/net/ops.js. A flag never reaches the match sim. Players are bucketed by a hash of flag and account, so the split is stable and needs no storage. Built in: push_prompt (m3 / m6: ask for notifications after match 3 or 6).'),
      h('button', { class: 'btn', onclick: () => flagForm(null) }, 'Create a flag')),
  ];
}
function flagForm(f) {
  const key = h('input', { value: f ? f.key : '', placeholder: 'push_prompt', disabled: !!f, autocapitalize: 'off' });
  const vs = h('input', { value: f ? f.variants.map((v) => `${v.id}:${v.w}`).join(', ') : 'a:50, b:50', placeholder: 'a:50, b:50' });
  const st = h('select', {}, ['off', 'on', 'ship'].map((x) => h('option', { value: x, selected: (f ? f.status : 'off') === x }, x)));
  const ship = h('input', { value: f && f.ship ? f.ship : '', placeholder: 'variant to ship' });
  const note = h('input', { value: f ? f.note || '' : '', placeholder: 'What it tests' });
  const wrap = h('div', { class: 'modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'card form' }, h('h3', {}, f ? 'Edit ' + f.key : 'New flag'),
    h('label', {}, 'Key', key), h('label', {}, 'Variants (id:weight, …)', vs), h('label', {}, 'Status (on = running, ship = everyone gets one variant)', st), h('label', {}, 'Ship variant', ship), h('label', {}, 'Note', note),
    h('div', { class: 'row' }, h('button', { class: 'chip', onclick: () => wrap.remove() }, 'Cancel'),
      h('button', { class: 'btn', onclick: (e) => act(e.currentTarget, async () => {
        const variants = vs.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [id, w] = x.split(':'); return { id: id.trim(), w: Number(w) || 0 }; });
        await call('/api/admin/ops/flag', { method: 'POST', body: { key: key.value.trim(), variants, status: st.value, ship: ship.value.trim(), note: note.value } });
        wrap.remove(); await load();
      }) }, 'Save'))));
  document.body.append(wrap);
}

function push(D) {
  const P = D.push;
  const id = h('input', { placeholder: 'Account id (10 letters / digits)', autocapitalize: 'characters' });
  const out = h('p', { class: 'small muted' });
  return [card('Push notifications', h('div', { class: 'tiles small' }, tile('Devices', num(P.n || 0), `${num(P.coaches || 0)} coaches`), ...PUSH_T.map(([k, l]) => tile(l, num(P[k] || 0))), tile('Queued', num(P.outbox || 0))),
    h('p', { class: 'muted small' }, `Opt-in prompts shown: ${num(D.sums['ev:push_prompt'] || 0)} · opted in: ${num(D.sums['ev:push_optin'] || 0)} (last ${D.days} days).`)),
  card('Send a test', h('div', { class: 'row' }, id, h('button', { class: 'btn', onclick: (e) => act(e.currentTarget, async () => { const d = await call('/api/admin/push/test', { method: 'POST', body: { player: id.value.trim().toUpperCase() } }); out.textContent = `${d.devices} device(s): ` + d.results.map((r) => (r.ok ? 'sent' : r.gone ? 'gone' : 'failed ' + (r.status || r.error))).join(', '); }) }, 'Send')), out)];
}

// ── shell ──
const TABS = [['overview', 'Overview', overview], ['heroes', 'Heroes', heroes], ['health', 'Health', health], ['feedback', 'Feedback', feedback], ['flags', 'A/B flags', flags], ['push', 'Push', push]];
function render() {
  const D = state.data;
  if (!token) return login();
  if (!D) return mount(app, h('p', { class: 'boot' }, state.err || 'Loading…'));
  const nb = (k) => (k === 'feedback' ? (D.feedbackBy.find((r) => r.status === 'new') || {}).n : k === 'health' ? D.flagged.length + D.crashes.filter((c) => c.last > Date.now() - 86400000).length : 0);
  mount(app,
    h('header', { class: 'top' }, h('h1', {}, 'MOBA-VS', h('small', {}, ' owner')),
      h('select', { 'aria-label': 'Window', onchange: (e) => { state.days = +e.target.value; load(); } }, [7, 14, 30, 90].map((d) => h('option', { value: d, selected: state.days === d }, `${d} days`))),
      h('button', { class: 'chip', title: 'Recompute DAU / WAU / retention for the last 14 days', onclick: (e) => act(e.currentTarget, async () => { await call('/api/admin/ops/rollup', { method: 'POST' }); await load(); }) }, 'Roll up now'),
      h('button', { class: 'chip', onclick: () => load() }, 'Refresh'),
      h('button', { class: 'chip', onclick: () => { if (confirm('Forget the token on this device?')) { try { localStorage.removeItem(LS); } catch { /* ignore */ } token = null; state.data = null; render(); } } }, 'Sign out')),
    h('nav', { class: 'tabs' }, TABS.map(([k, l]) => h('button', { class: state.tab === k ? 'on' : '', onclick: () => { state.tab = k; render(); scrollTo(0, 0); } }, l, nb(k) ? h('span', { class: 'badge' }, nb(k)) : null))),
    h('main', {}, TABS.find((t) => t[0] === state.tab)[2](D)),
    h('footer', { class: 'muted small' }, `Updated ${when(D.now)} UTC · days are UTC · season ${D.season}`));
}
function login(msg) {
  const inp = h('input', { type: 'password', placeholder: 'MOBAVS_ADMIN token', autocomplete: 'current-password' });
  const go = () => { token = inp.value.trim(); if (token.length < 16) { alert('The token is at least 16 characters.'); return; } try { localStorage.setItem(LS, token); } catch { /* ignore */ } load(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  mount(app, h('form', { class: 'card login', onsubmit: (e) => { e.preventDefault(); go(); } }, h('h1', {}, 'MOBA-VS owner'), h('p', { class: 'muted' }, 'Paste the MOBAVS_ADMIN token once. It stays in this browser only.'), msg ? h('p', { class: 'err' }, msg) : null, inp, h('button', { class: 'btn', type: 'submit' }, 'Open dashboard')));
  setTimeout(() => inp.focus(), 30);
}
async function load() {
  state.err = null; if (!state.data) render();
  try {
    const season = seasonAt().id;
    state.data = await call(`/api/admin/ops/summary?days=${state.days}&season=${season}`);
    render();
  } catch (e) {
    if (e.auth) { try { localStorage.removeItem(LS); } catch { /* ignore */ } token = null; state.data = null; login('That token was not accepted.'); return; }
    state.err = 'Could not load: ' + e.message; if (!state.data) render(); else alert(state.err);
  }
}
if (token) load(); else login();
