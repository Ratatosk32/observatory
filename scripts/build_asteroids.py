import argparse
import collections
import csv
import datetime
import glob
import gzip
import json
import math
import os
import statistics

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
D = os.path.join(ROOT, 'data')
F = os.path.join(D, 'fetched-2026-11-22')

AU_KM = 149597870.7
K2 = 0.01720209895 ** 2
EPS = math.radians(23.439281)
BANDS = 'ugrizy'
G_FIXED = 0.15


def ssoft_path():
    return os.path.join(F, 'ssoft-hg.csv.gz')


def opener(fn):
    return gzip.open(fn, 'rt', encoding='utf-8') if fn.endswith('.gz') else open(fn, encoding='utf-8')


def eq2ecl(x, y, z):
    return x, y * math.cos(EPS) + z * math.sin(EPS), -y * math.sin(EPS) + z * math.cos(EPS)


def unit(ra, dec):
    r, d = math.radians(ra), math.radians(dec)
    return math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d)


def elements(r, v_kms):
    v = [c * 86400 / AU_KM for c in v_kms]
    rn = math.sqrt(sum(c * c for c in r))
    v2 = sum(c * c for c in v)
    a = 1 / (2 / rn - v2 / K2)
    h = (r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0])
    hn = math.sqrt(sum(c * c for c in h))
    rv = sum(r[k] * v[k] for k in range(3))
    ev = [((v2 - K2 / rn) * r[k] - rv * v[k]) / K2 for k in range(3)]
    e = math.sqrt(sum(c * c for c in ev))
    inc = math.acos(max(-1, min(1, h[2] / hn)))
    node = math.atan2(h[0], -h[1])
    nvec = (math.cos(node), math.sin(node), 0.0)
    if e < 1e-9:
        return None
    cw = sum(nvec[k] * ev[k] for k in range(3)) / e
    w = math.acos(max(-1, min(1, cw)))
    if ev[2] < 0:
        w = 2 * math.pi - w
    cnu = sum(ev[k] * r[k] for k in range(3)) / (e * rn)
    nu = math.acos(max(-1, min(1, cnu)))
    if rv < 0:
        nu = 2 * math.pi - nu
    if e >= 1 or a <= 0:
        return dict(a=a, e=e, i=math.degrees(inc), hyper=True)
    E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    M = (E - e * math.sin(E)) % (2 * math.pi)
    return dict(a=a, e=e, i=math.degrees(inc), node=math.degrees(node) % 360, peri=math.degrees(w) % 360,
                M=math.degrees(M), hyper=False)


def orbit_class(a, e, i):
    q = a * (1 - e)
    if q < 1.3:
        return 'NEO'
    if q < 1.666 and a < 3.2:
        return 'MC'
    if 1.78 < a < 2.06 and e < 0.18 and i > 16:
        return 'HUN'
    if a < 2.06:
        return 'OTH'
    if a < 3.28:
        return 'MBA'
    if a < 3.7:
        return 'CYB'
    if a < 4.2 and e < 0.3:
        return 'HIL'
    if 5.05 < a < 5.35:
        return 'TRO'
    return 'OTH'


def hg_phi(alpha_deg, G):
    t = math.tan(math.radians(alpha_deg) / 2)
    p1 = math.exp(-3.33 * t ** 0.63)
    p2 = math.exp(-1.87 * t ** 1.22)
    return (1 - G) * p1 + G * p2


def observer_ok(r):
    hx, hy, hz = r['r:helio_x'], r['r:helio_y'], r['r:helio_z']
    de = r.get('r:topoRange')
    if not de or r.get('r:ra') is None:
        return False
    ux, uy, uz = unit(r['r:ra'], r['r:dec'])
    d = math.sqrt((hx - de * ux) ** 2 + (hy - de * uy) ** 2 + (hz - de * uz) ** 2)
    return 0.975 < d < 1.025


def fnum(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def load_rows():
    files = sorted(glob.glob(os.path.join(D, 'sso-b50_*.json'))) + sorted(glob.glob(os.path.join(F, 'sso-x*.json.gz')))
    files += [os.path.join(D, 'sso-2020HJ4.json'), os.path.join(D, 'sso-2026CZ10.json')]
    rows, seen = collections.defaultdict(list), set()
    for fn in files:
        try:
            data = json.load(opener(fn))
        except ValueError:
            continue
        if not isinstance(data, list):
            continue
        for r in data:
            name = r.get('f:sso_name') or r.get('r:designation')
            t = r.get('r:midpointMjdTai')
            if not name or t is None or r.get('r:helio_x') is None:
                continue
            key = (name, round(t, 6), r.get('r:band'))
            if key in seen:
                continue
            seen.add(key)
            rows[name].append(r)
    return rows


def load_ssoft():
    out = {}
    fn = ssoft_path()
    for r in csv.DictReader(opener(fn)):
        if r['fit'] != '0':
            continue
        rec = {}
        for b in 'gr':
            H, G, eH = fnum(r['H_' + b]), fnum(r['G_' + b]), fnum(r['err_H_' + b])
            if H is None or G is None or eH is None:
                continue
            if eH > 0.3 or not (0.02 < G < 0.98):
                continue
            rec[b] = [round(H, 2), round(G, 2), round(eH, 2)]
        if rec:
            rec['ph'] = [round(fnum(r['min_phase']) or 0, 1), round(fnum(r['max_phase']) or 0, 1)]
            out[r['sso_name']] = rec
    return out


def ssoft_colour_sample():
    vals = []
    for r in csv.DictReader(opener(ssoft_path())):
        if r['fit'] != '0':
            continue
        Hg, Hr, eg, er = (fnum(r[k]) for k in ('H_g', 'H_r', 'err_H_g', 'err_H_r'))
        if None in (Hg, Hr, eg, er) or eg > 0.2 or er > 0.2:
            continue
        vals.append(round(Hg - Hr, 3))
    return vals


def build():
    rows = load_rows()
    ssoft = load_ssoft()
    objs, colours_all = [], {'gr': [], 'ri': [], 'iz': []}
    nhyper = 0
    ndrop = 0
    for name, rs in rows.items():
        rs.sort(key=lambda r: r['r:midpointMjdTai'])
        good = [r for r in rs if observer_ok(r)]
        ndrop += len(rs) - len(good)
        if not good:
            continue
        last = good[-1]
        pe = eq2ecl(last['r:helio_x'], last['r:helio_y'], last['r:helio_z'])
        ve = eq2ecl(last['r:helio_vx'], last['r:helio_vy'], last['r:helio_vz'])
        el = elements(pe, ve)
        if el is None or el['hyper']:
            nhyper += 1
            continue
        first = good[0]
        el0 = elements(eq2ecl(first['r:helio_x'], first['r:helio_y'], first['r:helio_z']),
                       eq2ecl(first['r:helio_vx'], first['r:helio_vy'], first['r:helio_vz']))
        da = abs(el0['a'] - el['a']) if el0 and not el0['hyper'] else None
        dets = []
        per_band_H = collections.defaultdict(list)
        for r in rs:
            hx, hy, hz = r['r:helio_x'], r['r:helio_y'], r['r:helio_z']
            rh = math.sqrt(hx * hx + hy * hy + hz * hz)
            de = r['r:topoRange']
            ux, uy, uz = unit(r['r:ra'], r['r:dec'])
            ox, oy, oz = hx - de * ux, hy - de * uy, hz - de * uz
            ca = ((-hx) * (ox - hx) + (-hy) * (oy - hy) + (-hz) * (oz - hz)) / (rh * de)
            alpha = math.degrees(math.acos(max(-1, min(1, ca))))
            f, fe = r.get('r:psfFlux'), r.get('r:psfFluxErr')
            band = BANDS.index(r['r:band']) if r.get('r:band') in BANDS else -1
            geom = observer_ok(r)
            mag = merr = red = None
            if f and f > 0:
                mag = 31.4 - 2.5 * math.log10(f)
                if fe and fe > 0:
                    merr = 1.0857 * fe / f
                if geom:
                    red = mag - 5 * math.log10(rh * de)
                    if band >= 0:
                        per_band_H[band].append(red + 2.5 * math.log10(hg_phi(alpha, G_FIXED)))
            ex, ey, _ = eq2ecl(hx, hy, hz)
            dets.append([round(r['r:midpointMjdTai'] - 60000, 5), band,
                         None if mag is None else round(mag, 2),
                         None if merr is None else round(merr, 2),
                         round(alpha, 1) if geom else None, None if red is None else round(red, 2),
                         round(ex, 3) if geom else None, round(ey, 3) if geom else None])
        colours = {}
        pairs = {'gr': (1, 2), 'ri': (2, 3), 'iz': (3, 4)}
        for key, (b1, b2) in pairs.items():
            vals = []
            d1 = [d for d in dets if d[1] == b1 and d[5] is not None]
            d2 = [d for d in dets if d[1] == b2 and d[5] is not None]
            for x in d1:
                best = min(d2, key=lambda y: abs(y[0] - x[0]), default=None)
                if best is not None and abs(best[0] - x[0]) < 0.1 and (x[3] or 1) < 0.1 and (best[3] or 1) < 0.1:
                    vals.append(x[5] - best[5])
            if vals:
                colours[key] = round(statistics.median(vals), 3)
                colours_all[key].append(colours[key])
        Hown = {BANDS[k]: round(statistics.median(v), 2) for k, v in per_band_H.items() if v}
        cls = orbit_class(el['a'], el['e'], el['i'])
        nights = len(set(int(d[0] + 60000 - 0.5) for d in dets))
        o = {'n': name, 'c': cls,
             'el': [round(el['a'], 4), round(el['e'], 4), round(el['i'], 3), round(el['node'], 3), round(el['peri'], 3),
                    round(el['M'], 3), round(last['r:midpointMjdTai'], 4)],
             'H': Hown, 'nn': nights, 'det': dets}
        desig = last.get('r:designation')
        if desig and desig != name:
            o['des'] = desig
        if da is not None and da > 0.05 * el['a']:
            o['unstable'] = round(da, 3)
        s = ssoft.get(name) or (ssoft.get(desig) if desig else None)
        if s:
            o['sf'] = s
        if colours:
            o['col'] = colours
        objs.append(o)
    objs.sort(key=lambda o: o['el'][0])
    return objs, colours_all, nhyper, ndrop


def nights():
    out = {}
    for fn in ('stats-2026.json', 'stats-202611.json'):
        for r in json.load(open(os.path.join(D, fn))):
            n = r['f:night']
            out[n] = [int(n), int(r.get('f:alerts') or 0), int(r.get('f:is_sso') or 0)]
    return [out[k] for k in sorted(out)]


def mjd_to_date(m):
    return (datetime.datetime(1858, 11, 17) + datetime.timedelta(days=m)).strftime('%Y-%m-%d')


def set_dirs(data_dir, fetched):
    global D, F
    D = os.path.abspath(data_dir)
    F = os.path.join(D, fetched)


def main():
    ap = argparse.ArgumentParser(description='Build site/data/asteroids.json from the raw Fink SSO downloads (local files only).')
    ap.add_argument('--data-dir', default=os.path.join(ROOT, 'data'), help='folder with the raw downloads (default: data/)')
    ap.add_argument('--fetched', default='fetched-2026-11-22', help='subfolder written by fetch_asteroids.py')
    ap.add_argument('--out', default=os.path.join(ROOT, 'site', 'data', 'asteroids.json'))
    args = ap.parse_args()
    set_dirs(args.data_dir, args.fetched)
    objs, colours_all, nhyper, ndrop = build()
    ndet = sum(len(o['det']) for o in objs)
    ts = [d[0] + 60000 for o in objs for d in o['det']]
    band_counts = collections.Counter(BANDS[d[1]] for o in objs for d in o['det'] if d[1] >= 0)
    meta = {
        'nobj': len(objs), 'ndet': ndet, 'tmin': min(ts), 'tmax': max(ts),
        'dmin': mjd_to_date(min(ts)), 'dmax': mjd_to_date(max(ts)),
        'bands': dict(band_counts), 'classes': dict(collections.Counter(o['c'] for o in objs)),
        'nhyper': nhyper, 'ndrop': ndrop, 'ssoft_rows': sum(1 for _ in opener(ssoft_path())) - 1,
        'gfixed': G_FIXED,
    }
    out = {'meta': meta, 'objs': objs, 'nights': nights(), 'ssoftGR': ssoft_colour_sample()}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    body = json.dumps(out, separators=(',', ':'))
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(body)
    print('wrote', args.out, len(body) // 1024, 'kB;', meta['nobj'], 'asteroids,', meta['ndet'], 'detections;',
          'colour pairs', {k: len(v) for k, v in colours_all.items()})


if __name__ == '__main__':
    main()
