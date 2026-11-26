import * as K from './kit.js';
import { sceneHtml, wireScene } from './scene.js';
import { dockHtml, makeDock } from './dock.js';
import * as SC from './showcase.js';
import * as SKY from './skycalc.js';
import * as EG from './earthgl.js';
import { PICK, guessSite } from './places.js';
import { register as registerData, refresh as refreshData } from './datapanel.js';
import { createLive } from './swpc.js';
import * as CL from './clouds.js';
import { cardHead } from './cardhead.js';

const [E, LT, AU] = await Promise.all([K.loadJson('data/earth.json'), K.loadJson('data/earth-lightning.json'), K.loadJson('data/earth-aurora.json').catch(() => null)]);
const { $, esc, fmtN, MON, clamp, text, annotate } = K;
const C = () => K.C;
const reduceMotion = K.reduceMotion;
const DEG = Math.PI / 180;
const M = E.meta, SW = E.sw || {}, CELLS = E.cells || [], REGIONS = E.regions || [], COV = E.coverage || [];
const T0 = M.t0, T1 = M.t1, HOURS = Math.round((T1 - T0) / 3600);
const WRAP_MS = 1600, EGG_EVERY = 1000;
const MAG_POLES = [[80.8, -72.8], [-80.8, 107.2]];
const SPEEDS = [[300, '5 min/s'], [900, '15 min/s'], [3600, '1 h/s']];
const SAT_LABEL = { G19: 'GLM-East', G18: 'GLM-West', MTI1: 'MTG LI' };
const SAT_NAME = { G19: 'GOES-East GLM', G18: 'GOES-West GLM', MTI1: 'MTG Lightning Imager' };
const LI_ON = COV.some((c) => c.id === 'MTI1' && c.state !== 'off');
const LI_STATE = (M.li && M.li.state) || 'off';

const nowS = () => Date.now() / 1000;
const pad = (x) => String(x).padStart(2, '0');
const dOf = (t) => new Date(t * 1000);
const hhmm = (t) => { const d = dOf(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fmtUtc = (t, short) => { const d = dOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${short ? '' : ' ' + d.getUTCFullYear()} · ${hhmm(t)} UTC`; };
const fmtDayHour = (t) => { const d = dOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${hhmm(t)}`; };
const fmtM = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : fmtN(n));
const mjdOf = (t) => t / 86400 + 40587;
const wrapLon = (l) => ((l + 540) % 360) - 180;
const lb = (arr, x, lo = 0, hi = arr.length) => { while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const B64 = new Uint8Array(128);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => { B64[c.charCodeAt(0)] = i; });
function decode(b) {
  const n = b.length, pad = b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0, out = new Uint8Array((n * 3 >> 2) - pad);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const v = (B64[b.charCodeAt(i)] << 18) | (B64[b.charCodeAt(i + 1)] << 12) | (B64[b.charCodeAt(i + 2)] << 6) | B64[b.charCodeAt(i + 3)];
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

function sunLL(t) {
  const m = mjdOf(t), [ra, dec] = SKY.sunRaDec(m);
  return [dec, wrapLon(ra - SKY.gmst(m))];
}
function sunAlt(lat, lon, t) {
  const [sd, sl] = sunLL(t);
  const c = Math.sin(lat * DEG) * Math.sin(sd * DEG) + Math.cos(lat * DEG) * Math.cos(sd * DEG) * Math.cos((lon - sl) * DEG);
  return Math.asin(clamp(c, -1, 1)) / DEG;
}
const solarTime = (lon, t) => { const h = ((dOf(t).getUTCHours() + dOf(t).getUTCMinutes() / 60 + lon / 15) % 24 + 24) % 24; return `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`; };
const sunWord = (a) => (a > 0 ? 'day' : a > -6 ? 'civil twilight' : a > -12 ? 'nautical twilight' : a > -18 ? 'astronomical twilight' : 'night');
function gcKm(a, b, c, d) {
  const x = Math.sin(a * DEG) * Math.sin(c * DEG) + Math.cos(a * DEG) * Math.cos(c * DEG) * Math.cos((b - d) * DEG);
  return 6371 * Math.acos(clamp(x, -1, 1));
}

function hash3(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab | 0, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
function decodeFlashes(b64, n, from = 0, to = Infinity, F0 = null) {
  const raw = F0 ? F0.raw : decode(b64), dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  n = Math.min(n, Math.floor(raw.byteLength / 7));
  const F = F0 || { n, raw, lat: new Float32Array(n), lon: new Float32Array(n), t: new Float64Array(n), e: new Uint8Array(n), h: new Uint32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
  const end = Math.min(n, to);
  for (let k = from; k < end; k++) {
    const o = 7 * k, a = dv.getUint16(o, true), b = dv.getUint16(o + 2, true), c = dv.getUint16(o + 4, true);
    const h = hash3(a, b, c), la = a / 65535 * 180 - 90, lo = b / 65535 * 360 - 180;
    F.lat[k] = la; F.lon[k] = lo; F.t[k] = T0 + c * 2 + (h % 1000) / 1000; F.e[k] = raw[o + 6]; F.h[k] = h;
    const cl = Math.cos(la * DEG);
    F.x[k] = cl * Math.cos(lo * DEG); F.y[k] = cl * Math.sin(lo * DEG); F.z[k] = Math.sin(la * DEG);
  }
  if (end >= n) delete F.raw;
  return F;
}
const L0 = decodeFlashes(LT.l0.data, LT.l0.n);
const L0_MOD = (M.l0 && M.l0.mod) || 128, L1_MOD = (M.l1 && M.l1.mod) || 8;
const DENS = (LT.density.hours || []).map((b) => {
  const raw = decode(b), u = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1), n = u.length >> 1;
  const idx = new Int32Array(n), cnt = new Uint16Array(n);
  let acc = 0;
  for (let k = 0; k < n; k++) { acc += u[2 * k]; idx[k] = acc; cnt[k] = u[2 * k + 1]; }
  return { idx, cnt };
});

const AUR = (() => {
  const fr = AU && AU.frames && AU.frames[0];
  if (!fr) return null;
  const raw = decode(fr.data), rows = fr.rows || 51, cols = 360 / (fr.lonStep || 2), g = new Uint8Array(362 * 181);
  for (let r = 0; r < rows; r++) for (let lon = 0; lon < 360; lon++) {
    const c = Math.floor(lon / (fr.lonStep || 2));
    g[(180 - r) * 362 + lon] = raw[r * cols + c];
    g[r * 362 + lon] = raw[(rows + r) * cols + c];
  }
  for (let r = 0; r < 181; r++) { g[r * 362 + 360] = g[r * 362]; g[r * 362 + 361] = g[r * 362 + 1]; }
  return { grid: g, obs: Date.parse(fr.obs) / 1000, valid: Date.parse(fr.valid) / 1000 };
})();

const st = {
  t: M.defaultT || T0, playing: false, speed: 900, live: false, lightA: 1, liveFade: null,
  sel: null, hover: null, emph: { light: 1, aurora: 1, hatch: 1, others: 1, dayTint: 0, focus: -1 }, stopAt: null,
};
const view = { lat: (M.defaultView || [0, -60])[0], lon: (M.defaultView || [0, -60])[1], k: 1, tween: null };
const phoneQ = matchMedia('(max-width: 699.98px)');
const HUD_BAND = 46;
const box = { w: 0, h: 0, dpr: 1, R: 1, cx: 0, cy: 0, capR: 0, capN: [0, 0], capS: [0, 0], phone: false };
let built = false, entered = false, G = null, glFail = '', imgs = null, ov = null, stripS = null, pill = null, whyEl = null;
let wrapAt = 0, wrapAlpha = 1, raf = 0, lastTs = 0, glDirty = true, lastSunPx = null;
let drawnFlashes = 0, gridState = '', lastGlAt = 0;
const eggs = { count: 0, last: null, at: 0 };
const stats = { drawn: [], level: 'L0', stride: 128, sub: 1, rate: 0 };
const live = createLive({ desktop: innerWidth >= 700, onUpdate });
const CLOUD_KEY = 'observatory.earth.clouds';
const clouds = { on: false, ready: false, loading: false, alpha: 0, time: 0, status: {}, err: '' };
function cloudPref() { try { return localStorage.getItem(CLOUD_KEY) === '1'; } catch { return false; } }
function setCloudPref(v) { try { if (v) localStorage.setItem(CLOUD_KEY, '1'); else localStorage.removeItem(CLOUD_KEY); } catch {} }
async function loadCloudLayer(fresh) {
  if (!G || clouds.loading) return;
  clouds.loading = true; clouds.err = ''; cloudUi();
  try {
    const r = await CL.loadClouds({ fresh });
    EG.uploadClouds(G, r.data, CL.W, CL.H);
    clouds.ready = true; clouds.time = r.time; clouds.status = r.status;
    if (clouds.on) fadeClouds(1);
  } catch (e) {
    clouds.err = 'The cloud imagery did not load.';
  } finally {
    clouds.loading = false; cloudUi(); redraw();
  }
}
function fadeClouds(to) {
  const from = clouds.alpha, t0 = performance.now();
  const step = (ts) => { const p = reduceMotion ? 1 : clamp((ts - t0) / 400, 0, 1); clouds.alpha = from + (to - from) * p; glDirty = true; if (entered) drawGl(); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function setClouds(on) {
  clouds.on = on; setCloudPref(on);
  if (on) { if (clouds.ready) fadeClouds(1); else loadCloudLayer(false); } else fadeClouds(0);
  cloudUi();
}
function cloudUi() {
  const b = $('#eClouds'), n = $('#eCloudNote');
  if (!b || !n) return;
  b.classList.toggle('on', clouds.on); b.setAttribute('aria-pressed', String(clouds.on));
  if (!G) { b.hidden = true; return; }
  n.hidden = !clouds.on;
  if (!clouds.on) return;
  if (!n.dataset.watch) {
    n.dataset.watch = '1';
    new ResizeObserver(() => { const w = n.parentElement; if (w) w.style.setProperty('--ecloud-h', `${n.offsetHeight}px`); }).observe(n);
  }
  const ok = CL.SOURCES.filter((s) => clouds.status[s.id]), bad = CL.SOURCES.filter((s) => clouds.status[s.id] === false);
  const when = clouds.loading ? 'Loading the cloud imagery…' : clouds.err ? clouds.err : `Clouds as of ${hhmm(clouds.time / 1000)} UTC, not the map’s time${bad.length ? ` · missing: ${bad.map((s) => s.label).join(', ')}` : ''}.`;
  n.innerHTML = `${esc(when)} <button class="link" type="button" id="eCloudRefresh"${clouds.loading ? ' hidden' : ''}>Refresh</button><span class="cred">Clouds: infrared imagery recoloured for this site, based on EUMETSAT Meteosat data, NOAA GOES and Himawari (Japan Meteorological Agency), via EUMETView and NASA GIBS.</span>`;
  n.title = ok.length ? `Loaded: ${ok.map((s) => s.label).join(', ')}` : '';
  const rb = $('#eCloudRefresh');
  if (rb) rb.addEventListener('click', () => loadCloudLayer(true));
}

function layout() {
  const cv = $('#earthGl'), r = cv.getBoundingClientRect();
  box.w = r.width; box.h = r.height;
  box.dpr = Math.min(window.devicePixelRatio || 1, r.width < 700 ? 1.5 : 2);
  box.phone = box.w < 600 || box.w / Math.max(1, box.h) < 1.7;
  const { w, h } = box;
  if (!box.phone) {
    box.R = 0.47 * h; box.cx = w / 2; box.cy = h / 2;
    box.capR = 0.26 * h; box.capN = [0.125 * w, 0.56 * h]; box.capS = [0.875 * w, 0.56 * h];
  } else {
    box.R = Math.min(0.42 * w, 0.46 * h); box.cx = w / 2; box.cy = box.R + 6 + (phoneQ.matches && h > 2 * box.R + 60 ? HUD_BAND : 0);
    box.capR = 0.105 * w; box.capN = [box.capR + 2, h - box.capR - 2]; box.capS = [w - box.capR - 2, h - box.capR - 2];
  }
  cv.width = Math.round(w * box.dpr); cv.height = Math.round(h * box.dpr);
  const o = $('#earthOv'); o.width = cv.width; o.height = cv.height;
  ov.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
  hazeCache.clear(); visKey = ''; glDirty = true;
  const h2 = $('#h-emap'), ttl = w < 600 ? 'Where is the night glowing?' : 'Where is the night sky glowing?';
  if (h2.firstChild && h2.firstChild.nodeType === 3 && h2.firstChild.nodeValue !== ttl) h2.firstChild.nodeValue = ttl;
  const sc = document.querySelector('.escale'), a = sc && sc.children[0], b = sc && sc.children[1];
  const lv = sc && sc.children[2];
  if (a && b && lv) {
    b.style.marginLeft = ''; a.style.visibility = '';
    const over = b.getBoundingClientRect().right + 8 - lv.getBoundingClientRect().left;
    if (over > 0) b.style.marginLeft = `${-over}px`;
    if (a.getBoundingClientRect().right + 8 > b.getBoundingClientRect().left) a.style.visibility = 'hidden';
  }
}
const Rk = () => box.R * view.k;
const capA = () => clamp((1.35 - view.k) / 0.2, 0, 1);
let basis = null;
function makeBasis() {
  const p = view.lat * DEG, l = view.lon * DEG;
  basis = { e: [-Math.sin(l), Math.cos(l), 0], n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], c: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] };
}
const P = { x: 0, y: 0, z: 0 };
function projV(x, y, z) {
  const b = basis, r = Rk();
  P.z = x * b.c[0] + y * b.c[1] + z * b.c[2];
  P.x = box.cx + r * (x * b.e[0] + y * b.e[1] + z * b.e[2]);
  P.y = box.cy - r * (x * b.n[0] + y * b.n[1] + z * b.n[2]);
  return P;
}
function projLL(lat, lon) { const cl = Math.cos(lat * DEG); return projV(cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG)); }
function invert(px, py) {
  const r = Rk(), x = (px - box.cx) / r, y = -(py - box.cy) / r, r2 = x * x + y * y;
  if (r2 >= 1) return null;
  const z = Math.sqrt(1 - r2), b = basis;
  const wx = x * b.e[0] + y * b.n[0] + z * b.c[0], wy = x * b.e[1] + y * b.n[1] + z * b.c[1], wz = x * b.e[2] + y * b.n[2] + z * b.c[2];
  return [Math.asin(clamp(wz, -1, 1)) / DEG, Math.atan2(wy, wx) / DEG];
}
function capHit(px, py) {
  if (capA() < 0.5) return 0;
  for (const [k, c] of [[1, box.capN], [-1, box.capS]]) if (Math.hypot(px - c[0], py - c[1]) < box.capR) return k;
  return 0;
}
function capProj(sgn, lat, lon, t) {
  const [, sl] = sunLL(t), c = sgn > 0 ? box.capN : box.capS;
  const rho = Math.cos(lat * DEG) / Math.SQRT1_2, th = (lon - sl) * DEG;
  return [c[0] - sgn * rho * box.capR * Math.sin(th), c[1] - rho * box.capR * Math.cos(th)];
}
function viewChanged() { makeBasis(); glDirty = true; visKey = ''; }

const tokens = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  for (const [k, n] of [['nightSea', '--night-sea'], ['nightLand', '--night-land'], ['daySea', '--day-sea'], ['dayLand', '--day-land'], ['lights', '--lights'], ['aurora', '--aurora'], ['auroraHi', '--aurora-hi'], ['bolt', '--bolt'], ['ember', '--ember'], ['sprite', '--sprite'], ['spriteTail', '--sprite-tail'], ['live', '--live']]) tokens[k] = g(n);
  atlas = null; hazeCache.clear(); glDirty = true;
}
function glColors() {
  const c = C(), h = EG.hexRgb, rgb = (x) => { const v = SC.rgbOf(x); return v.map((u) => u / 255); };
  return { NightSea: h(tokens.nightSea), NightLand: h(tokens.nightLand), DaySea: h(tokens.daySea), DayLand: h(tokens.dayLand), LightsC: h(tokens.lights), Gold: rgb(c.gold), Grid: rgb(c.ink), Ink: rgb(c.ink), Aur: h(tokens.aurora), AurHi: h(tokens.auroraHi), Tint: rgb(c.band.r), Cloud: c.dark ? rgb(SC.mixColor(c.ink, tokens.daySea, 0.18)) : [0.985, 0.98, 0.965] };
}
let glCol = null;

function covVec(k) {
  const c = COV.filter((x) => x.state !== 'off')[k];
  return c ? [c.lon, c.angle || 60, c.lat || 56, 1] : [0, 0, 0, 0];
}
function isCovered(lat, lon) {
  return COV.some((c) => c.state !== 'off' && Math.abs(lat) <= (c.lat || 56) && Math.cos(lat * DEG) * Math.cos((lon - c.lon) * DEG) >= Math.cos((c.angle || 60) * DEG));
}

let liveGrid = null;
function auroraParams(t) {
  if (st.live && liveGrid) return { mode: 'live', shiftA: 0, shiftB: 0, mix: 0 };
  if (!AUR) return null;
  const s = (tt) => wrapLon(sunLL(AUR.obs)[1] - sunLL(tt)[1]);
  if (wrapAt && wrapAlpha < 1) return { mode: 'nightly', shiftA: s(T1), shiftB: s(T0), mix: 1 - wrapAlpha };
  return { mode: 'nightly', shiftA: s(t), shiftB: s(t), mix: 0 };
}
function ensureGrid(mode) {
  if (!G || gridState === mode) return;
  const grid = mode === 'live' ? liveGrid.grid : AUR ? AUR.grid : new Uint8Array(362 * 181);
  EG.uploadGrid(G, 2, grid); EG.uploadGrid(G, 3, grid);
  gridState = mode;
}
function auroraAt(lat, lon, t) {
  const a = auroraParams(t);
  if (!a) return null;
  const grid = a.mode === 'live' ? liveGrid.grid : AUR.grid;
  const lo = ((lon + a.shiftA) % 360 + 360) % 360, r = Math.round(lat + 90);
  return grid[clamp(r, 0, 180) * 362 + Math.round(lo) % 360];
}
function ovalEdge(lon, hemi, t) {
  let edge = null;
  for (let la = 89; la >= 40; la--) { const v = auroraAt(hemi * la, lon, t); if (v != null && v >= 10) edge = la; }
  return edge;
}

function drawGl() {
  if (!box.w || !imgs) return;
  glDirty = false;
  const t = st.t, [sd, sl] = sunLL(t), a = auroraParams(t);
  if (!G) { drawFallback(t, sd, sl, a); return; }
  ensureGrid(a ? a.mode : 'none');
  const d = box.dpr, em = st.emph;
  if (!glCol) glCol = glColors();
  EG.drawGl(G, {
    globe: [box.cx * d, box.cy * d, Rk() * d], view: [view.lat * DEG, view.lon * DEG],
    capN: [box.capN[0] * d, box.capN[1] * d, box.capR * d], capS: [box.capS[0] * d, box.capS[1] * d, box.capR * d], capA: capA(),
    sun: [sd * DEG, sl * DEG], ovMix: a ? a.mix : 0, ovShift: a ? [a.shiftA, a.shiftB] : [0, 0],
    aurGain: (a ? 1 : 0) * em.aurora * (st.live || !wrapAt ? 1 : 0.4 + 0.6 * wrapAlpha), hatchA: em.hatch * (C().dark ? 1 : 1.15), dayTint: em.dayTint, dpr: d,
    cov: [covVec(0), covVec(1), covVec(2)], colors: glCol, dark: C().dark, cloudA: clouds.on && clouds.ready ? clouds.alpha : 0,
  });
  lastSunPx = [sd, sl, view.k]; lastGlAt = performance.now();
}
let fbData = null;
function drawFallback(t, sd, sl, a) {
  const cv = $('#earthGl'), g = cv.getContext('2d');
  if (!g) return;
  if (!fbData) {
    const sample = (im, w) => { const c = document.createElement('canvas'); c.width = w; c.height = w / 2; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, w / 2); return x.getImageData(0, 0, w, w / 2).data; };
    fbData = { lights: sample(imgs.lights, 1024), land: sample(imgs.land, 1024) };
  }
  const W = Math.ceil(box.w / 2), H = Math.ceil(box.h / 2), im = g.createImageData(W, H), px = im.data;
  const col = (n) => SC.rgbOf(tokens[n]), ns = col('nightSea'), nl = col('nightLand'), ds = col('daySea'), dl = col('dayLand'), li = col('lights'), au = col('aurora');
  const sv = [Math.cos(sd * DEG) * Math.cos(sl * DEG), Math.cos(sd * DEG) * Math.sin(sl * DEG), Math.sin(sd * DEG)];
  const shade = (lat, lon, aur) => {
    const u = Math.min(1023, Math.floor((lon + 180) / 360 * 1024)), v = Math.min(511, Math.floor((90 - lat) / 180 * 512)), k = (v * 1024 + u) * 4;
    const land = fbData.land[k] / 255, L = clamp((fbData.lights[k] / 255 - 0.07) / 0.68, 0, 1);
    const cl = Math.cos(lat * DEG), cz = cl * Math.cos(lon * DEG) * sv[0] + cl * Math.sin(lon * DEG) * sv[1] + Math.sin(lat * DEG) * sv[2];
    const day = clamp((cz + 0.3) / 0.35, 0, 1), night = 1 - clamp((cz + 0.2) / 0.22, 0, 1), lw = clamp(L * night, 0, 1);
    const out = [0, 1, 2].map((c) => { const n = ns[c] + (nl[c] - ns[c]) * land, dd = ds[c] + (dl[c] - ds[c]) * land; const b = n + (dd - n) * day; return b + (li[c] - b) * lw; });
    if (aur) { const v2 = auroraAt(lat, lon, t) || 0, aa = clamp((v2 - 4) / 41, 0, 1) * (1 - 0.85 * day) * st.emph.aurora; for (let c = 0; c < 3; c++) out[c] = out[c] * (1 - 0.2 * aa) + au[c] * aa; }
    return out;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x * 2 + 1, sy = y * 2 + 1, o = (y * W + x) * 4;
    const ll = invert(sx, sy);
    let c = null;
    if (ll) c = shade(ll[0], ll[1], !!a);
    else if (capA() > 0.5) {
      for (const [sgn, cc] of [[1, box.capN], [-1, box.capS]]) {
        const qx = (sx - cc[0]) / box.capR, qy = (sy - cc[1]) / box.capR, rr = qx * qx + qy * qy;
        if (rr >= 1) continue;
        const lat = sgn * Math.acos(clamp(Math.sqrt(rr) * Math.SQRT1_2, 0, 1)) / DEG, lon = wrapLon(sl + Math.atan2(-sgn * qx, -qy) / DEG);
        c = shade(lat, lon, !!a);
      }
    }
    if (!c) continue;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(im, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 0, 0, cv.width, cv.height);
}

let atlas = null;
function makeAtlas() {
  const s = 64, c = document.createElement('canvas'); c.width = s * 3; c.height = s;
  const g = c.getContext('2d'), dk = C().dark;
  const halo = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  halo.addColorStop(0, tokens.ember); halo.addColorStop(0.25, SC.mixColor(tokens.ember, C().paper, dk ? 0.35 : 0.2)); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = dk ? 0.7 : 0.55; g.fillStyle = halo; g.fillRect(0, 0, s, s);
  g.globalAlpha = 1;
  const core = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.16);
  core.addColorStop(0, tokens.bolt); core.addColorStop(0.6, tokens.bolt); core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core; g.fillRect(0, 0, s, s);
  const em = SC.rgbOf(tokens.ember).join(','), dot = g.createRadialGradient(s * 1.5, s / 2, 0, s * 1.5, s / 2, s / 2);
  dot.addColorStop(0, `rgba(${em},1)`); dot.addColorStop(0.45, `rgba(${em},0.45)`); dot.addColorStop(1, `rgba(${em},0)`);
  g.fillStyle = dot; g.fillRect(s, 0, s, s);
  const sp = g.createRadialGradient(s * 2.5, s / 2, 0, s * 2.5, s / 2, s / 2);
  sp.addColorStop(0, '#ff8c6e'); sp.addColorStop(0.35, tokens.sprite); sp.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sp; g.fillRect(2 * s, 0, s, s);
  atlas = { c, s, dark: dk };
}

const hazeCache = new Map();
let visKey = '', visRate = 0;
function viewKey() { return `${view.lat.toFixed(3)},${view.lon.toFixed(3)},${view.k.toFixed(3)},${box.w}x${box.h}`; }
const CELLV = new Float32Array(64800 * 3).fill(NaN);
function cellVisible(idx) {
  const o = idx * 3;
  if (Number.isNaN(CELLV[o])) {
    const lat = (Math.floor(idx / 360) - 89.5) * DEG, lon = ((idx % 360) - 179.5) * DEG, cl = Math.cos(lat);
    CELLV[o] = cl * Math.cos(lon); CELLV[o + 1] = cl * Math.sin(lon); CELLV[o + 2] = Math.sin(lat);
  }
  const p = projV(CELLV[o], CELLV[o + 1], CELLV[o + 2]);
  if (p.z <= 0 || p.x < -10 || p.y < -10 || p.x > box.w + 10 || p.y > box.h + 10) return null;
  return p;
}
function hourOf(t) { return clamp(Math.floor((t - T0) / 3600), 0, HOURS - 1); }
function rateInView(h) {
  const key = `${viewKey()}|${h}`;
  if (key === visKey) return visRate;
  const D = DENS[h];
  let n = 0;
  if (D) for (let k = 0; k < D.idx.length; k++) if (cellVisible(D.idx[k])) n += D.cnt[k];
  visKey = key; visRate = n;
  return n;
}
function buildHaze(h) {
  const key = `${h}|${viewKey()}|${C().dark}`;
  if (hazeCache.has(key)) return hazeCache.get(key);
  const t0 = performance.now();
  const q = 4, W = Math.max(1, Math.round(box.w / q)), H = Math.max(1, Math.round(box.h / q));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), cellPx = Rk() * DEG / q;
  const paths = Array.from({ length: 8 }, () => new Path2D()), used = new Uint8Array(8);
  for (const [hh, w] of [[h, 1], [h - 1, Math.exp(-2)]]) {
    const D = DENS[hh];
    if (!D) continue;
    for (let k = 0; k < D.idx.length; k++) {
      const p = cellVisible(D.idx[k]);
      if (!p) continue;
      const a = Math.min(1, Math.log10(1 + D.cnt[k]) / 4) * w * smooth(0, 0.06, p.z);
      if (a < 0.02) continue;
      const b = Math.min(7, Math.floor(a * 8)), r = Math.max(0.75, cellPx * 0.75 * Math.max(0.35, p.z));
      paths[b].rect(p.x / q - r, p.y / q - r, 2 * r, 2 * r); used[b] = 1;
    }
  }
  g.fillStyle = tokens.ember;
  for (let b = 0; b < 8; b++) if (used[b]) { g.globalAlpha = (b + 0.5) / 8; g.fill(paths[b]); }
  let out = c;
  if ('filter' in g) {
    out = document.createElement('canvas'); out.width = W; out.height = H;
    const o = out.getContext('2d'); o.filter = `blur(${clamp(cellPx * 0.6, 1, 3).toFixed(1)}px)`; o.drawImage(c, 0, 0);
  }
  if (hazeCache.size > 6) hazeCache.delete(hazeCache.keys().next().value);
  hazeCache.set(key, out);
  K.pushPerf(K.perf.haze || (K.perf.haze = []), performance.now() - t0);
  return out;
}
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

const tiles = new Map();
function tileIdAt(lat, lon) {
  const T = E.tiles || {};
  let i = clamp(Math.floor((lat + 90) / 30), 0, 5), j = clamp(Math.floor((lon + 180) / 30), 0, 11), id = `lt-${i}-${j}`, la0 = -90 + i * 30, lo0 = -180 + j * 30, size = 30;
  while (!T[id] && size > 3.75) {
    size /= 2;
    const q = (lat >= la0 + size ? 2 : 0) + (lon >= lo0 + size ? 1 : 0);
    if (q & 2) la0 += size;
    if (q & 1) lo0 += size;
    id += `-${q}`;
  }
  return T[id] ? id : null;
}
function tilesInView() {
  if (view.k < 3) return [];
  const ids = new Set();
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 9; j++) {
    const ll = invert(box.w * i / 12, box.h * j / 9);
    if (!ll) continue;
    const id = tileIdAt(ll[0], ll[1]);
    if (id) ids.add(id);
  }
  return [...ids];
}
function loadTiles() {
  for (const id of tilesInView()) {
    if (tiles.has(id)) continue;
    tiles.set(id, null);
    fetch(`data/earth-tiles/${id}.json?v=${E.tiles[id]}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j) { tiles.delete(id); return; }
      const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 0));
      let F = null, at = 0;
      const step = () => {
        const t0 = performance.now();
        if (!F) F = decodeFlashes(j.data, j.n, 0, 0);
        else { F = decodeFlashes(null, j.n, at, at + 3000, F); at += 3000; }
        K.pushPerf(K.perf.tile || (K.perf.tile = []), performance.now() - t0);
        if (at < F.n) idle(step); else { tiles.set(id, F); visKey = ''; }
      };
      idle(step);
    }).catch(() => tiles.delete(id));
  }
}

function budget(speed = st.speed) {
  const h = hourOf(st.t), n = rateInView(h), D = box.phone ? 18 : 30;
  const r = n / 3600 * speed;
  const s = Math.max(1, r / D);
  stats.rate = r;
  const loaded = tilesInView().filter((id) => tiles.get(id));
  if (s >= L0_MOD || !loaded.length) { stats.level = 'L0'; stats.sub = Math.max(1, Math.round(s / L0_MOD)); stats.stride = L0_MOD * stats.sub; }
  else { stats.level = 'L1'; stats.sub = Math.max(1, s / L1_MOD < 4 ? Math.ceil(s / L1_MOD - 0.15) : Math.round(s / L1_MOD)); stats.stride = L1_MOD * stats.sub; }
  stats.loaded = new Set(loaded);
  return stats;
}
function pillText() {
  if (!pill) return;
  const phone = box.w < 600;
  if (st.live) { pill.set(phone ? 'No lightning after the nightly update' : `No lightning after ${hhmm(T1)} UTC · it arrives with tonight's update`, '', 'live'); return; }
  const total = fmtM(M.flashes || 0);
  if (stats.level === 'L1' && stats.sub <= 1) pill.set(phone ? '1 in 8 stored, all drawn' : '1 in 8 stored, all drawn', 'Why?', 'why');
  else if (stats.level === 'L1') pill.set(phone ? `1 in ${fmtN(stats.stride)} flashes` : `Drawing 1 in ${fmtN(stats.stride)} at this zoom`, 'Why?', 'why');
  else pill.set(phone ? `1 in ${fmtN(stats.stride)} flashes` : `Drawing 1 in ${fmtN(stats.stride)} of ${total} flashes`, 'Why?', 'why');
}

const active = [];
const IDLE_WIN = 120;
const idle = { on: false, t0: 0, prev: 0, timer: 0, wake: false };
const idleOk = () => entered && !st.playing && !st.live && !reduceMotion && !document.hidden;
function idleSpawn(nowMs) {
  if (!idle.on) { idle.on = true; idle.t0 = nowMs; idle.prev = 0; return; }
  const a = idle.prev, b = (nowMs - idle.t0) / 1000;
  idle.prev = b;
  if (b <= a) return;
  const base = st.t - IDLE_WIN, wa = a % IDLE_WIN, wb = b % IDLE_WIN;
  if (b - a >= IDLE_WIN) spawn(base, st.t, nowMs);
  else if (Math.floor(b / IDLE_WIN) > Math.floor(a / IDLE_WIN)) { spawn(base + wa, st.t, nowMs); spawn(base, base + wb, nowMs); }
  else spawn(base + wa, base + wb, nowMs);
}
function idleStop() { idle.on = false; if (idle.timer) { clearTimeout(idle.timer); idle.timer = 0; } }
function idleSleep() {
  if (idle.timer || !idleOk()) return;
  idle.timer = setTimeout(() => { idle.timer = 0; idle.wake = true; loop(); }, 220);
}
const eggList = [], eggQueue = [];
let lastData = null, drawnLog = [];
function keep(F, k, level, inTile) {
  if (level === 'L0') return F.h[k] % stats.sub === 0;
  if (!inTile) return true;
  return F.h[k] % stats.sub === 0;
}
function spawn(tA, tB, now) {
  if (tB <= tA) return;
  const lv = stats.level;
  const visit = (F, isTile) => {
    let k = lb(F.t, tA);
    for (; k < F.n && F.t[k] < tB; k++) {
      if (!isTile && lv === 'L1' && stats.loaded.has(tileIdAt(F.lat[k], F.lon[k]))) continue;
      if (!keep(F, k, lv, isTile)) continue;
      const p = projV(F.x[k], F.y[k], F.z[k]);
      if (p.z <= 0.02 || p.x < 0 || p.y < 0 || p.x > box.w || p.y > box.h) continue;
      const f = { F, k, born: now + (F.t[k] - tA) / Math.max(1, tB - tA) * 16, dbl: F.h[k] % 10 < 3, boost: 1 };
      if (st.playing || idle.on) {
        drawnFlashes++;
        drawnLog.push(now);
        if (drawnFlashes % EGG_EVERY === 0) {
          const egg = { F, k, type: F.e[k] >= 230 ? 'elves' : 'sprite', born: f.born + 20 };
          f.boost = 1.3;
          eggs.count++; eggs.last = egg.type; eggs.at = F.t[k];
          if (eggList.length < 2) eggList.push(egg); else eggQueue.push(egg);
        }
      }
      if (active.length < 600) active.push(f);
    }
  };
  visit(L0, false);
  if (lv === 'L1') for (const id of stats.loaded) { const F = tiles.get(id); if (F) visit(F, true); }
}

function drawFlashes(g, now) {
  if (!atlas) makeAtlas();
  const dk = C().dark, sk = Math.min(2, Math.sqrt(view.k)), a0 = st.lightA * st.emph.light * wrapAlpha;
  g.globalCompositeOperation = dk ? 'lighter' : 'source-over';
  let w = 0;
  const dots = active.length > 300;
  for (let i = 0; i < active.length; i++) {
    const f = active[i], age = now - f.born;
    if (age > 350) continue;
    active[w++] = f;
    if (age < 0) continue;
    const { F, k } = f;
    const p = projV(F.x[k], F.y[k], F.z[k]);
    if (p.z <= 0) continue;
    let a;
    if (reduceMotion) a = age < 150 ? age / 150 : 1 - (age - 150) / 200;
    else { a = age < 40 ? age / 40 : Math.exp(-(age - 40) / 120); if (f.dbl && age > 80) a += 0.6 * Math.exp(-Math.max(0, age - 120) / 90) * Math.min(1, (age - 80) / 40); }
    a = clamp(a * f.boost * a0 * smooth(0, 0.06, p.z) * (dk ? 1 : 1.15), 0, 1);
    if (a < 0.01) continue;
    const r = (2.6 + 3.2 * F.e[k] / 255) * sk;
    if (dots || reduceMotion) { g.globalAlpha = a; g.fillStyle = reduceMotion ? tokens.ember : tokens.bolt; g.fillRect(p.x - r / 2, p.y - r / 2, r, r); continue; }
    const S = r * 6.2;
    g.globalAlpha = a;
    g.drawImage(atlas.c, 0, 0, atlas.s, atlas.s, p.x - S / 2, p.y - S / 2, S, S);
  }
  active.length = w;
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

function drawEmbers(g) {
  const t = st.t, a0 = 0.35 * st.lightA * st.emph.light * wrapAlpha;
  if (a0 < 0.01) return;
  g.fillStyle = tokens.ember;
  const lv = stats.level;
  const buckets = [[], [], [], []];
  const visit = (F, isTile) => {
    let k = lb(F.t, t - 3600);
    const end = lb(F.t, t, k);
    if (end - k > 6000) k = end - 6000;
    for (; k < end; k++) {
      if (!isTile && lv === 'L1' && stats.loaded.has(tileIdAt(F.lat[k], F.lon[k]))) continue;
      const p = projV(F.x[k], F.y[k], F.z[k]);
      if (p.z <= 0 || p.x < 0 || p.y < 0 || p.x > box.w || p.y > box.h) continue;
      const age = (t - F.t[k]) / 3600;
      buckets[clamp(Math.floor(age * 4), 0, 3)].push(p.x, p.y);
    }
  };
  visit(L0, false);
  if (lv === 'L1') for (const id of stats.loaded) { const F = tiles.get(id); if (F) visit(F, true); }
  buckets.forEach((b, q) => {
    if (!b.length) return;
    g.globalAlpha = a0 * (1 - q / 4) * (C().dark ? 1 : 1.15);
    g.beginPath();
    for (let i = 0; i < b.length; i += 2) g.rect(b[i] - 0.5, b[i + 1] - 0.5, 1, 1);
    g.fill();
  });
  g.globalAlpha = 1;
}

function drawEggs(g, now) {
  if (!eggList.length) return;
  const dk = C().dark;
  for (let i = eggList.length - 1; i >= 0; i--) {
    const e = eggList[i], age = now - e.born, life = reduceMotion ? 900 : e.type === 'sprite' ? 800 : 700;
    if (age > life) { eggList.splice(i, 1); if (eggQueue.length) { const n = eggQueue.shift(); n.born = now + 20; eggList.push(n); } continue; }
    if (age < 0) continue;
    const { F, k } = e, p = projV(F.x[k], F.y[k], F.z[k]);
    if (p.z <= 0) continue;
    const r = Rk(), ux = (p.x - box.cx) / r, uy = (p.y - box.cy) / r, um = Math.hypot(ux, uy);
    const dir = um > 1e-3 ? [ux / um, uy / um] : [0, -1];
    g.save();
    g.globalCompositeOperation = dk ? 'lighter' : 'source-over';
    if (e.type === 'sprite') drawSprite(g, p.x, p.y, dir, um, age, r, dk);
    else drawElves(g, p.x, p.y, dir, um, Math.sqrt(Math.max(0, 1 - um * um)), age, r, dk);
    g.restore();
  }
}
function drawSprite(g, x, y, dir, um, age, r, dk) {
  let grow, alpha;
  if (reduceMotion) { grow = 1; alpha = age < 150 ? age / 150 : age < 750 ? 1 : 1 - (age - 750) / 150; }
  else { const p = clamp(age / 120, 0, 1); grow = 1 - (1 - p) ** 3; alpha = age < 320 ? 1 : 1 - (age - 320) / 480; }
  alpha = clamp(alpha, 0, 1) * (dk ? 0.85 : 0.8) * st.lightA;
  if (alpha <= 0.01) return;
  const sigma = clamp(1.4 * um, 0, 1), E2 = Math.max(6, 26 / (75 / 6371 * r));
  const hPx = 75 / 6371 * r * E2 * sigma, scale = Math.min(2, Math.sqrt(view.k));
  const hx = x + dir[0] * hPx, hy = y + dir[1] * hPx, ang = Math.atan2(dir[1], dir[0]) + Math.PI / 2;
  const tail = 30 / 75 * hPx * grow + 6 * scale * grow * (1 - sigma);
  g.translate(hx, hy); g.rotate(ang);
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const off = (i - 4) * 2.2 * scale, len = tail * (0.7 + 0.3 * Math.sin(i * 1.7 + 0.5) ** 2);
    const gr = g.createLinearGradient(off, 4 * scale, off * 1.25, 4 * scale + len);
    gr.addColorStop(0, tokens.sprite); gr.addColorStop(1, tokens.spriteTail);
    g.strokeStyle = gr; g.globalAlpha = alpha * 0.55; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(off * 0.6, 3 * scale); g.quadraticCurveTo(off * 1.1, 4 * scale + len * 0.5, off * 1.3, 4 * scale + len); g.stroke();
  }
  g.strokeStyle = tokens.sprite;
  for (let i = 0; i < 5; i++) { const off = (i - 2) * 3 * scale; g.globalAlpha = alpha * 0.25; g.lineWidth = 0.7; g.beginPath(); g.moveTo(off, -6 * scale); g.lineTo(off * 1.2, -6 * scale - 10 * scale * grow); g.stroke(); }
  const hw = 13 * scale * (0.4 + 0.6 * grow), hh = 9 * scale * (0.4 + 0.6 * grow) * (0.55 + 0.45 * sigma);
  g.globalAlpha = alpha;
  g.drawImage(atlas.c, atlas.s * 2, 0, atlas.s, atlas.s, -hw * 1.6, -hh * 1.6, hw * 3.2, hh * 3.2);
}
function drawElves(g, x, y, dir, um, z, age, r, dk) {
  const rmax = Math.max(300 / 6371 * r, 40);
  let rho, alpha;
  if (reduceMotion) { rho = 0.7 * rmax; alpha = age < 150 ? age / 150 : age < 750 ? 1 : 1 - (age - 750) / 150; }
  else { const p = clamp(age / 700, 0, 1); rho = rmax * (1 - (1 - p) ** 3); alpha = (1 - p) ** 2; }
  alpha = clamp(alpha, 0, 1) * st.lightA;
  if (alpha <= 0.01 || rho < 1) return;
  const lift = 90 / 6371 * r * um;
  g.translate(x + dir[0] * lift, y + dir[1] * lift); g.rotate(Math.atan2(dir[1], dir[0]));
  const minor = rho * Math.max(0.12, z);
  g.strokeStyle = tokens.sprite;
  g.globalAlpha = alpha * 0.16; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, minor, rho, 0, 0, 6.2832); g.stroke();
  g.globalAlpha = alpha * 0.1; g.fillStyle = tokens.sprite; g.fill();
  g.globalAlpha = alpha * (dk ? 0.9 : 0.8); g.lineWidth = 1.5; g.stroke();
}

function stormsAt(h) {
  const out = [];
  CELLS.forEach((c, i) => { const tr = c.track.find((r) => r[0] === h); if (tr) out.push({ i, lat: tr[1], lon: tr[2], n: tr[3] }); });
  return out.sort((a, b) => b.n - a.n);
}
let ringList = [];
const TRACKS = CELLS.map((c) => new Map(c.track.map((r) => [r[0], r])));
function stormsNow(t) {
  const u = (t - T0) / 3600 - 0.5, h0 = Math.floor(u), w = clamp(u - h0, 0, 1), out = [];
  CELLS.forEach((c, i) => {
    const a = TRACKS[i].get(h0), b = TRACKS[i].get(h0 + 1);
    if (!a && !b) return;
    if (a && b) out.push({ i, lat: a[1] + (b[1] - a[1]) * w, lon: a[2] + wrapLon(b[2] - a[2]) * w, n: a[3] + (b[3] - a[3]) * w, fade: 1 });
    else { const r = a || b, f = a ? 1 - w : w; out.push({ i, lat: r[1], lon: r[2], n: r[3], fade: smooth(0, 1, f) }); }
  });
  return out.sort((x, y) => y.n * y.fade - x.n * x.fade);
}
const ringR = (n) => (3 + Math.sqrt(n) / 6) * Math.min(2, Math.sqrt(view.k));
function drawTrack(g, c, i) {
  const pts = [...TRACKS[i].values()].sort((x, y) => x[0] - y[0]);
  g.strokeStyle = C().hi; g.fillStyle = C().hi; g.lineWidth = 1.2; g.globalAlpha = 0.55;
  g.beginPath();
  let on = false;
  for (const r of pts) {
    const p = projLL(r[1], r[2]);
    if (p.z <= 0.05) { on = false; continue; }
    if (on) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
    on = true;
  }
  g.stroke();
  for (const r of pts) { const p = projLL(r[1], r[2]); if (p.z > 0.05) { g.beginPath(); g.arc(p.x, p.y, 1.6, 0, 6.2832); g.fill(); } }
  g.globalAlpha = 1;
}
function drawRings(g) {
  const list = st.live ? [] : stormsNow(st.t);
  ringList = [];
  const a0 = st.lightA * wrapAlpha;
  g.strokeStyle = tokens.ember; g.lineWidth = 1;
  for (const s of list) {
    if (ringList.length >= 8) break;
    const p = projLL(s.lat, s.lon);
    if (p.z <= 0.05 || p.x < 0 || p.y < 0 || p.x > box.w || p.y > box.h || s.fade < 0.05) continue;
    const r = ringR(s.n);
    if (ringList.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < q.r)) continue;
    const dim = st.emph.focus >= 0 && st.emph.focus !== s.i ? st.emph.others : 1, rank = ringList.length;
    ringList.push({ ...s, x: p.x, y: p.y, r });
    g.globalAlpha = (rank < 3 ? 0.55 : 0.3) * a0 * dim * s.fade;
    g.beginPath(); g.arc(p.x, p.y, r, 0, 6.2832); g.stroke();
  }
  g.globalAlpha = 1;
  const sel = st.sel && st.sel.type === 'storm' ? CELLS[st.sel.i] : null;
  if (sel) {
    drawTrack(g, sel, st.sel.i);
    const now = list.find((x) => x.i === st.sel.i), h = hourOf(st.t);
    const tr = now ? [h, now.lat, now.lon, now.n] : sel.track.reduce((a, r) => (Math.abs(r[0] - h) < Math.abs(a[0] - h) ? r : a));
    const p = projLL(tr[1], tr[2]);
    if (p.z > 0) {
      const r = ringR(tr[3]) + 2;
      g.strokeStyle = C().hi; g.lineWidth = 2; g.globalAlpha = now ? 1 : 0.5; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.2832); g.stroke(); g.globalAlpha = 1;
      const dx = p.x - box.cx, dy = p.y - box.cy, m = Math.hypot(dx, dy) || 1, lx = p.x + dx / m * (r + 18), ly = p.y + dy / m * (r + 18);
      g.strokeStyle = C().ink; g.lineWidth = 1; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(p.x + dx / m * r, p.y + dy / m * r); g.lineTo(lx, ly); g.stroke(); g.globalAlpha = 1;
      annotate(g, sel.name.replace(/^Storm over /, ''), clamp(lx, 60, box.w - 60), clamp(ly + (dy > 0 ? 14 : -4), 16, box.h - 8), { size: 17, color: C().ink, align: dx >= 0 ? 'left' : 'right' });
    }
  }
  if (st.sel && st.sel.type === 'place') {
    const p = projLL(st.sel.lat, st.sel.lon);
    if (p.z > 0) { g.strokeStyle = C().hi; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 7, 0, 6.2832); g.stroke(); }
  }
}

function drawFrameBits(g) {
  const c = C(), r = Rk(), ca = capA();
  g.save();
  g.beginPath(); g.arc(box.cx, box.cy, r + 3, 0, 6.2832);
  g.strokeStyle = tokens.daySea; g.globalAlpha = 0.15; g.lineWidth = 6; g.stroke();
  g.globalAlpha = 0.6; g.strokeStyle = c.gold; g.lineWidth = 1; g.beginPath(); g.arc(box.cx, box.cy, r, 0, 6.2832); g.stroke();
  g.restore();
  if (ca <= 0) return;
  const t = st.live ? nowS() : st.t;
  g.save(); g.globalAlpha = ca;
  for (const [sgn, cc] of [[1, box.capN], [-1, box.capS]]) {
    g.strokeStyle = c.grid; g.lineWidth = 1;
    for (let la = 50; la < 90; la += 10) { const rho = Math.cos(la * DEG) / Math.SQRT1_2 * box.capR; g.beginPath(); g.arc(cc[0], cc[1], rho, 0, 6.2832); g.stroke(); }
    g.strokeStyle = c.gold; g.globalAlpha = 0.6 * ca; g.beginPath(); g.arc(cc[0], cc[1], box.capR, 0, 6.2832); g.stroke();
    const mp = MAG_POLES[sgn > 0 ? 0 : 1], [mx, my] = capProj(sgn, mp[0], mp[1], t);
    g.globalAlpha = ca; g.lineWidth = 1.2; g.beginPath(); g.arc(mx, my, 2.5, 0, 6.2832); g.stroke();
    if (!box.phone) {
      const y = cc[1] + box.capR + 14, room = sgn < 0 || y + 14 < box.h - 46;
      if (sgn < 0 || y < box.h - 44) text(g, sgn > 0 ? 'North' : 'South', cc[0], y, { size: 13, weight: 600, color: c.ink2, align: 'center', halo: true });
      if (room) text(g, 'noon at top · to 45°', cc[0], y + 14, { size: 11, color: c.ink3, align: 'center', halo: true });
    } else text(g, sgn > 0 ? 'N' : 'S', cc[0], cc[1] - box.capR - 5, { size: 12, weight: 600, color: c.ink2, align: 'center', halo: true });
  }
  g.restore();
}
function provenanceLine() {
  if (st.live) {
    const v = liveGrid ? `aurora: OVATION, live, valid ${hhmm(liveGrid.valid)}` : AUR ? `aurora: OVATION run ${hhmm(AUR.obs)}, turned with the Sun` : 'aurora: no model run';
    return `${v} · no lightning after ${hhmm(T1)}`;
  }
  const a = AUR ? `aurora: OVATION run ${hhmm(AUR.obs)}, turned with the Sun to ${hhmm(st.t)}` : 'aurora: no model run kept';
  return `${a} · lightning: ${LI_ON ? "GLM and MTG LI" : "GLM"}, 1 h trail`;
}
function provenanceShort() {
  if (st.live) return liveGrid ? `aurora: OVATION live, valid ${hhmm(liveGrid.valid)}` : 'aurora: OVATION, turned with the Sun';
  return `aurora: model run ${AUR ? hhmm(AUR.obs) : 'none'} · lightning: ${LI_ON ? 'GLM, MTG LI' : 'GLM'}, 1 h trail`;
}
function drawOverlay(now) {
  if (!box.w || !entered) return;
  const g = ov, c = C();
  g.clearRect(0, 0, box.w, box.h);
  if (!st.live || st.lightA > 0) {
    const h = hourOf(st.t), f = clamp((st.t - T0) / 3600 - h, 0, 1);
    const hA = buildHaze(h), hB = h + 1 < HOURS ? buildHaze(h + 1) : null;
    const base = (c.dark ? 0.55 : 0.65) * st.lightA * st.emph.light * wrapAlpha;
    g.save();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.globalAlpha = base * (hB ? 1 - f : 1); g.drawImage(hA, 0, 0, box.w, box.h);
    if (hB) { g.globalAlpha = base * f; g.drawImage(hB, 0, 0, box.w, box.h); }
    g.restore(); g.globalAlpha = 1;
    drawEmbers(g);
  }
  drawFlashes(g, now);
  drawEggs(g, now);
  drawRings(g);
  drawFrameBits(g);
  if (!box.phone) {
    text(g, fmtUtc(st.live ? nowS() : st.t), 16, box.h - 30, { size: 16, weight: 600, color: c.ink, halo: true });
    text(g, provenanceLine(), 16, box.h - 12, { size: 12, color: c.ink3, halo: true });
  } else if (box.w >= 600) {
    const room = box.w - 4 * box.capR - 24, line = provenanceLine();
    g.font = K.font(11);
    const str = g.measureText(line).width <= room ? line : provenanceShort();
    if (g.measureText(str).width <= room) text(g, str, box.cx, box.h - 8, { size: 11, color: c.ink3, align: 'center', halo: true });
  }
  if (glFail) text(g, glFail, 16, 52, { size: 12, color: c.ink2, halo: true });
}

function frame(ts) {
  raf = 0;
  if (!entered) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  if (lastTs) K.pushPerf(K.perf.frame, ts - lastTs);
  lastTs = ts;
  const c0 = performance.now();
  let moving = false;
  if (view.tween) { stepTween(ts); moving = true; }
  if (st.liveFade) { const p = clamp((ts - st.liveFade.t0) / 400, 0, 1); st.lightA = st.liveFade.from + (st.liveFade.to - st.liveFade.from) * p; if (p >= 1) st.liveFade = null; moving = true; }
  const tPrev = st.t;
  if (st.live) {
    const n = nowS();
    if (Math.abs(n - st.t) > 20) { st.t = n; glDirty = true; }
  } else if (st.playing) {
    if (wrapAt) {
      const p = Math.min(1, (ts - wrapAt) / WRAP_MS);
      wrapAlpha = 1 - p * p * (3 - 2 * p);
      glDirty = true;
      if (p >= 1) { wrapAt = 0; wrapAlpha = 1; st.t = T0; active.length = 0; }
    } else {
      st.t += dt * st.speed;
      if (st.stopAt != null && st.t >= st.stopAt) { st.t = st.stopAt; st.stopAt = null; setPlay(false); }
      else if (st.t >= T1) { st.t = T1; wrapAt = ts; }
    }
  }
  const wake = idle.wake;
  idle.wake = false;
  if (!st.live) {
    const still = idleOk();
    budget(still ? 1 : st.speed);
    if (st.playing && !wrapAt && st.t > tPrev) spawn(tPrev, st.t, performance.now());
    else if (still) idleSpawn(performance.now());
  }
  if (!idleOk()) idleStop();
  if (wake && !active.length && !eggList.length && !glDirty && !moving && !view.tween) { idleSleep(); return; }
  if (!glDirty && lastSunPx) {
    const [sd, sl] = sunLL(st.t), mv = Math.hypot(sd - lastSunPx[0], wrapLon(sl - lastSunPx[1])) * DEG * Rk();
    if (mv > 0.6 && performance.now() - lastGlAt > 100) glDirty = true;
  }
  if (glDirty) drawGl();
  drawOverlay(performance.now());
  const cost = performance.now() - c0;
  K.pushPerf(K.perf.draw, cost);
  if (dock && (st.playing || st.live)) dock.update();
  if (ts - (frame.lastUi || 0) > 120) { frame.lastUi = ts; syncTime(); }
  while (drawnLog.length && drawnLog[0] < performance.now() - 1000) drawnLog.shift();
  stats.drawnPerSec = drawnLog.length;
  heroTick(ts);
  const busy = st.playing || st.live || view.tween || active.length || eggList.length || moving || st.liveFade;
  if (busy) raf = requestAnimationFrame(frame);
  else idleSleep();
}
function loop() { if (!raf && entered) { lastTs = 0; raf = requestAnimationFrame(frame); } }
function redraw() { glDirty = true; loop(); K.pingLadder(); }
let stripFocus = false;
export function ladder() {
  if (!built) return null;
  const em = st.emph, auroraOnly = em.aurora > 1 && em.light < 1;
  const l1 = stripFocus || st.live;
  let sel = null;
  if (stripFocus) sel = { km: 1.5e6, comovingKm: null, z: null, label: 'Solar wind at L1', how: st.live ? 'live' : 'measured', words: st.live ? 'live from NOAA SWPC' : 'measured at L1, nightly copy', note: 'from Earth' };
  else if (st.sel && st.sel.type === 'storm' && CELLS[st.sel.i]) sel = { km: 12, comovingKm: null, z: null, label: CELLS[st.sel.i].name, how: 'typical', words: 'typical storm top; GLM gives no heights', note: 'above the ground' };
  else if (st.sel && st.sel.type === 'aurora') sel = { km: 110, comovingKm: null, z: null, label: st.sel.hemi > 0 ? 'Northern lights' : 'Southern lights', how: 'model', words: 'the green aurora shell, from the OVATION model', note: 'above the ground' };
  return { band: [5, 1.6e6], view: auroraOnly ? [100, 300] : [8, 300], also: l1 ? [1.4e6, 1.6e6] : null, rest: 110, sel };
}

let lastHourUi = -1, dock = null;
function syncTime() {
  if (dock) dock.update();
  pillText();
  if (stripS) drawStrip(stripS);
  const h = st.live ? -2 : hourOf(st.t);
  if (h !== lastHourUi) { lastHourUi = h; regionCursor(); if (!st.sel) renderCard(); }
}
function setPlay(p) {
  if (p && st.live) setLive(false);
  st.playing = p;
  if (!p) { wrapAt = 0; wrapAlpha = 1; glDirty = true; }
  if (dock) dock.sync();
  if (p) { drawnLog = []; loop(); } else syncTime();
}
const flashBins = () => {
  const n = HOURS * 4, out = [];
  for (let i = 0; i < n; i++) { let v = 0; for (const r of REGIONS) v += (r.q15 && r.q15[i]) || 0; out.push([T0 + i * 900, v]); }
  return out;
};
let binsV = null;
function makeTimeDock() {
  const tEnd = () => Math.max(Math.ceil(nowS() / 60) * 60, T1 + 1800);
  const bzAt = (t) => { const v = valueAt(allSeries().bz, t, 900); return v == null ? '' : `<br>Bz ${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)} nT${v < 0 ? ', south' : ''}`; };
  dock = makeDock('earth', {
    t0: () => T0, t1: () => T1, end: () => T1, get: () => (st.live ? nowS() : st.t), set: setT,
    playing: () => st.playing, play: setPlay,
    speeds: SPEEDS.map((x) => x[0]), speed: () => st.speed, setSpeed: (v) => { st.speed = v; },
    speedText: (v) => { const k = SPEEDS.find((x) => x[0] === v); return k ? k[1] : v >= 3600 ? `${+(v / 3600).toFixed(1)} h/s` : `${Math.round(v / 60)} min/s`; },
    step: (dir, big) => setT((st.live ? T1 : st.t) + dir * (big ? 3600 : 600)),
    scrub: (t) => { if (t > T1 + 600) setLive(true); else setT(t); },
    live: { on: () => st.live, set: setLive },
    fmt: (t) => (st.live ? `Live · ${fmtUtc(nowS(), true)}` : fmtUtc(t, true)),
    valueText: (t) => (st.live ? `Live, ${fmtUtc(nowS())}` : `${fmtUtc(t)}${t >= T1 ? ', end of the nightly lightning' : ''}`),
    tip: (t) => {
      if (t < T0) return '';
      if (t > T1) return `<b>${fmtUtc(Math.min(t, nowS()), true)}</b><br>No lightning yet: it arrives with tonight’s update${bzAt(t)}`;
      const i = Math.floor((t - T0) / 900), b = (binsV || [])[i];
      return `<b>${fmtUtc(t, true)}</b><br>${b ? `${fmtN(b[1])} flashes in 15 minutes` : 'no flashes'}${bzAt(t)}`;
    },
    paint: {
      domain: () => [T0, tEnd()], solid: () => [T0, T1], outAfter: 'after the nightly update',
      bars: () => (binsV = binsV || flashBins()), bin: 900, scale: 'sqrt', barColor: () => tokens.ember || K.C.ink3, cursorColor: () => K.C.gold, ticks: 'hour',
      lane: () => ({ pts: allSeries().bz, gap: 900, step: 300, label: 'Bz', lim: (pts) => (pts.some((p) => Math.abs(p[1]) > 10) ? 30 : 10) }),
      key: () => `${Math.floor(nowS() / 60)}|${allSeries() && seriesCache.key}|${tokens.ember}`,
    },
  });
}
function setT(t) {
  if (st.live) setLive(false);
  wrapAt = 0; wrapAlpha = 1; st.stopAt = null;
  st.t = clamp(t, T0, T1); active.length = 0;
  glDirty = true; syncTime(); redraw();
}
function setLive(on) {
  if (on === st.live) return;
  st.live = on;
  if (on) {
    st.playing = false; setPlay(false); wrapAt = 0; wrapAlpha = 1; active.length = 0;
    st.liveFade = { from: st.lightA, to: 0, t0: performance.now() };
    st.t = nowS();
  } else {
    st.liveFade = { from: st.lightA, to: 1, t0: performance.now() };
    if (st.t > T1) st.t = T1;
  }
  if (reduceMotion) { st.lightA = on ? 0 : 1; st.liveFade = null; }
  K.setUrl({ live: on ? '1' : null });
  glDirty = true; syncTime(); loop();
}

function stepTween(ts) {
  const w = view.tween, p = Math.min(1, (ts - w.t0) / w.ms), e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  view.lat = w.lat0 + (w.lat1 - w.lat0) * e;
  view.lon = wrapLon(w.lon0 + w.dlon * e);
  view.k = Math.exp(Math.log(w.k0) + (Math.log(w.k1) - Math.log(w.k0)) * e);
  viewChanged();
  if (p >= 1) { view.tween = null; zoomUi(); loadTiles(); if (w.done) w.done(); }
}
function flyTo(lat, lon, k, done) {
  const ms = reduceMotion ? 0 : 1200;
  k = clamp(k, 1, 12); lat = clamp(lat, -85, 85);
  if (!ms) { view.lat = lat; view.lon = wrapLon(lon); view.k = k; viewChanged(); zoomUi(); loadTiles(); redraw(); if (done) done(); return; }
  view.tween = { lat0: view.lat, lon0: view.lon, k0: view.k, lat1: lat, dlon: wrapLon(lon - view.lon), k1: k, t0: performance.now(), ms, done };
  loop();
}
function zoomAt(px, py, f) {
  const k1 = clamp(view.k * f, 1, 12);
  const ll = invert(px, py);
  view.k = k1;
  if (ll) {
    makeBasis();
    for (let i = 0; i < 4; i++) {
      const p = projLL(ll[0], ll[1]);
      if (p.z <= 0) break;
      view.lon = wrapLon(view.lon + (p.x - px) / Rk() / DEG / Math.max(0.2, Math.cos(view.lat * DEG)));
      view.lat = clamp(view.lat - (p.y - py) / Rk() / DEG, -85, 85);
      makeBasis();
    }
  }
  viewChanged(); zoomUi(); loadTiles(); redraw();
}
function zoomUi() {
  const r = $('#eZoomReset');
  if (r) r.hidden = view.k <= 1.01;
}
function resetView() { const dv = M.defaultView || [0, -60]; flyTo(dv[0], dv[1], 1); }

function wire() {
  const cv = $('#earthGl');
  const pts = new Map();
  let drag = null, moved = false, pinch = null;
  const loc = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, loc(e));
    moved = false; view.tween = null;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; drag = null; }
    else drag = { p: loc(e), lat: view.lat, lon: view.lon };
  });
  cv.addEventListener('pointermove', (e) => {
    const p = loc(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(pinch.mid[0], pinch.mid[1], (pinch.k * d / Math.max(10, pinch.d)) / view.k); moved = true; return;
    }
    if (drag) {
      const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        view.lon = wrapLon(drag.lon - dx / Rk() / DEG / Math.max(0.2, Math.cos(view.lat * DEG)));
        view.lat = clamp(drag.lat + dy / Rk() / DEG, -85, 85);
        viewChanged(); redraw(); K.hideTip();
      }
      return;
    }
    if (e.pointerType === 'mouse') hover(p, e);
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (drag && !moved && e.type === 'pointerup') click(loc(e));
    if (moved) loadTiles();
    drag = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { K.hideTip(); cv.classList.remove('hot'); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = loc(e); zoomAt(p[0], p[1], Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const step = 5;
    if (e.key === '+' || e.key === '=') zoomAt(box.cx, box.cy, 1.4);
    else if (e.key === '-') zoomAt(box.cx, box.cy, 1 / 1.4);
    else if (e.key === '0') resetView();
    else if (e.key.startsWith('Arrow')) {
      const d = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [step, 0], ArrowDown: [-step, 0] }[e.key];
      view.lat = clamp(view.lat + d[0] / view.k, -85, 85); view.lon = wrapLon(view.lon + d[1] / view.k); viewChanged(); loadTiles(); redraw();
    } else return;
    e.preventDefault(); e.stopPropagation();
  });
  $('#eZoomIn').addEventListener('click', () => zoomAt(box.cx, box.cy, 1.5));
  $('#eZoomOut').addEventListener('click', () => zoomAt(box.cx, box.cy, 1 / 1.5));
  $('#eZoomReset').addEventListener('click', resetView);
  $('#eClouds').addEventListener('click', () => setClouds(!clouds.on));
  makeTimeDock();
  document.addEventListener('visibilitychange', () => {
    if (!entered) return;
    if (document.hidden && st.playing) { st.wasPlaying = true; setPlay(false); }
    else if (!document.hidden && st.wasPlaying) { st.wasPlaying = false; setPlay(true); }
  });
  new ResizeObserver(() => { if (entered) { layout(); makeBasis(); if (stripS) stripS.resize(); redraw(); } }).observe(cv);
  K.onTheme(() => { readColors(); glCol = null; if (!entered) return; legend(); renderCard(); regionsRender(); redraw(); });
}

function hitStorm(x, y, r) {
  let best = null, bd = r * r;
  for (const s of ringList) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}
function nearbyFlashes(lat, lon, t) {
  const h = hourOf(t), D = DENS[h];
  if (!D || !isCovered(lat, lon)) return null;
  let n = 0;
  for (let k = 0; k < D.idx.length; k++) {
    const la = Math.floor(D.idx[k] / 360) - 89.5, lo = (D.idx[k] % 360) - 179.5;
    if (Math.abs(la - lat) > 2 || Math.abs(wrapLon(lo - lon)) > 2 / Math.max(0.1, Math.cos(lat * DEG))) continue;
    const d = gcKm(lat, lon, la, lo);
    if (d < 100) n += D.cnt[k];
    else if (d < 160) n += D.cnt[k] * (160 - d) / 60 * 0.5;
  }
  return Math.round(n);
}
function hover(p, e) {
  const cv = $('#earthGl'), s = st.live ? null : hitStorm(p[0], p[1], 10), cap = capHit(p[0], p[1]);
  cv.classList.toggle('hot', !!s || !!cap);
  if (s) { const c = CELLS[s.i]; K.showTip(`<b>${esc(c.name)}</b><br>~${fmtN(s.n)} flashes in this hour · ${SAT_LABEL[c.sat] || c.sat}`, e.clientX, e.clientY); return; }
  if (cap) { K.showTip(`<b>${cap > 0 ? 'Northern' : 'Southern'} aurora oval</b><br>Seen from above the pole, noon at top. Click to fly there.`, e.clientX, e.clientY); return; }
  const ll = invert(p[0], p[1]);
  if (!ll) { K.hideTip(); return; }
  const t = st.live ? nowS() : st.t, [la, lo] = ll, alt = sunAlt(la, lo, t), av = auroraAt(la, lo, t), nf = st.live ? null : nearbyFlashes(la, lo, t);
  const rows = [`<b>${Math.abs(la).toFixed(1)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(1)}° ${lo >= 0 ? 'E' : 'W'}</b>`, `${solarTime(lo, t)} local solar time · ${sunWord(alt)} · Sun ${alt < 0 ? '−' : ''}${Math.abs(alt).toFixed(0)}°`];
  if (av != null && Math.abs(la) >= 40) rows.push(`Aurora chance ${av}% <small>(model)</small>`);
  if (nf != null) rows.push(`About ${fmtN(nf)} flashes within 100 km in the last hour`);
  K.showTip(rows.join('<br>'), e.clientX, e.clientY);
}
function click(p) {
  const cap = capHit(p[0], p[1]);
  if (cap) { openAurora(cap); return; }
  const s = st.live ? null : hitStorm(p[0], p[1], 14);
  if (s) { selectStorm(s.i, false); return; }
  const ll = invert(p[0], p[1]);
  if (ll) { st.sel = { type: 'place', lat: ll[0], lon: ll[1] }; renderCard(); redraw(); }
}
function openAurora(hemi) {
  const t = st.live ? nowS() : st.t, mid = wrapLon(sunLL(t)[1] + 180);
  st.sel = { type: 'aurora', hemi };
  renderCard();
  flyTo(72 * hemi, mid, 1.6);
}
function selectStorm(i, fly = true) {
  st.sel = { type: 'storm', i };
  K.setUrl({ obj: CELLS[i] ? CELLS[i].name : null });
  renderCard();
  if (fly) { const c = CELLS[i]; flyTo(c.lat, c.lon, Math.max(view.k, 2.2)); }
  redraw();
}

function legend() {
  const c = C();
  $('#eLegend').innerHTML = `<span class="k"><span class="sw" style="background:${tokens.bolt};box-shadow:0 0 0 3px ${tokens.ember}66"></span>flash (${LI_ON ? 'GOES GLM, MTG LI' : 'GOES GLM'})</span><span class="k"><span class="sw" style="background:${tokens.ember}"></span>last hour</span><span class="k"><span class="sw" style="background:${tokens.aurora}"></span>aurora chance 10–50% <small class="prov model" title="model">◆</small></span><span class="k"><span class="sw sq hatchsw"></span>no open lightning data</span><span class="k"><span class="sw ring" style="border-color:${c.gold}"></span>geomagnetic pole</span>`;
}

function kpStr(kp) {
  if (kp == null) return '–';
  const n = Math.round(kp * 3) / 3, b = Math.round(n), d = Math.round((n - b) * 3);
  return `${b}${d < 0 ? '−' : d > 0 ? '+' : ''}`;
}
const kpWord = (kp) => (kp == null ? 'Unknown' : kp < 3 ? 'Quiet' : kp < 4 ? 'Unsettled' : kp < 5 ? 'Active' : `Storm (G${Math.min(5, Math.floor(kp - 4))})`);
const windWord = (v) => (v < 400 ? 'slow' : v <= 600 ? 'moderate' : 'fast');
const bzWord = (b) => (b >= 0 ? 'north' : b > -5 ? 'gently south' : b >= -10 ? 'south' : 'strongly south');
const lastOf = (arr) => { if (!arr) return null; for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return [i, arr[i]]; return null; };

function nowValues() {
  const L = live.st, out = { live: false };
  if (L.speed.data) { out.speed = L.speed.data.v; out.at = L.speed.data.t; out.live = true; }
  else { const v = lastOf(SW.speed); if (v) { out.speed = v[1]; out.at = T0 + v[0] * 300; } }
  const dn = L.wind.data && L.wind.data.rows.length ? L.wind.data.rows[L.wind.data.rows.length - 1][2] : null;
  if (dn != null) out.density = dn; else { const v = lastOf(SW.density); if (v) out.density = v[1] / 10; }
  if (L.mag.data) out.bz = L.mag.data.bz; else { const v = lastOf(SW.bz); if (v) out.bz = v[1] / 10; }
  if (L.kp1m.data && L.kp1m.data.length) out.kp = L.kp1m.data[L.kp1m.data.length - 1][1];
  else if (L.kp3.data && L.kp3.data.length) out.kp = L.kp3.data[L.kp3.data.length - 1][1];
  else if (SW.kp && SW.kp.length) out.kp = SW.kp[SW.kp.length - 1][1];
  out.scales = (L.scales.data || SW.scales || {}).now || {};
  out.max24 = (L.scales.data || SW.scales || {}).max24 || {};
  return out;
}
function readSite() {
  try { const v = JSON.parse(localStorage.getItem('observatory.site') || 'null'); if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v; } catch {}
  return guessSite();
}
function prov(kind, at) {
  if (kind === 'live') return `<span class="prov live" title="live, ${hhmm(at)} UTC"></span>`;
  if (kind === 'model') return '<span class="prov model" title="model">◆</span>';
  return `<span class="prov nightly" title="nightly, to ${hhmm(T1)} UTC"></span>`;
}
function scaleChips(v) {
  const chip = (k, word) => { const n = v.scales[k], m = v.max24[k]; return `${k}${n ?? 0}${m > (n ?? 0) ? ` (max ${m})` : ''} ${word}`; };
  return SC.chipsHtml([chip('G', 'storms'), chip('R', 'radio'), chip('S', 'protons'), `Kp ${kpStr(v.kp)}`].slice(0, 3)).replace('</div>', `<span>Kp ${kpStr(v.kp)}</span></div>`);
}
function cardRightNow() {
  const v = nowValues(), t = st.live ? nowS() : st.t, h = hourOf(t);
  const failed = live.running && live.allFailed();
  const when = v.live ? `Live from NOAA SWPC at ${hhmm(v.at)} UTC.` : `Nightly copy from NOAA SWPC, to ${hhmm(T1)} UTC.`;
  const sent = v.speed != null && v.bz != null ? ` ${kpWord(v.kp).replace(/ \(.+\)$/, '')}: the solar wind is ${windWord(v.speed)} and Bz is ${bzWord(v.bz)}.` : '';
  const site = readSite(), hemi = site.lat >= 0 ? 1 : -1, ch = auroraAt(site.lat, site.lon, st.live ? nowS() : t), edge = ovalEdge(site.lon, hemi, st.live ? nowS() : t);
  const lead = v.speed ? Math.round(1.5e6 / v.speed / 60) : null;
  const storms = st.live ? [] : stormsAt(h).slice(0, 5);
  const facts = [
    ['Solar wind', v.speed != null ? `${Math.round(v.speed)} km/s${v.density != null ? ` · ${v.density.toFixed(1)} per cm³` : ''} ${prov(v.live ? 'live' : 'nightly', v.at)}` : '–'],
    ['Bz (GSM)', v.bz != null ? `${v.bz < 0 ? '−' : '+'}${Math.abs(v.bz).toFixed(1)} nT, ${v.bz < 0 ? 'south' : 'north'} ${prov(live.st.mag.data ? 'live' : 'nightly', v.at)}` : '–'],
    ['Reaches Earth in', lead ? `about ${lead} min from L1` : '–'],
    [`Aurora from ${esc(site.label || 'your place')}`, ch != null ? `${ch}% chance · ${edge ? `oval above ${edge}° ${hemi > 0 ? 'N' : 'S'}` : 'no oval at this longitude'} ${prov('model')}` : 'no model run'],
  ];
  const watch = [
    ...COV.filter((c) => c.state !== 'off').map((c) => [true, c.name, `${c.area} · nightly`]),
    ...COV.filter((c) => c.state === 'off').map((c) => [false, c.name, `${c.area} · ${LI_STATE === 'error' ? 'not this night' : 'not yet'}`]),
    [false, 'Asia, Australia, Indian Ocean', 'no open data'],
  ];
  return `<h3 class="ph">Right now</h3>
    <p class="cap">${when}${sent}</p>
    ${failed ? `<p class="note">Live data from NOAA did not load; showing the nightly copy to ${hhmm(T1)}.</p>` : ''}
    ${scaleChips(v)}
    <dl class="efacts">${facts.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>
    ${storms.length ? `<h4>Busiest storms, ${hhmm(T0 + h * 3600)} UTC</h4>
    <ul class="hooks">${storms.map((s) => { const c = CELLS[s.i]; return `<li><button type="button" data-storm="${s.i}"><span class="sw" style="background:${tokens.ember}"></span><b>${esc(c.name)}</b>${SC.chipsHtml([`~${fmtN(s.n)} flashes/h`, SAT_LABEL[c.sat] || c.sat, ...(c.areaMax >= 1000 ? ['Big flashes'] : c.sea > 0.6 ? ['Over the ocean'] : [])])}</button></li>`; }).join('')}</ul>` : st.live ? `<p class="note">No lightning after ${hhmm(T1)} UTC; it arrives with tonight's update.</p>` : ''}
    <h4>Who is watching for lightning</h4>
    <ul class="watch">${watch.map(([on, a, b]) => `<li><span class="sw${on ? '' : ' hollow'}"></span><span><b>${esc(a)}</b><small>${esc(b)}</small></span></li>`).join('')}</ul>
    <div class="chead"><p class="ch-links"><a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener">NOAA SWPC <span aria-hidden="true">↗</span></a><a href="${SWPC_AURORA}" target="_blank" rel="noopener">Aurora forecast <span aria-hidden="true">↗</span></a></p></div>`;
}
const SWPC_AURORA = 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast';
const IMAGERY = { G19: ['GOES imagery', 'https://www.star.nesdis.noaa.gov/GOES/index.php'], G18: ['GOES imagery', 'https://www.star.nesdis.noaa.gov/GOES/index.php'], MTI1: ['EUMETView', 'https://view.eumetsat.int/'] };
const llStr = (lat, lon) => `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
function cardStorm(i) {
  const c = CELLS[i], th = (h) => T0 + h * 3600;
  const chips = [`~${fmtN(c.peak)} flashes/h`];
  if (c.areaMax >= 1000) chips.push(`Big flashes: up to ${fmtN(Math.round(c.areaMax / 100) * 100)} km²`);
  if (c.sea > 0.6) chips.push('Over the ocean');
  chips.push(`Lasted ${c.h1 - c.h0 + 1} h`);
  const facts = [
    ['First hour', `${hhmm(th(c.h0))} UTC <small>${solarTime(c.lon, th(c.h0))} local</small>`],
    ['Last hour', `${hhmm(th(c.h1))} UTC <small>${solarTime(c.lon, th(c.h1))} local</small>`],
    ['Peak rate', `${fmtN(c.peak)} <small>flashes/h</small>`],
    ['Flashes in 24 h', fmtN(c.total)],
    ['Mean flash area', `${fmtN(c.areaMean)} km²`],
    ['Centre', llStr(c.lat, c.lon)],
  ];
  const img = IMAGERY[c.sat];
  const head = cardHead({
    name: c.name, sw: tokens.ember, cls: 'Thunderstorm complex', note: `seen by ${esc(SAT_NAME[c.sat] || c.sat)}`,
    chips: SC.chipsHtml(chips).replace(/<div class="why">(.*)<\/div>/, (m, x) => `<div class="why">${x}${chips.slice(3).map((y) => `<span>${esc(y)}</span>`).join('')}</div>`),
    how: 'measured', prov: `flashes counted by ${esc(SAT_NAME[c.sat] || c.sat)}, ${c.sat === 'MTI1' ? 'via EUMETSAT' : 'via NOAA NODD'} · nightly copy to ${hhmm(T1)} UTC ${prov('nightly')}`,
    ladder: '<b>≈ 12 km</b> above the ground · a typical storm top; GLM gives no heights',
    links: img ? [{ label: img[0], href: img[1] }] : [],
  });
  return `${head}
    <h4>Flashes per 10 minutes</h4>
    <canvas class="erate ehero" id="eRate" aria-label="Flash rate of this storm over its life, with the map's time"></canvas>
    <p class="cap hero-cap">Gold line: the time on the map; dim bars are still to come. On the globe, the thin line is the storm's path, hour by hour.</p>
    <dl>${facts.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>
    <p class="note">${c.sat === 'MTI1' ? 'MTG’s Lightning Imager counts flashes, cloud-to-ground and in-cloud alike, from 35,786 km up. Contains modified EUMETSAT Meteosat data 2026.' : 'GLM counts flashes, cloud-to-ground and in-cloud alike, from 35,786 km up. By day it misses more (it sees about 70–90% of flashes).'}</p>
    <p><button class="link" type="button" data-back>Back to right now</button></p>`;
}
function nearestPick(lat, lon) {
  let best = null, bd = 400;
  for (const p of PICK) { const d = gcKm(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }
  return best;
}
function auroraNightly(lat, lon, t) {
  if (!AUR) return null;
  const sh = wrapLon(sunLL(AUR.obs)[1] - sunLL(t)[1]), lo = ((lon + sh) % 360 + 360) % 360;
  return AUR.grid[clamp(Math.round(lat + 90), 0, 180) * 362 + Math.round(lo) % 360];
}
const placeCache = { key: '', v: null };
function placeSeries(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (placeCache.key === key) return placeCache.v;
  const cov = isCovered(lat, lon), flashes = [], aur = [], alt = [];
  for (let h = 0; h < HOURS; h++) {
    const tm = T0 + h * 3600 + 1800;
    flashes.push(cov ? nearbyFlashes(lat, lon, tm) || 0 : null);
    aur.push(Math.abs(lat) >= 40 ? auroraNightly(lat, lon, tm) : null);
  }
  for (let k = 0; k <= HOURS * 6; k++) alt.push(sunAlt(lat, lon, T0 + k * 600));
  placeCache.key = key; placeCache.v = { cov, flashes, aur, alt };
  return placeCache.v;
}
function cardPlace(lat, lon) {
  const t = st.live ? nowS() : st.t, alt = sunAlt(lat, lon, t), now = auroraAt(lat, lon, t), nf = st.live ? null : nearbyFlashes(lat, lon, t);
  const near = nearestPick(lat, lon), cov = isCovered(lat, lon), high = Math.abs(lat) >= 40;
  const facts = [
    ['Local solar time', solarTime(lon, t)],
    ['Sun', `${alt < 0 ? '−' : ''}${Math.abs(alt).toFixed(0)}° · ${sunWord(alt)}`],
  ];
  if (now != null) facts.push(['Aurora chance', `${now}% ${prov('model')}`]);
  if (!cov) facts.push(['Lightning', 'No lightning coverage here.']);
  else if (nf != null) facts.push(['Flashes within 100 km', `${fmtN(nf)} <small>in the last hour</small>`]);
  const kinds = [cov ? `lightning from ${LI_ON ? 'GLM and MTG LI' : 'GLM'}, nightly to ${hhmm(T1)} UTC ${prov('nightly')}` : 'no open lightning data here', `aurora from the OVATION model ${prov('model')}`, 'city lights 2016'];
  const head = cardHead({
    name: near ? `Near ${near.label}` : 'A place on the map', sw: 'var(--gold)', cls: llStr(lat, lon), note: fmtUtc(t),
    how: cov ? 'measured' : 'model', prov: kinds.join(' · '),
    ladder: 'Above this point: storm tops at <b>≈ 12 km</b>, the green aurora at <b>≈ 110 km</b>',
    links: high ? [{ label: 'SWPC aurora forecast', href: SWPC_AURORA }] : [],
  });
  return `${head}
    <h4>The 24 hours here</h4>
    <canvas class="ehero" id="ePlace" aria-label="Flashes within 100 km per hour${high ? ', aurora chance' : ''} and daylight at this place over the 24 hours"></canvas>
    <p class="cap hero-cap">${cov ? 'Bars: flashes within 100 km per hour. ' : ''}${high ? 'Green line: aurora chance from the model. ' : ''}Shading: day and twilight here. Gold line: the time on the map.</p>
    <dl>${facts.map(([k, x]) => `<div style="grid-column:span ${x.length > 34 ? 3 : 1}"><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>
    <p class="note">City lights from 2016 composites, not tonight.</p>
    <p><button class="link" type="button" data-back>Back to right now</button></p>`;
}
function cardAurora(hemi) {
  const t = st.live ? nowS() : st.t, site = readSite();
  const mine = Math.sign(site.lat || 1) === hemi;
  const lon = mine ? site.lon : wrapLon(sunLL(t)[1] + 180);
  const edge = ovalEdge(lon, hemi, t);
  const run = st.live && liveGrid ? liveGrid : AUR;
  const hp = live.st.hp.data && live.st.hp.data.length ? live.st.hp.data[live.st.hp.data.length - 1] : null;
  const lastN = lastOf(hemi > 0 ? SW.hpN : SW.hpS);
  const pw = hp ? hp[hemi > 0 ? 1 : 2] : lastN ? lastN[1] : null;
  const v = nowValues(), ch = mine ? auroraAt(site.lat, site.lon, t) : null;
  const turned = !(st.live && liveGrid) && run;
  const head = cardHead({
    name: hemi > 0 ? 'Northern lights' : 'Southern lights', sw: tokens.aurora, cls: 'Aurora oval', note: 'OVATION Prime model',
    how: 'model', prov: run ? `OVATION run ${hhmm(run.obs)} UTC, valid ${hhmm(run.valid)}, from NOAA SWPC${turned ? `, turned with the Sun to ${hhmm(t)}` : ''} ${prov('model')}` : 'no model run kept',
    ladder: '<b>≈ 110 km</b> above the ground · the green aurora shell; the red glow reaches ≈ 220 km',
    links: [{ label: 'SWPC aurora forecast', href: SWPC_AURORA }],
  });
  return `${head}
    <h4>Hemispheric power since ${hhmm(T0)} UTC</h4>
    <canvas class="erate ehero" id="eHp" aria-label="Hemispheric power over the window, with the map's time"></canvas>
    <p class="cap hero-cap">The power the model puts into this hemisphere's aurora. ${live.st.hp.data ? 'Brighter tail: live from NOAA. ' : ''}Gold line: the time on the map.</p>
    <dl>
      <div><dt>Hemispheric power</dt><dd>${pw != null ? `${pw} GW` : '–'} ${prov('model')}</dd></div>
      <div><dt>Oval edge at ${Math.abs(lon).toFixed(0)}° ${lon >= 0 ? 'E' : 'W'}</dt><dd>${edge ? `${edge}° ${hemi > 0 ? 'N' : 'S'}` : 'no oval'}</dd></div>
      <div><dt>Kp now</dt><dd>${kpStr(v.kp)} <small>${esc(kpWord(v.kp))}</small></dd></div>
      ${ch != null ? `<div style="grid-column:span 3"><dt>From ${esc(site.label || 'your place')}</dt><dd>${ch}% chance overhead ${prov('model')}</dd></div>` : ''}
    </dl>
    <p class="cap">Think of OVATION as a table with one row per 1° × 1° cell. Its column is the chance, in percent, that aurora is overhead within the hour. It is computed from the solar wind measured at L1, so it is a forecast about 30–90 minutes ahead, not a photo.</p>
    ${st.live && liveGrid ? '' : `<p class="note">One model run is kept each night; for other hours the map turns it with the Sun, so the oval keeps its place under the Sun while the Earth turns.</p>`}
    <p><button class="link" type="button" data-back>Back to right now</button></p>`;
}
let rateS = null, heroAt = 0, heroT = -1;
function heroTick(ts) {
  if (!rateS || ts - heroAt < 150) return;
  const t = st.live ? Math.floor(nowS() / 60) : st.t;
  if (t === heroT) return;
  heroAt = ts; heroT = t;
  rateS.draw(rateS);
}
function renderCard() {
  K.pingLadder();
  rateS = null; heroT = -1;
  const body = $('#eCardBody');
  if (!body) return;
  const s = st.sel;
  body.innerHTML = !s ? cardRightNow() : s.type === 'storm' ? cardStorm(s.i) : s.type === 'place' ? cardPlace(s.lat, s.lon) : cardAurora(s.hemi);
  body.querySelectorAll('[data-storm]').forEach((b) => b.addEventListener('click', () => selectStorm(+b.dataset.storm)));
  body.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { st.sel = null; st.emph.focus = -1; K.setUrl({ obj: null }); renderCard(); redraw(); }));
  const rc = body.querySelector('#eRate');
  if (rc && s && s.type === 'storm') rateS = K.setupCanvas(rc, (x) => drawRate(x, CELLS[s.i]));
  const hc = body.querySelector('#eHp');
  if (hc) rateS = K.setupCanvas(hc, (x) => drawHp(x, s.hemi));
  const pc = body.querySelector('#ePlace');
  if (pc) rateS = K.setupCanvas(pc, (x) => drawPlace(x, s.lat, s.lon));
}
function heroFrame(s, t0, t1) {
  const L = 36, Rm = 6, T = 8, B = 18, W = s.w - L - Rm, H = s.h - T - B;
  return { L, Rm, T, B, W, H, x: (t) => L + (t - t0) / Math.max(1, t1 - t0) * W, y: (f) => T + H - f * H, t0, t1 };
}
function heroAxes(g, s, f, yTop, yLabel) {
  const c = C(), span = f.t1 - f.t0, step = span > 15 * 3600 ? 6 * 3600 : span > 6 * 3600 ? 3 * 3600 : 3600;
  g.strokeStyle = c.grid; g.lineWidth = 1; g.globalAlpha = 0.8;
  g.beginPath(); g.moveTo(f.L, f.y(0) + 0.5); g.lineTo(f.L + f.W, f.y(0) + 0.5); g.moveTo(f.L, f.y(1) + 0.5); g.lineTo(f.L + f.W, f.y(1) + 0.5); g.stroke();
  g.globalAlpha = 1;
  text(g, yTop, f.L - 4, f.y(1) + 4, { size: 10.5, color: c.ink3, align: 'right' });
  text(g, '0', f.L - 4, f.y(0) + 3, { size: 10.5, color: c.ink3, align: 'right' });
  if (yLabel) text(g, yLabel, f.L + 2, f.y(1) - 1 + 11, { size: 10.5, color: c.ink3 });
  let first = true;
  for (let t = Math.ceil(f.t0 / step) * step; t <= f.t1 + 1; t += step) {
    const x = f.x(t);
    if (x < f.L + 8 || x > f.L + f.W - 8) continue;
    g.strokeStyle = c.grid; g.beginPath(); g.moveTo(x + 0.5, f.y(0)); g.lineTo(x + 0.5, f.y(0) + 4); g.stroke();
    text(g, `${hhmm(t)}${first ? ' UTC' : ''}`, x, s.h - 4, { size: 10.5, color: c.ink3, align: 'center' });
    first = false;
  }
}
function heroCursor(g, f, t) {
  const x = f.x(t);
  if (x < f.L - 1 || x > f.L + f.W + 1) return;
  g.strokeStyle = C().gold; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, f.T - 4); g.lineTo(x, f.y(0)); g.stroke();
}
const niceTop = (v) => { const p = 10 ** Math.floor(Math.log10(Math.max(1, v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
function drawRate(s, c) {
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  if (!c || !s.w) return;
  const r = c.r10, n = r.length, t0 = T0 + c.h0 * 3600, f = heroFrame(s, t0, t0 + n * 600), pk = Math.max(1, ...r), top = niceTop(pk);
  heroAxes(g, s, f, fmtN(top), '');
  const tc = st.live ? T1 : st.t, bw = f.W / n;
  g.fillStyle = tokens.ember;
  for (let i = 0; i < n; i++) {
    const bh = r[i] / top * f.H;
    if (bh <= 0) continue;
    g.globalAlpha = t0 + i * 600 <= tc ? 0.9 : 0.3;
    g.fillRect(f.L + i * bw + 0.5, f.y(0) - bh, Math.max(1, bw - 1), bh);
  }
  g.globalAlpha = 1;
  const ip = r.indexOf(pk), px = f.L + (ip + 0.5) * bw, py = f.y(pk / top);
  const left = px < f.L + f.W * 0.55;
  text(g, `peak ${fmtN(pk)} at ${hhmm(t0 + ip * 600)}`, px + (left ? 6 : -6), Math.max(f.T + 9, py + 9), { size: 10.5, weight: 600, color: C().ink2, align: left ? 'left' : 'right', halo: true });
  heroCursor(g, f, tc);
}
function drawHp(s, hemi) {
  const g = s.ctx, arr = (hemi > 0 ? SW.hpN : SW.hpS) || [];
  g.clearRect(0, 0, s.w, s.h);
  if (!s.w) return;
  const liveRows = (live.st.hp.data || []).filter((r) => r[0] >= T1);
  const night = arr.map((v, i) => [T0 + i * 300 + 150, v]).filter((p) => p[1] != null);
  const lv = liveRows.map((r) => [r[0], r[hemi > 0 ? 1 : 2]]).filter((p) => p[1] != null);
  const tEnd = Math.max(nowS(), T1), top = niceTop(Math.max(40, ...night.map((p) => p[1]), ...lv.map((p) => p[1])));
  const f = heroFrame(s, T0, tEnd);
  heroAxes(g, s, f, `${fmtN(top)} GW`, '');
  if (tEnd > T1 + 600) {
    g.fillStyle = C().ink; g.globalAlpha = 0.05; g.fillRect(f.x(T1), f.T, f.x(tEnd) - f.x(T1), f.H); g.globalAlpha = 1;
  }
  const line = (pts, w, a, fill) => {
    if (!pts.length) return;
    g.beginPath();
    let prev = null, start = null;
    const close = () => { if (fill && start != null && prev != null) { g.lineTo(f.x(prev), f.y(0)); g.lineTo(f.x(start), f.y(0)); } };
    for (const [t, v] of pts) {
      const px = f.x(t), py = f.y(v / top);
      if (prev == null || t - prev > 900) { if (fill && prev != null) { close(); } if (fill) { g.moveTo(px, f.y(0)); g.lineTo(px, py); } else g.moveTo(px, py); start = t; } else g.lineTo(px, py);
      prev = t;
    }
    if (fill) { close(); g.fillStyle = tokens.aurora; g.globalAlpha = 0.16; g.fill(); }
    else { g.strokeStyle = tokens.aurora; g.lineWidth = w; g.globalAlpha = a; g.stroke(); }
    g.globalAlpha = 1;
  };
  line(night, 0, 1, true);
  line(night, 1.3, 0.85, false);
  line(lv, 2, 1, false);
  if (lv.length) { const [t, v] = lv[lv.length - 1]; g.fillStyle = tokens.live; g.beginPath(); g.arc(f.x(t), f.y(v / top), 3, 0, 6.2832); g.fill(); }
  if (tEnd > T1 + 600) text(g, 'now', f.L + f.W, f.T + 9, { size: 10.5, color: C().ink3, align: 'right' });
  heroCursor(g, f, st.live ? nowS() : st.t);
}
function drawPlace(s, lat, lon) {
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  if (!s.w) return;
  const d = placeSeries(lat, lon), f = heroFrame(s, T0, T1), c = C();
  for (let k = 0; k < d.alt.length - 1; k++) {
    const a = (d.alt[k] + d.alt[k + 1]) / 2, x0 = f.x(T0 + k * 600), x1 = f.x(T0 + (k + 1) * 600);
    const v = a > 0 ? 0.1 : a > -18 ? 0.1 * (1 + a / 18) * 0.6 : 0;
    if (v <= 0) continue;
    g.fillStyle = c.ink; g.globalAlpha = v; g.fillRect(x0, f.T, x1 - x0 + 0.5, f.H);
  }
  g.globalAlpha = 1;
  const pk = Math.max(0, ...d.flashes.map((v) => v || 0)), top = niceTop(Math.max(10, pk));
  heroAxes(g, s, f, d.cov ? fmtN(top) : '', d.cov ? 'flashes/h' : '');
  const bw = f.W / HOURS, tc = st.live ? T1 : st.t;
  if (d.cov) {
    g.fillStyle = tokens.ember;
    d.flashes.forEach((v, h) => {
      if (!v) return;
      const bh = Math.max(1, v / top * f.H);
      g.globalAlpha = T0 + h * 3600 <= tc ? 0.9 : 0.3;
      g.fillRect(f.L + h * bw + 1, f.y(0) - bh, Math.max(1, bw - 2), bh);
    });
    g.globalAlpha = 1;
    if (!pk) text(g, 'no flashes within 100 km', f.L + f.W / 2, f.T + f.H / 2 + 4, { size: 11, color: c.ink3, align: 'center', halo: true });
  } else text(g, 'no open lightning data here', f.L + f.W / 2, f.T + f.H / 2 + 4, { size: 11, color: c.ink3, align: 'center', halo: true });
  if (d.aur.some((v) => v != null)) {
    g.strokeStyle = tokens.aurora; g.lineWidth = 1.6; g.beginPath();
    d.aur.forEach((v, h) => { const x = f.L + (h + 0.5) * bw, y = f.y(clamp((v || 0) / 100, 0, 1)); if (h) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    text(g, 'aurora 0–100%', f.L + f.W, f.T + 9, { size: 10.5, color: c.ink3, align: 'right', halo: true });
  }
  heroCursor(g, f, tc);
}

const LANES_DESK = ['speed', 'density', 'bz', 'kp', 'xray', 'hp'];
const LANES_PHONE = ['speed', 'bz', 'kp', 'xray'];
const LANE = {
  speed: { label: 'Solar wind', unit: 'km/s' }, density: { label: 'Density', unit: 'per cm³' }, bz: { label: 'Bz', unit: 'nT' },
  kp: { label: 'Kp', unit: '' }, xray: { label: 'X-rays', unit: 'W/m²' }, hp: { label: 'Aurora power', unit: 'GW' },
};
function series(id) {
  const out = [];
  const L = live.st;
  const nightly = (arr, f) => { if (arr) arr.forEach((v, i) => { if (v != null) out.push([T0 + i * 300 + 150, f(v)]); }); };
  if (id === 'speed') { nightly(SW.speed, (v) => v); if (L.wind.data) L.wind.data.rows.forEach((r) => { if (r[0] >= T1 && r[1] != null) out.push([r[0], r[1]]); }); if (L.speed.data && L.speed.data.t > (out.length ? out[out.length - 1][0] : 0)) out.push([L.speed.data.t, L.speed.data.v]); }
  if (id === 'density') { nightly(SW.density, (v) => v / 10); if (L.wind.data) L.wind.data.rows.forEach((r) => { if (r[0] >= T1 && r[2] != null) out.push([r[0], r[2]]); }); }
  if (id === 'bz') { nightly(SW.bz, (v) => v / 10); if (L.magfull.data) L.magfull.data.rows.forEach((r) => { if (r[0] >= T1 && r[1] != null) out.push([r[0], r[1]]); }); if (L.mag.data && L.mag.data.t > (out.length ? out[out.length - 1][0] : 0)) out.push([L.mag.data.t, L.mag.data.bz]); }
  if (id === 'hp') { nightly(SW.hpN, (v) => v); if (L.hp.data) L.hp.data.forEach((r) => { if (r[0] >= T1) out.push([r[0], r[1]]); }); }
  if (id === 'hpS') { nightly(SW.hpS, (v) => v); if (L.hp.data) L.hp.data.forEach((r) => { if (r[0] >= T1) out.push([r[0], r[2]]); }); }
  if (id === 'xray') {
    if (SW.xray) { const raw = xrayRaw || (xrayRaw = decode(SW.xray.data)); raw.forEach((v, i) => { if (v) out.push([T0 + i * 60 + 30, 10 ** ((v - 1) / 254 * 6 - 9)]); }); }
    if (L.xray.data) L.xray.data.forEach((r) => { if (r[0] >= T1) out.push([r[0], r[1]]); });
  }
  return out;
}
let xrayRaw = null, seriesCache = { key: '', v: {} };
function allSeries() {
  const key = Object.values(live.st).map((s) => s.at).join('|');
  if (seriesCache.key !== key) seriesCache = { key, v: Object.fromEntries(['speed', 'density', 'bz', 'hp', 'hpS', 'xray'].map((id) => [id, series(id)])) };
  return seriesCache.v;
}
function laneProv(id) {
  if (id === 'hp') return 'model';
  const map = { speed: ['speed', 'wind'], density: ['wind'], bz: ['mag', 'magfull'], kp: ['kp1m', 'kp3'], xray: ['xray'] }[id];
  if (map.some((k) => live.st[k].ok)) return 'live';
  return 'nightly';
}
function valueAt(pts, t, gap) {
  if (!pts.ts) pts.ts = Float64Array.from(pts, (p) => p[0]);
  const i = lb(pts.ts, t);
  let best = null, bd = Infinity;
  for (const j of [i - 1, i]) if (j >= 0 && j < pts.length) { const d = Math.abs(pts.ts[j] - t); if (d < bd) { bd = d; best = pts[j]; } }
  return best && bd <= gap ? best[1] : null;
}
const NOOP = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function drawStrip(s) {
  if (!s.w) return;
  const c = C(), tEnd = Math.max(Math.ceil(nowS() / 60) * 60, T1 + 60);
  const key = `${allSeries() && seriesCache.key}|${s.w}x${s.h}|${c.dark}|${tEnd}|${['speed', 'density', 'bz', 'kp', 'xray'].map(laneProv).join('')}|${live.st.kp3.at}|${live.st.kp1m.at}|${live.st.flares.at}`;
  if (s.__key !== key || !s.__off) {
    const off = s.__off && s.__off.width === s.cv.width && s.__off.height === s.cv.height ? s.__off : document.createElement('canvas');
    off.width = s.cv.width; off.height = s.cv.height;
    const og = off.getContext('2d');
    og.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); og.clearRect(0, 0, s.w, s.h);
    stripPass(s, og, NOOP, tEnd);
    s.__off = off; s.__key = key;
  }
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(s.__off, 0, 0, s.w, s.h);
  stripPass(s, NOOP, g, tEnd);
}
const xrClass = (f) => { if (f == null) return '–'; const L = ['A', 'B', 'C', 'M', 'X'], e = clamp(Math.floor(Math.log10(f)) + 8, 0, 4); return `${L[e]}${(f / 10 ** (e - 8)).toFixed(1)}`; };
function stripPass(s, g, gv, tEnd) {
  const c = C(), phone = s.w < 600, lanes = phone ? LANES_PHONE : LANES_DESK, statics = gv === NOOP;
  const left = phone ? 70 : 104, right = phone ? 46 : 70, axis = 22, lh = (s.h - axis) / lanes.length;
  const W = s.w - left - right;
  const x = (t) => left + (t - T0) / (tEnd - T0) * W;
  s.__inv = (px) => T0 + (px - left) / W * (tEnd - T0);
  s.__lanes = { lanes, lh, left, right };
  const S = allSeries(), cur = st.live ? nowS() : st.t;
  const hatchGap = (y0, y1, a, b) => { if (b - a < 1) return; g.save(); g.fillStyle = K.hatch(g, c.ink3, 6); g.globalAlpha = 0.35; g.fillRect(a, y0, b - a, y1 - y0); g.restore(); };
  const line = (pts, y0, y1, toY, color, gap, w = 1) => {
    if (!statics) return;
    g.strokeStyle = color; g.lineWidth = w; g.beginPath();
    let prev = null, spans = [], st0 = null;
    for (const [t, v] of pts) {
      const px = x(t), py = toY(v);
      if (prev == null || t - prev > gap) { if (prev != null) spans.push([st0, prev]); g.moveTo(px, py); st0 = t; } else g.lineTo(px, py);
      prev = t;
    }
    if (prev != null) spans.push([st0, prev]);
    g.stroke();
    let a = T0;
    for (const [s0, s1] of spans) { hatchGap(y0, y1, x(a), x(s0)); a = s1; }
    hatchGap(y0, y1, x(a), x(tEnd));
  };
  lanes.forEach((id, li) => {
    const y0 = li * lh + 4, y1 = (li + 1) * lh - 4, mid = (y0 + y1) / 2;
    g.strokeStyle = c.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(left, y1 + 3.5); g.lineTo(s.w - right, y1 + 3.5); g.stroke();
    const pv = laneProv(id);
    text(g, LANE[id].label, 0, y0 + 13, { size: 12, weight: 600, color: c.ink });
    if (LANE[id].unit) text(g, LANE[id].unit, 0, y0 + 27, { size: 11, color: c.ink3 });
    const lw = (g.font = K.font(12, 600), g.measureText(LANE[id].label).width);
    if (pv === 'live') { g.fillStyle = tokens.live; g.beginPath(); g.arc(lw + 8, y0 + 9, 3, 0, 6.2832); g.fill(); }
    else if (pv === 'model') { g.fillStyle = c.gold; g.save(); g.translate(lw + 8, y0 + 9); g.rotate(Math.PI / 4); g.fillRect(-2.5, -2.5, 5, 5); g.restore(); }
    else { g.strokeStyle = c.ink3; g.lineWidth = 1; g.beginPath(); g.arc(lw + 8, y0 + 9, 2.6, 0, 6.2832); g.stroke(); }
    let val = '';
    if (id === 'speed') {
      const top = Math.max(800, Math.min(1200, ...S.speed.map((p) => p[1]).concat([0])));
      line(S.speed, y0, y1, (v) => y1 - clamp((v - 250) / (top - 250), 0, 1) * (y1 - y0), c.gold, 900);
      const v = valueAt(S.speed, cur, 900); val = v != null ? `${Math.round(v)}` : '–';
    } else if (id === 'density') {
      line(S.density, y0, y1, (v) => y1 - (v <= 20 ? v / 20 * 0.8 : 0.8 + 0.2 * Math.min(1, Math.log10(v / 20))) * (y1 - y0), c.ink2, 900);
      const v = valueAt(S.density, cur, 900); val = v != null ? v.toFixed(1) : '–';
    } else if (id === 'bz') {
      const lim = S.bz.some((p) => Math.abs(p[1]) > 10) ? 30 : 10, toY = (v) => mid - clamp(v / lim, -1, 1) * (y1 - y0) / 2;
      g.fillStyle = c.accent; g.globalAlpha = 0.28; g.beginPath();
      let prev = null;
      if (statics) for (const [t, v] of S.bz) { if (v < 0 && (prev == null || t - prev <= 900)) { const px = x(t); g.rect(px - 0.6, mid, Math.max(1.2, 300 / (tEnd - T0) * W), toY(v) - mid); } prev = t; }
      g.fill(); g.globalAlpha = 1;
      g.strokeStyle = c.grid; g.beginPath(); g.moveTo(left, mid); g.lineTo(s.w - right, mid); g.stroke();
      line(S.bz, y0, y1, toY, c.ink, 900);
      text(g, 'south', left + 4, y1 - 2, { size: 11, color: c.accent });
      const v = valueAt(S.bz, cur, 900); val = v != null ? `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}` : '–';
    } else if (id === 'kp') {
      const bars = (live.st.kp3.data || SW.kp || []).filter((r) => r[0] + 10800 > T0);
      let lastEnd = T0;
      for (const [t, kp] of bars) {
        const a = x(Math.max(T0, t)), b = x(Math.min(tEnd, t + 10800)), hgt = kp / 9 * (y1 - y0);
        g.fillStyle = kp >= 7 ? c.hi : kp >= 5 ? c.gold : c.ink3; g.globalAlpha = 0.7;
        g.fillRect(a + 1, y1 - Math.max(1, hgt), Math.max(1, b - a - 2), Math.max(1, hgt)); g.globalAlpha = 1;
        lastEnd = Math.max(lastEnd, t + 10800);
      }
      const ticks = (live.st.kp1m.data || []).filter((r) => r[0] >= lastEnd - 10800 && r[0] >= T0);
      g.strokeStyle = c.ink2; g.lineWidth = 1; g.globalAlpha = 0.6; g.beginPath();
      ticks.forEach(([t, kp], i) => { if (i % 5) return; const px = x(t); g.moveTo(px, y1); g.lineTo(px, y1 - kp / 9 * (y1 - y0)); });
      g.stroke(); g.globalAlpha = 1;
      const nv = nowValues(), at = bars.filter((r) => r[0] <= cur).pop(), kv = st.live ? nv.kp : at ? at[1] : null;
      val = `Kp ${kpStr(kv)} · G${(nv.scales && nv.scales.G) || 0}`;
    } else if (id === 'xray') {
      const toY = (f) => y1 - clamp((Math.log10(f) + 9) / 6, 0, 1) * (y1 - y0);
      g.strokeStyle = c.grid; g.lineWidth = 1;
      ['A', 'B', 'C', 'M', 'X'].forEach((L, i) => { const yy = toY(10 ** (i - 8)); g.beginPath(); g.moveTo(left, yy); g.lineTo(s.w - right, yy); g.stroke(); text(g, L, left - 4, yy + 3, { size: 10, weight: 500, color: c.ink3, align: 'right' }); });
      line(S.xray, y0, y1, toY, c.band.r, 300);
      const fl = (SW.flares || []).concat((live.st.flares.data || []).filter((f) => f[0] >= T1));
      g.strokeStyle = c.band.r; g.lineWidth = 3;
      for (const [t, cls] of fl) if (/^[CMX]/.test(cls || '') && t >= T0) { const px = x(t); g.beginPath(); g.moveTo(px, y0); g.lineTo(px, y0 + 6); g.stroke(); }
      val = xrClass(valueAt(S.xray, cur, 600));
    } else if (id === 'hp') {
      const all = S.hp.concat(S.hpS), top = all.some((p) => p[1] > 60) ? 200 : 60, toY = (v) => y1 - clamp(v / top, 0, 1) * (y1 - y0);
      line(S.hp, y0, y1, toY, tokens.aurora, 900, 1.2);
      g.globalAlpha = 0.5; line(S.hpS, y0, y1, toY, tokens.aurora, 900); g.globalAlpha = 1;
      const n = valueAt(S.hp, cur, 900), so = valueAt(S.hpS, cur, 900);
      val = n != null ? `N ${n} · S ${so ?? '–'}` : '–';
    }
    text(gv, val, s.w - 2, y0 + 13, { size: 12, weight: 600, color: id === 'speed' ? c.gold : id === 'hp' ? tokens.aurora : c.ink, align: 'right' });
  });
  const ybot = lanes.length * lh;
  const step = 6 * 3600;
  if (statics) {
    for (let t = T0; t < tEnd - 3600; t += step) text(g, hhmm(t), x(t), s.h - 4, { size: 11, color: c.ink3, align: 'center' });
    text(g, 'now', s.w - right, s.h - 4, { size: 11, color: c.ink3, align: 'center' });
    return;
  }
  g = gv;
  const v = valueAt(allSeries().speed, cur, 1800);
  if (v) {
    const lx = x(cur - 1.5e6 / v);
    g.save(); g.setLineDash([3, 3]); g.strokeStyle = c.gold; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, ybot); g.stroke(); g.restore();
    s.__lead = lx;
  }
  const cx = x(cur);
  g.strokeStyle = c.gold; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, ybot); g.stroke();
}
function stripTip(s, px, py, e) {
  const t = s.__inv(px);
  if (!(t >= T0)) { K.hideTip(); return; }
  const S = allSeries(), f = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
  const rows = [`<b>${fmtUtc(Math.min(t, nowS()), true)}</b>`, `Solar wind ${f(valueAt(S.speed, t, 900))} km/s · ${f(valueAt(S.density, t, 900), 1)} per cm³`, `Bz ${f(valueAt(S.bz, t, 900), 1)} nT`, `X-rays ${xrClass(valueAt(S.xray, t, 600))}`, `Aurora power N ${f(valueAt(S.hp, t, 900))} · S ${f(valueAt(S.hpS, t, 900))} GW <small>(model)</small>`];
  if (s.__lead && Math.abs(px - s.__lead) < 6) rows.push('Dashed line: the solar wind measured at L1 then, reaching Earth now');
  K.showTip(rows.join('<br>'), e.clientX, e.clientY);
}
function scalesRow() {
  const v = nowValues(), el = $('#eScales');
  if (!el) return;
  const one = (k, word) => { const n = v.scales[k] ?? 0, m = v.max24[k]; const lvl = Math.max(n, m || 0); return `<span class="sc${lvl >= 3 ? ' hi' : lvl >= 1 ? ' on' : ''}">${k}${n} ${word}${m > n ? ` · max ${m} in 24 h` : ''}</span>`; };
  el.innerHTML = `${one('R', 'radio')}${one('S', 'protons')}${one('G', 'storms')}`;
  const src = (live.st.wind.data && live.st.wind.data.active) || (SW.source && SW.source.active);
  const backups = ((live.st.wind.data && live.st.wind.data.sources) || (SW.source && SW.source.backups) || []).filter((x) => x !== src);
  const cap = $('#eStripCap');
  const nm = (x) => ({ SOLAR1: 'SWFO-L1', ACE: 'ACE', IMAP: 'IMAP', DSCOVR: 'DSCOVR' }[x] || x);
  if (cap) cap.textContent = `Measured at L1, 1.5 million km sunward, by ${src ? nm(src) : 'the active L1 spacecraft'}${backups.length ? ` (with ${backups.map(nm).join(' and ')} as backups)` : ''}, and by GOES in orbit. Bz south opens the door to the aurora. Gold line: the time on the map.`;
  const note = $('#eLiveNote');
  if (note) note.hidden = !(live.running && live.allFailed());
}

function regionsRender() {
  const el = $('#eRegions');
  if (!el) return;
  const max = Math.max(1, ...REGIONS.map((r) => r.total));
  const rows = [...REGIONS].sort((a, b) => (b.covered - a.covered) || (b.total - a.total));
  el.innerHTML = rows.map((r) => {
    const hrs = Array.from({ length: HOURS }, (_, h) => r.q15.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0)), top = Math.max(1, ...hrs);
    const pk = hrs.indexOf(Math.max(...hrs)), loc = ((Math.floor((T0 / 3600 + pk) % 24) + Math.round(r.lon / 15)) % 24 + 24) % 24;
    const path = hrs.map((v, h) => `${h ? 'L' : 'M'}${(h / (HOURS - 1) * 100).toFixed(1)} ${(12 - v / top * 11).toFixed(1)}`).join('');
    return `<button type="button" class="erow${r.covered ? '' : ' nodata'}" data-region="${esc(r.id)}">
      <span class="nm">${esc(r.name)}</span>
      <span class="bar">${r.covered || r.total ? `<span class="fill" style="width:${(Math.sqrt(r.total / max) * 100).toFixed(1)}%"></span><span class="n">${fmtM(r.total)}</span>` : '<span class="n">no open data</span>'}</span>
      <svg class="spark" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">${r.total ? `<path d="${path}"/>` : ''}<line class="cur" x1="0" x2="0" y1="0" y2="12"/></svg>
      <span class="pk">${r.total ? `peak ${pad(loc)}:00 local` : r.covered ? 'no flashes' : 'not covered'}</span></button>`;
  }).join('');
  el.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => { const r = REGIONS.find((x) => x.id === b.dataset.region); if (r) flyTo(r.lat, r.lon, 2); }));
  regionCursor();
}
function regionCursor() {
  const x = st.live ? 100 : clamp((st.t - T0) / (T1 - T0) * 100, 0, 100).toFixed(1);
  document.querySelectorAll('#eRegions line.cur').forEach((l) => { l.setAttribute('x1', x); l.setAttribute('x2', x); });
}

function flaresM() { return (SW.flares || []).filter((f) => /^[MX]/.test(f[1] || '')).sort((a, b) => (b[2] || 0) - (a[2] || 0)); }
function stormComing() {
  const fc = (live.st.kpf.data || SW.kpForecast || []).filter((r) => r[0] > nowS() && r[0] < nowS() + 3 * 86400);
  return fc.some((r) => r[1] >= 5);
}
function presetList() {
  const midLon = () => wrapLon(sunLL(st.live ? nowS() : st.t)[1] + 180);
  const amer = (() => {
    const ids = ['na', 'ca', 'san', 'sas'], regs = REGIONS.filter((r) => ids.includes(r.id));
    let best = 0, bh = 0;
    for (let h = 0; h < HOURS; h++) { const n = regs.reduce((a, r) => a + r.q15.slice(h * 4, h * 4 + 4).reduce((x, y) => x + y, 0), 0); if (n > best) { best = n; bh = h; } }
    return T0 + bh * 3600;
  })();
  const list = [
    { id: 'all', label: 'Everything', run: () => { const dv = M.defaultView || [0, -60]; flyTo(dv[0], dv[1], dv[2] || 1); setT(M.defaultT || T0); } },
    { id: 'north', label: 'Northern lights', emph: { light: 0.4, aurora: 1.3 }, run: () => { st.sel = { type: 'aurora', hemi: 1 }; flyTo(72, midLon(), 1.6); } },
    { id: 'south', label: 'Southern lights', emph: { light: 0.4, aurora: 1.3 }, run: () => { st.sel = { type: 'aurora', hemi: -1 }; flyTo(-72, midLon(), 1.6); } },
    { id: 'amer', label: 'Storms of the Americas', emph: { aurora: 0.6 }, run: () => { flyTo(-8, -62, 2.2); setT(amer); } },
    { id: 'gap', label: 'Where we can’t see', emph: { hatch: 1.6 }, run: () => { st.sel = null; flyTo(5, 105, 1.4); } },
  ];
  if (CELLS.length) list.push({ id: 'night', label: 'A storm’s night', emph: { others: 0.4, focus: 0 }, run: () => {
    const c = CELLS[0];
    st.sel = { type: 'storm', i: 0 };
    flyTo(c.lat, c.lon, 4, () => { setT(T0 + c.h0 * 3600); st.speed = 300; st.stopAt = T0 + (c.h1 + 1) * 3600; setPlay(true); });
  } });
  const fl = flaresM()[0];
  if (fl) list.push({ id: 'flare', label: 'When the Sun flared', emph: { dayTint: 0.1 }, run: () => { const [sd, sl] = sunLL(fl[0]); setT(fl[0]); flyTo(sd, sl, 1); } });
  if (stormComing()) list.push({ id: 'coming', label: 'Storm on the way', emph: { aurora: 1.3 }, run: () => { st.sel = { type: 'aurora', hemi: 1 }; setLive(true); flyTo(72, midLon(), 1.6); } });
  return list;
}
function runPreset(p) {
  st.emph = { light: 1, aurora: 1, hatch: 1, others: 1, dayTint: 0, focus: -1, ...(p.emph || {}) };
  if (p.id === 'all') st.sel = null;
  if (st.live && p.id !== 'coming') setLive(false);
  setPlay(false);
  p.run();
  renderCard(); glDirty = true; redraw();
  document.querySelectorAll('#ePresets .btn').forEach((b) => b.classList.toggle('on', b.dataset.p === p.id));
}
function presets() {
  const nav = $('#ePresets');
  nav.querySelectorAll('.btn').forEach((b) => b.remove());
  for (const p of presetList()) {
    const b = document.createElement('button');
    b.className = 'btn' + (p.id === 'all' ? ' on' : ''); b.type = 'button'; b.textContent = p.label; b.dataset.p = p.id;
    b.addEventListener('click', () => runPreset(p));
    nav.appendChild(b);
  }
}

function searchItems(q) {
  const v = q.trim().toLowerCase(), out = [];
  const storm = (i) => ({ label: CELLS[i].name.replace(/^Storm over /, 'Storm: '), color: tokens.ember, meta: `peak ~${fmtN(CELLS[i].peak)} flashes/h`, pick: () => { setT(T0 + CELLS[i].peakH * 3600); selectStorm(i); } });
  const aur = (hemi) => ({ label: hemi > 0 ? 'Northern lights' : 'Southern lights', color: tokens.aurora, meta: 'aurora oval, model', pick: () => openAurora(hemi) });
  if (!v) {
    CELLS.slice(0, 3).forEach((c, i) => out.push(storm(i)));
    const n = lastOf(SW.hpN), s = lastOf(SW.hpS);
    out.push(aur(!s || (n && n[1] >= s[1]) ? 1 : -1));
    return out;
  }
  CELLS.forEach((c, i) => { if (out.length < 6 && c.name.toLowerCase().includes(v)) out.push(storm(i)); });
  for (const h of [1, -1]) if ((h > 0 ? 'northern lights' : 'southern lights').includes(v)) out.push(aur(h));
  for (const p of PICK) if (out.length < 8 && p.label.toLowerCase().includes(v)) out.push({ label: p.label, color: 'var(--gold)', meta: `${Math.abs(p.lat).toFixed(0)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(0)}° ${p.lon >= 0 ? 'E' : 'W'}`, pick: () => { st.sel = { type: 'place', lat: p.lat, lon: p.lon }; renderCard(); flyTo(p.lat, p.lon, Math.max(view.k, 2)); } });
  return out;
}

function onUpdate(id, ok) {
  if (!entered) return;
  if (id === 'ovation' && ok) { liveGrid = live.st.ovation.data; if (gridState === 'live') gridState = ''; if (st.live) glDirty = true; }
  if (id === 'kpf' && ok) presets();
  scalesRow();
  if (!st.sel || st.sel.type === 'aurora') renderCard();
  if (stripS) drawStrip(stripS);
  if (dock) dock.update(true);
  refreshData();
  loop();
}

function buildDom() {
  const root = $('#earthRoot');
  root.innerHTML = sceneHtml('earth', {
    qid: 'h-emap', stageCls: 'e-map', mainCls: 'emain', wrapCls: 'e-wrap', pillId: 'eTools',
    question: 'Where is the night sky glowing?',
    canvas: '<div class="e-stage"><canvas id="earthGl" tabindex="0" aria-label="Globe with the two polar caps. Drag to turn, wheel or pinch to zoom, plus and minus zoom, 0 resets, arrows turn."></canvas><canvas id="earthOv" aria-hidden="true"></canvas></div>',
    zoom: '<div class="zoom ezoom"><button class="btn sm" type="button" id="eZoomIn" aria-label="Zoom in" title="Zoom in">+</button><button class="btn sm" type="button" id="eZoomOut" aria-label="Zoom out" title="Zoom out">−</button><button class="btn sm" type="button" id="eZoomReset" hidden>Reset view</button><button class="btn sm" type="button" id="eClouds" aria-pressed="false" title="Show today’s clouds from five weather satellites">Clouds</button></div>',
    overlay: '<p class="note ecloud" id="eCloudNote" aria-live="polite" hidden></p>',
    views: { nav: 'ePresets', label: 'Guided views of the Earth', first: 'Everything' },
    dockCls: 'etime',
    dock: dockHtml({ play: 'ePlay', date: 'eDate', track: 'eTrack', speed: 'eSpeed', live: 'eLive', label: 'Time track: lightning flashes in the 24 hours of nightly data, hatched after the nightly update, with the solar wind’s Bz below. Left and right arrows step 10 minutes, Shift an hour; L goes live.' }),
    info: {
      cap: `The Earth at night from NASA’s Black Marble, the aurora the OVATION model expects, and the lightning the ${LI_ON ? 'GOES and Meteosat' : 'GOES'} satellites saw. Gold line: dusk and dawn.${LI_ON ? ' Contains modified EUMETSAT Meteosat data 2026.' : ''}`,
      about: '<p>City lights are NASA’s Black Marble 2016 composite, not tonight’s lights. The aurora is OVATION Prime, a model: a 30–90 minute forecast from the solar wind measured at L1, not an observation. One model run is kept each night; for other hours it is turned with the Sun. Live shows the newest run. The aurora is drawn on two shells about 1.7% and 3.4% above the surface (110 and 220 km), true to scale, so it pokes past the limb. GLM (and, over Europe and Africa, MTG’s Lightning Imager) sees total lightning, cloud-to-ground and in-cloud, from geostationary orbit, and detects fewer flashes by day; where two satellites overlap, each flash is kept from the one whose point below is nearer. Hatched: nobody shares open lightning data there yet. GLM flash areas are optical footprints, not channel lengths. City lights and aurora are styled into the site’s palette. Geomagnetic poles: the 2025 IGRF dipole. Tags: <span class="prov live"></span> live, <span class="prov nightly"></span> nightly copy, <span class="prov model">◆</span> model.</p>',
      key: 'eLegend',
      honest: 'Aurora: a model (OVATION), not an observation. Lightning: last night’s satellites, not live. City lights: 2016. Hatched: no open lightning data.',
    },
    instruments: [
      { label: 'Space weather', cls: 'e-sw', html: `<h3 id="h-esw">What is the Sun sending us?</h3><p class="cap" id="eStripCap">Measured at L1, 1.5 million km sunward, and by GOES in orbit. Bz south opens the door to the aurora. Gold line: the time on the map.</p>
      <div class="escales" id="eScales"></div>
      <p class="note" id="eLiveNote" hidden>Live data from NOAA did not load; showing the nightly copy to ${hhmm(T1)}.</p>
      <canvas id="eStrip" aria-label="Space weather over the last day: solar wind, density, magnetic field, Kp, X-rays and aurora power. Click or drag to move in time."></canvas>` },
      { label: 'Regions', cls: 'e-reg', html: '<h3 id="h-ereg">Where is it storming?</h3><p class="cap">Flashes per region over the 24 hours, square-root bar length. Hatched: nobody shares open lightning data there. Click a region to fly to it.</p><div class="eregions" id="eRegions"></div>' },
    ],
    card: { id: 'eCard', hid: 'h-ecard', body: 'eCardBody', title: 'Earth card' },
  });
  wireScene('earth', root);
}

async function loadImages() {
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + src)); im.src = src; });
  const [lights, land] = await Promise.all([load(innerWidth < 700 ? 'data/earth-lights-2048.jpg' : 'data/earth-lights-4096.jpg'), load('data/earth-land-2048.png')]);
  return { lights, land };
}
async function build() {
  buildDom();
  ov = $('#earthOv').getContext('2d');
  readColors();
  imgs = await loadImages();
  G = EG.initGl($('#earthGl'));
  if (G) { EG.uploadImage(G, 0, imgs.lights); EG.uploadImage(G, 1, imgs.land); $('#earthGl').addEventListener('snapshot', drawGl); }
  else glFail = 'WebGL is not available here, so the globe is drawn once per view without the aurora shells.';
  pill = SC.makePill($('#eTools'), { onToggle: toggleWhy, onBack: toggleWhy });
  whyEl = document.createElement('div');
  whyEl.className = 'ewhy'; whyEl.hidden = true; whyEl.id = 'eWhy';
  whyEl.textContent = 'About 15 flashes a second fall in GLM’s view. Drawing all of them would be a white blur, so the map draws about 30 a second and the violet haze shows them all. Zoom in to draw more.';
  $('#eTools').appendChild(whyEl);
  stripS = K.setupCanvas($('#eStrip'), drawStrip);
  const strip = $('#eStrip');
  let drag = false;
  const scrub = (e) => { const r = strip.getBoundingClientRect(), t = stripS.__inv(e.clientX - r.left); if (t > T1 + 600) setLive(true); else setT(t); };
  const focusStrip = (v) => { if (stripFocus !== v) { stripFocus = v; K.pingLadder(); } };
  strip.addEventListener('pointerdown', (e) => { drag = true; focusStrip(true); strip.setPointerCapture(e.pointerId); scrub(e); });
  strip.addEventListener('pointermove', (e) => { const r = strip.getBoundingClientRect(); if (drag) scrub(e); else if (e.pointerType === 'mouse') { focusStrip(true); stripTip(stripS, e.clientX - r.left, e.clientY - r.top, e); } });
  strip.addEventListener('pointerup', (e) => { drag = false; if (e.pointerType !== 'mouse') focusStrip(false); });
  strip.addEventListener('pointerleave', () => { K.hideTip(); focusStrip(false); });
  wire();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && entered) loop(); });
  presets();
  legend();
  regionsRender();
  built = true;
}
function toggleWhy() { whyEl.hidden = !whyEl.hidden; }

async function enter(objId) {
  entered = true;
  if (!built) {
    $('#earthLoading').hidden = false;
    try { await build(); } finally { $('#earthLoading').hidden = true; }
  }
  if (!entered) return;
  K.shell.setSearch({ items: searchItems, empty: 'No storm or place matches. Try Northern lights.' }, 'Search a storm or a place');
  drawnFlashes = 0; eggs.count = 0; eggs.last = null; eggList.length = 0; eggQueue.length = 0;
  const params = new URLSearchParams(location.search);
  if (objId) { const i = CELLS.findIndex((c) => c.name === objId); if (i >= 0) st.sel = { type: 'storm', i }; }
  const tp = params.get('t');
  if (tp) { const v = /^\d+$/.test(tp) ? +tp : Date.parse(tp) / 1000; if (Number.isFinite(v)) st.t = clamp(v, T0, T1); }
  requestAnimationFrame(() => {
    layout(); makeBasis(); stripS.resize(); renderCard(); scalesRow(); syncTime();
    if (params.has('live')) setLive(true);
    else if (!reduceMotion && (params.has('play') || (!tp && !objId && !params.has('pause')))) setPlay(true);
    redraw();
  });
  if (live.enabled) live.start();
  if (cloudPref() && !clouds.on) setClouds(true); else cloudUi();
}
function leave() {
  entered = false; setPlay(false); live.stop(); K.hideTip(); idleStop();
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

const dataProvider = {
  live: true, title: 'Earth data',
  status: () => {
    const a = live.st.speed.at || live.st.scales.at;
    return `Live data from NOAA SWPC, checked every minute while this view is open.${a ? ` Last answer at <b>${hhmm(a / 1000)} UTC</b>.` : ''} Lightning and the nightly copy run to <b>${fmtUtc(T1)}</b>.`;
  },
  optText: 'Keep checking for live data',
  optChecked: () => live.enabled,
  onOpt: (v) => { live.setEnabled(v); if (v && entered) live.start(); scalesRow(); },
  note: 'Requests go from this browser straight to services.swpc.noaa.gov, one per product per minute at most, and only while this view is open and the tab is visible. Nothing about you is sent.',
  label: () => (live.anyOk() ? 'Data · live' : `Data · ${dOf(T1).getUTCDate()} ${MON[dOf(T1).getUTCMonth()]}`),
};
registerData('earth', dataProvider);

export const api = (K.ns.earth = {
  enter, leave, setT, setLive, setPlay, flyTo, zoomAt, runPreset: (id) => { const p = presetList().find((x) => x.id === id); if (p) runPreset(p); },
  eggs, stats, live, view, perf: K.perf,
  get state() { return st; }, get gl() { return !!G; }, get drawn() { return drawnFlashes; }, get tiles() { return [...tiles.keys()]; },
  get box() { return { ...box }; }, ringList: () => ringList, proj: (lat, lon) => { const p = projLL(lat, lon); return [p.x, p.y, p.z]; }, get active() { return active.map((f) => [f.F.lat[f.k], f.F.lon[f.k], Math.round(performance.now() - f.born)]); },
});
