// Front end: home, season pass, profile (banners/titles/borders), Season Cup bracket, patch notes, and post-match progression.
import { h, mount, face, emptyState } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { CLANS } from '../sim/constants.js';
import { daysLeft, TIERS, rankOf, TRACK, MAX_LEVEL, XP_PER_LEVEL, SKINS, BANNERS, TITLES, rewardName } from '../data/seasons.js';
import { PATCHES } from '../data/patchnotes.js';
import { profile } from '../profile.js';
import { myMatch, ROUND_NAMES } from '../cup.js';
import { heroSprite } from './heroui.js';
import { showDojo } from './dojo.js';
import { mapThumb, showHowTo } from './screens.js';
import { audio } from '../audio.js';
import { shareMatch } from './share.js';
import { showLeaderboard } from './online.js';
import { fmtTime } from './dom.js';
import { showSettings } from './settings.js';

const screen = () => document.getElementById('screen');
const item = (n) => `assets/img/${n}.png`;
const DIFF = ['Easy', 'Normal', 'Hard'];

export function rankBadge(rk, big) {
  return h('div', { class: 'rbadge' + (big ? ' big' : ''), style: { borderColor: rk.tier.color, color: rk.tier.color } }, h('img', { src: item(rk.tier.icon) }));
}
function bar(frac, color) { return h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color || 'var(--gold)' } })); }
function back(app) { return h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'); }

// ───────────── home ─────────────
// Label with a short form for the one-row nav on landscape phones (CSS picks one).
const lbl = (full, short) => [h('span', { class: 'lf' }, full), h('span', { class: 'ls' }, short)];
export function showHome(app) {
  const p = profile, s = p.season, ss = p.ss(), rk = p.rank;
  const nextTxt = rk.next ? `${ss.rp} RP · ${rk.next.min - ss.rp} to ${rk.next.name}` : `${ss.rp} RP · top tier`;
  const unseen = p.d.seenPatch !== PATCHES[0].version;
  const cup = p.d.cup && p.d.cup.season === s.id && !p.d.cup.done ? p.d.cup : null;
  const mm = cup ? myMatch(cup) : null;
  mount(screen(), h('div', { class: 'home' },
    h('div', { class: 'brand' }, h('div', { class: 'title' }, 'MOBA-VS'), h('div', { class: 'subtitle' }, 'Draft five heroes. Make the calls. Out-coach your rival.')),
    h('button', { class: 'sstrip', style: { '--sc': s.color }, onclick: () => showSeason(app) },
      h('div', { class: 'sname' }, h('small', {}, `SEASON ${s.id}`), h('b', {}, s.name)),
      h('div', { class: 'sinfo' }, h('span', {}, `${daysLeft(s)} days left`), h('span', { style: { color: CLANS[s.clan].color } }, `${CLANS[s.clan].name} bonus`), h('span', {}, `${MAP_BY_ID[s.map].name}`)),
      h('div', { class: 'slv' }, h('span', {}, `Pass Lv ${p.level}`), bar(p.levelProgress, s.color)), h('span', { class: 'chev' }, '›')),
    h('div', { class: 'coach', style: { background: p.banner.bg } },
      rankBadge(rk, true),
      h('div', { class: 'cinfo' },
        h('input', { class: 'cname', value: app.name, maxlength: 12, title: 'Tap to rename', oninput: (e) => app.setName(e.target.value) }),
        h('div', { class: 'ctitle' }, p.title),
        h('div', { class: 'crank', style: { color: rk.tier.color } }, rk.label),
        bar(rk.next ? rk.into / rk.span : 1, rk.tier.color), h('small', { class: 'muted' }, nextTxt)),
      h('div', { class: 'cstats' },
        h('div', {}, h('img', { src: item('items/GoldCup') }), ` ${p.d.trophies.gold}`), h('div', {}, h('img', { src: item('items/SilverCup') }), ` ${p.d.trophies.silver}`),
        h('div', { class: 'muted' }, `${ss.w}W ${ss.l}L`))),
    h('div', { class: 'modes' },
      h('div', { class: 'mode ranked' },
        h('div', { class: 'mh' }, h('b', {}, 'Ranked vs AI'), h('small', {}, 'Climb the ladder. Harder AI pays more RP.')),
        h('div', { class: 'seg3' }, ...DIFF.map((l, i) => h('button', { class: 'chip' + (app.aiLevel === i ? ' on' : ''), onclick: () => { app.aiLevel = i; showHome(app); } }, l))),
        h('div', { class: 'maprow' }, ...[['random', 'Random'], ...MAPS.map((m) => [m.id, m.name.split(' ')[0]])].map(([id, l]) =>
          h('button', { class: 'mapchip' + (app.mapPref === id ? ' on' : ''), title: id === 'random' ? `Random (${MAP_BY_ID[s.map].name} is featured)` : MAP_BY_ID[id].blurb, onclick: () => { app.mapPref = id; showHome(app); } },
            id === 'random' ? h('span', { class: 'q' }, '?') : mapThumb(id), h('span', {}, l)))),
        h('button', { class: 'btn big', onclick: () => app.startVsAI() }, 'Play')),
      h('div', { class: 'mode cupm' },
        h('div', { class: 'mh' }, h('b', {}, 'Season Cup'), h('small', {}, '8-team knockout. Win three in a row for the Golden Cup.')),
        h('div', { class: 'cupnow' }, h('img', { src: item('items/GoldCup') }),
          h('span', {}, mm ? `${ROUND_NAMES[mm.round]} vs ${mm.opp.name}` : 'A new bracket awaits')),
        h('button', { class: 'btn big', onclick: () => showCup(app) }, mm ? 'Continue' : 'Enter')),
      h('div', { class: 'mode online' },
        h('div', { class: 'mh' }, h('b', {}, 'Online'), h('small', {}, 'Ranked vs real players, or a private game with a friend.')),
        h('div', { class: 'col', style: { gap: '6px' } },
          h('button', { class: 'btn big', onclick: () => app.findMatch() }, 'Find Match'),
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
            h('button', { class: 'btn', style: { flex: 1 }, onclick: () => app.hostGame() }, 'Host'),
            h('button', { class: 'btn', style: { flex: 1 }, onclick: () => app.joinScreen() }, 'Join'))))),
    h('div', { class: 'hometiles' },
      h('button', { class: 'htile dojot', onclick: () => { audio.sfx('move', 0.5); showDojo(app, { tab: 'heroes', hero: null }); } },
        ((id) => heroSprite(id, p.d.equip.skins[id], 56, 'walk'))(p.activePreset && p.activePreset.main.mid || 'kaze'),
        h('div', { class: 'ht' }, h('b', {}, 'Dojo'), h('small', {}, 'Heroes, skins and lineups'),
          h('span', { class: 'hsub' }, p.activePreset ? `★ ${p.activePreset.name} auto-picks in the draft` : 'No active lineup'))),
      h('button', { class: 'htile proft', style: { background: p.banner.bg }, onclick: () => { audio.sfx('move', 0.5); showProfile(app); } },
        rankBadge(rk), h('div', { class: 'ht' }, h('b', {}, 'Profile'), h('small', {}, 'Banners, titles and borders'), h('span', { class: 'hsub' }, p.title)))),
    h('div', { class: 'subnav' },
      h('button', { class: 'chip', onclick: () => app.watch() }, lbl('Watch AI', 'Watch')),
      app.lastReplay() ? h('button', { class: 'chip', onclick: () => app.watchReplay() }, lbl('Last Replay', 'Replay')) : null,
      (document.fullscreenEnabled || document.webkitFullscreenEnabled) ? h('button', { class: 'chip', onclick: () => window.toggleFullscreen() }, lbl('Full Screen', 'Full')) : null,
      h('button', { class: 'chip', onclick: () => showLeaderboard(app) }, 'Ladder'),
      h('button', { class: 'chip', onclick: () => showHistory(app) }, 'History'),
      h('button', { class: 'chip', onclick: () => showSeason(app) }, lbl('Season Pass', 'Pass')),
      h('button', { class: 'chip' + (unseen ? ' new' : ''), onclick: () => showPatch(app) }, lbl('Patch Notes', 'Patch')),
      h('button', { class: 'chip', onclick: () => showHowTo(app) }, lbl('How to Play', 'Help')),
      h('button', { class: 'chip gear', title: 'Settings', onclick: () => { audio.sfx('move', 0.5); showSettings(app); } }, h('img', { src: 'assets/img/icons/Permutation.png', alt: '' }), lbl('Settings', ''))),
    p.newSeasonNote ? h('div', { class: 'panel note' }, `Season ${p.newSeasonNote.from} is over. You peaked at ${p.newSeasonNote.peak}. Your rank was soft-reset; your border is in your Profile.`) : null,
    h('div', { class: 'credits' }, `MOBA-VS v${PATCHES[0].version}`),
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
    h('div', { class: 'panel' }, h('b', {}, 'Ranked ladder'),
      h('div', { class: 'ladder' }, ...TIERS.map((t, i) => h('div', { class: 'lrow' + (rk.idx === i ? ' cur' : '') + (rk.idx > i ? ' past' : '') },
        rankBadge(rankOf(t.min)), h('span', { style: { color: t.color } }, t.name), h('small', { class: 'muted' }, `${t.min}+ RP`), rk.idx === i ? h('small', { class: 'you' }, `you · ${ss.rp} RP`) : null))),
      h('small', { class: 'muted' }, 'Win: Easy +8 · Normal +18 · Hard +26 · Online +24 · Cup +20. Easy AI caps at Samurai, Normal at Shogun. Peak rank earns a season border; ranks soft-reset each season.')),
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
export function showProfile(app, tab = 'banners') {
  const p = profile, un = p.d.unlocked;
  const tabs = h('div', { class: 'tabs' }, ...[['banners', 'Banners'], ['titles', 'Titles'], ['borders', 'Borders']].map(([k, l]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), onclick: () => showProfile(app, k) }, l)));
  let body;
  if (tab === 'banners') {
    body = h('div', { class: 'cardgrid' }, ...Object.entries(BANNERS).map(([k, b]) => {
      const have = un.banners.includes(k);
      return h('button', { class: 'bannercard' + (p.d.equip.banner === k ? ' on' : '') + (have ? '' : ' locked'), disabled: !have, style: { background: b.bg }, onclick: () => { p.equip('banner', k); showProfile(app, 'banners'); } },
        h('b', {}, b.name), h('small', {}, have ? (p.d.equip.banner === k ? 'Equipped' : 'Equip') : lockText('banner', k)));
    }));
  } else if (tab === 'titles') {
    body = h('div', { class: 'col' }, ...Object.entries(TITLES).map(([k, t]) => {
      const have = un.titles.includes(k);
      return h('button', { class: 'titlerow' + (p.d.equip.title === k ? ' on' : '') + (have ? '' : ' locked'), disabled: !have, onclick: () => { p.equip('title', k); showProfile(app, 'titles'); } },
        h('img', { src: item('items/Scroll') }), h('b', {}, t), h('small', {}, have ? (p.d.equip.title === k ? 'Equipped' : 'Equip') : lockText('title', k)));
    }));
  } else {
    body = p.d.borders.length ? h('div', { class: 'cardgrid' }, ...p.d.borders.map((b) => { const t = TIERS.find((x) => x.id === b.tier); return h('div', { class: 'bannercard', style: { borderColor: t.color } }, h('img', { src: item(t.icon) }), h('b', { style: { color: t.color } }, t.name), h('small', {}, `Season ${b.season}`)); }))
      : emptyState('assets/img/items/SilverCup.png', 'No borders yet', 'Reach Samurai or higher this season to earn a border when it ends.');
  }
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Profile'), h('div')), tabs, body,
    h('small', { class: 'muted center' }, 'Hero skins are equipped on each hero\'s page in the Dojo.')));
}
function lockText(kind, id) {
  const l = Object.entries(TRACK).find(([, r]) => (r.kind === kind && r.id === id) || (r.also && r.also.kind === kind && r.also.id === id));
  if (l) return `Pass Lv ${l[0]}`;
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
        h('p', { class: 'muted' }, 'Champion: Golden Cup trophy, the "Cup Champion" title and the Golden Cup banner. Finalist: Silver Cup. Every Cup match also earns +50 pass XP and RP.'),
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
export function showPatch(app) {
  profile.d.seenPatch = PATCHES[0].version; profile.save();
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Patch Notes'), h('div')),
    ...PATCHES.map((pt) => h('div', { class: 'panel patch' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { class: 'gold' }, `v${pt.version} · ${pt.title}`), h('small', { class: 'muted' }, pt.date)),
      h('ul', {}, ...pt.notes.map((n) => h('li', {}, n))),
      pt.heroes.length ? h('div', { class: 'hchanges' }, ...pt.heroes.map((c) => h('div', { class: 'hc' }, h('img', { src: face(c.id) }), h('b', { class: c.dir > 0 ? 'up' : 'down' }, c.dir > 0 ? '▲' : '▼'), h('span', {}, h('b', {}, HERO_BY_ID[c.id] ? HERO_BY_ID[c.id].name : c.id), ' ', c.text)))) : null))));
}

// ───────────── post-match progression (inside results) ─────────────
export function progressPanel(sum, cupOut) {
  if (!sum) return null;
  const rk = sum.rankAfter;
  return h('div', { class: 'panel prog' },
    h('div', { class: 'prow' }, rankBadge(rk),
      h('div', { class: 'col', style: { gap: '3px', flex: 1 } },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { style: { color: rk.tier.color } }, rk.label), h('b', { class: sum.delta >= 0 ? 'up' : 'down' }, `${sum.delta >= 0 ? '+' : ''}${sum.delta} RP`)),
        bar(rk.next ? rk.into / rk.span : 1, rk.tier.color),
        sum.promoted ? h('small', { class: 'gold' }, `Promoted to ${rk.label}!`) : sum.capped ? h('small', { class: 'muted' }, 'Try a harder AI to climb further.') : null)),
    h('div', { class: 'prow' }, h('div', { class: 'lvb' }, `Lv ${sum.lvAfter}`),
      h('div', { class: 'col', style: { gap: '3px', flex: 1 } }, h('div', { class: 'xps' }, ...sum.xpParts.map(([l, v]) => h('span', {}, `${l} +${v}`))), bar(profile.levelProgress, profile.season.color))),
    sum.lvAfter > sum.lvBefore ? h('div', { class: 'gold center' }, `Season Pass level ${sum.lvAfter}!`) : null,
    [...sum.unlocks, ...((cupOut && cupOut.rewards) || [])].length ? h('div', { class: 'unlocks' }, ...[...sum.unlocks, ...((cupOut && cupOut.rewards) || [])].map((r) => h('div', { class: 'unlock' },
      r.kind === 'trophy' ? h('img', { src: item(r.id === 'gold' ? 'items/GoldCup' : 'items/SilverCup') }) : rewardIcon(r), h('span', {}, r.kind === 'trophy' ? (r.id === 'gold' ? 'Golden Cup!' : 'Silver Cup') : rewardName(r)), h('small', {}, 'Unlocked')))) : null,
    cupOut ? h('div', { class: 'center muted' }, cupOut.won ? (cupOut.round === 2 ? 'Season Cup champion!' : `You advance past the ${ROUND_NAMES[cupOut.round]}.`) : `Eliminated in the ${ROUND_NAMES[cupOut.round]}.`) : null);
}

// ───────────── match history ─────────────
const MODE_L = { ai0: 'Easy AI', ai1: 'Normal AI', ai2: 'Hard AI', online: 'Online', cup: 'Cup' };
export function showHistory(app, open = 0) {
  const list = profile.d.history;
  const coach = { name: app.name, rank: profile.rank.label };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const detail = (m) => {
    const side = (t) => h('div', { class: 'hd-team ' + (t ? 'red' : 'blue') }, h('b', {}, `${(m.names || ['Blue', 'Red'])[t] || ''}${t === m.side ? ' (you)' : ''} · ${m.kills[t]} kills · ${m.towers[t]} towers`),
      ...m.picks[t].map((id, i) => { const k = (m.kda && m.kda[t] && m.kda[t][i]) || []; const mvp = m.mvp && m.mvp.id === id && m.mvp.team === t;
        return h('div', { class: 'hd-row' + (mvp ? ' hmvp' : '') }, h('img', { src: face(id) }), h('span', {}, HERO_BY_ID[id] ? HERO_BY_ID[id].name : id), h('span', { class: 'k' }, k.length ? `${k[0]}/${k[1]}/${k[2]}` : ''), h('small', {}, k.length ? `${k[3]} CS · ${(k[5] / 1000).toFixed(1)}k` : ''), mvp ? h('b', { class: 'mvpt' }, 'MVP') : null); }));
    return h('div', { class: 'hd' }, h('div', { class: 'hd-teams' }, side(0), side(1)),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn big', onclick: () => shareMatch(m, coach, app.lastReplay()) }, 'Share card')));
  };
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Match History'), h('div')),
    !list.length ? emptyState('assets/img/emote/think.png', 'No matches yet', 'Every match you coach lands here with its picks, K/D/A and a share card.', { label: 'Play vs AI', onclick: () => app.startVsAI() })
      : h('div', { class: 'hist' }, ...list.map((m, i) => h('div', { class: 'hentry' + (m.won ? ' win' : ' loss') + (i === open ? ' open' : '') },
        h('button', { class: 'hrow2', onclick: () => showHistory(app, i === open ? -1 : i) },
          h('b', { class: 'res' }, m.won ? 'WIN' : 'LOSS'),
          h('div', { class: 'hmeta' }, h('span', {}, `${MODE_L[m.mode] || m.mode}${m.cup ? ' · ' + m.cup : ''} · ${(MAP_BY_ID[m.map] || {}).name || m.map}`), h('small', {}, `${ago(m.t)} · ${fmtTime(m.len)}${m.crystal === false ? ' · on towers' : ''}${m.rpDelta ? ` · ${m.rpDelta > 0 ? '+' : ''}${m.rpDelta} RP` : ''}`)),
          h('div', { class: 'hfaces' }, ...m.picks[m.side].map((id) => h('img', { src: face(id) }))),
          h('b', { class: 'hk' }, `${m.kills[m.side]}-${m.kills[1 - m.side]}`)),
        i === open ? detail(m) : null)))));
}
