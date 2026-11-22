// Koban (the champion currency): the single way any feature grants it. The `unlocks` branch owns the economy
// (balance, purchases, server validation, sync caps) and replaces this file's body with its own grantKoban.
// Until then grants are banked in the local profile (profile.d.koban, a plain number), which that economy adopts.
//   grantKoban(n, reason)  n > 0 whole Koban; reason: a short key for logs ('campaign:c1m3', 'tutorial'). Returns n.
import { profile } from './profile.js';

export function grantKoban(n, reason) {
  n = Math.max(0, Math.floor(+n || 0));
  if (!n) return 0;
  profile.d.koban = Math.min(1e7, (profile.d.koban || 0) + n);
  profile.save();
  void reason;
  return n;
}
