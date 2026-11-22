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
    graphite: g('--graphite'), gold: g('--gold'), goldSoft: g('--gold-soft'), frame: g('--frame'), accent: g('--accent'), accentSoft: g('--accent-soft'), hi: g('--hi'), sun: g('--sun'), sunrays: g('--sunrays'),
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

export function pencilLine(g, x1, y1, x2, y2, { color = C.graphite, width = 1, amp = 0.9, passes = 2, alpha = 1 } = {}) {
  const r = rng(seedOf(x1, y1, x2, y2));
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const a = Math.min(amp, len / 60 + 0.25);
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  for (let p = 0; p < passes; p++) {
    g.globalAlpha = alpha * (p === 0 ? 1 : 0.45);
    const j = () => (r() - 0.5) * 2 * a;
    const o1 = (r() - 0.3) * Math.min(4, len * 0.02), o2 = (r() - 0.3) * Math.min(4, len * 0.02);
    const sx = x1 - (x2 - x1) / len * o1 + nx * j(), sy = y1 - (y2 - y1) / len * o1 + ny * j();
    const ex = x2 + (x2 - x1) / len * o2 + nx * j(), ey = y2 + (y2 - y1) / len * o2 + ny * j();
    const b = (r() - 0.5) * a * 2.2;
    g.beginPath(); g.moveTo(sx, sy);
    g.quadraticCurveTo((sx + ex) / 2 + nx * b, (sy + ey) / 2 + ny * b, ex, ey);
    g.stroke();
  }
  g.globalAlpha = 1;
}
export function pencilCircle(g, cx, cy, rad, { color = C.graphite, width = 1, passes = 2, alpha = 1, wob = 0.03 } = {}) {
  const r = rng(seedOf(cx, cy, rad));
  g.strokeStyle = color; g.lineWidth = width;
  for (let p = 0; p < passes; p++) {
    g.globalAlpha = alpha * (p === 0 ? 1 : 0.5);
    const ph = r() * 6.283, k1 = (r() - 0.5) * wob, k2 = (r() - 0.5) * wob, over = 0.25 + r() * 0.3;
    const steps = Math.max(24, Math.min(180, Math.round(rad * 0.8)));
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = ph + (i / steps) * (6.283 + over);
      const rr = rad * (1 + k1 * Math.sin(2 * t) + k2 * Math.cos(3 * t));
      const x = cx + Math.cos(t) * rr, y = cy + Math.sin(t) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
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
  if (fill) { g.fillStyle = hatch(g, color, 3.2, 52, 1.2); g.fillRect(x, y, w, h); }
  g.strokeStyle = color; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + 0.3, y); g.lineTo(x + w - 0.2, y + 0.4); g.lineTo(x + w, y + h); g.stroke();
}

function roughRectPath(w, h, r, o) {
  const j = () => (r() - 0.5) * 2 * o;
  const side = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, over = Math.min(5, len * 0.012);
    const ex = (x2 - x1) / len * over + j() * 0.4, ey = (y2 - y1) / len * over + j() * 0.4;
    const mx = (x1 + x2) / 2 + j(), my = (y1 + y2) / 2 + j();
    return `M${(x1 - ex + j()).toFixed(1)} ${(y1 - ey + j()).toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${(x2 + ex + j()).toFixed(1)} ${(y2 + ey + j()).toFixed(1)}`;
  };
  return [side(0, 0, w, 0), side(w, 0, w, h), side(w, h, 0, h), side(0, h, 0, 0)].join(' ');
}
function frameSvg(w, h, seed, kind) {
  const r = rng(seed);
  const inset = 2.5, W = w - 2 * inset, H = h - 2 * inset;
  const amp = kind === 'panel' ? 1.6 : 1.1;
  const p1 = roughRectPath(W, H, r, amp), p2 = roughRectPath(W, H, r, amp);
  const backing = kind === 'panel' ? '' : `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" fill="var(--paper-deep)" opacity="0.7"/>`;
  let lit = '';
  if (kind !== 'panel') {
    const lines = [];
    for (let x = -H; x < W; x += 5) lines.push(`M${Math.max(0, x).toFixed(1)} ${(x < 0 ? -x : 0).toFixed(1)} L${Math.min(W, x + H).toFixed(1)} ${(x + H > W ? H - (x + H - W) : H).toFixed(1)}`);
    lit = `<g class="lit"><clipPath id="c${seed}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}"/></clipPath><path clip-path="url(#c${seed})" d="${lines.join(' ')}" stroke="var(--gold)" stroke-width="1.1" opacity="0.4" fill="none"/></g>`;
  }
  const sw = kind === 'panel' ? 1.2 : kind === 'accent' ? 1.5 : 1.1;
  const stroke = kind === 'accent' ? 'var(--gold)' : 'var(--frame)';
  return `${backing}<g transform="translate(${inset} ${inset})">${lit}<path class="stroke" d="${p1}" stroke="${stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round"/><path class="stroke" d="${p2}" stroke="${stroke}" stroke-width="${sw * 0.7}" fill="none" opacity="0.45" stroke-linecap="round"/></g>`;
}
let frameSeed = 11;
const frameRO = new ResizeObserver((entries) => {
  for (const en of entries) {
    const el = en.target, svg = el.__frame;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!svg || (w === el.__fw && h === el.__fh) || !w || !h) continue;
    el.__fw = w; el.__fh = h;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = frameSvg(w, h, el.__seed, el.__kind);
  }
});
export function sketchify(root = document) {
  root.querySelectorAll('.panel').forEach((el) => {
    if (el.__frame) return;
    el.classList.add('sk');
    for (const n of [...el.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) { const sp = document.createElement('span'); n.replaceWith(sp); sp.appendChild(n); }
    el.__seed = frameSeed++ * 7919;
    el.__kind = el.classList.contains('panel') ? 'panel' : el.classList.contains('play') ? 'accent' : 'btn';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'frame'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
    el.prepend(svg); el.__frame = svg;
    frameRO.observe(el);
  });
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

export const font = (px, w = 400) => `${w} ${px}px 'IBM Plex Sans', system-ui, sans-serif`;
export function annotate(ctx, str, x, y, { size = 19, color = C.ink, align = 'center', halo = true } = {}) {
  ctx.font = font(Math.round(size * 0.7), 600); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
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

const IC = {
  chev: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  fs: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  close: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
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
    ctl.innerHTML = `<button type="button" class="icon-btn sm col">${IC.chev}</button><button type="button" class="icon-btn sm fsb" aria-label="Full screen" title="Full screen">${IC.fs}</button>`;
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
const SUN_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.1 7.9c2.3.1 4.1 2 4 4.3-.1 2.3-2 4-4.3 3.9-2.2-.1-4-2-3.9-4.3.1-2.2 2-4 4.2-3.9z"/><path d="M12 2.6v2.3M12.1 19.2v2.2M2.7 12.1h2.2M19.1 11.9h2.3M5.3 5.4l1.6 1.5M17.1 17.2l1.6 1.6M5.4 18.7l1.5-1.6M17.2 6.9l1.5-1.6"/></svg>';
const MOON_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 14.6c-1 .4-2 .6-3.1.6-4.4 0-7.9-3.5-7.9-7.9 0-1.1.2-2.1.6-3.1-3.1 1.1-5.3 4.1-5.2 7.6.1 4.5 3.8 8 8.2 7.9 3.4 0 6.3-2.1 7.4-5.1z"/><path d="M17.3 4.2v2.4M16.1 5.4h2.4"/></svg>';
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

export const shell = { setMode: null, setSearch: null };

