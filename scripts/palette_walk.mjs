import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = opt('url', 'http://127.0.0.1:8095/');
const CHROME = opt('chrome', process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const MODULES = opt('modules', process.env.PUPPETEER_MODULES || '');
const LIMIT = +opt('timeout', 300000);
const SIZE = opt('size', '1440x900').split('x').map(Number);
const require = createRequire(MODULES ? MODULES.replace(/\/?$/, '/') : import.meta.url);
const puppeteer = require('puppeteer-core');

const ROWS = [
  ['Floors on the ladder', 'dark matter', 'floor:dm', `document.body.dataset.mode === 'dm' && shown('.scene[data-floor="dm"] .sc-stage')`],
  ['Stars sky', 'stars', 'floor:stars', `document.body.dataset.mode === 'stars' && shown('.scene[data-floor="stars"] .sc-stage')`],
  ['Ladder peek', 'distance ladder', 'act:ladder', `shown('#ladderPeek')`],
  ['Search per floor with Worth a look', '', '@worth', ''],
  ['Data panel, live updates, resets', 'data', 'act:data', `shown('#dataPanel') && (document.querySelector('#doReset').scrollIntoView({ block: 'nearest' }), shown('#doReset'))`],
  ['Data health verdict, first line of Above you', 'above', 'act:brief', `shown('#aboveYou .ab-status') && shown('#aboveYou .ab-floors')`],
  ['Showcase pill', 'show all', 'act:pill', `pillChanged()`],
  ['A sample of Rubin alerts, not the survey (info)', 'about', 'act:about', `shown('#starsInfo .honest')`],
  ['Sources and credits', 'credits', 'act:credits', `shown('#starsCredits')`],
  ['View menu', 'views and filters', 'key:Views and filters', `shown('#starsView')`],
  ['Stars preset: Tonight', 'tonight', 'view:stars:tonight', `document.querySelector('#sPresets [data-p="tonight"]').classList.contains('on')`],
  ['Stars preset: Tour', 'tour', 'view:stars:tour', `document.querySelector('#sPresets [data-p="tour"]').classList.contains('on')`],
  ['Stars preset: Halo RR Lyrae', 'halo rr', 'view:stars:halo', `document.querySelector('#sPresets [data-p="halo"]').classList.contains('on')`],
  ['Stars stories', 'supernova rises', 'story:sn', `window.Observatory.story && window.Observatory.story.chapter === 'sn' && shown('#storyView')`],
  ['Leave the story', 'free sky', 'stars:free', `!window.Observatory.story.chapter || window.Observatory.story.chapter === 'free'`],
  ['Stars season ribbon', 'season', 'inst:stars:Season', `shown('.s-ribbon')`],
  ['Stars distance ladder', 'distances', 'inst:stars:Distances', `shown('.s-ladder')`],
  ['Stars census', 'census', 'inst:stars:Census', `shown('.s-census')`],
  ['Stars HR diagram', 'hr diagram', 'inst:stars:HR diagram', `shown('.s-hr')`],
  ['Stars family filter', 'explosions', 'stars:fam:2', `document.querySelector('#sLegend [data-g="2"]').getAttribute('aria-pressed') !== window.__before && shown('#sLegend')`, `document.querySelector('#sLegend [data-g="2"]').getAttribute('aria-pressed')`],
  ['Stars drop to distance', 'drop', 'stars:drop', `shown('.s-ladder') || (shown('#sky') && [...document.querySelectorAll('.proj-switch [aria-checked="true"]')].some((b) => b.textContent.trim() === 'Distance'))`],
  ['Stars pulse scale', 'pulse', 'stars:pulse', `document.activeElement && document.activeElement.id === 'sPulse' && shown('#sPulse')`],
  ['Stars object card', 'SN 2025agpz', '@obj', `window.Observatory.stars.state.sel != null && window.Observatory.stars.state.sel >= 0`],
  ['Hide the controls (zen)', 'hide', 'key:Hide or show the controls', `document.body.classList.contains('zen')`],
  ['Asteroid from another floor', '2026 cz10', 'obj:asteroids:2026 CZ10', `document.body.dataset.mode === 'asteroids' && window.Observatory.asteroids.state.sel && window.Observatory.asteroids.state.sel.name === '2026 CZ10'`],
  ['Asteroid presets', 'trojans', 'view:asteroids:tro', `document.querySelector('#presets [data-preset="tro"]').classList.contains('on')`],
  ['Asteroid size filter', 'size', 'ast:size', `document.activeElement && document.activeElement.id === 'dMin' && shown('#sizebar')`],
  ['Asteroid class filter', 'hungaria', 'ast:cls:HUN', `document.querySelector('#legend-map [data-cls="HUN"]').getAttribute('aria-pressed') === 'true'`],
  ['Asteroid zoom stops', 'jupiter', 'ast:z3', `Math.abs(window.Observatory.asteroids.state.viewR - 6.2) < 0.01`],
  ['Two-body orbits honesty (info)', 'about', 'act:about', `shown('#asteroidsInfo .honest')`],
  ['Asteroid orbits', 'orbits', 'inst:asteroids:Orbits', `shown('.el-panel')`],
  ['Asteroid colours', 'colours', 'inst:asteroids:Colours', `shown('.col-panel')`],
  ['Asteroid cadence', 'cadence', 'inst:asteroids:Cadence', `shown('.cad-panel')`],
  ['Asteroid stamps', 'stamps', 'inst:asteroids:Stamps', `shown('.stamp-panel')`],
  ['Lens control and the x1 note', 'amplify', 'dm:amp', `document.body.dataset.mode === 'dm' && document.activeElement && document.activeElement.id === 'dAmp' && shown('#dAmpNote')`],
  ['The shadow', 'shadow', 'dm:shadow', `document.querySelector('#dShadow').getAttribute('aria-pressed') === 'true'`],
  ['Dark matter presets', 'heaviest', 'view:dm:Heaviest cluster', `[...document.querySelectorAll('#dPresets .btn')].find((b) => b.textContent.trim() === 'Heaviest cluster').classList.contains('on')`],
  ['Dark matter meters', 'meters', 'inst:dm:Meters', `shown('.d-meter')`],
  ['Dark matter story so far', 'story so far', 'inst:dm:The story so far', `shown('.d-story')`],
  ['Dark matter cluster card', 'ACT-CL J', '@obj', `window.Observatory.dm.state.sel != null && window.Observatory.dm.state.sel >= 0`],
  ['Earth presets', 'northern lights', 'view:earth:north', `document.body.dataset.mode === 'earth' && document.querySelector('#ePresets [data-p="north"]').classList.contains('on')`],
  ['Earth live', 'live space', 'earth:live', `window.Observatory.earth.state.live === !window.__before`, `!!window.Observatory.earth.state.live`],
  ['Earth clouds', 'clouds', 'earth:clouds', `document.querySelector('#eClouds').getAttribute('aria-pressed') === 'true'`],
  ['Earth space-weather lanes', 'space weather', 'inst:earth:Space weather', `shown('.e-sw')`],
  ['Earth regions', 'regions', 'inst:earth:Regions', `shown('.e-reg')`],
  ['Earth fly to a region', 'north america', 'earth:reg:na', `window.Observatory.earth.view.k >= 1.9`],
  ['Aurora is a model, city lights 2016 (info)', 'about', 'act:about', `shown('#earthInfo .honest')`],
  ['Earth storm card', 'storm', '@obj', `!!window.Observatory.earth.state.sel`],
  ['Theme', 'day paper', 'act:theme', `document.documentElement.dataset.theme === 'light'`],
  ['URL deep link', 'copy a link', 'act:link', `shown('.pl-toast')`],
];

const HELPERS = () => {
  window.shown = (s) => {
    const e = typeof s === 'string' ? document.querySelector(s) : s;
    if (!e || e.closest('[hidden]') || !e.getClientRects().length) return false;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && +cs.opacity > 0;
  };
  window.pillText = () => { const b = document.querySelector(`.scene[data-floor="${document.body.dataset.mode}"] .showcase button`); return b ? b.textContent : null; };
  window.pillChanged = () => window.pillText() !== window.__before;
};

let browser = null;
async function main() {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => out.push('FAIL page error: ' + e.message));
    await page.setViewport({ width: SIZE[0], height: SIZE[1], isMobile: SIZE[0] < 700, hasTouch: SIZE[0] < 700 });
    await page.goto(BASE + '?mode=stars', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Observatory && window.Observatory.ready, { timeout: 40000 });
    await page.evaluate(HELPERS);
    const egg = await page.evaluate(async () => {
      const p = await import('/js/palette.js' + new URL(document.querySelector('script[src*="main.js"]').src).search);
      return ['sprite', 'sprites', 'elves', 'egg', '70 km'].flatMap((q) => p.paletteItems(q).filter((i) => i.group !== 'Search other floors' && /sprite|elves|egg/i.test(i.label)).map((i) => i.label));
    });
    out.push((egg.length ? 'FAIL' : 'ok  ') + ' the easter egg is not indexed ' + (egg.length ? JSON.stringify(egg) : ''));
    for (const [row, q, id, check, before] of ROWS) {
      const res = await page.evaluate(async (q, id, check, before) => {
        const p = await import('/js/palette.js' + new URL(document.querySelector('script[src*="main.js"]').src).search);
        const a = document.querySelector('#aboveYou');
        if (a && !a.hidden) a.querySelector('.ab-close').click();
        if (!document.querySelector('#dataPanel').hidden) document.querySelector('#dataClose').click();
        if (document.body.classList.contains('zen') && window.Observatory.scene) window.Observatory.scene.zen(false);
        const items = p.paletteItems(q);
        if (id === '@worth') return { ok: items.some((i) => i.group === 'Worth a look') };
        let target = id;
        if (id === '@obj') { const o = items.find((i) => i.group === 'Objects'); if (!o) return { ok: false, why: `no object for "${q}"` }; target = o.id; }
        const found = items.find((i) => i.id === target);
        if (!found) return { ok: false, why: `not listed for "${q}"`, top: items.slice(0, 5).map((i) => i.id) };
        window.__before = id === 'act:pill' ? window.pillText() : before ? (0, eval)(before) : null;
        p.runById(target, q);
        const t0 = performance.now();
        while (performance.now() - t0 < 12000) {
          await new Promise((r) => setTimeout(r, 150));
          let v = false;
          try { v = (0, eval)(check); } catch { v = false; }
          if (v) return { ok: true, label: found.label };
        }
        return { ok: false, why: 'ran but nothing visible happened', label: found.label };
      }, q, id, check, before || '');
      out.push((res.ok ? 'ok  ' : 'FAIL') + ' ' + row + (res.ok ? ` (${res.label})` : ' ' + JSON.stringify(res)));
    }
  } finally {
    await browser.close();
  }
  return out;
}

const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), LIMIT));
Promise.race([main(), timeout]).then((lines) => {
  process.stdout.write(lines.join('\n') + '\n');
  const failed = lines.filter((l) => l.startsWith('FAIL')).length;
  process.stdout.write(failed ? `${failed} rows failed\n` : `all ${lines.length} rows reached\n`);
  process.exit(failed ? 1 : 0);
}, async (e) => {
  process.stderr.write(String(e) + '\n');
  try { if (browser) await browser.close(); } catch { process.exitCode = 1; }
  process.exit(1);
});
