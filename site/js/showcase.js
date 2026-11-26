import * as K from './kit.js';
import { ticker } from './motion.js';

export async function loadShowcase() {
  try { return await K.loadJson('data/showcase.json'); } catch { return null; }
}

export function rgbOf(color) {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillStyle = color; g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
export function mixColor(a, b, t) {
  const x = rgbOf(a), y = rgbOf(b);
  return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`;
}

export function makeWeights(n) {
  return { n, w: new Float32Array(n), tgt: new Float32Array(n).fill(1), delay: new Float32Array(n), rip0: -1e9, last: 0 };
}
export function resizeWeights(W, n) {
  if (W.n === n) return W;
  const V = makeWeights(n);
  V.w.set(W.w.subarray(0, Math.min(n, W.n))); V.tgt.set(W.tgt.subarray(0, Math.min(n, W.n)));
  return V;
}

export function lodPass(W, o) {
  const { rank, n0, k, total, ok, x, y, wpx, hpx, forced, all } = o;
  W.tgt.fill(0);
  let accepted = 0;
  if (all) {
    for (let p = 0; p < rank.length; p++) { const i = rank[p]; if (ok(i)) { W.tgt[i] = 1; accepted++; } }
  } else {
    const budget = Math.min(total, Math.round(n0 * Math.pow(Math.max(1, k), 1.5)));
    const cells = new Map(), picked = [];
    for (let p = 0; p < rank.length && picked.length < budget; p++) {
      const i = rank[p];
      if (!ok(i)) continue;
      const xi = x[i], yi = y[i];
      if (xi < -12 || yi < -12 || xi > wpx + 12 || yi > hpx + 12) continue;
      const key = Math.floor(xi / 24) * 4096 + Math.floor(yi / 24);
      const c = cells.get(key) || 0;
      if (c >= 2) continue;
      cells.set(key, c + 1);
      picked.push(i);
    }
    const band = Math.max(1, 0.15 * budget);
    for (let q = 0; q < picked.length; q++) {
      const rest = budget - q;
      W.tgt[picked[q]] = rest < band ? 0.5 + 0.5 * rest / band : 1;
    }
    accepted = picked.length;
  }
  for (const i of forced) if (i >= 0 && i < W.n) W.tgt[i] = 1;
  return accepted;
}

export function ripple(W, rankPos, total, on, now, flat = false) {
  W.rip0 = now;
  for (let i = 0; i < W.n; i++) {
    const p = rankPos[i] / Math.max(1, total);
    W.delay[i] = K.reduceMotion || flat ? 0 : 400 * (on ? p : 1 - p);
  }
}

export function stepWeights(W, now) {
  const dt = Math.min(100, W.last ? now - W.last : 16);
  W.last = now;
  const tau = K.reduceMotion ? 50 : 250, f = 1 - Math.exp(-dt / tau);
  let moving = false;
  const since = now - W.rip0;
  for (let i = 0; i < W.n; i++) {
    if (since < W.delay[i]) { moving = true; continue; }
    const d = W.tgt[i] - W.w[i];
    if (d > 0.004 || d < -0.004) { W.w[i] += d * f; moving = true; } else W.w[i] = W.tgt[i];
  }
  return moving;
}

const NUM = /\d[\d,.]*\d|\d/g;
function tickNum(el, str, first = false) {
  const dec = (str.split('.')[1] || '').length, v = parseFloat(str.replace(/,/g, ''));
  ticker(el, v, { first, format: (x) => (dec ? x.toFixed(dec) : K.fmtN(Math.round(x))) });
}

export function makePill(host, { onToggle, onBack }) {
  const el = document.createElement('div');
  el.className = 'showcase';
  el.innerHTML = '<span class="sc-txt"></span><button class="link" type="button"></button>';
  host.prepend(el);
  const txt = el.querySelector('.sc-txt'), btn = el.querySelector('button');
  let mode = 'show', lastSet = 0, pending = null;
  btn.addEventListener('click', () => (mode === 'back' ? onBack() : onToggle()));
  let tpl = '';
  const apply = (t, b, m) => {
    const nums = t.match(NUM) || [], shape = t.replace(NUM, '#'), cells = txt.querySelectorAll('b');
    if (shape === tpl && cells.length === nums.length) nums.forEach((n, k) => tickNum(cells[k], n));
    else {
      txt.innerHTML = K.esc(t).replace(NUM, (n) => `<b>${n}</b>`);
      txt.querySelectorAll('b').forEach((c, k) => tickNum(c, nums[k], true));
    }
    tpl = shape; btn.textContent = b; mode = m; lastSet = performance.now();
  };
  return {
    el,
    set(t, b, m) {
      const now = performance.now();
      clearTimeout(pending);
      if (now - lastSet >= 250 || m !== mode) apply(t, b, m);
      else pending = setTimeout(() => apply(t, b, m), 250 - (now - lastSet));
    },
  };
}

export function pillCopy({ phone, all, guided, accepted, total, n0, noun = 'most unusual', zoomed }) {
  const N = K.fmtN(total);
  if (guided) return ['Guided view', 'Back to the showcase', 'back'];
  if (all) return [phone ? `All ${N}` : `All ${N} shown`, phone ? 'Unusual only' : 'Most unusual only', 'hide'];
  if (phone) return [`${K.fmtN(accepted)} of ${N}`, 'Show all', 'show'];
  if (zoomed && accepted > n0) return [`Showing ${K.fmtN(accepted)} of ${N} at this zoom`, 'Show all', 'show'];
  return [`Showing ${K.fmtN(accepted)} ${noun} of ${N}`, 'Show all', 'show'];
}

export function chipsHtml(chips) {
  return chips.length ? `<div class="why">${chips.slice(0, 3).map((c, k) => `<span class="chip${k === 0 ? ' lead' : ''}" title="${K.esc(c)}">${K.esc(c)}</span>`).join('')}</div>` : '';
}
