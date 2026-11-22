// Party UI: the shared party panel on Home (members, ready, mode, quick chat, Start / Ready), the invite
// dialog (online friends, invite link, party code) and the "joining your party's room" screen.
// The party itself lives in src/party.js; this file only draws it.
import { h, mount, toast } from './dom.js';
import { tierBadge } from './badges.js';
import { BANNERS } from '../data/seasons.js';
import { audio } from '../audio.js';
import { getAccount, online } from '../net/online.js';
import { socialData, refreshSocial, onSocial } from './social.js';
import { party, mate, onParty, createParty, leaveParty, setReady, setMode, stopWaiting, sendChat, partyStart, inviteToParty, setPartyUi, PARTY_LINES, PARTY_MODES } from '../party.js';

const DIFF = ['Easy', 'Normal', 'Hard'];
const MODE_SHORT = [['coop', 'vs AI'], ['mm2', 'Match'], ['room2', 'Room']];
const MODE_DESC = { coop: 'two coaches, one team, vs the AI', mm2: 'Find Match: you two vs another pair', room2: 'Private room: share the code with another pair' };
const SAY_MS = 4000;

// Home's side column while in a party. It redraws itself on every party change while it is on screen.
export function partyPanel(app) {
  const el = h('div', { class: 'h2card ppanel', 'data-view': 'party' });
  let chatOpen = false, tm = 0;
  const render = () => {
    const P = party();
    if (!el.isConnected && el.dataset.drawn) { off(); clearTimeout(tm); return; }
    el.dataset.drawn = '1';
    if (!P) { mount(el); return; }
    const m = mate(), lead = P.leader, self = P.members.find((x) => x.self);
    const now = Date.now();
    const said = (x) => (x.said && now - x.said.t < SAY_MS ? h('span', { class: 'psay' }, PARTY_LINES[x.said.i]) : null);
    const state = (x) => (x.lost ? ['Reconnecting…', 'lost'] : x.busy ? ['In a match', 'busy'] : x.leader ? ['Leader', 'lead'] : x.ready ? ['Ready', 'ready'] : ['Not ready', 'wait']);
    const row = (x) => { const [txt, cls] = state(x), b = x.looks && x.looks.banner && BANNERS[x.looks.banner];
      return h('div', { class: 'pmem' + (x.self ? ' me' : ''), style: b ? { background: b.bg } : {} },
        tierBadge(x.elo || 1000, 18), h('span', { class: 'pt-n' }, x.leader ? h('i', { class: 'crown', title: 'Party leader' }) : null, x.name + (x.self ? ' (you)' : '')),
        said(x) || h('small', { class: 'pst ' + cls }, txt)); };
    const slot = lead && !m ? h('button', { class: 'pmem pinv', onclick: () => openInvite(app) }, h('b', {}, '+'), h('span', {}, 'Invite a friend'))
      : !m && !lead ? h('div', { class: 'pmem muted' }, P.status || 'Connecting…') : null;
    const mode = P.mode, ready = !m || m.ready;
    const main = lead
      ? P.want ? h('button', { class: 'btn pgo waiting', title: 'Tap to stop waiting', onclick: () => stopWaiting() }, `Waiting for ${m ? m.name : 'partner'}…`)
        : h('button', { class: 'btn pgo' + (ready && !(mode === 'coop' && !m) ? ' hot' : ''), disabled: !P.up || (mode === 'coop' && !m) || (m && (m.busy || m.lost)), onclick: () => partyStart(app, mode) }, mode === 'mm2' ? 'Find 2v2' : mode === 'room2' ? 'Open room' : 'Start')
      : h('button', { class: 'btn pgo' + (self && self.ready ? '' : ' hot') + (P.want && !(self && self.ready) ? ' nudge' : ''), disabled: !P.link, onclick: () => setReady(!(self && self.ready)) }, self && self.ready ? 'Not ready' : 'Ready');
    const chat = chatOpen ? h('div', { class: 'pchat', role: 'menu' }, ...PARTY_LINES.map((l, i) => h('button', { class: 'chip', role: 'menuitem', onclick: () => { chatOpen = false; sendChat(i); render(); } }, l))) : null;
    mount(el,
      h('div', { class: 'pt-head' }, h('b', {}, 'Party'), h('small', { class: 'muted', title: 'Party code: friends can type it in Join' }, P.code),
        h('button', { class: 'pleave', title: lead ? 'Leave and disband the party' : 'Leave the party', onclick: () => { if (confirm(lead ? 'Leave and disband your party?' : 'Leave the party?')) leaveParty(app); } }, 'Leave')),
      h('div', { class: 'pmems' }, ...P.members.map(row), slot),
      lead ? h('div', { class: 'seg3 pmodes', role: 'radiogroup', 'aria-label': 'Party mode' }, ...MODE_SHORT.map(([k, l]) =>
        h('button', { class: 'chip' + (mode === k ? ' on' : ''), role: 'radio', 'aria-checked': String(mode === k), title: PARTY_MODES[k], onclick: () => { audio.sfx('move', 0.4); setMode(k); } }, l))) : null,
      h('small', { class: 'pt-desc' }, h('b', {}, PARTY_MODES[mode] + (mode === 'coop' ? ` · ${DIFF[app.aiLevel ?? 1]}` : '')), ' · ', MODE_DESC[mode]),
      chat,
      h('div', { class: 'pt-row' }, h('button', { class: 'chip pchatbtn' + (chatOpen ? ' on' : ''), 'aria-expanded': String(chatOpen), disabled: !m, title: m ? 'Quick chat with your party' : 'Quick chat (once a friend joins)', onclick: () => { chatOpen = !chatOpen; render(); } }, 'Chat'), main));
    // a line someone said fades after a few seconds
    clearTimeout(tm);
    const next = P.members.filter((x) => x.said && now - x.said.t < SAY_MS).map((x) => SAY_MS - (now - x.said.t));
    if (next.length) tm = setTimeout(render, Math.min(...next) + 50);
  };
  const off = onParty(render);
  // tapping anywhere else closes the chat lines
  const outside = (e) => { if (!el.isConnected) { window.removeEventListener('pointerdown', outside, true); return; } if (chatOpen && !e.target.closest('.pchat, .pchatbtn')) { chatOpen = false; render(); } };
  window.addEventListener('pointerdown', outside, true);
  render();
  return el;
}

// Invite: online friends (one tap each), a shareable link, and the party code for Join.
export async function openInvite(app) {
  if (!party()) { const p = await createParty(app); if (!p) return; }
  const P = party(); if (!P || !P.leader) return;
  const list = h('div', { class: 'col pfriends' });
  const close = () => { off(); m.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const sent = new Set();
  const draw = () => {
    const d = socialData(), signed = getAccount() && online.ok;
    if (!signed) { mount(list, h('small', { class: 'muted' }, 'Friends need online play. Share the code instead.')); return; }
    const on = d ? d.friends.filter((f) => f.presence === 'online') : [];
    mount(list, !d ? h('small', { class: 'muted' }, 'Loading friends…') : on.length ? on.map((f) => h('div', { class: 'frow p-online' }, h('i', { class: 'pdot' }), h('span', { class: 'fname' }, f.name),
      h('button', { class: 'btn', disabled: sent.has(f.id), onclick: async (e) => { e.target.disabled = true; try { await inviteToParty(app, f); sent.add(f.id); e.target.textContent = 'Sent'; toast(`Party invite sent to ${f.name}`); } catch (err) { toast(err.message || 'Could not send the invite'); e.target.disabled = false; } } }, sent.has(f.id) ? 'Sent' : 'Invite')))
      : h('small', { class: 'muted' }, 'No friends online right now. Send the link instead.'));
  };
  const copy = async () => {
    let link;
    try { link = (await inviteToParty(app, null)).url; } catch { link = null; }
    if (!link) { toast(`Party code: ${P.code} (friends type it in Join)`, 5000); return; }
    const text = `Team up with me in MOBA-VS: ${link}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'MOBA-VS party', text, url: link });
      else { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
    } catch { toast(link, 6000); }
  };
  const m = h('div', { class: 'modal smodal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel pinvite' }, h('div', { class: 'mhead' }, h('b', {}, 'Invite to your party'), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, 'X')),
      h('div', { class: 'row pcode' }, h('div', { class: 'col' }, h('small', { class: 'muted' }, 'Party code (friends type it in Join)'), h('b', { class: 'gold' }, P.code)),
        h('button', { class: 'chip', onclick: copy }, 'Copy invite link')),
      list));
  const off = onSocial(() => draw());
  document.addEventListener('keydown', esc);
  document.body.append(m);
  draw(); refreshSocial();
}
// The partner's screen while it joins the room the leader opened.
function wait(app, text) {
  mount(document.getElementById('screen'), h('div', { class: 'panel col center mmsearch', 'data-view': 'partywait' },
    h('div', { class: 'mm-spin' }), h('h2', { class: 'gold' }, 'Party'), h('b', {}, text),
    h('button', { class: 'btn big', onclick: () => app.menu() }, 'Cancel')));
}
setPartyUi({ wait });
