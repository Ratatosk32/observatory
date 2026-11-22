import { openStore, post, pool, monthsSince, storageUsage, persistOnce, CONCURRENCY } from './net.js';

const idb = openStore('rubin-viz', ['rows', 'nights', 'meta', 'stamps']);
export const resetStore = () => idb.clearAll();

export function createSync(R) {

const SSO_COLS = 'r:designation,r:midpointMjdTai,r:band,r:ra,r:dec,r:helio_x,r:helio_y,r:helio_z,r:helio_vx,r:helio_vy,r:helio_vz,r:topoRange,r:psfFlux,r:psfFluxErr,r:diaSourceId';
const BATCH = 50;
const MJD_OFF = 60000;
const AU_KM = 149597870.7;
const K2 = 0.01720209895 ** 2;
const EPS = 23.439281 * Math.PI / 180;
const BANDS = 'ugrizy';
const G_FIXED = 0.15;
const DEG = 180 / Math.PI;

function eq2ecl(x, y, z) { return [x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS)]; }
function unit(ra, dec) { const r = ra / DEG, d = dec / DEG; return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)]; }
function observerOk(r) {
  if (!r.tr || r.ra == null) return false;
  const [ux, uy, uz] = unit(r.ra, r.dec);
  const d = Math.hypot(r.hx - r.tr * ux, r.hy - r.tr * uy, r.hz - r.tr * uz);
  return d > 0.975 && d < 1.025;
}
function elements(r, vkms) {
  const v = vkms.map((c) => c * 86400 / AU_KM);
  const rn = Math.hypot(...r), v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const a = 1 / (2 / rn - v2 / K2);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hn = Math.hypot(...h);
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const ev = [0, 1, 2].map((k) => ((v2 - K2 / rn) * r[k] - rv * v[k]) / K2);
  const e = Math.hypot(...ev);
  if (e < 1e-9 || e >= 1 || a <= 0) return null;
  const inc = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const node = Math.atan2(h[0], -h[1]);
  const nv = [Math.cos(node), Math.sin(node), 0];
  let w = Math.acos(Math.max(-1, Math.min(1, (nv[0] * ev[0] + nv[1] * ev[1]) / e)));
  if (ev[2] < 0) w = 2 * Math.PI - w;
  let nu = Math.acos(Math.max(-1, Math.min(1, (ev[0] * r[0] + ev[1] * r[1] + ev[2] * r[2]) / (e * rn))));
  if (rv < 0) nu = 2 * Math.PI - nu;
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = ((E - e * Math.sin(E)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return { a, e, i: inc * DEG, node: ((node * DEG) % 360 + 360) % 360, peri: (w * DEG) % 360, M: M * DEG };
}
function orbitClass(a, e, i) {
  const q = a * (1 - e);
  if (q < 1.3) return 'NEO';
  if (q < 1.666 && a < 3.2) return 'MC';
  if (a > 1.78 && a < 2.06 && e < 0.18 && i > 16) return 'HUN';
  if (a < 2.06) return 'OTH';
  if (a < 3.28) return 'MBA';
  if (a < 3.7) return 'CYB';
  if (a < 4.2 && e < 0.3) return 'HIL';
  if (a > 5.05 && a < 5.35) return 'TRO';
  return 'OTH';
}
function hgPhi(alpha, G) {
  const t = Math.tan(alpha / DEG / 2);
  return (1 - G) * Math.exp(-3.33 * t ** 0.63) + G * Math.exp(-1.87 * t ** 1.22);
}
const r5 = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function compact(r) {
  return {
    n: r['f:sso_name'] || r['r:designation'], des: r['r:designation'], t: r['r:midpointMjdTai'], b: r['r:band'],
    ra: r['r:ra'], dec: r['r:dec'], hx: r['r:helio_x'], hy: r['r:helio_y'], hz: r['r:helio_z'],
    vx: r['r:helio_vx'], vy: r['r:helio_vy'], vz: r['r:helio_vz'], tr: r['r:topoRange'],
    f: r['r:psfFlux'], fe: r['r:psfFluxErr'], sid: r['r:diaSourceId'] != null ? String(r['r:diaSourceId']) : null,
  };
}
const rowKey = (r) => `${r.n}|${r.t.toFixed(6)}|${r.b}`;
const detKey = (t5, band) => `${t5.toFixed(5)}|${band}`;

function detFromRow(r) {
  const geom = observerOk(r);
  const band = BANDS.indexOf(r.b);
  let mag = null, merr = null, red = null, alpha = null;
  const rh = Math.hypot(r.hx, r.hy, r.hz);
  if (geom) {
    const [ux, uy, uz] = unit(r.ra, r.dec);
    const o = [r.hx - r.tr * ux, r.hy - r.tr * uy, r.hz - r.tr * uz];
    const ca = (-r.hx * (o[0] - r.hx) - r.hy * (o[1] - r.hy) - r.hz * (o[2] - r.hz)) / (rh * r.tr);
    alpha = Math.acos(Math.max(-1, Math.min(1, ca))) * DEG;
  }
  if (r.f && r.f > 0) {
    mag = 31.4 - 2.5 * Math.log10(r.f);
    if (r.fe && r.fe > 0) merr = 1.0857 * r.fe / r.f;
    if (geom) red = mag - 5 * Math.log10(rh * r.tr);
  }
  const [ex, ey] = eq2ecl(r.hx, r.hy, r.hz);
  return [r5(r.t - MJD_OFF, 5), band < 0 ? -1 : band, mag == null ? null : r5(mag, 2), merr == null ? null : r5(merr, 2),
    geom ? r5(alpha, 1) : null, red == null ? null : r5(red, 2), geom ? r5(ex, 3) : null, geom ? r5(ey, 3) : null];
}

function derive(o) {
  o.det.sort((a, b) => a[0] - b[0]);
  const perBand = {};
  for (const d of o.det) {
    if (d[5] == null || d[1] < 0 || d[4] == null) continue;
    (perBand[BANDS[d[1]]] ||= []).push(d[5] + 2.5 * Math.log10(hgPhi(d[4], G_FIXED)));
  }
  o.H = {};
  for (const b in perBand) o.H[b] = r5(median(perBand[b]), 2);
  const pairs = { gr: [1, 2], ri: [2, 3], iz: [3, 4] };
  const col = {};
  for (const k in pairs) {
    const [b1, b2] = pairs[k];
    const d1 = o.det.filter((d) => d[1] === b1 && d[5] != null), d2 = o.det.filter((d) => d[1] === b2 && d[5] != null);
    const vals = [];
    for (const x of d1) {
      let best = null;
      for (const y of d2) if (!best || Math.abs(y[0] - x[0]) < Math.abs(best[0] - x[0])) best = y;
      if (best && Math.abs(best[0] - x[0]) < 0.1 && (x[3] ?? 1) < 0.1 && (best[3] ?? 1) < 0.1) vals.push(x[5] - best[5]);
    }
    if (vals.length) col[k] = r5(median(vals), 3);
  }
  if (Object.keys(col).length) o.col = col; else delete o.col;
  o.nn = new Set(o.det.map((d) => Math.floor(d[0] + MJD_OFF - 0.5))).size;
  o.c = orbitClass(o.el[0], o.el[1], o.el[2]);
}

function elFromRow(r) {
  const el = elements(eq2ecl(r.hx, r.hy, r.hz), eq2ecl(r.vx, r.vy, r.vz));
  if (!el) return null;
  return [r5(el.a, 4), r5(el.e, 4), r5(el.i, 3), r5(el.node, 3), r5(el.peri, 3), r5(el.M, 3), r5(r.t, 4)];
}

function mjdToIso(m) { return new Date((m - 40587) * 864e5).toISOString().slice(0, 10); }

function merge(R, rows, nights) {
  const idx = new Map();
  R.objs.forEach((o) => { idx.set(o.n, o); if (o.des) idx.set(o.des, o); });
  const groups = new Map();
  for (const r of rows) {
    if (r.hx == null || r.t == null) continue;
    const o = idx.get(r.n) || (r.des && idx.get(r.des));
    const key = o ? o.n : r.n;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  let added = 0, newObjs = 0, updated = 0;
  for (const [name, rs] of groups) {
    rs.sort((a, b) => a.t - b.t);
    let o = idx.get(name);
    const good = rs.filter(observerOk);
    if (!o) {
      const last = good[good.length - 1];
      const el = last && elFromRow(last);
      if (!el) continue;
      o = { n: name, c: 'OTH', el, H: {}, nn: 0, det: [] };
      if (last.des && last.des !== name) o.des = last.des;
      R.objs.push(o); idx.set(name, o); newObjs++;
    }
    const have = new Set(o.det.map((d) => detKey(d[0], d[1])));
    let n = 0;
    for (const r of rs) {
      const d = detFromRow(r);
      const k = detKey(d[0], d[1]);
      if (have.has(k)) continue;
      have.add(k); o.det.push(d); n++;
    }
    const last = good[good.length - 1];
    if (last && last.t > o.el[6] + 1e-6) { const el = elFromRow(last); if (el) o.el = el; }
    if (n) { added += n; if (o.det.length > n) updated++; }
    derive(o);
  }
  R.objs.sort((a, b) => a.el[0] - b.el[0]);
  if (nights && nights.length) {
    const m = new Map(R.nights.map((x) => [x[0], x]));
    for (const x of nights) m.set(x[0], x);
    R.nights = [...m.values()].sort((a, b) => a[0] - b[0]);
  }
  const ts = R.objs.flatMap((o) => o.det.map((d) => d[0] + MJD_OFF));
  const meta = R.meta;
  meta.nobj = R.objs.length;
  meta.ndet = ts.length;
  meta.tmin = Math.min(...ts); meta.tmax = Math.max(...ts);
  meta.dmin = mjdToIso(meta.tmin); meta.dmax = mjdToIso(meta.tmax);
  const bands = {}, classes = {};
  for (const o of R.objs) { classes[o.c] = (classes[o.c] || 0) + 1; for (const d of o.det) if (d[1] >= 0) bands[BANDS[d[1]]] = (bands[BANDS[d[1]]] || 0) + 1; }
  meta.bands = bands; meta.classes = classes;
  return { added, newObjs, updated };
}

const BUNDLED = JSON.parse(JSON.stringify({ nobj: R.meta.nobj, ndet: R.meta.ndet, tmax: R.meta.tmax, nights: R.nights.length }));

async function loadStored() {
  try {
    const rows = await idb.getAll('rows');
    const nights = await idb.getAll('nights');
    const info = await idb.get('meta', 'info');
    if (!rows.length && !nights.length) return { info: info || null, stats: null };
    const stats = merge(R, rows, nights);
    return { info: info || null, stats };
  } catch (e) {
    return { info: null, stats: null, error: e };
  }
}

async function fetchNames(signal) {
  const out = await post('ssoft', { columns: 'sso_name,last_jd,n_obs', 'output-format': 'json' }, { signal, timeout: 120000 });
  return Array.isArray(out) ? out : [];
}

async function update({ refresh = true, extra = 0, onProgress = () => {}, signal }) {
  const report = { batches: 0, done: 0, failed: 0, rows: 0, nights: 0, names: 0 };
  const progress = (msg) => onProgress({ ...report, msg });
  const lastNight = R.nights.length ? R.nights[R.nights.length - 1][0] : 20260101;
  progress('Nightly statistics');
  const nightRows = [];
  for (const mo of monthsSince(lastNight)) {
    try {
      const st = await post('statistics', { date: mo, columns: 'f:night,f:alerts,f:is_sso' }, { signal, timeout: 60000, retries: 2 });
      if (Array.isArray(st)) for (const x of st) nightRows.push([+x['f:night'], +(x['f:alerts'] || 0), +(x['f:is_sso'] || 0)]);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      report.failed++;
    }
  }
  if (nightRows.length) { await idb.putMany('nights', nightRows.map((x) => [x[0], x])); report.nights = nightRows.length; }
  const names = refresh ? R.objs.map((o) => o.n) : [];
  if (extra > 0) {
    progress('Choosing new asteroids from SSOFT');
    const have = new Set(R.objs.flatMap((o) => (o.des ? [o.n, o.des] : [o.n])));
    const pool0 = (await fetchNames(signal)).filter((x) => x.sso_name && !have.has(x.sso_name) && (x.n_obs || 0) >= 4);
    pool0.sort((a, b) => (b.last_jd || 0) - (a.last_jd || 0));
    const fresh = pool0.slice(0, extra).map((x) => x.sso_name);
    report.names = fresh.length;
    names.push(...fresh);
  }
  const batches = [];
  for (let i = 0; i < names.length; i += BATCH) batches.push(names.slice(i, i + BATCH));
  report.batches = batches.length;
  progress('Fetching detections');
  const tasks = batches.map((b) => async () => {
    try {
      const out = await post('sso', { n_or_d: b.join(','), columns: SSO_COLS }, { signal });
      if (!Array.isArray(out)) throw new Error('unexpected reply');
      const rows = out.map(compact).filter((r) => r.n && r.t != null && r.hx != null);
      await idb.putMany('rows', rows.map((r) => [rowKey(r), r]));
      report.rows += rows.length;
    } catch (e) {
      if (e.name === 'AbortError') return;
      report.failed++;
    }
    report.done++;
    progress('Fetching detections');
  });
  await pool(tasks, CONCURRENCY, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const info = { at: Date.now(), ...report };
  await idb.put('meta', 'info', info);
  return info;
}

async function storageInfo() {
  const out = { rows: 0, stamps: 0, usage: await storageUsage() };
  try { out.rows = await idb.count('rows'); out.stamps = await idb.count('stamps'); } catch {}
  return out;
}

async function cutouts(name, signal) {
  try {
    const cached = await idb.get('stamps', name);
    if (cached) return cached;
  } catch {}
  const rows = await post('sso', { n_or_d: name, columns: 'r:diaSourceId,r:midpointMjdTai,r:band,r:topoRange' }, { signal, retries: 2 });
  if (!Array.isArray(rows) || !rows.length) throw new Error('no alerts for this object');
  rows.sort((a, b) => b['r:midpointMjdTai'] - a['r:midpointMjdTai']);
  const r = rows[0], id = String(r['r:diaSourceId']);
  const kinds = ['Science', 'Template', 'Difference'];
  const blobs = [];
  for (const kind of kinds) blobs.push(await post('cutouts', { diaSourceId: id, kind }, { signal, as: 'blob', retries: 2 }));
  const rec = { name, id, t: r['r:midpointMjdTai'], band: r['r:band'], dist: r['r:topoRange'], science: blobs[0], template: blobs[1], difference: blobs[2] };
  try { await idb.put('stamps', name, rec); } catch {}
  return rec;
}

return { loadStored, update, storageInfo, persistOnce, reset: resetStore, cutouts, BUNDLED, ready: loadStored() };
}
