import { lookbackGyr, comovingGly, zOfLookback } from '../site/js/cosmo.js';

const CHECKS = [
  [0.1, 1.301, 1.365],
  [1, 7.715, 10.775],
  [1090, 13.461, 44.41],
];
let bad = 0;
for (const [z, lt, cm] of CHECKS) {
  const a = lookbackGyr(z), b = comovingGly(z);
  const ok = Math.abs(a / lt - 1) < 0.005 && Math.abs(b / cm - 1) < 0.005;
  if (!ok) bad++;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} z = ${z}: light travel ${a.toFixed(3)} Gyr (expected ${lt}), comoving ${b.toFixed(3)} Gly (expected ${cm})\n`);
}
const back = zOfLookback(lookbackGyr(0.45));
const ok = Math.abs(back - 0.45) < 1e-4;
if (!ok) bad++;
process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} zOfLookback inverts lookbackGyr at z = 0.45 (${back.toFixed(5)})\n`);
if (bad) process.exit(1);
