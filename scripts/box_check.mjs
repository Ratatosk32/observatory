import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes('--' + name);
const BASE = opt('url', 'http://127.0.0.1:8095/');
const CHROME = opt('chrome', process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const MODULES = opt('modules', process.env.PUPPETEER_MODULES || '');
const LIMIT = +opt('timeout', 300000);
const MODES = opt('modes', 'stars,asteroids,dm,earth').split(',');
const SIZES = opt('sizes', '360x780,390x844').split(',').map((s) => s.split('x').map(Number));
const THEMES = opt('themes', 'dark').split(',');
const TOL = +opt('tolerance', 1);
const require = createRequire(MODULES ? MODULES.replace(/\/?$/, '/') : import.meta.url);
const puppeteer = require('puppeteer-core');

function collect(tol) {
  const W = innerWidth, H = innerHeight;
  const CTL = 'a[href], button, input, select, textarea, summary, [role=button], [role=radio], [role=tab], [role=slider], [role=switch], [role=checkbox]';
  const opaque = (e) => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.1) return false;
      if (n.hidden) return false;
    }
    return true;
  };
  const clipOf = (e) => {
    let r = { l: 0, t: 0, r: W, b: H };
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible' || c.clipPath !== 'none' || c.clip !== 'auto') {
        const b = n.getBoundingClientRect();
        if (b.width <= 2 || b.height <= 2 || /inset\(50%\)/.test(c.clipPath)) return null;
        r = { l: Math.max(r.l, b.left), t: Math.max(r.t, b.top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
      if (c.position === 'fixed') break;
    }
    return r;
  };
  const cut = (b, c) => (c ? { l: Math.max(b.left, c.l), t: Math.max(b.top, c.t), r: Math.min(b.right, c.r), b: Math.min(b.bottom, c.b) } : null);
  const ok = (r) => r && r.r - r.l > 2 && r.b - r.t > 2;
  const sheet = document.querySelector(`.scene[data-floor="${document.body.dataset.mode}"] > .card`);
  const sheetOn = sheet && getComputedStyle(sheet).position === 'fixed';
  const sr = sheetOn ? sheet.getBoundingClientRect() : null;
  const layerOf = (e) => (sheetOn && sheet.contains(e) ? 'sheet' : e.closest('.pop:not([hidden]), .drawer:not([hidden]), .elayers-pop:not([hidden])') ? 'pop' : 'page');
  const underSheet = (r) => sheetOn && r.b > sr.top + 1;
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.id || e.className || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 36);
  const boxes = [], clipped = [];
  const scope = document.querySelector(`.scene[data-floor="${document.body.dataset.mode}"]`);
  const roots = [document.querySelector('.top'), scope].filter(Boolean);
  for (const root of roots) {
    for (const e of root.querySelectorAll(CTL)) {
      if (e.tagName === 'CANVAS' || e.closest('.card-ghost') || !opaque(e)) continue;
      const r = cut(e.getBoundingClientRect(), clipOf(e));
      if (!ok(r)) continue;
      const layer = layerOf(e);
      if (layer === 'page' && underSheet(r)) continue;
      boxes.push({ kind: 'control', name: name(e), r, layer, el: e });
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const e = n.parentElement;
      if (!e || e.closest('.card-ghost, script, style, svg') || !opaque(e)) continue;
      const clip = clipOf(e);
      if (!clip) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const inCtl = !!e.closest(CTL);
      for (const q of rg.getClientRects()) {
        if (!e.closest('.credit > span') && q.width > 2 && q.height > 2 && q.bottom > 0 && q.top < H && (q.right > clip.r + tol || q.left < clip.l - tol)) clipped.push(`"${n.nodeValue.trim().slice(0, 30)}" cut by ${Math.round(Math.max(q.right - clip.r, clip.l - q.left))} px`);
        if (inCtl) continue;
        const r = cut(q, clip);
        if (!ok(r)) continue;
        const layer = layerOf(e);
        if (layer === 'page' && underSheet(r)) continue;
        boxes.push({ kind: 'label', name: n.nodeValue.trim().slice(0, 36), r, layer, el: e });
      }
    }
  }
  const mod = window.Observatory[document.body.dataset.mode];
  const drawn = mod && mod.labels ? mod.labels : [];
  for (const g of drawn) {
    if (!g.el || !g.el.getClientRects().length || !opaque(g.el)) continue;
    const cr = g.el.getBoundingClientRect(), clip = cut(cr, clipOf(g.el));
    for (const [x0, y0, x1, y1, nm] of g.boxes || []) {
      const r = cut({ left: cr.left + x0, top: cr.top + y0, right: cr.left + x1, bottom: cr.top + y1 }, clip);
      if (!ok(r) || underSheet(r)) continue;
      boxes.push({ kind: 'drawn', name: nm || 'canvas label', r, layer: 'page', el: g.el });
    }
    for (const [x, y, rad, nm] of g.circles || []) {
      const c = { x: cr.left + x, y: cr.top + y, rad };
      if (sheetOn && c.y - rad > sr.top) continue;
      boxes.push({ kind: 'mark', name: nm || 'canvas mark', r: { l: c.x - rad, t: c.y - rad, r: c.x + rad, b: c.y + rad }, c, layer: 'page', el: g.el });
    }
  }
  const circleHit = (c, r) => {
    const dx = Math.max(r.l - c.x, 0, c.x - r.r), dy = Math.max(r.t - c.y, 0, c.y - r.b);
    return dx * dx + dy * dy < (c.rad - tol) * (c.rad - tol);
  };
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.layer !== b.layer) continue;
      if (a.kind === 'mark' && b.kind === 'mark') continue;
      if (a.el !== b.el && (a.el.contains(b.el) || b.el.contains(a.el))) continue;
      if (a.el === b.el && a.kind === 'label' && b.kind === 'label') continue;
      if (a.kind === 'drawn' && b.kind === 'drawn' && a.el !== b.el) continue;
      const ix = Math.min(a.r.r, b.r.r) - Math.max(a.r.l, b.r.l), iy = Math.min(a.r.b, b.r.b) - Math.max(a.r.t, b.r.t);
      if (ix <= tol || iy <= tol) continue;
      const m = a.kind === 'mark' ? a : b.kind === 'mark' ? b : null;
      if (m && !circleHit(m.c, m === a ? b.r : a.r)) continue;
      hits.push(`${a.kind} "${a.name}" × ${b.kind} "${b.name}" (${Math.round(ix)}×${Math.round(iy)} px)`);
    }
  }
  const inline = (e) => e.matches('a, .link') && !!e.closest('p') && e.closest('p').textContent.trim().length > e.textContent.trim().length;
  const narrow = [];
  for (const b of boxes) if (b.kind === 'control' && b.layer !== 'pop' && (b.r.r - b.r.l < 40 - tol || b.r.b - b.r.t < 40 - tol) && !b.el.closest('.lp-group, .seg, .proj-switch, .card, .tabs') && !inline(b.el)) narrow.push(`${b.name} ${Math.round(b.r.r - b.r.l)}×${Math.round(b.r.b - b.r.t)}`);
  for (const b of boxes) if (b.kind === 'control' && b.layer !== 'pop' && b.el.closest('.seg, .proj-switch') && b.r.b - b.r.t < 40 - tol) narrow.push(`${b.name} ${Math.round(b.r.r - b.r.l)}×${Math.round(b.r.b - b.r.t)}`);
  const se = document.scrollingElement;
  return { hits, narrow, clipped, n: boxes.length, hscroll: se.scrollWidth > W + 1 };
}

function popCheck(which) {
  const m = document.body.dataset.mode;
  const p = document.getElementById(`${m}${which}`);
  if (!p || p.hidden) return `${which} did not open`;
  const r = p.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const out = [];
  if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) out.push(`${which} popover leaves the viewport (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`);
  const card = document.querySelector(`.scene[data-floor="${m}"] > .card`);
  if (card && getComputedStyle(card).position === 'fixed') {
    const c = card.getBoundingClientRect();
    const iy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top), ix = Math.min(r.right, c.right) - Math.max(r.left, c.left);
    if (ix > 1 && iy > 1) {
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(Math.max(r.top, c.top) + Math.min(iy, 20) / 2));
      if (!top || !p.contains(top)) out.push(`${which} popover is covered by the sheet for ${Math.round(iy)} px`);
    }
  }
  return out.join('; ');
}

async function settle(page, mode) {
  await page.waitForFunction(() => window.Observatory && window.Observatory.ready, { timeout: 60000 });
  await page.waitForFunction((m) => document.body.dataset.mode === m && !document.querySelector('.loading:not([hidden])'), { timeout: 60000 }, mode);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1800));
}

let browser;
async function main() {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const lines = [];
  let bad = 0;
  for (const theme of THEMES) {
    for (const [w0, h0] of SIZES) {
      for (const turn of flag('landscape') ? [false, true] : [false]) {
        const [w, h] = turn ? [h0, w0] : [w0, h0];
        for (const mode of MODES) {
          const page = await browser.newPage();
          try {
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
            await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
            await page.goto(`${BASE}?mode=${mode}&theme=${theme}&still`, { waitUntil: 'load', timeout: 60000 });
            await settle(page, mode);
            const res = await page.evaluate(collect, TOL);
            const pops = [];
            for (const [which, sel] of [['View', '.hb-view'], ['Info', '.hb-info']]) {
              const opened = await page.evaluate((m, s) => { const b = document.querySelector(`.scene[data-floor="${m}"] ${s}`); if (b) b.click(); return !!b; }, mode, sel);
              if (!opened) { pops.push(`no ${which} button`); continue; }
              await new Promise((r) => setTimeout(r, 500));
              const p = await page.evaluate(popCheck, which);
              if (p) pops.push(p);
              await page.keyboard.press('Escape');
              await new Promise((r) => setTimeout(r, 300));
            }
            const tag = `${mode} ${w}x${h} ${theme}`;
            const fails = [...res.hits, ...res.narrow.map((x) => `control under 40 px: ${x}`), ...res.clipped.map((x) => `clipped text: ${x}`), ...pops, ...(res.hscroll ? ['horizontal scroll'] : [])];
            bad += fails.length;
            lines.push(`${fails.length ? 'FAIL' : 'ok  '} ${tag}: ${res.n} boxes${fails.length ? '' : ', no overlap'}`);
            for (const f of fails) lines.push(`       ${f}`);
          } finally {
            await page.close();
          }
        }
      }
    }
  }
  return { lines, bad };
}

const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), LIMIT));
Promise.race([main(), timeout]).then(async ({ lines, bad }) => {
  await browser.close().catch(() => {});
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write(bad ? `${bad} problems\n` : 'no overlaps, every control at least 40 px\n');
  process.exit(bad ? 1 : 0);
}, async (e) => {
  process.stderr.write(String(e) + '\n');
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
