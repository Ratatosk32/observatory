import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = opt('url', 'http://127.0.0.1:8095/');
const CHROME = opt('chrome', process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const MODULES = opt('modules', process.env.PUPPETEER_MODULES || '');
const LIMIT = +opt('timeout', 60000);
const TOL = 0.25;
const require = createRequire(MODULES ? MODULES.replace(/\/?$/, '/') : import.meta.url);
const puppeteer = require('puppeteer-core');

const CASES = [
  { mjd: 61368.25, label: '24 Nov 2026 06:00 UTC' },
  { mjd: 61212.9, label: '21 Jun 2026 21:36 UTC' },
  { mjd: 61120.5, label: '21 Mar 2026 12:00 UTC' },
];

function probe(cases) {
  return (async () => {
    const EG = await import(new URL('js/earthgl.js', location.href).href);
    const SKY = await import(new URL('js/skycalc.js', location.href).href);
    const D2R = Math.PI / 180, N = 640, R = 300;
    const cv = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    cv.width = N; cv.height = N;
    const G = EG.initGl(cv);
    if (!G) return { error: 'WebGL is not available' };
    const zero = [0, 0, 0];
    const colors = { NightSea: zero, NightLand: zero, DaySea: zero, DayLand: zero, LightsC: zero, Gold: [1, 1, 1], Grid: zero, Ink: zero, Aur: zero, AurHi: zero, Tint: zero, Cloud: zero };
    const vec = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const toWorld = (v, lat0, lon0) => {
      const e = [-Math.sin(lon0), Math.cos(lon0), 0];
      const n = [-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0)];
      const c = vec(lat0, lon0);
      const w = [0, 1, 2].map((k) => v[0] * e[k] + v[1] * n[k] + v[2] * c[k]);
      const l = Math.hypot(...w);
      return w.map((x) => x / l);
    };
    const out = [];
    for (const { mjd, label } of cases) {
      const [ra, dec] = SKY.sunRaDec(mjd);
      const sLat = dec * D2R, sLon = (((ra - SKY.gmst(mjd)) % 360 + 540) % 360 - 180) * D2R;
      const S = vec(sLat, sLon);
      let U = [-S[1], S[0], 0];
      const ul = Math.hypot(...U) || 1;
      U = U.map((x) => x / ul);
      const a = 102 * D2R, Cv = S.map((s, k) => Math.cos(a) * s + Math.sin(a) * U[k]);
      const view = [Math.asin(Cv[2]), Math.atan2(Cv[1], Cv[0])];
      const render = (tw) => {
        EG.drawGl(G, { globe: [N / 2, N / 2, R], view, capN: [0, 0, 0], capS: [0, 0, 0], capA: 0, sun: [sLat, sLon], ovMix: 0, ovShift: [0, 0], aurGain: 0, hatchA: 0, dayTint: 0, dpr: 1, cov: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], colors, dark: true, twilight: tw, cloudA: 0 });
        const px = new Uint8Array(N * N * 4);
        G.g.readPixels(0, 0, N, N, G.g.RGBA, G.g.UNSIGNED_BYTE, px);
        return px;
      };
      const on = render(1), off = render(0);
      const lines = EG.TWILIGHT.map((d) => ({ target: -d, w: 0, sum: 0, peak: 0, pw: 0, psum: 0 }));
      const hits = [];
      let stray = 0;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = (r * N + c) * 4, dv = on[i] - off[i];
          if (dv <= 0) continue;
          const x = (c + 0.5 - N / 2) / R, y = (r + 0.5 - N / 2) / R, r2 = x * x + y * y;
          if (r2 >= 0.97) continue;
          const w = toWorld([x, y, Math.sqrt(1 - r2)], view[0], view[1]);
          const lat = Math.asin(w[2]) / D2R, lon = Math.atan2(w[1], w[0]) / D2R;
          const alt = SKY.altitude(ra, dec, lat, lon, mjd);
          const L = lines.find((l) => Math.abs(alt - l.target) < 3);
          if (!L) { if (dv > 2) stray++; continue; }
          L.w += dv; L.sum += dv * alt; L.peak = Math.max(L.peak, dv);
          hits.push([L, dv, alt]);
        }
      }
      for (const [L, dv, alt] of hits) if (dv >= 0.6 * L.peak) { L.pw += dv; L.psum += dv * alt; }
      out.push({ label, stray, lines: lines.map((l) => ({ target: l.target, mean: l.w ? l.sum / l.w : null, peak: l.pw ? l.psum / l.pw : null, strength: l.peak })) });
    }
    return { out };
  })();
}

async function run() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('favicon.svg', BASE).href, { waitUntil: 'load', timeout: 30000 });
    const res = await page.evaluate(probe, CASES);
    if (res.error) throw new Error(res.error);
    let bad = 0;
    for (const c of res.out) {
      process.stdout.write(`${c.label}\n`);
      for (const l of c.lines) {
        const ok = l.mean != null && l.peak != null && Math.abs(l.mean - l.target) <= TOL && Math.abs(l.peak - l.target) <= TOL && l.strength > 4;
        if (!ok) bad++;
        process.stdout.write(`  Sun at ${l.target}°: line centre ${l.mean == null ? 'missing' : l.mean.toFixed(3) + '°'}, peak ${l.peak == null ? 'missing' : l.peak.toFixed(3) + '°'}, strength ${l.strength} ${ok ? 'ok' : 'FAIL'}\n`);
      }
      if (c.stray) { bad++; process.stdout.write(`  ${c.stray} pixels lit away from the three lines FAIL\n`); }
    }
    if (bad) throw new Error(`${bad} twilight checks failed (tolerance ${TOL}°)`);
    process.stdout.write(`twilight lines within ${TOL}° of skycalc.js\n`);
  } finally {
    await browser.close();
  }
}

await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), LIMIT))]).catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
process.exit();
