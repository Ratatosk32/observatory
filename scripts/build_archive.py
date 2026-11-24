import argparse
import datetime
import gzip
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'site', 'data')
VERSION = 1


def warn(msg):
    print('::warning::' + msg, flush=True)


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def part(name, fn):
    try:
        return fn()
    except Exception as e:
        warn(f'archive: skipped {name} ({e.__class__.__name__}: {e})')
        return None


def column(obj, key, i):
    col = obj.get(key)
    return col[i] if isinstance(col, list) and i < len(col) else None


def stars_objects(st):
    o, cats, fams = st['objects'], st['meta']['catTypes'], [f['key'] for f in st['meta']['families']]
    out = {}
    for i, oid in enumerate(o['id']):
        cat, fam = column(o, 'catType', i), column(o, 'fam', i)
        out[oid] = [
            fams[fam] if isinstance(fam, int) and 0 <= fam < len(fams) else None,
            cats[cat] if isinstance(cat, int) and 0 <= cat < len(cats) else None,
            column(o, 'name', i) or None,
            column(o, 'z', i),
            column(o, 'zSrc', i) or None,
        ]
    return out


def cluster_names(cmb):
    raw, n = cmb['clusters']['names'], cmb['clusters']['n']
    for sep in ('\n', '|', '\t', ';'):
        parts = raw.split(sep)
        if len(parts) == n:
            return parts
    return None


def showcase(sc, st, ast, cmb):
    ids = {
        'stars': (lambda i: st['objects']['id'][i]) if st else None,
        'asteroids': (lambda i: ast['objs'][i]['n']) if ast else None,
    }
    names = part('cluster names', lambda: cluster_names(cmb)) if cmb else None
    if names:
        ids['dm'] = lambda i: names[i]
    out = {}
    for mode, m in sc['modes'].items():
        k = (m.get('top') or {}).get('desktop', 120)
        name_of = ids.get(mode)
        rows = []
        for idx in m['rank'][:k]:
            row = {'i': idx, 'score': m['score'][idx] if idx < len(m['score']) else None}
            if name_of:
                row['id'] = part(f'{mode} id', lambda: name_of(idx))
            if 'why' in m and idx < len(m['why']):
                row['why'] = m['why'][idx]
            fact = (m.get('facts') or {}).get(str(idx))
            if fact:
                row['facts'] = {fk: fv for fk, fv in fact.items() if fk != 'c'}
            rows.append(row)
        out[mode] = {'n': m['n'], 'refNight': m.get('refNight'), 'whyBits': m.get('whyBits'), 'top': rows}
    return out


def dm_meters(cmb):
    keep = ('sigma', 'bias', 'biasSigma', 'nObjects', 'areaDeg2', 'controlSigma', 'controlBias', 'controlBiasSigma', 'forecast')
    return {'lensing': {k: cmb['lensing'].get(k) for k in keep}, 'clusterTest': cmb['clusterTest']}


def dm_classified(cmb):
    sne = cmb['sne']
    f = sne['fields']
    kt, kz, kl, kb, kc = f.index('tnsType'), f.index('z'), f.index('l'), f.index('b'), f.index('t')
    return [[r[kl], r[kb], r[kc], r[kt], r[kz]] for r in sne['rows'] if r[kt]]


def summary(arr, scale=1):
    vals = [v / scale for v in (arr or []) if v is not None]
    if not vals:
        return None
    return {'mean': round(sum(vals) / len(vals), 2), 'min': round(min(vals), 2), 'max': round(max(vals), 2), 'n': len(vals)}


def earth(e):
    m, sw = e['meta'], e.get('sw') or {}
    return {
        'window': m.get('window'),
        'kp': sw.get('kp'),
        'kpForecast': sw.get('kpForecast'),
        'scales': sw.get('scales'),
        'flares': sw.get('flares'),
        'solarWind': {'source': sw.get('source'), 'speedKmS': summary(sw.get('speed')), 'densityCm3': summary(sw.get('density'), 10), 'bzGsmNt': summary(sw.get('bz'), 10)},
        'auroraPowerGW': {'north': summary(sw.get('hpN')), 'south': summary(sw.get('hpS')), 'ovationRun': (m.get('swpc') or {}).get('ovationRun')},
        'lightning': {
            'flashes': m.get('flashes'), 'glm': m.get('glm'), 'li': m.get('li'), 'hourly': e.get('hourly'),
            'regions': {r['id']: {'name': r['name'], 'covered': r['covered'], 'flashes': r['total']} for r in e.get('regions') or []},
            'topStorms': [{k: c.get(k) for k in ('name', 'lat', 'lon', 'sat', 'total', 'peak', 'h0', 'h1', 'areaMax', 'sea')} for c in (e.get('cells') or [])[:10]],
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--commit', default=os.environ.get('GITHUB_SHA', 'local')[:8])
    args = ap.parse_args()
    now = datetime.datetime.now(datetime.timezone.utc)

    st = part('stars.json', lambda: load('stars.json'))
    ast = part('asteroids.json', lambda: load('asteroids.json'))
    cmb = part('cmb.json', lambda: load('cmb.json'))
    sc = part('showcase.json', lambda: load('showcase.json'))

    snap = {
        'version': VERSION,
        'date': now.strftime('%Y-%m-%d'),
        'built': now.strftime('%Y-%m-%dT%H:%MZ'),
        'commit': args.commit,
        'health': part('health.json', lambda: load('health.json')),
        'dm': part('dm meters', lambda: dm_meters(cmb)) if cmb else None,
        'dmClassified': part('dm classified', lambda: dm_classified(cmb)) if cmb else None,
        'showcase': part('showcase', lambda: showcase(sc, st, ast, cmb)) if sc else None,
        'stars': {
            'meta': part('stars meta', lambda: {k: st['meta'].get(k) for k in ('built', 'counts', 'mjdRange')}),
            'fields': ['family', 'catalogueType', 'name', 'z', 'zSource'],
            'objects': part('stars objects', lambda: stars_objects(st)),
        } if st else None,
        'asteroids': part('asteroids meta', lambda: ast['meta']) if ast else None,
        'tonight': part('tonight.json', lambda: load('tonight.json')),
        'earth': part('earth', lambda: earth(load('earth.json'))),
    }
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{snap['date']}.json.gz")
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(snap, f, separators=(',', ':'), allow_nan=False)
    missing = [k for k, v in snap.items() if v is None]
    print(f'archive: wrote {path} ({os.path.getsize(path) / 1024:.1f} KB gzip){" missing " + ", ".join(missing) if missing else ""}', flush=True)


if __name__ == '__main__':
    main()
