import * as K from './kit.js';
import { sceneHtml, wireScene, verdictHtml } from './scene.js';
import { dockHtml, makeDock, fmtSpeed, dataLoop, LOOP_NOTE } from './dock.js';
import { register as registerData, fmtBytes } from './datapanel.js';
import { openStore, post, pool, storageUsage } from './net.js';
import * as SC from './showcase.js';
import { cardHead } from './cardhead.js';
import { DUR, ease, tween, play } from './motion.js';

const [D, SCD] = await Promise.all([K.loadJson('data/cmb.json'), SC.loadShowcase()]);
const { $, fmtN, MON, clamp, esc, text, annotate } = K;
const C = () => K.C;
const DEG = Math.PI / 180;
const GAL = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
function gal2eq(l, b) {
  const g = [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];
  const e = [0, 1, 2].map((i) => GAL[0][i] * g[0] + GAL[1][i] * g[1] + GAL[2][i] * g[2]);
  return [((Math.atan2(e[1], e[0]) / DEG) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, e[2]))) / DEG];
}
function decodeClusters(c) {
  if (!c.data) return { ...c, expect: c.inside.map(() => 0), catalogue: 'ACT DR5' };
  const raw = Uint8Array.from(atob(c.data), (ch) => ch.charCodeAt(0)), u = new Uint16Array(raw.buffer), F = c.fields.length, n = c.n;
  const out = { name: c.names.split('|').map((x) => 'ACT-CL ' + x), catalogue: c.catalogue };
  c.fields.forEach((f, k) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = u[i * F + k] / c.scale[k] - c.offset[k]; out[f] = a; });
  out.ra = new Float32Array(n); out.dec = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [r, d] = gal2eq(out.l[i], out.b[i]); out.ra[i] = r; out.dec[i] = d; }
  return out;
}
const M = D.meta, CL = decodeClusters(D.clusters), NC = CL.name.length, LT = D.lensing, CT = D.clusterTest;
const SNE = (D.sne && D.sne.rows) || [];
const scDm = SCD && SCD.modes && SCD.modes.dm && SCD.modes.dm.n === NC ? SCD.modes.dm : null;
const RANK = scDm ? scDm.rank : [...Array(NC).keys()].sort((a, b) => CL.m500[b] - CL.m500[a]);
const massOrder = [...Array(NC).keys()].sort((a, b) => CL.m500[b] - CL.m500[a]);
const massTop = new Float32Array(NC); massOrder.forEach((i, r) => { massTop[i] = 100 * (r + 1) / NC; });
const RANKPOS = new Int32Array(NC); RANK.forEach((i, q) => { RANKPOS[i] = q; });
const busyZ = (i) => (CL.inside[i] - CL.expect[i]) / Math.sqrt(CL.expect[i] + 1);
const nFront = () => (skyBox.w && skyBox.w < 600 ? (scDm ? scDm.top.phone : 60) : (scDm ? scDm.top.desktop : 120));
const BASE = M.mjdBase;

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
const phoneQ = matchMedia('(max-width: 699.98px)');
const HUD_BAND = 50;
const frameOf = (s) => {
  const sc = Math.min(s.w / (4 * Math.SQRT2), s.h / (2 * Math.SQRT2)) * 0.97, half = sc * Math.SQRT2, slack = s.h - 2 * half;
  const top = phoneQ.matches ? Math.max(slack / 2, Math.min(HUD_BAND, slack - 4)) : slack / 2;
  return { sc, cx: s.w / 2, cy: top + half };
};

const st = { t: T1 - 1e-3, playing: false, speed: 2, amp: 1, shadow: 0, shadowTarget: 0, sel: -1, hover: -1, lan: null, lanR: 0.2, showAll: false };
let built = false, entered = false;
let sky = null, ov = null, gl = null, glFail = '', imgs = null, meterS = null, ctestS = null;
let cx = new Float32Array(NC), cy = new Float32Array(NC), ax = new Float32Array(0), ay = new Float32Array(0);
let laceCv = null, allCv = null, emberCv = null, emberN = 0, pill = null, sx = new Float32Array(0), sy = new Float32Array(0);
const WRAP_MS = 1600;
let wrapAt = 0, wrapAlpha = 1;
const lb = (arr, x, n = arr.length) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const dateOf = (t) => new Date((t - 40587) * 864e5);
const fmtD = (t) => { const d = dateOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = `precision highp float;
uniform sampler2D uSky; uniform sampler2D uLens;
uniform vec2 uRes; uniform vec3 uFrame; uniform vec3 uLan; uniform float uAmp; uniform float uShadow;
uniform vec3 uCool; uniform vec3 uWarm; uniform vec3 uMid; uniform vec3 uKLo; uniform vec3 uKHi; uniform vec3 uNeutral; uniform vec3 uGold; uniform float uDuo;
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
  vec3 cmb;
  if (uDuo > 0.5) {
    cmb = mix(uMid, t < 0.0 ? uCool : uWarm, clamp(abs(t) * mix(0.85, 1.0, w), 0.0, 1.0));
    cmb = mix(mix(uMid, cmb, 0.4), cmb, s0.g);
  } else {
    cmb = mix(uCool, uWarm, 0.5 + 0.5 * t) * mix(0.86 + 0.14 * abs(t), 0.72 + 0.5 * abs(t), w);
    cmb *= mix(0.72, 1.0, s0.g);
  }
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
const CMB_TOKENS = { cool: '--cmb-cool', warm: '--cmb-warm', mid: '--cmb-mid', klo: '--cmb-klo', khi: '--cmb-khi', neutral: '--cmb-neutral' };
const paletteOf = { key: null, P: null };
function palette() {
  const dark = C().dark;
  if (paletteOf.key === dark && paletteOf.P) return paletteOf.P;
  const cs = getComputedStyle(document.documentElement), P = { duo: !dark };
  for (const k in CMB_TOKENS) P[k] = hexRgb(cs.getPropertyValue(CMB_TOKENS[k]).trim() || '#808080');
  paletteOf.key = dark; paletteOf.P = P;
  return P;
}
const mix3 = (a, b, x) => a.map((v, c) => v + (b[c] - v) * x);
function cmbColour(P, t, trusted) {
  if (!P.duo) return mix3(P.cool, P.warm, 0.5 + 0.5 * t).map((v) => v * (0.86 + 0.14 * Math.abs(t)) * (trusted ? 1 : 0.72));
  const c = mix3(P.mid, t < 0 ? P.cool : P.warm, Math.min(1, Math.abs(t) * 0.85));
  return trusted ? c : mix3(P.mid, c, 0.4);
}

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
    for (const n of ['uSky', 'uLens', 'uRes', 'uFrame', 'uLan', 'uAmp', 'uShadow', 'uCool', 'uWarm', 'uMid', 'uKLo', 'uKHi', 'uNeutral', 'uGold', 'uDuo', 'uDefl', 'uDark', 'uZoom', 'uGrid', 'uDegPx']) U[n] = g.getUniformLocation(pr, n);
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

const skyBox = { w: 0, h: 0, dpr: 1, key: '' };
function sizeSky() {
  const cv = $('#dmGl'), r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, r.width < 700 ? 1.5 : 2);
  const key = `${r.width}x${r.height}@${dpr}`;
  if (key === skyBox.key && emberCv && r.width) { st.glDirty = true; drawOverlay(); return; }
  skyBox.key = r.width ? key : '';
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
const LENS_ZOOM = 3, BREATH_S = 7, LENS_RINGS = 150;
const breathing = () => !K.reduceMotion && !demo && st.amp > 1 && st.shadowTarget === 0;
function ampNow() { return breathing() ? 1 + (st.amp - 1) * (0.5 - 0.5 * Math.cos(performance.now() / 1000 * 2 * Math.PI / BREATH_S)) : st.amp; }
function lanRadius() { return Math.max(56, Math.min(skyBox.w, skyBox.h) * st.lanR); }

let fallbackCv = null;
function drawGl() {
  if (!skyBox.w || !imgs) return;
  const f = frameOf(skyBox), dk = C().dark, P = palette();
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
  g.uniform3fv(U.uCool, P.cool); g.uniform3fv(U.uWarm, P.warm); g.uniform3fv(U.uMid, P.mid); g.uniform3fv(U.uKLo, P.klo); g.uniform3fv(U.uKHi, P.khi); g.uniform3fv(U.uNeutral, P.neutral); g.uniform1f(U.uDuo, P.duo ? 1 : 0);
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
    const t = clamp((fallbackCv[k] - 128) / 110, -1, 1), col = cmbColour(P, t, fallbackCv[k + 1] > 127);
    const p = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) im.data[p + c] = 255 * col[c];
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

let aU = new Float32Array(0), aV = new Float32Array(0), aUVof = null;
function alertUV() {
  if (aUVof === aL && aU.length === NA) return;
  aU = new Float32Array(NA); aV = new Float32Array(NA);
  for (let k = 0; k < NA; k++) { const [u, v] = hammer(aL[k], aB[k]); aU[k] = u; aV[k] = v; }
  aUVof = aL;
}
function project() {
  const f = frameOf(skyBox);
  for (let i = 0; i < NC; i++) { const [u, v] = hammer(CL.l[i], CL.b[i]); cx[i] = f.cx + u * f.sc; cy[i] = f.cy - v * f.sc; }
  alertUV();
  ax = new Float32Array(NA); ay = new Float32Array(NA);
  for (let k = 0; k < NA; k++) { ax[k] = f.cx + aU[k] * f.sc; ay[k] = f.cy - aV[k] * f.sc; }
  sx = new Float32Array(SNE.length); sy = new Float32Array(SNE.length);
  SNE.forEach((r, k) => { const [u, v] = hammer(r[0], r[1]); sx[k] = f.cx + u * f.sc; sy[k] = f.cy - v * f.sc; });
}
const RING_PX_PER_ARCMIN = 0.45;
const ringScale = () => frameOf(skyBox).sc / 135;
const ringR = (i) => Math.max(0.7, CL.theta500[i] * RING_PX_PER_ARCMIN * ringScale());
function buildRings() {
  const d = skyBox.dpr;
  const thin = clamp(skyBox.w / 1100, 0.35, 1);
  [laceCv, allCv] = [[0.5, (C().dark ? 0.12 : 0.18) * thin], [1, 0.5 * Math.sqrt(thin)]].map(([lw, al]) => {
    const c = document.createElement('canvas'); c.width = Math.round(skyBox.w * d); c.height = Math.round(skyBox.h * d);
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    g.strokeStyle = C().gold; g.lineWidth = lw; g.globalAlpha = al;
    g.beginPath();
    for (let i = 0; i < NC; i++) { const r = lw < 1 ? ringR(i) : Math.max(2.5, ringR(i)); g.moveTo(cx[i] + r, cy[i]); g.arc(cx[i], cy[i], r, 0, 6.283); }
    g.stroke();
    return c;
  });
}
const isBusy = (i) => busyZ(i) / 3 >= 0.5;
const BREATH_PERIODS = [6, 7.4, 6.6, 8, 7];
function drawFront(g, now) {
  const n = nFront(), lanes = K.reduceMotion ? 1 : BREATH_PERIODS.length;
  g.strokeStyle = C().gold; g.lineWidth = 1;
  for (let b = 0; b < lanes; b++) {
    const a = K.reduceMotion ? 0.75 : 0.725 + 0.175 * Math.sin(2 * Math.PI * now / BREATH_PERIODS[b] + b * 2.4);
    g.globalAlpha = a * wrapAlpha; g.beginPath();
    for (let q = 0; q < n; q++) { const i = RANK[q]; if (i % lanes !== b) continue; const r = Math.max(2.5, ringR(i)); g.moveTo(cx[i] + r, cy[i]); g.arc(cx[i], cy[i], r, 0, 6.283); }
    g.stroke();
  }
  g.globalAlpha = 0.45 * wrapAlpha; g.beginPath();
  for (let q = 0; q < n; q++) { const i = RANK[q]; if (!isBusy(i)) continue; const r = 1.35 * Math.max(2.5, ringR(i)); g.moveTo(cx[i] + r, cy[i]); g.arc(cx[i], cy[i], r, 0, 6.283); }
  g.stroke();
  g.globalAlpha = 1;
}
function drawSne(g) {
  for (let k = 0; k < SNE.length; k++) {
    if (SNE[k][2] > st.t) continue;
    g.fillStyle = C().gold; g.globalAlpha = 0.9 * wrapAlpha; g.beginPath(); g.arc(sx[k], sy[k], 1.6, 0, 6.283); g.fill();
    g.strokeStyle = C().gold; g.lineWidth = 1; g.globalAlpha = 0.35 * wrapAlpha; g.beginPath(); g.arc(sx[k], sy[k], 4.5, 0, 6.283); g.stroke();
  }
  g.globalAlpha = 1;
}
function pillText() {
  if (!pill) return;
  const phone = skyBox.w < 600, N = fmtN(NC), n = nFront();
  if (st.showAll) pill.set(`All ${N} shown`, phone ? 'Fewer' : 'Heaviest and busiest only', 'all');
  else pill.set(phone ? `${n} of ${N}` : `Showing ${n} heaviest and busiest of ${N}`, 'Show all', 'show');
}
function toggleShowAll() { st.showAll = !st.showAll; pillText(); drawOverlay(); }

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
  g.strokeStyle = C().gold; g.lineWidth = 1; g.globalAlpha = 0.6;
  const reach = (inner + 40) / LENS_ZOOM, inLens = [];
  for (let i = 0; i < NC; i++) {
    const dx = cx[i] - lx, dy = cy[i] - ly;
    if (i === st.sel || Math.abs(dx) > reach || Math.abs(dy) > reach || Math.hypot(dx, dy) > reach) continue;
    inLens.push(i);
  }
  if (inLens.length > LENS_RINGS) inLens.sort((a, b) => CL.m500[b] - CL.m500[a]).length = LENS_RINGS;
  g.beginPath();
  for (const i of inLens) {
    const r = ringR(i) * LENS_ZOOM, x = lx + (cx[i] - lx) * LENS_ZOOM, y = ly + (cy[i] - ly) * LENS_ZOOM;
    g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.283);
  }
  g.stroke();
  if (st.sel >= 0) {
    const dx = cx[st.sel] - lx, dy = cy[st.sel] - ly;
    if (Math.hypot(dx, dy) * LENS_ZOOM <= inner + 40) { g.globalAlpha = 1; g.lineWidth = 2; g.beginPath(); g.arc(lx + dx * LENS_ZOOM, ly + dy * LENS_ZOOM, ringR(st.sel) * LENS_ZOOM, 0, 6.283); g.stroke(); }
  }
  g.restore();
  g.globalAlpha = 1;
}
function stampEmbers(eg, from, to) {
  const W = emberCv.width, H = emberCv.height, d = skyBox.dpr, side = Math.max(1, Math.round(d));
  const img = from ? eg.getImageData(0, 0, W, H) : new ImageData(W, H), px = new Uint32Array(img.data.buffer);
  const [r, gg, b] = hexRgb(C().gold).map((x) => Math.round(x * 255)), a = Math.round(255 * (C().dark ? 0.1 : 0.16));
  const col = ((a << 24) | (b << 16) | (gg << 8) | r) >>> 0;
  for (let k = from; k < to; k++) {
    const x0 = Math.round((ax[k] - 0.5) * d), y0 = Math.round((ay[k] - 0.5) * d);
    if (x0 < 0 || y0 < 0 || x0 + side > W || y0 + side > H) continue;
    for (let yy = 0; yy < side; yy++) { const row = (y0 + yy) * W + x0; for (let xx = 0; xx < side; xx++) if (!px[row + xx]) px[row + xx] = col; }
  }
  eg.putImageData(img, 0, 0);
}
const DIAL = { a0: -Math.PI / 3, a1: Math.PI / 3, max: 300 }, KAPPA_AT = Math.PI * 0.75;
let ampX = 0;
const onRim = (R, a) => [st.lan[0] + Math.cos(a) * R, st.lan[1] + Math.sin(a) * R];
const dialAt = (x) => DIAL.a0 + (DIAL.a1 - DIAL.a0) * x;
function ringLabel(wide) {
  const rms = M.deflectionRmsArcmin.toFixed(1);
  if (st.amp === 1) return `×1 · true bending, about ${rms}′${wide ? ', too small to see' : ''}`;
  return `×${st.amp} · amplified${wide ? `, up to ${(M.deflectionRmsArcmin * st.amp / 60).toFixed(1)}° typical shift` : ''}`;
}
function lensRing(g, R) {
  const [lx, ly] = st.lan, gold = C().gold, wide = skyBox.w >= 600, tr = R + 6;
  g.strokeStyle = gold; g.lineWidth = 1.2; g.globalAlpha = 0.9;
  g.beginPath(); g.arc(lx, ly, R, 0, 6.283); g.stroke();
  g.lineCap = 'round'; g.lineWidth = 3;
  g.globalAlpha = 0.22; g.beginPath(); g.arc(lx, ly, tr, DIAL.a0, DIAL.a1); g.stroke();
  g.globalAlpha = 0.85; g.beginPath(); g.arc(lx, ly, tr, DIAL.a0, Math.max(DIAL.a0 + 0.001, dialAt(ampX))); g.stroke();
  g.lineCap = 'butt'; g.lineWidth = 1; g.globalAlpha = 0.7;
  for (const v of [1, 3, 10, 30, 100, 300]) {
    const a = dialAt(Math.log(v) / Math.log(DIAL.max)), major = v === 1 || v === 10 || v === 100 || v === 300;
    const [x0, y0] = onRim(tr + 3, a), [x1, y1] = onRim(tr + (major ? 9 : 6), a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    if (major && wide && v > 1) { const [tx, ty] = onRim(tr + 20, a); text(g, `×${v}`, tx, ty + 4, { size: 10.5, color: C().ink2, align: 'center', halo: true }); }
  }
  g.globalAlpha = 1;
  const [kx, ky] = onRim(tr, dialAt(ampX));
  g.fillStyle = gold; g.strokeStyle = C().bg; g.lineWidth = 1.5;
  g.beginPath(); g.arc(kx, ky, wide ? 6 : 7, 0, 6.283); g.fill(); g.stroke();
  const [qx, qy] = onRim(R, KAPPA_AT), on = st.shadowTarget > 0, kr = wide ? 10 : 12;
  g.fillStyle = on ? gold : C().bg; g.strokeStyle = gold; g.lineWidth = 1.2;
  g.beginPath(); g.arc(qx, qy, kr, 0, 6.283); g.fill(); g.stroke();
  text(g, 'κ', qx, qy + 4.5, { size: 13, weight: 650, color: on ? C().bg : gold, align: 'center' });
  if (wide) text(g, on ? 'the shadow' : 'shadow', qx - kr - 4, qy + 4, { size: 10.5, color: C().ink2, align: 'right', halo: true });
  const lab = ringLabel(wide);
  g.font = K.font(12, 600);
  const lw2 = g.measureText(lab).width / 2 + 6;
  text(g, lab, clamp(lx, lw2, skyBox.w - lw2), Math.max(14, ly - R - 9), { size: 12, weight: 600, color: gold, align: 'center', halo: true });
  if (wide && ly + R + 18 < skyBox.h - 40) text(g, `the lens magnifies ${LENS_ZOOM}×`, lx, ly + R + 18, { size: 11, color: C().ink2, align: 'center', halo: true });
}
function ringHit(p, touch) {
  const R = lanRadius(), [qx, qy] = onRim(R, KAPPA_AT);
  if (Math.hypot(p[0] - qx, p[1] - qy) < (touch ? 20 : 13)) return 'kappa';
  const [kx, ky] = onRim(R + 6, dialAt(ampX));
  if (Math.hypot(p[0] - kx, p[1] - ky) < (touch ? 20 : 11)) return 'rim';
  const d = Math.hypot(p[0] - st.lan[0], p[1] - st.lan[1]);
  if (Math.abs(d - R - 3) < (touch ? 14 : 8)) return 'rim';
  return d < R ? 'inside' : null;
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
  if (nNow - emberN > 4000) { stampEmbers(eg, emberN, nNow); emberN = nNow; }
  if (nNow > emberN) {
    eg.fillStyle = C().gold; eg.globalAlpha = C().dark ? 0.1 : 0.16;
    eg.beginPath();
    for (let k = emberN; k < nNow; k++) eg.rect(ax[k] - 0.5, ay[k] - 0.5, 1, 1);
    eg.fill(); eg.globalAlpha = 1; emberN = nNow;
  }
  g.globalAlpha = wrapAlpha; g.drawImage(emberCv, 0, 0, s.w, s.h); g.globalAlpha = 1;
  if (st.showAll) { g.globalAlpha = wrapAlpha; g.drawImage(allCv, 0, 0, s.w, s.h); g.globalAlpha = 1; } else { g.drawImage(laceCv, 0, 0, s.w, s.h); drawFront(g, now); }
  const i0 = lb(aT, st.t - 3, NA);
  g.fillStyle = C().gold;
  for (let k = Math.max(i0, nNow - 2500); k < nNow; k++) {
    const age = st.t - aT[k], a = K.reduceMotion ? 0.8 : Math.exp(-age / 1.2), r = 1 + 2.2 * a;
    g.globalAlpha = (0.15 + 0.6 * a) * wrapAlpha;
    g.beginPath(); g.arc(ax[k], ay[k], r, 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
  drawSne(g);
  const R = lanRadius();
  lensWindow(g, R);
  lensRing(g, R);
  for (const [i, col, w] of [[st.hover, C().ink, 1.5], [st.sel, C().hi, 2]]) {
    if (i < 0) continue;
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx[i], cy[i], ringR(i) + 5, 0, 6.283); g.stroke();
    if (i === st.sel) annotate(g, CL.name[i], cx[i] + 12, cy[i] - 12, { size: 17, color: C().ink, align: 'left' });
  }
  if (s.w >= 600) text(g, `${fmtN(nNow)} SN-like alerts so far · ${fmtN(NC)} ${CL.catalogue} clusters, ${st.showAll ? 'all' : nFront()} in front (rings ${Math.round(RING_PX_PER_ARCMIN * ringScale() * 60 / (frameOf(s).sc * DEG))}× their R500)`, 16, s.h - 12, { size: 'micro', color: C().ink2, halo: true });
  if (glFail) text(g, glFail, 16, 18, { size: 12, color: C().ink2, halo: true });
}

let raf = 0, lastTs = 0, dock = null;
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
      if (p >= 1) { wrapAt = 0; wrapAlpha = 1; st.t = (playLoop() || { from: T0 }).from; emberN = 0; emberCv = null; if (dock) dock.note(LOOP_NOTE); }
    } else if (st.tween) {
      const p = Math.min(1, (ts - st.tween.t0) / st.tween.ms);
      st.t = st.tween.from + (st.tween.to - st.tween.from) * p * p * (3 - 2 * p);
      if (p >= 1) st.tween = null;
    } else {
      const L = playLoop(), next = st.t + dt * st.speed, gp = L && L.gap(next);
      if (gp) st.tween = { from: st.t, to: gp[1] + 0.01, t0: ts, ms: 600 };
      else st.t = next;
      const end = L ? L.end : T1;
      if (st.t >= end) { st.t = end - 1e-3; st.tween = null; wrapAt = ts; }
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

function syncTime() { if (dock) dock.update(); }
let loopOf = null;
function playLoop() {
  const n = alertNights();
  if (!loopOf || loopOf.n !== n) loopOf = { n, ...dataLoop(n.map((x) => x[0]), alertGaps()) };
  return loopOf.end == null ? null : loopOf;
}
function setPlay(p) {
  st.playing = p;
  if (!p) { wrapAt = 0; wrapAlpha = 1; st.tween = null; }
  if (dock) dock.sync();
}
function setT(t) { wrapAt = 0; wrapAlpha = 1; st.tween = null; st.t = clamp(t, T0, T1); if (dock) dock.update(true); }
let nightsKey = -1, nightsV = [];
function alertNights() {
  if (nightsKey === NA) return nightsV;
  const m = new Map();
  for (let k = 0; k < NA; k++) { const d = Math.floor(aT[k]); m.set(d, (m.get(d) || 0) + 1); }
  nightsKey = NA; nightsV = [...m].sort((a, b) => a[0] - b[0]);
  return nightsV;
}
function alertGaps() {
  const n = alertNights(), out = [];
  for (let k = 1; k < n.length; k++) if (n[k][0] - n[k - 1][0] > 10) out.push([n[k - 1][0] + 1, n[k][0]]);
  return out;
}
function makeTimeDock() {
  dock = makeDock('dm', {
    t0: () => T0, t1: () => T1, end: () => T1 - 1e-3, get: () => st.t, set: setT,
    playing: () => st.playing, play: setPlay,
    speeds: [1, 2, 5, 15], speed: () => st.speed, setSpeed: (v) => { st.speed = v; }, speedText: fmtSpeed('day', 'days'),
    unit: 1, big: 7, snap: (t) => Math.floor(t) + 0.5, fmt: fmtD,
    tip: (t) => { const d = Math.floor(t), n = alertNights().find((x) => x[0] === d); return t >= T0 && t <= T1 ? `<b>${fmtD(d)}</b><br>${n ? `${fmtN(n[1])} SN-like alert${n[1] === 1 ? '' : 's'}` : 'no SN-like alerts this night'}` : ''; },
    paint: { domain: () => [T0, T1], bars: alertNights, scale: 'sqrt', gaps: alertGaps, ticks: 'month', barColor: () => K.C.gold, key: () => `${NA}|${T0}|${T1}` },
  });
}

function nearestCluster(x, y, r) {
  let best = -1, bd = r * r;
  for (let i = 0; i < NC; i++) { const d = (cx[i] - x) ** 2 + (cy[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function tipFor(i) { return `<b>${esc(CL.name[i])}</b><br>z = ${CL.z[i].toFixed(2)} · M500c = ${CL.m500[i].toFixed(1)}×10¹⁴ M☉<br>${CL.inside[i]} SN-like alerts inside R500`; }
function chipsFor(i) {
  const out = [], f = scDm && scDm.facts[String(i)];
  if (f && f.freshT) out.push([1.2, `New alert inside, ${K.fmtShort(f.freshT)}`]);
  if (massTop[i] <= 10) out.push([1 - massTop[i] / 10, `Top ${Math.max(1, Math.ceil(massTop[i]))}% by mass: ${CL.m500[i].toFixed(1)}×10¹⁴ M☉`]);
  if (CL.inside[i] > 0) out.push([Math.min(1, Math.max(0.05, busyZ(i) / 3)), `${CL.inside[i]} SN-like alert${CL.inside[i] === 1 ? '' : 's'} inside`]);
  if (CL.inside[i] + CL.expect[i] > 0) out.push([0.25, 'Rubin is watching it']);
  return out.sort((a, b) => b[0] - a[0]).map((c) => c[1]);
}
function select(i) { st.sel = i; K.setUrl({ obj: i >= 0 ? CL.name[i] : null }); renderCard(); K.pingLadder(); }
const ltKm = (z) => K.cosmo.lookbackGyr(z) * 1e9 * K.cosmo.KM_PER_LY, cmKm = (z) => K.cosmo.comovingLy(z) * K.cosmo.KM_PER_LY;
let ladderFront = { n: -1, view: null };
export function ladder() {
  if (!built) return null;
  const n = Math.min(NC, nFront());
  if (ladderFront.n !== n) {
    const zs = [];
    for (let q = 0; q < n; q++) { const z = CL.z[RANK[q]]; if (z > 0) zs.push(z); }
    zs.sort((a, b) => a - b);
    ladderFront = { n, view: zs.length ? [ltKm(zs[0]), ltKm(zs[zs.length - 1])] : null };
  }
  const i = st.sel, cmb = ltKm(1090);
  const sel = i >= 0 && CL.z[i] > 0
    ? { km: ltKm(CL.z[i]), comovingKm: cmKm(CL.z[i]), z: CL.z[i], label: CL.name[i], how: 'indirect', words: 'ACT DR6 catalogue redshift', note: 'light travel' }
    : { km: cmb, comovingKm: cmKm(1090), z: 1090, label: 'The CMB', how: 'measured', words: 'Planck: the oldest light, from z = 1090', note: 'light travel' };
  return { band: [ltKm(0.05), cmKm(1090)], view: ladderFront.view, also: [cmb, cmb], sel };
}

function renderCard() {
  const body = $('#dCardBody');
  const i = st.sel;
  if (i < 0) {
    const top = [], seen = new Map();
    for (let q = 0; q < RANK.length && top.length < 8; q++) {
      const k = RANK[q], lead = (chipsFor(k)[0] || '').replace(/[0-9.,]+/g, '#');
      if ((seen.get(lead) || 0) >= 2 && q < nFront()) continue;
      seen.set(lead, (seen.get(lead) || 0) + 1); top.push(k);
    }
    body.innerHTML = `<h3 class="ph">Clusters worth a look</h3>
      <p class="cap">The heaviest clusters, and those with the most supernova-like alerts inside. Each ring is a galaxy cluster the Atacama Cosmology Telescope found by the shadow its hot gas casts on the CMB; the faint lace is all ${fmtN(NC)}.</p>
      <ul class="hooks">${top.map((k) => `<li><button type="button" data-pick="${k}"><span class="sw" style="background:var(--gold)"></span><b>${esc(CL.name[k])}</b>${SC.chipsHtml(chipsFor(k).slice(0, 2))}</button></li>`).join('')}</ul>`;
    body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => select(+b.dataset.pick)));
    return;
  }
  const facts = [
    ['Redshift', CL.z[i].toFixed(3)],
    ['Mass M500c', `${CL.m500[i].toFixed(2)}×10¹⁴ M☉ <small>(calibrated SZ mass)</small>`],
    ['Radius θ500', `${CL.theta500[i].toFixed(2)}′ <small>on the sky</small>`],
    ['SN-like alerts inside R500', `${CL.inside[i]} <small>(${CL.expect[i].toFixed(1)} expected from the 3–6 R500 ring)</small>`],
    ['RA, Dec', `${CL.ra[i].toFixed(3)}°, ${CL.dec[i].toFixed(3)}°`],
    ['Galactic l, b', `${CL.l[i].toFixed(1)}°, ${CL.b[i].toFixed(1)}°`],
  ];
  const lt = K.cosmo.lookbackGyr(CL.z[i]);
  body.innerHTML = `${cardHead({
    name: CL.name[i], kind: 'Galaxy cluster', sw: 'var(--gold)', cls: `${esc(CL.catalogue)} SZ galaxy cluster`, chips: SC.chipsHtml(chipsFor(i)), how: 'indirect',
    prov: `${esc(CL.catalogue)} catalogue redshift and calibrated SZ mass · alerts inside: Rubin via Fink`,
    ladder: `<b>${lt.toFixed(1)} Gyr of light</b> (z = ${CL.z[i].toFixed(2)}) · indirect, ${esc(CL.catalogue)} catalogue redshift`,
    links: [{ label: 'ACT DR6 on LAMBDA', href: 'https://lambda.gsfc.nasa.gov/product/act/' }],
  })}
    <canvas class="dhero" aria-label="SN-like alerts inside R500 against the number expected from the 3 to 6 R500 ring"></canvas>
    <p class="cap hero-cap">Inside R500 against what its own 3–6 R500 ring predicts for the same area; the whisker is the Poisson spread of the expectation.</p>
    ${scDm ? `<div class="note scoreline">Unusualness ${scDm.score[i]} of 100 · #${fmtN(RANKPOS[i] + 1)} of ${fmtN(NC)} · <details><summary>How it’s scored</summary><p>Each cluster gets 0–1 for mass (the top 10% by M500c), for SN-like alerts inside beyond what its own 3–6 R500 ring predicts, and 0.5 for Rubin coverage. Its best three count (full, half, quarter), plus a little for a new alert inside. At least 30% of the front places go to clusters with an excess.</p></details></div>` : ''}
    <p class="cap">Its hot gas scatters CMB photons (the Sunyaev–Zel’dovich effect); its mass, mostly dark matter, bends the CMB around it by a fraction of an arcminute.</p>
    <dl>${facts.map(([k, v]) => `<div style="grid-column:span ${v.length > 40 ? 3 : 1}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p class="note">R500 is the radius inside which the mean density is 500 times the critical density of the universe; here it spans ${CL.theta500[i].toFixed(1)} arcminutes.</p>`;
  K.setupCanvas(body.querySelector('.dhero'), (s) => drawHero(s, i));
}
function drawHero(s, i) {
  if (!s.w) return;
  const g = s.ctx, n = CL.inside[i], e = CL.expect[i], sd = Math.sqrt(Math.max(e, 0)), top = Math.max(n, e + 2 * sd, 1) * 1.15;
  g.clearRect(0, 0, s.w, s.h);
  const L = 128, R = s.w - 44, X = (v) => L + v / top * (R - L), rows = [['inside R500', n, true], ['expected', e, false]];
  rows.forEach(([lab, v, solid], k) => {
    const y = 14 + k * 30;
    text(g, lab, 0, y + 12, { size: 12, color: C().ink2 });
    g.fillStyle = C().gold; g.strokeStyle = C().gold; g.lineWidth = 1.2; g.globalAlpha = solid ? 0.85 : 0.3;
    g.fillRect(L, y, Math.max(1, X(v) - L), 16); g.globalAlpha = 1;
    if (!solid) { g.strokeRect(L + 0.5, y + 0.5, Math.max(1, X(v) - L), 15); g.beginPath(); g.moveTo(X(Math.max(0, v - sd)), y + 8); g.lineTo(X(v + sd), y + 8); g.moveTo(X(Math.max(0, v - sd)), y + 4); g.lineTo(X(Math.max(0, v - sd)), y + 12); g.moveTo(X(v + sd), y + 4); g.lineTo(X(v + sd), y + 12); g.stroke(); }
    text(g, solid ? fmtN(v) : v.toFixed(1), X(solid ? v : v + sd) + 6, y + 12, { size: 12, weight: 600, color: C().ink });
  });
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
  if (opts.ghost != null) {
    const [gx, gy] = pt(opts.ghost, R * 0.85);
    g.setLineDash([3, 3]); g.strokeStyle = C().ink3; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cxm, cym); g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
    const near = Math.abs(opts.ghost - opts.value) < 0.6, away = opts.ghost >= opts.value ? 1 : -1;
    const span = (hi - lo) / Math.PI, at = near ? opts.ghost + away * span * 10 / (R + 14) : opts.ghost;
    const [lx, ly] = pt(at, R + 14);
    text(g, opts.ghostLabel, lx, ly + 4, { size: 11, color: C().ink3, align: near ? (away > 0 ? 'left' : 'right') : 'center', halo: true });
  }
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

const isoMjd = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 + 40587 : null; };
function updatedLine() {
  const up = isoMjd(M.updated || M.built), to = isoMjd(M.dataTo);
  return `Updated ${up ? fmtD(up) : M.built}: both meters recomputed from ${fmtN(M.objectsAllTags || LT.nObjects)} SN-like objects${to ? `, with Rubin data to ${fmtD(to)}` : ''}. The needles move as Rubin fills the southern sky.`;
}
const sig = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}σ`;
function ctestNote() {
  const G = CT.dr5Ghost;
  if (!G) return `${CT.observed} alerts inside R500 of ${CT.clusters} clusters, ${CT.expected} expected from their surroundings: ${CT.sigma.toFixed(1)}σ. Forecast: ${esc(CT.forecast)}.`;
  return `${fmtN(CT.observed)} alerts inside R500 of ${fmtN(CT.clusters)} ACT DR6 clusters, ${fmtN(Math.round(CT.expected))} expected from their surroundings: ${sig(CT.sigma)}${Math.abs(CT.sigma) < 3 ? ', no significant excess yet' : ''}. Dashed: the same test on DR5’s ${fmtN(G.of)} clusters, ${sig(G.sigma)}. Forecast: ${esc(CT.forecast)}.`;
}
function verdict() {
  return { lens: LT.sigma, control: LT.controlSigma, nObjects: LT.nObjects, clusters: CT.sigma, dr5: CT.dr5Ghost ? CT.dr5Ghost.sigma : null, observed: CT.observed, expected: CT.expected, nClusters: CT.clusters, forecast: LT.forecast };
}
function buildDom() {
  const root = $('#dmRoot');
  root.innerHTML = sceneHtml('dm', {
    qid: 'h-dsky', stageCls: 's-sky d-sky', mainCls: 'dmain', wrapCls: 'dm-wrap',
    question: 'The oldest light, bent by everything in between',
    canvas: '<div class="e-stage dm-stage"><canvas id="dmGl" aria-label="CMB sky with a lensing magnifier. Drag to move the lens; drag its rim to amplify the bending; κ on the rim shows the shadow."></canvas><canvas id="dmOv" aria-hidden="true"></canvas></div>',
    overlay: `<div class="lensbar on-ring" id="lensbar" role="group" aria-label="Lens controls"><label class="lbl" for="dAmp">Amplify bending</label><input type="range" id="dAmp" min="0" max="1000" step="1" value="0"><output id="dAmpV" class="sval">×1</output><button class="btn" type="button" id="dShadow" aria-pressed="false">Show the shadow</button><span class="scnt" id="dAmpNote" aria-live="polite"></span></div>${verdictHtml(verdict())}`,
    views: { nav: 'dPresets', label: 'Guided views of the lensing sky', first: 'True bending' },
    dock: dockHtml({ play: 'dPlay', date: 'dDate', track: 'dTrack', speed: 'dSpeed', label: 'Time track: Rubin’s SN-like alerts per night. Left and right arrows step a night, Shift a week.' }),
    info: {
      cap: 'The cosmic microwave background from Planck, in Galactic coordinates. The gold lens magnifies the sky 3× and bends it, and a gold grid, by the lensing deflection Planck measured, amplified by the lens control; the projected mass glows faintly underneath. Gold sparks: Rubin’s supernova-like alerts, night by night. Rings: ACT galaxy clusters.',
      about: `<p>Temperature: Planck SMICA, smoothed to 12′, shown as a muted warm–cool weave rather than the usual rainbow; the dimmer band is where Planck trusts the map less. Bending: the lensing potential from Planck PR4 (ℓ ≤ 400), turned into a deflection field. The true deflection is about ${M.deflectionRmsArcmin.toFixed(1)}′ rms in this reconstruction, smaller than one pixel here, so at ×1 the lens shows nothing: the bending is real but invisible. “Show the shadow” fades into the convergence κ, the projected mass itself, smoothed to 1.5°. Clusters: ${CL.catalogue}, ${fmtN(NC)} clusters as a faint lace, the ${nFront()} heaviest and busiest in front (doubled when unusually many SN-like alerts sit inside), rings drawn far larger than life so they can be seen. Alerts: ${fmtN(NA)} Fink “most likely SN” objects, at the time each was first seen. Cluster meter: “most likely SN” objects that do not look like stars (Legacy Survey p_star ≤ 0.5) at |b| > 20°, counted inside R500 against a 3–6 R500 ring, over clusters with any object within 6 R500; the error is a 2,000-draw bootstrap over those clusters.</p>`,
      key: 'dLegend',
      honest: `At ×1 the bending is real but about ${M.deflectionRmsArcmin.toFixed(1)}′, too small to see; anything larger is amplified. Cluster rings are drawn far larger than life.`,
    },
    instruments: [
      { label: 'Meters', cls: 'd-meter', html: `<h3 id="h-dmeter">Do Rubin’s explosions follow the dark matter?</h3><p class="cap">Left: the Planck κ averaged at ${fmtN(LT.nObjects)} supernova-like alerts, against 300 copies of the same pattern rotated around the sky (faint ticks). Right: supernova-like alerts inside ACT clusters against the surroundings. The dashed line is 3σ.</p>
      <div class="meters"><div><canvas id="dMeter" aria-label="Lensing significance meter"></canvas><p class="note">b = ${LT.bias.toFixed(1).replace('-', '−')} ± ${LT.biasSigma.toFixed(1)} over about ${fmtN(LT.areaDeg2)} deg². What a detection looks like: ACT clusters through the same pipeline give +${LT.controlSigma.toFixed(1)}σ. Forecast: ${esc(LT.forecast)}.</p></div>
      <div><canvas id="dCtest" aria-label="Cluster supernova excess meter"></canvas><p class="note">${ctestNote()}</p></div></div>
      <p class="note dupd">${updatedLine()}</p>` },
      { label: 'The story so far', cls: 'd-story', html: `<h3 id="h-dstory">The story so far</h3>
      <ol class="dbeats">
        <li><b>The oldest light.</b> The CMB left the young universe 13.8 billion years ago. Its warm and cool spots are sound waves frozen in the first plasma.</li>
        <li><b>Bent on the way.</b> Every clump of matter between us and that light, mostly dark matter, bends it by a couple of arcminutes. Planck turned those tiny bends back into a map of the mass: the shadow.</li>
        <li><b>Rubin’s explosions.</b> Supernovae go off in galaxies, and galaxies sit where the dark matter is. If Rubin’s explosions trace the same mass, they should crowd where the shadow is darkest.</li>
        <li><b>Not yet.</b> Today the needle sits at ${LT.sigma.toFixed(1).replace('-', '−')}σ, inside the cloud of rotated skies: no signal, because Rubin has so far looked hard at a few patches only.</li>
        <li><b>How the needle should move.</b> As the wide survey fills the southern sky, the noise shrinks; if explosions follow dark matter like ordinary galaxies, the needle should cross 3σ around late 2027. ${CT.catalogue === 'ACT DR6' ? 'The cluster test, now on ten thousand ACT DR6 clusters, should get there about as soon.' : 'The cluster test should follow around mid-2028.'}</li>
      </ol>` },
    ],
    card: { id: 'dCard', hid: 'h-dcard', body: 'dCardBody', title: 'ACT clusters' },
  });
  wireScene('dm', root);
}

function aim(l, b, amp, shadow) {
  const f = frameOf(skyBox), [u, v] = hammer(l, b);
  st.lan = [f.cx + u * f.sc, f.cy - v * f.sc];
  const x = Math.round(Math.log(amp) / Math.log(300) * 1000);
  $('#dAmp').value = String(x); $('#dAmp').dispatchEvent(new Event('input'));
  const sb = $('#dShadow'); if ((sb.getAttribute('aria-pressed') === 'true') !== shadow) sb.click();
  st.glDirty = true;
}
function presets() {
  const busiest = [...Array(NC).keys()].sort((a, b) => CL.inside[b] - CL.inside[a])[0];
  const heaviest = [...Array(NC).keys()].sort((a, b) => CL.m500[b] - CL.m500[a])[0];
  const list = [
    { id: 'all', label: 'True bending', run: () => aim(240, -35, 1, false) },
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
function legendStops() {
  const P = palette(), rgb = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
  return (P.duo ? [P.cool, P.mid, P.warm] : [P.cool, P.warm]).map(rgb).join(',');
}
function legend() {
  $('#dLegend').innerHTML = `<span class="k"><span class="sw" style="background:${C().gold}"></span>SN-like alert (spark, then ember)</span><span class="k"><span class="sw ring" style="border-color:${C().gold}"></span>${CL.catalogue} cluster: faint lace; in front ◯ heaviest · ◎ most SN-like alerts inside</span><span class="k"><span class="sw" style="background:${C().gold};box-shadow:0 0 0 2px var(--paper),0 0 0 3px ${C().gold}"></span>a confident supernova</span><span class="k"><span class="sw" style="background:linear-gradient(90deg,${legendStops()})"></span>CMB cooler · warmer (about ±250 μK)</span>`;
}

function wire() {
  const cv = $('#dmGl'), amp = $('#dAmp'), ampV = $('#dAmpV');
  let drag = false;
  const toLocal = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const moveLan = (p) => { st.lan = p; st.glDirty = true; };
  let dial = null;
  const angleOf = (p) => Math.atan2(p[1] - st.lan[1], p[0] - st.lan[0]);
  cv.addEventListener('pointerdown', (e) => {
    const p = toLocal(e), ring = ringHit(p, e.pointerType !== 'mouse');
    if (ring === 'kappa') { $('#dShadow').click(); return; }
    if (ring === 'rim') { dial = { a: angleOf(p), x: ampX }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; K.hideTip(); return; }
    const onLens = ring === 'inside';
    const hit = nearestCluster(p[0], p[1], e.pointerType === 'mouse' ? 8 : 14);
    if (hit >= 0 && !onLens) { select(hit); return; }
    drag = true; cv.setPointerCapture(e.pointerId); moveLan(p);
    if (hit >= 0) select(hit);
  });
  cv.addEventListener('pointermove', (e) => {
    const p = toLocal(e);
    if (dial) {
      const a = angleOf(p), da = ((a - dial.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      dial.a = a; dial.x = clamp(dial.x + da / (DIAL.a1 - DIAL.a0), 0, 1);
      amp.value = String(Math.round(dial.x * 1000)); amp.dispatchEvent(new Event('input'));
      return;
    }
    if (drag) { moveLan(p); return; }
    if (e.pointerType !== 'mouse') return;
    const ring = ringHit(p, false);
    cv.style.cursor = ring === 'kappa' ? 'pointer' : ring === 'rim' ? 'grab' : ring === 'inside' ? 'move' : '';
    const i = nearestCluster(p[0], p[1], 8);
    st.hover = i;
    cv.classList.toggle('hot', i >= 0);
    if (i >= 0) K.showTip(tipFor(i), e.clientX, e.clientY); else K.hideTip();
  });
  const end = () => { drag = false; if (dial) { dial = null; cv.style.cursor = ''; } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { st.hover = -1; K.hideTip(); });
  makeTimeDock();
  const setAmp = () => { const x = +amp.value; ampX = x / 1000; st.amp = Math.round(Math.pow(300, x / 1000)); ampV.textContent = `×${st.amp}`; if (!demo) $('#dAmpNote').textContent = st.amp === 1 ? `At ×1 the bending is real but about ${M.deflectionRmsArcmin.toFixed(1)}′, too small to see.` : `Bending breathes up to ×${st.amp}: ${(M.deflectionRmsArcmin * st.amp / 60).toFixed(1)}° typical shift. The gold grid bends with it.`; st.glDirty = true; };
  amp.addEventListener('input', setAmp); setAmp();
  $('#dShadow').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.classList.toggle('on', on); st.shadowTarget = on ? 1 : 0; if (K.reduceMotion) { st.shadow = st.shadowTarget; st.glDirty = true; } });
  new ResizeObserver(() => { if (entered) sizeSky(); }).observe(cv);
  K.onTheme(() => { if (!built) return; buildRings(); emberCv = null; legend(); st.glDirty = true; meterS && meterS.draw(meterS); ctestS && ctestS.draw(ctestS); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
}

async function loadImages() {
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + src)); im.src = src; });
  const [skyIm, lensIm] = await Promise.all([load('data/cmb-sky.png'), load('data/cmb-lens.png')]);
  return { sky: skyIm, lens: lensIm };
}

const sessionMemo = new Set();
function firstInSession(key) {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    if (sessionMemo.has(key)) return false;
    sessionMemo.add(key);
    return true;
  }
}
function afterArrival(fn) {
  const t0 = performance.now();
  const wait = () => {
    if (!entered) return;
    if (document.querySelector('.floor-climb') && performance.now() - t0 < 2 * DUR.count) { requestAnimationFrame(wait); return; }
    setTimeout(() => { if (entered) fn(); }, DUR.gentle);
  };
  requestAnimationFrame(wait);
}

const DEMO = { peak: 50, ms: 4 * DUR.travel, rise: 0.4 };
let demo = null;
function setAmpX(x) { const amp = $('#dAmp'); amp.value = String(Math.round(clamp(x, 0, 1) * 1000)); amp.dispatchEvent(new Event('input')); }
function endDemo() {
  if (!demo) return;
  const d = demo;
  demo = null;
  d.job.cancel();
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.removeEventListener(ev, d.stop, { capture: true }));
  setAmpX(0);
  $('#lensbar').removeAttribute('aria-busy');
}
function lensDemo() {
  if (demo || K.reduceMotion || !entered || document.hidden || st.amp !== 1 || st.shadowTarget) return;
  if (!firstInSession('observatory-dm-lens-demo')) return;
  const top = Math.log(DEMO.peak) / Math.log(DIAL.max), r = DEMO.rise;
  const d = { stop: () => endDemo() };
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, d.stop, { capture: true }));
  demo = d;
  $('#lensbar').setAttribute('aria-busy', 'true');
  d.job = tween({
    from: 0, to: 1, dur: DEMO.ms, curve: 'linear',
    step: (v) => { if (demo === d) setAmpX(top * (v < r ? ease.io(v / r) : v < 1 - r ? 1 : ease.io((1 - v) / r))); },
    done: () => { if (demo === d) endDemo(); },
  });
}

function sweepVerdict() {
  const v = $('#dmRoot .verdict'), zero = v && v.querySelector('.zero');
  if (!zero || K.reduceMotion || !v.getClientRects().length || !firstInSession('observatory-dm-needles')) return;
  const z = zero.offsetLeft + zero.offsetWidth / 2;
  const vals = { lens: LT.sigma, cl: CT.sigma };
  for (const n of v.querySelectorAll('.ndl')) {
    play(n, [{ transform: `translateX(${Math.round(z - n.offsetLeft - n.offsetWidth / 2)}px)` }, { transform: 'none' }], { dur: DUR.travel, curve: 'out' });
    const lab = n.querySelector('i'), key = Object.keys(vals).find((k) => n.classList.contains(k));
    if (!lab || !key) continue;
    const pre = lab.textContent.slice(0, lab.textContent.lastIndexOf(' ') + 1), to = vals[key];
    tween({ from: 0, to, dur: DUR.travel, curve: 'out', step: (x) => { lab.textContent = pre + sig(x === to ? to : x); } });
  }
}
const meterSweep = { p: 1, started: false };
function sweepMeters(s) {
  if (meterSweep.started || !s.w) return;
  meterSweep.started = true;
  if (K.reduceMotion || !firstInSession('observatory-dm-meters')) return;
  meterSweep.p = 0;
  tween({ from: 0, to: 1, dur: DUR.travel, curve: 'out', step: (p) => { meterSweep.p = p; [meterS, ctestS].forEach((m) => m && m.w && drawMeters[m === meterS ? 0 : 1](m)); } });
}
const drawMeters = [
  (s) => { sweepMeters(s); const v = LT.sigma * meterSweep.p; drawMeter(s, { range: [-4, 8], every: 2, nulls: LT.nulls, value: v, ref: LT.controlSigma, refLabel: `ACT clusters +${LT.controlSigma.toFixed(1)}σ`, big: sig(v), small: 'κ at SN-like alerts vs 300 rotated skies' }); },
  (s) => { sweepMeters(s); const v = CT.sigma * meterSweep.p; drawMeter(s, { range: [-2, 5], every: 1, value: v, ghost: CT.dr5Ghost ? CT.dr5Ghost.sigma : null, ghostLabel: 'DR5', big: sig(v), small: `${CT.observed} seen vs ${CT.expected} expected in ${fmtN(CT.clusters)} clusters` }); },
];

async function build() {
  buildDom();
  ov = $('#dmOv').getContext('2d');
  imgs = await loadImages();
  gl = initGl($('#dmGl'));
  if (gl) { uploadTextures(); $('#dmGl').addEventListener('snapshot', drawGl); }
  meterS = K.setupCanvas($('#dMeter'), drawMeters[0]);
  ctestS = K.setupCanvas($('#dCtest'), drawMeters[1]);
  pill = SC.makePill($('#dmRoot .pill-host'), { onToggle: toggleShowAll, onBack: toggleShowAll });
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
  K.shell.setSearch({ items: searchItems, empty: 'No ACT cluster matches. Try ACT-CL J0102.' }, `Search ${fmtN(NC)} ACT clusters, e.g. ACT-CL J0102`);
  if (objId) { const i = CL.name.indexOf(objId); if (i >= 0) st.sel = i; }
  renderCard();
  K.pingLadder();
  requestAnimationFrame(() => { sizeSky(); syncTime(); pillText(); K.pingLadder(); [meterS, ctestS].forEach((s) => s.resize()); });
  const params = new URLSearchParams(location.search);
  if (!K.reduceMotion && params.has('play')) { st.t = T0; emberN = 0; emberCv = null; setPlay(true); } else syncTime();
  loop();
  afterArrival(() => { sweepVerdict(); lensDemo(); });
}
function leave() { endDemo(); entered = false; if (dock) setPlay(false); K.hideTip(); }

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
  counts: () => ({ nobj: NC, nunit: NA, tmax: Math.max(aT[NA - 1], isoMjd(M.dataTo) || 0) }),
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
export const api = (K.ns.dm = { enter, leave, select, setPlay, get state() { return st; }, get verdict() { return verdict(); }, get gl() { return !!gl; }, perf: K.perf });
