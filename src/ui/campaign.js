// Story campaign screens: the chapter map (six chapters of five missions, the Coach Academy on top), mission
// briefings, the comic story panels between chapters, the results panel (stars, Koban, Next mission) and the
// first-launch offer of the guided match. Logic and progress: src/campaign.js; data: src/data/campaign.js.
import { h, mount, face, toast, MODE_LABEL } from './dom.js';
import { audio } from '../audio.js';
import { comicPanel } from './lore.js';
import { guideSetup } from './tutorial.js';
import { mapThumb } from './screens.js';
import { MAP_BY_ID, RUSH_MAPS } from '../maps/defs.js';
import { EVENT_BY_ID } from '../data/events.js';
import { rivalFace } from '../data/rivals.js';
import { HERO_BY_ID, ROLE_LABEL } from '../data/heroes.js';
import { PLAN_INFO } from '../data/plans.js';
import { CHAPTERS, CHAPTER_BY_N, MISSIONS, missionsOf, goalText, STAR_KOBAN, TUTORIAL_KOBAN } from '../data/campaign.js';
import { maskOf, unlocked, chapterOpen, chapterDone, currentChapter, chapterSeen, markChapter, totalStars, MAX_STARS, missionStars,
  startMission, startTutorial, tutorialDone, tutorialResumes, tut, skipTutorial, rivalOf, markOffered, nextMission } from '../campaign.js';

const screen = () => document.getElementById('screen');
const KOBAN = 'assets/img/items/MoneyBag.png';
const ROLES5 = ['top', 'jungle', 'mid', 'bot', 'support'];
const mapName = (id) => (MAP_BY_ID[id] || RUSH_MAPS.find((m) => m.id === id) || { name: id }).name;
const starRow = (n, cls = '') => h('span', { class: 'cpstars ' + cls, 'aria-label': `${n} of 3 stars` }, ...[0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' }, '★')));
const kobanTag = (n) => h('span', { class: 'cpkoban', title: 'Koban: buys champions' }, h('img', { src: KOBAN, alt: '' }), `${n}`);
const mentor = (text) => h('div', { class: 'cpmentor' }, h('img', { src: rivalFace('ume'), alt: '' }), h('p', {}, h('b', {}, 'Granny Ume: '), text));

// The guided match: the session plus Granny's draft / prep guide (the match guide starts with the HUD).
export function playTutorial(app) { startTutorial(app); guideSetup(app); }

// ── home ──
// The Campaign card of the home screen: the next mission (or the academy for a brand-new coach) and the stars.
export function campaignCard(app) {
  const nm = nextMission(), academy = !tutorialDone() && !totalStars();
  const sub = academy ? (tutorialResumes() ? 'Resume the Coach Academy' : 'Start with the Coach Academy') : nm ? `Ch ${nm.ch} · ${nm.title}` : 'Campaign complete!';
  return h('button', { class: 'h2card h2camp' + (academy ? ' fresh' : ''), title: 'Story campaign: 30 missions vs the rival coaches, plus the guided first match', onclick: () => { audio.sfx('move', 0.5); showCampaign(app); } },
    h('span', { class: 'h2h' }, h('b', {}, 'Campaign'), h('small', {}, sub)),
    h('span', { class: 'cpstar' }, academy ? 'Start ›' : `★ ${totalStars()}`));
}

// ── chapter map ──
export function showCampaign(app, n = currentChapter(), opts = {}) {
  const ch = CHAPTER_BY_N[n] || CHAPTERS[0];
  if (!opts.noStory && chapterOpen(ch.n) && !chapterSeen(ch.n, 1)) { showStory(ch.intro, `Chapter ${ch.n}: ${ch.name}`, () => { markChapter(ch.n, 1); showCampaign(app, ch.n, { noStory: true }); }); }
  const ms = missionsOf(ch.n), open = chapterOpen(ch.n), boss = rivalOf(ms[4]);
  const tabs = h('div', { class: 'cptabs', role: 'tablist' }, ...CHAPTERS.map((c) => {
    const st = missionsOf(c.n).reduce((a, m) => a + missionStars(m.id), 0), ok = chapterOpen(c.n);
    return h('button', { class: 'chip cptab' + (c.n === ch.n ? ' on' : '') + (ok ? '' : ' locked') + (chapterDone(c.n) ? ' done' : ''), role: 'tab', 'aria-selected': String(c.n === ch.n), style: { '--cc': c.color },
      title: ok ? `Chapter ${c.n}: ${c.name}` : `Chapter ${c.n}: beat the chapter before it`, onclick: () => { audio.sfx('move', 0.4); showCampaign(app, c.n, { noStory: !ok }); } },
      h('b', {}, `${c.n}`), h('small', {}, ok ? `★${st}` : '—'));
  }));
  const academy = ch.n === 1 ? h('button', { class: 'cpnode cpacad' + (tutorialDone() ? ' done' : ' open'), title: 'The guided first match: draft, prep, calls, the map and the Kami', onclick: () => tutorialBrief(app) },
    h('img', { class: 'cpicon', src: 'assets/img/items/Letter.png', alt: '' }), h('b', { class: 'cpn' }, 'Academy'), h('small', {}, tutorialDone() ? 'Done' : tutorialResumes() ? 'Resume' : 'Tutorial')) : null;
  const node = (m, i) => {
    const ok = unlocked(m.id), st = missionStars(m.id), rv = rivalOf(m);
    return h('button', { class: 'cpnode' + (m.boss ? ' boss' : '') + (ok ? (st ? ' done' : ' open') : ' locked'), disabled: !ok, title: ok ? `${m.title} vs ${rv.name}` : 'Locked: clear the mission before it', onclick: () => { audio.sfx('move', 0.5); showBriefing(app, m); } },
      h('img', { class: 'cpface', src: rivalFace(rv.id), alt: '' }),
      h('b', { class: 'cpn' }, `${ch.n}-${i + 1}`), h('small', { class: 'cpt' }, m.title), h('small', { class: 'cprv' }, `vs ${rv.name}`), ok ? starRow(st) : h('small', { class: 'cplock' }, 'Locked'), m.boss ? h('i', { class: 'cpboss' }, 'BOSS') : null);
  };
  mount(screen(), h('div', { class: 'subscreen campaign', 'data-view': 'campaign', style: { '--cc': ch.color } },
    h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'), h('h2', {}, 'Campaign'),
      h('span', { class: 'cptotal', title: 'Stars earned' }, `★ ${totalStars()}/${MAX_STARS}`)),
    tabs,
    h('div', { class: 'panel cpchap' },
      h('div', { class: 'cpch' }, h('small', {}, `CHAPTER ${ch.n}`), h('b', {}, ch.name), h('p', { class: 'muted' }, ch.blurb)),
      h('div', { class: 'cpbossbox', title: `Chapter boss: ${boss.name}` }, h('img', { src: rivalFace(boss.id), alt: '' }), h('small', {}, 'Boss'), h('b', {}, boss.name)),
      h('div', { class: 'cpchbtns' }, open ? h('button', { class: 'chip', onclick: () => showStory(ch.intro, `Chapter ${ch.n}: ${ch.name}`, () => {}) }, 'Story') : null,
        chapterSeen(ch.n, 2) ? h('button', { class: 'chip', onclick: () => showStory(ch.outro, `Chapter ${ch.n} ending`, () => {}) }, 'Ending') : null)),
    h('div', { class: 'cppath' + (open ? '' : ' locked') }, academy, ...ms.map(node)),
    open ? nextUp(app, ch) : null,
    open ? null : h('p', { class: 'muted center small' }, `Beat ${CHAPTER_BY_N[ch.n - 1] ? rivalOf(missionsOf(ch.n - 1)[4]).name : 'the chapter before'} to open this chapter.`)));
}

// Under the path: what to play next in this chapter (the academy first for a new coach), with Granny's line.
function nextUp(app, ch) {
  const ms = missionsOf(ch.n), nm = ms.find((m) => unlocked(m.id) && !(maskOf(m.id) & 1));
  if (ch.n === 1 && !tutorialDone() && !maskOf(ms[0].id)) return h('div', { class: 'cpnext' }, mentor('New here? The academy match shows you every tool in about eight minutes.'), h('button', { class: 'btn big', onclick: () => tutorialBrief(app) }, tutorialResumes() ? 'Resume' : 'Academy'));
  if (nm) return h('div', { class: 'cpnext' }, mentor(nm.brief), h('button', { class: 'btn big', onclick: () => showBriefing(app, nm) }, `Play ${ch.n}-${ms.indexOf(nm) + 1}`));
  const left = ms.filter((m) => missionStars(m.id) < 3).length;
  return h('div', { class: 'cpnext' }, mentor(left ? `Chapter cleared, dear. ${left} missions still have stars to earn.` : 'Every star in this chapter. Granny is proud.'));
}

// ── briefing ──
function modal(cls, ...kids) {
  const close = () => m.remove();
  const m = h('div', { class: 'modal cpmodal ' + cls, onclick: (e) => { if (e.target === m) close(); } }, h('div', { class: 'panel mpanel' }, ...kids));
  document.body.append(m);
  return { el: m, close };
}
export function showBriefing(app, mis) {
  const rv = rivalOf(mis), mask = maskOf(mis.id), rush = mis.mode === 'rush', ev = mis.event && EVENT_BY_ID[mis.event];
  const mult = mis.boss ? 2 : 1;
  const md = modal('cpbrief',
    h('div', { class: 'cpbhead' }, h('img', { class: 'cpbface', src: rivalFace(rv.id), alt: '' }),
      h('div', { class: 'cpbt' }, h('small', {}, h('span', {}, `Chapter ${mis.ch}`), mis.boss ? h('span', { class: 'cpbosst' }, ' · Boss') : null, ' · ', h('span', {}, 'vs'), ' ', h('span', { translate: 'no' }, rv.name), ', ', h('span', {}, rv.title)), h('b', {}, mis.title),
        h('div', { class: 'cpbchips' }, h('span', { class: 'chipx' }, MODE_LABEL['ai' + mis.lvl]), h('span', { class: 'chipx' }, rush ? 'Lane Rush' : '5v5'), h('span', { class: 'chipx' }, mapName(mis.map)),
          ev ? h('span', { class: 'chipx ev' }, ev.name) : null)),
      rush ? null : h('div', { class: 'cpbmap' }, mapThumb(mis.map))),
    mentor(mis.brief),
    h('div', { class: 'cplearn' }, h('b', {}, `New: ${mis.learn}`), h('span', {}, mis.tip)),
    mis.squad ? h('div', { class: 'cpsquad' }, h('small', { class: 'muted' }, 'Your squad'), ...mis.squad.map((id, i) => h('span', { class: 'cpsq', title: `${HERO_BY_ID[id].name} · ${ROLE_LABEL[ROLES5[i]]}` }, h('img', { src: face(id), alt: '' }), h('small', {}, ROLE_LABEL[ROLES5[i]])))) : null,
    mis.plan ? h('div', { class: 'cpplan muted small' }, `Plan set in prep: ${PLAN_INFO[mis.plan].name}`) : null,
    h('div', { class: 'cpgoals' }, ...mis.goals.map((g, i) => h('div', { class: 'cpgoal' + (mask & (1 << i) ? ' got' : '') },
      h('i', { class: 'cpgs' }, '★'), h('span', {}, goalText(g)), mask & (1 << i) ? h('small', { class: 'muted' }, 'Earned') : kobanTag(STAR_KOBAN[i] * mult)))),
    h('div', { class: 'cpbbtns' }, h('button', { class: 'btn', onclick: () => md.close() }, 'Close'),
      h('button', { class: 'btn big cpgo', onclick: () => { md.close(); audio.sfx('accept', 0.6); if (!startMission(app, mis.id)) toast('This mission is locked.'); } }, mask & 1 ? 'Play again' : 'Play')));
}
// The academy's card: what it teaches, Play / Resume / Replay.
function tutorialBrief(app) {
  const done = tutorialDone() && !tut().skip, resume = tutorialResumes();
  const md = modal('cpbrief',
    h('div', { class: 'cpbhead' }, h('div', { class: 'cpbt' }, h('small', {}, 'Guided first match · about 8 minutes'), h('b', {}, 'Coach Academy'))),
    mentor('Your heroes play on their own, dear. You are the coach: you draft, you plan, you make the calls. Granny will show you.'),
    h('ul', { class: 'cplist' }, h('li', {}, 'The draft (bans and one hero per role), then prep (plan and lineup)'),
      h('li', {}, 'Calls, the map ring, stances, tactic cards and Coach Moments'), h('li', {}, 'The scout pet, fight forecasts and the decision tray'),
      h('li', {}, 'Kami and blessings, the Oni, the Kraken, the Elder and the minimap')),
    h('div', { class: 'cpgoals' }, h('div', { class: 'cpgoal' + (tut().paid ? ' got' : '') }, h('i', { class: 'cpgs' }, '★'), h('span', {}, 'Finish the academy match'), tut().paid ? h('small', { class: 'muted' }, 'Earned') : kobanTag(TUTORIAL_KOBAN))),
    h('div', { class: 'cpbbtns' }, h('button', { class: 'btn', onclick: () => md.close() }, 'Close'),
      h('button', { class: 'btn big cpgo', onclick: () => { md.close(); audio.sfx('accept', 0.6); playTutorial(app); } }, resume ? 'Resume' : done ? 'Replay' : 'Start')));
}

// ── story panels ──
export function showStory(panels, title, onDone) {
  const md = modal('cpstory',
    h('div', { class: 'cpsthead' }, h('b', {}, title)),
    h('div', { class: 'lcomic cpcomic' + (panels.length === 2 ? ' two' : ''), role: 'img', 'aria-label': title }, ...panels.map((p, i) => comicPanel(p, i))),
    h('div', { class: 'cpbbtns' }, h('button', { class: 'btn big cpgo', onclick: () => { md.close(); audio.sfx('accept', 0.5); onDone(); } }, 'Continue')));
  md.el.onclick = null; // the story closes with its button (it may lead on to the next screen)
  return md;
}

// ── results ──
// The results screen's campaign panel and its main button: { panel, again, label }.
export function campaignResults(app, s, r) {
  if (r.tutorial) {
    return { label: 'Start the campaign', again: () => { audio.music('menu'); app.session = null; showCampaign(app, 1); },
      panel: h('div', { class: 'panel cpres' }, h('div', { class: 'cprhead' }, h('img', { src: rivalFace('ume'), alt: '' }),
        h('div', {}, h('small', {}, 'COACH ACADEMY'), h('b', {}, 'Academy complete!'))),
      mentor(r.won ? 'Well coached, dear! The village team is waiting for you in the campaign.' : 'A loss is a lesson too, dear. The village team is waiting for you in the campaign.'),
      r.koban ? h('div', { class: 'cprk' }, kobanTag(r.koban), h('small', { class: 'muted' }, 'Koban buys champions')) : null) };
  }
  const m = r.m, o = r.out;
  const goals = h('div', { class: 'cpgoals' }, ...o.goals.map((g, i) => h('div', { class: 'cpgoal' + (g.done ? ' got' : '') + (g.done && !(r.prev & (1 << i)) ? ' new' : '') },
    h('i', { class: 'cpgs' }, '★'), h('span', {}, g.text), h('small', { class: 'muted' }, g.done ? 'Done' : r.mask & (1 << i) ? 'Earned before' : 'Not this time'))));
  const outro = r.bossDown && !chapterSeen(m.ch, 2) ? CHAPTER_BY_N[m.ch] : null;
  const toMap = (nextCh) => () => {
    if (outro) { showStory(outro.outro, `Chapter ${outro.n}: ${outro.name}`, () => { markChapter(outro.n, 2); goMap(nextCh); }); return; }
    goMap(nextCh);
  };
  const goMap = (n) => { audio.music('menu'); app.session = null; showCampaign(app, n); const nm = r.next; if (nm && r.out.won) showBriefing(app, nm); };
  const won = o.won;
  const panel = h('div', { class: 'panel cpres' + (won ? ' won' : '') },
    h('div', { class: 'cprhead' }, h('img', { src: rivalFace(s.rival), alt: '' }),
      h('div', {}, h('small', {}, `CHAPTER ${m.ch} · MISSION ${MISSIONS.filter((x) => x.ch === m.ch).indexOf(m) + 1}`), h('b', {}, won ? `${m.title}: complete!` : `${m.title}: failed`)),
      starRow(o.stars, 'big')),
    goals,
    r.koban ? h('div', { class: 'cprk' }, kobanTag(r.koban), h('small', { class: 'muted' }, 'Koban for new stars')) : null,
    r.bossDown ? h('div', { class: 'cprboss gold' }, m.ch < CHAPTERS.length ? `Chapter ${m.ch} complete! Chapter ${m.ch + 1} is open.` : 'The Kami Cup is yours! Campaign complete.') : null,
    won ? null : h('div', { class: 'muted small' }, 'Missions are cleared with a win. Each goal met in a win is a star, kept for good.'),
    h('div', { class: 'cprbtns' }, h('button', { class: 'chip', onclick: toMap(r.next ? r.next.ch : m.ch) }, 'Campaign map')));
  if (won && r.next) return { panel, label: 'Next mission', again: toMap(r.next.ch) };
  if (won) return { panel, label: r.last ? 'Campaign' : 'Next mission', again: toMap(m.ch) };
  return { panel, label: 'Retry mission', again: () => startMission(app, m.id) };
}

// ── first launch ──
// A brand-new coach is offered the guided match once (it closes itself when another screen opens).
export function tutorialOffer(app) {
  markOffered();
  const md = modal('cpoffer',
    h('div', { class: 'cpbhead' }, h('div', { class: 'cpbt' }, h('small', {}, 'Welcome to MOBA-VS'), h('b', {}, 'New coach?'))),
    mentor('Your heroes play themselves. You draft, plan and make the calls. Let Granny show you in one short guided match.'),
    h('div', { class: 'cpbbtns' }, h('button', { class: 'btn', onclick: () => { skipTutorial(); md.close(); toast('The Coach Academy waits in Campaign whenever you want it.', 2600); } }, 'Skip'),
      h('button', { class: 'btn big cpgo', onclick: () => { md.close(); audio.sfx('accept', 0.6); playTutorial(app); } }, 'Play the academy')));
  const sc = screen(), first = sc.firstElementChild;
  const obs = new MutationObserver(() => { if (sc.firstElementChild !== first) { obs.disconnect(); md.close(); } });
  obs.observe(sc, { childList: true });
  return md;
}
