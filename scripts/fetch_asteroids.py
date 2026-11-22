import argparse
import csv
import gzip
import json
import os
import random
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
D = os.path.join(ROOT, 'data')
OUT = os.path.join(D, 'fetched-2026-11-22')
API = 'https://api.lsst.fink-portal.org/api/v1/'
COLS = ('r:designation,r:midpointMjdTai,r:band,r:ra,r:dec,r:helio_x,r:helio_y,r:helio_z,'
        'r:helio_vx,r:helio_vy,r:helio_vz,r:topoRange,r:psfFlux,r:psfFluxErr,r:observation_reason')
BATCH = 50
SSOFT_COLS = ('sso_name,H_g,H_r,H_i,H_z,G_g,G_r,G_i,G_z,err_H_g,err_H_r,err_G_g,err_G_r,n_obs_g,n_obs_r,n_obs_i,'
              'min_phase,max_phase,rms,chi2red,n_obs,n_days,fit,status')


def post(endpoint, payload, timeout=240):
    req = urllib.request.Request(API + endpoint, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'observatory-data-fetch'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def already_have():
    have = set()
    for i in range(8):
        have |= set(x for x in open(os.path.join(D, f'n50_{i}.txt')).read().split(',') if x)
    return have


def candidates(target):
    have = already_have()
    names = []
    for i in range(3):
        names += [x for x in open(os.path.join(D, f'names{i}.txt')).read().split(',') if x and x not in have]
    seen = set(names) | have
    rows = list(csv.DictReader(open(os.path.join(D, 'ssoft.csv'))))
    rng = random.Random(20261122)
    rng.shuffle(rows)
    for r in rows:
        if len(names) >= target:
            break
        n = r['sso_name']
        if n and n not in seen:
            names.append(n)
            seen.add(n)
    return names


def main():
    global D, OUT
    ap = argparse.ArgumentParser(description='Fetch SSOFT and Fink SSO alerts for more asteroids (resumable; existing files are skipped).')
    ap.add_argument('count', nargs='?', type=int, default=2000, help='number of extra asteroids to fetch')
    ap.add_argument('--data-dir', default=os.path.join(ROOT, 'data'))
    ap.add_argument('--folder', default='fetched-2026-11-22')
    args = ap.parse_args()
    D = os.path.abspath(args.data_dir)
    OUT = os.path.join(D, args.folder)
    os.makedirs(OUT, exist_ok=True)
    ssoft_fn = os.path.join(OUT, 'ssoft-hg.csv.gz')
    if not os.path.exists(ssoft_fn):
        body = post('ssoft', {'columns': SSOFT_COLS, 'output-format': 'csv'})
        with gzip.open(ssoft_fn, 'wb') as fh:
            fh.write(body)
    names = candidates(args.count)
    batches = [names[i:i + BATCH] for i in range(0, len(names), BATCH)]
    for k, b in enumerate(batches):
        fn = os.path.join(OUT, f'sso-x{k:03d}.json.gz')
        if os.path.exists(fn) and os.path.getsize(fn) > 10:
            continue
        t0 = time.time()
        try:
            body = post('sso', {'n_or_d': ','.join(b), 'columns': COLS})
            rows = json.loads(body)
            if not isinstance(rows, list):
                raise ValueError(str(rows)[:200])
        except Exception as ex:
            print(k, 'failed', ex, flush=True)
            continue
        with gzip.open(fn, 'wt', encoding='utf-8') as fh:
            json.dump(rows, fh)
        print(k, len(b), 'names', len(rows), 'rows', round(time.time() - t0, 1), 's', flush=True)


if __name__ == '__main__':
    main()
