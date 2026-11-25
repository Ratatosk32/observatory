import contextlib
import copy
import datetime
import gzip
import importlib.util
import io
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('archive_week', os.path.join(HERE, 'archive_week.py'))
aw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aw)

BASE = None


def base_snapshot():
    global BASE
    if BASE is None:
        with tempfile.TemporaryDirectory() as out:
            subprocess.run([sys.executable, '-I', os.path.join(HERE, 'build_archive.py'), '--out', out, '--commit', 'test0000'], check=True, stdout=subprocess.DEVNULL)
            name = next(n for n in os.listdir(out) if n.endswith('.json.gz'))
            with gzip.open(os.path.join(out, name), 'rt', encoding='utf-8') as f:
                BASE = json.load(f)
        if not isinstance(BASE.get('health'), dict):
            BASE['health'] = {}
        BASE['health'].setdefault('fink', {'last': '20261115', 'night': [1, 1]})
        BASE['health'].setdefault('verdict', {'code': 'ok', 'level': 'ok'})
        BASE['stars'] = BASE.get('stars') or {'meta': {}, 'fields': [], 'objects': {f'1700{i:014d}': ['unk', 'Fink tag in_tns', None, None, None] for i in range(400)}}
        BASE['showcase'] = BASE.get('showcase') or {m: {'n': 100, 'refNight': 61359.0, 'whyBits': None, 'top': [{'i': i, 'score': 90 - i % 50, 'id': f'{m}{i}'} for i in range(100)]} for m in ('stars', 'asteroids', 'dm')}
    return copy.deepcopy(BASE)


def night_label(date):
    return date.replace('-', '')


def data_night(s, rng, date, prev_date):
    objs = s['stars']['objects']
    ids = sorted(objs)
    for k in rng.sample(ids, min(50, len(ids))):
        del objs[k]
    for k in rng.sample(sorted(objs), min(20, len(objs))):
        row = list(objs[k])
        row[1] = rng.choice(['SN Ia', 'Fink tag mdwarf_flare', 'AGN', 'CV'])
        row[3] = round(rng.random(), 3)
        objs[k] = row
    for _ in range(150):
        objs[str(rng.randrange(10 ** 17, 10 ** 18))] = ['unk', 'Fink tag in_tns', f'AT 2026{rng.randrange(1000)}', round(rng.random(), 3), 'photo']
    for mode, block in s['showcase'].items():
        top = block['top']
        for row in rng.sample(top, min(30, len(top))):
            row['score'] = max(0, (row.get('score') or 0) + rng.randint(-5, 5))
        del top[-15:]
        for j in range(15):
            top.insert(rng.randrange(len(top) + 1), {'i': rng.randrange(5000), 'score': rng.randint(40, 95), 'id': f'{mode}-{date}-{j}'})
        top.sort(key=lambda r: -(r.get('score') or 0))
    s['health']['fink']['last'] = night_label(prev_date)
    s['health']['fink']['night'] = [rng.randrange(10000, 250000), rng.randrange(20, 150)]
    hist = s['health'].get('history')
    if isinstance(hist, dict) and isinstance(hist.get('nights'), list):
        hist['nights'] = hist['nights'][1:] + [s['health']['fink']['night']]
    s['health']['verdict'] = {'code': 'ok', 'level': 'ok', 'since': night_label(prev_date)}
    if isinstance(s.get('dm'), dict):
        s['dm']['lensing']['sigma'] = round(s['dm']['lensing']['sigma'] + rng.uniform(-0.1, 0.1), 3)
        s['dm']['clusterTest']['observed'] += rng.randint(0, 4)
        s['dm']['clusterTest']['sigma'] = round(s['dm']['clusterTest']['sigma'] + rng.uniform(-0.05, 0.08), 2)
    if isinstance(s.get('dmClassified'), list):
        s['dmClassified'].append([round(rng.uniform(0, 360), 4), round(rng.uniform(-60, 0), 4), 61360.0, 'SN Ia', 0.05])
    if isinstance(s.get('tonight'), dict) and isinstance(s['tonight'].get('recent'), list):
        for r in s['tonight']['recent']:
            r['det'] = r.get('det', []) + [[61360.02, 'r', round(rng.uniform(15, 19), 2)]]
            r['lastMag'] = r['det'][-1][2]
        s['tonight']['dataTo'] = prev_date


def earth_day(s, rng, k):
    e = s.get('earth')
    if not isinstance(e, dict):
        return
    shift = 86400 * k
    e['kp'] = [[t + 86400, round(rng.uniform(0, 7), 2)] for t, _ in (e.get('kp') or [[1795446000 + shift, 1.0]])]
    sw = e.get('solarWind') or {}
    sw['speedKmS'] = {'mean': round(rng.uniform(300, 600), 2), 'min': 290.0, 'max': round(rng.uniform(400, 800), 1), 'n': 264}
    sw['bzGsmNt'] = {'mean': -0.1, 'min': round(rng.uniform(-20, 0), 1), 'max': 4.4, 'n': 263}
    e['solarWind'] = sw
    li = e.get('lightning') or {}
    li['hourly'] = [rng.randrange(20000, 120000) for _ in range(24)]
    li['flashes'] = sum(li['hourly'])
    for r in (li.get('regions') or {}).values():
        r['flashes'] = rng.randrange(0, 400000)
    li['topStorms'] = [{'name': f'storm {k}-{j}', 'lat': round(rng.uniform(-40, 40), 2), 'lon': round(rng.uniform(-180, 180), 2), 'sat': 'G19', 'total': rng.randrange(1000, 90000), 'peak': rng.randrange(100, 3000), 'h0': 3, 'h1': 9, 'areaMax': 12.5, 'sea': rng.random() < 0.5} for j in range(10)]
    e['lightning'] = li
    e['window'] = [f'day {k} start', f'day {k} end']


def last_part(out, key):
    return next((copy.deepcopy(s[key]) for s in reversed(out) if s.get(key) is not None), None)


def make_week(start, n=7, seed=7, first_night=None):
    rng = random.Random(seed)
    s = base_snapshot()
    s['health']['fink']['last'] = first_night or night_label((datetime.date.fromisoformat(start) - datetime.timedelta(days=1)).isoformat())
    out = []
    plan = ['data', 'data', 'silent', 'silent-earth-missing', 'stars-missing', 'types', 'health-missing']
    for k in range(n):
        date = (datetime.date.fromisoformat(start) + datetime.timedelta(days=k)).isoformat()
        prev = (datetime.date.fromisoformat(date) - datetime.timedelta(days=1)).isoformat()
        cur = copy.deepcopy(out[-1]) if out else s
        cur['date'], cur['built'] = date, f'{date}T11:40Z'
        if cur.get('health') is None:
            cur['health'] = copy.deepcopy(s['health'])
        step = plan[k % len(plan)]
        if step == 'stars-missing':
            cur['stars'], cur['showcase'] = None, None
        elif cur.get('stars') is None:
            cur['stars'], cur['showcase'] = last_part(out, 'stars'), last_part(out, 'showcase')
        if step == 'silent-earth-missing':
            cur['earth'] = None
        else:
            if cur.get('earth') is None:
                cur['earth'] = last_part(out, 'earth')
            earth_day(cur, rng, k)
        if step in ('data', 'types') and k > 0:
            data_night(cur, rng, date, prev)
        if step.startswith('silent'):
            cur['health']['verdict'] = {'code': 'rubin-silent', 'level': 'warn', 'since': cur['health']['fink']['last'], 'gap': k}
        if step == 'types':
            cur['flag'] = 1
            cur['ratio'] = 1.0
            cur['zero'] = -0.0
            cur['name'] = 'Café ☉ \U0001f320'
            cur['empty'] = {}
            cur['lists'] = [[1, 2], [3, 4]]
            cur['health']['fink']['last'] = night_label(prev)
        if step == 'health-missing':
            cur['health'] = None
            cur['flag'] = True
            cur['ratio'] = 1
            cur['zero'] = 0.0
            cur['lists'] = [[3, 4], [1, 2], [5]]
            cur['empty'] = []
        cur['night'] = aw.night_of({'health': cur['health']}) if cur.get('health') else None
        out.append(cur)
    return out


def write_snap(folder, snap):
    os.makedirs(folder, exist_ok=True)
    with gzip.open(os.path.join(folder, f"{snap['date']}.json.gz"), 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(snap, f, separators=(',', ':'), allow_nan=False)


def tree(top):
    out = {}
    for root, _, files in os.walk(top):
        for n in files:
            p = os.path.join(root, n)
            with open(p, 'rb') as f:
                out[os.path.relpath(p, top).replace(os.sep, '/')] = f.read()
    return out


def quiet(fn, *a):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = fn(*a)
    return result, buf.getvalue()


class Delta(unittest.TestCase):
    def test_type_flips_and_nesting_round_trip(self):
        pairs = [
            ({'a': 1}, {'a': 1.0}), ({'a': True}, {'a': 1}), ({'a': 0.0}, {'a': -0.0}), ({'a': None}, {'a': {}}),
            ({'a': [[1], [2]]}, {'a': [[2], [1], [3]]}), ({'a': [{'x': 1}, {'x': 2}]}, {'a': [{'x': 2}, {'x': 1.0}]}),
            ({'a': {'b': {'c': 1}}}, {'a': {'b': {}}}), ({'a': 'x'}, {'b': 'x'}), ({'a': [1, 2, 3]}, {'a': [1, 2]}),
            ({'u': 'café'}, {'u': '\U0001f320'}), ({'a': [{}]}, {'a': []}),
        ]
        for a, b in pairs:
            ops = aw.diff(a, b)
            self.assertEqual(aw.canonical(aw.apply(copy.deepcopy(a), json.loads(json.dumps(ops)))), aw.canonical(b), (a, b))
        self.assertEqual(aw.diff({'a': [1.5]}, {'a': [1.5]}), [])


class Week(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snaps = make_week('2026-11-23')
        cls.week = aw.build_week('2026-W48', cls.snaps, prev_night='20261121')
        cls.data = aw.encode(cls.week)

    def test_every_night_rebuilds_byte_exact(self):
        self.assertIsNone(aw.verify_bytes(self.data, self.snaps))
        rebuilt = aw.reconstruct(aw.decode(self.data))
        self.assertEqual(len(rebuilt), 7)
        for a, b in zip(rebuilt, self.snaps):
            self.assertEqual(aw.canonical(a).encode('utf-8'), aw.canonical(b).encode('utf-8'))

    def test_restored_parts_patch_their_last_value(self):
        ops = self.week['deltas'][4]['ops']
        self.assertEqual(sorted(op[1][0] for op in ops if op[0] == '@'), ['showcase', 'stars'])
        self.assertTrue(all(op[2] == 3 for op in ops if op[0] == '@'))

    def test_tampering_is_caught(self):
        week = aw.decode(self.data)
        week['deltas'][2]['ops'].append(['+', ['tampered'], 1])
        self.assertIsNotNone(aw.check(week))
        other = copy.deepcopy(self.snaps)
        other[4]['ratio'] = 2
        self.assertIsNotNone(aw.verify_bytes(self.data, other))

    def test_replay_keys_on_data_night_and_merges_silent_days(self):
        tl = self.week['timeline']
        self.assertEqual([(t['night'], t['silent'], t['dates'], t['runs']) for t in tl], [
            ('20261122', False, ['2026-11-23', '2026-11-23'], 1),
            ('20261123', False, ['2026-11-24', '2026-11-24'], 1),
            ('20261123', True, ['2026-11-25', '2026-11-27'], 3),
            ('20261127', False, ['2026-11-28', '2026-11-28'], 1),
            (None, True, ['2026-11-29', '2026-11-29'], 1),
        ])
        self.assertEqual(tl[2]['reason'], 'rubin-silent')
        self.assertEqual(tl[4]['reason'], 'no health')
        s = self.week['summary']
        self.assertEqual([d['night'] for d in s['dataNights']], ['20261122', '20261123', '20261127'])
        self.assertEqual(len(s['silent']), 2)

    def test_events_name_what_changed(self):
        d1 = self.week['deltas'][0]['events']
        self.assertEqual(len(d1['objects']['added']), 150)
        self.assertEqual(len(d1['objects']['removed']), 50)
        rc = d1['objects']['reclassified']
        self.assertEqual(len(rc), 20)
        self.assertTrue(all(old != new for _, old, new in rc))
        self.assertIn('stars', d1['showcase'])
        self.assertEqual(len(d1['showcase']['stars']['entered']), len(d1['showcase']['stars']['exited']))
        self.assertIn('lensSigma', d1['meters'])
        self.assertIn('kp', d1)
        self.assertIn('regions', d1['lightning'])
        self.assertEqual(d1['verdict']['code'], 'ok')
        d3 = self.week['deltas'][2]['events']
        self.assertEqual(d3['missing'], ['earth'])
        self.assertNotIn('objects', d3)
        d4 = self.week['deltas'][3]['events']
        self.assertEqual(d4['restored'], ['earth'])
        self.assertEqual(sorted(d4['missing']), ['showcase', 'stars'])
        d5 = self.week['deltas'][4]['events']
        self.assertEqual(sorted(d5['restored']), ['showcase', 'stars'])
        self.assertIsNone(self.week['deltas'][5]['events']['verdict'])

    def test_summary(self):
        s = self.week['summary']
        self.assertEqual(len(s['series']['rows']), 7)
        self.assertEqual(s['series']['fields'], aw.DAY_FIELDS)
        top = s['top']
        self.assertIsNotNone(top['weirdest'])
        self.assertEqual(top['reclassified'], sum(len(aw.dig(d, 'events', 'objects', 'reclassified') or []) for d in self.week['deltas']))
        self.assertLessEqual(len(top['storms']), aw.STORMS_KEPT)
        self.assertEqual(top['storms'], sorted(top['storms'], key=lambda c: -c['total']))
        for mode, p in s['showcase'].items():
            self.assertEqual(p['nights'], 3)
            self.assertEqual(p['stayed'], len(p['stayedIds']))
            self.assertTrue(set(p['stayedIds']).isdisjoint(p['fleetingIds']))

    def test_size(self):
        raw = len(gzip.decompress(self.data))
        sys.stderr.write(f'\nsynthetic week: {len(self.data) / 1024:.1f} KB gzip ({raw / 1024:.0f} KB raw), keyframe {len(aw.encode(self.week["keyframe"])) / 1024:.1f} KB gzip\n')
        self.assertLess(len(self.data), 400 * 1024)


class Flush(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.branch = os.path.join(self.tmp.name, 'branch')
        self.got = os.path.join(self.tmp.name, 'got')
        os.makedirs(self.branch)
        self.snaps = make_week('2026-11-23', n=14, seed=3)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, snaps, tag):
        for s in snaps:
            write_snap(os.path.join(self.got, f"{s['date']}T{tag}"), s)

    def test_weekly_flushes(self):
        first = self.snaps[:8]
        self.put(first, '1')
        copies = []
        for j in range(5):
            dup = copy.deepcopy(self.snaps[1])
            dup['built'] = f'2026-11-24T0{j}:00Z'
            dup['commit'] = f'push{j}'
            copies.append(dup)
            write_snap(os.path.join(self.got, f'2026-11-24T0{j}'), dup)
        report, out = quiet(aw.flush, self.branch, self.got)
        self.assertNotIn('::warning::', out)
        files = tree(self.branch)
        self.assertEqual(sorted(files), ['history/index.json', 'weeks/2026-W48.json.gz', 'weeks/2026-W49.json.gz'])
        w48 = aw.decode(files['weeks/2026-W48.json.gz'])
        self.assertEqual(aw.reconstruct(w48)[1]['commit'], self.snaps[1]['commit'])
        self.assertEqual(len(w48['deltas']), 6)
        w49 = aw.decode(files['weeks/2026-W49.json.gz'])
        self.assertEqual(w49['keyframe']['date'], '2026-11-30')
        ix = json.loads(files['history/index.json'])
        self.assertEqual([r[0] for r in ix['days']['rows']], [s['date'] for s in first])
        self.assertEqual(len(ix['weeks']), 2)

        _, out = quiet(aw.flush, self.branch, self.got)
        self.assertEqual(tree(self.branch), files)

        self.put(self.snaps[8:], '2')
        quiet(aw.flush, self.branch, self.got)
        after = tree(self.branch)
        self.assertEqual(after['weeks/2026-W48.json.gz'], files['weeks/2026-W48.json.gz'])
        w49 = aw.decode(after['weeks/2026-W49.json.gz'])
        self.assertEqual(len(aw.reconstruct(w49)), 7)
        for a, b in zip(aw.reconstruct(w49), self.snaps[7:]):
            self.assertEqual(aw.canonical(a), aw.canonical(b))
        self.assertEqual(w49['prevNight'], aw.night_of(self.snaps[5]))
        ix = json.loads(after['history/index.json'])
        self.assertEqual(len(ix['days']['rows']), 14)
        nights = [dict(zip(ix['nights']['fields'], r)) for r in ix['nights']['rows']]
        self.assertTrue(all(not (a['silent'] and b['silent'] and a['night'] == b['night']) for a, b in zip(nights, nights[1:])))
        self.assertEqual(sum(n['runs'] for n in nights), 14)

        shutil.rmtree(self.got)
        quiet(aw.flush, self.branch, None)
        self.assertEqual(tree(self.branch), after)

    def test_failed_self_check_keeps_daily_files(self):
        self.put(self.snaps[:7], '1')
        real = aw.verify_bytes
        aw.verify_bytes = lambda data, snaps: 'forced mismatch'
        try:
            _, out = quiet(aw.flush, self.branch, self.got)
        finally:
            aw.verify_bytes = real
        self.assertIn('::warning::archive: week 2026-W48 failed its self-check', out)
        files = tree(self.branch)
        self.assertNotIn('weeks/2026-W48.json.gz', files)
        self.assertEqual(len([f for f in files if f.startswith('snapshots/2026/')]), 7)
        shutil.rmtree(self.got)
        _, out = quiet(aw.flush, self.branch, None)
        self.assertNotIn('::warning::', out)
        files = tree(self.branch)
        self.assertIn('weeks/2026-W48.json.gz', files)
        self.assertFalse(any(f.startswith('snapshots/') for f in files))

    def test_unreadable_week_file_is_left_alone(self):
        self.put(self.snaps[:3], '1')
        quiet(aw.flush, self.branch, self.got)
        path = os.path.join(self.branch, 'weeks', '2026-W48.json.gz')
        with open(path, 'wb') as f:
            f.write(b'not gzip')
        self.put(self.snaps[3:5], '2')
        _, out = quiet(aw.flush, self.branch, self.got)
        self.assertIn('cannot rebuild', out)
        with open(path, 'rb') as f:
            self.assertEqual(f.read(), b'not gzip')
        self.assertEqual(len([f for f in tree(self.branch) if f.startswith('snapshots/')]), 5)

    def test_cli_verify_and_extract(self):
        self.put(self.snaps[:7], '1')
        quiet(aw.flush, self.branch, self.got)
        path = os.path.join(self.branch, 'weeks', '2026-W48.json.gz')
        code, _ = quiet(aw.main, ['verify', path])
        self.assertEqual(code, 0)
        outdir = os.path.join(self.tmp.name, 'x')
        code, _ = quiet(aw.main, ['extract', path, '--date', '2026-11-26', '--out', outdir])
        self.assertEqual(code, 0)
        with gzip.open(os.path.join(outdir, '2026-11-26.json.gz'), 'rt', encoding='utf-8') as f:
            self.assertEqual(aw.canonical(json.load(f)), aw.canonical(self.snaps[3]))


if __name__ == '__main__':
    unittest.main(verbosity=1)
