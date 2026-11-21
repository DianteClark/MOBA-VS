// Haptics: short vibrations on kills, objectives and your call results, where the device supports
// the Vibration API (Android Chrome; iOS Safari has none, so it quietly does nothing there).
import { settings } from './settings.js';

const can = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let last = 0;
export const hapticsSupported = can;
export const HAPTIC = {
  kill: 18,                 // we got a kill
  death: [12, 50, 12],      // we lost a hero
  objective: [30, 40, 60],  // we took an objective
  objectiveLost: 70,        // they took one
  callWin: [16, 40, 16],    // a call paid off
  callFail: 45,             // a call failed
  big: [40, 50, 40, 50, 80],// ace / multi-kill / victory
};
export function buzz(kind) {
  if (!can || !settings.haptics || document.hidden) return;
  const now = performance.now();
  if (now - last < 120) return; // a burst of events is one buzz, not a rattle
  last = now;
  try { navigator.vibrate(HAPTIC[kind] ?? kind); } catch { /* blocked until the first tap */ }
}
