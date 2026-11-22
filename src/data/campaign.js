// Story campaign (v23+): six chapters of five missions against the rival coaches, told in comic panels, plus the
// guided first match (the tutorial). Pure data and pure functions (no DOM): the app builds sessions from it
// (src/campaign.js), the sim reads only each mission's `rules` (cfg.mission, src/sim/mission.js) and the goals
// are read from the finished game here, so tools/campaign_test.mjs can check every mission headless.
// Plain ASCII. Short lines: every caption fits a phone-sized panel.
//
// Mission fields:
//   rival  rival coach id (src/data/rivals.js): name, portrait, draft habits, plans
//   lvl    AI coach level 0-2            map   map id            mode  'classic' | 'rush'      event  weekly event id
//   squad  your fixed lineup [top, jungle, mid, bot, support] (no draft), else a normal draft vs the rival
//   foe    their fixed lineup (only with a squad); otherwise the rival drafts it
//   plan   your plan, set in prep         learn  the system the mission teaches (a short tag + tip)
//   rules  sim rules (src/sim/mission.js)  goals  [win, bonus, bonus]: each goal met in a won match is a star
//   boss   the chapter's boss rival (double Koban)
import { ROLE_LABEL } from './heroes.js';
import { PLAN_INFO } from './plans.js';
import { DRAFT_ORDER, autoChoice } from '../sim/draft.js';

// Koban for each star the first time it is earned (a boss pays double). The tutorial pays once.
export const STAR_KOBAN = [60, 40, 50];
export const TUTORIAL_KOBAN = 200;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Panel: { sc: scene clan, a: hero (left / alone), b: hero (right), p: 'solo' | 'clash' | 'duo', t: caption, say: bubble }
export const CHAPTERS = [
  { n: 1, id: 'hearth', name: 'Embers of the Hearth', color: '#ffcf5a', sc: 'hearth', boss: 'kenta',
    blurb: 'A village team, a borrowed whistle, and a coach who has never won a match.',
    intro: [
      { sc: 'hearth', a: 'ume', p: 'solo', t: 'The clans are at war again, and the valley is in the way.', say: 'Sit, dear. Tea first.' },
      { sc: 'hearth', a: 'daichi', b: 'tetsu', p: 'clash', t: 'Golems trample the rice fields. The village has no army.', say: 'Not my fields!' },
      { sc: 'hearth', a: 'kenta', b: 'mame', p: 'duo', t: 'It has a team, though. And now it has you: the new coach.', say: 'Coach!' },
    ],
    outro: [
      { sc: 'hearth', a: 'kenta', b: 'daichi', p: 'duo', t: 'The Village Champion shakes your hand. The valley cheers.', say: 'Fine. You can coach.' },
      { sc: 'iron', a: 'bastion', p: 'solo', t: 'Far away, the clans hear about a village that wins.', say: 'Who is this coach?' },
    ] },
  { n: 2, id: 'clans', name: 'The Clans Gather', color: '#c8c8d8', sc: 'iron', boss: 'rin',
    blurb: 'The clan coaches come to test the village. Each one plays a different game.',
    intro: [
      { sc: 'iron', a: 'valka', b: 'gorath', p: 'clash', t: 'Word travels. The clan coaches want to see the village team.', say: 'Show us.' },
      { sc: 'beast', a: 'leonin', p: 'solo', t: 'Goro brings brawlers. Kuma brings a wall. Jin brings nothing you can see.', say: 'Grr.' },
      { sc: 'hearth', a: 'ume', b: 'aki', p: 'duo', t: 'Granny Ume pours the tea. "A plan beats a punch, dear."', say: 'Plans, dear.' },
    ],
    outro: [
      { sc: 'spirit', a: 'kurai', p: 'solo', t: 'Rin folds her notes. "Your plan was better. This time."', say: 'Noted.' },
      { sc: 'spirit', a: 'hotaru', b: 'gaki', p: 'clash', t: 'That night the marsh lanterns go dark, one by one.', say: 'The parade comes!' },
    ] },
  { n: 3, id: 'yokai', name: 'Night of the Yokai', color: '#c7a7ff', sc: 'spirit', boss: 'shishi',
    blurb: 'Moonlit marshes, a parade of spirits and a lion who hunts after dark.',
    intro: [
      { sc: 'spirit', a: 'hotaru', p: 'solo', t: 'In the marsh, night falls fast and the Yokai Parade marches.', say: 'Follow the lantern.' },
      { sc: 'spirit', a: 'aki', b: 'gaki', p: 'clash', t: 'Spirits that hunger. A Kraken in the deep water.', say: 'Stay in the light!' },
      { sc: 'wild', a: 'kaen', b: 'leonin', p: 'duo', t: 'And Shishi, the Lion of Ember, invading at the second minute.', say: 'Run.' },
    ],
    outro: [
      { sc: 'wild', a: 'leonin', p: 'solo', t: 'The lion bows his great head. "A worthy hunt."', say: 'Hm.' },
      { sc: 'wild', a: 'azim', b: 'zahra', p: 'duo', t: 'An invitation arrives, sealed in gold: the Lane Rush Circuit.', say: 'One lane. Fast.' },
    ] },
  { n: 4, id: 'rush', name: 'The Lane Rush Circuit', color: '#8be08b', sc: 'wild', boss: 'kin',
    blurb: 'One lane, ten heroes, seven minutes. Every second counts.',
    intro: [
      { sc: 'wild', a: 'fletch', b: 'wren', p: 'duo', t: 'Lane Rush: one bridge, all ten heroes, a Crystal in about seven minutes.', say: 'No time to farm!' },
      { sc: 'iron', a: 'varro', p: 'solo', t: 'The crowd loves it. The General loves it more.', say: 'Formation!' },
      { sc: 'hearth', a: 'taro', b: 'suzu', p: 'duo', t: 'The twins pack the crossbows. "Fast, coach. Fast!"', say: 'Boom!' },
    ],
    outro: [
      { sc: 'iron', a: 'tomoe', p: 'solo', t: 'General Kin salutes. "You out-planned me. That is rare."', say: 'Victory earned.' },
      { sc: 'hearth', a: 'ume', p: 'solo', t: 'Then the ground shakes. In every pit, the Elder Kami wakes.', say: 'Oh dear.' },
    ] },
  { n: 5, id: 'elder', name: 'The Elder Wakes', color: '#ffb35a', sc: 'beast', boss: 'ume',
    blurb: 'Ancient Kami stir in the ruins. Whoever tames them ends the war.',
    intro: [
      { sc: 'beast', a: 'grok', b: 'monolith', p: 'clash', t: 'Elder Kami land in the old arenas. Their push breaks any wall.', say: 'Big rock!' },
      { sc: 'spirit', a: 'kurai', b: 'hex', p: 'duo', t: 'The clans race for them. Old grudges come back.', say: 'Your nemesis waits.' },
      { sc: 'hearth', a: 'ume', b: 'aki', p: 'duo', t: 'Granny Ume puts down her tea. "Last lesson, dear. Beat me."', say: 'Gloves off.' },
    ],
    outro: [
      { sc: 'hearth', a: 'ume', p: 'solo', t: 'Granny Ume laughs until she cries. "Oh, you sharp one."', say: 'Proud of you.' },
      { sc: 'shinobi', a: 'umbra', p: 'solo', t: 'One coach has watched every match. The Old Fox calls you to the Kami Cup.', say: '...' },
    ] },
  { n: 6, id: 'cup', name: 'The Kami Cup', color: '#7fd0ff', sc: 'shinobi', boss: 'ozu',
    blurb: 'The best coaches of the valley. One cup. One Old Fox.',
    intro: [
      { sc: 'shinobi', a: 'sora', b: 'kenshi', p: 'clash', t: 'The Kami Cup: every rival you beat, now at their best.', say: 'Draw.' },
      { sc: 'shinobi', a: 'kaze', b: 'shiro', p: 'duo', t: 'The village sends its team. The whole valley watches.', say: 'Go, coach!' },
      { sc: 'spirit', a: 'hoshi', p: 'solo', t: 'At the end of the bracket waits Sensei Ozu, the Old Fox.', say: 'Show me.' },
    ],
    outro: [
      { sc: 'hearth', a: 'kenta', b: 'mame', p: 'duo', t: 'The Kami Cup comes home to the Hearth. Beans fly. Oni out!', say: 'Champions!' },
      { sc: 'hearth', a: 'ume', b: 'daichi', p: 'duo', t: 'Sensei Ozu bows. "The student surpasses the master." The war can wait.', say: 'Tea, everyone.' },
    ] },
];
export const CHAPTER_BY_N = Object.fromEntries(CHAPTERS.map((c) => [c.n, c]));

const W = { k: 'win' };
export const MISSIONS = [
  // ── Chapter 1: Embers of the Hearth (Sakura Valley, Easy) ──
  { id: 'c1m1', ch: 1, title: 'The Village Team', rival: 'taro', lvl: 0, map: 'sakura', squad: ['daichi', 'isamu', 'mame', 'suzu', 'aki'],
    brief: 'Taro wants a warm-up match. Your heroes play on their own: you make the calls.', learn: 'Calls', tip: 'Tap a call (Gank, Kami, Push...) to steer the whole team. Each costs charges.',
    rules: { mods: [[1, 'all', -0.15, -0.15]], charges: 3 }, goals: [W, { k: 'calls', n: 3 }, { k: 'kills', n: 10 }] },
  { id: 'c1m2', ch: 1, title: 'Jungle Kid', rival: 'momo', lvl: 0, map: 'sakura', squad: ['tobi', 'kenta', 'taro', 'momo', 'ume'],
    brief: 'Momo says the Kami pit is hers. The Frog Kami blesses whoever slays it, for the whole match.', learn: 'Kami', tip: 'Call Kami when it wakes. Each Kami slain is one more stack of the map\'s blessing.',
    rules: { mods: [[1, 'all', -0.12, -0.12]], kami: [120, 330] }, goals: [W, { k: 'kami', n: 2 }, { k: 'fb' }] },
  { id: 'c1m3', ch: 1, title: 'The Feast Lord', rival: 'buta', lvl: 0, map: 'sakura', squad: ['daichi', 'kenta', 'mame', 'suzu', 'aki'],
    brief: 'Lord Buta farms until he is full. Do not let him eat: end it early.', learn: 'Pushing', tip: 'Push calls send the team down a lane. Towers falling early starve a farming team.',
    rules: { mods: [[1, 'all', -0.1, -0.1]] }, goals: [W, { k: 'before', t: 720 }, { k: 'towers', n: 6 }] },
  { id: 'c1m4', ch: 1, title: 'Your First Draft', rival: 'taro', lvl: 0, map: 'frost',
    brief: 'No borrowed lineup this time. Ban, pick, then bring three tactic cards.', learn: 'Draft & cards', tip: 'Bans remove a hero for both teams. Your three tactic cards are one-shot plays: use them all.',
    rules: { mods: [[1, 'all', -0.1, -0.1]] }, goals: [W, { k: 'cards', n: 3 }, { k: 'keep', n: 3 }] },
  { id: 'c1m5', ch: 1, boss: true, title: 'Village Champion', rival: 'kenta', lvl: 1, map: 'sakura',
    brief: 'Kenta has never lost on his home field. He splits a side lane and never leaves it.', learn: 'Elder Kami', tip: 'The Elder Kami lands in the centre. Slay it: its blessing and push end games.',
    rules: { elder: 600 }, goals: [W, { k: 'elder' }, { k: 'keep', n: 4 }] },
  // ── Chapter 2: The Clans Gather (Normal) ──
  { id: 'c2m1', ch: 2, title: 'Red Bandana', rival: 'goro', lvl: 1, map: 'ember',
    brief: 'Goro arrives rich and angry: his heroes start with extra gold. Save your Coach Moments for his big dive.', learn: 'Coach Moments', tip: 'Timeout, Rally and All-Out Push: once per match each. Use one when a fight swings.',
    rules: { gold: [0, 250], mods: [[1, 'all', -0.05, -0.05]] }, goals: [W, { k: 'moment', n: 1 }, { k: 'deaths', n: 15 }] },
  { id: 'c2m2', ch: 2, title: 'Guard Up', rival: 'kuma', lvl: 1, map: 'oasis',
    brief: 'Your Bot carry is still hurt from the last match: much less health. Kuma will hunt them.', learn: 'Protect the carry', tip: 'The Protect plan and peel calls keep a fragile carry alive. Do not send them in first.',
    rules: { mods: [[0, 'bot', -0.35, 0], [1, 'all', -0.08, -0.05]] }, plan: 'protect', goals: [W, { k: 'carry', role: 'bot', n: 2 }, { k: 'kills', n: 15 }] },
  { id: 'c2m3', ch: 2, title: 'Eyes in the Snow', rival: 'jin', lvl: 1, map: 'frost', event: 'fog',
    brief: 'Fog on the pass, and Jin hides in it. Your scout pet is free from the first minute.', learn: 'Scout pet', tip: 'Tap the map, then Scout: your pet runs there and lights the area for 30s. Free.',
    rules: { scout: 60, mods: [[1, 'all', -0.05, -0.05]] }, goals: [W, { k: 'scout', n: 3 }, { k: 'keep', n: 3 }] },
  { id: 'c2m4', ch: 2, title: 'Split the Valley', rival: 'goro', lvl: 1, map: 'ruins',
    brief: 'Goro groups up and brawls. Do not fight him: take his towers while he looks mid.', learn: 'Game plans', tip: 'Your game plan sets how heroes play all match. Split Push beats grouping, if you keep it.',
    rules: { mods: [[1, 'all', -0.05, -0.05]] }, plan: 'split', goals: [W, { k: 'plan', plan: 'split' }, { k: 'towers', n: 7 }] },
  { id: 'c2m5', ch: 2, boss: true, title: 'The Cold Strategist', rival: 'rin', lvl: 1, map: 'ruins',
    brief: 'Rin turns every objective into a trap. Read the fight forecast before you commit.', learn: 'Fight forecast', tip: 'The forecast spots fights 5-11s ahead and says who is favoured. Join good ones, dodge bad ones.',
    rules: { mods: [[1, 'all', 0.05, 0.05]] }, goals: [W, { k: 'kamiAll' }, { k: 'oni' }] },
  // ── Chapter 3: Night of the Yokai (Hard begins) ──
  { id: 'c3m1', ch: 3, title: 'Moonlit Marsh', rival: 'jin', lvl: 1, map: 'marsh',
    brief: 'Night falls fast in the marsh. When the Yokai Parade marches, tame it before Jin does.', learn: 'Night & Yokai', tip: 'At night sight shrinks and camps wake stronger. The Yokai Parade is worth a detour.',
    rules: { mods: [[1, 'all', 0, 0]] }, goals: [W, { k: 'yokai' }, { k: 'calls', n: 5 }] },
  { id: 'c3m2', ch: 3, title: 'Kraken Tide', rival: 'kuma', lvl: 1, map: 'marsh',
    brief: 'The Kraken rises early tonight. Its slayers push with empowered minions.', learn: 'Kraken', tip: 'Take the Kraken when ahead or when enemies are dead: it turns a lead into towers.',
    rules: { kraken: 360 }, goals: [W, { k: 'kraken' }, { k: 'before', t: 840 }] },
  { id: 'c3m3', ch: 3, title: 'Kami Storm', rival: 'rin', lvl: 1, map: 'sakura', event: 'kamistorm',
    brief: 'Three Kami wake tonight, one after another. Rin wants every blessing.', learn: 'Blessings', tip: 'Blessings stack: three Kami make a team much stronger for the rest of the match.',
    rules: {}, goals: [W, { k: 'kami', n: 3 }, { k: 'deaths', n: 18 }] },
  { id: 'c3m4', ch: 3, title: 'Blood Moon', rival: 'shishi', lvl: 1, map: 'ember', event: 'bloodmoon',
    brief: 'Shishi tests you under the Blood Moon. Call your ultimates in together.', learn: 'Ults stance', tip: 'Tap Ults once: ALL-IN, ultimates fire in the next fight. Tap again to Hold them.',
    rules: {}, goals: [W, { k: 'allin' }, { k: 'fb' }] },
  { id: 'c3m5', ch: 3, boss: true, title: 'The Lion of Ember', rival: 'shishi', lvl: 2, map: 'ember',
    brief: 'Shishi invades at the second minute and never stops. The Elder lands at 10:00.', learn: 'Boss: Shishi', tip: 'Ward your jungle, punish his invades, and save charges for the Elder.',
    rules: { elder: 600 }, goals: [W, { k: 'elder' }, { k: 'keep', n: 4 }] },
  // ── Chapter 4: The Lane Rush Circuit ──
  { id: 'c4m1', ch: 4, title: 'One Lane', rival: 'taro', lvl: 0, map: 'rush_sakura', mode: 'rush',
    brief: 'Lane Rush: one bridge, all ten heroes, fast gold. Taro thinks speed is everything.', learn: 'Lane Rush', tip: 'No side lanes, no farming time: group, fight and push. Towers fall fast.',
    rules: {}, goals: [W, { k: 'before', t: 390 }, { k: 'kills', n: 20 }] },
  { id: 'c4m2', ch: 4, title: 'Cinder Run', rival: 'kenta', lvl: 1, map: 'rush_ember', mode: 'rush',
    brief: 'Kenta is back, and he brought his village. Play every card before the Crystal falls.', learn: 'Card timing', tip: 'In a short match a card in your hand is wasted. Play them on fights and pushes.',
    rules: {}, goals: [W, { k: 'cards', n: 3 }, { k: 'keep', n: 2 }] },
  { id: 'c4m3', ch: 4, title: 'Glass Cannon', rival: 'momo', lvl: 1, map: 'rush_sakura', mode: 'rush',
    brief: 'Your Mid hits harder than ever but breaks like glass. Keep them behind the front line.', learn: 'Fragile carry', tip: 'Protect and Safe calls pull a hurt hero back. A living carry wins Lane Rush.',
    rules: { mods: [[0, 'mid', -0.3, 0.15]] }, goals: [W, { k: 'carry', role: 'mid', n: 2 }, { k: 'kills', n: 15 }] },
  { id: 'c4m4', ch: 4, title: 'Kraken Run', rival: 'jin', lvl: 2, map: 'rush_ember', mode: 'rush',
    brief: 'The Kraken wakes at 2:30. Whoever slays it takes the bridge.', learn: 'Rush objectives', tip: 'In Lane Rush the Kraken decides most matches. Fight for it with full charges.',
    rules: { kraken: 150 }, goals: [W, { k: 'kraken' }, { k: 'deaths', n: 20 }] },
  { id: 'c4m5', ch: 4, boss: true, title: 'The Golden General', rival: 'kin', lvl: 2, map: 'rush_ember', mode: 'rush',
    brief: 'General Kin has an answer for every plan. Beat him fast, before his formation sets.', learn: 'Boss: Kin', tip: 'Kin punishes a stalled lane. Keep momentum: every fight won is a tower.',
    rules: { mods: [[1, 'all', 0.05, 0.05]] }, goals: [W, { k: 'before', t: 420 }, { k: 'keep', n: 1 }] },
  // ── Chapter 5: The Elder Wakes ──
  { id: 'c5m1', ch: 5, title: 'Sunscar Oasis', rival: 'rin', lvl: 2, map: 'oasis',
    brief: 'The Golden Racoon lands early in the oasis. Its push ends matches at the Crystal.', learn: 'Elder\'s Push', tip: 'After the Elder, push together: All-Out waves crack the Crystal.',
    rules: { elder: 540 }, goals: [W, { k: 'elder' }, { k: 'crystal' }] },
  { id: 'c5m2', ch: 5, title: 'Mossgate Ruins', rival: 'kuma', lvl: 2, map: 'ruins',
    brief: 'Kuma\'s team arrives rich. Take the river monsters to catch up.', learn: 'Catching up', tip: 'Behind in gold? Monsters pay the whole team. Fight where your blessings help.',
    rules: { gold: [0, 400] }, goals: [W, { k: 'oni' }, { k: 'kraken' }] },
  { id: 'c5m3', ch: 5, title: 'Nemesis', rival: 'nemesis', lvl: 2, map: 'frost',
    brief: 'The rival who beat you most is waiting. (No nemesis yet? Goro volunteers.)', learn: 'Rivals', tip: 'Each rival drafts and plans in their own way. Their card on the Play vs AI screen tells you how.',
    rules: {}, goals: [W, { k: 'fb' }, { k: 'kills', n: 20 }] },
  { id: 'c5m4', ch: 5, title: 'Hold the Line', rival: 'jin', lvl: 2, map: 'sakura',
    brief: 'A short clock: at 12:00 the team with more towers standing wins. Jin will split.', learn: 'Time-out wins', tip: 'When the clock runs out, towers decide. Defend your side lanes.',
    rules: { len: 720 }, goals: [W, { k: 'keep', n: 2 }, { k: 'deaths', n: 15 }] },
  { id: 'c5m5', ch: 5, boss: true, title: 'Mother of Champions', rival: 'ume', lvl: 2, map: 'sakura',
    brief: 'Granny Ume coached three Cup winners. Nobody touches her carry. Last lesson.', learn: 'Boss: Ume', tip: 'Ume peels and heals. Take the Kami and the Elder before her team scales.',
    rules: { mods: [[1, 'all', 0.05, 0.05]], elder: 660 }, goals: [W, { k: 'kamiAll' }, { k: 'elder' }] },
  // ── Chapter 6: The Kami Cup ──
  { id: 'c6m1', ch: 6, title: 'Quarterfinal', rival: 'shishi', lvl: 2, map: 'tide',
    brief: 'The Lion of Ember again, hungrier than before.', learn: 'Kami Cup', tip: 'Every Cup rival plays at full strength. Use everything you have learned.',
    rules: { mods: [[1, 'all', 0.05, 0.05]] }, goals: [W, { k: 'fb' }, { k: 'keep', n: 3 }] },
  { id: 'c6m2', ch: 6, title: 'Semifinal', rival: 'kin', lvl: 2, map: 'ruins',
    brief: 'General Kin counters every plan. So pick one and hold it: Objective Control.', learn: 'Plan discipline', tip: 'A plan you switch is a plan you never played. Hold it and take the Kami.',
    rules: { mods: [[1, 'all', 0.05, 0.05]] }, plan: 'objective', goals: [W, { k: 'plan', plan: 'objective' }, { k: 'kami', n: 2 }] },
  { id: 'c6m3', ch: 6, title: 'Underdogs', rival: 'goro', lvl: 2, map: 'sky',
    brief: 'Your heroes start broke and Goro\'s hit harder. The crowd loves an underdog.', learn: 'Comebacks', tip: 'Behind? Play safe, take what is free, and wait for one good fight.',
    rules: { gold: [-300, 0], mods: [[1, 'all', 0, 0.06]] }, goals: [W, { k: 'kills', n: 20 }, { k: 'deaths', n: 18 }] },
  { id: 'c6m4', ch: 6, title: 'Every Kami', rival: 'rin', lvl: 2, map: 'marsh',
    brief: 'The final Kami storm. Three Kami and the Elder: take them all.', learn: 'Map control', tip: 'Vision and charges before each Kami: arrive first, fight on your terms.',
    rules: { kami: [150, 330, 510], elder: 660, mods: [[1, 'all', 0.05, 0.05]] }, goals: [W, { k: 'kamiAll' }, { k: 'elder' }] },
  { id: 'c6m5', ch: 6, boss: true, title: 'The Old Fox', rival: 'ozu', lvl: 2, map: 'oasis',
    brief: 'Sensei Ozu gives up the early game to own the late one. Do not give him a late game.', learn: 'Final: Ozu', tip: 'Win before his team scales: early Kami, early towers, no long stalls.',
    rules: { mods: [[1, 'all', 0.1, 0.1]] }, goals: [W, { k: 'before', t: 780 }, { k: 'towers', n: 8 }] },
];
export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const missionsOf = (n) => MISSIONS.filter((m) => m.ch === n);

// The guided first match: a short, easy 5v5 on Sakura Valley with early Kami, Oni, Kraken and Elder so every
// lesson happens in about eight minutes. The rival's team is weakened; a scripted Kami call makes a fight happen.
export const TUTORIAL = {
  id: 'tutorial', title: 'Coach Academy', rival: 'taro', lvl: 0, map: 'sakura',
  squad: ['daichi', 'isamu', 'mame', 'suzu', 'aki'], // used when the draft lessons were already seen (resume)
  rules: { kami: [75, 300], oni: 150, oniEnd: 300, kraken: 320, elder: 420, scout: 40, len: 600, charges: 3,
    mods: [[1, 'all', -0.22, -0.22]], script: [[80, 1, { type: 'objective', obj: 'dragon' }], [160, 1, { type: 'objective', obj: 'herald' }]] },
  goals: [W],
};

// A mission with a fixed squad has no draft: a finished draft with your squad and their lineup (the mission's `foe`,
// else picked for the rival around your squad: autoChoice on red pick turns, with the rival's habits as `pref`).
// rng: the session's seeded Rng (the same lineup on a replay of the session).
export function missionDraft(m, rng, pref = null) {
  const picks = [m.squad.slice(), m.foe ? m.foe.slice() : []];
  const turn = DRAFT_ORDER.findIndex((t) => t.team === 1 && t.act === 'pick');
  while (picks[1].length < 5) picks[1].push(autoChoice({ turn, bans: [picks[0].slice(), []], picks: [[], picks[1].slice()], done: false }, 1, rng, 1, pref));
  return { turn: DRAFT_ORDER.length, bans: [[], []], picks, done: true, fixed: true };
}

// ── goals ──
const PLAN_NAME = (id) => (PLAN_INFO[id] ? PLAN_INFO[id].name : id);
export function goalText(g) {
  switch (g.k) {
    case 'win': return 'Win the match';
    case 'before': return `Win before ${fmt(g.t)}`;
    case 'kami': return `Slay ${g.n} Kami`;
    case 'kamiAll': return 'Take every Kami (they take none)';
    case 'elder': return 'Slay the Elder Kami';
    case 'oni': return 'Slay the Oni';
    case 'kraken': return 'Slay the Kraken';
    case 'yokai': return 'Tame the Yokai Parade';
    case 'calls': return `Make ${g.n} successful calls`;
    case 'cards': return `Play all ${g.n} tactic cards`;
    case 'moment': return g.n === 1 ? 'Use a Coach Moment' : `Use ${g.n} Coach Moments`;
    case 'scout': return `Send your scout ${g.n} times`;
    case 'towers': return `Destroy ${g.n} towers`;
    case 'keep': return g.n === 0 ? 'Lose no tower' : g.n === 1 ? 'Lose at most 1 tower' : `Lose at most ${g.n} towers`;
    case 'deaths': return `Your team dies at most ${g.n} times`;
    case 'kills': return `Score ${g.n} kills`;
    case 'fb': return 'Draw first blood';
    case 'carry': return g.n === 0 ? `Your ${ROLE_LABEL[g.role]} hero never dies` : `Your ${ROLE_LABEL[g.role]} hero dies at most ${g.n} times`;
    case 'plan': return `Keep the ${PLAN_NAME(g.plan)} plan all match`;
    case 'crystal': return 'Win at the Crystal (not on time)';
    case 'allin': return 'Call ALL-IN on ultimates';
    default: return g.k;
  }
}
// Did the coach of `my` meet goal g in this finished game? (Read-only: events, call log, team tallies.)
function goalMet(goal, g, my) {
  const won = g.winner === my, T = g.teams[my], E = g.teams[1 - my], ev = g.events;
  const obj = (o, team) => ev.filter((e) => e.type === 'objective' && e.obj === o && e.team === team).length;
  const calls = (pred) => ev.filter((e) => e.type === 'call' && e.team === my && pred(e.call || {})).length;
  switch (goal.k) {
    case 'win': return won;
    case 'before': return won && g.time < goal.t;
    case 'kami': return obj('dragon', my) >= goal.n;
    case 'kamiAll': return obj('dragon', my) >= 1 && obj('dragon', 1 - my) === 0;
    case 'elder': return obj('boss', my) >= 1;
    case 'oni': return obj('herald', my) >= 1;
    case 'kraken': return obj('baron', my) >= 1;
    case 'yokai': return obj('yokai', my) >= 1;
    case 'calls': return g.callLog.filter((c) => c.team === my && c.result === 'success').length >= goal.n;
    case 'cards': return T.deck.filter((d) => d.used).length >= goal.n;
    case 'moment': return ev.filter((e) => e.type === 'moment' && e.team === my).length >= goal.n;
    case 'scout': return ev.filter((e) => e.type === 'scout' && e.team === my).length >= goal.n;
    case 'towers': return T.towers >= goal.n;
    case 'keep': return E.towers <= goal.n;
    case 'deaths': return T.heroes.reduce((a, x) => a + x.deaths, 0) <= goal.n;
    case 'kills': return T.kills >= goal.n;
    case 'fb': { const k = ev.find((e) => e.type === 'kill'); return !!k && k.team !== my; }
    case 'carry': { const x = T.heroes.find((h) => h.role === goal.role); return !!x && x.deaths <= goal.n; }
    case 'plan': return (T.planFrom || T.plan) === goal.plan && T.plan === goal.plan;
    case 'crystal': return won && !ev.some((e) => e.type === 'victory' && e.timeout);
    case 'allin': return calls((c) => c.type === 'ult' && c.mode === 'go') >= 1;
    default: return false;
  }
}
// A finished mission: which goals were met and the stars (each goal met in a WON match is a star; a loss earns none).
export function missionOutcome(m, g, my) {
  const won = g.winner === my;
  const goals = m.goals.map((goal) => ({ text: goalText(goal), done: won && goalMet(goal, g, my) }));
  let mask = 0; goals.forEach((x, i) => { if (x.done) mask |= 1 << i; });
  return { won, goals, mask, stars: goals.filter((x) => x.done).length };
}
export const starsOf = (mask) => ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1));
// Koban for the stars in `mask` that `prev` did not have yet.
export function starKoban(m, prev, mask) {
  let k = 0; for (let i = 0; i < 3; i++) if ((mask & (1 << i)) && !(prev & (1 << i))) k += STAR_KOBAN[i] * (m.boss ? 2 : 1);
  return k;
}
