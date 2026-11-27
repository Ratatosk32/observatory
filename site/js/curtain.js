import { DUR, STAGGER, play, stagger } from './motion.js';

const GRACE_MS = 150;
const SLOW_MS = 4000;
const FALLBACK_MS = 3000;
const ROOTS = { stars: 'starsRoot', dm: 'dmRoot', earth: 'earthRoot', asteroids: 'astRoot' };
const LOADS = { stars: 'starsLoading', dm: 'dmLoading', earth: 'earthLoading', asteroids: 'astLoading' };
const NOUN = { stars: 'the sky', dm: 'the CMB', earth: 'the Earth', asteroids: 'the asteroids' };
const CODE = { stars: ['js/stars.js', 'js/story.js'], asteroids: ['js/asteroids.js'], dm: ['js/darkmatter.js'], earth: ['js/earth.js'] };
const earthLights = () => (innerWidth < 700 ? 'data/earth-lights-2048.jpg' : 'data/earth-lights-4096.jpg');
const DATA = {
  stars: () => ['data/stars.json', 'data/showcase.json', 'data/tonight.json', 'data/milkyway.png'],
  asteroids: () => ['data/asteroids.json', 'data/showcase.json'],
  dm: () => ['data/cmb.json', 'data/showcase.json', 'data/cmb-sky.png', 'data/cmb-lens.png'],
  earth: () => ['data/earth.json', 'data/earth-lightning.json', 'data/earth-aurora.json', earthLights(), 'data/earth-land-2048.png'],
};

const ELLIPSE = 'M100 2A98 48 0 1 1 100 98A98 48 0 1 1 100 2';
const DISC = 'M50 3A47 47 0 1 1 50 97A47 47 0 1 1 50 3';
const ring = (r, cls = '') => `<circle${cls ? ` class="${cls}"` : ''} cx="50" cy="50" r="${r}"/>`;
const ART = {
  stars: { box: '0 0 200 100', trace: ELLIPSE, base: '<path d="M2 50H198M100 2V98"/><ellipse cx="100" cy="50" rx="49" ry="48"/><path class="cu-band" d="M8 50Q100 41 192 50Q100 59 8 50"/>' },
  dm: { box: '0 0 200 100', trace: ELLIPSE, base: '<path d="M2 50H198M100 2V98M10.3 30.6H189.7M10.3 69.4H189.7M36.5 13.4H163.5M36.5 86.6H163.5"/><ellipse cx="100" cy="50" rx="49" ry="48"/>' },
  earth: { box: '0 0 100 100', trace: DISC, base: '<ellipse cx="50" cy="50" rx="47" ry="13"/><ellipse cx="50" cy="50" rx="19" ry="47"/><path d="M3 50H97"/>' },
  asteroids: { box: '0 0 100 100', trace: DISC, base: `${ring(13)}${ring(21)}${ring(30, 'cu-belt')}${ring(40)}<circle class="cu-sun" cx="50" cy="50" r="0.9"/>` },
};

const runs = {};
const drawn = new Set();
const arrived = new Set();
let observer = null;
const TRACE_PX = 1.5;
const INSET = 8;
const sizer = typeof ResizeObserver === 'function' ? new ResizeObserver((list) => { for (const e of list) fit(e.target); }) : null;

function fit(wrap) {
  const node = wrap.querySelector(':scope > .curtain');
  if (!node) return;
  const stage = wrap.querySelector(':scope > canvas, :scope > .e-stage');
  const top = stage ? stage.offsetTop : 0, height = stage ? stage.offsetHeight : wrap.clientHeight;
  Object.assign(node.style, { top: `${top + INSET}px`, height: `${Math.max(0, height - 2 * INSET)}px`, bottom: 'auto' });
  const svg = node.querySelector('svg'), trace = node.querySelector('.cu-trace');
  const box = svg.viewBox.baseVal, w = svg.clientWidth, h = svg.clientHeight;
  if (!box || !box.width || !w || !h) return;
  trace.setAttribute('stroke-width', (TRACE_PX / Math.min(w / box.width, h / box.height)).toFixed(3));
}

const pathOf = (url) => { try { return new URL(url, location.href).pathname.split('/').slice(-2).join('/'); } catch { return ''; } };
const rootOf = (m) => document.getElementById(ROOTS[m]);
const wrapOf = (root) => root && root.querySelector(':scope > .scene .map-wrap');
const needsOf = (m) => [...CODE[m], ...DATA[m]().map(pathOf), 'drawn'];
const doneOf = (run) => run.needs.filter((n) => (n === 'drawn' ? drawn.has(run.m) : arrived.has(n))).length;

function watchResources() {
  if (observer || typeof PerformanceObserver !== 'function') return;
  for (const e of performance.getEntriesByType('resource')) arrived.add(pathOf(e.name));
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) arrived.add(pathOf(e.name));
    for (const run of Object.values(runs)) progress(run);
  });
  try { observer.observe({ type: 'resource', buffered: true }); } catch { observer = null; }
}

function preload(m) {
  for (const href of DATA[m]()) {
    if (arrived.has(pathOf(href)) || document.head.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = href;
    if (href.endsWith('.json')) { link.as = 'fetch'; link.crossOrigin = 'anonymous'; } else link.as = 'image';
    document.head.appendChild(link);
  }
}

function curtainNode(m) {
  const a = ART[m];
  const el = document.createElement('div');
  el.className = 'curtain';
  el.dataset.floor = m;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="${a.box}" preserveAspectRatio="xMidYMid meet" focusable="false"><g class="cu-base">${a.base}<path d="${a.trace}"/></g><path class="cu-trace" d="${a.trace}" pathLength="1"/></svg><p class="cu-note"></p>`;
  return el;
}

function place(run) {
  const wrap = wrapOf(run.root);
  if (!wrap || run.node.parentElement === wrap) return;
  if (sizer && run.node.parentElement) sizer.unobserve(run.node.parentElement);
  wrap.prepend(run.node);
  if (sizer) sizer.observe(wrap);
  fit(wrap);
}

function progress(run) {
  const done = doneOf(run), total = run.needs.length;
  run.node.style.setProperty('--cu-p', String(1 - done / total));
  if (run.slow) run.node.querySelector('.cu-note').textContent = `Still loading ${NOUN[run.m]} · ${Math.min(done, total - 1)} of ${total - 1} files`;
  clearTimeout(run.fallback);
  if (done >= total - 1 && !drawn.has(run.m)) run.fallback = setTimeout(() => reveal(run.m), FALLBACK_MS);
}

export function arm(m) {
  if (drawn.has(m) || runs[m] || !ART[m]) return;
  const root = rootOf(m);
  if (!root) return;
  watchResources();
  preload(m);
  const run = { m, root, needs: needsOf(m), node: curtainNode(m), shown: false, slow: false };
  runs[m] = run;
  root.classList.add('waiting');
  place(run);
  run.mo = new MutationObserver(() => place(run));
  run.mo.observe(root, { childList: true });
  progress(run);
  run.grace = setTimeout(() => { run.shown = true; run.node.classList.add('on'); performance.mark(`floor-curtain:${m}`); }, GRACE_MS);
  run.slowT = setTimeout(() => { run.slow = true; run.node.classList.add('slow'); progress(run); }, SLOW_MS);
}

export const waiting = (m) => !!runs[m];

function bandsOf(card) {
  const out = [];
  const head = card.querySelector(':scope > .phead');
  if (head) out.push(head);
  const body = card.querySelector('[aria-live]');
  if (body) for (const el of body.children) { if (el.tagName === 'UL') out.push(...el.children); else out.push(el); }
  return out.filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
}

function develop(run) {
  const scene = run.root.querySelector(':scope > .scene');
  if (!scene || !scene.getClientRects().length) return;
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  const wrap = wrapOf(run.root);
  if (wrap) for (const el of wrap.children) if (el !== run.node) play(el, fade, { dur: DUR.gentle, fill: 'backwards' });
  for (const el of scene.querySelectorAll(':scope > .sc-stage > :is(.question, .dock, .credit)')) play(el, fade, { dur: DUR.gentle, delay: STAGGER.each, fill: 'backwards' });
  const card = scene.querySelector(':scope > .card');
  if (card) stagger(bandsOf(card), { dur: DUR.base, y: 8, delay: STAGGER.each * 2 });
}

function retire(run) {
  const node = run.node;
  if (!run.shown || !node.isConnected) { node.remove(); return; }
  node.classList.add('done');
  const out = play(node, [{ opacity: 1 }, { opacity: 0 }], { dur: DUR.gentle, fill: 'forwards' });
  if (out) out.finished.then(() => node.remove(), () => node.remove()); else node.remove();
}

function settle(m) {
  const run = runs[m];
  if (!run) return null;
  delete runs[m];
  clearTimeout(run.grace); clearTimeout(run.slowT); clearTimeout(run.fallback);
  run.mo.disconnect();
  if (sizer && run.node.parentElement) sizer.unobserve(run.node.parentElement);
  run.root.classList.remove('waiting');
  const note = document.getElementById(LOADS[m]);
  if (note) note.hidden = true;
  return run;
}

export function reveal(m) {
  const run = settle(m);
  if (!run) return;
  const climbing = !!document.querySelector('.floor-climb');
  if (run.shown || !climbing) develop(run);
  retire(run);
  performance.mark(`floor-reveal:${m}`);
}

export function fail(m) {
  const run = settle(m);
  if (run) run.node.remove();
}

export function floorDrawn(m) {
  if (drawn.has(m)) return;
  drawn.add(m);
  performance.mark(`floor-drawn:${m}`);
  if (runs[m]) reveal(m);
}

export const isDrawn = (m) => drawn.has(m);
