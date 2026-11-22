import argparse
import csv
import gzip
import io
import math
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DATA = os.path.join(ROOT, 'data')
FINK = 'https://api.lsst.fink-portal.org/api/v1/'
GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/'
UA = 'observatory-data-fetch'
PAUSE = 1.0

ALERT_COLS = ','.join([
    'r:diaObjectId', 'r:diaSourceId', 'r:ra', 'r:dec', 'r:midpointMjdTai', 'r:band',
    'r:psfFlux', 'r:psfFluxErr', 'r:scienceFlux', 'r:snr', 'r:observation_reason', 'r:reliability',
    'f:xm_vsx_Type', 'f:xm_simbad_otype', 'f:xm_gcvs_type', 'f:xm_spicy_class',
    'f:xm_tns_fullname', 'f:xm_tns_type', 'f:xm_tns_redshift',
    'f:xm_gaiadr3_DR3Name', 'f:xm_gaiadr3_Plx', 'f:xm_gaiadr3_e_Plx',
    'f:xm_mangrove_lum_dist', 'f:xm_mangrove_HyperLEDA_name', 'f:xm_legacydr8_zphot', 'f:xm_legacydr8_pstar',
    'f:clf_snnSnVsOthers_score', 'f:clf_cats_class', 'f:clf_cats_score', 'f:clf_earlySNIa_score',
])

BANDS = 'ugrizy'
OBJECT_COLS = ','.join(
    ['r:diaObjectId', 'r:ra', 'r:dec', 'r:nDiaSources', 'r:firstDiaSourceMjdTai', 'r:lastDiaSourceMjdTai',
     'f:main_label_crossmatch', 'f:main_label_classifier', 'f:is_cataloged']
    + [f'r:{b}_psfFluxNdata' for b in BANDS] + [f'r:{b}_scienceFluxMean' for b in BANDS]
)

SOURCE_COLS = ','.join([
    'r:diaObjectId', 'r:diaSourceId', 'r:midpointMjdTai', 'r:band', 'r:psfFlux', 'r:psfFluxErr',
    'r:scienceFlux', 'r:scienceFluxErr', 'r:snr', 'r:observation_reason',
    'f:xm_tns_fullname', 'f:xm_tns_type', 'f:xm_tns_redshift', 'f:xm_mangrove_lum_dist', 'f:xm_legacydr8_zphot',
])
FP_COLS = 'r:diaObjectId,r:midpointMjdTai,r:band,r:psfFlux,r:psfFluxErr'

FAMILIES = {
    'rrlyr': ['VSX/RRAB', 'VSX/RRC', 'VSX/RRD', 'VSX/RR', 'VSX/RRAB/BL', 'SIMBAD/RR*'],
    'ceph': ['VSX/DCEP', 'VSX/CEP', 'VSX/CWA', 'VSX/CWB', 'VSX/ACEP', 'SIMBAD/cC*', 'SIMBAD/Ce*'],
    'dsct': ['VSX/DSCT', 'VSX/HADS', 'VSX/SXPHE', 'SIMBAD/dS*'],
    'lpv': ['VSX/M', 'VSX/SR', 'VSX/LPV', 'VSX/SRS', 'VSX/L', 'SIMBAD/Mi*', 'SIMBAD/LP*'],
    'ecl': ['VSX/EA', 'VSX/EB', 'VSX/EW', 'VSX/E', 'VSX/ELL', 'SIMBAD/EB*'],
    'active': ['VSX/UV', 'VSX/BY', 'VSX/RS', 'VSX/ROT', 'SIMBAD/Er*', 'SIMBAD/BY*', 'SIMBAD/RS*', 'SIMBAD/Ro*'],
    'yso': ['VSX/YSO', 'VSX/CTTS', 'SIMBAD/Or*', 'SIMBAD/Y*O'],
    'cv': ['VSX/UG', 'VSX/UGSU', 'VSX/UGWZ', 'VSX/NL', 'VSX/CV', 'VSX/AM', 'VSX/DQ', 'SIMBAD/CV*', 'SIMBAD/No*', 'TNS/CV'],
    'star': ['SIMBAD/*', 'SIMBAD/V*', 'SIMBAD/WD*', 'SIMBAD/PM*', 'SIMBAD/HB*', 'VSX/VAR', 'VSX/MISC'],
    'sn': ['TNS/SN', 'TNS/SN Ia', 'TNS/SN Ia-91T-like', 'TNS/SN Ia-pec', 'TNS/SN Ia-CSM', 'TNS/SN Ia-SC',
           'TNS/SN II', 'TNS/SN IIP', 'TNS/SN IIb', 'TNS/SN IIn', 'TNS/SN Ib', 'TNS/SN Ib/c', 'TNS/SN Ibn',
           'TNS/SN Ic', 'TNS/SN Ic-BL', 'TNS/SLSN-I', 'TNS/SLSN-II', 'SIMBAD/SN*'],
    'tde': ['TNS/TDE', 'TNS/TDE-H-He'],
    'agn': ['TNS/AGN', 'VSX/AGN', 'VSX/BLLAC', 'SIMBAD/QSO', 'SIMBAD/AGN', 'SIMBAD/Sy1', 'SIMBAD/Sy2',
            'SIMBAD/BLL', 'SIMBAD/Bla', 'SIMBAD/Q?'],
}

TAGS = ['in_tns', 'most_likely_sn', 'mdwarf_flare', 'sn_near_galaxy_candidate',
        'extragalactic_new_candidate', 'extragalactic_lt20mag_candidate', 'hostless_candidate']

VSX_FAMILY = {}
for fam, classes in FAMILIES.items():
    for c in classes:
        VSX_FAMILY[c] = fam

STELLAR = {'rrlyr', 'ceph', 'dsct', 'lpv', 'ecl', 'active', 'yso', 'cv', 'star'}


def clean(v):
    if v is None:
        return None
    if isinstance(v, str) and v.strip() in ('', 'nan', 'Fail', 'None', 'Unknown'):
        return None
    if isinstance(v, float) and v != v:
        return None
    return v


def family_of(row):
    tns_type = clean(row.get('f:xm_tns_type'))
    if tns_type:
        key = 'TNS/' + tns_type
        if key in VSX_FAMILY:
            return VSX_FAMILY[key]
        if tns_type.startswith(('SN', 'SLSN')):
            return 'sn'
        if tns_type.startswith('TDE'):
            return 'tde'
    vsx = clean(row.get('f:xm_vsx_Type'))
    if vsx and 'VSX/' + vsx in VSX_FAMILY:
        return VSX_FAMILY['VSX/' + vsx]
    simbad = clean(row.get('f:xm_simbad_otype'))
    if simbad and 'SIMBAD/' + simbad in VSX_FAMILY:
        return VSX_FAMILY['SIMBAD/' + simbad]
    cls = row.get('_class')
    if cls and cls in VSX_FAMILY:
        return VSX_FAMILY[cls]
    tag = row.get('_tag')
    if tag == 'mdwarf_flare':
        return 'active'
    if tag in ('most_likely_sn', 'sn_near_galaxy_candidate'):
        return 'sncand'
    return 'unk'


def out_dir(date, source):
    d = os.path.join(DATA, f'stars-{date}', source)
    os.makedirs(d, exist_ok=True)
    return d


def http(url, data=None, headers=None, timeout=300):
    h = {'User-Agent': UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fink(endpoint, payload, timeout=300):
    body = http(FINK + endpoint, json.dumps(payload).encode(), {'Content-Type': 'application/json'}, timeout)
    rows = json.loads(body)
    if not isinstance(rows, list):
        raise ValueError(str(rows)[:300])
    return rows


def save_gz(fn, obj):
    tmp = fn + '.part'
    with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
        json.dump(obj, fh)
    os.replace(tmp, fn)


def load_gz(fn):
    with gzip.open(fn, 'rt', encoding='utf-8') as fh:
        return json.load(fh)


def safe_name(s):
    return ''.join(ch if ch.isalnum() else '_' for ch in s)


def step_stats(date):
    d = out_dir(date, 'fink')
    for year in ('2025', '2026'):
        fn = os.path.join(d, f'stats-{year}.json.gz')
        if os.path.exists(fn):
            continue
        save_gz(fn, fink('statistics', {'date': year}))
        print('stats', year, 'ok', flush=True)
        time.sleep(PAUSE)


def step_explore(date):
    d = out_dir(date, 'fink')
    for fam, classes in FAMILIES.items():
        for c in classes:
            fn = os.path.join(d, f'explore-{safe_name(c)}.json.gz')
            if os.path.exists(fn):
                continue
            t0 = time.time()
            try:
                rows = fink('explore', {'class': c, 'columns': ALERT_COLS})
            except Exception as ex:
                print('explore', c, 'failed', ex, flush=True)
                time.sleep(PAUSE)
                continue
            for r in rows:
                r['_class'] = c
            save_gz(fn, rows)
            print('explore', c, len(rows), round(time.time() - t0, 1), 's', flush=True)
            time.sleep(PAUSE)


def half_months():
    out = []
    for m in range(1, 12):
        nxt = f'2026-{m + 1:02d}-01' if m < 12 else '2027-01-01'
        out.append((f'2026-{m:02d}-01', f'2026-{m:02d}-16'))
        out.append((f'2026-{m:02d}-16', nxt))
    out.append(('2026-12-01', '2026-12-31'))
    return out


def step_tags(date, n=150):
    d = out_dir(date, 'fink')
    for tag in TAGS:
        for a, b in half_months():
            fn = os.path.join(d, f'tag-{tag}-{a}.json.gz')
            if os.path.exists(fn):
                continue
            try:
                rows = fink('tags', {'tag': tag, 'n': n, 'startdate': a, 'stopdate': b, 'columns': ALERT_COLS})
            except Exception as ex:
                print('tag', tag, a, 'failed', ex, flush=True)
                time.sleep(PAUSE)
                continue
            for r in rows:
                r['_tag'] = tag
            save_gz(fn, rows)
            print('tag', tag, a, len(rows), flush=True)
            time.sleep(PAUSE)


def all_alerts(date):
    d = os.path.join(DATA, f'stars-{date}', 'fink')
    rows = []
    for f in sorted(os.listdir(d)):
        if f.startswith(('explore-', 'tag-')) and f.endswith('.json.gz'):
            rows += load_gz(os.path.join(d, f))
    return rows


def step_objects(date, batch=100):
    d = out_dir(date, 'fink')
    ids = sorted({int(r['r:diaObjectId']) for r in all_alerts(date)})
    print('unique objects', len(ids), flush=True)
    for k in range(0, len(ids), batch):
        fn = os.path.join(d, f'objects-{k // batch:04d}.json.gz')
        if os.path.exists(fn):
            continue
        chunk = ids[k:k + batch]
        try:
            rows = fink('objects', {'diaObjectId': ','.join(str(i) for i in chunk), 'columns': OBJECT_COLS})
        except Exception as ex:
            print('objects', k, 'failed', ex, flush=True)
            time.sleep(PAUSE)
            continue
        save_gz(fn, rows)
        print('objects', k, len(rows), flush=True)
        time.sleep(PAUSE / 2)


def load_objects(date):
    d = os.path.join(DATA, f'stars-{date}', 'fink')
    objs = {}
    for f in sorted(os.listdir(d)):
        if f.startswith('objects-'):
            for r in load_gz(os.path.join(d, f)):
                objs[int(r['r:diaObjectId'])] = r
    return objs


def object_families(date):
    fam = {}
    rank = {}
    for r in all_alerts(date):
        i = int(r['r:diaObjectId'])
        f = family_of(r)
        score = 0 if f in ('unk', 'sncand') else 1
        if i not in fam or score > rank[i]:
            fam[i] = f
            rank[i] = score
    return fam


LC_QUOTA = {'rrlyr': 120, 'ceph': 60, 'dsct': 60, 'lpv': 80, 'ecl': 100, 'active': 120, 'yso': 50, 'cv': 80,
            'star': 60, 'sn': 220, 'tde': 20, 'agn': 100, 'sncand': 120, 'unk': 60}


def lightcurve_targets(date):
    objs = load_objects(date)
    fam = object_families(date)
    by = {}
    for i, f in fam.items():
        o = objs.get(i)
        if not o:
            continue
        by.setdefault(f, []).append((-(o.get('r:nDiaSources') or 0), i))
    picks = []
    for f, lst in by.items():
        lst.sort()
        picks += [i for _, i in lst[:LC_QUOTA.get(f, 40)]]
    return sorted(picks)


def step_sources(date, batch=20):
    d = out_dir(date, 'fink')
    ids = lightcurve_targets(date)
    print('light-curve targets', len(ids), flush=True)
    for k in range(0, len(ids), batch):
        fn = os.path.join(d, f'sources-{k // batch:04d}.json.gz')
        if os.path.exists(fn):
            continue
        chunk = ids[k:k + batch]
        try:
            rows = fink('sources', {'diaObjectId': ','.join(str(i) for i in chunk), 'columns': SOURCE_COLS})
        except Exception as ex:
            print('sources', k, 'failed', ex, flush=True)
            time.sleep(PAUSE)
            continue
        save_gz(fn, rows)
        print('sources', k, len(rows), flush=True)
        time.sleep(PAUSE / 2)


def load_sources(date):
    d = os.path.join(DATA, f'stars-{date}', 'fink')
    by = {}
    for f in sorted(os.listdir(d)):
        if f.startswith('sources-'):
            for r in load_gz(os.path.join(d, f)):
                by.setdefault(int(r['r:diaObjectId']), []).append(r)
    return by


def featured_targets(date, per_family=4):
    fam = object_families(date)
    src = load_sources(date)
    by = {}
    for i, rows in src.items():
        f = fam.get(i, 'unk')
        best = max(rows, key=lambda r: r.get('r:snr') or 0)
        by.setdefault(f, []).append((-len(rows), i, best['r:diaSourceId']))
    out = []
    for f, lst in by.items():
        lst.sort()
        out += [(f, i, s) for _, i, s in lst[:per_family]]
    return out


def step_fp(date, batch=10):
    d = out_dir(date, 'fink')
    ids = sorted({i for _, i, _ in featured_targets(date)})
    for k in range(0, len(ids), batch):
        fn = os.path.join(d, f'fp-{k // batch:04d}.json.gz')
        if os.path.exists(fn):
            continue
        try:
            rows = fink('fp', {'diaObjectId': ','.join(str(i) for i in ids[k:k + batch]), 'columns': FP_COLS})
        except Exception as ex:
            print('fp', k, 'failed', ex, flush=True)
            time.sleep(PAUSE)
            continue
        save_gz(fn, rows)
        print('fp', k, len(rows), flush=True)
        time.sleep(PAUSE / 2)


def step_cutouts(date):
    d = out_dir(date, 'fink-cutouts')
    for fam, obj, src in featured_targets(date):
        for kind in ('Science', 'Template', 'Difference'):
            fn = os.path.join(d, f'{obj}-{src}-{kind}.png')
            if os.path.exists(fn):
                continue
            try:
                body = http(FINK + 'cutouts', json.dumps({'diaSourceId': str(src), 'kind': kind}).encode(),
                            {'Content-Type': 'application/json'}, 120)
            except Exception as ex:
                print('cutout', obj, kind, 'failed', ex, flush=True)
                time.sleep(PAUSE)
                continue
            if body[:8] != b'\x89PNG\r\n\x1a\n':
                print('cutout', obj, kind, 'not a PNG', body[:80], flush=True)
                continue
            with open(fn, 'wb') as fh:
                fh.write(body)
            time.sleep(PAUSE / 2)
        print('cutouts', fam, obj, flush=True)


def tap_sync(query, upload=None, fmt='csv', timeout=600):
    fields = {'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': fmt, 'QUERY': query, 'MAXREC': '400000'}
    if upload is None:
        return http(GAIA_TAP + 'sync', urllib.parse.urlencode(fields).encode(), timeout=timeout)
    name, votable = upload
    fields['UPLOAD'] = f'{name},param:{name}'
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}.xml"\r\n'
                 f'Content-Type: application/x-votable+xml\r\n\r\n'.encode() + votable + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return http(GAIA_TAP + 'sync', b''.join(parts),
                {'Content-Type': f'multipart/form-data; boundary={boundary}'}, timeout)


def tap_async(query, timeout=900, maxrec=400000):
    fields = {'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': 'csv', 'QUERY': query, 'PHASE': 'RUN', 'MAXREC': str(maxrec)}
    req = urllib.request.Request(GAIA_TAP + 'async', data=urllib.parse.urlencode(fields).encode(),
                                 headers={'User-Agent': UA})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(req, timeout=60)
        job = r.headers.get('Location')
    except urllib.error.HTTPError as e:
        job = e.headers.get('Location')
    if not job:
        raise RuntimeError('no async job location')
    t0 = time.time()
    while time.time() - t0 < timeout:
        phase = http(job + '/phase', timeout=60).decode().strip()
        if phase == 'COMPLETED':
            return http(job + '/results/result', timeout=600)
        if phase in ('ERROR', 'ABORTED'):
            raise RuntimeError(http(job + '/error', timeout=60)[:500])
        time.sleep(5)
    raise TimeoutError(job)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def step_gaia_map(date):
    d = out_dir(date, 'gaia')
    fn = os.path.join(d, 'density-l05-b05.csv.gz')
    if not os.path.exists(fn):
        q = ('SELECT FLOOR(l*2) AS li, FLOOR((b+90)*2) AS bi, COUNT(*) AS n, AVG(bp_rp) AS bprp '
             'FROM gaiadr3.gaia_source WHERE random_index < 12000000 GROUP BY li, bi')
        body = tap_async(q)
        with gzip.open(fn, 'wb') as fh:
            fh.write(body)
        print('gaia density ok', len(body), flush=True)
    fn = os.path.join(d, 'bright-g7.csv.gz')
    if not os.path.exists(fn):
        q = ('SELECT source_id, l, b, ra, dec, phot_g_mean_mag, bp_rp, parallax FROM gaiadr3.gaia_source '
             'WHERE phot_g_mean_mag < 7')
        body = tap_sync(q)
        with gzip.open(fn, 'wb') as fh:
            fh.write(body)
        print('gaia bright ok', len(body), flush=True)
    fn = os.path.join(d, 'hrd-plx10.csv.gz')
    if not os.path.exists(fn):
        q = ('SELECT FLOOR(bp_rp*20) AS ci, FLOOR((phot_g_mean_mag + 5*LOG10(parallax/100.0))*10) AS mi, '
             'COUNT(*) AS n FROM gaiadr3.gaia_source '
             'WHERE parallax > 5 AND parallax_over_error > 10 AND bp_rp IS NOT NULL '
             'AND phot_bp_mean_flux_over_error > 20 AND phot_rp_mean_flux_over_error > 20 AND ruwe < 1.4 '
             'GROUP BY ci, mi')
        body = tap_async(q)
        with gzip.open(fn, 'wb') as fh:
            fh.write(body)
        print('gaia hrd ok', len(body), flush=True)


def step_gaia_map_fine(date):
    d = out_dir(date, 'gaia')
    fn = os.path.join(d, 'density-l025-b025.csv.gz')
    if os.path.exists(fn):
        return
    q = ('SELECT FLOOR(l*4) AS li, FLOOR((b+90)*4) AS bi, COUNT(*) AS n '
         'FROM gaiadr3.gaia_source WHERE random_index < 100000000 GROUP BY li, bi')
    body = tap_async(q, timeout=5400, maxrec=1100000)
    with gzip.open(fn, 'wb') as fh:
        fh.write(body)
    print('gaia fine density ok', len(body), flush=True)


def nearest_target(row, targets, radius_arcsec):
    ra, dec = float(row['ra']), float(row['dec'])
    best, bsep = None, None
    for oid, tra, tdec in targets:
        dra = (ra - tra) * math.cos(math.radians(dec))
        sep = math.hypot(dra, dec - tdec) * 3600
        if sep <= radius_arcsec and (bsep is None or sep < bsep):
            best, bsep = oid, sep
    return best


def step_gaia_xmatch(date, batch=40, radius_arcsec=8.0):
    d = out_dir(date, 'gaia')
    objs = load_objects(date)
    fam = object_families(date)
    targets = sorted((i, o['r:ra'], o['r:dec']) for i, o in objs.items() if fam.get(i) in STELLAR)
    print('gaia xmatch targets', len(targets), flush=True)
    cols = ('source_id, ra, dec, pmra, pmdec, parallax, parallax_error, phot_g_mean_mag, bp_rp, l, b, '
            'phot_variable_flag, ruwe')
    r_deg = radius_arcsec / 3600.0
    for k in range(0, len(targets), batch):
        fn = os.path.join(d, f'xmatch-{k // batch:04d}.csv.gz')
        if os.path.exists(fn):
            continue
        chunk = targets[k:k + batch]
        conds = ' OR '.join(f"1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.7f}, {dec:.7f}, {r_deg:.7f}))"
                            for _, ra, dec in chunk)
        try:
            body = tap_sync(f'SELECT {cols} FROM gaiadr3.gaia_source WHERE {conds}', timeout=180)
            rows = list(csv.DictReader(io.StringIO(body.decode('utf-8'))))
            ids = [r['source_id'] for r in rows]
            extra = {}
            if ids:
                q2 = ('SELECT g.source_id, rr.pf AS rr_pf, rr.p1_o AS rr_p1o, rr.best_classification AS rr_type, '
                      'ce.pf AS ce_pf, ce.type_best_classification AS ce_type, eb.frequency AS eb_freq, '
                      'lp.frequency AS lpv_freq, dd.r_med_geo, dd.r_lo_geo, dd.r_hi_geo '
                      'FROM gaiadr3.gaia_source AS g '
                      'LEFT OUTER JOIN gaiadr3.vari_rrlyrae AS rr ON rr.source_id = g.source_id '
                      'LEFT OUTER JOIN gaiadr3.vari_cepheid AS ce ON ce.source_id = g.source_id '
                      'LEFT OUTER JOIN gaiadr3.vari_eclipsing_binary AS eb ON eb.source_id = g.source_id '
                      'LEFT OUTER JOIN gaiadr3.vari_long_period_variable AS lp ON lp.source_id = g.source_id '
                      'LEFT OUTER JOIN external.gaiaedr3_distance AS dd ON dd.source_id = g.source_id '
                      f'WHERE g.source_id IN ({",".join(ids)})')
                time.sleep(PAUSE / 2)
                body2 = tap_sync(q2, timeout=180)
                extra = {r['source_id']: r for r in csv.DictReader(io.StringIO(body2.decode('utf-8')))}
        except Exception as ex:
            msg = ex.read()[:300] if hasattr(ex, 'read') else ex
            print('gaia xmatch', k, 'failed', msg, flush=True)
            time.sleep(PAUSE)
            continue
        out = []
        for r in rows:
            oid = nearest_target(r, chunk, radius_arcsec)
            if oid is None:
                continue
            r.update({kk: vv for kk, vv in extra.get(r['source_id'], {}).items() if kk != 'source_id'})
            r['oid'] = oid
            out.append(r)
        buf = io.StringIO()
        if out:
            w = csv.DictWriter(buf, fieldnames=list(out[0].keys()))
            w.writeheader()
            w.writerows(out)
        else:
            buf.write('oid' + chr(10))
        with gzip.open(fn, 'wt', encoding='utf-8') as fh:
            fh.write(buf.getvalue())
        print('gaia xmatch', k, len(out), 'rows', flush=True)
        time.sleep(PAUSE)


GAVO_TAP = 'https://dc.g-vo.org/tap/'


def step_sdss(date, batch=40, radius_arcsec=1.5):
    d = out_dir(date, 'sdss')
    objs = load_objects(date)
    fam = object_families(date)
    targets = sorted((i, o['r:ra'], o['r:dec']) for i, o in objs.items()
                     if fam.get(i) not in STELLAR and o['r:dec'] > -12.0)
    print('sdss targets', len(targets), flush=True)
    r_deg = radius_arcsec / 3600.0
    for k in range(0, len(targets), batch):
        fn = os.path.join(d, f'sdss-{k // batch:04d}.csv.gz')
        if os.path.exists(fn):
            continue
        chunk = targets[k:k + batch]
        conds = ' OR '.join(f"1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.7f}, {dec:.7f}, {r_deg:.7f}))"
                            for _, ra, dec in chunk)
        q = ('SELECT ra, dec, spec_z, spec_z_err, spec_z_warning, spec_class, spec_sub_class, photoz_z, photoz_z_err, '
             f'class FROM sdssdr16.main WHERE spec_z IS NOT NULL AND ({conds})')
        fields = {'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': 'csv', 'QUERY': q, 'MAXREC': '5000'}
        try:
            body = http(GAVO_TAP + 'sync', urllib.parse.urlencode(fields).encode(), timeout=180)
        except Exception as ex:
            print('sdss', k, 'failed', ex, flush=True)
            time.sleep(PAUSE)
            continue
        rows = list(csv.DictReader(io.StringIO(body.decode('utf-8'))))
        out = []
        for r in rows:
            oid = nearest_target(r, chunk, radius_arcsec)
            if oid is not None:
                r['oid'] = oid
                out.append(r)
        buf = io.StringIO()
        if out:
            w = csv.DictWriter(buf, fieldnames=list(out[0].keys()))
            w.writeheader()
            w.writerows(out)
        else:
            buf.write('oid' + chr(10))
        with gzip.open(fn, 'wt', encoding='utf-8') as fh:
            fh.write(buf.getvalue())
        print('sdss', k, len(out), flush=True)
        time.sleep(PAUSE)


GAL_M = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
         [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
         [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]]

TILE_REGIONS = [
    ('COSMOS', 150.11, 2.18, 2.5, 0.05, 1.0),
    ('XMM-LSS', 35.71, -4.75, 2.5, 0.05, 1.0),
    ('ECDFS', 53.13, -28.10, 2.5, 0.05, 1.0),
    ('ELAIS-S1', 9.45, -44.03, 2.5, 0.05, 1.0),
    ('EDFS', 61.24, -48.42, 3.5, 0.05, 1.0),
    ('SMC', 13.19, -72.83, 3.0, 0.05, 1.0),
    ('LMC', 80.89, -69.76, 8.0, 0.1, 1.0),
    ('Bulge', 266.405, -28.936, 8.0, 0.1, 1.0),
]
GAIA_N = 1811709771


def gal_lb(ra, dec):
    r, d = math.radians(ra), math.radians(dec)
    v = (math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d))
    x, y, z = (sum(GAL_M[i][j] * v[j] for j in range(3)) for i in range(3))
    return math.degrees(math.atan2(y, x)) % 360.0, math.degrees(math.asin(z))


def tile_box(ra, dec, radius, step):
    l, b = gal_lb(ra, dec)
    lw = l - 360.0 if l >= 180.0 else l
    half_l = radius / max(0.2, math.cos(math.radians(b)))
    l0 = math.floor((lw - half_l) / step) * step
    b0 = math.floor((b - radius) / step) * step
    return l0, b0, int(math.ceil(2 * half_l / step)) + 1, int(math.ceil(2 * radius / step)) + 1


def step_tiles(date):
    d = out_dir(date, 'gaia-tiles')
    for name, ra, dec, radius, step, frac in TILE_REGIONS:
        fn = os.path.join(d, f'tile-{safe_name(name)}.csv.gz')
        if os.path.exists(fn):
            continue
        l0, b0, w, h = tile_box(ra, dec, radius, step)
        sample = f' AND random_index < {int(GAIA_N * frac)}' if frac < 1 else ''
        lw = 'l - 360.0 * FLOOR((l + 180.0) / 360.0)'
        q = (f'SELECT FLOOR(({lw} - ({l0:.4f})) / {step}) AS li, FLOOR((b - ({b0:.4f})) / {step}) AS bi, '
             'COUNT(*) AS n, AVG(bp_rp) AS bprp FROM gaiadr3.gaia_source '
             f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})){sample} "
             'GROUP BY li, bi')
        t0 = time.time()
        try:
            body = tap_async(q, timeout=1500)
        except Exception as ex:
            print('tile', name, 'failed', str(ex)[-600:], flush=True)
            continue
        meta = json.dumps({'name': name, 'ra': ra, 'dec': dec, 'radius': radius, 'step': step, 'fraction': frac,
                           'l0': l0, 'b0': b0, 'w': w, 'h': h})
        with gzip.open(fn, 'wt', encoding='utf-8') as fh:
            fh.write('# ' + meta + chr(10) + body.decode('utf-8'))
        print('tile', name, body.count(chr(10).encode()) - 1, 'cells', round(time.time() - t0), 's', flush=True)
        time.sleep(PAUSE)


def step_names(date):
    d = out_dir(date, 'iau')
    fn = os.path.join(d, 'IAU-CSN.txt')
    if not os.path.exists(fn):
        body = http('https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt', timeout=60)
        with open(fn, 'wb') as fh:
            fh.write(body)
    print('names ok', flush=True)


STORY_IDS = {
    'sn_ia': 170235219334922248,
    'sn_gap': 314003014107006318,
    'slsn_old_light': 313928194567700757,
    'contact_binary': 313637935274000406,
    'rr_lyrae': 313677516768805021,
    'quasar': 170028526654193761,
    'quasar_far': 171141216007618582,
}


def story_epochs(rows):
    good = [r for r in rows if r.get('r:psfFlux') is not None and r.get('r:diaSourceId')]
    if not good:
        return []
    good.sort(key=lambda r: r['r:midpointMjdTai'])
    peak = max(good, key=lambda r: r['r:psfFlux'])
    first = good[0]
    late = [r for r in good if r['r:midpointMjdTai'] > peak['r:midpointMjdTai'] + 25]
    picks = [('first', first), ('peak', peak)] + ([('late', late[len(late) // 2])] if late else [])
    seen, out = set(), []
    for tag, r in picks:
        if r['r:diaSourceId'] not in seen:
            seen.add(r['r:diaSourceId'])
            out.append((tag, int(r['r:diaSourceId']), r['r:midpointMjdTai'], r['r:band']))
    return out


def step_story(date, extra=None):
    d = out_dir(date, 'fink-story')
    ids = dict(STORY_IDS)
    for k, v in (extra or {}).items():
        ids[k] = v
    for key, oid in ids.items():
        fn = os.path.join(d, f'story-{key}-{oid}.json.gz')
        if os.path.exists(fn):
            continue
        try:
            src = fink('sources', {'diaObjectId': str(oid), 'columns': SOURCE_COLS})
            time.sleep(PAUSE / 2)
            fp = fink('fp', {'diaObjectId': str(oid), 'columns': FP_COLS})
        except Exception as ex:
            print('story', key, 'failed', ex, flush=True)
            continue
        epochs = story_epochs(src)
        stamps = []
        for tag, sid, t, band in epochs:
            for kind in ('Science', 'Template', 'Difference'):
                pn = os.path.join(d, f'{oid}-{sid}-{kind}.png')
                if not os.path.exists(pn):
                    time.sleep(PAUSE / 2)
                    try:
                        body = http(FINK + 'cutouts', json.dumps({'diaSourceId': str(sid), 'kind': kind}).encode(),
                                    {'Content-Type': 'application/json'}, 120)
                    except Exception as ex:
                        print('story cutout', key, kind, 'failed', ex, flush=True)
                        continue
                    if body[:8] != bytes([137, 80, 78, 71, 13, 10, 26, 10]):
                        continue
                    with open(pn, 'wb') as fh:
                        fh.write(body)
            stamps.append({'epoch': tag, 'diaSourceId': sid, 't': t, 'band': band})
        save_gz(fn, {'key': key, 'oid': oid, 'sources': src, 'fp': fp, 'stamps': stamps})
        print('story', key, oid, len(src), 'src', len(fp), 'fp', len(stamps), 'epochs', flush=True)
        time.sleep(PAUSE)


STEPS = {
    'stats': step_stats, 'explore': step_explore, 'tags': step_tags, 'objects': step_objects,
    'sources': step_sources, 'fp': step_fp, 'cutouts': step_cutouts,
    'gaia_map': step_gaia_map, 'gaia_map_fine': step_gaia_map_fine, 'gaia_xmatch': step_gaia_xmatch, 'sdss': step_sdss, 'tiles': step_tiles, 'names': step_names, 'story': step_story,
}


def main():
    global DATA
    ap = argparse.ArgumentParser(description='Fetch public Rubin/Fink and Gaia data for the stars mode.')
    ap.add_argument('steps', nargs='*', default=list(STEPS))
    ap.add_argument('--date', default='2026-11-22')
    ap.add_argument('--data-dir', default=DATA, help='where raw downloads go (default: data/)')
    a = ap.parse_args()
    DATA = os.path.abspath(a.data_dir)
    for s in a.steps:
        print('==', s, flush=True)
        STEPS[s](a.date)


if __name__ == '__main__':
    sys.exit(main())
