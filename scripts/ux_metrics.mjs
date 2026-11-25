import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes('--' + name);
const BASE = opt('base', 'http://127.0.0.1:8094/');
const OUT = opt('out', null);
const SHOTS = opt('shots', null);
const MODES = (opt('modes', 'stars,asteroids,dm,earth')).split(',');
const LIMIT_MS = +opt('timeout', 240000);
const EXTRA = opt('query', '');
const [PERF_W, PERF_H] = opt('perf-size', '412x915').split('x').map(Number);
const CPU = +opt('cpu', 4);
const PERF_DPR = +opt('dpr', PERF_W < 700 ? 2.6 : 1);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUP = process.env.PUPPETEER_CORE || 'puppeteer-core';

const SIZES = flag('quick')
  ? [{ name: '1440', w: 1440, h: 900, theme: 'dark' }, { name: '390', w: 390, h: 844, theme: 'dark', mobile: true }]
  : [
    { name: '1440', w: 1440, h: 900, theme: 'dark' },
    { name: '1440-light', w: 1440, h: 900, theme: 'light' },
    { name: '390', w: 390, h: 844, theme: 'dark', mobile: true },
    { name: '360-light', w: 360, h: 780, theme: 'light', mobile: true },
  ];

const BEFORE = {
  chrome1440: { stars: 41, asteroids: 26, dm: 24, earth: 28 },
  all1440: { stars: 83, asteroids: 119, dm: 41, earth: 57 },
  height1440: { stars: 3551, asteroids: 3744, dm: 2102, earth: 2361 },
  height390: { stars: 5206, asteroids: 5261, dm: 3829, earth: 3850 },
};

const ANSWER = {
  stars: ['.showcase', '#sDate, .s-sky .date, .time .date'],
  asteroids: ['.showcase', '#play'],
  dm: ['.verdict, .d-meter canvas'],
  earth: ['.showcase', '#ePlay, .e-map .btn.play'],
};

async function collect(page, mode) {
  return page.evaluate((mode, answer) => {
    const H = innerHeight, W = innerWidth;
    const SEL = 'a[href], button, input, select, textarea, summary, [role=button], [role=radio], [role=tab], [role=combobox], canvas';
    const shown = (e) => {
      if (e.closest('[hidden]')) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      let n = e;
      while (n && n.nodeType === 1) { const c = getComputedStyle(n); if (+c.opacity === 0 || c.display === 'none') return false; n = n.parentElement; }
      return true;
    };
    const inFold = (e) => { const r = e.getBoundingClientRect(); return r.top < H && r.bottom > 0 && r.left < W && r.right > 0; };
    const content = (e) => e.tagName === 'CANVAS' || !!e.closest('#sCardBody, #cardBody, #dCardBody, #eCardBody');
    const all = [...document.querySelectorAll(SEL)].filter(shown);
    const fold = all.filter(inFold);
    const chrome = fold.filter((e) => !content(e));
    const label = (e) => (e.getAttribute('aria-label') || e.title || e.textContent || e.id || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    let stage = 0;
    for (const cv of document.querySelectorAll('canvas')) {
      if (!shown(cv)) continue;
      const r = cv.getBoundingClientRect();
      const a = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
      stage = Math.max(stage, a);
    }
    const ans = answer[mode].map((sel) => {
      const e = [...document.querySelectorAll(sel)].find(shown);
      if (!e) return { sel, ok: false, why: 'missing' };
      const r = e.getBoundingClientRect();
      return { sel, ok: r.top >= 0 && r.bottom <= H + 1, top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    const st = [...document.querySelectorAll('.sc-stage')].find(shown);
    const top = document.querySelector('.top'), rail = document.querySelector('.ladder');
    let stageCol = null, stageOfContent = null;
    if (st) {
      const r = st.getBoundingClientRect();
      const a = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
      const railW = rail && getComputedStyle(rail).position === 'fixed' ? rail.getBoundingClientRect().right : 0;
      const topH = top ? top.getBoundingClientRect().bottom : 0;
      stageCol = +(a / (W * H)).toFixed(3);
      stageOfContent = +(a / ((W - railW) * (H - topH))).toFixed(3);
    }
    const se = document.scrollingElement;
    return {
      chrome: chrome.length,
      all: all.length,
      list: chrome.map(label),
      height: se.scrollHeight,
      hscroll: se.scrollWidth > W + 1,
      stageShare: +(stage / (W * H)).toFixed(3),
      stageCol,
      stageOfContent,
      answer: ans,
    };
  }, mode, ANSWER);
}

async function dateText(page) {
  return page.evaluate(() => {
    const e = [...document.querySelectorAll('output.date, .date, #eTime, .e-time')].find((x) => x.getClientRects().length && !x.closest('[hidden]'));
    return e ? e.textContent.trim() : '';
  });
}

async function waitReady(page, mode) {
  await page.waitForFunction(() => window.Observatory && window.Observatory.ready, { timeout: 60000 });
  await page.waitForFunction((m) => document.body.dataset.mode === m && !document.querySelector('.loading:not([hidden])'), { timeout: 60000 }, mode);
  await new Promise((r) => setTimeout(r, 2500));
}

async function layoutRun(browser, results, errors) {
  for (const sz of SIZES) {
    for (const mode of MODES) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => errors.push(`${mode}@${sz.name}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${mode}@${sz.name}: ${m.text()}`); });
      try {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: sz.theme }]);
        await page.setViewport({ width: sz.w, height: sz.h, deviceScaleFactor: 1, isMobile: !!sz.mobile, hasTouch: !!sz.mobile });
        await page.goto(`${BASE}?mode=${mode}&theme=${sz.theme}`, { waitUntil: 'load', timeout: 60000 });
        await waitReady(page, mode);
        const r = await collect(page, mode);
        const d0 = await dateText(page);
        await new Promise((res) => setTimeout(res, 1200));
        const d1 = await dateText(page);
        r.date = d1;
        r.paused = d0 === d1;
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${mode}-${sz.name}.png`) });
        results[`${mode}@${sz.name}`] = r;
      } finally {
        await page.close();
      }
    }
  }
}

async function perfRun(browser, results, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`perf: ${e.message}`));
  try {
    const cdp = await page.createCDPSession();
    await page.setViewport({ width: PERF_W, height: PERF_H, deviceScaleFactor: PERF_DPR, isMobile: PERF_W < 700, hasTouch: PERF_W < 700 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await page.evaluateOnNewDocument(() => {
      window.__long = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([performance.now(), e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { window.__long = null; }
    });
    await page.goto(`${BASE}?mode=${MODES[0]}${EXTRA ? '&' + EXTRA : ''}`, { waitUntil: 'load', timeout: 90000 });
    await waitReady(page, MODES[0]);
    const out = {};
    for (const pass of ['first', 'again']) {
      for (const mode of MODES) {
        const t0 = await page.evaluate((m) => {
          const b = document.querySelector(`.lad-group button[data-mode="${m}"]`);
          const now = performance.now();
          if (document.body.dataset.mode !== m && b) b.click();
          return now;
        }, mode);
        await page.waitForFunction((m) => document.body.dataset.mode === m && !document.querySelector('.loading:not([hidden])'), { timeout: 90000 }, mode);
        await new Promise((r) => setTimeout(r, 2500));
        const long = await page.evaluate((t) => (window.__long || []).filter(([at]) => at >= t).map(([, d]) => Math.round(d)), t0);
        const key = `${mode}:${pass}`;
        out[key] = { longTasks: long.length, maxLong: long.length ? Math.max(...long) : 0 };
        if (pass === 'again') {
          await page.evaluate(() => { const p = window.Observatory.perf; p.draw.length = 0; p.frame.length = 0; });
          const playing = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button.play, #play, #ePlay, #sPlay, #dPlay')].find((x) => x.getClientRects().length && !x.closest('[hidden]'));
            if (!b) return false;
            if (b.getAttribute('aria-label') === 'Play') { b.click(); return 'started'; }
            return 'already';
          });
          await new Promise((r) => setTimeout(r, 4000));
          const p = await page.evaluate(() => {
            const q = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * 0.95)].toFixed(1); };
            return { draw95: q(window.Observatory.perf.draw), frame95: q(window.Observatory.perf.frame), n: window.Observatory.perf.draw.length };
          });
          Object.assign(out[key], p, { played: playing });
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('button.play, #play, #ePlay, #sPlay, #dPlay')].find((x) => x.getClientRects().length && !x.closest('[hidden]'));
            if (b && b.getAttribute('aria-label') !== 'Play') b.click();
          });
        }
      }
    }
    results.perf = out;
  } finally {
    await page.close();
  }
}

function report(results) {
  const rows = [];
  rows.push('| Mode | Chrome 1440 (before) | All controls 1440 (before) | Height 1440 (before) | Height 390 (before) | Canvas share 1440 | Stage column share | Answer 1440 | Answer 390 | Paused | H-scroll |');
  rows.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of MODES) {
    const a = results[`${m}@1440`], p = results[`${m}@390`];
    if (!a) continue;
    const ok = (r) => (r ? (r.answer.every((x) => x.ok) ? 'yes' : 'no') : '-');
    const hs = SIZES.map((s) => results[`${m}@${s.name}`]).filter(Boolean).some((r) => r.hscroll);
    rows.push(`| ${m} | ${a.chrome} (${BEFORE.chrome1440[m]}) | ${a.all} (${BEFORE.all1440[m]}) | ${a.height} (${BEFORE.height1440[m]}) | ${p ? p.height : '-'} (${BEFORE.height390[m]}) | ${a.stageShare} | ${a.stageCol == null ? '-' : `${a.stageCol} (${a.stageOfContent} of content)`} | ${ok(a)} | ${ok(p)} | ${a.paused ? 'yes' : 'no'} | ${hs ? 'YES' : 'no'} |`);
  }
  return rows.join('\n');
}

async function main() {
  const { default: puppeteer } = await import(PUP.includes('/') || PUP.includes('\\') ? pathToFileURL(resolve(PUP, 'lib/esm/puppeteer/puppeteer-core.js')).href : PUP);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const results = {}, errors = [];
  let browser;
  const run = (async () => {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox', '--js-flags=--max-old-space-size=512'] });
    if (!flag('perf-only')) await layoutRun(browser, results, errors);
    if (flag('perf') || flag('perf-only')) await perfRun(browser, results, errors);
  })();
  const limit = new Promise((_, rej) => setTimeout(() => rej(new Error(`ux_metrics: over ${LIMIT_MS} ms`)), LIMIT_MS));
  try {
    await Promise.race([run, limit]);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  results.errors = errors;
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
  process.stdout.write(report(results) + '\n');
  if (results.perf) process.stdout.write(JSON.stringify(results.perf, null, 1) + '\n');
  if (errors.length) process.stdout.write('Errors:\n' + errors.join('\n') + '\n');
}

main().then(() => process.exit(0), (e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
