// Pre/post-match screens: menu, lobby, how-to, draft, prep, results.
import { h, mount, face, icon, fmtTime } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, matchupScore, PERSONALITIES } from '../data/heroes.js';
import { TACTICS, TACTIC_IDS } from '../data/tactics.js';
import { PLAN_IDS, PLAN_INFO, planLine, EDGE_TEXT } from '../data/plans.js';
import { BUILDS } from '../data/items.js';
import { aiPrep, recommendPlan } from '../sim/draft.js';
import { TEAM_NAME, DRAGON_INFO, CLANS } from '../sim/constants.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { World, N as GN } from '../sim/world.js';
import { THEMES } from '../render/mapgen.js';
import { IMG } from '../render/assets.js';
import { ladderPanel } from './online.js';
import { TEAM_COL } from '../render/palette.js';
import { audio } from '../audio.js';
import { tweenNumber, growBars } from './juice.js';
import { analysisCard } from './analytics.js';
import { myHeroIds, isLead, mateOf, COOP_COL } from '../coop-room.js';

// Tiny map previews from the terrain grid (cheap: 100x100 pixels).
const thumbs = {};
export function mapThumb(id) {
  if (thumbs[id]) return thumbs[id];
  const def = MAP_BY_ID[id], w = new World(def), th = THEMES[def.theme];
  const c = document.createElement('canvas'); c.width = GN; c.height = GN;
  const x = c.getContext('2d'), img = x.createImageData(GN, GN);
  const col = (t) => [th.forestFloor[0], th.ground[1], th.lane[0], th.water[1], th.base[0][0], th.pit[1], th.shrine[0], th.path[0]][t];
  for (let i = 0; i < GN * GN; i++) { const c3 = w.walk[i] ? col(w.type[i]) : th.forestFloor[0].map((v) => v * 0.7); img.data.set([c3[0], c3[1], c3[2], 255], i * 4); }
  x.putImageData(img, 0, 0);
  for (const st of w.structures) { x.fillStyle = TEAM_COL[st.team]; x.fillRect(Math.floor(st.x / 24) - 1, Math.floor(st.y / 24) - 1, 3, 3); }
  thumbs[id] = c; return c;
}
// Heroes strolling along the bottom of the menu.
let paradeRAF = 0;
function parade(el) {
  cancelAnimationFrame(paradeRAF);
  const c = document.createElement('canvas'); el.append(c);
  const ctx = c.getContext('2d');
  const ids = HEROES.map((x) => x.id).sort(() => Math.random() - 0.5).slice(0, 7);
  const walkers = ids.map((id, i) => ({ id, x: -60 - i * 150, sp: 34 + Math.random() * 18 }));
  let last = performance.now();
  const loop = (now) => {
    if (!c.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const r = c.getBoundingClientRect(); if (c.width !== Math.round(r.width)) { c.width = Math.round(r.width); c.height = Math.round(r.height); }
    ctx.clearRect(0, 0, c.width, c.height); ctx.imageSmoothingEnabled = false;
    for (const w of walkers) {
      w.x += w.sp * dt; if (w.x > c.width + 40) w.x = -60 - Math.random() * 200;
      const img = IMG['hero_' + w.id]; if (!img) continue;
      const f = Math.floor(now / 140 + w.x) % 4;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(w.x + 18, c.height - 4, 13, 4, 0, 0, 6.3); ctx.fill();
      ctx.drawImage(img, 3 * 16, f * 16, 16, 16, Math.round(w.x), c.height - 40, 36, 36);
    }
    paradeRAF = requestAnimationFrame(loop);
  };
  paradeRAF = requestAnimationFrame(loop);
}

const screen = () => document.getElementById('screen');

export function startParade() { const old = document.querySelector('.parade'); if (old) old.remove(); const el = h('div', { class: 'parade' }); document.body.append(el); parade(el); }
export function stopParade() { cancelAnimationFrame(paradeRAF); const old = document.querySelector('.parade'); if (old) old.remove(); }

export function showHowTo(app) {
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => app.menu() }, '‹ Back'), h('h2', {}, 'How to Play'), h('div')),
    h('div', { class: 'panel howto' },
    h('p', {}, 'You are the coach. Your five heroes play on their own: they farm, trade, fight and retreat. They only know what your team can see. You win by making the calls.'),
    h('h3', {}, '1. Draft'), h('p', {}, 'Ban and pick in turns: Top, Jungle, Mid, Bot and Support. Filter by role or search ("tank", "dive", a name). Green numbers show counters; duos, comps and matching clans give team bonuses.'),
    h('h3', {}, '2. Prep'), h('p', {}, 'Pick each hero\'s build path, 3 tactic cards and a game plan: Early Aggression, Scale, Objective Control, Split Push or Protect the Carry. Your heroes play to it. The recommended plan (★) reads your comp against theirs. Each plan beats two others and loses to two; both plans are revealed at kickoff, and you can switch once at halftime.'),
    h('h3', {}, '3. Calls'), h('p', {}, 'Six big buttons along the bottom: Gank, Objective, Push, Shrine, Defend and Regroup. Calls cost charges (max 3, +1 every 20s). Or just tap the map: tap a lane, a pit, a shrine or an enemy and a ring of calls pops up right there.'),
    h('p', {}, 'Your analyst flashes one-tap suggestions ("Mid is overextended: Gank"). Tap the button and the call goes out. Tactic cards (Q, E, T) are one-time plays like Smoke Bomb or Second Wind.'),
    h('p', {}, 'Tap one of your portraits to follow that hero and change its build; tap an enemy portrait to focus them. Press and hold (or right-click) a portrait for details, including "Why": what the hero is doing and why. Good calls build trust, and inspired heroes react faster.'),
    h('p', {}, 'Arrows on the screen edge point at fights, towers under attack and contested objectives: tap one to jump there. The camera follows the action on its own until you drag it, tap the minimap or follow a hero (Cam turns it back on).'),
    h('h3', {}, '4. Big moments'), h('p', {}, 'Coach\'s Calls pop up above the buttons when something big is about to happen: pick one of the 2-3 options before the bar runs out. Fill Momentum with calls that pay off, then tap the meter for a Kami Surge.'),
    h('p', {}, 'Moments (M) are three once-per-match calls that open at 1:15: Timeout (reset cooldowns and heal), Rally (+15% damage and speed) and All-Out Push (super minions). The Ults button switches between Auto, Hold (save them for a fight) and ALL-IN. At halftime you can change the game plan, swap a card and adjust builds.'),
    h('h3', {}, 'Winning'), h('p', {}, 'Destroy the enemy Shrine Crystal, or have more towers standing when the clock runs out (15:00; Lane Rush: 8:00).'),
    h('h3', {}, 'Modes'), h('p', {}, 'Play vs AI pits you against rival coaches: four per difficulty, each with signature plans, favourite heroes and draft habits. Tap the rival on the Play vs AI card to see them all, pick one, and track your record (beware your nemesis). Play vs AI and the Season Cup move your rating (Bronze to Kami). Find Match pairs you with real players: Ranked climbs the ladder while Casual and Rush never change it. Lane Rush is a quick one-lane game. Host and Join are private games with a friend. Co-op puts two coaches on one team (vs the AI, or 2v2): each runs their own heroes, and the lead makes the team-wide calls (and picks the game plan) while the partner suggests them. Settings has sound, colour-blind colours, text size, reduced effects, graphics quality and a button to replay the first-match coach tips.'),
    h('h3', {}, 'Franchise'), h('p', {}, 'Found a club (name, colours, crest) and run it for season after season against seven AI franchises: 14 matches, the top four make the playoffs, then contracts, a rookie draft and free agency. Your roster is your draft: the starting five go straight to prep. Morale, form, fatigue and chemistry give each hero a small edge (a few %, never more than 10%); rest tired starters, keep good heroes playing, and keep pairs together to build bonds. Play every match as the real 5v5, or Sim it. Franchise matches never change your rating. The Pro League tab follows 16 pro teams through a new week-long season every week: predict winners for points and watch the featured matches.'),
    h('h3', {}, 'Controls'), h('p', {}, 'Drag to pan, scroll or pinch to zoom, tap the minimap to jump. Keys: G O R K X B for calls, Q E T for cards, M for Moments, C to cancel, 1-5 follow heroes, Tab for the scoreboard, Space for the auto-camera.'),
  )));
}

export function showLobby(app, { code, status, joining, onJoin, onCancel, extra }) {
  let input;
  mount(screen(), h('div', { class: 'lobby panel col', style: { alignItems: 'center' } },
    joining ? h('h2', {}, 'Join a match') : h('h2', {}, 'Your room code'),
    joining ? (input = h('input', { maxlength: 5, placeholder: 'CODE', value: code || '' })) : h('div', { class: 'code' }, code),
    h('div', { class: 'status muted' }, status || ''),
    extra || null,
    joining ? h('button', { class: 'btn big', onclick: () => onJoin(input.value.trim().toUpperCase()) }, 'Connect') : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Share this code with your opponent. You play Blue.'),
    h('button', { class: 'btn', onclick: onCancel }, 'Back'),
  ));
  if (input) input.focus();
}

// ───────────────────────── prep ─────────────────────────
// Quick confirm screen: the lineup (lanes, builds), plan and deck prefilled from the active preset.
// "Adjust" opens the full editors.
export function showPrep(app, prep, enemyIds, left, onChange, onReady, ready) {
  const s = app.session, myIds = prep.heroes.map((p) => p.id), fromPreset = new Set(s.prepFromPreset || []);
  const adjust = !!s.prepAdjust && !ready;
  const mirror = s.draft && s.draft.mirror; // Mirror Match: lanes and deck are fixed (the same on both sides)
  // co-op: this coach sets up their own heroes; the lead also picks the plan and the deck
  const coop = s.mode === 'coop', mine = new Set(coop ? myHeroIds(s) : myIds), lead = !coop || isLead(s), mate = coop ? mateOf(s) : null;
  const mateSeat = mate ? mate.seat : -1, matePrep = mate && s.seatPreps ? s.seatPreps[s.myTeam][mateSeat] : null;
  const leadPrep = lead ? prep : s.seatPreps && s.seatPreps[s.myTeam][s.coop[s.myTeam].lead];
  const autoSetup = () => {
    if (ready) return;
    const ai = aiPrep(myIds, enemyIds, s.gameMode);
    for (const hp of prep.heroes) { const a = ai.heroes.find((q) => q.id === hp.id); if (a && mine.has(hp.id)) hp.build = a.build; }
    if (lead) { prep.plan = ai.plan; if (!mirror) prep.deck = ai.deck.slice(0, 3); }
    audio.sfx('accept', 0.6); onChange();
  };
  const toggleAdjust = () => { s.prepAdjust = !s.prepAdjust; audio.sfx('move', 0.4); onChange(); };
  const byRole = prep.heroes.slice().sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  // summary: one compact card per hero
  const mini = (hp0) => {
    // a partner's hero shows the partner's choice once they are ready ("choosing…" until then)
    const theirs = coop && !mine.has(hp0.id), hp = theirs && matePrep ? matePrep.heroes.find((q) => q.id === hp0.id) || hp0 : hp0;
    const x = HERO_BY_ID[hp.id], b = BUILDS[hp.build];
    return h('div', { class: 'pmini' + (coop ? ' cs' : ''), style: { '--cc': CLANS[x.clan].color, '--bc': b.color, ...(coop ? { '--sc': COOP_COL[theirs ? mateSeat : s.mySeat] } : {}) }, title: theirs ? `${mate ? mate.name : 'Partner'} runs ${x.name}` : null },
      h('span', { class: 'plane' }, ROLE_LABEL[hp.role]), h('img', { src: face(hp.id) }), h('b', {}, x.name),
      theirs && !matePrep ? h('span', { class: 'pbuild muted' }, 'choosing…')
        : h('span', { class: 'pbuild', 'data-build': hp.build, 'data-build-info': true, title: b.desc }, h('img', { src: icon(b.icon) }), b.name),
      fromPreset.has(hp.id) ? h('span', { class: 'pfrom', title: 'From your lineup' }, '★') : null);
  };
  const card = (hp) => {
    const x = HERO_BY_ID[hp.id], pers = PERSONALITIES[x.pers], b = BUILDS[hp.build];
    return h('div', { class: 'pcard', style: { '--cc': CLANS[x.clan].color } },
      h('div', { class: 'head' }, h('div', { class: 'face' }, h('img', { src: face(hp.id) })),
        h('div', { class: 'pch' }, h('div', { class: 'pn' }, x.name), h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': CLANS[x.clan].color } }, CLANS[x.clan].name), h('span', { class: 'chipx', style: { '--cc': pers.color } }, pers.name)))),
      h('label', { class: 'rolesel' }, h('span', {}, 'Lane'),
        h('select', { disabled: !!mirror, onchange: (e) => { const r = e.target.value; const other = prep.heroes.find((o) => o.role === r); if (other) other.role = hp.role; hp.role = r; onChange(); } },
          // co-op: lanes swap only among this coach's own heroes
          ...ROLES.filter((r) => !coop || prep.heroes.some((o) => o.role === r && mine.has(o.id))).map((r) => h('option', { value: r, selected: r === hp.role }, ROLE_LABEL[r] + (x.roles.includes(r) ? '' : ' (off-role)'))))),
      h('div', { class: 'bchips' }, ...x.builds.map((bb) => h('button', { class: 'bchip' + (hp.build === bb ? ' on' : ''), style: { '--bc': BUILDS[bb].color }, 'data-build': bb, onclick: () => { hp.build = bb; audio.sfx('move', 0.4); onChange(); } }, BUILDS[bb].name, bb === x.rec ? h('i', { class: 'star', title: 'Recommended' }) : null))),
      h('div', { class: 'bsel' }, h('div', { class: 'bd' }, b.desc), h('div', { class: 'items' }, ...b.items.map((it) => h('img', { src: icon(it.icon), title: `${it.name} (${it.cost}g)` })))));
  };
  const clans = (() => {
    const c = {}; for (const p of prep.heroes) { const k = HERO_BY_ID[p.id].clan; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const tier = CLANS[k].tiers.filter((t) => n >= t.n).pop(); return h('div', { class: 'cchip' + (tier ? ' on' : ''), style: { '--cc': CLANS[k].color } }, h('b', {}, `${CLANS[k].name} x${n}`), h('small', {}, tier ? tier.text : `${CLANS[k].tiers[0].n} needed: ${CLANS[k].tiers[0].text}`)); });
  })();
  const sec = (title, extra, ...kids) => h('div', { class: 'panel psec' }, h('div', { class: 'psh' }, h('span', {}, title), extra || null), ...kids);
  // game plan: the recommended one (your comp vs theirs) is marked; the enemy only sees yours at kickoff. Co-op: the lead picks it.
  const rush = s.gameMode === 'rush', rec = recommendPlan(myIds, enemyIds, s.gameMode), lp = leadPrep || prep, plan = PLAN_INFO[lp.plan] || PLAN_INFO[rec.id];
  const summary = h('div', { class: 'psum' },
    h('div', { class: 'pminis' }, ...byRole.map(mini)),
    h('div', { class: 'pplan' },
      h('button', { class: 'pp', disabled: ready || !lead, title: `${plan.desc} ${planLine(lp.plan)}.${lead ? ' Tap to change.' : ''}`, style: { '--pc': plan.color }, onclick: () => { if (lead && !s.prepAdjust) toggleAdjust(); } },
        h('small', {}, !lead ? `Plan (${mate ? mate.name : 'lead'})` : lp.plan === rec.id ? 'Plan · recommended' : 'Plan'), h('b', {}, h('img', { src: icon(plan.icon), alt: '' }), leadPrep ? plan.name : 'choosing…')),
      leadPrep ? h('div', { class: 'pdeck' }, ...lp.deck.map((id) => h('span', { class: 'pdc', title: TACTICS[id].desc }, h('img', { src: icon(TACTICS[id].icon) }), TACTICS[id].name))) : null,
      h('div', { class: 'pclans' }, clans)));
  const editors = adjust ? [
    sec(coop ? 'Your heroes: lanes & builds' : 'Lanes & builds', h('button', { class: 'btn small', onclick: autoSetup, title: 'Counter-builds, plan and deck picked for you' }, 'Auto counter-build'), h('div', { class: 'prep-cards' }, ...byRole.filter((hp) => mine.has(hp.id)).map(card))),
    !lead ? h('div', { class: 'panel psec muted small' }, `${mate ? mate.name : 'Your partner'} leads: they pick the game plan and the tactic deck.`) : null,
    !lead ? null : sec('Game plan', h('small', { class: 'muted' }, `Secret until kickoff · countering theirs: ${EDGE_TEXT}${rush ? ' · one lane: no Split Push' : ' · one switch at halftime'}`), h('div', { class: 'plans' }, ...PLAN_IDS.filter((k) => !(rush && k === 'split')).map((k) => { const P = PLAN_INFO[k];
      return h('button', { class: 'plan' + (prep.plan === k ? ' on' : '') + (rec.id === k ? ' rec' : ''), style: { '--pc': P.color }, onclick: () => { prep.plan = k; audio.sfx('move', 0.4); onChange(); } },
        h('b', {}, h('img', { src: icon(P.icon), alt: '' }), P.name), h('small', {}, P.desc), h('small', { class: 'pvs' }, planLine(k)),
        rec.id === k ? h('span', { class: 'precw' }, '★ ' + rec.why) : null); }))),
    !lead || mirror ? null : sec('Tactic deck', h('span', { class: 'dcount' + (prep.deck.length === 3 ? ' full' : '') }, `${prep.deck.length}/3`),
      h('div', { class: 'deck' }, ...TACTIC_IDS.map((id) => {
        const t = TACTICS[id], on = prep.deck.includes(id);
        return h('button', { class: 'card' + (on ? ' sel' : ''), onclick: () => { if (on) prep.deck = prep.deck.filter((d) => d !== id); else if (prep.deck.length < 3) prep.deck = [...prep.deck, id]; else prep.deck = [...prep.deck.slice(1), id]; audio.sfx('move', 0.4); onChange(); } },
          h('img', { src: icon(t.icon) }), h('div', { class: 'cn' }, t.name), h('div', { class: 'cd' }, t.desc), on ? h('i', { class: 'tick' }) : null);
      })))] : [];
  const prevScroll = screen().scrollTop;
  mount(screen(), h('div', { class: 'prep' + (ready ? ' ready' : '') + (adjust ? ' adjusting' : '') },
    h('div', { class: 'phead' },
      h('div', { class: 'pt' }, h('h2', {}, 'Prep'), h('small', { class: 'muted' }, coop && mate ? (lead ? `You lead: plan and deck are yours. ${mate.name} sets up their heroes.` : `Set up your heroes. ${mate.name} leads the plan and deck.`)
        : mirror ? `Mirror Match: both teams play ${mirror.name} with the same cards. Your builds and plan decide it.`
        : s.preset ? `Lineup "${s.preset.name}" loaded. Ready, or adjust anything.` : 'Recommended setup loaded. Ready, or adjust anything.')),
      h('div', { class: 'ptimer' }, h('b', { id: 'ptimer' }, String(Math.max(0, Math.ceil(left)))), h('small', {}, 'sec')),
      h('div', { class: 'pbtns' }, h('button', { class: 'btn adjbtn' + (adjust ? ' on' : ''), disabled: ready, onclick: toggleAdjust }, adjust ? 'Done' : 'Adjust'),
        h('button', { class: 'btn big readybtn', disabled: ready, onclick: onReady }, ready ? (coop && mate && !matePrep ? `Waiting for ${mate.name}...` : 'Waiting...') : 'Ready!'))),
    h('div', { class: 'enemyrow' }, h('span', { class: 'lab' }, 'Enemy'), ...enemyIds.map((id) => {
      const x = HERO_BY_ID[id]; const mu = matchupScore(x, prep.heroes.map((p) => HERO_BY_ID[p.id]));
      return h('div', { class: 'efoe', title: x.tags.join(', ') }, h('img', { src: face(id) }), h('span', {}, x.name), mu.score > 0 ? h('b', { class: 'threat', title: 'Counters your team' }, `+${mu.score}`) : null);
    })),
    summary, ...editors));
  if (adjust) screen().scrollTop = prevScroll;
}

// ───────────────────────── results ─────────────────────────
// Why a timed-out game went the way it did (same order as Game.timeUp: towers, Crystal health, kills, gold).
function timeTiebreak(g) {
  const a = g.towersStanding(0), b = g.towersStanding(1);
  if (a !== b) return `towers ${a} - ${b}`;
  const nx = (t) => { const n = g.units.find((u) => u.type === 'nexus' && u.team === t); return n ? n.hp / n.maxHp : 0; };
  const pc = (t) => Math.min(99, Math.round(nx(t) * 100)) + (nx(t) >= 1 ? 1 : 0); // 100% only when untouched
  if (Math.abs(nx(0) - nx(1)) > 1e-6) return `towers ${a} - ${b}, Crystal ${pc(0)}% - ${pc(1)}%`;
  const k = [g.teams[0].kills, g.teams[1].kills];
  return k[0] !== k[1] ? `towers ${a} - ${b}, kills ${k[0]} - ${k[1]}` : `towers ${a} - ${b}, more gold earned`;
}
export function showResults(app, g, myTeam, onAgain, onMenu, extra = {}) {
  const win = g.winner;
  const verdict = myTeam < 0 ? `${TEAM_NAME[win] ?? '-'} wins` : win === myTeam ? 'VICTORY' : win < 0 ? 'NO CONTEST' : 'DEFEAT';
  const vcls = myTeam < 0 ? (win === 0 ? 'blue' : 'red') : win === myTeam ? 'win' : 'loss';
  const all = [...g.teams[0].heroes, ...g.teams[1].heroes];
  const score = (x) => x.kills * 3 + x.assists * 1.5 - x.deaths + x.dmgHeroes / 1500 + x.cs / 40 + (x.team === win ? 4 : 0);
  const mvp = all.slice().sort((a, b) => score(b) - score(a))[0];
  const best = (k) => Math.max(...all.map((x) => x[k]));
  const row = (x) => h('tr', { class: x === mvp ? 'mvprow' : '' },
    h('td', { class: 'hero' }, h('img', { class: 'f', src: face(x.heroId) }), h('span', {}, x.def.name), x === mvp ? h('small', { class: 'mvptag' }, 'MVP') : null),
    h('td', { class: 'muted c-role' }, ROLE_LABEL[x.role]), h('td', {}, x.level), h('td', { class: 'kda' }, `${x.kills}/${x.deaths}/${x.assists}`), h('td', { class: x.cs === best('cs') ? 'top' : '' }, x.cs),
    h('td', { class: Math.round(x.dmgHeroes) === Math.round(best('dmgHeroes')) ? 'top' : '' }, Math.round(x.dmgHeroes)), h('td', { class: 'c-gold' }, Math.round(x.goldEarned)), h('td', { class: 'c-build', style: { color: BUILDS[x.build].color } }, BUILDS[x.build].name),
    h('td', { class: 'its c-items' }, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name }))));
  const table = (t) => h('div', { class: 'panel rteam t' + t + (t === win ? ' won' : '') },
    h('div', { class: 'rth' }, h('b', {}, `${TEAM_NAME[t]} · ${app.session.names[t]}`), extra.emotes && extra.emotes[t] ? extra.emotes[t].cloneNode(true) : null, t === win ? h('span', { class: 'wtag' }, 'WIN') : null,
      h('span', { class: 'rstats' }, `${g.teams[t].kills} kills · ${g.teams[t].towers} towers · ${g.teams[t].dragons.length} kami${g.teams[t].soul ? ' + ' + DRAGON_INFO[g.teams[t].soul].name + ' blessing' : ''}`)),
    h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('tr', {}, ...[['Hero'], ['Role', 'c-role'], ['Lv'], ['KDA'], ['CS'], ['Dmg'], ['Gold', 'c-gold'], ['Build', 'c-build'], ['Items', 'c-items']].map(([c, k]) => h('th', { class: k || '' }, c))), ...g.teams[t].heroes.map(row))));
  const timeout = g.events.find((e) => e.type === 'victory' && e.timeout);
  const mvpCard = mvp ? h('div', { class: 'mvp panel t' + mvp.team },
    h('div', { class: 'mvpart' }, h('div', { class: 'rays' }), h('img', { src: face(mvp.heroId) }), h('span', { class: 'mvpbadge' }, 'MVP')),
    h('div', { class: 'mvpinfo' }, h('div', { class: 'mvpname' }, mvp.def.name, h('small', {}, ` ${mvp.def.title}`)),
      h('div', { class: 'muted small' }, `${TEAM_NAME[mvp.team]} · ${ROLE_LABEL[mvp.role]} · ${PERSONALITIES[mvp.def.pers].name}`),
      h('div', { class: 'mvpstats' }, h('div', {}, h('b', {}, `${mvp.kills}/${mvp.deaths}/${mvp.assists}`), h('small', {}, 'KDA')), h('div', {}, h('b', {}, Math.round(mvp.dmgHeroes)), h('small', {}, 'damage')), h('div', {}, h('b', {}, mvp.cs), h('small', {}, 'CS')), h('div', {}, h('b', {}, `${Math.round(mvp.goldEarned / 100) / 10}k`), h('small', {}, 'gold'))))) : null;
  // Play of the Game + coach report card (one compact row on wide screens)
  const p = extra.potg;
  const potgEl = p ? h('div', { class: 'panel potg t' + p.team },
    h('div', { class: 'potg-l' }, h('small', {}, 'PLAY OF THE GAME'), h('b', {}, p.title), h('span', { class: 'muted' }, `at ${p.at} · ${p.kills} kill${p.kills === 1 ? '' : 's'}`)),
    p.heroId ? h('img', { class: 'potg-f', src: face(p.heroId) }) : null,
    h('button', { class: 'btn potgbtn', onclick: () => extra.onPOTG && extra.onPOTG() }, 'Watch'),
    extra.onClip ? h('button', { class: 'btn potgbtn clipbtn', title: 'Save the Play of the Game as a video clip', onclick: extra.onClip }, 'Save clip') : null) : null;
  const rc = extra.report;
  const repEl = rc ? h('div', { class: 'panel report' },
    h('div', { class: 'rth' }, h('b', {}, 'Coach report card')),
    h('div', { class: 'grades' }, ...rc.rows.map((r) => h('div', { class: 'grade g' + r.g }, h('b', {}, r.g), h('div', {}, h('span', {}, r.k), h('small', {}, r.d))))),
    h('div', { class: 'tip' }, h('span', {}, 'Tip'), rc.tip)) : null;
  mount(screen(), h('div', { class: 'results' },
    h('div', { class: 'verdict ' + vcls }, verdict, myTeam >= 0 && extra.emotes && extra.emotes[myTeam] ? extra.emotes[myTeam] : null),
    h('div', { class: 'vsub muted' }, timeout ? `Decided on time: ${timeTiebreak(g)} · ` : '', `Game length ${fmtTime(g.time)}`),
    extra.rival || null,
    extra.progress || null,
    potgEl || repEl ? h('div', { class: 'rrow' }, potgEl, repEl) : null,
    mvpCard,
    extra.ladder ? ladderPanel(extra.ladder) : null,
    extra.social || null,
    table(0), table(1),
    extra.analytics ? analysisCard(extra.analytics, extra.onAnalysis) : null,
    extra.foot || null,
    h('div', { class: 'rbtns' }, extra.share ? h('button', { class: 'btn big sharebtn', onclick: extra.share }, 'Share') : null, onAgain ? h('button', { class: 'btn big', onclick: onAgain }, extra.againLabel || 'Play again') : null, extra.onReplay && app.lastReplay() && !app.session.replay ? h('button', { class: 'btn big', title: 'Replay Theater: timeline, speeds, jumps to fights', onclick: extra.onReplay }, 'Watch replay') : null, h('button', { class: 'btn big', onclick: onMenu }, 'Main menu')),
  ));
  growBars(screen().querySelector('.results .prog'), 300);
  // the MVP's numbers count up
  for (const b of screen().querySelectorAll('.mvpstats b')) { const m = /^(\d+)$/.exec(b.textContent); if (m) tweenNumber(b, 0, +m[1], 900); }
}
