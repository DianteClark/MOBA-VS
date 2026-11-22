// Hero/ability text generated from hero data (draft side panel + Dojo hero page), in the player's language.
import { t } from '../i18n/i18n.js';
const KIND = { shot: 'Skillshot', line: 'Line', target: 'Targeted', circle: 'Ground area', nova: 'Around self', dash: 'Dash', self: 'Self buff', ally: 'On an ally', allynova: 'Whole team', hook: 'Hook', zone: 'Lingering zone' };
const STAT = { asPct: 'attack speed', msPct: 'move speed', power: 'power', armor: 'armor', mr: 'magic resist', haste: 'ability haste', omnivamp: 'omnivamp', crit: 'crit chance', range: 'attack range', slowOnHit: 'slow on hit', thorns: 'thorns',
  tenacity: 'tenacity', siegePct: 'structure damage', sunder: 'armor shred per hit', dmgPct: 'damage', drPct: 'damage reduction' };
const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => t('{0}s', +v.toFixed(2));
// Ability text is built from translated pieces (src/i18n): every template below is one catalog entry.
const K = (k) => t(KIND[k]);
const S = (k) => t(STAT[k] || k);
const and = (list) => list.reduce((a, b) => (a === null ? b : t('{0} and {1}', a, b)), null) || '';
function ratios(v) {
  const r = [];
  if (v.ad) r.push(t('{0} AD', pct(v.ad))); if (v.ap) r.push(t('{0} AP', pct(v.ap))); if (v.hp) r.push(t('{0}% max HP', (v.hp * 100).toFixed(0)));
  return r;
}
function amount(v) { const r = ratios(v); return `${v.b || 0}${v.l ? ' ' + t('(+{0}/lvl)', v.l) : ''}${r.length ? ' + ' + r.join(' + ') : ''}`; }
function ccText(cc) {
  const o = [];
  if (cc.stun) o.push(t('stuns for {0}', secs(cc.stun))); if (cc.root) o.push(t('roots for {0}', secs(cc.root))); if (cc.knock) o.push(t('knocks up for {0}', secs(cc.knock)));
  if (cc.slow) o.push(t('slows {0} for {1}', pct(cc.slow[0]), secs(cc.slow[1])));
  if (cc.silence) o.push(t('silences for {0}', secs(cc.silence))); if (cc.fear) o.push(t('fears for {0}', secs(cc.fear)));
  if (cc.shred) o.push(t('shreds {0} armor and MR for {1}', pct(cc.shred[0]), secs(cc.shred[1])));
  if (cc.mark) o.push(t('marks (next ally hit +{0}) for {1}', pct(cc.mark[0]), secs(cc.mark[1])));
  if (cc.grievous) o.push(t('applies Grievous Wounds for {0}', secs(cc.grievous)));
  return o;
}
const statList = (st) => Object.entries(st).map(([k, v]) => (v < 1 && !['armor', 'mr', 'power', 'haste', 'range'].includes(k) ? `+${pct(v)} ` : `+${v} `) + S(k)).join(', ');

// Short one-liner (draft side panel, compact lists).
export function describeAbility(a) {
  const parts = [K(a.kind)];
  if (a.dmg) parts.push(t('{0} dmg', `${a.dmg.b}${a.dmg.l ? '+' + a.dmg.l + t('/lvl') : ''}`));
  if (a.cc) { const c = a.cc; if (c.stun) parts.push(t('stun {0}s', c.stun)); if (c.root) parts.push(t('root {0}s', c.root)); if (c.knock) parts.push(t('knock-up {0}s', c.knock)); if (c.slow) parts.push(t('slow {0}', pct(c.slow[0])));
    if (c.silence) parts.push(t('silence {0}s', c.silence)); if (c.fear) parts.push(t('fear {0}s', c.fear)); if (c.shred) parts.push(t('shred {0}', pct(c.shred[0]))); if (c.mark) parts.push(t('mark')); if (c.grievous) parts.push(t('anti-heal')); }
  for (const [k, w] of [['stealth', 'stealth'], ['cleanse', 'cleanse'], ['parry', 'parry'], ['knockAway', 'knockback'], ['pull', 'pull'], ['resetOnKill', 'resets on kill']]) if (a[k]) parts.push(t(w));
  if (a.burn) parts.push(t('burn')); if (a.heal) parts.push(t('heal')); if (a.shield) parts.push(t('shield'));
  if (a.buff) parts.push(t('{0} buff', Object.keys(a.buff.stats).map(S).join('/')));
  parts.push(t('{0}s cd', a.cd));
  return parts.join(' · ');
}

// Full sentence(s) for the Dojo: what it does, how hard it hits, its CC, reach and cooldown.
export function abilitySentence(a, hero) {
  const out = [];
  const team = a.kind === 'ally' || a.kind === 'allynova';
  const who = a.kind === 'ally' ? t('an ally') : a.kind === 'allynova' ? t('allies within {0}', a.radius) : t('enemies');
  const type = a.type || hero.dmgType, dtype = type === 'true' ? 'true' : type === 'phys' ? 'physical' : 'magic';
  const where = {
    shot: a.pierce ? t('Fires a projectile that pierces') : t('Fires a projectile'), line: t('Strikes in a line'), target: t('Hits one target'),
    circle: a.delay ? t('Hits an area ({0} wide) after {1}', a.radius, secs(a.delay)) : t('Hits an area ({0} wide)', a.radius),
    nova: t('Hits everything within {0}', a.radius), dash: a.radius ? t('Dashes and hits around the landing spot') : t('Dashes'), self: t('Empowers self'), ally: t('Targets an ally'),
    allynova: t('Affects the whole team nearby'), hook: t('Throws a hook that pulls the first enemy hit'), zone: t('Leaves a zone ({0} wide) for {1}', a.radius, secs(a.dur || 3)) }[a.kind];
  if (a.dmg) {
    const dm = amount(a.dmg);
    let d = dtype === 'true' ? t('{0}, dealing {1} true damage', where, dm) : dtype === 'physical' ? t('{0}, dealing {1} physical damage', where, dm) : t('{0}, dealing {1} magic damage', where, dm);
    if (a.dmg.miss) d = t("{0} plus {1} of the target's missing HP", d, pct(a.dmg.miss));
    if (a.kind === 'zone') d = t('{0} per tick', d);
    out.push(t('{0}.', d));
  } else out.push(t('{0}.', where));
  if (a.cc) { const c = ccText(a.cc); if (c.length) out.push(t('It {0}.', and(c))); }
  if (a.burn) out.push(t('Burns for {0} over {1}.', amount(a.burn), secs(a.burn.dur)));
  if (a.heal) { const v = a.heal.hp && !a.heal.b ? t('{0} max HP', pct(a.heal.hp)) : amount(a.heal); out.push(team ? t('Heals {0} for {1}.', who, v) : t('Heals self for {0}.', v)); }
  if (a.shield) out.push(team ? t('Shields {0} for {1} ({2}).', who, amount(a.shield), secs(a.shield.dur || 2)) : t('Shields self for {0} ({1}).', amount(a.shield), secs(a.shield.dur || 2)));
  if (a.buff) out.push(a.kind === 'ally' ? t('Grants {0} for {1} to the ally.', statList(a.buff.stats), secs(a.buff.dur)) : a.kind === 'allynova' ? t('Grants {0} for {1} to the team.', statList(a.buff.stats), secs(a.buff.dur)) : t('Grants {0} for {1}.', statList(a.buff.stats), secs(a.buff.dur)));
  if (a.allyDash) out.push(t('Dashes to the ally first and shields both.'));
  if (a.allyShield) out.push(t('Shields nearby allies for {0}.', amount(a.allyShield)));
  if (a.enemyCc) { const c = ccText(a.enemyCc); if (c.length) out.push(t('Also {0} every visible enemy nearby.', and(c))); }
  if (a.onHitAlly) out.push(t("The ally's attacks deal {0} bonus magic damage for {1}.", amount(a.onHitAlly), secs(a.onHitAlly.dur || 4)));
  if (a.cleanse) out.push(t('Removes all crowd control and debuffs.'));
  if (a.stealth) out.push(t('Turns invisible for {0} (the first hit out of stealth deals +25%).', secs(a.stealth)));
  if (a.parry) out.push(t('Parries the next hero hit within {0}, stunning the attacker for {1}.', secs(a.parry.dur), secs(a.parry.stun)));
  if (a.selfRoot) out.push(t('Plants in place (cannot move) for {0}.', secs(a.selfRoot)));
  if (a.knockAway) out.push(t('Knocks enemies {0} away.', a.knockAway));
  if (a.pull) out.push(t('Pulls enemies toward the center.'));
  if (a.bounce) out.push(t('Bounces to {0} more nearby enemies for 60% damage.', a.bounce));
  if (a.splash) out.push(t('Explodes on the first hit ({0} wide).', a.splash));
  if (a.reveal) out.push(t('Reveals enemies hit for {0}.', secs(a.reveal)));
  if (a.resetOnKill) out.push(t('If the target dies within 3s, the cooldown resets.'));
  const meta = [];
  if (a.range) meta.push(t('{0} range', a.range));
  meta.push(t('{0}s cooldown', a.cd));
  return { text: out.join(' '), meta: `${K(a.kind)} · ${meta.join(' · ')}` };
}
