// v26 tactic cards and build types (render-only; Math.random is fine here, nothing touches the sim).
//  * one-shot: a card played (sim fx kind 'card'): a team-coloured ring and a rising card glyph on each hero it
//    touched, a pulse where it landed; Blackout dims the screen of the team it blinds.
//  * every frame (information, kept with Reduced effects): the Bounty Hunt coin over its target, the Escort and
//    Lone Wolf rings, and Venom stacks (green pips under a poisoned hero).
// Reduced effects: no rings, glyph pops or screen dimming; the persistent marks stay (static, no pulsing).
import { TEAM_COL } from './palette.js';

const CARD_COL = { blackout: '#6a5acd', owl: '#fff2a8', charge: '#ff8a5a', fallback: '#9fe8ff', underdog: '#ffd84a', crash: '#4fc3f7', escort: '#7affc8',
  pit: '#c4874a', slowpush: '#a8f06a', lone: '#e4e8f2', echo: '#b48cff', raid: '#86d94f', wardline: '#fff8c8', snipe: '#ffe45c', bounty: '#ffd24a', revive: '#c6fff4' };

export class CardFx {
  constructor(r) { this.r = r; }
  fx(f) {
    const r = this.r, g = r.game, col = CARD_COL[f.card] || TEAM_COL[f.team], motion = r.motion;
    if (f.card === 'blackout' && r.viewTeam >= 0 && f.team !== r.viewTeam) { r.screenTint('#0a0618', 0.35, 1.4); r.text(r.cam.x, r.cam.y - 60, 'BLACKOUT', '#b9a2ff', 12, 1.4, 'pop'); return; }
    if (!motion) return;
    const u = f.id ? g.byId(f.id) : null;
    if (u && u.alive && r.visible(u)) { r.ring(u.x, u.y, 8, 46, col, 0.55, 3); r.puff(u.x, u.y - 8, 6, 22, col, 0.5, 0, -30); return; }
    let p = f.x !== undefined ? f : null;
    if (!p && f.lane && g.world.lanes[f.lane]) p = g.world.lanePoint(f.lane, 0.5);
    if (p && r.visiblePoint(p.x, p.y)) { r.ring(p.x, p.y, 20, 140, col, 0.9, 4); r.ring(p.x, p.y, 10, 90, '#ffffff', 0.7, 2, 0.15); }
  }
  // World-space marks, drawn above units and under bars. list: the drawables of this frame ({ u, x, y }).
  draw(ctx, list) {
    const r = this.r, g = r.game, now = g.tick, t = r.time, motion = r.motion;
    const marks = [];
    for (const tm of g.teams) {
      const S = tm.c2; if (!S) continue;
      if (S.bounty && S.bounty.until > now) marks.push([S.bounty.id, 'bounty', tm.id]);
      if (S.escort && S.escort.until > now) marks.push([S.escort.id, 'escort', tm.id]);
      if (S.lone && S.lone.until > now) marks.push([S.lone.id, 'lone', tm.id]);
    }
    for (const d of list) {
      const u = d.u; if (u.type !== 'hero' || !u.alive) continue;
      const v = u.venom;
      if (v && v.until > now) { ctx.fillStyle = '#000'; ctx.fillRect(Math.round(d.x - v.n * 3 - 1), Math.round(d.y + 9), v.n * 6 + 1, 5); ctx.fillStyle = v.n >= 5 ? '#c6ff5a' : '#5fbf3a'; for (let i = 0; i < v.n; i++) ctx.fillRect(Math.round(d.x - v.n * 3 + i * 6 + 1), Math.round(d.y + 10), 4, 3); }
      for (const [id, kind, team] of marks) {
        if (id !== u.id) continue;
        const pulse = motion ? 0.5 + 0.5 * Math.sin(t * 5) : 0.6;
        if (kind === 'bounty') {
          const y = d.y - 58 - (motion ? Math.sin(t * 3) * 2 : 0);
          ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(d.x, y, 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(d.x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8a5a00'; ctx.fillRect(Math.round(d.x - 1), Math.round(y - 3), 2, 6);
        } else {
          ctx.globalAlpha = 0.45 + 0.35 * pulse; ctx.strokeStyle = kind === 'escort' ? CARD_COL.escort : TEAM_COL[team]; ctx.lineWidth = 2;
          if (kind === 'lone') ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.ellipse(d.x, d.y + 2, 24, 11, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
      }
    }
  }
}
