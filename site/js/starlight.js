export const STAR_NIGHT = [[-0.4, 155, 176, 255], [0, 172, 192, 255], [0.35, 205, 217, 255], [0.6, 246, 245, 255], [0.82, 255, 243, 230], [1.1, 255, 222, 182], [1.5, 255, 197, 138], [2.0, 255, 171, 98], [2.8, 255, 140, 72], [4.6, 255, 104, 58]];
export const STAR_DAY = [[-0.4, 38, 84, 205], [0, 52, 100, 212], [0.35, 84, 118, 196], [0.6, 118, 120, 146], [0.82, 170, 134, 58], [1.2, 194, 118, 40], [1.8, 198, 92, 34], [2.6, 182, 68, 34], [4.6, 146, 42, 34]];
const NEUTRAL_NIGHT = [236, 228, 206], NEUTRAL_DAY = [96, 92, 84];
export const NB = 14;
const B0 = -0.4, B1 = 3.2;
const LUT = 64;
const MAX_HZ = 3;

export function lerpStops(stops, c) {
  if (c <= stops[0][0]) return stops[0].slice(1);
  for (let k = 1; k < stops.length; k++) {
    if (c <= stops[k][0]) { const a = stops[k - 1], b = stops[k], u = (c - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]; }
  }
  return stops[stops.length - 1].slice(1);
}
export const bucketOf = (bpRp) => bpRp == null || !Number.isFinite(bpRp) ? NB : Math.max(0, Math.min(NB - 1, Math.round((bpRp - B0) / (B1 - B0) * (NB - 1))));
const bucketColour = (k, dark) => k === NB ? (dark ? NEUTRAL_NIGHT : NEUTRAL_DAY) : lerpStops(dark ? STAR_NIGHT : STAR_DAY, B0 + k / (NB - 1) * (B1 - B0));
export const gToBpRp = (gr) => 0.25 + 1.3 * gr;

export function makeAtlas(dark, gold) {
  const S = 64, h = S / 2;
  const core = [], spiked = [];
  for (let k = 0; k <= NB; k++) {
    const [r, g, b] = bucketColour(k, dark).map(Math.round);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), gr = x.createRadialGradient(h, h, 0, h, h, h);
    if (dark) {
      gr.addColorStop(0, 'rgba(255,253,245,1)'); gr.addColorStop(0.12, `rgba(${r},${g},${b},0.95)`);
      gr.addColorStop(0.32, `rgba(${r},${g},${b},0.32)`); gr.addColorStop(0.62, `rgba(${r},${g},${b},0.08)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    } else {
      gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.2, `rgba(${r},${g},${b},0.85)`);
      gr.addColorStop(0.45, `rgba(${r},${g},${b},0.22)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    }
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    core.push(c);
    const sp = document.createElement('canvas'); sp.width = sp.height = S;
    const y = sp.getContext('2d');
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const lg = y.createLinearGradient(h - dx * h, h - dy * h, h + dx * h, h + dy * h);
      lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, gold); lg.addColorStop(1, 'rgba(0,0,0,0)');
      y.strokeStyle = lg; y.globalAlpha = dark ? 0.75 : 0.6; y.lineWidth = 0.9;
      y.beginPath(); y.moveTo(h - dx * h, h - dy * h); y.lineTo(h + dx * h, h + dy * h); y.stroke();
    }
    y.globalAlpha = 1; y.drawImage(c, 0, 0);
    spiked.push(sp);
  }
  return { core, spiked, dark };
}

function solve(A, b, n) {
  for (let i = 0; i < n; i++) {
    let pv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r * n + i]) > Math.abs(A[pv * n + i])) pv = r;
    if (pv !== i) { for (let c = 0; c < n; c++) { const t = A[i * n + c]; A[i * n + c] = A[pv * n + c]; A[pv * n + c] = t; } const t = b[i]; b[i] = b[pv]; b[pv] = t; }
    const d = A[i * n + i] || 1e-12;
    for (let r = i + 1; r < n; r++) { const f = A[r * n + i] / d; if (f) { for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c]; b[r] -= f * b[i]; } }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i * n + c] * x[c]; x[i] = s / (A[i * n + i] || 1e-12); }
  return x;
}
const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

function foldShape(lc, P, OFF) {
  const pts = [];
  for (let b = 0; b < 6; b++) {
    const ks = []; for (let k = 0; k < lc.t.length; k++) if (lc.b[k] === b && lc.f[k] != null) ks.push(k);
    if (ks.length < 4) continue;
    const v = ks.map((k) => lc.f[k]), med = pct(v, 0.5), rng = pct(v, 0.95) - pct(v, 0.05);
    if (!(rng > 0)) continue;
    for (const k of ks) pts.push([(((lc.t[k] + OFF) / P) % 1 + 1) % 1, (lc.f[k] - med) / rng]);
  }
  if (pts.length < 10) return null;
  const H = Math.max(1, Math.min(4, Math.floor((pts.length - 1) / 5))), n = 2 * H + 1;
  const A = new Float64Array(n * n), bb = new Float64Array(n), row = new Float64Array(n);
  for (const [ph, y] of pts) {
    const a = 2 * Math.PI * ph; row[0] = 1;
    for (let h = 1; h <= H; h++) { row[2 * h - 1] = Math.cos(h * a); row[2 * h] = Math.sin(h * a); }
    for (let i = 0; i < n; i++) { bb[i] += row[i] * y; for (let j = 0; j < n; j++) A[i * n + j] += row[i] * row[j]; }
  }
  for (let i = 0; i < n; i++) A[i * n + i] += 1e-6;
  const cf = solve(A, bb, n), out = new Float32Array(LUT);
  for (let s = 0; s < LUT; s++) {
    const a = 2 * Math.PI * s / LUT; let v = cf[0];
    for (let h = 1; h <= H; h++) v += cf[2 * h - 1] * Math.cos(h * a) + cf[2 * h] * Math.sin(h * a);
    out[s] = v;
  }
  let lo = Infinity, hi = -Infinity; for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi - lo > 1e-6)) return null;
  for (let s = 0; s < LUT; s++) out[s] = (out[s] - lo) / (hi - lo);
  return out;
}
function alignToPeak(l) {
  let m = 0; for (let s = 1; s < LUT; s++) if (l[s] > l[m]) m = s;
  const o = new Float32Array(LUT); for (let s = 0; s < LUT; s++) o[s] = l[(s + m) % LUT];
  return o;
}

export function buildPulses(S, FKEY, OFF) {
  const Ob = S.objects, N = Ob.id.length;
  const P = new Float64Array(N), own = new Uint8Array(N), lut = new Array(N).fill(null), phase0 = new Float32Array(N);
  const rubin = new Map(), fp = new Map();
  for (const f of S.featured) { if (f.periodRubin && f.periodRubin.reliable) rubin.set(f.o, f.periodRubin.period); if (f.fp && f.fp.t.length >= 10) fp.set(f.o, f.fp); }
  const famSum = new Map(), famN = new Map();
  for (let i = 0; i < N; i++) {
    const p = Ob.period[i] || rubin.get(i) || 0;
    if (!(p > 0)) continue;
    P[i] = p;
    const lc = Ob.lc[i] >= 0 ? S.lcs[Ob.lc[i]] : null;
    const sh = (fp.has(i) ? foldShape(fp.get(i), p, OFF) : null) || (lc ? foldShape(lc, p, OFF) : null);
    if (sh) {
      lut[i] = sh; own[i] = 1;
      const fk = FKEY[Ob.fam[i]], al = alignToPeak(sh);
      if (!famSum.has(fk)) { famSum.set(fk, new Float32Array(LUT)); famN.set(fk, 0); }
      const acc = famSum.get(fk); for (let s = 0; s < LUT; s++) acc[s] += al[s]; famN.set(fk, famN.get(fk) + 1);
    }
  }
  let generic = null;
  for (let i = 0; i < N; i++) {
    if (!P[i] || lut[i]) continue;
    const fk = FKEY[Ob.fam[i]];
    let tpl = famSum.has(fk) ? famSum.get(fk).map((v) => v / famN.get(fk)) : null;
    if (!tpl) { if (!generic) { generic = new Float32Array(LUT); for (let s = 0; s < LUT; s++) generic[s] = 0.5 + 0.5 * Math.cos(2 * Math.PI * s / LUT); } tpl = generic; }
    let lo = Infinity, hi = -Infinity; for (const v of tpl) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    lut[i] = tpl.map((v) => (v - lo) / ((hi - lo) || 1));
    let hsh = 0; const id = Ob.id[i]; for (let k = 0; k < id.length; k++) hsh = (hsh * 31 + id.charCodeAt(k)) % 9973;
    phase0[i] = hsh / 9973;
  }
  const list = []; for (let i = 0; i < N; i++) if (P[i]) list.push(i);
  return { P, own, lut, phase0, list };
}

export function pulseLevel(pl, i, tauDays, secPerDay) {
  const p = pl.P[i];
  if (!p || !secPerDay) return 1;
  if (1 / (p * secPerDay) > MAX_HZ) return -1;
  const ph = ((tauDays / p + pl.phase0[i]) % 1 + 1) % 1, x = ph * LUT, k = Math.floor(x) % LUT, u = x - Math.floor(x);
  const l = pl.lut[i];
  return l[k] * (1 - u) + l[(k + 1) % LUT] * u;
}

export function flickerAmps(S, list) {
  const Ob = S.objects, out = new Map();
  for (const i of list) {
    const lc = Ob.lc[i] >= 0 ? S.lcs[Ob.lc[i]] : null;
    if (!lc || lc.f.length < 8) continue;
    const ss = lc.s.filter((x) => x != null && x > 0), base = ss.length ? pct(ss, 0.5) : null;
    const f = lc.f.filter((x) => x != null);
    const m = f.reduce((a, b) => a + b, 0) / f.length, sd = Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / f.length);
    const rel = base ? sd / base : 0.2;
    out.set(i, Math.max(0.05, Math.min(0.6, rel)));
  }
  return out;
}

export function colourTrack(S, i) {
  const lc = S.objects.lc[i] >= 0 ? S.lcs[S.objects.lc[i]] : null;
  if (!lc) return null;
  const g = [], r = [];
  for (let k = 0; k < lc.t.length; k++) { if (lc.s[k] == null || lc.s[k] <= 0) continue; if (lc.b[k] === 1) g.push([lc.t[k], lc.s[k]]); if (lc.b[k] === 2) r.push([lc.t[k], lc.s[k]]); }
  if (g.length < 2 || r.length < 2) return null;
  const tr = [];
  for (const [t, fg] of g) {
    let best = null; for (const q of r) if (!best || Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q;
    if (best && Math.abs(best[0] - t) < 1.5) tr.push([t, gToBpRp(-2.5 * Math.log10(fg / best[1]))]);
  }
  return tr.length >= 2 ? tr.sort((a, b) => a[0] - b[0]) : null;
}
export function trackAt(tr, t) {
  if (t <= tr[0][0]) return tr[0][1];
  for (let k = 1; k < tr.length; k++) if (t <= tr[k][0]) { const a = tr[k - 1], b = tr[k], u = (t - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * u; }
  return tr[tr.length - 1][1];
}
