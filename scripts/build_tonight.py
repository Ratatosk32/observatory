import argparse
import base64
import csv
import datetime
import io
import json
import math
import os
import struct
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dmcore import galactic

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FINK = 'https://api.lsst.fink-portal.org/api/v1/'
GAIA_TAPS = ['https://dc.g-vo.org/tap/sync', 'https://gea.esac.esa.int/tap-server/tap/sync']
GAIA_TABLES = {'https://dc.g-vo.org/tap/sync': 'gaia.dr3lite', 'https://gea.esac.esa.int/tap-server/tap/sync': 'gaiadr3.gaia_source'}
UA = 'observatory-data-refresh'
TAGS = ['extragalactic_lt20mag_candidate', 'in_tns', 'most_likely_sn']
COLUMNS = 'r:diaObjectId,r:ra,r:dec,r:midpointMjdTai,r:band,r:psfFlux,r:psfFluxErr,r:reliability,f:xm_tns_fullname,f:xm_tns_type,f:xm_tns_redshift,f:xm_simbad_otype'
SOURCE_COLS = 'r:diaObjectId,r:ra,r:dec,r:midpointMjdTai,r:band,r:psfFlux,r:psfFluxErr,r:reliability'
N_MAX = 15000
MAG_CANDIDATE = 19.5
MAG_TONIGHT = 19.0
FINDER_ARCMIN = 12.0


def warn(msg):
    print('::warning::' + msg, flush=True)


def mag(f):
    return 31.4 - 2.5 * math.log10(f) if isinstance(f, (int, float)) and f > 0 else None


def iso(mjd):
    return (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=mjd)).strftime('%Y-%m-%d %H:%M:%S')


def date_of(mjd):
    return (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=mjd)).strftime('%Y-%m-%d')


def http(url, body, timeout, headers):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=body, headers=dict(headers, **{'User-Agent': UA}))
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read().decode()
            if text.lstrip().startswith('<'):
                raise RuntimeError('HTML error page')
            return text
        except Exception as e:
            last = e
            if attempt < 3:
                time.sleep([5, 15, 40][attempt])
    raise last


def fink(endpoint, payload, timeout=180):
    return json.loads(http(FINK + endpoint, json.dumps(payload).encode(), timeout, {'Content-Type': 'application/json'}))


def gaia_cone(ra, dec, radius_deg, max_g, cache):
    key = f'{ra:.5f},{dec:.5f},{radius_deg:.5f},{max_g}'
    if key in cache:
        return cache[key]
    last = None
    for tap in GAIA_TAPS:
        table = GAIA_TABLES[tap]
        q = (f"SELECT ra, dec, phot_g_mean_mag AS g, phot_bp_mean_mag - phot_rp_mean_mag AS bp_rp FROM {table} "
             f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg})) AND phot_g_mean_mag < {max_g}")
        try:
            text = http(tap, urllib.parse.urlencode({'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': 'csv', 'QUERY': q}).encode(), 120, {})
            rows = list(csv.DictReader(io.StringIO(text)))
            if rows and 'g' not in rows[0]:
                raise RuntimeError('not a table')
            out = [[float(r['ra']), float(r['dec']), float(r['g']), float(r['bp_rp']) if r['bp_rp'] else None] for r in rows]
            cache[key] = out
            time.sleep(0.3)
            return out
        except Exception as e:
            last = e
    raise last


def fetch_tags(start, stop, state, deadline):
    rows_dir = os.path.join(state, 'tags')
    os.makedirs(rows_dir, exist_ok=True)
    got, failed = [], 0
    for tag in TAGS:
        pending, m = [], start
        while m < stop:
            pending.append((m, min(m + 1.0, stop)))
            m += 1.0
        while pending:
            if time.time() > deadline:
                warn('tonight: tag fetch time budget used up')
                return got, failed + 1
            a, b = pending.pop(0)
            path = os.path.join(rows_dir, f'{tag}_{a:.3f}_{b:.3f}.json')
            final = b < stop - 0.01
            if os.path.exists(path):
                got += json.load(open(path))
                continue
            try:
                rows = fink('tags', {'tag': tag, 'n': N_MAX, 'startdate': iso(a), 'stopdate': iso(b), 'columns': COLUMNS})
            except Exception as e:
                failed += 1
                print('tags', tag, a, 'failed', e, flush=True)
                continue
            if not isinstance(rows, list):
                failed += 1
                continue
            if len(rows) >= N_MAX and b - a > 0.05:
                mid = (a + b) / 2
                pending[:0] = [(a, mid), (mid, b)]
                continue
            keep = [{k: r.get(k) for k in COLUMNS.split(',')} for r in rows if (mag(r.get('r:psfFlux')) or 99) <= MAG_CANDIDATE]
            for r in keep:
                r['_tag'] = tag
            if final:
                json.dump(keep, open(path, 'w'))
            got += keep
            time.sleep(0.5)
    return got, failed


def clean(v):
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, str) and v.strip() in ('', 'nan', 'Fail', 'None', 'Unknown'):
        return None
    return v


def finder_blob(ra, dec, stars):
    out = bytearray()
    cosd = math.cos(math.radians(dec))
    kept = []
    for sra, sdec, g, c in stars:
        dx = ((sra - ra + 540) % 360 - 180) * cosd * 3600
        dy = (sdec - dec) * 3600
        if abs(dx) > FINDER_ARCMIN * 30 or abs(dy) > FINDER_ARCMIN * 30:
            continue
        kept.append((g, dx, dy, c))
    kept.sort()
    for g, dx, dy, c in kept[:80]:
        out += struct.pack('<hhBb', int(round(dx * 10)), int(round(dy * 10)), max(0, min(255, int(round(g * 10 - 100)))),
                           0 if c is None else max(-127, min(127, int(round(c * 20)))))
    return base64.b64encode(bytes(out)).decode(), len(kept[:80])


def main():
    ap = argparse.ArgumentParser(description='Build site/data/tonight.json: bright, fresh Rubin transients for small telescopes, with Gaia impostors removed and finder stars.')
    ap.add_argument('--data', default=os.path.join(ROOT, 'site', 'data'))
    ap.add_argument('--state', default=os.path.join(ROOT, 'data', 'tonight-state'))
    ap.add_argument('--days', type=float, default=30.0)
    ap.add_argument('--minutes', type=float, default=7.0)
    a = ap.parse_args()
    t0 = time.time()
    deadline = t0 + a.minutes * 60
    os.makedirs(a.state, exist_ok=True)
    stars = json.load(open(os.path.join(a.data, 'stars.json'), encoding='utf-8'))
    off = stars['meta']['mjdOffset']
    night_list = sorted(n['mjd'] for n in stars['nights'])
    last_night = night_list[-1]
    data_nights = night_list[-4:]
    sample_index = {sid: k for k, sid in enumerate(stars['objects']['id'])}
    now = (datetime.datetime.utcnow() - datetime.datetime(1858, 11, 17)).total_seconds() / 86400
    start = math.floor(min(now, last_night + 1.5) - a.days) + 0.5
    rows, failed = fetch_tags(start, now, a.state, deadline)
    meta, best = {}, {}
    for r in rows:
        oid = str(r.get('r:diaObjectId'))
        m = meta.setdefault(oid, {'tags': set()})
        m['tags'].add(r['_tag'])
        for col in ('f:xm_tns_fullname', 'f:xm_tns_type', 'f:xm_tns_redshift', 'f:xm_simbad_otype'):
            v = clean(r.get(col))
            if v is not None:
                m[col] = v
    cand = sorted(meta)
    year = datetime.datetime.utcnow().year
    lc_path = os.path.join(a.state, 'lightcurves.json')
    lcs = json.load(open(lc_path)) if os.path.exists(lc_path) else {}
    newest = {}
    for r in rows:
        oid = str(r.get('r:diaObjectId'))
        newest[oid] = max(newest.get(oid, 0), r.get('r:midpointMjdTai') or 0)
    todo = [o for o in cand if o not in lcs or lcs[o]['to'] < newest[o] - 1e-4]
    for k in range(0, len(todo), 10):
        if time.time() > deadline:
            warn('tonight: light-curve time budget used up')
            failed += 1
            break
        chunk = todo[k:k + 10]
        try:
            out = fink('sources', {'diaObjectId': ','.join(chunk), 'columns': SOURCE_COLS})
        except Exception as e:
            failed += 1
            print('sources failed', e, flush=True)
            continue
        per = {}
        for r in out if isinstance(out, list) else []:
            per.setdefault(str(r['r:diaObjectId']), []).append([r['r:midpointMjdTai'], r['r:band'], r['r:psfFlux'], r.get('r:psfFluxErr'), r.get('r:reliability'), r['r:ra'], r['r:dec']])
        for o in chunk:
            lcs[o] = {'to': newest[o], 'rows': per.get(o, [])}
        time.sleep(0.5)
    json.dump(lcs, open(lc_path, 'w'))
    gaia_path = os.path.join(a.state, 'gaia.json')
    gcache = json.load(open(gaia_path)) if os.path.exists(gaia_path) else {}
    funnel = {'tagged': len(cand), 'cuts': 0, 'gaiaImpostors': 0, 'kept': 0}
    kept = []
    for o in cand:
        m = meta[o]
        rows_o = (lcs.get(o) or {}).get('rows') or []
        pos = [r for r in rows_o if isinstance(r[2], (int, float)) and r[2] > 0 and r[2] > 5 * (r[3] or 1e30)]
        if len(pos) < 2:
            continue
        pos.sort()
        rel = sorted((r[4] or 0) for r in pos)[len(pos) // 2]
        tns = m.get('f:xm_tns_fullname') or ''
        yr = tns.split()[1][:4] if len(tns.split()) > 1 else ''
        if yr.isdigit() and int(yr) < year - 1:
            continue
        simbad = m.get('f:xm_simbad_otype') or ''
        if simbad.endswith('*'):
            continue
        ra, dec = pos[-1][5], pos[-1][6]
        _, b = galactic(ra, dec)
        if abs(float(b)) < 15 or rel < 0.6:
            continue
        last_mag = mag(pos[-1][2])
        recent = [r for r in pos if r[0] >= data_nights[0] - 0.5]
        if not recent or min(mag(r[2]) for r in recent) > MAG_TONIGHT:
            if min(mag(r[2]) for r in pos) > MAG_TONIGHT:
                continue
        funnel['cuts'] += 1
        if time.time() > deadline:
            warn('tonight: Gaia time budget used up')
            failed += 1
            break
        try:
            near = gaia_cone(ra, dec, 2.0 / 3600, 21, gcache)
        except Exception as e:
            failed += 1
            print('gaia failed', e, flush=True)
            continue
        if near:
            funnel['gaiaImpostors'] += 1
            continue
        kept.append((o, m, pos, ra, dec, last_mag))
    funnel['kept'] = len(kept)
    recent_out = []
    for o, m, pos, ra, dec, last_mag in sorted(kept, key=lambda x: -x[2][-1][0])[:20]:
        try:
            stars_f = gaia_cone(ra, dec, FINDER_ARCMIN / 60 * 0.75, 19.5, gcache)
            blob, nstars = finder_blob(ra, dec, stars_f)
        except Exception:
            blob, nstars = '', 0
        nights = sorted({int(r[0] - 0.5) for r in pos})
        last2 = [r for r in pos if r[0] >= pos[-1][0] - 3.5]
        trend = None
        if len(last2) >= 2 and last2[-1][0] - last2[0][0] > 0.3:
            trend = round((mag(last2[-1][2]) - mag(last2[0][2])) / (last2[-1][0] - last2[0][0]), 3)
        peak = min(pos, key=lambda r: mag(r[2]))
        recent_mag = min((mag(r[2]) for r in pos if r[0] >= data_nights[0] - 0.5), default=None)
        z = clean(m.get('f:xm_tns_redshift'))
        recent_out.append({
            'id': o, 'name': m.get('f:xm_tns_fullname') or f'Rubin {o}', 'type': m.get('f:xm_tns_type'), 'z': float(z) if z is not None else None,
            'ra': round(ra, 5), 'dec': round(dec, 5), 'first': round(pos[0][0], 4), 'last': round(pos[-1][0], 4),
            'lastMag': round(last_mag, 2), 'lastBand': pos[-1][1], 'peakMag': round(mag(peak[2]), 2), 'trend': trend,
            'det': [[round(r[0], 4), r[1], round(mag(r[2]), 2)] for r in pos], 'nights': len(nights),
            'tonight': recent_mag is not None and recent_mag <= MAG_TONIGHT, 'inSample': sample_index.get(o),
            'tags': sorted(m['tags']), 'finder': {'fieldArcmin': FINDER_ARCMIN, 'n': nstars, 'stars': blob},
        })
    json.dump(gcache, open(gaia_path, 'w'))
    out = {'version': 1, 'built': datetime.datetime.utcnow().strftime('%Y-%m-%d'), 'dataTo': date_of(last_night), 'refNight': last_night,
           'funnel': funnel, 'recent': recent_out}
    target = os.path.join(a.data, 'tonight.json')
    if failed and os.path.exists(target):
        warn(f'tonight: {failed} steps incomplete; keeping the previous tonight.json, caches saved for the next run')
    else:
        with open(target, 'w', encoding='ascii') as fh:
            json.dump(out, fh, separators=(',', ':'), ensure_ascii=True)
    print(f"tonight: {funnel}; {sum(1 for r in recent_out if r['tonight'])} active in the last data nights; {len(cand)} candidates; {failed} failed requests; {time.time() - t0:.0f} s", flush=True)


if __name__ == '__main__':
    main()
