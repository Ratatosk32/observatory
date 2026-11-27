import {
  $, C, DEG, BANDS, MON, ns, perf, pushPerf, pingLadder, cosmo, reduceMotion, mjdDate, fmtDate, fmtShort, dateMjd, nightMjd, fmtN, clamp, norm, esc,
  rng, seedOf, pencilLine, pencilCircle, hatch, sketchBar, setupCanvas, font, annotate, text, showTip, hideTip, setUrl,
  onTheme, loadJson, withTokensOf,
} from './kit.js';
import { createSync } from './sync.js';
import { register as registerData, refresh as refreshData, fmtBytes } from './datapanel.js';
import * as SC from './showcase.js';
import { sceneHtml, wireScene, openInstrument } from './scene.js';
import { dockHtml, makeDock, fmtSpeed, dataLoop, LOOP_NOTE } from './dock.js';
import { cardHead } from './cardhead.js';
import { DUR, ease, tween, flightMs } from './motion.js';
import { floorDrawn } from './curtain.js';

function buildDom() {
  const root = $('#astRoot');
  root.innerHTML = sceneHtml('asteroids', {
    mainId: 'astMain', qid: 'h-map', stageCls: 'map-panel', pillId: 'astTools',
    question: 'Where are they, and where is Rubin looking?',
    canvas: '<canvas id="map" aria-label="Solar System map"></canvas>',
    zoom: '<div class="zoom stops seg" role="group" aria-label="Zoom stops"><button class="btn sm" data-zoom="1.8" type="button">Inner</button><button class="btn sm" data-zoom="3.9" type="button">Belt</button><button class="btn sm" data-zoom="6.2" type="button">Jupiter</button></div>',
    views: {
      nav: 'presets', label: 'Guided views of the asteroids', first: 'Whole sample', legend: 'legend-map',
      extra: [['Size', `<div class="sizebar" id="sizebar" role="group" aria-labelledby="sizeLbl">
  <span class="lbl" id="sizeLbl">Estimated diameter</span>
  <div class="dual" id="dual"><canvas id="sizeHist" aria-hidden="true"></canvas><input type="range" id="dMin" min="0" max="1000" step="1" value="0" aria-label="Minimum estimated diameter"><input type="range" id="dMax" min="0" max="1000" step="1" value="1000" aria-label="Maximum estimated diameter"></div>
  <span class="sval" id="sizeVal"></span>
  <span class="scnt" id="sizeCnt" aria-live="polite"></span>
  <button class="btn" type="button" id="sizeReset" hidden>Reset</button>
  <p class="note">D = 1329 km / √p × 10<sup>−H/5</sup>, from the absolute magnitude H measured here. Albedo p = 0.15, except 0.40 for Hungarias and 0.06 for Cybeles, Hildas and Trojans. Real sizes can differ by about 2×.</p>
</div>`]],
    },
    dock: dockHtml({ play: 'play', date: 'date', track: 'aTrack', speed: 'speed', label: 'Time track: Rubin alerts per night, hatched outside the data window where positions are extrapolated. Left and right arrows step a day, Shift a week.' }),
    info: {
      cap: 'The Solar System from above, to scale. Bright: the most unusual asteroids; the soft haze is everyone else. Glowing: detected by Rubin within two days; the gold fan from Earth is where it looked.',
      about: '<p>Each asteroid moves on its own orbit; the fan from Earth is brighter where Rubin looked more often. The ring is the ecliptic, marked in heliocentric longitude from the vernal equinox. <span id="timenote"></span></p>',
      honest: 'Orbits are two-body Sun-only ellipses fixed at each asteroid’s last detection; far outside the detection window the dots are extrapolations. Sizes are estimates from brightness and an assumed albedo.',
    },
    instruments: [
      { label: 'Orbits', cls: 'el-panel', html: '<h3 id="h-el">How does Jupiter sculpt the asteroid belt?</h3><p class="cap">Each dot is an asteroid: its orbit size (semi-major axis a) against its <span id="ycap">eccentricity e, how stretched the orbit is</span>. The strip on top counts asteroids per 0.025 AU. Dashed lines mark orbits whose period is a simple fraction of Jupiter’s (4:1, 3:1, …); Jupiter’s regular tugs clear those zones, so look for the dips.</p><div class="seg" role="group" aria-label="Vertical axis"><button class="btn sm on" data-y="e" type="button">a vs e</button><button class="btn sm" data-y="i" type="button">a vs i</button></div><canvas id="elem" aria-label="Orbital element scatter plot"></canvas><div class="legend" id="legend-el"></div>' },
      { label: 'Colours', cls: 'col-panel', html: '<h3 id="h-col">What are they made of?</h3><p class="cap">Colour from two exposures in different filters taken minutes apart, so distance and lighting barely change. Gold line: the Sun’s colour. Redder than the Sun in r − i hints at stony S-types; close to solar hints at dark carbon-rich C-types.</p><canvas id="colours" aria-label="Colour histograms"></canvas><p class="note" id="colnote"></p>' },
      { label: 'Cadence', cls: 'cad-panel', html: '<h3 id="h-cad">When was Rubin observing?</h3><p class="cap">One bar per night of 2026 with data. Top: all alerts that night (log scale), and in blue those matched to known Solar System objects. Bottom: detections of the asteroids on this page. Empty stretches mean no data. Click a night to send the map there.</p><canvas id="cadence" aria-label="Nightly cadence chart"></canvas><div class="legend" id="legend-cad"></div>' },
      { label: 'Stamps', cls: 'stamp-panel', html: `<h3 id="h-st">How does one alert find a moving dot?</h3><p class="cap" id="stampCap">The three 36 × 36 pixel stamps (0.2″ per pixel, about 7″ across) that came with alert 171211557626183684: near-Earth asteroid 2020 HJ4, i band, 15 Nov 2026, 0.30 AU from Earth. Open any asteroid’s card and press <b>Show cutouts</b> to load its latest stamps here.</p>
    <div class="stamps">
      <figure><span class="im"><img id="stSci" src="stamps/science.png" alt="Science image stamp" width="36" height="36"></span><figcaption><b>Science</b>tonight’s exposure</figcaption></figure>
      <div class="op">−</div>
      <figure><span class="im"><img id="stTpl" src="stamps/template.png" alt="Template image stamp" width="36" height="36"></span><figcaption><b>Template</b>deep stack of earlier visits</figcaption></figure>
      <div class="op">=</div>
      <figure><span class="im"><img id="stDif" src="stamps/difference.png" alt="Difference image stamp" width="36" height="36"></span><figcaption><b>Difference</b>only what changed</figcaption></figure>
    </div>
    <p class="body" id="stampBody">The template holds only noise at this spot: the asteroid was elsewhere when the template visits were taken. Subtracting it leaves the asteroid alone. It is an elongated streak rather than a round star because it moved about 3″ during the 30-second exposure, which is the signature of a nearby, fast-moving object. The alert pipeline then matches the source to a predicted position of a known object and attaches its heliocentric position and velocity, which is what every orbit on this page is built from.</p>` },
    ],
    card: { id: 'card', hid: 'h-card', body: 'cardBody', title: 'Rubin asteroids' },
  });
  wireScene('asteroids', root);
}
buildDom();

const [R, SCD] = await Promise.all([loadJson('data/asteroids.json'), SC.loadShowcase()]);
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
    g.fillStyle = on ? C.goldSoft : C.grid; g.globalAlpha = on ? 0.7 : 1;
    const hh = Math.max(1, Math.sqrt(h[k] / mx) * r.height);
    g.fillRect(k * bw + 0.5, r.height - hh, bw - 1, hh);
  }
  g.globalAlpha = 1;
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
const PLANET_R = { Mercury: 3.4, Venus: 5, Earth: 5.6, Mars: 4.4, Jupiter: 10, Saturn: 8 };
const PLANET_LOOK = {
  Sun: ['--sun'], Mercury: ['#b8b2a7'], Venus: ['#e8d6a8'], Earth: ['#a8c8e0'], Mars: ['#e3a99a'], Jupiter: ['#e8c9a0'], Saturn: ['#ebddb0'],
};
function planetSprite(name, rad, dpr) {
  const key = [name, rad, dpr, C.dark].join('|');
  let sp = spriteCache.get(key);
  if (sp) return sp;
  const pad = name === 'Saturn' ? rad * 1.4 : name === 'Sun' ? rad * 2.4 : rad * 0.7 + 2;
  const size = Math.ceil((rad + pad) * 2 + 4);
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2, cy = size / 2;
  const col = name === 'Sun' ? '#f6d98b' : PLANET_LOOK[name][0];
  const ink = C.dark ? 'rgba(236, 230, 214, 0.85)' : '#4a4a4a';
  const glow = g.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad + pad);
  glow.addColorStop(0, name === 'Sun' ? (C.dark ? 'rgba(246, 217, 139, 0.5)' : 'rgba(214, 160, 60, 0.35)') : col + (C.dark ? '3a' : '22'));
  glow.addColorStop(name === 'Sun' ? 0.35 : 1, name === 'Sun' ? (C.dark ? 'rgba(246, 217, 139, 0.12)' : 'rgba(214, 160, 60, 0.08)') : col + '00');
  if (name === 'Sun') glow.addColorStop(1, 'rgba(242, 184, 128, 0)');
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, rad + pad, 0, 6.283); g.fill();
  if (name === 'Sun') {
    const r = rng(77);
    g.strokeStyle = C.sunrays; g.lineWidth = 0.7; g.lineCap = 'round';
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * 6.283 + r() * 0.08, r1 = rad + 2.5, r2 = rad + 4 + (k % 2 ? 0.25 : 0.55) * pad;
      g.globalAlpha = k % 2 ? 0.35 : 0.55; g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
    }
    g.globalAlpha = 1;
  }
  g.save(); g.beginPath(); g.arc(cx, cy, rad, 0, 6.283); g.clip();
  const shade = g.createRadialGradient(cx - rad * 0.35, cy - rad * 0.35, rad * 0.1, cx, cy, rad * 1.05);
  shade.addColorStop(0, col); shade.addColorStop(1, C.dark ? 'rgba(20, 22, 34, 1)' : 'rgba(120, 112, 100, 1)');
  g.fillStyle = col; g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.55; g.fillStyle = shade; g.fillRect(0, 0, size, size); g.globalAlpha = 1;
  if (name === 'Jupiter') { g.globalAlpha = 0.45; g.fillStyle = '#b98a64'; g.fillRect(cx - rad, cy - rad * 0.35, rad * 2, rad * 0.22); g.fillRect(cx - rad, cy + rad * 0.15, rad * 2, rad * 0.2); g.globalAlpha = 1; }
  if (name === 'Earth') { g.globalAlpha = 0.7; g.fillStyle = '#7fa874'; g.beginPath(); g.ellipse(cx - rad * 0.25, cy - rad * 0.1, rad * 0.45, rad * 0.3, 0.6, 0, 6.283); g.fill(); g.globalAlpha = 1; }
  g.restore();
  if (name === 'Saturn') {
    g.save(); g.translate(cx, cy); g.rotate(-0.35); g.scale(1, 0.34);
    g.strokeStyle = '#c9b585'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, rad * 1.9, 0, 6.283); g.stroke();
    g.strokeStyle = ink; g.lineWidth = 0.9; g.beginPath(); g.arc(0, 0, rad * 2.1, 0, 6.283); g.stroke();
    g.restore();
  }
  g.strokeStyle = ink; g.lineWidth = 0.8; g.globalAlpha = name === 'Sun' ? 0.5 : 0.8; g.beginPath(); g.arc(cx, cy, rad, 0, 6.283); g.stroke(); g.globalAlpha = 1;
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
let dataVer = 0, scA = null, rankPosA = new Int32Array(0), rank = [], W = null, lodFirst = true, lodKey = '', accepted = 0, pill = null, showAll = false, weightRaf = 0;
let hazeSmall = null, hazeSoft = null;
const BLUR = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const AST_W = { rare: 1, orbit: 0.9, approach: 1, extreme: 0.8 };
let N = 0, flatT = new Float64Array(0), META = R.meta, posX = new Float32Array(0), posY = new Float32Array(0);
const ladderGeo = { ok: false, sc: 1, ex: 0, ey: 0 };
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
  const sc = SCD && SCD.modes && SCD.modes.asteroids;
  scA = sc && sc.n === N && sc.rank.every((k) => O[k] && O[k].name === R.objs[k].n) ? sc : null;
  rank = scA ? scA.rank : [...O.keys()].sort((a, b) => (O[a].cls === 'MBA') - (O[b].cls === 'MBA') || O[b].nn - O[a].nn);
  dataVer++;
  rankPosA = new Int32Array(N); rank.forEach((k, q) => { rankPosA[k] = q; });
  W = SC.makeWeights(N); lodFirst = true; lodKey = '';
}
buildData();

function solveE(M, e) {
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI;
  for (let k = 0; k < 12; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-8) break;
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


let clsIdx = new Uint8Array(0), clsVer = -1;
function binBy(levelOf, nl) {
  if (clsVer !== dataVer) { clsIdx = Uint8Array.from(O, (o) => Math.max(0, CLASS_ORDER.indexOf(o.cls))); clsVer = dataVer; }
  const bins = Array.from({ length: CLASS_ORDER.length * nl }, () => []);
  for (let k = 0; k < N; k++) { const l = levelOf(k); if (l > 0) bins[clsIdx[k] * nl + l].push(k); }
  return bins;
}
const showcaseOn = () => !state.filter && state.preset === 'all';
function runLod(s) {
  const n0 = s.w < 600 ? (scA ? scA.top.phone : 50) : (scA ? scA.top.desktop : 100);
  const k = Math.max(1, 3.9 / state.viewR);
  const key = [s.w, s.h, state.viewR.toFixed(3), Math.floor(state.t / 5), showAll, showcaseOn(), state.sel ? state.sel.idx : -1, state.hover ? state.hover.idx : -1, n0].join('|');
  if (key !== lodKey) {
    lodKey = key;
    if (!showcaseOn()) { W.tgt.fill(1); accepted = N; }
    else accepted = SC.lodPass(W, { rank, n0, k, total: N, ok: () => true, x: posX, y: posY, wpx: s.w, hpx: s.h, forced: [state.sel ? state.sel.idx : -1, state.hover ? state.hover.idx : -1], all: showAll });
    if (lodFirst) { W.w.set(W.tgt); lodFirst = false; }
    if (pill) {
      const [t, b, m] = SC.pillCopy({ phone: s.w < 600, all: showAll, guided: !showcaseOn(), accepted, total: N, n0, zoomed: k > 1.05 });
      pill.set(t, b, m);
    }
  }
}
function toggleShowAll() {
  showAll = !showAll;
  lodKey = '';
  const rp = new Float32Array(N); rank.forEach((k, q) => { rp[k] = q; });
  SC.ripple(W, rp, N, showAll, performance.now(), mapS.w < 600);
  mapS.draw(mapS);
}
let hazeCols = {};
function hazeColors() {
  if (hazeCols.dark === C.dark) return hazeCols;
  hazeCols = { dark: C.dark };
  for (const c of CLASS_ORDER) hazeCols[c] = SC.mixColor(C.cls[c], C.ink, 0.35);
  return hazeCols;
}
function drawHaze(g, s) {
  const hw = Math.max(2, Math.ceil(s.w / 2)), hh = Math.max(2, Math.ceil(s.h / 2));
  if (!hazeSmall || hazeSmall.width !== hw || hazeSmall.height !== hh) {
    hazeSmall = document.createElement('canvas'); hazeSmall.width = hw; hazeSmall.height = hh;
    hazeSoft = document.createElement('canvas'); hazeSoft.width = hw; hazeSoft.height = hh;
  }
  const hg = hazeSmall.getContext('2d'), cols = hazeColors();
  const bins = binBy((k) => { const crowd = 1 - W.w[k]; return crowd <= 0.02 ? -1 : Math.min(3, Math.ceil(crowd * 3)); }, 4);
  if (!bins.some((a) => a.length)) return;
  hg.clearRect(0, 0, hw, hh);
  for (let ci = 0; ci < CLASS_ORDER.length; ci++) {
    const c = CLASS_ORDER[ci];
    hg.fillStyle = cols[c];
    for (let lev = 1; lev <= 3; lev++) {
      const arr = bins[ci * 4 + lev]; if (!arr.length) continue;
      hg.globalAlpha = 0.5 * lev / 3; hg.beginPath();
      for (const k of arr) hg.rect(posX[k] / 2 - 1, posY[k] / 2 - 1, 2, 2);
      hg.fill();
    }
  }
  hg.globalAlpha = 1;
  const sg = hazeSoft.getContext('2d');
  sg.clearRect(0, 0, hw, hh);
  if (BLUR) { sg.filter = 'blur(1.25px)'; sg.drawImage(hazeSmall, 0, 0); sg.filter = 'none'; }
  else { sg.drawImage(hazeSmall, 0, 0); sg.globalAlpha = 0.33; for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) sg.drawImage(hazeSmall, ox, oy); sg.globalAlpha = 1; }
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalAlpha = C.dark ? 0.55 : 0.65;
  g.drawImage(hazeSoft, 0, 0, s.w, s.h);
  g.restore();
}
const glowBudget = () => (mapS.w < 600 ? 50 : 100) * Math.max(1, Math.pow(3.9 / state.viewR, 1.5));
function drawFront(g, sc) {
  const sp = glowFor(), R = clamp(sc / 11, 4, 7);
  for (let q = 0; q < Math.min(rank.length, glowBudget()); q++) {
    const k = rank[q], w = W.w[k];
    if (w <= 0.02) continue;
    g.globalAlpha = 0.35 * w;
    g.drawImage(sp, posX[k] - R, posY[k] - R, 2 * R, 2 * R);
  }
  const bins = binBy((k) => { const w = W.w[k]; return w <= 0.02 ? -1 : Math.min(4, Math.ceil(w * 4)); }, 5);
  for (let ci = 0; ci < CLASS_ORDER.length; ci++) {
    const c = CLASS_ORDER[ci];
    g.fillStyle = C.cls[c];
    const r = c === 'MBA' ? 2.2 : 2.6, square = c === 'MBA' && showAll;
    for (let lvl = 1; lvl <= 4; lvl++) {
      const arr = bins[ci * 5 + lvl]; if (!arr.length) continue;
      g.globalAlpha = lvl / 4; g.beginPath();
      for (const k of arr) { if (square) g.rect(posX[k] - 1.9, posY[k] - 1.9, 3.8, 3.8); else { g.moveTo(posX[k] + r, posY[k]); g.arc(posX[k], posY[k], r, 0, 6.2832); } }
      g.fill();
    }
  }
  g.globalAlpha = 1;
}
function drawArcs(g, sc, cx, cy) {
  if (!scA) return;
  const tmp = [0, 0];
  g.strokeStyle = C.cls.NEO; g.lineWidth = 1; g.setLineDash([4, 3]);
  for (let q = 0; q < Math.min(rank.length, 300); q++) {
    const k = rank[q], f = scA.facts[String(k)], w = W.w[k];
    if (!f || w <= 0.02 || f.c[2] < 128) continue;
    g.globalAlpha = 0.6 * w;
    g.beginPath();
    for (let d = 0; d <= 30; d += 1) { posAt(O[k], state.t + d, tmp); const x = cx + tmp[0] * sc, y = cy - tmp[1] * sc; if (d) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  g.setLineDash([]); g.globalAlpha = 1;
}
const RARE_CHIP = { NEO: 'Near-Earth asteroid', MC: 'Mars-crosser', HUN: 'Hungaria', CYB: 'Cybele', HIL: 'Hilda', TRO: 'Jupiter Trojan', OTH: 'Unusual orbit' };
const RARE_W = { NEO: 1, MC: 0.6, HUN: 0.6, MBA: 0, CYB: 0.6, HIL: 0.7, TRO: 0.9, OTH: 0.7 };
function chipsFor(o) {
  const f = scA && scA.facts[String(o.idx)], out = [];
  if (f && f.pha) out.push([1.01, 'Potentially hazardous']);
  else if (RARE_CHIP[o.cls]) out.push([RARE_W[o.cls], RARE_CHIP[o.cls]]);
  const tilt = clamp((o.inc - 18) / 17, 0, 1), str = clamp((o.e - 0.25) / 0.25, 0, 1);
  if (o.inc > 90) out.push([0.9, 'Retrograde']);
  else if (tilt > 0 && tilt >= str) out.push([0.9 * tilt, `Tilted ${Math.round(o.inc)}°`]);
  else if (str > 0) out.push([0.9 * str, `Stretched orbit, e ${o.e.toFixed(2)}`]);
  if (f && f.approachAU != null) out.push([f.c[2] / 255, `Passes ${f.approachAU.toFixed(2)} AU on ${fmtShort(f.approachT)}`]);
  if (f && f.extreme) {
    const v = 0.8 * f.c[3] / 255;
    if (f.extreme === 'biggest' && o.D) out.push([v, `Biggest here: ~${o.D >= 10 ? Math.round(o.D) : o.D.toFixed(1)} km`]);
    if (f.extreme === 'smallest' && o.D) out.push([v, `Smallest: ~${o.D < 1 ? Math.round(o.D * 1000) + ' m' : o.D.toFixed(1) + ' km'}`]);
    if (f.extreme === 'mostSeen') out.push([v, `Seen on ${o.nn} nights`]);
  }
  if (f && scA.refNight - f.last < 1) out.push([0.15, 'Seen last night']);
  return out.filter((c) => c[0] > 0).sort((a, b) => b[0] - a[0]).map((c) => c[1]);
}
function topList() {
  const out = [], lead = new Map();
  for (let q = 0; q < rank.length && out.length < 8; q++) {
    const o = O[rank[q]], b = chipsFor(o)[0] || '';
    if ((lead.get(b) || 0) >= 2) continue;
    lead.set(b, (lead.get(b) || 0) + 1); out.push(o);
  }
  return out;
}

function tipFor(o) {
  return `<b>${o.name}</b>${o.des ? ' (' + o.des + ')' : ''}<br>${CLASS[o.cls].short} · a ${o.a.toFixed(2)} AU · e ${o.e.toFixed(2)} · i ${o.inc.toFixed(1)}°<br>${o.det.length} detections on ${o.nn} nights`;
}

$('#map').dataset.lowdpr = '';
const mapS = setupCanvas($('#map'), drawMap);
const chromeRo = new ResizeObserver(() => { hudBox.key = ''; zoomBox.key = ''; requestAnimationFrame(() => mapS.draw(mapS)); });
document.querySelectorAll('#astRoot .hud .hud-l, #astRoot .hud .pill-host, #astRoot .hud .hud-r, #astRoot .zoom.stops').forEach((e) => chromeRo.observe(e));
let staticLayer = null, staticKey = '';
const planetNow = {};

function mapScale(s) { return Math.min(s.w, s.h) / 2 / state.viewR * 0.94; }
const mapCy = (s) => (s.h > s.w ? s.h - s.w / 2 : s.h / 2);

let plateLayer = null, plateKey = '', staticR = 0;
function layerCanvas(cv, s) {
  const c = cv || document.createElement('canvas'), w = Math.round(s.w * s.dpr), h = Math.round(s.h * s.dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  return [c, g];
}
function buildPlate(s) {
  const safe = safeRects(s), bar = scaleBox(s);
  const key = [s.w, s.h, s.dpr, C.dark, safe.map((r) => r.map(Math.round).join(',')).join(';'), bar.map(Math.round).join(',')].join('|');
  if (key === plateKey && plateLayer) return;
  plateKey = key;
  const [cv, g] = layerCanvas(plateLayer, s);
  const cx = s.w / 2, cy = mapCy(s);
  const plateR = drawPlate(g, s, cx, cy);
  plateLabels(g, s, cx, cy, plateR, [...safe, bar]);
  plateLayer = cv;
}
function buildStatic(s) {
  const key = [s.w, s.h, s.dpr, state.viewR, state.preset, state.sel ? state.sel.idx : -1, C.dark].join('|');
  if (key === staticKey && staticLayer) return;
  staticKey = key; staticR = state.viewR;
  const [cv, g] = layerCanvas(staticLayer, s);
  const sc = mapScale(s), cx = s.w / 2, cy = mapCy(s);
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
      g.globalAlpha = pass === 0 ? (color === C.hi ? 0.75 : 1) : 0.45;
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
    }, 200, seedOf(a, 3), 0, C.porbit, 0.8, 1);
  }
  if (state.sel) {
    const o = state.sel;
    ellipse((E) => {
      const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
      return [xp * o.Px + yp * o.Qx, xp * o.Py + yp * o.Qy];
    }, 240, seedOf(o.idx, 5), 0, C.hi, 1, 1);
    g.globalAlpha = 0.8; g.fillStyle = C.hi; g.beginPath();
    for (const d of o.det) if (d[6] !== null) { const x = cx + d[6] * sc, y = cy - d[7] * sc; g.moveTo(x + 1.6, y); g.arc(x, y, 1.6, 0, 6.2832); }
    g.fill(); g.globalAlpha = 1;
  }
  staticLayer = cv;
}
let zoomBox = { key: '', r: null };
function zoomRect(s) {
  const key = `${s.w}x${s.h}`;
  if (zoomBox.key === key) return zoomBox.r;
  const z = document.querySelector('#astRoot .zoom.stops'), cv = $('#map');
  const zr = z && z.getBoundingClientRect(), cr = cv.getBoundingClientRect();
  const r = zr && zr.width ? { left: zr.left - cr.left, top: zr.top - cr.top, right: zr.right - cr.left, bottom: zr.bottom - cr.top } : null;
  zoomBox = { key: r ? key : '', r };
  return r;
}
function scaleAnchor(s) {
  const z = zoomRect(s);
  let x1 = s.w - 12, y0 = s.h - 14;
  if (z && z.bottom > y0 - 26 && z.left < x1) { x1 = z.left - 14; y0 = Math.min(y0, z.bottom - 6); }
  return [x1, y0];
}
const scaleOf = (s, r) => Math.min(s.w, s.h) / 2 / r * 0.94;
function scaleBox(s) {
  const [x1, y0] = scaleAnchor(s), len = zoomFx.job ? Math.max(niceAU(zoomFx.from) * scaleOf(s, zoomFx.from), niceAU(zoomFx.to) * scaleOf(s, zoomFx.to)) : niceAU(state.viewR) * scaleOf(s, state.viewR);
  return [x1 - len - 2, y0 - 22, x1 + 2, y0 + 3];
}
function scaleBar(g, s, sc) {
  const [x1, y0] = scaleAnchor(s);
  let au = niceAU(state.viewR), len = au * sc, label = `${au} AU`;
  if (zoomFx.job) {
    const l0 = niceAU(zoomFx.from) * scaleOf(s, zoomFx.from), l1 = niceAU(zoomFx.to) * scaleOf(s, zoomFx.to);
    len = l0 + (l1 - l0) * zoomFx.e; au = len / sc;
    label = `${au.toFixed(au < 1 ? 2 : 1)} AU`;
  }
  const x0 = x1 - len;
  pencilLine(g, x0, y0, x1, y0, { color: C.graphite, width: 1.2 });
  pencilLine(g, x0, y0 - 5, x0, y0 + 1, { color: C.graphite, width: 1 });
  pencilLine(g, x1, y0 - 5, x1, y0 + 1, { color: C.graphite, width: 1 });
  text(g, label, x0 + len / 2, y0 - 8, { size: 11, weight: 500, color: C.ink2, align: 'center', halo: true });
  labelBoxes.push([x0, y0 - 19, x1, y0 + 2]);
  return [x0, y0, x1];
}
function plateFill() {
  const [r, g, b] = SC.rgbOf(C.dark ? C.ink : getComputedStyle(document.documentElement).getPropertyValue('--field').trim());
  return (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
}
function drawPlate(g, s, cx, cy) {
  const R = Math.min(s.w, s.h) / 2 - 6, fill = plateFill();
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  gr.addColorStop(0, fill(C.dark ? 0.065 : 0.8)); gr.addColorStop(0.75, fill(C.dark ? 0.035 : 0.5)); gr.addColorStop(1, fill(C.dark ? 0.02 : 0.3));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.fill();
  return R;
}
const hits = (b, rects) => rects.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
const RING_TRY = [[0, 0], [-7, 0], [7, 0], [0, 16], [0, 30], [-14, 0], [14, 0], [-21, 0], [21, 0], [-7, 16], [7, 16], [0, 44], [0, 58], [-14, 44], [14, 44]];
function plateLabels(g, s, cx, cy, R, avoid) {
  g.strokeStyle = C.goldSoft; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
  g.lineWidth = 1; g.beginPath();
  for (let d = 0; d < 360; d += 10) {
    const a = d * DEG, len = d % 90 === 0 ? 7 : d % 30 === 0 ? 4.5 : 2;
    g.moveTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - len), cy - Math.sin(a) * (R - len));
  }
  g.stroke();
  const lab = { size: 11, color: C.ink3, halo: true, align: 'center' };
  plateBoxes = [];
  g.font = font(11);
  const ring = (str, deg) => {
    const w = g.measureText(str).width;
    let pick = null;
    for (const [dd, deeper] of RING_TRY) {
      const a = (deg + dd) * DEG, inset = 12 + deeper + w / 2 * Math.abs(Math.cos(a)) + 6 * Math.abs(Math.sin(a));
      const x = cx + Math.cos(a) * (R - inset), y = cy - Math.sin(a) * (R - inset), b = [x - w / 2 - 2, y - 8, x + w / 2 + 2, y + 6];
      if (b[0] < 2 || b[2] > s.w - 2 || b[1] < 2 || b[3] > s.h - 2) continue;
      if (!hits(b, avoid)) { pick = [x, y, b]; break; }
    }
    if (!pick) return;
    text(g, str, pick[0], pick[1] + 4, lab);
    plateBoxes.push(pick[2]);
  };
  ring('90°', 90);
  ring('180°', 180);
  ring('270°', 270);
  const eq = '0° · vernal equinox';
  g.font = font(11);
  if (cx + R + 10 + g.measureText(eq).width < s.w - 8) plateEq = [eq, cx + R + 10, cy + 4, 'left'];
  else {
    ring('0°', 0);
    plateEq = ['0°: vernal equinox', s.w - 12, s.h - 12, 'right'];
  }
}
let plateBoxes = [], labelBoxes = [];
let plateEq = null;
function fadeOutside(g, s) {
  const cx = s.w / 2, cy = mapCy(s), R = Math.min(s.w, s.h) / 2 - 6;
  if (Math.hypot(cx, cy) < R + 4) return;
  const gr = g.createRadialGradient(cx, cy, R + 2, cx, cy, R + 28);
  gr.addColorStop(0, 'rgba(0, 0, 0, 0)'); gr.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gr; g.fillRect(0, 0, s.w, s.h); g.restore();
}
function niceAU(r) { return r < 2.5 ? 0.5 : r < 5 ? 1 : 2; }

const litSet = new Set();
let glowSprite = null;
function glowFor() {
  if (glowSprite && glowSprite.dark === C.dark) return glowSprite.c;
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const x = c.getContext('2d'), gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
  if (C.dark) { gr.addColorStop(0, 'rgba(255, 228, 190, 0.9)'); gr.addColorStop(0.25, 'rgba(242, 168, 120, 0.45)'); gr.addColorStop(1, 'rgba(242, 138, 118, 0)'); }
  else { gr.addColorStop(0, 'rgba(176, 70, 24, 0.8)'); gr.addColorStop(0.3, 'rgba(194, 90, 40, 0.3)'); gr.addColorStop(1, 'rgba(194, 90, 40, 0)'); }
  x.fillStyle = gr; x.fillRect(0, 0, 48, 48);
  glowSprite = { c, dark: C.dark };
  return c;
}
function drawLit(g, lit, sc) {
  const sp = glowFor(), n = lit.size, a = clamp(60 / n, 0.12, 0.45), R = clamp(sc / 11, 4, 7), cr = clamp(sc / 48, 1, 1.5);
  g.globalAlpha = a;
  for (const k of lit) g.drawImage(sp, posX[k] - R, posY[k] - R, 2 * R, 2 * R);
  g.globalAlpha = 1;
  g.fillStyle = C.dark ? 'rgba(255, 238, 214, 0.95)' : 'rgba(120, 40, 10, 0.9)';
  g.beginPath();
  for (const k of lit) { g.moveTo(posX[k] + cr, posY[k]); g.arc(posX[k], posY[k], cr, 0, 6.2832); }
  g.fill();
}
const FAN_BINS = 240;
let fanCol = null;
function fanRgb() {
  if (!fanCol || fanCol.dark !== C.dark) fanCol = { dark: C.dark, rgb: SC.rgbOf(C.gold) };
  return fanCol.rgb;
}
const fanCount = new Float32Array(FAN_BINS), fanDist = new Float32Array(FAN_BINS);
function drawFan(g, ex, ey, i0, i1, sc, cx, cy) {
  fanCount.fill(0); fanDist.fill(0);
  for (let k = i0; k < i1; k++) {
    const dx = cx + flat[k][1] * sc - ex, dy = cy - flat[k][2] * sc - ey;
    const a = Math.atan2(dy, dx), bi = Math.floor((a + Math.PI) / (2 * Math.PI) * FAN_BINS) % FAN_BINS;
    fanCount[bi]++; fanDist[bi] = Math.max(fanDist[bi], Math.hypot(dx, dy));
  }
  let mx = 0, md = 0;
  for (let b = 0; b < FAN_BINS; b++) { mx = Math.max(mx, fanCount[b]); md = Math.max(md, fanDist[b]); }
  if (!mx) return;
  const gr = g.createRadialGradient(ex, ey, 0, ex, ey, md), [fr, fg, fb] = fanRgb();
  gr.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, ${C.dark ? 0.42 : 0.3})`);
  gr.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 0)`);
  g.fillStyle = gr;
  const w = 2 * Math.PI / FAN_BINS;
  for (let b = 0; b < FAN_BINS; b++) {
    if (!fanCount[b]) continue;
    const a0 = -Math.PI + b * w;
    g.globalAlpha = 0.03 + 0.5 * Math.sqrt(fanCount[b] / mx);
    g.beginPath(); g.moveTo(ex, ey); g.arc(ex, ey, fanDist[b], a0, a0 + w); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
}
const ALWAYS_LABEL = new Set(['Earth', 'Mars', 'Jupiter', 'Saturn']);
let hudBox = { key: '', r: [] };
function hudRects(s) {
  const key = `${s.w}x${s.h}`;
  if (hudBox.key === key) return hudBox.r;
  const hud = document.querySelector('#astRoot .hud');
  if (!hud) return [];
  const cr = $('#map').getBoundingClientRect();
  const r = [...hud.querySelectorAll('.btn, .pill-host > *')].filter((e) => !e.closest('.pop') && e.getClientRects().length).map((e) => {
    const b = e.getBoundingClientRect();
    return [b.left - cr.left - 4, b.top - cr.top - 4, b.right - cr.left + 4, b.bottom - cr.top + 4];
  });
  hudBox = { key: cr.width ? key : '', r };
  return r;
}
function safeRects(s) {
  const z = zoomRect(s), out = hudRects(s).slice();
  if (z) out.push([z.left - 4, z.top - 4, z.right + 4, z.bottom + 4]);
  return out;
}
function planetLabels(g, s, discs) {
  const placed = [...safeRects(s), ...plateBoxes, ...labelBoxes];
  const hit = (b) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) || discs.some(([x, y, r]) => b[0] < x + r && b[2] > x - r && b[1] < y + r && b[3] > y - r);
  g.font = font(12.5, 500);
  const crowd = state.viewR > 2.4;
  for (const [x, y, r, p] of discs) {
    if (!p) continue;
    if (crowd && !ALWAYS_LABEL.has(p) && state.planetHover !== p) continue;
    const w = g.measureText(p).width, gap = r + (p === 'Saturn' ? 10 : 4);
    const cands = [[x + gap, y - 7, 'left', 0], [x - gap - w, y - 7, 'left', 0], [x - w / 2, y - r - 18, 'left', 0], [x - w / 2, y + r + 4, 'left', 0], [x + gap + 14, y - 26, 'left', 1], [x - gap - w - 14, y - 26, 'left', 1], [x + gap + 14, y + 14, 'left', 1]];
    let pick = null;
    for (const c of cands) { const b = [c[0] - 2, c[1] - 2, c[0] + w + 2, c[1] + 16]; if (b[0] < 2 || b[2] > s.w - 2 || b[1] < 2 || b[3] > s.h - 2) continue; if (!hit(b)) { pick = c; placed.push(b); break; } }
    if (!pick) continue;
    if (pick[3]) {
      g.strokeStyle = C.ink3; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + Math.sign(pick[0] - x) * (r + 1), y); g.lineTo(pick[0] < x ? pick[0] + w : pick[0], pick[1] + 8); g.stroke();
    }
    text(g, p, pick[0], pick[1] + 11, { size: 12.5, weight: p === 'Earth' ? 600 : 500, color: p === 'Earth' ? C.ink : C.ink2, halo: true });
    labelBoxes.push(placed[placed.length - 1]);
  }
}
const WRAP_MS = 1600;
let wrapAt = 0, wrapAlpha = 1, wrapCv = null;
function wrapLayer(s) {
  const w = Math.round(s.w * s.dpr), h = Math.round(s.h * s.dpr);
  if (!wrapCv || wrapCv.width !== w || wrapCv.height !== h) { wrapCv = document.createElement('canvas'); wrapCv.width = w; wrapCv.height = h; }
  const g = wrapCv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  return g;
}
function endWrap() { wrapAt = 0; wrapAlpha = 1; wrapCv = null; state.tween = null; }
let wrapDone = false, loopOf = null;
function playLoop() {
  if (!loopOf || loopOf.nights !== R.nights || loopOf.tmax !== META.tmax) {
    const days = R.nights.map((n) => nightMjd(n[0]));
    loopOf = { nights: R.nights, tmax: META.tmax, ...dataLoop(days.length ? days : [META.tmax], cadenceGaps()) };
    loopOf.end = Math.max(loopOf.end, Math.floor(META.tmax) + 1);
  }
  return loopOf;
}
const TRAIL = { days: 3, seg: 3, selDays: 30, selSeg: 12, selBins: 3, max: 160, minPx: 2.5 };
const trailXY = new Float32Array(2 * (TRAIL.selSeg + 1));
function trailOf(o, days, seg, sc, cx, cy) {
  let E = 0, Mprev = 0;
  for (let i = 0; i <= seg; i++) {
    const M = o.M0 + o.n * (state.t - days * i / seg - o.ep);
    if (i === 0) {
      let m = M % (2 * Math.PI);
      if (m < 0) m += 2 * Math.PI;
      E = solveE(m, o.e) + (M - m);
    } else {
      E += (M - Mprev) / (1 - o.e * Math.cos(E));
      for (let it = 0; it < 2; it++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
    }
    Mprev = M;
    const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
    trailXY[2 * i] = cx + (xp * o.Px + yp * o.Qx) * sc;
    trailXY[2 * i + 1] = cy - (xp * o.Py + yp * o.Qy) * sc;
  }
}
const trailPaths = [];
function drawTrails(g, s, sc, cx, cy) {
  const { seg } = TRAIL, n = Math.min(rank.length, glowBudget(), TRAIL.max), sel = state.sel ? state.sel.idx : -1;
  for (let ci = 0; ci < CLASS_ORDER.length * seg; ci++) { if (trailPaths[ci]) trailPaths[ci].length = 0; else trailPaths[ci] = []; }
  let any = false;
  for (let q = 0; q < n; q++) {
    const k = rank[q];
    if (k === sel || W.w[k] < 0.5) continue;
    if (posX[k] < -20 || posY[k] < -20 || posX[k] > s.w + 20 || posY[k] > s.h + 20) continue;
    const o = O[k];
    if (o.n * o.a * TRAIL.days * sc * Math.sqrt((1 + o.e) / Math.max(0.05, 1 - o.e)) < TRAIL.minPx) continue;
    trailOf(o, TRAIL.days, seg, sc, cx, cy);
    const base = clsIdx[k] * seg;
    for (let j = 0; j < seg; j++) trailPaths[base + j].push(trailXY[2 * j], trailXY[2 * j + 1], trailXY[2 * j + 2], trailXY[2 * j + 3]);
    any = true;
  }
  g.lineWidth = 1.5; g.lineCap = 'round';
  if (any) {
    for (let ci = 0; ci < CLASS_ORDER.length; ci++) {
      if (!trailPaths[ci * seg].length) continue;
      g.strokeStyle = C.cls[CLASS_ORDER[ci]];
      for (let j = 0; j < seg; j++) {
        const a = trailPaths[ci * seg + j];
        if (!a.length) continue;
        g.globalAlpha = 0.5 * (1 - (j + 0.5) / seg);
        g.beginPath();
        for (let i = 0; i < a.length; i += 4) { g.moveTo(a[i], a[i + 1]); g.lineTo(a[i + 2], a[i + 3]); }
        g.stroke();
      }
    }
  }
  if (sel >= 0) {
    trailOf(O[sel], TRAIL.selDays, TRAIL.selSeg, sc, cx, cy);
    g.strokeStyle = C.hi; g.lineWidth = 3;
    const per = TRAIL.selSeg / TRAIL.selBins;
    for (let b = 0; b < TRAIL.selBins; b++) {
      g.globalAlpha = 0.6 * (1 - (b + 0.5) / TRAIL.selBins);
      g.beginPath(); g.moveTo(trailXY[2 * b * per], trailXY[2 * b * per + 1]);
      for (let j = b * per + 1; j <= (b + 1) * per; j++) g.lineTo(trailXY[2 * j], trailXY[2 * j + 1]);
      g.stroke();
    }
  }
  g.globalAlpha = 1; g.lineCap = 'butt';
}
const pings = [], pingAt = new Map();
const PING_MAX = 60;
function addPings(tA, tB, now) {
  if (!state.playing || reduceMotion || !(tB > tA) || tB - tA > 2) return;
  const i0 = lowerBound(flatT, tA), i1 = lowerBound(flatT, tB), nGlow = glowBudget(), sel = state.sel ? state.sel.idx : -1, front = showcaseOn();
  for (let i = i0; i < i1 && pings.length < PING_MAX; i++) {
    const k = flat[i][3];
    if (k !== sel && (front ? W.w[k] < 0.5 || rankPosA[k] >= nGlow : !inFilter(O[k]))) continue;
    const last = pingAt.get(k);
    if (last != null && now - last < DUR.travel) continue;
    pingAt.set(k, now);
    pings.push({ k, born: now });
  }
}
function clearPings() { pings.length = 0; pingAt.clear(); }
function drawPings(g, now) {
  if (!pings.length) return;
  g.strokeStyle = C.gold; g.lineWidth = 1.2;
  let w = 0;
  for (const p of pings) {
    const f = (now - p.born) / DUR.travel;
    if (f >= 1) continue;
    pings[w++] = p;
    const e = ease.out(f);
    g.globalAlpha = 0.85 * (1 - f);
    g.beginPath(); g.arc(posX[p.k], posY[p.k], 3 + 13 * e, 0, 6.2832); g.stroke();
  }
  pings.length = w;
  g.globalAlpha = 1;
}
const zoomFx = { job: null, from: 1, to: 1, e: 0, wheelAt: -1e9, timer: 0 };
const zoomMoving = () => !!zoomFx.job || performance.now() - zoomFx.wheelAt < DUR.base;
function drawMap(s) {
  if (!s.w) return;
  const t0 = performance.now();
  labelBoxes = [];
  buildPlate(s);
  if (!zoomMoving() || !staticLayer) buildStatic(s);
  const sc = mapScale(s), cx = s.w / 2, cy = mapCy(s);
  s.ctx.clearRect(0, 0, s.w, s.h);
  s.ctx.drawImage(plateLayer, 0, 0, s.w, s.h);
  const f = staticR / state.viewR;
  if (Math.abs(f - 1) > 1e-4) { s.ctx.save(); s.ctx.translate(cx, cy); s.ctx.scale(f, f); s.ctx.translate(-cx, -cy); s.ctx.drawImage(staticLayer, 0, 0, s.w, s.h); s.ctx.restore(); }
  else s.ctx.drawImage(staticLayer, 0, 0, s.w, s.h);
  const g = wrapAlpha < 1 ? wrapLayer(s) : s.ctx;
  const tmp = [0, 0];
  for (let k = 0; k < N; k++) { posAt(O[k], state.t, tmp); posX[k] = cx + tmp[0] * sc; posY[k] = cy - tmp[1] * sc; }
  for (const p in PLANETS) planetNow[p] = planetAt(p, state.t);
  const E = planetNow.Earth;
  const ex = cx + E[0] * sc, ey = cy - E[1] * sc;
  ladderGeo.sc = sc; ladderGeo.ex = ex; ladderGeo.ey = ey; ladderGeo.ok = true;
  pingLadder();

  const win = 2;
  const i0 = lowerBound(flatT, state.t - win), i1 = lowerBound(flatT, state.t + win);
  const lit = litSet;
  lit.clear();
  if (i1 > i0) {
    for (let k = i0; k < i1; k++) lit.add(flat[k][3]);
    drawFan(g, ex, ey, i0, i1, sc, cx, cy);
  }

  const filtered = !!state.filter;
  runLod(s);
  const moving = SC.stepWeights(W, performance.now());
  if (moving && !state.playing && !weightRaf) weightRaf = requestAnimationFrame(() => { weightRaf = 0; mapS.draw(mapS); });
  if (showcaseOn()) {
    drawHaze(g, s);
    drawArcs(g, sc, cx, cy);
    if (state.playing && !reduceMotion) drawTrails(g, s, sc, cx, cy);
    drawFront(g, sc);
  } else for (const c of CLASS_ORDER) {
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
  if (lit.size && showcaseOn()) {
    const front = new Set(), back = [];
    const nGlow = glowBudget();
    for (const k of lit) (W.w[k] >= 0.5 && rankPosA[k] < nGlow ? front.add(k) : back.push(k));
    g.fillStyle = C.dark ? 'rgba(255, 238, 214, 1)' : 'rgba(120, 40, 10, 1)'; g.globalAlpha = C.dark ? 0.45 : 0.35;
    g.beginPath();
    for (const k of back) { g.moveTo(posX[k] + 1.1, posY[k]); g.arc(posX[k], posY[k], 1.1, 0, 6.2832); }
    g.fill(); g.globalAlpha = 1;
    if (front.size) drawLit(g, front, sc);
  } else if (lit.size) drawLit(g, lit, sc);
  drawPings(g, performance.now());

  const sunR = Math.round(clamp(sc * 0.04, 3.5, 7.5) * 2) / 2, pf = clamp(sc / 100, 0.7, 1);
  drawSprite(g, 'Sun', cx, cy, sunR);
  const discs = [[cx, cy, sunR + 2]];
  for (const p in PLANETS) {
    const P = planetNow[p];
    const x = cx + P[0] * sc, y = cy - P[1] * sc;
    if (x < -30 || y < -30 || x > s.w + 30 || y > s.h + 30) continue;
    const pr = Math.round(PLANET_R[p] * pf * 2) / 2;
    drawSprite(g, p, x, y, pr);
    discs.push([x, y, pr + 2, p]);
  }
  fadeOutside(g, s);
  if (g !== s.ctx) fadeOutside(s.ctx, s);
  const [bx, by, bx1] = scaleBar(g, s, sc);
  g.font = font(11);
  const eqW = plateEq ? g.measureText(plateEq[0]).width : 0;
  if (plateEq && plateEq[3] !== 'right') { text(g, plateEq[0], plateEq[1], plateEq[2], { size: 11, color: C.ink3, align: 'left', halo: true }); labelBoxes.push([plateEq[1], plateEq[2] - 10, plateEq[1] + eqW, plateEq[2] + 3]); }
  else if (plateEq) {
    if (bx - 14 - eqW >= 4) { text(g, plateEq[0], bx - 14, by + 4, { size: 11, color: C.ink3, align: 'right', halo: true }); labelBoxes.push([bx - 14 - eqW, by - 6, bx - 14, by + 7]); }
    else if (bx1 - eqW >= 4) { text(g, plateEq[0], bx1, by - 24, { size: 11, color: C.ink3, align: 'right', halo: true }); labelBoxes.push([bx1 - eqW, by - 34, bx1, by - 21]); }
  }
  let selLab = null;
  if (state.sel) {
    const k = state.sel.idx, x = posX[k], y = posY[k];
    const dx = (x - cx) / sc - E[0], dy = -(y - cy) / sc - E[1];
    const sub = `${Math.hypot(dx, dy).toFixed(2)} AU from Earth, in-plane`;
    g.font = font(19 * 0.7, 600);
    const nw = g.measureText(state.sel.name).width;
    g.font = font(11.5);
    const lw = Math.max(nw, g.measureText(sub).width), avoid = [...safeRects(s), ...plateBoxes, ...labelBoxes, ...discs.slice(1).map(([px, py, pr]) => [px - pr, py - pr, px + pr, py + pr])];
    const r0 = x <= s.w * 0.7, a0 = y >= 60, opts = [[r0, a0], [!r0, a0], [r0, !a0], [!r0, !a0]];
    const boxOf = ([r, a]) => { const lx0 = x + (r ? 48 : -48 - lw), ly0 = a ? y - 30 : y + 40; return [lx0, ly0 - 14, lx0 + lw, ly0 + 19]; };
    const ok = (b) => b[0] >= 2 && b[2] <= s.w - 2 && b[1] >= 2 && b[3] <= s.h - 2 && !hits(b, avoid);
    const [right, above] = opts.find((o) => ok(boxOf(o))) || opts[0];
    labelBoxes.push(boxOf([right, above]));
    selLab = { x, y, sub, right, lx: x + (right ? 44 : -44), ly: above ? y - 30 : y + 40 };
  }
  planetLabels(g, s, discs);

  if (selLab) {
    const { x, y, sub, right, lx, ly } = selLab;
    g.strokeStyle = C.hi; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
    g.setLineDash([3, 4]); g.lineWidth = 1; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(ex, ey); g.lineTo(x, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + (right ? 7 : -7), y + (ly > y ? 5 : -5)); g.lineTo(lx, ly + (ly > y ? -10 : 4)); g.stroke();
    annotate(g, state.sel.name, lx + (right ? 4 : -4), ly, { size: 19, color: C.ink, align: right ? 'left' : 'right' });
    text(g, sub, lx + (right ? 4 : -4), ly + 15, { size: 11.5, color: C.ink2, align: right ? 'left' : 'right', halo: true });
  }
  if (state.hover && state.hover !== state.sel) {
    const k = state.hover.idx;
    g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(posX[k], posY[k], 6, 0, 7); g.stroke();
  }
  if (g !== s.ctx) { s.ctx.globalAlpha = wrapAlpha; s.ctx.drawImage(g.canvas, 0, 0, s.w, s.h); s.ctx.globalAlpha = 1; }

  const inData = state.t >= META.tmin - 1 && state.t <= META.tmax + 1;
  if (s.w >= 600) {
    text(s.ctx, i1 > i0 ? `${fmtN(i1 - i0)} detections within ±${win} days` : inData ? 'no detections in this sample within ±2 days' : 'outside the data window: positions are extrapolated',
      16, s.h - 12, { size: 'micro', color: C.ink2, halo: true });
  }
  perf.draw.push(performance.now() - t0);
  if (perf.draw.length > 600) perf.draw.shift();
  heroTick();
}


function syncTime() {
  dock.update(true);
  cadS.draw(cadS);
}
function setTime(t) { stopGlide(); endWrap(); state.t = clamp(t, T0, T1); syncTime(); mapS.draw(mapS); }
const glide = { job: null, to: 0 };
function stopGlide() { if (glide.job) { glide.job.cancel(); glide.job = null; } }
function glideTo(t) {
  const to = clamp(Math.floor(t) + 0.5, T0, T1);
  if (state.playing || reduceMotion) { setTime(to); return; }
  stopGlide(); endWrap();
  glide.to = to;
  const job = tween({ from: state.t, to, dur: DUR.base, curve: 'out', step: (v) => { state.t = v; mapS.draw(mapS); dock.update(); }, done: () => { glide.job = null; syncTime(); } });
  glide.job = job.running ? job : null;
}
function cadenceGaps() {
  const ts = R.nights.map((n) => nightMjd(n[0])).sort((a, b) => a - b), out = [];
  for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 20) out.push([ts[k - 1] + 1, ts[k]]);
  return out;
}
const dock = makeDock('asteroids', {
  t0: () => T0, t1: () => T1, end: () => Math.floor(META.tmax) + 0.5, get: () => state.t, set: setTime,
  playing: () => state.playing, play: (p) => setPlaying(p),
  speeds: [1, 5, 15, 60, 200], speed: () => state.speed, setSpeed: (v) => { state.speed = v; }, speedText: fmtSpeed('day', 'days'),
  unit: 1, big: 7, snap: (t) => Math.floor(t) + 0.5, fmt: fmtDate,
  step: (dir, big) => glideTo((glide.job ? glide.to : state.t) + dir * (big ? 7 : 1)),
  valueText: (t) => `${fmtDate(t)}${t < META.tmin - 1 || t > META.tmax + 1 ? ', outside the data window: positions are extrapolated' : ''}`,
  tip: (t) => {
    if (t < T0 || t > T1) return '';
    const day = Math.floor(t), n = R.nights.find((x) => Math.floor(nightMjd(x[0])) === day), dn = nightDet.get(day) || 0;
    const out = t < META.tmin - 1 || t > META.tmax + 1;
    return `<b>${fmtDate(day)}</b><br>${n ? `${fmtN(n[1])} Rubin alerts, ${fmtN(n[2])} matched to known Solar System objects` : out ? 'outside the data window: positions are extrapolated' : 'no Fink statistics for this night'}${dn ? `<br>${dn} detections in this sample` : ''}`;
  },
  paint: {
    domain: () => [T0, T1], solid: () => [META.tmin, META.tmax + 1], outBefore: 'extrapolated', outAfter: 'extrapolated',
    bars: () => R.nights.map(([n, a]) => [nightMjd(n), a]), scale: 'log',
    marks: () => [...(nightDetF || nightDet)].map(([t, v]) => [t, v]), gaps: cadenceGaps, ticks: 'month',
    sel: () => (state.sel ? state.sel.det.map((d) => Math.floor(d[0] + MJD_OFF)) : null),
    key: () => `${R.nights.length}|${META.tmin}|${META.tmax}|${nightDet.size}|${nVis}|${state.preset}|${state.dLo}|${state.dHi}`,
  },
});

let lastTs = 0, raf = 0;
function frame(ts) {
  raf = 0;
  if (!state.playing) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  if (lastTs) perf.frame.push(ts - lastTs);
  if (perf.frame.length > 600) perf.frame.shift();
  lastTs = ts;
  if (wrapAt) {
    const p = Math.min(1, (ts - wrapAt) / WRAP_MS), q = p < 0.5 ? 1 - p * 2 : p * 2 - 1;
    if (p >= 0.5 && !wrapDone) { wrapDone = true; state.t = playLoop().from; dock.note(LOOP_NOTE); }
    wrapAlpha = q * q * (3 - 2 * q);
    if (p >= 1) endWrap();
  } else if (state.tween) {
    const p = Math.min(1, (ts - state.tween.t0) / state.tween.ms);
    state.t = state.tween.from + (state.tween.to - state.tween.from) * p * p * (3 - 2 * p);
    if (p >= 1) state.tween = null;
  } else {
    const L = playLoop(), next = state.t + dt * state.speed, gp = L.gap(next);
    if (!gp && !(state.t < L.end && next >= L.end) && next <= T1) addPings(state.t, next, performance.now());
    if (gp) state.tween = { from: state.t, to: gp[1] + 0.01, t0: ts, ms: 600 };
    else if (state.t < L.end && next >= L.end) { state.t = L.end - 1e-3; wrapAt = ts; wrapDone = false; }
    else state.t = next;
    if (state.t > T1) { state.t = T1; wrapAt = ts; wrapDone = false; }
  }
  drawMap(mapS);
  dock.update();
  if (++frameCount % 15 === 0) cadS.draw(cadS);
  raf = requestAnimationFrame(frame);
}
let frameCount = 0;
function setPlaying(p) {
  state.playing = p;
  if (p) stopGlide();
  clearPings();
  if (!p) endWrap();
  lastTs = 0;
  if (p && !raf) raf = requestAnimationFrame(frame);
  if (!p && mapS.w) mapS.draw(mapS);
  dock.sync();
}
let wasPlaying = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { wasPlaying = state.playing; setPlaying(false); } else if (wasPlaying) setPlaying(true);
});

document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => flyZoom(+b.dataset.zoom)));
function markZoom(r) {
  document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.zoom - r) < 0.01));
}
function stopFlight() { if (zoomFx.job) { zoomFx.job.cancel(); zoomFx.job = null; } }
function setZoom(r) {
  stopFlight();
  state.viewR = clamp(r, 0.6, 11);
  markZoom(state.viewR);
  mapS.draw(mapS);
}
function gestureZoom(r) {
  zoomFx.wheelAt = performance.now();
  clearTimeout(zoomFx.timer);
  zoomFx.timer = setTimeout(() => { if (!state.playing) mapS.draw(mapS); }, DUR.base + 20);
  setZoom(r);
}
function flyZoom(r) {
  const to = clamp(r, 0.6, 11), from = state.viewR;
  if (reduceMotion || !mapS.w || Math.abs(Math.log(to / from)) < 0.01) { setZoom(to); return; }
  stopFlight();
  markZoom(to);
  Object.assign(zoomFx, { from, to, e: 0 });
  const job = tween({
    from: 0, to: 1, dur: flightMs(Math.abs(Math.log2(to / from))), curve: 'io',
    step: (v) => { zoomFx.e = v; state.viewR = Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * v); if (!state.playing) mapS.draw(mapS); },
    done: () => { zoomFx.job = null; state.viewR = to; if (!state.playing) mapS.draw(mapS); },
  });
  zoomFx.job = job.running ? job : null;
}
$('#map').addEventListener('wheel', (e) => { e.preventDefault(); gestureZoom(state.viewR * Math.exp(e.deltaY * 0.0015)); }, { passive: false });
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
    if (pinch0 > 0) gestureZoom(pinchR * pinch0 / d);
    return;
  }
  if (e.pointerType !== 'mouse') return;
  const ph = pickPlanet(e);
  if (ph !== state.planetHover) { state.planetHover = ph; mapS.draw(mapS); }
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
$('#map').addEventListener('pointerleave', () => { setHover(null); hideTip(); if (state.planetHover) { state.planetHover = null; mapS.draw(mapS); } });
function pickPlanet(e) {
  const r = $('#map').getBoundingClientRect(), s = mapS, sc = mapScale(s), x = e.clientX - r.left, y = e.clientY - r.top;
  for (const p in PLANETS) { const P = planetNow[p]; if (P && Math.hypot(s.w / 2 + P[0] * sc - x, mapCy(s) - P[1] * sc - y) < PLANET_R[p] + 6) return p; }
  return null;
}
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
  g.fillStyle = C.gold; g.globalAlpha = 0.3;
  for (let k = 0; k < nb; k++) {
    if (!hist[k]) continue;
    const x = f.X(1.4 + k * bw), w = Math.max(1, f.X(1.4 + (k + 1) * bw) - x - 0.6);
    const hgt = Math.sqrt(hist[k] / hmax) * (hB - hT);
    g.fillRect(x, hB - hgt, w, hgt);
  }  g.globalAlpha = 1;

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
    annotate(g, 'near-Earth: q < 1.3 AU', f.X(1.45), f.Y(0.57), { size: 17, color: C.cls.NEO, align: 'left' });
    annotate(g, 'Mars-crossers', f.X(2.55), f.Y(0.385), { size: 17, color: C.cls.MC, align: 'left' });
  }
  const lab = (str, a, v) => annotate(g, str, f.X(a), f.Y(v), { size: s.w < 500 ? 16 : 18, color: C.ink2 });
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
      g.globalAlpha = pass === 0 ? 0.14 : (c === 'MBA' ? 0.6 : 1);
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
    g.fillStyle = C.bar; g.globalAlpha = 0.45; g.fillRect(x, Yl(a), w, topB - Yl(a)); g.globalAlpha = 1;
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
      g.font = font(11);
      if (x1 - x0 > g.measureText(lbl).width + 12) text(g, lbl, (x0 + x1) / 2, topB - 14, { size: 11, color: C.ink2, align: 'center', halo: true });
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

const LIGHT_S_PER_AU = 499.005;
function earthDist(o, mjd) {
  const p = posAt(o, mjd, [0, 0]), E = planetAt('Earth', mjd);
  return Math.hypot(p[0] - E[0], p[1] - E[1]);
}
function lightWords(au) {
  const s = au * LIGHT_S_PER_AU;
  return s < 90 ? `${Math.round(s)} light-seconds` : s < 5400 ? `${(s / 60).toFixed(s < 600 ? 1 : 0)} light-minutes` : `${(s / 3600).toFixed(1)} light-hours`;
}
function ladLine(o) {
  const d = earthDist(o, state.t), inData = state.t >= META.tmin - 1 && state.t <= META.tmax + 1;
  return `<b>${d.toFixed(2)} AU</b> from Earth on ${fmtShort(state.t)}, ${lightWords(d)} · ${inData ? 'orbit fitted to Rubin detections, in the ecliptic plane' : 'extrapolated along the fitted orbit'}`;
}
function detRuns(o) {
  const ts = o.det.map((d) => d[0] + MJD_OFF).sort((a, b) => a - b), runs = [];
  for (const t of ts) { const r = runs[runs.length - 1]; if (r && t - r[1] < 20) r[1] = t; else runs.push([t, t]); }
  return runs;
}
const hero = { s: null, o: null, base: null, key: '', col: null, fit: null, lastT: -1, lastAt: 0 };
function heroFit(s, o) {
  const tmp = [0, 0];
  let x0 = -1.02, x1 = 1.02, y0 = -1.02, y1 = 1.02;
  for (let k = 0; k < 96; k++) {
    const E = k / 96 * 2 * Math.PI, xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
    tmp[0] = xp * o.Px + yp * o.Qx; tmp[1] = xp * o.Py + yp * o.Qy;
    x0 = Math.min(x0, tmp[0]); x1 = Math.max(x1, tmp[0]); y0 = Math.min(y0, tmp[1]); y1 = Math.max(y1, tmp[1]);
  }
  const padX = 18, padT = 26, padB = 14;
  const sc = Math.min((s.w - 2 * padX) / (x1 - x0), (s.h - padT - padB) / (y1 - y0));
  const cx = s.w / 2 - (x0 + x1) / 2 * sc, cy = padT + (s.h - padT - padB) / 2 + (y0 + y1) / 2 * sc;
  return { sc, cx, cy, X: (x) => cx + x * sc, Y: (y) => cy - y * sc };
}
function heroBase(s, o) {
  const key = [s.w, s.h, s.dpr, o.idx, C.dark, dataVer].join('|');
  if (key === hero.key && hero.base) return;
  hero.key = key;
  hero.col = { hi: C.hi, gold: C.gold, porbit: C.porbit, ink: C.ink, ink2: C.ink2, ink3: C.ink3, bg: C.bg, earth: PLANET_LOOK.Earth[0], sun: '#f6d98b' };
  const f = hero.fit = heroFit(s, o), c = hero.col;
  const cv = hero.base || document.createElement('canvas');
  cv.width = Math.round(s.w * s.dpr); cv.height = Math.round(s.h * s.dpr);
  const g = cv.getContext('2d');
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); g.clearRect(0, 0, s.w, s.h);
  g.lineWidth = 0.8; g.strokeStyle = c.porbit;
  for (const p of ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter']) {
    const a = PLANETS[p][0];
    if (a * f.sc < 6 || (p !== 'Earth' && a > Math.max(o.Q, 1) * 1.25)) continue;
    g.globalAlpha = p === 'Earth' ? 0.9 : 0.5;
    g.beginPath(); g.arc(f.cx, f.cy, a * f.sc, 0, 6.2832); g.stroke();
  }
  g.globalAlpha = 1;
  const tmp = [0, 0];
  g.strokeStyle = c.hi; g.lineWidth = 1.4; g.beginPath();
  for (let k = 0; k <= 240; k++) {
    const E = k / 240 * 2 * Math.PI, xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E);
    tmp[0] = xp * o.Px + yp * o.Qx; tmp[1] = xp * o.Py + yp * o.Qy;
    if (k) g.lineTo(f.X(tmp[0]), f.Y(tmp[1])); else g.moveTo(f.X(tmp[0]), f.Y(tmp[1]));
  }
  g.stroke();
  g.strokeStyle = c.gold; g.lineWidth = 4.5; g.lineCap = 'round'; g.globalAlpha = 0.55;
  for (const [t0, t1] of detRuns(o)) {
    g.beginPath();
    const n = Math.max(2, Math.ceil((t1 - t0) / 2));
    for (let k = 0; k <= n; k++) { posAt(o, t0 + (t1 - t0) * k / n, tmp); if (k) g.lineTo(f.X(tmp[0]), f.Y(tmp[1])); else g.moveTo(f.X(tmp[0]), f.Y(tmp[1])); }
    if (t1 - t0 < 1) { posAt(o, t0, tmp); g.lineTo(f.X(tmp[0]) + 0.1, f.Y(tmp[1])); }
    g.stroke();
  }
  g.globalAlpha = 1; g.lineCap = 'butt'; g.fillStyle = c.gold;
  for (const d of o.det) if (d[6] !== null) { g.beginPath(); g.arc(f.X(d[6]), f.Y(d[7]), 1.6, 0, 6.2832); g.fill(); }
  const sunR = 3.5;
  g.fillStyle = c.sun; g.beginPath(); g.arc(f.cx, f.cy, sunR, 0, 6.2832); g.fill();
  const apse = (E, lbl) => {
    const xp = o.a * (Math.cos(E) - o.e), yp = o.b * Math.sin(E), x = f.X(xp * o.Px + yp * o.Qx), y = f.Y(xp * o.Py + yp * o.Qy);
    const dx = x - f.cx, dy = y - f.cy, m = Math.hypot(dx, dy) || 1;
    g.strokeStyle = c.hi; g.lineWidth = 1; g.beginPath(); g.moveTo(x - dx / m * 4, y - dy / m * 4); g.lineTo(x + dx / m * 4, y + dy / m * 4); g.stroke();
    g.font = font(11);
    const w = g.measureText(lbl).width, ux = dx / m, uy = dy / m;
    const lx = clamp(x + ux * 10 + (ux > 0.3 ? 0 : ux < -0.3 ? -w : -w / 2), 3, s.w - w - 3), ly = clamp(y + uy * 12 + 4, 26, s.h - 4);
    text(g, lbl, lx, ly, { size: 11, color: c.ink2, halo: true });
  };
  if (o.e > 0.02) { apse(0, `q ${o.q.toFixed(2)} AU`); apse(Math.PI, `Q ${o.Q.toFixed(2)} AU`); }
  hero.base = cv;
}
function drawHero(s) {
  const o = hero.o;
  if (!s.w || !o) return;
  heroBase(s, o);
  const g = s.ctx, f = hero.fit, c = hero.col;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(hero.base, 0, 0, s.w, s.h);
  const p = posAt(o, state.t, [0, 0]), q = posAt(o, state.t + 3, [0, 0]), E = planetAt('Earth', state.t);
  const ax = f.X(p[0]), ay = f.Y(p[1]), ex = f.X(E[0]), ey = f.Y(E[1]);
  g.strokeStyle = c.ink2; g.lineWidth = 1; g.setLineDash([3, 3]); g.globalAlpha = 0.8;
  g.beginPath(); g.moveTo(ex, ey); g.lineTo(ax, ay); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  g.fillStyle = c.earth; g.strokeStyle = c.ink; g.lineWidth = 0.8; g.beginPath(); g.arc(ex, ey, 3.5, 0, 6.2832); g.fill(); g.stroke();
  const vx = f.X(q[0]) - ax, vy = f.Y(q[1]) - ay, vm = Math.hypot(vx, vy);
  if (vm > 0.01) {
    const ux = vx / vm, uy = vy / vm, bx = ax + ux * 11, by = ay + uy * 11;
    g.fillStyle = c.hi; g.beginPath(); g.moveTo(bx + ux * 5, by + uy * 5); g.lineTo(bx - uy * 3.2, by + ux * 3.2); g.lineTo(bx + uy * 3.2, by - ux * 3.2); g.closePath(); g.fill();
  }
  g.fillStyle = c.hi; g.beginPath(); g.arc(ax, ay, 4, 0, 6.2832); g.fill();
  g.strokeStyle = c.bg; g.lineWidth = 1.2; g.stroke();
  const d = Math.hypot(p[0] - E[0], p[1] - E[1]), mx = (ax + ex) / 2, my = (ay + ey) / 2;
  if (Math.hypot(ax - ex, ay - ey) > 46) text(g, `${d.toFixed(2)} AU`, mx + 6, my - 4, { size: 11, weight: 600, color: c.ink, halo: true });
  text(g, 'Earth', ex + 6, ey + 12, { size: 11, color: c.ink2, halo: true });
  const inData = state.t >= META.tmin - 1 && state.t <= META.tmax + 1;
  text(g, fmtDate(state.t), 4, 13, { size: 12, weight: 600, color: c.ink, halo: true });
  if (!inData) text(g, 'position extrapolated', s.w - 4, 13, { size: 11, color: c.ink3, align: 'right', halo: true });
}
function heroTick() {
  if (!hero.s || !hero.o || hero.o !== state.sel || state.t === hero.lastT) return;
  const now = performance.now();
  if (state.playing && now - hero.lastAt < 66) return;
  hero.lastT = state.t; hero.lastAt = now;
  drawHero(hero.s);
  const l = $('#cardBody [data-ladline]');
  if (l) l.innerHTML = ladLine(hero.o);
}

let cardPlots = [];
const renderCard = onCard(renderCardInner);
function renderCardInner() {
  const card = $('#cardBody');
  cardPlots = [];
  const o = state.sel;
  if (!o) {
    hero.s = null; hero.o = null;
    const c = META.classes;
    const stats = `<dl><div><dt>Asteroids</dt><dd>${fmtN(META.nobj)}</dd></div><div><dt>Detections</dt><dd>${fmtN(META.ndet)}</dd></div><div><dt>Bands</dt><dd>${Object.keys(META.bands).length}</dd></div>
      <div><dt>Main belt</dt><dd>${fmtN(c.MBA || 0)}</dd></div><div><dt>Near-Earth</dt><dd>${c.NEO || 0}</dd></div><div><dt>Trojans</dt><dd>${c.TRO || 0}</dd></div></dl>
      <p class="cap">Detections per band: ${BANDS.filter((b) => META.bands[b]).map((b) => `${b} ${fmtN(META.bands[b])}`).join(' · ')}.</p>`;
    const pickList = O.filter((x) => (state.filter ? state.filter(x) : x.cls !== 'MBA')).sort((p, q) => q.det.length - p.det.length);
    const picks = `<div class="picks">${pickList.slice(0, 48).map((x) => `<button class="btn" type="button" data-pick="${x.idx}"><span class="sw" style="background:${C.cls[x.cls]}"></span>${x.name} <small>${x.det.length}</small></button>`).join('')}</div>`;
    card.innerHTML = showcaseOn() ? `<h3 class="ph">Asteroids worth a look</h3>
      <p class="cap">Chosen from ${fmtN(N)} by orbit, close passes, size and class. Tap one, or any dot on the map, to open its card.</p>
      <ul class="hooks">${topList().map((x) => `<li><button type="button" data-pick="${x.idx}"><span class="sw" style="background:${C.cls[x.cls]}"></span><b>${esc(x.name)}</b>${SC.chipsHtml(chipsFor(x).slice(0, 2))}</button></li>`).join('')}</ul>
      <details class="about ast-more"><summary>Everything outside the main belt (${fmtN(pickList.length)})</summary><p class="cap">${pickList.length > 48 ? 'The 48 most detected, sorted' : 'Sorted'} by number of detections.</p>${picks}</details>
      <h4>This sample</h4>${stats}`
      : `<h3 class="ph">${state.filter ? 'In this view' : 'Pick an asteroid'}</h3>
      <p class="cap">${pickList.length > 48 ? `The 48 most detected of ${fmtN(pickList.length)}` : `${fmtN(pickList.length)} asteroids`}, sorted by number of detections. Tap a name, or any dot on the map, to open its card.</p>${picks}
      <h4>This sample</h4>${stats}`;
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
  const sstr = encodeURIComponent(o.des || o.name);
  const head = cardHead({
    name: o.name, kind: 'Asteroid', sw: C.cls[o.cls], cls: esc(CLASS[o.cls].name), note: esc(CLASS[o.cls].desc), chips: SC.chipsHtml(chipsFor(o)), how: 'measured',
    prov: `orbit fitted to ${o.det.length} Rubin detection${o.det.length === 1 ? '' : 's'} on ${o.nn} night${o.nn === 1 ? '' : 's'}, via Fink, to ${fmtShort(Math.max(...t))}`,
    ladder: ladLine(o),
    links: [{ label: 'JPL SBDB', href: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${sstr}` }, { label: 'MPC', href: `https://minorplanetcenter.net/db_search/show_object?object_id=${sstr}` }],
  });
  card.innerHTML = `
    ${head}
    <canvas class="orbit" aria-label="The orbit of ${esc(o.name)} seen from above the ecliptic, with Earth, the Sun, the stretches where Rubin detected it, and its position on the map's date"></canvas>
    <p class="cap orbit-cap">To scale, seen from above the ecliptic. Thick gold: where on its orbit Rubin detected it. The arrow shows its direction of travel; the dashed line runs to Earth on the map's date.</p>
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
  hero.o = o; hero.lastT = state.t; hero.key = '';
  hero.s = setupCanvas(card.querySelector('canvas.orbit'), onCard(drawHero));
  cardPlots.push(hero.s);
  cardPlots.push(phasePlot(card.querySelector('.pp'), o));
  cardPlots.push(lcPlot(card.querySelector('.lc'), o));
}

function select(o, opts = {}) {
  state.sel = o;
  if (!document.body.dataset.mode || document.body.dataset.mode === 'asteroids') setUrl({ sel: o ? o.name : null });
  staticKey = '';
  if (o) {
    $('#search').value = o.name;
    if (opts.zoom) flyZoom(clamp(o.Q * 1.08, 1.6, 6.5));
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
  dock.update(true);
  cardPlots.forEach((p) => p.draw(p));
}

const PRESETS = [
  { id: 'all', label: 'Whole sample', run: () => { state.pfilter = null; select(null); flyZoom(3.9); } },
  { id: 'cz10', label: 'Follow 2026 CZ10', run: () => {
    state.pfilter = null; const o = byName.get(norm('2026 CZ10'));
    select(o, { zoom: true }); state.t = Math.floor(Math.min(...o.det.map((d) => d[0] + MJD_OFF))) - 10; state.speed = 5; syncTime(); if (!reduceMotion) setPlaying(true);
  } },
  { id: 'hj4', label: '2020 HJ4 close pass', run: () => {
    state.pfilter = null; const o = byName.get(norm('2020 HJ4'));
    select(o); flyZoom(1.8); state.t = dateMjd(2026, 9, 25); state.speed = 1; syncTime(); if (!reduceMotion) setPlaying(true);
  } },
  { id: 'neo', label: 'Near-Earth & Mars-crossers', run: () => { state.pfilter = (o) => o.cls === 'NEO' || o.cls === 'MC'; select(null); flyZoom(3.2); } },
  { id: 'hun', label: 'Hungarias', run: () => { state.pfilter = (o) => o.cls === 'HUN'; select(null); flyZoom(2.4); } },
  { id: 'hil', label: 'Hildas', run: () => { state.pfilter = (o) => o.cls === 'HIL'; select(null); flyZoom(6.2); } },
  { id: 'tro', label: 'Jupiter Trojans', run: () => { state.pfilter = (o) => o.cls === 'TRO'; select(null); flyZoom(6.2); } },
  { id: 'kirk', label: 'Edges of the 3:1 gap', run: () => { state.pfilter = (o) => o.a > 2.4 && o.a < 2.6; select(null); flyZoom(3.2); } },
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
  const clsBtns = (withN) => CLASS_ORDER.filter((c) => counts[c]).map((c) => `<button type="button" class="chip k${state.preset === 'cls-' + c ? ' on' : ''}" data-cls="${c}" title="${CLASS[c].name}: ${CLASS[c].desc}. Click to show only these." aria-pressed="${state.preset === 'cls-' + c}"><span class="sw" style="background:${C.cls[c]}"></span>${CLASS[c].short}${withN ? ' ' + fmtN(counts[c]) : ''}</button>`).join('');
  $('#legend-map').innerHTML = `<span class="ttl">Orbit class (click to filter):</span>` + clsBtns(true) +
    `<span class="k"><span class="sw" style="background:${C.dark ? '#ffe4be' : '#8a3a14'};box-shadow:0 0 6px ${C.dark ? 'rgba(242,168,120,0.9)' : 'rgba(176,70,24,0.6)'}"></span>detected by Rubin within ±2 d</span><span class="k"><span class="sw sq" style="background:${C.gold};opacity:.45"></span>Rubin's lines of sight</span><span class="k"><span class="sw ring" style="border-color:${C.hi}"></span>selected</span>`;
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

function metaText() {
  if (document.body.dataset.mode && document.body.dataset.mode !== 'asteroids') return;
  $('#search').placeholder = `Search ${fmtN(META.nobj)} asteroids, e.g. 2026 CZ10`;
  $('#colnote').textContent = colNote();
  $('#timenote').textContent = `Detections run ${fmtDate(META.tmin)} – ${fmtDate(META.tmax)} (the solid stretch of the time track; outside it the track is hatched). Each orbit is a simple Sun-only ellipse fixed at the asteroid's last detection, so far outside that window the dots are extrapolations. Zoom with the buttons, the mouse wheel or a pinch; Space plays and pauses.`;
  dock.invalidate();
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
    openInstrument('asteroids', 'Stamps');
    if ($('#cutMsg')) $('#cutMsg').textContent = 'Shown in Instruments, Stamps.';
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
  counts: () => ({ nobj: META.nobj, nunit: META.ndet, tmax: Math.max(META.tmax, R.nights.length ? nightMjd(R.nights[R.nights.length - 1][0]) : 0) }),
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

$('#dMin').addEventListener('input', () => onSize('lo'));
$('#dMax').addEventListener('input', () => onSize('hi'));
$('#sizeReset').addEventListener('click', () => { state.dLo = 0; state.dHi = 1000; applyFilters(); renderCard(); redrawAll(); });
new ResizeObserver(drawSizeHist).observe($('#dual'));
onTheme(() => { spriteCache.clear(); legendMap(); renderCard(); redrawAll(); drawSizeHist(); });

export function start(params) {
  pill = SC.makePill($('#astTools'), { onToggle: toggleShowAll, onBack: () => runPreset('all') });
  legendMap();
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
  setUrl({ mode: 'asteroids', obj: null, chapter: null, beat: null, sel: state.sel ? state.sel.name : null });
  metaText(); mapS.draw(mapS);
  const arrived = () => { if (mapS.w) floorDrawn('asteroids'); else requestAnimationFrame(arrived); };
  requestAnimationFrame(arrived);
  setTimeout(() => { elS.draw(elS); colS.draw(colS); cadS.draw(cadS); cardPlots.forEach((p) => p.draw(p)); }, 0);
  $('#search').value = state.sel ? state.sel.name : '';
  if (params && !reduceMotion && params.has('play')) setPlaying(true);
}
export function hide() { setPlaying(false); }
ns.asteroids = { rebuild, get meta() { return META; }, get state() { return state; }, byName: (n) => byName.get(norm(n)), runPreset, select, get labels() { return [{ el: $('#map'), boxes: [...plateBoxes, ...labelBoxes] }]; } };

export const count = () => fmtN(META.nobj);
const geoKm = (k) => Math.hypot(posX[k] - ladderGeo.ex, posY[k] - ladderGeo.ey) / ladderGeo.sc * cosmo.KM_PER_AU;
export function ladder() {
  if (!ladderGeo.ok) return null;
  const d = [];
  for (let k = 0; k < N; k++) if (W.tgt[k] >= 0.5 && inFilter(O[k])) d.push(geoKm(k));
  d.sort((a, b) => a - b);
  const view = d.length ? [d[Math.floor(0.05 * (d.length - 1))], d[Math.ceil(0.95 * (d.length - 1))]] : null;
  const o = state.sel;
  const sel = o ? { km: geoKm(o.idx), comovingKm: null, z: null, label: o.name, how: 'measured', words: 'orbit fitted to Rubin detections, distance in the ecliptic plane', note: 'from Earth' } : null;
  return { band: [0.02 * cosmo.KM_PER_AU, 6.2 * cosmo.KM_PER_AU], view, sel };
}
export function screenOf(sel = state.sel) {
  if (!sel || !ladderGeo.ok || !mapS.w || !(sel.idx < N)) return null;
  const x = posX[sel.idx], y = posY[sel.idx];
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > mapS.w || y > mapS.h) return null;
  const r = mapS.cv.getBoundingClientRect();
  return { x: r.left + x, y: r.top + y, color: C.cls[sel.cls], sel };
}
