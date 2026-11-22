// Translations. English is the source language: every UI string is written in English in the code, and
// tools/i18n_extract.mjs collects them into src/i18n/en.json. A language pack (src/i18n/packs/<code>.json,
// fetched only when that language is chosen) maps English source text to its translation.
//
// Most text never calls this module: once a pack is active, `translateTree` rewrites text nodes and the
// title / aria-label / placeholder / alt attributes as the UI builds them (dom.js h() and setText call it
// eagerly; a MutationObserver catches innerHTML/textContent writes). Lookups go through a skeleton: every
// number and every {n} placeholder becomes "{}", so "Win 10 matches." in the pack also translates
// "Win 25 matches.", and "{0} gold" translates "350 gold". Keys with text placeholders ("View {0}'s profile")
// become patterns; their captured parts are translated too. Code that builds text from fragments (hero
// ability sentences) or draws on a canvas calls t() / tr() directly.
//
// English (the default when nothing matches the browser) installs nothing: no observer, no lookups.
// Elements with translate="no" (player names, chat, codes) are left alone. The sim never sees any of this.
export const LANGS = [
  ['en', 'English'], ['es', 'Español'], ['pt', 'Português (BR)'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['ja', '日本語'], ['ko', '한국어'], ['zh', '简体中文'], ['ru', 'Русский'],
];
const CODES = LANGS.map((l) => l[0]);
const KEY = 'mobavs_lang';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'];

export let lang = 'en';
let dict = null; // skeleton -> { out: [string pieces and arg indices], n }
let pats = []; // { re, need, out } for keys with text placeholders, most specific first
let lower = new Map(); // lower-cased skeleton -> entry (text the UI upper-cases in code)
const cache = new Map();
let observer = null;

// The language this device uses: the saved choice, else the browser's first supported language.
export function detectLang() {
  try { const s = localStorage.getItem(KEY); if (s && CODES.includes(s)) return s; } catch { /* ignore */ }
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
  for (const l of list) {
    const c = String(l).toLowerCase();
    if (c.startsWith('zh')) { if (/tw|hk|mo|hant/.test(c)) continue; return 'zh'; } // Simplified only
    const base = c.split('-')[0];
    if (CODES.includes(base)) return base;
  }
  return 'en';
}
export function savedLang() { try { return localStorage.getItem(KEY); } catch { return null; } }

// ── skeletons ──
const NUM = /\d+(?:[.,]\d+)*|\{\d+\}/g;
function skel(s) { const args = []; const k = s.replace(NUM, (m) => { args.push(m); return '{}'; }); return { k, args }; }
// Compile one pack entry: the translation becomes pieces and references to the key's arguments.
// A literal number in the key ("Win 10 matches.") becomes an argument, matched by value in the translation.
function compile(src, dst) {
  const { k, args } = skel(src);
  const out = []; let last = 0; const used = new Set();
  const re = /\{(\d+)\}|\d+(?:[.,]\d+)*/g; let m;
  while ((m = re.exec(dst))) {
    let ai = -1;
    if (m[1] !== undefined) ai = args.indexOf('{' + m[1] + '}');
    else { for (let i = 0; i < args.length; i++) if (!used.has(i) && args[i] === m[0]) { ai = i; break; } }
    if (ai < 0) continue;
    used.add(ai);
    if (m.index > last) out.push(dst.slice(last, m.index));
    out.push(ai); last = m.index + m[0].length;
  }
  if (last < dst.length) out.push(dst.slice(last));
  return { k, out, textArgs: args.map((a) => a[0] === '{') };
}
const fill = (out, vals) => out.map((p) => (typeof p === 'number' ? (vals[p] ?? '') : p)).join('');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function installPack(pack) {
  dict = new Map(); pats = []; lower = new Map(); cache.clear();
  for (const [src, dst] of Object.entries(pack)) {
    if (!dst || typeof dst !== 'string') continue;
    const c = compile(src, dst);
    if (!dict.has(c.k)) dict.set(c.k, c);
    if (!lower.has(c.k.toLowerCase())) lower.set(c.k.toLowerCase(), c);
    if (!NUM.test(dst)) cache.set(dst, dst);
    NUM.lastIndex = 0;
    // keys with a text placeholder ({0} that is not a number at runtime) also match as patterns
    if (c.textArgs.some(Boolean)) {
      const lits = c.k.split('{}');
      const need = lits.reduce((a, b) => (b.length > a.length ? b : a), '');
      if ((lits.join('').match(/\p{L}/gu) || []).length < 4) continue; // "{0} {1}", "{0} the {1}": too generic to be a pattern
      pats.push({ re: new RegExp('^' + lits.map(esc).join('(.+?)') + '$', 's'), need, c, score: lits.join('').length });
    }
  }
  pats.sort((a, b) => b.score - a.score);
}

// Translate one runtime string (any whitespace around it is kept). Returns it unchanged when unknown.
export function tr(s) {
  if (!dict || s == null) return s;
  s = String(s);
  if (s.length < 2 || s.length > 1200) return s;
  const hit = cache.get(s); if (hit !== undefined) return hit;
  const lead = s.match(/^\s*/)[0], trail = s.length > lead.length ? s.match(/\s*$/)[0] : '';
  const core = s.slice(lead.length, s.length - trail.length);
  let r = /[A-Za-z]/.test(core) ? look(core, 0) : null;
  if (r == null && misses && /[A-Za-z]{2}/.test(core)) misses.add(core);
  r = r == null ? s : lead + r + trail;
  if (cache.size > 6000) cache.clear();
  cache.set(s, r);
  if (r !== s) cache.set(r, r); // already translated text is never translated twice (fr "Options" is also an English key)
  return r;
}
// The text of `core` in the active language, or null.
function look(core, depth) {
  const { k, args } = skel(core);
  const e = dict.get(k);
  if (e) return fill(e.out, args);
  if (k.length > 2 && k === k.toUpperCase() && /[A-Z]{2}/.test(k)) { const u = lower.get(k.toLowerCase()); if (u) return fill(u.out, args).toLocaleUpperCase(lang); } // "ALL-OUT PUSH"
  if (depth > 2) return null;
  for (const p of pats) {
    if (p.need && !k.includes(p.need)) continue;
    const m = p.re.exec(k); if (!m) continue;
    // each capture holds its own share of the numbers, in order
    // a capture that reads like an untranslated English phrase means the pattern was the wrong fit
    let ai = 0, bad = false; const vals = [];
    for (let i = 1; i < m.length && !bad; i++) {
      const real = m[i].replace(/\{\}/g, () => args[ai++]);
      const x = /[A-Za-z]/.test(real) ? look(real, depth + 1) : real;
      if (x == null && /\b[a-z]{2,}\b.*\b[a-z]{2,}\b/.test(real)) bad = true;
      vals.push(x ?? real);
    }
    if (!bad) return fill(p.c.out, vals);
  }
  // decorated text: "★ Title", "Label:", "\"Quote\"", "Happy (64)", "Name ×2"
  let m = core.match(/^([^\p{L}\p{N}"“'«{]+)(.+)$/u);
  if (m) { const x = look(m[2], depth + 1); if (x != null) return m[1] + x; }
  m = core.match(/^(.+?)([:!?.…]+)$/u);
  if (m && m[1].length > 1) { const x = look(m[1], depth + 1); if (x != null) return x + (/^(ja|zh)$/.test(lang) && m[2] === ':' ? '：' : m[2]); }
  m = core.match(/^(["“'«])(.+)(["”'»])$/u);
  if (m) { const x = look(m[2], depth + 1); if (x != null) return m[1] + x + m[3]; }
  m = core.match(/^(.+?) ([^\p{L}]+)$/u); // "Control 1/10", "Chemistry 66%", "Burst ★"
  if (m && /\p{L}/u.test(m[1])) { const x = look(m[1], depth + 1); if (x != null) return x + ' ' + m[2]; }
  m = core.match(/^(.+?) (\([^()]*\)|[×x]\d+|\[[^\]]*\])$/u);
  if (m) { const x = look(m[1], depth + 1); if (x != null) return x + ' ' + m[2].replace(/^\((.*)\)$/, (_, i) => '(' + (/[A-Za-z]{2}/.test(i) ? look(i, depth + 1) ?? i : i) + ')'); }
  // compound text: "Top · Tank", "Gold: 350", two sentences: translate each part
  for (const sep of [' · ', ' — ', ' | ', '. ', ': ', ' / ', ', ', '/']) {
    if (!core.includes(sep)) continue;
    const parts = core.split(sep); let any = false, bad = false;
    const outp = parts.map((x, i) => {
      const piece = sep === '. ' && i < parts.length - 1 ? x + '.' : x;
      const tx = /[A-Za-z]/.test(piece) ? look(piece.trim(), depth + 1) : null;
      if (tx != null) { any = true; return sep === '. ' && i < parts.length - 1 ? tx.replace(/[.。]$/, '') : tx; }
      if (/\b[a-z]{2,}\b.*\b[a-z]{2,}\b/.test(x)) bad = true; // an English phrase left over: not this split
      return x;
    });
    if (any && !bad) return outp.join(sep === '. ' && /^(ja|zh)$/.test(lang) ? '。' : sep);
  }
  return null;
}

// t('Win {0} matches.', n): format an English template and translate it.
export function t(src, ...args) {
  if (!dict) return args.length ? src.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '') : src;
  const e = dict.get(skel(src).k);
  if (e) {
    // the key's own args are the template's {n} in order, then literal numbers
    const { args: keyArgs } = skel(src);
    const vals = keyArgs.map((a) => (a[0] === '{' ? args[+a.slice(1, -1)] : a));
    return fill(e.out, vals);
  }
  const s = args.length ? src.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '') : src;
  return tr(s);
}

// ── DOM ──
const skipEl = (el) => !el || el.closest('[translate="no"],script,style,textarea,canvas,svg');
function trText(node) {
  const v = node.data;
  if (!v || v.length < 2 || !/[A-Za-z]/.test(v)) return;
  if (node._tr === v) return;
  if (skipEl(node.parentElement)) return;
  const r = tr(v);
  node._tr = r;
  if (r !== v) node.data = r;
}
function trAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v || !/[A-Za-z]/.test(v)) continue;
    if (el['_tr_' + a] === v) continue;
    const r = tr(v); el['_tr_' + a] = r;
    if (r !== v) el.setAttribute(a, r);
  }
}
export function translateTree(root) {
  if (!dict || !root) return;
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (skipEl(root)) return; trAttrs(root); }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (n.getAttribute('translate') === 'no' || /^(SCRIPT|STYLE|TEXTAREA|CANVAS)$/.test(n.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) trText(n); else trAttrs(n); }
}
function startObserver() {
  if (observer) return;
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') { if (m.target.nodeType === 1 && !skipEl(m.target)) trAttrs(m.target); }
      else for (const n of m.addedNodes) translateTree(n);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

function applyLangAttr() {
  const root = document.documentElement;
  root.lang = lang === 'zh' ? 'zh-CN' : lang === 'pt' ? 'pt-BR' : lang;
  for (const c of CODES) root.classList.toggle('lang-' + c, c === lang);
  root.classList.toggle('lang-cjk', /^(ja|ko|zh)$/.test(lang));
  if (dict) document.title = tr('MOBA-VS — MOBA Manager');
}
async function fetchPack(code) {
  const r = await fetch(`src/i18n/packs/${code}.json`);
  if (!r.ok) throw new Error('pack ' + r.status);
  return r.json();
}
// Boot: load the device's language before the first screen is drawn. A failed load stays in English.
// Coverage audit (tools/screen_audit.py MISS=file): with localStorage.mobavs_i18n_miss = '1' the English catalog is
// installed as an identity pack and every UI string that is not in it is collected in window.__i18nMiss.
let misses = null;
export async function initI18n() {
  let dbg = null; try { dbg = localStorage.getItem('mobavs_i18n_miss'); } catch { /* ignore */ }
  if (dbg === '1') {
    try { const cat = await (await fetch('src/i18n/en.json')).json(); installPack(Object.fromEntries(cat.map((k) => [k, k]))); misses = window.__i18nMiss = new Set(); startObserver(); translateTree(document.body); } catch { /* no catalog */ }
    applyLangAttr(); return lang;
  }
  const want = detectLang();
  if (want !== 'en') {
    try { installPack(await fetchPack(want)); lang = want; startObserver(); translateTree(document.body); } catch { lang = 'en'; dict = null; }
  }
  applyLangAttr();
  return lang;
}
// Settings: switch language. The caller re-renders its screen; everything drawn after this is in the new language.
export async function setLang(code) {
  if (!CODES.includes(code)) return lang;
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  if (code === 'en') { dict = null; pats = []; cache.clear(); if (observer) { observer.disconnect(); observer = null; } lang = 'en'; applyLangAttr(); return lang; }
  const pack = await fetchPack(code);
  installPack(pack); lang = code; startObserver(); applyLangAttr(); translateTree(document.body);
  return lang;
}
export const i18nOn = () => !!dict;
