// The coach's profile: rank, season pass, cosmetics, trophies and match history.
// Stored in this browser (localStorage). Every match is recorded in a compact, shareable
// format so a future shared backend can feed real results into the season balancer.
import { seasonAt, rankOf, RP, RP_CAP, XP_PER_LEVEL, MAX_LEVEL, MATCH_XP, TRACK, SKINS, BANNERS, TITLES } from './data/seasons.js';
import { HERO_BY_ID } from './data/heroes.js';

const KEY = 'mobavs_profile_v1';
const fresh = () => ({
  v: 1, seasons: {}, unlocked: { skins: ['base'], banners: ['plain'], titles: ['rookie'] },
  equip: { banner: 'plain', title: 'rookie', skins: {} }, trophies: { gold: 0, silver: 0 }, borders: [],
  history: [], heroStats: {}, cup: null, seenPatch: '', lastSeason: 0,
});

export class Profile {
  constructor() {
    this.d = fresh();
    try { const raw = localStorage.getItem(KEY); if (raw) this.d = Object.assign(fresh(), JSON.parse(raw)); } catch { /* private mode: in-memory */ }
    this.rollover();
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ } }
  get season() { return seasonAt(); }
  ss(id = this.season.id) { return this.d.seasons[id] || (this.d.seasons[id] = { rp: 0, peak: 0, xp: 0, w: 0, l: 0, claimed: [] }); }
  get rank() { return rankOf(this.ss().rp); }
  get level() { return Math.min(MAX_LEVEL, 1 + Math.floor(this.ss().xp / XP_PER_LEVEL)); }
  get levelProgress() { const xp = this.ss().xp; return this.level >= MAX_LEVEL ? 1 : (xp % XP_PER_LEVEL) / XP_PER_LEVEL; }

  // New season: soft-reset rank, award last season's border and title.
  rollover() {
    const cur = this.season.id;
    if (this.d.lastSeason && this.d.lastSeason !== cur) {
      const prev = this.d.seasons[this.d.lastSeason];
      if (prev) {
        const r = rankOf(prev.peak);
        if (r.idx >= 1) this.d.borders.push({ season: this.d.lastSeason, tier: r.tier.id });
        const s = this.ss(cur); s.rp = Math.floor(prev.rp * 0.5); s.peak = s.rp;
        this.newSeasonNote = { from: this.d.lastSeason, peak: r.label };
      }
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
  record({ game, myTeam, mode, aiLevel, cup }) {
    if (myTeam < 0) return null;
    const s = this.ss(), season = this.season;
    const won = game.winner === myTeam;
    const key = cup ? 'cup' : mode === 'ai' ? 'ai' + aiLevel : 'online';
    const [gain, loss] = RP[key] || RP.ai1;
    const before = s.rp, rankBefore = rankOf(before);
    let rp = Math.max(0, before + (won ? gain : loss));
    const cap = RP_CAP[key]; if (won && cap !== undefined && before <= cap) rp = Math.min(rp, Math.max(before, cap));
    s.rp = rp; s.peak = Math.max(s.peak, rp);
    if (won) s.w++; else s.l++;
    // season XP
    const team = game.teams[myTeam];
    const good = game.callLog.filter((c) => c.team === myTeam && c.result === 'success').length;
    const featured = team.heroes.filter((x) => HERO_BY_ID[x.heroId].clan === season.clan).length;
    const xpParts = [[won ? 'Victory' : 'Played', won ? MATCH_XP.win : MATCH_XP.loss]];
    if (good) xpParts.push([`${good} good call${good > 1 ? 's' : ''}`, Math.min(MATCH_XP.goodCallCap, good * MATCH_XP.perGoodCall)]);
    if (featured) xpParts.push([`${featured} featured-clan hero${featured > 1 ? 'es' : ''}`, featured * MATCH_XP.featuredHero]);
    if (cup) xpParts.push(['Season Cup', MATCH_XP.cup]);
    const xp = xpParts.reduce((a, p) => a + p[1], 0);
    const lvBefore = this.level;
    s.xp += xp;
    const lvAfter = this.level, unlocks = [];
    for (let lv = lvBefore + 1; lv <= lvAfter; lv++) this.unlock(TRACK[lv], unlocks);
    // hero stats + history (compact, backend-ready)
    for (const x of team.heroes) { const hs = this.d.heroStats[x.heroId] || (this.d.heroStats[x.heroId] = { g: 0, w: 0 }); hs.g++; if (won) hs.w++; }
    this.d.history.unshift({
      t: Date.now(), season: season.id, mode: key, map: game.world.def.id, won, len: Math.round(game.time),
      picks: [0, 1].map((t) => game.teams[t].heroes.map((x) => x.heroId)), winner: game.winner, side: myTeam,
      towers: [game.towersStanding(0), game.towersStanding(1)], kills: [game.teams[0].kills, game.teams[1].kills],
    });
    this.d.history.length = Math.min(this.d.history.length, 50);
    this.save();
    const rankAfter = rankOf(rp);
    return { won, rpBefore: before, rp, delta: rp - before, rankBefore, rankAfter, promoted: rankAfter.idx > rankBefore.idx || (rankAfter.idx === rankBefore.idx && rankAfter.div !== rankBefore.div && rp > before),
      xp, xpParts, lvBefore, lvAfter, unlocks, capped: cap !== undefined && won && rp - before < gain };
  }

  equipSkin(heroId, skin) { if (skin === 'base') delete this.d.equip.skins[heroId]; else this.d.equip.skins[heroId] = skin; this.save(); }
  skinsFor(ids) { const o = {}; for (const id of ids) { const s = this.d.equip.skins[id]; if (s && SKINS[s] && this.d.unlocked.skins.includes(s)) o[id] = s; } return o; }
  get banner() { return BANNERS[this.d.equip.banner] || BANNERS.plain; }
  get title() { return TITLES[this.d.equip.title] || TITLES.rookie; }
  equip(kind, id) { this.d.equip[kind] = id; this.save(); }
}
export const profile = new Profile();
