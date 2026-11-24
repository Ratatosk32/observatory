import argparse
import json
import os
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ci-data', 'earth_names.npz')
UA = 'Mozilla/5.0 (compatible; static-site-build)'
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
FILES = {'admin': 'ne_50m_admin_0_countries.geojson', 'marine': 'ne_50m_geography_marine_polys.geojson', 'land': 'ne_50m_land.geojson'}
RES = 4
W, H = 360 * RES, 180 * RES

REGIONS = [
    ('na', 'North America', 'land', [(23, 85, -170, -50)]),
    ('ca', 'Central America and Caribbean', 'any', [(7, 23, -118, -58)]),
    ('san', 'South America north', 'land', [(-15, 13, -82, -34)]),
    ('sas', 'South America south', 'land', [(-60, -15, -82, -34)]),
    ('me', 'Middle East', 'land', [(12, 42, 34, 63)]),
    ('eu', 'Europe', 'land', [(35, 85, -30, 50)]),
    ('af', 'Africa', 'land', [(-40, 38, -20, 52)]),
    ('mc', 'Maritime Continent', 'any', [(-11, 18, 92, 155)]),
    ('sa', 'South Asia', 'land', [(0, 40, 60, 92)]),
    ('ea', 'East Asia', 'land', [(18, 85, 50, 180)]),
    ('au', 'Australia', 'any', [(-50, -11, 110, 180)]),
    ('nat', 'North Atlantic', 'sea', [(0, 85, -100, 30)]),
    ('sat', 'South Atlantic', 'sea', [(-70, 0, -70, 30)]),
    ('io', 'Indian Ocean', 'sea', [(-70, 30, 20, 120)]),
    ('ep', 'East Pacific', 'sea', [(-70, 70, -180, -70)]),
    ('wp', 'West Pacific', 'sea', [(-70, 70, 100, 180)]),
]


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=180) as r, open(path + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(path + '.part', path)
    return path


def rings_of(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        for k, ring in enumerate(poly):
            yield k, ring


def to_px(ring):
    return [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in ring]


def raster(features, value_of):
    im = Image.new('I', (W, H), 0)
    d = ImageDraw.Draw(im)
    for feat, v in features:
        for k, ring in rings_of(feat['geometry']):
            d.polygon(to_px(ring), fill=v if k == 0 else 0)
    return np.asarray(im, dtype=np.int32)


def area(feat):
    a = 0.0
    for k, ring in rings_of(feat['geometry']):
        x = np.array([p[0] for p in ring]); y = np.array([p[1] for p in ring])
        s = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        a += s if k == 0 else -s
    return a


def grow(idx, mask, steps):
    out = idx.copy()
    for _ in range(steps):
        empty = (out == 0) & mask
        if not empty.any():
            break
        best = np.zeros_like(out)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(out, dx, axis=1)
            sh = np.roll(sh, dy, axis=0) if dy else sh
            if dy == 1:
                sh[0] = 0
            elif dy == -1:
                sh[-1] = 0
            best = np.where(best == 0, sh, best)
        out = np.where(empty, best, out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    os.makedirs(args.raw, exist_ok=True)
    gj = {}
    for k, name in FILES.items():
        with open(fetch(NE + name, os.path.join(args.raw, name)), encoding='utf-8') as f:
            gj[k] = json.load(f)
    land_feats = [(f, 1) for f in gj['land']['features']]
    land = raster(land_feats, None) > 0

    admin_names = ['']
    feats = []
    for f in gj['admin']['features']:
        p = f['properties']
        admin_names.append(p.get('NAME_LONG') or p.get('NAME') or p.get('ADMIN') or '')
        feats.append((f, len(admin_names) - 1))
    admin = raster(feats, None)
    admin = grow(admin, land, 12)
    near = grow(admin, np.ones_like(land), 16)

    marine_names = ['']
    mf = sorted(gj['marine']['features'], key=area, reverse=True)
    feats = []
    for f in mf:
        p = f['properties']
        marine_names.append(p.get('name') or p.get('NAME') or '')
        feats.append((f, len(marine_names) - 1))
    marine = raster(feats, None)
    marine = grow(marine, ~land, 400)

    lat = 90 - (np.arange(H) + 0.5) / RES
    lon = -180 + (np.arange(W) + 0.5) / RES
    LON, LAT = np.meshgrid(lon, lat)
    region = np.zeros((H, W), np.uint8)
    for i, (_, _, kind, boxes) in enumerate(REGIONS):
        sel = np.zeros_like(land)
        for la0, la1, lo0, lo1 in boxes:
            sel |= (LAT >= la0) & (LAT < la1) & (LON >= lo0) & (LON < lo1)
        if kind == 'land':
            sel &= land
        elif kind == 'sea':
            sel &= ~land
        region = np.where((region == 0) & sel, i + 1, region).astype(np.uint8)
    region = grow(region.astype(np.int32), np.ones_like(land), 200).astype(np.uint8)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    np.savez_compressed(
        args.out,
        admin=admin.astype(np.uint16), near=near.astype(np.uint16), marine=marine.astype(np.uint16),
        region=region, land=land.astype(np.uint8),
        admin_names=np.array(admin_names), marine_names=np.array(marine_names),
        region_ids=np.array([r[0] for r in REGIONS]), region_names=np.array([r[1] for r in REGIONS]),
    )
    print(f'{args.out}: {os.path.getsize(args.out) / 1024:.0f} KB, {len(admin_names) - 1} countries, {len(marine_names) - 1} marine areas', flush=True)


if __name__ == '__main__':
    main()
