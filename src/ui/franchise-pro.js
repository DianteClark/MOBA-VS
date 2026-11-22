// Pro League screen (Franchise hub, Pro League tab): this week's matchdays, predictions, the division tables,
// the prediction board and the hall of fame. The league itself is src/franchise/pro.js (pure, from the ISO week);
// predictions are kept in profile.d.pro and locked in with one Worker write per matchday (worker/pro.js).
// Featured matches can be watched in the Theater as a full AI-vs-AI broadcast (src/franchise/broadcast.js).
import { h, mount, face, toast, emptyState } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { audio } from '../audio.js';
import { profile } from '../profile.js';
import { PRO_TEAMS, PRO_DIVS } from '../franchise/data.js';
import * as P from '../franchise/pro.js';
import { broadcastCfg } from '../franchise/broadcast.js';
import { proBoard, proSend, ensureAccount, getAccount } from '../net/online.js';

let view = 'days', selDay = null, gen = 0;
const T = (t) => PRO_TEAMS[t];
const pcrest = (t, size = 18) => h('span', { class: 'frcrest pro', style: { width: size + 'px', height: Math.round(size * 1.15) + 'px', background: `linear-gradient(135deg, ${T(t).c1} 55%, ${T(t).c2} 55%)` }, title: T(t).name }, h('b', {}, T(t).abbr[0]));
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400); return d ? `${d}d ${Math.floor(s / 3600) % 24}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`; };

// Your predictions: { w, picks: { [day]: [0|1|-1 …] }, sent: [days locked in], hist: [{ w, pts, right, made }] } (bounded).
function store(w) {
  let d = profile.d.pro;
  if (!d || typeof d !== 'object') d = profile.d.pro = { w, picks: {}, sent: [], hist: [] };
  if (d.w !== w) { // a new week: file last week's score
    if (d.w && Object.keys(d.picks || {}).length) { const s = P.scorePicks(d.w, d.picks, Date.now()); d.hist = [{ w: d.w, ...s }, ...(d.hist || [])].slice(0, 12); }
    d.w = w; d.picks = {}; d.sent = [];
  }
  return d;
}

export function showPro(app, body) {
  const now = Date.now(), w = P.weekIndex(now), L = P.proWeek(w), done = P.daysDone(w, now), st = store(w), open = P.openDay(L, now);
  if (selDay === null || selDay > 6) selDay = open ? open.day : Math.max(0, done - 1);
  const mine = P.scorePicks(w, st.picks, now), next = done < 7 ? L.days[done].at - now : P.weekStart(w + 1) - now;
  const id = ++gen, rerun = () => { if (id === gen && body.isConnected) showPro(app, body); };
  const head = h('div', { class: 'panel prohead' },
    h('div', { class: 'col' }, h('b', {}, `Pro League · ${L.label}`), h('small', { class: 'muted' }, done < 7 ? `${P.DAY_LABEL[done]} resolves in ${clock(next)} (18:00 UTC)` : `Champions: ${T(L.champion).name} · next week in ${clock(next)}`)),
    h('div', { class: 'propts' }, h('b', { class: 'gold' }, mine.pts), h('small', {}, `pts · ${mine.right}/${mine.made}`)),
    h('div', { class: 'frseg' }, ...[['days', 'Matches'], ['table', 'Table'], ['board', 'Board'], ['hof', 'Champions']].map(([k, l]) => h('button', { class: 'chip' + (view === k ? ' on' : ''), onclick: () => { if (view !== k) { view = k; audio.sfx('move', 0.5); rerun(); } } }, l))));
  const main = view === 'days' ? daysView(app, L, st, now, done, rerun) : view === 'table' ? tableView(L, done) : view === 'board' ? boardView(app, w, mine) : hofView(w, now);
  mount(body, head, main);
  // the countdown ticks over into the next matchday while the screen is open
  if (done < 7 && next < 6 * 3600000) setTimeout(rerun, Math.min(next + 1500, 60000));
}

function daysView(app, L, st, now, done, rerun) {
  const open = P.openDay(L, now);
  const chips = h('div', { class: 'prodays' }, ...L.days.map((dd) => {
    const res = now >= dd.at, isOpen = open && open.day === dd.day, sent = st.sent.includes(dd.day);
    return h('button', { class: 'chip' + (selDay === dd.day ? ' on' : '') + (res ? ' done' : isOpen ? ' open' : ''), onclick: () => { selDay = dd.day; audio.sfx('move', 0.4); rerun(); } },
      P.DAY_NAMES[dd.day], res ? h('small', {}, '✓') : isOpen ? h('small', { class: sent ? 'pos' : 'gold' }, '•') : null);
  }));
  const dd = L.days[selDay], res = now >= dd.at, isOpen = open && open.day === dd.day, sent = st.sent.includes(dd.day);
  const known = dd.day < 5 || now >= L.days[dd.day - 1].at; // playoff pairings wait for the day before
  const picks = st.picks[dd.day] || (st.picks[dd.day] = dd.matches.map(() => -1));
  let list;
  if (!known) list = [h('p', { class: 'muted center' }, dd.day === 5 ? 'The semifinals (East #1 v West #2, West #1 v East #2) are set when Friday resolves.' : 'The Final is set when the semifinals resolve.')];
  else list = dd.matches.map((m, i) => {
    const pick = picks[i], right = res && pick === m.w, pts = right ? P.pickPoints(pick === 0 ? m.p : 1 - m.p) : 0;
    const side = (s) => {
      const t = s === 0 ? m.a : m.b, p = s === 0 ? m.p : 1 - m.p, won = res && m.w === s;
      const can = isOpen && !sent;
      return h('button', { class: 'proside' + (pick === s ? ' pick' : '') + (won ? ' won' : '') + (res && pick === s && !won ? ' miss' : ''), disabled: !can, 'aria-pressed': String(pick === s),
        title: can ? `Pick ${T(t).name} (${P.pickPoints(p)} pts if right)` : T(t).name,
        onclick: () => { picks[i] = picks[i] === s ? -1 : s; profile.save({ local: true }); audio.sfx('move', 0.4); rerun(); } },
        pcrest(t), h('span', { class: 'pn' }, h('b', {}, T(t).abbr), h('small', {}, `${Math.round(p * 100)}%`)), res ? h('b', { class: 'pk' }, m.k[s]) : null);
    };
    return h('div', { class: 'promatch' + (m.featured ? ' feat' : '') },
      side(0), h('span', { class: 'provs' }, res ? (pick < 0 ? '' : right ? h('b', { class: 'pos' }, `+${pts}`) : h('b', { class: 'neg' }, '✗')) : 'vs'), side(1),
      m.featured ? (res ? h('button', { class: 'chip prowatch', title: 'Watch this match in the Theater', onclick: () => watchFeatured(app, L.w, dd.day, i) }, '▶ Watch') : h('small', { class: 'profeat' }, 'Featured')) : null);
  });
  const made = picks.filter((x) => x >= 0).length;
  const foot = isOpen && known ? h('div', { class: 'profoot' },
    sent ? h('small', { class: 'pos' }, `Locked in: ${made} pick${made === 1 ? '' : 's'}. Results at 18:00 UTC.`)
      : h('small', { class: 'muted' }, 'Correct picks score 5-15 points: more for an underdog. Lock in before 18:00 UTC.'),
    sent ? null : h('button', { class: 'btn', disabled: !made, onclick: (e) => lockIn(app, L.w, dd.day, picks, st, e.currentTarget, rerun) }, `Lock in ${made}/${dd.matches.length}`))
    : res ? h('div', { class: 'profoot' }, h('small', { class: 'muted' }, `${P.DAY_LABEL[dd.day]} · resolved`)) : null;
  const feat = known ? dd.matches.find((m) => m.featured) : null;
  const featCard = feat ? h('div', { class: 'profeatcard' }, h('small', { class: 'kick' }, dd.day === 6 ? 'THE FINAL' : 'FEATURED'),
    ...[feat.a, feat.b].map((t, s) => h('div', { class: 'proline' }, pcrest(t, 16), h('b', {}, T(t).abbr), ...L.lineups[t].map((id) => h('img', { src: face(id), alt: HERO_BY_ID[id].name, title: HERO_BY_ID[id].name }))))) : null;
  return h('div', { class: 'proday' }, chips, h('div', { class: 'panel prolist' }, h('div', { class: 'frh' }, h('b', {}, P.DAY_LABEL[dd.day]), h('small', { class: 'muted' }, new Date(dd.at).toUTCString().slice(0, 11))), featCard, ...list, foot));
}

async function lockIn(app, w, day, picks, st, btn, rerun) {
  btn.disabled = true;
  try {
    await ensureAccount(app.name);
    await proSend(w, day, picks.slice());
    st.sent.push(day); profile.save(); audio.sfx('lockin', 0.7); toast('Picks locked in');
  } catch (e) {
    const msg = String(e.message || e);
    if (/already/.test(msg)) { st.sent.push(day); profile.save(); }
    else { // offline: picks still count on this device; they just are not on the board
      st.sent.push(day); profile.save(); toast('Offline: your picks are saved on this device (not on the board)', 3000);
    }
  }
  rerun();
}

function tableView(L, done) {
  const tab = P.tableAfter(L, done);
  return h('div', { class: 'protables' }, ...PRO_DIVS.map((div) => h('div', { class: 'panel' }, h('div', { class: 'frh' }, h('b', {}, `${div} division`), h('small', { class: 'muted' }, 'Top 2 reach the semifinals')),
    h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Team'), h('th', {}, 'W-L'), h('th', {}, 'K±')),
      ...tab[div].map((r, i) => h('tr', { class: i === 1 ? 'cut' : '' }, h('td', {}, i + 1), h('td', {}, h('span', { class: 'frteam' }, pcrest(r.t, 14), h('span', {}, T(r.t).name))), h('td', {}, `${r.w}-${r.l}`), h('td', {}, (r.kd > 0 ? '+' : '') + r.kd)))))));
}

function boardView(app, w, mine) {
  const el = h('div', { class: 'panel proboard' }, h('p', { class: 'muted center' }, 'Loading the board…'));
  (async () => {
    try {
      const r = await proBoard(w);
      if (!el.isConnected) return;
      const me = getAccount();
      mount(el, h('div', { class: 'frh' }, h('b', {}, `Prediction board · ${P.weekLabel(w)}`), h('small', { class: 'muted' }, r.me ? `You: #${r.me.rank} · ${r.me.pts} pts` : 'Lock in picks to join the board')),
        r.top.length ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Coach'), h('th', {}, 'Pts'), h('th', {}, 'Right')),
          ...r.top.map((x, i) => h('tr', { class: me && x.id === me.id ? 'me' : '' }, h('td', {}, i + 1), h('td', {}, x.name), h('td', {}, x.pts), h('td', {}, `${x.right}/${x.made}`)))) : h('p', { class: 'muted' }, 'Nobody has scored yet this week.'),
        h('small', { class: 'muted' }, 'Points update after each matchday resolves (18:00 UTC). One board per week.'));
    } catch {
      if (el.isConnected) mount(el, emptyState('assets/img/icons/Vision.png', 'Board offline', `The prediction board can't be reached. Your points this week: ${mine.pts}.`));
    }
  })();
  const hist = (profile.d.pro && profile.d.pro.hist) || [];
  return h('div', { class: 'col' }, el, hist.length ? h('div', { class: 'panel' }, h('div', { class: 'frh' }, h('b', {}, 'Your past weeks')), ...hist.map((x) => h('div', { class: 'frrow' }, h('span', { class: 'muted' }, P.weekLabel(x.w)), h('b', {}, `${x.pts} pts · ${x.right}/${x.made}`)))) : null);
}

function hofView(w, now) {
  const H = P.hallOfFame(w, now, 12);
  return h('div', { class: 'prohof' },
    h('div', { class: 'panel' }, h('div', { class: 'frh' }, h('b', {}, 'Recent champions')),
      ...H.recent.map((x) => h('div', { class: 'frrow' }, h('span', { class: 'muted' }, x.label), h('span', { class: 'frteam' }, h('img', { class: 'procup', src: 'assets/img/items/GoldCup.png', alt: '' }), pcrest(x.champion, 14), h('b', {}, T(x.champion).name)), h('small', { class: 'muted' }, `beat ${T(x.finalist).abbr}`)))),
    h('div', { class: 'panel' }, h('div', { class: 'frh' }, h('b', {}, 'Titles in the last year')),
      h('div', { class: 'protitles' }, ...H.titles.map((x) => h('span', {}, pcrest(x.t, 16), h('b', {}, T(x.t).abbr), h('small', {}, `×${x.c}`))))));
}

// ── featured broadcast: find (or reuse) the broadcast seed off the main thread, then open the Theater ──
const BC_KEY = 'mobavs_pro_bc';
function bcCache() { try { return JSON.parse(localStorage.getItem(BC_KEY) || '{}'); } catch { return {}; } }
let bcWorker = null;
function watchFeatured(app, w, day, idx) {
  const key = `${app.version}:${w}:${day}:${idx}`, c = bcCache();
  const open = (tries, len) => {
    const cfg = broadcastCfg(w, day, idx, tries), names = cfg.teams.map((t) => t.name);
    app.watchReplay({ v: app.version, cfg, log: [], names, mapId: cfg.map, len }, { back: () => { app.menu(); import('./franchise.js').then((m) => m.showFranchise(app, 'pro')); } });
  };
  if (c[key]) { open(c[key].t, c[key].len); return; }
  if (bcWorker) return;
  const note = h('small', { class: 'muted' }, 'Setting up the broadcast cameras…');
  const card = h('div', { class: 'modal' }, h('div', { class: 'panel mpanel probc' }, h('b', {}, 'Featured match'), note, h('div', { class: 'pbar' }, h('i', { class: 'probcbar' })),
    h('button', { class: 'chip', onclick: () => { stop(); } }, 'Cancel')));
  const stop = () => { if (bcWorker) bcWorker.terminate(); bcWorker = null; card.remove(); };
  document.body.append(card);
  try { bcWorker = new Worker(new URL('../franchise/broadcast-worker.js', import.meta.url), { type: 'module' }); } catch { stop(); toast('Broadcasts need a newer browser'); return; }
  bcWorker.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'try') note.textContent = m.n ? `Reviewing the tapes… (${m.n + 1})` : 'Setting up the broadcast cameras…';
    if (m.t === 'done') {
      stop();
      if (m.tries < 0) { toast('This broadcast is not available'); return; }
      const cc = bcCache(); cc[key] = { t: m.tries, len: m.len };
      const keys = Object.keys(cc); if (keys.length > 30) delete cc[keys[0]];
      try { localStorage.setItem(BC_KEY, JSON.stringify(cc)); } catch { /* ignore */ }
      open(m.tries, m.len);
    }
  };
  bcWorker.onerror = () => { stop(); toast('The broadcast could not be prepared'); };
  bcWorker.postMessage({ w, day, idx });
}
