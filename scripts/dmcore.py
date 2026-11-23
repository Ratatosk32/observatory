import numpy as np

GAL = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
                [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
                [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]])


def ang2pix_ring(nside, theta, phi):
    theta = np.asarray(theta, float)
    phi = np.asarray(phi, float)
    z = np.cos(theta)
    za = np.abs(z)
    tt = np.mod(phi, 2 * np.pi) * (2 / np.pi)
    tt = np.where(tt >= 4.0, 0.0, tt)
    pix = np.empty(z.shape, dtype=np.int64)
    eq = za <= 2.0 / 3.0
    if eq.any():
        t1 = nside * (0.5 + tt[eq])
        t2 = nside * z[eq] * 0.75
        jp = np.floor(t1 - t2).astype(np.int64)
        jm = np.floor(t1 + t2).astype(np.int64)
        ir = nside + 1 + jp - jm
        kshift = 1 - (ir & 1)
        ip = (jp + jm - nside + kshift + 1) // 2
        ip = np.mod(ip, 4 * nside)
        pix[eq] = 2 * nside * (nside - 1) + (ir - 1) * 4 * nside + ip
    pol = ~eq
    if pol.any():
        ttp = tt[pol]
        tp = ttp - np.floor(ttp)
        tmp = nside * np.sqrt(3 * (1 - za[pol]))
        jp = np.floor(tp * tmp).astype(np.int64)
        jm = np.floor((1 - tp) * tmp).astype(np.int64)
        ir = jp + jm + 1
        ip = np.floor(ttp * ir).astype(np.int64)
        ip = np.mod(ip, 4 * ir)
        north = z[pol] > 0
        pix[pol] = np.where(north, 2 * ir * (ir - 1) + ip, 12 * nside * nside - 2 * ir * (ir + 1) + ip)
    return pix


def unit(ra, dec):
    r, d = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)])


def galactic(ra, dec):
    g = GAL @ unit(ra, dec)
    return np.degrees(np.arctan2(g[1], g[0])) % 360, np.degrees(np.arcsin(np.clip(g[2], -1, 1)))


def equatorial(l, b):
    v = GAL.T @ unit(l, b)
    return np.degrees(np.arctan2(v[1], v[0])) % 360, np.degrees(np.arcsin(np.clip(v[2], -1, 1)))


def galactic_pixels(nside, ra, dec):
    l, b = galactic(ra, dec)
    return ang2pix_ring(nside, np.radians(90 - b), np.radians(l))


def lensing_meter(kappa, mask, nside, ra, dec, starlike, unit_bias, rotations=300, seed=20261122, min_abs_b=20.0):
    _, b = galactic(ra, dec)
    keep = mask[galactic_pixels(nside, ra, dec)] & (np.abs(b) > min_abs_b) & ~starlike
    rk, dk = ra[keep], dec[keep]
    measured = float(kappa[galactic_pixels(nside, rk, dk)].mean())
    shifts = np.random.default_rng(seed).uniform(15, 345, rotations)
    null = []
    for s in shifts:
        r2 = (rk + s) % 360
        pix = galactic_pixels(nside, r2, dk)
        inside = mask[pix]
        null.append(float(kappa[pix[inside]].mean()))
    null = np.array(null)
    nmean, nsig = float(null.mean()), float(null.std())
    cells = np.unique(ang2pix_ring(64, np.radians(90 - dk), np.radians(rk)))
    area = cells.size * 4 * np.pi / (12 * 64 * 64) * (180 / np.pi) ** 2
    return {
        'n': int(keep.sum()), 'area': float(area), 'sigma': (measured - nmean) / nsig,
        'bias': (measured - nmean) / unit_bias, 'biasSigma': nsig / unit_bias,
        'nulls': ((null - nmean) / nsig).tolist(),
    }


def cluster_meter(c_ra, c_dec, c_theta, o_ra, o_dec, inner=1.0, ann_in=3.0, ann_out=6.0, min_abs_b=20.0, bootstrap=2000, seed=7):
    _, b = galactic(o_ra, o_dec)
    keep = np.abs(b) > min_abs_b
    o_ra, o_dec = o_ra[keep], o_dec[keep]
    order = np.argsort(o_dec)
    o_ra, o_dec = o_ra[order], o_dec[order]
    ov = unit(o_ra, o_dec)
    nc = c_ra.size
    inner_counts = np.zeros(nc, np.int64)
    ann_counts = np.zeros(nc, np.int64)
    cv = unit(c_ra, c_dec)
    for i in range(nc):
        rmax = ann_out * c_theta[i] / 60.0
        lo, hi = np.searchsorted(o_dec, [c_dec[i] - rmax, c_dec[i] + rmax])
        if hi <= lo:
            continue
        cosang = np.clip(cv[:, i] @ ov[:, lo:hi], -1, 1)
        sep = np.degrees(np.arccos(cosang)) * 60.0 / c_theta[i]
        inner_counts[i] = int((sep < inner).sum())
        ann_counts[i] = int(((sep >= ann_in) & (sep < ann_out)).sum())
    ratio = inner ** 2 / (ann_out ** 2 - ann_in ** 2)
    covered = (inner_counts + ann_counts) > 0
    observed = int(inner_counts[covered].sum())
    expected = float(ann_counts[covered].sum() * ratio)
    rng = np.random.default_rng(seed)
    idx = np.flatnonzero(covered)
    boot = np.array([inner_counts[d].sum() - ann_counts[d].sum() * ratio for d in (rng.choice(idx, idx.size) for _ in range(bootstrap))]) if idx.size else np.zeros(1)
    sd = float(boot.std()) or 1.0
    return {'observed': observed, 'expected': expected, 'excess': observed - expected, 'excessSigma': sd,
            'sigma': (observed - expected) / sd, 'clusters': int(covered.sum()), 'inside': inner_counts.tolist(),
            'expect': (ann_counts * ratio).tolist(), 'covered': covered.tolist()}
