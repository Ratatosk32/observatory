import argparse
import base64
import collections
import csv
import gzip
import io
import json
import math
import os
import statistics
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_stars
from fetch_stars import (ROOT, STELLAR, all_alerts, clean, family_of, featured_targets, load_gz, load_objects,
                         load_sources, object_families)

BANDS = 'ugrizy'
MJD0 = 61000.0
ZP_NJY = 31.4

FAMILY_META = [
    ('rrlyr', 'RR Lyrae', 'pulsating halo giants, period about half a day; standard candles'),
    ('ceph', 'Cepheids', 'pulsating supergiants, periods of days to weeks; standard candles'),
    ('dsct', 'Delta Scuti & SX Phe', 'small, fast pulsators, periods of hours'),
    ('lpv', 'Miras & long-period variables', 'cool giants that swell over months'),
    ('ecl', 'Eclipsing binaries', 'two stars passing in front of each other'),
    ('active', 'Flare & spotted stars', 'magnetically active, mostly M dwarfs'),
    ('yso', 'Young stars', 'still accreting from their birth disks'),
    ('cv', 'Cataclysmic variables & novae', 'white dwarfs feeding on a companion'),
    ('star', 'Other catalogued stars', 'a known star that changed, no finer class'),
    ('sn', 'Supernovae (classified)', 'exploding stars in other galaxies, typed by spectra in TNS'),
    ('sncand', 'Supernova candidates', 'unconfirmed, flagged by Fink classifiers'),
    ('tde', 'Tidal disruption events', 'a star torn apart by a black hole'),
    ('agn', 'AGN, quasars & blazars', 'flickering accretion onto supermassive black holes'),
    ('unk', 'Unclassified transients', 'no catalogue match and no confident classifier label'),
]
FAM_INDEX = {k: i for i, (k, _, _) in enumerate(FAMILY_META)}
DIST_METHODS = ['gaia_parallax', 'rr_lyrae_candle', 'cloud_member', 'tns_redshift', 'host_galaxy', 'photo_z',
                'sdss_specz']
REASONS = ['wide', 'ddf_cosmos', 'ddf_edfs', 'ddf_ecdfs', 'ddf_xmm_lss', 'ddf_elaiss1', 'other']

LANDMARKS = [
    {'name': 'Proxima Centauri', 'pc': 1.302, 'ref': 'Gaia DR3 parallax'},
    {'name': 'Pleiades', 'pc': 136, 'ref': 'Gaia DR2 cluster parallax (Lodieu+2019)'},
    {'name': 'Galactic centre', 'pc': 8178, 'ref': 'GRAVITY Collaboration 2019'},
    {'name': 'Large Magellanic Cloud', 'pc': 49590, 'ref': 'Pietrzynski+2019'},
    {'name': 'Small Magellanic Cloud', 'pc': 62440, 'ref': 'Graczyk+2020'},
    {'name': 'Andromeda (M31)', 'pc': 761000, 'ref': 'Li+2021'},
    {'name': 'Virgo cluster', 'pc': 16.5e6, 'ref': 'Mei+2007'},
    {'name': 'Coma cluster', 'pc': 99e6, 'ref': 'z = 0.0231, H0 = 70'},
    {'name': 'z = 0.5', 'pc': None, 'ref': 'luminosity distance, flat LCDM H0 = 70, Om = 0.3'},
]
CLOUDS = [('Large Magellanic Cloud', 80.89, -69.76, 8.0, 49590.0, 0.022),
          ('Small Magellanic Cloud', 13.19, -72.83, 4.0, 62440.0, 0.03)]
RR_MG = 0.63
R_SUN_KPC = 8.178
Z_SUN_KPC = 0.0208
PHOTOZ_MAX = 1.0
H0 = 70.0
OM = 0.3

GAL = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
       [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
       [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]]


def galactic(ra, dec):
    r, d = math.radians(ra), math.radians(dec)
    v = (math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d))
    x, y, z = (sum(GAL[i][j] * v[j] for j in range(3)) for i in range(3))
    l = math.degrees(math.atan2(y, x)) % 360.0
    b = math.degrees(math.asin(max(-1.0, min(1.0, z))))
    return l, b


def sep_deg(ra1, d1, ra2, d2):
    r1, r2, a, b = map(math.radians, (ra1, ra2, d1, d2))
    c = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(r1 - r2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def lookback_gyr(z):
    n = 400
    acc = 0.0
    for k in range(n + 1):
        zz = z * k / n
        w = 0.5 if k in (0, n) else 1.0
        acc += w / ((1 + zz) * math.sqrt(OM * (1 + zz) ** 3 + (1 - OM)))
    return 977.792 / H0 * acc * z / n


def galactocentric(l, b, dist_pc):
    rl, rb = math.radians(l), math.radians(b)
    d = dist_pc / 1000.0
    x = d * math.cos(rb) * math.cos(rl) - R_SUN_KPC
    y = d * math.cos(rb) * math.sin(rl)
    z = d * math.sin(rb) + Z_SUN_KPC
    return [round(x, 3), round(y, 3), round(z, 3)]


def sdss_matches(base):
    d = os.path.join(base, 'sdss')
    best = {}
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            for r in read_csv_gz(os.path.join(d, f)):
                if r.get('spec_z'):
                    best.setdefault(int(r['oid']), r)
    return best


def lum_dist_pc(z):
    n = 400
    s = 0.0
    for k in range(n + 1):
        zz = z * k / n
        w = 0.5 if k in (0, n) else 1.0
        s += w / math.sqrt(OM * (1 + zz) ** 3 + (1 - OM))
    dc = 299792.458 / H0 * s * z / n
    return dc * (1 + z) * 1e6


def mag(flux):
    if flux is None or not isinstance(flux, (int, float)) or flux <= 0 or flux != flux:
        return None
    return ZP_NJY - 2.5 * math.log10(flux)


def num(v):
    v = clean(v)
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and math.isfinite(f) else None


def reason_index(r):
    r = (r or '').lower()
    if not r.startswith('ddf'):
        return 0 if r else REASONS.index('other')
    for k, name in enumerate(REASONS):
        if name.startswith('ddf') and r.startswith(name):
            return k
    return REASONS.index('other')


def r3(x, k=3):
    return None if x is None else round(x, k)


def read_csv_gz(fn):
    with gzip.open(fn, 'rt', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def gaia_xmatch(base):
    d = os.path.join(base, 'gaia')
    rows = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.startswith('xmatch-'):
                rows += read_csv_gz(os.path.join(d, f))
    by = collections.defaultdict(list)
    for r in rows:
        by[int(r['oid'])].append(r)
    return by


def best_gaia(cands, ra, dec, mjd):
    dt = (mjd - 57388.5) / 365.25 if mjd else 10.5
    best, bsep = None, None
    for c in cands:
        gra, gdec = float(c['ra']), float(c['dec'])
        pmra = num(c.get('pmra')) or 0.0
        pmdec = num(c.get('pmdec')) or 0.0
        gra += pmra * dt / 3.6e6 / max(1e-6, math.cos(math.radians(gdec)))
        gdec += pmdec * dt / 3.6e6
        s = sep_deg(ra, dec, gra, gdec) * 3600
        if bsep is None or s < bsep:
            best, bsep = c, s
    if best is None or bsep > 1.0:
        return None, bsep
    return best, bsep


def milky_way(base):
    fn = os.path.join(base, 'gaia', 'density-l05-b05.csv.gz')
    if not os.path.exists(fn):
        return None
    W, H = 720, 360
    n = [0] * (W * H)
    col = [None] * (W * H)
    for r in read_csv_gz(fn):
        li, bi = int(float(r['li'])), int(float(r['bi']))
        if 0 <= li < W and 0 <= bi < H:
            n[bi * W + li] += int(float(r['n']))
            col[bi * W + li] = num(r.get('bprp'))
    lo = min(v for v in n if v > 0)
    hi = max(n)
    ln_lo, ln_hi = math.log(lo), math.log(hi)
    dens = bytes(0 if v <= 0 else 1 + int(254 * (math.log(v) - ln_lo) / (ln_hi - ln_lo)) for v in n)
    colb = bytes(0 if c is None else max(1, min(255, int(round(c / 3.0 * 255)))) for c in col)
    total = sum(n)
    return {
        'width': W, 'height': H, 'cellDeg': 0.5,
        'indexing': 'cell (li, bi) at byte bi*720+li; l = (li+0.5)/2 deg in [0,360), b = (bi+0.5)/2-90 deg',
        'density': base64.b64encode(dens).decode(),
        'densityEncoding': f'uint8; 0 = no stars; v>0 -> count = exp(ln({lo}) + (v-1)/254*(ln({hi})-ln({lo})))',
        'countMin': lo, 'countMax': hi, 'starsSampled': total,
        'bpRp': base64.b64encode(colb).decode(),
        'bpRpEncoding': 'uint8; 0 = none; v -> mean BP-RP = v/255*3 mag',
    }


def milky_way_png(base, out_path):
    import numpy as np
    from PIL import Image
    fn = os.path.join(base, 'gaia', 'density-l025-b025.csv.gz')
    W, H = 1440, 720
    n = np.zeros((H, W))
    for r in read_csv_gz(fn):
        li, bi = int(float(r['li'])), int(float(r['bi']))
        if 0 <= li < W and 0 <= bi < H:
            n[bi, li] += float(r['n'])

    def smooth(a, sigma):
        rad = int(3 * sigma)
        x = np.arange(-rad, rad + 1)
        k = np.exp(-0.5 * (x / sigma) ** 2)
        k /= k.sum()
        p = np.concatenate([a[:, -rad:], a, a[:, :rad]], axis=1)
        a = np.stack([np.convolve(row, k, mode='valid') for row in p])
        p = np.concatenate([np.repeat(a[:1], rad, 0), a, np.repeat(a[-1:], rad, 0)], axis=0)
        return np.stack([np.convolve(col, k, mode='valid') for col in p.T]).T

    fine, coarse = smooth(n, 0.8), smooth(n, 3.0)
    w = np.clip((fine - 8) / 40, 0, 1)
    d = w * fine + (1 - w) * coarse
    ln = np.log10(np.maximum(d, 0.05))
    lo, hi = np.percentile(ln, 0.5), np.percentile(ln, 99.95)
    v = np.clip((ln - lo) / (hi - lo), 0, 1)
    img = np.round(v * 255).astype(np.uint8)[::-1]
    Image.fromarray(img, 'L').save(out_path, optimize=True)
    return {'width': W, 'height': H, 'cellDeg': 0.25, 'log10Min': round(float(lo), 4), 'log10Max': round(float(hi), 4),
            'rows': 'row 0 is b = +90; column j is l = (j + 0.5) / 4 deg', 'stars': int(n.sum())}


def bright_stars(base, gmax):
    fn = os.path.join(base, 'gaia', 'bright-g7.csv.gz')
    if not os.path.exists(fn):
        return None
    l, b, g, c = [], [], [], []
    for r in read_csv_gz(fn):
        G = num(r['phot_g_mean_mag'])
        if G is None or G >= gmax:
            continue
        l.append(round(float(r['l']), 2))
        b.append(round(float(r['b']), 2))
        g.append(round(G, 2))
        bp = num(r.get('bp_rp'))
        c.append(None if bp is None else round(bp, 2))
    return {'l': l, 'b': b, 'G': g, 'bpRp': c, 'gMax': gmax}


def hr_diagram(base):
    fn = os.path.join(base, 'gaia', 'hrd-plx10.csv.gz')
    if not os.path.exists(fn):
        return None
    c0, c1, m0, m1 = -10, 100, -50, 170
    W, H = c1 - c0, m1 - m0
    n = [0] * (W * H)
    for r in read_csv_gz(fn):
        if not r['ci'] or not r['mi']:
            continue
        ci, mi = int(float(r['ci'])), int(float(r['mi']))
        if c0 <= ci < c1 and m0 <= mi < m1:
            n[(mi - m0) * W + (ci - c0)] += int(float(r['n']))
    hi = max(n)
    enc = bytes(0 if v <= 0 else 1 + int(254 * math.log(v) / math.log(hi)) for v in n)
    return {
        'width': W, 'height': H, 'bpRpMin': c0 / 20, 'bpRpStep': 0.05, 'absGMin': m0 / 10, 'absGStep': 0.1,
        'indexing': 'byte (mi*width + ci): BP-RP = bpRpMin + (ci+0.5)*0.05, M_G = absGMin + (mi+0.5)*0.1',
        'counts': base64.b64encode(enc).decode(),
        'countsEncoding': f'uint8; 0 = empty; v>0 -> count = exp((v-1)/254*ln({hi}))',
        'countMax': hi, 'stars': sum(n),
        'selection': 'Gaia DR3, parallax > 5 mas (within 200 pc), parallax_over_error > 10, BP/RP flux S/N > 20, '
                     'RUWE < 1.4; no extinction correction',
    }


def nights(base):
    rows = []
    for year in ('2025', '2026'):
        fn = os.path.join(base, 'fink', f'stats-{year}.json.gz')
        if os.path.exists(fn):
            rows += load_gz(fn)
    out = []
    for r in sorted(rows, key=lambda x: x['f:night']):
        n = r['f:night']
        y, m, d = int(n[:4]), int(n[4:6]), int(n[6:8])
        a = (14 - m) // 12
        yy, mm = y + 4800 - a, m + 12 * a - 3
        jdn = d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
        mjd = jdn - 2400001
        out.append({'night': n, 'mjd': mjd, 'alerts': int(r['f:alerts']), 'visits': int(r['f:visits']),
                    'objects': int(r['f:objects']), 'new': int(r['f:is_first']), 'sso': int(r['f:is_sso']),
                    'tns': int(r['f:in_tns']), 'bands': [int(r[f'f:alerts_{b}']) for b in BANDS]})
    return out


def night_key(mjd):
    return int(math.floor(mjd - 0.5))


def nightly_bins(rows, width=None):
    groups = collections.OrderedDict()
    for r in sorted(rows, key=lambda r: r['r:midpointMjdTai']):
        t = num(r.get('r:midpointMjdTai'))
        f = num(r.get('r:psfFlux'))
        if t is None or f is None or r.get('r:band') not in BANDS:
            continue
        key = night_key(t) if width is None else int(math.floor((t - 0.5) / width))
        groups.setdefault((key, r['r:band']), []).append(r)
    lc = {'binDays': 1.0 if width is None else round(width, 5), 't': [], 'b': [], 'f': [], 'fe': [], 's': [], 'n': []}
    for (_, band), grp in groups.items():
        ws, wf, ts, ss = 0.0, 0.0, [], []
        for r in grp:
            fe = num(r.get('r:psfFluxErr')) or 0.0
            w = 1.0 / fe ** 2 if fe > 0 else 0.0
            ws += w
            wf += w * num(r['r:psfFlux'])
            ts.append(num(r['r:midpointMjdTai']))
            sv = num(r.get('r:scienceFlux'))
            if sv is not None:
                ss.append(sv)
        if ws > 0:
            f, fe = wf / ws, 1.0 / math.sqrt(ws)
        else:
            f, fe = statistics.mean(num(r['r:psfFlux']) for r in grp), None
        lc['t'].append(round(statistics.mean(ts) - MJD0, 4))
        lc['b'].append(BANDS.index(band))
        lc['f'].append(round(f, 1))
        lc['fe'].append(None if fe is None else round(fe, 1))
        lc['s'].append(round(statistics.median(ss), 1) if ss else None)
        lc['n'].append(len(grp))
    return lc


PERIODIC = {'rrlyr', 'ceph', 'dsct', 'ecl', 'star', 'active'}


def rubin_period(fpc, min_points=30):
    import numpy as np
    t = np.array(fpc['t'], dtype=float)
    b = np.array(fpc['b'])
    f = np.array([np.nan if v is None else v for v in fpc['f']], dtype=float)
    fe = np.array([np.nan if v is None else v for v in fpc['fe']], dtype=float)
    ok = np.isfinite(f) & np.isfinite(fe) & (fe > 0)
    if ok.sum() < min_points:
        return None
    bands, counts = np.unique(b[ok], return_counts=True)
    band = bands[np.argmax(counts)]
    m = ok & (b == band)
    if m.sum() < min_points:
        return None
    t, y, w = t[m], f[m], 1.0 / fe[m] ** 2
    y = y - np.average(y, weights=w)
    span = t.max() - t.min()
    if span < 5:
        return None
    freqs = np.arange(1.0 / min(span, 400.0), 25.0, 0.1 / span)
    power = np.empty(len(freqs))
    W = w.sum()
    for k0 in range(0, len(freqs), 4000):
        fr = freqs[k0:k0 + 4000, None]
        ph = 2 * np.pi * fr * t[None, :]
        c, s_ = np.cos(ph), np.sin(ph)
        yc, ys = (w * y * c).sum(1), (w * y * s_).sum(1)
        cc, ss, cs = (w * c * c).sum(1), (w * s_ * s_).sum(1), (w * c * s_).sum(1)
        cm, sm = (w * c).sum(1) / W, (w * s_).sum(1) / W
        cc, ss, cs = cc - W * cm * cm, ss - W * sm * sm, cs - W * cm * sm
        det = cc * ss - cs * cs
        power[k0:k0 + 4000] = np.where(det > 0, (ss * yc ** 2 + cc * ys ** 2 - 2 * cs * yc * ys) / np.maximum(det, 1e-30), 0)
    yy = (w * y * y).sum()
    power = power / yy
    k = int(np.argmax(power))
    return {'period': round(float(1.0 / freqs[k]), 6), 'power': round(float(power[k]), 3), 'band': BANDS[int(band)],
            'points': int(m.sum()), 'method': 'weighted Lomb-Scargle on Fink forced photometry, 0.04-25 cycles/day'}


def png_data_uri(fn):
    with open(fn, 'rb') as fh:
        body = fh.read()
    if body[:8] != b'\x89PNG\r\n\x1a\n' or len(body) > 200_000:
        return None, None
    w, h = struct.unpack('>II', body[16:24])
    return 'data:image/png;base64,' + base64.b64encode(body).decode(), (w, h)


HORIZONS = [
    ('M dwarf, quiet', 12.0, 'r', 'quiescent red dwarf; a big flare adds 2-5 mag only for minutes'),
    ('RR Lyrae', 0.6, 'r', 'nearly constant luminosity; a standard candle'),
    ('Classical Cepheid, P = 10 d', -4.1, 'V', 'period-luminosity relation (Leavitt law)'),
    ('Classical nova at peak', -8.0, 'V', 'typical, with a wide spread'),
    ('Type II-P supernova, plateau', -16.5, 'r', 'typical, wide spread'),
    ('Type Ia supernova at peak', -19.3, 'B', 'standardisable candle'),
    ('Superluminous supernova at peak', -21.5, 'u/g', 'rare, brightest explosions'),
    ('Luminous quasar', -26.0, 'i', 'accreting supermassive black hole'),
]
M_LIM_SINGLE = 24.5
M_LIM_DEEP = 26.0


def dl_from_mu(mu):
    target = 10 ** (mu / 5 + 1)
    if target < 1e7:
        return target
    lo, hi = 0.0, 20.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if lum_dist_pc(mid) < target:
            lo = mid
        else:
            hi = mid
    return target, (lo + hi) / 2


def horizons():
    out = []
    for name, absmag, band, note in HORIZONS:
        row = {'kind': name, 'absMag': absmag, 'band': band, 'note': note}
        for key, mlim in (('single', M_LIM_SINGLE), ('deep', M_LIM_DEEP)):
            r = dl_from_mu(mlim - absmag)
            if isinstance(r, tuple):
                row[key + 'Pc'] = round(r[0], -3)
                row[key + 'Z'] = round(r[1], 3)
            else:
                row[key + 'Pc'] = round(r, 1)
                row[key + 'Z'] = None
        out.append(row)
    return out


def multiband_periodogram(t, b, f, fe, fmin=0.5, fmax=25.0, nbins=1500, phase_bins=20):
    import numpy as np
    t, b, f = (np.asarray(x, dtype=float) for x in (t, b, f))
    ok = np.isfinite(f)
    t, b, f = t[ok], b[ok], f[ok]
    y = np.zeros_like(f)
    for band in np.unique(b):
        m = b == band
        if m.sum() < 5:
            continue
        lo, hi = np.percentile(f[m], [5, 95])
        y[m] = (f[m] - np.median(f[m])) / max(hi - lo, 1e-9)
    span = t.max() - t.min()
    freqs = np.arange(fmin, fmax, 0.05 / span)
    var = ((y - y.mean()) ** 2).sum()

    def theta(fr):
        ph = (t[None, :] * fr[:, None]) % 1.0
        idx = (ph * phase_bins).astype(int)
        tot = np.zeros(len(fr))
        for k in range(phase_bins):
            m = idx == k
            n = m.sum(1)
            s1 = (y[None, :] * m).sum(1)
            s2 = ((y ** 2)[None, :] * m).sum(1)
            tot += s2 - np.where(n > 0, s1 ** 2 / np.maximum(n, 1), 0)
        return tot / var

    th = np.concatenate([theta(freqs[i:i + 3000]) for i in range(0, len(freqs), 3000)])
    quality = 1.0 - th
    periods = 1.0 / freqs
    lp = np.log10(periods)
    edges = np.linspace(lp.min(), lp.max(), nbins + 1)
    idx = np.clip(np.digitize(lp, edges) - 1, 0, nbins - 1)
    curve = np.zeros(nbins)
    np.maximum.at(curve, idx, quality)
    peaks = []
    for k in np.argsort(th):
        if len(peaks) >= 8:
            break
        if all(abs(freqs[k] - 1 / p['period']) > 2.0 / span for p in peaks):
            peaks.append({'period': round(float(periods[k]), 7), 'quality': round(float(quality[k]), 4),
                          'halfWidthDays': round(float(periods[k] ** 2 * 0.5 / span), 8)})
    return {'logPeriodMin': round(float(lp.min()), 5), 'logPeriodMax': round(float(lp.max()), 5),
            'curve': [round(float(v), 4) for v in curve], 'peaks': peaks, 'spanDays': round(float(span), 3),
            'medianQuality': round(float(np.median(quality)), 4),
            'method': 'phase dispersion minimisation (20 phase bins) on forced photometry, each band '
                      'median-subtracted and scaled by its 5-95 percentile range; quality = 1 - theta; '
                      'curve = best quality per log-period bin, from short to long period'}


def story_series(rows, with_science):
    keys = ['t', 'b', 'f', 'fe'] + (['s'] if with_science else [])
    S = {k: [] for k in keys}
    for r in sorted(rows, key=lambda r: r['r:midpointMjdTai']):
        f = num(r.get('r:psfFlux'))
        if r.get('r:band') not in BANDS or f is None:
            continue
        S['t'].append(round(r['r:midpointMjdTai'] - MJD0, 5))
        S['b'].append(BANDS.index(r['r:band']))
        S['f'].append(round(f, 1))
        fe = num(r.get('r:psfFluxErr'))
        S['fe'].append(None if fe is None else round(fe, 1))
        if with_science:
            sv = num(r.get('r:scienceFlux'))
            S['s'].append(None if sv is None else round(sv, 1))
    return S


def build_stories(base, index_of, O):
    d = os.path.join(base, 'fink-story')
    out = {}
    if not os.path.isdir(d):
        return out
    for f in sorted(os.listdir(d)):
        if not f.startswith('story-'):
            continue
        st = load_gz(os.path.join(d, f))
        oid = st['oid']
        o = index_of.get(oid)
        S = story_series(st['sources'], True)
        P = story_series(st['fp'], False)
        stamps = []
        for e in st['stamps']:
            item = {'epoch': e['epoch'], 'diaSourceId': str(e['diaSourceId']), 't': round(e['t'] - MJD0, 5),
                    'band': e['band']}
            for kind in ('Science', 'Template', 'Difference'):
                fn = os.path.join(d, f"{oid}-{e['diaSourceId']}-{kind}.png")
                if os.path.exists(fn):
                    uri, dims = png_data_uri(fn)
                    if uri:
                        item[kind.lower()] = uri
                        item['px'] = dims
            stamps.append(item)
        peak = None
        if S['f']:
            j = max(range(len(S['f'])), key=lambda k: S['f'][k])
            pm = mag(S['f'][j])
            peak = {'t': S['t'][j], 'band': BANDS[S['b'][j]], 'diffMag': None if pm is None else round(pm, 2)}
            if o is not None and O['dist'][o] and pm:
                peak['absMag'] = round(pm - 5 * math.log10(O['dist'][o] / 10), 2)
                peak['absMagNote'] = ('difference-flux peak minus distance modulus; no K-correction, '
                                      'no host or Milky Way extinction')
        item = {'key': st['key'], 'id': str(oid), 'o': o, 'sources': S, 'fp': P, 'stamps': stamps, 'peak': peak}
        if st['key'] in ('contact_binary', 'rr_lyrae') and len(P['t']) > 50:
            item['periodogram'] = multiband_periodogram(P['t'], P['b'],
                                                        [math.nan if v is None else v for v in P['f']],
                                                        [math.nan if v is None else v for v in P['fe']])
        out[st['key']] = item
    return out


def parse_iau_names(fn, vmax=6.5):
    lines = open(fn, encoding='utf-8').read().splitlines()
    hdr = next(x for x in lines if x.startswith('#Name/ASCII'))
    c_des = hdr.index('Designation')
    c_id = hdr.index('ID', c_des + 11)
    c_con = hdr.index('Con', c_id)
    c_comp = hdr.index('#', c_con)
    names = []
    for x in lines:
        if not x.strip() or x[0] in '#$':
            continue
        toks = x.split()
        date_i = next((i for i in range(len(toks) - 1, 0, -1)
                       if len(toks[i]) == 10 and toks[i].count('-') == 2), None)
        if date_i is None or date_i < 7:
            continue
        try:
            ra, dec, vmag = float(toks[date_i - 2]), float(toks[date_i - 1]), float(toks[date_i - 6])
        except ValueError:
            continue
        if vmag > vmax:
            continue
        hip = toks[date_i - 4]
        ids = x[c_id:c_con].split()
        greek = ids[1] if len(ids) > 1 and ids[1] != '_' else (ids[0] if ids and ids[0] != '_' else '')
        con = x[c_con:c_comp].strip()
        l, b = galactic(ra, dec)
        names.append({'name': toks[0], 'bayer': (greek + ' ' + con).strip() if greek else '',
                      'designation': x[c_des:c_id].strip(), 'constellation': con,
                      'hip': None if hip == '_' else hip, 'mag': vmag, 'ra': round(ra, 4), 'dec': round(dec, 4),
                      'l': round(l, 3), 'b': round(b, 3)})
    names.sort(key=lambda r: r['mag'])
    return names


def build_tiles(date):
    base = os.path.join(fetch_stars.DATA, f'stars-{date}')
    d = os.path.join(base, 'gaia-tiles')
    tiles = []
    for f in sorted(os.listdir(d)):
        with gzip.open(os.path.join(d, f), 'rt', encoding='utf-8') as fh:
            head = json.loads(fh.readline()[2:])
            rows = list(csv.DictReader(fh))
        w, h = head['w'], head['h']
        n = [0] * (w * h)
        col = [None] * (w * h)
        for r in rows:
            if not r.get('li') or not r.get('bi'):
                continue
            li, bi = int(float(r['li'])), int(float(r['bi']))
            if 0 <= li < w and 0 <= bi < h:
                n[bi * w + li] += int(float(r['n']))
                col[bi * w + li] = num(r.get('bprp'))
        pos = [v for v in n if v > 0]
        lo, hi = min(pos), max(pos)
        span = (math.log(hi) - math.log(lo)) or 1.0
        dens = bytes(0 if v <= 0 else 1 + int(254 * (math.log(v) - math.log(lo)) / span) for v in n)
        colb = bytes(0 if c is None else max(1, min(255, int(round(c / 3.0 * 255)))) for c in col)
        tiles.append({'name': head['name'], 'raCenter': head['ra'], 'decCenter': head['dec'],
                      'radiusDeg': head['radius'], 'l0': round(head['l0'], 4), 'b0': round(head['b0'], 4), 'step': head['step'],
                      'width': w, 'height': h, 'sampleFraction': head['fraction'], 'starsCounted': sum(n),
                      'countMin': lo, 'countMax': hi,
                      'density': base64.b64encode(dens).decode(), 'bpRp': base64.b64encode(colb).decode()})
    fn = os.path.join(base, 'iau', 'IAU-CSN.txt')
    names = parse_iau_names(fn) if os.path.exists(fn) else []
    meta = {
        'built': date,
        'tileEncoding': 'like stars.json milkyWay: uint8 log scale, 0 = empty; count = exp(ln(countMin) + '
                        '(v-1)/254*(ln(countMax)-ln(countMin))); stars per deg2 = count / sampleFraction / step^2 '
                        '(cells are step x step in l and b; multiply area by cos b for true solid angle)',
        'tileIndexing': 'byte bi*width + li; l = l0 + (li+0.5)*step, l wrapped to [-180,180); b = b0 + (bi+0.5)*step',
        'tileSource': 'Gaia DR3 gaia_source via ESA Gaia Archive TAP; only cells inside the ICRS circle of radiusDeg '
                      'are filled, the rest are 0 (no data, not empty sky)',
        'bpRpEncoding': 'uint8; 0 = none; mean BP-RP = v/255*3 mag',
        'namesSource': 'IAU Catalog of Star Names (IAU-CSN), IAU WGSN, compiled by E. Mamajek; CC BY; V <= 6.5',
    }
    return {'meta': meta, 'tiles': tiles, 'namedStars': names}


def build(date, gmax):
    base = os.path.join(fetch_stars.DATA, f'stars-{date}')
    alerts = all_alerts(date)
    objs = load_objects(date)
    fams = object_families(date)
    src = load_sources(date)
    xm = gaia_xmatch(base)
    sdss = sdss_matches(base)

    info = {}
    for a in alerts:
        i = int(a['r:diaObjectId'])
        d = info.setdefault(i, {'tags': set(), 'classes': set(), 'xm': {}})
        if a.get('_tag'):
            d['tags'].add(a['_tag'])
        if a.get('_class'):
            d['classes'].add(a['_class'])
        for k, v in a.items():
            if k.startswith('f:xm_') and clean(v) is not None and k not in d['xm']:
                d['xm'][k] = v
        d.setdefault('reason', a.get('r:observation_reason'))
    for i, rows in src.items():
        d = info.setdefault(i, {'tags': set(), 'classes': set(), 'xm': {}})
        for r in rows:
            for k, v in r.items():
                if k.startswith('f:xm_') and clean(v) is not None and k not in d['xm']:
                    d['xm'][k] = v

    ids = sorted(i for i in info if i in objs)
    missing_obj = len(info) - len(ids)

    points = {}
    for a in alerts:
        points[int(a['r:diaSourceId'])] = a
    for rows in src.values():
        for r in rows:
            points[int(r['r:diaSourceId'])] = r

    O = collections.defaultdict(list)
    lcs = []
    stats = collections.Counter()
    bad_coord = 0
    index_of = {}
    type_index = {}
    for i in ids:
        o = objs[i]
        ra, dec = num(o.get('r:ra')), num(o.get('r:dec'))
        if ra is None or dec is None or not (0 <= ra < 360 and -90 <= dec <= 90):
            bad_coord += 1
            continue
        index_of[i] = len(O['id'])
        fam = fams.get(i, 'unk')
        xmi = info[i]['xm']
        l, b = galactic(ra, dec)
        t0 = num(o.get('r:firstDiaSourceMjdTai'))
        t1 = num(o.get('r:lastDiaSourceMjdTai'))
        means = {bd: mag(num(o.get(f'r:{bd}_scienceFluxMean'))) for bd in BANDS}
        ndet = {bd: int(num(o.get(f'r:{bd}_psfFluxNdata')) or 0) for bd in BANDS}
        ref_band = max(BANDS, key=lambda bd: (means[bd] is not None, ndet[bd]))
        tns_name = clean(xmi.get('f:xm_tns_fullname'))
        tns_type = clean(xmi.get('f:xm_tns_type'))
        vsx = clean(xmi.get('f:xm_vsx_Type'))
        simbad = clean(xmi.get('f:xm_simbad_otype'))
        catalog_type = (f'TNS {tns_type}' if tns_type else f'VSX {vsx}' if vsx else
                        f'SIMBAD {simbad}' if simbad else ('Fink tag ' + ','.join(sorted(info[i]['tags'])))
                        if info[i]['tags'] else '')

        dist = dlo = dhi = None
        method = None
        period = None
        period_src = None
        gmag = bprp = plx = eplx = None
        g, gsep = best_gaia(xm.get(i, []), ra, dec, t1)
        if g is not None:
            plx, eplx = num(g.get('parallax')), num(g.get('parallax_error'))
            gmag, bprp = num(g.get('phot_g_mean_mag')), num(g.get('bp_rp'))
            rmed, rlo, rhi = num(g.get('r_med_geo')), num(g.get('r_lo_geo')), num(g.get('r_hi_geo'))
            if plx and eplx and plx / eplx >= 5:
                method = 'gaia_parallax'
                if rmed:
                    dist, dlo, dhi = rmed, rlo, rhi
                else:
                    dist, dlo, dhi = 1000 / plx, 1000 / (plx + eplx), 1000 / max(plx - eplx, 1e-3)
            rr_p = num(g.get('rr_pf')) or num(g.get('rr_p1o'))
            if rr_p:
                period, period_src = rr_p, 'Gaia DR3 vari_rrlyrae'
            elif num(g.get('ce_pf')):
                period, period_src = num(g.get('ce_pf')), 'Gaia DR3 vari_cepheid'
            elif num(g.get('eb_freq')):
                period, period_src = 1.0 / num(g.get('eb_freq')), 'Gaia DR3 vari_eclipsing_binary'
            elif num(g.get('lpv_freq')):
                period, period_src = 1.0 / num(g.get('lpv_freq')), 'Gaia DR3 vari_long_period_variable'
            if method is None and fam == 'rrlyr' and gmag is not None:
                method = 'rr_lyrae_candle'
                dist = 10 ** ((gmag - RR_MG + 5) / 5)
                dlo, dhi = dist * 0.9, dist * 1.1
        if method is None and fam in STELLAR:
            for name, cra, cdec, rad, dpc, frac in CLOUDS:
                if sep_deg(ra, dec, cra, cdec) < rad and (g is None or (num(g.get('parallax')) or 0) < 0.2):
                    method = 'cloud_member'
                    dist, dlo, dhi = dpc, dpc * (1 - frac), dpc * (1 + frac)
                    break
        zval = zsrc = None
        sd = sdss.get(i)
        if method is None and fam not in STELLAR:
            z = num(xmi.get('f:xm_tns_redshift'))
            ld = num(xmi.get('f:xm_mangrove_lum_dist'))
            zp = num(xmi.get('f:xm_legacydr8_zphot'))
            zs = num(sd.get('spec_z')) if sd and sd.get('spec_z_warning') == '0' else None
            if z and 0 < z < 7:
                method = 'tns_redshift'
                dist = lum_dist_pc(z)
                dlo, dhi = dist * 0.97, dist * 1.03
                zval, zsrc = z, 'tns'
            elif zs and 0.002 < zs < 7:
                method = 'sdss_specz'
                dist = lum_dist_pc(zs)
                dlo, dhi = dist * 0.99, dist * 1.01
                zval, zsrc = zs, 'sdss'
            elif ld and ld > 0:
                method = 'host_galaxy'
                dist = ld * 1e6
                dlo, dhi = dist * 0.8, dist * 1.2
            elif zp and 0.005 < zp <= PHOTOZ_MAX and (num(xmi.get('f:xm_legacydr8_pstar')) or 0) < 0.5:
                method = 'photo_z'
                dist = lum_dist_pc(zp)
                dlo, dhi = lum_dist_pc(zp * 0.8), lum_dist_pc(zp * 1.2)
                zval, zsrc = zp, 'photo'
        stats['dist_' + (method or 'none')] += 1

        lc_index = -1
        rows = src.get(i)
        if rows:
            lc = nightly_bins(rows, None if not period else min(1.0, max(period / 20.0, 0.005)))
            if lc['t']:
                lc_index = len(lcs)
                lcs.append(lc)

        O['id'].append(str(i))
        O['fam'].append(FAM_INDEX[fam])
        O['ra'].append(r3(ra, 4))
        O['dec'].append(r3(dec, 4))
        O['l'].append(r3(l, 2))
        O['b'].append(r3(b, 2))
        O['t0'].append(r3(t0 - MJD0 if t0 else None, 4))
        O['t1'].append(r3(t1 - MJD0 if t1 else None, 4))
        O['nDet'].append(int(num(o.get('r:nDiaSources')) or 0))
        O['nDetBand'].append([ndet[bd] for bd in BANDS])
        O['meanMag'].append([r3(means[bd], 1) for bd in BANDS])
        O['refBand'].append(BANDS.index(ref_band))
        O['name'].append(tns_name or '')
        if catalog_type not in type_index:
            type_index[catalog_type] = len(type_index)
        O['catType'].append(type_index[catalog_type])
        O['reason'].append(reason_index(info[i].get('reason')))
        O['dist'].append(None if dist is None else round(dist, 1))
        O['distLo'].append(None if dlo is None else round(dlo, 1))
        O['distHi'].append(None if dhi is None else round(dhi, 1))
        O['distMethod'].append(-1 if method is None else DIST_METHODS.index(method))
        O['period'].append(None if period is None else round(period, 7))
        O['periodSrc'].append(period_src or '')
        O['gaiaG'].append(r3(gmag, 3))
        O['gaiaBpRp'].append(r3(bprp, 3))
        O['gaiaPlx'].append(r3(plx, 4))
        O['gaiaPlxErr'].append(r3(eplx, 4))
        O['gaiaSep'].append(None if g is None else round(gsep, 3))
        O['lc'].append(lc_index)
        O['z'].append(None if zval is None else round(zval, 5))
        O['zSrc'].append(zsrc or '')
        O['lookbackGyr'].append(None if dist is None else round(lookback_gyr(zval) if zval else dist * 3.2616e-9, 4 if zval else 9))
        O['sdssClass'].append((sd.get('spec_class') or '').strip() if sd else '')
        O['gc'].append(galactocentric(l, b, dist) if dist is not None and fam in STELLAR else None)
        stats['fam_' + fam] += 1

    best = {}
    raw_per_night = collections.Counter()
    for a in points.values():
        i = int(a['r:diaObjectId'])
        f = num(a.get('r:psfFlux'))
        t = num(a.get('r:midpointMjdTai'))
        if i not in index_of or a.get('r:band') not in BANDS or not f or t is None:
            continue
        key = (index_of[i], night_key(t))
        raw_per_night[key[1]] += 1
        if key not in best or abs(f) > abs(best[key][1]):
            best[key] = (t, f, a['r:band'])
    A = {'o': [], 't': [], 'b': [], 'm': [], 'sgn': []}
    for (o_idx, _), (t, f, band) in sorted(best.items(), key=lambda kv: kv[1][0]):
        A['o'].append(o_idx)
        A['t'].append(round(t - MJD0, 4))
        A['b'].append(BANDS.index(band))
        A['m'].append(round(mag(abs(f)), 2))
        A['sgn'].append(1 if f > 0 else -1)
    stats['raw_alert_points'] = len(points)
    span = {}
    for (o_idx, _), (t, _, _) in best.items():
        lo, hi = span.get(o_idx, (t, t))
        span[o_idx] = (min(lo, t), max(hi, t))
    O['tSrc'] = [0] * len(O['id'])
    for k in range(len(O['id'])):
        if O['t0'][k] is None and k in span:
            O['t0'][k] = round(span[k][0] - MJD0, 4)
            O['t1'][k] = round(span[k][1] - MJD0, 4)
            O['tSrc'][k] = 1
            stats['t0_from_sample_alerts'] += 1

    fp_by = collections.defaultdict(list)
    fdir = os.path.join(base, 'fink')
    for f in sorted(os.listdir(fdir)):
        if f.startswith('fp-'):
            for r in load_gz(os.path.join(fdir, f)):
                fp_by[int(r['r:diaObjectId'])].append(r)

    featured = []
    cdir = os.path.join(base, 'fink-cutouts')
    for fam, oid, sid in featured_targets(date):
        if oid not in index_of:
            continue
        stamps = {}
        dims = None
        for kind in ('Science', 'Template', 'Difference'):
            fn = os.path.join(cdir, f'{oid}-{sid}-{kind}.png')
            if os.path.exists(fn):
                uri, dims = png_data_uri(fn)
                if uri:
                    stamps[kind.lower()] = uri
        fp = sorted(fp_by.get(oid, []), key=lambda r: r['r:midpointMjdTai'])
        fpc = {'t': [round(r['r:midpointMjdTai'] - MJD0, 4) for r in fp],
               'b': [BANDS.index(r['r:band']) if r['r:band'] in BANDS else -1 for r in fp],
               'f': [None if num(r.get('r:psfFlux')) is None else round(num(r['r:psfFlux']), 1) for r in fp],
               'fe': [None if num(r.get('r:psfFluxErr')) is None else round(num(r['r:psfFluxErr']), 1) for r in fp]}
        stamp_mjd = None
        for r in src.get(oid, []):
            if int(r['r:diaSourceId']) == sid:
                stamp_mjd = round(r['r:midpointMjdTai'] - MJD0, 4)
        prub = rubin_period(fpc) if fam in PERIODIC else None
        if prub:
            stats['featured_rubin_period'] += 1
            pg = O['period'][index_of[oid]]
            rel = None
            if pg:
                q = prub['period'] / pg
                rel = 'agrees' if abs(q - 1) < 0.01 else 'half' if abs(2 * q - 1) < 0.01 else 'double' if abs(q / 2 - 1) < 0.01 else 'differs'
            prub['vsGaia'] = rel
            prub['reliable'] = prub['power'] >= 0.5
        featured.append({'o': index_of[oid], 'fam': fam, 'periodRubin': prub, 'diaSourceId': str(sid), 'stampT': stamp_mjd,
                         'stampPx': dims, 'stamps': stamps, 'fp': fpc})

    nts = nights(base)
    mw = milky_way(base)
    bright = bright_stars(base, gmax)
    hrd = hr_diagram(base)
    for lm in LANDMARKS:
        if lm['pc'] is None:
            lm['pc'] = round(lum_dist_pc(0.5))

    tmin = min(A['t']) + MJD0 if A['t'] else None
    tmax = max(A['t']) + MJD0 if A['t'] else None
    meta = {
        'built': date,
        'mjdOffset': MJD0,
        'bands': list(BANDS),
        'magZeroPointNJy': ZP_NJY,
        'families': [{'key': k, 'label': lab, 'blurb': blurb} for k, lab, blurb in FAMILY_META],
        'catTypes': list(type_index),
        'distMethods': DIST_METHODS,
        'reasons': REASONS,
        'landmarks': LANDMARKS,
        'rrLyraeAbsMagG': RR_MG,
        'photoZMax': PHOTOZ_MAX,
        'cosmology': {'H0': H0, 'Om': OM, 'flat': True},
        'counts': {
            'objects': len(O['id']), 'alertPoints': len(A['t']), 'lightCurves': len(lcs),
            'featured': len(featured), 'objectsWithoutAggregate': missing_obj, 'badCoordinates': bad_coord,
            'nights': len(nts), 'alertsAllNights': sum(n['alerts'] for n in nts),
            'brightStars': len(bright['l']) if bright else 0,
        },
        'mjdRange': [tmin, tmax],
        'stats': dict(sorted(stats.items())),
        'sources': [
            'Fink LSST broker API, api.lsst.fink-portal.org (explore, tags, objects, sources, fp, cutouts, statistics)',
            'Gaia DR3 via ESA Gaia Archive TAP (gaia_source, vari_rrlyrae, vari_cepheid, vari_eclipsing_binary, '
            'vari_long_period_variable) and external.gaiaedr3_distance (Bailer-Jones et al. 2021)',
        ],
    }
    meta['horizons'] = horizons()
    meta['horizonLimits'] = {'singleVisit': M_LIM_SINGLE, 'deepDrillingNight': M_LIM_DEEP}
    stories = build_stories(base, index_of, O)
    return {'stories': stories, 'meta': meta, 'nights': nts, 'objects': dict(O), 'alerts': A, 'lcs': lcs,
            'featured': featured, 'milkyWay': mw, 'brightStars': bright, 'hrDiagram': hrd}


def write_json(path, obj, ascii_only=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = json.dumps(obj, separators=(',', ':'), allow_nan=False, ensure_ascii=ascii_only)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(body)
    return len(body.encode())


def main():
    ap = argparse.ArgumentParser(description='Build site/data/stars.json and stars-tiles.json from data/stars-<date>/ (local files only).')
    ap.add_argument('--date', default='2026-11-22')
    ap.add_argument('--gmax', type=float, default=6.0)
    ap.add_argument('--data-dir', default=os.path.join(ROOT, 'data'))
    ap.add_argument('--out-dir', default=os.path.join(ROOT, 'site', 'data'))
    ap.add_argument('--tiles', action='store_true', help='build stars-tiles.json instead of stars.json')
    ap.add_argument('--milkyway', action='store_true', help='build site/data/milkyway.png (Gaia DR3 star density at 0.25 deg) instead of stars.json')
    a = ap.parse_args()
    fetch_stars.DATA = os.path.abspath(a.data_dir)
    if a.milkyway:
        out = os.path.join(a.out_dir, 'milkyway.png')
        info = milky_way_png(os.path.join(fetch_stars.DATA, f'stars-{a.date}'), out)
        print('wrote', out, os.path.getsize(out), json.dumps(info))
        return
    if a.tiles:
        tiles = build_tiles(a.date)
        out = os.path.join(a.out_dir, 'stars-tiles.json')
        size = write_json(out, tiles, ascii_only=False)
        print('wrote', out, round(size / 1e6, 2), 'MB', len(tiles['tiles']), 'tiles', len(tiles['namedStars']), 'names')
        return
    data = build(a.date, a.gmax)
    out = os.path.join(a.out_dir, 'stars.json')
    size = write_json(out, data)
    print('wrote', out, round(size / 1e6, 2), 'MB')
    print(json.dumps(data['meta']['counts'], indent=1))


if __name__ == '__main__':
    main()
