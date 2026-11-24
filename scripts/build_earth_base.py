import argparse
import json
import os
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'site', 'data')
UA = 'Mozilla/5.0 (compatible; static-site-build)'
BLACK_MARBLE = ('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0'
                '&LAYERS=VIIRS_Black_Marble&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=4096&HEIGHT=2048&FORMAT=image/png&TIME=2016-01-01')
LAND = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson'

Image.MAX_IMAGE_PIXELS = 4096 * 2048 * 2


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=180) as r, open(path + '.part', 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(path + '.part', path)
    return path


def rings_of(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        for k, ring in enumerate(poly):
            yield k, ring


def land_mask(path, w, h):
    with open(path, encoding='utf-8') as f:
        gj = json.load(f)
    big = Image.new('L', (w * 2, h * 2), 0)
    d = ImageDraw.Draw(big)
    for feat in gj['features']:
        for k, ring in rings_of(feat['geometry']):
            pts = [((x + 180) / 360 * w * 2, (90 - y) / 180 * h * 2) for x, y in ring]
            d.polygon(pts, fill=255 if k == 0 else 0)
    return big.resize((w, h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    os.makedirs(args.raw, exist_ok=True)
    bm_path = fetch(BLACK_MARBLE, os.path.join(args.raw, 'black-marble-2016-4096.png'))
    land_path = fetch(LAND, os.path.join(args.raw, 'ne_50m_land.geojson'))
    bm = np.asarray(Image.open(bm_path).convert('RGB'), dtype=np.float32) / 255
    if bm.shape[:2] != (2048, 4096):
        raise SystemExit(f'unexpected Black Marble size {bm.shape}')
    lights = np.clip((bm[..., 0] - 0.55 * bm[..., 2]) * 1.6, 0, 1) ** 0.75
    full = Image.fromarray(np.round(lights * 255).astype(np.uint8), 'L')
    for w in (4096, 2048):
        im = full if w == 4096 else full.resize((w, w // 2), Image.LANCZOS)
        p = os.path.join(args.out, f'earth-lights-{w}.jpg')
        im.save(p, quality=82, optimize=True)
        print(f'{os.path.basename(p)}: {os.path.getsize(p) / 1024:.0f} KB', flush=True)
    land = land_mask(land_path, 2048, 1024)
    p = os.path.join(args.out, 'earth-land-2048.png')
    land.save(p, optimize=True)
    print(f'{os.path.basename(p)}: {os.path.getsize(p) / 1024:.0f} KB', flush=True)


if __name__ == '__main__':
    main()
