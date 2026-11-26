import { reduceMotion } from './kit.js';
import { FLOORS, MODES } from './ladder.js';
import { KM_PER_LY, KM_PER_AU } from './cosmo.js';

const FADE_MS = 150;
const font = (px, w) => `${w} ${px}px 'IBM Plex Sans', system-ui, sans-serif`;
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const smooth = (p) => p * p * (3 - 2 * p);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
let current = null;

const nf = (v, d) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export function distanceParts(u) {
  const km = 10 ** u, ly = km / KM_PER_LY, au = km / KM_PER_AU;
  if (km < 1e6) return [nf(km, 0), 'km'];
  if (km < 1e7) return [nf(km / 1e6, 1), 'million km'];
  if (ly < 0.05) return [au < 10 ? nf(au, 2) : nf(au, 0), 'AU'];
  if (ly < 1e6) return [ly < 10 ? nf(ly, 1) : nf(ly, 0), 'light-years'];
  if (ly < 1e9) return [nf(ly / 1e6, 0), 'million years of light'];
  return [nf(ly / 1e9, 1), 'billion years of light'];
}
export const distanceWords = (u) => distanceParts(u).join(' ');

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

function snapshot(stage) {
  const { el, r } = stage, k = Math.min(1.5, devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(r.width * k)); cv.height = Math.max(1, Math.round(r.height * k));
  const g = cv.getContext('2d');
  g.scale(k, k);
  let drew = false;
  for (const c of el.querySelectorAll('canvas')) {
    const cr = c.getBoundingClientRect();
    if (!c.width || !c.height || cr.width < 2) continue;
    c.dispatchEvent(new Event('snapshot'));
    try { g.drawImage(c, cr.left - r.left, cr.top - r.top, cr.width, cr.height); drew = true; } catch {}
  }
  return drew ? cv : null;
}

function tokens() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  return { paper: v('--paper') || v('--bg'), gold: v('--hr-gold') || v('--gold'), ink: v('--ink'), ink2: v('--ink2'), ink3: v('--ink3') };
}

function stop(run) {
  cancelAnimationFrame(run.raf);
  run.cv.remove();
  if (run.grow) run.grow.cancel();
  if (current === run) current = null;
}

function overlay(r) {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.className = 'floor-climb';
  cv.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;z-index:60;pointer-events:none`;
  document.body.appendChild(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, -r.left * dpr, -r.top * dpr);
  return { cv, g, W: r.right, H: r.bottom };
}

function drawFade(run, p) {
  const { g, W, H, snap, from } = run;
  g.clearRect(0, 0, W, H);
  g.globalAlpha = 1 - smooth(p);
  g.drawImage(snap, from.r.left, from.r.top, from.r.width, from.r.height);
  g.globalAlpha = 1;
}

function dust(n) {
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: n }, () => ({ x: r(), y: r(), z: 0.3 + r() * 0.7, gold: r() < 0.2 }));
}
const DUST = dust(90);

function drawDust(run, veil, speed, travel) {
  const { g, c, up, L, T, cw, ch } = run;
  const dir = up ? 1 : -1;
  g.lineCap = 'round';
  for (const gold of [false, true]) {
    g.strokeStyle = gold ? c.gold : c.ink;
    for (const d of DUST) {
      if (d.gold !== gold) continue;
      const y = T + ((((d.y * ch + dir * travel * d.z * 0.5) % ch) + ch) % ch), x = L + d.x * cw, len = 0.01 + speed * d.z * 5;
      g.globalAlpha = veil * (gold ? 0.6 : 0.4) * d.z;
      g.lineWidth = 0.6 + 1.1 * d.z;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - dir * len); g.stroke();
    }
  }
}

function drawOld(run, p) {
  const { g, c, snap, from, up } = run;
  if (!from || p > 0.5) return;
  const q = ease(clamp01(p / 0.5)), r = from.r;
  const sc = up ? 1 - 0.06 * q : 1 + 0.06 * q, dy = (up ? 1 : -1) * r.height * 0.07 * q;
  const w = r.width * sc, h = r.height * sc, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - h) / 2 + dy;
  g.globalAlpha = 1 - q;
  g.fillStyle = c.paper; g.fillRect(x0, y0, w, h);
  if (snap) g.drawImage(snap, x0, y0, w, h);
}

function spaced(g, em) {
  if ('letterSpacing' in g) g.letterSpacing = em ? `${em}em` : '0px';
}

function drawFloors(run, u, veil, px, cx, cy, big) {
  const { g, c, T, H, phone } = run;
  const seen = [];
  for (const f of FLOORS) {
    const mid = (f.a + f.b) / 2, y = cy - (mid - u) * px;
    if (y < T - 30 || y > H + 30) continue;
    const a = veil * Math.exp(-(((mid - u) / 3.4) ** 2)) * smooth(clamp01((Math.abs(y - cy) - big * 0.7) / (big * 0.8)));
    if (a >= 0.02) seen.push([f, y, a]);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  spaced(g, 0.14);
  g.font = font(phone ? 12 : 13, 500); g.fillStyle = c.ink2;
  for (const [f, y, a] of seen) { g.globalAlpha = a; g.fillText(f.name.toUpperCase(), cx, y - 8); }
  spaced(g, 0);
  g.font = font(phone ? 11 : 12, 400); g.fillStyle = c.ink3;
  for (const [f, y, a] of seen) { g.globalAlpha = a * 0.75; g.fillText(f.sub, cx, y + 9); }
}

function drawClimb(run, p) {
  const { g, W, H, c, up, uFrom, uTo, L, T, cw, ch, phone } = run;
  g.clearRect(0, 0, W, H);
  const veil = p < 0.16 ? smooth(p / 0.16) : p > 0.62 ? 1 - smooth((p - 0.62) / 0.38) : 1;
  const speed = Math.sin(Math.PI * Math.min(1, p * 1.08));
  g.globalAlpha = 0.93 * veil; g.fillStyle = c.paper; g.fillRect(L, T, cw, ch);
  drawOld(run, p);
  const u = uFrom + (uTo - uFrom) * ease(p);
  const px = phone ? Math.max(44, Math.min(64, ch / 11)) : Math.max(52, Math.min(80, ch / 10));
  drawDust(run, veil, speed, (u - uFrom) * px);
  const cx = L + cw / 2, cy = T + ch * (phone ? 0.4 : 0.45), big = phone ? 50 : 84;
  drawFloors(run, u, veil, px, cx, cy, big);
  const [num, unit] = distanceParts(u);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = veil;
  g.font = font(big, 300);
  const bs = Math.min(big, (big * (cw - 32)) / Math.max(1, g.measureText(num).width));
  g.font = font(bs, 300); g.fillStyle = c.gold; g.fillText(num, cx, cy);
  spaced(g, 0.14);
  g.font = font(phone ? 12 : 13, 500); g.fillStyle = c.ink2;
  g.fillText(unit.toUpperCase(), cx, cy + bs * 0.62 + 6);
  spaced(g, 0);
  g.globalAlpha = veil * 0.9;
  g.font = font(phone ? 12.5 : 13.5, 400); g.fillStyle = c.ink3;
  g.fillText(`${up ? 'Up' : 'Down'} to ${MODES[run.to].name} · ${MODES[run.to].measure}`, cx, cy + bs * 0.62 + 30);
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
  if (!fromStage || (reduceMotion && !snap)) return;
  const r = fromStage.r;
  const run = { ...overlay(r), from: fromStage, to, snap, raf: 0, grow: null };
  current = run;
  if (reduceMotion) {
    run.dur = FADE_MS;
  } else {
    Object.assign(run, { dur: climbMs(from, to), c: tokens(), L: r.left, T: r.top, cw: r.width, ch: r.height, phone: r.width < 600, up: MODES[to].icon > MODES[from].icon, uFrom: MODES[from].icon, uTo: MODES[to].icon });
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
