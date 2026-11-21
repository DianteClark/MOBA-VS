// Plain-English hero/ability text generated from hero data (draft side panel + Dojo hero page).
const KIND = { shot: 'Skillshot', line: 'Line', target: 'Targeted', circle: 'Ground area', nova: 'Around self', dash: 'Dash', self: 'Self buff', ally: 'On an ally', allynova: 'Whole team', hook: 'Hook', zone: 'Lingering zone' };
const STAT = { asPct: 'attack speed', msPct: 'move speed', power: 'power', armor: 'armor', mr: 'magic resist', haste: 'ability haste', omnivamp: 'omnivamp', crit: 'crit chance', range: 'attack range', slowOnHit: 'slow on hit', thorns: 'thorns' };
const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (v) => `${+v.toFixed(2)}s`;
function ratios(v) {
  const r = [];
  if (v.ad) r.push(`${pct(v.ad)} AD`); if (v.ap) r.push(`${pct(v.ap)} AP`); if (v.hp) r.push(`${(v.hp * 100).toFixed(0)}% max HP`);
  return r;
}
function amount(v) { const r = ratios(v); return `${v.b || 0}${v.l ? ` (+${v.l}/lvl)` : ''}${r.length ? ' + ' + r.join(' + ') : ''}`; }
function ccText(cc) {
  const o = [];
  if (cc.stun) o.push(`stuns for ${secs(cc.stun)}`); if (cc.root) o.push(`roots for ${secs(cc.root)}`); if (cc.knock) o.push(`knocks up for ${secs(cc.knock)}`);
  if (cc.slow) o.push(`slows ${pct(cc.slow[0])} for ${secs(cc.slow[1])}`);
  return o;
}
const statList = (st) => Object.entries(st).map(([k, v]) => (v < 1 && !['armor', 'mr', 'power', 'haste', 'range'].includes(k) ? `+${pct(v)} ` : `+${v} `) + (STAT[k] || k)).join(', ');

// Short one-liner (draft side panel, compact lists).
export function describeAbility(a) {
  const parts = [KIND[a.kind]];
  if (a.dmg) parts.push(`${a.dmg.b}${a.dmg.l ? '+' + a.dmg.l + '/lvl' : ''} dmg`);
  if (a.cc) { const c = a.cc; if (c.stun) parts.push(`stun ${c.stun}s`); if (c.root) parts.push(`root ${c.root}s`); if (c.knock) parts.push(`knock-up ${c.knock}s`); if (c.slow) parts.push(`slow ${pct(c.slow[0])}`); }
  if (a.burn) parts.push('burn'); if (a.heal) parts.push('heal'); if (a.shield) parts.push('shield');
  if (a.buff) parts.push(Object.keys(a.buff.stats).map((k) => STAT[k] || k).join('/') + ' buff');
  parts.push(`${a.cd}s cd`);
  return parts.join(' · ');
}

// Full sentence(s) for the Dojo: what it does, how hard it hits, its CC, reach and cooldown.
export function abilitySentence(a, hero) {
  const out = [];
  const who = a.kind === 'ally' ? 'an ally' : a.kind === 'allynova' ? `allies within ${a.radius}` : 'enemies';
  const where = { shot: `Fires a projectile${a.pierce ? ' that pierces' : ''}`, line: 'Strikes in a line', target: 'Hits one target', circle: `Hits an area (${a.radius} wide)${a.delay ? ` after ${secs(a.delay)}` : ''}`,
    nova: `Hits everything within ${a.radius}`, dash: `Dashes${a.radius ? ' and hits around the landing spot' : ''}`, self: 'Empowers himself', ally: 'Targets an ally', allynova: 'Affects the whole team nearby',
    hook: 'Throws a hook that pulls the first enemy hit', zone: `Leaves a zone (${a.radius} wide) for ${secs(a.dur || 3)}` }[a.kind];
  let s = where;
  if (a.dmg) {
    const type = a.type || hero.dmgType;
    s += `, dealing ${amount(a.dmg)} ${type === 'true' ? 'true' : type === 'phys' ? 'physical' : 'magic'} damage${a.dmg.miss ? ` plus ${pct(a.dmg.miss)} of the target's missing HP` : ''}${a.kind === 'zone' ? ' per tick' : ''}`;
  }
  out.push(s + '.');
  if (a.cc) { const c = ccText(a.cc); if (c.length) out.push(`It ${c.join(' and ')}.`); }
  if (a.burn) out.push(`Burns for ${amount(a.burn)} over ${secs(a.burn.dur)}.`);
  if (a.heal) out.push(`Heals ${a.kind === 'ally' || a.kind === 'allynova' ? who : 'himself'} for ${a.heal.hp && !a.heal.b ? `${pct(a.heal.hp)} max HP` : amount(a.heal)}.`);
  if (a.shield) out.push(`Shields ${a.kind === 'ally' || a.kind === 'allynova' ? who : 'himself'} for ${amount(a.shield)} (${secs(a.shield.dur || 2)}).`);
  if (a.buff) out.push(`Grants ${statList(a.buff.stats)} for ${secs(a.buff.dur)}${a.kind === 'ally' ? ' to the ally' : a.kind === 'allynova' ? ' to the team' : ''}.`);
  const meta = [];
  if (a.range) meta.push(`${a.range} range`);
  meta.push(`${a.cd}s cooldown`);
  return { text: out.join(' ').replace(/himself/g, 'self'), meta: `${KIND[a.kind]} · ${meta.join(' · ')}` };
}
