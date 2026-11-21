// Rival coaches: the named opponents of Play vs AI. Each difficulty is a tier of four rivals. A rival brings
// a portrait (assets/img/coaches, from the Ninja Adventure pack), a personality, signature game plans (the
// second is their halftime switch), favourite heroes and draft habits, a Coach Moment habit, a ladder rating
// (shown as a rank badge) and a few short lines for the draft and the results.
//   draft.fav  favourite heroes (picked whenever they fit)        draft.tags  hero tags they lean toward
//   draft.ban  'best' (your most-played winners) | 'carry' (marksmen/mages) | 'meta' (strong into their picks)
//   moment     'early' (fires Coach Moments on the first good fight) | 'late' (saves them for the second half) | ''
//   plans      [signature, halftime switch]; `stick` = how often the signature beats the recommended plan
export const RIVALS = [
  // ── Easy ──
  { id: 'taro', tier: 0, elo: 880, name: 'Taro', title: 'The Eager Rookie', pers: 'Reckless and loud. Dives first, thinks later.',
    plans: ['aggro', 'scale'], stick: 0.8, moment: 'early', draft: { fav: ['brawlo', 'leonin', 'hex', 'hachi', 'bonehook'], tags: ['dive', 'early'], ban: 'meta' },
    lines: { hi: ['First match of my career. Go easy on me. Or don\'t!', 'I watched one replay. I\'m basically a pro now.'], win: ['Did you see that dive?! I meant to do that!', 'Rookie luck? No such thing!'], lose: ['Okay, okay. Teach me that next time.', 'I\'ll be back. With a plan this time.'] } },
  { id: 'momo', tier: 0, elo: 910, name: 'Momo', title: 'Jungle Kid', pers: 'Lives in the jungle, loves the Kami pit.',
    plans: ['objective', 'aggro'], stick: 0.7, moment: '', draft: { fav: ['ponta', 'saru', 'kumo', 'kinta', 'shuri'], tags: ['pick', 'cc'], ban: 'meta' },
    lines: { hi: ['The Kami is mine. Just so you know.', 'I mapped every camp on this map. Twice.'], win: ['Every Kami, every time!', 'The jungle always wins.'], lose: ['You out-smited me. Respect.', 'Next time I\'m warding your jungle.'] } },
  { id: 'buta', tier: 0, elo: 940, name: 'Lord Buta', title: 'The Feast Lord', pers: 'Greedy. Farms everything, fights nothing until he is full.',
    plans: ['scale', 'protect'], stick: 0.75, moment: 'late', draft: { fav: ['grok', 'fang', 'sanguis', 'tomoe', 'oak'], tags: ['scaling', 'sustain'], ban: 'carry' },
    lines: { hi: ['A full belly wins late games.', 'Take your time. I\'ll be farming.'], win: ['Fed and happy. As planned.', 'The feast is served.'], lose: ['I was still hungry...', 'You ate my lunch. Well played.'] } },
  { id: 'kenta', tier: 0, elo: 960, name: 'Kenta', title: 'Village Champion', pers: 'Stubborn. Picks a side lane and never leaves it.',
    plans: ['split', 'objective'], stick: 0.75, moment: '', draft: { fav: ['tetsu', 'yuki', 'sora', 'bolt', 'gizmo'], tags: ['split', 'siege'], ban: 'meta' },
    lines: { hi: ['Top lane is my village. Stay out.', 'My towers fall last. Yours first.'], win: ['Side lanes, all day!', 'Told you. My village, my rules.'], lose: ['You found my village. Hm.', 'Fine. I\'ll defend better.'] } },
  // ── Normal ──
  { id: 'rin', tier: 1, elo: 1180, name: 'Rin', title: 'The Cold Strategist', pers: 'Calm and precise. Every objective is a setup.',
    plans: ['objective', 'protect'], stick: 0.65, moment: 'late', draft: { fav: ['karasu', 'kurai', 'wren', 'frost', 'monolith'], tags: ['cc', 'teamfight'], ban: 'best' },
    lines: { hi: ['I have already seen how this ends.', 'Your wards will not save you.'], win: ['As calculated.', 'Vision wins games. Remember that.'], lose: ['Unexpected. I will study this.', 'A clean game. I respect it.'] } },
  { id: 'goro', tier: 1, elo: 1210, name: 'Goro', title: 'Red Bandana', pers: 'Hothead brawler. Fights at every Oni.',
    plans: ['aggro', 'split'], stick: 0.7, moment: 'early', draft: { fav: ['akaro', 'gorath', 'leonin', 'nami', 'ruga'], tags: ['dive', 'engage'], ban: 'carry' },
    lines: { hi: ['Gloves on. Let\'s brawl.', 'First blood is mine, I swear it.'], win: ['That\'s how we fight where I\'m from!', 'Too slow, coach!'], lose: ['You hit hard. Rematch soon.', 'Good fight. My knuckles hurt.'] } },
  { id: 'kuma', tier: 1, elo: 1240, name: 'Kuma', title: 'The Boxer', pers: 'Patient guard, then a counter-punch. Protects his carry.',
    plans: ['protect', 'scale'], stick: 0.7, moment: '', draft: { fav: ['valka', 'gama', 'marlowe', 'wu', 'zahra'], tags: ['peel', 'shield'], ban: 'meta' },
    lines: { hi: ['Keep your guard up.', 'My carry never drops. Never.'], win: ['Guard, guard, counter. Easy.', 'Untouchable!'], lose: ['You broke my guard. Impressive.', 'Clean hits. I\'ll train harder.'] } },
  { id: 'jin', tier: 1, elo: 1260, name: 'Jin', title: 'The Silent Splitter', pers: 'Quiet. Shows up where you are not.',
    plans: ['split', 'scale'], stick: 0.75, moment: 'late', draft: { fav: ['kenshi', 'sora', 'sumi', 'rekka', 'hotaru'], tags: ['split', 'pick'], ban: 'best' },
    lines: { hi: ['...', 'Watch your side lanes.'], win: ['You were looking mid.', 'Gone before you noticed.'], lose: ['You saw me coming. Few do.', 'Hm. Good eyes.'] } },
  // ── Hard ──
  { id: 'ozu', tier: 2, elo: 1420, name: 'Sensei Ozu', title: 'The Old Fox', pers: 'Patient master. Gives up the early game to own the late one.',
    plans: ['scale', 'objective'], stick: 0.65, moment: 'late', draft: { fav: ['totem', 'azim', 'umbra', 'voss', 'hoshi'], tags: ['scaling'], ban: 'best' },
    lines: { hi: ['Patience, young coach. The game is long.', 'Show me what you have learned.'], win: ['The late game rewards the patient.', 'Good. Now study why you lost.'], lose: ['The student surpasses the master. For today.', 'Excellent. You have grown.'] } },
  { id: 'ume', tier: 2, elo: 1460, name: 'Grandma Ume', title: 'Mother of Champions', pers: 'Coached three Cup winners. Peels like nobody else.',
    plans: ['protect', 'objective'], stick: 0.6, moment: '', draft: { fav: ['aurelia', 'oak', 'fletch', 'bastion', 'kitsu'], tags: ['heal', 'peel'], ban: 'best' },
    lines: { hi: ['Eat something first, dear. You\'ll need it.', 'My grandchildren play better than this. Prove me wrong.'], win: ['Nobody touches my carry, sweetie.', 'Come back when you\'ve grown up a little.'], lose: ['Oh! You\'re a sharp one.', 'Well played, dear. I\'m proud of you.'] } },
  { id: 'shishi', tier: 2, elo: 1500, name: 'Shishi', title: 'The Lion of Ember', pers: 'Ferocious. Invades at 2:00 and never stops.',
    plans: ['aggro', 'objective'], stick: 0.7, moment: 'early', draft: { fav: ['kaen', 'kaze', 'raiden', 'hachi', 'bonehook'], tags: ['dive', 'burst'], ban: 'carry' },
    lines: { hi: ['I\'ll be in your jungle before your first camp.', 'Run.'], win: ['The pride feeds.', 'You never left your base. Smart.'], lose: ['You tamed the lion. Remarkable.', 'Hm. A worthy hunt.'] } },
  { id: 'kin', tier: 2, elo: 1540, name: 'General Kin', title: 'The Golden General', pers: 'A strategist with an answer for every plan.',
    plans: ['split', 'protect'], stick: 0.55, moment: 'late', draft: { fav: ['varro', 'gaki', 'ember', 'tomoe', 'daikoku'], tags: ['siege', 'teamfight'], ban: 'best' },
    lines: { hi: ['Every plan has a counter. I have yours.', 'Your formation is predictable.'], win: ['Outflanked, outplanned.', 'The general always wins the war.'], lose: ['You out-planned me. That is rare.', 'Victory earned. I salute you.'] } },
];
export const RIVAL_BY_ID = Object.fromEntries(RIVALS.map((r) => [r.id, r]));
export const TIER_NAME = ['Easy', 'Normal', 'Hard'];
export const rivalFace = (id) => `assets/img/coaches/${id}.png`;
export const MOMENT_HABIT = { early: 'Fires Coach Moments early', late: 'Saves Coach Moments for the second half', '': 'Uses Coach Moments when they swing a fight' };
export const BAN_HABIT = { best: 'Bans your best heroes', carry: 'Bans carries', meta: 'Bans what counters their picks' };

// A short line by kind ('hi' | 'win' | 'lose'), stable for one match (seeded).
export function rivalLine(r, kind, seed = 0) { const l = r && r.lines[kind]; return l && l.length ? l[(seed >>> 0) % l.length] : ''; }
