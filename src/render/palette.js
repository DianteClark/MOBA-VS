// Shared team palette. Arrays are mutated in place by settings (colour-blind mode),
// so every importer always reads the current colours.
export const TEAM_COL = ['#4aa3ff', '#ff5a5a', '#c8c8c8'];
export const TEAM_DARK = ['#1d4f8a', '#8a1d27', '#555'];
// '#rrggbb' + alpha → 'rgba(...)'
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
