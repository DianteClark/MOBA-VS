// Pre/post-match screens: menu, lobby, how-to, draft, prep, results.
import { h, mount, face, icon, fmtTime } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, matchupScore, PERSONALITIES } from '../data/heroes.js';
import { TACTICS, TACTIC_IDS } from '../data/tactics.js';
import { BUILDS } from '../data/items.js';
import { DRAFT_ORDER, currentTurn, taken, legal, assignRoles, aiPrep, TURN_SECONDS } from '../sim/draft.js';
import { TEAM_NAME, DRAGON_INFO, CLANS } from '../sim/constants.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { World, N as GN } from '../sim/world.js';
import { THEMES } from '../render/mapgen.js';
import { IMG } from '../render/assets.js';
import { TEAM_COL } from '../render/palette.js';
import { audio } from '../audio.js';

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
const TEAMC = ['blue', 'red'];

export function startParade() { const old = document.querySelector('.parade'); if (old) old.remove(); const el = h('div', { class: 'parade' }); document.body.append(el); parade(el); }
export function stopParade() { cancelAnimationFrame(paradeRAF); const old = document.querySelector('.parade'); if (old) old.remove(); }

export function showHowTo(app) {
  mount(screen(), h('div', { class: 'panel howto', style: { margin: 'auto' } },
    h('h2', { class: 'gold' }, 'How to play'),
    h('p', {}, 'You are the coach. Your five heroes play on their own: they farm, trade, fight and retreat. They only know what your team can see. You win by making the calls.'),
    h('h3', {}, '1. Draft'), h('p', {}, 'Ban and pick in turns: Top, Jungle, Mid, Bot and Support. Green numbers show counters; matching clans give team bonuses.'),
    h('h3', {}, '2. Prep'), h('p', {}, 'Pick each hero\'s build path and choose 3 tactic cards for your hand.'),
    h('h3', {}, '3. Calls'), h('p', {}, 'Six big buttons along the bottom: Gank, Objective, Push, Shrine, Defend and Regroup. Calls cost charges (max 3, +1 every 20s). Or just tap the map: tap a lane, a pit, a shrine or an enemy and a ring of calls pops up right there.'),
    h('p', {}, 'Your analyst flashes one-tap suggestions ("Mid is overextended: Gank"). Tap the button and the call goes out. Tactic cards (Q, E, T) are one-time plays like Smoke Bomb or Second Wind.'),
    h('p', {}, 'Tap one of your portraits to follow that hero and change its build; tap an enemy portrait to focus them. Press and hold (or right-click) a portrait for details. Good calls build trust, and inspired heroes react faster.'),
    h('p', {}, 'Arrows on the screen edge point at fights, towers under attack and contested objectives: tap one to jump there. Sound, colour-blind colours, text size and motion live in Settings.'),
    h('h3', {}, 'Winning'), h('p', {}, 'Destroy the enemy Shrine Crystal, or have more towers standing when the 15:00 clock runs out.'),
    h('h3', {}, 'Controls'), h('p', {}, 'Drag to pan, scroll or pinch to zoom, tap the minimap to jump. Keys: G O R K X B for calls, Q E T for cards, C to cancel, 1-5 follow heroes, Space for the director camera.'),
    h('button', { class: 'btn', onclick: () => app.menu() }, 'Back'),
  ));
}

export function showLobby(app, { code, status, joining, onJoin, onCancel }) {
  let input;
  mount(screen(), h('div', { class: 'lobby panel col', style: { alignItems: 'center' } },
    joining ? h('h2', {}, 'Join a match') : h('h2', {}, 'Your room code'),
    joining ? (input = h('input', { maxlength: 5, placeholder: 'CODE', value: code || '' })) : h('div', { class: 'code' }, code),
    h('div', { class: 'status muted' }, status || ''),
    joining ? h('button', { class: 'btn big', onclick: () => onJoin(input.value.trim().toUpperCase()) }, 'Connect') : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Share this code with your opponent. You play Blue.'),
    h('button', { class: 'btn', onclick: onCancel }, 'Back'),
  ));
  if (input) input.focus();
}

// ───────────────────────── draft ─────────────────────────
const ACT_L = { ban: 'BAN', pick: 'PICK' };
export class DraftView {
  constructor(app) { this.app = app; this.sel = null; this.filter = 'all'; this.more = false; this.scroll = 0; }
  // Up to 3 suggestions for the acting player: picks that counter, fill a missing role and match clans;
  // bans of heroes that counter your picks.
  recommend(d, me, t, enemyPicks) {
    if (!t || t.team !== me || d.done) return new Set();
    const tk = taken(d), mine = d.picks[me].map((id) => HERO_BY_ID[id]);
    const have = assignRoles(d.picks[me]) || [], need = ROLES.filter((r) => !have.includes(r));
    const clanN = {}; for (const x of mine) clanN[x.clan] = (clanN[x.clan] || 0) + 1;
    const sc = [];
    for (const x of HEROES) {
      if (tk.has(x.id)) continue;
      let v;
      if (t.act === 'pick') {
        if (!legal(d, me, x.id)) continue;
        v = matchupScore(x, enemyPicks).score * 2 + (x.roles.some((r) => need.includes(r)) ? 3 : -4) + (need.includes(x.role) ? 1 : 0) + (clanN[x.clan] || 0) * 1.5;
      } else {
        if (!mine.length) continue;
        v = matchupScore(x, mine).score;
      }
      if (v > 0) sc.push([v, x.id]);
    }
    sc.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
    return new Set(sc.slice(0, 3).map((q) => q[1]));
  }
  render() {
    const app = this.app, d = app.session.draft, me = app.session.myTeam;
    const t = currentTurn(d);
    const myTurn = t && t.team === me && app.session.mode !== 'watch';
    const tk = taken(d);
    const enemyPicks = d.picks[1 - Math.max(0, me)].map((id) => HERO_BY_ID[id]);
    const names = app.session.names;
    const recs = myTurn ? this.recommend(d, me, t, enemyPicks) : new Set();
    const prevGrid = document.querySelector('.dpool .grid'); if (prevGrid) this.scroll = prevGrid.scrollTop;
    const teamCol = (team) => {
      const picks = d.picks[team], bans = d.bans[team], roles = assignRoles(picks) || [];
      return h('div', { class: 'dteam t' + team + (t && t.team === team ? ' acting' : '') },
        h('div', { class: 'tname' }, h('span', { class: 'tdot' }), `${names[team]}`, team === me ? h('small', {}, 'you') : null),
        h('div', { class: 'slots' }, ...Array.from({ length: 5 }, (_, i) => {
          const id = picks[i], active = t && t.team === team && t.act === 'pick' && i === picks.length;
          return h('div', { class: 'slot' + (active ? ' active' : '') + (id ? ' filled' : '') }, id ? h('img', { src: face(id) }) : (active ? h('span', { class: 'dots' }, '...') : null), id ? h('div', { class: 'role' }, ROLE_LABEL[roles[i]] || '') : null);
        }),
        h('div', { class: 'bans' }, ...Array.from({ length: 3 }, (_, i) => {
          const id = bans[i], active = t && t.team === team && t.act === 'ban' && i === bans.length;
          return h('div', { class: 'slot ban' + (active ? ' active' : '') }, id ? h('img', { src: face(id) }) : null);
        }))),
        clanLine(picks));
    };
    const clanLine = (picks) => {
      const c = {}; for (const id of picks) { const k = HERO_BY_ID[id].clan; c[k] = (c[k] || 0) + 1; }
      return h('div', { class: 'clans' }, ...Object.entries(c).map(([k, n]) => h('span', { class: 'clan' + (n >= 2 ? ' on' : ''), style: { '--cc': CLANS[k].color } }, `${CLANS[k].name} ${n}`)));
    };
    const left = Math.ceil(app.session.turnLeft ?? TURN_SECONDS);
    const turnBox = h('div', { class: 'dturn' + (t ? ' t' + t.team : '') + (myTurn ? ' mine' : '') },
      d.done ? h('div', { class: 'what' }, 'Draft complete!') : h('div', { class: 'what' }, myTurn ? `YOUR ${ACT_L[t.act]}` : `${TEAM_NAME[t.team]} ${ACT_L[t.act]}`),
      d.done ? null : h('div', { class: 'timer', id: 'dtimer' }, String(left)),
      d.done ? null : h('div', { class: 'tbar' }, h('i', { id: 'dtbar', style: { width: Math.max(0, left / TURN_SECONDS * 100) + '%' } })),
      h('div', { class: 'mapname' }, (MAP_BY_ID[app.session.mapId] || MAPS[0]).name));
    const counts = { all: HEROES.length }; for (const r of ROLES) counts[r] = HEROES.filter((x) => x.roles.includes(r)).length;
    const tabs = h('div', { class: 'rtabs', role: 'tablist' }, ...['all', ...ROLES].map((r) => h('button', { class: 'rtab' + (this.filter === r ? ' on' : ''), role: 'tab', onclick: () => { this.filter = r; this.scroll = 0; this.render(); } },
      r === 'all' ? 'All' : ROLE_LABEL[r], h('small', {}, counts[r]))));
    const list = HEROES.filter((x) => this.filter === 'all' || x.roles.includes(this.filter));
    list.sort((a, b) => (tk.has(a.id) ? 1 : 0) - (tk.has(b.id) ? 1 : 0) || (recs.has(b.id) ? 1 : 0) - (recs.has(a.id) ? 1 : 0));
    const grid = h('div', { class: 'grid' }, ...list.map((x) => {
      const off = tk.has(x.id);
      const bad = !off && t && t.act === 'pick' && myTurn && !legal(d, me, x.id);
      const ms = enemyPicks.length && !off ? matchupScore(x, enemyPicks).score : 0;
      const pers = PERSONALITIES[x.pers];
      return h('button', { class: 'hcard' + (off ? ' off' : '') + (bad ? ' bad' : '') + (this.sel === x.id ? ' sel' : '') + (recs.has(x.id) ? ' rec' : ''), disabled: off, style: { '--cc': CLANS[x.clan].color },
        onclick: () => { if (off) return; this.sel = x.id; this.more = false; audio.sfx('move', 0.4); this.render(); }, title: `${x.name} · ${CLANS[x.clan].name} · ${pers.name}` },
        h('div', { class: 'fwrap' }, h('img', { src: face(x.id) }), ms ? h('span', { class: 'score ' + (ms > 0 ? 'pos' : 'neg') }, (ms > 0 ? '+' : '') + ms) : null, h('i', { class: 'pdot', style: { background: pers.color }, title: pers.name })),
        recs.has(x.id) ? h('span', { class: 'recb' }, t.act === 'ban' ? 'BAN?' : 'REC') : null,
        h('div', { class: 'n' }, x.name), h('div', { class: 'r' }, x.roles.map((r) => ROLE_LABEL[r]).join(' / ')));
    }));
    const info = this.infoPanel(this.sel, enemyPicks, myTurn, t, recs);
    mount(screen(), h('div', { class: 'draft' + (this.sel ? ' hassel' : '') },
      h('div', { class: 'dtop' }, teamCol(0), turnBox, teamCol(1)),
      h('div', { class: 'dmain' }, h('div', { class: 'panel dpool' }, tabs, grid), info)));
    grid.scrollTop = this.scroll;
  }
  infoPanel(id, enemyPicks, myTurn, t, recs) {
    const app = this.app, d = app.session.draft, me = app.session.myTeam;
    if (!id) {
      const need = ROLES.filter((r) => !(assignRoles(d.picks[Math.max(0, me)]) || []).includes(r)).map((r) => ROLE_LABEL[r]);
      return h('div', { class: 'panel dinfo empty' },
        h('div', { class: 'hint' }, myTurn ? (t.act === 'ban' ? 'Your ban: remove a hero you fear.' : `Your pick. Still needed: ${need.join(', ')}`) : d.done ? 'Locked in. Prep starts soon...' : 'Waiting for the other side...'),
        recs.size ? h('div', { class: 'muted small' }, 'Heroes marked REC suit your draft.') : h('div', { class: 'muted small' }, 'Tap a hero to see abilities and matchups.'));
    }
    const x = HERO_BY_ID[id], pers = PERSONALITIES[x.pers], clan = CLANS[x.clan];
    const mu = matchupScore(x, enemyPicks);
    const canAct = myTurn && legal(d, me, id);
    const action = myTurn ? h('button', { class: 'btn big lockbtn', disabled: !canAct, onclick: () => app.draftAct(id) }, t.act === 'ban' ? 'Ban ' + x.name : 'Lock in ' + x.name) : null;
    return h('div', { class: 'panel dinfo' + (this.more ? ' more' : '') },
      h('div', { class: 'ihead' }, h('div', { class: 'face' }, h('img', { src: face(id) })),
        h('div', { class: 'icol' }, h('h2', {}, x.name, recs.has(id) ? h('span', { class: 'recb inline' }, t.act === 'ban' ? 'BAN?' : 'REC') : null), h('div', { class: 't' }, `${x.title} · ${x.roles.map((r) => ROLE_LABEL[r]).join(' / ')}`),
          h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': clan.color }, title: clan.tiers ? clan.tiers.map((q) => `${q.n}+: ${q.text}`).join(' · ') : '' }, clan.name),
            h('span', { class: 'chipx', style: { '--cc': pers.color } }, pers.name), h('span', { class: 'chipx plain' }, x.ranged ? 'Ranged' : 'Melee'), h('span', { class: 'chipx plain' }, `${x.curve} game`))),
        h('button', { class: 'morebtn', onclick: () => { this.more = !this.more; this.render(); } }, this.more ? 'Less' : 'More')),
      action,
      myTurn && !canAct && t.act === 'pick' ? h('div', { class: 'red small' }, 'Your team already covers this hero\'s roles.') : null,
      h('div', { class: 'idetail' },
        h('div', { class: 'pers', style: { color: pers.color } }, `${pers.name}: `, h('span', { class: 'muted' }, pers.desc)),
        h('div', { class: 'tags' }, ...x.tags.map((tg) => h('span', { class: 'tag' }, tg)), h('span', { class: 'tag' }, x.dmgType === 'phys' ? 'physical' : 'magic')),
        h('div', { class: 'ab' }, h('img', { src: icon('LuckUpgrade') }), h('div', {}, h('b', {}, `Passive: ${x.passive.name}`), h('div', { class: 'd' }, x.passive.desc))),
        ...x.abilities.map((a) => h('div', { class: 'ab' + (a.ult ? ' ult' : '') }, h('img', { src: icon(a.icon) }), h('div', {}, h('b', {}, `${a.ult ? 'Ultimate: ' : ''}${a.name}`), h('div', { class: 'd' }, describeAbility(a))))),
        h('div', { class: 'muted small' }, 'Builds: ' + x.builds.map((b) => BUILDS[b].name).join(', ')),
        enemyPicks.length ? h('div', { class: 'notes' }, h('div', { class: 'muted' }, 'Vs enemy picks:'), ...(mu.notes.length ? mu.notes.map((n) => h('div', { class: /struggles|countered|into heavy/i.test(n) ? 'neg' : 'pos' }, '- ' + n)) : [h('div', { class: 'muted' }, '- Neutral matchup')])) : null));
  }
  tickTimer(left) {
    const el = document.getElementById('dtimer'); if (el) { const v = String(Math.max(0, Math.ceil(left))); if (el.textContent !== v) { el.textContent = v; if (left < 6) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); } } }
    const b = document.getElementById('dtbar'); if (b) b.style.width = Math.max(0, left / TURN_SECONDS * 100) + '%';
  }
}

export function describeAbility(a) {
  const parts = [];
  const kind = { shot: 'Skillshot', line: 'Line', target: 'Targeted', circle: 'Ground AoE', nova: 'Self AoE', dash: 'Dash', self: 'Self buff', ally: 'Ally', allynova: 'Team AoE', hook: 'Hook', zone: 'Zone' }[a.kind];
  parts.push(kind);
  if (a.dmg) { const d = a.dmg; const r = []; if (d.ad) r.push(`${Math.round(d.ad * 100)}% AD`); if (d.ap) r.push(`${Math.round(d.ap * 100)}% AP`); if (d.hp) r.push(`${(d.hp * 100).toFixed(0)}% max HP`); if (d.miss) r.push(`${Math.round(d.miss * 100)}% missing HP`); parts.push(`${d.b}${d.l ? '+' + d.l + '/lvl' : ''} dmg${r.length ? ' (' + r.join(', ') + ')' : ''}`); }
  if (a.cc) { if (a.cc.stun) parts.push(`stun ${a.cc.stun}s`); if (a.cc.root) parts.push(`root ${a.cc.root}s`); if (a.cc.knock) parts.push(`knock-up ${a.cc.knock}s`); if (a.cc.slow) parts.push(`slow ${Math.round(a.cc.slow[0] * 100)}%`); }
  if (a.burn) parts.push('burn'); if (a.heal) parts.push('heal'); if (a.shield) parts.push('shield');
  if (a.buff) parts.push(Object.keys(a.buff.stats).map((k) => ({ asPct: 'attack speed', msPct: 'move speed', power: 'power', armor: 'armor', mr: 'MR' }[k] || k)).join('/') + ' buff');
  parts.push(`${a.cd}s cd`);
  return parts.join(' · ');
}

// ───────────────────────── prep ─────────────────────────
const PLANS = { aggressive: ['Aggressive', 'Trade often, roam early, chase further.'], balanced: ['Balanced', 'Default risk. Adapt to the game.'], scaling: ['Scaling', 'Farm safely; avoid even fights before ~10 min.'] };
export function showPrep(app, prep, enemyIds, left, onChange, onReady, ready) {
  const myIds = prep.heroes.map((p) => p.id);
  const autoSetup = () => {
    if (ready) return;
    const ai = aiPrep(myIds, enemyIds);
    for (const hp of prep.heroes) { const a = ai.heroes.find((q) => q.id === hp.id); if (a) hp.build = a.build; }
    prep.plan = ai.plan; prep.deck = ai.deck.slice(0, 3);
    audio.sfx('accept', 0.6); onChange();
  };
  const card = (hp) => {
    const x = HERO_BY_ID[hp.id], pers = PERSONALITIES[x.pers], b = BUILDS[hp.build];
    return h('div', { class: 'pcard', style: { '--cc': CLANS[x.clan].color } },
      h('div', { class: 'head' }, h('div', { class: 'face' }, h('img', { src: face(hp.id) })),
        h('div', { class: 'pch' }, h('div', { class: 'pn' }, x.name), h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': CLANS[x.clan].color } }, CLANS[x.clan].name), h('span', { class: 'chipx', style: { '--cc': pers.color } }, pers.name)))),
      h('label', { class: 'rolesel' }, h('span', {}, 'Lane'),
        h('select', { disabled: ready, onchange: (e) => { const r = e.target.value; const other = prep.heroes.find((o) => o.role === r); if (other) other.role = hp.role; hp.role = r; onChange(); } },
          ...ROLES.map((r) => h('option', { value: r, selected: r === hp.role }, ROLE_LABEL[r] + (x.roles.includes(r) ? '' : ' (off-role)'))))),
      h('div', { class: 'bchips' }, ...x.builds.map((bb) => h('button', { class: 'bchip' + (hp.build === bb ? ' on' : ''), disabled: ready, style: { '--bc': BUILDS[bb].color }, onclick: () => { hp.build = bb; audio.sfx('move', 0.4); onChange(); } }, BUILDS[bb].name, bb === x.rec ? h('i', { class: 'star', title: 'Recommended' }) : null))),
      h('div', { class: 'bsel' }, h('div', { class: 'bd' }, b.desc), h('div', { class: 'items' }, ...b.items.map((it) => h('img', { src: icon(it.icon), title: `${it.name} (${it.cost}g)` })))));
  };
  const clans = (() => {
    const c = {}; for (const p of prep.heroes) { const k = HERO_BY_ID[p.id].clan; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const tier = CLANS[k].tiers.filter((t) => n >= t.n).pop(); return h('div', { class: 'cchip' + (tier ? ' on' : ''), style: { '--cc': CLANS[k].color } }, h('b', {}, `${CLANS[k].name} x${n}`), h('small', {}, tier ? tier.text : `${CLANS[k].tiers[0].n} needed: ${CLANS[k].tiers[0].text}`)); });
  })();
  const sec = (title, extra, ...kids) => h('div', { class: 'panel psec' }, h('div', { class: 'psh' }, h('span', {}, title), extra || null), ...kids);
  mount(screen(), h('div', { class: 'prep' + (ready ? ' ready' : '') },
    h('div', { class: 'phead' },
      h('div', { class: 'pt' }, h('h2', {}, 'Prep'), h('small', { class: 'muted' }, 'Defaults are good to go. Tweak anything, or tap Auto for counter-builds.')),
      h('div', { class: 'ptimer' }, h('b', { id: 'ptimer' }, String(Math.max(0, Math.ceil(left)))), h('small', {}, 'sec')),
      h('div', { class: 'pbtns' }, h('button', { class: 'btn', disabled: ready, onclick: autoSetup, title: 'Counter-builds, plan and deck picked for you' }, 'Auto'),
        h('button', { class: 'btn big readybtn', disabled: ready, onclick: onReady }, ready ? 'Waiting...' : 'Ready!'))),
    h('div', { class: 'panel enemyrow' }, h('span', { class: 'lab' }, 'Enemy'), ...enemyIds.map((id) => {
      const x = HERO_BY_ID[id]; const mu = matchupScore(x, prep.heroes.map((p) => HERO_BY_ID[p.id]));
      return h('div', { class: 'efoe', title: x.tags.join(', ') }, h('img', { src: face(id) }), h('span', {}, x.name), mu.score > 0 ? h('b', { class: 'threat', title: 'Counters your team' }, `+${mu.score}`) : null);
    })),
    sec('Lanes & builds', h('small', { class: 'muted' }, 'star = recommended'), h('div', { class: 'prep-cards' }, ...prep.heroes.map(card))),
    h('div', { class: 'prow2' },
      sec('Game plan', null, h('div', { class: 'plans' }, ...Object.entries(PLANS).map(([k, [nm, dsc]]) => h('button', { class: 'plan' + (prep.plan === k ? ' on' : ''), disabled: ready, onclick: () => { prep.plan = k; audio.sfx('move', 0.4); onChange(); } }, h('b', {}, nm), h('small', {}, dsc))))),
      sec('Clan synergies', null, h('div', { class: 'cchips' }, clans))),
    sec('Tactic deck', h('span', { class: 'dcount' + (prep.deck.length === 3 ? ' full' : '') }, `${prep.deck.length}/3`),
      h('div', { class: 'deck' }, ...TACTIC_IDS.map((id) => {
        const t = TACTICS[id], on = prep.deck.includes(id);
        return h('button', { class: 'card' + (on ? ' sel' : ''), disabled: ready, onclick: () => { if (on) prep.deck = prep.deck.filter((d) => d !== id); else if (prep.deck.length < 3) prep.deck = [...prep.deck, id]; else prep.deck = [...prep.deck.slice(1), id]; audio.sfx('move', 0.4); onChange(); } },
          h('img', { src: icon(t.icon) }), h('div', { class: 'cn' }, t.name), h('div', { class: 'cd' }, t.desc), on ? h('i', { class: 'tick' }) : null);
      }))),
    h('div', { class: 'pfoot' }, h('button', { class: 'btn', disabled: ready, onclick: autoSetup }, 'Auto'), h('button', { class: 'btn big readybtn', disabled: ready, onclick: onReady }, ready ? 'Waiting for opponent...' : 'Ready!')),
  ));
}

// ───────────────────────── results ─────────────────────────
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
    h('div', { class: 'rth' }, h('b', {}, `${TEAM_NAME[t]} · ${app.session.names[t]}`), t === win ? h('span', { class: 'wtag' }, 'WIN') : null,
      h('span', { class: 'rstats' }, `${g.teams[t].kills} kills · ${g.teams[t].towers} towers · ${g.teams[t].dragons.length} kami${g.teams[t].soul ? ' + ' + DRAGON_INFO[g.teams[t].soul].name + ' blessing' : ''}`)),
    h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('tr', {}, ...[['Hero'], ['Role', 'c-role'], ['Lv'], ['KDA'], ['CS'], ['Dmg'], ['Gold', 'c-gold'], ['Build', 'c-build'], ['Items', 'c-items']].map(([c, k]) => h('th', { class: k || '' }, c))), ...g.teams[t].heroes.map(row))));
  const graph = h('canvas', { class: 'graph' });
  const calls = g.callLog.filter((c) => myTeam < 0 || c.team === myTeam);
  const okN = calls.filter((c) => c.result === 'success' || c.result === 'played').length;
  const callEl = h('div', { class: 'panel' }, h('div', { class: 'rth' }, h('b', {}, myTeam < 0 ? 'Calls' : 'Your calls'), calls.length ? h('span', { class: 'rstats' }, `${okN}/${calls.length} paid off`) : null), h('div', { class: 'calllog' },
    ...(calls.length ? calls.map((c) => h('div', { class: 'crow' }, h('span', { class: 'muted' }, fmtTime(c.t / 20)), h('span', { class: TEAMC[c.team] }, c.type.toUpperCase()), h('span', {}, c.lane || c.obj || c.card || ''), h('span', { class: 'badge ' + (c.result || 'null') }, c.result || 'pending'))) : [h('div', { class: 'muted' }, 'No calls made.')])));
  const timeout = g.events.find((e) => e.type === 'victory' && e.timeout);
  const mvpCard = mvp ? h('div', { class: 'mvp panel t' + mvp.team },
    h('div', { class: 'mvpart' }, h('div', { class: 'rays' }), h('img', { src: face(mvp.heroId) }), h('span', { class: 'mvpbadge' }, 'MVP')),
    h('div', { class: 'mvpinfo' }, h('div', { class: 'mvpname' }, mvp.def.name, h('small', {}, ` ${mvp.def.title}`)),
      h('div', { class: 'muted small' }, `${TEAM_NAME[mvp.team]} · ${ROLE_LABEL[mvp.role]} · ${PERSONALITIES[mvp.def.pers].name}`),
      h('div', { class: 'mvpstats' }, h('div', {}, h('b', {}, `${mvp.kills}/${mvp.deaths}/${mvp.assists}`), h('small', {}, 'KDA')), h('div', {}, h('b', {}, Math.round(mvp.dmgHeroes)), h('small', {}, 'damage')), h('div', {}, h('b', {}, mvp.cs), h('small', {}, 'CS')), h('div', {}, h('b', {}, `${Math.round(mvp.goldEarned / 100) / 10}k`), h('small', {}, 'gold'))))) : null;
  mount(screen(), h('div', { class: 'results' },
    h('div', { class: 'verdict ' + vcls }, verdict),
    h('div', { class: 'vsub muted' }, timeout ? `Decided on time: towers ${g.towersStanding(0)} - ${g.towersStanding(1)} · ` : '', `Game length ${fmtTime(g.time)}`),
    mvpCard,
    extra.progress || null,
    table(0), table(1),
    h('div', { class: 'panel' }, h('div', { class: 'rth' }, h('b', {}, 'Gold lead'), h('span', { class: 'rstats' }, 'Blue above / Red below')), graph),
    callEl,
    h('div', { class: 'rbtns' }, onAgain ? h('button', { class: 'btn big', onclick: onAgain }, extra.againLabel || 'Play again') : null, app.lastReplay && app.lastReplay() && !app.session.replay ? h('button', { class: 'btn big', onclick: () => app.watchReplay() }, 'Watch replay') : null, h('button', { class: 'btn big', onclick: onMenu }, 'Main menu')),
  ));
  requestAnimationFrame(() => drawGoldGraph(graph, g));
}
function drawGoldGraph(c, g) {
  const r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height;
  const ctx = c.getContext('2d'); const a = g.teams[0].goldHistory, b = g.teams[1].goldHistory;
  const n = Math.min(a.length, b.length); if (n < 2) return;
  const diff = Array.from({ length: n }, (_, i) => a[i] - b[i]);
  const mx = Math.max(1000, ...diff.map(Math.abs));
  const mid = c.height / 2;
  ctx.strokeStyle = '#3d3346'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(c.width, mid); ctx.stroke();
  for (let i = 1; i < n; i++) {
    const x0 = (i - 1) / (n - 1) * c.width, x1 = i / (n - 1) * c.width;
    const y0 = mid - diff[i - 1] / mx * (mid - 8), y1 = mid - diff[i] / mx * (mid - 8);
    ctx.strokeStyle = (diff[i] + diff[i - 1]) / 2 >= 0 ? TEAM_COL[0] : TEAM_COL[1]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.fillStyle = '#a99fb3'; ctx.font = '10px PixelFont, monospace';
  ctx.fillText('+' + Math.round(mx / 100) / 10 + 'k', 4, 12); ctx.fillText('-' + Math.round(mx / 100) / 10 + 'k', 4, c.height - 4);
}
void DRAFT_ORDER;
