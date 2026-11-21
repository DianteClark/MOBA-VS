// Front end: home, season pass, profile (banners/titles/borders), Season Cup bracket, patch notes, and post-match progression.
import { h, mount, face, emptyState, fmtTime, MODE_LABEL } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { CLANS } from '../sim/constants.js';
import { daysLeft, TRACK, MAX_LEVEL, XP_PER_LEVEL, SKINS, BANNERS, TITLES, rewardName } from '../data/seasons.js';
import { tierById, rankOf, SEASON_REWARDS } from '../data/ranks.js';
import { titleName } from '../profile.js';
import { tierBadge } from './badges.js';
import { rankRow, rankTab, seasonEndNote } from './ranks.js';
import { masteryTab, masteryRow } from './mastery.js';
import { PATCHES } from '../data/patchnotes.js';
import { profile } from '../profile.js';
import { myMatch, ROUND_NAMES } from '../cup.js';
import { heroSprite } from './heroui.js';
import { showDojo } from './dojo.js';
import { mapThumb, showHowTo } from './screens.js';
import { audio } from '../audio.js';
import { shareMatch } from './share.js';
import { showLeaderboard } from './online.js';
import { showSettings } from './settings.js';
import { careerTab } from './career.js';
import { showAnalysis } from './analytics.js';
import { loadLib } from './replays.js';
import { friendsTab, socialBadge, showPlayer } from './social.js';
import { rivalChip, showRivals, nextRival } from './rivals.js';
import { RIVAL_BY_ID } from '../data/rivals.js';

const screen = () => document.getElementById('screen');
const item = (n) => `assets/img/${n}.png`;
const DIFF = ['Easy', 'Normal', 'Hard'];

function rankBadge(rk) { return tierBadge(rk, 38); }
function bar(frac, color) { return h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color || 'var(--gold)' } })); }
function back(app) { return h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'); }

// ───────────── home ─────────────
// One landscape screen: coach + season on top, three clear ways to play (vs AI, Find Match with its
// queue toggle, Lane Rush), a "What's new" card, and one row of destinations. No scrolling for the
// primary actions on a 667x375 phone.
const navTile = (label, img, onclick, opts = {}) => h('button', { class: 'h2tile' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || label, onclick },
  typeof img === 'string' ? h('img', { src: img, alt: '' }) : img, h('span', {}, label), opts.dot ? h('i', { class: 'dot' }) : null);
// One-line highlights for the newest patch: its own `highlights` list if it has one, else the first notes, shortened.
function patchHighlights(pt) {
  if (Array.isArray(pt.highlights) && pt.highlights.length) return pt.highlights.slice(0, 4);
  return pt.notes.slice(0, 3).map((n) => n.split(/[:.(]/)[0].trim()).filter(Boolean);
}
export function showHome(app) {
  const p = profile, s = p.season, ss = p.ss(), rk = p.rank, pt = PATCHES[0];
  const qm = app.queueMode || 'ranked', unseen = p.d.seenPatch !== pt.version, newbie = !p.d.history.length;
  const cup = p.d.cup && p.d.cup.season === s.id && !p.d.cup.done ? p.d.cup : null;
  const mm = cup ? myMatch(cup) : null;
  const mapPick = app.mapPref === 'rush' ? 'random' : app.mapPref || 'random';
  const fs = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  const QDESC = { ranked: 'Real players · climbs the ladder', casual: 'Real players · 5v5, no rank change', rush: 'Real players · Lane Rush, casual' };
  mount(screen(), h('div', { class: 'home2' + (newbie ? ' newbie' : '') },
    h('div', { class: 'h2top' },
      h('div', { class: 'h2brand' }, h('div', { class: 'title' }, 'MOBA-VS'), h('small', {}, `v${pt.version}`)),
      h('div', { class: 'h2coach', style: { background: p.banner.bg }, title: 'Your coach card: tap for rank, mastery and banners', onclick: (e) => { if (e.target.tagName !== 'INPUT') { audio.sfx('move', 0.5); showProfile(app); } } },
        rankBadge(rk),
        h('div', { class: 'cc' },
          h('input', { class: 'cname', value: app.name, maxlength: 12, title: 'Tap to rename', 'aria-label': 'Coach name', oninput: (e) => app.setName(e.target.value) }),
          h('small', { style: { color: rk.tier.color } }, `${rk.label} · ${ss.elo}`),
          bar(rk.into / rk.span, rk.tier.color))),
      h('button', { class: 'h2season', style: { '--sc': s.color }, onclick: () => showSeason(app) },
        h('small', {}, `SEASON ${s.id} · ${daysLeft(s)}d left`), h('b', {}, s.name), h('div', { class: 'slv' }, h('span', {}, `Pass ${p.level}`), bar(p.levelProgress, s.color))),
      h('div', { class: 'h2icons' },
        fs ? h('button', { class: 'h2icon', title: 'Full screen', 'aria-label': 'Full screen', onclick: () => window.toggleFullscreen() }, h('i', { class: 'fsicon' })) : null,
        h('button', { class: 'h2icon', title: 'Settings', 'aria-label': 'Settings', onclick: () => { audio.sfx('move', 0.5); showSettings(app); } }, h('img', { src: 'assets/img/icons/Permutation.png', alt: '' })))),
    h('div', { class: 'h2main' },
      h('div', { class: 'h2card h2ai' },
        newbie ? h('span', { class: 'h2start' }, 'Start here') : null,
        h('div', { class: 'h2aihead' }, h('div', { class: 'h2h' }, h('b', {}, 'Play vs AI'), h('small', {}, 'Ranked 5v5 · vs a rival coach')),
          rivalChip(app, () => { audio.sfx('move', 0.5); showRivals(app); })),
        h('div', { class: 'seg3', role: 'radiogroup', 'aria-label': 'AI difficulty' }, ...DIFF.map((l, i) => h('button', { class: 'chip' + (app.aiLevel === i ? ' on' : ''), role: 'radio', 'aria-checked': String(app.aiLevel === i),
          onclick: () => { app.aiLevel = i; if (app.rivalPick && RIVAL_BY_ID[app.rivalPick].tier !== i) app.rivalPick = null; showHome(app); } }, l))),
        h('div', { class: 'maprow' }, ...[['random', 'Random'], ...MAPS.map((m) => [m.id, m.id[0].toUpperCase() + m.id.slice(1)])].map(([id, l]) =>
          h('button', { class: 'mapchip' + (mapPick === id ? ' on' : ''), title: id === 'random' ? `Random (${MAP_BY_ID[s.map].name} is featured)` : `${MAP_BY_ID[id].name}: ${MAP_BY_ID[id].blurb}`, onclick: () => { app.mapPref = id; showHome(app); } },
            id === 'random' ? h('span', { class: 'q' }, '?') : mapThumb(id), h('span', {}, l)))),
        h('button', { class: 'btn big h2go', onclick: () => app.startVsAI('classic') }, 'Play')),
      h('div', { class: 'h2card h2online' },
        h('div', { class: 'h2h' }, h('b', {}, 'Find Match'), h('small', {}, QDESC[qm])),
        h('div', { class: 'seg3', role: 'radiogroup', 'aria-label': 'Queue' }, ...[['ranked', 'Ranked'], ['casual', 'Casual'], ['rush', 'Rush']].map(([k, l]) =>
          h('button', { class: 'chip' + (qm === k ? ' on' : ''), role: 'radio', 'aria-checked': String(qm === k), title: QDESC[k], onclick: () => { app.setQueueMode(k); showHome(app); } }, l))),
        h('button', { class: 'btn big h2go', onclick: () => app.findMatch() }, 'Find Match'),
        h('div', { class: 'h2row' },
          h('button', { class: 'chip', title: 'Private room: share a code with a friend', onclick: () => app.hostGame() }, 'Host'),
          h('button', { class: 'chip', title: 'Join a friend\'s room code', onclick: () => app.joinScreen() }, 'Join'))),
      h('div', { class: 'h2side' },
        h('button', { class: 'h2card h2rush', onclick: () => app.startVsAI('rush') },
          h('span', { class: 'h2h' }, h('b', {}, 'Lane Rush'), h('small', {}, `One lane · ~7 min · vs ${nextRival(app).name}`)),
          h('span', { class: 'h2arrow' }, 'Play ›')),
        h('button', { class: 'h2card h2new' + (unseen ? ' unseen' : ''), onclick: () => showPatch(app) },
          h('span', { class: 'h2h' }, h('small', { class: 'kick' }, unseen ? 'NEW' : 'PATCH NOTES'), h('b', {}, `What's new in ${pt.version}`)),
          h('span', { class: 'h2hl' }, ...patchHighlights(pt).map((t) => h('i', {}, t)))))),
    h('nav', { class: 'h2nav' },
      navTile('Dojo', heroSprite(p.activePreset && p.activePreset.main.mid || 'kaze', p.d.equip.skins[p.activePreset && p.activePreset.main.mid || 'kaze'], 28, 'walk'), () => { audio.sfx('move', 0.5); showDojo(app, { tab: 'heroes', hero: null }); }, { title: 'Dojo: heroes, builds and lineups' }),
      navTile('Profile', rankBadge(rk), () => { audio.sfx('move', 0.5); showProfile(app, socialBadge() ? 'friends' : 'rank'); }, { title: 'Rank, mastery, friends, banners and titles', cls: 'navprofile', dot: socialBadge() }),
      navTile('Cup', item('items/GoldCup'), () => showCup(app), { title: mm ? `Season Cup: ${ROUND_NAMES[mm.round]} vs ${mm.opp.name}` : 'Season Cup: 8-team knockout', dot: !!mm }),
      navTile('Pass', item('items/BigTreasureChest'), () => showSeason(app), { title: 'Season Pass' }),
      navTile('Ladder', item('items/BarGold'), () => showLeaderboard(app), { title: 'Online leaderboard' }),
      navTile('History', item('items/Hourglass'), () => showHistory(app), { title: 'Match history and replays' }),
      navTile('Watch', 'assets/img/icons/Vision.png', () => app.watch(), { title: 'Watch an AI vs AI match' }),
      navTile('Help', item('items/Letter'), () => showHowTo(app), { title: 'How to play', cls: newbie ? 'hl' : '' })),
    seasonEndNote(p.newSeasonNote),
    h('div', { class: 'credits' }, 'Art & audio: ', h('a', { href: 'https://pixel-boy.itch.io/ninja-adventure-asset-pack', target: '_blank' }, 'Ninja Adventure'), ' by Pixel-boy & AAA (CC0)'),
  ));
  p.newSeasonNote = null;
}

// ───────────── season pass ─────────────
export function showSeason(app) {
  const p = profile, s = p.season, ss = p.ss(), lv = p.level;
  const cells = [];
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const r = TRACK[l], got = l <= lv;
    cells.push(h('div', { class: 'tcell' + (got ? ' got' : '') + (l === lv ? ' cur' : '') },
      h('b', {}, l), r ? rewardIcon(r) : h('span', { class: 'dot' }), h('small', {}, r ? rewardName(r).replace('Title: ', '') : '')));
  }
  const rk = p.rank;
  mount(screen(), h('div', { class: 'subscreen' },
    h('div', { class: 'shead', style: { '--sc': s.color } }, back(app), h('div', {}, h('small', {}, `SEASON ${s.id} · ${daysLeft(s)} days left`), h('h2', {}, s.name)), h('div')),
    h('p', { class: 'muted center' }, s.blurb),
    h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `Season Pass · Level ${lv}`), h('small', { class: 'muted' }, lv >= MAX_LEVEL ? 'Complete!' : `${ss.xp % XP_PER_LEVEL}/${XP_PER_LEVEL} XP`)), bar(p.levelProgress, s.color),
      h('div', { class: 'track' }, cells),
      h('small', { class: 'muted' }, `Earn XP every match: win 120 · loss 70 · +15 per successful call · +10 per ${CLANS[s.clan].name} hero on your team · +50 in the Cup.`)),
    h('div', { class: 'panel row seasonrank', style: { gap: '10px' } }, rankBadge(rk), h('div', { class: 'col', style: { gap: '3px', flex: 1 } }, h('b', { style: { color: rk.tier.color } }, `${rk.label} · ${ss.elo}`),
      h('small', { class: 'muted' }, 'Ranks run Bronze → Kami with three divisions each. Your peak tier earns season rewards.')), h('button', { class: 'btn', onclick: () => showProfile(app, 'rank') }, 'Tiers & rewards')),
    h('div', { class: 'panel' }, h('b', {}, 'How seasons stay balanced'),
      h('p', { class: 'muted' }, 'At the end of every season our balancer plays hundreds of matches, measures every legend\'s win rate and nudges the strong ones down and the weak ones up (at most 5% a season). The changes ship with the next season\'s patch notes.')),
  ));
}
function rewardIcon(r) {
  if (r.kind === 'skin') return h('span', { class: 'sw', style: { background: SKINS[r.id].swatch } });
  if (r.kind === 'banner') return h('span', { class: 'bn', style: { background: BANNERS[r.id].bg } });
  return h('img', { src: item('items/Scroll') });
}

// ───────────── profile (cosmetics; hero skins live in the Dojo) ─────────────
export function showProfile(app, tab = 'rank', all = false) {
  const p = profile, un = p.d.unlocked;
  const tabs = h('div', { class: 'tabs' }, ...[['rank', 'Rank'], ['career', 'Career'], ['mastery', 'Mastery'], ['friends', 'Friends'], ['banners', 'Banners'], ['titles', 'Titles'], ['borders', 'Borders']].map(([k, l]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), onclick: () => showProfile(app, k) }, l)));
  let body;
  if (tab === 'rank') body = rankTab();
  else if (tab === 'career') body = careerTab(p.d, all, () => showProfile(app, 'career', !all));
  else if (tab === 'mastery') body = masteryTab();
  else if (tab === 'friends') body = friendsTab(app);
  else if (tab === 'banners') {
    body = h('div', { class: 'cardgrid' }, ...Object.entries(BANNERS).map(([k, b]) => {
      const have = un.banners.includes(k);
      return h('button', { class: 'bannercard' + (p.d.equip.banner === k ? ' on' : '') + (have ? '' : ' locked'), disabled: !have, style: { background: b.bg }, onclick: () => { p.equip('banner', k); showProfile(app, 'banners'); } },
        h('b', {}, b.name), h('small', {}, have ? (p.d.equip.banner === k ? 'Equipped' : 'Equip') : lockText('banner', k)));
    }));
  } else if (tab === 'titles') {
    const keys = [...Object.keys(TITLES), ...un.titles.filter((k) => !TITLES[k])];
    body = h('div', { class: 'col' }, ...keys.map((k) => [k, titleName(k)]).map(([k, t]) => {
      const have = un.titles.includes(k);
      return h('button', { class: 'titlerow' + (p.d.equip.title === k ? ' on' : '') + (have ? '' : ' locked'), disabled: !have, onclick: () => { p.equip('title', k); showProfile(app, 'titles'); } },
        h('img', { src: item('items/Scroll') }), h('b', {}, t), h('small', {}, have ? (p.d.equip.title === k ? 'Equipped' : 'Equip') : lockText('title', k)));
    }));
  } else {
    body = p.d.borders.length ? h('div', { class: 'cardgrid' }, ...p.d.borders.map((b) => { const t = tierById(b.tier); return h('div', { class: 'bannercard bordercard', style: { borderColor: t.color } }, tierBadge(rankOf(Math.max(850, t.min)), 36), h('b', { style: { color: t.color } }, t.name), h('small', {}, `Season ${b.season}`)); }))
      : emptyState('assets/img/items/SilverCup.png', 'No borders yet', 'Finish a season with 5+ rated matches to earn the border of your peak tier.');
  }
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Profile'), h('div')), tabs, body,
    h('small', { class: 'muted center' }, 'Hero skins are equipped on each hero\'s page in the Dojo.')));
}
function lockText(kind, id) {
  const l = Object.entries(TRACK).find(([, r]) => (r.kind === kind && r.id === id) || (r.also && r.also.kind === kind && r.also.id === id));
  if (l) return `Pass Lv ${l[0]}`;
  const rk = Object.entries(SEASON_REWARDS).find(([, list]) => list.some((r) => r.kind === kind && r.id === id));
  if (rk) return `Season end: ${tierById(rk[0]).name}`;
  if (/^m:/.test(id)) return 'Hero mastery';
  if (id === 'gold' || id === 'champ') return 'Win the Season Cup';
  if (id === 'tripleChamp') return 'Win 3 Season Cups';
  return 'Locked';
}

// ───────────── Season Cup ─────────────
export function showCup(app) {
  const p = profile;
  let cup = p.d.cup && p.d.cup.season === p.season.id ? p.d.cup : null;
  const start = () => { app.newCup(); showCup(app); };
  if (!cup) {
    mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Season Cup'), h('div')),
      h('div', { class: 'panel center col' }, h('img', { class: 'bigcup', src: item('items/GoldCup') }),
        h('p', {}, 'Eight teams. Three knockout rounds. The AI gets tougher every round, and the Grand Final is played on this season\'s featured map.'),
        h('p', { class: 'muted' }, 'Champion: Golden Cup trophy, the "Cup Champion" title and the Golden Cup banner. Finalist: Silver Cup. Every Cup match also earns +50 pass XP and counts for your rank.'),
        h('button', { class: 'btn big', onclick: start }, 'Start the Cup'))));
    return;
  }
  const mm = myMatch(cup);
  const team = (i, m) => {
    if (i === null || i === undefined) return h('div', { class: 'bteam tbd' }, 'TBD');
    const t = cup.teams[i];
    return h('div', { class: 'bteam' + (t.you ? ' you' : '') + (m.w === i ? ' win' : m.w !== null ? ' lose' : '') }, h('img', { src: face(t.crest) }), h('span', {}, t.name), t.you ? null : h('small', {}, ['★', '★★', '★★★'][t.lvl]));
  };
  const cols = [0, 1, 2].map((r) => {
    const ms = cup.rounds[r] || Array.from({ length: 4 >> r }, () => ({ a: null, b: null, w: null }));
    return h('div', { class: 'bcol' }, h('div', { class: 'bround' }, ROUND_NAMES[r]), ...ms.map((m) => h('div', { class: 'bmatch' }, team(m.a, m), team(m.b, m))));
  });
  const champ = cup.done ? (cup.rounds[2] && cup.rounds[2][0].w !== null ? cup.teams[cup.rounds[2][0].w] : null) : null;
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, `Season ${cup.season} Cup`), h('div')),
    h('div', { class: 'bracket' }, cols, h('div', { class: 'bcol champ' }, h('div', { class: 'bround' }, 'Champion'), h('div', { class: 'bmatch' }, champ ? h('div', { class: 'bteam win' + (champ.you ? ' you' : '') }, h('img', { src: item('items/GoldCup') }), h('span', {}, champ.name)) : h('div', { class: 'bteam tbd' }, h('img', { src: item('items/GoldCup') }), '?')))),
    mm ? h('div', { class: 'panel center col' }, h('b', {}, `${ROUND_NAMES[mm.round]}: you vs ${mm.opp.name}`), h('small', { class: 'muted' }, `${DIFF[mm.opp.lvl]} AI · ${mm.round === 2 ? MAP_BY_ID[p.season.map].name : 'random map'}`), h('button', { class: 'btn big', onclick: () => app.startCupMatch() }, 'Play match'))
      : h('div', { class: 'panel center col' }, h('b', {}, cup.result === 'champion' ? 'You won the Cup!' : cup.result === 'runner-up' ? 'Finalist: Silver Cup earned.' : 'Knocked out. Next time.'), h('button', { class: 'btn big', onclick: start }, 'New Cup')),
  ));
}

// ───────────── patch notes ─────────────
// Newest patch open, older ones folded. A note's lead-in ("Lane Rush: ...") is highlighted for skimming.
function noteLine(n) {
  const m = /^([^:.]{2,42}):\s(.+)$/.exec(n);
  return h('li', {}, m ? [h('b', { class: 'nlead' }, m[1] + ': '), m[2]] : n);
}
export function showPatch(app) {
  profile.d.seenPatch = PATCHES[0].version; profile.save();
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Patch Notes'), h('div')),
    ...PATCHES.map((pt, i) => {
      const head = h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { class: 'gold' }, `v${pt.version} · ${pt.title}`), h('small', { class: 'muted' }, pt.date));
      const body = [h('ul', {}, ...pt.notes.map(noteLine)),
        pt.heroes.length ? h('div', { class: 'hchanges' }, ...pt.heroes.map((c) => h('div', { class: 'hc' }, h('img', { src: face(c.id) }), h('b', { class: c.dir > 0 ? 'up' : 'down' }, c.dir > 0 ? '▲' : '▼'), h('span', {}, h('b', {}, HERO_BY_ID[c.id] ? HERO_BY_ID[c.id].name : c.id), ' ', c.text)))) : null];
      return i === 0 ? h('div', { class: 'panel patch' }, head, body)
        : h('details', { class: 'panel patch old' }, h('summary', {}, head), body);
    })));
}

// ───────────── post-match progression (inside results) ─────────────
export function progressPanel(sum, cupOut) {
  if (!sum) return null;
  return h('div', { class: 'panel prog' },
    rankRow(sum),
    masteryRow(sum),
    h('div', { class: 'prow' }, h('div', { class: 'lvb' }, `Lv ${sum.lvAfter}`),
      h('div', { class: 'col', style: { gap: '3px', flex: 1 } }, h('div', { class: 'xps' }, ...sum.xpParts.map(([l, v]) => h('span', {}, `${l} +${v}`))), bar(profile.levelProgress, profile.season.color))),
    sum.lvAfter > sum.lvBefore ? h('div', { class: 'gold center' }, `Season Pass level ${sum.lvAfter}!`) : null,
    [...sum.unlocks, ...((cupOut && cupOut.rewards) || [])].length ? h('div', { class: 'unlocks' }, ...[...sum.unlocks, ...((cupOut && cupOut.rewards) || [])].map((r) => h('div', { class: 'unlock' },
      r.kind === 'trophy' ? h('img', { src: item(r.id === 'gold' ? 'items/GoldCup' : 'items/SilverCup') }) : rewardIcon(r), h('span', {}, r.kind === 'trophy' ? (r.id === 'gold' ? 'Golden Cup!' : 'Silver Cup') : rewardName(r)), h('small', {}, 'Unlocked')))) : null,
    cupOut ? h('div', { class: 'center muted' }, cupOut.won ? (cupOut.round === 2 ? 'Season Cup champion!' : `You advance past the ${ROUND_NAMES[cupOut.round]}.`) : `Eliminated in the ${ROUND_NAMES[cupOut.round]}.`) : null);
}

// ───────────── match history ─────────────
export function showHistory(app, open = 0) {
  const list = profile.d.history, lib = loadLib();
  const coach = { name: app.name, rank: profile.rank.label };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const detail = (m) => {
    const side = (t) => h('div', { class: 'hd-team ' + (t ? 'red' : 'blue') }, h('b', {}, `${(m.names || ['Blue', 'Red'])[t] || ''}${t === m.side ? ' (you)' : ''} · ${m.kills[t]} kills · ${m.towers[t]} towers`),
      ...m.picks[t].map((id, i) => { const k = (m.kda && m.kda[t] && m.kda[t][i]) || []; const mvp = m.mvp && m.mvp.id === id && m.mvp.team === t;
        return h('div', { class: 'hd-row' + (mvp ? ' hmvp' : '') }, h('img', { src: face(id) }), h('span', {}, HERO_BY_ID[id] ? HERO_BY_ID[id].name : id), h('span', { class: 'k' }, k.length ? `${k[0]}/${k[1]}/${k[2]}` : ''), h('small', {}, k.length ? `${k[3]} CS · ${(k[5] / 1000).toFixed(1)}k` : ''), mvp ? h('b', { class: 'mvpt' }, 'MVP') : null); }));
    // the last few matches keep their analytics and replay on this device
    const e = lib.find((x) => x.id === m.t), back = () => showHistory(app, list.indexOf(m));
    const theater = e && app.canPlay(e) ? () => app.watchReplay(null, { entry: e, back }) : null;
    return h('div', { class: 'hd' }, h('div', { class: 'hd-teams' }, side(0), side(1)),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        e && e.A ? h('button', { class: 'btn big', title: 'Turning point, damage, calls and the timeline', onclick: () => showAnalysis(e.A, { title: 'Match analysis', onTheater: theater }) }, 'Analysis') : null,
        theater ? h('button', { class: 'btn big', title: 'Replay Theater', onclick: theater }, '▶ Replay') : null,
        h('button', { class: 'btn big', onclick: () => shareMatch(m, coach, app.lastReplay()) }, 'Share card'),
        m.opp ? h('button', { class: 'btn big', onclick: () => showPlayer(app, m.opp, { name: (m.names || [])[1 - m.side] || 'Coach' }) }, 'Opponent') : null));
  };
  const rep = app.lastReplay();
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Match History'), h('div')),
    rep ? h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'chip', title: 'Watch your last match again in the Replay Theater', onclick: () => app.watchReplay(null, { back: () => showHistory(app, open) }) }, '▶ Watch last replay')) : null,
    !list.length ? emptyState('assets/img/emote/think.png', 'No matches yet', 'Every match you coach lands here with its picks, K/D/A and a share card.', { label: 'Play vs AI', onclick: () => app.startVsAI('classic') })
      : h('div', { class: 'hist' }, ...list.map((m, i) => h('div', { class: 'hentry' + (m.won ? ' win' : ' loss') + (i === open ? ' open' : '') },
        h('button', { class: 'hrow2', onclick: () => showHistory(app, i === open ? -1 : i) },
          h('b', { class: 'res' }, m.won ? 'WIN' : 'LOSS'),
          h('div', { class: 'hmeta' }, h('span', {}, `${MODE_LABEL[m.mode] || m.mode}${m.cup ? ' · ' + m.cup : ''} · ${(MAP_BY_ID[m.map] || {}).name || m.map}`), h('small', {}, `${ago(m.t)} · ${fmtTime(m.len)}${m.crystal === false ? ' · on towers' : ''}${m.rpDelta ? ` · ${m.rpDelta > 0 ? '+' : ''}${m.rpDelta} rating` : ''}`)),
          h('div', { class: 'hfaces' }, ...m.picks[m.side].map((id) => h('img', { src: face(id) }))),
          h('b', { class: 'hk' }, `${m.kills[m.side]}-${m.kills[1 - m.side]}`), lib.some((x) => x.id === m.t) ? h('i', { class: 'hrep', title: 'Analysis and replay saved on this device' }, '▶') : null),
        i === open ? detail(m) : null)))));
}
