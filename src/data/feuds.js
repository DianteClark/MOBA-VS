// Hero rivalries (v23): pairs with history. When one takes down the other, the killer says a line of
// their own instead of a generic one (render-only chatter, src/render/chatter.js). Plain ASCII only.
// Each entry: [a, b, line when a beats b, line when b beats a].
const FEUDS = [
  ['kenshi', 'sora', 'Your stance is still sloppy.', 'The student draws first!'],
  ['ember', 'frost', 'Melt, snowflake!', 'Fire goes out. Always.'],
  ['kaze', 'umbra', 'Too slow, shadow!', 'Loud ones die first.'],
  ['shiro', 'umbra', 'Two shadows. One left.', 'You copy my style badly.'],
  ['raiden', 'nami', 'Thunder beats the tide!', 'Even storms sink.'],
  ['oak', 'sanguis', 'The temple stands, Count.', 'Your blood was sweet, monk.'],
  ['valka', 'gorath', 'No wall breaks today, boar.', 'Shields crack. Oaths too.'],
  ['bastion', 'tetsu', 'Gates hold, golem.', 'Every gate falls.'],
  ['marlowe', 'umbra', 'Case closed, faceless.', 'No witnesses, detective.'],
  ['voss', 'fletch', 'Take my card, peasant.', 'Never miss twice, Baron.'],
  ['saru', 'ponta', 'The real trickster wins!', 'Nice crown. Mine now.'],
  ['leonin', 'fang', 'The pride eats first!', 'Caves are dark, kitty.'],
  ['azim', 'kitsu', 'Pay your tribute, fox.', 'Gold burns too, Sultan.'],
  ['hotaru', 'gaki', 'Back to the dark, ghost.', 'Your light tastes of fear.'],
  ['kaen', 'yuki', 'Fanned the flame!', 'Little spark, out.'],
  ['bolt', 'rekka', 'Iron outranges powder.', 'Boom. Siege that.'],
  ['grok', 'monolith', 'Big rock beat old rock!', 'The valley endures.'],
  ['akaro', 'wu', 'Your palms are weak, old man.', 'Patience beats horns.'],
  ['hex', 'kurai', 'One thread unravels the sage.', 'I read that rune coming.'],
  ['bonehook', 'aurelia', 'Hooked the sun!', 'Light finds every hook.'],
];
const BY = new Map();
for (const [a, b, ab, ba] of FEUDS) { BY.set(a + '>' + b, ab); BY.set(b + '>' + a, ba); }
// The killer's line, or null when the two have no history.
export const feudLine = (killerId, victimId) => BY.get(killerId + '>' + victimId) || null;
export const hasFeud = (a, b) => BY.has(a + '>' + b);
// Display list for the Dojo hero page: [{ id, line }] rivals of this hero.
export const feudsOf = (id) => FEUDS.filter((f) => f[0] === id || f[1] === id).map((f) => (f[0] === id ? { id: f[1], line: f[2] } : { id: f[0], line: f[3] }));
