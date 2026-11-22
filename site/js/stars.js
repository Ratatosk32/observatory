import * as K from './kit.js';
import { createStarSync, QUERIES } from './starsync.js';
import { register as registerData, refresh as refreshData, fmtBytes } from './datapanel.js';

const S = await K.loadJson('data/stars.json?v=2026-11-22');
const sync = createStarSync(S);
let lastInfo = (await sync.loadStored()).info;
const { $, pencilLine, pencilCircle, hatch, text, annotate, setupCanvas, fmtN, MON, clamp, esc } = K;
const reduceMotion = K.reduceMotion;
const DEG = Math.PI / 180;
const OFF = S.meta.mjdOffset;
const BANDS = S.meta.bands;
const Ob = S.objects, AL = S.alerts;
let N = 0, NA = 0;
const FAM = S.meta.families, FKEY = FAM.map((f) => f.key);
const METHODS = S.meta.distMethods;
const C = () => K.C;
export const ext = { story: null };
const dateOf = (t) => new Date((t + OFF - 40587) * 864e5);
const fmtD = (t) => { const d = dateOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDs = (t) => { const d = dateOf(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

const GROUPS = [
  { key: 'puls', label: 'Pulsating stars', fams: ['rrlyr', 'ceph', 'dsct', 'lpv'], tok: '--gold' },
  { key: 'bin', label: 'Binaries, flares & other stars', fams: ['ecl', 'active', 'yso', 'cv', 'star'], tok: '--c-tro' },
  { key: 'expl', label: 'Explosions', fams: ['sn', 'sncand'], tok: '--c-neo' },
  { key: 'bh', label: 'Black holes', fams: ['agn', 'tde'], tok: '--c-hil' },
  { key: 'unk', label: 'Unclassified', fams: ['unk'], tok: '--ink3' },
];
const famGroup = FKEY.map((k) => GROUPS.findIndex((g) => g.fams.includes(k)));
let gcol = [];
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  gcol = GROUPS.map((g) => cs.getPropertyValue(g.tok).trim());
}

const GAL = [[-0.0548755604162154, -0.873437090234885, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
function eq2gal(ra, dec) {
  const a = ra * DEG, d = dec * DEG, v = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = GAL.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return [((Math.atan2(g[1], g[0]) / DEG) + 360) % 360, Math.asin(clamp(g[2], -1, 1)) / DEG];
}
function hammer(l, b) {
  let lam = l > 180 ? l - 360 : l;
  lam = -lam * DEG;
  const phi = b * DEG, den = Math.sqrt(1 + Math.cos(phi) * Math.cos(lam / 2));
  return [2 * Math.SQRT2 * Math.cos(phi) * Math.sin(lam / 2) / den, Math.SQRT2 * Math.sin(phi) / den];
}
const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const MW = S.milkyWay, mwD = decode(MW.density);
const HR = S.hrDiagram, hrC = decode(HR.counts);

let grp, pU, pV, nights, T0, T1, gaps, byT0, t0Sorted, vis, sx, sy, qx, qy, jit, lx, ly;
function derive() {
  N = Ob.id.length; NA = AL.t.length;
  grp = Uint8Array.from(Ob.fam, (f) => famGroup[f]);
  pU = new Float32Array(N); pV = new Float32Array(N);
  for (let i = 0; i < N; i++) { const [x, y] = hammer(Ob.l[i], Ob.b[i]); pU[i] = x; pV[i] = y; }
  nights = S.nights.map((n) => ({ ...n, t: n.mjd - OFF }));
  T0 = nights[0].t; T1 = nights[nights.length - 1].t + 1;
  gaps = [];
  for (let i = 1; i < nights.length; i++) if (nights[i].t - nights[i - 1].t > 1.5) gaps.push([nights[i - 1].t + 1, nights[i].t]);
  byT0 = Array.from({ length: N }, (_, i) => i).sort((a, b) => Ob.t0[a] - Ob.t0[b]);
  t0Sorted = Float64Array.from(byT0, (i) => Ob.t0[i]);
  vis = new Uint8Array(N);
  sx = new Float32Array(N); sy = new Float32Array(N); qx = new Float32Array(N); qy = new Float32Array(N);
  jit = new Float32Array(N);
  for (let i = 0; i < N; i++) { let h = 0; const id = Ob.id[i]; for (let k = id.length - 6; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) % 1000; jit[i] = h / 1000; }
  lx = new Float32Array(N); ly = new Float32Array(N);
}
derive();
const inGap = (t) => gaps.find((g) => t >= g[0] && t < g[1]);
const lb = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const featuredBy = new Map(S.featured.map((f) => [f.o, f]));
const nameOf = (i) => Ob.name[i] || 'Rubin object …' + Ob.id[i].slice(-6);
const famLabel = (i) => FAM[Ob.fam[i]].label;
const catOf = (i) => S.meta.catTypes[Ob.catType[i]] || '';
const fmtPc = (pc) => pc >= 1e9 ? (pc / 1e9).toFixed(pc >= 1e10 ? 0 : 1) + ' Gpc' : pc >= 1e6 ? (pc / 1e6).toFixed(pc >= 1e7 ? 0 : 1) + ' Mpc' : pc >= 1e3 ? (pc / 1e3).toFixed(pc >= 1e4 ? 0 : 1) + ' kpc' : Math.round(pc) + ' pc';
const fmtLy = (pc) => { const ly = pc * 3.2616; return ly >= 1e9 ? (ly / 1e9).toFixed(1) + ' billion light years' : ly >= 1e6 ? (ly / 1e6).toFixed(ly >= 1e7 ? 0 : 1) + ' million light years' : fmtN(Math.round(ly)) + ' light years'; };
const METHOD_WORDS = { gaia_parallax: 'Gaia DR3 parallax', rr_lyrae_candle: 'RR Lyrae standard candle', cloud_member: 'cloud membership', tns_redshift: 'TNS spectroscopic redshift', host_galaxy: 'host-galaxy distance (Mangrove)', photo_z: 'host photometric redshift (Legacy DR8)', sdss_specz: 'SDSS DR16 spectroscopic redshift' };
const DDF = [['COSMOS', 150.11, 2.18], ['XMM-LSS', 35.71, -4.75], ['ECDFS', 53.13, -28.10], ['ELAIS-S1', 9.45, -44.03], ['EDFS', 58.90, -49.32], ['', 63.60, -47.60]];

const st = {
  t: Math.min(T1, Math.max(T0, Ob.t1.reduce((a, b) => Math.max(a, b), -1e9))), playing: false, speed: 2, skip: true,
  sel: -1, hover: -1, groupsOn: new Set(GROUPS.map((_, i) => i)), pred: null, preset: 'all', lcMode: 'flux', tour: null,
};
function applyFilter() {
  for (let i = 0; i < N; i++) vis[i] = st.groupsOn.has(grp[i]) && (!st.pred || st.pred(i)) ? 1 : 0;
  emberN = -1; ladderKey = ''; hrKey = '';
}

let built = false, entered = false;
let skyS, ladS, ribS, hrS, cardPlots = [];
let emberN = -1, emberCv = null, ladderKey = '', ladderCv = null, hrKey = '', hrCv = null, ribKey = '', ribCv = null;
let skyStatic = null, skyKey = '', skyGeom = null, lantern = null;
const perf = K.perf;
const sprites = [];

function buildDom() {
  const root = $('#starsRoot');
  root.innerHTML = `
<main class="smain">
  <div class="stack">
    <section class="panel map-panel s-sky" aria-labelledby="h-sky">
      <div class="phead"><div class="pbar"><h2 id="h-sky">Where in the sky does something change?</h2></div>
      <p class="cap">Gaia’s Milky Way in Galactic coordinates, centre in the middle. Each spark is one night on which an object in this sample changed; embers stay where something has changed so far. Clusters are deep drilling fields, where Rubin returns night after night.</p></div>
      <div class="map-wrap"><canvas id="sky" tabindex="0" aria-label="All-sky map in Galactic coordinates. Plus and minus zoom, 0 resets."></canvas>
        <div class="zoom"><button class="btn sm" type="button" id="zoomIn" aria-label="Zoom in" title="Zoom in">+</button><button class="btn sm" type="button" id="zoomOut" aria-label="Zoom out" title="Zoom out">−</button><button class="btn sm" type="button" id="zoomReset" hidden>Reset view</button></div></div>
      <div class="time">
        <button id="sPlay" class="btn play" type="button" aria-label="Play"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path class="pl" d="M8 5.5v13l10.5-6.5z"/></svg><span>Play</span></button>
        <div class="slider-wrap">
          <input id="sSlider" type="range" min="0" max="1000" step="0.01" aria-label="Date">
          <div class="slider-scale" aria-hidden="true"><span id="sScale0"></span><span class="win">nights with data</span><span id="sScale1"></span></div>
        </div>
        <output id="sDate" class="date"></output>
        <label class="speed"><span>Speed</span><select id="sSpeed" aria-label="Days per second"><option value="1">1 day/s</option><option value="2" selected>2 days/s</option><option value="5">5 days/s</option><option value="15">15 days/s</option></select></label>
      </div>
      <p class="note">In this first season the sample’s alerts come mostly from high Galactic latitudes, looking out of the Milky Way: its stars are halo stars, and the plane and the Magellanic Clouds have almost no alerts here. The soft gold disc is the sky more than 30° above Cerro Pachón at local midnight (computed, not data); north of the gold dec +30° line Rubin cannot see. Gaps with no data are skipped while playing.</p>
      <div class="legend" id="sLegend"></div>
      <div class="sky-tools"><button class="btn" type="button" id="dropBtn">Drop to distance</button></div>
    </section>
    <section class="panel s-ribbon" aria-labelledby="h-rib">
      <div class="phead"><div class="pbar"><h2 id="h-rib">When was Rubin watching?</h2></div>
      <p class="cap">Every night Fink has statistics for: all alerts that night (log scale), coloured by filter. Dots below: this sample's alerts per night, to show how sparse the sample is. Hatched: no data. Click or drag to move in time; ← → step a night, Shift for a week.</p></div>
      <canvas id="ribbon" tabindex="0" aria-label="Season ribbon and time scrubber"></canvas>
      <div class="legend" id="sBandLegend"></div>
    </section>
    <section class="panel s-ladder" aria-labelledby="h-lad">
      <div class="phead"><div class="pbar"><h2 id="h-lad">How far away are the things that change?</h2></div>
      <p class="cap">Each object at its own distance, on a log scale from 1 parsec to 10 billion. Filled dot: measured directly (Gaia parallax, spectroscopic redshift). Open ring: indirect (RR Lyrae standard candle, host galaxy). Dotted ring: weak (photometric redshift). Flaring and eclipsing stars sit within a few kpc, RR Lyrae 10–100 kpc out in the halo, supernovae hundreds of Mpc to Gpc away. Three in four objects cannot be placed and wait in the hatched pile.</p></div>
      <canvas id="ladder" aria-label="Distance ladder"></canvas>
    </section>
    <section class="panel s-census" aria-labelledby="h-cen">
      <div class="phead"><div class="pbar"><h2 id="h-cen">What is in this sample?</h2></div>
      <p class="cap">Objects per family (square-root bar length, number at the end). The three thin lines under each bar: how many have a light curve, a distance, a Gaia period. Click a family to show only it.</p></div>
      <div class="census" id="census"></div>
      <p class="note">How these were chosen: up to about 200 recent alerts per catalogue class and up to 150 per half-month per Fink tag. Proportions reflect that choice, not the sky. Labels are catalogue crossmatches (VSX, SIMBAD, TNS) and Fink tags, and can be wrong.</p>
    </section>
    <section class="panel s-hr" aria-labelledby="h-hrd">
      <div class="phead"><div class="pbar"><h2 id="h-hrd">What kind of star is it?</h2></div>
      <p class="cap">Background: 1.34 million Gaia stars within 200 pc, colour (BP − RP) against absolute magnitude. On top: the sample's stars with a Gaia parallax better than 5σ. Flare stars sit at the cool bottom of the main sequence, white-dwarf binaries below it. RR Lyrae are too far for good parallaxes, so only one appears.</p></div>
      <canvas id="hr" aria-label="Hertzsprung-Russell diagram"></canvas>
    </section>
  </div>
  <aside class="panel card" id="sCard" aria-labelledby="h-scard">
    <div class="phead"><div class="pbar"><h2 id="h-scard">Object card</h2></div></div>
    <div id="sCardBody" aria-live="polite"></div>
  </aside>
</main>`;
  K.sketchify(root);
  K.panelControls(root);
}

function makeSprites() {
  sprites.length = 0;
  for (const col of gcol) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.2, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.globalAlpha = 1; g.fillRect(0, 0, 64, 64);
    const g2 = g.getImageData(0, 0, 64, 64);
    for (let i = 0; i < g2.data.length; i += 4) { const d = Math.hypot((i / 4) % 64 - 31.5, Math.floor(i / 256) - 31.5) / 32; if (d > 0.2) g2.data[i + 3] = Math.round(g2.data[i + 3] * Math.max(0, 1 - (d - 0.2) / 0.8) * 0.6 + 0); }
    g.putImageData(g2, 0, 0);
    sprites.push(c);
  }
}

const view = { k: 1, px: 0, py: 0 };
const KMAX = 40;
function baseFrame(s) {
  const sc = Math.min(s.w / (4 * Math.SQRT2), s.h / (2 * Math.SQRT2)) * 0.97;
  return { sc, cx: s.w / 2, cy: s.h / 2 };
}
function skyFrame(s, v = view) {
  const b = baseFrame(s), w2 = s.w / 2, h2 = s.h / 2;
  const T = (x, y) => [(x - w2) * v.k + w2 + v.px, (y - h2) * v.k + h2 + v.py];
  return {
    sc: b.sc * v.k, k: v.k, cx: b.cx, cy: b.cy,
    X: (u) => (b.cx + u * b.sc - w2) * v.k + w2 + v.px,
    Y: (w) => (b.cy - w * b.sc - h2) * v.k + h2 + v.py,
    T,
    inv: (x, y) => { const mx = (x - w2 - v.px) / v.k + w2, my = (y - h2 - v.py) / v.k + h2; return [(mx - b.cx) / b.sc, (b.cy - my) / b.sc]; },
  };
}
function polyLB(g, f, pts, seam = 0.5) {
  let prev = null;
  g.beginPath();
  for (const [l, b] of pts) {
    const [u, v] = hammer(l, b), x = f.X(u), y = f.Y(v);
    if (!prev || Math.abs(x - prev[0]) > f.sc * 2 * seam) g.moveTo(x, y); else g.lineTo(x, y);
    prev = [x, y];
  }
}
function eqLine(dec) { const pts = []; for (let ra = 0; ra <= 360; ra += 1) pts.push(eq2gal(ra, dec)); return pts; }
function eclLine() {
  const e = 23.4393 * DEG, pts = [];
  for (let lam = 0; lam <= 360; lam += 1) {
    const L = lam * DEG, ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L)) / DEG, dec = Math.asin(Math.sin(e) * Math.sin(L)) / DEG;
    pts.push(eq2gal((ra + 360) % 360, dec));
  }
  return pts;
}
function smallCircleEq(ra0, dec0, r, n = 128) {
  const pts = [], a0 = ra0 * DEG, d0 = dec0 * DEG, rr = r * DEG;
  for (let k = 0; k <= n; k++) {
    const az = k / n * 2 * Math.PI;
    const dec = Math.asin(Math.sin(d0) * Math.cos(rr) + Math.cos(d0) * Math.sin(rr) * Math.cos(az));
    const ra = a0 + Math.atan2(Math.sin(az) * Math.sin(rr) * Math.cos(d0), Math.cos(rr) - Math.sin(d0) * Math.sin(dec));
    pts.push(eq2gal(((ra / DEG) % 360 + 360) % 360, dec / DEG));
  }
  return pts;
}
function invHammer(u, v) {
  const q = 1 - (u / 4) ** 2 - (v / 2) ** 2;
  if (q < 0.5) return null;
  const z = Math.sqrt(q);
  const lam = 2 * Math.atan2(z * u, 2 * (2 * z * z - 1)), phi = Math.asin(clamp(z * v, -1, 1));
  let l = -lam / DEG; if (l < 0) l += 360;
  return [l, phi / DEG];
}
function mwAt(l, b) {
  const x = l * 2 - 0.5, y = (b + 90) * 2 - 0.5;
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(358, Math.floor(y))), fx = x - x0, fy = clamp(y - y0, 0, 1);
  const a = (xx, yy) => mwD[yy * 720 + ((xx % 720) + 720) % 720];
  return (a(x0, y0) * (1 - fx) + a(x0 + 1, y0) * fx) * (1 - fy) + (a(x0, y0 + 1) * (1 - fx) + a(x0 + 1, y0 + 1) * fx) * fy;
}
const GALT = [0, 1, 2].map((c) => GAL.map((r) => r[c]));
function galToEqVec(l, b) {
  const L = l * DEG, B = b * DEG, g = [Math.cos(B) * Math.cos(L), Math.cos(B) * Math.sin(L), Math.sin(B)];
  return GALT.map((r) => r[0] * g[0] + r[1] * g[1] + r[2] * g[2]);
}
const LSTEP = 4;
let lanGrid = null, lanCv = null, staticView = null;
function buildSkyStatic(s) {
  const key = [s.w, s.h, s.dpr, C().dark, view.k.toFixed(4), view.px.toFixed(1), view.py.toFixed(1)].join('|');
  if (key === skyKey && skyStatic) return;
  skyKey = key;
  staticView = { ...view };
  const cv = document.createElement('canvas');
  cv.width = Math.round(s.w * s.dpr); cv.height = Math.round(s.h * s.dpr);
  const g = cv.getContext('2d');
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  const f = skyFrame(s), dark = C().dark, k = view.k;
  const res = k > 2 ? Math.min(2, s.dpr) : 1;
  const W = Math.max(1, Math.round(s.w * res)), H = Math.max(1, Math.round(s.h * res));
  const wash = document.createElement('canvas'); wash.width = W; wash.height = H;
  const wg = wash.getContext('2d'), img = wg.createImageData(W, H), d = img.data;
  const col = dark ? [236 * 0.6 + 240 * 0.4, 230 * 0.6 + 191 * 0.4, 214 * 0.6 + 79 * 0.4] : [60, 62, 70];
  const amax = 255 * 0.55 * (dark ? 1 : 0.8);
  const tw = clamp((k - 6) / 4, 0, 1), tl = tw > 0 ? visibleTiles(s, f) : [];
  let grainy = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [u, v] = f.inv((x + 0.5) / res, (y + 0.5) / res);
      const lb2 = invHammer(u, v);
      if (!lb2) continue;
      let val = k > 1.5 ? mwAt(lb2[0], lb2[1]) : mwD[Math.min(359, Math.max(0, Math.floor((lb2[1] + 90) * 2))) * 720 + Math.min(719, Math.floor(lb2[0] * 2))];
      for (const t of tl) {
        const tv = tileAt(t, lb2[0], lb2[1]);
        if (tv < 0) continue;
        const wgt = tw * tv.w;
        val = val * (1 - wgt) + tv.v * wgt;
        if (t.grainy) grainy = true;
      }
      if (!val) continue;
      const p = (y * W + x) * 4;
      d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2];
      d[p + 3] = Math.round(amax * Math.pow(val / 255, 1.6));
    }
  }
  wg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  if (grainy) g.filter = 'blur(1px)';
  g.drawImage(wash, 0, 0, s.w, s.h);
  g.filter = 'none';
  const LW = Math.ceil(s.w / LSTEP), LH = Math.ceil(s.h / LSTEP), vec = new Float32Array(LW * LH * 3).fill(NaN);
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    const [u, v] = f.inv((x + 0.5) * LSTEP, (y + 0.5) * LSTEP), lb2 = invHammer(u, v);
    if (!lb2) continue;
    const e = galToEqVec(lb2[0], lb2[1]), p = (y * LW + x) * 3;
    vec[p] = e[0]; vec[p + 1] = e[1]; vec[p + 2] = e[2];
  }
  lanGrid = { LW, LH, vec };
  lanCv = document.createElement('canvas'); lanCv.width = LW; lanCv.height = LH;
  const gold = C().gold;
  polyLB(g, f, (() => { const p = []; for (let b = -90; b <= 90; b += 1) p.push([180.001, b]); for (let b = 90; b >= -90; b -= 1) p.push([179.999, b]); return p; })(), 2);
  g.strokeStyle = C().goldSoft; g.lineWidth = 1.2; g.stroke();
  const fine = k >= 2.5;
  const grid = fine ? fineGrid() : smoothGrid();
  const levels = fine ? [[120, 0.12], [140, 0.16], [160, 0.2], [180, 0.26], [200, 0.32], [220, 0.4]] : [[150, 0.15], [175, 0.25], [200, 0.35]];
  g.lineWidth = 1;
  levels.forEach(([lev, a]) => { contour(g, f, grid, lev, s); g.strokeStyle = gold; g.globalAlpha = a; g.stroke(); });
  g.globalAlpha = 1;
  const BS = S.brightStars, rk = Math.min(3, Math.sqrt(k));
  for (let i = 0; i < BS.l.length; i++) {
    const [u, v] = hammer(BS.l[i], BS.b[i]), x = f.X(u), y = f.Y(v);
    if (x < -4 || y < -4 || x > s.w + 4 || y > s.h + 4) continue;
    const r = clamp(1.8 - (BS.G[i] + 1) * 0.2, 0.4, 1.8) * rk, c = BS.bpRp[i];
    g.fillStyle = !dark ? 'rgba(40,42,50,0.4)' : c === null ? 'rgba(236,230,214,0.45)' : c < 0.3 ? 'rgba(190,210,255,0.5)' : c > 1.5 ? 'rgba(255,200,140,0.5)' : 'rgba(236,230,214,0.45)';
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
  }
  const bStep = k < 2.5 ? 30 : k < 6 ? 10 : k < 15 ? 5 : 2, lStep = k < 2.5 ? 60 : k < 6 ? 15 : k < 15 ? 5 : 2;
  const centre = invHammer(...f.inv(s.w / 2, s.h / 2)) || [0, 0];
  g.strokeStyle = C().line; g.lineWidth = 0.8; g.globalAlpha = 0.5;
  const db = Math.max(0.25, Math.min(2, 2 / k));
  for (let b0 = -90 + bStep; b0 < 90; b0 += bStep) { const p = []; for (let l = -179.9; l <= 179.9; l += db) p.push([(l + 360) % 360, b0]); polyLB(g, f, p); g.stroke(); }
  for (let l0 = 0; l0 < 360; l0 += lStep) { if (l0 === 180) continue; const p = []; for (let b = -90; b <= 90; b += db) p.push([l0, b]); polyLB(g, f, p); g.stroke(); }
  g.globalAlpha = 1;
  for (let b0 = -90 + bStep; b0 < 90; b0 += bStep) {
    const [u, v] = hammer(centre[0], b0), x = f.X(u), y = f.Y(v);
    if (x > 0 && x < s.w && y > 10 && y < s.h - 10) text(g, (b0 > 0 ? '+' : b0 < 0 ? '−' : '') + Math.abs(b0) + '°', x + 4, y - 3, { size: 10.5, color: C().ink3, halo: true });
  }
  if (k >= 2.5) for (let l0 = 0; l0 < 360; l0 += lStep) {
    const [u, v] = hammer(l0 === 180 ? 179.9 : l0, centre[1]), x = f.X(u), y = f.Y(v);
    if (x > 10 && x < s.w - 30 && y > 10 && y < s.h - 10) text(g, `l ${l0}°`, x + 3, y + 12, { size: 10.5, color: C().ink3, halo: true });
  }
  g.setLineDash([3, 5]); g.strokeStyle = C().ink3; g.lineWidth = 1; polyLB(g, f, eqLine(0)); g.stroke();
  g.strokeStyle = gold; g.lineWidth = 1.3; polyLB(g, f, eqLine(30)); g.stroke();
  g.setLineDash([1, 4]); g.strokeStyle = C().ink2; polyLB(g, f, eclLine()); g.stroke(); g.setLineDash([]);
  const vis2 = (x, y) => x > -50 && x < s.w + 50 && y > -20 && y < s.h + 20;
  const lab = (str, l, b, opts) => { const [u, v] = hammer(l, b), x = f.X(u), y = f.Y(v); if (vis2(x, y)) annotate(g, str, x, y, opts); };
  const sz = s.w < 600 ? 14 : 18;
  lab('Galactic centre', 0, -5 / Math.sqrt(k), { size: sz, color: C().ink2 });
  if (k < 4) lab('Galactic bulge', 0, 12, { size: sz - 2, color: C().ink3 });
  lab('anticentre', 183, 4, { size: sz - 2, color: C().ink3, align: 'right' });
  lab(k > 3 ? 'Large Magellanic Cloud' : 'Large Magellanic Cloud', 280.5, -32.9 - 5 / Math.sqrt(k), { size: sz - 2, color: C().ink2 });
  lab('Small Magellanic Cloud', 302.8, -44.3 - 4.5 / Math.sqrt(k), { size: sz - 2, color: C().ink2 });
  if (k < 4) lab('dust lanes', 330, -9, { size: sz - 4, color: C().ink3 });
  const [eu, ev] = hammer(...eq2gal(150, 33));
  if (vis2(f.X(eu), f.Y(ev))) annotate(g, 'north of this line Rubin cannot see', f.X(eu), f.Y(ev) - 4, { size: sz - 2, color: gold });
  const ecl = eclLine(), ep = ecl[Math.floor(ecl.length * 0.62)], [xu, xv] = hammer(ep[0], ep[1]);
  if (vis2(f.X(xu), f.Y(xv))) annotate(g, "the asteroids' plane (other mode) →", f.X(xu) + 6, f.Y(xv) - 6, { size: sz - 2, color: C().ink2, align: 'left' });
  skyGeom = { eclLabel: [f.X(xu), f.Y(xv) - 20, 260, 26] };
  g.strokeStyle = C().ink; g.lineWidth = 1;
  DDF.forEach(([nm, ra, dec], i) => {
    polyLB(g, f, smallCircleEq(ra, dec, 1.75, k > 3 ? 96 : 32)); g.closePath(); g.stroke();
    const [u, v] = hammer(...eq2gal(ra, dec)), x = f.X(u), y = f.Y(v), off = 1.75 * f.sc / 57 + 6;
    if (nm && vis2(x, y)) annotate(g, nm, x + (i % 2 ? -off : off), y + (i % 2 ? off + 8 : -off), { size: sz - 2, color: C().ink, align: i % 2 ? 'right' : 'left' });
  });
  if (s.w >= 600) text(g, k > 1.01 ? `zoom ×${k.toFixed(k < 10 ? 1 : 0)} · Gaia density cells are 0.5° wide${k > 12 ? ', so the wash is smooth but not sharper than that' : ''}` : '', 12, 18, { size: 11, color: C().ink3, halo: true });
  if (TILES && k >= 1) namedStarLabels(g, f, s, k);
  if (tl.length && tw > 0 && s.w >= 600) {
    const t = tl[0], cell = t.step;
    text(g, `fine Gaia tile: ${t.name}, ${cell}° cells, ${fmtN(Math.round(t.countMin / cell / cell))}–${fmtN(Math.round(t.countMax / cell / cell))} stars per deg²${t.grainy ? ' (grain is real counting noise, drawn softened)' : ''}`, 12, 34, { size: 11, color: C().ink3, halo: true });
  }
  if (hooks.staticOverlay) hooks.staticOverlay(g, s, f);
  skyStatic = cv;
}
let TILES = null, tilesLoading = null;
function loadTiles() {
  if (TILES || tilesLoading) return tilesLoading || Promise.resolve();
  tilesLoading = K.loadJson('data/stars-tiles.json?v=2026-11-22').then(prepTiles, () => null);
  return tilesLoading;
}
function prepTiles(T) {
  if (!T) return;
  for (const t of T.tiles) {
    t.d = decode(t.density);
    [t.lc, t.bc] = eq2gal(t.raCenter, t.decCenter);
    t.cosR = Math.cos(t.radiusDeg * DEG); t.cosRin = Math.cos((t.radiusDeg - 0.3) * DEG);
    t.sbc = Math.sin(t.bc * DEG); t.cbc = Math.cos(t.bc * DEG);
    t.grainy = t.countMax < 100;
  }
  TILES = T;
  skyKey = '';
  if (entered) drawSky(skyS);
}
function visibleTiles(s, f) {
  if (!TILES) { if (view.k >= 4) loadTiles(); return []; }
  const out = [];
  for (const t of TILES.tiles) {
    const [u, v] = hammer(t.lc, t.bc), x = f.X(u), y = f.Y(v), r = t.radiusDeg * f.sc / 57.3;
    if (x + r < 0 || x - r > s.w || y + r < 0 || y - r > s.h) continue;
    const area = Math.min(s.w, 2 * r) * Math.min(s.h, 2 * r);
    if (area < 0.25 * s.w * s.h && r * 2 < Math.min(s.w, s.h) * 0.5) continue;
    out.push(t);
  }
  return out;
}
function tileAt(t, l, b) {
  const L = l * DEG, B = b * DEG;
  const cd = Math.sin(B) * t.sbc + Math.cos(B) * t.cbc * Math.cos(L - t.lc * DEG);
  if (cd < t.cosR) return -1;
  const w = cd >= t.cosRin ? 1 : (cd - t.cosR) / (t.cosRin - t.cosR);
  let lw = l >= 180 ? l - 360 : l;
  let li = Math.floor((lw - t.l0) / t.step);
  if (li < 0) li = Math.floor((lw + 360 - t.l0) / t.step);
  const bi = Math.floor((b - t.b0) / t.step);
  if (li < 0 || li >= t.width || bi < 0 || bi >= t.height) return -1;
  const raw = t.d[bi * t.width + li];
  if (!raw) return { v: 0, w };
  return { v: 40 + raw * 0.84, w };
}
function namedStarLabels(g, f, s, k) {
  const lim = k >= 10 ? 9 : k >= 4 ? 3 : 1.5;
  const placed = [];
  g.font = "500 11px 'IBM Plex Sans', system-ui, sans-serif";
  for (const ns of TILES.namedStars) {
    if (ns.mag > lim) continue;
    const [u, v] = hammer(ns.l, ns.b), x = f.X(u), y = f.Y(v);
    if (x < 4 || y < 12 || x > s.w - 60 || y > s.h - 40) continue;
    const w = g.measureText(ns.name).width, box = [x + 5, y - 10, x + 9 + w, y + 3];
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    g.fillStyle = C().ink; g.beginPath(); g.arc(x, y, 1.6, 0, 6.283); g.fill();
    text(g, ns.name, x + 6, y, { size: 11, weight: 500, color: C().ink2, halo: true });
  }
}
const hooks = { overlay: null, staticOverlay: null, skyAlpha: 1, emberAlpha: 1, onStop: null };
let smoothed = null, finer = null;
function smoothGrid() {
  if (smoothed) return smoothed;
  const W = 360, H = 180, out = new Float32Array(W * H);
  for (let bi = 0; bi < H; bi++) for (let li = 0; li < W; li++) {
    let s = 0, n = 0;
    for (let db = -1; db <= 2; db++) for (let dl = -1; dl <= 2; dl++) {
      const b2 = bi * 2 + db, l2 = (li * 2 + dl + 720) % 720;
      if (b2 < 0 || b2 >= 360) continue;
      s += mwD[b2 * 720 + l2]; n++;
    }
    out[bi * W + li] = s / n;
  }
  smoothed = { W, H, v: out, cell: 1 };
  return smoothed;
}
function fineGrid() {
  if (finer) return finer;
  const W = 720, H = 360, out = new Float32Array(W * H);
  for (let bi = 0; bi < H; bi++) for (let li = 0; li < W; li++) {
    let s = 0, n = 0;
    for (let db = -1; db <= 1; db++) for (let dl = -1; dl <= 1; dl++) {
      const b2 = bi + db, l2 = (li + dl + W) % W;
      if (b2 < 0 || b2 >= H) continue;
      s += mwD[b2 * W + l2]; n++;
    }
    out[bi * W + li] = s / n;
  }
  finer = { W, H, v: out, cell: 0.5 };
  return finer;
}
function contour(g, f, m, lev, s) {
  const { W, H, v, cell } = m;
  const P = (li, bi) => { const l = (li + 0.5) * cell, b = (bi + 0.5) * cell - 90; const [u, w] = hammer(((l % 360) + 360) % 360, b); return [f.X(u), f.Y(w)]; };
  g.beginPath();
  const seg = (a, b) => { if (Math.abs(a[0] - b[0]) > f.sc) return; g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); };
  const zoomed = f.k > 1.5;
  for (let bi = 0; bi < H - 1; bi++) for (let li = 0; li < W; li++) {
    const l1 = (li + 1) % W;
    const a = v[bi * W + li], b = v[bi * W + l1], c = v[(bi + 1) * W + l1], d = v[(bi + 1) * W + li];
    const idx = (a > lev ? 1 : 0) | (b > lev ? 2 : 0) | (c > lev ? 4 : 0) | (d > lev ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    if (zoomed) { const q = P(li, bi); if (q[0] < -40 || q[0] > s.w + 40 || q[1] < -40 || q[1] > s.h + 40) continue; }
    const ip = (p, q, x0, y0, x1, y1) => { const t = (lev - p) / (q - p); return P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); };
    const e0 = () => ip(a, b, li, bi, li + 1, bi), e1 = () => ip(b, c, li + 1, bi, li + 1, bi + 1), e2 = () => ip(d, c, li, bi + 1, li + 1, bi + 1), e3 = () => ip(a, d, li, bi, li, bi + 1);
    switch (idx) {
      case 1: case 14: seg(e3(), e0()); break;
      case 2: case 13: seg(e0(), e1()); break;
      case 3: case 12: seg(e3(), e1()); break;
      case 4: case 11: seg(e1(), e2()); break;
      case 5: seg(e3(), e0()); seg(e1(), e2()); break;
      case 6: case 9: seg(e0(), e2()); break;
      case 7: case 8: seg(e3(), e2()); break;
      case 10: seg(e0(), e1()); seg(e2(), e3()); break;
    }
  }
}

function zenith(t) {
  const mjd = t + OFF, d0 = Math.floor(mjd), jd0 = d0 + 2400000.5 + (4 + 43 / 60) / 24;
  const gmst = ((280.46061837 + 360.98564736629 * (jd0 - 2451545.0) + 0.98564736629 * (mjd - d0)) % 360 + 360) % 360;
  return { ra: ((gmst - 70.7494) % 360 + 360) % 360, dec: -30.2446 };
}
function lanternPts(t) { const z = zenith(t); return smallCircleEq(z.ra, z.dec, 60, 160); }
function paintLantern(t) {
  if (!lanGrid) return;
  const { LW, LH, vec } = lanGrid, z = zenith(t), a = z.ra * DEG, dd = z.dec * DEG;
  const zx = Math.cos(dd) * Math.cos(a), zy = Math.cos(dd) * Math.sin(a), zz = Math.sin(dd);
  const lg = lanCv.getContext('2d'), im = lg.createImageData(LW, LH), d = im.data;
  const gc = C().dark ? [240, 191, 79] : [74, 74, 74], c0 = Math.cos(56 * DEG), c1 = Math.cos(62 * DEG), amax = C().dark ? 34 : 26;
  for (let i = 0, n = LW * LH; i < n; i++) {
    const x = vec[i * 3];
    if (x !== x) continue;
    const dot = x * zx + vec[i * 3 + 1] * zy + vec[i * 3 + 2] * zz;
    if (dot <= c1) continue;
    const w = dot >= c0 ? 1 : (dot - c1) / (c0 - c1);
    const p = i * 4;
    d[p] = gc[0]; d[p + 1] = gc[1]; d[p + 2] = gc[2]; d[p + 3] = Math.round(amax * w * w * (3 - 2 * w));
  }
  lg.putImageData(im, 0, 0);
}

let settleTimer = 0, gesturing = false;
function viewChanged() {
  gesturing = true; emberN = -1;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { gesturing = false; skyKey = ''; drawSky(skyS); }, 180);
  if (!st.playing) drawSky(skyS);
  const zb = $('#zoomReset'); if (zb) zb.hidden = view.k <= 1.001 && !view.px && !view.py;
}
function clampView(s) {
  view.k = clamp(view.k, 1, KMAX);
  const mx = (s.w / 2) * (view.k - 1), my = (s.h / 2) * (view.k - 1);
  view.px = clamp(view.px, -mx, mx); view.py = clamp(view.py, -my, my);
  if (s.w) { const b = baseFrame(s); view.cu = ((s.w / 2 - view.px / view.k) - b.cx) / b.sc; view.cv = (b.cy - (s.h / 2 - view.py / view.k)) / b.sc; }
}
function placeCenter(s, u, v, k) {
  const b = baseFrame(s);
  view.k = clamp(k, 1, KMAX); view.px = -(b.cx + u * b.sc - s.w / 2) * view.k; view.py = -(b.cy - v * b.sc - s.h / 2) * view.k;
  clampView(s);
}
function zoomAt(factor, x, y) {
  const s = skyS, k1 = clamp(view.k * factor, 1, KMAX), fct = k1 / view.k;
  view.px = x - s.w / 2 - (x - s.w / 2 - view.px) * fct;
  view.py = y - s.h / 2 - (y - s.h / 2 - view.py) * fct;
  view.k = k1; clampView(s); viewChanged();
}
function zoomTo(l, b, k) {
  const s = skyS, bf = baseFrame(s), [u, v] = hammer(l, b);
  const mx = bf.cx + u * bf.sc, my = bf.cy - v * bf.sc;
  view.k = clamp(k, 1, KMAX); view.px = -(mx - s.w / 2) * view.k; view.py = -(my - s.h / 2) * view.k;
  clampView(s); viewChanged();
}
function resetView() { view.k = 1; view.px = 0; view.py = 0; view.cu = 0; view.cv = 0; viewChanged(); }

function drawSky(s) {
  if (!s.w || !entered) return;
  const t0 = performance.now();
  if (!gesturing) buildSkyStatic(s);
  const g = s.ctx, f = skyFrame(s);
  g.clearRect(0, 0, s.w, s.h);
  const sv = staticView || view, r = view.k / sv.k;
  const dx = (-s.w / 2 - sv.px) * r + s.w / 2 + view.px, dy = (-s.h / 2 - sv.py) * r + s.h / 2 + view.py;
  g.globalAlpha = hooks.skyAlpha;
  g.drawImage(skyStatic, dx, dy, s.w * r, s.h * r);
  g.globalAlpha = 1;
  if (s.__w !== s.w || s.__h !== s.h) {
    const b = baseFrame(s);
    for (let i = 0; i < N; i++) { sx[i] = b.cx + pU[i] * b.sc; sy[i] = b.cy - pV[i] * b.sc; }
    if (s.__w && view.k > 1.001 && view.cu != null) { placeCenter(s, view.cu, view.cv, view.k); skyKey = ''; buildSkyStatic(s); }
    s.__w = s.w; s.__h = s.h; emberN = -1;
  }
  const w2 = s.w / 2, h2 = s.h / 2;
  for (let i = 0; i < N; i++) { qx[i] = (sx[i] - w2) * view.k + w2 + view.px; qy[i] = (sy[i] - h2) * view.k + h2 + view.py; }
  paintLantern(st.t);
  g.imageSmoothingEnabled = true;
  g.drawImage(lanCv, dx, dy, lanGrid.LW * LSTEP * r, lanGrid.LH * LSTEP * r);
  lantern = lanternPts(st.t);
  polyLB(g, f, lantern);
  g.strokeStyle = C().gold; g.lineWidth = 1; g.globalAlpha = 0.45; g.stroke(); g.globalAlpha = 1;
  const nNow = lb(t0Sorted, st.t + 1e-9);
  if (!emberCv || emberCv.width !== Math.round(s.w * s.dpr) || emberCv.height !== Math.round(s.h * s.dpr)) { emberCv = document.createElement('canvas'); emberCv.width = Math.round(s.w * s.dpr); emberCv.height = Math.round(s.h * s.dpr); emberN = -1; }
  const eg = emberCv.getContext('2d');
  eg.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  if (emberN < 0 || nNow < emberN) { eg.clearRect(0, 0, s.w, s.h); emberN = 0; }
  if (nNow > emberN) {
    eg.globalAlpha = C().dark ? 0.4 : 0.55;
    const er = 1.3 * Math.min(2.2, Math.sqrt(view.k));
    for (let gi = 0; gi < GROUPS.length; gi++) {
      eg.fillStyle = gcol[gi]; eg.beginPath();
      for (let k = emberN; k < nNow; k++) { const i = byT0[k]; if (grp[i] !== gi || !vis[i]) continue; const x = qx[i], y = qy[i]; if (x < -5 || y < -5 || x > s.w + 5 || y > s.h + 5) continue; eg.moveTo(x + er, y); eg.arc(x, y, er, 0, 6.283); }
      eg.fill();
    }
    eg.globalAlpha = 1; emberN = nNow;
  }
  g.globalAlpha = hooks.emberAlpha;
  g.drawImage(emberCv, 0, 0, s.w, s.h);
  g.globalAlpha = 1;
  const win = reduceMotion ? [Math.floor(st.t), Math.floor(st.t) + 1] : [st.t - 4, st.t];
  let i0 = lb(AL.t, win[0]), i1 = lb(AL.t, win[1] + 1e-9);
  if (i1 - i0 > 1500) i0 = i1 - 1500;
  const dark = C().dark, add = dark && i1 - i0 < 300, sk = Math.min(2, Math.sqrt(view.k));
  g.globalCompositeOperation = add ? 'lighter' : 'source-over';
  for (let k = i0; k < i1; k++) {
    const o = AL.o[k];
    if (!vis[o]) continue;
    const x = qx[o], y = qy[o];
    if (x < -20 || y < -20 || x > s.w + 20 || y > s.h + 20) continue;
    const age = st.t - AL.t[k], a = reduceMotion ? 1 : Math.exp(-age / 1.5);
    const rad = clamp(10 - (AL.m[k] - 16) * 7.5 / 8, 2.5, 10) * sk;
    if (AL.sgn[k] < 0) {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = a * 0.9; g.strokeStyle = gcol[grp[o]]; g.lineWidth = 1.3;
      g.beginPath(); g.arc(x, y, rad * 0.6, 0, 6.283); g.stroke();
      g.globalCompositeOperation = add ? 'lighter' : 'source-over';
    } else {
      g.globalAlpha = a * (dark ? 0.5 : 0.7);
      g.drawImage(sprites[grp[o]], x - rad, y - rad, 2 * rad, 2 * rad);
    }
  }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const gp = inGap(st.t);
  if (gp) text(g, 'No observations in this stretch', s.w / 2, s.h / 2 + 40, { size: 14, weight: 600, color: C().ink, align: 'center', halo: true });
  text(g, fmtD(st.t), 16, s.h - 30, { size: 16, weight: 650, color: C().ink, halo: true });
  if (s.w >= 500) text(g, `${fmtN(i1 - i0)} sample alerts in the last ${reduceMotion ? 'night' : '4 nights'} · ${fmtN(Math.min(nNow, N))} objects seen so far`, 16, s.h - 12, { size: 12, color: C().ink2, halo: true });
  for (const [i, col, w] of [[st.hover, C().ink, 1.5], [st.sel, C().hi, 2]]) {
    if (i < 0) continue;
    const x = qx[i], y = qy[i];
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, 8, 0, 6.283); g.stroke();
    if (i === st.sel) {
      const lx2 = x + (x > s.w * 0.7 ? -60 : 60), ly2 = y - 36;
      g.beginPath(); g.moveTo(x + (lx2 > x ? 7 : -7), y - 5); g.lineTo(lx2, ly2 + 4); g.stroke();
      annotate(g, nameOf(i), lx2 + (lx2 > x ? 4 : -4), ly2, { size: 19, color: C().ink, align: lx2 > x ? 'left' : 'right' });
    }
  }
  if (hooks.overlay) hooks.overlay(g, s, f, qx, qy);
  s.__cost = performance.now() - t0;
}
function wireSkyZoom() {
  const cv = $('#sky');
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const ptrs = new Map();
  let start = null, pinch = null, moved = false, lastTap = 0;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (ptrs.size === 1) start = { x: e.clientX, y: e.clientY, px: view.px, py: view.py };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const r = cv.getBoundingClientRect(); pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, mx: (a[0] + b[0]) / 2 - r.left, my: (a[1] + b[1]) / 2 - r.top }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      moved = true; zoomAt(pinch.k * d / pinch.d / view.k, pinch.mx, pinch.my);
    } else if (ptrs.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (view.k <= 1.001) return;
      moved = true; cv.style.cursor = 'grabbing';
      view.px = start.px + dx; view.py = start.py + dy; clampView(skyS); viewChanged();
    }
  });
  const end = (e) => {
    const wasMoved = moved;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) { start = null; cv.style.cursor = ''; }
    if (e.type !== 'pointerup' || wasMoved) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const now = performance.now();
    if (e.pointerType !== 'mouse' && now - lastTap < 300) { zoomAt(2, x, y); lastTap = 0; return; }
    lastTap = now;
    if (skyGeom) { const [gx, gy, gw, gh] = skyGeom.eclLabel; if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) { K.shell.setMode('asteroids'); return; } }
    select(nearest(qx, qy, x, y, e.pointerType === 'mouse' ? 8 : 14));
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', (e) => { const r = cv.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || ptrs.size) return;
    const r = cv.getBoundingClientRect(), i = nearest(qx, qy, e.clientX - r.left, e.clientY - r.top, 8);
    setHover(i);
    if (i >= 0) K.showTip(tipFor(i), e.clientX, e.clientY); else K.hideTip();
  });
  cv.addEventListener('pointerleave', () => { setHover(-1); K.hideTip(); });
  $('#zoomIn').addEventListener('click', () => zoomAt(2, skyS.w / 2, skyS.h / 2));
  $('#zoomOut').addEventListener('click', () => zoomAt(0.5, skyS.w / 2, skyS.h / 2));
  $('#zoomReset').addEventListener('click', resetView);
  cv.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.5, skyS.w / 2, skyS.h / 2); }
    if (e.key === '-') { e.preventDefault(); zoomAt(1 / 1.5, skyS.w / 2, skyS.h / 2); }
    if (e.key === '0') { e.preventDefault(); resetView(); }
  });
}

const LAD = { L: 16, top: 54, bot: 40, pileW: 0.13 };
function ladFrame(s) {
  const pileW = Math.max(70, s.w * LAD.pileW), R = s.w - pileW - 16;
  const laneH = (s.h - LAD.top - LAD.bot) / GROUPS.length;
  return { R, pileX: R + 12, pileW, laneH, X: (pc) => LAD.L + Math.log10(pc) / 10 * (R - LAD.L), lane: (gi) => LAD.top + gi * laneH };
}
function drawLadder(s) {
  if (!s.w || !entered) return;
  const f = ladFrame(s);
  const key = [s.w, s.h, s.dpr, C().dark, st.groupsOn.size, st.preset].join('|');
  if (key !== ladderKey || !ladderCv) {
    ladderKey = key;
    ladderCv = document.createElement('canvas'); ladderCv.width = Math.round(s.w * s.dpr); ladderCv.height = Math.round(s.h * s.dpr);
    const g = ladderCv.getContext('2d'); g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    const axisY = s.h - LAD.bot;
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const y = f.lane(gi);
      if (gi) pencilLine(g, LAD.L, y, f.R, y, { color: C().grid, passes: 1 });
      text(g, GROUPS[gi].label, LAD.L + 2, y + 12, { size: 11, color: C().ink3, halo: true });
    }
    for (let dcd = 0; dcd <= 10; dcd++) {
      const x = f.X(10 ** dcd);
      pencilLine(g, x, LAD.top, x, axisY, { color: C().grid, passes: 1 });
      const lbs = ['1 pc', '10 pc', '100 pc', '1 kpc', '10 kpc', '100 kpc', '1 Mpc', '10 Mpc', '100 Mpc', '1 Gpc', '10 Gpc'];
      const lys = ['3 yr', '33 yr', '330 yr', '3,300 yr', '33,000 yr', '330,000 yr', '3.3 Myr', '33 Myr', '330 Myr', '3.3 Gyr', '33 Gyr'];
      const every = s.w < 600 ? 3 : 1;
      if (dcd % every === 0) {
        text(g, lbs[dcd], x, axisY + 15, { size: 11.5, weight: 500, color: C().ink2, align: dcd === 0 ? 'left' : 'center' });
        if (s.w >= 600 || dcd % 3 === 0) text(g, lys[dcd], x, axisY + 30, { size: 10.5, color: C().ink3, align: dcd === 0 ? 'left' : 'center' });
      }
    }
    pencilLine(g, LAD.L, axisY, f.R, axisY, { color: C().goldSoft, width: 1.2 });
    let row = 0, lastX = -1e9;
    for (const lm of S.meta.landmarks) {
      const x = f.X(lm.pc);
      g.font = K.font(Math.round(15 * 0.7), 600);
      const w = g.measureText(lm.name).width;
      row = x - lastX < w / 2 + 34 ? (row + 1) % 3 : 0;
      const y = 16 + row * 14;
      pencilLine(g, x, y + 3, x, LAD.top, { color: C().ink3, passes: 1 });
      annotate(g, lm.name.replace('Large Magellanic Cloud', 'LMC').replace('Small Magellanic Cloud', 'SMC').replace('Andromeda (M31)', 'M31').replace('Proxima Centauri', 'Proxima'), x, y, { size: 15, color: C().ink2, align: x < 60 ? 'left' : 'center' });
      lastX = x;
    }
    const pile = new Array(GROUPS.length).fill(0);
    for (let i = 0; i < N; i++) {
      const gi = grp[i];
      if (Ob.dist[i] == null || Ob.distMethod[i] < 0) { if (vis[i]) pile[gi]++; lx[i] = f.pileX + 6 + jit[i] * (f.pileW - 12); ly[i] = f.lane(gi) + 16 + ((jit[i] * 7.31) % 1) * (f.laneH - 20); continue; }
      lx[i] = f.X(clamp(Ob.dist[i], 1, 1e10)); ly[i] = f.lane(gi) + 16 + ((jit[i] * 13.7) % 1) * (f.laneH - 20);
    }
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const y = f.lane(gi) + 4, h = f.laneH - 8;
      g.fillStyle = hatch(g, C().line, 5, 45, 1); g.fillRect(f.pileX, y, f.pileW, h);
      g.strokeStyle = C().line; g.lineWidth = 1; g.strokeRect(f.pileX + 0.5, y + 0.5, f.pileW - 1, h - 1);
      text(g, pile[gi] ? `no distance: ${fmtN(pile[gi])}` : 'none', f.pileX + f.pileW / 2, y + h / 2 + 4, { size: 11, weight: 600, color: C().ink, align: 'center', halo: true });
    }
    for (let gi = 0; gi < GROUPS.length; gi++) {
      for (const kind of ['fill', 'ring', 'dot']) {
        g.beginPath();
        for (let i = 0; i < N; i++) {
          if (grp[i] !== gi || !vis[i] || Ob.distMethod[i] < 0 || Ob.dist[i] == null) continue;
          const m = METHODS[Ob.distMethod[i]], k = m === 'gaia_parallax' || m === 'tns_redshift' || m === 'sdss_specz' ? 'fill' : m === 'photo_z' ? 'dot' : 'ring';
          if (k !== kind) continue;
          g.moveTo(lx[i] + 2.5, ly[i]); g.arc(lx[i], ly[i], 2.5, 0, 6.283);
        }
        g.globalAlpha = 0.9;
        if (kind === 'fill') { g.fillStyle = gcol[gi]; g.fill(); } else { g.strokeStyle = gcol[gi]; g.lineWidth = 1; if (kind === 'dot') g.setLineDash([1, 1.6]); g.stroke(); g.setLineDash([]); }
        g.globalAlpha = 1;
      }
    }
  }
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(ladderCv, 0, 0, s.w, s.h);
  if (!reduceMotion) {
    let i0 = lb(AL.t, st.t - 2), i1 = lb(AL.t, st.t + 1e-9);
    g.globalCompositeOperation = C().dark ? 'lighter' : 'source-over';
    for (let k = Math.max(i0, i1 - 400); k < i1; k++) {
      const o = AL.o[k]; if (!vis[o]) continue;
      const a = Math.exp(-(st.t - AL.t[k]) / 1.5);
      g.globalAlpha = a * 0.9; g.drawImage(sprites[grp[o]], lx[o] - 6, ly[o] - 6, 12, 12);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  for (const [i, col, w] of [[st.hover, C().ink, 1.5], [st.sel, C().hi, 2]]) {
    if (i < 0) continue;
    if (i === st.sel && Ob.distLo[i] != null && Ob.distHi[i] != null) { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(f.X(Math.max(1, Ob.distLo[i])), ly[i]); g.lineTo(f.X(Math.min(1e10, Ob.distHi[i])), ly[i]); g.stroke(); }
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(lx[i], ly[i], 6, 0, 6.283); g.stroke();
  }
}

function drawRibbon(s) {
  if (!s.w || !entered) return;
  const L = 8, R = s.w - 8, top = 8, base = s.h - 30;
  const X = (t) => L + (t - T0) / (T1 - T0) * (R - L);
  const key = [s.w, s.h, s.dpr, C().dark].join('|');
  if (key !== ribKey || !ribCv) {
    ribKey = key;
    ribCv = document.createElement('canvas'); ribCv.width = Math.round(s.w * s.dpr); ribCv.height = Math.round(s.h * s.dpr);
    const g = ribCv.getContext('2d'); g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    const mx = Math.log10(Math.max(...nights.map((n) => n.alerts)));
    const bw = Math.max(1.5, (R - L) / (T1 - T0) - 0.4);
    const bc = BANDS.map((b) => C().band[b]);
    for (const n of nights) {
      const h = Math.log10(Math.max(1, n.alerts)) / mx * (base - top);
      let y = base;
      const tot = n.bands.reduce((a, b) => a + b, 0) || 1;
      for (let k = 0; k < 6; k++) { if (!n.bands[k]) continue; const hh = h * n.bands[k] / tot; g.fillStyle = bc[k]; g.globalAlpha = 0.85; g.fillRect(X(n.t), y - hh, bw, hh); y -= hh; }
      g.globalAlpha = 1;
    }
    for (const [a, b] of gaps) {
      const x0 = X(a), x1 = X(b);
      g.fillStyle = hatch(g, C().line, 5, 45, 1); g.fillRect(x0, top, x1 - x0, base - top);
      if (b - a > 10 && x1 - x0 > 70) text(g, `no data · ${Math.round(b - a)} nights`, (x0 + x1) / 2, top + 14, { size: 11, color: C().ink2, align: 'center', halo: true });
    }
    pencilLine(g, L, base, R, base, { color: C().goldSoft, width: 1.1 });
    const perDay = new Map();
    for (let k = 0; k < NA; k++) { const d = Math.floor(AL.t[k]); perDay.set(d, (perDay.get(d) || 0) + 1); }
    const pm = Math.max(...perDay.values());
    g.fillStyle = C().gold;
    perDay.forEach((v, d) => { const r = 0.8 + Math.sqrt(v / pm) * 3; g.beginPath(); g.arc(X(d + 0.5), base + 8, r, 0, 6.283); g.fill(); });
    for (let y = 2025, m = 10; y < 2027 || m <= 11; m === 11 ? (y++, m = 0) : m++) {
      const t = Date.UTC(y, m, 1) / 864e5 + 40587 - OFF;
      if (t < T0 || t > T1) { if (t > T1) break; continue; }
      const x = X(t);
      g.strokeStyle = C().line; g.lineWidth = 1; g.beginPath(); g.moveTo(x, base + 14); g.lineTo(x, base + 18); g.stroke();
      if (s.w > 560 || m % 2 === 0) text(g, m === 0 ? `${MON[m]} ${y}` : MON[m], x + 2, s.h - 2, { size: 11, color: C().ink3 });
    }
  }
  const g = s.ctx;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(ribCv, 0, 0, s.w, s.h);
  if (st.sel >= 0) { g.fillStyle = C().hi; g.fillRect(X(Ob.t0[st.sel]), base + 15, Math.max(2, X(Ob.t1[st.sel]) - X(Ob.t0[st.sel])), 3); }
  const x = X(st.t);
  g.strokeStyle = C().hi; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, base + 12); g.stroke();
  g.fillStyle = C().hi; g.beginPath(); g.moveTo(x - 5, top - 6); g.lineTo(x + 5, top - 6); g.lineTo(x, top); g.fill();
  s.__X = X; s.__inv = (px) => T0 + (px - L) / (R - L) * (T1 - T0);
}

function drawHr(s) {
  if (!s.w || !entered) return;
  const L = 44, Rm = 12, T = 12, B = 34;
  const cx0 = -0.5, cx1 = 4.5, m0 = -4, m1 = 17;
  const X = (c) => L + (c - cx0) / (cx1 - cx0) * (s.w - L - Rm), Y = (m) => T + (m - m0) / (m1 - m0) * (s.h - T - B);
  const key = [s.w, s.h, s.dpr, C().dark, st.groupsOn.size, st.preset].join('|');
  const g = s.ctx;
  if (key !== hrKey || !hrCv) {
    hrKey = key;
    hrCv = document.createElement('canvas'); hrCv.width = Math.round(s.w * s.dpr); hrCv.height = Math.round(s.h * s.dpr);
    const h = hrCv.getContext('2d'); h.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    const im = document.createElement('canvas'); im.width = HR.width; im.height = HR.height;
    const ig = im.getContext('2d'), id = ig.createImageData(HR.width, HR.height);
    const col = C().dark ? [236, 230, 214] : [50, 52, 60];
    for (let k = 0; k < hrC.length; k++) { const v = hrC[k]; id.data[k * 4] = col[0]; id.data[k * 4 + 1] = col[1]; id.data[k * 4 + 2] = col[2]; id.data[k * 4 + 3] = v ? 30 + v * 0.8 : 0; }
    ig.putImageData(id, 0, 0);
    const xa = X(HR.bpRpMin), xb = X(HR.bpRpMin + HR.bpRpStep * HR.width), ya = Y(HR.absGMin), yb = Y(HR.absGMin + HR.absGStep * HR.height);
    h.imageSmoothingEnabled = true; h.globalAlpha = 0.75; h.drawImage(im, xa, ya, xb - xa, yb - ya); h.globalAlpha = 1;
    for (let c = 0; c <= 4; c++) { pencilLine(h, X(c), T, X(c), s.h - B, { color: C().grid, passes: 1 }); text(h, String(c), X(c), s.h - B + 14, { size: 11, color: C().ink3, align: 'center' }); }
    for (let m = -4; m <= 16; m += 4) { pencilLine(h, L, Y(m), s.w - Rm, Y(m), { color: C().grid, passes: 1 }); text(h, String(m).replace('-', '−'), L - 6, Y(m) + 4, { size: 11, color: C().ink3, align: 'right' }); }
    text(h, 'colour BP − RP (mag) → redder, cooler', (L + s.w) / 2, s.h - 4, { size: 11.5, color: C().ink2, align: 'center' });
    h.save(); h.translate(12, (T + s.h - B) / 2); h.rotate(-Math.PI / 2); text(h, 'absolute magnitude M_G (brighter ↑)', 0, 0, { size: 11.5, color: C().ink2, align: 'center', base: 'middle' }); h.restore();
    annotate(h, 'main sequence', X(1.6), Y(6.5), { size: 18, color: C().ink2 });
    annotate(h, 'giants', X(1.4), Y(-1), { size: 18, color: C().ink2 });
    annotate(h, 'white dwarfs', X(0.3), Y(14.2), { size: 18, color: C().ink2 });
  }
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(hrCv, 0, 0, s.w, s.h);
  hrPts = [];
  for (let i = 0; i < N; i++) {
    if (!vis[i] || Ob.gaiaPlx[i] == null || !Ob.gaiaPlxErr[i] || Ob.gaiaPlx[i] / Ob.gaiaPlxErr[i] < 5 || Ob.gaiaBpRp[i] == null || Ob.gaiaG[i] == null) continue;
    const M = Ob.gaiaG[i] + 5 * Math.log10(Ob.gaiaPlx[i] / 100), x = X(Ob.gaiaBpRp[i]), y = Y(M);
    g.fillStyle = gcol[grp[i]]; g.beginPath(); g.arc(x, y, 3.2, 0, 6.283); g.fill();
    hrPts.push([x, y, i]);
  }
  for (const [i, col] of [[st.hover, C().ink], [st.sel, C().hi]]) {
    const p = hrPts.find((q) => q[2] === i);
    if (p) { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 7, 0, 6.283); g.stroke(); }
  }
}
let hrPts = [];

function legend() {
  const counts = GROUPS.map(() => 0);
  for (let i = 0; i < N; i++) counts[grp[i]]++;
  $('#sLegend').innerHTML = '<span class="ttl">Show:</span>' + GROUPS.map((gp, gi) => `<button type="button" class="k${st.groupsOn.has(gi) ? ' on' : ''}" data-g="${gi}" aria-pressed="${st.groupsOn.has(gi)}" title="${gp.fams.map((k) => FAM[FKEY.indexOf(k)].label).join(', ')}. Click to toggle; Alt-click to show only this."><span class="sw" style="background:${gcol[gi]}"></span>${gp.label} ${fmtN(counts[gi])}</button>`).join('') +
    `<span class="k"><span class="sw ring" style="border-color:${gcol[0]}"></span>got fainter</span><span class="k"><span class="sw ring" style="border-color:${C().hi}"></span>selected</span>`;
  $('#sLegend').querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', (e) => {
    const gi = +b.dataset.g;
    if (e.altKey) st.groupsOn = new Set([gi]);
    else if (st.groupsOn.has(gi) && st.groupsOn.size > 1) st.groupsOn.delete(gi); else st.groupsOn.add(gi);
    applyFilter(); legend(); redraw();
  }));
  $('#sBandLegend').innerHTML = BANDS.map((b) => `<span class="k"><span class="sw sq" style="background:${C().band[b]}"></span>${b}</span>`).join('') + `<span class="k"><span class="sw" style="background:${C().gold}"></span>this sample's alerts per night</span><span class="k"><span class="sw sq" style="background:${C().line}"></span>no data</span>`;
}

function census() {
  const rows = FAM.map((fm, fi) => {
    let n = 0, lc = 0, di = 0, pe = 0;
    for (let i = 0; i < N; i++) if (Ob.fam[i] === fi) { n++; if (Ob.lc[i] >= 0) lc++; if (Ob.distMethod[i] >= 0) di++; if (Ob.period[i]) pe++; }
    return { fi, fm, n, lc, di, pe };
  });
  const mx = Math.sqrt(Math.max(...rows.map((r) => r.n)));
  $('#census').innerHTML = rows.map((r) => {
    const w = (v) => (Math.sqrt(v) / mx * 85).toFixed(1) + '%';
    return `<button type="button" class="nm${st.preset === 'fam-' + r.fi ? ' on' : ''}" data-f="${r.fi}" title="${esc(r.fm.blurb)}">${esc(r.fm.label)}</button>
      <div class="bar"><span class="tot" style="width:${w(r.n)};background:${gcol[famGroup[r.fi]]}"></span><span class="n" style="left:calc(${w(r.n)} + 8px)">${fmtN(r.n)}</span>
      <span class="ov" style="top:13px;width:${w(r.lc)}"></span><span class="ov" style="top:15.5px;width:${w(r.di)};opacity:.55"></span><span class="ov" style="top:18px;width:${w(r.pe)};opacity:.3"></span></div>`;
  }).join('');
  $('#census').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    const fi = +b.dataset.f;
    if (st.preset === 'fam-' + fi) { runPreset('all'); return; }
    st.preset = 'fam-' + fi; st.pred = (i) => Ob.fam[i] === fi; st.groupsOn = new Set(GROUPS.map((_, i) => i));
    markPresets(); applyFilter(); legend(); census(); redraw();
  }));
}

const PRESETS = [
  { id: 'all', label: 'Everything', pred: null },
  { id: 'puls', label: 'Pulsating stars', pred: (i) => grp[i] === 0 },
  { id: 'expl', label: 'Explosions', pred: (i) => grp[i] === 2 },
  { id: 'bh', label: 'Black holes', pred: (i) => grp[i] === 3 },
  { id: 'ddf', label: 'Deep drilling fields', pred: (i) => Ob.reason[i] > 0 && Ob.reason[i] < 6 },
  { id: 'halo', label: 'Halo RR Lyrae', pred: (i) => FKEY[Ob.fam[i]] === 'rrlyr' && Ob.dist[i] > 10000 },
  { id: 'far', label: 'Farthest 20', pred: null, top: (a, b) => (Ob.dist[b] || 0) - (Ob.dist[a] || 0) },
  { id: 'near', label: 'Nearest 20', pred: null, top: (a, b) => (Ob.dist[a] || 1e99) - (Ob.dist[b] || 1e99) },
  { id: 'tour', label: 'Tour', pred: null },
];
function markPresets() { $('#sPresets').querySelectorAll('.btn').forEach((x) => { x.classList.toggle('on', x.dataset.p === st.preset); x.setAttribute('aria-pressed', String(x.dataset.p === st.preset)); }); }
function runPreset(id) {
  stopTour();
  const p = PRESETS.find((x) => x.id === id);
  st.preset = id; st.groupsOn = new Set(GROUPS.map((_, i) => i));
  if (p.top) { const idx = Array.from({ length: N }, (_, i) => i).filter((i) => Ob.dist[i] != null && Ob.distMethod[i] >= 0).sort(p.top).slice(0, 20); const set = new Set(idx); st.pred = (i) => set.has(i); }
  else st.pred = p.pred;
  markPresets(); applyFilter(); legend(); census();
  if (id === 'tour') startTour();
  renderCard(); redraw();
}

function startTour() {
  const list = S.featured.map((f) => f.o).filter((o) => Ob.lc[o] >= 0);
  let k = 0;
  const step = () => {
    const o = list[k++ % list.length];
    select(o, { keepTour: true });
    st.t = clamp(Ob.t0[o] + Math.min(20, (Ob.t1[o] - Ob.t0[o]) / 2), T0, T1);
    emberN = -1;
    if (!reduceMotion) setPlay(true);
  };
  step();
  st.tour = setInterval(step, 20000);
  const stop = (e) => { if (e && e.isTrusted && st.tour && !(e.target instanceof Element && e.target.closest('[data-p="tour"]'))) { stopTour(); runPresetMark(); } };
  st.tourStop = stop;
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, stop, { capture: true, once: false }));
}
function runPresetMark() { if (st.preset === 'tour') { st.preset = 'all'; markPresets(); } }
function stopTour() {
  if (st.tour) clearInterval(st.tour);
  st.tour = null;
  if (st.tourStop) ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.removeEventListener(ev, st.tourStop, { capture: true }));
  st.tourStop = null;
}

function select(i, opts = {}) {
  if (!opts.keepTour) stopTour();
  st.sel = i;
  K.setUrl({ obj: i >= 0 ? Ob.id[i] : null });
  renderCard(); redraw();
}

const SINGULAR = { rrlyr: 'RR Lyrae star', ceph: 'Cepheid', dsct: 'Delta Scuti star', lpv: 'Long-period variable', ecl: 'Eclipsing binary', active: 'Flaring star', yso: 'Young star', cv: 'Cataclysmic variable', star: 'Variable star', sn: 'Supernova', sncand: 'Supernova candidate', tde: 'Star torn by a black hole', agn: 'Feeding black hole', unk: 'Unclassified transient' };
const FIELD = ['', 'in COSMOS', 'in EDFS', 'in ECDFS', 'in XMM-LSS', 'in ELAIS-S1', ''];
function humanName(i) { return Ob.name[i] ? `${Ob.name[i]}` : `${SINGULAR[FKEY[Ob.fam[i]]]} ${FIELD[Ob.reason[i]] || 'in the wide survey'}`.trim(); }
function fmtPer(d) { const h = d * 24; return h < 48 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min` : `${d.toFixed(1)} days`; }
function fmtAgo(gyr) { if (gyr == null) return ''; const y = gyr * 1e9; return y >= 1e9 ? `${(y / 1e9).toFixed(1)} billion years` : y >= 1e6 ? `${Math.round(y / 1e6)} million years` : `${fmtN(Math.round(y))} years`; }
function hookOf(i) {
  const k = FKEY[Ob.fam[i]], d = Ob.dist[i], P = Ob.period[i], lb = Ob.lookbackGyr ? Ob.lookbackGyr[i] : null, cat = catOf(i);
  const where = d ? fmtPc(d) + ' away' : '';
  if (k === 'rrlyr') return `a giant star ${where || 'in the halo'}, pulsing every ${P ? fmtPer(P) : 'half a day'}`;
  if (k === 'ecl') return `two stars eclipsing each other${P ? ' every ' + fmtPer(P) : ''}${where ? ', ' + where : ''}`;
  if (k === 'ceph') return `a pulsating supergiant${P ? ', period ' + fmtPer(P) : ''}`;
  if (k === 'dsct') return `a star ringing every ${P ? fmtPer(P) : 'few hours'}`;
  if (k === 'lpv') return `a cool giant that swells and fades${P ? ' over ' + fmtPer(P) : ''}`;
  if (k === 'active') return `a small red star that flares${where ? ', ' + where : ''}`;
  if (k === 'cv') return 'a white dwarf eating its companion';
  if (k === 'sn' || k === 'sncand') return `${cat.replace('TNS ', '') || 'a stellar explosion'}${lb ? `; light left ${fmtAgo(lb)} ago` : where ? ', ' + where : ''}`;
  if (k === 'tde') return `a star torn apart by a black hole${lb ? `; light ${fmtAgo(lb)} old` : ''}`;
  if (k === 'agn') return `a feeding black hole${lb ? `; light ${fmtAgo(lb)} old` : ''}`;
  if (Ob.sdssClass && Ob.sdssClass[i] === 'QSO') return `labelled a transient, but its spectrum says quasar${lb ? ` (${fmtAgo(lb)})` : ''}`;
  return `something that changed ${Ob.nDet[i]} times${where ? ', ' + where : '; no distance yet'}`;
}
function renderCard() {
  const body = $('#sCardBody');
  cardPlots = [];
  const i = st.sel;
  if (i < 0) {
    const feats = [...new Set([...Object.values(S.stories || {}).map((x) => x.o), ...S.featured.map((f) => f.o)])];
    body.innerHTML = `<h3 class="ph">Pick an object</h3>
      <p class="cap">Tap a spark or ember on the sky, a marker on the distance ladder or a star in the HR diagram, or search a name. Some objects worth meeting:</p>
      <ul class="hooks">${feats.map((o) => `<li><button type="button" data-pick="${o}"><span class="sw" style="background:${gcol[grp[o]]}"></span><b>${esc(humanName(o))}</b><span>${esc(hookOf(o))}</span></button></li>`).join('')}</ul>`;
    body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => select(+b.dataset.pick)));
    return;
  }
  const fe = featuredBy.get(i);
  const facts = [];
  const f1 = (v, d = 1) => v == null ? '—' : (+v).toFixed(d);
  facts.push(['RA, Dec', `${f1(Ob.ra[i], 3)}°, ${f1(Ob.dec[i], 3)}°`]);
  facts.push(['Galactic l, b', `${f1(Ob.l[i], 1)}°, ${f1(Ob.b[i], 1)}°`]);
  facts.push(['Seen', `${fmtDs(Ob.t0[i])} – ${fmtD(Ob.t1[i])}`]);
  facts.push(['Detections', `${fmtN(Ob.nDet[i])}`]);
  const mm = Ob.meanMag[i].map((m, k) => m == null ? null : `${BANDS[k]} ${m.toFixed(1)}`).filter(Boolean).join(' · ');
  facts.push(['Mean magnitude', mm || '—']);
  if (Ob.gaiaG[i] != null) facts.push(['Gaia DR3', `G ${f1(Ob.gaiaG[i], 2)}${Ob.gaiaBpRp[i] != null ? ` · BP−RP ${f1(Ob.gaiaBpRp[i], 2)}` : ''} <small>(match ${f1(Ob.gaiaSep[i], 2)}″)</small>`]);
  if (Ob.distMethod[i] >= 0 && Ob.dist[i] != null) facts.push(['Distance', `${fmtPc(Ob.dist[i])} <small>${esc(METHOD_WORDS[METHODS[Ob.distMethod[i]]] || '')}${Ob.distLo[i] != null ? `, ${fmtPc(Ob.distLo[i])}–${fmtPc(Ob.distHi[i])}` : ''}; light left it ${fmtLy(Ob.dist[i])} ago</small>`]);
  else facts.push(['Distance', '<small>unknown: no Gaia match, no redshift</small>']);
  if (Ob.period[i]) facts.push(['Period', `${Ob.period[i].toFixed(Ob.period[i] < 10 ? 5 : 2)} d <small>${esc(Ob.periodSrc[i] || 'Gaia DR3')}</small>`]);
  const pr = fe && fe.periodRubin && fe.periodRubin.reliable ? fe.periodRubin : null;
  const prLine = pr ? (pr.vsGaia === 'agrees' ? `Rubin alone finds ${pr.period.toFixed(5)} d (agrees).` : pr.vsGaia === 'half' ? `Rubin alone finds ${pr.period.toFixed(5)} d, half the Gaia period: two eclipses per orbit.` : `Rubin alone finds ${pr.period.toFixed(5)} d, a different, probably aliased period.`) : '';
  const isTrans = ['sn', 'sncand', 'tde', 'cv', 'agn', 'unk'].includes(FKEY[Ob.fam[i]]);
  body.innerHTML = `
    <h3>${esc(nameOf(i))}</h3>
    <div class="cls"><span class="sw" style="background:${gcol[grp[i]]}"></span>${esc(famLabel(i))} <span style="color:var(--ink3)">· ${esc(catOf(i))}</span></div>
    <p class="cap">${esc(FAM[Ob.fam[i]].blurb)}. Rubin object ${esc(Ob.id[i])}.</p>
    <dl>${facts.map(([k, v]) => `<div style="grid-column:span ${v.length > 40 ? 3 : 1}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${Ob.lc[i] >= 0 ? `<h4>Light curve</h4>
    <p class="cap">${st.lcMode === 'flux' ? 'Difference flux in nJy: how much brighter (above 0) or fainter (below) than the reference image; this is what Rubin alerts on.' : 'Apparent AB magnitude of the total (science-image) flux.'}${fe ? ' Hollow points: forced photometry, including nights without a detection.' : ''}</p>
    <div class="seg sm" role="group" aria-label="Light-curve units"><button class="btn${st.lcMode === 'flux' ? ' on' : ''}" type="button" data-lc="flux">Flux</button><button class="btn${st.lcMode === 'mag' ? ' on' : ''}" type="button" data-lc="mag">Magnitude</button></div>
    <canvas class="slc"></canvas>` : '<p class="cap">No light curve was fetched for this object; only its sample alerts (sparks) are on the map.</p>'}
    ${Ob.period[i] && Ob.lc[i] >= 0 ? `<h4>Folded on the period</h4><p class="cap">Folded on ${Ob.period[i].toFixed(5)} d from ${esc(Ob.periodSrc[i] || 'Gaia DR3')} (2014–2017 data); one stave per band, each scaled to its own range, two cycles shown. Rubin's 2026 points still line up. ${prLine}</p><canvas class="sfold"></canvas>` : ''}
    ${fe ? `<h4>Stamps</h4><p class="cap">Alert ${esc(fe.diaSourceId)}, ${fmtD(fe.stampT)}, ${fe.stampPx[0]} × ${fe.stampPx[1]} px at 0.2″/px.</p>
    <div class="stamps sm"><figure><span class="im"><img src="${fe.stamps.science}" alt="Science stamp"></span><figcaption><b>Science</b></figcaption></figure><div class="op">−</div><figure><span class="im"><img src="${fe.stamps.template}" alt="Template stamp"></span><figcaption><b>Template</b></figcaption></figure><div class="op">=</div><figure><span class="im"><img src="${fe.stamps.difference}" alt="Difference stamp"></span><figcaption><b>Difference</b></figcaption></figure></div>` : ''}
    <div class="legend">${BANDS.map((b) => `<span class="k"><span class="sw" style="background:${C().band[b]}"></span>${b}</span>`).join('')}</div>`;
  body.querySelectorAll('[data-lc]').forEach((b) => b.addEventListener('click', () => { st.lcMode = b.dataset.lc; renderCard(); }));
  if (Ob.lc[i] >= 0) cardPlots.push(setupCanvas(body.querySelector('.slc'), (s) => drawLc(s, i, fe, isTrans)));
  if (body.querySelector('.sfold')) cardPlots.push(setupCanvas(body.querySelector('.sfold'), (s) => drawFold(s, i, fe)));
  if (ext.story) ext.story.cardToys(body, i);
}
function pctl(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }
function drawLc(s, i, fe, isTrans) {
  if (!s.w) return;
  const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
  const lc = S.lcs[Ob.lc[i]], mag = st.lcMode === 'mag';
  const pts = [];
  for (let k = 0; k < lc.t.length; k++) {
    if (mag) { if (lc.s[k] > 0) pts.push([lc.t[k], 31.4 - 2.5 * Math.log10(lc.s[k]), lc.b[k], null, false]); }
    else pts.push([lc.t[k], lc.f[k], lc.b[k], lc.fe[k], false]);
  }
  if (fe && !mag) for (let k = 0; k < fe.fp.t.length; k++) if (fe.fp.f[k] != null) pts.push([fe.fp.t[k], fe.fp.f[k], fe.fp.b[k], fe.fp.fe[k], true]);
  if (!pts.length) { text(g, 'No points with positive total flux', s.w / 2, s.h / 2, { size: 12, color: C().ink2, align: 'center' }); return; }
  let tA = Math.min(...pts.map((p) => p[0])), tB = Math.max(...pts.map((p) => p[0]));
  if (isTrans) { tA = Math.max(tA, Ob.t0[i] - 30); tB = Math.min(tB, Ob.t1[i] + 30); }
  const inT = pts.filter((p) => p[0] >= tA && p[0] <= tB);
  const ys = inT.map((p) => p[1]);
  let lo = pctl(ys, 0.01), hi = pctl(ys, 0.99);
  if (!mag) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const L = 52, Rm = 10, T = 8, Bm = 28;
  const X = (t) => L + (t - tA) / Math.max(1e-6, tB - tA) * (s.w - L - Rm);
  const Y = mag ? (m) => T + (m - lo) / (hi - lo) * (s.h - T - Bm) : (f) => s.h - Bm - (f - lo) / (hi - lo) * (s.h - T - Bm);
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); pencilLine(g, L, y, s.w - Rm, y, { color: C().grid, passes: 1 }); text(g, mag ? v.toFixed(1) : fmtN(Math.round(v)), L - 5, y + 4, { size: 10.5, color: C().ink3, align: 'right' }); }
  if (!mag) pencilLine(g, L, Y(0), s.w - Rm, Y(0), { color: C().ink3, width: 1 });
  const span = tB - tA, step = span > 200 ? 60 : span > 60 ? 30 : span > 20 ? 7 : 2;
  for (let t = Math.ceil(tA / step) * step; t <= tB; t += step) text(g, fmtDs(t), X(t), s.h - Bm + 14, { size: 10.5, color: C().ink3, align: 'center' });
  text(g, mag ? 'mag (AB), brighter ↑' : 'difference flux (nJy)', L, s.h - 4, { size: 11, color: C().ink2 });
  for (const p of inT) {
    const x = X(p[0]), y = Y(p[1]), col = C().band[BANDS[p[2]]];
    if (p[3] && !mag) { g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(p[1] - p[3])); g.lineTo(x, Y(p[1] + p[3])); g.stroke(); g.globalAlpha = 1; }
    if (p[4]) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 2.4, 0, 6.283); g.stroke(); }
    else { g.fillStyle = col; g.beginPath(); g.arc(x, y, 2.6, 0, 6.283); g.fill(); }
  }
}
function drawFold(s, i, fe) {
  if (!s.w) return;
  const g = s.ctx; g.clearRect(0, 0, s.w, s.h);
  const P = Ob.period[i], src = fe ? fe.fp : S.lcs[Ob.lc[i]];
  const per = BANDS.map(() => []);
  for (let k = 0; k < src.t.length; k++) if (src.f[k] != null) per[src.b[k]].push([((src.t[k] + OFF) / P) % 1, src.f[k]]);
  const bands = per.map((a, k) => [a, k]).filter(([a]) => a.length >= 5);
  if (!bands.length) { text(g, 'Too few points per band to fold', s.w / 2, s.h / 2, { size: 12, color: C().ink2, align: 'center' }); return; }
  const L = 24, Rm = 8, T = 6, Bm = 22, sh = (s.h - T - Bm) / bands.length;
  const X = (ph) => L + ph / 2 * (s.w - L - Rm);
  bands.forEach(([a, k], r) => {
    const ys = a.map((p) => p[1]), lo = pctl(ys, 0.02), hi = pctl(ys, 0.98), y0 = T + r * sh;
    const Y = (v) => y0 + sh - 4 - (clamp(v, lo, hi) - lo) / Math.max(1e-9, hi - lo) * (sh - 8);
    pencilLine(g, L, y0 + sh - 2, s.w - Rm, y0 + sh - 2, { color: C().grid, passes: 1 });
    text(g, BANDS[k], 6, y0 + sh / 2 + 4, { size: 12, weight: 600, color: C().band[BANDS[k]] });
    const col = C().band[BANDS[k]];
    g.fillStyle = col;
    for (const [ph, v] of a) for (const c of [0, 1]) { g.beginPath(); g.arc(X(ph + c), Y(v), 1.8, 0, 6.283); g.fill(); }
    const bins = 20, med = [];
    for (let b = 0; b < bins; b++) { const vals = a.filter((p) => p[0] >= b / bins && p[0] < (b + 1) / bins).map((p) => p[1]); med.push(vals.length ? pctl(vals, 0.5) : null); }
    g.strokeStyle = C().gold; g.globalAlpha = 0.7; g.lineWidth = 1.3; g.beginPath();
    let started = false;
    for (let c = 0; c < 2; c++) for (let b = 0; b < bins; b++) { if (med[b] == null) { started = false; continue; } const x = X(c + (b + 0.5) / bins), y = Y(med[b]); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
    g.stroke(); g.globalAlpha = 1;
  });
  for (const ph of [0, 0.5, 1, 1.5, 2]) text(g, ph.toFixed(1), X(ph), s.h - 6, { size: 10.5, color: C().ink3, align: 'center' });
}

function nearest(arrX, arrY, x, y, rad, filt) {
  let best = -1, bd = rad * rad;
  for (let i = 0; i < N; i++) { if (!vis[i] || (filt && !filt(i))) continue; const d = (arrX[i] - x) ** 2 + (arrY[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function tipFor(i) {
  return `<b>${esc(nameOf(i))}</b><br>${esc(famLabel(i))} · ${esc(catOf(i))}<br>${Ob.distMethod[i] >= 0 && Ob.dist[i] != null ? fmtPc(Ob.dist[i]) + ' · ' + esc(METHOD_WORDS[METHODS[Ob.distMethod[i]]]) : 'distance unknown'}`;
}
function setHover(i) { if (st.hover === i) return; st.hover = i; ['sky', 'ladder', 'hr'].forEach((id) => $('#' + id).classList.toggle('hot', i >= 0)); if (!st.playing) redraw(); }
function wireCanvas(cv, get) {
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = cv.getBoundingClientRect(), i = get(e.clientX - r.left, e.clientY - r.top, 8);
    setHover(i);
    if (i >= 0) K.showTip(tipFor(i), e.clientX, e.clientY); else K.hideTip();
  });
  cv.addEventListener('pointerleave', () => { setHover(-1); K.hideTip(); });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (cv.id === 'sky' && skyGeom) { const [gx, gy, gw, gh] = skyGeom.eclLabel; if (x >= gx && x <= gx + gw && y >= gy && y <= gy + gh) { K.shell.setMode('asteroids'); return; } }
    const i = get(x, y, e.pointerType === 'mouse' ? 8 : 14);
    select(i);
  });
}

let raf = 0, lastTs = 0, frameN = 0;
function frame(ts) {
  raf = 0;
  if (!st.playing || !entered) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  if (lastTs) { perf.frame.push(ts - lastTs); if (perf.frame.length > 600) perf.frame.shift(); }
  lastTs = ts;
  const gp = st.skip && st.stopAt == null && inGap(st.t);
  st.t += dt * (gp ? 30 : st.speed);
  if (st.stopAt != null && st.t >= st.stopAt) { st.t = st.stopAt; st.stopAt = null; drawSky(skyS); drawLadder(ladS); drawRibbon(ribS); setPlay(false); if (hooks.onStop) { const cb = hooks.onStop; hooks.onStop = null; cb(); } return; }
  if (st.t > T1) { st.t = T0; emberN = -1; }
  const c0 = performance.now();
  drawSky(skyS); drawLadder(ladS); drawRibbon(ribS);
  perf.draw.push(performance.now() - c0);
  if (perf.draw.length > 600) perf.draw.shift();
  if (++frameN % 10 === 0) { $('#sDate').textContent = fmtD(st.t); syncSlider(); }
  raf = requestAnimationFrame(frame);
}
function setPlay(p) {
  st.playing = p;
  const b = $('#sPlay');
  b.querySelector('span').textContent = p ? 'Pause' : 'Play';
  b.querySelector('path.pl').setAttribute('d', p ? 'M8 5.5v13M16 5.5v13' : 'M8 5.5v13l10.5-6.5z');
  b.setAttribute('aria-label', p ? 'Pause' : 'Play'); b.classList.toggle('on', p);
  lastTs = 0;
  if (p && !raf) raf = requestAnimationFrame(frame);
  if (!p) $('#sDate').textContent = fmtD(st.t);
}
function syncSlider() { const sl = $('#sSlider'); if (sl) sl.value = ((st.t - T0) / (T1 - T0) * 1000).toFixed(2); }
function setT(t) { st.t = clamp(t, T0, T1); $('#sDate').textContent = fmtD(st.t); syncSlider(); redraw(); }
function redraw() {
  if (!entered) return;
  drawSky(skyS); drawLadder(ladS); drawRibbon(ribS); drawHr(hrS);
  cardPlots.forEach((p) => p.draw(p));
}

function dropToDistance() {
  const sky = $('#sky'), lad = $('#ladder');
  if (reduceMotion || window.innerWidth < 700) { lad.scrollIntoView({ behavior: 'auto', block: 'center' }); return; }
  lad.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  const rs = sky.getBoundingClientRect(), rl = lad.getBoundingClientRect();
  const ov = document.createElement('canvas');
  ov.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  ov.width = innerWidth * dpr; ov.height = innerHeight * dpr;
  document.body.appendChild(ov);
  const g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nNow = lb(t0Sorted, st.t + 1e-9), list = [];
  for (let k = 0; k < nNow; k++) { const i = byT0[k]; if (vis[i]) list.push(i); }
  const t0 = performance.now();
  const ease = (x) => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  const step = (ts) => {
    const p = Math.min(1, (ts - t0) / 900), e = ease(p);
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (let gi = 0; gi < GROUPS.length; gi++) {
      g.fillStyle = gcol[gi]; g.globalAlpha = 0.75; g.beginPath();
      for (const i of list) {
        if (grp[i] !== gi) continue;
        const x = rs.left + qx[i] + (rl.left + lx[i] - rs.left - qx[i]) * e, y = rs.top + qy[i] + (rl.top + ly[i] - rs.top - qy[i]) * e;
        g.moveTo(x + 1.6, y); g.arc(x, y, 1.6, 0, 6.283);
      }
      g.fill();
    }
    if (p < 1) requestAnimationFrame(step); else setTimeout(() => ov.remove(), 250);
  };
  requestAnimationFrame(step);
}

function searchItems(q) {
  const v = q.trim().toLowerCase();
  const out = [];
  if (!v) return S.featured.slice(0, 8).map((f) => item(f.o));
  for (let i = 0; i < N && out.length < 8; i++) {
    const nm = (Ob.name[i] || '').toLowerCase();
    if (nm.includes(v) || Ob.id[i].includes(v) || catOf(i).toLowerCase().includes(v) || famLabel(i).toLowerCase().includes(v)) out.push(item(i));
  }
  return out;
}
function item(i) { return { label: nameOf(i), des: Ob.name[i] ? null : null, color: gcol[grp[i]], meta: `${famLabel(i)} · ${catOf(i)}`, pick: () => select(i) }; }

function onKey(e) {
  const tg = e.target instanceof Element ? e.target : document.body;
  if (!entered || tg.closest('input, select, textarea')) return;
  if (e.key === ' ' && !tg.closest('button')) { e.preventDefault(); setPlay(!st.playing); }
  if (tg.id === 'ribbon' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setT(Math.floor(st.t) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1) + 0.5); }
}

function build() {
  buildDom();
  readColors(); makeSprites();
  const pnav = $('#sPresets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'btn' + (p.id === 'all' ? ' on' : ''); b.type = 'button'; b.textContent = p.label; b.dataset.p = p.id;
    b.addEventListener('click', () => runPreset(p.id));
    pnav.appendChild(b);
  }
  applyFilter();
  skyS = setupCanvas($('#sky'), drawSky);
  ladS = setupCanvas($('#ladder'), drawLadder);
  ribS = setupCanvas($('#ribbon'), drawRibbon);
  hrS = setupCanvas($('#hr'), drawHr);
  wireSkyZoom();
  wireCanvas($('#ladder'), (x, y, r) => nearest(lx, ly, x, y, r, (i) => Ob.distMethod[i] >= 0 && Ob.dist[i] != null));
  wireCanvas($('#hr'), (x, y, r) => { let best = -1, bd = r * r; for (const p of hrPts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = p[2]; } } return best; });
  const rib = $('#ribbon');
  let drag = false;
  const scrub = (e) => { if (!ribS.__inv) return; const r = rib.getBoundingClientRect(); setT(ribS.__inv(e.clientX - r.left)); };
  rib.addEventListener('pointerdown', (e) => { drag = true; rib.setPointerCapture(e.pointerId); scrub(e); });
  rib.addEventListener('pointermove', (e) => { if (drag) scrub(e); });
  rib.addEventListener('pointerup', () => { drag = false; });
  $('#sPlay').addEventListener('click', () => setPlay(!st.playing));
  $('#sSpeed').addEventListener('change', (e) => { st.speed = +e.target.value; });
  const sl = $('#sSlider');
  sl.addEventListener('input', () => setT(T0 + +sl.value / 1000 * (T1 - T0)));
  $('#dropBtn').addEventListener('click', dropToDistance);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.playing) { st.wasPlaying = true; setPlay(false); } else if (!document.hidden && st.wasPlaying) { st.wasPlaying = false; if (entered) setPlay(true); } });
  K.onTheme(() => { if (!entered) { skyKey = ''; return; } readColors(); makeSprites(); skyKey = ''; ladderKey = ''; ribKey = ''; hrKey = ''; emberN = -1; legend(); census(); renderCard(); redraw(); });
  legend(); census(); scaleText();
  built = true;
}

const STARS_TITLE = 'Rubin’s restless sky';
const monthYear = (t) => `${MON[dateOf(t).getUTCMonth()]} ${dateOf(t).getUTCFullYear()}`;
function headerText() {
  $('#sub').textContent = `${fmtN(N)} objects · ${monthYear(T0)} – ${monthYear(T1 - 1)} · Fink + Gaia DR3`;
  K.shell.setSearch({ items: searchItems, empty: 'No object in this sample matches. Try a TNS name (SN 2026…), a family or a Rubin ID.' }, `Search ${fmtN(N)} objects, e.g. SN or RR Lyrae`);
}
function scaleText() { $('#sScale0').textContent = monthYear(T0); $('#sScale1').textContent = monthYear(T1 - 1); }
function rebuildData() {
  derive();
  applyFilter();
  st.t = clamp(st.t, T0, T1);
  skyKey = ''; ladderKey = ''; ribKey = ''; hrKey = ''; emberN = -1;
  if (skyS) skyS.__w = 0;
  if (built) { legend(); census(); scaleText(); }
  if (entered) { headerText(); renderCard(); $('#sDate').textContent = fmtD(st.t); syncSlider(); redraw(); }
}
function enter(objId) {
  if (!built) build();
  entered = true;
  readColors(); makeSprites();
  skyKey = ''; ladderKey = ''; ribKey = ''; hrKey = ''; emberN = -1;
  $('h1').textContent = STARS_TITLE;
  headerText();
  if (objId) { const i = Ob.id.indexOf(objId); if (i >= 0) st.sel = i; }
  $('#sDate').textContent = fmtD(st.t);
  [skyS, ladS, ribS, hrS].forEach((s) => s.resize());
  legend(); census(); renderCard();
  requestAnimationFrame(() => { [skyS, ladS, ribS, hrS].forEach((s) => s.resize()); redraw(); });
  const params = new URLSearchParams(location.search);
  const handled = ext.story ? ext.story.onEnter(params) : false;
  if (!handled && !reduceMotion && !params.has('still')) setPlay(true);
}
function leave() { if (ext.story && ext.story.chapter) ext.story.exitStory(); entered = false; setPlay(false); stopTour(); K.hideTip(); }

function zoomAnim(l, b, k, ms = 1200, done) {
  const s = skyS, k0 = view.k;
  if (view.cu == null) clampView(s);
  const u0 = view.cu || 0, v0 = view.cv || 0, [u1, v1] = hammer(l, b);
  const k1 = clamp(k, 1, KMAX);
  if (k1 >= 4) loadTiles();
  if (reduceMotion || ms <= 0) { zoomTo(l, b, k); if (done) done(); return; }
  const t0 = performance.now();
  const lk0 = Math.log(k0), lk1 = Math.log(k1);
  const step = (ts) => {
    const p = Math.min(1, (ts - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    placeCenter(s, u0 + (u1 - u0) * e, v0 + (v1 - v0) * e, Math.exp(lk0 + (lk1 - lk0) * e));
    viewChanged();
    if (p < 1) requestAnimationFrame(step); else if (done) done();
  };
  requestAnimationFrame(step);
}
export const api = (K.ns.stars = { enter, leave, zoomTo, zoomAnim, resetView, eq2gal, hammer, hooks, loadTiles, setPlay, redraw, renderCard, applyFilter, humanName, hookOf, fmtPer, fmtAgo, fmtPc, fmtD, nameOf, catOf, famLabel,
  S, Ob, get N() { return N; }, GROUPS, FKEY, get grp() { return grp; }, get vis() { return vis; }, rebuildData, get gcol() { return gcol; }, get sprites() { return sprites; }, get view() { return view; }, get skyS() { return skyS; }, get ribS() { return ribS; }, get lanGrid() { return lanGrid; }, invalidateSky: () => { skyKey = ''; emberN = -1; }, get entered() { return entered; }, get state() { return st; }, select, setT, runPreset, perf});

const dataProvider = {
  title: 'Stars & beyond data', short: 'stars', noun: 'objects', unit: 'sample alerts', bundled: sync.BUNDLED,
  counts: () => ({ nobj: N, nunit: NA, tmax: S.meta.mjdRange[1] }),
  info: () => lastInfo,
  refreshText: 'Check the objects already here for new alerts',
  refreshHint: () => `(${fmtN(N)}, about ${Math.ceil(N / 100)} requests, then one per 20 changed objects)`,
  extraText: 'Add new objects, most recently seen first', extraAria: 'Number of new objects',
  note: `Also fetches the newest nightly statistics for the ribbon. New objects come from the same ${QUERIES.tags} Fink tag and ${QUERIES.classes} catalogue-class queries the build script uses, with Fink’s per-object summary; their distances come only from TNS redshifts and host galaxies (no Gaia lookup). Requests go straight to api.lsst.fink-portal.org, 3 at a time, with retries. Everything is kept in this browser (IndexedDB), apart from the asteroids; the bundled data is never changed.`,
  doneExtra: (info) => info.changed ? `, ${fmtN(info.changed)} objects had new alerts` : '',
  async update(opts) {
    const info = await sync.update(opts);
    opts.onMerge();
    await sync.loadStored();
    rebuildData();
    lastInfo = info;
    return info;
  },
  async storage() {
    const st = await sync.storageInfo();
    return `Stored in this browser for stars: ${fmtN(st.rows)} alert points, ${fmtN(st.objects)} object summaries, ${fmtBytes(st.usage)} used in all.`;
  },
  reset: () => sync.reset(),
};
registerData('stars', dataProvider);
