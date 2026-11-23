import argparse
import json
import os
import sys

import ducc0
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dmcore import ang2pix_ring

NSIDE = 256


def ring_to_nest(values, nside):
    base = ducc0.healpix.Healpix_Base(nside, 'RING')
    return values[base.nest2ring(np.arange(values.size))]


def nest_to_ring(values, nside):
    base = ducc0.healpix.Healpix_Base(nside, 'NEST')
    return values[base.ring2nest(np.arange(values.size))]


def degrade(values, nside_in, nside_out):
    factor = (nside_in // nside_out) ** 2
    nest = ring_to_nest(values, nside_in).reshape(-1, factor).mean(axis=1)
    return nest_to_ring(nest, nside_out)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='Build the compact inputs the nightly dark-matter refresh needs (run once, locally).')
    ap.add_argument('--kappa-wf', required=True, help='matched-filtered kappa map saved by lensing_cross.py --save_map (HEALPix RING)')
    ap.add_argument('--kappa', required=True, help='planck_pr4_kappa.npz with the lensing mask')
    ap.add_argument('--objects', required=True, help='SN-like object table (objects.npz, all tags)')
    ap.add_argument('--lensing', required=True, help='lensing test json from the same run (for the unit-bias normalisation)')
    ap.add_argument('--out', default=os.path.join(here, 'ci-data', 'dm_inputs.npz'))
    a = ap.parse_args()

    wf = np.load(a.kappa_wf)
    kappa = degrade(wf['kappa_wf'].astype(np.float64), int(wf['nside']), NSIDE)
    store = np.load(a.kappa)
    mask = degrade(store['mask'].astype(np.float64), int(store['mask_nside']), NSIDE) > 0.5

    base = ducc0.healpix.Healpix_Base(NSIDE, 'RING')
    rng = np.random.default_rng(1)
    theta, phi = np.arccos(rng.uniform(-1, 1, 200000)), rng.uniform(0, 2 * np.pi, 200000)
    ours = ang2pix_ring(NSIDE, theta, phi)
    ref = base.ang2pix(np.stack([theta, phi], axis=1))
    assert np.array_equal(ours, ref), 'numpy ang2pix_ring disagrees with ducc0'

    obj = np.load(a.objects, allow_pickle=False)
    names = [str(t) for t in obj['tag_names']]
    ms = obj['tag_matrix'][:, names.index('most_likely_sn')]
    pstar = obj['pstar']
    starlike = np.isfinite(pstar) & (pstar > 0.5)
    order = np.argsort(obj['ids'])
    ids = obj['ids'][order].astype(np.int64)
    flags = (ms[order].astype(np.uint8) | (starlike[order].astype(np.uint8) << 1))
    lens = json.load(open(a.lensing))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    np.savez_compressed(
        a.out, nside=NSIDE, kappa=kappa.astype(np.float16), mask=np.packbits(mask),
        ids_diff=np.diff(ids, prepend=0), ra=obj['ra'][order].astype(np.float32), dec=obj['dec'][order].astype(np.float32),
        first_mjd=obj['first_mjd'][order].astype(np.float64), flags=flags,
        unit_bias=np.float64(lens['expected_mean_for_unit_bias']), snapshot_mjd=np.float64(np.nanmax(obj['first_mjd'])),
    )
    print('wrote', a.out, os.path.getsize(a.out), 'bytes;', ids.size, 'objects;', int(ms.sum()), 'most_likely_sn; mask fsky', round(float(mask.mean()), 3))


if __name__ == '__main__':
    main()
