import * as K from './kit.js';
import { register as registerData, fmtBytes } from './datapanel.js';
import { openStore, post, pool, storageUsage } from './net.js';

const V = '?v=2026-11-22';
const D = await K.loadJson('data/cmb.json' + V);
const { $, fmtN, MON, clamp, esc, text, annotate } = K;
const C = () => K.C;
const reduceMotion = K.reduceMotion;
const DEG = Math.PI / 180;
const M = D.meta, CL = D.clusters, NC = CL.name.length, LT = D.lensing, CT = D.clusterTest;
const BASE = M.mjdBase;
const TITLE = 'The dark-matter shadow';

const raw = Uint8Array.from(atob(D.alerts.data), (c) => c.charCodeAt(0));
const triples = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
let NA = D.alerts.n;
let aL = new Float32Array(NA), aB = new Float32Array(NA), aT = new Float64Array(NA);
for (let k = 0; k < NA; k++) { aL[k] = triples[3 * k] / 65535 * 360; aB[k] = triples[3 * k + 1] / 65535 * 180 - 90; aT[k] = BASE + triples[3 * k + 2] / 100; }
const BUNDLED = { nobj: NC, nunit: NA, tmax: aT[NA - 1] };
let T0 = Math.floor(aT[0]), T1 = Math.ceil(aT[NA - 1]);

function hammer(l, b) {
  let lam = l > 180 ? l - 360 : l;
  lam = -lam * DEG;
  const phi = b * DEG, den = Math.sqrt(1 + Math.cos(phi) * Math.cos(lam / 2));
  return [2 * Math.SQRT2 * Math.cos(phi) * Math.sin(lam / 2) / den, Math.SQRT2 * Math.sin(phi) / den];
}
const frameOf = (s) => { const sc = Math.min(s.w / (4 * Math.SQRT2), s.h / (2 * Math.SQRT2)) * 0.97; return { sc, cx: s.w / 2, cy: s.h / 2 }; };

const st = { t: T1, playing: false, speed: 2, amp: 1, shadow: 0, shadowTarget: 0, sel: -1, hover: -1, lan: null, lanR: 0.2 };
let built = false, entered = false;
let sky = null, ov = null, gl = null, glFail = '', imgs = null, meterS = null, ctestS = null;
let cx = new Float32Array(NC), cy = new Float32Array(NC), ax = new Float32Array(0), ay = new Float32Array(0);
let ringCv = [null, null], emberCv = null, emberN = 0;
const WRAP_MS = 1600;
let wrapAt = 0, wrapAlpha = 1;
const lb = (arr, x, n = arr.length) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const dateOf = (t) => new Date((t - 40587) * 864e5);
const fmtD = (t) => { const d = dateOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = `precision highp float;
uniform sampler2D uSky; uniform sampler2D uLens;
uniform vec2 uRes; uniform vec3 uFrame; uniform vec3 uLan; uniform float uAmp; uniform float uShadow;
uniform vec3 uCool; uniform vec3 uWarm; uniform vec3 uKLo; uniform vec3 uKHi; uniform vec3 uNeutral; uniform vec3 uGold;
uniform float uDefl; uniform float uDark; uniform float uZoom; uniform float uGrid; uniform float uDegPx;
const float PI = 3.14159265;
vec2 lonlatToUv(float l, float b) { return vec2(fract(l / 360.0), clamp((90.0 - b) / 180.0, 0.0005, 0.9995)); }
vec3 skyAt(vec2 px) {
  float u = (px.x - uFrame.y) / uFrame.x, v = (uFrame.z - px.y) / uFrame.x;
  float q = 1.0 - (u / 4.0) * (u / 4.0) - (v / 2.0) * (v / 2.0);
  float z = sqrt(max(q, 0.0));
  float lam = 2.0 * atan(z * u, 2.0 * (2.0 * z * z - 1.0));
  return vec3(mod(-lam * 180.0 / PI + 360.0, 360.0), asin(clamp(z * v, -1.0, 1.0)) * 180.0 / PI, q);
}
vec2 deflAt(float l, float b) {
  vec2 acc = vec2(0.0); float wsum = 0.0;
  float cb = max(cos(b * PI / 180.0), 0.1);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    float wt = exp(-0.5 * float(i * i + j * j) / 1.6);
    vec4 t = texture2D(uLens, lonlatToUv(l + float(i) * 0.7 / cb, b + float(j) * 0.7));
    acc += wt * vec2(t.r * 255.0 - 128.0, t.g * 255.0 - 128.0); wsum += wt;
  }
  return acc / wsum * uDefl;
}
float gridLine(float d, float spacingPx) { return 1.0 - smoothstep(0.2, 0.95, d * spacingPx); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float q0 = skyAt(px).z;
  if (q0 < 0.5) { gl_FragColor = vec4(0.0); return; }
  float edge = smoothstep(0.5, 0.503, q0);
  float dist = length(px - uLan.xy);
  float w = 1.0 - smoothstep(uLan.z * 0.82, uLan.z, dist);
  vec2 src = uLan.xy + (px - uLan.xy) * mix(1.0, 1.0 / uZoom, w);
  vec3 sp = skyAt(src);
  float l = sp.x, b = sp.y;
  if (sp.z < 0.5) w = 0.0;
  vec4 lens = texture2D(uLens, lonlatToUv(l, b));
  float a = uAmp * w;
  vec2 dd = a > 0.0 ? deflAt(l, b) : vec2(0.0);
  float dth = dd.x, dph = dd.y;
  float b2 = b - a * dth / 60.0;
  float l2 = l + a * dph / 60.0 / max(cos(b * PI / 180.0), 0.05);
  if (b2 > 90.0) { b2 = 180.0 - b2; l2 += 180.0; } else if (b2 < -90.0) { b2 = -180.0 - b2; l2 += 180.0; }
  vec4 s0 = texture2D(uSky, lonlatToUv(l, b));
  vec4 s1 = texture2D(uSky, lonlatToUv(l2, b2));
  float t = clamp((s1.r * 255.0 - 128.0) / 110.0 * mix(1.0, 1.7, w), -1.0, 1.0);
  vec3 cmb = mix(uCool, uWarm, 0.5 + 0.5 * t) * mix(0.86 + 0.14 * abs(t), 0.72 + 0.5 * abs(t), w);
  cmb *= mix(0.72, 1.0, s0.g);
  float k = clamp((lens.b * 255.0 - 128.0) / 110.0, -1.0, 1.0);
  vec3 kap = mix(uKLo, uKHi, smoothstep(-0.9, 0.9, k));
  kap = mix(uNeutral, kap, s0.b * step(0.5 / 255.0, lens.b));
  vec3 col = mix(cmb, kap, max(uShadow, 0.22 * w));
  float pxPerDeg = uZoom / uDegPx;
  float gb = abs(b2 - uGrid * floor(b2 / uGrid + 0.5));
  float gl = abs(l2 - uGrid * floor(l2 / uGrid + 0.5)) * cos(b2 * PI / 180.0);
  float line = max(gridLine(gb, pxPerDeg), gridLine(gl, pxPerDeg)) * w;
  col = mix(col, uGold, line * mix(0.55, 0.7, uDark));
  gl_FragColor = vec4(col * edge, edge);
}`;

function hexRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) return m[1].split(',').slice(0, 3).map((x) => +x / 255);
  const h = c.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return v.map((x) => parseInt(x, 16) / 255);
}
const PALETTE = {
  dark: { cool: [0.1, 0.14, 0.3], warm: [0.55, 0.33, 0.24], klo: [0.07, 0.08, 0.15], khi: [0.72, 0.63, 0.46], neutral: [0.12, 0.13, 0.18] },
  light: { cool: [0.55, 0.62, 0.8], warm: [0.9, 0.7, 0.58], klo: [0.5, 0.54, 0.64], khi: [0.97, 0.93, 0.84], neutral: [0.84, 0.84, 0.86] },
};

function initGl(cv) {
  let g = null;
  try { g = cv.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }) || cv.getContext('experimental-webgl'); } catch { g = null; }
  if (!g) { glFail = 'WebGL is not available here, so the map is drawn once without the bending lens.'; return null; }
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader'); return s; };
  try {
    const pr = g.createProgram();
    g.attachShader(pr, sh(g.VERTEX_SHADER, VERT)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error('link');
    g.useProgram(pr);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uSky', 'uLens', 'uRes', 'uFrame', 'uLan', 'uAmp', 'uShadow', 'uCool', 'uWarm', 'uKLo', 'uKHi', 'uNeutral', 'uGold', 'uDefl', 'uDark', 'uZoom', 'uGrid', 'uDegPx']) U[n] = g.getUniformLocation(pr, n);
    return { g, pr, U, tex: [] };
  } catch (e) { glFail = 'WebGL could not start here, so the map is drawn once without the bending lens.'; return null; }
}
function uploadTextures() {
  const { g } = gl;
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
  [imgs.sky, imgs.lens].forEach((im, k) => {
    const t = g.createTexture();
    g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, im);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    gl.tex.push(t);
  });
  g.uniform1i(gl.U.uSky, 0); g.uniform1i(gl.U.uLens, 1);
}

const skyBox = { w: 0, h: 0, dpr: 1 };
function sizeSky() {
  const cv = $('#dmGl'), r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, r.width < 700 ? 1.5 : 2);
  skyBox.w = r.width; skyBox.h = r.height; skyBox.dpr = dpr;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const o = $('#dmOv'); o.width = cv.width; o.height = cv.height;
  ov.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!st.lan) st.lan = defaultLantern();
  project();
  buildRings();
  emberCv = null;
  drawGl();
  drawOverlay();
}
function defaultLantern() { const f = frameOf(skyBox), [u, v] = hammer(240, -35); return [f.cx + u * f.sc, f.cy - v * f.sc]; }
const LENS_ZOOM = 3, BREATH_S = 7;
const breathing = () => !reduceMotion && st.amp > 1 && st.shadowTarget === 0;
function ampNow() { return breathing() ? 1 + (st.amp - 1) * (0.5 - 0.5 * Math.cos(performance.now() / 1000 * 2 * Math.PI / BREATH_S)) : st.amp; }
function lanRadius() { return Math.max(56, Math.min(skyBox.w, skyBox.h) * st.lanR); }

let fallbackCv = null;
function drawGl() {
  if (!skyBox.w || !imgs) return;
  const f = frameOf(skyBox), dk = C().dark, P = dk ? PALETTE.dark : PALETTE.light;
  if (!gl) { drawFallback(f, P); return; }
  const { g, U } = gl, d = skyBox.dpr;
  g.viewport(0, 0, g.canvas.width, g.canvas.height);
  g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.uniform2f(U.uRes, g.canvas.width, g.canvas.height);
  g.uniform3f(U.uFrame, f.sc * d, f.cx * d, f.cy * d);
  g.uniform3f(U.uLan, st.lan[0] * d, st.lan[1] * d, lanRadius() * d);
  g.uniform1f(U.uAmp, ampNow()); g.uniform1f(U.uShadow, st.shadow);
  const degPx = 40.5 / (f.sc * d), lensDeg = lanRadius() * d * degPx / LENS_ZOOM;
  g.uniform1f(U.uZoom, LENS_ZOOM); g.uniform1f(U.uDegPx, degPx); g.uniform1f(U.uGrid, [0.5, 1, 2, 5, 10].find((x) => x >= lensDeg / 3.5) || 10);
  g.uniform3fv(U.uGold, hexRgb(C().gold));
  g.uniform3fv(U.uCool, P.cool); g.uniform3fv(U.uWarm, P.warm); g.uniform3fv(U.uKLo, P.klo); g.uniform3fv(U.uKHi, P.khi); g.uniform3fv(U.uNeutral, P.neutral);
  g.uniform1f(U.uDefl, M.deflectionScaleArcmin); g.uniform1f(U.uDark, dk ? 1 : 0);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
}
function drawFallback(f, P) {
  const cv = $('#dmGl'), ctx = cv.getContext('2d');
  if (!ctx) return;
  if (!fallbackCv) {
    const src = document.createElement('canvas'); src.width = 1024; src.height = 512;
    const sg = src.getContext('2d'); sg.drawImage(imgs.sky, 0, 0, 1024, 512);
    fallbackCv = sg.getImageData(0, 0, 1024, 512).data;
  }
  const W = cv.width, H = cv.height, im = ctx.createImageData(W, H), d = skyBox.dpr;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x / d - f.cx) / f.sc, v = (f.cy - y / d) / f.sc, q = 1 - (u / 4) ** 2 - (v / 2) ** 2;
    if (q < 0.5) continue;
    const z = Math.sqrt(q), lam = 2 * Math.atan2(z * u, 2 * (2 * z * z - 1)), b = Math.asin(clamp(z * v, -1, 1)) / DEG;
    const l = ((-lam / DEG) % 360 + 360) % 360;
    const px = Math.min(1023, Math.floor(l / 360 * 1024)), py = Math.min(511, Math.floor((90 - b) / 180 * 512)), k = (py * 1024 + px) * 4;
    const t = clamp((fallbackCv[k] - 128) / 110, -1, 1), m = 0.5 + 0.5 * t, sh = (0.86 + 0.14 * Math.abs(t)) * (fallbackCv[k + 1] > 127 ? 1 : 0.72);
    const p = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) im.data[p + c] = 255 * (P.cool[c] + (P.warm[c] - P.cool[c]) * m) * sh;
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

function project() {
  const f = frameOf(skyBox);
  for (let i = 0; i < NC; i++) { const [u, v] = hammer(CL.l[i], CL.b[i]); cx[i] = f.cx + u * f.sc; cy[i] = f.cy - v * f.sc; }
  ax = new Float32Array(NA); ay = new Float32Array(NA);
  for (let k = 0; k < NA; k++) { const [u, v] = hammer(aL[k], aB[k]); ax[k] = f.cx + u * f.sc; ay[k] = f.cy - v * f.sc; }
}
const RING_PX_PER_ARCMIN = 0.45;
const ringScale = () => frameOf(skyBox).sc / 135;
const ringR = (i) => Math.max(0.7, CL.theta500[i] * RING_PX_PER_ARCMIN * ringScale());
function buildRings() {
  const d = skyBox.dpr;
  ringCv = [1, 1.18].map((sc) => {
    const c = document.createElement('canvas'); c.width = Math.round(skyBox.w * d); c.height = Math.round(skyBox.h * d);
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    g.strokeStyle = C().gold; g.lineWidth = 0.7; g.globalAlpha = sc > 1 ? 0.18 : 0.42;
    g.beginPath();
    for (let i = 0; i < NC; i++) { const r = ringR(i) * sc; g.moveTo(cx[i] + r, cy[i]); g.arc(cx[i], cy[i], r, 0, 6.283); }
    g.stroke();
    return c;
  });
}

function lensWindow(g, R) {
  const [lx, ly] = st.lan, inner = R * 0.82;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const gr = g.createRadialGradient(lx, ly, inner, lx, ly, R);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(lx, ly, R, 0, 6.283); g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.arc(lx, ly, inner, 0, 6.283); g.clip();
  g.strokeStyle = C().gold; g.lineWidth = 1;
  for (let i = 0; i < NC; i++) {
    const dx = cx[i] - lx, dy = cy[i] - ly;
    if (i !== st.sel || Math.hypot(dx, dy) * LENS_ZOOM > inner + 40) continue;
    g.globalAlpha = 1; g.lineWidth = 2;
    g.beginPath(); g.arc(lx + dx * LENS_ZOOM, ly + dy * LENS_ZOOM, ringR(i) * LENS_ZOOM, 0, 6.283); g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
}
function drawOverlay() {
  if (!skyBox.w || !entered) return;
  const g = ov, s = skyBox, f = frameOf(s), now = performance.now() / 1000;
  g.clearRect(0, 0, s.w, s.h);
  g.save();
  g.beginPath(); g.ellipse(f.cx, f.cy, 2 * Math.SQRT2 * f.sc, Math.SQRT2 * f.sc, 0, 0, 6.283);
  g.strokeStyle = C().goldSoft; g.lineWidth = 1; g.stroke();
  g.restore();
  const nNow = lb(aT, st.t + 1e-9, NA);
  if (!emberCv || emberCv.width !== Math.round(s.w * s.dpr)) { emberCv = document.createElement('canvas'); emberCv.width = Math.round(s.w * s.dpr); emberCv.height = Math.round(s.h * s.dpr); emberN = 0; }
  const eg = emberCv.getContext('2d');
  eg.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  if (nNow < emberN) { eg.clearRect(0, 0, s.w, s.h); emberN = 0; }
  if (nNow > emberN) {
    eg.fillStyle = C().gold; eg.globalAlpha = C().dark ? 0.1 : 0.16;
    eg.beginPath();
    for (let k = emberN; k < nNow; k++) eg.rect(ax[k] - 0.5, ay[k] - 0.5, 1, 1);
    eg.fill(); eg.globalAlpha = 1; emberN = nNow;
  }
  g.globalAlpha = wrapAlpha; g.drawImage(emberCv, 0, 0, s.w, s.h); g.globalAlpha = 1;
  const breathe = reduceMotion ? 0.3 : 0.5 + 0.5 * Math.sin(now * 1.1);
  g.globalAlpha = 1 - breathe * 0.55; g.drawImage(ringCv[0], 0, 0, s.w, s.h);
  g.globalAlpha = breathe * 0.8; g.drawImage(ringCv[1], 0, 0, s.w, s.h);
  g.globalAlpha = 1;
  const i0 = lb(aT, st.t - 3, NA);
  g.fillStyle = C().gold;
  for (let k = Math.max(i0, nNow - 2500); k < nNow; k++) {
    const age = st.t - aT[k], a = reduceMotion ? 0.8 : Math.exp(-age / 1.2), r = 1 + 2.2 * a;
    g.globalAlpha = (0.15 + 0.6 * a) * wrapAlpha;
    g.beginPath(); g.arc(ax[k], ay[k], r, 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
  const R = lanRadius();
  lensWindow(g, R);
  g.strokeStyle = C().gold; g.lineWidth = 1.2; g.globalAlpha = 0.9;
  g.beginPath(); g.arc(st.lan[0], st.lan[1], R, 0, 6.283); g.stroke();
  g.globalAlpha = 1;
  text(g, st.amp > 1 ? `magnified ${LENS_ZOOM}× · bending ×${Math.round(ampNow())}` : `magnified ${LENS_ZOOM}× · true bending`, st.lan[0], st.lan[1] - R - 8, { size: 12, weight: 600, color: C().gold, align: 'center', halo: true });
  for (const [i, col, w] of [[st.hover, C().ink, 1.5], [st.sel, C().hi, 2]]) {
    if (i < 0) continue;
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx[i], cy[i], ringR(i) + 5, 0, 6.283); g.stroke();
    if (i === st.sel) annotate(g, CL.name[i], cx[i] + 12, cy[i] - 12, { size: 17, color: C().ink, align: 'left' });
  }
  text(g, fmtD(st.t), 16, s.h - 30, { size: 16, weight: 650, color: C().ink, halo: true });
  if (s.w >= 500) text(g, `${fmtN(nNow)} SN-like alerts so far · ${fmtN(NC)} ACT clusters (rings drawn ${Math.round(RING_PX_PER_ARCMIN * ringScale() * 60 / (frameOf(s).sc * DEG))}× their R500)`, 16, s.h - 12, { size: 12, color: C().ink2, halo: true });
  if (glFail) text(g, glFail, 16, 18, { size: 12, color: C().ink2, halo: true });
}

let raf = 0, lastTs = 0;
function frame(ts) {
  raf = 0;
  if (!entered) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  if (lastTs) K.pushPerf(K.perf.frame, ts - lastTs);
  lastTs = ts;
  const c0 = performance.now();
  let glDirty = false;
  if (st.playing) {
    if (wrapAt) {
      const p = Math.min(1, (ts - wrapAt) / WRAP_MS);
      wrapAlpha = 1 - p * p * (3 - 2 * p);
      if (p >= 1) { wrapAt = 0; wrapAlpha = 1; st.t = T0; emberN = 0; emberCv = null; }
    } else {
      st.t += dt * st.speed;
      if (st.t > T1) { st.t = T1; wrapAt = ts; }
    }
    syncTime();
  }
  if (Math.abs(st.shadow - st.shadowTarget) > 0.001) { st.shadow += clamp(st.shadowTarget - st.shadow, -dt * 2.5, dt * 2.5); glDirty = true; }
  if (breathing()) glDirty = true;
  if (glDirty || st.glDirty) { st.glDirty = false; drawGl(); }
  drawOverlay();
  K.pushPerf(K.perf.draw, performance.now() - c0);
  raf = requestAnimationFrame(frame);
}
function loop() { if (!raf && entered) { lastTs = 0; raf = requestAnimationFrame(frame); } }

function syncTime() {
  const sl = $('#dSlider'); if (sl) sl.value = ((st.t - T0) / (T1 - T0) * 1000).toFixed(2);
  const dd = $('#dDate'); if (dd) dd.textContent = fmtD(st.t);
}
function setPlay(p) {
  st.playing = p;
  if (!p) { wrapAt = 0; wrapAlpha = 1; }
  const b = $('#dPlay');
  b.querySelector('span').textContent = p ? 'Pause' : 'Play';
  b.querySelector('path.pl').setAttribute('d', p ? 'M8 5.5v13M16 5.5v13' : 'M8 5.5v13l10.5-6.5z');
  b.setAttribute('aria-label', p ? 'Pause' : 'Play'); b.classList.toggle('on', p);
}

function nearestCluster(x, y, r) {
  let best = -1, bd = r * r;
  for (let i = 0; i < NC; i++) { const d = (cx[i] - x) ** 2 + (cy[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function tipFor(i) { return `<b>${esc(CL.name[i])}</b><br>z = ${CL.z[i].toFixed(2)} · M500 = ${CL.m500[i].toFixed(1)}×10¹⁴ M☉<br>${CL.inside[i]} SN-like alerts inside R500`; }
function select(i) { st.sel = i; K.setUrl({ obj: i >= 0 ? CL.name[i] : null }); renderCard(); }

function renderCard() {
  const body = $('#dCardBody');
  const i = st.sel;
  if (i < 0) {
    const rich = [...Array(NC).keys()].filter((k) => CL.inside[k] > 0).sort((a, b) => CL.inside[b] - CL.inside[a]).slice(0, 6);
    const heavy = [...Array(NC).keys()].sort((a, b) => CL.m500[b] - CL.m500[a]).slice(0, 2);
    body.innerHTML = `<h3 class="ph">Pick a cluster</h3>
      <p class="cap">Each gold ring is a galaxy cluster found by the Atacama Cosmology Telescope through the shadow its hot gas casts on the CMB. Tap a ring, or meet these:</p>
      <ul class="hooks">${[...rich, ...heavy].map((k) => `<li><button type="button" data-pick="${k}"><span class="sw" style="background:var(--gold)"></span><b>${esc(CL.name[k])}</b><span>${CL.inside[k] ? `${CL.inside[k]} SN-like alerts inside R500` : `one of the most massive: ${CL.m500[k].toFixed(1)}×10¹⁴ M☉`}</span></button></li>`).join('')}</ul>`;
    body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => select(+b.dataset.pick)));
    return;
  }
  const facts = [
    ['Redshift', CL.z[i].toFixed(3)],
    ['Mass M500', `${CL.m500[i].toFixed(2)}×10¹⁴ M☉ <small>(calibrated SZ mass)</small>`],
    ['Radius θ500', `${CL.theta500[i].toFixed(2)}′ <small>on the sky</small>`],
    ['SN-like alerts inside R500', `${CL.inside[i]} <small>(counted for the ${CT.clusters} clusters with Rubin coverage)</small>`],
    ['RA, Dec', `${CL.ra[i].toFixed(3)}°, ${CL.dec[i].toFixed(3)}°`],
    ['Galactic l, b', `${CL.l[i].toFixed(1)}°, ${CL.b[i].toFixed(1)}°`],
  ];
  body.innerHTML = `<h3>${esc(CL.name[i])}</h3>
    <div class="cls"><span class="sw" style="background:var(--gold)"></span>ACT DR5 SZ galaxy cluster</div>
    <p class="cap">Its hot gas scatters CMB photons (the Sunyaev–Zel’dovich effect); its mass, mostly dark matter, bends the CMB around it by a fraction of an arcminute.</p>
    <dl>${facts.map(([k, v]) => `<div style="grid-column:span ${v.length > 40 ? 3 : 1}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p class="note">R500 is the radius inside which the mean density is 500 times the critical density of the universe; here it spans ${CL.theta500[i].toFixed(1)} arcminutes.</p>`;
}

function drawMeter(s, opts) {
  if (!s.w) return;
  const g = s.ctx, dk = C().dark;
  g.clearRect(0, 0, s.w, s.h);
  const cxm = s.w / 2, cym = s.h - 30, R = Math.min(s.w / 2 - 20, s.h - 54);
  const [lo, hi] = opts.range, A = (x) => Math.PI + (clamp(x, lo, hi) - lo) / (hi - lo) * Math.PI;
  const pt = (x, r) => [cxm + Math.cos(A(x)) * r, cym + Math.sin(A(x)) * r];
  g.strokeStyle = C().line; g.lineWidth = 1;
  g.beginPath(); g.arc(cxm, cym, R, Math.PI, 2 * Math.PI); g.stroke();
  if (opts.nulls) {
    g.strokeStyle = C().ink3; g.lineWidth = 1; g.globalAlpha = dk ? 0.16 : 0.22;
    g.beginPath();
    for (const v of opts.nulls) { const [x0, y0] = pt(v, R * 0.55), [x1, y1] = pt(v, R * 0.98); g.moveTo(x0, y0); g.lineTo(x1, y1); }
    g.stroke(); g.globalAlpha = 1;
  }
  for (let x = Math.ceil(lo); x <= hi; x++) {
    const [x0, y0] = pt(x, R), [x1, y1] = pt(x, R + (x % 3 === 0 ? 7 : 4));
    g.strokeStyle = C().ink3; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    if (x % opts.every === 0) { const [tx, ty] = pt(x, R + 18); text(g, `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}σ`, tx, ty + 4, { size: 11, color: C().ink3, align: 'center' }); }
  }
  const [t0x, t0y] = pt(3, R * 0.5), [t1x, t1y] = pt(3, R * 1.0);
  g.setLineDash([3, 3]); g.strokeStyle = C().gold; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(t0x, t0y); g.lineTo(t1x, t1y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  if (opts.ref != null) {
    const [r0x, r0y] = pt(opts.ref, R * 0.62), [r1x, r1y] = pt(opts.ref, R * 1.0);
    g.strokeStyle = C().ink2; g.lineWidth = 2; g.beginPath(); g.moveTo(r0x, r0y); g.lineTo(r1x, r1y); g.stroke();
    text(g, opts.refLabel, r1x + 4, r1y + 16, { size: 11.5, weight: 600, color: C().ink2, align: 'right', halo: true });
  }
  const [nx, ny] = pt(opts.value, R * 0.92);
  g.strokeStyle = C().gold; g.lineWidth = 2.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cxm, cym); g.lineTo(nx, ny); g.stroke(); g.lineCap = 'butt';
  g.fillStyle = C().gold; g.beginPath(); g.arc(cxm, cym, 4, 0, 6.283); g.fill();
  text(g, opts.big, cxm, cym - R * 0.25, { size: 22, weight: 650, color: C().gold, align: 'center', halo: true });
  text(g, opts.small, cxm, cym + 20, { size: 12, color: C().ink2, align: 'center' });
}

function buildDom() {
  $('#dmRoot').innerHTML = `
<main class="smain dmain">
  <div class="stack">
    <section class="panel map-panel s-sky d-sky" aria-labelledby="h-dsky">
      <div class="phead"><div class="pbar"><h2 id="h-dsky">The oldest light, bent by everything in between</h2></div>
      <p class="cap">The cosmic microwave background from Planck, in Galactic coordinates. The gold lens magnifies the sky 3× and bends it, and a gold grid, by the lensing deflection Planck measured, amplified by the slider above; the projected mass glows faintly underneath. Gold sparks: Rubin’s supernova-like alerts, night by night. Rings: ACT galaxy clusters.</p></div>
      <div class="map-wrap dm-wrap"><canvas id="dmGl" aria-label="CMB sky with a lensing magnifier. Drag to move the lens."></canvas><canvas id="dmOv" aria-hidden="true"></canvas></div>
      <div class="time">
        <button id="dPlay" class="btn play" type="button" aria-label="Play"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path class="pl" d="M8 5.5v13l10.5-6.5z"/></svg><span>Play</span></button>
        <div class="slider-wrap">
          <input id="dSlider" type="range" min="0" max="1000" step="0.01" aria-label="Date">
          <div class="slider-scale" aria-hidden="true"><span>${MON[dateOf(T0).getUTCMonth()]} ${dateOf(T0).getUTCFullYear()}</span><span class="win">SN-like alerts</span><span>${MON[dateOf(T1 - 1).getUTCMonth()]} ${dateOf(T1 - 1).getUTCFullYear()}</span></div>
        </div>
        <output id="dDate" class="date"></output>
        <label class="speed"><span>Speed</span><select id="dSpeed" aria-label="Days per second"><option value="1">1 day/s</option><option value="2" selected>2 days/s</option><option value="5">5 days/s</option><option value="15">15 days/s</option></select></label>
      </div>
      <details class="about"><summary>About this view</summary><p>Temperature: Planck SMICA, smoothed to 12′, shown as a muted warm–cool weave rather than the usual rainbow; the dimmer band is where Planck trusts the map less. Bending: the lensing potential from Planck PR4 (ℓ ≤ 400), turned into a deflection field. The true deflection is about ${M.deflectionRmsArcmin.toFixed(1)}′ rms in this reconstruction, smaller than one pixel here, so at ×1 the lens shows nothing: the bending is real but invisible. “Show the shadow” fades into the convergence κ, the projected mass itself, smoothed to 1.5°. Clusters: ACT DR5, 4,195 clusters, rings drawn far larger than life so they can be seen. Alerts: ${fmtN(NA)} Fink “most likely SN” objects, at the time each was first seen.</p></details>
      <div class="legend" id="dLegend"></div>
    </section>
    <section class="panel d-meter" aria-labelledby="h-dmeter">
      <div class="phead"><div class="pbar"><h2 id="h-dmeter">Do Rubin’s explosions follow the dark matter?</h2></div>
      <p class="cap">Left: the Planck κ averaged at ${fmtN(LT.nObjects)} supernova-like alerts, against 300 copies of the same pattern rotated around the sky (faint ticks). Right: supernova-like alerts inside ACT clusters against the surroundings. The dashed line is 3σ.</p></div>
      <div class="meters"><div><canvas id="dMeter" aria-label="Lensing significance meter"></canvas><p class="note">b = ${LT.bias.toFixed(1).replace('-', '−')} ± ${LT.biasSigma.toFixed(1)} over about ${fmtN(LT.areaDeg2)} deg². What a detection looks like: ACT clusters through the same pipeline give +${LT.controlSigma.toFixed(1)}σ. Forecast: ${esc(LT.forecast)}.</p></div>
      <div><canvas id="dCtest" aria-label="Cluster supernova excess meter"></canvas><p class="note">${CT.observed} alerts inside R500 of ${CT.clusters} clusters, ${CT.expected} expected from their surroundings: ${CT.sigma.toFixed(1)}σ. Forecast: ${esc(CT.forecast)}.</p></div></div>
    </section>
    <section class="panel d-story" aria-labelledby="h-dstory">
      <div class="phead"><div class="pbar"><h2 id="h-dstory">The story so far</h2></div></div>
      <ol class="dbeats">
        <li><b>The oldest light.</b> The CMB left the young universe 13.8 billion years ago. Its warm and cool spots are sound waves frozen in the first plasma.</li>
        <li><b>Bent on the way.</b> Every clump of matter between us and that light, mostly dark matter, bends it by a couple of arcminutes. Planck turned those tiny bends back into a map of the mass: the shadow.</li>
        <li><b>Rubin’s explosions.</b> Supernovae go off in galaxies, and galaxies sit where the dark matter is. If Rubin’s explosions trace the same mass, they should crowd where the shadow is darkest.</li>
        <li><b>Not yet.</b> Today the needle sits at ${LT.sigma.toFixed(1).replace('-', '−')}σ, inside the cloud of rotated skies: no signal, because Rubin has so far looked hard at a few patches only.</li>
        <li><b>How the needle should move.</b> As the wide survey fills the southern sky, the noise shrinks; if explosions follow dark matter like ordinary galaxies, the needle should cross 3σ around late 2027. The cluster test should follow around mid-2028.</li>
      </ol>
    </section>
  </div>
  <aside class="panel card" id="dCard" aria-labelledby="h-dcard">
    <div class="phead"><div class="pbar"><h2 id="h-dcard">Object card</h2></div></div>
    <div id="dCardBody" aria-live="polite"></div>
  </aside>
</main>`;
  K.panelControls($('#dmRoot'));
}

function aim(l, b, amp, shadow) {
  const f = frameOf(skyBox), [u, v] = hammer(l, b);
  st.lan = [f.cx + u * f.sc, f.cy - v * f.sc]; st.pinned = true;
  const x = Math.round(Math.log(amp) / Math.log(300) * 1000);
  $('#dAmp').value = String(x); $('#dAmp').dispatchEvent(new Event('input'));
  const sb = $('#dShadow'); if ((sb.getAttribute('aria-pressed') === 'true') !== shadow) sb.click();
  st.glDirty = true;
}
function presets() {
  const busiest = [...Array(NC).keys()].sort((a, b) => CL.inside[b] - CL.inside[a])[0];
  const heaviest = [...Array(NC).keys()].sort((a, b) => CL.m500[b] - CL.m500[a])[0];
  const list = [
    { id: 'all', label: 'True bending', run: () => { st.pinned = false; aim(240, -35, 1, false); st.pinned = false; } },
    { id: 'bend', label: 'Bend it ×50', run: () => aim(240, -35, 50, false) },
    { id: 'shadow', label: 'The shadow', run: () => aim(240, -35, 1, true) },
    { id: 'busy', label: 'Busiest cluster', run: () => { aim(CL.l[busiest], CL.b[busiest], 100, false); select(busiest); } },
    { id: 'heavy', label: 'Heaviest cluster', run: () => { aim(CL.l[heaviest], CL.b[heaviest], 100, false); select(heaviest); } },
  ];
  const nav = $('#dPresets');
  for (const p of list) {
    const b = document.createElement('button');
    b.className = 'btn' + (p.id === 'all' ? ' on' : ''); b.type = 'button'; b.textContent = p.label;
    b.addEventListener('click', () => { nav.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b)); p.run(); });
    nav.appendChild(b);
  }
}
function legend() {
  $('#dLegend').innerHTML = `<span class="k"><span class="sw" style="background:${C().gold}"></span>SN-like alert (spark, then ember)</span><span class="k"><span class="sw ring" style="border-color:${C().gold}"></span>ACT cluster</span><span class="k"><span class="sw" style="background:linear-gradient(90deg,rgb(${PALETTE.dark.cool.map((x) => Math.round(x * 255)).join(',')}),rgb(${PALETTE.dark.warm.map((x) => Math.round(x * 255)).join(',')}))"></span>CMB cooler · warmer (about ±250 μK)</span>`;
}

function wire() {
  const cv = $('#dmGl');
  let drag = false;
  const toLocal = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const moveLan = (p) => { st.lan = p; st.glDirty = true; };
  cv.addEventListener('pointerdown', (e) => {
    const p = toLocal(e);
    const onLens = Math.hypot(p[0] - st.lan[0], p[1] - st.lan[1]) < lanRadius();
    const hit = nearestCluster(p[0], p[1], e.pointerType === 'mouse' ? 8 : 14);
    if (hit >= 0 && !onLens) { select(hit); return; }
    drag = true; cv.setPointerCapture(e.pointerId); moveLan(p);
    if (hit >= 0) select(hit);
  });
  cv.addEventListener('pointermove', (e) => {
    const p = toLocal(e);
    if (drag) { moveLan(p); return; }
    if (e.pointerType !== 'mouse') return;
    if (!st.pinned) moveLan(p);
    const i = nearestCluster(p[0], p[1], 8);
    st.hover = i;
    cv.classList.toggle('hot', i >= 0);
    if (i >= 0) K.showTip(tipFor(i), e.clientX, e.clientY); else K.hideTip();
  });
  const end = () => { drag = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { st.hover = -1; K.hideTip(); });
  cv.addEventListener('dblclick', () => { st.pinned = !st.pinned; });
  $('#dPlay').addEventListener('click', () => setPlay(!st.playing));
  $('#dSpeed').addEventListener('change', (e) => { st.speed = +e.target.value; });
  $('#dSlider').addEventListener('input', (e) => { wrapAt = 0; wrapAlpha = 1; st.t = T0 + +e.target.value / 1000 * (T1 - T0); syncTime(); });
  const amp = $('#dAmp'), ampV = $('#dAmpV');
  const setAmp = () => { const x = +amp.value; st.amp = Math.round(Math.pow(300, x / 1000)); ampV.textContent = `×${st.amp}`; $('#dAmpNote').textContent = st.amp === 1 ? `At ×1 the bending is real but about ${M.deflectionRmsArcmin.toFixed(1)}′, too small to see.` : `Bending breathes up to ×${st.amp}: ${(M.deflectionRmsArcmin * st.amp / 60).toFixed(1)}° typical shift. The gold grid bends with it.`; st.glDirty = true; };
  amp.addEventListener('input', setAmp); setAmp();
  $('#dShadow').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.classList.toggle('on', on); st.shadowTarget = on ? 1 : 0; if (reduceMotion) { st.shadow = st.shadowTarget; st.glDirty = true; } });
  new ResizeObserver(() => { if (entered) sizeSky(); }).observe(cv);
  K.onTheme(() => { if (!built) return; buildRings(); emberCv = null; legend(); st.glDirty = true; meterS && meterS.draw(meterS); ctestS && ctestS.draw(ctestS); });
  document.addEventListener('keydown', (e) => {
    if (!entered || document.body.dataset.mode !== 'dm') return;
    const tg = e.target instanceof Element ? e.target : document.body;
    if (e.key === ' ' && !tg.closest('input, select, button, textarea')) { e.preventDefault(); setPlay(!st.playing); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
}

async function loadImages() {
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + src)); im.src = src; });
  const [skyIm, lensIm] = await Promise.all([load('data/cmb-sky.png' + V), load('data/cmb-lens.png' + V)]);
  return { sky: skyIm, lens: lensIm };
}

async function build() {
  buildDom();
  ov = $('#dmOv').getContext('2d');
  imgs = await loadImages();
  gl = initGl($('#dmGl'));
  if (gl) uploadTextures();
  meterS = K.setupCanvas($('#dMeter'), (s) => drawMeter(s, { range: [-4, 8], every: 2, nulls: LT.nulls, value: LT.sigma, ref: LT.controlSigma, refLabel: `ACT clusters +${LT.controlSigma.toFixed(1)}σ`, big: `${LT.sigma > 0 ? '+' : '−'}${Math.abs(LT.sigma).toFixed(1)}σ`, small: 'κ at SN-like alerts vs 300 rotated skies' }));
  ctestS = K.setupCanvas($('#dCtest'), (s) => drawMeter(s, { range: [-2, 5], every: 1, value: CT.sigma, big: `+${CT.sigma.toFixed(1)}σ`, small: `${CT.observed} seen vs ${CT.expected} expected in clusters` }));
  wire();
  presets();
  legend();
  built = true;
}

function searchItems(q) {
  const v = q.trim().toLowerCase(), out = [];
  const pool0 = v ? [...Array(NC).keys()].filter((i) => CL.name[i].toLowerCase().includes(v)) : [...Array(NC).keys()].filter((i) => CL.inside[i] > 2).sort((a, b) => CL.inside[b] - CL.inside[a]);
  for (const i of pool0.slice(0, 8)) out.push({ label: CL.name[i], color: 'var(--gold)', meta: `z ${CL.z[i].toFixed(2)} · ${CL.inside[i]} alerts inside R500`, pick: () => select(i) });
  return out;
}

async function enter(objId) {
  entered = true;
  if (!built) {
    $('#dmLoading').hidden = false;
    try { await build(); } finally { $('#dmLoading').hidden = true; }
  }
  if (!entered) return;
  $('h1').textContent = TITLE;
  $('#sub').textContent = `Planck CMB and lensing · ${fmtN(NC)} ACT clusters · ${fmtN(NA)} Rubin SN-like alerts`;
  K.shell.setSearch({ items: searchItems, empty: 'No ACT cluster matches. Try ACT-CL J0102.' }, `Search ${fmtN(NC)} ACT clusters, e.g. ACT-CL J0102`);
  if (objId) { const i = CL.name.indexOf(objId); if (i >= 0) st.sel = i; }
  renderCard();
  requestAnimationFrame(() => { sizeSky(); syncTime(); [meterS, ctestS].forEach((s) => s.resize()); });
  const params = new URLSearchParams(location.search);
  if (!reduceMotion && !params.has('still')) { st.t = T0; emberN = 0; emberCv = null; setPlay(true); } else syncTime();
  loop();
}
function leave() { entered = false; setPlay(false); K.hideTip(); }

const idb = openStore('observatory-dm', ['points', 'meta']);
let lastInfo = null;
function mergePoints(pts) {
  const fresh = pts.filter((p) => p.t > BUNDLED.tmax).sort((a, b) => a.t - b.t);
  if (!fresh.length) return 0;
  const n = NA + fresh.length;
  const L2 = new Float32Array(n), B2 = new Float32Array(n), T2 = new Float64Array(n);
  L2.set(aL.subarray(0, NA)); B2.set(aB.subarray(0, NA)); T2.set(aT.subarray(0, NA));
  fresh.forEach((p, k) => { L2[NA + k] = p.l; B2[NA + k] = p.b; T2[NA + k] = p.t; });
  aL = L2; aB = B2; aT = T2; NA = n; T1 = Math.ceil(aT[NA - 1]);
  return fresh.length;
}
async function loadStored() {
  try {
    const [pts, info] = await Promise.all([idb.getAll('points'), idb.get('meta', 'info')]);
    lastInfo = info || null;
    mergePoints(pts);
  } catch {}
}
await loadStored();
function galOf(ra, dec) {
  const G = [[-0.0548755604162154, -0.873437090234885, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
  const a = ra * DEG, d = dec * DEG, v = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = G.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return [((Math.atan2(g[1], g[0]) / DEG) + 360) % 360, Math.asin(clamp(g[2], -1, 1)) / DEG];
}
async function update({ onProgress = () => {}, signal }) {
  const report = { batches: 0, done: 0, failed: 0, rows: 0, nights: 0, names: 0 };
  const iso = (m) => new Date((m - 40587) * 864e5).toISOString().slice(0, 10);
  const start = Math.floor(aT[NA - 1]), stop = Math.floor(Date.now() / 864e5 + 40587) + 1;
  const days = []; for (let m = start; m < stop; m++) days.push(m);
  report.batches = days.length;
  const seen = new Map();
  onProgress({ ...report, msg: 'Fetching SN-like alerts' });
  await pool(days.map((m) => async () => {
    try {
      const out = await post('tags', { tag: 'most_likely_sn', n: 1000, startdate: iso(m), stopdate: iso(m + 1), columns: 'r:diaObjectId,r:ra,r:dec,r:midpointMjdTai' }, { signal, timeout: 60000, retries: 2 });
      if (Array.isArray(out)) for (const r of out) {
        const id = String(r['r:diaObjectId']), t = +r['r:midpointMjdTai'];
        if (!(t > BUNDLED.tmax) || !Number.isFinite(+r['r:ra'])) continue;
        const cur = seen.get(id);
        if (!cur || t < cur.t) { const [l, b] = galOf(+r['r:ra'], +r['r:dec']); seen.set(id, { id, l, b, t }); }
      }
    } catch (e) { if (e.name === 'AbortError') throw e; report.failed++; }
    report.done++;
    report.rows = seen.size;
    onProgress({ ...report, msg: 'Fetching SN-like alerts' });
  }), 2, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (seen.size) await idb.putMany('points', [...seen.values()].map((p) => [p.id, p]));
  const info = { at: Date.now(), ...report };
  await idb.put('meta', 'info', info);
  return info;
}
const dataProvider = {
  title: 'Dark-matter data', short: 'dark matter', noun: 'clusters', unit: 'SN-like alerts', bundled: BUNDLED,
  counts: () => ({ nobj: NC, nunit: NA, tmax: aT[NA - 1] }),
  info: () => lastInfo,
  refreshText: 'Fetch new SN-like alerts since the last one',
  refreshHint: () => `(Fink tag most_likely_sn, one request per night since ${fmtD(aT[NA - 1])})`,
  extraText: '', extraAria: '',
  note: 'The CMB, lensing and cluster maps are fixed published data and are not refetched. New alerts are drawn on the map but the meters stay at the published test result until it is recomputed offline. Requests go straight to api.lsst.fink-portal.org, 2 at a time, with retries. Everything is kept in this browser (IndexedDB); the bundled data is never changed.',
  async update(opts) {
    const info = await update(opts);
    opts.onMerge();
    const before = NA;
    await loadStored();
    lastInfo = info;
    if (NA !== before && built) { project(); emberCv = null; }
    return info;
  },
  async storage() {
    let n = 0; try { n = await idb.count('points'); } catch {}
    return `Stored in this browser for dark matter: ${fmtN(n)} alerts, ${fmtBytes(await storageUsage())} used in all.`;
  },
  reset: () => idb.clearAll(),
};
registerData('dm', dataProvider);

export const resetStore = () => idb.clearAll();
export const api = (K.ns.dm = { enter, leave, select, setPlay, get state() { return st; }, get gl() { return !!gl; }, perf: K.perf });
