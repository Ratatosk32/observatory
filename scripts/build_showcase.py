import argparse
import base64
import datetime
import json
import math
import os
from collections import Counter

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ZP = 31.4
BANDS = 'ugrizy'
RARE_FIXED = {
    'TDE': 1.0, 'TDE-H-He': 1.0, 'SLSN-I': 1.0, 'SLSN-II': 1.0, 'kilonova': 1.0,
    'SN Ic-BL': 0.8, 'SN IIn': 0.7, 'SN Ibn': 0.8, 'SN Ia-SC': 0.8, 'SN Ia-91T-like': 0.6,
    'SN Ia-pec': 0.7, 'SN IIb': 0.6, 'SN Ib': 0.5, 'SN Ic': 0.5, 'SN Ib/c': 0.5,
    'CEP': 0.6, 'DCEP': 0.7, 'ACEP': 0.8, 'ACEPS:': 0.8, 'CWA': 0.7, 'CWB': 0.7,
    'UGWZ': 0.8, 'UGWZ:': 0.8, 'UGWZ+E': 0.8, 'Pu*': 0.9, 'WD*': 0.5,
}
STAR_W = {'rare': 1.0, 'outburst': 0.8, 'bright': 0.8, 'extreme': 0.9, 'spectrum': 0.6, 'odd': 0.9}
STAR_BITS = ['rare', 'outburst', 'bright', 'extreme', 'fresh', 'spectrum', 'odd', 'tonight']
FRESH_BOOST = 0.15
NORM = 1.90
GROUP_CAP = 0.4
FRESH_LANE = 0.2
FRESH_NIGHTS = 3
FAMILY_GROUP = {'rrlyr': 'puls', 'ceph': 'puls', 'dsct': 'puls', 'lpv': 'puls', 'ecl': 'bin', 'active': 'bin', 'yso': 'bin',
                'cv': 'bin', 'star': 'bin', 'sn': 'expl', 'sncand': 'expl', 'agn': 'bh', 'tde': 'bh', 'unk': 'unk'}
STELLAR = {'rrlyr', 'ceph', 'dsct', 'lpv', 'ecl', 'active', 'yso', 'star'}


def mag(flux):
    return ZP - 2.5 * math.log10(flux) if flux and flux > 0 else None


def fine_class(cat, fam):
    for p in ('TNS ', 'VSX ', 'SIMBAD '):
        if cat.startswith(p):
            return cat[len(p):]
    return fam


def combine(comp, weights, fresh):
    v = sorted((weights[k] * comp[k] for k in weights), reverse=True)
    base = v[0] + 0.5 * v[1] + 0.25 * v[2]
    return 100.0 * (base + FRESH_BOOST * fresh) / NORM


def select_rank(order, groups, fresh_ok, n_top, cap_frac=GROUP_CAP, lane_frac=FRESH_LANE):
    cap = int(cap_frac * n_top) if cap_frac else n_top
    lane = int(round(lane_frac * n_top))
    taken, top, gcount = set(), [], Counter()
    for i in [i for i in order if fresh_ok[i]][:lane]:
        top.append(i)
        taken.add(i)
        gcount[groups[i]] += 1
    for i in order:
        if len(top) >= n_top:
            break
        if i in taken or gcount[groups[i]] >= cap:
            continue
        top.append(i)
        taken.add(i)
        gcount[groups[i]] += 1
    pos = {i: k for k, i in enumerate(order)}
    top.sort(key=pos.get)
    return top + [i for i in order if i not in taken]


def stars_part(S, n_top=120):
    O, meta = S['objects'], S['meta']
    off = meta['mjdOffset']
    N = len(O['id'])
    fam_keys = [f['key'] for f in meta['families']]
    cats = meta['catTypes']
    t_ref = max(t for t in O['t1'] if t is not None)
    nights = sorted(n['mjd'] - off for n in S['nights'])
    recent_nights = [t for t in nights if t <= t_ref + 0.5][-FRESH_NIGHTS:]
    fresh_from = (recent_nights[0] - 0.5) if recent_nights else t_ref - FRESH_NIGHTS
    fam = [fam_keys[k] for k in O['fam']]
    fine = [fine_class(cats[O['catType'][i]], fam[i]) for i in range(N)]
    freq = Counter(fine)
    al = S['alerts']
    peak_gr = [None] * N
    for o, b, m in zip(al['o'], al['b'], al['m']):
        if m is not None and b in (1, 2) and (peak_gr[o] is None or m < peak_gr[o][0]):
            peak_gr[o] = (m, b)
    keys = list(STAR_W) + ['fresh']
    comp = {k: [0.0] * N for k in keys}
    facts = [dict() for _ in range(N)]
    for i in range(N):
        rare_freq = min(1.0, math.log10(N / freq[fine[i]]) / math.log10(N / 2))
        rare = max(RARE_FIXED.get(fine[i], 0.0), 0.0 if fam[i] in ('unk', 'sncand') else rare_freq * 0.7)
        if fam[i] == 'tde':
            rare = 1.0
        comp['rare'][i] = rare
        facts[i]['rareLabel'] = fine[i]
        facts[i]['rareOf'] = freq[fine[i]]
        amp = jump = 0.0
        jump_days = None
        lc = O['lc'][i]
        if lc is not None and lc >= 0:
            L = S['lcs'][lc]
            by_band = {}
            for t, b, s in zip(L['t'], L['b'], L['s']):
                m = mag(s)
                if m is not None:
                    by_band.setdefault(b, []).append((t, m))
            for pts in by_band.values():
                ms = sorted(m for _, m in pts)
                if len(ms) >= 4:
                    amp = max(amp, ms[min(len(ms) - 1, int(0.95 * len(ms)))] - ms[max(0, int(0.05 * len(ms)))])
                per_night = {}
                for t, m in sorted(pts):
                    per_night.setdefault(math.floor(t), []).append(m)
                ks = sorted(per_night)
                for a, c in zip(ks, ks[1:]):
                    if c - a <= 3:
                        d = min(per_night[a]) - min(per_night[c])
                        if d > jump:
                            jump, jump_days = d, c - a
        facts[i]['amp'] = round(amp, 2)
        facts[i]['jump'] = round(jump, 2)
        facts[i]['jumpDays'] = jump_days
        comp['outburst'][i] = min(1.0, max(amp / 3.0, jump / 2.0))
        mm = O['meanMag'][i]
        if fam[i] in STELLAR:
            gr = [(m, b) for b, m in enumerate(mm) if m is not None and b in (1, 2)]
            reach, rband = min(gr) if gr else (None, None)
        else:
            reach, rband = peak_gr[i] if peak_gr[i] else (None, None)
        facts[i]['reach'] = None if reach is None else round(reach, 1)
        facts[i]['reachBand'] = None if rband is None else BANDS[rband]
        comp['bright'][i] = 0.0 if reach is None else max(0.0, min(1.0, (20.0 - reach) / 3.0))
        cat = cats[O['catType'][i]]
        name = O['name'][i]
        comp['spectrum'][i] = 1.0 if cat.startswith('TNS ') else (0.4 if name.startswith('AT ') else 0.0)
        odd, why_odd = 0.0, None
        sd = O['sdssClass'][i]
        if sd == 'QSO' and fam[i] in ('sncand', 'unk', 'sn'):
            odd, why_odd = 1.0, 'qso'
        if sd == 'STAR' and fam[i] in ('sncand', 'sn', 'agn'):
            odd, why_odd = 1.0, 'star'
        if 'mdwarf_flare' in cat and ('sn_near_galaxy' in cat or 'extragalactic' in cat) and odd < 0.7:
            odd, why_odd = 0.7, 'tags'
        comp['odd'][i] = odd
        facts[i]['odd'] = why_odd
        t1 = O['t1'][i]
        age = t_ref - t1 if t1 is not None else 999.0
        comp['fresh'][i] = math.exp(-max(0.0, age) / 7.0)

    def top_rank(values, k, reverse=True):
        idx = [i for i in range(N) if values[i] is not None]
        idx.sort(key=lambda i: (-values[i] if reverse else values[i], O['id'][i]))
        return {i: (max(0.0, 1.0 - r / k), r + 1) for r, i in enumerate(idx[:k])}

    far = top_rank([O['dist'][i] if O['distMethod'][i] >= 0 else None for i in range(N)], 40)
    near = top_rank([O['dist'][i] if O['distMethod'][i] == 0 else None for i in range(N)], 20, reverse=False)
    fast = top_rank([O['period'][i] for i in range(N)], 20, reverse=False)
    for i in range(N):
        best = max((far.get(i, (0, 0)) + ('farthest',), near.get(i, (0, 0)) + ('nearest',), fast.get(i, (0, 0)) + ('fastest',)), key=lambda x: x[0])
        comp['extreme'][i] = best[0]
        if best[0] > 0:
            facts[i]['extreme'], facts[i]['extremeRank'] = best[2], best[1]

    score = [combine({k: comp[k][i] for k in STAR_W}, STAR_W, comp['fresh'][i]) for i in range(N)]
    order = sorted(range(N), key=lambda i: (-round(score[i], 6), facts[i]['reach'] if facts[i]['reach'] is not None else 99.0, -(O['t1'][i] or 0.0), O['id'][i]))
    fresh_ok = [O['t1'][i] is not None and O['t1'][i] >= fresh_from for i in range(N)]
    rank = select_rank(order, [FAMILY_GROUP[f] for f in fam], fresh_ok, n_top)
    why = [sum(1 << n for n, k in enumerate(STAR_BITS) if k in comp and comp[k][i] >= 0.5) for i in range(N)]
    keep = sorted(rank[:3 * n_top])
    out_facts = {}
    for i in keep:
        f = {k: v for k, v in facts[i].items() if v is not None}
        f['c'] = [int(round(255 * comp[k][i])) for k in keys]
        out_facts[str(i)] = f
    return {
        'refNight': round(t_ref + off, 3), 'n': N, 'top': {'desktop': n_top, 'phone': n_top // 2, 'freshLane': int(round(FRESH_LANE * n_top))},
        'whyBits': STAR_BITS, 'components': keys, 'rank': rank, 'score': [int(round(x)) for x in score], 'why': why, 'facts': out_facts,
    }


AST_W = {'rare': 1.0, 'orbit': 0.9, 'approach': 1.0, 'extreme': 0.8}
AST_RARE = {'NEO': 1.0, 'MC': 0.6, 'HUN': 0.6, 'MBA': 0.0, 'CYB': 0.6, 'HIL': 0.7, 'TRO': 0.9, 'OTH': 0.7}
AST_NORM = 1.875
GK = 0.01720209895
EARTH = [1.00000261, 0.00000562, 0.01671123, -0.00004392, 102.93768193, 0.32327364, 100.46457166, 35999.37244981]


def kepler(M, e):
    E = np.where(e < 0.8, M, np.pi)
    for _ in range(30):
        E = E - (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    return E


def frame(node, peri, inc):
    w, W, i = np.radians(peri), np.radians(node), np.radians(inc)
    P = np.stack([np.cos(w) * np.cos(W) - np.sin(w) * np.sin(W) * np.cos(i), np.cos(w) * np.sin(W) + np.sin(w) * np.cos(W) * np.cos(i), np.sin(w) * np.sin(i)])
    Q = np.stack([-np.sin(w) * np.cos(W) - np.cos(w) * np.sin(W) * np.cos(i), -np.sin(w) * np.sin(W) + np.cos(w) * np.cos(W) * np.cos(i), np.cos(w) * np.sin(i)])
    return P, Q


def earth_at(t):
    T = (t - 51544.5) / 36525
    a, e = EARTH[0] + EARTH[1] * T, EARTH[2] + EARTH[3] * T
    wb, L = EARTH[4] + EARTH[5] * T, EARTH[6] + EARTH[7] * T
    E = kepler(np.radians(((L - wb) % 360 + 540) % 360 - 180), e)
    xp, yp = a * (np.cos(E) - e), a * np.sqrt(1 - e * e) * np.sin(E)
    c, s = np.cos(np.radians(wb)), np.sin(np.radians(wb))
    return np.array([c * xp - s * yp, s * xp + c * yp, 0.0])


def ellipse_points(a, e, P, Q, E):
    return np.outer(P, a * (np.cos(E) - e)) + np.outer(Q, a * np.sqrt(1 - e * e) * np.sin(E))


def moid(a, e, P, Q, ae, ee, Pe, Qe, n=360):
    E1 = np.linspace(0, 2 * np.pi, n, endpoint=False)
    d = np.linalg.norm(ellipse_points(a, e, P, Q, E1)[:, :, None] - ellipse_points(ae, ee, Pe, Qe, E1)[:, None, :], axis=0)
    i, j = np.unravel_index(np.argmin(d), d.shape)
    best, ca, cb = d[i, j], E1[i], E1[j]
    for step in (2 * np.pi / n, 2 * np.pi / n / 20):
        Ea, Eb = ca + np.linspace(-step, step, 41), cb + np.linspace(-step, step, 41)
        dd = np.linalg.norm(ellipse_points(a, e, P, Q, Ea)[:, :, None] - ellipse_points(ae, ee, Pe, Qe, Eb)[:, None, :], axis=0)
        p, q = np.unravel_index(np.argmin(dd), dd.shape)
        if dd[p, q] < best:
            best, ca, cb = dd[p, q], Ea[p], Eb[q]
    return float(best)


def h_of(o):
    H = o.get('H') or {}
    if 'r' in H:
        return H['r']
    v = sorted(H.values())
    return v[len(v) // 2] if v else None


def asteroid_part(A, n_top=100):
    objs = A['objs']
    N = len(objs)
    a, e, inc, node, peri, M0, ep = np.array([o['el'] for o in objs], float).T
    P, Q = frame(node, peri, inc)
    ref = A['meta']['tmax']
    best_d, best_t = np.full(N, np.inf), np.zeros(N)
    nmean = GK / a ** 1.5
    for t in np.arange(math.floor(ref) - 7, math.floor(ref) + 90.01, 0.5):
        E = kepler((M0 + nmean * (t - ep)) % (2 * np.pi), e)
        r = P * (a * (np.cos(E) - e)) + Q * (a * np.sqrt(1 - e * e) * np.sin(E))
        d = np.linalg.norm(r - earth_at(t)[:, None], axis=0)
        closer = d < best_d
        best_d[closer], best_t[closer] = d[closer], t
    T = (ref - 51544.5) / 36525
    ee = EARTH[2] + EARTH[3] * T
    Pe, Qe = frame(0.0, EARTH[4] + EARTH[5] * T, 0.0)
    cls = [o['c'] for o in objs]
    Hs = [h_of(o) for o in objs]
    moids, pha = {}, set()
    for k in range(N):
        if cls[k] in ('NEO', 'MC'):
            moids[k] = moid(a[k], e[k], P[:, k], Q[:, k], EARTH[0], ee, Pe, Qe)
            if cls[k] == 'NEO' and Hs[k] is not None and Hs[k] <= 22 and moids[k] <= 0.05:
                pha.add(k)
    comp = {c: [0.0] * N for c in list(AST_W) + ['fresh']}
    last = [max(d[0] for d in o['det']) + 60000 for o in objs]
    nights = sorted({math.floor(d[0] + 60000 - 0.5) for o in objs for d in o['det']})
    fresh_from = nights[-FRESH_NIGHTS] + 0.5 if len(nights) >= FRESH_NIGHTS else ref - FRESH_NIGHTS
    for k in range(N):
        comp['rare'][k] = 1.0 if k in pha else AST_RARE.get(cls[k], 0.7)
        comp['orbit'][k] = max(min(1.0, max(0.0, (e[k] - 0.25) / 0.25)), min(1.0, max(0.0, (inc[k] - 18) / 17)), 1.0 if inc[k] > 90 else 0.0)
        comp['approach'][k] = min(1.0, max(0.0, math.log10(0.5 / best_d[k]))) if best_d[k] > 0 else 1.0
        comp['fresh'][k] = math.exp(-max(0.0, ref - last[k]) / 7.0)

    def rank_of(values, K, reverse):
        idx = [k for k in range(N) if values[k] is not None]
        idx.sort(key=lambda k: (-values[k] if reverse else values[k], k))
        return {k: (max(0.0, 1.0 - r / K), r + 1) for r, k in enumerate(idx[:K])}

    big, small, seen = rank_of(Hs, 10, False), rank_of(Hs, 10, True), rank_of([o['nn'] for o in objs], 10, True)
    ext = {}
    for k in range(N):
        best = max((big.get(k, (0, 0)) + ('biggest',), small.get(k, (0, 0)) + ('smallest',), seen.get(k, (0, 0)) + ('mostSeen',)), key=lambda x: x[0])
        comp['extreme'][k] = best[0]
        if best[0] > 0:
            ext[k] = best
    score = [combine({c: comp[c][k] for c in AST_W}, AST_W, comp['fresh'][k]) * NORM / AST_NORM for k in range(N)]
    order = sorted(range(N), key=lambda k: (-round(score[k], 6), -objs[k]['nn'], k))
    fresh_ok = [last[k] >= fresh_from for k in range(N)]
    rank = select_rank(order, ['MBA' if c == 'MBA' else c for c in cls], fresh_ok, n_top)
    keys = list(AST_W) + ['fresh']
    facts = {}
    for k in sorted(rank[:3 * n_top]):
        f = {'c': [int(round(255 * comp[c][k])) for c in keys], 'last': round(last[k], 3)}
        if best_d[k] < 0.5:
            f['approachAU'], f['approachT'] = round(float(best_d[k]), 3), round(float(best_t[k]), 1)
        if k in moids:
            f['moid'] = round(moids[k], 4)
        if k in pha:
            f['pha'] = 1
        if k in ext:
            f['extreme'], f['extremeRank'] = ext[k][2], ext[k][1]
        facts[str(k)] = f
    return {'refNight': round(ref, 3), 'n': N, 'top': {'desktop': n_top, 'phone': n_top // 2, 'freshLane': int(round(FRESH_LANE * n_top))},
            'components': keys, 'rank': rank, 'score': [int(round(x)) for x in score], 'facts': facts}


DM_W = {'mass': 1.0, 'busy': 1.0, 'covered': 0.5}
DM_NORM = 1.775
DM_BUSY_SHARE = 0.3


def dm_part(D, n_top=120):
    cl = D['clusters']
    n = cl['n']
    raw = np.frombuffer(base64.b64decode(cl['data']), dtype='<u2').reshape(n, len(cl['fields'])).astype(float)
    col = {f: raw[:, k] / cl['scale'][k] - cl['offset'][k] for k, f in enumerate(cl['fields'])}
    tri = np.frombuffer(base64.b64decode(D['alerts']['data']), dtype='<u2').reshape(-1, 3).astype(float)
    a_t = D['meta']['mjdBase'] + tri[:, 2] / 100
    nights = np.unique(np.floor(a_t - 0.5))
    recent = nights[-FRESH_NIGHTS:]
    fresh_from = recent[0] + 0.5 if recent.size else a_t.max()
    sel = a_t >= fresh_from
    al, ab = np.radians(tri[sel, 0] / 65535 * 360), np.radians(tri[sel, 1] / 65535 * 180 - 90)
    av = np.stack([np.cos(ab) * np.cos(al), np.cos(ab) * np.sin(al), np.sin(ab)])
    cl_l, cl_b = np.radians(col['l']), np.radians(col['b'])
    cv = np.stack([np.cos(cl_b) * np.cos(cl_l), np.cos(cl_b) * np.sin(cl_l), np.sin(cl_b)], axis=1)
    fresh_t = np.zeros(n)
    if av.shape[1]:
        for s in range(0, n, 2000):
            sep = np.degrees(np.arccos(np.clip(cv[s:s + 2000] @ av, -1, 1))) * 60 / np.maximum(col['theta500'][s:s + 2000, None], 0.01)
            hit = sep < 1
            fresh_t[s:s + 2000] = np.where(hit.any(1), np.where(hit, a_t[sel][None, :], 0).max(1), 0)
    pct = np.argsort(np.argsort(col['m500'], kind='stable'), kind='stable') / max(1, n - 1)
    comp = {
        'mass': np.clip((pct - 0.9) / 0.1, 0, 1),
        'busy': np.clip((col['inside'] - col['expect']) / np.sqrt(col['expect'] + 1) / 3, 0, 1),
        'covered': ((col['inside'] + col['expect']) > 0).astype(float),
        'fresh': (fresh_t > 0).astype(float),
    }
    score = [combine({k: comp[k][i] for k in DM_W}, DM_W, comp['fresh'][i]) * NORM / DM_NORM for i in range(n)]
    order = sorted(range(n), key=lambda i: (-round(score[i], 6), -col['m500'][i], i))
    busy = [i for i in order if comp['busy'][i] > 0]
    need = min(len(busy), int(DM_BUSY_SHARE * n_top))
    top = busy[:need]
    taken = set(top)
    for i in order:
        if len(top) >= n_top:
            break
        if i not in taken:
            top.append(i)
            taken.add(i)
    pos = {i: k for k, i in enumerate(order)}
    top.sort(key=pos.get)
    rank = top + [i for i in order if i not in taken]
    keys = list(DM_W) + ['fresh']
    facts = {}
    for i in sorted(rank[:3 * n_top]):
        f = {'massPct': round(100 * (1 - pct[i]), 2), 'c': [int(round(255 * comp[k][i])) for k in keys]}
        if fresh_t[i]:
            f['freshT'] = round(float(fresh_t[i]), 3)
        facts[str(i)] = f
    return {'n': n, 'top': {'desktop': n_top, 'phone': n_top // 2}, 'components': keys, 'rank': rank,
            'score': [int(round(x)) for x in score], 'facts': facts}


def main():
    ap = argparse.ArgumentParser(description='Score every object for the showcase and write site/data/showcase.json.')
    ap.add_argument('--data', default=os.path.join(ROOT, 'site', 'data'))
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    out_path = a.out or os.path.join(a.data, 'showcase.json')
    modes = {}
    stars = json.load(open(os.path.join(a.data, 'stars.json'), encoding='utf-8'))
    modes['stars'] = stars_part(stars)
    ast_path = os.path.join(a.data, 'asteroids.json')
    if os.path.exists(ast_path):
        modes['asteroids'] = asteroid_part(json.load(open(ast_path, encoding='utf-8')))
    cmb_path = os.path.join(a.data, 'cmb.json')
    if os.path.exists(cmb_path):
        cmb = json.load(open(cmb_path, encoding='utf-8'))
        if 'data' in cmb.get('clusters', {}):
            modes['dm'] = dm_part(cmb)
    built = stars['meta'].get('updated') or stars['meta'].get('built') or datetime.date.today().isoformat()
    out = {'version': 1, 'built': built, 'modes': modes}
    body = json.dumps(out, separators=(',', ':'), ensure_ascii=True, sort_keys=False)
    with open(out_path, 'w', encoding='ascii') as fh:
        fh.write(body)
    s = modes['stars']
    d = modes.get('dm')
    ast = modes.get('asteroids')
    ast_note = f"; asteroids top {ast['top']['desktop']} cut score {ast['score'][ast['rank'][ast['top']['desktop'] - 1]]}" if ast else ''
    dm_note = ast_note + f"; dm top {d['top']['desktop']} cut score {d['score'][d['rank'][d['top']['desktop'] - 1]]}" if d else ''
    print(f"showcase: stars top {s['top']['desktop']} cut score {s['score'][s['rank'][s['top']['desktop'] - 1]]}{dm_note}, {len(body)} bytes")


if __name__ == '__main__':
    main()
