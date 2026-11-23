import argparse
import datetime
import json
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'site', 'data')
FINK_STATS = 'https://api.lsst.fink-portal.org/api/v1/statistics'
ANTARES = 'https://api.antares.noirlab.edu/v1/loci'
UA = 'observatory-data-refresh'
MJD0 = datetime.date(1858, 11, 17)
HISTORY_DAYS = 60
STEPS = ['stars', 'asteroids', 'dm', 'showcase', 'tonight']


def warn(msg):
    print('::warning::' + msg, flush=True)


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def day_of_mjd(mjd):
    return MJD0 + datetime.timedelta(days=int(mjd))


def mjd_of_day(day):
    return (day - MJD0).days


def night_label(day):
    return day.strftime('%Y%m%d')


def label_day(label):
    return datetime.datetime.strptime(str(label), '%Y%m%d').date()


def fink_nights(today):
    months = sorted({(today - datetime.timedelta(days=d)).strftime('%Y%m') for d in range(0, HISTORY_DAYS + 10, 10)})
    rows = {}
    for m in months:
        q = urllib.parse.urlencode({'date': m, 'columns': 'f:night,f:alerts,f:visits'})
        for r in get_json(f'{FINK_STATS}?{q}'):
            rows[str(r['f:night'])] = (int(r.get('f:alerts') or 0), int(r.get('f:visits') or 0))
    return rows


def antares_count(lo_mjd):
    query = {'query': {'bool': {'filter': [
        {'prefix': {'properties.newest_alert_id': 'lsst'}},
        {'range': {'properties.newest_alert_observation_time': {'gte': lo_mjd}}},
    ]}}}
    q = urllib.parse.urlencode({'elasticsearch_query[locus_listing]': json.dumps(query), 'page[limit]': 1})
    d = get_json(f'{ANTARES}?{q}')
    return int((d.get('meta') or {}).get('count') or 0)


def antares_last_day(today):
    lo, hi = mjd_of_day(today) - HISTORY_DAYS, mjd_of_day(today) + 1
    if antares_count(lo) == 0:
        return None
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if antares_count(mid) > 0:
            lo = mid
        else:
            hi = mid
    return day_of_mjd(lo)


def site_newest():
    def load(name):
        with open(os.path.join(DATA, name), encoding='utf-8') as f:
            return json.load(f)
    out = {}
    try:
        out['stars'] = night_label(max(label_day(n['night']) for n in load('stars.json')['nights'] if n.get('alerts')))
    except Exception as e:
        warn(f'health: could not read stars.json ({e})')
    try:
        out['asteroids'] = night_label(datetime.date.fromisoformat(load('asteroids.json')['meta']['dmax']))
    except Exception as e:
        warn(f'health: could not read asteroids.json ({e})')
    try:
        sne = load('cmb.json')['sne']
        k = sne['fields'].index('t')
        out['dm'] = night_label(day_of_mjd(max(r[k] for r in sne['rows'])))
    except Exception as e:
        warn(f'health: could not read cmb.json ({e})')
    try:
        out['tonight'] = night_label(datetime.date.fromisoformat(load('tonight.json')['dataTo']))
    except Exception as e:
        warn(f'health: could not read tonight.json ({e})')
    return out


def verdict(today, fink_last, antares_last, newest, steps, reachable):
    upstream = max([d for d in (fink_last, antares_last) if d], default=None)
    failed = [k for k, v in steps.items() if v in ('failure', 'fallback')]
    behind = [k for k, v in newest.items() if fink_last and label_day(v) < fink_last]
    if upstream is None:
        return {'code': 'unknown', 'level': 'warn'}
    gap = (today - upstream).days
    if fink_last and antares_last and (antares_last - fink_last).days >= 2:
        return {'code': 'broker-lag', 'level': 'warn', 'since': night_label(fink_last), 'ahead': night_label(antares_last)}
    if failed:
        return {'code': 'pipeline', 'level': 'bad', 'failed': failed, 'gap': gap, 'since': night_label(upstream)}
    if gap >= 2:
        return {'code': 'rubin-silent', 'level': 'warn' if gap <= 3 else 'quiet', 'since': night_label(upstream), 'gap': gap}
    if behind:
        return {'code': 'behind', 'level': 'warn', 'behind': behind, 'since': night_label(upstream)}
    if not all(reachable.values()):
        return {'code': 'partial', 'level': 'ok', 'since': night_label(upstream)}
    return {'code': 'ok', 'level': 'ok', 'since': night_label(upstream)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fallbacks', default='')
    args = ap.parse_args()
    now = datetime.datetime.now(datetime.timezone.utc)
    today = now.date()
    reachable = {'fink': True, 'antares': True}

    nights = {}
    try:
        nights = fink_nights(today)
    except Exception as e:
        reachable['fink'] = False
        warn(f'health: Fink statistics unreachable ({e})')
    lit = sorted(n for n, (a, _) in nights.items() if a > 0)
    fink_last = label_day(lit[-1]) if lit else None

    antares_last = None
    try:
        antares_last = antares_last_day(today)
    except Exception as e:
        reachable['antares'] = False
        warn(f'health: ANTARES unreachable ({e})')

    steps = {k: os.environ.get(f'STEP_{k.upper()}', 'skipped') or 'skipped' for k in STEPS}
    fallbacks = set()
    if args.fallbacks and os.path.exists(args.fallbacks):
        with open(args.fallbacks, encoding='utf-8') as f:
            fallbacks = {os.path.basename(x.strip()) for x in f if x.strip()}
    for k, name in (('stars', 'stars.json'), ('asteroids', 'asteroids.json'), ('dm', 'cmb.json'), ('showcase', 'showcase.json'), ('tonight', 'tonight.json')):
        if name in fallbacks:
            steps[k] = 'fallback'

    newest = site_newest()
    start = today - datetime.timedelta(days=HISTORY_DAYS - 1)
    history = []
    for i in range(HISTORY_DAYS):
        a, v = nights.get(night_label(start + datetime.timedelta(days=i)), (0, 0))
        history.append([a, v])

    out = {
        'version': 1,
        'checked': now.strftime('%Y-%m-%dT%H:%MZ'),
        'reachable': reachable,
        'fink': {'last': night_label(fink_last) if fink_last else None, 'night': list(nights.get(night_label(fink_last), (0, 0))) if fink_last else None},
        'antares': {'last': night_label(antares_last) if antares_last else None},
        'history': {'start': night_label(start), 'nights': history},
        'steps': steps,
        'site': newest,
        'verdict': verdict(today, fink_last, antares_last, newest, steps, reachable),
        'links': {'rubin': 'https://rubinobservatory.org/for-scientists/rubin-101/live-status', 'fink': 'https://lsst.fink-portal.org/', 'antares': 'https://antares.noirlab.edu/'},
    }
    with open(os.path.join(DATA, 'health.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"health: {out['verdict']} fink={out['fink']['last']} antares={out['antares']['last']} site={newest} steps={steps}", flush=True)


if __name__ == '__main__':
    main()
