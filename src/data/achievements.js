// Achievements: tracked on this device from finished matches (the analytics record, the callLog and the
// final game state) and from the profile, stored in profile.d.ach (bounded: one timestamp per id plus the
// MVP roles seen), cloud-saved with the profile. Each one grants a cosmetic reward.
// A match context m = { game, my, won, key, A, potg } (see matchContext); a profile check gets (d, P).
import { legKey } from './skins.js';
import { ROLES, ROLE_LABEL } from './heroes.js';
import { masteryLevel } from '../mastery.js';

const kills = (m) => (m.A ? m.A.ev.filter((e) => e[1] === 'k') : []);
const myKills = (m) => kills(m).filter((e) => e[2] === m.my);
const wins = (d) => Object.values(d.seasons || {}).reduce((a, s) => a + (s.w || 0), 0);
const games = (d) => Object.values(d.seasons || {}).reduce((a, s) => a + (s.w || 0) + (s.l || 0), 0);
const masteryCount = (d, lv) => Object.values(d.mastery || {}).filter((x) => masteryLevel(x.pts) >= lv).length;
const myEvents = (m, type) => m.game.events.filter((e) => e.type === type && e.team === m.my);
const classic = (m) => m.game.mode !== 'rush';
// longest run of kills by one of my heroes without dying (from the kill log)
function bestStreak(m) {
  const run = {}; let best = 0;
  for (const e of kills(m)) { if (e[2] === m.my && e[4]) { run[e[4]] = (run[e[4]] || 0) + 1; best = Math.max(best, run[e[4]]); } else if (e[2] !== m.my) run[e[3]] = 0; }
  return best;
}

export const ACH = [
  { id: 'first_win', name: 'First Victory', desc: 'Win a match.', icon: 'icons/Upgrade', reward: { kind: 'emote', id: 'happy' }, match: (m) => m.won },
  { id: 'calls5', name: 'Shotcaller', desc: '5 calls that pay off in one match.', icon: 'items/Letter', reward: { kind: 'emote', id: 'nervous' }, match: (m) => m.calls >= 5 },
  { id: 'calls10', name: 'Voice of the Team', desc: '10 calls that pay off in one match.', icon: 'items/Scroll', reward: { kind: 'skin', id: legKey('rekka') }, match: (m) => m.calls >= 10 },
  { id: 'comeback', name: 'Never Say Die', desc: 'Win after trailing by 5,000 gold or more.', icon: 'items/MoneyBag', reward: { kind: 'banner', id: 'phoenix' }, match: (m) => m.won && m.worstGold <= -5000 },
  { id: 'moment_ace', name: 'Masterstroke', desc: 'Ace the enemy team within 15s of using a Coach Moment.', icon: 'icons/Explosion', reward: { kind: 'skin', id: legKey('kaen') },
    match: (m) => { const mo = m.A ? m.A.ev.filter((e) => e[1] === 'mo' && e[2] === m.my).map((e) => e[0]) : []; return myKills(m).some((e) => e[6] && mo.some((t) => e[0] >= t && e[0] - t <= 15)); } },
  { id: 'double_ace', name: 'Clean Sweep', desc: 'Ace the enemy team twice in one match.', icon: 'icons/Cut', reward: { kind: 'emote', id: 'ko', also: { kind: 'banner', id: 'abyss' } }, match: (m) => myKills(m).filter((e) => e[6]).length >= 2 },
  { id: 'unstoppable', name: 'Unstoppable', desc: 'One of your heroes scores 10 kills in a row without dying.', icon: 'icons/Fireball', reward: { kind: 'skin', id: legKey('fang') }, match: (m) => bestStreak(m) >= 10 },
  { id: 'no_towers', name: 'Iron Curtain', desc: 'Win a 5v5 match without losing a tower.', icon: 'icons/DefenseUpgrade', reward: { kind: 'skin', id: legKey('bastion') },
    match: (m) => m.won && classic(m) && !m.game.teams[1 - m.my].towers },
  { id: 'clean_sheet', name: 'Untouchable', desc: 'Win a 5v5 match giving up 3 kills or fewer.', icon: 'icons/Heal', reward: { kind: 'border', id: 'moon' }, match: (m) => m.won && classic(m) && m.game.teams[1 - m.my].kills <= 3 },
  { id: 'blitz', name: 'Blitz', desc: 'Destroy the enemy Crystal before 12:00.', icon: 'items/Hourglass', reward: { kind: 'skin', id: legKey('shuri') },
    match: (m) => m.won && classic(m) && m.game.time < 720 && m.game.events.some((e) => e.type === 'victory' && !e.timeout) },
  { id: 'on_time', name: 'Marathon', desc: 'Win a match decided on towers when time runs out.', icon: 'icons/Counter', reward: { kind: 'emote', id: 'zzz' },
    match: (m) => m.won && m.game.events.some((e) => e.type === 'victory' && e.timeout) },
  { id: 'blessing', name: "Kami's Favour", desc: 'Earn a Kami blessing.', icon: 'icons/OrbLight', reward: { kind: 'banner', id: 'aurora' }, match: (m) => myEvents(m, 'soul').length > 0 },
  { id: 'kraken', name: 'Kraken Hunter', desc: 'Slay the Kraken.', icon: 'icons/WaterCanon', reward: { kind: 'skin', id: legKey('gorath') }, match: (m) => m.game.events.some((e) => e.type === 'objective' && e.obj === 'baron' && e.team === m.my) },
  { id: 'steal', name: 'Thief in the Night', desc: 'Steal a Kami, the Oni or the Kraken.', icon: 'icons/Camouflage', reward: { kind: 'emote', id: 'huh' }, match: (m) => m.game.events.some((e) => e.type === 'objective' && e.team === m.my && e.steal) },
  { id: 'duo3', name: 'Dynamic Duo', desc: 'Land 3 duo combos in one match.', icon: 'icons/Permutation', reward: { kind: 'emote', id: 'dizzy' }, match: (m) => myEvents(m, 'duo').length >= 3 },
  { id: 'comp', name: 'Perfect Fit', desc: 'Win with a team comp bonus active.', icon: 'icons/BookLight', reward: { kind: 'banner', id: 'lotus' }, match: (m) => m.won && myEvents(m, 'comp').length > 0 },
  { id: 'clan3', name: 'Clan Pride', desc: 'Win with three or more heroes of one clan.', icon: 'icons/LuckUpgrade', reward: { kind: 'skin', id: legKey('hachi') },
    match: (m) => m.won && (m.game.teams[m.my].clans || []).some((c) => c.n >= 3) },
  { id: 'tactics', name: 'Card Shark', desc: 'Play all 3 tactic cards and win.', icon: 'icons/MagicWeapon', reward: { kind: 'skin', id: legKey('sumi') }, match: (m) => m.won && myEvents(m, 'tactic').length >= 3 },
  { id: 'moments3', name: 'Moment Maker', desc: 'Use all three Coach Moments in one match.', icon: 'icons/Mist', reward: { kind: 'emote', id: 'cry' }, match: (m) => myEvents(m, 'moment').length >= 3 },
  { id: 'potg', name: 'Highlight Reel', desc: 'Earn the Play of the Game.', icon: 'icons/Vision', reward: { kind: 'emote', id: 'grumpy' }, match: (m) => !!m.potg },
  { id: 'all_roles', name: 'All-Rounder', desc: 'Earn MVP with a hero in every role.', icon: 'icons/Alchemy', reward: { kind: 'skin', id: legKey('leonin') },
    prog: (d) => [((d.ach && d.ach.roles) || []).length, ROLES.length], state: (d) => ((d.ach && d.ach.roles) || []).length >= ROLES.length,
    hint: (d) => { const got = (d.ach && d.ach.roles) || []; const left = ROLES.filter((r) => !got.includes(r)); return left.length ? `Still to go: ${left.map((r) => ROLE_LABEL[r]).join(', ')}` : ''; } },
  { id: 'rush_win', name: 'Rush Hour', desc: 'Win a Lane Rush match.', icon: 'icons/BookWind', reward: { kind: 'emote', id: 'alert' }, match: (m) => m.won && !classic(m) },
  { id: 'giant', name: 'Giant Slayer', desc: 'Beat the Hard AI.', icon: 'icons/AttackUpgrade', reward: { kind: 'skin', id: legKey('kenshi') }, match: (m) => m.won && (m.key === 'ai2' || m.key === 'cup' && m.aiLevel === 2) },
  { id: 'online_win', name: 'Proven Online', desc: 'Win an online match.', icon: 'icons/BookThunder', reward: { kind: 'border', id: 'shogun' }, match: (m) => m.won && ['online', 'casual', 'rushOnline'].includes(m.key) },
  { id: 'cup', name: 'Cup Champion', desc: 'Win the Season Cup.', icon: 'items/GoldCup', reward: { kind: 'border', id: 'storm', also: { kind: 'banner', id: 'thunder' } }, state: (d) => !!(d.trophies && d.trophies.gold) },
  { id: 'wins10', name: 'Seasoned Coach', desc: 'Win 10 matches.', icon: 'items/SilverCup', reward: { kind: 'banner', id: 'dojo' }, prog: (d) => [wins(d), 10], state: (d) => wins(d) >= 10 },
  { id: 'wins50', name: 'Veteran Coach', desc: 'Win 50 matches.', icon: 'items/BarGold', reward: { kind: 'skin', id: legKey('oak') }, prog: (d) => [wins(d), 50], state: (d) => wins(d) >= 50 },
  { id: 'games25', name: 'Learning Every Day', desc: 'Coach 25 matches.', icon: 'items/BarSilver', reward: { kind: 'emote', id: 'sad' }, prog: (d) => [games(d), 25], state: (d) => games(d) >= 25 },
  { id: 'pool20', name: 'Deep Pool', desc: 'Coach 20 different heroes.', icon: 'items/LittleTreasureChest', reward: { kind: 'emote', id: 'meh' }, prog: (d) => [Object.keys(d.heroStats || {}).length, 20], state: (d) => Object.keys(d.heroStats || {}).length >= 20 },
  { id: 'first_sig', name: 'Signature Look', desc: 'Reach Mastery 5 with a hero (it unlocks that hero\'s Signature skin).', icon: 'items/GemPurple', reward: { kind: 'emote', id: 'gasp' },
    prog: (d) => [Math.min(1, masteryCount(d, 5)), 1], state: (d) => masteryCount(d, 5) >= 1 },
  { id: 'master5', name: 'Dojo Master', desc: 'Reach Mastery 7 with 5 heroes.', icon: 'items/GemYellow', reward: { kind: 'skin', id: legKey('wu') }, prog: (d) => [masteryCount(d, 7), 5], state: (d) => masteryCount(d, 7) >= 5 },
  { id: 'sensei', name: 'True Sensei', desc: 'Reach Mastery 10 with a hero.', icon: 'items/GemGreen', reward: { kind: 'border', id: 'sensei' }, prog: (d) => [Math.min(1, masteryCount(d, 10)), 1], state: (d) => masteryCount(d, 10) >= 1 },
  { id: 'pass10', name: 'Season Grinder', desc: 'Reach Season Pass level 10.', icon: 'items/BigTreasureChest', reward: { kind: 'banner', id: 'starfield' }, state: (d, P) => P.level >= 10, prog: (d, P) => [Math.min(10, P.level), 10] },
  { id: 'gold_rank', name: 'Gilded Climb', desc: 'Reach Gold rank in any season.', icon: 'items/GemRed', reward: { kind: 'border', id: 'jade' }, state: (d) => Object.values(d.seasons || {}).some((s) => (s.peakElo || 0) >= 1150) },
];
export const ACH_BY_ID = Object.fromEntries(ACH.map((a) => [a.id, a]));

// Everything a match check needs, computed once.
export function matchContext({ game, myTeam, key, aiLevel, analytics, potgHero }) {
  const my = myTeam, A = analytics && analytics.ev ? analytics : null, sign = my === 0 ? 1 : -1;
  return {
    game, my, key, aiLevel, A, won: game.winner === my, potg: !!potgHero,
    calls: game.callLog.filter((c) => c.team === my && c.result === 'success').length,
    worstGold: A && A.gold.length ? Math.min(0, ...A.gold.map((v) => v * sign)) : 0,
  };
}
