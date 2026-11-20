// Pre/post-match screens: menu, lobby, how-to, draft, prep, results.
import { h, mount, face, icon, fmtTime } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, matchupScore, PERSONALITIES } from '../data/heroes.js';
import { TACTICS, TACTIC_IDS } from '../data/tactics.js';
import { BUILDS } from '../data/items.js';
import { DRAFT_ORDER, currentTurn, taken, legal, assignRoles, TURN_SECONDS } from '../sim/draft.js';
import { TEAM_NAME, DRAGON_INFO, CLANS } from '../sim/constants.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { World, N as GN } from '../sim/world.js';
import { THEMES } from '../render/mapgen.js';
import { IMG } from '../render/assets.js';

// Tiny map previews from the terrain grid (cheap: 100x100 pixels).
const thumbs = {};
function mapThumb(id) {
  if (thumbs[id]) return thumbs[id];
  const def = MAP_BY_ID[id], w = new World(def), th = THEMES[def.theme];
  const c = document.createElement('canvas'); c.width = GN; c.height = GN;
  const x = c.getContext('2d'), img = x.createImageData(GN, GN);
  const col = (t) => [th.forestFloor[0], th.ground[1], th.lane[0], th.water[1], th.base[0][0], th.pit[1], th.shrine[0], th.path[0]][t];
  for (let i = 0; i < GN * GN; i++) { const c3 = w.walk[i] ? col(w.type[i]) : th.forestFloor[0].map((v) => v * 0.7); img.data.set([c3[0], c3[1], c3[2], 255], i * 4); }
  x.putImageData(img, 0, 0);
  for (const st of w.structures) { x.fillStyle = st.team ? '#ff5a5a' : '#4aa3ff'; x.fillRect(Math.floor(st.x / 24) - 1, Math.floor(st.y / 24) - 1, 3, 3); }
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

export function showMenu(app) {
  let name = app.name;
  mount(screen(), h('div', { class: 'menu' },
    h('div', {}, h('div', { class: 'title' }, 'MOBA-VS'), h('div', { class: 'subtitle' }, 'Draft five heroes. Make the calls. Out-coach your rival.')),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn big', onclick: () => app.startVsAI() }, 'Play vs AI'),
      h('button', { class: 'btn big', onclick: () => app.hostGame() }, 'Host Match'),
      h('button', { class: 'btn big', onclick: () => app.joinScreen() }, 'Join Match'),
      h('button', { class: 'btn', onclick: () => app.watch() }, 'Watch AI vs AI'),
      h('button', { class: 'btn', onclick: () => showHowTo(app) }, 'How to Play'),
    ),
    h('div', { class: 'panel col', style: { width: 'min(320px, 90vw)' } },
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Coach name'),
      h('input', { value: name, maxlength: 12, oninput: (e) => { app.setName(e.target.value); } }),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Map'),
      h('div', { class: 'mapcards' }, ...[['random', 'Random'], ...MAPS.map((m) => [m.id, m.name])].map(([id, l]) =>
        h('div', { class: 'mapcard' + (app.mapPref === id ? ' sel' : ''), title: id === 'random' ? 'A different valley every match' : MAP_BY_ID[id].blurb, onclick: () => { app.mapPref = id; showMenu(app); } },
          id === 'random' ? h('div', { class: 'q' }, '?') : mapThumb(id), l))),
      app.mapPref && app.mapPref !== 'random' ? h('div', { class: 'muted', style: { fontSize: '10px', textAlign: 'center' } }, MAP_BY_ID[app.mapPref].blurb) : null,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'AI difficulty'),
      h('div', { class: 'diffrow' },
        ...['Easy', 'Normal', 'Hard'].map((l, i) => h('button', { class: 'btn small' + (app.aiLevel === i ? ' on' : ''), onclick: () => { app.aiLevel = i; showMenu(app); } }, l)),
      ),
    ),
    h('div', { class: 'credits' }, h('a', { href: 'https://dianteclark.github.io/MOBA-VS/', target: '_blank' }, 'dianteclark.github.io/MOBA-VS'), ' · ', h('a', { href: 'https://github.com/DianteClark/MOBA-VS', target: '_blank' }, 'GitHub')),
    h('div', { class: 'credits' }, 'v1.0 · ', 'Art & audio: ', h('a', { href: 'https://pixel-boy.itch.io/ninja-adventure-asset-pack', target: '_blank' }, 'Ninja Adventure'), ' by Pixel-boy & AAA (CC0)'),
  ));
}

export function startParade() { const old = document.querySelector('.parade'); if (old) old.remove(); const el = h('div', { class: 'parade' }); document.body.append(el); parade(el); }
export function stopParade() { cancelAnimationFrame(paradeRAF); const old = document.querySelector('.parade'); if (old) old.remove(); }

export function showHowTo(app) {
  mount(screen(), h('div', { class: 'panel howto', style: { margin: 'auto' } },
    h('h2', { class: 'gold' }, 'How to play'),
    h('p', {}, 'You are the coach. Your five heroes play on their own (they farm, trade, fight and retreat by themselves) but they only know what your team can see. Your job is to make the calls.'),
    h('h3', {}, '1. Draft'), h('p', {}, 'Ban and pick in turns. Each team needs a Top, Jungle, Mid, Bot and Support. Green numbers on portraits show how well a hero counters the enemy picks.'),
    h('h3', {}, '2. Prep'), h('p', {}, 'Choose each hero\'s build path (Burst, Burn, Tank, Sustain, Crit, Haste, Guardian) and your team plan. Burn melts tanks and healers, Tank soaks burst, Crit wins late.'),
    h('h3', {}, '3. Calls'), h('p', {}, 'Calls cost command charges (max 3, +1 every 20s). Gank a lane, take Dragon/Herald/Baron, group to push, split-push, focus a target, play safe, or reset. Heroes break off a call to save their life, but a bad call still costs you time.'),
    h('p', {}, 'Objectives are never started by the AI. Only your calls take Dragon, Herald and Baron. Junglers smite automatically, and the enemy jungler can steal.'),
    h('h3', {}, 'Controls'), h('p', {}, 'Drag to pan, scroll or pinch to zoom, tap the minimap to jump. Tap a hero card to follow that hero. Keys: 1-5 follow heroes, Space toggles Director cam, WASD pans.'),
    h('button', { class: 'btn', onclick: () => showMenu(app) }, 'Back'),
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
export class DraftView {
  constructor(app) { this.app = app; this.sel = null; this.filter = 'all'; this.built = false; }
  render() {
    const app = this.app, d = app.session.draft, me = app.session.myTeam;
    const t = currentTurn(d);
    const myTurn = t && t.team === me && app.session.mode !== 'watch';
    const tk = taken(d);
    const enemyPicks = d.picks[1 - Math.max(0, me)].map((id) => HERO_BY_ID[id]);
    const names = app.session.names;
    const teamCol = (team) => {
      const picks = d.picks[team], bans = d.bans[team];
      const roles = assignRoles(picks) || [];
      const nPicks = 5, nBans = 3;
      let pickIdx = picks.length, banIdx = bans.length;
      return h('div', { class: 'teamcol ' + TEAMC[team] },
        h('div', { class: 'tname ' + TEAMC[team] }, `${TEAM_NAME[team]} · ${names[team]}`),
        h('div', { class: 'slots' }, ...Array.from({ length: nPicks }, (_, i) => {
          const id = picks[i];
          const active = t && t.team === team && t.act === 'pick' && i === pickIdx;
          return h('div', { class: 'slot' + (active ? ' active' : '') }, id ? h('img', { src: face(id) }) : (active ? '...' : ''), id ? h('div', { class: 'role' }, ROLE_LABEL[roles[i]] || '') : null);
        })),
        clanLine(picks),
        h('div', { class: 'slots bans' }, ...Array.from({ length: nBans }, (_, i) => {
          const id = bans[i];
          const active = t && t.team === team && t.act === 'ban' && i === banIdx;
          return h('div', { class: 'slot ban' + (active ? ' active' : '') }, id ? h('img', { src: face(id) }) : '');
        })),
      );
    };
    const clanLine = (picks) => {
      const c = {}; for (const id of picks) { const k = HERO_BY_ID[id].clan; c[k] = (c[k] || 0) + 1; }
      return h('div', { class: 'clans' }, ...Object.entries(c).map(([k, n]) => h('span', { class: 'clan' + (n >= 2 ? ' on' : ''), style: { borderColor: CLANS[k].color, color: n >= 2 ? '#111' : CLANS[k].color, background: n >= 2 ? CLANS[k].color : 'transparent' } }, `${CLANS[k].name} ${n}`)));
    };
    const timer = h('div', { class: 'timer', id: 'dtimer' }, String(Math.ceil(app.session.turnLeft ?? TURN_SECONDS)));
    const turnBox = h('div', { class: 'turn panel' },
      d.done ? h('div', {}, 'Draft complete') : h('div', { class: 'what ' + TEAMC[t.team] }, `${TEAM_NAME[t.team]} ${t.act === 'ban' ? 'BAN' : 'PICK'}`),
      timer,
      h('div', { class: 'muted', style: { fontSize: '10px' } }, myTurn ? 'Your turn' : (d.done ? '' : 'Waiting…')),
      h('div', { class: 'mapname' }, (MAP_BY_ID[app.session.mapId] || MAPS[0]).name),
    );
    const roles = ['all', ...ROLES];
    const filters = h('div', { class: 'filters' }, ...roles.map((r) => h('button', { class: 'btn small' + (this.filter === r ? ' on' : ''), onclick: () => { this.filter = r; this.render(); } }, r === 'all' ? 'All' : ROLE_LABEL[r])));
    const grid = h('div', { class: 'grid' }, ...HEROES.filter((x) => this.filter === 'all' || x.roles.includes(this.filter)).map((x) => {
      const off = tk.has(x.id);
      const bad = !off && t && t.act === 'pick' && myTurn && !legal(d, me, x.id);
      const ms = enemyPicks.length ? matchupScore(x, enemyPicks).score : 0;
      return h('div', { class: 'hcard' + (off ? ' off' : '') + (bad ? ' bad' : '') + (this.sel === x.id ? ' sel' : ''), onclick: () => { if (!off) { this.sel = x.id; this.render(); } }, title: x.name },
        h('img', { src: face(x.id) }), h('i', { class: 'cl', style: { background: CLANS[x.clan].color }, title: CLANS[x.clan].name }), h('div', { class: 'n' }, x.name), h('div', { class: 'r' }, x.roles.map((r) => ROLE_LABEL[r]).join('/')),
        ms ? h('div', { class: 'score', style: { color: ms > 0 ? 'var(--green)' : 'var(--red)' } }, (ms > 0 ? '+' : '') + ms) : null);
    }));
    const info = this.infoPanel(this.sel, enemyPicks, myTurn, t);
    mount(screen(), h('div', { class: 'draft' },
      h('div', { class: 'draft-top' }, teamCol(0), turnBox, teamCol(1)),
      h('div', { class: 'draft-main' }, h('div', { class: 'panel' }, filters, grid), info),
    ));
  }
  infoPanel(id, enemyPicks, myTurn, t) {
    const app = this.app, d = app.session.draft, me = app.session.myTeam;
    if (!id) return h('div', { class: 'panel info' }, h('div', { class: 'muted' }, 'Select a hero to see abilities and matchups.'),
      myTurn ? h('div', { class: 'gold', style: { marginTop: '10px' } }, t.act === 'ban' ? 'Ban a hero you fear.' : 'Pick a hero. You still need: ' + ROLES.filter((r) => !(assignRoles(d.picks[me]) || []).includes(r)).map((r) => ROLE_LABEL[r]).join(', ')) : null);
    const x = HERO_BY_ID[id];
    const mu = matchupScore(x, enemyPicks);
    const canAct = myTurn && legal(d, me, id);
    return h('div', { class: 'panel info' },
      h('div', { class: 'row' }, h('div', { class: 'face' }, h('img', { src: face(id) })), h('div', {}, h('h2', {}, x.name), h('div', { class: 't' }, `${x.title} · ${x.roles.map((r) => ROLE_LABEL[r]).join(' / ')} · ${x.curve} game`))),
      h('div', { class: 'tags' }, h('span', { class: 'tag', style: { background: CLANS[x.clan].color, color: '#111' } }, CLANS[x.clan].name), ...x.tags.map((tg) => h('span', { class: 'tag' }, tg)), h('span', { class: 'tag' }, x.dmgType === 'phys' ? 'physical' : 'magic'), h('span', { class: 'tag' }, x.ranged ? 'ranged' : 'melee')),
      h('div', { class: 'pers', style: { color: PERSONALITIES[x.pers].color } }, `${PERSONALITIES[x.pers].name} — `, h('span', { class: 'muted' }, PERSONALITIES[x.pers].desc)),
      h('div', { class: 'ab' }, h('img', { src: icon('LuckUpgrade') }), h('div', {}, h('b', {}, `Passive: ${x.passive.name}`), h('div', { class: 'd' }, x.passive.desc))),
      ...x.abilities.map((a) => h('div', { class: 'ab' }, h('img', { src: icon(a.icon) }), h('div', {}, h('b', {}, `${a.ult ? 'Ultimate: ' : ''}${a.name}`), h('div', { class: 'd' }, describeAbility(a))))),
      h('div', { class: 'muted', style: { fontSize: '10px', marginTop: '6px' } }, 'Builds: ' + x.builds.map((b) => BUILDS[b].name).join(', ')),
      enemyPicks.length ? h('div', { class: 'notes', style: { marginTop: '6px' } }, h('div', { class: 'muted' }, 'Vs enemy picks:'), ...(mu.notes.length ? mu.notes.map((n) => h('div', { class: /struggles|countered|into heavy/i.test(n) ? 'neg' : 'pos' }, '• ' + n)) : [h('div', { class: 'muted' }, '• Neutral matchup')])) : null,
      h('div', { style: { marginTop: '10px' } },
        myTurn ? h('button', { class: 'btn big', disabled: !canAct, style: { width: '100%' }, onclick: () => app.draftAct(id) }, t.act === 'ban' ? 'Ban ' + x.name : 'Lock in ' + x.name) : null,
        myTurn && !canAct && t.act === 'pick' ? h('div', { class: 'red', style: { fontSize: '10px', marginTop: '4px' } }, 'Your team already covers this hero\'s roles.') : null),
    );
  }
  tickTimer(left) { const el = document.getElementById('dtimer'); if (el) el.textContent = String(Math.max(0, Math.ceil(left))); }
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
export function showPrep(app, prep, enemyIds, left, onChange, onReady, ready) {
  const PLANS = { aggressive: 'Trade often, roam early, chase further.', balanced: 'Default risk.', scaling: 'Farm safely; avoid even fights before ~10 min.' };
  const card = (hp, i) => {
    const x = HERO_BY_ID[hp.id];
    return h('div', { class: 'panel pcard' },
      h('div', { class: 'head' }, h('div', { class: 'face' }, h('img', { src: face(hp.id) })),
        h('div', { class: 'col', style: { gap: '3px' } }, h('div', {}, x.name, ' ', h('span', { style: { color: PERSONALITIES[x.pers].color, fontSize: '10px' } }, PERSONALITIES[x.pers].name)),
          h('select', { disabled: ready, onchange: (e) => { const r = e.target.value; const other = prep.heroes.find((o) => o.role === r); if (other) other.role = hp.role; hp.role = r; onChange(); } },
            ...ROLES.map((r) => h('option', { value: r, selected: r === hp.role }, ROLE_LABEL[r] + (x.roles.includes(r) ? '' : ' (off-role)')))))),
      h('div', { class: 'bopts' }, ...x.builds.map((b) => h('div', { class: 'bopt' + (hp.build === b ? ' sel' : ''), onclick: () => { if (ready) return; hp.build = b; onChange(); } },
        h('div', { style: { color: BUILDS[b].color } }, BUILDS[b].name + (b === x.rec ? '  ★' : '')), h('div', { class: 'bd' }, BUILDS[b].desc),
        h('div', { class: 'items' }, ...BUILDS[b].items.map((it) => h('img', { src: icon(it.icon), title: `${it.name} (${it.cost}g)` })))))),
    );
  };
  mount(screen(), h('div', { class: 'prep' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', {}, 'Prep: lanes, builds & game plan'), h('div', { class: 'gold', id: 'ptimer', style: { fontSize: '24px' } }, String(Math.ceil(left)))),
    h('div', { class: 'panel enemyrow' }, h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Enemy:'), ...enemyIds.map((id) => {
      const x = HERO_BY_ID[id]; const mu = matchupScore(x, prep.heroes.map((p) => HERO_BY_ID[p.id]));
      return h('div', { class: 'row', style: { gap: '4px', fontSize: '11px' } }, h('img', { src: face(id), style: { width: '28px', height: '28px' } }), h('span', {}, x.name), h('span', { class: 'muted', style: { fontSize: '9px' } }, x.tags.slice(0, 2).join(',')), mu.score > 0 ? h('span', { class: 'red', style: { fontSize: '9px' } }, `(+${mu.score} vs you)`) : null);
    })),
    h('div', { class: 'prep-cards' }, ...prep.heroes.map(card)),
    h('div', { class: 'panel col' }, h('div', {}, 'Clan synergies'), h('div', { class: 'row' }, ...(() => {
      const c = {}; for (const p of prep.heroes) { const k = HERO_BY_ID[p.id].clan; c[k] = (c[k] || 0) + 1; }
      return Object.entries(c).map(([k, n]) => { const tier = CLANS[k].tiers.filter((t) => n >= t.n).pop(); return h('div', { class: 'bopt' + (tier ? ' sel' : ''), style: { borderColor: CLANS[k].color } }, h('div', { style: { color: CLANS[k].color } }, `${CLANS[k].name} ×${n}`), h('div', { class: 'bd' }, tier ? tier.text : `${CLANS[k].tiers[0].n} needed: ${CLANS[k].tiers[0].text}`)); });
    })())),
    h('div', { class: 'panel col' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', {}, 'Tactic deck'), h('span', { class: 'muted', style: { fontSize: '11px' } }, `pick 3 · ${prep.deck.length}/3`)),
      h('div', { class: 'deck' }, ...TACTIC_IDS.map((id) => {
        const t = TACTICS[id], on = prep.deck.includes(id);
        return h('div', { class: 'card' + (on ? ' sel' : ''), onclick: () => { if (ready) return; if (on) prep.deck = prep.deck.filter((d) => d !== id); else if (prep.deck.length < 3) prep.deck = [...prep.deck, id]; else prep.deck = [...prep.deck.slice(1), id]; onChange(); } },
          h('img', { src: icon(t.icon) }), h('div', { class: 'cn' }, t.name), h('div', { class: 'cd' }, t.desc));
      }))),
    h('div', { class: 'panel col' }, h('div', {}, 'Team plan'), h('div', { class: 'plans' }, ...Object.entries(PLANS).map(([k, d]) => h('div', { class: 'bopt' + (prep.plan === k ? ' sel' : ''), onclick: () => { if (ready) return; prep.plan = k; onChange(); } }, h('div', {}, k[0].toUpperCase() + k.slice(1)), h('div', { class: 'bd' }, d))))),
    h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn big', disabled: ready, onclick: onReady }, ready ? 'Waiting for opponent…' : 'Ready')),
  ));
}

// ───────────────────────── results ─────────────────────────
export function showResults(app, g, myTeam, onAgain, onMenu) {
  const win = g.winner;
  const verdict = myTeam < 0 ? `${TEAM_NAME[win] ?? '—'} wins` : win === myTeam ? 'VICTORY' : win < 0 ? 'NO CONTEST' : 'DEFEAT';
  const vcol = myTeam < 0 ? (win === 0 ? 'var(--blue)' : 'var(--red)') : win === myTeam ? 'var(--gold)' : 'var(--red)';
  const row = (x) => h('tr', {},
    h('td', {}, h('img', { class: 'f', src: face(x.heroId) }), ' ', x.def.name),
    h('td', { class: 'muted' }, ROLE_LABEL[x.role]), h('td', {}, x.level), h('td', {}, `${x.kills}/${x.deaths}/${x.assists}`), h('td', {}, x.cs),
    h('td', {}, Math.round(x.dmgHeroes)), h('td', {}, Math.round(x.goldEarned)), h('td', { style: { color: BUILDS[x.build].color } }, BUILDS[x.build].name),
    h('td', { class: 'its' }, ...x.items.map((it) => h('img', { src: icon(it.icon), title: it.name }))));
  const table = (t) => h('div', { class: 'panel' }, h('div', { class: TEAMC[t], style: { marginBottom: '4px' } }, `${TEAM_NAME[t]} · ${app.session.names[t]} — ${g.teams[t].kills} kills, ${g.teams[t].towers} towers, ${g.teams[t].dragons.length} drakes${g.teams[t].soul ? ' + ' + DRAGON_INFO[g.teams[t].soul].name + ' Soul' : ''}`),
    h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'tbl' }, h('tr', {}, ...['Hero', 'Role', 'Lv', 'KDA', 'CS', 'Dmg', 'Gold', 'Build', 'Items'].map((c) => h('th', {}, c))), ...g.teams[t].heroes.map(row))));
  const graph = h('canvas', { class: 'graph' });
  const calls = g.callLog.filter((c) => myTeam < 0 || c.team === myTeam);
  const callEl = h('div', { class: 'panel' }, h('div', {}, myTeam < 0 ? 'Calls' : 'Your calls'), h('div', { class: 'calllog' },
    ...(calls.length ? calls.map((c) => h('div', { class: 'row' }, h('span', { class: 'muted' }, fmtTime(c.t / 20)), h('span', { class: TEAMC[c.team] }, c.type.toUpperCase()), h('span', {}, c.lane || c.obj || ''), h('span', { class: 'badge ' + (c.result || 'null') }, c.result || 'pending'))) : [h('div', { class: 'muted' }, 'No calls made.')])));
  const all = [...g.teams[0].heroes, ...g.teams[1].heroes];
  const score = (x) => x.kills * 3 + x.assists * 1.5 - x.deaths + x.dmgHeroes / 1500 + x.cs / 40 + (x.team === win ? 4 : 0);
  const mvp = all.slice().sort((a, b) => score(b) - score(a))[0];
  mount(screen(), h('div', { class: 'results' },
    h('div', { class: 'verdict', style: { color: vcol } }, verdict),
    mvp ? h('div', { class: 'mvp panel' }, h('img', { src: face(mvp.heroId) }), h('div', {}, h('div', { class: 'gold' }, 'MVP'), h('div', {}, `${mvp.def.name} (${TEAM_NAME[mvp.team]})`), h('div', { class: 'muted', style: { fontSize: '11px' } }, `${mvp.kills}/${mvp.deaths}/${mvp.assists} · ${Math.round(mvp.dmgHeroes)} damage · ${mvp.cs} CS`))) : null,
    g.events.find((e) => e.type === 'victory' && e.timeout) ? h('div', { class: 'muted', style: { textAlign: 'center' } }, `Decided on time — towers standing ${g.towersStanding(0)} to ${g.towersStanding(1)}`) : null,
    h('div', { class: 'muted', style: { textAlign: 'center' } }, `Game length ${fmtTime(g.time)}`),
    table(0), table(1),
    h('div', { class: 'panel' }, h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Gold lead (Blue above / Red below)'), graph),
    callEl,
    h('div', { class: 'row', style: { justifyContent: 'center' } }, onAgain ? h('button', { class: 'btn big', onclick: onAgain }, 'Play again') : null, h('button', { class: 'btn big', onclick: onMenu }, 'Main menu')),
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
    ctx.strokeStyle = (diff[i] + diff[i - 1]) / 2 >= 0 ? '#4aa3ff' : '#ff5a5a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.fillStyle = '#a99fb3'; ctx.font = '10px PixelFont, monospace';
  ctx.fillText('+' + Math.round(mx / 100) / 10 + 'k', 4, 12); ctx.fillText('-' + Math.round(mx / 100) / 10 + 'k', 4, c.height - 4);
}
void DRAFT_ORDER;
