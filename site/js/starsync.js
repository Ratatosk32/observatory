import { openStore, post, pool, monthsSince, storageUsage, CONCURRENCY } from './net.js';

const idb = openStore('observatory-stars', ['points', 'objects', 'nights', 'meta']);
export const resetStore = () => idb.clearAll();

const BANDS = 'ugrizy';
const ZP = 31.4;
const OBJ_BATCH = 100;
const SRC_BATCH = 20;
const TAG_WINDOW_DAYS = 30;
const ALERT_COLS = [
  'r:diaObjectId', 'r:diaSourceId', 'r:midpointMjdTai', 'r:band', 'r:psfFlux', 'r:psfFluxErr', 'r:scienceFlux', 'r:observation_reason',
  'f:xm_vsx_Type', 'f:xm_simbad_otype', 'f:xm_tns_fullname', 'f:xm_tns_type', 'f:xm_tns_redshift',
  'f:xm_mangrove_lum_dist', 'f:xm_legacydr8_zphot', 'f:xm_legacydr8_pstar',
].join(',');
const OBJECT_COLS = ['r:diaObjectId', 'r:ra', 'r:dec', 'r:nDiaSources', 'r:firstDiaSourceMjdTai', 'r:lastDiaSourceMjdTai',
  ...[...BANDS].map((b) => `r:${b}_psfFluxNdata`), ...[...BANDS].map((b) => `r:${b}_scienceFluxMean`)].join(',');
const SOURCE_COLS = 'r:diaObjectId,r:diaSourceId,r:midpointMjdTai,r:band,r:psfFlux,r:psfFluxErr,r:scienceFlux';
const STAT_COLS = ['f:night', 'f:alerts', 'f:visits', 'f:objects', 'f:is_first', 'f:is_sso', 'f:in_tns', ...[...BANDS].map((b) => `f:alerts_${b}`)].join(',');

const FAMILIES = {
  rrlyr: ['VSX/RRAB', 'VSX/RRC', 'VSX/RRD', 'VSX/RR', 'VSX/RRAB/BL', 'SIMBAD/RR*'],
  ceph: ['VSX/DCEP', 'VSX/CEP', 'VSX/CWA', 'VSX/CWB', 'VSX/ACEP', 'SIMBAD/cC*', 'SIMBAD/Ce*'],
  dsct: ['VSX/DSCT', 'VSX/HADS', 'VSX/SXPHE', 'SIMBAD/dS*'],
  lpv: ['VSX/M', 'VSX/SR', 'VSX/LPV', 'VSX/SRS', 'VSX/L', 'SIMBAD/Mi*', 'SIMBAD/LP*'],
  ecl: ['VSX/EA', 'VSX/EB', 'VSX/EW', 'VSX/E', 'VSX/ELL', 'SIMBAD/EB*'],
  active: ['VSX/UV', 'VSX/BY', 'VSX/RS', 'VSX/ROT', 'SIMBAD/Er*', 'SIMBAD/BY*', 'SIMBAD/RS*', 'SIMBAD/Ro*'],
  yso: ['VSX/YSO', 'VSX/CTTS', 'SIMBAD/Or*', 'SIMBAD/Y*O'],
  cv: ['VSX/UG', 'VSX/UGSU', 'VSX/UGWZ', 'VSX/NL', 'VSX/CV', 'VSX/AM', 'VSX/DQ', 'SIMBAD/CV*', 'SIMBAD/No*', 'TNS/CV'],
  star: ['SIMBAD/*', 'SIMBAD/V*', 'SIMBAD/WD*', 'SIMBAD/PM*', 'SIMBAD/HB*', 'VSX/VAR', 'VSX/MISC'],
  sn: ['TNS/SN', 'TNS/SN Ia', 'TNS/SN Ia-91T-like', 'TNS/SN Ia-pec', 'TNS/SN Ia-CSM', 'TNS/SN Ia-SC',
    'TNS/SN II', 'TNS/SN IIP', 'TNS/SN IIb', 'TNS/SN IIn', 'TNS/SN Ib', 'TNS/SN Ib/c', 'TNS/SN Ibn',
    'TNS/SN Ic', 'TNS/SN Ic-BL', 'TNS/SLSN-I', 'TNS/SLSN-II', 'SIMBAD/SN*'],
  tde: ['TNS/TDE', 'TNS/TDE-H-He'],
  agn: ['TNS/AGN', 'VSX/AGN', 'VSX/BLLAC', 'SIMBAD/QSO', 'SIMBAD/AGN', 'SIMBAD/Sy1', 'SIMBAD/Sy2',
    'SIMBAD/BLL', 'SIMBAD/Bla', 'SIMBAD/Q?'],
};
const TAGS = ['in_tns', 'most_likely_sn', 'mdwarf_flare', 'sn_near_galaxy_candidate',
  'extragalactic_new_candidate', 'extragalactic_lt20mag_candidate', 'hostless_candidate'];
const CLASS_FAMILY = new Map(Object.entries(FAMILIES).flatMap(([fam, cs]) => cs.map((c) => [c, fam])));
export const QUERIES = { tags: TAGS.length, classes: CLASS_FAMILY.size };
const STELLAR = new Set(['rrlyr', 'ceph', 'dsct', 'lpv', 'ecl', 'active', 'yso', 'cv', 'star']);
const CLOUDS = [[80.89, -69.76, 8.0, 49590.0, 0.022], [13.19, -72.83, 4.0, 62440.0, 0.03]];
const H0 = 70, OM = 0.3, PHOTOZ_MAX = 1.0, R_SUN_KPC = 8.178, Z_SUN_KPC = 0.0208;
const GAL = [[-0.0548755604162154, -0.873437090234885, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
const RAD = Math.PI / 180;

const rnd = (x, k) => x == null ? null : Math.round(x * 10 ** k) / 10 ** k;
const nightKey = (mjd) => Math.floor(mjd - 0.5);
const mag = (f) => f > 0 ? ZP - 2.5 * Math.log10(f) : null;
const isoOf = (mjd) => new Date((mjd - 40587) * 864e5).toISOString().slice(0, 10);
const todayMjd = () => Date.now() / 864e5 + 40587;
function clean(v) {
  if (v == null) return null;
  if (typeof v === 'string' && ['', 'nan', 'Fail', 'None', 'Unknown'].includes(v.trim())) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}
function num(v) {
  v = clean(v);
  if (v == null) return null;
  const f = +v;
  return Number.isFinite(f) ? f : null;
}
function galactic(ra, dec) {
  const a = ra * RAD, d = dec * RAD, v = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = GAL.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return [((Math.atan2(g[1], g[0]) / RAD) % 360 + 360) % 360, Math.asin(Math.max(-1, Math.min(1, g[2]))) / RAD];
}
function sepDeg(ra1, d1, ra2, d2) {
  const c = Math.sin(d1 * RAD) * Math.sin(d2 * RAD) + Math.cos(d1 * RAD) * Math.cos(d2 * RAD) * Math.cos((ra1 - ra2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}
function integrate(z, fn) {
  const n = 400;
  let s = 0;
  for (let k = 0; k <= n; k++) { const zz = z * k / n; s += (k === 0 || k === n ? 0.5 : 1) * fn(zz); }
  return s * z / n;
}
const lumDistPc = (z) => 299792.458 / H0 * integrate(z, (zz) => 1 / Math.sqrt(OM * (1 + zz) ** 3 + 1 - OM)) * (1 + z) * 1e6;
const lookbackGyr = (z) => 977.792 / H0 * integrate(z, (zz) => 1 / ((1 + zz) * Math.sqrt(OM * (1 + zz) ** 3 + 1 - OM)));
function galactocentric(l, b, pc) {
  const d = pc / 1000;
  return [rnd(d * Math.cos(b * RAD) * Math.cos(l * RAD) - R_SUN_KPC, 3), rnd(d * Math.cos(b * RAD) * Math.sin(l * RAD), 3), rnd(d * Math.sin(b * RAD) + Z_SUN_KPC, 3)];
}

function familyOf(row) {
  const tns = clean(row['f:xm_tns_type']);
  if (tns) {
    if (CLASS_FAMILY.has('TNS/' + tns)) return CLASS_FAMILY.get('TNS/' + tns);
    if (tns.startsWith('SN') || tns.startsWith('SLSN')) return 'sn';
    if (tns.startsWith('TDE')) return 'tde';
  }
  const vsx = clean(row['f:xm_vsx_Type']);
  if (vsx && CLASS_FAMILY.has('VSX/' + vsx)) return CLASS_FAMILY.get('VSX/' + vsx);
  const simbad = clean(row['f:xm_simbad_otype']);
  if (simbad && CLASS_FAMILY.has('SIMBAD/' + simbad)) return CLASS_FAMILY.get('SIMBAD/' + simbad);
  if (row._class && CLASS_FAMILY.has(row._class)) return CLASS_FAMILY.get(row._class);
  if (row._tag === 'mdwarf_flare') return 'active';
  if (row._tag === 'most_likely_sn' || row._tag === 'sn_near_galaxy_candidate') return 'sncand';
  return 'unk';
}

function point(r) {
  const t = num(r['r:midpointMjdTai']), f = num(r['r:psfFlux']);
  if (t == null || f == null || !BANDS.includes(r['r:band']) || r['r:diaSourceId'] == null) return null;
  return { o: String(r['r:diaObjectId']), s: String(r['r:diaSourceId']), t, b: r['r:band'], f, fe: num(r['r:psfFluxErr']), sf: num(r['r:scienceFlux']) };
}

function summary(o) {
  const means = [...BANDS].map((b) => mag(num(o[`r:${b}_scienceFluxMean`])));
  const ndet = [...BANDS].map((b) => Math.round(num(o[`r:${b}_psfFluxNdata`]) || 0));
  let ref = 0;
  for (let k = 1; k < 6; k++) if ((means[k] != null) > (means[ref] != null) || ((means[k] != null) === (means[ref] != null) && ndet[k] > ndet[ref])) ref = k;
  return {
    id: String(o['r:diaObjectId']), ra: num(o['r:ra']), dec: num(o['r:dec']),
    t0: num(o['r:firstDiaSourceMjdTai']), t1: num(o['r:lastDiaSourceMjdTai']), nDet: Math.round(num(o['r:nDiaSources']) || 0),
    nDetBand: ndet, meanMag: means.map((m) => rnd(m, 1)), refBand: ref,
  };
}

function describe(sum, rows) {
  let fam = 'unk', rank = -1;
  const xm = {}, tags = new Set();
  for (const r of rows) {
    const f = familyOf(r), score = f === 'unk' || f === 'sncand' ? 0 : 1;
    if (score > rank) { fam = f; rank = score; }
    if (r._tag) tags.add(r._tag);
    for (const k in r) if (k.startsWith('f:xm_') && clean(r[k]) != null && !(k in xm)) xm[k] = r[k];
  }
  const reason = rows.map((r) => r['r:observation_reason']).find((x) => x) || '';
  const tnsType = clean(xm['f:xm_tns_type']), vsx = clean(xm['f:xm_vsx_Type']), simbad = clean(xm['f:xm_simbad_otype']);
  const cat = tnsType ? `TNS ${tnsType}` : vsx ? `VSX ${vsx}` : simbad ? `SIMBAD ${simbad}` : tags.size ? 'Fink tag ' + [...tags].sort().join(',') : '';
  let dist = null, lo = null, hi = null, method = null, z = null, zSrc = '';
  if (STELLAR.has(fam)) {
    for (const [cra, cdec, rad, dpc, frac] of CLOUDS) {
      if (sepDeg(sum.ra, sum.dec, cra, cdec) < rad) { method = 'cloud_member'; dist = dpc; lo = dpc * (1 - frac); hi = dpc * (1 + frac); break; }
    }
  } else {
    const zt = num(xm['f:xm_tns_redshift']), ld = num(xm['f:xm_mangrove_lum_dist']), zp = num(xm['f:xm_legacydr8_zphot']);
    if (zt && zt > 0 && zt < 7) { method = 'tns_redshift'; dist = lumDistPc(zt); lo = dist * 0.97; hi = dist * 1.03; z = zt; zSrc = 'tns'; }
    else if (ld && ld > 0) { method = 'host_galaxy'; dist = ld * 1e6; lo = dist * 0.8; hi = dist * 1.2; }
    else if (zp && zp > 0.005 && zp <= PHOTOZ_MAX && (num(xm['f:xm_legacydr8_pstar']) || 0) < 0.5) { method = 'photo_z'; dist = lumDistPc(zp); lo = lumDistPc(zp * 0.8); hi = lumDistPc(zp * 1.2); z = zp; zSrc = 'photo'; }
  }
  return { ...sum, fam, name: clean(xm['f:xm_tns_fullname']) || '', cat, reason: reason || '', dist, lo, hi, method, z, zSrc };
}

function reasonIndex(reasons, r) {
  r = (r || '').toLowerCase();
  if (!r.startsWith('ddf')) return r ? 0 : reasons.indexOf('other');
  const k = reasons.findIndex((n) => n.startsWith('ddf') && r.startsWith(n));
  return k >= 0 ? k : reasons.indexOf('other');
}

const DEFAULTS = { nDetBand: () => [0, 0, 0, 0, 0, 0], meanMag: () => [null, null, null, null, null, null], name: () => '', periodSrc: () => '', zSrc: () => '', sdssClass: () => '', lc: () => -1, distMethod: () => -1, tSrc: () => 0, catType: () => 0, nDet: () => 0, refBand: () => 0 };

function addObject(S, r) {
  const Ob = S.objects, M = S.meta, OFF = M.mjdOffset;
  const fi = M.families.findIndex((f) => f.key === r.fam);
  if (fi < 0 || r.ra == null || r.dec == null || !(r.ra >= 0 && r.ra < 360 && r.dec >= -90 && r.dec <= 90)) return -1;
  const i = Ob.id.length;
  for (const k of Object.keys(Ob)) Ob[k].push(DEFAULTS[k] ? DEFAULTS[k]() : null);
  const [l, b] = galactic(r.ra, r.dec);
  let ct = M.catTypes.indexOf(r.cat);
  if (ct < 0) { ct = M.catTypes.length; M.catTypes.push(r.cat); }
  Ob.id[i] = r.id; Ob.fam[i] = fi; Ob.ra[i] = rnd(r.ra, 4); Ob.dec[i] = rnd(r.dec, 4); Ob.l[i] = rnd(l, 2); Ob.b[i] = rnd(b, 2);
  Ob.t0[i] = r.t0 == null ? null : rnd(r.t0 - OFF, 4); Ob.t1[i] = r.t1 == null ? null : rnd(r.t1 - OFF, 4);
  Ob.nDet[i] = r.nDet; Ob.nDetBand[i] = r.nDetBand; Ob.meanMag[i] = r.meanMag; Ob.refBand[i] = r.refBand;
  Ob.name[i] = r.name; Ob.catType[i] = ct; Ob.reason[i] = reasonIndex(M.reasons, r.reason);
  if (r.method) {
    Ob.dist[i] = rnd(r.dist, 1); Ob.distLo[i] = rnd(r.lo, 1); Ob.distHi[i] = rnd(r.hi, 1); Ob.distMethod[i] = M.distMethods.indexOf(r.method);
    Ob.z[i] = rnd(r.z, 5); Ob.zSrc[i] = r.zSrc;
    Ob.lookbackGyr[i] = r.z ? rnd(lookbackGyr(r.z), 4) : rnd(r.dist * 3.2616e-9, 9);
    if (STELLAR.has(r.fam)) Ob.gc[i] = galactocentric(l, b, r.dist);
  }
  return i;
}

function binLc(lc, pts, OFF) {
  const w = lc.binDays || 1;
  const key = (mjd, b) => `${Math.floor((mjd - 0.5) / w)}|${b}`;
  const have = new Set(lc.t.flatMap((t, k) => [key(t + OFF - 6e-5, lc.b[k]), key(t + OFF + 6e-5, lc.b[k])]));
  const last = lc.t.length ? Math.max(...lc.t) + OFF : -Infinity;
  const groups = new Map();
  for (const p of pts) {
    if (p.t <= last) continue;
    const k = key(p.t, BANDS.indexOf(p.b));
    if (have.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  let added = 0;
  for (const g of groups.values()) {
    let ws = 0, wf = 0;
    for (const p of g) { const wt = p.fe > 0 ? 1 / p.fe ** 2 : 0; ws += wt; wf += wt * p.f; }
    const f = ws > 0 ? wf / ws : g.reduce((a, p) => a + p.f, 0) / g.length, fe = ws > 0 ? 1 / Math.sqrt(ws) : null;
    const ss = g.map((p) => p.sf).filter((x) => x != null).sort((a, b) => a - b);
    const med = ss.length ? (ss.length % 2 ? ss[ss.length >> 1] : (ss[ss.length / 2 - 1] + ss[ss.length / 2]) / 2) : null;
    lc.t.push(rnd(g.reduce((a, p) => a + p.t, 0) / g.length - OFF, 4)); lc.b.push(BANDS.indexOf(g[0].b));
    lc.f.push(rnd(f, 1)); lc.fe.push(rnd(fe, 1)); lc.s.push(rnd(med, 1)); lc.n.push(g.length);
    added += g.length;
  }
  if (added) {
    const ord = lc.t.map((_, k) => k).sort((a, b) => lc.t[a] - lc.t[b]);
    for (const c of ['t', 'b', 'f', 'fe', 's', 'n']) lc[c] = ord.map((k) => lc[c][k]);
  }
  return added;
}

function nightRecord(x) {
  const n = String(x['f:night']), y = +n.slice(0, 4), m = +n.slice(4, 6), d = +n.slice(6, 8);
  return {
    night: n, mjd: Math.round(Date.UTC(y, m - 1, d) / 864e5 + 40587), alerts: +(x['f:alerts'] || 0), visits: +(x['f:visits'] || 0),
    objects: +(x['f:objects'] || 0), new: +(x['f:is_first'] || 0), sso: +(x['f:is_sso'] || 0), tns: +(x['f:in_tns'] || 0),
    bands: [...BANDS].map((b) => +(x[`f:alerts_${b}`] || 0)),
  };
}

export function createStarSync(S) {
  const Ob = S.objects, M = S.meta, OFF = M.mjdOffset;
  const BUNDLED = { nobj: Ob.id.length, nunit: S.alerts.t.length, tmax: M.mjdRange[1], nights: S.nights.length };

  function merge(objs, pts, nights) {
    const AL = S.alerts;
    const idx = new Map(Ob.id.map((id, i) => [id, i]));
    let newObjs = 0;
    for (const r of objs) {
      let i = idx.get(r.id);
      if (i == null) {
        if (!r.fam) continue;
        i = addObject(S, r);
        if (i < 0) continue;
        idx.set(r.id, i); newObjs++;
        continue;
      }
      if (r.t1 != null && (Ob.t1[i] == null || r.t1 - OFF > Ob.t1[i])) { Ob.t1[i] = rnd(r.t1 - OFF, 4); Ob.tSrc[i] = 0; }
      if (r.t0 != null && Ob.t0[i] == null) Ob.t0[i] = rnd(r.t0 - OFF, 4);
      if (r.nDet > Ob.nDet[i]) { Ob.nDet[i] = r.nDet; Ob.nDetBand[i] = r.nDetBand; Ob.meanMag[i] = r.meanMag; Ob.refBand[i] = r.refBand; }
    }
    const have = new Set();
    for (let k = 0; k < AL.t.length; k++) have.add(`${AL.o[k]}|${nightKey(AL.t[k] + OFF)}`);
    const byObj = new Map();
    for (const p of pts) {
      const i = idx.get(p.o);
      if (i == null) continue;
      if (!byObj.has(i)) byObj.set(i, []);
      byObj.get(i).push(p);
    }
    const add = { o: [], t: [], b: [], m: [], sgn: [] };
    let lcPoints = 0;
    for (const [i, ps] of byObj) {
      const best = new Map();
      for (const p of ps) {
        const k = `${i}|${nightKey(p.t)}`;
        if (have.has(k)) continue;
        const cur = best.get(k);
        if (!cur || Math.abs(p.f) > Math.abs(cur.f)) best.set(k, p);
      }
      for (const [k, p] of best) {
        have.add(k);
        add.o.push(i); add.t.push(rnd(p.t - OFF, 4)); add.b.push(BANDS.indexOf(p.b)); add.m.push(rnd(mag(Math.abs(p.f)), 2)); add.sgn.push(p.f > 0 ? 1 : -1);
      }
      const tmax = Math.max(...ps.map((p) => p.t)) - OFF, tmin = Math.min(...ps.map((p) => p.t)) - OFF;
      if (Ob.t1[i] == null || tmax > Ob.t1[i]) Ob.t1[i] = rnd(tmax, 4);
      if (Ob.t0[i] == null) { Ob.t0[i] = rnd(tmin, 4); Ob.tSrc[i] = 1; }
      if (Ob.lc[i] >= 0 && S.lcs[Ob.lc[i]]) lcPoints += binLc(S.lcs[Ob.lc[i]], ps.filter((p) => p.src), OFF);
    }
    if (add.t.length) {
      const all = { o: AL.o.concat(add.o), t: AL.t.concat(add.t), b: AL.b.concat(add.b), m: AL.m.concat(add.m), sgn: AL.sgn.concat(add.sgn) };
      const ord = all.t.map((_, k) => k).sort((a, b) => all.t[a] - all.t[b]);
      for (const c of ['o', 't', 'b', 'm', 'sgn']) AL[c] = ord.map((k) => all[c][k]);
    }
    if (nights && nights.length) {
      const m = new Map(S.nights.map((x) => [x.night, x]));
      for (const x of nights) m.set(x.night, x);
      S.nights = [...m.values()].sort((a, b) => a.mjd - b.mjd);
    }
    const ts = AL.t;
    if (ts.length) M.mjdRange = [ts[0] + OFF, ts[ts.length - 1] + OFF];
    Object.assign(M.counts, { objects: Ob.id.length, alertPoints: ts.length, nights: S.nights.length, alertsAllNights: S.nights.reduce((a, n) => a + n.alerts, 0) });
    return { added: add.t.length, newObjs, lcPoints };
  }

  async function loadStored() {
    try {
      const [objs, pts, nights, info] = await Promise.all([idb.getAll('objects'), idb.getAll('points'), idb.getAll('nights'), idb.get('meta', 'info')]);
      if (!objs.length && !pts.length && !nights.length) return { info: info || null, stats: null };
      return { info: info || null, stats: merge(objs, pts, nights) };
    } catch (e) {
      return { info: null, stats: null, error: e };
    }
  }

  async function update({ refresh = true, extra = 0, onProgress = () => {}, signal }) {
    const report = { batches: 0, done: 0, failed: 0, rows: 0, nights: 0, names: 0, changed: 0 };
    const progress = (msg) => onProgress({ ...report, msg });
    const step = async (fn) => {
      try { await fn(); } catch (e) { if (e.name === 'AbortError') throw e; report.failed++; }
      report.done++;
    };
    const months = monthsSince(+S.nights[S.nights.length - 1].night);
    const pending = { objects: [], points: [], nights: [] };
    const flush = async () => {
      if (pending.points.length) await idb.putMany('points', pending.points.splice(0).map((p) => [p.s, p]));
      if (pending.objects.length) await idb.putMany('objects', pending.objects.splice(0).map((o) => [o.id, o]));
      if (pending.nights.length) await idb.putMany('nights', pending.nights.splice(0).map((n) => [n.night, n]));
    };
    const idx = new Map(Ob.id.map((id, i) => [id, i]));
    const objBatches = [];
    if (refresh) for (let k = 0; k < Ob.id.length; k += OBJ_BATCH) objBatches.push(Ob.id.slice(k, k + OBJ_BATCH));
    const queries = extra > 0 ? [...TAGS.map((tag) => ({ tag })), ...[...CLASS_FAMILY.keys()].map((c) => ({ cls: c }))] : [];
    report.batches = months.length + objBatches.length + queries.length;

    progress('Nightly statistics');
    for (const mo of months) {
      await step(async () => {
        const st = await post('statistics', { date: mo, columns: STAT_COLS }, { signal, timeout: 60000, retries: 2 });
        if (Array.isArray(st)) for (const x of st) if (x['f:night']) { pending.nights.push(nightRecord(x)); report.nights++; }
      });
      progress('Nightly statistics');
    }
    await flush();

    const changed = [];
    progress('Checking the objects already here');
    await pool(objBatches.map((ids) => () => step(async () => {
      const out = await post('objects', { diaObjectId: ids.join(','), columns: OBJECT_COLS }, { signal });
      if (!Array.isArray(out)) throw new Error('unexpected reply');
      for (const o of out) {
        const s = summary(o), i = idx.get(s.id);
        if (i == null) continue;
        const t1 = Ob.t1[i] == null ? -1e9 : Ob.t1[i] + OFF;
        if ((s.t1 != null && s.t1 > t1 + 2e-4) || s.nDet > Ob.nDet[i]) changed.push({ s, after: t1 + 2e-4 });
      }
      progress('Checking the objects already here');
    })), CONCURRENCY, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    report.changed = changed.length;

    const srcBatches = [];
    for (let k = 0; k < changed.length; k += SRC_BATCH) srcBatches.push(changed.slice(k, k + SRC_BATCH));
    report.batches += srcBatches.length;
    progress('Fetching new alerts of changed objects');
    await pool(srcBatches.map((b) => () => step(async () => {
      const out = await post('sources', { diaObjectId: b.map((c) => c.s.id).join(','), columns: SOURCE_COLS }, { signal });
      if (!Array.isArray(out)) throw new Error('unexpected reply');
      const after = new Map(b.map((c) => [c.s.id, c.after]));
      const pts = out.map(point).filter((p) => p && after.has(p.o) && p.t > after.get(p.o)).map((p) => ({ ...p, src: 1 }));
      pending.points.push(...pts); pending.objects.push(...b.map((c) => c.s));
      report.rows += pts.length;
      await flush();
      progress('Fetching new alerts of changed objects');
    })), CONCURRENCY, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    if (queries.length) {
      const cand = new Map();
      const from = isoOf(Math.min(todayMjd(), BUNDLED.tmax) - TAG_WINDOW_DAYS), to = isoOf(todayMjd() + 1);
      const n = Math.min(1000, 300 + 4 * extra);
      progress('Searching the class and tag queries for new objects');
      await pool(queries.map((q) => () => step(async () => {
        const body = q.tag ? { tag: q.tag, n, startdate: from, stopdate: to, columns: ALERT_COLS } : { class: q.cls, columns: ALERT_COLS };
        const out = await post(q.tag ? 'tags' : 'explore', body, { signal, timeout: 120000 });
        if (!Array.isArray(out)) throw new Error('unexpected reply');
        for (const r of out) {
          const id = r['r:diaObjectId'] == null ? null : String(r['r:diaObjectId']);
          if (!id || idx.has(id)) continue;
          if (q.tag) r._tag = q.tag; else r._class = q.cls;
          const t = num(r['r:midpointMjdTai']) || 0;
          const c = cand.get(id) || { id, rows: [], last: 0 };
          c.rows.push(r); c.last = Math.max(c.last, t);
          cand.set(id, c);
        }
        progress('Searching the class and tag queries for new objects');
      })), CONCURRENCY, signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const fresh = [...cand.values()].sort((a, b) => b.last - a.last).slice(0, extra);
      const newBatches = [];
      for (let k = 0; k < fresh.length; k += OBJ_BATCH) newBatches.push(fresh.slice(k, k + OBJ_BATCH));
      report.batches += newBatches.length;
      progress('Fetching summaries of new objects');
      await pool(newBatches.map((b) => () => step(async () => {
        const out = await post('objects', { diaObjectId: b.map((c) => c.id).join(','), columns: OBJECT_COLS }, { signal });
        if (!Array.isArray(out)) throw new Error('unexpected reply');
        const rowsOf = new Map(b.map((c) => [c.id, c.rows]));
        for (const o of out) {
          const s = summary(o), rows = rowsOf.get(s.id);
          if (!rows || s.ra == null || s.dec == null) continue;
          const d = describe(s, rows);
          const pts = rows.map(point).filter(Boolean);
          pending.objects.push(d); pending.points.push(...pts);
          report.rows += pts.length; report.names++;
        }
        await flush();
        progress('Fetching summaries of new objects');
      })), CONCURRENCY, signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    }
    const info = { at: Date.now(), ...report };
    await idb.put('meta', 'info', info);
    return info;
  }

  async function storageInfo() {
    const out = { rows: 0, objects: 0, usage: await storageUsage() };
    try { out.rows = await idb.count('points'); out.objects = await idb.count('objects'); } catch {}
    return out;
  }

  return { loadStored, update, storageInfo, reset: resetStore, BUNDLED };
}
