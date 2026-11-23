import argparse
import base64
import datetime
import json
import os
import sys
import time
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dmcore import cluster_meter, galactic, lensing_meter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
API = 'https://api.lsst.fink-portal.org/api/v1/'
UA = 'observatory-data-refresh'
TAGS = ['most_likely_sn', 'extragalactic_new_candidate', 'hostless_candidate', 'in_tns']
COLUMNS = 'r:diaObjectId,r:ra,r:dec,r:midpointMjdTai,f:xm_legacydr8_pstar'
N_MAX = 15000


def warn(msg):
    print('::warning::' + msg, flush=True)


def iso(mjd):
    return (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=mjd)).strftime('%Y-%m-%d %H:%M:%S')


def post(endpoint, payload, retries=3, timeout=180):
    body = json.dumps(payload).encode()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(API + endpoint, data=body, headers={'Content-Type': 'application/json', 'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read().decode()
            if text.lstrip().startswith('<'):
                raise RuntimeError('HTML error page')
            return json.loads(text)
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep([5, 15, 40][attempt])
    raise last


def fetch_new(start, stop, deadline, state_dir):
    rows_dir = os.path.join(state_dir, 'tags')
    os.makedirs(rows_dir, exist_ok=True)
    got, failed, requests = [], 0, 0
    for tag in TAGS:
        pending = []
        m = start
        while m < stop:
            pending.append((m, min(m + 1.0, stop)))
            m += 1.0
        while pending:
            if time.time() > deadline:
                warn('dark matter: fetch time budget used up; the rest waits for the next run')
                return got, failed, requests, False
            a, b = pending.pop(0)
            path = os.path.join(rows_dir, f'{tag}_{a:.3f}_{b:.3f}.json')
            final = b < stop - 0.01
            if os.path.exists(path):
                got += [dict(r, _tag=tag) for r in json.load(open(path))]
                continue
            try:
                rows = post('tags', {'tag': tag, 'n': N_MAX, 'startdate': iso(a), 'stopdate': iso(b), 'columns': COLUMNS})
                requests += 1
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
            if final:
                json.dump(rows, open(path, 'w'))
            got += [dict(r, _tag=tag) for r in rows]
            time.sleep(1.0)
    return got, failed, requests, True


def main():
    ap = argparse.ArgumentParser(description='Nightly dark-matter refresh: new Fink SN-like alerts, both meters recomputed, cmb.json rewritten.')
    ap.add_argument('--inputs', default=os.path.join(HERE, 'ci-data', 'dm_inputs.npz'))
    ap.add_argument('--cmb', default=os.path.join(ROOT, 'site', 'data', 'cmb.json'))
    ap.add_argument('--out', default=None, help='where to write the refreshed cmb.json (default: in place)')
    ap.add_argument('--state', default=os.path.join(ROOT, 'data', 'dm-state'))
    ap.add_argument('--minutes', type=float, default=8.0)
    ap.add_argument('--no-fetch', action='store_true', help='recompute the meters from the stored objects only')
    a = ap.parse_args()
    t0 = time.time()
    deadline = t0 + a.minutes * 60

    inp = np.load(a.inputs)
    nside = int(inp['nside'])
    kappa = inp['kappa'].astype(np.float64)
    mask = np.unpackbits(inp['mask'])[:12 * nside * nside].astype(bool)
    ids = np.cumsum(inp['ids_diff'])
    ra, dec, mjd, flags = inp['ra'].astype(np.float64), inp['dec'].astype(np.float64), inp['first_mjd'], inp['flags']
    snapshot = float(inp['snapshot_mjd'])
    known = {int(i): k for k, i in enumerate(ids)}

    os.makedirs(a.state, exist_ok=True)
    new_path = os.path.join(a.state, 'new_objects.json')
    new = json.load(open(new_path)) if os.path.exists(new_path) else {}
    fetched_to = max([snapshot] + [v['t'] for v in new.values()])
    fetched, failed, requests, complete = 0, 0, 0, True
    if not a.no_fetch:
        now = (datetime.datetime.utcnow() - datetime.datetime(1858, 11, 17)).total_seconds() / 86400
        start = np.floor(fetched_to - 0.5) + 0.5 - 1.0
        rows, failed, requests, complete = fetch_new(max(start, snapshot - 1.0), now, deadline, a.state)
        for r in rows:
            try:
                oid = int(r['r:diaObjectId'])
                t = float(r['r:midpointMjdTai'])
                rr, dd = float(r['r:ra']), float(r['r:dec'])
            except (KeyError, TypeError, ValueError):
                continue
            if oid in known:
                k = known[oid]
                if r['_tag'] == 'most_likely_sn':
                    flags[k] |= 1
                continue
            ps = r.get('f:xm_legacydr8_pstar')
            star = isinstance(ps, (int, float)) and ps == ps and ps > 0.5
            e = new.get(str(oid))
            if e is None:
                new[str(oid)] = {'ra': rr, 'dec': dd, 't': t, 'ms': r['_tag'] == 'most_likely_sn', 'star': bool(star)}
                fetched += 1
            else:
                e['t'] = min(e['t'], t)
                e['ms'] = e['ms'] or r['_tag'] == 'most_likely_sn'
                e['star'] = e['star'] or bool(star)
        json.dump(new, open(new_path, 'w'))
        if failed:
            warn(f'dark matter: {failed} Fink tag requests failed after retries')

    n_ra = np.array([v['ra'] for v in new.values()], float)
    n_dec = np.array([v['dec'] for v in new.values()], float)
    n_t = np.array([v['t'] for v in new.values()], float)
    n_ms = np.array([v['ms'] for v in new.values()], bool)
    n_star = np.array([v['star'] for v in new.values()], bool)
    all_ra = np.concatenate([ra, n_ra])
    all_dec = np.concatenate([dec, n_dec])
    all_ms = np.concatenate([(flags & 1).astype(bool), n_ms])
    all_star = np.concatenate([(flags & 2).astype(bool), n_star])
    all_t = np.concatenate([mjd, n_t])

    lens = lensing_meter(kappa, mask, nside, all_ra, all_dec, all_star, float(inp['unit_bias']))
    cmb = json.load(open(a.cmb, encoding='ascii'))
    cl = cmb['clusters']
    ctest = cluster_meter(np.array(cl['ra'], float), np.array(cl['dec'], float), np.array(cl['theta500'], float), all_ra[all_ms], all_dec[all_ms])

    meta = cmb['meta']
    base = float(meta['mjdBase'])
    raw = base64.b64decode(cmb['alerts']['data'])
    tri = np.frombuffer(raw, dtype='<u2').reshape(-1, 3)
    snap_tmax = base + tri[:, 2].max() / 100.0
    add = n_ms & (n_t > snap_tmax + 1e-4)
    if add.any():
        order = np.argsort(n_t[add])
        l, b = galactic(n_ra[add][order], n_dec[add][order])
        extra = np.stack([np.round(l / 360 * 65535), np.round((b + 90) / 180 * 65535), np.round((n_t[add][order] - base) * 100)], axis=1)
        tri = np.concatenate([tri, np.clip(extra, 0, 65535).astype('<u2')])
    cmb['alerts']['n'] = int(tri.shape[0])
    cmb['alerts']['data'] = base64.b64encode(tri.astype('<u2').tobytes()).decode()
    cl['inside'] = ctest['inside']
    L = cmb['lensing']
    L.update({'sigma': round(lens['sigma'], 3), 'bias': round(lens['bias'], 2), 'biasSigma': round(lens['biasSigma'], 2),
              'nObjects': lens['n'], 'areaDeg2': round(lens['area']), 'nulls': [round(v, 3) for v in lens['nulls']]})
    T = cmb['clusterTest']
    T.update({'observed': ctest['observed'], 'expected': round(ctest['expected'], 1), 'sigma': round(ctest['sigma'], 2),
              'excessSigma': round(ctest['excessSigma'], 1), 'clusters': ctest['clusters']})
    latest = float(max(all_t.max(), snap_tmax))
    meta['updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')
    meta['dataTo'] = (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=latest)).strftime('%Y-%m-%d')
    meta['objectsAllTags'] = int(all_ra.size)
    out = a.out or a.cmb
    with open(out, 'w', encoding='ascii') as fh:
        json.dump(cmb, fh, separators=(',', ':'), ensure_ascii=True)
    print(f"dark matter: +{fetched} new objects ({requests} requests, {failed} failed, complete {complete}); "
          f"lensing {lens['sigma']:+.3f} sigma, b = {lens['bias']:.2f} +- {lens['biasSigma']:.2f} from {lens['n']} objects; "
          f"clusters {ctest['observed']} vs {ctest['expected']:.1f} ({ctest['sigma']:.2f} sigma, {ctest['clusters']} clusters); "
          f"{tri.shape[0]} alerts on the map; data to {meta['dataTo']}; {time.time() - t0:.0f} s", flush=True)


if __name__ == '__main__':
    main()
