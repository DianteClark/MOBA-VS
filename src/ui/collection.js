// Cosmetics UI: the Dojo skin viewer, Profile → Collection (skins, emotes, banners, borders, titles, all with
// how to earn the locked ones), Profile → Achievements, unlock toasts, and the results emotes.
import { h, mount, toast } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { SKINS, BANNERS, TITLES, passSource, rewardName } from '../data/seasons.js';
import { metaSource } from './coach.js';
import { SEASON_REWARDS, tierById, rankOf, TIERS } from '../data/ranks.js';
import { THEMES, ACC_NAMES, sigKey, legKey, SIG_MASTERY } from '../data/skins.js';
import { EMOTES, EMOTE_IDS, BORDERS, emoteSrc, borderStyle } from '../data/cosmetics.js';
import { ACH, ACH_BY_ID } from '../data/achievements.js';
import { PETS, PET_IDS, FAMILIES, FAMILY_IDS, hasPet, hasFamily, petFace, monSrc, unlockText } from '../data/beasts.js';
import { profile, titleName } from '../profile.js';
import { skinSheet, skinFace, loadSkinBodies, loadFace } from '../render/skins.js';
import { heroStill } from './heroui.js';
import { tierBadge } from './badges.js';
import { masteryColor, MASTERY_AT } from '../mastery.js';
import { settings } from './settings.js';
import { audio } from '../audio.js';

const tap = () => audio.sfx('move', 0.4);
const reduced = () => !!settings.reducedMotion;
const pbar = (frac, color) => h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color || 'var(--gold)' } }));
const achIcon = (a) => `assets/img/${a.icon}.png`;

// ───────────── how to earn ─────────────
// Plain-language source of any reward: pass level, season rank, achievement, hero mastery, or free.
function howToEarn(kind, id) {
  const same = (r) => r && ((r.kind === kind && r.id === id) || (r.also && r.also.kind === kind && r.also.id === id));
  const a = ACH.find((x) => same(x.reward));
  if (a) return `Achievement: ${a.name}`;
  const l = passSource(same);
  if (l) return l;
  const mt = metaSource(same);
  if (mt) return mt;
  const rk = Object.entries(SEASON_REWARDS).find(([, list]) => list.some(same));
  if (rk) return `Season end at ${tierById(rk[0]).name}`;
  if (kind === 'skin' && SKINS[id] && SKINS[id].mastery) return `${SKINS[id].hero ? HERO_BY_ID[SKINS[id].hero].name : 'Hero'} Mastery ${SKINS[id].mastery}`;
  if (kind === 'border' && BORDERS[id] && BORDERS[id].tier) return `Finish a season at ${BORDERS[id].name}`;
  if (kind === 'title' && /^m:/.test(id)) return 'Hero mastery';
  if (id === 'gold' || id === 'champ') return 'Win the Season Cup';
  if (id === 'tripleChamp') return 'Win 3 Season Cups';
  return 'Locked';
}
// Bosses & Beasts unlocks (derived from the profile)
const beastHow = (u) => unlockText(u, (id) => (ACH_BY_ID[id] ? ACH_BY_ID[id].name : id));
const shortBeast = (u) => beastHow(u).replace('Season Pass level ', 'Pass Lv ').replace('Achievement: ', '★ ');
const shortHow = (kind, id) => howToEarn(kind, id).replace(/Season (\d+) Pass level /, 'S$1 Pass Lv ').replace('Achievement: ', '★ ').replace('Season end at ', 'Rank: ').replace('Finish a season at ', 'Season: ');

// Skins that fit a hero, unique ones first: base, Signature, Legendary, then the account-wide tints.
export function heroSkinKeys(id) {
  return ['base', ...[sigKey(id), legKey(id)].filter((k) => SKINS[k]), ...Object.keys(SKINS).filter((k) => k !== 'base' && !SKINS[k].hero)];
}
const tierLabel = (sk) => (sk.hero ? (sk.tier === 'legendary' ? 'Legendary' : 'Signature') : sk.mastery ? 'Mastery tint' : 'Palette');

// ───────────── skin viewer (Dojo) ─────────────
// A modal stage: animated idle / walk / attack, four facings, the portrait, every skin that fits the hero,
// how to earn the locked ones, and Equip. Backdrop motes are off with Reduced effects.
export function skinViewer(id, onChange, start) {
  const x = HERO_BY_ID[id], keys = heroSkinKeys(id);
  let cur = start && keys.includes(start) ? start : profile.d.equip.skins[id] || 'base', anim = 'walk', facing = 0, t0 = performance.now(), raf = 0;
  const stage = h('canvas', { class: 'svstage', width: 96, height: 96, 'aria-label': `${x.name} preview` });
  const ctx = stage.getContext('2d');
  const motes = Array.from({ length: 14 }, (_, i) => ({ x: (i * 37) % 96, y: (i * 53) % 96, v: 6 + (i % 5) * 3, s: 1 + (i % 3 === 0) }));
  const portrait = h('div', { class: 'svface' });
  const info = h('div', { class: 'svinfo' });
  const strip = h('div', { class: 'svstrip' });
  const close = () => { cancelAnimationFrame(raf); m.remove(); onChange && onChange(); };
  const m = h('div', { class: 'modal svmodal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel svpanel', role: 'dialog', 'aria-label': `${x.name} skins` },
      h('div', { class: 'mhead' }, h('b', {}, `${x.name} · Skins`), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, 'X')),
      h('div', { class: 'svbody' },
        h('div', { class: 'svleft' },
          h('div', { class: 'svstagewrap' }, h('button', { class: 'navb', 'aria-label': 'Turn left', onclick: () => { facing = [2, 0, 3, 1][facing]; tap(); } }, '‹'), stage,
            h('button', { class: 'navb', 'aria-label': 'Turn right', onclick: () => { facing = [3, 2, 0, 1][facing]; tap(); } }, '›')),
          h('div', { class: 'animbtns' }, ...[['idle', 'Idle'], ['walk', 'Walk'], ['attack', 'Attack']].map(([k, l]) => h('button', { class: 'chip' + (k === anim ? ' on' : ''),
            onclick: (e) => { anim = k; t0 = performance.now(); for (const b of e.target.parentNode.children) b.classList.toggle('on', b === e.target); } }, l)))),
        h('div', { class: 'svright' }, info, strip))));
  const theme = () => { const sk = SKINS[cur]; return sk && sk.theme ? THEMES[sk.theme] : null; };
  const draw = (now) => {
    if (!m.isConnected) return;
    const sk = SKINS[cur], T = theme(), img = skinSheet(id, cur);
    const bg = ctx.createRadialGradient(48, 60, 4, 48, 52, 64);
    bg.addColorStop(0, T ? T.ramp[2] + '66' : sk && sk.tier === 'legendary' ? '#ffd84a44' : '#ffffff22'); bg.addColorStop(1, T ? T.ramp[0] : '#120e18');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 96, 96);
    if (!reduced()) {
      ctx.fillStyle = sk && sk.accent ? sk.accent : '#ffe3a3';
      for (const p of motes) { const y = (p.y - (now / 1000) * p.v) % 96; ctx.globalAlpha = 0.35 + 0.3 * Math.sin(now / 400 + p.x); ctx.fillRect(p.x, y < 0 ? y + 96 : y, p.s, p.s); }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(48, 82, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (img) {
      ctx.imageSmoothingEnabled = false;
      const el = now - t0, f = Math.floor(el / (anim === 'attack' ? 160 : 150));
      const row = anim === 'walk' ? f % 4 : anim === 'attack' ? (f % 3 ? 4 : 0) : f % 8 < 6 ? 0 : 1;
      const bob = anim === 'idle' && !reduced() ? Math.round(Math.sin(el / 500)) : 0;
      ctx.drawImage(img, facing * 16, row * 16, 16, 16, 16, 18 + bob, 64, 64);
    }
    raf = requestAnimationFrame(draw);
  };
  const render = () => {
    const sk = SKINS[cur], have = profile.hasSkin(id, cur), on = (profile.d.equip.skins[id] || 'base') === cur;
    const fc = skinFace(id, cur);
    mount(portrait, fc ? (() => { const c = h('canvas', { width: 38, height: 38 }); c.getContext('2d').drawImage(fc, 0, 0); return c; })() : h('img', { src: `assets/img/faces/${id}.png`, alt: '' }));
    const T = theme(), mi = profile.mastery(id);
    const prog = sk.mastery && !have ? h('div', { class: 'svprog' }, pbar(mi.pts / MASTERY_AT[sk.mastery], masteryColor(sk.mastery)), h('small', { class: 'muted' }, `Mastery ${mi.lv} / ${sk.mastery}`)) : null;
    const ach = ACH.find((a) => a.reward.kind === 'skin' && a.reward.id === cur);
    mount(info,
      h('div', { class: 'svtitle' }, portrait, h('div', { class: 'col', style: { gap: '2px' } },
        h('b', { class: 'svname' }, cur === 'base' ? `Classic ${x.name}` : sk.name),
        h('small', { class: 'svtier t-' + (sk.hero ? sk.tier : 'palette') }, cur === 'base' ? 'Original look' : tierLabel(sk) + (T ? ` · ${T.name} theme` : '') + (sk.acc ? ` · ${ACC_NAMES[sk.acc]}` : '')))),
      h('small', { class: 'muted svhow' }, cur === 'base' ? 'Always yours.' : have ? (on ? 'Equipped: your heroes wear it in every match, and online opponents see it.' : 'Owned. Equip it to wear it in matches.') : `Unlock: ${howToEarn('skin', cur)}${ach ? ` (${ach.desc})` : ''}`),
      prog,
      h('div', { class: 'row svact' },
        have ? h('button', { class: 'btn' + (on ? ' on' : ''), disabled: on, onclick: () => { profile.equipSkin(id, cur); audio.sfx('accept', 0.5); toast(`${x.name}: ${cur === 'base' ? 'Classic' : sk.name} equipped`, 1400); render(); } }, on ? 'Equipped' : 'Equip')
          : h('span', { class: 'svlock' }, 'Locked')));
    mount(strip, ...keys.map((k) => {
      const s2 = SKINS[k], own = profile.hasSkin(id, k);
      return h('button', { class: 'svthumb' + (k === cur ? ' on' : '') + (own ? '' : ' locked') + (s2.hero ? ' t-' + s2.tier : ''), title: k === 'base' ? 'Classic' : s2.name, 'aria-pressed': String(k === cur),
        onclick: () => { cur = k; tap(); render(); } }, heroStill(id, k, 32), (profile.d.equip.skins[id] || 'base') === k ? h('i', { class: 'svdot' }) : null);
    }));
  };
  document.body.append(m);
  render();
  raf = requestAnimationFrame(draw);
  // Legendary bodies and portraits may still be loading on a fresh visit
  Promise.all([loadSkinBodies(), loadFace(id)]).then(() => { if (m.isConnected) render(); });
  return close;
}

// ───────────── Profile → Collection ─────────────
const SECTIONS = [['skins', 'Skins'], ['emotes', 'Emotes'], ['banners', 'Banners'], ['borders', 'Borders'], ['titles', 'Titles'], ['pets', 'Scouts'], ['troops', 'Minions']];
export function collectionTab(app, section, go) {
  const p = profile, un = p.d.unlocked, wev = app && app.weekEvent && app.weekEvent() ? app.weekEvent().id : null; // (the week's featured minion family)
  section = SECTIONS.some(([k]) => k === section) ? section : 'skins';
  const heroSkins = Object.entries(SKINS).filter(([, s]) => s.hero);
  const count = {
    skins: [heroSkins.filter(([k, s]) => p.hasSkin(s.hero, k)).length, heroSkins.length],
    emotes: [EMOTE_IDS.filter((k) => p.hasEmote(k)).length, EMOTE_IDS.length],
    banners: [Object.keys(BANNERS).filter((k) => un.banners.includes(k)).length, Object.keys(BANNERS).length],
    borders: [Object.keys(BORDERS).filter((k) => p.hasBorder(k)).length, Object.keys(BORDERS).length],
    titles: [un.titles.filter((k) => TITLES[k]).length, Object.keys(TITLES).length],
    pets: [PET_IDS.filter((k) => hasPet(p, k)).length, PET_IDS.length],
    troops: [FAMILY_IDS.filter((k) => hasFamily(p, k, wev)).length, FAMILY_IDS.length],
  };
  const chips = h('div', { class: 'colchips' }, ...SECTIONS.map(([k, l]) => h('button', { class: 'chip' + (section === k ? ' on' : ''), onclick: () => { tap(); go(k); } }, l, h('small', {}, ` ${count[k][0]}/${count[k][1]}`))));
  let body;
  if (section === 'skins') {
    let filter = 'all';
    const grid = h('div', { class: 'colskins' });
    const draw = () => mount(grid, ...heroSkins.filter(([k, s]) => filter === 'all' || (filter === 'owned') === p.hasSkin(s.hero, k))
      .sort((a, b) => (p.hasSkin(b[1].hero, b[0]) - p.hasSkin(a[1].hero, a[0])) || (a[1].tier === b[1].tier ? 0 : a[1].tier === 'legendary' ? -1 : 1))
      .map(([k, s]) => {
        const own = p.hasSkin(s.hero, k), on = p.d.equip.skins[s.hero] === k;
        return h('button', { class: 'colskin t-' + s.tier + (own ? '' : ' locked') + (on ? ' on' : ''), title: `${s.name}: ${own ? 'owned' : howToEarn('skin', k)}`, onclick: () => { tap(); skinViewer(s.hero, () => go('skins'), k); } },
          heroStill(s.hero, k, 40), h('b', {}, s.name), h('small', {}, on ? 'Equipped' : own ? tierLabel(s) : shortHow('skin', k)));
      }));
    const fchips = h('div', { class: 'colfilter' }, ...[['all', 'All'], ['owned', 'Owned'], ['locked', 'Locked']].map(([k, l]) => h('button', { class: 'chip' + (k === filter ? ' on' : ''),
      onclick: (e) => { filter = k; for (const b of e.target.parentNode.children) b.classList.toggle('on', b === e.target); draw(); } }, l)));
    draw();
    loadSkinBodies().then(() => { if (grid.isConnected) draw(); });
    body = h('div', { class: 'col' }, h('small', { class: 'muted center colnote' }, `Every hero has a Signature skin (Mastery ${SIG_MASTERY}); ${heroSkins.filter(([, s]) => s.tier === 'legendary').length} have a Legendary skin from achievements, the pass or season rank. Tap one to preview and equip.`), fchips, grid);
  } else if (section === 'emotes') {
    body = h('div', { class: 'col' }, h('small', { class: 'muted center colnote' }, 'Owned emotes are in your online quick chat. Your signature emote shows on your results and share cards.'),
      h('div', { class: 'colemotes' }, ...EMOTE_IDS.map((k) => {
        const own = p.hasEmote(k), on = p.emote === k;
        return h('button', { class: 'colemote' + (own ? '' : ' locked') + (on ? ' on' : ''), title: own ? EMOTES[k].name : howToEarn('emote', k),
          onclick: () => { if (!own) { toast(`${EMOTES[k].name}: ${howToEarn('emote', k)}`); return; } p.equip('emote', k); audio.sfx('accept', 0.5); go('emotes'); } },
          h('img', { src: emoteSrc(k), alt: '' }), h('b', {}, EMOTES[k].name), h('small', {}, on ? 'Signature' : own ? 'Set signature' : shortHow('emote', k)));
      })));
  } else if (section === 'banners') {
    body = h('div', { class: 'cardgrid' }, ...Object.entries(BANNERS).map(([k, b]) => {
      const have = un.banners.includes(k);
      return h('button', { class: 'bannercard' + (p.d.equip.banner === k ? ' on' : '') + (have ? '' : ' locked'), title: have ? b.name : howToEarn('banner', k), style: { background: b.bg },
        onclick: () => { if (!have) { toast(`${b.name}: ${howToEarn('banner', k)}`); return; } p.equip('banner', k); go('banners'); } },
        h('b', {}, b.name), h('small', {}, have ? (p.d.equip.banner === k ? 'Equipped' : 'Equip') : shortHow('banner', k)));
    }));
  } else if (section === 'borders') {
    const cur = p.border;
    body = h('div', { class: 'col' }, h('small', { class: 'muted center colnote' }, 'Borders frame your coach card on the home screen and your share cards.'),
      h('div', { class: 'cardgrid' },
        h('button', { class: 'bannercard bordercard' + (!cur ? ' on' : ''), onclick: () => { p.equip('border', null); go('borders'); } }, h('b', {}, 'None'), h('small', {}, !cur ? 'Equipped' : 'Equip')),
        ...Object.entries(BORDERS).map(([k, b]) => {
          const have = p.hasBorder(k), seasons = b.tier ? p.d.borders.filter((x) => x.tier === k).map((x) => x.season) : [];
          return h('button', { class: 'bannercard bordercard cbd' + (cur === k ? ' on' : '') + (have ? '' : ' locked') + (b.shine ? ' shine' : ''), style: borderStyle(k), title: have ? b.name : howToEarn('border', k),
            onclick: () => { if (!have) { toast(`${b.name}: ${howToEarn('border', k)}`); return; } p.equip('border', k); audio.sfx('accept', 0.5); go('borders'); } },
            b.tier ? tierBadge(rankOf(Math.max(850, TIERS.find((t) => t.id === k).min)), 30) : null,
            h('b', { style: { color: b.c1 } }, b.name), h('small', {}, have ? (cur === k ? 'Equipped' : seasons.length ? `Season ${seasons.join(', ')}` : 'Equip') : shortHow('border', k)));
        })));
  } else if (section === 'pets') {
    // Bosses & Beasts: the scout animal (looks only: every one runs, watches and dies the same)
    const cur = hasPet(p, p.d.equip.pet) ? p.d.equip.pet : 'dog';
    body = h('div', { class: 'col' }, h('small', { class: 'muted center colnote' }, 'Your scout pet: in a 5v5 match, tap the map to send it from 3:00. Every animal has the same stats; online opponents see yours.'),
      h('div', { class: 'colemotes' }, ...PET_IDS.map((k) => {
        const own = hasPet(p, k), on = cur === k;
        return h('button', { class: 'colemote colpet' + (own ? '' : ' locked') + (on ? ' on' : ''), title: own ? PETS[k].name : beastHow(PETS[k].unlock),
          onclick: () => { if (!own) { toast(`${PETS[k].name}: ${beastHow(PETS[k].unlock)}`); return; } p.equip('pet', k); audio.sfx('accept', 0.5); go('pets'); } },
          h('img', { src: petFace(k), alt: '' }), h('b', {}, PETS[k].name), h('small', {}, on ? 'Equipped' : own ? 'Equip' : shortBeast(PETS[k].unlock)));
      })));
  } else if (section === 'troops') {
    // Bosses & Beasts: minion families (looks only); "Map's own" wears each map's family
    const cur = p.d.equip.troop && hasFamily(p, p.d.equip.troop, wev) ? p.d.equip.troop : null;
    const strip = (f) => h('span', { class: 'famstrip' }, ...(f.set ? ['melee', 'caster', 'siege', 'super'].map((r) => h('i', { style: { backgroundImage: `url(${monSrc(f.set[r])})` } }))
      : ['minion_blue_melee', 'minion_blue_caster', 'minion_blue_siege'].map((k) => h('i', { style: { backgroundImage: `url(assets/img/units/${k}.png)` } }))));
    body = h('div', { class: 'col' }, h('small', { class: 'muted center colnote' }, 'Your minion family in 5v5 matches. Rings under them show their team. Online opponents see yours; each weekly event features one family anyone may wear.'),
      h('div', { class: 'cardgrid' },
        h('button', { class: 'bannercard famcard' + (!cur ? ' on' : ''), onclick: () => { p.equip('troop', null); go('troops'); } }, h('b', {}, "Map's own"), h('small', {}, !cur ? 'Equipped' : 'Each map has its family')),
        ...FAMILY_IDS.map((k) => {
          const f = FAMILIES[k], own = hasFamily(p, k, wev), on = cur === k;
          return h('button', { class: 'bannercard famcard' + (own ? '' : ' locked') + (on ? ' on' : ''), title: own ? f.name : beastHow(f.unlock),
            onclick: () => { if (!own) { toast(`${f.name}: ${beastHow(f.unlock)}`); return; } p.equip('troop', k); audio.sfx('accept', 0.5); go('troops'); } },
            strip(f), h('b', {}, f.name), h('small', {}, on ? 'Equipped' : own ? f.blurb : shortBeast(f.unlock)));
        })));
  } else {
    const keys = [...Object.keys(TITLES), ...un.titles.filter((k) => !TITLES[k])];
    body = h('div', { class: 'col' }, ...keys.map((k) => {
      const have = un.titles.includes(k);
      return h('button', { class: 'titlerow' + (p.d.equip.title === k ? ' on' : '') + (have ? '' : ' locked'), disabled: !have, onclick: () => { p.equip('title', k); go('titles'); } },
        h('img', { src: 'assets/img/items/Scroll.png' }), h('b', {}, titleName(k)), h('small', {}, have ? (p.d.equip.title === k ? 'Equipped' : 'Equip') : shortHow('title', k)));
    }));
  }
  return h('div', { class: 'col collection' }, chips, body);
}

// ───────────── Profile → Achievements ─────────────
function rewardChip(r) {
  const list = [r, ...(r.also ? [r.also] : [])];
  return h('span', { class: 'achrw' }, ...list.map((x) => h('span', { class: 'achrwi', title: rewardName(x) }, rewardIcon(x), h('small', {}, rewardName(x).replace(/ \((Legendary|Signature) skin\)/, ' skin')))));
}
export function rewardIcon(r) {
  if (r.kind === 'emote') return h('img', { class: 'rwemote', src: emoteSrc(r.id), alt: '' });
  if (r.kind === 'skin' && SKINS[r.id] && SKINS[r.id].hero) return heroStill(SKINS[r.id].hero, r.id, 22);
  if (r.kind === 'skin') return h('i', { class: 'sw', style: { background: SKINS[r.id].swatch } });
  if (r.kind === 'banner') return h('i', { class: 'bn', style: { background: BANNERS[r.id].bg } });
  if (r.kind === 'border') return h('i', { class: 'bdr cbd', style: borderStyle(r.id) });
  return h('i', { class: 'tt' }, 'T');
}
// Bosses & Beasts: a scout pet or minion family that an achievement also unlocks
function beastRewards(id) {
  const pets = PET_IDS.filter((k) => PETS[k].unlock && PETS[k].unlock.ach === id).map((k) => h('span', { class: 'achrwi', title: `${PETS[k].name} scout pet` }, h('img', { class: 'rwemote', src: petFace(k), alt: '' }), h('small', {}, `${PETS[k].name} scout`)));
  const fams = FAMILY_IDS.filter((k) => FAMILIES[k].unlock && FAMILIES[k].unlock.ach === id).map((k) => h('span', { class: 'achrwi', title: `${FAMILIES[k].name} minions` }, h('small', {}, `${FAMILIES[k].name} minions`)));
  return pets.length || fams.length ? [h('span', { class: 'achrw' }, ...pets, ...fams)] : [];
}
export function achievementsTab() {
  const p = profile, got = ACH.filter((a) => p.hasAch(a.id)).length;
  const card = (a) => {
    const have = p.hasAch(a.id), pr = !have && a.prog ? a.prog(p.d, p) : null, hint = !have && a.hint ? a.hint(p.d) : '';
    const when = have ? new Date(p.d.ach.got[a.id]).toLocaleDateString() : '';
    return h('div', { class: 'achcard' + (have ? ' got' : '') },
      h('img', { class: 'achi', src: achIcon(a), alt: '' }),
      h('div', { class: 'achtx' }, h('b', {}, a.name), h('small', {}, a.desc), hint ? h('small', { class: 'muted' }, hint) : null,
        pr ? h('div', { class: 'achprog' }, pbar(pr[0] / pr[1]), h('small', {}, `${Math.min(pr[0], pr[1])}/${pr[1]}`)) : null),
      h('div', { class: 'achside' }, rewardChip(a.reward), ...beastRewards(a.id), h('small', { class: have ? 'gold' : 'muted' }, have ? `✓ ${when}` : 'Locked')));
  };
  const sorted = ACH.slice().sort((a, b) => p.hasAch(a.id) - p.hasAch(b.id));
  return h('div', { class: 'col achtab' },
    h('div', { class: 'achhead' }, h('b', {}, `${got} / ${ACH.length} achievements`), pbar(got / ACH.length)),
    h('div', { class: 'achgrid' }, ...sorted.map(card)));
}

// ───────────── unlock toasts ─────────────
// One small card at a time above the bottom buttons: icon, name, reward; taps go through it to the screen below.
// Reduced effects: no slide or shine, just appears.
let queue = [], busy = false;
export function achToasts(list, delay = 0) {
  queue.push(...list.map((x) => ACH_BY_ID[x.id]).filter(Boolean));
  if (!busy) { busy = true; setTimeout(nextToast, delay); }
}
function nextToast() {
  const a = queue.shift();
  if (!a) { busy = false; return; }
  const el = h('div', { class: 'achtoast' + (reduced() ? ' still' : ''), role: 'status', 'aria-live': 'polite' }, // taps pass through (css)
    h('img', { class: 'achi', src: achIcon(a), alt: '' }),
    h('div', { class: 'col' }, h('small', { class: 'kick' }, 'ACHIEVEMENT UNLOCKED'), h('b', {}, a.name), h('span', { class: 'achrwline' }, rewardIcon(a.reward), h('small', {}, rewardName(a.reward)))));
  document.body.append(el);
  audio.sfx('powerup', 0.45);
  let gone = false;
  const done = () => { if (gone) return; gone = true; el.classList.add('out'); setTimeout(() => { el.remove(); nextToast(); }, reduced() ? 0 : 260); };
  setTimeout(done, 3200);
}

// ───────────── results emotes ─────────────
// Your signature emote by the verdict; an online opponent's by their team name.
export function resultEmotes(s) {
  const out = [null, null];
  if (!s || s.myTeam < 0) return out;
  const img = (id, mine) => (id && EMOTES[id] ? h('img', { class: 'remote' + (mine ? ' mine' : ''), src: emoteSrc(id), alt: EMOTES[id].name, title: EMOTES[id].name }) : null);
  out[s.myTeam] = img(profile.emote, true);
  if (s.oppLooks) out[1 - s.myTeam] = img(s.oppLooks.emote, false);
  return out;
}
