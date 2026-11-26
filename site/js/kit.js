import { icon } from './icons.js';

export const DEG = Math.PI / 180;
export const BANDS = ['u', 'g', 'r', 'i', 'z', 'y'];
export const ns = (window.Observatory = window.Observatory || {});
export const perf = (ns.perf = { draw: [], frame: [] });
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = (s) => document.querySelector(s);
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const mjdDate = (m) => new Date((m - 40587) * 864e5);
export const fmtDate = (m) => { const d = mjdDate(m); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtShort = (m) => { const d = mjdDate(m); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const dateMjd = (y, mo, d) => Date.UTC(y, mo, d) / 864e5 + 40587;
export const nightMjd = (n) => dateMjd(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
export const fmtN = (n) => n.toLocaleString('en-US');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
export function pushPerf(list, v) {
  list.push(v);
  if (list.length > 600) list.shift();
}

const CLASS_TOKENS = { NEO: '--c-neo', MC: '--c-mc', HUN: '--c-hun', MBA: '--c-mba', CYB: '--c-cyb', HIL: '--c-hil', TRO: '--c-tro', OTH: '--c-oth' };
export const C = { cls: {}, band: {} };
function tokensFrom(cs) {
  const g = (n) => cs.getPropertyValue(n).trim();
  const t = {
    bg: g('--paper'), paper: g('--paper'), line: g('--line'), grid: g('--grid'), ink: g('--ink'), ink2: g('--ink2'), ink3: g('--ink3'),
    graphite: g('--graphite'), gold: g('--gold'), goldSoft: g('--gold-soft'), accent: g('--accent'), accentSoft: g('--accent-soft'), hi: g('--hi'), sun: g('--sun'), sunrays: g('--sunrays'),
    earth: g('--earth'), planet: g('--planet'),
    orbit: g('--orbit'), porbit: g('--porbit'), bar: g('--bar'), bar2: g('--bar2'), det: g('--det'),
    cls: {}, band: {},
  };
  for (const k in CLASS_TOKENS) t.cls[k] = g(CLASS_TOKENS[k]);
  for (const b of BANDS) t.band[b] = g('--b-' + b);
  return t;
}
export function readTokens() {
  Object.assign(C, tokensFrom(getComputedStyle(document.documentElement)));
  C.dark = document.documentElement.dataset.theme !== 'light';
  hatchCache.clear();
}
export function withTokensOf(el, fn) {
  return (...args) => {
    const saved = { ...C, cls: { ...C.cls }, band: { ...C.band } };
    Object.assign(C, tokensFrom(getComputedStyle(el)));
    try { return fn(...args); } finally { Object.assign(C, saved); }
  };
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (...xs) => xs.reduce((h, x) => Math.imul(h ^ Math.round(x * 97), 2654435761) >>> 0, 2166136261);

export function pencilLine(g, x1, y1, x2, y2, { color = C.graphite, width = 1, alpha = 1 } = {}) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'butt'; g.globalAlpha = alpha;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.globalAlpha = 1;
}
export function pencilCircle(g, cx, cy, rad, { color = C.graphite, width = 1, alpha = 1 } = {}) {
  g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha;
  g.beginPath(); g.arc(cx, cy, rad, 0, 6.2832); g.stroke();
  g.globalAlpha = 1;
}
const hatchCache = new Map();
export function hatch(g, color, gap = 4, angle = 45, weight = 1.1) {
  const key = [color, gap, angle, weight].join('|');
  let pat = hatchCache.get(key);
  if (!pat) {
    const s = 32, c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = weight; x.lineCap = 'round';
    const rr = rng(seedOf(gap, angle, weight));
    x.save(); x.translate(s / 2, s / 2); x.rotate(angle * DEG); x.translate(-s, -s);
    for (let y = 0; y < 2 * s; y += gap) { x.globalAlpha = 0.65 + rr() * 0.35; x.beginPath(); x.moveTo(0, y + rr() * 0.6); x.lineTo(2 * s, y + rr() * 0.6); x.stroke(); }
    x.restore();
    pat = g.createPattern(c, 'repeat');
    hatchCache.set(key, pat);
  }
  return pat;
}
export function sketchBar(g, x, y, w, h, color, { fill = true } = {}) {
  if (h <= 0.5 || w <= 0) return;
  if (fill) { g.globalAlpha = 0.5; g.fillStyle = color; g.fillRect(x, y, w, h); g.globalAlpha = 1; }
  g.strokeStyle = color; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(x, y + 0.6); g.lineTo(x + w, y + 0.6); g.stroke();
}

export function paperTile() {
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d'), r = rng(1609);
  g.fillStyle = C.paper; g.fillRect(0, 0, s, s);
  const dark = C.dark;
  for (let i = 0; i < 14; i++) {
    const x = r() * s, y = r() * s, rad = s * (0.12 + r() * 0.3);
    const tone = r() < 0.55 ? (dark ? '4, 6, 12' : '70, 78, 110') : (dark ? '64, 78, 118' : '250, 249, 244');
    for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, `rgba(${tone}, ${dark ? 0.16 : 0.08})`); gr.addColorStop(1, `rgba(${tone}, 0)`);
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, 2 * rad, 2 * rad);
    }
  }
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * (dark ? 10 : 12);
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 95; i++) {
    const x = r() * s, y = r() * s, len = 3 + r() * r() * 22, ang = r() * Math.PI, bend = (r() - 0.5) * len * 0.6;
    const light = r() < 0.4;
    g.strokeStyle = light ? (dark ? `rgba(200,210,230,${0.05 + r() * 0.08})` : `rgba(255,253,246,${0.25 + r() * 0.35})`) : `rgba(${dark ? '5,8,15' : '125,108,80'},${0.05 + r() * 0.08})`;
    g.lineWidth = 0.3 + r() * 0.5;
    g.beginPath(); g.moveTo(x - Math.cos(ang) * len / 2, y - Math.sin(ang) * len / 2);
    g.quadraticCurveTo(x - Math.sin(ang) * bend, y + Math.cos(ang) * bend, x + Math.cos(ang) * len / 2, y + Math.sin(ang) * len / 2); g.stroke();
  }
  if (dark) for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(236,230,214,${0.15 + r() * 0.35})`; g.beginPath(); g.arc(r() * s, r() * s, 0.4 + r() * 0.6, 0, 6.283); g.fill(); }
  const url = `url(${c.toDataURL('image/png')})`;
  document.body.style.backgroundImage = url;
  document.documentElement.style.setProperty('--paper-img', url);
}

const canvases = new Set();
export function setupCanvas(cv, draw) {
  const ctx = cv.getContext('2d');
  const s = { cv, ctx, w: 0, h: 0, dpr: 1, draw };
  const resize = () => {
    const r = cv.getBoundingClientRect();
    s.dpr = Math.min(window.devicePixelRatio || 1, cv.dataset.lowdpr != null && r.width < 700 ? 1.5 : 2);
    s.w = r.width; s.h = r.height;
    cv.width = Math.round(r.width * s.dpr); cv.height = Math.round(r.height * s.dpr);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    s.dirty = true;
    draw(s);
  };
  new ResizeObserver(resize).observe(cv);
  s.resize = resize;
  canvases.add(s);
  return s;
}

export const TYPE = { micro: 11, small: 12.5, body: 14, lead: 16, title: 20, display: 28, hero: 56 };
const STEPS = [TYPE.micro, TYPE.small, TYPE.body, TYPE.lead, TYPE.title];
export const typeSize = (px) => (typeof px === 'string' ? TYPE[px] || TYPE.body : px >= 24 ? px : STEPS.reduce((b, x) => (Math.abs(x - px) < Math.abs(b - px) ? x : b), STEPS[0]));
export const typeWeight = (w) => (w < 250 ? 200 : w < 350 ? 300 : w < 450 ? 400 : w < 550 ? 500 : 600);
export const font = (px, w = 400) => `${typeWeight(w)} ${typeSize(px)}px 'IBM Plex Sans', system-ui, sans-serif`;
export const MINUS = '−';
export const signed = (v, d = 1) => `${v < 0 ? MINUS : v > 0 ? '+' : ''}${Math.abs(v).toFixed(d)}`;
export function fmtK(v) {
  const a = Math.abs(v), sg = v < 0 ? MINUS : '';
  if (a >= 1e6) return `${sg}${+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sg}${+(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sg}${+a.toFixed(a >= 10 || a === 0 ? 0 : 1)}`;
}
export function niceTicks(lo, hi, n = 4) {
  const raw = (hi - lo) / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
export function annotate(ctx, str, x, y, { size = 19, color = C.ink, align = 'center', halo = true } = {}) {
  ctx.font = font(size * 0.7, 600); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (halo) { ctx.lineWidth = 4; ctx.strokeStyle = C.bg; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
export function text(ctx, str, x, y, { size = 12, weight = 400, color = C.ink2, align = 'left', base = 'alphabetic', halo = false } = {}) {
  ctx.font = font(size, weight); ctx.textAlign = align; ctx.textBaseline = base;
  if (halo) { ctx.lineWidth = 3.5; ctx.strokeStyle = C.bg; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

const tip = $('#tip');
export function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let tx = x + 14, ty = y + 14;
  if (tx + r.width > innerWidth - 8) tx = x - r.width - 14;
  if (ty + r.height > innerHeight - 8) ty = y - r.height - 14;
  tip.style.left = Math.max(8, tx) + 'px'; tip.style.top = Math.max(8, ty) + 'px';
}
export function hideTip() { tip.hidden = true; }

const IC = { chev: icon('chev', 'chev'), fs: icon('full'), close: icon('close') };
let fsPanel = null;
export const fullscreenPanel = () => fsPanel;
const panelKey = (el) => 'observatory-collapsed-' + (el.querySelector('h2') || {}).id;
function loadCollapsed(el) { try { return localStorage.getItem(panelKey(el)) === '1'; } catch (e) { return false; } }
function saveCollapsed(el, v) { try { if (v) localStorage.setItem(panelKey(el), '1'); else localStorage.removeItem(panelKey(el)); } catch (e) { return; } }
function refreshPanel(el) {
  requestAnimationFrame(() => { for (const p of canvases) { if (!p.cv.isConnected) canvases.delete(p); else if (el.contains(p.cv)) p.resize(); } });
}
export function setCollapsed(el, v) {
  el.classList.toggle('collapsed', v);
  const b = el.querySelector('.pctl .col');
  const name = el.querySelector('h2').textContent;
  b.setAttribute('aria-expanded', String(!v));
  b.setAttribute('aria-label', (v ? 'Expand ' : 'Collapse ') + name); b.title = v ? 'Expand' : 'Collapse';
  if (!v) refreshPanel(el);
}
export function enterFs(el) {
  if (fsPanel) exitFs();
  if (el.classList.contains('collapsed')) setCollapsed(el, false);
  fsPanel = el; el.classList.add('fs'); document.body.classList.add('fs-open');
  const b = el.querySelector('.pctl .fsb');
  b.innerHTML = IC.close; b.setAttribute('aria-label', 'Exit full screen'); b.title = 'Exit full screen (Esc)';
  el.querySelector('.pctl .col').hidden = true;
  refreshPanel(el); b.focus();
}
export function exitFs() {
  const el = fsPanel;
  if (!el) return;
  fsPanel = null; el.classList.remove('fs'); document.body.classList.remove('fs-open');
  const b = el.querySelector('.pctl .fsb');
  b.innerHTML = IC.fs; b.setAttribute('aria-label', 'Full screen'); b.title = 'Full screen';
  el.querySelector('.pctl .col').hidden = false;
  refreshPanel(el); b.focus();
}
export function panelControls(root = document) {
  root.querySelectorAll('.panel').forEach((el) => {
    if (el.querySelector('.pctl')) return;
    const bar = el.querySelector('.pbar');
    const ctl = document.createElement('div');
    ctl.className = 'pctl';
    ctl.innerHTML = `<button type="button" class="btn icon quiet sm col">${IC.chev}</button><button type="button" class="btn icon quiet sm fsb" aria-label="Full screen" title="Full screen">${IC.fs}</button>`;
    bar.appendChild(ctl);
    ctl.querySelector('.col').addEventListener('click', () => { const v = !el.classList.contains('collapsed'); setCollapsed(el, v); saveCollapsed(el, v); });
    ctl.querySelector('.fsb').addEventListener('click', () => (fsPanel === el ? exitFs() : enterFs(el)));
    setCollapsed(el, loadCollapsed(el));
  });
}

export function setUrl(updates) {
  const u = new URL(location.href);
  for (const k in updates) { if (updates[k] == null || updates[k] === '') u.searchParams.delete(k); else u.searchParams.set(k, updates[k]); }
  history.replaceState(null, '', u);
}

const themeHooks = [];
export const onTheme = (fn) => themeHooks.push(fn);
const SUN_IC = icon('sun');
const MOON_IC = icon('moon');
export function setThemeLabel() {
  const b = $('#theme'), lbl = C.dark ? 'Switch to day paper' : 'Switch to night paper';
  b.innerHTML = C.dark ? SUN_IC : MOON_IC;
  b.setAttribute('aria-label', lbl); b.title = lbl;
}
export function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem('observatory-theme', t); else localStorage.removeItem('observatory-theme'); } catch (e) { return; }
  readTokens(); paperTile(); setThemeLabel();
  themeHooks.forEach((f) => f());
}
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('observatory-theme'); } catch (e) { saved = null; }
  if (saved) document.documentElement.dataset.theme = saved;
  readTokens(); paperTile(); setThemeLabel();
  $('#theme').addEventListener('click', () => applyTheme(C.dark ? 'light' : 'dark'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fsPanel) exitFs(); });
}

export const shell = { setMode: null, setSearch: null, mode: () => document.body.dataset.mode, search: () => ({ items: () => [], empty: '' }), scene: {} };

const keyMap = new Map();
const typingIn = (t) => t instanceof Element && !!t.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]');
export function onKey(key, fn, { mod = false, typing = false } = {}) {
  const id = (mod ? 'mod+' : '') + key.toLowerCase();
  keyMap.set(id, { fn, typing });
  return () => { if (keyMap.get(id)?.fn === fn) keyMap.delete(id); };
}
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  const hit = keyMap.get((mod ? 'mod+' : '') + e.key.toLowerCase());
  if (!hit || (typingIn(e.target) && !hit.typing && !mod)) return;
  if (hit.fn(e) !== false) e.preventDefault();
});
export const slot = (name) => document.querySelector(`[data-slot="${name}"]`);
const modeHooks = [];
export const onModeReady = (fn) => { modeHooks.push(fn); };
export const modeReady = (m) => modeHooks.forEach((f) => f(m));
export function onBrand(fn, label) {
  const h = document.querySelector('.brand h1');
  if (!h) return;
  h.setAttribute('role', 'button'); h.tabIndex = 0; h.classList.add('brand-act');
  if (label) h.title = label;
  h.addEventListener('click', fn);
  h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
}
Object.assign(shell, { onKey, slot, onModeReady, onBrand });


export { cosmo } from './cosmo.js';
let ladderAt = 0, ladderTimer = 0;
export function pingLadder() {
  if (ladderTimer) return;
  ladderTimer = setTimeout(() => { ladderTimer = 0; ladderAt = performance.now(); window.dispatchEvent(new CustomEvent('ladder')); }, Math.max(0, 250 - (performance.now() - ladderAt)));
}
