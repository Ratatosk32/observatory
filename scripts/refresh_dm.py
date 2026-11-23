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
TAG_BIT = {'most_likely_sn': 1, 'in_tns': 4, 'extragalactic_new_candidate': 8}


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


def confident_sne(inp, ra, dec, t, bits, star, act, n=40):
    typed = {int(i): (str(ty), float(z)) for i, ty, z in zip(inp['tns_idx'], inp['tns_type'], inp['tns_z'])}
    tier0 = sorted((k for k, (ty, _) in typed.items() if ty.startswith('SN') and not star[k]), key=lambda k: -t[k])
    ntags = ((bits & 1) > 0).astype(int) + ((bits & 4) > 0) + ((bits & 8) > 0)
    pool = np.flatnonzero(((bits & 1) > 0) & ((bits & 8) > 0) & ~star)
    tier1 = [int(k) for k in pool[np.lexsort((-t[pool], -ntags[pool]))] if int(k) not in typed]
    pick = (tier0 + tier1)[:n]
    l, b = galactic(ra[pick], dec[pick])
    cv = np.stack([np.cos(np.radians(act['act6_dec'])) * np.cos(np.radians(act['act6_ra'])), np.cos(np.radians(act['act6_dec'])) * np.sin(np.radians(act['act6_ra'])), np.sin(np.radians(act['act6_dec']))])
    rows = []
    for j, k in enumerate(pick):
        v = np.array([np.cos(np.radians(dec[k])) * np.cos(np.radians(ra[k])), np.cos(np.radians(dec[k])) * np.sin(np.radians(ra[k])), np.sin(np.radians(dec[k]))])
        sep = np.degrees(np.arccos(np.clip(v @ cv, -1, 1))) * 60 / act['act6_theta']
        c = int(np.argmin(sep))
        ty, z = typed.get(k, (None, None))
        rows.append([round(float(l[j]), 4), round(float(b[j]), 4), round(float(t[k]), 3), ty, None if z is None or z != z else round(z, 4), c if sep[c] < 1 else -1, int(ntags[k])])
    return {'fields': ['l', 'b', 't', 'tnsType', 'z', 'cluster', 'tags'], 'rows': rows}


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
                flags[k] |= TAG_BIT.get(r['_tag'], 0)
                continue
            ps = r.get('f:xm_legacydr8_pstar')
            star = isinstance(ps, (int, float)) and ps == ps and ps > 0.5
            e = new.get(str(oid))
            if e is None:
                new[str(oid)] = {'ra': rr, 'dec': dd, 't': t, 'ms': r['_tag'] == 'most_likely_sn', 'star': bool(star), 'bits': TAG_BIT.get(r['_tag'], 0)}
                fetched += 1
            else:
                e['t'] = min(e['t'], t)
                e['ms'] = e['ms'] or r['_tag'] == 'most_likely_sn'
                e['star'] = e['star'] or bool(star)
                e['bits'] = e.get('bits', 0) | TAG_BIT.get(r['_tag'], 0)
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
    n_bits = np.array([v.get('bits', 0) | (1 if v['ms'] else 0) for v in new.values()], np.uint8)
    all_bits = np.concatenate([flags.astype(np.uint8), n_bits]) if n_bits.size else flags.astype(np.uint8)

    sn_clean = all_ms & ~all_star
    lens = lensing_meter(kappa, mask, nside, all_ra, all_dec, all_star, float(inp['unit_bias']))
    cmb = json.load(open(a.cmb, encoding='ascii'))
    cl = cmb['clusters']
    act = {k: inp[k].astype(np.float64) for k in ('act5_ra', 'act5_dec', 'act5_theta', 'act6_ra', 'act6_dec', 'act6_theta', 'act6_z', 'act6_m500')}
    ghost = cluster_meter(act['act5_ra'], act['act5_dec'], act['act5_theta'], all_ra[sn_clean], all_dec[sn_clean])
    ctest = cluster_meter(act['act6_ra'], act['act6_dec'], act['act6_theta'], all_ra[sn_clean], all_dec[sn_clean])

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
    cmb['sne'] = confident_sne(inp, all_ra, all_dec, all_t, all_bits, all_star, act)
    cmb['alerts']['n'] = int(tri.shape[0])
    cmb['alerts']['data'] = base64.b64encode(tri.astype('<u2').tobytes()).decode()
    c_l, c_b = galactic(act['act6_ra'], act['act6_dec'])
    packed = np.stack([np.round(c_l / 360 * 65535), np.round((c_b + 90) / 180 * 65535), np.round(act['act6_z'] * 1e4),
                       np.round(act['act6_m500'] * 100), np.round(act['act6_theta'] * 100), np.array(ctest['inside'], float),
                       np.round(np.array(ctest['expect']) * 100)], axis=1)
    cmb['clusters'] = cl = {'catalogue': 'ACT DR6', 'n': int(act['act6_ra'].size), 'names': str(inp['act6_names']),
                            'fields': ['l', 'b', 'z', 'm500', 'theta500', 'inside', 'expect'], 'scale': [65535 / 360, 65535 / 180, 1e4, 100, 100, 1, 100],
                            'offset': [0, 90, 0, 0, 0, 0, 0],
                            'data': base64.b64encode(np.clip(packed, 0, 65535).astype('<u2').tobytes()).decode()}
    L = cmb['lensing']
    L.update({'sigma': round(lens['sigma'], 3), 'bias': round(lens['bias'], 2), 'biasSigma': round(lens['biasSigma'], 2),
              'nObjects': lens['n'], 'areaDeg2': round(lens['area']), 'nulls': [round(v, 3) for v in lens['nulls']]})
    T = cmb['clusterTest']
    T.update({'observed': ctest['observed'], 'expected': round(ctest['expected'], 1), 'sigma': round(ctest['sigma'], 2),
              'excessSigma': round(ctest['excessSigma'], 1), 'clusters': ctest['clusters'], 'catalogue': 'ACT DR6', 'of': int(act['act6_ra'].size),
              'south': int((act['act6_dec'] < 10).sum()), 'yearsTo3Sigma': 0.84, 'forecast': '3 sigma after about 0.8 years of full southern coverage, about late 2027',
              'dr5Ghost': {'observed': ghost['observed'], 'expected': round(ghost['expected'], 1), 'sigma': round(ghost['sigma'], 2), 'clusters': ghost['clusters'], 'of': int(act['act5_ra'].size)}})
    latest = float(max(all_t.max(), snap_tmax))
    meta['updated'] = datetime.datetime.utcnow().strftime('%Y-%m-%d')
    meta['dataTo'] = (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=latest)).strftime('%Y-%m-%d')
    meta['objectsAllTags'] = int(all_ra.size)
    out = a.out or a.cmb
    with open(out, 'w', encoding='ascii') as fh:
        json.dump(cmb, fh, separators=(',', ':'), ensure_ascii=True)
    print(f"dark matter: +{fetched} new objects ({requests} requests, {failed} failed, complete {complete}); "
          f"lensing {lens['sigma']:+.3f} sigma, b = {lens['bias']:.2f} +- {lens['biasSigma']:.2f} from {lens['n']} objects; "
          f"DR6 clusters {ctest['observed']} vs {ctest['expected']:.1f} ({ctest['sigma']:.2f} sigma, {ctest['clusters']} clusters), DR5 {ghost['observed']} vs {ghost['expected']:.1f} ({ghost['sigma']:.2f} sigma); "
          f"{tri.shape[0]} alerts on the map; data to {meta['dataTo']}; {time.time() - t0:.0f} s", flush=True)


if __name__ == '__main__':
    main()
