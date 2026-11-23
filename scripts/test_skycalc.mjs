import { night } from '../site/js/skycalc.js';

const TARGETS = [
  ["SN 2026acxa", 315.62612, -19.46165],
  ["AT 2026adgn", 330.94293, -11.13265],
  ["SN 2026plb", 314.19693, -18.51796],
  ["AT 2026afrf", 339.08089, -10.14842],
  ["AT 2026aeyz", 320.08592, -13.05274],
  ["SN 2026ahjd", 339.67225, -10.27917],
  ["AT 2026agvo", 331.73506, -10.65099],
  ["SN 2026afjj", 352.06126, -10.68985],
];
const SITES = [
  ["La Serena", -29.9, -71.25, 8, [2.1667, 3.0, 2.1667, 3.5, 2.3333, 3.5, 3.0, 4.3333]],
  ["Sydney", -33.9, 151.2, 8, [2.1667, 2.8333, 2.0, 3.3333, 2.1667, 3.3333, 2.8333, 4.1667]],
  ["Austin", 30.3, -97.7, 8, [1.8333, 3.5, 1.8333, 4.1667, 2.6667, 4.1667, 3.6667, 5.0]],
  ["Madrid", 40.4, -3.7, 6, [0.0, 3.0, 0.5, 3.6667, 2.0, 3.6667, 3.0, 4.3333]],
  ["London", 51.5, -0.1, 0, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]],
];

let bad = 0;
for (const [site, lat, lon, expected, pyHours] of SITES) {
  const start = 61358 + 0.5 - lon / 360;
  const hours = TARGETS.map(([, ra, dec]) => night(ra, dec, lat, lon, start).hours);
  const worst = Math.max(...hours.map((h, k) => Math.abs(h - pyHours[k])));
  const count = hours.filter((h) => h >= 1).length;
  const ok = count === expected && worst <= 10 / 60 + 1e-9;
  if (!ok) bad++;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${site}: ${count}/${TARGETS.length} observable (expected ${expected}), worst difference ${(worst * 60).toFixed(0)} min\n`);
}
if (bad) process.exit(1);
