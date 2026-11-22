// Hearth clan numbers and display text (v24). The sim reads HEARTH (src/sim/hearth.js); the Dojo, draft and HUD
// read the text. Pure data.
export const HEARTH = { max: 5, keeperMax: 6, bonfire: 5, dmg: 0.03, heal: 0.03, ms: 0.05, loss: 2 };

export const HEARTH_TEXT = {
  name: 'Hearthfire',
  short: 'Takedowns light embers. Each ember: Hearth heroes +3% damage and healing. A fallen Hearth hero loses 2.',
  rules: [
    'A Hearth hero in a takedown lights 1 ember (Kenta lights 2). Epic monsters light 1.',
    'Each ember gives Hearth heroes +3% damage and +3% heal and shield power.',
    'At 5 embers the Bonfire burns: Hearth heroes also move 5% faster.',
    'When a Hearth hero falls, the team loses 2 embers. Protect them.',
    'Aki keeps the flame: while she lives it never drops below 1, and it holds 6.',
  ],
};
