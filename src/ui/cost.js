// Charge pips: the one visual language for what a call costs, everywhere it is offered (call buttons, decision
// cards, the map ring, sheet tiles). A gold diamond = a charge you have; a hollow one = a charge you are short.
// So "can I afford this?" reads at a glance, the same way on every control.
import { h } from './dom.js';

export const shortBy = (charges, n) => Math.max(0, n - Math.floor(charges + 1e-9));
export const pips = (n) => h('span', { class: 'cost' }, ...Array.from({ length: n }, () => h('i')));
// Mark the pips you can't pay for; returns the element (for inline use).
export function paintPips(el, charges) {
  if (!el) return el;
  const kids = el.children, have = Math.floor(charges + 1e-9);
  for (let i = 0; i < kids.length; i++) { const s = i >= have; if (kids[i].classList.contains('short') !== s) kids[i].classList.toggle('short', s); }
  el.classList.toggle('short', kids.length > have);
  return el;
}
