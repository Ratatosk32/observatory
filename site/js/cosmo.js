export const KM_PER_LY = 9.4607e12;
export const KM_PER_AU = 1.495979e8;
export const KM_PER_PC = 3.0857e13;

const H0 = 70, OM = 0.3, OR = 8.4e-5, OL = 1 - OM - OR, STEPS = 64;
const HUBBLE_GYR = 977.792 / H0;
const HUBBLE_GLY = (299792.458 / H0) * 3.26156e-3;
const E = (z) => Math.sqrt(OM * (1 + z) ** 3 + OR * (1 + z) ** 4 + OL);

const cache = new Map();
function integrals(z) {
  if (!(z > 0)) return [0, 0];
  const hit = cache.get(z);
  if (hit) return hit;
  const xb = Math.log1p(z), dx = xb / STEPS;
  let lb = 0, cm = 0;
  for (let k = 0; k < STEPS; k++) {
    const zz = Math.expm1((k + 0.5) * dx), e = E(zz);
    lb += dx / e;
    cm += (dx * (1 + zz)) / e;
  }
  const out = [lb * HUBBLE_GYR, cm * HUBBLE_GLY];
  if (cache.size > 4096) cache.clear();
  cache.set(z, out);
  return out;
}

export const lookbackGyr = (z) => integrals(z)[0];
export const comovingGly = (z) => integrals(z)[1];
export const comovingLy = (z) => integrals(z)[1] * 1e9;
export function zOfLookback(gyr) {
  let lo = 0, hi = 1100;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (lookbackGyr(m) < gyr) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
export const kmOfLy = (ly) => ly * KM_PER_LY;
export const kmOfGyr = (gyr) => gyr * 1e9 * KM_PER_LY;
export const cosmo = { H0, Om: OM, Or: OR, lookbackGyr, comovingGly, comovingLy, zOfLookback, KM_PER_LY, KM_PER_AU, KM_PER_PC };
