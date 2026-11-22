// Franchise hub: found a team, then run it season after season. Tabs: Team (next match, lineup, bench; the
// offseason steps live here too), Market (free agents, trades), League (standings, fixtures, playoffs),
// Club (finances, trophy room, history, news, settings) and Pro (the weekly Pro League, src/ui/franchise-pro.js).
// All rules live in src/franchise/*; this file only shows the state and calls them.
import { clubMascotImg } from './beastsui.js';
import { h, mount, face, toast } from './dom.js';
import { HERO_BY_ID, ROLES, ROLE_LABEL } from '../data/heroes.js';
import { audio } from '../audio.js';
import { buzz } from './haptics.js';
import * as D from '../franchise/data.js';
import * as L from '../franchise/league.js';
import * as M from '../franchise/market.js';
import { heroModParts, offRole, valueOf, salaryFor } from '../franchise/model.js';
import { getFr, saveFr, foundFranchise, retireFranchise, playFixture, simFixture } from '../franchise/play.js';
import { showPro } from './franchise-pro.js';

const screen = () => document.getElementById('screen');
const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const hn = (id) => HERO_BY_ID[id].name;
const sfx = (k = 'move', v = 0.5) => audio.sfx(k, v);
const TABS = [['team', 'Team'], ['market', 'Market'], ['league', 'League'], ['club', 'Club'], ['pro', 'Pro League']];
let tab = 'team', mkt = 'fa', tradeWith = 1, give = [], get = [], APP = null;

// ── crest: a pixel shield in the team's colours with an emblem from the pack ──
const PAT = {
  plain: (a) => a,
  split: (a, b) => `linear-gradient(90deg, ${a} 50%, ${b} 50%)`,
  band: (a, b) => `linear-gradient(180deg, ${a} 34%, ${b} 34% 66%, ${a} 66%)`,
  chevron: (a, b) => `linear-gradient(135deg, ${a} 50%, ${b} 50%)`,
  quarters: (a, b) => `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0)`,
};
export function crest(tm, size = 36, cls = '') {
  return h('span', { class: 'frcrest ' + cls, style: { width: size + 'px', height: Math.round(size * 1.15) + 'px', '--c1': tm.c1, '--c2': tm.c2, background: (PAT[D.PATTERNS[tm.p]] || PAT.plain)(tm.c1, tm.c2) }, title: tm.name },
    h('img', { src: D.emblemSrc(tm.e), alt: '' }));
}
// (Bosses & Beasts: every club has a monster mascot, fixed by its name)
const mascotOf = (tm) => { let x = 7; for (const c of String(tm.name || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const teamChip = (fr, t, extra = '') => h('span', { class: 'frteam' }, crest(fr.teams[t], 18), clubMascotImg(mascotOf(fr.teams[t])), h('span', {}, fr.teams[t].name), extra ? h('small', { class: 'muted' }, extra) : null);

// ── small hero widgets ──
const moraleWord = (m) => (m >= 80 ? 'Fired up' : m >= 62 ? 'Happy' : m >= 45 ? 'Content' : m >= 30 ? 'Unhappy' : 'Wants out');
const moraleCls = (m) => (m >= 62 ? 'good' : m >= 45 ? '' : 'bad');
const formTxt = (f) => (f >= 2 ? '▲▲' : f >= 1 ? '▲' : f <= -2 ? '▼▼' : f <= -1 ? '▼' : '–');
function fatigue(x) {
  const n = Math.min(7, Math.round(x.f));
  return h('span', { class: 'frfat' + (x.inj ? ' inj' : x.f >= D.FATIGUE.exhausted ? ' ex' : x.f >= D.FATIGUE.tired ? ' tired' : ''), title: x.inj ? 'Strained: sits the next match' : `Fatigue ${Math.round(x.f)}/7` },
    ...Array.from({ length: 7 }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
}
const ovr = (x) => h('b', { class: 'frovr' + (x.o >= 80 ? ' star' : x.o >= 70 ? ' good' : ''), title: `Overall ${x.o} · potential ${x.p}` }, x.o);
const roleTag = (id) => h('small', { class: 'frrole' }, HERO_BY_ID[id].roles.map((r) => ROLE_LABEL[r]).join('/'));
function heroLine(fr, x, opts = {}) {
  return h('button', { class: 'frhero' + (opts.cls ? ' ' + opts.cls : ''), onclick: opts.onclick || (() => heroCard(fr, x.id)) },
    opts.role ? h('small', { class: 'frslot' + (opts.off ? ' off' : '') }, ROLE_LABEL[opts.role]) : null,
    h('img', { class: 'frface', src: face(x.id), alt: '' }),
    h('span', { class: 'frname' }, h('b', {}, hn(x.id)), opts.sub || roleTag(x.id)),
    ovr(x),
    opts.edge !== undefined ? h('small', { class: 'fredge ' + (opts.edge >= 0 ? 'pos' : 'neg'), title: 'Edge in the match (cfg stat bonus)' }, pct(opts.edge)) : null,
    opts.right || fatigue(x));
}

// ── entry ──
export function showFranchise(app, which) {
  APP = app;
  if (which) tab = which;
  const fr = getFr();
  if (!fr) { if (tab === 'pro') return frame(app, null, (body) => showPro(app, body)); return showFounding(app); }
  frame(app, fr, (body) => {
    if (tab === 'team') (fr.phase === 'offseason' ? offseasonTab : teamTab)(app, fr, body);
    else if (tab === 'market') marketTab(app, fr, body);
    else if (tab === 'league') leagueTab(app, fr, body);
    else if (tab === 'club') clubTab(app, fr, body);
    else showPro(app, body);
  });
}
const rerender = (app) => showFranchise(app);
function frame(app, fr, fill) {
  const me = fr && fr.teams[0], st = fr && L.standings(fr), rec = fr && st.find((r) => r.t === 0);
  const sub = !fr ? (tab === 'pro' ? 'Pro League' : 'Found your club') : fr.phase === 'offseason' ? `Season ${fr.season} offseason` : fr.phase === 'playoffs' ? `Season ${fr.season} · Playoffs` : `Season ${fr.season} · Round ${Math.min(D.ROUNDS, fr.round + 1)} of ${D.ROUNDS} · ${rec.w}-${rec.l}`;
  const body = h('div', { class: 'frbody' });
  const root = h('div', { class: 'subscreen franchise', 'data-view': 'franchise', style: fr ? { '--c1': me.c1, '--c2': me.c2 } : {} },
    h('div', { class: 'frhead' },
      h('button', { class: 'btn backbtn', onclick: () => { sfx(); app.menu(); } }, '‹ Back'),
      fr ? crest(me, 34, 'big') : h('img', { class: 'frproicon', src: 'assets/img/items/GoldCup.png', alt: '' }),
      h('div', { class: 'frtitle' }, h('b', {}, fr ? me.name : 'Franchise'), h('small', {}, sub)),
      h('div', { class: 'frtabs', role: 'tablist' },
        !fr ? h('button', { class: 'chip' + (tab !== 'pro' ? ' on' : ''), role: 'tab', 'aria-selected': String(tab !== 'pro'), onclick: () => { if (tab === 'pro') { sfx(); showFounding(app); } } }, 'Found a team') : null,
        ...TABS.filter(([k]) => fr || k === 'pro').map(([k, l]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), role: 'tab', 'aria-selected': String(tab === k),
          onclick: () => { if (tab !== k) { sfx(); tab = k; showFranchise(app); } } }, l)))),
    body);
  mount(screen(), root);
  fill(body);
}

// ── founding ──
let draftOpts = null;
function showFounding(app) {
  tab = 'team';
  const o = draftOpts || (draftOpts = { name: `${(app.name || 'Coach').slice(0, 10)} FC`, c1: D.COLORS[6], c2: D.COLORS[2], p: 1, e: 0, diff: 1 });
  const abbrOf = (n) => (n.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('') + n.replace(/[^A-Za-z]/g, '')).toUpperCase().slice(0, 3).padEnd(3, 'X');
  frame(app, null, (body) => {
    const prev = h('div', { class: 'frprev' });
    const paint = () => mount(prev, crest({ ...o, name: o.name }, 72, 'big'), h('div', { class: 'col' }, h('b', { class: 'frpname' }, o.name || 'Your team'), h('small', { class: 'muted' }, abbrOf(o.name || 'You'))));
    const sw = (k) => h('div', { class: 'frswatch' }, ...D.COLORS.map((c) => h('button', { class: 'sw' + (o[k] === c ? ' on' : ''), style: { background: c }, title: c, 'aria-label': `Colour ${c}`,
      onclick: (e) => { o[k] = c; for (const b of e.target.parentElement.children) b.classList.toggle('on', b === e.target); paint(); } })));
    const choose = (list, k, label) => h('div', { class: 'frpick' }, ...list.map((v, i) => h('button', { class: 'chip' + (o[k] === i ? ' on' : ''), onclick: (e) => { o[k] = i; for (const b of e.currentTarget.parentElement.children) b.classList.toggle('on', b === e.currentTarget); paint(); } }, label(v, i))));
    paint();
    mount(body, h('div', { class: 'frfound' },
      h('div', { class: 'panel col frfoundl' }, prev,
        h('p', { class: 'muted small' }, `Run a club for season after season: ${D.LEAGUE_TEAMS} franchises, ${D.ROUNDS} matches, playoffs, then contracts, a rookie draft and free agency. Every match is the real 5v5 with your own roster, or sim it in a second.`),
        h('div', { class: 'frpick' }, h('small', { class: 'muted' }, 'AI coaches'), ...['Easy', 'Normal', 'Hard'].map((l, i) => h('button', { class: 'chip' + (o.diff === i ? ' on' : ''), onclick: (e) => { o.diff = i; for (const b of e.currentTarget.parentElement.querySelectorAll('.chip')) b.classList.toggle('on', b === e.currentTarget); } }, l))),
        h('button', { class: 'btn big', onclick: () => {
          const name = (o.name || '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 20);
          if (name.length < 3) { toast('Give your team a name (3+ letters)'); return; }
          audio.sfx('accept', 0.8); buzz('callWin');
          foundFranchise({ name, abbr: abbrOf(name), c1: o.c1, c2: o.c2, p: o.p, e: o.e, diff: o.diff }); draftOpts = null; tab = 'team'; showFranchise(app);
          toast('Welcome to the league! Your roster is ready.', 2600);
        } }, 'Found the team')),
      h('div', { class: 'panel col frfoundr' },
        h('label', { class: 'frfield' }, h('small', { class: 'muted' }, 'Team name'), h('input', { value: o.name, maxlength: 20, 'aria-label': 'Team name', oninput: (e) => { o.name = e.target.value; paint(); } })),
        h('small', { class: 'muted' }, 'Main colour'), sw('c1'), h('small', { class: 'muted' }, 'Second colour'), sw('c2'),
        h('small', { class: 'muted' }, 'Pattern'), choose(D.PATTERNS, 'p', (v) => v[0].toUpperCase() + v.slice(1)),
        h('small', { class: 'muted' }, 'Emblem'), h('div', { class: 'fremblems' }, ...D.EMBLEMS.map((_, i) => h('button', { class: 'emb' + (o.e === i ? ' on' : ''), 'aria-label': D.EMBLEMS[i], title: D.EMBLEMS[i],
          onclick: (e) => { o.e = i; for (const b of e.currentTarget.parentElement.children) b.classList.toggle('on', b === e.currentTarget); paint(); } }, h('img', { src: D.emblemSrc(i), alt: '' })))))));
  });
}

// ── hero card (modal) ──
function heroCard(fr, id, app = APP) {
  const x = fr.h[id]; if (!x) return;
  const mine = x.t === 0, tm = x.t >= 0 ? fr.teams[x.t] : null, lu = mine ? L.myLineup(fr) : null, info = lu ? L.lineupInfo(lu) : null, slot = lu ? lu.findIndex((y) => y.id === id) : -1;
  const close = () => m.remove();
  const parts = heroModParts(x, info && slot >= 0 ? info.chem.mod : 0);
  const act = [];
  if (mine && fr.phase !== 'offseason') {
    if (slot >= 0) {
      const bench = L.rosterOf(fr, 0).filter((y) => !lu.includes(y) && !y.inj);
      if (bench.length) act.push(h('small', { class: 'muted' }, 'Rest them: start instead'), h('div', { class: 'frswap' }, ...bench.map((y) => h('button', { class: 'chip', onclick: () => { swapIn(fr, y.id, id); close(); rerender(app); } }, h('img', { src: face(y.id), alt: '' }), `${hn(y.id)} ${y.o}`))));
    } else if (!x.inj && lu) act.push(h('small', { class: 'muted' }, 'Start them in place of'), h('div', { class: 'frswap' }, ...lu.map((y, i) => h('button', { class: 'chip', onclick: () => { swapIn(fr, id, y.id); close(); rerender(app); } }, h('img', { src: face(y.id), alt: '' }), `${ROLE_LABEL[ROLES[i]]}: ${hn(y.id)}`))));
  }
  if (mine) {
    const rb = M.releaseBlock(fr, id);
    act.push(h('button', { class: 'chip danger', disabled: !!rb, title: rb || '', onclick: () => {
      if (!confirm(`Release ${hn(id)}? You pay ${M.releaseCost(x)}k dead money ${fr.phase === 'offseason' ? 'next season' : 'this season'}.`)) return;
      M.release(fr, id); saveFr(fr); close(); rerender(app);
    } }, rb ? `Release (${rb})` : `Release · ${M.releaseCost(x)}k dead money`));
  }
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel frcard' },
      h('div', { class: 'mhead' }, h('img', { class: 'frbigface', src: face(id), alt: '' }), h('b', {}, hn(id), h('small', { class: 'muted' }, ` ${HERO_BY_ID[id].title}`)), h('button', { class: 'x', title: 'Close', onclick: close }, 'X')),
      h('div', { class: 'frstats' },
        stat('Overall', x.o, x.o >= 80 ? 'gold' : ''), stat('Potential', x.p), stat('Pro seasons', x.a), stat('Roles', HERO_BY_ID[id].roles.map((r) => ROLE_LABEL[r]).join(' / ')),
        stat('Team', tm ? tm.name : x.t === -2 ? 'Draft prospect' : 'Free agent'),
        x.t >= 0 ? stat('Contract', `${x.s}k × ${x.y} season${x.y === 1 ? '' : 's'}`) : stat('Asks', `${salaryFor(x.o, x.p, x.a)}k a season`),
        stat('Morale', `${moraleWord(x.m)} (${Math.round(x.m)})`, moraleCls(x.m)), stat('Form', formTxt(x.fo)), stat('Fatigue', x.inj ? 'Strained' : `${Math.round(x.f)} / 7`, x.f >= D.FATIGUE.tired ? 'bad' : ''),
        stat('Bond', `${Math.round(x.b)} / ${D.BOND_MAX}`), stat('This season', `${x.w}-${x.g - x.w}`)),
      mine ? h('div', { class: 'frparts' }, h('small', { class: 'muted' }, 'Match edge'), ...parts.filter(([, v]) => Math.abs(v) >= 0.0005).map(([k, v]) => h('span', { class: v >= 0 ? 'pos' : 'neg' }, `${k} ${pct(v)}`))) : null,
      h('p', { class: 'muted small' }, mine ? 'Starters tire (−1.5% at 4, −3% at 6, strained at 7) and rest on the bench. Benched good heroes lose morale. Bonds grow with every match together.' : ''),
      ...act));
  document.body.append(m);
}
const stat = (k, v, cls = '') => h('div', { class: 'frstat' }, h('small', {}, k), h('b', { class: cls }, String(v)));
function swapIn(fr, inId, outId) {
  const cur = L.myLineup(fr).map((x) => x.id), i = cur.indexOf(outId);
  if (i < 0) return;
  cur[i] = inId; fr.lineup = cur; saveFr(fr); sfx('accept', 0.5);
}

// ── Team tab ──
function teamTab(app, fr, body) {
  const fx = L.nextFixture(fr), lu = L.myLineup(fr), info = lu && L.lineupInfo(lu), ros = L.rosterOf(fr, 0);
  const st = L.standings(fr), place = (t) => 1 + st.findIndex((r) => r.t === t), recOf = (t) => st.find((r) => r.t === t);
  let next;
  if (fx) {
    const ctx = L.matchContext(fr, fx), opp = fr.teams[fx.opp], orec = recOf(fx.opp);
    const label = fx.kind === 'season' ? `Round ${fx.round + 1} of ${D.ROUNDS}` : fx.kind === 'semi' ? 'Playoff semifinal' : 'The Final';
    next = h('div', { class: 'panel frnext' + (fx.kind !== 'season' ? ' po' : '') },
      h('small', { class: 'kick' }, label),
      h('div', { class: 'frvs' }, crest(fr.teams[0], 40), h('b', { class: 'vs' }, 'vs'), crest(opp, 40),
        h('div', { class: 'col' }, h('b', {}, opp.name), h('small', { class: 'muted' }, `${orec.w}-${orec.l}${orec.w + orec.l ? ' · ' + ordinal(place(fx.opp)) : ''} · ${D.GM_STYLES[opp.gm].name}`))),
      h('div', { class: 'frodds' }, h('span', {}, 'Edge ', h('b', { class: ctx.str[0] >= 0 ? 'pos' : 'neg' }, pct(ctx.str[0])), ' vs ', h('b', { class: ctx.str[1] >= 0 ? 'pos' : 'neg' }, pct(ctx.str[1]))),
        h('span', { class: 'muted' }, `Sim odds ${Math.round(ctx.p * 100)}%`)),
      h('div', { class: 'frgo' },
        h('button', { class: 'btn big', onclick: () => { sfx('accept', 0.7); playFixture(app); } }, 'Play match'),
        h('button', { class: 'btn', title: 'Resolve instantly with the sim model (same roster effects, no 5v5)', onclick: () => {
          const r = simFixture(); if (!r) return;
          audio.sfx(r.won ? 'accept' : 'move', 0.7); buzz(r.won ? 'callWin' : 'tap');
          toast(`${r.won ? 'Win' : 'Loss'} vs ${opp.name} · ${r.k[0]}-${r.k[1]} kills (simmed)`, 2600); rerender(app);
        } }, 'Sim match')));
  } else next = h('div', { class: 'panel frnext' }, h('b', {}, fr.phase === 'playoffs' ? 'Your season is over' : 'No match scheduled'), h('small', { class: 'muted' }, 'The playoffs are being decided.'));
  const lineupEl = h('div', { class: 'panel frlineup' },
    h('div', { class: 'frh' }, h('b', {}, 'Starting five'), h('small', { class: 'muted' }, info ? `Chemistry ${info.chem.pct}%${info.chem.comp ? ' · ' + info.chem.comp : ''}${info.chem.duos.length ? ' · ' + info.chem.duos.map((d) => d.name + (d.bonded ? ' ✓' : '')).join(', ') : ''}` : ''),
      h('button', { class: 'chip' + (fr.lineup ? '' : ' on'), title: 'Auto: the best rested five every match', onclick: () => { fr.lineup = null; saveFr(fr); sfx(); rerender(app); } }, fr.lineup ? 'Auto pick' : 'Auto ✓')),
    ...(lu || []).map((x, i) => heroLine(fr, x, { role: ROLES[i], off: offRole(x, i), edge: info.mods[i] })));
  const bench = ros.filter((x) => !lu || !lu.includes(x));
  const benchEl = h('div', { class: 'panel frbench' }, h('div', { class: 'frh' }, h('b', {}, 'Bench'), h('small', { class: 'muted' }, 'Tap a hero to rest or start them')),
    ...(bench.length ? bench.map((x) => heroLine(fr, x, { cls: 'bench' })) : [h('small', { class: 'muted' }, 'Nobody on the bench: sign a sixth hero so your starters can rest.')]));
  const last = fr.mine.slice(-5).reverse();
  const form = last.length ? h('div', { class: 'frform' }, h('small', { class: 'muted' }, 'Last results'), ...last.map((g) => h('i', { class: g.won ? 'w' : 'l', title: `${g.won ? 'Win' : 'Loss'} vs ${fr.teams[g.opp].name} (${g.k[0]}-${g.k[1]})${g.how === 'play' ? '' : ' · simmed'}` }, g.won ? 'W' : 'L'))) : null;
  const ne = fr.news[0] ? h('div', { class: 'frnews1 muted small' }, fr.news[0].text) : null;
  mount(body, h('div', { class: 'frteamtab' }, h('div', { class: 'col frcolL' }, next, form, ne), h('div', { class: 'col frcolR' }, lineupEl, benchEl)));
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th');

// ── Market tab ──
function marketTab(app, fr, body) {
  const me = fr.teams[0], pay = L.payroll(fr, 0), ros = L.rosterOf(fr, 0);
  const head = h('div', { class: 'panel frmoney' },
    h('span', {}, 'Payroll ', h('b', {}, `${pay}k`), ` / budget ${me.bud}k`), h('span', { class: L.capSpace(fr, 0) < 0 ? 'neg' : 'pos' }, `Room ${L.capSpace(fr, 0)}k`), h('span', {}, `Roster ${ros.length}/${D.ROSTER_MAX}`),
    h('div', { class: 'frseg' }, ...[['fa', 'Free agents'], ['trade', 'Trades']].map(([k, l]) => h('button', { class: 'chip' + (mkt === k ? ' on' : ''), onclick: () => { mkt = k; sfx(); rerender(app); } }, l))));
  if (!M.marketOpen(fr)) { mount(body, head, h('div', { class: 'panel muted center' }, 'The market is closed during the playoffs. It reopens in the offseason.')); return; }
  mount(body, head, mkt === 'fa' ? faList(app, fr) : tradePanel(app, fr));
}
function faList(app, fr) {
  const list = M.freeAgents(fr);
  const off = fr.phase === 'offseason' && fr.off.step !== 'fa';
  return h('div', { class: 'panel frfa' },
    h('div', { class: 'frh' }, h('b', {}, 'Free agents'), h('small', { class: 'muted' }, off ? 'Signings open after the rookie draft.' : 'Asking salary per season. Young heroes grow; veterans fade after 6 seasons.')),
    ...(list.length ? list.map((x) => {
      const why = M.signBlock(fr, x.id), ask = salaryFor(x.o, x.p, x.a);
      return heroLine(fr, x, { sub: h('small', { class: 'frrole' }, `${HERO_BY_ID[x.id].roles.map((r) => ROLE_LABEL[r]).join('/')} · POT ${x.p} · ${x.a} seasons`),
        right: h('span', { class: 'frsign' }, h('b', {}, `${ask}k`), ...[1, 2, 3].map((y) => h('button', { class: 'chip', disabled: !!why, title: why || `Sign for ${y} season${y > 1 ? 's' : ''}`,
          onclick: (e) => { e.stopPropagation(); if (M.sign(fr, x.id, y)) { saveFr(fr); audio.sfx('accept', 0.7); buzz('kill'); toast(`${hn(x.id)} signs for ${y} season${y > 1 ? 's' : ''}`); rerender(app); } } }, `${y}y`))) });
    }) : [h('p', { class: 'muted' }, 'No free agents right now. Retirements and releases bring new ones.')]));
}
function tradePanel(app, fr) {
  if (!fr.teams[tradeWith] || tradeWith === 0) tradeWith = 1;
  const t = tradeWith, tm = fr.teams[t], gm = D.GM_STYLES[tm.gm];
  give = give.filter((id) => fr.h[id] && fr.h[id].t === 0); get = get.filter((id) => fr.h[id] && fr.h[id].t === t);
  const ev = give.length ? M.evalTrade(fr, t, give, get) : null;
  const pickList = (owner, sel, max) => L.rosterOf(fr, owner).sort((a, b) => b.o - a.o).map((x) => heroLine(fr, x, { cls: sel.includes(x.id) ? 'sel' : '',
    sub: h('small', { class: 'frrole' }, `${HERO_BY_ID[x.id].roles.map((r) => ROLE_LABEL[r]).join('/')} · ${x.s}k × ${x.y}`),
    right: h('small', { class: 'frval', title: `Value to ${owner === 0 ? 'them' : 'them'} (their GM style)` }, `val ${Math.round(valueOf(x, tm.gm))}`),
    onclick: () => { const i = sel.indexOf(x.id); if (i >= 0) sel.splice(i, 1); else if (sel.length < max) sel.push(x.id); else { sel.shift(); sel.push(x.id); } sfx('move', 0.4); rerender(app); } }));
  const verdict = !M.tradeOpen(fr) ? h('b', { class: 'neg' }, fr.phase === 'season' ? `The trade deadline (round ${D.TRADE_DEADLINE}) has passed. Trades reopen in free agency.` : 'Trades open in free agency.')
    : !ev ? h('span', { class: 'muted' }, 'Pick one or two of your heroes, and up to two of theirs.')
    : h('span', { class: ev.ok ? 'pos' : 'neg' }, ev.why, ev.need > 0 ? h('small', { class: 'muted' }, ` (value ${ev.mine} offered, ${Math.round((ev.mine + ev.need) * 10) / 10} wanted)`) : null);
  return h('div', { class: 'frtrade' },
    h('div', { class: 'frtrteams' }, ...fr.teams.map((x, i) => (i === 0 ? null : h('button', { class: 'chip' + (i === t ? ' on' : ''), onclick: () => { tradeWith = i; get = []; sfx(); rerender(app); } }, crest(x, 14), x.abbr)))),
    h('div', { class: 'panel frtrhead' }, teamChip(fr, t), h('small', { class: 'muted' }, `GM: ${gm.name} · ${gm.blurb} · payroll ${L.payroll(fr, t)}k / ${tm.bud}k`)),
    h('div', { class: 'frtrcols' },
      h('div', { class: 'panel col' }, h('div', { class: 'frh' }, h('b', {}, 'You give'), h('small', { class: 'muted' }, `${give.length}/2`)), ...pickList(0, give, 2)),
      h('div', { class: 'panel col' }, h('div', { class: 'frh' }, h('b', {}, 'You get'), h('small', { class: 'muted' }, `${get.length}/2`)), ...pickList(t, get, 2))),
    h('div', { class: 'panel frverdict' }, verdict,
      h('button', { class: 'btn', disabled: !(ev && ev.ok), onclick: () => {
        const r = M.trade(fr, t, give, get); if (!r.ok) { toast(r.why); return; }
        saveFr(fr); audio.sfx('accept', 0.8); buzz('callWin'); toast('Trade done!'); give = []; get = []; rerender(app);
      } }, 'Make the trade')));
}

// ── League tab ──
function leagueTab(app, fr, body) {
  const st = L.standings(fr);
  const table = h('div', { class: 'panel frtable' }, h('div', { class: 'frh' }, h('b', {}, `Season ${fr.season} standings`), h('small', { class: 'muted' }, `Top ${D.PLAYOFF_TEAMS} make the playoffs`)),
    h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Team'), h('th', {}, 'W-L'), h('th', {}, 'K±'), h('th', { class: 'c-st' }, 'Streak')),
      ...st.map((r, i) => h('tr', { class: (r.t === 0 ? 'me' : '') + (i === D.PLAYOFF_TEAMS - 1 ? ' cut' : '') }, h('td', {}, i + 1), h('td', {}, teamChip(fr, r.t)), h('td', {}, `${r.w}-${r.l}`), h('td', {}, (r.kd > 0 ? '+' : '') + r.kd), h('td', { class: 'c-st' }, r.streak || '-')))));
  const res = (m) => (m[2] < 0 ? null : m[2] === 0 ? m[0] : m[1]);
  const fxRow = (m, key) => h('div', { class: 'frfx' + (m[0] === 0 || m[1] === 0 ? ' me' : ''), key },
    h('span', { class: res(m) === m[0] ? 'w' : '' }, crest(fr.teams[m[0]], 14), fr.teams[m[0]].abbr), h('b', {}, m[2] < 0 ? 'vs' : `${m[3]}-${m[4]}`), h('span', { class: res(m) === m[1] ? 'w' : '' }, fr.teams[m[1]].abbr, crest(fr.teams[m[1]], 14)));
  const rd = Math.min(fr.round, D.ROUNDS - 1), show = fr.phase === 'season' ? [rd - 1, rd].filter((r) => r >= 0) : [D.ROUNDS - 1];
  const fixtures = h('div', { class: 'panel frfixtures' }, ...show.map((r) => h('div', { class: 'col' }, h('small', { class: 'muted' }, `Round ${r + 1}`), ...fr.sched[r].map((m) => fxRow(m)))));
  const po = fr.po ? h('div', { class: 'panel frpo' }, h('div', { class: 'frh' }, h('b', {}, 'Playoffs')),
    h('div', { class: 'frbr' }, h('div', { class: 'col' }, h('small', { class: 'muted' }, 'Semifinals'), ...fr.po.sf.map((m) => fxRow(m))),
      h('div', { class: 'col' }, h('small', { class: 'muted' }, 'Final'), fr.po.f ? fxRow(fr.po.f) : h('small', { class: 'muted' }, 'TBD')))) : null;
  const mine = h('div', { class: 'panel frmine' }, h('div', { class: 'frh' }, h('b', {}, 'Your schedule')),
    h('div', { class: 'frsched' }, ...fr.sched.map((rdm, r) => { const m = rdm.find((x) => x[0] === 0 || x[1] === 0), opp = m[0] === 0 ? m[1] : m[0], w = res(m);
      return h('span', { class: 'frsc' + (w === null ? (r === fr.round && fr.phase === 'season' ? ' next' : '') : w === 0 ? ' w' : ' l'), title: `Round ${r + 1}: ${m[0] === 0 ? 'home' : 'away'} vs ${fr.teams[opp].name}` }, crest(fr.teams[opp], 16), h('small', {}, w === null ? `R${r + 1}` : w === 0 ? 'W' : 'L')); })));
  mount(body, h('div', { class: 'frleague' }, table, h('div', { class: 'col' }, po, fixtures, mine)));
}

// ── Club tab ──
function clubTab(app, fr, body) {
  const me = fr.teams[0], pay = L.payroll(fr, 0), dead = fr.phase === 'offseason' ? me.deadNext || 0 : me.dead || 0;
  const money = h('div', { class: 'panel frfin' }, h('div', { class: 'frh' }, h('b', {}, 'Finances'), h('small', { class: 'muted' }, `Salary cap ${D.CAP}k for every club`)),
    row('Owner budget', `${me.bud}k`), row('Payroll', `${pay - dead}k`), dead ? row('Dead money (released)', `${dead}k`) : null, row('Room', `${me.bud - pay}k`, me.bud - pay < 0 ? 'neg' : 'pos'),
    row('Fans', h('span', { class: 'frfans' }, h('i', { style: { width: me.fans + '%' } }), h('b', {}, me.fans))),
    h('p', { class: 'muted small' }, `Next budget = ${D.BUDGET_BASE}k + fans × ${D.BUDGET_PER_FAN} + half the season's prize, between ${D.BUDGET_MIN}k and ${D.CAP}k. Fans follow wins and playoff runs, and drift back toward ${D.FANS_START}, so a bad season never sinks the club.`));
  const tro = fr.troph;
  const trophies = h('div', { class: 'panel frtro' }, h('div', { class: 'frh' }, h('b', {}, 'Trophy room')),
    h('div', { class: 'frtrow' }, h('span', {}, h('img', { src: 'assets/img/items/GoldCup.png', alt: '' }), h('b', {}, tro.titles), h('small', {}, 'titles')),
      h('span', {}, h('img', { src: 'assets/img/items/SilverCup.png', alt: '' }), h('b', {}, tro.finals), h('small', {}, 'finals')),
      h('span', {}, h('b', {}, tro.best ? `${tro.best.w}-${tro.best.l}` : '-'), h('small', {}, tro.best ? `best (S${tro.best.s})` : 'best record'))),
    fr.hof.length ? h('div', { class: 'col' }, h('small', { class: 'muted' }, 'Club legends'), h('div', { class: 'frlegends' }, ...fr.hof.map((x) => h('span', { class: 'frleg', title: `${hn(x.id)}: peak OVR ${x.pk}, ${x.ys} seasons with you, retired after season ${x.s}` }, h('img', { src: face(x.id), alt: '' }), h('small', {}, hn(x.id)))))) : h('small', { class: 'muted' }, 'Heroes who retire after years with you (or a peak of 80+) join your club legends.'));
  const hist = h('div', { class: 'panel frhist' }, h('div', { class: 'frh' }, h('b', {}, 'History')),
    fr.hist.length ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Season'), h('th', {}, 'W-L'), h('th', {}, 'Finish'), h('th', {}, 'Champion'), h('th', { class: 'c-mvp' }, 'MVP')),
      ...fr.hist.map((s) => h('tr', { class: s.place === 1 ? 'champ' : '' }, h('td', {}, s.s), h('td', {}, `${s.w}-${s.l}`), h('td', {}, PLACE[s.place] || ordinal(s.place)), h('td', {}, s.champ), h('td', { class: 'c-mvp' }, s.mvp ? hn(s.mvp) : '-'))))
      : h('small', { class: 'muted' }, 'Your first season is under way.'));
  const news = h('div', { class: 'panel frnewsall' }, h('div', { class: 'frh' }, h('b', {}, 'League news')), ...fr.news.map((n) => h('div', { class: 'small' }, h('small', { class: 'muted' }, `S${n.s} `), n.text)));
  const set = h('div', { class: 'panel frset' }, h('div', { class: 'frpick' }, h('small', { class: 'muted' }, 'AI coaches'), ...['Easy', 'Normal', 'Hard'].map((l, i) => h('button', { class: 'chip' + ((fr.diff ?? 1) === i ? ' on' : ''), onclick: () => { fr.diff = i; saveFr(fr); sfx(); rerender(app); } }, l))),
    h('button', { class: 'chip danger', onclick: () => { if (confirm(`Retire ${me.name}? The club, its history and trophies are deleted. This cannot be undone.`)) { retireFranchise(); tab = 'team'; showFranchise(app); } } }, 'Retire the club'));
  mount(body, h('div', { class: 'frclub' }, h('div', { class: 'col' }, money, trophies, set), h('div', { class: 'col' }, hist, news)));
}
const PLACE = { 1: 'Champion', 2: 'Finalist', 3: 'Semifinal' };
const row = (k, v, cls = '') => h('div', { class: 'frrow' }, h('span', { class: 'muted' }, k), typeof v === 'string' ? h('b', { class: cls }, v) : v);

// ── Offseason (in the Team tab): review → contracts → draft → free agency → next season ──
const STEPS = [['review', 'Review'], ['contracts', 'Contracts'], ['draft', 'Draft'], ['fa', 'Free agency']];
function offseasonTab(app, fr, body) {
  const off = fr.off, si = STEPS.findIndex(([k]) => k === off.step);
  const steps = h('div', { class: 'frsteps' }, ...STEPS.map(([k, l], i) => h('span', { class: i < si ? 'done' : i === si ? 'on' : '' }, `${i + 1}. ${l}`)));
  const go = (fn) => { fn(); saveFr(fr); sfx('accept', 0.6); rerender(app); };
  let main;
  if (off.step === 'review') {
    const me = off.sum[0], ch = off.changes;
    main = h('div', { class: 'panel frreview' },
      h('div', { class: 'frh' }, h('b', {}, off.champ === 0 ? 'Champions!' : `Season ${fr.season} is over`), h('small', { class: 'muted' }, `${fr.teams[off.champ].name} won the title`)),
      off.champ === 0 ? h('img', { class: 'frbigcup', src: 'assets/img/items/GoldCup.png', alt: '' }) : null,
      row('Record', `${me.w}-${me.l}`), row('Finish', PLACE[me.place] || ordinal(me.place)), row('Prize', `${me.prize}k`), row('Fans', `${me.fans[0]} → ${me.fans[1]}`, me.fans[1] >= me.fans[0] ? 'pos' : 'neg'), row('Budget next season', `${me.bud[0]}k → ${me.bud[1]}k`, me.bud[1] >= me.bud[0] ? 'pos' : 'neg'),
      ch.length ? h('div', { class: 'frchanges' }, h('small', { class: 'muted' }, 'Your heroes over the summer'), ...ch.map((c) => h('span', { class: c.retired ? 'muted' : c.d > 0 ? 'pos' : 'neg' }, h('img', { src: face(c.id), alt: '' }), c.retired ? `${hn(c.id)} retires` : `${hn(c.id)} ${c.d > 0 ? '+' : ''}${c.d}`))) : null,
      h('button', { class: 'btn big', onclick: () => go(() => { off.step = 'contracts'; }) }, 'Contracts ›'));
  } else if (off.step === 'contracts') {
    const exp = off.exp.map((id) => fr.h[id]).filter(Boolean), stay = L.rosterOf(fr, 0).filter((x) => x.y > 0);
    const keepPay = stay.reduce((s, x) => s + x.s, 0) + (fr.teams[0].deadNext || 0);
    main = h('div', { class: 'panel frcontracts' },
      h('div', { class: 'frh' }, h('b', {}, 'Expiring contracts'), h('small', { class: 'muted' }, `Under contract: ${stay.length} heroes, ${keepPay}k of your ${fr.teams[0].bud}k budget`)),
      ...(exp.length ? exp.map((x) => heroLine(fr, x, { sub: h('small', { class: 'frrole' }, `${moraleWord(x.m)} · was ${x.s}k`),
        right: x.ask > 0 ? h('span', { class: 'frsign' }, h('b', {}, `${x.ask}k`), ...[1, 2, 3].map((y) => h('button', { class: 'chip', title: `Re-sign for ${y} season${y > 1 ? 's' : ''}`, onclick: (e) => { e.stopPropagation(); go(() => L.resign(fr, x.id, y)); } }, `${y}y`)),
          h('button', { class: 'chip danger', onclick: (e) => { e.stopPropagation(); go(() => L.letGo(fr, x.id)); } }, 'Let go'))
          : h('span', { class: 'frsign' }, h('small', { class: 'neg' }, 'Unhappy: will not re-sign'), h('button', { class: 'chip', onclick: (e) => { e.stopPropagation(); go(() => L.letGo(fr, x.id)); } }, 'OK')) })) : [h('p', { class: 'muted' }, 'No contracts expire this summer.')]),
      h('small', { class: 'muted' }, 'Happy heroes (morale 75+) give a 10% hometown discount. Anyone you do not re-sign becomes a free agent.'),
      h('button', { class: 'btn big', onclick: () => go(() => L.startDraft(fr)) }, exp.length ? `Let the rest go · Draft ›` : 'Rookie draft ›'));
  } else if (off.step === 'draft') {
    const pool = L.prospects(fr), myTurn = L.myDraftTurn(fr), full = L.rosterOf(fr, 0).length >= D.ROSTER_MAX;
    main = h('div', { class: 'panel frdraft' },
      h('div', { class: 'frh' }, h('b', {}, 'Rookie draft'), h('small', { class: 'muted' }, `Worst record picks first. Pick ${off.pick + 1} · rookie deals: 3 seasons, ${D.ROOKIE_SAL[Math.min(off.pick, D.ROOKIE_SAL.length - 1)]}k`)),
      off.picks.length ? h('div', { class: 'frpicks' }, ...off.picks.map((p) => h('span', { class: p.t === 0 ? 'me' : '' }, `${p.slot + 1}. ${fr.teams[p.t].abbr}: ${p.id ? hn(p.id) : 'pass'}`))) : null,
      myTurn ? h('small', { class: 'gold' }, full ? 'Your roster is full: pass this pick.' : 'You are on the clock: pick a prospect.') : null,
      ...pool.map((x) => heroLine(fr, x, { sub: h('small', { class: 'frrole' }, `${HERO_BY_ID[x.id].roles.map((r) => ROLE_LABEL[r]).join('/')} · potential ${x.p}`),
        right: h('button', { class: 'chip', disabled: !myTurn || full, onclick: (e) => { e.stopPropagation(); go(() => L.myDraftPick(fr, x.id)); audio.sfx('lockin', 0.7); } }, 'Draft') })),
      pool.length ? null : h('p', { class: 'muted' }, 'No prospects this year.'),
      myTurn ? h('button', { class: 'chip', onclick: () => go(() => L.myDraftPick(fr, null)) }, 'Pass') : null);
  } else {
    const blockers = L.seasonBlockers(fr), warn = L.seasonWarnings(fr);
    main = h('div', { class: 'panel frfastart' },
      h('div', { class: 'frh' }, h('b', {}, 'Free agency'), h('small', { class: 'muted' }, 'Sign, release and trade in the Market tab. The AI clubs sign when the season starts.')),
      row('Roster', `${L.rosterOf(fr, 0).length} (${D.ROSTER_MIN}-${D.ROSTER_MAX})`), row('Payroll', `${L.payroll(fr, 0)}k / ${fr.teams[0].bud}k`, L.capSpace(fr, 0) < 0 ? 'neg' : 'pos'),
      ...blockers.map((b) => h('div', { class: 'neg small' }, b)), ...warn.map((b) => h('div', { class: 'gold small' }, b)),
      h('div', { class: 'frgo' }, h('button', { class: 'btn', onclick: () => { tab = 'market'; mkt = 'fa'; rerender(app); } }, 'Market ›'),
        h('button', { class: 'btn big', disabled: blockers.length > 0, onclick: () => { if (L.startNextSeason(fr)) { saveFr(fr); audio.sfx('accept', 0.9); buzz('callWin'); toast(`Season ${fr.season} begins!`, 2400); rerender(app); } } }, `Start season ${fr.season + 1}`)));
  }
  const ros = L.rosterOf(fr, 0).sort((a, b) => b.o - a.o);
  mount(body, steps, h('div', { class: 'frteamtab off' }, h('div', { class: 'col frcolL' }, main,
    h('button', { class: 'chip', title: 'Your assistant GM re-signs good value, drafts the best prospect and fills the roster', onclick: () => { if (confirm('Let your assistant GM finish the offseason (contracts, draft, free agency) and start the next season?')) { L.assistant(fr); saveFr(fr); rerender(app); } } }, 'Assistant GM: do it for me')),
  h('div', { class: 'col frcolR' }, h('div', { class: 'panel frbench' }, h('div', { class: 'frh' }, h('b', {}, 'Your roster'), h('small', { class: 'muted' }, `${ros.length} heroes`)), ...ros.map((x) => heroLine(fr, x, { sub: h('small', { class: 'frrole' }, `${x.y ? `${x.s}k × ${x.y}` : 'expiring'} · ${x.a} seasons`), right: h('small', { class: 'frval ' + moraleCls(x.m) }, moraleWord(x.m)) }))))));
}

// ── results-screen panel (main.js endMatch): the league after your match ──
export function franchiseResults(app, out) {
  if (!out) return null;
  const fr = out.fr, st = L.standings(fr), place = st.findIndex((r) => r.t === 0) + 1, rec = st.find((r) => r.t === 0);
  const line = fr.phase === 'offseason' ? (fr.off.champ === 0 ? 'Champions! Season complete.' : `Season over: ${fr.teams[fr.off.champ].name} are champions.`)
    : fr.phase === 'playoffs' ? (L.nextFixture(fr) ? (fr.po.f && (fr.po.f[0] === 0 || fr.po.f[1] === 0) ? 'Into the Final!' : 'Playoffs: your semifinal is next.') : 'Your playoff run is over.')
    : `${rec.w}-${rec.l} · ${ordinal(place)} of ${D.LEAGUE_TEAMS}${out.placeBefore && place !== out.placeBefore ? ` (was ${ordinal(out.placeBefore)})` : ''}`;
  return h('div', { class: 'panel frres' }, crest(fr.teams[0], 30), h('div', { class: 'col' }, h('small', { class: 'muted' }, `${fr.teams[0].name} · ${out.fx.kind === 'season' ? `Round ${out.fx.round + 1}` : out.fx.kind === 'semi' ? 'Semifinal' : 'Final'}`), h('b', {}, line)));
}
