import argparse
import base64
import concurrent.futures
import datetime
import gzip
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import h5py
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE_DATA = os.path.join(ROOT, 'site', 'data')
CACHE = os.path.join(ROOT, 'data', 'earth')
NAMES = os.path.join(HERE, 'ci-data', 'earth_names.npz')
UA = 'Mozilla/5.0 (compatible; static-site-build)'
SWPC = 'https://services.swpc.noaa.gov/'
SATS = [
    {'id': 'G19', 'bucket': 'noaa-goes19', 'slot': 'GOES-East', 'name': 'GOES-East GLM', 'lon': -75.2, 'area': 'Americas, Atlantic'},
    {'id': 'G18', 'bucket': 'noaa-goes18', 'slot': 'GOES-West', 'name': 'GOES-West GLM', 'lon': -137.0, 'area': 'Pacific, western Americas'},
]
LI = {'id': 'MTI1', 'collection': 'EO:EUM:DAT:0691', 'slot': 'MTG-0', 'name': 'MTG Lightning Imager', 'lon': 0.0, 'area': 'Europe, Africa', 'angle': 62, 'lat': 70}
EUM = 'https://api.eumetsat.int/'
FIELDS = ['flash_lat', 'flash_lon', 'flash_time_offset_of_first_event', 'flash_energy', 'flash_area', 'flash_quality_flag']
EPOCH_2000 = datetime.datetime(2000, 1, 1, 12, tzinfo=datetime.timezone.utc).timestamp()
HOURS = 24
L0_MOD, L1_MOD, L0_MAX = 128, 8, 13000
TILE_DEG = 30
TILE_GZ_MAX = 280 * 1024
U64 = np.uint64


def log(msg):
    print(msg, flush=True)


def warn(msg):
    print('::warning::' + msg, flush=True)


def http_get(url, timeout=60, tries=3):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(1.5 * 2 ** k)
    raise err


def get_json(path):
    return json.loads(http_get(SWPC + path).decode('utf-8'))


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')


def parse_t(s):
    s = s.strip().replace('_', 'T').rstrip('Z')
    if len(s) == 16:
        s += ':00'
    return datetime.datetime.fromisoformat(s[:19]).replace(tzinfo=datetime.timezone.utc).timestamp()


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode('ascii')


def scaled(ds):
    a = ds[()]
    if ds.attrs.get('_Unsigned', b'false') in (b'true', 'true') and a.dtype.kind == 'i':
        a = a.view(a.dtype.str.replace('i', 'u'))
    a = a.astype(np.float64)
    sf, ao = ds.attrs.get('scale_factor'), ds.attrs.get('add_offset')
    if sf is not None:
        a = a * float(np.asarray(sf).ravel()[0])
    if ao is not None:
        a = a + float(np.asarray(ao).ravel()[0])
    return a


def read_glm(blob):
    with h5py.File(io.BytesIO(blob), 'r') as f:
        q = f['flash_quality_flag'][()]
        if q.size == 0:
            return None, f.attrs.get('orbital_slot', b'').decode(), float(f['nominal_satellite_subpoint_lon'][()])
        t0 = float(f['product_time'][()]) + EPOCH_2000
        keep = q == 0
        out = {
            'lat': scaled(f['flash_lat'])[keep], 'lon': scaled(f['flash_lon'])[keep],
            't': t0 + scaled(f['flash_time_offset_of_first_event'])[keep],
            'energy': scaled(f['flash_energy'])[keep], 'area': scaled(f['flash_area'])[keep] / 1e6,
        }
        return out, f.attrs.get('orbital_slot', b'').decode(), float(f['nominal_satellite_subpoint_lon'][()])


def list_hour(bucket, ts):
    d = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
    prefix = f'GLM-L2-LCFA/{d.year}/{d.timetuple().tm_yday:03d}/{d.hour:02d}/'
    xml = http_get(f'https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={prefix}').decode('utf-8')
    return sorted(k for k in re.findall(r'<Key>([^<]+)</Key>', xml) if k.endswith('.nc'))


def fetch_hour(sat, ts, pool, deadline):
    keys = list_hour(sat['bucket'], ts)
    parts, slots, lons, got = [], set(), [], 0

    def one(k):
        if time.time() > deadline:
            return None
        try:
            return read_glm(http_get(f"https://{sat['bucket']}.s3.amazonaws.com/{k}", timeout=60))
        except Exception:
            return None

    for res in pool.map(one, keys):
        if res is None:
            continue
        data, slot, sublon = res
        got += 1
        slots.add(slot)
        lons.append(sublon)
        if data is not None:
            parts.append(data)
    cat = {k: np.concatenate([p[k] for p in parts]) if parts else np.zeros(0) for k in ('lat', 'lon', 't', 'energy', 'area')}
    return cat, {'files': got, 'listed': len(keys), 'expected': max(len(keys), 180), 'slot': '/'.join(sorted(slots)), 'sublon': float(np.median(lons)) if lons else sat['lon']}


def eum_token():
    key, secret = os.environ.get('METSAT_KEY', ''), os.environ.get('METSAT_SECRET', '')
    if not key or not secret:
        return None
    auth = base64.b64encode(f'{key}:{secret}'.encode()).decode()
    req = urllib.request.Request(EUM + 'token', data=b'grant_type=client_credentials', method='POST',
                                 headers={'User-Agent': UA, 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))['access_token']
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'token request refused with HTTP {e.code}') from None
    except Exception as e:
        raise RuntimeError(f'token request failed ({e.__class__.__name__})') from None


def li_search(t0, t1):
    out, si = [], 0
    while True:
        q = urllib.parse.urlencode({'format': 'json', 'pi': LI['collection'], 'dtstart': iso(t0)[:-1] + ':00Z', 'dtend': iso(t1)[:-1] + ':00Z', 'si': si, 'c': 100})
        d = json.loads(http_get(f'{EUM}data/search-products/1.0.0/os?{q}').decode('utf-8'))
        feats = d.get('features') or []
        for f in feats:
            props = f.get('properties') or {}
            a = (props.get('date') or '').split('/')[0]
            link = (props.get('links') or {}).get('data') or []
            if a and link:
                out.append((parse_t(a), link[0]['href']))
        si += len(feats)
        if not feats or si >= int(d.get('totalResults') or 0):
            break
    return sorted(set(out))


def first_var(f, names):
    for n in names:
        if n in f:
            return f[n]
    raise KeyError(f'none of {names} in the LI file; it has {sorted(f.keys())[:40]}')


def epoch_of(ds):
    u = ds.attrs.get('units', b'')
    u = u.decode() if isinstance(u, bytes) else str(u)
    m = re.search(r'since\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})', u)
    if not m:
        raise ValueError(f'LI time units not understood: {u!r}')
    return datetime.datetime.fromisoformat(f'{m.group(1)}T{m.group(2)}').replace(tzinfo=datetime.timezone.utc).timestamp()


def read_li(blob):
    out = []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for info in z.infolist():
            name = info.filename.rsplit('/', 1)[-1]
            if not name.endswith('.nc') or 'BODY' not in name or info.file_size > 64 << 20:
                continue
            with h5py.File(io.BytesIO(z.read(info)), 'r') as f:
                lat = scaled(first_var(f, ['latitude', 'flash_lat']))
                if lat.size == 0:
                    continue
                tv = first_var(f, ['flash_time', 'time'])
                d = {'lat': lat, 'lon': scaled(first_var(f, ['longitude', 'flash_lon'])), 't': epoch_of(tv) + scaled(tv),
                     'energy': scaled(first_var(f, ['radiance', 'flash_radiance']))}
                try:
                    d['area'] = scaled(first_var(f, ['flash_footprint', 'footprint']))
                except KeyError:
                    d['area'] = np.full(lat.size, np.nan)
                ok = np.isfinite(d['lat']) & np.isfinite(d['lon']) & (np.abs(d['lat']) <= 90)
                out.append({k: v[ok] for k, v in d.items()})
    if not out:
        return {k: np.zeros(0) for k in ('lat', 'lon', 't', 'energy', 'area')}
    return {k: np.concatenate([o[k] for o in out]) for k in out[0]}


def load_li(t0, deadline, per, stats):
    st = {'state': 'off', 'files': 0, 'expected': HOURS * 6, 'hours': 0, 'missingHours': []}
    stats[LI['id']] = st
    per[LI['id']] = {}
    if not os.environ.get('METSAT_KEY') or not os.environ.get('METSAT_SECRET'):
        return
    st['state'] = 'error'
    hours = [t0 + 3600 * h for h in range(HOURS)]
    token, found, first_err = None, {}, []
    if any(not os.path.exists(hour_cache(LI, ts)) for ts in hours):
        try:
            token = eum_token()
            for ts, href in li_search(t0, t0 + HOURS * 3600):
                found.setdefault(int(ts // 3600 * 3600), []).append(href)
        except Exception as e:
            warn(f'earth: MTG LI skipped, EUMETSAT access failed: {e}')
            token = None

    def one(href):
        if time.time() > deadline:
            return None
        try:
            req = urllib.request.Request(href, headers={'User-Agent': UA, 'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(req, timeout=90) as r:
                return read_li(r.read())
        except Exception as e:
            if not first_err:
                first_err.append(f'{e.__class__.__name__}: {str(e)[:300]}')
            return None

    todo = []
    for ts in hours:
        path = hour_cache(LI, ts)
        if os.path.exists(path):
            z = np.load(path)
            per[LI['id']][ts] = ({k: z[k] for k in ('lat', 'lon', 't', 'energy', 'area')}, json.loads(str(z['info'])))
        elif token:
            todo += [(ts, href) for href in found.get(ts, [])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda job: one(job[1]), todo))
    for ts in hours:
        if ts in per[LI['id']]:
            continue
        got = [r for (t, _), r in zip(todo, results) if t == ts and r is not None]
        listed = sum(1 for t, _ in todo if t == ts)
        if not got:
            continue
        data = {k: np.concatenate([g[k] for g in got]) for k in ('lat', 'lon', 't', 'energy', 'area')}
        info = {'files': len(got), 'listed': listed, 'expected': max(6, listed), 'sublon': LI['lon']}
        per[LI['id']][ts] = (data, info)
        if len(got) == listed and ts + 7200 < time.time():
            path = hour_cache(LI, ts)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            np.savez_compressed(path, info=json.dumps(info), **data)
    log(f'earth: {LI["id"]} {sum(r is not None for r in results)} of {len(todo)} products read')
    if first_err:
        warn(f'earth: some MTG LI products failed, first error: {first_err[0]}')
    for ts in hours:
        got = per[LI['id']].get(ts)
        if got:
            st['files'] += got[1]['files']
            st['hours'] += 1
        else:
            st['missingHours'].append(iso(ts)[:13])
    if st['hours']:
        st['state'] = 'nightly'


def hour_cache(sat, ts):
    return os.path.join(CACHE, 'glm', sat['id'], datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime('%Y%m%d%H') + '.npz')


def load_glm(t0, deadline, workers):
    hours = [t0 + 3600 * h for h in range(HOURS)]
    per = {s['id']: {} for s in SATS}
    stats = {s['id']: {'files': 0, 'expected': HOURS * 180, 'hours': 0, 'missingHours': []} for s in SATS}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for ts in hours:
            for sat in SATS:
                path = hour_cache(sat, ts)
                if os.path.exists(path):
                    z = np.load(path)
                    per[sat['id']][ts] = ({k: z[k] for k in ('lat', 'lon', 't', 'energy', 'area')}, json.loads(str(z['info'])))
                    continue
                if time.time() > deadline:
                    continue
                try:
                    data, info = fetch_hour(sat, ts, pool, deadline)
                except Exception as e:
                    warn(f'earth: {sat["id"]} {iso(ts)} failed ({e.__class__.__name__}: {e})')
                    continue
                per[sat['id']][ts] = (data, info)
                if info['files'] and info['files'] == info['listed'] and ts + 7200 < time.time():
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    np.savez_compressed(path, info=json.dumps(info), **data)
                log(f'earth: {sat["id"]} {iso(ts)} {info["files"]}/{info["expected"]} files, {data["lat"].size} flashes')
    for sat in SATS:
        for ts in hours:
            got = per[sat['id']].get(ts)
            if got:
                stats[sat['id']]['files'] += got[1]['files']
                stats[sat['id']]['hours'] += 1
                sat['lon'] = got[1].get('sublon', sat['lon'])
            else:
                stats[sat['id']]['missingHours'].append(iso(ts)[:13])
    return per, stats


def prune_cache(t0):
    root = os.path.join(CACHE, 'glm')
    if not os.path.isdir(root):
        return
    cutoff = datetime.datetime.fromtimestamp(t0 - 6 * 3600, datetime.timezone.utc).strftime('%Y%m%d%H')
    for sat in os.listdir(root):
        for name in os.listdir(os.path.join(root, sat)):
            if name.endswith('.npz') and name[:10] < cutoff:
                os.remove(os.path.join(root, sat, name))


def central_angle(lat, lon, lon0):
    la, dl = np.radians(lat), np.radians(lon - lon0)
    return np.degrees(np.arccos(np.clip(np.cos(la) * np.cos(dl), -1, 1)))


def merge_flashes(per, t0, t1, sats):
    cols = {k: [] for k in ('lat', 'lon', 't', 'energy', 'area', 'sat', 'eclass')}
    for si, sat in enumerate(sats):
        mine_cols = {k: [] for k in ('lat', 'lon', 't', 'energy', 'area')}
        for ts, (d, _) in sorted(per[sat['id']].items()):
            if d['lat'].size == 0:
                continue
            others = [o for o in sats if o is not sat and per[o['id']].get(ts) and per[o['id']][ts][1].get('files')]
            mine = central_angle(d['lat'], d['lon'], sat['lon'])
            keep = (d['t'] >= t0) & (d['t'] < t1) & np.isfinite(d['lat']) & np.isfinite(d['lon'])
            for o in others:
                theirs = central_angle(d['lat'], d['lon'], o['lon'])
                keep &= (mine < theirs) | ((mine == theirs) & (si < sats.index(o)))
            for k in mine_cols:
                mine_cols[k].append(d[k][keep])
        if not mine_cols['lat']:
            continue
        part = {k: np.concatenate(v) for k, v in mine_cols.items()}
        for k in mine_cols:
            cols[k].append(part[k])
        cols['sat'].append(np.full(part['lat'].size, si, np.uint8))
        cols['eclass'].append(energy_class(np.nan_to_num(part['energy'])))
    f = {k: np.concatenate(v) if v else np.zeros(0) for k, v in cols.items()}
    f['lon'] = (f['lon'] + 180) % 360 - 180
    f['lat16'] = np.clip(np.round((f['lat'] + 90) / 180 * 65535), 0, 65535).astype(np.uint16)
    f['lon16'] = np.clip(np.round((f['lon'] + 180) / 360 * 65535), 0, 65535).astype(np.uint16)
    tq = np.round(f['t'] * 1000).astype(np.int64)
    order = np.lexsort((f['lon16'], f['lat16'], tq))
    for k in list(f):
        f[k] = f[k][order]
    f['tq'] = tq[order]
    return f


def splitmix(a):
    with np.errstate(over='ignore'):
        a = a + U64(0x9E3779B97F4A7C15)
        a = (a ^ (a >> U64(30))) * U64(0xBF58476D1CE4E5B9)
        a = (a ^ (a >> U64(27))) * U64(0x94D049BB133111EB)
        return a ^ (a >> U64(31))


def flash_hash(f):
    key = splitmix(f['tq'].astype(U64)) ^ (f['lat16'].astype(U64) << U64(16)) ^ f['lon16'].astype(U64)
    return splitmix(key)


def energy_class(e):
    n = e.size
    if n < 2:
        return np.zeros(n, np.uint8)
    rank = np.empty(n, np.int64)
    rank[np.argsort(e, kind='stable')] = np.arange(n)
    return np.floor(rank / (n - 1) * 255).astype(np.uint8)


def records(f, sel, t0):
    rec = np.zeros(int(sel.sum()), dtype=[('lat', '<u2'), ('lon', '<u2'), ('t', '<u2'), ('e', 'u1')])
    rec['lat'] = f['lat16'][sel]
    rec['lon'] = f['lon16'][sel]
    rec['t'] = np.clip(np.floor((f['t'][sel] - t0) / 2), 0, 65535).astype(np.uint16)
    rec['e'] = f['eclass'][sel]
    return rec


def sun_lat_lon(ts):
    d = ts / 86400 + 2440587.5 - 2451545.0
    L = math.radians((280.460 + 0.9856474 * d) % 360)
    g = math.radians((357.528 + 0.9856003 * d) % 360)
    lam = L + math.radians(1.915) * math.sin(g) + math.radians(0.020) * math.sin(2 * g)
    eps = math.radians(23.439 - 0.0000004 * d)
    ra = math.degrees(math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam)))
    dec = math.degrees(math.asin(math.sin(eps) * math.sin(lam)))
    gmst = (280.46061837 + 360.98564736629 * d) % 360
    return dec, ((ra - gmst + 540) % 360) - 180


def sun_alt(lat, lon, ts):
    sd, sl = sun_lat_lon(ts)
    la, sdr = np.radians(lat), math.radians(sd)
    c = np.sin(la) * math.sin(sdr) + np.cos(la) * math.cos(sdr) * np.cos(np.radians(lon - sl))
    return np.degrees(np.arcsin(np.clip(c, -1, 1)))


def vec_mean(lat, lon, w):
    la, lo = np.radians(lat), np.radians(lon)
    x, y, z = (w * np.cos(la) * np.cos(lo)).sum(), (w * np.cos(la) * np.sin(lo)).sum(), (w * np.sin(la)).sum()
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))


def gc_km(a, b, c, d):
    a, b, c, d = map(math.radians, (a, b, c, d))
    return 6371 * math.acos(max(-1, min(1, math.sin(a) * math.sin(c) + math.cos(a) * math.cos(c) * math.cos(b - d))))


class Names:
    def __init__(self, path):
        z = np.load(path)
        self.admin, self.near, self.marine, self.region, self.land = z['admin'], z['near'], z['marine'], z['region'], z['land']
        self.admin_names = [str(x) for x in z['admin_names']]
        self.marine_names = [str(x) for x in z['marine_names']]
        self.region_ids = [str(x) for x in z['region_ids']]
        self.region_names = [str(x) for x in z['region_names']]
        self.res = self.admin.shape[1] // 360
        self.bbox = {}
        ys, xs = np.nonzero(self.admin)
        ids = self.admin[ys, xs]
        for a in np.unique(ids):
            m = ids == a
            self.bbox[int(a)] = (90 - ys[m].max() / self.res, 90 - ys[m].min() / self.res, xs[m].min() / self.res - 180, xs[m].max() / self.res - 180)

    def idx(self, lat, lon):
        i = np.clip(((90 - lat) * self.res).astype(np.int64), 0, self.admin.shape[0] - 1)
        j = np.clip(((lon + 180) * self.res).astype(np.int64), 0, self.admin.shape[1] - 1)
        return i, j

    def country(self, a, lat, lon):
        n = self.admin_names[a]
        n = {'United States': 'the United States', 'Russian Federation': 'Russia', 'Democratic Republic of the Congo': 'the DR Congo',
             'Republic of the Congo': 'the Congo', 'Bahamas': 'the Bahamas', 'Dominican Republic': 'the Dominican Republic'}.get(n, n)
        b = self.bbox.get(a)
        if not b or (b[1] - b[0] < 12 and b[3] - b[2] < 12):
            return n
        fy = (lat - b[0]) / max(1e-6, b[1] - b[0])
        fx = (lon - b[2]) / max(1e-6, b[3] - b[2])
        dy, dx = fy - 0.5, fx - 0.5
        if max(abs(dy), abs(dx)) < 0.17:
            q = 'central'
        elif abs(dy) >= abs(dx):
            q = 'northern' if dy > 0 else 'southern'
        else:
            q = 'eastern' if dx > 0 else 'western'
        return f'the {q} {n[4:]}' if n.startswith('the ') else f'{q} {n}'

    def sea(self, m):
        n = self.marine_names[m]
        n = n.title() if n.isupper() else n
        n = re.sub(r'^(North|South) (Atlantic|Pacific) Ocean$', r'\1 \2', n)
        return 'the ' + n if n and not n.lower().startswith('the ') else n


def storm_name(N, lat, lon, admin_counts, near_counts, marine_counts, sea_frac):
    if sea_frac > 0.6 or not admin_counts:
        m = max(marine_counts, key=marine_counts.get) if marine_counts else 0
        base = N.sea(m) if m else f'{abs(lat):.0f}°{"N" if lat >= 0 else "S"} {abs(lon):.0f}°{"E" if lon >= 0 else "W"}'
        if near_counts:
            a = max(near_counts, key=near_counts.get)
            return f'Storm over {base} off {N.country(a, lat, lon).replace("central ", "").replace("northern ", "").replace("southern ", "").replace("eastern ", "").replace("western ", "")}'
        return f'Storm over {base}'
    top = sorted(admin_counts.items(), key=lambda kv: -kv[1])
    tot = sum(admin_counts.values())
    first = N.country(top[0][0], lat, lon)
    if len(top) > 1 and top[1][1] >= 0.3 * tot:
        return f'Storm over {first} and {N.country(top[1][0], lat, lon)}'
    return f'Storm over {first}'


def components(ci, counts, width):
    alive = {int(c): int(n) for c, n in zip(ci, counts) if n >= 2}
    label, comps = {}, []
    for c in alive:
        if c in label:
            continue
        stack, cells = [c], []
        label[c] = len(comps)
        while stack:
            x = stack.pop()
            cells.append(x)
            r, q = divmod(x, width)
            for dr in (-1, 0, 1):
                for dq in (-1, 0, 1):
                    y = (r + dr) * width + (q + dq) % width
                    if y in alive and y not in label:
                        label[y] = len(comps)
                        stack.append(y)
        comps.append(cells)
    return comps, label, alive


def storms(f, t0, N):
    res = N.res
    width = 360 * res
    ii, jj = N.idx(f['lat'], f['lon'])
    cell = ii * width + jj
    hour = np.clip(((f['t'] - t0) // 3600).astype(np.int64), 0, HOURS - 1)
    sid = np.full(f['lat'].size, -1, np.int64)
    tracks = []
    prev = []
    for h in range(HOURS):
        m = np.nonzero(hour == h)[0]
        if m.size == 0:
            prev = []
            continue
        ci, inv, cnt = np.unique(cell[m], return_inverse=True, return_counts=True)
        comps, label, alive = components(ci, cnt, width)
        info = []
        for k, cells in enumerate(comps):
            n = sum(alive[c] for c in cells)
            if n < 20:
                continue
            la = np.array([90 - (c // width + 0.5) / res for c in cells])
            lo = np.array([(c % width + 0.5) / res - 180 for c in cells])
            w = np.array([alive[c] for c in cells], float)
            clat, clon = vec_mean(la, lo, w)
            info.append((n, k, clat, clon))
        info.sort(key=lambda r: -r[0])
        used, now = set(), []
        comp_sid = {}
        for n, k, clat, clon in info:
            best, bd = None, 150.0
            for s, plat, plon in prev:
                if s in used:
                    continue
                d = gc_km(clat, clon, plat, plon)
                if d < bd:
                    best, bd = s, d
            if best is None:
                best = len(tracks)
                tracks.append([])
            used.add(best)
            tracks[best].append([h, round(clat, 2), round(clon, 2), n])
            comp_sid[k] = best
            now.append((best, clat, clon))
        prev = now
        lab = np.array([comp_sid.get(label.get(int(c), -1), -1) for c in ci], np.int64)
        sid[m] = lab[inv]
    return tracks, sid, ii, jj


def storm_cells(f, t0, N, top=60):
    tracks, sid, ii, jj = storms(f, t0, N)
    if not tracks:
        return [], sid
    tot = np.bincount(sid[sid >= 0], minlength=len(tracks))
    order = [int(s) for s in np.argsort(-tot, kind='stable')[:top] if tot[s] > 0]
    out = []
    for s in order:
        m = sid == s
        tr = tracks[s]
        h0, h1 = tr[0][0], tr[-1][0]
        peak = max(tr, key=lambda r: r[3])
        land = N.land[ii[m], jj[m]].astype(bool)
        admin, near, marine = N.admin[ii[m], jj[m]], N.near[ii[m], jj[m]], N.marine[ii[m], jj[m]]
        ac = {int(a): int(c) for a, c in zip(*np.unique(admin[land & (admin > 0)], return_counts=True))}
        nc = {int(a): int(c) for a, c in zip(*np.unique(near[~land & (near > 0)], return_counts=True))}
        mc = {int(a): int(c) for a, c in zip(*np.unique(marine[~land & (marine > 0)], return_counts=True))}
        sea = float((~land).mean())
        lat, lon = vec_mean(f['lat'][m], f['lon'][m], np.ones(int(m.sum())))
        r10 = np.bincount(((f['t'][m] - t0 - h0 * 3600) // 600).astype(np.int64), minlength=(h1 - h0 + 1) * 6)[:(h1 - h0 + 1) * 6]
        counts = np.bincount(f['sat'][m].astype(np.int64), minlength=len(f['sats']))
        area = f['area'][m]
        out.append({
            'name': storm_name(N, peak[1], peak[2], ac, nc, mc, sea),
            'lat': round(lat, 2), 'lon': round(lon, 2), 'h0': h0, 'h1': h1, 'peak': int(peak[3]), 'peakH': int(peak[0]),
            'total': int(m.sum()), 'areaMax': int(round(float(area.max()))) if area.size else 0, 'areaMean': int(round(float(area.mean()))) if area.size else 0,
            'sea': round(sea, 2), 'sat': f['sats'][int(np.argmax(counts))]['id'], 'track': tr, 'r10': [int(x) for x in r10],
        })
    return out, sid


def density(f, t0):
    hour = ((f['t'] - t0) // 3600).astype(np.int64)
    li = np.clip(np.floor(f['lat'] + 90).astype(np.int64), 0, 179)
    lj = np.clip(np.floor(f['lon'] + 180).astype(np.int64), 0, 359)
    cell = li * 360 + lj
    out, totals = [], []
    for h in range(HOURS):
        c = cell[hour == h]
        ci, n = np.unique(c, return_counts=True)
        delta = np.diff(np.concatenate([[0], ci])).astype(np.uint16)
        pairs = np.zeros(ci.size * 2, np.uint16)
        pairs[0::2] = delta
        pairs[1::2] = np.minimum(n, 65535)
        out.append(b64(pairs.astype('<u2')))
        totals.append(int(c.size))
    return out, totals


def regions(f, t0, N, sats):
    ii, jj = N.idx(f['lat'], f['lon'])
    reg = N.region[ii, jj].astype(np.int64) - 1
    q = np.clip(((f['t'] - t0) // 900).astype(np.int64), 0, HOURS * 4 - 1)
    out = []
    for r, (rid, name) in enumerate(zip(N.region_ids, N.region_names)):
        m = reg == r
        sel = N.region == r + 1
        ys, xs = np.nonzero(sel)
        mid = np.abs(90 - (ys + 0.5) / N.res) <= 60
        if mid.any():
            ys, xs = ys[mid], xs[mid]
        la, lo = vec_mean(90 - (ys + 0.5) / N.res, (xs + 0.5) / N.res - 180, np.ones(ys.size)) if ys.size else (0, 0)
        cl, co = 90 - (ys[::7] + 0.5) / N.res, (xs[::7] + 0.5) / N.res - 180
        inside = np.zeros(cl.size, bool)
        for s in sats:
            inside |= (central_angle(cl, co, s['lon']) <= s.get('angle', 60)) & (np.abs(cl) <= s.get('lat', 56))
        covered = bool(cl.size) and inside.mean() >= 0.3
        out.append({'id': rid, 'name': name, 'lat': round(la, 1), 'lon': round(lo, 1), 'covered': bool(covered),
                    'total': int(m.sum()), 'q15': [int(x) for x in np.bincount(q[m], minlength=HOURS * 4)]})
    return out


def defaults(f, t0):
    if f['lat'].size == 0:
        return t0, [0.0, -60.0, 1]
    hour = ((f['t'] - t0) // 3600).astype(np.int64)
    best, bh = -1, 0
    for h in range(HOURS):
        m = hour == h
        if not m.any():
            continue
        n = int((sun_alt(f['lat'][m], f['lon'][m], t0 + 3600 * h + 1800) < -6).sum())
        if n > best:
            best, bh = n, h
    m = hour == bh
    night = sun_alt(f['lat'][m], f['lon'][m], t0 + 3600 * bh + 1800) < -6
    la, lo = vec_mean(f['lat'][m][night], f['lon'][m][night], np.ones(int(night.sum()))) if night.any() else (0.0, -60.0)
    return t0 + 3600 * bh, [round(la, 1), round(lo, 1), 1]


def space_weather(t0, t1):
    sw = {'step': 300, 't0': t0, 'n': (t1 - t0) // 300}
    ok = {}

    def bins(rows, key, scale):
        n = sw['n']
        acc = [[] for _ in range(n)]
        for r in rows:
            v = r.get(key)
            if v is None:
                continue
            k = int((parse_t(r['time_tag']) - t0) // 300)
            if 0 <= k < n:
                acc[k].append(float(v))
        return [int(round(float(np.median(a)) * scale)) if a else None for a in acc]

    try:
        wind = [r for r in get_json('json/rtsw/rtsw_wind_1m.json') if r.get('active')]
        sw['speed'] = bins(wind, 'proton_speed', 1)
        sw['density'] = bins(wind, 'proton_density', 10)
        srcs = [r.get('source') for r in wind if r.get('source')]
        ok['wind'] = True
    except Exception as e:
        warn(f'earth: solar wind unavailable ({e})')
        srcs = []
    try:
        mag_all = get_json('json/rtsw/rtsw_mag_1m.json')
        mag = [r for r in mag_all if r.get('active')]
        sw['bz'] = bins(mag, 'bz_gsm', 10)
        srcs += [r.get('source') for r in mag if r.get('source')]
        every = sorted({r.get('source') for r in mag_all if r.get('source')})
        ok['mag'] = True
    except Exception as e:
        warn(f'earth: magnetic field unavailable ({e})')
        every = []
    active = max(set(srcs), key=srcs.count) if srcs else None
    sw['source'] = {'active': active, 'backups': [s for s in every if s != active]}
    try:
        kp = get_json('products/noaa-planetary-k-index.json')
        sw['kp'] = [[int(parse_t(r['time_tag'])), round(float(r['Kp']), 2)] for r in kp if t0 - 3 * 3600 <= parse_t(r['time_tag']) < t1 and r.get('Kp') is not None]
        ok['kp'] = True
    except Exception as e:
        warn(f'earth: Kp unavailable ({e})')
    try:
        fc = get_json('products/noaa-planetary-k-index-forecast.json')
        sw['kpForecast'] = [[int(parse_t(r['time_tag'])), round(float(r['kp']), 2)] for r in fc if r.get('observed') == 'predicted' and r.get('kp') is not None]
    except Exception as e:
        warn(f'earth: Kp forecast unavailable ({e})')
    try:
        xr = get_json('json/goes/primary/xrays-1-day.json')
        n = (t1 - t0) // 60
        arr = np.zeros(n, np.uint8)
        for r in xr:
            if r.get('energy') != '0.1-0.8nm' or not r.get('flux') or r['flux'] <= 0:
                continue
            k = int((parse_t(r['time_tag']) - t0) // 60)
            if 0 <= k < n:
                arr[k] = int(np.clip(round((math.log10(r['flux']) + 9) / 6 * 254) + 1, 1, 255))
        sw['xray'] = {'step': 60, 'data': b64(arr)}
        sw['xraySat'] = next((r.get('satellite') for r in xr if r.get('satellite')), None)
        ok['xray'] = True
    except Exception as e:
        warn(f'earth: X-rays unavailable ({e})')
    try:
        fl = get_json('json/goes/primary/xray-flares-7-day.json')
        sw['flares'] = [[int(parse_t(r['max_time'])), r.get('max_class'), r.get('max_xrlong')] for r in fl if r.get('max_time') and t0 <= parse_t(r['max_time']) < t1]
    except Exception as e:
        warn(f'earth: flares unavailable ({e})')
    try:
        sc = get_json('products/noaa-scales.json')
        pick = lambda d: {k: int(d[k]['Scale']) if d.get(k) and d[k].get('Scale') not in (None, '') else None for k in ('R', 'S', 'G')}
        sw['scales'] = {'now': pick(sc['0']), 'max24': pick(sc.get('-1', {})), 'at': f"{sc['0']['DateStamp']}T{sc['0']['TimeStamp'][:5]}Z",
                        'forecast': [{'day': sc[k]['DateStamp'], 'G': pick(sc[k])['G']} for k in ('1', '2', '3') if k in sc]}
    except Exception as e:
        warn(f'earth: NOAA scales unavailable ({e})')
    try:
        txt = http_get(SWPC + 'text/aurora-nowcast-hemi-power.txt').decode('utf-8', 'replace')
        n = sw['n']
        hn, hs = [None] * n, [None] * n
        for line in txt.splitlines():
            p = line.split()
            if len(p) < 4 or line.startswith(('#', ':')):
                continue
            try:
                k = int((parse_t(p[0]) - t0) // 300)
                if 0 <= k < n:
                    hn[k], hs[k] = int(p[2]), int(p[3])
            except ValueError:
                continue
        sw['hpN'], sw['hpS'] = hn, hs
        ok['hp'] = True
    except Exception as e:
        warn(f'earth: hemispheric power unavailable ({e})')
    return sw, ok


def aurora():
    j = get_json('json/ovation_aurora_latest.json')
    grid = np.zeros((181, 360), np.uint8)
    for lon, lat, v in j['coordinates']:
        grid[int(lat) + 90, int(lon) % 360] = min(100, max(0, int(v)))
    north = grid[130:181][::-1]
    south = grid[0:51]
    pair = lambda g: np.maximum(g[:, 0::2], g[:, 1::2])
    data = np.concatenate([pair(north), pair(south)]).astype(np.uint8)
    return {'obs': j.get('Observation Time'), 'valid': j.get('Forecast Time'), 'lonStep': 2, 'rows': 51, 'data': b64(data)}


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'), allow_nan=False)
    return tmp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--minutes', type=float, default=10)
    ap.add_argument('--out', default=SITE_DATA)
    ap.add_argument('--end', default='')
    ap.add_argument('--workers', type=int, default=16)
    args = ap.parse_args()
    start = time.time()
    deadline = start + args.minutes * 60
    now = datetime.datetime.fromisoformat(args.end).timestamp() if args.end else time.time()
    t1 = int(now // 3600 * 3600 - 3600)
    t0 = t1 - HOURS * 3600
    N = Names(NAMES)

    sw, sw_ok = space_weather(t0, t1)
    try:
        aur = aurora()
        ovation_ok = True
    except Exception as e:
        warn(f'earth: OVATION unavailable ({e})')
        aur, ovation_ok = None, False

    per, stats = {}, {}
    load_li(t0, min(deadline - 330, time.time() + 270), per, stats)
    glm_per, glm_stats = load_glm(t0, deadline, args.workers)
    per.update(glm_per)
    stats.update(glm_stats)
    sats = SATS + ([LI] if per[LI['id']] else [])
    prune_cache(t0)
    if sum(stats[s['id']]['files'] for s in SATS) == 0:
        raise SystemExit('earth: no GLM files could be read; keeping the committed files')
    f = merge_flashes(per, t0, t1, sats)
    f['sats'] = sats
    h = flash_hash(f)
    log(f'earth: {f["lat"].size} flashes after the overlap split and quality filter')

    l0_mod = L0_MOD
    while f['lat'].size / l0_mod > L0_MAX:
        l0_mod *= 2
    l0 = records(f, h % U64(l0_mod) == 0, t0)
    dens, dens_tot = density(f, t0)
    cells, _ = storm_cells(f, t0, N)
    regs = regions(f, t0, N, sats)
    default_t, default_view = defaults(f, t0)

    tiles_dir = os.path.join(args.out, 'earth-tiles')
    staged = tempfile.mkdtemp(prefix='earth-tiles-')
    l1 = h % U64(L1_MOD) == 0
    manifest = {}

    def put_tile(tid, sel, lat0, lon0, size):
        if not sel.any():
            return
        rec = records(f, sel, t0)
        body = json.dumps({'id': tid, 'n': int(rec.size), 'data': b64(rec)}, separators=(',', ':'))
        if size > 3.75 and len(gzip.compress(body.encode(), 6)) > TILE_GZ_MAX:
            half = size / 2
            for q in range(4):
                la, lo = lat0 + (q // 2) * half, lon0 + (q % 2) * half
                put_tile(f'{tid}-{q}', sel & (f['lat'] >= la) & (f['lat'] < la + half) & (f['lon'] >= lo) & (f['lon'] < lo + half), la, lo, half)
            return
        manifest[tid] = hashlib.sha256(body.encode()).hexdigest()[:8]
        with open(os.path.join(staged, f'{tid}.json'), 'w', encoding='utf-8') as fh:
            fh.write(body)

    for i in range(180 // TILE_DEG):
        for j in range(360 // TILE_DEG):
            lat0, lon0 = -90 + i * TILE_DEG, -180 + j * TILE_DEG
            box = l1 & (f['lat'] >= lat0) & (f['lat'] < lat0 + TILE_DEG) & (f['lon'] >= lon0) & (f['lon'] < lon0 + TILE_DEG)
            if i == 180 // TILE_DEG - 1:
                box |= l1 & (f['lat'] >= 90) & (f['lon'] >= lon0) & (f['lon'] < lon0 + TILE_DEG)
            put_tile(f'lt-{i}-{j}', box, lat0, lon0, TILE_DEG)

    per_sat = {s['id']: int((f['sat'] == k).sum()) for k, s in enumerate(sats)}
    per_sat.setdefault(LI['id'], 0)
    glm = {('east' if s['slot'] == 'GOES-East' else 'west'): {'sat': s['id'], 'files': stats[s['id']]['files'], 'expected': stats[s['id']]['expected'],
                                                              'flashes': per_sat.get(s['id'], 0), 'missingHours': stats[s['id']]['missingHours'][:30]} for s in SATS}
    coverage = [{'id': s['id'], 'name': s['name'], 'area': s['area'], 'lon': round(s['lon'], 1), 'angle': 60, 'lat': 56, 'state': 'nightly'} for s in SATS]
    li_st = stats[LI['id']]
    coverage.append({'id': LI['id'], 'name': LI['name'], 'area': LI['area'], 'lon': LI['lon'], 'angle': LI['angle'], 'lat': LI['lat'], 'state': 'nightly' if li_st['state'] == 'nightly' else 'off'})
    li_meta = {'state': li_st['state'], 'files': li_st['files'], 'expected': li_st['expected'], 'flashes': per_sat[LI['id']], 'missingHours': li_st['missingHours'][:30]}
    earth = {
        'version': 1,
        'meta': {
            'built': iso(time.time()), 'window': [iso(t0), iso(t1)], 't0': t0, 't1': t1,
            'defaultT': int(default_t), 'defaultView': default_view, 'flashes': int(f['lat'].size),
            'l0': {'mod': l0_mod, 'n': int(l0.size)}, 'l1': {'mod': L1_MOD, 'n': int(l1.sum())},
            'glm': glm, 'li': li_meta,
            'swpc': {'reachable': bool(sw_ok) or ovation_ok, 'parts': sorted(sw_ok), 'ovationRun': aur['obs'] if aur else None, 'source': sw.get('source', {}).get('active')},
            'aurora': {'frames': 1 if aur else 0, 'mode': 'latest'},
            'complete': all(not s['missingHours'] for s in stats.values()),
        },
        'coverage': coverage,
        'sources': {
            'li': 'Contains modified EUMETSAT Meteosat data 2026 (MTG-I1 Lightning Imager, LI-2-LFL, CC BY 4.0)',
            'glm': 'NOAA GOES-R GLM L2 LCFA via NOAA Open Data Dissemination (AWS)',
            'swpc': 'NOAA Space Weather Prediction Center',
            'lights': 'NASA Earth Observatory / NOAA NGDC, Suomi NPP VIIRS Black Marble 2016 (Román et al. 2018), via NASA GIBS',
            'land': 'Natural Earth 1:50m',
        },
        'sw': sw,
        'regions': regs,
        'cells': cells,
        'hourly': dens_tot,
        'tiles': manifest,
    }
    lightning = {'version': 1, 't0': t0, 'l0': {'n': int(l0.size), 'data': b64(l0)}, 'density': {'res': 1, 'hours': dens}}
    tmps = [(write_json(os.path.join(args.out, 'earth-lightning.json'), lightning), os.path.join(args.out, 'earth-lightning.json'))]
    if aur:
        tmps.append((write_json(os.path.join(args.out, 'earth-aurora.json'), {'version': 1, 'frames': [aur]}), os.path.join(args.out, 'earth-aurora.json')))
    tmps.append((write_json(os.path.join(args.out, 'earth.json'), earth), os.path.join(args.out, 'earth.json')))
    if os.path.isdir(tiles_dir):
        shutil.rmtree(tiles_dir)
    shutil.copytree(staged, tiles_dir)
    shutil.rmtree(staged, ignore_errors=True)
    for tmp, final in tmps:
        os.replace(tmp, final)
    missing = {k: v['missingHours'] for k, v in stats.items() if v['missingHours'] and (k != LI['id'] or v['state'] != 'off')}
    if missing:
        warn(f'earth: lightning incomplete, hours missing: {missing}')
    log(f'earth: window {iso(t0)} to {iso(t1)}, {f["lat"].size} flashes ({per_sat}), L0 {l0.size}, L1 {int(l1.sum())} in {len(manifest)} tiles, '
        f'{len(cells)} storms, default {iso(default_t)} at {default_view}, {time.time() - start:.0f} s')


if __name__ == '__main__':
    main()
