const RAD = Math.PI / 180;
const MJD_TO_JD = 2400000.5;

export function gmst(mjd) {
  const d = mjd + MJD_TO_JD - 2451545.0;
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
}

export function sunRaDec(mjd) {
  const d = mjd + MJD_TO_JD - 2451545.0;
  const L = (((280.460 + 0.9856474 * d) % 360) + 360) % 360 * RAD;
  const g = (((357.528 + 0.9856003 * d) % 360) + 360) % 360 * RAD;
  const lam = L + 1.915 * RAD * Math.sin(g) + 0.020 * RAD * Math.sin(2 * g);
  const eps = (23.439 - 0.0000004 * d) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
  return [((ra % 360) + 360) % 360, Math.asin(Math.sin(eps) * Math.sin(lam)) / RAD];
}

export function altitude(ra, dec, lat, lonEast, mjd) {
  const h = (gmst(mjd) + lonEast - ra) * RAD, la = lat * RAD, de = dec * RAD;
  return Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(h)) / RAD;
}

export function nightStart(nowMjd, lonEast) {
  const local = nowMjd + lonEast / 360;
  const noon = Math.floor(local - 0.5) + 0.5;
  return noon - lonEast / 360;
}

export function night(ra, dec, lat, lonEast, startMjd, { minAlt = 30, maxSun = -12, step = 10 } = {}) {
  const n = Math.round(1440 / step), alt = new Float32Array(n), sun = new Float32Array(n);
  let hours = 0, best = -90, bestAt = startMjd;
  for (let k = 0; k < n; k++) {
    const t = startMjd + k * step / 1440;
    const [sr, sd] = sunRaDec(t);
    sun[k] = altitude(sr, sd, lat, lonEast, t);
    alt[k] = ra == null ? 0 : altitude(ra, dec, lat, lonEast, t);
    if (sun[k] < maxSun) {
      if (alt[k] > minAlt) hours += step / 60;
      if (alt[k] > best) { best = alt[k]; bestAt = t; }
    }
  }
  return { hours, alt, sun, step, start: startMjd, best, bestAt, dark: sun.some((v) => v < maxSun) };
}
