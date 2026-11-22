// Co-op coaching: two human coaches share one team. Deterministic and pure (lockstep-safe).
//
// Active only when the match config has `coop`: cfg.coop[t] = { seats, own, lead } or null.
//   seats: 1 or 2 humans on that team (a co-op room gives every human team a config, so a coach
//          who loses their partner, or a whole team that disconnects, is handled the same way);
//   own:   role → seat (0 or 1), e.g. { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 };
//   lead:  the seat that owns team-wide calls.
// Every command from a co-op team carries the issuing coach's `seat`. The rules (one place, here):
//   * Hero calls (gank, split, build, permit) only for heroes of your own seat.
//   * Team calls (objectives, push, shrine, defend, regroup, invade, focus, Oni, ults, tactic cards,
//     Coach Moments, Kami Surge, plan, card swap) belong to the lead. The other coach's taps on those
//     buttons become suggestions the lead confirms with one tap (a UI side channel, not a command).
//   * Cancel from the lead cancels everything; from the partner it cancels their own heroes' calls.
//   * 'lead' (from the lead) hands the lead to the partner.
//   * 'leave' (a system command the session issues when a coach disconnects) hands that coach's heroes
//     and the lead to the partner, or to the AI coach when no human is left on the team.
// Without cfg.coop none of this runs and commands behave exactly as before.
import { Coach } from './coach.js';
import { HEROES, HERO_BY_ID, ROLES, matchupScore } from '../data/heroes.js';
import { currentTurn, taken, apply as draftApply, synergyScore } from './draft.js';

export const HERO_CMDS = new Set(['gank', 'split', 'build', 'permit', 'talent', 'item']);
export const DEFAULT_OWN = { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 };

// A clean role → seat split (each seat at least one role).
export function cleanOwn(own) {
  const o = {}; for (const r of ROLES) o[r] = own && own[r] === 1 ? 1 : 0;
  const n1 = ROLES.filter((r) => o[r] === 1).length;
  return n1 === 0 || n1 === ROLES.length ? { ...DEFAULT_OWN } : o;
}

export function setupCoop(g) {
  const cc = g.cfg.coop; if (!cc) return;
  for (let t = 0; t < 2; t++) {
    const c = cc[t]; if (!c) continue;
    const seats = c.seats === 1 ? 1 : 2, own = cleanOwn(c.own);
    g.teams[t].coop = { seats, lead: seats === 2 && c.lead === 1 ? 1 : 0, left: [false, seats < 2], ai: false };
    for (const h of g.teams[t].heroes) h.seat = seats === 1 ? 0 : own[h.role];
  }
}

// Called by Game.applyCommand for co-op teams before anything else: false = rejected, true = fully
// handled here, undefined = allowed (the normal command code runs).
export function coopGate(g, c) {
  const team = g.teams[c.team], co = team.coop;
  if (c.sys) return c.type === 'leave' ? leave(g, c.team, c.seat === 1 ? 1 : 0) : false;
  if (co.ai) return undefined; // every human left: the AI coach runs the team
  const seat = c.seat === 1 && co.seats === 2 ? 1 : 0;
  if (co.left[seat]) return false;
  if (c.type === 'lead') {
    if (seat !== co.lead || co.seats < 2 || co.left[1 - seat]) return false;
    co.lead = 1 - seat;
    g.emit({ type: 'coop', team: c.team, what: 'lead', seat: co.lead });
    return true;
  }
  if (c.type === 'leave') return false;
  if (c.type === 'cancel' && seat !== co.lead) {
    for (const h of team.heroes) if (h.alive && h.seat === seat) { if (h.task.call) h.task = { kind: 'idle' }; h.pendingCall = null; }
    return true;
  }
  if (c.type === 'scout') return undefined; // the scout pet (Bosses & Beasts): either coach may send it
  if (HERO_CMDS.has(c.type)) {
    // the same hero the command code will use (gank falls back to the jungler)
    const h = team.heroes.find((x) => x.id === c.hero) || (c.type === 'gank' ? team.heroes.find((x) => x.role === 'jungle') : null);
    return h && h.seat === seat ? undefined : false;
  }
  return seat === co.lead ? undefined : false;
}

function leave(g, t, seat) {
  const co = g.teams[t].coop;
  if (!co || co.ai || co.left[seat]) return false;
  co.left[seat] = true;
  const other = co.seats === 2 && !co.left[1 - seat] ? 1 - seat : -1;
  if (other >= 0) { for (const h of g.teams[t].heroes) h.seat = other; co.lead = other; }
  else { co.ai = true; g.coaches[t] = new Coach(g, t, 1); }
  g.emit({ type: 'coop', team: t, what: 'leave', seat, to: other });
  return true;
}

// ── read-only helpers for the UI ──
export function canCommand(g, team, seat, cmd) {
  const co = g.teams[team] && g.teams[team].coop;
  if (!co || co.ai) return true;
  if (cmd.type === 'cancel' || cmd.type === 'scout') return true;
  if (HERO_CMDS.has(cmd.type)) {
    const t = g.teams[team], h = t.heroes.find((x) => x.id === cmd.hero) || (cmd.type === 'gank' ? t.heroes.find((x) => x.role === 'jungle') : null);
    return !!h && h.seat === seat;
  }
  return seat === co.lead;
}

// ───────────── co-op draft (pure; both peers run the same rules) ─────────────
// splits[t]: role → seat for a team with two coaches, or null. d.seats[t] records who picked each hero.
// Bans alternate (the lead first); picks alternate between the coaches until each has filled their roles.
// A coach may only pick a hero that fits one of their own still-open roles.
function ensureSeats(d) { if (!d.seats) d.seats = [[], []]; return d; }
export function draftActor(d, team, own, lead = 0) {
  ensureSeats(d);
  const t = currentTurn(d); if (!t || t.team !== team || !own) return 0;
  if (t.act === 'ban') return (d.bans[team].length + lead) % 2;
  const need = [0, 1].map((s) => ROLES.filter((r) => own[r] === s).length);
  const done = [0, 1].map((s) => d.seats[team].filter((x) => x === s).length);
  if (done[0] >= need[0]) return 1;
  if (done[1] >= need[1]) return 0;
  return done[(lead) % 2] <= done[(lead + 1) % 2] ? lead : 1 - lead;
}
// Heroes of one seat can take distinct roles among that seat's roles.
function fitsRoles(ids, roles) {
  const hs = ids.map((id) => HERO_BY_ID[id]); let ok = false; const used = new Set();
  (function go(i) {
    if (ok) return; if (i === hs.length) { ok = true; return; }
    for (const r of hs[i].roles) if (roles.includes(r) && !used.has(r)) { used.add(r); go(i + 1); used.delete(r); if (ok) return; }
  })(0);
  return ok;
}
export const seatRoles = (own, seat) => ROLES.filter((r) => own[r] === seat);
function seatPicks(d, team, seat) { ensureSeats(d); return d.picks[team].filter((_, i) => d.seats[team][i] === seat); }
// Any champion may go to any role (v25.1): a coach only needs one of their own roles still open. strict: the
// hero must also fit one of them (the timeout / AI auto-pick stays on-role).
export function coopLegal(d, team, seat, heroId, own, strict = false) {
  const t = currentTurn(d);
  if (!t || t.team !== team || !HERO_BY_ID[heroId] || taken(d, team).has(heroId)) return false;
  if (t.act === 'ban') return true;
  const mine = seatPicks(d, team, seat), roles = seatRoles(own, seat);
  return strict ? fitsRoles([...mine, heroId], roles) : mine.length < roles.length;
}
export function coopApply(d, team, seat, heroId, own) {
  ensureSeats(d);
  const t = currentTurn(d);
  if (!t || !coopLegal(d, team, seat, heroId, own)) return false;
  if (!draftApply(d, team, heroId)) return false;
  if (t.act === 'pick') d.seats[team].push(seat);
  return true;
}
// Timeout / fallback pick for one coach's open roles (deterministic given the rng).
export function coopAutoChoice(d, team, seat, own, rng) {
  const t = currentTurn(d); if (!t) return null;
  const enemy = d.picks[1 - team].map((id) => HERO_BY_ID[id]), tk = taken(d, team);
  let best = null, bs = -Infinity;
  const strict = t.act === 'pick' && fitsRoles(seatPicks(d, team, seat), seatRoles(own, seat)) && HEROES.some((h) => !tk.has(h.id) && coopLegal(d, team, seat, h.id, own, true));
  for (const h of HEROES) {
    if (tk.has(h.id) || !coopLegal(d, team, seat, h.id, own, strict)) continue;
    const s = (t.act === 'ban' ? matchupScore(h, d.picks[team].map((id) => HERO_BY_ID[id])).score : matchupScore(h, enemy).score + synergyScore(d.picks[team], h.id)) * 2 + (rng ? rng.next() * 1.5 : 0);
    if (s > bs) { bs = s; best = h.id; }
  }
  return best;
}
// Roles for the finished draft: each coach's heroes on that coach's roles.
export function coopRoles(d, team, own) {
  ensureSeats(d);
  const out = new Array(d.picks[team].length).fill(null);
  for (const seat of [0, 1]) {
    const idx = d.picks[team].map((_, i) => i).filter((i) => d.seats[team][i] === seat), roles = seatRoles(own, seat), used = new Set();
    const go = (k) => {
      if (k === idx.length) return true;
      const h = HERO_BY_ID[d.picks[team][idx[k]]];
      for (const r of [h.role, ...h.roles]) if (roles.includes(r) && !used.has(r)) { used.add(r); out[idx[k]] = r; if (go(k + 1)) return true; used.delete(r); }
      return false;
    };
    if (!go(0)) { // an off-role pick: fitting heroes keep their roles where they can, the rest fill what is left
      const left = roles.slice(), put = (k, r) => { out[idx[k]] = r; left.splice(left.indexOf(r), 1); };
      idx.forEach((_, k) => { out[idx[k]] = null; });
      idx.forEach((_, k) => { const h = HERO_BY_ID[d.picks[team][idx[k]]], r = [h.role, ...h.roles].find((q) => left.includes(q)); if (r) put(k, r); });
      idx.forEach((_, k) => { if (!out[idx[k]] && left.length) put(k, left[0]); });
    }
  }
  return out;
}
