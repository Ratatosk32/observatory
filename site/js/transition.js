import { reduceMotion } from './kit.js';
import { ease as EASE, smoothstep, CSS_EASE, DUR, STAGGER, stagger, play } from './motion.js';
import { FLOORS, MODES } from './ladder.js';
import { KM_PER_LY, KM_PER_AU } from './cosmo.js';

const FADE_MS = 150;
const SHRINK_END = 0.45, GROW_AT = 0.5, GROW_LEN = 0.48, CARD_IN = DUR.gentle;
const font = (px, w) => `${w} ${px}px 'IBM Plex Sans', system-ui, sans-serif`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (p, a, b) => clamp01((p - a) / (b - a));
let current = null, lastRun = null;

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

export const climbMs = (from, to) => Math.min(1400, DUR.travel + 35 * Math.abs(MODES[to].icon - MODES[from].icon));

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

export function stageSnapshot(el) {
  const r = el && el.getBoundingClientRect();
  return r && r.width > 8 && r.height > 8 ? snapshot({ el, r }) : null;
}

function tokens() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  return { paper: v('--paper') || v('--bg'), gold: v('--hr-gold') || v('--gold'), ink: v('--ink'), ink2: v('--ink2'), ink3: v('--ink3') };
}

function stop(run) {
  cancelAnimationFrame(run.raf);
  run.cv.remove();
  if (run.grow) run.grow.cancel();
  if (current === run) { current = null; window.dispatchEvent(new CustomEvent('climbend', { detail: { to: run.to } })); }
}

function overlay(r, left) {
  const L = Math.min(r.left, left), W = r.right - L;
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.className = 'floor-climb';
  cv.style.cssText = `position:absolute;left:${L + scrollX}px;top:${r.top + scrollY}px;width:${W}px;height:${r.height}px;z-index:60;pointer-events:none`;
  document.body.appendChild(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, -L * dpr, -r.top * dpr);
  return { cv, g, X0: L, W: r.right, H: r.bottom };
}

function drawFade(run, p) {
  const { g, X0, W, H, snap, from } = run;
  g.clearRect(X0, 0, W - X0, H);
  g.globalAlpha = 1 - smoothstep(0, 1, p);
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

function holeAt(run, p) {
  const q = seg(p, GROW_AT, GROW_AT + GROW_LEN);
  if (q <= 0 || !run.hole) return 0;
  return 12 + (run.hole.far - 12) * EASE.out(q);
}

function drawVeil(run, p, veil) {
  const { g, c, L, T, cw, ch } = run;
  if (veil <= 0) return;
  g.globalAlpha = veil; g.fillStyle = c.paper; g.fillRect(L, T, cw, ch);
  const rad = holeAt(run, p);
  if (rad > 0) {
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = 1;
    g.beginPath(); g.arc(run.hole.x, run.hole.y, rad, 0, 6.2832); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
}

function drawOld(run, p) {
  const { g, snap, from, sink } = run;
  if (!snap || p >= SHRINK_END) return;
  const a = EASE.io(seg(p, 0, SHRINK_END)), r = from.r, sc = 1 - 0.94 * a;
  const alpha = 1 - seg(p, 0.15, SHRINK_END);
  if (alpha <= 0) return;
  const w = r.width * sc, h = r.height * sc;
  const x0 = sink.x + (r.left - sink.x) * sc, y0 = sink.y + (r.top - sink.y) * sc;
  const rad = Math.min(w, h) / 2 * a + 16 * sc * (1 - a);
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  if (g.roundRect) g.roundRect(x0, y0, w, h, rad); else g.rect(x0, y0, w, h);
  g.clip();
  g.drawImage(snap, x0, y0, w, h);
  g.restore();
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
    const a = veil * Math.exp(-(((mid - u) / 3.4) ** 2)) * smoothstep(0, 1, clamp01((Math.abs(y - cy) - big * 0.7) / (big * 0.8)));
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
  const { g, X0, W, H, c, up, uFrom, uTo, L, T, cw, ch, phone } = run;
  g.clearRect(X0, T, W - X0, H - T);
  const veil = p > 0.62 ? 1 - smoothstep(0, 1, (p - 0.62) / 0.38) : 1;
  const text = p < 0.16 ? smoothstep(0, 1, p / 0.16) : veil;
  const speed = Math.sin(Math.PI * Math.min(1, p * 1.08));
  drawVeil(run, p, veil);
  drawOld(run, p);
  const u = uFrom + (uTo - uFrom) * EASE.io(p);
  const px = phone ? Math.max(44, Math.min(64, ch / 11)) : Math.max(52, Math.min(80, ch / 10));
  g.save();
  g.beginPath(); g.rect(L, T, cw, ch); g.clip();
  drawDust(run, text, speed, (u - uFrom) * px);
  const cx = L + cw / 2, cy = T + ch * (phone ? 0.4 : 0.45), big = phone ? 50 : 84;
  drawFloors(run, u, text, px, cx, cy, big);
  const [num, unit] = distanceParts(u);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.globalAlpha = text;
  g.font = font(big, 300);
  const bs = Math.min(big, (big * (cw - 32)) / Math.max(1, g.measureText(num).width));
  g.font = font(bs, 300); g.fillStyle = c.gold; g.fillText(num, cx, cy);
  spaced(g, 0.14);
  g.font = font(phone ? 12 : 13, 500); g.fillStyle = c.ink2;
  g.fillText(unit.toUpperCase(), cx, cy + bs * 0.62 + 6);
  spaced(g, 0);
  g.globalAlpha = text * 0.9;
  g.font = font(phone ? 12.5 : 13.5, 400); g.fillStyle = c.ink3;
  g.fillText(`${up ? 'Up' : 'Down'} to ${MODES[run.to].name} · ${MODES[run.to].measure}`, cx, cy + bs * 0.62 + 30);
  g.restore();
  g.globalAlpha = 1;
}

function holeFor(to, rung) {
  const ox = Math.round(rung.x - to.r.left), oy = Math.round(rung.y - to.r.top);
  const far = Math.ceil(Math.hypot(Math.max(Math.abs(ox), Math.abs(to.r.width - ox)), Math.max(Math.abs(oy), Math.abs(to.r.height - oy))));
  return { ox, oy, far, x: rung.x, y: rung.y };
}

function grow(run, elapsed) {
  const to = stageOf(run.to), rung = rungOf(run.to);
  if (!to || !rung || !to.el.animate) return null;
  if (run.grow && run.growEl === to.el) return run.grow;
  if (run.grow) run.grow.cancel();
  const h = holeFor(to, rung);
  run.hole = h; run.growEl = to.el;
  return to.el.animate([
    { clipPath: `circle(12px at ${h.ox}px ${h.oy}px)`, opacity: 0 },
    { clipPath: `circle(${Math.round(12 + (h.far - 12) * 0.25)}px at ${h.ox}px ${h.oy}px)`, opacity: 1, offset: 0.25 },
    { clipPath: `circle(${h.far}px at ${h.ox}px ${h.oy}px)`, opacity: 1 },
  ], { duration: Math.round(run.dur * GROW_LEN), delay: run.dur * GROW_AT - elapsed, fill: 'backwards', easing: CSS_EASE.out });
}

const inView = (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
function bandsOf(card) {
  const out = [];
  const head = card.querySelector(':scope > .phead');
  if (head) out.push(head);
  const body = card.querySelector('[aria-live]');
  if (body) for (const el of body.children) { if (el.classList.contains('card-ghost') || el.classList.contains('hero-wipe')) continue; if (el.tagName === 'UL') out.push(...el.children); else out.push(el); }
  return out;
}

function cardGhost(from) {
  const card = document.querySelector(`.scene[data-floor="${from}"] > .card`);
  const r = card && card.getBoundingClientRect();
  if (!r || r.width < 8 || r.height < 8 || r.top > innerHeight || r.bottom < 0) return null;
  const g = card.cloneNode(true);
  const src = card.querySelectorAll('canvas'), dst = g.querySelectorAll('canvas');
  dst.forEach((cv, i) => { try { if (src[i].width && src[i].height) cv.getContext('2d').drawImage(src[i], 0, 0); } catch {} });
  for (const n of g.querySelectorAll('.card-ghost')) n.remove();
  g.classList.add('floor-ghost');
  g.setAttribute('aria-hidden', 'true');
  g.removeAttribute('aria-labelledby');
  g.inert = true;
  Object.assign(g.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px`, boxSizing: 'border-box' });
  document.body.appendChild(g);
  const all = bandsOf(g);
  all.slice(STAGGER.max).forEach((e) => { e.style.visibility = 'hidden'; });
  const out = stagger(all.slice(0, STAGGER.max), { dur: DUR.base, x: -10, y: 0, exit: true });
  const gone = () => g.remove();
  if (out.length) Promise.all(out.map((a) => a && a.finished)).then(gone, gone); else gone();
  return g;
}

function enterCard(run, now) {
  const card = document.querySelector(`.scene[data-floor="${run.to}"]:not(.skel) > .card`);
  if (!card) return;
  stagger(inView(bandsOf(card)), { dur: DUR.base, y: 8, delay: Math.max(0, run.t0 + CARD_IN - now) });
}

function chrome(run, now) {
  const sc = document.querySelector(`.scene[data-floor="${run.to}"]:not(.skel) > .sc-stage`);
  if (!sc) return;
  const delay = Math.max(0, run.t0 + run.dur * GROW_AT - now);
  for (const el of sc.querySelectorAll(':scope > .question, :scope > .dock, :scope > .credit')) play(el, [{ opacity: 0 }, { opacity: 1 }], { dur: DUR.gentle, delay, fill: 'backwards' });
}

const ROOTS = { stars: 'starsRoot', dm: 'dmRoot', earth: 'earthRoot', asteroids: 'astRoot' };
function watchArrival(run) {
  const root = document.getElementById(ROOTS[run.to]);
  if (!root) return;
  const mo = new MutationObserver(() => {
    const scene = root.querySelector(':scope > .scene');
    if (!scene || scene.classList.contains('skel')) return;
    unwatch(run);
    const now = performance.now();
    if (current === run && now - run.t0 < run.dur) {
      run.grow = grow(run, now - run.t0);
      chrome(run, now);
      enterCard(run, now);
      return;
    }
    if (reduceMotion) return;
    const wrap = scene.querySelector('.map-wrap');
    if (wrap) play(wrap, [{ opacity: 0 }, { opacity: 1 }], { dur: DUR.gentle, fill: 'backwards' });
    stagger(inView(bandsOf(scene.querySelector(':scope > .card') || scene)), { dur: DUR.base, y: 8 });
  });
  mo.observe(root, { childList: true });
  run.mo = mo;
  run.arrivalT = setTimeout(() => unwatch(run), 30000);
}
function unwatch(run) {
  if (run.mo) run.mo.disconnect();
  clearTimeout(run.arrivalT);
  run.mo = null;
}

export function climbEntrance(m) {
  const run = current;
  if (!run || run.reduced || run.to !== m) return null;
  const left = run.t0 + CARD_IN - performance.now();
  return left > -DUR.base ? Math.max(0, left) : null;
}

export function floorTransition(from, to) {
  if (current) stop(current);
  if (lastRun) unwatch(lastRun);
  if (!from || !to || from === to || !MODES[from] || !MODES[to] || document.hidden) return;
  const fromStage = stageOf(from), snap = fromStage ? snapshot(fromStage) : null;
  if (!fromStage || (reduceMotion && !snap)) return;
  const r = fromStage.r;
  if (reduceMotion) {
    const run = { ...overlay(r, r.left), from: fromStage, to, snap, raf: 0, grow: null, dur: FADE_MS, reduced: true };
    current = run;
    const t0 = performance.now();
    const step = (now) => {
      if (current !== run) return;
      const p = clamp01((now - t0) / run.dur);
      drawFade(run, p);
      if (p < 1) run.raf = requestAnimationFrame(step); else stop(run);
    };
    drawFade(run, 0);
    run.raf = requestAnimationFrame(step);
    return;
  }
  const rung = rungOf(from);
  const rail = !!rung && rung.x < r.left && rung.y > r.top - 4 && rung.y < r.bottom + 4;
  const left = rail ? Math.max(0, rung.x - 24) : r.left;
  const sink = rung
    ? { x: rail ? rung.x : Math.max(r.left, Math.min(r.right, rung.x)), y: Math.max(r.top, Math.min(r.bottom, rung.y)) }
    : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const run = {
    ...overlay(r, left), from: fromStage, to, snap, raf: 0, grow: null, growEl: null, hole: null, sink,
    dur: climbMs(from, to), c: tokens(), L: r.left, T: r.top, cw: r.width, ch: r.height, phone: r.width < 600,
    up: MODES[to].icon > MODES[from].icon, uFrom: MODES[from].icon, uTo: MODES[to].icon, t0: performance.now(), entered: false,
  };
  current = lastRun = run;
  cardGhost(from);
  const sub = document.getElementById('sub');
  if (sub) play(sub, [{ opacity: 0 }, { opacity: 1 }], { dur: DUR.gentle, delay: STAGGER.each, fill: 'backwards' });
  const step = (now) => {
    if (current !== run) return;
    const el = now - run.t0, p = clamp01(el / run.dur);
    if (p < GROW_AT + GROW_LEN) run.grow = grow(run, el) || run.grow;
    if (!run.entered) {
      run.entered = true;
      chrome(run, now);
      enterCard(run, now);
      if (document.querySelector(`.scene[data-floor="${to}"].skel`) || !document.querySelector(`.scene[data-floor="${to}"]`)) watchArrival(run);
    }
    drawClimb(run, p);
    if (p < 1) run.raf = requestAnimationFrame(step); else stop(run);
  };
  drawClimb(run, 0);
  run.raf = requestAnimationFrame(step);
}
