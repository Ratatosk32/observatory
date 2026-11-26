import * as K from './kit.js';
import { ease, DUR } from './motion.js';
import { api as R, ext } from './stars.js';

const { $, text, annotate, pencilLine, setupCanvas, fmtN, clamp, esc } = K;
const C = () => K.C;
const S = R.S, Ob = R.Ob, ST = S.stories, OFF = S.meta.mjdOffset;
const BANDS = S.meta.bands;
const DEG = Math.PI / 180;
const oid = (id) => Ob.id.indexOf(id);
const dateOf = (t) => new Date((t + OFF - 40587) * 864e5);
const fmtD = (t) => { const d = dateOf(t); return `${d.getUTCDate()} ${K.MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
const loops = new Set();
function loop(fn) {
  let id = 0, alive = true;
  const step = (ts) => { if (!alive) return; fn(ts); id = requestAnimationFrame(step); };
  id = requestAnimationFrame(step);
  const h = () => { alive = false; cancelAnimationFrame(id); loops.delete(h); };
  loops.add(h);
  return h;
}
const timers = new Set();
const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
function stopAll() { [...loops].forEach((h) => h()); timers.forEach((t) => clearTimeout(t)); timers.clear(); }

const dLz = (z) => { let s = 0; const n = 400; for (let k = 0; k < n; k++) { const zz = (k + 0.5) / n * z; s += 1 / Math.sqrt(0.3 * (1 + zz) ** 3 + 0.7); } return (1 + z) * (299792.458 / 70) * (s * z / n) * 1e6; };

function lightCurve(cv, cfg) {
  return setupCanvas(cv, (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const src = cfg.src, mag = cfg.mode === 'sci';
    const pts = [];
    for (let k = 0; k < src.t.length; k++) {
      const v = mag ? src.s && src.s[k] : src.f[k];
      if (v == null || (mag && !(v > 0))) continue;
      pts.push([src.t[k], v, src.b[k], src.fe ? src.fe[k] : null]);
    }
    if (!pts.length) return;
    const tA = cfg.t0 != null ? cfg.t0 : Math.min(...pts.map((p) => p[0])) - 3, tB = cfg.t1 != null ? cfg.t1 : Math.max(...pts.map((p) => p[0])) + 3;
    const ys = pts.filter((p) => p[0] >= tA && p[0] <= tB).map((p) => p[1]);
    let lo = Math.min(0, pct(ys, 0.01)), hi = pct(ys, 0.995);
    if (mag) { lo = pct(ys, 0.01); hi = pct(ys, 0.995); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const L = 64, Rm = 12, T = 12, B = 30;
    const X = (t) => L + (t - tA) / (tB - tA) * (s.w - L - Rm), Y = (v) => s.h - B - (v - lo) / (hi - lo) * (s.h - T - B);
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; pencilLine(g, L, Y(v), s.w - Rm, Y(v), { color: C().grid, passes: 1 }); text(g, fmtN(Math.round(v)), L - 6, Y(v) + 4, { size: 10.5, color: C().ink3, align: 'right' }); }
    if (!mag) pencilLine(g, L, Y(0), s.w - Rm, Y(0), { color: C().ink3 });
    const span = tB - tA, stp = span > 150 ? 30 : span > 60 ? 15 : 7;
    for (let t = Math.ceil(tA / stp) * stp; t <= tB; t += stp) { const d = dateOf(t); text(g, `${d.getUTCDate()} ${K.MON[d.getUTCMonth()]}`, X(t), s.h - B + 15, { size: 10.5, color: C().ink3, align: 'center' }); }
    text(g, mag ? 'total flux (nJy)' : 'difference flux (nJy): new light', L, s.h - 3, { size: 11, color: C().ink2 });
    if (cfg.shade) for (const [a, b, lbl] of cfg.shade) { g.fillStyle = K.hatch(g, C().line, 5, 45, 1); g.fillRect(X(a), T, X(b) - X(a), s.h - T - B); if (lbl) text(g, lbl, (X(a) + X(b)) / 2, T + 14, { size: 11, color: C().ink, align: 'center', halo: true }); }
    const until = cfg.until ? cfg.until() : Infinity;
    for (const p of pts) {
      if (p[0] < tA || p[0] > tB || p[0] > until) continue;
      const b = BANDS[p[2]], col = C().band[b], dim = cfg.hi && !cfg.hi.includes(b);
      g.globalAlpha = dim ? 0.15 : 1;
      if (p[3] && !mag) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(X(p[0]), Y(p[1] - p[3])); g.lineTo(X(p[0]), Y(p[1] + p[3])); g.stroke(); }
      g.fillStyle = col; g.beginPath(); g.arc(X(p[0]), Y(p[1]), cfg.hi && !dim ? 3.6 : 2.8, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    if (cfg.until) { const x = X(Math.min(until, tB)); if (until > tA) { g.strokeStyle = C().hi; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, s.h - B); g.stroke(); } }
    if (cfg.marks) for (const [t, lbl] of cfg.marks) { const x = X(t); g.setLineDash([3, 3]); g.strokeStyle = C().gold; g.beginPath(); g.moveTo(x, T); g.lineTo(x, s.h - B); g.stroke(); g.setLineDash([]); annotate(g, lbl, x + 4, T + 16, { size: 16, color: C().gold, align: 'left' }); }
    if (cfg.after) cfg.after(g, s, X, Y);
  });
}
const bandLegend = (bands) => `<div class="legend">${bands.map((b) => `<span class="k"><span class="sw" style="background:${C().band[b]}"></span>${b}</span>`).join('')}</div>`;

function fitBands(src) {
  const per = {};
  for (let k = 0; k < src.t.length; k++) if (src.f[k] != null) (per[src.b[k]] ||= []).push(k);
  const out = [];
  for (const b in per) {
    const v = per[b].map((k) => src.f[k]).sort((x, y) => x - y);
    if (v.length < 8) continue;
    const lo = v[Math.floor(v.length * 0.05)], hi = v[Math.floor(v.length * 0.95)] || lo + 1;
    out.push({ t: Float64Array.from(per[b], (k) => src.t[k] + OFF), y: Float64Array.from(per[b], (k) => (src.f[k] - lo) / (hi - lo)) });
  }
  return out;
}
function solveSym(A, b, n) {
  for (let i = 0; i < n; i++) {
    let pv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r * n + i]) > Math.abs(A[pv * n + i])) pv = r;
    if (pv !== i) { for (let c = 0; c < n; c++) { const t = A[i * n + c]; A[i * n + c] = A[pv * n + c]; A[pv * n + c] = t; } const t = b[i]; b[i] = b[pv]; b[pv] = t; }
    const dd = A[i * n + i] || 1e-12;
    for (let r = i + 1; r < n; r++) { const f = A[r * n + i] / dd; if (!f) continue; for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c]; b[r] -= f * b[i]; }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let sm = b[i]; for (let c = i + 1; c < n; c++) sm -= A[i * n + c] * x[c]; x[i] = sm / (A[i * n + i] || 1e-12); }
  return x;
}
function residual(bands, P, H = 4) {
  const n = 2 * H + 1, row = new Float64Array(n);
  let res = 0, tot = 0;
  for (const bd of bands) {
    const A = new Float64Array(n * n), bb = new Float64Array(n);
    let sm = 0, s2 = 0;
    const m = bd.t.length;
    for (let k = 0; k < m; k++) {
      const ph = 2 * Math.PI * (bd.t[k] / P % 1); row[0] = 1;
      for (let h = 1; h <= H; h++) { row[2 * h - 1] = Math.cos(h * ph); row[2 * h] = Math.sin(h * ph); }
      for (let i = 0; i < n; i++) { bb[i] += row[i] * bd.y[k]; for (let j = i; j < n; j++) A[i * n + j] += row[i] * row[j]; }
      sm += bd.y[k]; s2 += bd.y[k] * bd.y[k];
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[i * n + j] = A[j * n + i];
    const yy = s2, cf = solveSym(A, bb.slice(), n);
    let fit = 0; for (let i = 0; i < n; i++) fit += cf[i] * bb[i];
    res += yy - fit; tot += s2 - sm * sm / m;
  }
  return res / tot;
}
function refinePeriod(bands, P0, half) {
  let best = P0, bv = residual(bands, P0);
  const scan = (a, b, st) => { for (let P = a; P <= b; P += st) { const v = residual(bands, P); if (v < bv) { bv = v; best = P; } } };
  scan(P0 - half, P0 + half, Math.max(1e-6, half / 60));
  const c = best; scan(c - Math.max(2e-6, half / 50), c + Math.max(2e-6, half / 50), 1e-6);
  return { P: best, res: bv };
}
K.ns.refine = { fitBands, residual, refinePeriod };
function makeDial(host, cfg) {
  host.innerHTML = `<div class="dial">
    <canvas class="dstrip" tabindex="0" aria-label="Period dial: drag or use arrow keys; Shift for fine control"></canvas>
    <div class="dread"><b class="dper"></b><span class="dmsg" aria-live="polite"></span>
      <span class="dbtns"><button class="btn" type="button" data-fine>Fine</button><button class="btn" type="button" data-ans>Show answer</button>${cfg.listen ? '<button class="btn" type="button" data-listen>Listen</button>' : ''}</span></div>
    <canvas class="dfold"></canvas></div>`;
  const pg = cfg.periodogram;
  const lmin = pg ? pg.logPeriodMin : Math.log10(cfg.gaiaP) - 0.6, lmax = pg ? pg.logPeriodMax : Math.log10(cfg.gaiaP) + 0.6;
  const peaks = pg ? pg.peaks.filter((p) => p.quality >= 0.6) : [{ period: cfg.gaiaP, quality: 1, halfWidthDays: cfg.gaiaP * cfg.gaiaP / (cfg.span || 270) * 0.25 }];
  const d = { logP: cfg.startLog != null ? cfg.startLog : lmin + (lmax - lmin) * 0.62, fine: false, ans: false, snapped: null, burst: 0 };
  const src = cfg.fp;
  const per = BANDS.map(() => []);
  for (let k = 0; k < src.t.length; k++) if (src.f[k] != null) per[src.b[k]].push(k);
  const bands = per.map((a, k) => [a, k]).filter(([a]) => a.length >= 5);
  const norm = bands.map(([a]) => { const v = a.map((k) => src.f[k]); return [pct(v, 0.05), pct(v, 0.95)]; });
  const curX = new Float32Array(src.t.length), fromX = new Float32Array(src.t.length);
  const fb = fitBands(src);
  let glide = 0;
  const phase = (k, P) => (((src.t[k] + OFF) / P) % 1 + 1) % 1;
  const strip = setupCanvas(host.querySelector('.dstrip'), (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const X = (lp) => 8 + (lp - lmin) / (lmax - lmin) * (s.w - 16);
    const base = s.h - 18;
    if (pg) {
      g.beginPath();
      pg.curve.forEach((q, i) => { const x = 8 + i / (pg.curve.length - 1) * (s.w - 16), y = base - clamp((q - pg.medianQuality) / (1 - pg.medianQuality), 0, 1) * (base - 6); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.strokeStyle = C().gold; g.lineWidth = 1.1; g.stroke();
    }
    pencilLine(g, 8, base, s.w - 8, base, { color: C().goldSoft });
    for (const P of [0.05, 0.1, 0.2, 0.5, 1, 2, 5]) { const lp = Math.log10(P); if (lp < lmin || lp > lmax) continue; const x = X(lp); g.fillStyle = C().ink3; g.fillRect(x, base, 1, 4); text(g, P < 1 ? `${Math.round(P * 24 * 10) / 10} h` : `${P} d`, x, s.h - 3, { size: 10, color: C().ink3, align: 'center' }); }
    if (d.ans || d.snapped) for (const tk of cfg.ticks || []) { const x = X(Math.log10(tk.p)); g.strokeStyle = tk.col || C().ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, base); g.stroke(); text(g, tk.label, x + 3, 12, { size: 10.5, color: C().ink, halo: true }); }
    const x = X(d.logP);
    g.strokeStyle = C().hi; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, base + 2); g.stroke();
    g.fillStyle = C().hi; g.beginPath(); g.arc(x, base, 6, 0, 6.283); g.fill();
    if (d.burst > 0) { g.strokeStyle = C().gold; g.globalAlpha = d.burst; g.lineWidth = 1.5; for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, r0 = 10 + (1 - d.burst) * 14, r1 = r0 + 6; g.beginPath(); g.moveTo(x + Math.cos(a) * r0, base / 2 + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r1, base / 2 + Math.sin(a) * r1); g.stroke(); } g.globalAlpha = 1; }
    strip.__X = X;
  });
  const fold = setupCanvas(host.querySelector('.dfold'), (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const L = 26, Rm = 8, T = 6, Bm = 20, sh = (s.h - T - Bm) / Math.max(1, bands.length);
    const X = (ph) => L + ph / 2 * (s.w - L - Rm);
    bands.forEach(([a, b], r) => {
      const [lo, hi] = norm[r], y0 = T + r * sh;
      const Y = (v) => y0 + sh - 4 - (clamp(v, lo, hi) - lo) / Math.max(1e-9, hi - lo) * (sh - 8);
      pencilLine(g, L, y0 + sh - 2, s.w - Rm, y0 + sh - 2, { color: C().grid, passes: 1 });
      text(g, BANDS[b], 6, y0 + sh / 2 + 4, { size: 12, weight: 600, color: C().band[BANDS[b]] });
      g.fillStyle = C().band[BANDS[b]];
      for (const k of a) for (const c of [0, 1]) { g.beginPath(); g.arc(X(curX[k] + c), Y(src.f[k]), 1.7, 0, 6.283); g.fill(); }
    });
    for (const ph of [0, 0.5, 1, 1.5, 2]) text(g, ph.toFixed(1), X(ph), s.h - 5, { size: 10, color: C().ink3, align: 'center' });
  });
  function setFold(animate) {
    const P = 10 ** d.logP;
    for (let k = 0; k < src.t.length; k++) { fromX[k] = curX[k]; }
    if (!animate) { for (let k = 0; k < src.t.length; k++) curX[k] = phase(k, P); fold.draw(fold); return; }
    const target = Float32Array.from({ length: src.t.length }, (_, k) => phase(k, P));
    const t0 = performance.now();
    if (glide) glide();
    glide = loop((ts) => {
      const p = Math.min(1, (ts - t0) / DUR.gentle), e = ease.io(p);
      for (let k = 0; k < src.t.length; k++) curX[k] = fromX[k] + (target[k] - fromX[k]) * e;
      fold.draw(fold);
      if (p >= 1) { glide(); glide = 0; }
    });
  }
  function readout() {
    const P = 10 ** d.logP;
    host.querySelector('.dper').textContent = `${P.toFixed(d.snapped ? 6 : 5)} d = ${R.fmtPer(P)}`;
  }
  function checkSnap() {
    const P = 10 ** d.logP;
    const pk = peaks.find((q) => Math.abs(P - q.period) <= q.halfWidthDays * 3 + P * 0.0006);
    if (!pk || d.snapped === pk) { if (!pk) d.snapped = null; return; }
    d.snapped = pk;
    const ref = fb.length ? refinePeriod(fb, pk.period, pk.halfWidthDays * 3 + pk.period * 0.0002) : { P: pk.period };
    d.refined = ref;
    const l0 = d.logP, l1 = Math.log10(ref.P), t0 = performance.now();
    const hnd = loop((ts) => {
      const p = Math.min(1, (ts - t0) / DUR.base);
      d.logP = l0 + (l1 - l0) * (1 - (1 - p) ** 2);
      d.burst = 1 - p;
      strip.draw(strip); readout();
      if (p >= 1) { d.burst = 0; strip.draw(strip); hnd(); }
    });
    later(() => setFold(true), 200);
    const msg = cfg.onSnap ? cfg.onSnap(ref.P) : '';
    host.querySelector('.dmsg').textContent = msg || 'Snap!';
  }
  function setLog(lp, animate, noSnap) {
    d.logP = clamp(lp, lmin, lmax);
    readout(); strip.draw(strip);
    setFold(animate);
    host.querySelector('.dmsg').textContent = '';
    if (!noSnap) checkSnap();
  }
  const sc = host.querySelector('.dstrip');
  let drag = null;
  sc.addEventListener('pointerdown', (e) => { sc.setPointerCapture(e.pointerId); drag = { x: e.clientX, lp: d.logP }; if (!e.shiftKey && !d.fine) { const r = sc.getBoundingClientRect(); setLog(lmin + (e.clientX - r.left - 8) / (r.width - 16) * (lmax - lmin)); drag.lp = d.logP; } });
  sc.addEventListener('pointermove', (e) => { if (!drag) return; const r = sc.getBoundingClientRect(), f = (e.shiftKey || d.fine) ? 0.1 : 1; setLog(drag.lp + (e.clientX - drag.x) / (r.width - 16) * (lmax - lmin) * f); });
  sc.addEventListener('pointerup', () => { drag = null; });
  sc.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation(); const st = (e.shiftKey || d.fine ? 0.0002 : 0.004) * (e.key === 'ArrowLeft' ? -1 : 1); setLog(d.logP + st); });
  host.querySelector('[data-fine]').addEventListener('click', (e) => { d.fine = !d.fine; e.target.classList.toggle('on', d.fine); });
  host.querySelector('[data-ans]').addEventListener('click', () => { d.ans = true; setLog(Math.log10(cfg.gaiaP), true, true); host.querySelector('.dmsg').textContent = `Gaia DR3: ${cfg.gaiaP.toFixed(6)} d.`; });
  const lb = host.querySelector('[data-listen]');
  if (lb) lb.addEventListener('click', () => listen(src, bands, 10 ** d.logP, cfg.gaiaP, lb));
  readout(); setFold(false);
  return { set: (P) => setLog(Math.log10(P), true), get P() { return 10 ** d.logP; }, get refined() { return d.refined; }, residualAt: (P) => residual(fb, P) };
}
let audio = null;
function listen(src, bands, P, realP, btn) {
  try {
    if (audio) { audio.stop(); audio = null; btn.classList.remove('on'); return; }
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const [a, b] = bands.reduce((m, x) => (x[0].length > m[0].length ? x : m), bands[0]);
    const v = a.map((k) => src.f[k]), lo = pct(v, 0.05), hi = pct(v, 0.95);
    const bins = 40, sum = new Float32Array(bins), cnt = new Float32Array(bins);
    for (const k of a) { const ph = (((src.t[k] + OFF) / P) % 1 + 1) % 1, i = Math.floor(ph * bins); sum[i] += clamp((src.f[k] - lo) / (hi - lo), 0, 1); cnt[i]++; }
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'sine'; gain.gain.value = 0.12; osc.connect(gain); gain.connect(ac.destination);
    const t0 = ac.currentTime;
    for (let c = 0; c < 8; c++) for (let i = 0; i < bins; i++) { const y = cnt[i] ? sum[i] / cnt[i] : 0.5; osc.frequency.setValueAtTime(220 * 4 ** y, t0 + c + i / bins); }
    osc.start(); osc.stop(t0 + 8);
    btn.classList.add('on');
    audio = { stop: () => { try { osc.stop(); ac.close(); } catch {} } };
    osc.onended = () => { btn.classList.remove('on'); audio = null; ac.close(); };
  } catch {}
}

const CLOCK_MARKS = [[417e-9, 'telescope invented'], [3e-4, 'first modern humans'], [0.066, 'dinosaurs end'], [0.47, 'first land plants'], [0.6, 'first animals'], [4.57, 'Sun and Earth form'], [13.2, 'first galaxies']];
function clockX(gyr, s) {
  const seam = 0.34, L = 16, W = s.w - 32, y = gyr * 1e9;
  if (y <= 1e6) return L + W * seam * Math.log10(1 + y) / 6;
  return L + W * seam + W * (1 - seam) * (gyr - 0.001) / (13.47 - 0.001);
}
function drawClock(cv, pins, opts = {}) {
  return setupCanvas(cv, (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const y = s.h * 0.55;
    pencilLine(g, 16, y, s.w - 16, y, { color: C().gold, width: 1.4 });
    const xs = clockX(0.001, s);
    g.setLineDash([2, 3]); g.strokeStyle = C().ink3; g.beginPath(); g.moveTo(xs, y - 18); g.lineTo(xs, y + 18); g.stroke(); g.setLineDash([]);
    text(g, '← log scale · linear in billions of years →', xs, y + 32, { size: 10, color: C().ink3, align: 'center' });
    text(g, 'now', 16, y + 16, { size: 11, color: C().ink2 });
    text(g, 'Big Bang, 13.47 Gyr', s.w - 16, y + 16, { size: 11, color: C().ink2, align: 'right' });
    (opts.compact || s.w < 520 ? CLOCK_MARKS.filter((m) => [0.066, 4.57, 13.2].includes(m[0])) : CLOCK_MARKS).forEach(([gy, lbl], i) => {
      const x = clockX(gy, s);
      g.strokeStyle = C().ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke();
      annotate(g, lbl, x, y - 12 - (i % 2) * 16, { size: 15, color: gy === 4.57 ? C().gold : C().ink2 });
    });
    for (const p of pins) {
      const gyr = typeof p.gyr === 'function' ? p.gyr() : p.gyr;
      const x = clockX(gyr, s);
      if (p.lo != null) { g.strokeStyle = C().hi; g.globalAlpha = 0.4; g.lineWidth = 6; g.beginPath(); g.moveTo(clockX(p.lo, s), y); g.lineTo(clockX(p.hi, s), y); g.stroke(); g.globalAlpha = 1; }
      g.fillStyle = C().hi; g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x - 6, y + 14); g.lineTo(x + 6, y + 14); g.fill();
      text(g, p.label || '', clamp(x, 80, s.w - 80), y + 50, { size: 12.5, weight: 600, color: C().ink, align: 'center', halo: true });
    }
  });
}

function makeHalo(cv, opts) {
  const pts = [];
  for (let i = 0; i < R.N; i++) { const gc = Ob.gc && Ob.gc[i]; if (gc) pts.push({ i, x: gc[0], y: gc[1], z: gc[2], r: Math.hypot(gc[0], gc[1], gc[2]), rr: R.FKEY[Ob.fam[i]] === 'rrlyr' }); }
  const radii = pts.map((p) => p.r).sort((a, b) => a - b);
  const fitR = opts.spheres ? 640 : Math.max(20, radii[Math.floor(radii.length * 0.97)] || 60) * 1.05;
  const h = { yaw: opts.yaw != null ? opts.yaw : -0.9, pitch: opts.pitch != null ? opts.pitch : 0.38, vy: 0, vp: 0, zoom: 1, spheres: !!opts.spheres, hover: -1, auto: !K.reduceMotion, D: fitR * 4.5 };
  const MC = [['LMC', -0.6, -41.3, -27.1, 50], ['SMC', 15.3, -36.9, -43.3, 62]];
  let proj = [];
  const s = setupCanvas(cv, draw);
  const scale = () => Math.min(s.w, s.h * 1.15) / 2 / fitR * h.zoom;
  function P(x, y, z) {
    const cy = Math.cos(h.yaw), sy = Math.sin(h.yaw), cp = Math.cos(h.pitch), sp = Math.sin(h.pitch);
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const f = h.D / (h.D + y2), sc = scale();
    return [s.w / 2 + h.ox + x1 * sc * f, s.h * 0.5 + h.oy - z2 * sc * f, f, y2];
  }
  h.ox = 0; h.oy = 0;
  function autoFit() {
    if (h.spheres || !s.w) return;
    h.zoom = 1; h.ox = 0; h.oy = 0;
    const xs = [], ys = [];
    for (const p of pts) { const [x, y] = P(p.x, p.y, p.z); xs.push(x); ys.push(y); }
    const gcp = P(0, 0, 0); xs.push(gcp[0]); ys.push(gcp[1]);
    const q = (a, f) => [...a].sort((u, v) => u - v)[Math.floor(f * (a.length - 1))];
    const x0 = Math.min(q(xs, 0.04), gcp[0] - 40), x1 = Math.max(q(xs, 0.96), gcp[0] + 40), y0 = Math.min(q(ys, 0.04), gcp[1] - 30), y1 = Math.max(q(ys, 0.96), gcp[1] + 30);
    const z = Math.min(s.w * 0.86 / (x1 - x0), s.h * 0.82 / (y1 - y0));
    h.zoom = clamp(z, 0.4, 6);
    h.ox = -((x0 + x1) / 2 - s.w / 2) * h.zoom; h.oy = -((y0 + y1) / 2 - s.h / 2) * h.zoom;
    fitted = true;
  }
  let fitted = false;
  const path = (g, arr) => { g.beginPath(); arr.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); };
  function draw() {
    if (!s.w) return;
    if (!fitted || s.__fw !== s.w) { autoFit(); s.__fw = s.w; }
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const gold = C().gold;
    const disc = []; for (let k = 0; k <= 96; k++) { const a = k / 96 * 6.283; disc.push(P(16 * Math.cos(a), 16 * Math.sin(a), 0)); }
    path(g, disc); g.fillStyle = gold; g.globalAlpha = 0.07; g.fill(); g.globalAlpha = 0.5; g.strokeStyle = gold; g.lineWidth = 1; g.stroke();
    for (let arm = 0; arm < 4; arm++) {
      const a0 = arm * Math.PI / 2, pts2 = [];
      for (let r = 2.2; r <= 15.5; r += 0.25) { const a = a0 + Math.log(r / 2.2) / Math.tan(13 * DEG); pts2.push(P(r * Math.cos(a), r * Math.sin(a), 0)); }
      path(g, pts2); g.globalAlpha = 0.45; g.lineWidth = 2.2; g.strokeStyle = gold; g.stroke();
    }
    g.globalAlpha = 1;
    const bl = []; for (let k = 0; k <= 48; k++) { const a = k / 48 * 6.283; bl.push(P(2.6 * Math.cos(a) * Math.cos(h.yaw), -2.6 * Math.cos(a) * Math.sin(h.yaw), 1.6 * Math.sin(a))); }
    const gc = P(0, 0, 0), bg = g.createRadialGradient(gc[0], gc[1], 0, gc[0], gc[1], 3 * scale());
    bg.addColorStop(0, 'rgba(255,236,190,0.9)'); bg.addColorStop(1, 'rgba(240,191,79,0)');
    g.fillStyle = bg; g.beginPath(); g.arc(gc[0], gc[1], 3 * scale(), 0, 6.283); g.fill();
    const wire = (R0, alpha, dash) => {
      g.setLineDash(dash); g.strokeStyle = gold; g.globalAlpha = alpha; g.lineWidth = 0.8;
      for (const [ax, rot] of [[0, 0], [1, 0], [1, Math.PI / 2], [2, 0]]) {
        const c = [];
        for (let k = 0; k <= 96; k++) {
          const a = k / 96 * 6.283, u = R0 * Math.cos(a), v = R0 * Math.sin(a);
          c.push(ax === 0 ? P(u, v, 0) : ax === 1 ? P(u * Math.cos(rot), u * Math.sin(rot), v) : P(u * Math.cos(rot + 0.785), u * Math.sin(rot + 0.785), v));
        }
        path(g, c); g.stroke();
      }
      g.setLineDash([]); g.globalAlpha = 1;
    };
    wire(100, h.spheres ? 0.5 : 0.22, []);
    if (h.spheres) wire(600, 0.4, [5, 5]);
    const lab100 = P(0, 0, 100);
    text(g, h.spheres ? '100 kpc: where our distances stop' : '100 kpc', lab100[0] + 4, lab100[1] - 4, { size: 11, color: C().ink3, halo: true });
    if (h.spheres) { const l6 = P(0, 0, 600); text(g, '~600 kpc: what Rubin can reach', l6[0] + 4, Math.max(14, l6[1] - 4), { size: 11.5, color: C().ink, halo: true }); }
    proj = pts.map((p) => { const [x, y, f, d] = P(p.x, p.y, p.z); const [x0, y0] = P(p.x, p.y, 0); return { p, x, y, f, d, x0, y0 }; }).sort((a, b) => b.d - a.d);
    g.lineWidth = 0.6;
    for (const q of proj) { if (!q.p.rr) continue; g.strokeStyle = C().ink3; g.globalAlpha = 0.12 * q.f; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x0, q.y0); g.stroke(); }
    for (const q of proj) {
      const t = clamp(Math.log10(q.p.r + 1) / 2, 0, 1);
      g.fillStyle = q.p.rr ? `rgb(${Math.round(240 - 50 * t)},${Math.round(200 - 30 * t)},${Math.round(90 + 165 * t)})` : C().band.z;
      g.globalAlpha = clamp(0.25 + 0.75 * (q.f - 0.7) / 0.6, 0.2, 1);
      const r = (q.p.rr ? 3 : 1.8) * clamp(q.f, 0.6, 1.5);
      g.beginPath(); g.arc(q.x, q.y, r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    for (const [nm, x, y, z, kpc] of MC) {
      const m = P(x, y, z);
      g.strokeStyle = C().ink2; g.lineWidth = 1; g.beginPath(); g.ellipse(m[0], m[1], 6, 3.5, 0.4, 0, 6.283); g.stroke();
      annotate(g, `${nm}, ${kpc} kpc`, m[0] + 9, m[1] + 4, { size: 15, color: C().ink2, align: 'left' });
    }
    const sun = P(-8.178, 0, 0.021);
    g.fillStyle = gold; g.beginPath(); g.arc(sun[0], sun[1], 4.5, 0, 6.283); g.fill();
    g.strokeStyle = C().ink; g.lineWidth = 1; g.beginPath(); g.arc(sun[0], sun[1], 7, 0, 6.283); g.stroke();
    const sunLeft = sun[0] < gc[0];
    annotate(g, 'Sun', sun[0] + (sunLeft ? -10 : 10), sun[1] - 8, { size: 17, color: gold, align: sunLeft ? 'right' : 'left' });
    annotate(g, 'Galactic centre', gc[0] + (sunLeft ? 14 : -14), gc[1] + 22, { size: 16, color: C().ink, align: sunLeft ? 'left' : 'right' });
    if (h.hover >= 0) {
      const q = proj.find((z) => z.p.i === h.hover);
      if (q) {
        g.strokeStyle = C().hi; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 8, 0, 6.283); g.stroke();
        const msg = candleText(q.p.i) || R.fmtPc(Ob.dist[q.p.i]);
        text(g, msg, clamp(q.x + 12, 8, s.w - 8), q.y - 12, { size: 12, weight: 600, color: C().ink, halo: true, align: q.x > s.w * 0.6 ? 'right' : 'left' });
      }
    }
    text(g, h.auto ? 'turning slowly · drag to rotate · wheel or pinch to zoom' : 'drag to rotate · wheel or pinch to zoom', 10, s.h - 8, { size: 10.5, color: C().ink3 });
  }
  let last = 0;
  const stop = loop((ts) => {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    if (!drag) { if (h.auto) h.yaw += dt * 6 * DEG; h.yaw += h.vy; h.pitch = clamp(h.pitch + h.vp, -1.45, 1.45); h.vy *= 0.94; h.vp *= 0.94; }
    draw();
  });
  let drag = null; const ptrs = new Map();
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY }; h.auto = false; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag.z = h.zoom; } });
  cv.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag && ptrs.size === 2 && drag.pinch) { const [a, b] = [...ptrs.values()]; h.zoom = clamp(drag.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / drag.pinch, 0.3, 8); return; }
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; h.vy = dx * 0.006; h.vp = dy * 0.006; h.yaw += h.vy; h.pitch = clamp(h.pitch + h.vp, -1.45, 1.45); drag.x = e.clientX; drag.y = e.clientY; return; }
    if (e.pointerType !== 'mouse') return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 144;
    for (const q of proj) { const dd = (q.x - x) ** 2 + (q.y - y) ** 2; if (dd < bd) { bd = dd; best = q; } }
    h.hover = best ? best.p.i : -1;
    if (opts.onHover) opts.onHover(h.hover);
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) drag = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); h.auto = false; h.zoom = clamp(h.zoom * Math.exp(-e.deltaY * 0.0012), 0.3, 8); }, { passive: false });
  return { h, stop, hoverStar: (i) => { h.hover = i; } };
}
function candleText(i) {
  if (Ob.gaiaG[i] == null) return '';
  const G = Ob.gaiaG[i], d = 10 ** ((G - 0.63 + 5) / 5);
  return `G = ${G.toFixed(2)}, M = 0.63 → 10^((${G.toFixed(2)} − 0.63 + 5)/5) pc = ${R.fmtPc(d)}`;
}

function drawHorizon(cv) {
  const H = S.meta.horizons;
  const kindFams = [(i) => R.FKEY[Ob.fam[i]] === 'active', (i) => R.FKEY[Ob.fam[i]] === 'rrlyr', (i) => R.FKEY[Ob.fam[i]] === 'ceph', (i) => R.FKEY[Ob.fam[i]] === 'cv',
    (i) => /SN II/.test(R.catOf(i)), (i) => /SN Ia/.test(R.catOf(i)), (i) => /SLSN/.test(R.catOf(i)), (i) => Ob.sdssClass[i] === 'QSO' || R.FKEY[Ob.fam[i]] === 'agn'];
  return setupCanvas(cv, (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const L = 150, Rm = 16, T = 10, B = 34, rh = (s.h - T - B) / H.length;
    const X = (pc) => L + Math.log10(clamp(pc, 1, 1e11)) / 11 * (s.w - L - Rm);
    for (let dcd = 0; dcd <= 11; dcd += s.w < 600 ? 3 : 1) { const x = X(10 ** dcd); pencilLine(g, x, T, x, s.h - B, { color: C().grid, passes: 1 }); text(g, ['1 pc', '10', '100', '1 kpc', '10', '100', '1 Mpc', '10', '100', '1 Gpc', '10', '100 Gpc'][dcd], x, s.h - B + 14, { size: 10.5, color: C().ink3, align: 'center' }); }
    H.forEach((hz, r) => {
      const y = T + r * rh + rh / 2, quasar = /quasar/i.test(hz.kind);
      let single = hz.singlePc, deep = hz.deepPc;
      if (quasar) { single = dLz(6.5); deep = single; }
      text(g, hz.kind.replace(', P = 10 d', '').replace(' at peak', '').replace(', plateau', ''), L - 8, y + 4, { size: 11.5, color: C().ink2, align: 'right' });
      g.fillStyle = C().goldSoft; g.globalAlpha = 0.5; g.fillRect(X(1), y - 4, X(single) - X(1), 8);
      g.globalAlpha = 0.25; g.fillRect(X(single), y - 4, X(deep) - X(single), 8); g.globalAlpha = 1;
      g.fillStyle = C().gold; g.fillRect(X(single) - 1, y - 7, 2, 14);
      if (quasar) text(g, 'in practice z ~ 6–7 in the reddest filters', X(single) + 6, y + 4, { size: 10.5, color: C().ink3 });
      g.fillStyle = C().ink;
      for (let i = 0; i < R.N; i++) { if (Ob.dist[i] == null || Ob.distMethod[i] < 0 || !kindFams[r](i)) continue; g.globalAlpha = 0.7; g.beginPath(); g.arc(X(Ob.dist[i]), y + ((i * 7.3) % 1 - 0.5) * 6, 1.8, 0, 6.283); g.fill(); }
      g.globalAlpha = 1;
    });
    text(g, 'bar: how far a single Rubin visit (m = 24.5) sees it; pale: a deep-field night (26.0); dots: this sample', L, s.h - 3, { size: 10.5, color: C().ink3 });
  });
}

function coreSample(cv, reasonIdx, named) {
  return setupCanvas(cv, (s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const objs = []; for (let i = 0; i < R.N; i++) if (Ob.reason[i] === reasonIdx) objs.push(i);
    const withD = objs.filter((i) => Ob.dist[i] != null && Ob.distMethod[i] >= 0);
    const ra = objs.map((i) => Ob.ra[i]), de = objs.map((i) => Ob.dec[i]);
    const r0 = pct(ra, 0.5), d0 = pct(de, 0.5), span = 3.2;
    const pw = Math.min(s.h - 40, s.w * 0.36), px = 16, py = 20;
    const SX = (i) => px + pw / 2 - (Ob.ra[i] - r0) * Math.cos(d0 * DEG) / span * pw, SY = (i) => py + pw / 2 - (Ob.dec[i] - d0) / span * pw;
    g.strokeStyle = C().line; g.strokeRect(px + 0.5, py + 0.5, pw, pw);
    text(g, `${fmtN(objs.length)} objects in ${span}° of sky`, px, py - 6, { size: 11, color: C().ink3 });
    const LX = s.w - 120, top = 16, bot = s.h - 16, Ylad = (pc) => bot - Math.log10(pc) / 10 * (bot - top);
    for (let dcd = 1; dcd <= 10; dcd++) { const y = Ylad(10 ** dcd); pencilLine(g, LX - 6, y, LX + 6, y, { color: C().ink3, passes: 1 }); text(g, ['', '10 pc', '100 pc', '1 kpc', '10 kpc', '100 kpc', '1 Mpc', '10 Mpc', '100 Mpc', '1 Gpc', '10 Gpc'][dcd], LX + 12, y + 4, { size: 10.5, color: C().ink3 }); }
    pencilLine(g, LX, top, LX, bot, { color: C().goldSoft, width: 1.2 });
    g.lineWidth = 0.6;
    for (const i of withD) { g.strokeStyle = R.gcol[R.grp[i]]; g.globalAlpha = 0.18; g.beginPath(); g.moveTo(SX(i), SY(i)); g.lineTo(LX, Ylad(Ob.dist[i])); g.stroke(); }
    g.globalAlpha = 1;
    for (const i of objs) { g.fillStyle = R.gcol[R.grp[i]]; g.globalAlpha = withD.includes(i) ? 0.9 : 0.3; g.beginPath(); g.arc(SX(i), SY(i), 1.8, 0, 6.283); g.fill(); }
    for (const i of withD) { g.fillStyle = R.gcol[R.grp[i]]; g.globalAlpha = 0.9; g.beginPath(); g.arc(LX, Ylad(Ob.dist[i]), 2.4, 0, 6.283); g.fill(); }
    g.globalAlpha = 1;
    (named || []).forEach(([id, lbl], k) => {
      const i = oid(id); if (i < 0) return;
      g.strokeStyle = C().hi; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(SX(i), SY(i)); g.lineTo(LX, Ylad(Ob.dist[i])); g.stroke();
      g.beginPath(); g.arc(LX, Ylad(Ob.dist[i]), 5, 0, 6.283); g.stroke();
      annotate(g, lbl, LX - 10, Ylad(Ob.dist[i]) + 5, { size: 16, color: C().ink, align: 'right' });
    });
    text(g, `${fmtN(withD.length)} with a distance`, LX, bot + 12, { size: 10.5, color: C().ink3, align: 'center' });
  });
}

let chap = null, beat = 0, stage = null, savedPos = null;
const CHAPTERS = [
  { key: 'sn', short: '1 · Supernova', n: 1, title: 'How a supernova rises and fades', hook: 'A white dwarf explodes in a deep field; Rubin catches every night of it.', big: '−19.1', icon: 'star' },
  { key: 'core', short: '2 · Core sample', n: 2, title: 'A core sample through the Universe', hook: 'One 3° patch of sky, from a red dwarf next door to an explosion 7.9 billion years old.', big: '8 decades', icon: 'core' },
  { key: 'beat', short: '3 · Find the beat', n: 3, title: 'Find the beat', hook: 'Turn the period dial until two touching stars snap into focus.', big: '6 h 26 min', icon: 'dial' },
  { key: 'halo', short: '4 · Halo in 3D', n: 4, title: 'The halo in 3D', hook: 'Pulsating stars 2 to 100 kpc out, placed by their own brightness.', big: '6× deeper', icon: 'halo' },
  { key: 'old', short: '5 · Old light', n: 5, title: 'Light older than the Sun', hook: 'A superluminous supernova and quasars seen as they were billions of years ago.', big: '12.2 billion years', icon: 'clock' },
  { key: 'cant', short: '6 · Can’t see', n: 6, title: 'What Rubin can’t see', hook: 'The north, daylight gaps, dust, faintness, and labels that were wrong.', big: "54 'supernovae'", icon: 'eye' },
  { key: 'free', short: '7 · Free sky', n: 7, title: 'Free sky', hook: 'The whole sample to explore: sky, distances, census, HR diagram.', big: '4,780', icon: 'free' },
];
const ICONS = {
  star: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/><circle cx="12" cy="12" r="2.5"/>',
  core: '<rect x="4" y="3" width="6" height="18"/><path d="M14 6h6M14 10h4M14 14h6M14 18h3"/>',
  dial: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-4M12 4v2M20 12h-2M12 20v-2M4 12h2"/>',
  halo: '<ellipse cx="12" cy="12" rx="9" ry="3"/><circle cx="12" cy="12" r="1.6"/><circle cx="6" cy="6" r=".8"/><circle cx="18" cy="17" r=".8"/><circle cx="16" cy="5" r=".8"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l-3 2M4 4l2 2"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 20 20 4"/>',
  free: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};

function stageSet(title, html) {
  $('#h-stage').textContent = title;
  $('#stageBody').innerHTML = html;
  return $('#stageBody');
}
function sel(i) { R.select(i); }
function playTo(t0, t1, speed, done) {
  R.setPlay(false); R.setT(t0);
  const st = R.state;
  st.speed = speed; st.stopAt = t1;
  R.hooks.onStop = done || null;
  if (K.reduceMotion) { R.setT(t1); st.stopAt = null; if (done) done(); return; }
  R.setPlay(true);
}
function resetHooks() {
  R.hooks.overlay = null; R.hooks.onStop = null; R.hooks.emberAlpha = 1; R.hooks.skyAlpha = 1;
  if (R.hooks.staticOverlay) { R.hooks.staticOverlay = null; R.invalidateSky(); }
  R.state.stopAt = null; R.state.speed = 2;
  const st = R.state;
  if (st.groupsOn.size !== R.GROUPS.length) { st.groupsOn = new Set(R.GROUPS.map((_, i) => i)); st.pred = null; R.applyFilter(); }
}
const ringOverlay = (i, lbl) => (g, s, f, qx, qy) => {
  const x = qx[i], y = qy[i], pulse = 1 + 0.25 * Math.sin(performance.now() / 250);
  const sp = R.sprites[R.grp[i]];
  if (sp) { g.globalAlpha = 0.9; g.drawImage(sp, x - 14 * pulse, y - 14 * pulse, 28 * pulse, 28 * pulse); g.globalAlpha = 1; }
  g.strokeStyle = C().hi; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 10, 0, 6.283); g.stroke();
  if (lbl && R.state.sel !== i) annotate(g, lbl, x + (x > s.w * 0.6 ? -16 : 16), y - 16, { size: 19, color: C().ink, align: x > s.w * 0.6 ? 'right' : 'left' });
};
const sni = ST.sn_ia, cb = ST.contact_binary, rr = ST.rr_lyrae, slsn = ST.slsn_old_light, qso = ST.quasar, qfar = ST.quasar_far, gap = ST.sn_gap;
const stampsHtml = (st) => `<div class="epochs">${st.stamps.map((e) => `<div class="ep"><div class="eph">${e.epoch} · ${fmtD(e.t)} · ${e.band}</div><div class="stamps sm"><figure><span class="im"><img src="${e.science}" alt="science"></span><figcaption>Science</figcaption></figure><div class="op">−</div><figure><span class="im"><img src="${e.template}" alt="template"></span><figcaption>Template</figcaption></figure><div class="op">=</div><figure><span class="im"><img src="${e.difference}" alt="difference"></span><figcaption>Difference</figcaption></figure></div></div>`).join('')}</div>`;

const BEATS = {
  sn: [
    { text: 'This patch of sky, 3° across, is one of Rubin\'s deep fields: COSMOS. On 1 April 2026 nothing here is new.', run() {
      R.zoomAnim(236.1, 40.5, 30, 1200); R.setPlay(false); R.setT(130); sel(sni.o);
      const b = stageSet('AT 2026ivl · forced photometry', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i', 'z', 'u'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: sni.fp, t0: 125, t1: 215, until: () => R.state.t });
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
    } },
    { text: 'Watch the light curve draw itself, one night per second. Rubin first detected it on 6 April; from the next night Fink measured the spot every night it was observed, in five filters, whether or not anything was detected.', honest: 'For this supernova the forced photometry starts after discovery, so there is no flat pre-explosion baseline here; chapter 6 shows one that has it.', run() {
      const b = stageSet('AT 2026ivl · forced photometry, drawn as the season plays', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i', 'z', 'u'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: sni.fp, t0: 125, t1: 215, until: () => R.state.t });
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
      playTo(130, 210, 1);
      loop(() => stage.draw(stage));
    } },
    { text: 'Same 6″ of sky, three nights. The template is the galaxy before; the difference is only the new light.', run() {
      R.setPlay(false); R.setT(191);
      stageSet('Three epochs: first detection, peak, late (0.2″ per pixel)', stampsHtml(sni));
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
    } },
    { text: 'The colours tell the physics. The u band fades fastest as the debris cools, while i shows a second bump around 30 May: iron recombining, a fingerprint of a Type Ia.', honest: 'The second bump is a hint in 3 points, not a measurement.', run() {
      const b = stageSet('Blue fades first; the red second bump', `<canvas class="lc"></canvas>${bandLegend(['u', 'i'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: sni.fp, t0: 125, t1: 215, hi: ['u', 'i'], marks: [[186, 'second bump (i)']] });
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
    } },
    { text: 'A standard candle, computed in front of you. Every Type Ia peaks near the same true brightness, M ≈ −19.3. Here is what this one gives.', big: '−19.1', honest: 'No K-correction and no dust correction: ±0.3 mag.', run() {
      const pk = sni.peak, dpc = Ob.dist[sni.o], mu = 5 * Math.log10(dpc / 10);
      const rows = [['Peak brightness (r)', `${pk.diffMag.toFixed(2)} mag`], ['Distance from the redshift z = ' + (Ob.z[sni.o] || 0.09).toFixed(3), R.fmtPc(dpc)], ['Distance modulus 5 log₁₀(d / 10 pc)', mu.toFixed(2)], ['Absolute magnitude = peak − modulus', `<b>${pk.absMag.toFixed(2)}</b>`], ['Every SN Ia peaks near', '−19.3']];
      const b = stageSet('The standard candle, live', `<table class="calc">${rows.map((r) => `<tr hidden><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table><p class="takeaway">−19.1: a standard candle, and it checks out.</p>`);
      b.querySelectorAll('tr').forEach((tr, k) => later(() => { tr.hidden = false; }, K.reduceMotion ? 0 : 450 * (k + 1)));
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
    } },
    { text: 'The light left this galaxy before animals existed on Earth.', run() {
      const b = stageSet('Light-travel clock', '<canvas class="clock"></canvas>');
      stage = drawClock(b.querySelector('.clock'), [{ gyr: Ob.lookbackGyr[sni.o], label: `AT 2026ivl: light left ${R.fmtAgo(Ob.lookbackGyr[sni.o])} ago` }]);
      R.hooks.overlay = ringOverlay(sni.o, 'AT 2026ivl');
    } },
  ],
  core: [
    { text: 'One field, about the size of 15 full Moons. Gaia\'s stars here are sparse: we are looking straight out of the Galaxy.', run() {
      R.setPlay(false); R.setT(359); sel(-1); R.loadTiles(); R.zoomAnim(236.8, 42.1, 30, 1200);
      stageSet('COSMOS', `<p class="body">${fmtN(countReason(1))} objects of this sample sit inside this one deep field; ${fmtN(countReason(1, true))} of them have a distance.</p>`);
    } },
    { text: 'The pins drop: every COSMOS object at its own distance, joined to its place on the sky. Nearest, a red dwarf 118 pc away; deepest, a superluminous supernova 7 Gpc away.', run() {
      const b = stageSet('Core sample through COSMOS', '<canvas class="core"></canvas>');
      stage = coreSample(b.querySelector('.core'), 1, [['313875416235900942', 'red dwarf, 118 pc'], ['314003014107006318', 'SN 2026gzf, 151 Mpc'], ['170235219334922248', 'AT 2026ivl, 411 Mpc'], ['313928194567700757', 'AT 2025altn, 7.07 Gpc']]);
    } },
    { text: 'Side by side on the sky, nearly eight powers of ten apart in depth: a red dwarf 385 light years away, and an exploding star whose light left 7.9 billion years ago.', big: '8 decades in 3 degrees', honest: 'The lines join sky position to distance; they do not mean the objects are related.', run() {
      const b = stageSet('Core sample through COSMOS', '<canvas class="core"></canvas>');
      stage = coreSample(b.querySelector('.core'), 1, [['313875416235900942', 'red dwarf, 118 pc'], ['313928194567700757', 'AT 2025altn, 7.07 Gpc']]);
    } },
    { text: 'Why the clusters? These are the fields where Rubin stares night after night, not where the Universe is busier. Pick a field.', run() {
      const fields = [[1, 'COSMOS', 236.8, 42.1, 30], [2, 'EDFS', 256.1, -47.2, 18], [5, 'ELAIS-S1', 311.3, -72.9, 25], [3, 'ECDFS', 224.1, -54.5, 30], [4, 'XMM-LSS', 171.2, -58.8, 30]];
      const b = stageSet('Core samples through all five deep fields', `<div class="seg">${fields.map((f, k) => `<button class="btn${k ? '' : ' on'}" type="button" data-f="${k}">${f[1]} ${fmtN(countReason(f[0]))}</button>`).join('')}</div><canvas class="core"></canvas>`);
      const show = (k) => { const f = fields[k]; b.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', +x.dataset.f === k)); stage = coreSample(b.querySelector('.core'), f[0], []); R.zoomAnim(f[2], f[3], f[4], 900); };
      b.querySelectorAll('[data-f]').forEach((x) => x.addEventListener('click', () => show(+x.dataset.f)));
      show(0);
    } },
  ],
  beat: [
    { text: 'Hundreds of measurements of one star in the EDFS deep field, a few each night over 271 days. To the eye it is noise. Is there a rhythm?', run() {
      R.setPlay(false); R.zoomAnim(256.1, -47.2, 18, 1100); sel(cb.o); R.hooks.overlay = ringOverlay(cb.o, '');
      const b = stageSet('Contact binary candidate · forced photometry', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i', 'z'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: cb.fp });
    } },
    { text: 'Turn the dial. Drag along the strip (hold Shift or press Fine for slow control); the gold skyline shows how clean each fold is. Near a right answer the fold snaps.', big: '6 h 26 min', run() {
      R.hooks.overlay = ringOverlay(cb.o, '');
      const b = stageSet('The period dial', '<div class="dialhost"></div>');
      makeDial(b.querySelector('.dialhost'), { fp: cb.fp, periodogram: cb.periodogram, gaiaP: Ob.period[cb.o], span: cb.periodogram.spanDays, startLog: Math.log10(0.2), listen: true,
        ticks: [{ p: 0.268066, label: 'Rubin 0.268066' }, { p: Ob.period[cb.o], label: 'Gaia 0.26807', col: C().gold }],
        onSnap: (P) => (P < 0.2 ? 'Two dips that look the same. Try doubling.' : P > 0.25 && P < 0.29 ? 'Two stars so close they touch, orbiting every 6 h 26 min: one deep eclipse, one shallow.' : 'A fold, but not the cleanest. Keep turning.') });
    } },
    { text: 'How sure are we? Fitted carefully, Rubin alone finds 0.268066 d; Gaia (2014–17) says 0.268074 d, under a second per orbit apart. The coarse peak at 0.26834 d is a neighbouring alias, one cycle more across the season, and its fold is visibly worse.', honest: 'One season leaves aliases one cycle apart; Gaia’s longer baseline is what makes the choice certain.', run() {
      R.hooks.overlay = ringOverlay(cb.o, '');
      const b = stageSet('Both answers on the dial', '<div class="dialhost"></div>');
      const dl = makeDial(b.querySelector('.dialhost'), { fp: cb.fp, periodogram: cb.periodogram, gaiaP: Ob.period[cb.o], ticks: [{ p: 0.268066, label: 'Rubin 0.268066' }, { p: Ob.period[cb.o], label: 'Gaia 0.26807', col: C().gold }] });
      b.querySelector('[data-ans]').click();
    } },
    { text: 'Now a single star breathing in and out. Stars like this, RR Lyrae, all have about the same true brightness, so its faintness gives its distance: 38 kpc, out in the stellar halo.', run() {
      R.zoomAnim(256.1, -47.2, 18, 600); sel(rr.o); R.hooks.overlay = ringOverlay(rr.o, 'RR Lyrae, 38 kpc');
      const b = stageSet('The period dial · RRc pulsator', '<div class="dialhost"></div>');
      makeDial(b.querySelector('.dialhost'), { fp: rr.fp, periodogram: rr.periodogram, gaiaP: Ob.period[rr.o], startLog: Math.log10(0.3), listen: true,
        ticks: [{ p: 0.372112, label: 'Rubin 0.372112' }, { p: 0.37322, label: 'alias 0.37322' }, { p: Ob.period[rr.o], label: 'Gaia 0.37212', col: C().gold }],
        onSnap: (P) => (Math.abs(P - 0.3732) < 0.0005 ? 'Close! There is a near-twin period 0.0011 d away. With one season Rubin can\'t tell which; Gaia\'s longer baseline says 0.37212.' : Math.abs(P - 0.3721) < 0.0005 ? 'A single star breathing in and out every 8.9 hours.' : P > 0.6 ? 'Twice the period: every cycle drawn twice. Try halving.' : 'A fold, but not the cleanest. Keep turning.') });
    } },
  ],
  halo: [
    { text: 'The Milky Way\'s disk in gold, 15 kpc in radius, the Sun 8 kpc from the centre. Each point is one RR Lyrae star, placed in 3D by its own brightness. Drag to turn it.', run() {
      R.setPlay(false); R.resetView();
      const b = stageSet('The halo in 3D', '<canvas class="halo"></canvas><p class="note halonote">Hover a star to see its distance worked out.</p>');
      const hh = makeHalo(b.querySelector('.halo'), { onHover: (i) => { const n = b.querySelector('.halonote'); if (n) n.textContent = i >= 0 ? `${R.humanName(i)}: ${candleText(i) || R.fmtPc(Ob.dist[i])}` : 'Hover a star to see its distance worked out.'; } });
    } },
    { text: 'Each RR Lyrae shines with about the same power, M_G ≈ +0.6, so its faintness gives its distance. For our EDFS star: G = 18.55, M = 0.63 → 10^((18.55 − 0.63 + 5)/5) pc = 38.4 kpc.', run() {
      const b = stageSet('The halo in 3D', '<canvas class="halo"></canvas><p class="note halonote"></p>');
      const hh = makeHalo(b.querySelector('.halo'), { onHover: (i) => { b.querySelector('.halonote').textContent = i >= 0 ? `${R.humanName(i)}: ${candleText(i) || R.fmtPc(Ob.dist[i])}` : ''; } });
      b.querySelector('.halonote').textContent = candleText(rr.o); hh.hoverStar(rr.o);
    } },
    { text: 'The stars sit in a few wedges: these are the directions Rubin looked, mostly one patch near RA 333°, Dec −13° observed in July. Rubin\'s sample is a set of probes into the halo, not a census.', run() {
      const b = stageSet('The halo in 3D', '<canvas class="halo"></canvas>');
      const hh = makeHalo(b.querySelector('.halo'), { pitch: 0.12, yaw: 0.35 });
    } },
    { text: 'The edge is Gaia\'s, not Rubin\'s. Our candle uses Gaia\'s mean G, which stops near G ≈ 20.7, about 100 kpc. Rubin\'s single visits would reach about 600 kpc, past the Magellanic Clouds and the dwarf galaxies.', big: '6× deeper', run() {
      const b = stageSet('Where our distances stop, and what Rubin can reach', '<canvas class="halo"></canvas>');
      makeHalo(b.querySelector('.halo'), { spheres: true });
    } },
    { text: 'We looked for the Sagittarius stream in this patch and did not detect it: the distances fall off smoothly.', honest: 'Extinction is ignored (under 5% at these latitudes); the candle is good to about ±10%.', run() {
      const b = stageSet('The halo in 3D', '<canvas class="halo"></canvas>');
      makeHalo(b.querySelector('.halo'), {});
    } },
  ],
  old: [
    { text: 'The light-travel clock spins back: through the Sun\'s birth 4.57 billion years ago, to 7.9 billion years. When this star exploded, the Sun did not exist yet.', run() {
      R.setPlay(false); R.zoomAnim(Ob.l[slsn.o], Ob.b[slsn.o], 30, 1100); sel(slsn.o); R.hooks.overlay = ringOverlay(slsn.o, 'AT 2025altn');
      const b = stageSet('Light-travel clock', '<canvas class="clock"></canvas>');
      const target = Ob.lookbackGyr[slsn.o], t0 = performance.now();
      let cur = 0;
      stage = drawClock(b.querySelector('.clock'), [{ gyr: () => cur, label: 'AT 2025altn' }]);
      loop((ts) => { const p = K.reduceMotion ? 1 : Math.min(1, (ts - t0) / DUR.count); cur = 1e-9 + target * ease.io(p); stage.draw(stage); });
    } },
    { text: 'Time dilation, visible. AT 2025altn rises over about 90 days in i. Its clock runs 2.06× slow as seen from here (1 + z): the 90-day rise was about 44 days at home.', honest: 'Peak i = 21.16 gives M ≈ −23.1 with no K-correction: ±0.3 mag at best, worse at this redshift.', run() {
      R.hooks.overlay = ringOverlay(slsn.o, 'AT 2025altn');
      const b = stageSet('AT 2025altn · superluminous supernova at z = 1.056', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i', 'z'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: slsn.fp, hi: ['i'], marks: [[41, 'rise starts'], [135, 'peak']], after: (g, s, X, Y) => { const y = 34; g.strokeStyle = C().gold; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(41), y); g.lineTo(X(135), y); g.stroke(); annotate(g, '≈ 90 days here = 44 days there', (X(41) + X(135)) / 2, y - 4, { size: 16, color: C().gold }); } });
    } },
    { text: 'A quasar at z = 2.96: a black hole a billion times the Sun\'s mass, feeding. Its total brightness wanders by about 10–14% over the season. We see it as it was when the Universe was 2.2 billion years old.', run() {
      R.zoomAnim(Ob.l[qso.o], Ob.b[qso.o], 12, 1000); sel(qso.o); R.hooks.overlay = ringOverlay(qso.o, 'quasar, z = 2.96');
      const b = stageSet('Quasar 170028526654193761 · total flux', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: qso.sources, mode: 'sci', hi: ['g', 'r', 'i'] });
    } },
    { text: 'And the oldest light in this sample: a quasar at z = 4.57, as it was 12.2 billion years ago, when the Universe was 1.3 billion years old. Rubin saw it only 5 times: we saw it flicker, not a light curve.', big: '12.2 billion years', honest: `${fmtN(countBeforeSun())} objects here have spectroscopic redshifts that put their light before the Sun's birth; the rest of the far objects (photo-z) are estimates.`, run() {
      R.zoomAnim(Ob.l[qfar.o], Ob.b[qfar.o], 12, 1000); sel(qfar.o); R.hooks.overlay = ringOverlay(qfar.o, 'quasar, z = 4.57');
      const b = stageSet('Light-travel clock', '<canvas class="clock"></canvas>');
      stage = drawClock(b.querySelector('.clock'), [{ gyr: Ob.lookbackGyr[slsn.o], label: '' }, { gyr: Ob.lookbackGyr[qso.o], label: '' }, { gyr: Ob.lookbackGyr[qfar.o], label: 'quasar z = 4.57: 12.2 billion years' }]);
    } },
  ],
  cant: [
    { text: 'Rubin is in Chile. North of dec +30° the sky never rises high enough, about a quarter of it. No object in this sample lies north of dec +9.8°.', run() {
      R.setPlay(false); R.setT(359); sel(-1); R.resetView();
      R.hooks.staticOverlay = hatchNorth; R.invalidateSky(); R.redraw();
      stageSet('The northern sky', '<p class="body">The hatched region is everything north of declination +30°, drawn from the map\'s own coordinates.</p>');
    } },
    { text: 'Daylight, weather and engineering leave gaps: 29 Jan–17 Feb, 10 Mar–5 Apr, and 14 Jul–30 Oct. SN 2026gzf exploded during one. Its last measurement before was 24 Feb, at zero; the next, 6 April, already 571,000 nJy. We have the fall, not the rise.', run() {
      R.zoomAnim(Ob.l[gap.o], Ob.b[gap.o], 30, 1000); sel(gap.o); R.hooks.overlay = ringOverlay(gap.o, 'SN 2026gzf');
      const b = stageSet('SN 2026gzf · forced photometry', `<canvas class="lc"></canvas>${bandLegend(['g', 'r', 'i', 'z'])}`);
      stage = lightCurve(b.querySelector('.lc'), { src: gap.fp, t0: 80, t1: 220, shade: [[95.5, 136, 'not looking']] });
    } },
    { text: 'Dust. Showing only explosions and black holes: none within 10° of the Galactic plane. The Milky Way\'s dust hides the Universe behind it.', run() {
      R.resetView(); sel(-1);
      const st = R.state; st.groupsOn = new Set([2, 3]); st.pred = null; R.applyFilter(); R.setT(359); R.redraw();
      stageSet('Dust', '<p class="body">Extragalactic objects in this sample within |b| &lt; 10°: <b>0</b>. Part of that is where Rubin pointed; part is the dust.</p>');
    } },
    { text: 'Faintness. For each kind of object, how far a single Rubin visit can see it, against where our objects actually are.', honest: 'Ignoring K-corrections and dust: an order-of-magnitude horizon, not a survey limit.', run() {
      const b = stageSet('The horizon', '<canvas class="horizon"></canvas>');
      stage = drawHorizon(b.querySelector('.horizon'));
    } },
    { text: 'Labels can be wrong. SDSS spectra say 54 of our Fink "supernova candidates" are quasars, for example this one, tagged most_likely_sn, SDSS quasar at z = 2.82. Classifiers guess from light curves; spectra decide.', big: "54 'supernovae' were quasars", honest: 'SDSS covers only the equatorial fields; EDFS, ELAIS-S1 and ECDFS have no SDSS spectra, so 54 is a lower bound.', run() {
      const i = oid('171141216039075877');
      R.zoomAnim(Ob.l[i], Ob.b[i], 20, 1000); sel(i); R.hooks.overlay = ringOverlay(i, 'a "supernova" that is a quasar');
      stageSet('Spectra decide', `<table class="calc"><tr><td>Fink tag</td><td>most_likely_sn</td></tr><tr><td>SDSS DR16 spectrum</td><td>quasar, z = ${(Ob.z[i] || 2.82).toFixed(2)}</td></tr><tr><td>Light left it</td><td>${R.fmtAgo(Ob.lookbackGyr[i])} ago</td></tr><tr><td>"Supernova candidates" that SDSS calls quasars</td><td><b>${countQsoSn()}</b></td></tr></table>`);
    } },
  ],
};
function countReason(r, withD) { let n = 0; for (let i = 0; i < R.N; i++) if (Ob.reason[i] === r && (!withD || (Ob.dist[i] != null && Ob.distMethod[i] >= 0))) n++; return n; }
function countBeforeSun() { let n = 0; for (let i = 0; i < R.N; i++) if ((Ob.zSrc[i] === 'tns' || Ob.zSrc[i] === 'sdss') && Ob.lookbackGyr[i] > 4.57) n++; return n; }
function countQsoSn() { let n = 0; for (let i = 0; i < R.N; i++) if (Ob.sdssClass[i] === 'QSO' && R.FKEY[Ob.fam[i]] === 'sncand') n++; return n; }
function hatchNorth(g, s, f) {
  const lg = R.lanGrid;
  if (!lg) return;
  const m = document.createElement('canvas'); m.width = lg.LW; m.height = lg.LH;
  const mg = m.getContext('2d'), im = mg.createImageData(lg.LW, lg.LH), sin30 = 0.5;
  for (let k = 0; k < lg.LW * lg.LH; k++) { const z = lg.vec[k * 3 + 2]; if (z === z && z > sin30) im.data[k * 4 + 3] = 255; }
  mg.putImageData(im, 0, 0);
  const t = document.createElement('canvas'); t.width = Math.round(s.w); t.height = Math.round(s.h);
  const tg = t.getContext('2d');
  tg.fillStyle = K.hatch(tg, C().gold, 6, 45, 1.2); tg.fillRect(0, 0, s.w, s.h);
  tg.globalCompositeOperation = 'destination-in'; tg.imageSmoothingEnabled = true; tg.drawImage(m, 0, 0, lg.LW * 4, lg.LH * 4);
  g.globalAlpha = 0.6; g.drawImage(t, 0, 0, s.w, s.h); g.globalAlpha = 1;
  annotate(g, 'never high enough from Chile', s.w * 0.75, s.h * 0.2, { size: 20, color: C().gold });
}

function buildUi() {
  const root = $('#starsRoot');
  $('#chapters').insertAdjacentHTML('beforeend', CHAPTERS.map((c) => `<button type="button" class="btn" data-c="${c.key}" title="${esc(c.hook)}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.icon]}</svg>${esc(c.short)}</button>`).join(''));
  root.insertAdjacentHTML('afterbegin', `
<div id="storyView" class="storyview" hidden>
    <aside class="panel narr" aria-labelledby="h-narr">
      <div class="phead"><div class="pbar"><h2 id="h-narr"></h2></div></div>
      <p class="beatno" id="beatNo"></p>
      <p class="narrtext" id="narrText" aria-live="polite"></p>
      <p class="big" id="narrBig"></p>
      <p class="note" id="narrHonest"></p>
      <ol class="beats" id="beatList" aria-label="Steps in this chapter"></ol>
      <div class="narrbtns"><button class="btn" type="button" id="bBack">Back</button><button class="btn play" type="button" id="bNext">Next</button></div>
      <button class="btn ghostlink" type="button" id="bExit">Back to the sky</button>
    </aside>
    <div class="storyright">
      <div id="slotMap"></div>
      <section class="panel stage" aria-labelledby="h-stage"><div class="phead"><div class="pbar"><h2 id="h-stage"></h2></div></div><div id="stageBody"></div></section>
    </div>
  </div>`);
  K.panelControls($('#storyView'));
  $('#chapters').querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => (b.dataset.c === 'free' ? exitStory() : openChapter(b.dataset.c))));
  $('#bNext').addEventListener('click', () => go(beat + 1));
  $('#bBack').addEventListener('click', () => go(beat - 1));
  $('#bExit').addEventListener('click', exitStory);
  document.addEventListener('keydown', (e) => {
    if (!chap || !document.body.classList.contains('story')) return;
    const tg = e.target instanceof Element ? e.target : document.body;
    if (tg.closest('input, select, textarea, .dstrip')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(beat + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(beat - 1); }
    if (e.key === 'Escape') exitStory();
  }, true);
  let sx0 = null;
  const narr = $('#storyView .narr');
  narr.addEventListener('touchstart', (e) => { sx0 = e.touches[0].clientX; }, { passive: true });
  narr.addEventListener('touchend', (e) => { if (sx0 == null) return; const dx = e.changedTouches[0].clientX - sx0; if (Math.abs(dx) > 60) go(beat + (dx < 0 ? 1 : -1)); sx0 = null; });
}
function openChapter(key) {
  stopAll(); resetHooks(); R.state.sel = -1;
  chap = CHAPTERS.find((c) => c.key === key);
  if (!document.body.classList.contains('story')) {
    savedPos = { sky: [$('.s-sky').parentNode, $('.s-sky').nextSibling] };
    $('#slotMap').appendChild($('.s-sky'));
    document.body.classList.add('story');
    $('#storyView').hidden = false;
  }
  $('#chapters').querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === key));
  $('#h-narr').textContent = `${chap.n} · ${chap.title}`;
  K.setUrl({ chapter: key });
  go(0, true);
  $('#storyView').scrollIntoView({ block: 'start', behavior: 'auto' });
}
function go(k, force) {
  const list = BEATS[chap.key];
  if (k < 0) return;
  if (k >= list.length) { const next = CHAPTERS[CHAPTERS.indexOf(chap) + 1]; if (next && next.key !== 'free') openChapter(next.key); else exitStory(); return; }
  if (k === beat && !force) return;
  stopAll(); resetHooks(); stage = null;
  beat = k;
  const b = list[k];
  $('#beatNo').textContent = `Step ${k + 1} of ${list.length}`;
  $('#narrText').textContent = b.text;
  $('#narrBig').textContent = b.big || (k === list.length - 1 ? chap.big : '');
  $('#narrHonest').textContent = b.honest ? 'How sure are we? ' + b.honest : '';
  $('#bBack').disabled = k === 0;
  $('#beatList').innerHTML = list.map((x, j) => `<li class="${j === k ? 'on' : j < k ? 'done' : ''}"><button type="button" data-b="${j}"${j === k ? ' aria-current="step"' : ''}><span class="bn">${j + 1}</span><span>${esc(x.text.split(/(?<=[.:!?])\s/)[0].slice(0, 90))}</span></button></li>`).join('');
  $('#beatList').querySelectorAll('[data-b]').forEach((x) => x.addEventListener('click', () => go(+x.dataset.b)));
  $('#bNext').textContent = k === list.length - 1 ? 'Next chapter' : 'Next';
  b.run();
  R.redraw();
}
function exitStory() {
  stopAll(); resetHooks();
  if (savedPos) {
    savedPos.sky[0].insertBefore($('.s-sky'), savedPos.sky[1]);
    savedPos = null;
  }
  document.body.classList.remove('story');
  $('#storyView').hidden = true;
  chap = null;
  $('#chapters').querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === 'free'));
  K.setUrl({ chapter: null });
  R.resetView(); R.renderCard(); R.redraw();
}

function onEnter(params) {
  if (!$('#storyView')) buildUi();
  const ch = params.get('chapter');
  if (ch && BEATS[ch]) { openChapter(ch); const b = +params.get('beat'); if (b > 0) go(b); return true; }
  $('#chapters').querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === 'free'));
  return false;
}
function cardToys(body, i) {
  if (Ob.period[i] && (Ob.lc[i] >= 0)) {
    const story = Object.values(ST).find((x) => x.o === i);
    const src = story ? story.fp : S.lcs[Ob.lc[i]];
    const host = document.createElement('div');
    host.innerHTML = '<h4>Period dial</h4><p class="cap">Drag along the strip to fold the light curve on any period; it snaps at Gaia\'s.</p><div class="dialhost"></div>';
    body.appendChild(host);
    makeDial(host.querySelector('.dialhost'), { fp: src, periodogram: story && story.periodogram, gaiaP: Ob.period[i], startLog: Math.log10(Ob.period[i]) - 0.15, listen: true, ticks: [{ p: Ob.period[i], label: 'Gaia', col: C().gold }] });
  }
  if (Ob.lookbackGyr && Ob.lookbackGyr[i] != null) {
    const host = document.createElement('div');
    host.innerHTML = '<h4>Light-travel clock</h4><canvas class="clock sm"></canvas>';
    body.appendChild(host);
    const g = Ob.lookbackGyr[i], photo = Ob.zSrc[i] === 'photo';
    drawClock(host.querySelector('.clock'), [{ gyr: g, label: `light left ${R.fmtAgo(g)} ago${photo ? ' (photo-z: rough)' : ''}`, lo: photo ? g * 0.8 : null, hi: photo ? Math.min(13.4, g * 1.2) : null }]);
  }
}
ext.story = K.ns.story = { onEnter, cardToys, openChapter, exitStory, go, get chapter() { return chap && chap.key; } };
