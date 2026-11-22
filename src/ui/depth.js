// Match depth in the HUD (v23, cfg.depth): live talent prompts, the item override and talent rows on
// the hero sheet, ult-upgrade / revenge / duo-ult news, rivalry chatter and the fight forecast.
// UI only: every choice goes out as a command (talent / item), so the sim stays in lockstep.
import { h, face, icon, setText } from './dom.js';
import { TICK_RATE, OBJ_NAME } from '../sim/constants.js';
import { heroTalents, TALENT_LEVELS, TALENT_WINDOW } from '../data/talents.js';
import { itemOptions, aiTalent } from '../sim/talents.js';
import { TEAM_COL } from '../render/renderer.js';
import { audio } from '../audio.js';
import { forecastFight } from './forecast.js';

const PRIO_TALENT = 35, PRIO_FORECAST = 45; // tray order: call 50 > forecast > request 40 > talent > surge 30
const PROMPT_MS = 5000;

export class Depth {
  constructor(hud) { this.hud = hud; this.g = hud.g; this.my = hud.my; this.fmem = {}; this.fNext = 0; }
  get dock() { return this.hud.dock; }
  mine(x) { return this.my >= 0 && x && x.team === this.my && this.hud.ownHero(x); }

  // ── sim events (Hud.processEvents) ──
  event(e) {
    const g = this.g, hud = this.hud;
    switch (e.type) {
      case 'talent': {
        const x = g.byId(e.hero); if (!x) break;
        if (e.live) { if (x.team === this.my) hud.ticker(`${x.def.name} takes ${this.talName(x, e.tier, e.pick)}`, 'n', 0); break; }
        // the hero picked on its own (no coach default for this tier): offer the swap for a few seconds
        // (at most one prompt per 15s, so a team levelling together does not flood the tray; the rest stay on the hero's pick)
        if (e.auto && this.mine(x) && !hud.holding() && hud.mode !== 'watch' && performance.now() - (this.promptAt || -1e9) > 15000) { this.promptAt = performance.now(); this.talentPrompt(x, e.tier, e.pick); }
        break;
      }
      case 'ultUp': {
        const x = g.byId(e.hero); if (!x) break;
        if (x.team === this.my) hud.ticker(`${x.def.name}'s ultimate is EMPOWERED (${e.why === 'streak' ? 'kill streak' : 'objective'})`, 'act', 0); // (its portrait's ult dot glows too)
        else if (this.my < 0) hud.ticker(`${x.def.name}'s ultimate is empowered`, x.team === 0 ? 'b' : 'r', 0);
        break;
      }
      case 'revenge': {
        const x = g.byId(e.hero), v = g.byId(e.victim); if (!x || !v) break;
        if (x.team === this.hud.view || this.my < 0) hud.ticker(`REVENGE! ${x.def.name} paid back ${v.def.name}`, x.team === this.my ? 'act' : x.team === 0 ? 'b' : 'r', 2);
        break;
      }
      case 'duoUlt':
        if (e.team === this.hud.view || this.my < 0) hud.banner('DUO ULT: ' + e.name.toUpperCase(), TEAM_COL[e.team], 1600);
        else hud.ticker(`Enemy duo ult: ${e.name}!`, 'danger', 3);
        break;
      case 'itemPick': {
        const x = g.byId(e.hero);
        if (x && x.team === this.my) hud.ticker(e.auto ? `${x.def.name} is back on the auto build` : `${x.def.name} buys ${e.item} next`, 'n', 0);
        break;
      }
    }
  }
  talName(x, tier, pick) { const t = heroTalents(x.heroId)[tier]; return t && t[pick] ? t[pick].name : 'a talent'; }

  // Live talent prompt: the hero's own pick is already in; a tap swaps it within the window.
  talentPrompt(x, tier, pick) {
    const dock = this.dock, opts = heroTalents(x.heroId)[tier]; if (!dock || !dock.tray || !opts) return;
    const until = x.talAt[tier] + (TALENT_WINDOW - 0.5) * TICK_RATE;
    dock.tray.push({ key: `tal:${x.id}:${tier}`, prio: PRIO_TALENT, ttl: PROMPT_MS, staleMs: 1800, cls: 'req mine talq',
      valid: () => this.g.tick < until && x.tal[tier] >= 0,
      build: (it) => [h('img', { class: 'tface', src: face(x.heroId) }),
        h('span', { class: 'tx' }, h('b', {}, `${x.def.name} L${TALENT_LEVELS[tier]}: `), 'talent'),
        ...opts.map((t, k) => {
          const b = h('button', { class: 'tch tal' + (x.tal[tier] === k ? ' on' : ''), title: t.text, onclick: () => {
            if (x.tal[tier] !== k) dock.send({ type: 'talent', hero: x.id, tier, pick: k });
            dock.tray.end(it, 'chosen');
          } }, h('img', { src: icon(t.icon), alt: '' }), h('span', { class: 'tl' }, t.name), h('small', {}, x.tal[tier] === k ? 'picked' : 'swap'));
          return b;
        })],
      onShow: () => audio.sfx('alert2', 0.3) });
  }

  // ── hero sheet rows (Dock.sheetBody 'hero:'): next item (auto + 1-2 alternatives) and talents ──
  sheetRows(x, theirs) {
    const dock = this.dock, g = this.g, rows = [];
    const itemRow = h('div', { class: 'sh-row dp-items' }, h('span', { class: 'muted' }, 'Next item'));
    const items = h('span', { class: 'dp-chips' }); itemRow.append(items);
    let key = '';
    const drawItems = () => {
      const opts = itemOptions(x), pick = x.itemPick && x.itemPick.name, k = opts.map((o) => o.name).join() + '|' + pick;
      if (k === key) return; key = k;
      items.replaceChildren(...(opts.length ? opts.map((it, i) => h('button', { class: 'chip dp-it' + ((i === 0 ? !pick : pick === it.name) ? ' on' : ''), disabled: theirs, title: `${it.name} (${it.cost}g)${i ? ' · from another build' : ' · auto (build path)'}`,
        onclick: () => dock.send({ type: 'item', hero: x.id, item: it.name }) }, h('img', { src: icon(it.icon), alt: '' }), h('span', {}, i === 0 ? 'Auto' : it.name.split(' ')[0]), h('small', {}, `${it.cost}g`)))
        : [h('small', { class: 'muted' }, 'Full build')]));
    };
    drawItems(); dock.live.push(drawItems);
    rows.push(itemRow);
    const talRow = h('div', { class: 'sh-row dp-tal' }, h('span', { class: 'muted' }, 'Talents'));
    const tchips = h('span', { class: 'dp-chips' }); talRow.append(tchips);
    let tkey = '';
    const drawTal = () => {
      const tiers = heroTalents(x.heroId), k = x.tal.join() + x.talPref.join() + x.level + (g.tick >> 4);
      if (k === tkey) return; tkey = k;
      tchips.replaceChildren(...tiers.map((opts, i) => {
        const taken = x.tal[i] >= 0, open = taken && g.tick <= x.talAt[i] + (TALENT_WINDOW - 0.5) * TICK_RATE;
        const cur = taken ? x.tal[i] : x.talPref[i], shown = cur >= 0 ? opts[cur] : opts[aiTalent(g, x, i)];
        const next = taken ? 1 - x.tal[i] : x.talPref[i] < 0 ? 0 : x.talPref[i] === 0 ? 1 : -1;
        const lab = taken ? shown.name : cur < 0 ? 'Auto' : shown.name;
        return h('button', { class: 'chip dp-t' + (taken ? ' taken' : '') + (open ? ' open' : ''), disabled: theirs || (taken && !open),
          title: `Level ${TALENT_LEVELS[i]}: ${taken ? 'took' : cur < 0 ? 'hero decides (now leaning to)' : 'will take'} ${shown.name}: ${shown.text}${taken ? (open ? ' · tap to swap' : '') : ' · tap to change'}`,
          onclick: () => dock.send({ type: 'talent', hero: x.id, tier: i, pick: next }) },
          h('img', { src: icon(shown.icon), alt: '' }), h('span', {}, `L${TALENT_LEVELS[i]} ${lab}`));
      }));
    };
    drawTal(); dock.live.push(drawTal);
    rows.push(talRow);
    return rows;
  }

  // ── fight forecast (Hud.analyst, ~1/s): one tray prompt, at most every 25s ──
  tick() {
    const g = this.g, hud = this.hud;
    if (this.my < 0 || g.over || hud.mode === 'watch') return;
    const f = forecastFight(g, this.my, this.fmem);
    if (!f || g.tick < this.fNext || hud.holding() || hud.dock.sheetId || !hud.isLead()) return;
    if (hud.dock.tray.items.some((i) => i.prio >= PRIO_FORECAST)) return;
    this.fNext = g.tick + 25 * TICK_RATE;
    this.showForecast(f);
  }
  showForecast(f) {
    const g = this.g, hud = this.hud, dk = hud.dock, tray = dk.tray;
    const t0 = g.tick, good = f.edge >= 0;
    const title = () => { const s = Math.max(1, f.eta - Math.round((this.g.tick - t0) / TICK_RATE)); return `${f.mine}v${f.theirs}${f.unseen ? '+?' : ''} at ${f.where} in ${s}s`; };
    const go = f.obj && this.g.objAvailable(f.obj) ? { label: 'Go', sub: `Take ${OBJ_NAME[f.obj]}`, cmd: { type: 'objective', obj: f.obj } }
      : { label: 'Go', sub: 'All-in, ults ready', cmd: { type: 'ult', mode: 'go' } };
    const back = { label: 'Back off', sub: 'Hold at towers', cmd: { type: 'safe' } };
    hud.mm.ping(f.at.x, f.at.y, good ? '#ffd84a' : '#ff5a5a');
    tray.push({ key: 'fc' + t0, prio: PRIO_FORECAST, at: f.at, ttl: Math.min(8000, f.eta * 1000), cls: 'ccall fcast ' + (good ? 'act' : 'danger'),
      build: (it) => {
        const tt = h('span', {}, title()); it.upd = () => setText(tt, title());
        return [h('div', { class: 'tc-head' }, h('b', {}, 'FIGHT FORECAST'), tt),
          h('div', { class: 'tc-text' }, good ? (f.unseen ? `You have the numbers we can see. ${f.unseen} enemy unseen.` : 'You have the numbers.') : `They have more heroes there${f.unseen ? `, and ${f.unseen} unseen` : ''}.`),
          h('div', { class: 'tc-opts' }, dk.choice(good ? go : back, it), dk.choice(good ? back : go, it))];
      },
      onShow: () => audio.sfx('alert', 0.5) });
  }
}
