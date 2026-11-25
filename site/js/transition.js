import { reduceMotion } from './kit.js';
import { FLOORS, MODES } from './ladder.js';
import { KM_PER_LY, KM_PER_AU } from './cosmo.js';

const FADE_MS = 150;
const font = (px, w) => `${w} ${px}px 'IBM Plex Sans', system-ui, sans-serif`;
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const smooth = (p) => p * p * (3 - 2 * p);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
let current = null;

export function distanceWords(u) {
  const km = 10 ** u, ly = km / KM_PER_LY, au = km / KM_PER_AU;
  const n = (v, d) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  if (km < 1e6) return `${n(km, 0)} km`;
  if (km < 1e7) return `${n(km / 1e6, 1)} million km`;
  if (ly < 0.05) return au < 10 ? `${n(au, 2)} AU` : `${n(au, 0)} AU`;
  if (ly < 1e6) return ly < 10 ? `${n(ly, 1)} light-years` : `${n(ly, 0)} light-years`;
  if (ly < 1e9) return `${n(ly / 1e6, 0)} million years of light`;
  return `${n(ly / 1e9, 1)} billion years of light`;
}

export const climbMs = (from, to) => Math.min(1400, 600 + 35 * Math.abs(MODES[to].icon - MODES[from].icon));

function stageOf(m) {
  const el = document.querySelector(`.scene[data-floor="${m}"] .map-wrap`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 8 && r.height > 8 ? { el, r } : null;
}

function rungOf(m) {
  const b = document.querySelector(`.lad-group button[data-mode="${m}"]`);
  const r = b && b.getBoundingClientRect();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

function railEdge() {
  const r = document.querySelector('.ladder')?.getBoundingClientRect();
  if (!r || !r.width) return { left: 0, top: 0 };
  return r.height > r.width * 2 ? { left: r.right, top: 0 } : { left: 0, top: r.bottom };
}

function snapshot(stage) {
  const { el, r } = stage, k = Math.min(1.5, devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(r.width * k)); cv.height = Math.max(1, Math.round(r.height * k));
  const g = cv.getContext('2d');
  g.scale(k, k);
  let drew = false;
  for (const c of el.querySelectorAll('canvas')) {
    const cr = c.getBoundingClientRect();
    if (!c.width || !cr.width || cr.width < 2 || !c.getContext('2d')) continue;
    try { g.drawImage(c, cr.left - r.left, cr.top - r.top, cr.width, cr.height); drew = true; } catch {}
  }
  return drew ? cv : null;
}

function tokens() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  return { paper: v('--paper') || v('--bg'), gold: v('--gold'), ink: v('--ink'), ink2: v('--ink2'), ink3: v('--ink3') };
}

function stop(run) {
  cancelAnimationFrame(run.raf);
  run.cv.remove();
  if (run.grow) run.grow.cancel();
  if (current === run) current = null;
}

function overlay() {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.className = 'floor-climb';
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:60;pointer-events:none';
  document.body.appendChild(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cv, g, W: innerWidth, H: innerHeight };
}

function drawFade(run, p) {
  const { g, W, H, snap, from } = run;
  g.clearRect(0, 0, W, H);
  g.globalAlpha = 1 - smooth(p);
  g.drawImage(snap, from.r.left, from.r.top, from.r.width, from.r.height);
  g.globalAlpha = 1;
}

function drawClimb(run, p) {
  const { g, W, H, c, edge, up, uFrom, uTo, snap, from, rungFrom } = run;
  g.clearRect(0, 0, W, H);
  const veil = p < 0.16 ? smooth(p / 0.16) : p > 0.62 ? 1 - smooth((p - 0.62) / 0.38) : 1;
  const L = edge.left, T = edge.top, cw = W - L, ch = H - T;
  g.globalAlpha = 0.94 * veil; g.fillStyle = c.paper; g.fillRect(L, T, cw, ch);
  const speed = Math.sin(Math.PI * Math.min(1, p * 1.12)), cx = L + cw * 0.5, cy = T + ch * 0.5;
  let s = 7;
  g.lineCap = 'round';
  const reach = Math.hypot(cw, ch) * 0.55;
  for (let i = 0; i < 200; i++) {
    s = (s * 16807) % 2147483647; const a = (s / 2147483647) * Math.PI * 2;
    s = (s * 16807) % 2147483647; const d0 = 30 + (s / 2147483647) * reach;
    s = (s * 16807) % 2147483647; const gold = s / 2147483647 < 0.2;
    const drift = up ? p * reach * 0.35 : -p * reach * 0.35;
    const d = ((d0 + drift) % reach + reach) % reach + 30, len = (10 + d * 0.32) * speed;
    const k0 = up ? d : d + len, k1 = up ? d + len : d;
    g.globalAlpha = veil * (gold ? 0.55 : 0.26) * speed;
    g.strokeStyle = gold ? c.gold : c.ink; g.lineWidth = gold ? 1.3 : 0.8;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * k0, cy + Math.sin(a) * k0 * 0.7); g.lineTo(cx + Math.cos(a) * k1, cy + Math.sin(a) * k1 * 0.7); g.stroke();
  }
  if (rungFrom && from && p < 0.55) {
    const q = ease(clamp01(p / 0.5)), r = from.r;
    const sc = 1 + (Math.min(30 / r.width, 30 / r.height) - 1) * q;
    const x = r.left + r.width / 2 + (rungFrom.x - r.left - r.width / 2) * q, y = r.top + r.height / 2 + (rungFrom.y - r.top - r.height / 2) * q;
    const w = r.width * sc, h = r.height * sc, x0 = x - w / 2, y0 = y - h / 2;
    g.globalAlpha = 1 - smooth(clamp01((p - 0.3) / 0.25));
    g.fillStyle = c.paper; g.fillRect(x0, y0, w, h);
    if (snap) g.drawImage(snap, x0, y0, w, h);
    g.strokeStyle = c.gold; g.lineWidth = 1.2; g.globalAlpha *= 0.4 + 0.6 * q;
    g.beginPath(); g.roundRect ? g.roundRect(x0, y0, w, h, Math.min(14, w / 6)) : g.rect(x0, y0, w, h); g.stroke();
  }
  const u = uFrom + (uTo - uFrom) * ease(p);
  const px = Math.max(26, Math.min(70, ch / 9));
  const ax = L + Math.max(28, cw * 0.5 - Math.min(260, cw * 0.22));
  g.globalAlpha = veil;
  g.strokeStyle = c.ink3; g.lineWidth = 1;
  g.beginPath(); g.moveTo(ax, T); g.lineTo(ax, H); g.stroke();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = font(cw < 600 ? 11.5 : 13, 600);
  for (const f of FLOORS) {
    const ya = cy - (f.a - u) * px, yb = cy - (f.b - u) * px;
    if (Math.max(ya, yb) < T - 40 || Math.min(ya, yb) > H + 40) continue;
    const near = Math.abs((f.a + f.b) / 2 - u) < 0.9;
    g.globalAlpha = veil * (near ? 1 : 0.6);
    g.strokeStyle = near ? c.gold : c.ink3; g.lineWidth = near ? 3 : 2;
    g.beginPath(); g.moveTo(ax + 6, ya); g.lineTo(ax + 6, Math.min(ya - 2, yb)); g.stroke();
    g.fillStyle = near ? c.gold : c.ink3;
    g.fillText(f.name, ax + 18, (ya + yb) / 2);
  }
  g.globalAlpha = veil * 0.5; g.strokeStyle = c.ink3; g.beginPath();
  for (let d = Math.floor(u) - 10; d <= Math.ceil(u) + 10; d++) { const y = cy - (d - u) * px; g.moveTo(ax - 6, y); g.lineTo(ax, y); }
  g.stroke();
  g.globalAlpha = veil; g.fillStyle = c.gold;
  g.beginPath(); g.moveTo(ax - 4, cy); g.lineTo(ax - 16, cy - 7); g.lineTo(ax - 16, cy + 7); g.closePath(); g.fill();
  const tx = ax + (cw < 700 ? 22 : Math.min(200, cw * 0.16)), room = Math.max(80, L + cw - tx - 16);
  const big = distanceWords(u), sub = `${up ? 'Climbing' : 'Descending'} to ${MODES[run.to].name} · ${MODES[run.to].measure}`;
  g.font = font(34, 600);
  const bs = Math.min(34, (34 * room) / Math.max(1, g.measureText(big).width));
  g.font = font(bs, 600); g.fillStyle = c.gold; g.fillText(big, tx, cy - 6 - bs * 0.1);
  g.font = font(14, 400);
  const ss = Math.min(14, (14 * room) / Math.max(1, g.measureText(sub).width));
  g.font = font(ss, 400); g.fillStyle = c.ink2; g.fillText(sub, tx, cy + 14 + bs * 0.35);
  g.globalAlpha = 1;
}

function grow(run, elapsed) {
  const to = stageOf(run.to), rung = rungOf(run.to);
  if (!to || !rung || !to.el.animate) return null;
  const ox = Math.round(rung.x - to.r.left), oy = Math.round(rung.y - to.r.top);
  const far = Math.ceil(Math.hypot(Math.max(Math.abs(ox), Math.abs(to.r.width - ox)), Math.max(Math.abs(oy), Math.abs(to.r.height - oy))));
  return to.el.animate([
    { clipPath: `circle(12px at ${ox}px ${oy}px)`, opacity: 0 },
    { clipPath: `circle(${far}px at ${ox}px ${oy}px)`, opacity: 1 },
  ], { duration: Math.round(run.dur * 0.48), delay: Math.max(0, run.dur * 0.5 - elapsed), fill: 'backwards', easing: 'cubic-bezier(.3,.6,.25,1)' });
}

export function floorTransition(from, to) {
  if (current) stop(current);
  if (!from || !to || from === to || !MODES[from] || !MODES[to] || document.hidden) return;
  const fromStage = stageOf(from), snap = fromStage ? snapshot(fromStage) : null;
  if (reduceMotion && !snap) return;
  const run = { ...overlay(), from: fromStage, to, snap, raf: 0, grow: null };
  current = run;
  if (reduceMotion) {
    run.dur = FADE_MS;
  } else {
    Object.assign(run, { dur: climbMs(from, to), c: tokens(), edge: railEdge(), up: MODES[to].icon > MODES[from].icon, uFrom: MODES[from].icon, uTo: MODES[to].icon, rungFrom: rungOf(from) });
  }
  const t0 = performance.now();
  const step = (now) => {
    if (current !== run) return;
    const p = clamp01((now - t0) / run.dur);
    if (reduceMotion) drawFade(run, p);
    else {
      if (!run.grow && p < 0.5) run.grow = grow(run, now - t0);
      drawClimb(run, p);
    }
    if (p < 1) run.raf = requestAnimationFrame(step); else stop(run);
  };
  if (reduceMotion) drawFade(run, 0); else drawClimb(run, 0);
  run.raf = requestAnimationFrame(step);
}
