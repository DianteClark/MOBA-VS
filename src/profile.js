// The coach's profile: rank, season pass, cosmetics, trophies and match history.
// Stored in this browser (localStorage). Every match is recorded in a compact, shareable
// format so a future shared backend can feed real results into the season balancer.
import { seasonAt, XP_PER_LEVEL, MAX_LEVEL, MATCH_XP, TRACK, SKINS, BANNERS, TITLES } from './data/seasons.js';
import { rankOf, eloDelta, START_ELO, AI_ELO, AI_CAP, CUP_ELO, RATED, SEASON_REWARDS, TIERS, MIN_RATED_GAMES } from './data/ranks.js';
import { masteryInfo, masteryLevel, matchPoints, masteryRewards, masteryTitleName } from './mastery.js';
import { HERO_BY_ID } from './data/heroes.js';
import { queueCloudSave } from './net/online.js';
import { loadPresets, sanitize } from './presets.js';

const KEY = 'mobavs_profile_v1';
const fresh = () => ({
  v: 1, seasons: {}, unlocked: { skins: ['base'], banners: ['plain'], titles: ['rookie'] },
  equip: { banner: 'plain', title: 'rookie', skins: {} }, trophies: { gold: 0, silver: 0 }, borders: [],
  history: [], heroStats: {}, cup: null, seenPatch: '', lastSeason: 0, mastery: {},
});

// Same MVP rule as the results screen.
export function mvpOf(game) {
  const all = [...game.teams[0].heroes, ...game.teams[1].heroes];
  const sc = (x) => x.kills * 3 + x.assists * 1.5 - x.deaths + x.dmgHeroes / 1500 + x.cs / 40 + (x.team === game.winner ? 4 : 0);
  const m = all.sort((a, b) => sc(b) - sc(a))[0]; return m ? { id: m.heroId, team: m.team } : null;
}
// Display name of any title key (season titles and hero-mastery titles).
export function titleName(key) { return TITLES[key] || masteryTitleName(key, key && HERO_BY_ID[key.split(':')[1]] && HERO_BY_ID[key.split(':')[1]].name) || null; }
const profile_cupRound = (c) => (c ? ['Quarterfinal', 'Semifinal', 'Grand Final'][c.round] || 'Final' : null);
export class Profile {
  constructor() {
    this.d = fresh();
    try { const raw = localStorage.getItem(KEY); if (raw) this.d = Object.assign(fresh(), JSON.parse(raw)); } catch { /* private mode: in-memory */ }
    this.d.presets = loadPresets(this.d.presets);
    this.rollover();
  }
  // Saves locally and (when signed in) queues a cloud save of the whole profile.
  save(opts = {}) {
    if (!opts.keepTime) this.d.savedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ }
    if (!opts.local) { let name = 'Coach'; try { name = localStorage.getItem('mobavs_name') || 'Coach'; } catch { /* ignore */ } queueCloudSave(name, this.d, this.d.savedAt); }
  }
  // Replace the local profile with a cloud copy (sign-in on a new device, or a newer save elsewhere).
  adopt(d) { this.d = Object.assign(fresh(), d); this.d.presets = loadPresets(this.d.presets); this.rollover(); this.save({ keepTime: true, local: true }); }
  get season() { return seasonAt(); }
  // Season record. elo/peakElo/rg (rated games) replaced the old RP fields; old saves convert once.
  ss(id = this.season.id) {
    const s = this.d.seasons[id] || (this.d.seasons[id] = { elo: START_ELO, peakElo: START_ELO, rg: 0, xp: 0, w: 0, l: 0, claimed: [] });
    if (s.elo === undefined) { s.elo = START_ELO + Math.round((s.rp || 0) * 0.4); s.peakElo = Math.max(s.elo, START_ELO + Math.round((s.peak || 0) * 0.4)); s.rg = (s.w || 0) + (s.l || 0); delete s.rp; delete s.peak; }
    return s;
  }
  get rank() { return rankOf(this.ss().elo); }
  get elo() { return this.ss().elo; }
  get level() { return Math.min(MAX_LEVEL, 1 + Math.floor(this.ss().xp / XP_PER_LEVEL)); }
  get levelProgress() { const xp = this.ss().xp; return this.level >= MAX_LEVEL ? 1 : (xp % XP_PER_LEVEL) / XP_PER_LEVEL; }

  // New season: soft-reset rank, award last season's border and title.
  // Season end: every reward up to the peak tier (with enough rated matches), then a soft reset toward 1000.
  rollover() {
    const cur = this.season.id;
    if (this.d.lastSeason && this.d.lastSeason !== cur && this.d.seasons[this.d.lastSeason]) {
      const prevId = this.d.lastSeason, prev = this.ss(prevId);
      const r = rankOf(prev.peakElo), got = [];
      if (prev.rg >= MIN_RATED_GAMES) {
        for (const t of TIERS.slice(0, r.idx + 1)) for (const rw of SEASON_REWARDS[t.id] || []) {
          if (rw.kind === 'border') { if (t === r.tier) { this.d.borders.push({ season: prevId, tier: t.id }); got.push(rw); } }
          else this.unlock(rw, got);
        }
      }
      const s = this.ss(cur); s.elo = Math.round(START_ELO + (prev.elo - START_ELO) * 0.5); s.peakElo = s.elo;
      this.newSeasonNote = { from: prevId, peak: r.label, tier: r.tier.id, rewards: got, eligible: prev.rg >= MIN_RATED_GAMES };
    }
    this.d.lastSeason = cur;
    this.save();
  }

  unlock(r, out) {
    if (!r) return;
    const list = this.d.unlocked[r.kind + 's'];
    if (list && !list.includes(r.id)) { list.push(r.id); out.push(r); }
    if (r.also) this.unlock(r.also, out);
  }

  // Record a finished match; returns a summary for the results screen.
  //   mode: 'ai' | 'online'; ranked: online ranked queue; oppElo: the online opponent's season rating;
  //   potgHero: hero id of the Play of the Game (mastery points).
  record({ game, myTeam, mode, aiLevel, cup, ranked, oppElo, potgHero }) {
    if (myTeam < 0) return null;
    const s = this.ss(), season = this.season;
    const won = game.winner === myTeam;
    const rush = game.mode === 'rush';
    const key = cup ? 'cup' : mode === 'ai' ? (rush ? 'rush' : 'ai' + aiLevel) : ranked && !rush ? 'online' : rush ? 'rushOnline' : 'casual';
    const rated = !!RATED[key];
    const before = s.elo, rankBefore = rankOf(before);
    let elo = before;
    if (rated) {
      const opp = key === 'cup' ? CUP_ELO[aiLevel] ?? CUP_ELO[1] : key === 'online' ? (oppElo || START_ELO) : AI_ELO[aiLevel] ?? AI_ELO[1];
      elo = Math.max(0, before + eloDelta(before, opp, won, s.rg));
      const cap = key.startsWith('ai') ? AI_CAP[aiLevel] : undefined;
      if (won && cap !== undefined) elo = Math.min(elo, Math.max(before, cap));
      s.elo = elo; s.peakElo = Math.max(s.peakElo, elo); s.rg++;
    }
    if (won) s.w++; else s.l++;
    // season XP
    const team = game.teams[myTeam];
    const good = game.callLog.filter((c) => c.team === myTeam && c.result === 'success').length;
    const featured = team.heroes.filter((x) => HERO_BY_ID[x.heroId] && HERO_BY_ID[x.heroId].clan === season.clan).length;
    const xpParts = [[won ? 'Victory' : 'Played', won ? MATCH_XP.win : MATCH_XP.loss]];
    if (good) xpParts.push([`${good} good call${good > 1 ? 's' : ''}`, Math.min(MATCH_XP.goodCallCap, good * MATCH_XP.perGoodCall)]);
    if (featured) xpParts.push([`${featured} featured-clan hero${featured > 1 ? 'es' : ''}`, featured * MATCH_XP.featuredHero]);
    if (cup) xpParts.push(['Season Cup', MATCH_XP.cup]);
    const xp = xpParts.reduce((a, p) => a + p[1], 0);
    const lvBefore = this.level;
    s.xp += xp;
    const lvAfter = this.level, unlocks = [];
    for (let lv = lvBefore + 1; lv <= lvAfter; lv++) this.unlock(TRACK[lv], unlocks);
    // hero stats + mastery
    const mvp = mvpOf(game), mastery = [];
    for (const x of team.heroes) {
      const hs = this.d.heroStats[x.heroId] || (this.d.heroStats[x.heroId] = { g: 0, w: 0 }); hs.g++; if (won) hs.w++;
      const pts = matchPoints(game, x, myTeam, { mvp, potgHero });
      const m = this.d.mastery[x.heroId] || (this.d.mastery[x.heroId] = { pts: 0 });
      const lvA = masteryLevel(m.pts); m.pts += pts.total; const lvB = masteryLevel(m.pts);
      const rewards = masteryRewards(x.heroId, lvA, lvB);
      for (const r of rewards) if (r.kind === 'title' && !this.d.unlocked.titles.includes(r.id)) this.d.unlocked.titles.push(r.id);
      mastery.push({ id: x.heroId, gain: pts.total, parts: pts.parts, before: lvA, after: lvB, info: masteryInfo(m.pts), rewards });
    }
    this.d.history.unshift({
      t: Date.now(), season: season.id, mode: key, map: game.world.def.id, won, len: Math.round(game.time),
      picks: [0, 1].map((t) => game.teams[t].heroes.map((x) => x.heroId)), winner: game.winner, side: myTeam,
      towers: [game.towersStanding(0), game.towersStanding(1)], kills: [game.teams[0].kills, game.teams[1].kills],
      kda: [0, 1].map((t) => game.teams[t].heroes.map((x) => [x.kills, x.deaths, x.assists, x.cs, Math.round(x.dmgHeroes), Math.round(x.goldEarned)])),
      names: (this.lastNames || ['You', 'Rival']).slice(), mvp, crystal: !game.events.some((e) => e.type === 'victory' && e.timeout),
      rank: rankOf(s.elo).label, rpDelta: elo - before, cup: cup ? (profile_cupRound(this.d.cup)) : null,
      calls: game.callLog.filter((c) => c.team === myTeam && c.result === 'success').length,
    });
    this.d.history.length = Math.min(this.d.history.length, 50);
    this.save();
    const rankAfter = rankOf(elo);
    return { won, rated, key, eloBefore: before, elo, delta: elo - before, rankBefore, rankAfter,
      promoted: rankAfter.step > rankBefore.step, demoted: rankAfter.step < rankBefore.step,
      xp, xpParts, lvBefore, lvAfter, unlocks, mastery, capped: rated && key.startsWith('ai') && won && elo >= AI_CAP[aiLevel] };
  }

  // Mastery of one hero: { lv, pts, into, toNext, max }
  mastery(id) { return masteryInfo((this.d.mastery[id] || {}).pts || 0); }
  equipSkin(heroId, skin) { if (skin === 'base') delete this.d.equip.skins[heroId]; else this.d.equip.skins[heroId] = skin; this.save(); }
  skinsFor(ids) { const o = {}; for (const id of ids) { const s = this.d.equip.skins[id]; if (s && this.hasSkin(id, s)) o[id] = s; } return o; }
  // Season/pass skins are account-wide; mastery tints only for heroes that reached the level.
  hasSkin(heroId, s) { const k = SKINS[s]; if (!k) return false; if (k.mastery) return this.mastery(heroId).lv >= k.mastery; return s === 'base' || this.d.unlocked.skins.includes(s); }
  // Lineup presets (Dojo → Lineups).
  get activePreset() { const p = this.d.presets; return p.active >= 0 ? p.slots[p.active] : null; }
  savePreset(i, preset) { this.d.presets.slots[i] = sanitize(preset); this.save(); }
  setActivePreset(i) { this.d.presets.active = i; this.save(); }
  get banner() { return BANNERS[this.d.equip.banner] || BANNERS.plain; }
  get title() { return titleName(this.d.equip.title) || TITLES.rookie; }
  equip(kind, id) { this.d.equip[kind] = id; this.save(); }
}
export const profile = new Profile();
