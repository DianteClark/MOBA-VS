// Ranked tiers in the UI: the results row, the promotion/demotion moment, and the Profile "Rank" tab.
import { h } from './dom.js';
import { TIERS, rankOf, SEASON_REWARDS, MIN_RATED_GAMES, AI_CAP, DIVS, START_ELO } from '../data/ranks.js';
import { SKINS, BANNERS, TITLES, rewardName } from '../data/seasons.js';
import { profile } from '../profile.js';
import { tierBadge } from './badges.js';
import { audio } from '../audio.js';
import { PRESTIGE, PRESTIGE_REWARDS } from '../data/meta.js';
import { rewardIcon } from './collection.js';
import { tweenNumber } from './juice.js';

const bar = (frac, color) => h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color } }));
const MODE_NOTE = { casual: 'Casual match: your rank is untouched.', rush: 'Lane Rush is casual: your rank is untouched.', rushOnline: 'Lane Rush is casual: your rank is untouched.' };

// Results: rank badge, rating change and division progress (or a casual note).
export function rankRow(sum) {
  const rk = sum.rankAfter;
  return h('div', { class: 'prow rankrow' }, tierBadge(rk, 44),
    h('div', { class: 'col', style: { gap: '3px', flex: 1 } },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { style: { color: rk.tier.color } }, rk.label),
        sum.rated ? delta(sum) : h('small', { class: 'muted' }, 'unranked')),
      bar(rk.into / rk.span, rk.tier.color),
      !sum.rated ? h('small', { class: 'muted' }, MODE_NOTE[sum.key] || 'This match did not count for rank.')
        : sum.promoted ? h('small', { class: 'gold' }, `Promoted to ${rk.label}!`) : sum.demoted ? h('small', { class: 'down' }, `Dropped to ${rk.label}`)
          : sum.capped ? h('small', { class: 'muted' }, 'This AI cannot take you higher: try a harder one or online ranked.')
            : h('small', { class: 'muted' }, rk.nextLabel ? `${rk.toNext} to ${rk.nextLabel}` : 'Top of the ladder')));
}

// "+18 (1018)": counts up from the old rating.
function delta(sum) {
  const el = h('b', { class: sum.delta >= 0 ? 'up' : 'down' });
  const fmt = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)} (${Math.round(sum.elo - sum.delta + v)})`;
  el.textContent = fmt(sum.delta);
  setTimeout(() => tweenNumber(el, 0, sum.delta, 900, fmt), 450);
  return el;
}

// The promotion / demotion moment: a full-width card over the results with the badge swap.
export function rankMoment(sum) {
  if (!sum || !sum.rated || !(sum.promoted || sum.demoted)) return;
  if (sum.demoted && sum.rg <= 3) return; // everyone starts on a division line: no DEMOTED card for a first loss (the results row still shows it)
  const up = sum.promoted, a = sum.rankBefore, b = sum.rankAfter, newTier = b.idx !== a.idx;
  const conf = up ? Array.from({ length: 26 }, (_, i) => h('i', { class: 'rconf', style: { '--x': `${(i * 37) % 100}%`, '--d': `${(i % 7) * 0.07}s`, '--c': [b.tier.color, '#fff', '#ffd84a', b.tier.gem][i % 4], '--r': `${(i * 53) % 360}deg` } })) : [];
  const el = h('div', { class: 'rankmoment ' + (up ? 'up' : 'down') + (newTier ? ' tier' : ''), style: { '--tc': b.tier.color }, onclick: () => close() },
    h('div', { class: 'rm-card' },
      h('div', { class: 'rm-rays' }),
      h('small', { class: 'rm-kicker' }, up ? (newTier ? 'NEW TIER' : 'PROMOTED') : 'DEMOTED'),
      h('div', { class: 'rm-badges' }, h('div', { class: 'rm-old' }, tierBadge(a, 56)), h('span', { class: 'rm-arrow' }, '▶'), h('div', { class: 'rm-new' }, tierBadge(b, 96))),
      h('b', { class: 'rm-name', style: { color: b.tier.color } }, b.label),
      h('small', { class: 'muted' }, up ? `Rating ${sum.elo} · ${b.nextLabel ? `${b.toNext} to ${b.nextLabel}` : 'the summit'}` : `Rating ${sum.elo} · ${b.toNext} to climb back to ${a.label}`),
      h('small', { class: 'rm-tap' }, 'tap to continue')),
    ...conf);
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  document.body.append(el);
  setTimeout(() => audio.sfx(up ? 'powerup' : 'cancel', 0.9), 250);
  if (up && newTier) setTimeout(() => audio.sfx('objective', 0.7), 700);
  setTimeout(close, up ? 3800 : 2800);
}

// Profile → Rank: current badge, rating, the full tier ladder and end-of-season rewards.
export function rankTab() {
  const ss = profile.ss(), rk = rankOf(ss.elo), peak = rankOf(ss.peakElo);
  const rw = (r) => h('span', { class: 'rwd' }, r.kind === 'skin' ? h('i', { class: 'sw', style: { background: SKINS[r.id].swatch } }) : r.kind === 'banner' ? h('i', { class: 'bn', style: { background: BANNERS[r.id].bg } }) : r.kind === 'border' ? h('i', { class: 'bd', style: { borderColor: TIERS.find((t) => t.id === r.id).color } }) : h('i', { class: 'tt' }, 'T'),
    h('small', {}, r.kind === 'title' ? `“${TITLES[r.id]}”` : rewardName(r)));
  return h('div', { class: 'col ranktab' },
    h('div', { class: 'panel rk-now', style: { '--tc': rk.tier.color } },
      tierBadge(rk, 84, 'rk-big'),
      h('div', { class: 'col', style: { gap: '4px', flex: 1, minWidth: 0 } },
        h('b', { class: 'rk-label', style: { color: rk.tier.color } }, rk.label),
        h('span', {}, `Rating ${ss.elo}`, h('small', { class: 'muted' }, ` · peak ${peak.label} (${ss.peakElo})`)),
        bar(rk.into / rk.span, rk.tier.color),
        h('small', { class: 'muted' }, `${ss.rg} rated match${ss.rg === 1 ? '' : 'es'} this season${ss.rg < MIN_RATED_GAMES ? ` · play ${MIN_RATED_GAMES - ss.rg} more to earn season rewards` : ''}`))),
    h('div', { class: 'panel rk-ladder' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, 'Tiers & season rewards'), h('small', { class: 'muted' }, 'Rewards for your peak tier (and every tier below) arrive when the season ends.')),
      // Prestige: past Kami I, a rank every 100 rating, each with its own badge; the looks below come once
      h('div', { class: 'rk-tier prestige' + (rk.prestige ? ' cur got' : ''), style: { '--tc': '#fff6dc' } },
        tierBadge(rankOf(PRESTIGE.from + (Math.max(1, rk.prestige) - 1) * PRESTIGE.step), 34),
        h('div', { class: 'rk-tn' }, h('b', { style: { color: '#fff6dc' } }, rk.prestige ? `Prestige ${rk.prestige}` : 'Prestige'), h('small', { class: 'muted' }, `${PRESTIGE.from}+, 1-${PRESTIGE.max}`)),
        h('div', { class: 'rk-divs' }, h('small', { class: 'muted' }, 'every 100')),
        h('div', { class: 'rk-rw' }, ...Object.entries(PRESTIGE_REWARDS).map(([n, r]) => h('span', { class: 'rwd', title: `Prestige ${n}: ${rewardName(r)}` }, rewardIcon(r), h('small', {}, `P${n}`))))),
      ...TIERS.slice().reverse().map((t) => {
        const i = TIERS.indexOf(t), mine = rk.idx === i, got = peak.idx >= i;
        return h('div', { class: 'rk-tier' + (mine ? ' cur' : '') + (got ? ' got' : ''), style: { '--tc': t.color } },
          tierBadge(rankOf(i === 0 ? 850 : t.min), 34),
          h('div', { class: 'rk-tn' }, h('b', { style: { color: t.color } }, t.name), h('small', { class: 'muted' }, i === 0 ? `below ${TIERS[1].min}` : `${t.min}+`)),
          h('div', { class: 'rk-divs' }, ...DIVS.map((d, k) => h('span', { class: mine && rk.d === k ? 'on' : '' }, d))),
          h('div', { class: 'rk-rw' }, ...(SEASON_REWARDS[t.id] || []).map(rw)));
      })),
    h('small', { class: 'muted center' }, `Start of season: ${START_ELO} (Silver III). Ranked vs AI, the Season Cup and online Ranked move your rating; Casual and Lane Rush never do. Easy AI tops out at ${rankOf(AI_CAP[0]).label}, Normal at ${rankOf(AI_CAP[1]).label}, Hard at ${rankOf(AI_CAP[2]).label}: Kami is earned online.`));
}
