import {
  $, C, DEG, BANDS, MON, ns, perf, pushPerf, reduceMotion, mjdDate, fmtDate, fmtShort, dateMjd, nightMjd, fmtN, clamp, norm, esc,
  rng, seedOf, pencilLine, pencilCircle, hatch, sketchBar, setupCanvas, font, annotate, text, showTip, hideTip, setUrl, setCollapsed,
  fullscreenPanel, onTheme, loadJson, withTokensOf,
} from './kit.js';
import { createSync } from './sync.js';
import { register as registerData, refresh as refreshData, fmtBytes } from './datapanel.js';

const R = await loadJson('data/asteroids.json?v=2026-11-22');
const sync = createSync(R);
const MJD_OFF = 60000;
const K = 0.01720209895;
const CLASS = {
  NEO: { name: 'Near-Earth asteroid', short: 'NEO', tok: '--c-neo', desc: 'perihelion q < 1.3 AU' },
  MC: { name: 'Mars-crosser', short: 'Mars-crosser', tok: '--c-mc', desc: '1.3 < q < 1.666 AU' },
  HUN: { name: 'Hungaria', short: 'Hungaria', tok: '--c-hun', desc: 'a 1.78–2.06 AU, e < 0.18, i > 16°' },
  MBA: { name: 'Main-belt asteroid', short: 'Main belt', tok: '--c-mba', desc: 'a 2.06–3.28 AU' },
  CYB: { name: 'Cybele', short: 'Cybele', tok: '--c-cyb', desc: 'a 3.28–3.7 AU' },
  HIL: { name: 'Hilda (3:2 with Jupiter)', short: 'Hilda', tok: '--c-hil', desc: 'a 3.7–4.2 AU, e < 0.3' },
  TRO: { name: 'Jupiter Trojan (1:1)', short: 'Jupiter Trojan', tok: '--c-tro', desc: 'a 5.05–5.35 AU' },
  OTH: { name: 'Other', short: 'Other', tok: '--c-oth', desc: 'outside the groups above' },
};
const CLASS_ORDER = ['MBA', 'NEO', 'MC', 'HUN', 'CYB', 'HIL', 'TRO', 'OTH'];
const RES = [
  { a: 2.065, l: '4:1' }, { a: 2.502, l: '3:1' }, { a: 2.825, l: '5:2' }, { a: 2.958, l: '7:3' },
  { a: 3.279, l: '2:1' }, { a: 3.972, l: '3:2' }, { a: 5.203, l: '1:1' },
];
const PLANETS = {
  Mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  Venus: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  Earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  Mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  Jupiter: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  Saturn: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
};

function sizeUi() {
  const a = state.dLo / 10, b = state.dHi / 10;
  const dual = $('#dual');
  if (!dual) return;
  dual.style.setProperty('--a', a + '%'); dual.style.setProperty('--b', b + '%');
  const dLo = 10 ** sliderToLg(state.dLo), dHi = 10 ** sliderToLg(state.dHi);
  const fk = (d) => d >= 100 ? Math.round(d) + '' : d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d.toFixed(2);
  const hOf = (d) => 5 * Math.log10(1329 / Math.sqrt(0.15) / d);
  $('#sizeVal').innerHTML = `${state.dLo === 0 ? '≤ ' : ''}${fk(dLo)} – ${state.dHi === 1000 ? '≥ ' : ''}${fk(dHi)} km <small>· H ${hOf(dLo).toFixed(1)} – ${hOf(dHi).toFixed(1)} at p = 0.15</small>`;
  const nNo = O.filter((o) => o.lgD === null).length;
  $('#sizeCnt').textContent = state.filter ? `showing ${fmtN(nVis)} of ${fmtN(N)}${sizeActive() && nNo ? ` · ${nNo} without a size hidden` : ''}` : `all ${fmtN(N)} shown`;
  $('#sizeReset').hidden = !sizeActive();
  $('#dMin').value = state.dLo; $('#dMax').value = state.dHi;
  $('#dMin').setAttribute('aria-valuetext', fk(dLo) + ' km'); $('#dMax').setAttribute('aria-valuetext', fk(dHi) + ' km');
  drawSizeHist();
}
function drawSizeHist() {
  const cv = $('#sizeHist');
  if (!cv || !C.gold) return;
  const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  if (!r.width) return;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nb = 48, h = new Array(nb).fill(0);
  for (const o of O) if (o.lgD !== null) h[Math.max(0, Math.min(nb - 1, Math.floor((o.lgD - size.lo) / (size.hi - size.lo) * nb)))]++;
  const mx = Math.max(1, ...h), bw = r.width / nb;
  for (let k = 0; k < nb; k++) {
    if (!h[k]) continue;
    const v = (k + 0.5) / nb * 1000, on = v >= state.dLo && v <= state.dHi;
    g.fillStyle = on ? C.goldSoft : C.grid;
    const hh = Math.max(1, Math.sqrt(h[k] / mx) * r.height);
    g.fillRect(k * bw + 0.5, r.height - hh, bw - 1, hh);
  }
}
let sizeTimer = 0;
function onSize(which) {
  const lo = +$('#dMin').value, hi = +$('#dMax').value;
  if (which === 'lo') state.dLo = Math.min(lo, state.dHi - 10); else state.dHi = Math.max(hi, state.dLo + 10);
  sizeUi();
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => { applyFilters(); if (state.sel && state.filter && !state.filter(state.sel)) select(null); else { renderCard(); redrawAll(); } }, 60);
}

const spriteCache = new Map();
const PLANET_R = { Mercury: 4.2, Venus: 6.2, Earth: 6.8, Mars: 5.2, Jupiter: 12, Saturn: 9.5 };
const PLANET_LOOK = {
  Sun: ['--sun'], Mercury: ['#b8b2a7'], Venus: ['#e8d6a8'], Earth: ['#a8c8e0'], Mars: ['#e3a99a'], Jupiter: ['#e8c9a0'], Saturn: ['#ebddb0'],
};
function planetSprite(name, rad, dpr) {
  const key = [name, rad, dpr, C.dark].join('|');
  let sp = spriteCache.get(key);
  if (sp) return sp;
  const pad = name === 'Saturn' ? rad * 1.5 : name === 'Sun' ? rad * 1.6 : rad * 1.3 + 3;
  const size = Math.ceil((rad + pad) * 2 + 4);
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2, cy = size / 2;
  const col = name === 'Sun' ? '#f6d98b' : PLANET_LOOK[name][0];
  const ink = C.dark ? 'rgba(236, 230, 214, 0.85)' : '#4a4a4a';
  const glow = g.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad + pad);
  glow.addColorStop(0, name === 'Sun' ? 'rgba(246, 217, 139, 0.55)' : col + (C.dark ? '66' : '33'));
  glow.addColorStop(1, name === 'Sun' ? 'rgba(242, 184, 128, 0)' : col + '00');
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, rad + pad, 0, 6.283); g.fill();
  if (name === 'Sun') {
    const r = rng(77);
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * 6.283 + r() * 0.2, r1 = rad + 2, r2 = rad + 4 + r() * pad * 0.7;
      g.strokeStyle = C.sunrays; g.lineWidth = 1.3; g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
    }
  }
  g.save(); g.beginPath(); g.arc(cx, cy, rad, 0, 6.283); g.clip();
  g.globalAlpha = 0.55; g.fillStyle = col; g.fillRect(0, 0, size, size); g.globalAlpha = 1;
  g.fillStyle = hatch(g, col, 2, 35, 1.4); g.fillRect(0, 0, size, size);
  if (name === 'Jupiter') { g.fillStyle = hatch(g, '#c99a74', 2.2, 4, 1.2); g.fillRect(cx - rad, cy - rad * 0.35, rad * 2, rad * 0.25); g.fillRect(cx - rad, cy + rad * 0.15, rad * 2, rad * 0.22); }
  if (name === 'Earth') { g.fillStyle = hatch(g, '#8fb583', 1.8, 60, 1.2); g.beginPath(); g.ellipse(cx - rad * 0.25, cy - rad * 0.1, rad * 0.45, rad * 0.3, 0.6, 0, 6.283); g.fill(); }
  g.fillStyle = 'rgba(40,40,60,0.22)'; g.beginPath(); g.arc(cx + rad * 0.45, cy + rad * 0.35, rad, 0, 6.283); g.fill();
  g.restore();
  if (name === 'Saturn') {
    g.save(); g.translate(cx, cy); g.rotate(-0.35); g.scale(1, 0.34);
    g.strokeStyle = '#c9b585'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, rad * 1.9, 0, 6.283); g.stroke();
    g.strokeStyle = ink; g.lineWidth = 0.9; g.beginPath(); g.arc(0, 0, rad * 2.1, 0, 6.283); g.stroke();
    g.restore();
  }
  pencilCircle(g, cx, cy, rad, { color: ink, width: rad > 5 ? 1 : 0.8, wob: 0.05 });
  sp = { c, size };
  spriteCache.set(key, sp);
  return sp;
}
function drawSprite(g, name, x, y, rad) {
  const sp = planetSprite(name, rad, mapS.dpr);
  g.drawImage(sp.c, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
}

const ALBEDO = { HUN: 0.4, CYB: 0.06, HIL: 0.06, TRO: 0.06 };
const albedoOf = (cls) => ALBEDO[cls] || 0.15;
function sizeOf(o) {
  const hs = Object.values(o.H || {});
  const H = o.H && o.H.r !== undefined ? o.H.r : hs.length ? hs.sort((x, y) => x - y)[hs.length >> 1] : null;
  if (H === null || !isFinite(H) || H < 0 || H > 35) return [null, null];
  return [H, 1329 / Math.sqrt(albedoOf(o.c)) * Math.pow(10, -H / 5)];
}
function mkObj(o, idx) {
  const [a, e, inc, node, peri, M, ep] = o.el;
  const [Hs, D] = sizeOf(o);
  const w = peri * DEG, W = node * DEG, i = inc * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cW = Math.cos(W), sW = Math.sin(W), ci = Math.cos(i);
  return {
    idx, name: o.n, des: o.des, cls: o.c, a, e, inc, node, peri, M0: M * DEG, ep, q: a * (1 - e), Q: a * (1 + e),
    n: K / Math.pow(a, 1.5), b: a * Math.sqrt(1 - e * e),
    Px: cw * cW - sw * sW * ci, Py: cw * sW + sw * cW * ci,
    Qx: -sw * cW - cw * sW * ci, Qy: -sw * sW + cw * cW * ci,
    det: o.det, H: o.H, sf: o.sf, col: o.col, nn: o.nn, key: norm(o.n), dkey: o.des ? norm(o.des) : '',
    Hs, D, lgD: D ? Math.log10(D) : null,
  };
}
const O = [], byName = new Map(), flat = [], nightDet = new Map();
let N = 0, flatT = new Float64Array(0), META = R.meta, posX = new Float32Array(0), posY = new Float32Array(0);
function buildData() {
  O.length = 0;
  R.objs.forEach((o, idx) => O.push(mkObj(o, idx)));
  N = O.length;
  byName.clear();
  O.forEach((o) => { byName.set(o.key, o); if (o.dkey) byName.set(o.dkey, o); });
  flat.length = 0;
  O.forEach((o) => o.det.forEach((d) => { if (d[6] !== null) flat.push([d[0] + MJD_OFF, d[6], d[7], o.idx, d[1]]); }));
  flat.sort((p, q) => p[0] - q[0]);
  flatT = Float64Array.from(flat, (d) => d[0]);
  nightDet.clear();
  O.forEach((o) => o.det.forEach((d) => { const k = Math.floor(d[0] + MJD_OFF); nightDet.set(k, (nightDet.get(k) || 0) + 1); }));
  META = R.meta;
  posX = new Float32Array(N); posY = new Float32Array(N);
}
buildData();

function solveE(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-9) break;
  }
  return E;
}
function posAt(o, mjd, out) {
  let M = (o.M0 + o.n * (mjd - o.ep)) % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  const E = solveE(M, o.e);
  const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
  out[0] = xp * o.Px + yp * o.Qx;
  out[1] = xp * o.Py + yp * o.Qy;
  return out;
}
function planetAt(name, mjd) {
  const T = (mjd - 51544.5) / 36525;
  const [a0, da, e0, de, I0, dI, L0, dL, w0, dw, O0, dO] = PLANETS[name];
  const a = a0 + da * T, e = e0 + de * T, I = (I0 + dI * T) * DEG, L = L0 + dL * T, wb = w0 + dw * T, Om = (O0 + dO * T) * DEG;
  const om = wb * DEG - Om;
  let M = ((L - wb) % 360 + 540) % 360 - 180;
  const E = solveE(M * DEG, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    a, e, om, Om, I,
  ];
}

function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

const T0 = dateMjd(2026, 0, 1), T1 = dateMjd(2027, 11, 31);
const state = {
  t: Math.floor(META.tmax) + 0.5, playing: false, speed: 15, viewR: 3.9, sel: null, hover: null,
  filter: null, pfilter: null, preset: 'all', yAxis: 'e', dLo: 0, dHi: 1000,
};
let vis = new Uint8Array(0), nightDetF = null, nVis = 0;
const size = { lo: -1, hi: 3 };
const sliderToLg = (v) => size.lo + v / 1000 * (size.hi - size.lo);
const sizeActive = () => state.dLo > 0 || state.dHi < 1000;
function sizeRange() {
  const lg = O.map((o) => o.lgD).filter((x) => x !== null).sort((a, b) => a - b);
  if (!lg.length) return;
  size.lo = Math.floor(lg[Math.floor(lg.length * 0.005)] * 10) / 10; size.hi = Math.ceil(lg[Math.min(lg.length - 1, Math.floor(lg.length * 0.995))] * 10) / 10;
}
function applyFilters() {
  vis = new Uint8Array(N);
  const sz = sizeActive(), lo = state.dLo === 0 ? -Infinity : sliderToLg(state.dLo), hi = state.dHi === 1000 ? Infinity : sliderToLg(state.dHi);
  nVis = 0;
  for (let k = 0; k < N; k++) {
    const o = O[k];
    let ok = !state.pfilter || state.pfilter(o);
    if (ok && sz) ok = o.lgD !== null && o.lgD >= lo - 1e-9 && o.lgD <= hi + 1e-9;
    vis[k] = ok ? 1 : 0;
    nVis += vis[k];
  }
  const any = !!state.pfilter || sz;
  state.filter = any ? (o) => vis[o.idx] === 1 : null;
  if (any) {
    nightDetF = new Map();
    O.forEach((o) => { if (vis[o.idx]) o.det.forEach((d) => { const k = Math.floor(d[0] + MJD_OFF); nightDetF.set(k, (nightDetF.get(k) || 0) + 1); }); });
  } else nightDetF = null;
  staticKey = '';
  sizeUi();
}

function inFilter(o) { return !state.filter || state.filter(o); }


function tipFor(o) {
  return `<b>${o.name}</b>${o.des ? ' (' + o.des + ')' : ''}<br>${CLASS[o.cls].short} · a ${o.a.toFixed(2)} AU · e ${o.e.toFixed(2)} · i ${o.inc.toFixed(1)}°<br>${o.det.length} detections on ${o.nn} nights`;
}

$('#map').dataset.lowdpr = '';
const mapS = setupCanvas($('#map'), drawMap);
let staticLayer = null, staticKey = '';
const planetNow = {};

function mapScale(s) { return Math.min(s.w, s.h) / 2 / state.viewR * 0.94; }

function buildStatic(s) {
  const key = [s.w, s.h, s.dpr, state.viewR, state.preset, state.sel ? state.sel.idx : -1, C.dark].join('|');
  if (key === staticKey && staticLayer) return;
  staticKey = key;
  const cv = staticLayer || document.createElement('canvas');
  cv.width = Math.round(s.w * s.dpr); cv.height = Math.round(s.h * s.dpr);
  const g = cv.getContext('2d');
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  g.clearRect(0, 0, s.w, s.h);
  const sc = mapScale(s), cx = s.w / 2, cy = s.h / 2;
  const members = O.filter(inFilter);
  g.lineWidth = 1;
  g.strokeStyle = C.orbit;
  g.globalAlpha = members.length > 400 ? clamp(500 / members.length, 0.2, 1) : 1;
  g.beginPath();
  const steps = 72;
  for (const o of members) {
    for (let k = 0; k <= steps; k++) {
      const E = (k / steps) * 2 * Math.PI;
      const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
      const x = cx + (xp * o.Px + yp * o.Qx) * sc, y = cy - (xp * o.Py + yp * o.Qy) * sc;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.stroke();
  if (members.length < 60) {
    g.globalAlpha = 1; g.lineWidth = 1;
    g.strokeStyle = C.porbit; g.stroke();
  }
  g.globalAlpha = 1;
  const ellipse = (pt, n, seed, amp, color, width, passes) => {
    const r = rng(seed);
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
    for (let pass = 0; pass < passes; pass++) {
      g.globalAlpha = pass === 0 ? 1 : 0.45;
      const ph = r() * 6.283, k1 = (r() - 0.5) * amp, k2 = (r() - 0.5) * amp, over = 0.06 + r() * 0.05;
      g.beginPath();
      for (let k = 0; k <= n; k++) {
        const E = ph + k / n * (2 * Math.PI + over), f = 1 + k1 * Math.sin(2 * E) + k2 * Math.cos(3 * E);
        const [x, y] = pt(E);
        const X = cx + x * sc * f, Y = cy - y * sc * f;
        if (k === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  for (const p in PLANETS) {
    const [, , a, e, om, Om, I] = planetAt(p, 61359);
    const b = a * Math.sqrt(1 - e * e);
    const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I);
    ellipse((E) => {
      const xp = a * (Math.cos(E) - e), yp = b * Math.sin(E);
      return [(co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp, (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp];
    }, 160, seedOf(a, 3), 0.006, C.porbit, 1, 2);
  }
  if (state.sel) {
    const o = state.sel;
    ellipse((E) => {
      const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
      return [xp * o.Px + yp * o.Qx, xp * o.Py + yp * o.Qy];
    }, 240, seedOf(o.idx, 5), 0.004, C.hi, 1.5, 2);
    g.fillStyle = C.hi;
    for (const d of o.det) if (d[6] !== null) { g.beginPath(); g.arc(cx + d[6] * sc, cy - d[7] * sc, 2.2, 0, 7); g.fill(); }
  }
  const au = niceAU(state.viewR);
  const x0 = 16, y0 = 30;
  pencilLine(g, x0, y0, x0 + au * sc, y0, { color: C.graphite, width: 1.4 });
  pencilLine(g, x0, y0 - 5, x0, y0 + 1, { color: C.graphite, width: 1.2, passes: 1 });
  pencilLine(g, x0 + au * sc, y0 - 5, x0 + au * sc, y0 + 1, { color: C.graphite, width: 1.2, passes: 1 });
  text(g, `${au} AU`, x0 + au * sc / 2, y0 - 8, { size: 12.5, weight: 500, color: C.ink2, align: 'center', halo: true });
  text(g, 'Vernal equinox direction →', s.w - 16, s.h - 14, { size: 12, color: C.ink3, align: 'right', halo: true });
  staticLayer = cv;
}
function niceAU(r) { return r < 2.5 ? 0.5 : r < 5 ? 1 : 2; }

function drawMap(s) {
  if (!s.w) return;
  const t0 = performance.now();
  buildStatic(s);
  const g = s.ctx, sc = mapScale(s), cx = s.w / 2, cy = s.h / 2;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(staticLayer, 0, 0, s.w, s.h);
  const tmp = [0, 0];
  for (let k = 0; k < N; k++) { posAt(O[k], state.t, tmp); posX[k] = cx + tmp[0] * sc; posY[k] = cy - tmp[1] * sc; }
  for (const p in PLANETS) planetNow[p] = planetAt(p, state.t);
  const E = planetNow.Earth;
  const ex = cx + E[0] * sc, ey = cy - E[1] * sc;

  const win = 2;
  const i0 = lowerBound(flatT, state.t - win), i1 = lowerBound(flatT, state.t + win);
  if (i1 > i0) {
    g.strokeStyle = C.det; g.globalAlpha = clamp(6 / (i1 - i0), 0.03, 0.25); g.lineWidth = 1; g.beginPath();
    for (let k = i0; k < i1; k++) { g.moveTo(ex, ey); g.lineTo(cx + flat[k][1] * sc, cy - flat[k][2] * sc); }
    g.stroke(); g.globalAlpha = 1;
  }

  const filtered = !!state.filter;
  for (const c of CLASS_ORDER) {
    g.fillStyle = C.cls[c];
    const big = c !== 'MBA';
    const r = big ? 2.6 : 1.6;
    g.globalAlpha = filtered ? 0.18 : (big ? 1 : 0.85);
    g.beginPath();
    for (let k = 0; k < N; k++) {
      const o = O[k];
      if (o.cls !== c || (filtered && state.filter(o))) continue;
      if (big) { g.moveTo(posX[k] + r, posY[k]); g.arc(posX[k], posY[k], r, 0, 6.2832); } else g.rect(posX[k] - 1.4, posY[k] - 1.4, 2.8, 2.8);
    }
    g.fill();
    if (filtered) {
      g.globalAlpha = 1; g.beginPath();
      for (let k = 0; k < N; k++) {
        const o = O[k];
        if (o.cls !== c || !state.filter(o)) continue;
        g.moveTo(posX[k] + 3.4, posY[k]); g.arc(posX[k], posY[k], 3.4, 0, 6.2832);
      }
      g.fill();
    }
  }
  g.globalAlpha = 1;
  if (i1 > i0) {
    g.strokeStyle = C.det; g.lineWidth = 1.2; g.globalAlpha = 0.6; g.beginPath();
    for (let k = i0; k < i1; k++) {
      const x = cx + flat[k][1] * sc, y = cy - flat[k][2] * sc;
      g.moveTo(x + 4, y); g.arc(x, y, 4, 0, 6.2832);
    }
    g.stroke(); g.globalAlpha = 1;
  }

  drawSprite(g, 'Sun', cx, cy, 13);
  for (const p in PLANETS) {
    const P = planetNow[p];
    const x = cx + P[0] * sc, y = cy - P[1] * sc;
    if (x < -30 || y < -30 || x > s.w + 30 || y > s.h + 30) continue;
    const r = PLANET_R[p];
    drawSprite(g, p, x, y, r);
    text(g, p, x + r + (p === 'Saturn' ? 12 : 5), y + 4, { size: 12.5, weight: p === 'Earth' ? 600 : 500, color: p === 'Earth' ? C.ink : C.ink2, halo: true });
  }

  if (state.sel) {
    const k = state.sel.idx, x = posX[k], y = posY[k];
    g.strokeStyle = C.hi; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
    g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(ex, ey); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
    const dx = (x - cx) / sc - E[0], dy = -(y - cy) / sc - E[1];
    const dist = Math.hypot(dx, dy);
    text(g, state.sel.name, x + 11, y - 9, { size: 13.5, weight: 650, color: C.ink, halo: true });
    text(g, `${dist.toFixed(2)} AU from Earth (in-plane)`, x + 11, y + 7, { size: 12, color: C.ink2, halo: true });
  }
  if (state.hover && state.hover !== state.sel) {
    const k = state.hover.idx;
    g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(posX[k], posY[k], 6, 0, 7); g.stroke();
  }

  const inData = state.t >= META.tmin - 1 && state.t <= META.tmax + 1;
  text(g, fmtDate(state.t), 16, s.h - 50, { size: 17, weight: 650, color: C.ink, halo: true });
  text(g, i1 > i0 ? `${i1 - i0} detections within ±${win} days` : inData ? 'no detections in this sample within ±2 days' : 'outside the data window: positions are extrapolated',
    16, s.h - 32, { size: 12.5, color: C.ink2, halo: true });
  perf.draw.push(performance.now() - t0);
  if (perf.draw.length > 600) perf.draw.shift();
}


const slider = $('#slider');
const tToS = (t) => (t - T0) / (T1 - T0) * 1000;
const sToT = (v) => T0 + v / 1000 * (T1 - T0);
function syncTime() {
  slider.value = tToS(state.t);
  $('#date').textContent = fmtDate(state.t);
  cadS.draw(cadS);
}
slider.addEventListener('input', () => { state.t = sToT(+slider.value); $('#date').textContent = fmtDate(state.t); mapS.draw(mapS); cadS.draw(cadS); });
$('#speed').addEventListener('change', (e) => { state.speed = +e.target.value; });

let lastTs = 0, raf = 0;
function frame(ts) {
  raf = 0;
  if (!state.playing) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  if (lastTs) perf.frame.push(ts - lastTs);
  if (perf.frame.length > 600) perf.frame.shift();
  lastTs = ts;
  state.t += dt * state.speed;
  if (state.t > T1) state.t = T0;
  drawMap(mapS);
  slider.value = tToS(state.t);
  $('#date').textContent = fmtDate(state.t);
  if (++frameCount % 15 === 0) cadS.draw(cadS);
  raf = requestAnimationFrame(frame);
}
let frameCount = 0;
function setPlaying(p) {
  state.playing = p;
  const pl = $('#play');
  pl.querySelector('span').textContent = p ? 'Pause' : 'Play';
  pl.querySelector('path.pl').setAttribute('d', p ? 'M8 5.5v13M16 5.5v13' : 'M8 5.5v13l10.5-6.5z');
  pl.setAttribute('aria-label', p ? 'Pause' : 'Play');
  pl.classList.toggle('on', p);
  lastTs = 0;
  if (p && !raf) raf = requestAnimationFrame(frame);
}
$('#play').addEventListener('click', () => setPlaying(!state.playing));
let wasPlaying = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { wasPlaying = state.playing; setPlaying(false); } else if (wasPlaying) setPlaying(true);
});

document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => setZoom(+b.dataset.zoom)));
function setZoom(r) {
  state.viewR = clamp(r, 0.6, 11);
  document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.zoom - state.viewR) < 0.01));
  mapS.draw(mapS);
}
$('#map').addEventListener('wheel', (e) => { e.preventDefault(); setZoom(state.viewR * Math.exp(e.deltaY * 0.0015)); }, { passive: false });
const pointers = new Map();
let pinch0 = 0, pinchR = 0;
$('#map').addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); pinchR = state.viewR; }
});
$('#map').addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch0 > 0) setZoom(pinchR * pinch0 / d);
    return;
  }
  if (e.pointerType !== 'mouse') return;
  const o = pickMap(e);
  setHover(o);
  if (o) showTip(tipFor(o), e.clientX, e.clientY); else hideTip();
});
const endPtr = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
$('#map').addEventListener('pointerup', (e) => {
  const was = pointers.size;
  endPtr(e);
  if (was === 1) { const o = pickMap(e); if (o) select(o); }
});
$('#map').addEventListener('pointercancel', endPtr);
$('#map').addEventListener('pointerleave', () => { setHover(null); hideTip(); });
function pickMap(e) {
  const r = $('#map').getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = (e.pointerType === 'mouse' ? 10 : 22) ** 2;
  for (let k = 0; k < N; k++) {
    if (state.filter && !state.filter(O[k])) continue;
    const d = (posX[k] - x) ** 2 + (posY[k] - y) ** 2;
    if (d < bd) { bd = d; best = O[k]; }
  }
  return best;
}
function setHover(o) {
  if (state.hover === o) return;
  state.hover = o;
  $('#map').classList.toggle('hot', !!o); $('#elem').classList.toggle('hot', !!o);
  if (!state.playing) mapS.draw(mapS);
  elS.draw(elS);
}

const elS = setupCanvas($('#elem'), drawElem);
let elPts = [];
function elFrame(s) {
  const L = s.w < 500 ? 40 : 48, Rm = 12, T = 92, B = 40;
  const yMax = state.yAxis === 'e' ? 0.6 : 36;
  return {
    L, T, B, x0: 1.4, x1: 5.6, y0: 0, y1: yMax,
    X: (a) => L + (a - 1.4) / (5.6 - 1.4) * (s.w - L - Rm),
    Y: (v) => s.h - B - v / yMax * (s.h - B - T),
    Rm,
  };
}
function drawElem(s) {
  if (!s.w) return;
  const g = s.ctx, f = elFrame(s);
  g.clearRect(0, 0, s.w, s.h);
  const yKey = state.yAxis;
  const yTicks = yKey === 'e' ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] : [0, 5, 10, 15, 20, 25, 30, 35];
  for (const v of yTicks) {
    const y = f.Y(v);
    if (v > 0) pencilLine(g, f.L, y, s.w - f.Rm, y, { color: C.grid, passes: 1, amp: 1.2 });
    text(g, yKey === 'e' ? v.toFixed(1) : v + '°', f.L - 6, y + 4, { size: 11.5, color: C.ink3, align: 'right' });
  }
  for (let a = 1.5; a <= 5.5; a += 0.5) {
    const x = f.X(a);
    pencilLine(g, x, f.T, x, s.h - f.B, { color: C.grid, passes: 1, amp: 1.2 });
    text(g, a.toFixed(1), x, s.h - f.B + 16, { size: 11.5, color: C.ink3, align: 'center' });
  }
  pencilLine(g, f.L, s.h - f.B, s.w - f.Rm, s.h - f.B, { color: C.goldSoft, width: 1.2 });
  pencilLine(g, f.L, f.T, f.L, s.h - f.B, { color: C.goldSoft, width: 1.2 });
  text(g, 'semi-major axis a (AU)', (f.L + s.w - f.Rm) / 2, s.h - 6, { size: 12, color: C.ink2, align: 'center' });
  g.save(); g.translate(12, (f.T + s.h - f.B) / 2); g.rotate(-Math.PI / 2);
  text(g, yKey === 'e' ? 'eccentricity e' : 'inclination i (degrees)', 0, 0, { size: 12, color: C.ink2, align: 'center', base: 'middle' });
  g.restore();

  const bw = 0.025, nb = Math.ceil((5.6 - 1.4) / bw), hist = new Array(nb).fill(0);
  for (const o of O) if (inFilter(o) && o.a >= 1.4 && o.a < 5.6) hist[Math.floor((o.a - 1.4) / bw)]++;
  const hmax = Math.max(1, ...hist), hT = 20, hB = f.T - 26;
  g.fillStyle = hatch(g, C.gold, 2.6, 52, 1.1);
  for (let k = 0; k < nb; k++) {
    if (!hist[k]) continue;
    const x = f.X(1.4 + k * bw), w = Math.max(1, f.X(1.4 + (k + 1) * bw) - x - 0.6);
    const hgt = Math.sqrt(hist[k] / hmax) * (hB - hT);
    g.fillRect(x, hB - hgt, w, hgt);
  }
  g.strokeStyle = C.gold; g.lineWidth = 1; g.beginPath();
  let prevY = hB;
  for (let k = 0; k <= nb; k++) {
    const x = f.X(1.4 + k * bw), y = k < nb && hist[k] ? hB - Math.sqrt(hist[k] / hmax) * (hB - hT) : hB;
    if (k === 0) g.moveTo(x, y); else { g.lineTo(x, prevY); g.lineTo(x, y); }
    prevY = y;
  }
  g.stroke();
  pencilLine(g, f.L, hB, s.w - f.Rm, hB, { color: C.goldSoft, width: 1.1 });


  g.setLineDash([4, 5]);
  for (const r of RES) { const x = f.X(r.a); pencilLine(g, x, hT, x, s.h - f.B, { color: C.goldSoft, width: 1.1, passes: 1, amp: 1.4 }); }
  g.setLineDash([]);
  g.font = font(11.5, 600);
  let resR = -1e9;
  for (const r of RES) { const x = f.X(r.a) + 3, w2 = g.measureText(r.l).width; const y = x < resR + 3 ? 28 : 12; text(g, r.l, x, y, { size: 11.5, weight: 600, color: C.gold, halo: true }); if (y === 12) resR = x + w2; }

  if (yKey === 'e') {
    for (const [q, lab] of [[1.3, 'q = 1.3 AU: below this curve is near-Earth space'], [1.666, 'q = 1.666 AU: Mars-crossing']]) {
      g.strokeStyle = q === 1.3 ? C.cls.NEO : C.cls.MC; g.lineWidth = 1.2; g.beginPath();
      for (let a = Math.max(1.4, q); a <= 5.6; a += 0.02) {
        const e = 1 - q / a; if (e > 0.6) break;
        const x = f.X(a), y = f.Y(e); if (a === Math.max(1.4, q)) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    annotate(g, 'near-Earth: q < 1.3 AU', f.X(1.45), f.Y(0.57), { size: 18, color: C.cls.NEO, align: 'left' });
    annotate(g, 'Mars-crossers', f.X(2.55), f.Y(0.385), { size: 18, color: C.cls.MC, align: 'left' });
  }
  const lab = (str, a, v) => annotate(g, str, f.X(a), f.Y(v), { size: s.w < 500 ? 17 : 21, color: C.ink });
  if (yKey === 'e') {
    lab('Hungarias', 1.62, 0.1); lab('Hildas', 3.97, 0.33); lab('Trojans', 5.2, 0.2); lab('Cybeles', 3.5, 0.26);
  } else {
    lab('Hungarias', 1.66, 24); lab('Hildas', 3.97, 22); lab('Trojans', 5.2, 31); lab('Cybeles', 3.5, 24);
  }
  const by = f.T - 9;
  const lbls = [['inner', 2.28], ['middle', 2.66], ['outer', 3.11]];
  g.font = font(11.5);
  let lastR = -1e9;
  for (const [str, a] of lbls) { const w2 = g.measureText(str).width / 2, x = f.X(a); if (x - w2 > lastR + 4) { text(g, str, x, by, { size: 11.5, color: C.ink3, align: 'center', halo: true }); lastR = x + w2; } }



  elPts = [];
  const val = (o) => yKey === 'e' ? o.e : o.inc;
  for (const c of CLASS_ORDER) {
    g.fillStyle = C.cls[c];
    const r = c === 'MBA' ? 1.8 : 3;
    for (const pass of [0, 1]) {
      g.globalAlpha = pass === 0 ? 0.14 : (c === 'MBA' ? 0.75 : 1);
      g.beginPath();
      for (const o of O) {
        if (o.cls !== c) continue;
        const inF = inFilter(o);
        if ((pass === 0) === inF) continue;
        if (o.a < 1.4 || o.a > 5.6 || val(o) > f.y1) continue;
        const x = f.X(o.a), y = f.Y(val(o));
        g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832);
        if (inF) elPts.push([x, y, o]);
      }
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const off = O.filter((o) => inFilter(o) && (o.a < 1.4 || o.a > 5.6 || val(o) > f.y1)).length;
  if (off) text(g, `${off} outside the plotted range`, s.w - f.Rm - 4, s.h - f.B - 8, { size: 11, color: C.ink3, align: 'right', halo: true });
  for (const [o, col, w] of [[state.hover, C.ink, 1.5], [state.sel, C.hi, 2]]) {
    if (!o || o.a < 1.4 || o.a > 5.6) continue;
    const x = f.X(o.a), y = f.Y(Math.min(val(o), f.y1));
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
    if (o === state.sel) text(g, o.name, x + 10, y - 8, { size: 12.5, weight: 650, color: C.ink, halo: true });
  }
}
function pickPts(pts, e, cv) {
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = (e.pointerType === 'mouse' ? 9 : 20) ** 2;
  for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = p[2]; } }
  return best;
}
$('#elem').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const o = pickPts(elPts, e, $('#elem'));
  setHover(o);
  if (o) showTip(tipFor(o), e.clientX, e.clientY); else hideTip();
});
$('#elem').addEventListener('pointerleave', () => { setHover(null); hideTip(); });
$('#elem').addEventListener('click', (e) => { const o = pickPts(elPts, e, $('#elem')); if (o) select(o); });
document.querySelectorAll('[data-y]').forEach((b) => b.addEventListener('click', () => {
  state.yAxis = b.dataset.y;
  document.querySelectorAll('[data-y]').forEach((x) => x.classList.toggle('on', x === b));
  $('#ycap').textContent = state.yAxis === 'e' ? 'eccentricity e' : 'inclination i';
  elS.draw(elS);
}));

const SUN = { gr: 0.44, ri: 0.11, iz: 0.03 };
const colS = setupCanvas($('#colours'), drawColours);
function drawColours(s) {
  if (!s.w) return;
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  const rows = [
    { k: 'ri', lab: 'r − i colour (mag)', lo: -0.4, hi: 0.8 },
    { k: 'iz', lab: 'i − z colour (mag)', lo: -0.6, hi: 0.6 },
  ];
  const L = 34, Rm = 12, gap = 30, ph = (s.h - gap - 16) / 2;
  rows.forEach((row, ri) => {
    const top = ri * (ph + gap) + 16, bot = top + ph - 42;
    const X = (v) => L + (v - row.lo) / (row.hi - row.lo) * (s.w - L - Rm);
    const bw = 0.04, nb = Math.round((row.hi - row.lo) / bw);
    const h = new Array(nb).fill(0), hf = new Array(nb).fill(0);
    let n = 0, nOut = 0;
    for (const o of O) {
      const v = o.col && o.col[row.k];
      if (v === undefined) continue;
      if (v < row.lo || v >= row.hi) { nOut++; continue; }
      const b = Math.floor((v - row.lo) / bw);
      h[b]++; n++;
      if (state.filter && state.filter(o)) hf[b]++;
    }
    const hmax = Math.max(1, ...h);
    const Y = (c) => bot - c / hmax * (bot - top - 18);
    const step = hmax > 40 ? 20 : hmax > 16 ? 10 : 5;
    for (let c = 0; c <= hmax; c += step) {
      const y = Y(c);
      if (c > 0) pencilLine(g, L, y, s.w - Rm, y, { color: C.grid, passes: 1, amp: 1.2 });
      text(g, String(c), L - 6, y + 4, { size: 11, color: C.ink3, align: 'right' });
    }
    for (let k = 0; k < nb; k++) {
      const x = X(row.lo + k * bw) + 1.5, w = X(row.lo + (k + 1) * bw) - X(row.lo + k * bw) - 3;
      if (h[k]) sketchBar(g, x, Y(h[k]), w, bot - Y(h[k]), state.filter ? C.line : C.bar2);
      if (hf[k]) sketchBar(g, x, Y(hf[k]), w, bot - Y(hf[k]), C.bar2);
    }
    pencilLine(g, L, bot, s.w - Rm, bot, { color: C.goldSoft, width: 1.2 });
    for (let v = Math.ceil(row.lo * 5) / 5; v <= row.hi + 1e-9; v += 0.2) {
      text(g, v.toFixed(1).replace('-', '−'), X(v), bot + 15, { size: 11.5, color: C.ink3, align: 'center' });
    }
    text(g, row.lab, L, top - 2, { size: 12.5, weight: 650, color: C.ink });
    text(g, `${n} asteroids${nOut ? ` · ${nOut} off-scale` : ''}`, s.w - Rm, top - 2, { size: 11.5, color: C.ink3, align: 'right' });
    text(g, '← bluer', L, bot + 31, { size: 11, color: C.ink3 });
    text(g, 'redder →', s.w - Rm, bot + 31, { size: 11, color: C.ink3, align: 'right' });
    const vals = O.filter((o) => o.col && o.col[row.k] !== undefined).map((o) => o.col[row.k]).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const mx = X(med), sx = X(SUN[row.k]), left = sx < mx;
    g.setLineDash([3, 4]); pencilLine(g, mx, top + 18, mx, bot, { color: C.ink2, width: 1.2, passes: 1 }); g.setLineDash([]);
    pencilLine(g, sx, top + 18, sx, bot, { color: C.gold, width: 2 });
    text(g, `Sun ${SUN[row.k].toFixed(2)}`, sx + (left ? -5 : 5), top + 16, { size: 11.5, weight: 600, color: C.ink2, align: left ? 'right' : 'left', halo: true });
    text(g, `median ${med.toFixed(2).replace('-', '−')}`, mx + (left ? 5 : -5), top + 16, { size: 11.5, color: C.ink2, align: left ? 'left' : 'right', halo: true });
    const o = state.sel;
    if (o && o.col && o.col[row.k] !== undefined) {
      const v = clamp(o.col[row.k], row.lo, row.hi - 0.001), x = X(v);
      pencilLine(g, x, top + 30, x, bot, { color: C.hi, width: 2.4 });
      text(g, `${o.name}: ${o.col[row.k].toFixed(2)}`, x + (x > s.w * 0.6 ? -6 : 6), top + (bot - top) * 0.5, { size: 12, weight: 650, color: C.ink, align: x > s.w * 0.6 ? 'right' : 'left', halo: true });
    }
  });
}
const colNote = () => `Each asteroid's colour is the median over its same-night pairs (< 2.4 h apart, both errors < 0.1 mag); rotation between the two exposures adds scatter of a few tenths of a magnitude. The sample sits redder than the Sun in r − i and bluer in i − z, the signature of the 1 µm absorption band of stony S-types, which dominate a brightness-limited inner-belt sample. Rubin mostly paired r with i and i with z, so g − r exists for only a handful of asteroids; SSOFT H_g − H_r is constrained (errors under 0.2 mag) for only ${R.ssoftGR.length} of ${fmtN(META.ssoft_rows)} rows. Solar colours are SDSS values.`;

const cadS = setupCanvas($('#cadence'), drawCad);
const CT0 = dateMjd(2026, 0, 1), CT1 = dateMjd(2027, 0, 1);
function cadFrame(s) {
  const L = 44, Rm = 12;
  return { L, Rm, X: (t) => L + (t - CT0) / (CT1 - CT0) * (s.w - L - Rm), T: (x) => CT0 + (x - L) / (s.w - L - Rm) * (CT1 - CT0) };
}
function drawCad(s) {
  if (!s.w) return;
  const g = s.ctx, f = cadFrame(s);
  g.clearRect(0, 0, s.w, s.h);
  const topT = 10, topB = Math.round(s.h * 0.56), botT = topB + 26, botB = s.h - 22;
  const lmax = 6.5;
  const Yl = (v) => topB - Math.log10(Math.max(1, v)) / lmax * (topB - topT);
  for (const p of [2, 4, 6]) {
    const y = Yl(10 ** p);
    pencilLine(g, f.L, y, s.w - f.Rm, y, { color: C.grid, passes: 1, amp: 1.2 });
    text(g, p === 6 ? '1M' : p === 4 ? '10k' : '100', f.L - 6, y + 4, { size: 11, color: C.ink3, align: 'right' });
  }
  const nights = R.nights.map(([n, a, sso]) => [nightMjd(n), a, sso]);
  const w = Math.max(1.5, (s.w - f.L - f.Rm) / 365 - 0.6);
  for (const [t, a, sso] of nights) {
    const x = f.X(t);
    g.fillStyle = hatch(g, C.bar, 2.4, 52, 1); g.fillRect(x, Yl(a), w, topB - Yl(a));
    g.fillStyle = C.bar; g.fillRect(x, Yl(a), w, 1.2);
    if (sso > 0) { g.fillStyle = C.bar2; g.globalAlpha = 0.85; g.fillRect(x, Yl(sso), w, topB - Yl(sso)); g.globalAlpha = 1; }
  }
  const ts = nights.map((n) => n[0]).sort((a, b) => a - b);
  g.fillStyle = C.ink3;
  for (let k = 1; k < ts.length; k++) {
    if (ts[k] - ts[k - 1] > 20) {
      const x0 = f.X(ts[k - 1] + 1), x1 = f.X(ts[k]);
      g.setLineDash([3, 4]); pencilLine(g, x0 + 2, topB - 6, x1 - 2, topB - 6, { color: C.line, passes: 1 }); g.setLineDash([]);
      const lbl = `no data · ${Math.round(ts[k] - ts[k - 1] - 1)} nights`;
      g.font = font(13, 600);
      if (x1 - x0 > g.measureText(lbl).width + 12) annotate(g, lbl, (x0 + x1) / 2, topB - 14, { size: 19, color: C.ink2 });
    }
  }
  pencilLine(g, f.L, topB, s.w - f.Rm, topB, { color: C.goldSoft, width: 1.2 });
  text(g, 'alerts per night (log)', f.L + 4, topT + 10, { size: 11.5, color: C.ink2, halo: true });

  let dmax = 1;
  nightDet.forEach((v) => { if (v > dmax) dmax = v; });
  const Yd = (v) => botB - Math.sqrt(v / dmax) * (botB - botT);
  g.fillStyle = nightDetF ? C.line : C.gold;
  nightDet.forEach((v, t) => { const x = f.X(t); g.fillRect(x, Yd(v), w, botB - Yd(v)); });
  if (nightDetF) { g.fillStyle = C.gold; nightDetF.forEach((v, t) => { const x = f.X(t); g.fillRect(x, Yd(v), w, botB - Yd(v)); }); }
  pencilLine(g, f.L, botB, s.w - f.Rm, botB, { color: C.goldSoft, width: 1.2 });
  text(g, `detections in this sample per night (√, max ${dmax})`, f.L + 4, botT - 6, { size: 11.5, color: C.ink2, halo: true });
  if (state.sel) {
    g.fillStyle = C.hi;
    const seen = new Set();
    for (const d of state.sel.det) { const t = Math.floor(d[0] + MJD_OFF); if (seen.has(t)) continue; seen.add(t); g.fillRect(f.X(t) - 0.5, botB + 3, Math.max(2, w), 7); }
  }
  for (let m = 0; m < 12; m++) {
    const x = f.X(dateMjd(2026, m, 1));
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, botB + 10); g.lineTo(Math.round(x) + 0.5, botB + 14); g.stroke();
    if (s.w > 520 || m % 2 === 0) text(g, MON[m], x + 3, s.h - 6, { size: 11.5, color: C.ink3 });
  }
  if (state.t >= CT0 && state.t <= CT1) {
    const x = Math.round(f.X(state.t)) + 0.5;
    g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, topT); g.lineTo(x, botB); g.stroke(); g.lineWidth = 1;
    g.fillStyle = C.ink; g.beginPath(); g.moveTo(x - 5, topT - 6); g.lineTo(x + 5, topT - 6); g.lineTo(x, topT); g.fill();
  }
}
$('#cadence').addEventListener('click', (e) => {
  const r = $('#cadence').getBoundingClientRect();
  const t = cadFrame(cadS).T(e.clientX - r.left);
  if (t < CT0 || t > CT1) return;
  state.t = Math.floor(t) + 0.5; syncTime(); mapS.draw(mapS);
});
$('#cadence').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = $('#cadence').getBoundingClientRect();
  const t = Math.floor(cadFrame(cadS).T(e.clientX - r.left));
  const n = R.nights.find((x) => Math.floor(nightMjd(x[0])) === t);
  const d = nightDet.get(t) || 0;
  if (t < CT0 || t >= CT1) { hideTip(); return; }
  showTip(`<b>${fmtDate(t)}</b><br>${n ? `${fmtN(n[1])} alerts, ${fmtN(n[2])} matched to known Solar System objects` : 'no Fink statistics for this night'}<br>${d} detections in this sample`, e.clientX, e.clientY);
});
$('#cadence').addEventListener('pointerleave', hideTip);

const onCard = (fn) => withTokensOf($('#card'), fn);
function phasePlot(cv, o) {
  const s = setupCanvas(cv, onCard((s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const pts = o.det.filter((d) => d[5] !== null && d[1] >= 0);
    const L = 54, Rm = 10, T = 10, B = 30;
    const amax = Math.max(10, Math.ceil((Math.max(0, ...pts.map((d) => d[4])) + 2) / 5) * 5);
    const reds = pts.map((d) => d[5]);
    const Hs = Object.values(o.H);
    let lo = Math.min(...reds, ...Hs) - 0.3, hi = Math.max(...reds) + 0.3;
    if (!pts.length) { lo = 10; hi = 20; }
    const X = (a) => L + a / amax * (s.w - L - Rm), Y = (m) => T + (m - lo) / (hi - lo) * (s.h - T - B);
    axes(g, s, { L, Rm, T, B, xt: ticks(0, amax, 5), xf: (v) => v + '°', yt: ticks(lo, hi, 4), yf: (v) => v.toFixed(1), X, Y, xl: 'phase angle α (Sun–asteroid–Earth)' });
    for (const b in o.H) {
      const bi = BANDS.indexOf(b), H = o.H[b];
      if (!pts.some((d) => d[1] === bi)) continue;
      g.strokeStyle = C.band[b]; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath();
      for (let a = 0; a <= amax; a += 0.5) { const m = H - 2.5 * Math.log10(hgPhi(a, R.meta.gfixed)); const y = Y(m); if (a === 0) g.moveTo(X(a), y); else g.lineTo(X(a), y); }
      g.stroke(); g.setLineDash([]);
    }
    if (o.sf) {
      for (const b in o.sf) {
        if (b === 'ph') continue;
        const [H, G] = o.sf[b];
        g.strokeStyle = C.band[b]; g.lineWidth = 2; g.beginPath();
        for (let a = 0; a <= amax; a += 0.5) { const y = Y(H - 2.5 * Math.log10(hgPhi(a, G))); if (a === 0) g.moveTo(X(a), y); else g.lineTo(X(a), y); }
        g.stroke();
      }
    }
    for (const d of pts) {
      const b = BANDS[d[1]], x = X(d[4]), y = Y(d[5]);
      if (d[3]) { g.strokeStyle = C.band[b]; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(d[5] - d[3])); g.lineTo(x, Y(d[5] + d[3])); g.stroke(); }
      g.fillStyle = C.band[b]; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    }
    g.save(); g.translate(10, (T + s.h - B) / 2); g.rotate(-Math.PI / 2);
    text(g, 'reduced mag (brighter ↑)', 0, 0, { size: 11, color: C.ink2, align: 'center', base: 'middle' }); g.restore();
    if (!pts.length) text(g, 'No detection with usable viewing geometry', (L + s.w - Rm) / 2, (T + s.h - B) / 2, { size: 13, color: C.ink2, align: 'center', halo: true });
  }));
  return s;
}
function lcPlot(cv, o) {
  return setupCanvas(cv, onCard((s) => {
    if (!s.w) return;
    const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
    const pts = o.det.filter((d) => d[2] !== null && d[1] >= 0);
    const L = 54, Rm = 10, T = 10, B = 30;
    const tt = pts.map((d) => d[0] + MJD_OFF), span = Math.max(30, Math.max(...tt) - Math.min(...tt));
    const t0 = Math.min(...tt) - span * 0.08, t1 = Math.max(...tt) + span * 0.08;
    const ms = pts.map((d) => d[2]);
    const lo = Math.min(...ms) - 0.3, hi = Math.max(...ms) + 0.3;
    const X = (t) => L + (t - t0) / (t1 - t0) * (s.w - L - Rm), Y = (m) => T + (m - lo) / (hi - lo) * (s.h - T - B);
    const xt = [];
    for (let m = 0; m < 12; m++) for (const d of [1, 15]) { const t = dateMjd(2026, m, d); if (t >= t0 && t <= t1) xt.push(t); }
    const xs = xt.length > 7 ? xt.filter((t) => mjdDate(t).getUTCDate() === 1) : xt;
    axes(g, s, { L, Rm, T, B, xt: xs, xf: fmtShort, yt: ticks(lo, hi, 4), yf: (v) => v.toFixed(1), X, Y, xl: 'date (2026)' });
    for (const d of pts) {
      const b = BANDS[d[1]], x = X(d[0] + MJD_OFF), y = Y(d[2]);
      g.fillStyle = C.band[b]; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    }
    g.save(); g.translate(10, (T + s.h - B) / 2); g.rotate(-Math.PI / 2);
    text(g, 'apparent mag (AB)', 0, 0, { size: 11, color: C.ink2, align: 'center', base: 'middle' }); g.restore();
  }));
}
function ticks(lo, hi, n) {
  const span = hi - lo, raw = span / n, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function axes(g, s, a) {
  for (const v of a.yt) { const y = a.Y(v); pencilLine(g, a.L, y, s.w - a.Rm, y, { color: C.grid, passes: 1 }); text(g, a.yf(v), a.L - 5, y + 4, { size: 11, color: C.ink3, align: 'right' }); }
  for (const v of a.xt) { const x = a.X(v); pencilLine(g, x, a.T, x, s.h - a.B, { color: C.grid, passes: 1 }); text(g, a.xf(v), x, s.h - a.B + 14, { size: 11, color: C.ink3, align: 'center' }); }
  pencilLine(g, a.L, s.h - a.B, s.w - a.Rm, s.h - a.B, { color: C.graphite, width: 1.1 });
  pencilLine(g, a.L, a.T, a.L, s.h - a.B, { color: C.graphite, width: 1.1 });
  text(g, a.xl, (a.L + s.w - a.Rm) / 2, s.h - 4, { size: 11.5, color: C.ink2, align: 'center' });
}
function hgPhi(a, G) {
  const t = Math.tan(a * DEG / 2);
  return (1 - G) * Math.exp(-3.33 * t ** 0.63) + G * Math.exp(-1.87 * t ** 1.22);
}

let cardPlots = [];
const renderCard = onCard(renderCardInner);
function renderCardInner() {
  const card = $('#cardBody');
  cardPlots = [];
  const o = state.sel;
  if (!o) {
    const c = META.classes;
    card.innerHTML = `<h3 class="ph">Pick an asteroid</h3>
      <p class="cap">Tap any dot on the map or in the element plot, search a designation, or pick one below. The chosen asteroid is then marked in red in every view.</p>
      <dl><div><dt>Asteroids</dt><dd>${fmtN(META.nobj)}</dd></div><div><dt>Detections</dt><dd>${fmtN(META.ndet)}</dd></div><div><dt>Bands</dt><dd>${Object.keys(META.bands).length}</dd></div>
      <div><dt>Main belt</dt><dd>${fmtN(c.MBA || 0)}</dd></div><div><dt>Near-Earth</dt><dd>${c.NEO || 0}</dd></div><div><dt>Trojans</dt><dd>${c.TRO || 0}</dd></div></dl>
      <p class="cap">Detections per band: ${BANDS.filter((b) => META.bands[b]).map((b) => `${b} ${fmtN(META.bands[b])}`).join(' · ')}.</p>
      <h4>${state.filter ? 'In this view' : 'Worth a look: everything outside the main belt'}</h4>
      <p class="cap">Sorted by number of detections. Tap a name to open its card.</p>
      <div class="picks">${O.filter((x) => (state.filter ? state.filter(x) : x.cls !== 'MBA')).sort((p, q) => q.det.length - p.det.length).slice(0, 48)
        .map((x) => `<button class="btn" type="button" data-pick="${x.idx}"><span class="sw" style="background:${C.cls[x.cls]}"></span>${x.name} <small>${x.det.length}</small></button>`).join('')}</div>`;
    card.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => select(O[+b.dataset.pick], { zoom: true })));
    return;
  }
  const bands = BANDS.filter((b) => o.det.some((d) => BANDS[d[1]] === b));
  const geomMissing = o.det.filter((d) => d[5] === null && d[2] !== null).length;
  const t = o.det.map((d) => d[0] + MJD_OFF);
  const Hr = o.sf && o.sf.r ? `${o.sf.r[0].toFixed(2)} <small>SSOFT, G ${o.sf.r[1].toFixed(2)}</small>` :
    o.H.r !== undefined ? `${o.H.r.toFixed(1)} <small>r, G=0.15 assumed</small>` :
    Object.keys(o.H).length ? `${Object.values(o.H)[0].toFixed(1)} <small>${Object.keys(o.H)[0]}, G=0.15</small>` : '—';
  const col = o.col ? Object.entries(o.col).map(([k, v]) => `${k[0]}−${k[1]} ${v.toFixed(2)}`).join(', ') : null;
  card.innerHTML = `
    <h3>${o.name}</h3>
    <div class="cls"><span class="sw" style="background:${C.cls[o.cls]}"></span>${CLASS[o.cls].name} <span style="color:var(--ink3)">· ${CLASS[o.cls].desc}</span></div>
    <dl>
      <div><dt>a, semi-major axis</dt><dd>${o.a.toFixed(3)} <small>AU</small></dd></div>
      <div><dt>e, eccentricity</dt><dd>${o.e.toFixed(3)}</dd></div>
      <div><dt>i, inclination</dt><dd>${o.inc.toFixed(2)}<small>°</small></dd></div>
      <div><dt>q, perihelion</dt><dd>${o.q.toFixed(2)} <small>AU</small></dd></div>
      <div><dt>Period</dt><dd>${(o.a ** 1.5).toFixed(2)} <small>yr</small></dd></div>
      <div><dt>H, absolute mag</dt><dd>${Hr}</dd></div>
      <div><dt>Detections</dt><dd>${o.det.length} <small>on ${o.nn} nights</small></dd></div>
      <div><dt>Seen</dt><dd>${fmtShort(Math.min(...t))} – ${fmtShort(Math.max(...t))}</dd></div>
      <div><dt title="From H with albedo ${albedoOf(o.cls)}; real size can differ by about 2×">Diameter, est.</dt><dd>${o.D ? (o.D >= 10 ? o.D.toFixed(0) : o.D.toFixed(1)) + ' <small>km, p = ' + albedoOf(o.cls) + '</small>' : '—'}</dd></div>
    </dl>
    ${col ? `<p class="cap">Same-night colour: ${col} (Sun: g−r 0.44, r−i 0.11, i−z 0.03).</p>` : ''}
    <h4>Brightness against phase angle</h4>
    <p class="cap">Each detection corrected to 1 AU from Sun and Earth. Dashed: H–G phase curve with G = 0.15 assumed, H fitted per band.${o.sf ? ' Solid: SSOFT H–G fit.' : ''}</p>
    <canvas class="pp"></canvas>
    ${geomMissing ? `<p class="warn">${geomMissing} detection${geomMissing > 1 ? 's' : ''} carry inconsistent geometry in the alert (observer not at Earth), so they are left out of this plot and the map.</p>` : ''}
    <h4>Light curve</h4>
    <p class="cap">Apparent magnitude of every detection over the season. Gaps are nights the asteroid was not detected.</p>
    <canvas class="lc"></canvas>
    <div class="legend">${bands.map((b) => `<span class="k"><span class="sw" style="background:${C.band[b]}"></span>${b} band</span>`).join('')}</div>
    <div class="cut-row"><button class="btn" type="button" id="cutBtn">Show cutouts</button><span id="cutMsg">latest Science / Template / Difference stamps, fetched from Fink</span></div>`;
  card.querySelector('#cutBtn').addEventListener('click', () => showCutouts(o));
  cardPlots.push(phasePlot(card.querySelector('.pp'), o));
  cardPlots.push(lcPlot(card.querySelector('.lc'), o));
}

function select(o, opts = {}) {
  state.sel = o;
  if (document.body.dataset.mode !== 'stars') setUrl({ sel: o ? o.name : null });
  staticKey = '';
  if (o) {
    $('#search').value = o.name;
    if (opts.zoom) setZoom(clamp(o.Q * 1.08, 1.6, 6.5));
  } else {
    $('#search').value = '';
  }
  $('#clear').hidden = !o;
  renderCard();
  redrawAll();
}
function redrawAll() {
  staticKey = '';
  mapS.draw(mapS); elS.draw(elS); colS.draw(colS); cadS.draw(cadS);
  cardPlots.forEach((p) => p.draw(p));
}

const PRESETS = [
  { id: 'all', label: 'Whole sample', run: () => { state.pfilter = null; select(null); setZoom(3.9); } },
  { id: 'cz10', label: 'Follow 2026 CZ10', run: () => {
    state.pfilter = null; const o = byName.get(norm('2026 CZ10'));
    select(o, { zoom: true }); state.t = Math.floor(Math.min(...o.det.map((d) => d[0] + MJD_OFF))) - 10; state.speed = 5; $('#speed').value = '5'; syncTime(); if (!reduceMotion) setPlaying(true);
  } },
  { id: 'hj4', label: '2020 HJ4 close pass', run: () => {
    state.pfilter = null; const o = byName.get(norm('2020 HJ4'));
    select(o); setZoom(1.8); state.t = dateMjd(2026, 9, 25); state.speed = 1; $('#speed').value = '1'; syncTime(); if (!reduceMotion) setPlaying(true);
  } },
  { id: 'neo', label: 'Near-Earth & Mars-crossers', run: () => { state.pfilter = (o) => o.cls === 'NEO' || o.cls === 'MC'; select(null); setZoom(3.2); } },
  { id: 'hun', label: 'Hungarias', run: () => { state.pfilter = (o) => o.cls === 'HUN'; select(null); setZoom(2.4); } },
  { id: 'hil', label: 'Hildas', run: () => { state.pfilter = (o) => o.cls === 'HIL'; select(null); setZoom(6.2); } },
  { id: 'tro', label: 'Jupiter Trojans', run: () => { state.pfilter = (o) => o.cls === 'TRO'; select(null); setZoom(6.2); } },
  { id: 'kirk', label: 'Edges of the 3:1 gap', run: () => { state.pfilter = (o) => o.a > 2.4 && o.a < 2.6; select(null); setZoom(3.2); } },
];
const pnav = $('#presets');
function runPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  state.preset = id;
  pnav.querySelectorAll('.btn').forEach((x) => { x.classList.toggle('on', x.dataset.preset === id); x.setAttribute('aria-pressed', String(x.dataset.preset === id)); });
  p.run(); applyFilters(); legendMap(); renderCard(); redrawAll();
}
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'btn' + (p.id === 'all' ? ' on' : ''); b.type = 'button'; b.textContent = p.label; b.dataset.preset = p.id;
  b.setAttribute('aria-pressed', String(p.id === 'all'));
  b.addEventListener('click', () => runPreset(p.id));
  pnav.appendChild(b);
}


const notable = () => ['2026 CZ10', '2020 HJ4', '2026 EA2', '2005 WZ101', '2026 GY5'].map((n) => byName.get(norm(n))).filter(Boolean);
function matchList(q) {
  const v = norm(q);
  if (!v) return notable();
  const pre = [], mid = [];
  for (const o of O) {
    if (o.key.startsWith(v) || (o.dkey && o.dkey.startsWith(v))) pre.push(o);
    else if (o.key.includes(v) || (o.dkey && o.dkey.includes(v))) mid.push(o);
  }
  const by = (a, b) => b.det.length - a.det.length;
  return [...pre.sort(by), ...mid.sort(by)].slice(0, 8);
}
export const provider = {
  items: (q) => matchList(q).map((o) => ({ label: o.name, des: o.des, color: C.cls[o.cls], meta: `${CLASS[o.cls].short} · ${o.det.length} det.`, pick: () => select(o, { zoom: true }) })),
  empty: 'No asteroid in this sample matches. Designations look like 2026 CZ10.',
};
function legendMap() {
  const counts = META.classes;
  const clsBtns = (withN) => CLASS_ORDER.filter((c) => counts[c]).map((c) => `<button type="button" class="k${state.preset === 'cls-' + c ? ' on' : ''}" data-cls="${c}" title="${CLASS[c].name}: ${CLASS[c].desc}. Click to show only these." aria-pressed="${state.preset === 'cls-' + c}"><span class="sw" style="background:${C.cls[c]}"></span>${CLASS[c].short}${withN ? ' ' + fmtN(counts[c]) : ''}</button>`).join('');
  $('#legend-map').innerHTML = `<span class="ttl">Orbit class (click to filter):</span>` + clsBtns(true) +
    `<span class="k"><span class="sw ring" style="border-color:${C.det}"></span>Rubin detection ±2 d</span><span class="k"><span class="sw ring" style="border-color:${C.hi}"></span>selected</span>`;
  $('#legend-el').innerHTML = clsBtns(false) +
    `<span class="k"><span class="sw ln" style="border-color:${C.gold}"></span>Jupiter resonance</span>`;
  document.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.cls;
    if (state.preset === 'cls-' + c) { runPreset('all'); return; }
    state.preset = 'cls-' + c; state.pfilter = (o) => o.cls === c;
    pnav.querySelectorAll('.btn').forEach((x) => x.classList.remove('on'));
    select(null); applyFilters(); legendMap(); renderCard(); redrawAll();
  }));
  $('#legend-cad').innerHTML = `<span class="k"><span class="sw sq" style="background:${C.bar}"></span>all Fink alerts</span><span class="k"><span class="sw sq" style="background:${C.bar2}"></span>matched to known SSOs</span><span class="k"><span class="sw sq" style="background:${C.gold}"></span>this sample</span><span class="k"><span class="sw sq" style="background:${C.hi}"></span>selected asteroid's nights</span>`;
}

const ASTRO_TITLE = 'Rubin’s first asteroid season';
function metaText() {
  if (document.body.dataset.mode === 'stars') return;
  const d0 = mjdDate(META.tmin), d1 = mjdDate(META.tmax);
  const span = d0.getUTCFullYear() === d1.getUTCFullYear() ? `${MON[d0.getUTCMonth()]}–${MON[d1.getUTCMonth()]} ${d1.getUTCFullYear()}` : `${fmtShort(META.tmin)} ${d0.getUTCFullYear()} – ${fmtDate(META.tmax)}`;
  $('#sub').textContent = `${fmtN(META.nobj)} asteroids · ${fmtN(META.ndet)} detections · ${span}`;
  $('#search').placeholder = `Search ${fmtN(META.nobj)} asteroids, e.g. 2026 CZ10`;
  $('#colnote').textContent = colNote();
  $('#timenote').textContent = `Detections run ${fmtDate(META.tmin)} – ${fmtDate(META.tmax)} (the highlighted stretch of the slider). Each orbit is a simple Sun-only ellipse fixed at the asteroid's last detection, so far outside that window the dots are extrapolations. Zoom with the buttons, the mouse wheel or a pinch; Space plays and pauses.`;
  const w0 = tToS(META.tmin) / 10, w1 = tToS(META.tmax) / 10;
  slider.style.setProperty('--w0', w0.toFixed(2) + '%'); slider.style.setProperty('--w1', w1.toFixed(2) + '%');
}
function rebuild() {
  const selKey = state.sel ? state.sel.key : null, hadFilter = state.preset;
  buildData(); sizeRange(); applyFilters();
  state.sel = selKey ? byName.get(selKey) || null : null;
  state.hover = null;
  staticKey = '';
  metaText(); legendMap(); renderCard(); redrawAll();
  return hadFilter;
}
let cutCtl = null;
const shownUrls = [];
async function showCutouts(o) {
  const msg = $('#cutMsg'), btn = $('#cutBtn');
  if (cutCtl) cutCtl.abort();
  cutCtl = new AbortController();
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = 'Fetching stamps…';
  try {
    const rec = await sync.cutouts(o.name, cutCtl.signal);
    shownUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    for (const [id, k] of [['#stSci', 'science'], ['#stTpl', 'template'], ['#stDif', 'difference']]) {
      const u = URL.createObjectURL(rec[k]); shownUrls.push(u); $(id).src = u; $(id).alt = `${k} stamp of ${o.name}`;
    }
    $('#stampCap').innerHTML = `Latest stamps of <b>${o.name}</b>: alert ${rec.id}, ${rec.band} band, ${fmtDate(rec.t)}${rec.dist ? `, ${(+rec.dist).toFixed(2)} AU from Earth` : ''} (0.2″ per pixel). <button class="btn" type="button" id="stBack">Back to the 2020 HJ4 example</button>`;
    $('#stBack').addEventListener('click', () => {
      shownUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      $('#stSci').src = 'stamps/science.png'; $('#stTpl').src = 'stamps/template.png'; $('#stDif').src = 'stamps/difference.png';
      $('#stampCap').innerHTML = STAMP_CAP; $('#stampBody').innerHTML = STAMP_BODY;
    });
    $('#stampBody').textContent = 'Science minus template leaves only what changed. A distant or slow asteroid barely moves during the 30-second exposure and looks like a star; a nearby, fast one smears into a streak. Anything that also appears in the template, a star or a galaxy, cancels out in the difference. Stamps are scaled by Fink with a sigmoid stretch, so brightness between panels is not comparable.';
    const sp = $('.stamp-panel');
    if (sp.classList.contains('collapsed')) setCollapsed(sp, false);
    if ($('#cutMsg')) $('#cutMsg').innerHTML = 'Shown in the <a href="#h-st">stamps panel</a> below.';
    if (window.innerWidth > 1000 || !fullscreenPanel()) sp.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  } catch (e) {
    if (e.name !== 'AbortError' && $('#cutMsg')) $('#cutMsg').textContent = `Could not fetch stamps (${e.message || e}). Try again later.`;
  } finally {
    if ($('#cutBtn')) $('#cutBtn').disabled = false;
  }
}
const STAMP_CAP = $('#stampCap').innerHTML, STAMP_BODY = $('#stampBody').innerHTML;

let lastInfo = null;
const dataProvider = {
  title: 'Asteroid data', short: 'asteroids', noun: 'asteroids', unit: 'detections', bundled: { nobj: sync.BUNDLED.nobj, nunit: sync.BUNDLED.ndet, tmax: sync.BUNDLED.tmax },
  counts: () => ({ nobj: META.nobj, nunit: META.ndet, tmax: META.tmax }),
  info: () => lastInfo,
  refreshText: 'Refresh the asteroids already here',
  refreshHint: () => `(${fmtN(META.nobj)}, about ${Math.ceil(META.nobj / 50)} requests)`,
  extraText: 'Add new asteroids, most recently seen first', extraAria: 'Number of new asteroids',
  note: 'Also fetches the newest nightly statistics. Requests go straight to api.lsst.fink-portal.org: 50 asteroids per request, 3 at a time, with retries. Everything is kept in this browser (IndexedDB); the bundled data is never changed.',
  async update(opts) {
    const info = await sync.update(opts);
    opts.onMerge();
    await sync.loadStored();
    rebuild();
    lastInfo = info;
    return info;
  },
  async storage() {
    const st = await sync.storageInfo();
    return `Stored in this browser for asteroids: ${fmtN(st.rows)} detections, ${st.stamps} stamp set${st.stamps === 1 ? '' : 's'}, ${fmtBytes(st.usage)} used in all.`;
  },
  reset: () => sync.reset(),
};
registerData('asteroids', dataProvider);
sync.ready.then((res) => {
  lastInfo = res && res.info;
  if (res && res.stats && (res.stats.added || res.stats.newObjs)) rebuild();
  else if (res && res.stats) { metaText(); redrawAll(); }
  refreshData(dataProvider);
});

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.mode === 'stars') return;
  const tg = e.target instanceof Element ? e.target : document.body;
  if (e.key !== ' ' || tg.closest('input, select, button, textarea')) return;
  e.preventDefault(); setPlaying(!state.playing);
});
$('#dMin').addEventListener('input', () => onSize('lo'));
$('#dMax').addEventListener('input', () => onSize('hi'));
$('#sizeReset').addEventListener('click', () => { state.dLo = 0; state.dHi = 1000; applyFilters(); renderCard(); redrawAll(); });
new ResizeObserver(drawSizeHist).observe($('#dual'));
onTheme(() => { spriteCache.clear(); legendMap(); renderCard(); redrawAll(); drawSizeHist(); });

export function start(params) {
  legendMap();
  state.sel = byName.get(norm('2026 CZ10')) || null;
  if (state.sel) $('#search').value = state.sel.name;
  sizeRange();
  applyFilters();
  renderCard();
  setZoom(3.9);
  syncTime();
  metaText();
  refreshData(dataProvider);
  if (params.get('sel')) { const o = byName.get(norm(params.get('sel'))); if (o) select(o, { zoom: true }); }
}
export function show(params) {
  $('h1').textContent = ASTRO_TITLE;
  setUrl({ mode: null, obj: null, chapter: null, beat: null, sel: state.sel ? state.sel.name : null });
  metaText(); staticKey = ''; redrawAll();
  $('#search').value = state.sel ? state.sel.name : '';
  if (params && !reduceMotion && !params.has('still')) setPlaying(true);
}
export function hide() { setPlaying(false); }
ns.asteroids = { rebuild, get meta() { return META; }, get state() { return state; }, byName: (n) => byName.get(norm(n)), runPreset, select };

export const count = () => fmtN(META.nobj);
