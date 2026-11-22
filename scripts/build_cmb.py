import argparse
import base64
import io
import json
import math
import os

import ducc0
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.cosmology import Planck18
from astropy.io import fits
import astropy.units as u
from PIL import Image

W, H = 2048, 1024
LW, LH = 1024, 512
MJD_BASE = 60970.0
NTHREADS = 4


def read_alm(path):
    table = fits.open(path)[1].data
    index = table['index'].astype(np.int64) - 1
    ell = np.floor(np.sqrt(index)).astype(np.int64)
    m = index - ell * ell - ell
    lmax = int(ell.max())
    packed = np.zeros((lmax + 1) * (lmax + 2) // 2, dtype=np.complex128)
    packed[m * (2 * lmax + 1 - m) // 2 + ell] = table['real'] + 1j * table['imag']
    return packed, lmax


def ells_of(lmax):
    return np.concatenate([np.arange(m, lmax + 1) for m in range(lmax + 1)])


def truncate(alm, lmax_in, lmax_out):
    out = np.zeros((lmax_out + 1) * (lmax_out + 2) // 2, dtype=np.complex128)
    for m in range(lmax_out + 1):
        src = m * (2 * lmax_in + 1 - m) // 2
        dst = m * (2 * lmax_out + 1 - m) // 2
        out[dst + m:dst + lmax_out + 1] = alm[src + m:src + lmax_out + 1]
    return out


def grid_synthesis(alm, lmax, ntheta, nphi):
    return ducc0.sht.synthesis_2d(alm=alm[None, :], spin=0, lmax=lmax, geometry='F1', ntheta=ntheta, nphi=nphi, nthreads=NTHREADS)[0]


def grid_gradient(alm, lmax, ntheta, nphi):
    return ducc0.sht.synthesis_2d_deriv1(alm=alm[None, :], lmax=lmax, geometry='F1', ntheta=ntheta, nphi=nphi, nthreads=NTHREADS)


def healpix_ring(values, ordering):
    nside = int(round(math.sqrt(values.size / 12)))
    if ordering.upper().startswith('NEST'):
        base = ducc0.healpix.Healpix_Base(nside, 'RING')
        values = values[base.ring2nest(np.arange(values.size))]
    return values, nside


def map2alm(values, nside, lmax):
    base = ducc0.healpix.Healpix_Base(nside, 'RING')
    geom = base.sht_info()
    return ducc0.sht.pseudo_analysis(map=values[None, :].astype(np.float64), lmax=lmax, spin=0, nthreads=NTHREADS, maxiter=10, epsilon=1e-6, **geom)[0][0]


def sample_healpix(values, nside, ntheta, nphi):
    base = ducc0.healpix.Healpix_Base(nside, 'RING')
    theta = (np.arange(ntheta) + 0.5) * np.pi / ntheta
    phi = np.arange(nphi) * 2 * np.pi / nphi
    tt, pp = np.meshgrid(theta, phi, indexing='ij')
    pix = base.ang2pix(np.stack([tt.ravel(), pp.ravel()], axis=1))
    return values[pix].reshape(ntheta, nphi)


def blur(grid, sigma_px):
    radius = int(3 * sigma_px)
    x = np.arange(-radius, radius + 1)
    kernel = np.exp(-0.5 * (x / sigma_px) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([grid[:, -radius:], grid, grid[:, :radius]], axis=1)
    rows = np.stack([np.convolve(r, kernel, mode='valid') for r in padded])
    padded = np.concatenate([np.repeat(rows[:1], radius, 0), rows, np.repeat(rows[-1:], radius, 0)], axis=0)
    return np.stack([np.convolve(c, kernel, mode='valid') for c in padded.T]).T


def gauss_beam(lmax, fwhm_arcmin):
    sigma = math.radians(fwhm_arcmin / 60) / math.sqrt(8 * math.log(2))
    ell = np.arange(lmax + 1)
    return np.exp(-0.5 * ell * (ell + 1) * sigma * sigma)


def apply_ell(alm, lmax, factor):
    return alm * factor[ells_of(lmax)]


def quantise(values, scale):
    return np.clip(np.round(128 + values / scale), 0, 255).astype(np.uint8)


def png_bytes(rgb):
    buf = io.BytesIO()
    Image.fromarray(rgb, 'RGB').save(buf, format='PNG', optimize=True, compress_level=9)
    return buf.getvalue()


def theta500_arcmin(m500_1e14, z):
    rho = Planck18.critical_density(z).to(u.Msun / u.Mpc ** 3).value
    r500 = (3 * m500_1e14 * 1e14 / (4 * np.pi * 500 * rho)) ** (1 / 3)
    return np.degrees(r500 / Planck18.angular_diameter_distance(z).to(u.Mpc).value) * 60


def main():
    ap = argparse.ArgumentParser(description='Build the dark-matter mode assets: CMB temperature, lensing deflection and kappa textures, ACT clusters, Rubin SN-like alerts and the test results.')
    ap.add_argument('--smica', required=True, help='Planck SMICA map, e.g. COM_CMB_IQU-smica_1024_R2.02_full.fits')
    ap.add_argument('--klm', required=True, help='Planck PR4 lensing klm, e.g. PR42018like_klm_dat_MV.fits')
    ap.add_argument('--mask', required=True, help='Planck PR4 lensing mask, mask.fits.gz')
    ap.add_argument('--act', required=True, help='ACT DR5 cluster catalogue, DR5_cluster-catalog_v1.1.fits')
    ap.add_argument('--objects', required=True, help='SN-like object table (npz with ra, dec, first_mjd)')
    ap.add_argument('--lensing', required=True, help='lensing test result json')
    ap.add_argument('--control', required=True, help='ACT positive-control lensing result json')
    ap.add_argument('--cluster-test', required=True, help='cluster SN-excess result json')
    ap.add_argument('--cluster-forecast', required=True, help='cluster forecast json')
    ap.add_argument('--out-dir', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'data'))
    args = ap.parse_args()

    smica = fits.open(args.smica)[1]
    order = smica.header.get('ORDERING', 'RING')
    t_map, t_nside = healpix_ring(np.asarray(smica.data['I_STOKES'], float).ravel() * 1e6, order)
    t_mask, _ = healpix_ring(np.asarray(smica.data['TMASK'], float).ravel(), order)
    t_lmax = 1500
    t_alm = map2alm(t_map, t_nside, t_lmax)
    ell = np.arange(t_lmax + 1)
    t_alm = apply_ell(t_alm, t_lmax, gauss_beam(t_lmax, 12.0) * (ell >= 2))
    t_grid = grid_synthesis(t_alm, t_lmax, H, W)
    t_scale = float(np.percentile(np.abs(t_grid), 99.7) / 127)
    t_mask_grid = sample_healpix(t_mask, t_nside, H, W)

    k_alm, k_lmax = read_alm(args.klm)
    lcut = 400
    k_alm = truncate(k_alm, k_lmax, lcut)
    ell = np.arange(lcut + 1)
    taper = np.where(ell < 2, 0, 1.0) * np.where(ell > 300, np.cos((ell - 300) / 100 * np.pi / 2) ** 2, 1.0)
    phi_factor = np.where(ell >= 2, 2.0 / np.maximum(ell * (ell + 1), 1), 0) * taper
    phi_alm = apply_ell(k_alm, lcut, phi_factor)
    d_theta, d_phi = grid_gradient(phi_alm, lcut, LH, LW)
    d_theta = np.degrees(d_theta) * 60
    d_phi = np.degrees(d_phi) * 60
    kappa = grid_synthesis(apply_ell(k_alm, lcut, gauss_beam(lcut, 90.0) * taper), lcut, LH, LW)

    mask_hdu = fits.open(args.mask)[1]
    m_values = np.asarray(mask_hdu.data.field(0), float).ravel()
    m_ring, m_nside = healpix_ring(m_values, mask_hdu.header.get('ORDERING', 'RING'))
    k_mask = sample_healpix(m_ring, m_nside, LH, LW)

    good = k_mask > 0.5
    soft = np.clip(blur(good.astype(float), 6.0) * 2 - 1, 0, 1) * good
    soft_big = np.asarray(Image.fromarray((soft * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR))
    d_rms = float(np.sqrt(np.mean((d_theta[good] ** 2 + d_phi[good] ** 2))))
    d_scale = float(np.percentile(np.abs(np.concatenate([d_theta[good], d_phi[good]])), 99.8) / 127)
    k_scale = float(np.percentile(np.abs(kappa[good]), 99.5) / 127)

    sky = np.zeros((H, W, 3), np.uint8)
    sky[..., 0] = quantise(t_grid, t_scale)
    sky[..., 1] = np.where(t_mask_grid > 0.5, 255, 0)
    sky[..., 2] = soft_big
    lens = np.zeros((LH, LW, 3), np.uint8)
    lens[..., 0] = quantise(d_theta * soft, d_scale)
    lens[..., 1] = quantise(d_phi * soft, d_scale)
    lens[..., 2] = np.where(good, quantise(kappa, k_scale), 0)
    os.makedirs(args.out_dir, exist_ok=True)
    sky_png, lens_png = png_bytes(sky), png_bytes(lens)
    open(os.path.join(args.out_dir, 'cmb-sky.png'), 'wb').write(sky_png)
    open(os.path.join(args.out_dir, 'cmb-lens.png'), 'wb').write(lens_png)

    act = fits.open(args.act)[1].data
    c_ra, c_dec = np.asarray(act['RADeg'], float), np.asarray(act['decDeg'], float)
    c_z, c_m = np.asarray(act['redshift'], float), np.asarray(act['M500cCal'], float)
    c_theta = theta500_arcmin(c_m, c_z)
    c_gal = SkyCoord(c_ra * u.deg, c_dec * u.deg, frame='icrs').galactic
    test = json.load(open(args.cluster_test))
    counts = {}
    for mem in test['members']:
        counts[mem['cluster']] = counts.get(mem['cluster'], 0) + 1
    names = [str(n).strip() for n in act['name']]
    clusters = {
        'name': names, 'l': np.round(c_gal.l.deg, 3).tolist(), 'b': np.round(c_gal.b.deg, 3).tolist(),
        'ra': np.round(c_ra, 3).tolist(), 'dec': np.round(c_dec, 3).tolist(), 'z': np.round(c_z, 3).tolist(),
        'm500': np.round(c_m, 2).tolist(), 'theta500': np.round(c_theta, 2).tolist(), 'inside': [counts.get(n, 0) for n in names],
    }

    obj = np.load(args.objects, allow_pickle=False)
    o_ra, o_dec, o_t = np.asarray(obj['ra'], float), np.asarray(obj['dec'], float), np.asarray(obj['first_mjd'], float)
    keep = np.isfinite(o_ra) & np.isfinite(o_dec) & np.isfinite(o_t)
    o_gal = SkyCoord(o_ra[keep] * u.deg, o_dec[keep] * u.deg, frame='icrs').galactic
    order_t = np.argsort(o_t[keep])
    lq = np.round(o_gal.l.deg[order_t] / 360 * 65535).astype(np.uint16)
    bq = np.round((o_gal.b.deg[order_t] + 90) / 180 * 65535).astype(np.uint16)
    tq = np.round((o_t[keep][order_t] - MJD_BASE) * 100).astype(np.uint16)
    packed = np.stack([lq, bq, tq], axis=1).astype('<u2').tobytes()

    lens_test = json.load(open(args.lensing))
    control = json.load(open(args.control))
    fc = json.load(open(args.cluster_forecast))
    sig_null = float(lens_test['null_sigma'])
    nulls = [round((v - lens_test['null_mean']) / sig_null, 3) for v in lens_test['null_values']]
    out = {
        'meta': {
            'built': '2026-11-22', 'mjdBase': MJD_BASE, 'width': W, 'height': H, 'lensWidth': LW, 'lensHeight': LH,
            'coords': 'Galactic, equirectangular: column j at l = 360 j / width, row i at b = 90 - 180 (i + 0.5) / height',
            'tScaleMicroK': round(t_scale, 4), 'tSmoothingArcmin': 12.0, 'tLmax': t_lmax,
            'deflectionScaleArcmin': round(d_scale, 5), 'deflectionRmsArcmin': round(d_rms, 3), 'kappaScale': round(k_scale, 7),
            'kappaLmax': lcut, 'kappaSmoothingArcmin': 90.0,
            'channels': {'cmb-sky.png': 'R: CMB temperature (128 + T / tScaleMicroK), G: SMICA confidence mask, B: PR4 lensing mask, apodised over about 2 degrees',
                         'cmb-lens.png': 'R: deflection along theta (south), G: deflection along phi (east), both 128 + d / deflectionScaleArcmin; B: kappa (128 + kappa / kappaScale), 0 where masked'},
            'sources': ['Planck PR2 SMICA CMB map (COM_CMB_IQU-smica_1024_R2.02_full), ESA Planck Legacy Archive via IRSA',
                        'Planck PR4 CMB lensing reconstruction (PR42018like MV klm and mask), Carron, Mirmelstein and Lewis 2022',
                        'ACT DR5 SZ cluster catalogue v1.1 (Hilton et al. 2021), NASA LAMBDA',
                        'Fink LSST broker, tag most_likely_sn'],
        },
        'clusters': clusters,
        'alerts': {'n': int(len(tq)), 'encoding': 'little-endian uint16 triples: l * 65535 / 360, (b + 90) * 65535 / 180, (first MJD - mjdBase) * 100', 'data': base64.b64encode(packed).decode()},
        'lensing': {
            'sigma': round(float(lens_test['significance_sigma']), 3), 'bias': round(float(lens_test['bias_estimate']), 2),
            'biasSigma': round(float(lens_test['bias_sigma']), 2), 'nObjects': int(lens_test['n_objects_used']),
            'areaDeg2': round(float(lens_test['footprint_area_deg2_approx'])), 'nulls': nulls,
            'controlSigma': round(float(control['significance_sigma']), 2), 'controlBias': round(float(control['bias_estimate']), 2),
            'controlBiasSigma': round(float(control['bias_sigma']), 2), 'forecast': '3 sigma expected around late 2027, once Rubin\'s wide survey fills the southern footprint',
        },
        'clusterTest': {
            'observed': int(test['observed_inside_r500']), 'expected': round(float(test['expected_from_annulus']), 1),
            'sigma': round(float(test['excess']) / float(test['excess_sigma_bootstrap']), 2), 'excessSigma': round(float(test['excess_sigma_bootstrap']), 1),
            'clusters': int(test['clusters_with_coverage']), 'yearsTo3Sigma': round(float(fc['years_to_3sigma']), 2),
            'forecast': '3 sigma expected around mid-2028',
        },
    }
    with open(os.path.join(args.out_dir, 'cmb.json'), 'w', encoding='ascii') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=True)
    print('cmb-sky.png', len(sky_png), 'cmb-lens.png', len(lens_png), 'cmb.json', os.path.getsize(os.path.join(args.out_dir, 'cmb.json')))
    print('T scale', t_scale, 'deflection rms arcmin', d_rms, 'scale', d_scale, 'kappa scale', k_scale)


if __name__ == '__main__':
    main()
