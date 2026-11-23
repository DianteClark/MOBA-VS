// Draft screen (landscape-first): both teams' slots across the top, the hero grid with role tabs,
// and a side panel with the selected hero, the preset auto-pick, or the "pick for this role" prompt.
import { kamiCard } from './beastsui.js';
import { h, mount, face, icon } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, matchupScore, PERSONALITIES } from '../data/heroes.js';
import { currentTurn, taken, legal, TURN_SECONDS } from '../sim/draft.js';
import { CLANS } from '../sim/constants.js';
import { duosOf, compOf, COMPS } from '../data/synergy.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { EVENT_BY_ID } from '../data/events.js';
import { pickScore, suggestedBans, teamRoles, presetRole } from '../presets.js';
import { describeAbility } from './herotext.js';
import { statBars } from './heroui.js';
import { audio } from '../audio.js';
import { BUILDS } from '../data/items.js';
import { profile } from '../profile.js';
import { masteryBadge } from './badges.js';
import { compLine } from './comp.js';
import { buildLine } from './buildguide.js';
import { searchBox, applySearch, clanChip } from './herosearch.js';
import { rivalDraftNote, rivalFaceImg } from './rivals.js';
import { RIVAL_BY_ID } from '../data/rivals.js';
import { draftLegal, draftWho, rolesLine, coachOf, COOP_COL } from '../coop-room.js';
import { coopRoles, seatRoles } from '../sim/coop.js';
import { ownershipOn, usable, access, openRoles, fitsRole, stepFor, ownedAutoPick } from '../unlocks.js';
import { accessBadge } from './shop.js';
import { heroInfo } from './heroinfo.js';

const screen = () => document.getElementById('screen');
export const AUTO_GRACE = 1.2; // seconds before a preset auto-pick locks in

export class DraftView {
  constructor(app) { this.app = app; this.sel = null; this.filter = 'all'; this.query = ''; this.scroll = 0; this.promptTurn = -1; this.showAll = false; }

  // Can this coach lock this hero now? (Co-op: it must fit one of their own open roles.)
  legal(id) { const s = this.app.session; return s.mode === 'coop' ? draftLegal(s, id) : legal(s.draft, s.myTeam, id); }
  // ── role steps (champion ownership, src/unlocks.js) ──
  openRoles() { return openRoles(this.app.session); }
  fits(id, role) { return fitsRole(this.app.session, id, role, (x) => this.legal(x)); }
  // Is this my pick turn with ownership on? Then the grid shows one role step at a time.
  stepMode() { const s = this.app.session, t = currentTurn(s.draft); return !!t && t.act === 'pick' && !s.draft.done && s.mode !== 'watch' && this.app.myDraftTurn() && ownershipOn(s); }
  // The current step's role (kept valid), with a loaner lent when nothing usable is left for it.
  stepRole() { this.step = stepFor(profile, this.app.session, this.step, (x) => this.legal(x)); return this.step; }
  // Ownership-aware timeout / auto choice for my pick (null for bans and sessions without ownership).
  ownedAuto() {
    if (!this.stepMode()) return null;
    const c = ownedAutoPick(profile, this.app.session, this.step, (x) => this.legal(x));
    if (c) this.step = c.role;
    return c ? c.id : null;
  }
  // REC / BAN? badges: best picks for the team, or the suggested bans.
  recommend(d, me, t) {
    if (!t || t.team !== me || d.done) return [];
    if (t.act === 'ban') return suggestedBans(d, me, this.app.session.preset);
    const tk = taken(d, me), step = this.stepMode() ? this.stepRole() : null;
    return HEROES.filter((x) => !tk.has(x.id) && (step ? usable(profile, this.app.session, x.id) && this.fits(x.id, step) : this.legal(x.id))).map((x) => [pickScore(d, me, x), x.id]).filter((q) => q[0] > 0)
      .sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1)).slice(0, 3).map((q) => q[1]);
  }
  select(id) {
    const s = this.app.session;
    if (s.autoPick) this.app.cancelAutoPick();
    this.sel = id; audio.sfx('move', 0.4); this.render();
  }

  render() {
    const app = this.app, s = app.session, d = s.draft, me = s.myTeam;
    const t = currentTurn(d), myTurn = !!t && s.mode !== 'watch' && app.myDraftTurn();
    const coop = s.mode === 'coop', who = coop ? draftWho(s) : null, mate = who && who.team === me && !myTurn ? coachOf(s, who.team, who.seat) : null;
    const ban = !!t && t.act === 'ban', tk = taken(d, me), ev = s.event && EVENT_BY_ID[s.event];
    const enemyPicks = d.picks[1 - Math.max(0, me)].map((id) => HERO_BY_ID[id]);
    const recs = myTurn ? this.recommend(d, me, t) : [];
    // a prompt for one role opens the grid on that role (once per turn)
    if (s.pickPrompt && this.promptTurn !== d.turn) { this.promptTurn = d.turn; this.filter = this.step = s.pickPrompt.prompt; this.scroll = 0; this.sel = null; this.promptFilter = true; }
    else if (!s.pickPrompt && this.promptFilter && this.promptTurn !== d.turn) { this.filter = 'all'; this.scroll = 0; this.promptFilter = false; }
    const prevGrid = document.querySelector('.draft .grid'); if (prevGrid) this.scroll = prevGrid.scrollTop;

    const teamBar = (team) => {
      const picks = d.picks[team], bans = d.bans[team];
      const split = coop && s.coop[team] && s.coop[team].seats === 2 ? s.coop[team] : null;
      const roles = (split ? coopRoles(d, team, split.own) : team === me ? teamRoles(picks, s.preset, s.pickRoles) : teamRoles(picks, null)) || [];
      const acting = t && t.team === team;
      const pickSlots = Array.from({ length: 5 }, (_, i) => {
        const id = picks[i], active = acting && t.act === 'pick' && i === picks.length;
        const auto = active && team === me && s.autoPick;
        // co-op: each pick framed in its coach's colour
        const seat = split ? (id ? d.seats[team][i] : acting && who && who.team === team ? who.seat : null) : null;
        const off = id && roles[i] && !HERO_BY_ID[id].roles.includes(roles[i]);
        return h('div', { class: 'slot' + (active ? ' active' : '') + (id ? ' filled' : '') + (auto ? ' auto' : '') + (seat !== null && seat !== undefined ? ' cs' : ''), style: seat !== null && seat !== undefined ? { '--sc': COOP_COL[seat] } : null,
          ...(id ? { role: 'button', tabindex: '0', title: `${HERO_BY_ID[id].name}: stats and abilities`, onclick: () => heroInfo(id, { note: roles[i] ? `Plays ${ROLE_LABEL[roles[i]]}${off ? ' (off-role)' : ''}` : null }) } : {}) },
          id ? h('img', { src: face(id) }) : auto ? h('img', { class: 'ghost', src: face(s.autoPick.id) }) : null, off ? h('span', { class: 'offr', title: 'Off-role' }, 'OFF') : null,
          auto ? h('b', { class: 'acd', id: 'autocd' }, '') : null,
          id ? h('span', { class: 'role' }, ROLE_LABEL[roles[i]] || '') : null);
      });
      const banSlots = Array.from({ length: 3 }, (_, i) => {
        const id = bans[i], active = acting && t.act === 'ban' && i === bans.length;
        return h('div', { class: 'slot ban' + (active ? ' active' : '') + (id ? ' filled' : ''), ...(id ? { role: 'button', tabindex: '0', title: `${HERO_BY_ID[id].name} (banned): stats and abilities`, onclick: () => heroInfo(id, { note: 'Banned this match' }) } : {}) }, id ? h('img', { src: face(id) }) : null);
      });
      return h('div', { class: 'dteam t' + team + (acting ? ' acting' : '') },
        h('div', { class: 'tname' }, h('span', { class: 'tdot' }), team !== me && s.rival && RIVAL_BY_ID[s.rival] ? rivalFaceImg(RIVAL_BY_ID[s.rival], 18) : null, h('span', { class: 'tn' }, s.names[team]), team === me ? h('small', {}, 'you') : null,
          team === me && s.preset && !picks.length ? h('span', { class: 'lineup', title: 'Active lineup: picks lock in automatically' }, '★ ' + s.preset.name) : null,
          compLine(picks, tk)),
        h('div', { class: 'slots' }, h('div', { class: 'picks' }, pickSlots), h('div', { class: 'bans' }, banSlots)));
    };
    const left = Math.ceil(s.turnLeft ?? TURN_SECONDS);
    const turnBox = h('div', { class: 'dturn' + (t ? ' t' + t.team : '') + (myTurn ? ' mine' : '') + (ban ? ' isban' : '') },
      h('div', { class: 'what' }, d.mirror ? `Mirror Match · ${d.mirror.name}` : d.done ? 'Draft complete!' : myTurn ? `YOUR ${ban ? 'BAN' : 'PICK'}` : (ban ? `${mate ? mate.name : s.names[t.team]} bans` : `${mate ? mate.name : s.names[t.team]} picks`)),
      d.done ? null : h('div', { class: 'timer', id: 'dtimer' }, String(left)),
      d.done ? null : h('div', { class: 'tbar' }, h('i', { id: 'dtbar', style: { width: Math.max(0, left / TURN_SECONDS * 100) + '%' } })),
      h('div', { class: 'mapname' }, (MAP_BY_ID[s.mapId] || MAPS[0]).name),
      kamiCard(MAP_BY_ID[s.mapId], true), // Bosses & Beasts: what this map's Kami blesses
      ev ? h('div', { class: 'evname', style: { '--ec': ev.color }, title: ev.blurb }, ev.name) : null);

    // My pick with champion ownership: one role step at a time (Top → Support), only heroes I may use for it.
    const steps = this.stepMode(), need = steps ? this.openRoles() : null, step = steps ? this.stepRole() : null;
    if (steps) this.filter = step;
    const own = ownershipOn(s) && me >= 0, mayUse = (id) => !own || usable(profile, s, id);
    const POOL = steps ? HEROES.filter((x) => mayUse(x.id)) : HEROES;
    const counts = { all: POOL.length }; for (const r of ROLES) counts[r] = POOL.filter((x) => x.roles.includes(r) && (!steps || !tk.has(x.id))).length;
    const hadFocus = this.searchEl && document.activeElement === this.searchEl.input;
    this.searchEl = searchBox(this.query, (q) => { this.query = q; this.filterGrid(); });
    const tabRoles = steps ? need : ['all', ...ROLES];
    const tabs = h('div', { class: 'rtabs' + (steps ? ' steps' : ''), role: 'tablist' }, ...tabRoles.map((r) => h('button', { class: 'rtab' + (this.filter === r ? ' on' : ''), role: 'tab',
      title: steps ? `Pick your ${ROLE_LABEL[r]}` : null, onclick: () => { this.filter = r; if (steps) this.step = r; this.scroll = 0; this.render(); } }, r === 'all' ? 'All' : (steps ? `${ROLES.indexOf(r) + 1} ` : '') + ROLE_LABEL[r], h('small', {}, counts[r]))),
      clanChip(this.clan, (c) => { this.clan = c; this.scroll = 0; this.render(); }), this.searchEl);
    const banChips = myTurn && ban && recs.length ? h('div', { class: 'sugbans' }, h('span', { class: 'lab' }, 'Suggested bans'),
      ...recs.map((id) => h('button', { class: 'sugban' + (this.sel === id ? ' on' : ''), onclick: () => this.select(id) }, h('img', { src: face(id) }), HERO_BY_ID[id].name))) : null;
    const list = POOL.filter((x) => (this.filter === 'all' || x.roles.includes(this.filter)) && (!this.clan || x.clan === this.clan))
      .sort((a, b) => this.filter === 'all' ? ROLES.indexOf(a.role) - ROLES.indexOf(b.role) : (a.role === this.filter ? 0 : 1) - (b.role === this.filter ? 0 : 1)); // main role first
    list.sort((a, b) => (tk.has(a.id) ? 1 : 0) - (tk.has(b.id) ? 1 : 0) || (recs.includes(b.id) ? 1 : 0) - (recs.includes(a.id) ? 1 : 0));
    // A role step lists the heroes that fit it; "All champions" opens every other hero: usable ones can be locked
    // off-role for this step, locked ones are there to read (stats, abilities) and unlock later.
    const inList = new Set(list.map((x) => x.id));
    const more = steps && this.showAll ? HEROES.filter((x) => !inList.has(x.id) && (!this.clan || x.clan === this.clan))
      .sort((a, b) => (mayUse(a.id) ? 0 : 1) - (mayUse(b.id) ? 0 : 1) || (tk.has(a.id) ? 1 : 0) - (tk.has(b.id) ? 1 : 0) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name < b.name ? -1 : 1)) : [];
    const card = (x) => {
      const off = tk.has(x.id), bad = !off && myTurn && !ban && !this.legal(x.id);
      const ms = enemyPicks.length && !off ? matchupScore(x, enemyPicks).score : 0;
      const pers = PERSONALITIES[x.pers], rec = recs.includes(x.id), mine = presetRole(s.preset, x.id), acc = own ? access(profile, s, x.id) : 'own';
      return h('button', { class: 'hcard' + (off ? ' off' : '') + (bad ? ' bad' : '') + (this.sel === x.id ? ' sel' : '') + (rec ? ' rec' : '') + (!acc && !ban ? ' lockd' : ''), disabled: off, 'data-hero': x.id,
        style: { '--cc': CLANS[x.clan].color }, title: `${x.name} · ${CLANS[x.clan].name} · ${pers.name}`, onclick: () => { if (!off) this.select(x.id); } },
        h('div', { class: 'fwrap' }, h('img', { src: face(x.id) }), ms ? h('span', { class: 'score ' + (ms > 0 ? 'pos' : 'neg') }, (ms > 0 ? '+' : '') + ms) : null,
          mine ? h('span', { class: 'mine', title: 'In your lineup' }, '★') : null, me >= 0 ? masteryBadge(profile.mastery(x.id).lv) : null, own && acc !== 'own' ? accessBadge(acc) : null),
        rec ? h('span', { class: 'recb' + (ban ? ' banb' : '') }, ban ? 'BAN?' : 'REC') : null,
        h('div', { class: 'n' }, x.name));
    };
    const nMore = steps ? HEROES.filter((x) => !inList.has(x.id) && mayUse(x.id) && !tk.has(x.id)).length : 0;
    const grid = h('div', { class: 'grid' }, ...list.map(card),
      steps ? h('button', { class: 'allc' + (this.showAll ? ' on' : ''), 'aria-expanded': String(this.showAll), onclick: () => { this.showAll = !this.showAll; audio.sfx('move', 0.4); this.render(); } },
        this.showAll ? 'Hide other champions' : `All champions · ${nMore} more you can play as ${ROLE_LABEL[step]} (off-role)`) : null,
      ...(more.length ? [h('div', { class: 'allh' }, `Off-role as ${ROLE_LABEL[step]}, then champions you don't own (tap to read them)`), ...more.map(card)] : []));
    mount(screen(), h('div', { class: 'draft' + (ban && !d.done ? ' banphase' : '') + (myTurn ? ' myturn' : '') },
      h('div', { class: 'dtop' }, teamBar(0), turnBox, teamBar(1)),
      h('div', { class: 'dmain' },
        h('div', { class: 'dpool' }, h('div', { class: 'dphead' }, tabs, banChips), grid),
        this.side(enemyPicks, myTurn, t, recs))));
    this.grid = grid;
    this.filterGrid();
    grid.scrollTop = this.scroll;
    if (hadFocus) { const i = this.searchEl.input; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    this.tickTimer(s.turnLeft ?? TURN_SECONDS);
  }
  // Search filters the cards in place; an empty result says so instead of showing a blank grid.
  filterGrid() {
    const g = this.grid; if (!g) return;
    const n = applySearch(g, (id) => HERO_BY_ID[id], this.query);
    let none = g.querySelector('.gnone');
    if (!n && !none) g.append(none = h('div', { class: 'gnone muted' }, `No hero matches "${this.query}"`));
    else if (n && none) none.remove();
    if (none) none.textContent = `No hero matches "${this.query}"`;
  }

  side(enemyPicks, myTurn, t, recs) {
    const app = this.app, s = app.session, d = s.draft, me = s.myTeam;
    const wrap = (cls, body, foot) => h('div', { class: 'dside ' + cls }, h('div', { class: 'dsbody' }, body), foot ? h('div', { class: 'dsfoot' }, foot) : null);
    // 1) preset auto-pick about to land
    if (myTurn && s.autoPick && !this.sel) {
      const a = s.autoPick, x = HERO_BY_ID[a.id];
      return wrap('autop', [
        h('div', { class: 'sidek' }, a.backup ? `Backup for ${ROLE_LABEL[a.role]}` : `Lineup pick · ${ROLE_LABEL[a.role]}`),
        h('div', { class: 'ihead' }, h('div', { class: 'face' }, h('img', { src: face(a.id) })), h('div', { class: 'icol' }, h('h2', {}, x.name), h('div', { class: 't' }, x.title))),
        a.backup ? h('div', { class: 'muted small' }, `${HERO_BY_ID[s.preset.main[a.role]].name} is gone, so your backup steps in.`) : null,
        h('div', { class: 'autoline' }, 'Locking in ', h('b', { id: 'autocd2' }, ''), ' · tap any hero to choose yourself')],
      [h('button', { class: 'btn big lockbtn', onclick: () => app.lockAutoPick() }, 'Lock now')]);
    }
    // 2) preset hero + backup gone: focused prompt for that role
    if (myTurn && s.pickPrompt && !this.sel) {
      const p = s.pickPrompt, role = p.prompt, pr = s.preset;
      const gone = [pr.main[role], pr.backup[role]].filter(Boolean).map((id) => HERO_BY_ID[id].name);
      return wrap('prompt', [
        h('div', { class: 'sidek' }, `Pick your ${ROLE_LABEL[role]}`),
        h('div', { class: 'muted small' }, gone.length ? `${gone.join(' and ')} ${gone.length > 1 ? 'are' : 'is'} gone. Recommended:` : 'Recommended:'),
        h('div', { class: 'precs' }, ...p.recs.map((id) => { const x = HERO_BY_ID[id], ms = matchupScore(x, enemyPicks).score;
          return h('button', { class: 'prec', onclick: () => app.draftAct(id) }, h('img', { src: face(id) }), h('span', { class: 'pn' }, x.name, h('small', {}, x.title)),
            ms ? h('b', { class: ms > 0 ? 'pos' : 'neg' }, (ms > 0 ? '+' : '') + ms) : null, h('span', { class: 'go' }, 'Lock')); })),
        h('div', { class: 'muted small' }, 'Or tap any hero in the grid.')]);
    }
    const id = this.sel;
    if (!id) {
      const split = s.mode === 'coop' && s.coop[me] && s.coop[me].seats === 2 ? s.coop[me] : null;
      const have = split ? coopRoles(d, me, split.own).filter((_, i) => d.seats[me][i] === s.mySeat) : teamRoles(d.picks[Math.max(0, me)], s.preset, s.pickRoles) || [];
      const need = (split ? seatRoles(split.own, s.mySeat) : ROLES).filter((r) => !have.includes(r)).map((r) => ROLE_LABEL[r]);
      const who = s.mode === 'coop' && !d.done ? draftWho(s) : null, mateTurn = who && who.team === me && who.seat !== s.mySeat ? coachOf(s, me, who.seat) : null;
      return wrap('empty', [
        split ? h('div', { class: 'coopline' }, rolesLine(s)) : null,
        h('div', { class: 'hint' }, d.done ? 'Locked in. Prep starts soon...' : mateTurn ? (t.act === 'ban' ? `${mateTurn.name} is banning...` : `${mateTurn.name} is picking...`) : !myTurn ? 'Waiting for the other side...'
          : t.act === 'ban' ? 'Your ban: remove a hero you fear.' : `Your pick. Still needed: ${need.join(', ')}`),
        h('div', { class: 'muted small' }, myTurn && t.act === 'ban' ? (recs.length ? 'Suggested bans counter your lineup.' : 'Tap a hero to ban it.')
          : recs.length && myTurn ? 'Heroes marked REC suit your draft.' : 'Tap a hero to see abilities and matchups.'),
        !s.preset && me >= 0 && !d.done && s.mode !== 'coop' ? h('div', { class: 'muted small' }, 'Tip: set up a lineup in the Dojo and your picks lock in automatically.') : null,
        myTurn && t.act === 'pick' && this.step && s.loaners && s.loaners[this.step] ? h('div', { class: 'loanline' }, accessBadge('loan'), ` ${HERO_BY_ID[s.loaners[this.step]].name} is on loan for your ${ROLE_LABEL[this.step]} this match.`) : null,
        rivalDraftNote(s)]);
    }
    const x = HERO_BY_ID[id], pers = PERSONALITIES[x.pers], clan = CLANS[x.clan];
    const ban = t && t.act === 'ban', mayUse = ban || !ownershipOn(s) || usable(profile, s, id), canAct = myTurn && this.legal(id) && mayUse, mu = matchupScore(x, enemyPicks);
    const inLineup = presetRole(s.preset, id);
    const offStep = myTurn && !ban && this.stepMode() && this.step && !x.roles.includes(this.step) ? this.step : null; // locking it plays this role off-role
    return wrap('info' + (ban ? ' isban' : ''), [
      h('div', { class: 'ihead' }, h('div', { class: 'face' }, h('img', { src: face(id) })),
        h('div', { class: 'icol' }, h('h2', {}, x.name), h('div', { class: 't' }, `${x.roles.map((r) => ROLE_LABEL[r]).join(' / ')} · ${x.ranged ? 'Ranged' : 'Melee'}`),
          h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': clan.color } }, clan.name), h('span', { class: 'chipx', style: { '--cc': pers.color }, title: pers.desc }, pers.name)))),
      myTurn && ban && inLineup ? h('div', { class: 'warnline' }, `${x.name} is in your lineup (${ROLE_LABEL[inLineup]}).`) : null,
      myTurn && !canAct ? h('div', { class: 'warnline' }, taken(d, me).has(id) ? 'Already banned or picked.' : !mayUse ? `You don't own ${x.name} yet: unlock it in the Shop, or Try it vs AI.` : 'Your roles are all filled.') : null,
      canAct && offStep ? h('div', { class: 'offline2' }, `Off-role: ${x.name} will play ${ROLE_LABEL[offStep]} (usually ${x.roles.map((r) => ROLE_LABEL[r]).join(' / ')}).`) : null,
      statBars(id, true),
      h('div', { class: 'chips dbuilds' }, ...x.builds.map((b) => h('span', { class: 'chipx', style: { '--cc': BUILDS[b].color }, title: buildLine(b), 'data-build': b, 'data-build-info': true }, BUILDS[b].name + (b === x.rec ? ' ★' : '')))),
      h('div', { class: 'abl' },
        h('div', { class: 'ab' }, h('img', { src: icon('LuckUpgrade') }), h('div', {}, h('b', {}, x.passive.name), h('div', { class: 'd' }, x.passive.desc))),
        ...x.abilities.map((a) => h('div', { class: 'ab' + (a.ult ? ' ult' : '') }, h('img', { src: icon(a.icon) }), h('div', {}, h('b', {}, (a.ult ? 'Ult: ' : '') + a.name), h('div', { class: 'd' }, describeAbility(a)))))),
      enemyPicks.length ? h('div', { class: 'notes' }, ...(mu.notes.length ? mu.notes.map((n) => h('div', { class: /struggles|countered|into heavy/i.test(n) ? 'neg' : 'pos' }, n)) : [h('div', { class: 'muted' }, 'Neutral into their picks')])) : null,
      synergyNotes(id, me >= 0 ? d.picks[me] : []),
      h('button', { class: 'chip hinfobtn', title: 'Talents, builds and lore', onclick: () => heroInfo(id) }, 'Talents, builds and lore ›')],
    myTurn ? [h('button', { class: 'btn big lockbtn' + (ban ? ' banbtn' : ''), disabled: !canAct, onclick: () => app.draftAct(id) }, (ban ? 'Ban ' : 'Lock ') + x.name)] : null);
  }

  tickTimer(left) {
    const el = document.getElementById('dtimer');
    if (el) { const v = String(Math.max(0, Math.ceil(left))); if (el.textContent !== v) { el.textContent = v; if (left < 6) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); } } }
    const b = document.getElementById('dtbar'); if (b) b.style.width = Math.max(0, left / TURN_SECONDS * 100) + '%';
    const a = this.app.session.autoPick;
    if (a) { const v = Math.max(0, (a.at - performance.now()) / 1000).toFixed(1) + 's'; for (const k of ['autocd', 'autocd2']) { const e = document.getElementById(k); if (e) e.textContent = v; } }
  }
}

// Duo partners and team-comp progress (v20 synergy; minimal text for now).
function synergyNotes(id, mine) {
  const rows = duosOf(id).map((q) => h('div', { class: mine.includes(q.partner) ? 'pos' : 'muted' }, `Duo ${q.name} with ${HERO_BY_ID[q.partner].name}${mine.includes(q.partner) ? ' (ready)' : ''}`));
  if (mine.length && !mine.includes(id)) { const c = compOf([...mine, id]); rows.push(h('div', { class: c.active ? 'pos' : 'muted' }, `Comp: ${c.name} ${Math.min(c.count, c.need)}/${c.need}${c.active ? ` · ${COMPS[c.id].bonus}` : ''}`)); }
  return rows.length ? h('div', { class: 'notes' }, ...rows) : null;
}

