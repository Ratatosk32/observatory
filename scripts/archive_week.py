import argparse
import copy
import datetime
import gzip
import hashlib
import json
import os
import re
import sys

VERSIONS = {'week': 1, 'delta': 1, 'events': 1, 'summary': 1}
INDEX_VERSION = 1
PARTS = ['health', 'dm', 'dmClassified', 'showcase', 'stars', 'asteroids', 'tonight', 'earth']
DAY_FIELDS = ['date', 'night', 'silent', 'verdict', 'finkAlerts', 'objects', 'lensSigma', 'clusterSigma', 'clusterObserved', 'topStar', 'topScore', 'kpMax', 'windMax', 'bzMin', 'flashes', 'auroraMax']
NIGHT_FIELDS = ['night', 'from', 'to', 'runs', 'silent', 'verdict', 'finkAlerts', 'objects', 'lensSigma', 'clusterSigma', 'topStar', 'topScore']
METERS = {
    'lensSigma': ('dm', 'lensing', 'sigma'),
    'lensBias': ('dm', 'lensing', 'bias'),
    'lensObjects': ('dm', 'lensing', 'nObjects'),
    'controlSigma': ('dm', 'lensing', 'controlSigma'),
    'clusterObserved': ('dm', 'clusterTest', 'observed'),
    'clusterExpected': ('dm', 'clusterTest', 'expected'),
    'clusterSigma': ('dm', 'clusterTest', 'sigma'),
    'dr5Sigma': ('dm', 'clusterTest', 'dr5Ghost', 'sigma'),
}
SNAPSHOT_NAME = re.compile(r'^(\d{4}-\d{2}-\d{2})\.json\.gz$')
WEEK_NAME = re.compile(r'^(\d{4})-W(\d{2})\.json\.gz$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
RECLASS_KEPT = 200
STORMS_KEPT = 5


def warn(msg):
    print('::warning::' + msg, flush=True)


def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(x):
    return hashlib.sha256(canonical(x).encode('utf-8')).hexdigest()


def same(a, b):
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, float):
        return repr(a) == repr(b)
    return a == b


def list_refs(a, b):
    if not isinstance(a, list) or not isinstance(b, list) or not b or not all(isinstance(x, (dict, list)) for x in b):
        return None
    where = {}
    for i, x in enumerate(a):
        where.setdefault(canonical(x), i)
    refs = [where.get(canonical(x), x) for x in b]
    if not any(isinstance(r, int) for r in refs):
        return None
    return refs if len(canonical(refs)) < len(canonical(b)) else None


def diff(a, b, path=None, ops=None):
    path = [] if path is None else path
    ops = [] if ops is None else ops
    if same(a, b):
        return ops
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a:
            if k not in b:
                ops.append(['-', path + [k]])
        for k, v in b.items():
            if k in a:
                diff(a[k], v, path + [k], ops)
            else:
                ops.append(['+', path + [k], v])
        return ops
    refs = list_refs(a, b)
    ops.append(['L', path, refs] if refs is not None else ['=', path, b])
    return ops


def resolve(op, old, history=None):
    kind = op[0]
    if kind == '@':
        return apply(copy.deepcopy(dig(history[op[2]], *op[1])), op[3], history)
    if kind == 'L':
        return [copy.deepcopy(old[r] if isinstance(r, int) else r) for r in op[2]]
    if kind in ('+', '='):
        return copy.deepcopy(op[2])
    raise ValueError(f'unknown delta op {kind!r}')


def apply(doc, ops, history=None):
    for op in ops:
        path = op[1]
        if not path:
            doc = resolve(op, doc, history)
            continue
        parent = doc
        for k in path[:-1]:
            parent = parent[k]
        if op[0] == '-':
            del parent[path[-1]]
        else:
            parent[path[-1]] = resolve(op, parent.get(path[-1]), history)
    return doc


def restoring_diff(history, prev, cur):
    ops = []
    for op in diff(prev, cur):
        key = op[1][0] if op[0] == '=' and len(op[1]) == 1 else None
        if key is not None and prev.get(key) is None and isinstance(op[2], (dict, list)):
            earlier = [j for j in range(len(history) - 1, -1, -1) if dig(history[j], key) is not None]
            if earlier:
                sub = diff(history[earlier[0]][key], op[2])
                if len(canonical(sub)) < len(canonical(op[2])):
                    op = ['@', [key], earlier[0], sub]
        ops.append(op)
    return ops


def reconstruct(week):
    state = copy.deepcopy(week['keyframe']['state'])
    out = [copy.deepcopy(state)]
    for d in week['deltas']:
        state = apply(state, d['ops'], out)
        out.append(copy.deepcopy(state))
    return out


def dig(x, *keys):
    for k in keys:
        if isinstance(x, dict):
            x = x.get(k)
        elif isinstance(x, list) and isinstance(k, int) and -len(x) <= k < len(x):
            x = x[k]
        else:
            return None
    return x


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def night_of(s):
    n = dig(s, 'health', 'fink', 'last')
    if not isinstance(n, str) or not n:
        n = s.get('night') if isinstance(s, dict) else None
    return n if isinstance(n, str) and n else None


def verdict_of(s):
    v = dig(s, 'health', 'verdict')
    return v if isinstance(v, dict) else None


def peak(pairs):
    best = None
    for p in pairs if isinstance(pairs, list) else []:
        v = num(dig(p, 1))
        if v is not None and (best is None or v > best[1]):
            best = (dig(p, 0), v)
    return best


def aurora_max(s):
    vals = [num(dig(s, 'earth', 'auroraPowerGW', h, 'max')) for h in ('north', 'south')]
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


def day_row(s, silent):
    objs = dig(s, 'stars', 'objects')
    kp = peak(dig(s, 'earth', 'kp'))
    return [
        s.get('date'), night_of(s), silent, dig(s, 'health', 'verdict', 'code'),
        num(dig(s, 'health', 'fink', 'night', 0)),
        len(objs) if isinstance(objs, dict) else None,
        num(dig(s, *METERS['lensSigma'])), num(dig(s, *METERS['clusterSigma'])), num(dig(s, *METERS['clusterObserved'])),
        dig(s, 'showcase', 'stars', 'top', 0, 'id'), num(dig(s, 'showcase', 'stars', 'top', 0, 'score')),
        kp[1] if kp else None,
        num(dig(s, 'earth', 'solarWind', 'speedKmS', 'max')), num(dig(s, 'earth', 'solarWind', 'bzGsmNt', 'min')),
        num(dig(s, 'earth', 'lightning', 'flashes')), aurora_max(s),
    ]


def silent_flags(snaps, prev_night):
    flags, last = [], prev_night
    for s in snaps:
        n = night_of(s)
        flags.append(n is None or n == last)
        if n is not None:
            last = n
    return flags


def row_key(row):
    if not isinstance(row, dict):
        return None
    k = row.get('id')
    return k if k is not None else f"#{row.get('i')}"


def object_events(a, b):
    if not isinstance(a, dict) or not isinstance(b, dict):
        return None
    out = {}
    added = sorted(k for k in b if k not in a)
    removed = sorted(k for k in a if k not in b)
    changed = [[k, a[k], b[k]] for k in sorted(b) if k in a and not same(a[k], b[k])]
    if added:
        out['added'] = added
    if removed:
        out['removed'] = removed
    if changed:
        out['reclassified'] = changed
    return out or None


def showcase_events(pa, pb):
    if not isinstance(pa, dict) or not isinstance(pb, dict):
        return None
    out = {}
    for mode in sorted(pb):
        a, b = dig(pa, mode, 'top'), dig(pb, mode, 'top')
        if not isinstance(a, list) or not isinstance(b, list):
            continue
        ra = {row_key(r): i + 1 for i, r in reversed(list(enumerate(a)))}
        rb = {row_key(r): i + 1 for i, r in reversed(list(enumerate(b)))}
        ev = {}
        entered = [[k, rb[k], num(dig(b, rb[k] - 1, 'score'))] for k in rb if k not in ra]
        exited = [[k, ra[k]] for k in ra if k not in rb]
        moved = [[k, ra[k], rb[k]] for k in rb if k in ra and ra[k] != rb[k]]
        for name, rows, col in (('entered', entered, 1), ('exited', exited, 1), ('moved', moved, 2)):
            if rows:
                ev[name] = sorted(rows, key=lambda r: r[col])
        if ev:
            out[mode] = ev
    return out or None


def changed_at(prev, cur, path):
    v = dig(cur, *path)
    return v if v is not None and not same(dig(prev, *path), v) else None


def earth_events(prev, cur):
    out = {}
    for name, path in (('kp', ('earth', 'kp')), ('scales', ('earth', 'scales')), ('flares', ('earth', 'flares')), ('solarWind', ('earth', 'solarWind')), ('auroraPowerGW', ('earth', 'auroraPowerGW'))):
        v = changed_at(prev, cur, path)
        if v is not None:
            out[name] = v
    if 'kp' in out:
        kp = peak(out['kp'])
        out['kpMax'] = kp[1] if kp else None
    flashes = changed_at(prev, cur, ('earth', 'lightning', 'flashes'))
    regions = dig(cur, 'earth', 'lightning', 'regions')
    light = {}
    if flashes is not None:
        light['flashes'] = flashes
    if isinstance(regions, dict):
        before = dig(prev, 'earth', 'lightning', 'regions') or {}
        moved = {k: dig(r, 'flashes') for k, r in sorted(regions.items()) if not same(dig(before, k, 'flashes'), dig(r, 'flashes'))}
        if moved:
            light['regions'] = moved
    if light:
        out['lightning'] = light
    return out


def events(prev, cur):
    ev = {'verdict': verdict_of(cur)}
    missing = [k for k in PARTS if cur.get(k) is None]
    restored = [k for k in PARTS if prev is not None and prev.get(k) is None and cur.get(k) is not None]
    if missing:
        ev['missing'] = missing
    if restored:
        ev['restored'] = restored
    if prev is None:
        return ev
    objs = object_events(dig(prev, 'stars', 'objects'), dig(cur, 'stars', 'objects'))
    if objs:
        ev['objects'] = objs
    sc = showcase_events(prev.get('showcase'), cur.get('showcase'))
    if sc:
        ev['showcase'] = sc
    meters = {name: v for name, path in METERS.items() for v in [changed_at(prev, cur, path)] if v is not None}
    if meters:
        ev['meters'] = meters
    ev.update(earth_events(prev, cur))
    return ev


def group_runs(entries):
    out = []
    for date, night, silent, verdict in entries:
        last = out[-1] if out else None
        code = (verdict or {}).get('code')
        if silent and last and last['silent'] and last['night'] == night:
            last['dates'][1] = date
            last['runs'] += 1
            last['reason'] = code or 'no health'
            last['level'] = (verdict or {}).get('level')
            last['gap'] = (verdict or {}).get('gap')
            continue
        item = {'night': night, 'silent': silent, 'dates': [date, date], 'runs': 1}
        if silent:
            item.update({'reason': code or 'no health', 'level': (verdict or {}).get('level'), 'gap': (verdict or {}).get('gap')})
        else:
            item['verdict'] = code
        out.append(item)
    return out


def leader(s, mode):
    row = dig(s, 'showcase', mode, 'top', 0)
    if not isinstance(row, dict):
        return None
    return {'id': row_key(row), 'score': row.get('score'), 'why': row.get('why'), 'facts': row.get('facts'), 'date': s.get('date'), 'night': night_of(s)}


def persistence(snaps, flags):
    picks = [s for s, silent in zip(snaps, flags) if not silent] or snaps
    out = {}
    modes = sorted({m for s in picks if isinstance(s.get('showcase'), dict) for m in s['showcase']})
    for mode in modes:
        sets = [{row_key(r) for r in rows} for s in picks for rows in [dig(s, 'showcase', mode, 'top')] if isinstance(rows, list)]
        if not sets:
            continue
        counts = {}
        for keys in sets:
            for k in keys:
                counts[k] = counts.get(k, 0) + 1
        stayed = sorted(k for k, c in counts.items() if c == len(sets))
        fleeting = sorted(k for k, c in counts.items() if c == 1) if len(sets) > 1 else []
        out[mode] = {'nights': len(sets), 'seen': len(counts), 'stayed': len(stayed), 'fleeting': len(fleeting), 'stayedIds': stayed, 'fleetingIds': fleeting}
    return out


def summary(snaps, flags, deltas):
    rows = [day_row(s, f) for s, f in zip(snaps, flags)]
    groups = group_runs([(s.get('date'), night_of(s), f, verdict_of(s)) for s, f in zip(snaps, flags)])
    leaders = {}
    for s in snaps:
        for mode in ('stars', 'asteroids', 'dm'):
            cand = leader(s, mode)
            if cand and num(cand['score']) is not None and (mode not in leaders or cand['score'] > leaders[mode]['score']):
                leaders[mode] = cand
    storms = []
    for s in snaps:
        for c in dig(s, 'earth', 'lightning', 'topStorms') or []:
            if isinstance(c, dict) and num(c.get('total')) is not None:
                storms.append(dict(c, date=s.get('date')))
    storms.sort(key=lambda c: -c['total'])
    region_peaks = {}
    for s in snaps:
        for rid, r in (dig(s, 'earth', 'lightning', 'regions') or {}).items():
            f = num(dig(r, 'flashes'))
            if f is not None and (rid not in region_peaks or f > region_peaks[rid]['flashes']):
                region_peaks[rid] = {'name': dig(r, 'name'), 'flashes': f, 'date': s.get('date')}
    kp_best = None
    for s in snaps:
        p = peak(dig(s, 'earth', 'kp'))
        if p and (kp_best is None or p[1] > kp_best['kp']):
            kp_best = {'kp': p[1], 'time': p[0], 'date': s.get('date')}
    reclass = [[d['date'], *r] for d in deltas for r in dig(d, 'events', 'objects', 'reclassified') or []]

    def extreme(col, pick):
        vals = [(r[col], r[0]) for r in rows if r[col] is not None]
        if not vals:
            return None
        v = pick(vals, key=lambda t: t[0])
        return {'value': v[0], 'date': v[1]}

    col = {f: i for i, f in enumerate(DAY_FIELDS)}
    return {
        'runs': len(snaps),
        'dataNights': [{'night': g['night'], 'date': g['dates'][0], 'verdict': g.get('verdict')} for g in groups if not g['silent']],
        'silent': [g for g in groups if g['silent']],
        'series': {'fields': DAY_FIELDS, 'rows': rows},
        'top': {
            'weirdest': leaders.get('stars'),
            'leaders': leaders,
            'storms': storms[:STORMS_KEPT],
            'busiestDay': extreme(col['flashes'], max),
            'regionPeaks': region_peaks,
            'kpMax': kp_best,
            'windMax': extreme(col['windMax'], max),
            'bzMin': extreme(col['bzMin'], min),
            'reclassified': len(reclass),
            'reclassifications': reclass[:RECLASS_KEPT],
        },
        'showcase': persistence(snaps, flags),
    }


def build_week(name, snaps, prev_night=None):
    flags = silent_flags(snaps, prev_night)
    head = snaps[0]
    keyframe = {'date': head.get('date'), 'night': night_of(head), 'silent': flags[0], 'sha256': digest(head), 'events': events(None, head), 'state': head}
    deltas = []
    for i, (prev, cur, silent) in enumerate(zip(snaps, snaps[1:], flags[1:])):
        deltas.append({'date': cur.get('date'), 'night': night_of(cur), 'silent': silent, 'sha256': digest(cur), 'events': events(prev, cur), 'ops': restoring_diff(snaps[:i + 1], prev, cur)})
    versions = sorted({s.get('version') for s in snaps if isinstance(s.get('version'), int)})
    timeline = group_runs([(s.get('date'), night_of(s), f, verdict_of(s)) for s, f in zip(snaps, flags)])
    return {
        'versions': dict(VERSIONS, snapshot=versions),
        'week': name,
        'from': snaps[0].get('date'),
        'to': snaps[-1].get('date'),
        'prevNight': prev_night,
        'timeline': timeline,
        'summary': summary(snaps, flags, deltas),
        'keyframe': keyframe,
        'deltas': deltas,
    }


def encode(obj):
    return gzip.compress(json.dumps(obj, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8'), compresslevel=9, mtime=0)


def decode(data):
    return json.loads(gzip.decompress(data).decode('utf-8'))


def check(week, snaps=None):
    rebuilt = reconstruct(week)
    recorded = [week['keyframe']['sha256']] + [d['sha256'] for d in week['deltas']]
    if snaps is not None and len(snaps) != len(rebuilt):
        return f'{len(rebuilt)} nights rebuilt, {len(snaps)} expected'
    for i, s in enumerate(rebuilt):
        if digest(s) != recorded[i]:
            return f'night {i} ({s.get("date")}) does not match its recorded sha256'
        if snaps is not None and canonical(s) != canonical(snaps[i]):
            return f'night {i} ({snaps[i].get("date")}) does not rebuild byte-exact'
    return None


def verify_bytes(data, snaps):
    try:
        return check(decode(data), snaps)
    except Exception as e:
        return f'{e.__class__.__name__}: {e}'


def week_of(date):
    y, w, _ = datetime.date.fromisoformat(date).isocalendar()
    return f'{y}-W{w:02d}'


def read_gz(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return decode(raw), raw


def write_if_changed(path, data):
    if os.path.exists(path):
        with open(path, 'rb') as f:
            if f.read() == data:
                return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    return True


def walk(top):
    for root, dirs, files in os.walk(top):
        dirs.sort()
        for name in sorted(files):
            yield root, name


def snapshot_date(snap, name):
    d = snap.get('date') if isinstance(snap, dict) else None
    if isinstance(d, str) and DATE.match(d):
        return d
    m = SNAPSHOT_NAME.match(name)
    return m.group(1) if m else None


def gather(branch, incoming):
    cands, order = {}, 0
    sources = [(os.path.join(branch, 'snapshots'), 1), (incoming, 2)] if incoming else [(os.path.join(branch, 'snapshots'), 1)]
    for top, priority in sources:
        if not top or not os.path.isdir(top):
            continue
        for root, name in walk(top):
            if not SNAPSHOT_NAME.match(name):
                continue
            path = os.path.join(root, name)
            try:
                snap, raw = read_gz(path)
            except Exception as e:
                warn(f'archive: cannot read {path} ({e.__class__.__name__}: {e})')
                continue
            date = snapshot_date(snap, name)
            if date is None:
                warn(f'archive: {path} has no date')
                continue
            order += 1
            cands.setdefault(date, []).append((str(snap.get('built') or ''), priority, order, snap, raw))
    return cands


def load_index(branch):
    path = os.path.join(branch, 'history', 'index.json')
    if not os.path.exists(path):
        return {'days': {}, 'weeks': {}}
    with open(path, encoding='utf-8') as f:
        ix = json.load(f)
    fields = dig(ix, 'days', 'fields') or DAY_FIELDS
    days = {}
    for r in dig(ix, 'days', 'rows') or []:
        row = dict(zip(fields, r))
        days[row.get('date')] = [row.get(f) for f in DAY_FIELDS]
    return {'days': days, 'weeks': {w['week']: w for w in ix.get('weeks') or [] if isinstance(w, dict) and 'week' in w}}


def night_rows(days):
    out = []
    for r in days:
        d = dict(zip(DAY_FIELDS, r))
        last = out[-1] if out else None
        if d['silent'] and last and last[4] and last[0] == d['night']:
            last[2] = d['date']
            last[3] += 1
            last[5] = d['verdict']
            continue
        out.append([d['night'], d['date'], d['date'], 1, d['silent'], d['verdict']] + ([None] * 6 if d['silent'] else [d['finkAlerts'], d['objects'], d['lensSigma'], d['clusterSigma'], d['topStar'], d['topScore']]))
    return out


def dump_index(days, weeks):
    rows = [days[k] for k in sorted(days)]
    last = None
    for r in rows:
        r[2] = r[1] is None or r[1] == last
        if r[1] is not None:
            last = r[1]

    def table(fields, rs):
        body = ',\n'.join(json.dumps(r, separators=(',', ':'), ensure_ascii=False) for r in rs)
        return '{"fields":' + json.dumps(fields, separators=(',', ':')) + ',"rows":[\n' + body + '\n]}'

    parts = [
        f'"version":{INDEX_VERSION}',
        '"updated":' + json.dumps(rows[-1][0] if rows else None),
        '"days":' + table(DAY_FIELDS, rows),
        '"nights":' + table(NIGHT_FIELDS, night_rows(rows)),
        '"weeks":[\n' + ',\n'.join(json.dumps(weeks[k], separators=(',', ':')) for k in sorted(weeks)) + '\n]',
    ]
    return ('{' + ',\n'.join(parts) + '}\n').encode('utf-8')


def snapshot_bytes(snap, raw):
    return raw if raw is not None else gzip.compress(json.dumps(snap, separators=(',', ':'), allow_nan=False).encode('utf-8'), compresslevel=9, mtime=0)


def flush(branch, incoming=None):
    cands = gather(branch, incoming)
    weeks_dir = os.path.join(branch, 'weeks')
    touched = sorted({week_of(d) for d in cands})
    broken = set()
    for name in touched:
        path = os.path.join(weeks_dir, f'{name}.json.gz')
        if not os.path.exists(path):
            continue
        try:
            week, _ = read_gz(path)
            problem = check(week)
            if problem:
                raise ValueError(problem)
            for snap in reconstruct(week):
                cands.setdefault(snap.get('date'), []).append((str(snap.get('built') or ''), 0, 0, snap, None))
        except Exception as e:
            warn(f'archive: cannot rebuild {path} ({e.__class__.__name__}: {e}); its new nights stay as daily files')
            broken.add(name)
    chosen = {d: max(c, key=lambda t: t[:3]) for d, c in cands.items()}
    index = load_index(branch)
    for d, c in chosen.items():
        index['days'][d] = day_row(c[3], False)
    nights_by_date = {d: r[1] for d, r in index['days'].items()}
    report = {'written': [], 'kept': [], 'dropped': []}
    for name in touched:
        dates = sorted(d for d in chosen if week_of(d) == name)
        snaps = [chosen[d][3] for d in dates]
        earlier = [d for d in nights_by_date if d < dates[0] and nights_by_date[d] is not None]
        prev_night = nights_by_date[max(earlier)] if earlier else None
        problem = 'the existing week file did not rebuild' if name in broken else None
        data = None
        if problem is None:
            try:
                data = encode(build_week(name, snaps, prev_night))
                problem = verify_bytes(data, snaps)
            except Exception as e:
                problem = f'{e.__class__.__name__}: {e}'
        if problem is None:
            path = os.path.join(weeks_dir, f'{name}.json.gz')
            write_if_changed(path, data)
            week = decode(data)
            index['weeks'][name] = {'week': name, 'file': f'weeks/{name}.json.gz', 'from': dates[0], 'to': dates[-1], 'runs': len(dates), 'dataNights': len(week['summary']['dataNights']), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            report['written'].append((name, dates, len(data)))
            for d in dates:
                daily = os.path.join(branch, 'snapshots', d[:4], f'{d}.json.gz')
                if os.path.exists(daily):
                    os.remove(daily)
                    report['dropped'].append(d)
        else:
            warn(f'archive: week {name} failed its self-check ({problem}); keeping its {len(dates)} daily files')
            for d in dates:
                c = chosen[d]
                if c[1] > 0:
                    write_if_changed(os.path.join(branch, 'snapshots', d[:4], f'{d}.json.gz'), snapshot_bytes(c[3], c[4]))
            report['kept'].append((name, dates))
    snapdir = os.path.join(branch, 'snapshots')
    if os.path.isdir(snapdir):
        for root, dirs, files in os.walk(snapdir, topdown=False):
            if not os.listdir(root):
                os.rmdir(root)
    if chosen:
        write_if_changed(os.path.join(branch, 'history', 'index.json'), dump_index(index['days'], index['weeks']))
    return report


def message(report):
    parts = []
    if report['written']:
        first = min(d for _, ds, _ in report['written'] for d in ds)
        last = max(d for _, ds, _ in report['written'] for d in ds)
        parts.append(f"Archive {', '.join(n for n, _, _ in report['written'])} ({first} to {last})")
    if report['kept']:
        parts.append(f"keep daily files for {', '.join(n for n, _ in report['kept'])}")
    subject = '; '.join(parts) or 'Archive index'
    lines = [subject[:1].upper() + subject[1:], '']
    for n, ds, size in report['written']:
        lines.append(f'{n}: {len(ds)} runs, {size / 1024:.1f} KB, rebuilt byte-exact')
    if report['dropped']:
        lines.append(f"Dropped {len(report['dropped'])} daily files now inside week files")
    return '\n'.join(lines) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description='Pack nightly archive snapshots into weekly keyframe-plus-delta files.')
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('flush', help='merge waiting snapshots into weeks/ on a checkout of the archive branch')
    f.add_argument('--branch', required=True)
    f.add_argument('--incoming')
    f.add_argument('--message')
    v = sub.add_parser('verify', help='rebuild every night of week files and check their sha256')
    v.add_argument('files', nargs='+')
    x = sub.add_parser('extract', help='write one night of a week file back as a snapshot')
    x.add_argument('file')
    x.add_argument('--date', required=True)
    x.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    if args.cmd == 'flush':
        report = flush(args.branch, args.incoming)
        text = message(report)
        if args.message:
            with open(args.message, 'w', encoding='utf-8') as fh:
                fh.write(text)
        print(text, end='', flush=True)
        return 0
    if args.cmd == 'verify':
        bad = 0
        for path in args.files:
            week, raw = read_gz(path)
            problem = check(week)
            print(f"{path}: {'FAILED ' + problem if problem else 'ok'}, {1 + len(week['deltas'])} nights, {len(raw) / 1024:.1f} KB", flush=True)
            bad += bool(problem)
        return 1 if bad else 0
    week, _ = read_gz(args.file)
    for snap in reconstruct(week):
        if snap.get('date') == args.date:
            os.makedirs(args.out, exist_ok=True)
            path = os.path.join(args.out, f'{args.date}.json.gz')
            with open(path, 'wb') as fh:
                fh.write(snapshot_bytes(snap, None))
            print(path, flush=True)
            return 0
    print(f'{args.date} is not in {args.file}', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
