// Koban (the champion currency): the single way a feature outside a match grants it (story campaign stars, the
// Coach Academy). The economy lives in src/unlocks.js: the grant goes into the coach's ledger at once and is
// queued as a claim for the server (worker/koban.js), which re-applies the same lifetime cap.
//   grantKoban(n, reason)  n > 0 whole Koban; reason: a short key for logs ('campaign:c1m3', 'tutorial'). Returns
//   the Koban credited (less than n once the campaign cap is reached).
import { profile } from './profile.js';
import { earnCampaign, syncKoban } from './unlocks.js';

export function grantKoban(n, reason) {
  const got = earnCampaign(profile, n, reason);
  if (got) { profile.save(); syncKoban(profile); }
  return got;
}
