import argparse
import os

import numpy as np
from astropy.cosmology import Planck18
from astropy.io import fits
import astropy.units as u

HERE = os.path.dirname(os.path.abspath(__file__))


def theta500_arcmin(m500_1e14, z):
    rho = Planck18.critical_density(z).to(u.Msun / u.Mpc ** 3).value
    r500 = (3 * m500_1e14 * 1e14 / (4 * np.pi * 500 * rho)) ** (1 / 3)
    return np.degrees(r500 / Planck18.angular_diameter_distance(z).to(u.Mpc).value) * 60


def catalogue(path, mass_column):
    t = fits.open(path)[1].data
    ra, dec = np.asarray(t['RADeg'], float), np.asarray(t['decDeg'], float)
    z, m = np.asarray(t['redshift'], float), np.asarray(t[mass_column], float)
    names = np.array([str(n).strip().replace('ACT-CL ', '') for n in t['name']])
    good = np.isfinite(ra) & np.isfinite(dec) & np.isfinite(z) & (z > 0) & np.isfinite(m) & (m > 0)
    theta = theta500_arcmin(m[good], z[good])
    return ra[good], dec[good], z[good], m[good], theta, names[good]


def main():
    ap = argparse.ArgumentParser(description='Add the ACT DR5 and DR6 cluster catalogues and the TNS and tag flags to dm_inputs.npz (run once, locally; needs astropy).')
    ap.add_argument('--inputs', default=os.path.join(HERE, 'ci-data', 'dm_inputs.npz'))
    ap.add_argument('--act5', required=True, help='DR5_cluster-catalog_v1.1.fits')
    ap.add_argument('--act6', required=True, help='DR6_cluster-catalog_v1.0.fits')
    ap.add_argument('--objects', required=True, help='objects.npz with tag_matrix, tns_type and tns_z')
    a = ap.parse_args()
    old = dict(np.load(a.inputs))
    out = {k: v for k, v in old.items() if not k.startswith(('act5_', 'act6_', 'tns_'))}
    for label, path, col in (('act5', a.act5, 'M500cCal'), ('act6', a.act6, 'M500c')):
        ra, dec, z, m, theta, names = catalogue(path, col)
        out[f'{label}_ra'], out[f'{label}_dec'], out[f'{label}_theta'] = ra.astype(np.float32), dec.astype(np.float32), theta.astype(np.float32)
        if label == 'act6':
            out['act6_z'], out['act6_m500'] = z.astype(np.float32), m.astype(np.float32)
            out['act6_names'] = np.array('|'.join(names))
        print(label, ra.size, 'clusters')
    ids = np.cumsum(old['ids_diff'])
    obj = np.load(a.objects, allow_pickle=False)
    tags = [str(t) for t in obj['tag_names']]
    pos = {int(i): k for k, i in enumerate(obj['ids'])}
    src = np.array([pos.get(int(i), -1) for i in ids])
    ok = src >= 0
    flags = old['flags'] & 3
    tm = obj['tag_matrix']
    flags[ok] |= (tm[src[ok], tags.index('in_tns')].astype(np.uint8) << 2) | (tm[src[ok], tags.index('extragalactic_new_candidate')].astype(np.uint8) << 3)
    out['flags'] = flags.astype(np.uint8)
    tt = np.where(ok, obj['tns_type'][np.maximum(src, 0)], '')
    has = np.flatnonzero(np.char.str_len(tt.astype(str)) > 0)
    out['tns_idx'] = has.astype(np.int32)
    out['tns_type'] = tt[has].astype('<U14')
    out['tns_z'] = np.where(ok[has], obj['tns_z'][np.maximum(src[has], 0)], np.nan).astype(np.float32)
    np.savez_compressed(a.inputs, **out)
    print('wrote', a.inputs, os.path.getsize(a.inputs), 'bytes;', has.size, 'TNS-typed objects;', int(((flags >> 2) & 1).sum()), 'in_tns')


if __name__ == '__main__':
    main()
