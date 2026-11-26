export const DUR = { instant: 80, quick: 140, base: 220, gentle: 360, travel: 600, fade: 120, count: 2200 };
export const EXIT = 0.6;
export const STAGGER = { each: 24, max: 8 };
const CURVES = { out: [0.2, 0.8, 0.2, 1], in: [0.4, 0, 1, 1], io: [0.65, 0, 0.35, 1] };
export const CSS_EASE = Object.fromEntries(Object.entries(CURVES).map(([k, c]) => [k, `cubic-bezier(${c.join(', ')})`]));

function bezier([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}
export const ease = Object.fromEntries(Object.entries(CURVES).map(([k, c]) => [k, bezier(c)]));
ease.linear = (x) => Math.min(1, Math.max(0, x));
export const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

export const climbMs = (decades) => Math.min(1400, DUR.travel + 35 * decades);
export const flightMs = (octaves) => Math.min(1200, 400 + 120 * Math.max(0, octaves));

const rmq = matchMedia('(prefers-reduced-motion: reduce)');
export let reduced = rmq.matches;
const reducedHooks = new Set();
export const onReduced = (fn) => { reducedHooks.add(fn); return () => reducedHooks.delete(fn); };
rmq.addEventListener('change', (e) => { reduced = e.matches; reducedHooks.forEach((f) => f(reduced)); });

const jobs = new Set();
let raf = 0;
function frame(now) {
  raf = 0;
  for (const j of [...jobs]) j(now);
  if (jobs.size) raf = requestAnimationFrame(frame);
}
function schedule(job) {
  jobs.add(job);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => jobs.delete(job);
}

export function tween({ from = 0, to = 1, dur = DUR.base, curve = 'out', delay = 0, step, done } = {}) {
  const f = typeof curve === 'function' ? curve : ease[curve];
  let t0 = null, over = false, stop = null;
  const finish = () => {
    if (over) return;
    over = true;
    if (stop) stop();
    if (step) step(to, 1);
    if (done) done();
  };
  if (reduced || dur <= 0) { finish(); return { cancel: () => {}, finish: () => {}, get running() { return false; } }; }
  stop = schedule((now) => {
    if (t0 == null) t0 = now + delay;
    const p = Math.min(1, Math.max(0, (now - t0) / dur));
    if (p >= 1) { finish(); return; }
    if (step) step(from + (to - from) * f(p), p);
  });
  return {
    cancel: () => { over = true; if (stop) stop(); },
    finish,
    get running() { return !over; },
  };
}

const ticking = new WeakMap();
export function ticker(el, value, { format = String, dur = DUR.gentle, first = false } = {}) {
  if (!el) return;
  const prev = ticking.get(el);
  const from = prev ? prev.shown : null;
  if (prev && prev.job) prev.job.cancel();
  const text = format(value);
  if (from == null || !Number.isFinite(from) || !Number.isFinite(value) || from === value || reduced || first) {
    ticking.set(el, { shown: value, job: null });
    if (el.textContent !== text) el.textContent = text;
    return;
  }
  const rec = { shown: from, job: null };
  ticking.set(el, rec);
  rec.job = tween({ from, to: value, dur, curve: 'out', step: (v) => { rec.shown = v; const s = format(v === value ? value : v); if (el.textContent !== s) el.textContent = s; } });
}
export const tickerValue = (el) => (ticking.get(el) || {}).shown;

export function play(el, frames, { dur = DUR.base, curve = 'out', delay = 0, fill = 'both', exit = false } = {}) {
  if (!el || !el.animate) return null;
  if (reduced) {
    const op = frames.map((f) => ({ opacity: f.opacity == null ? 1 : f.opacity }));
    if (op.every((f) => f.opacity === op[0].opacity)) return null;
    return el.animate(op, { duration: DUR.fade, fill });
  }
  return el.animate(frames, { duration: exit ? Math.round(dur * EXIT) : dur, delay, easing: CSS_EASE[exit ? 'in' : curve], fill });
}

export function stagger(items, { each = STAGGER.each, max = STAGGER.max, dur = DUR.base, x = 0, y = 6, delay = 0, exit = false } = {}) {
  const list = [...items].filter((e) => e && e.animate);
  if (reduced || !list.length) return [];
  const from = { opacity: 0, transform: `translate(${x}px, ${y}px)` }, to = { opacity: 1, transform: 'none' };
  return list.map((e, i) => play(e, exit ? [to, from] : [from, to], { dur, delay: delay + Math.min(i, max - 1) * each, exit, fill: exit ? 'forwards' : 'backwards' }));
}

export function popFrom(el, origin, { dur = DUR.base } = {}) {
  if (!el) return null;
  if (origin) {
    const a = origin.getBoundingClientRect(), b = el.getBoundingClientRect();
    if (b.width && b.height) {
      const ox = Math.min(b.width, Math.max(0, a.left + a.width / 2 - b.left));
      const oy = Math.min(b.height, Math.max(0, a.top + a.height / 2 - b.top));
      el.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
    }
  }
  return play(el, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { dur, fill: 'backwards' });
}

export function slideThumb(seg) {
  const thumb = seg.querySelector(':scope > .seg-thumb');
  const on = seg.querySelector(':scope > [aria-checked="true"], :scope > .on, :scope > [aria-pressed="true"]');
  if (!thumb) return;
  if (!on || !on.offsetWidth) { thumb.style.opacity = '0'; seg.dataset.thumb = ''; return; }
  const x = on.offsetLeft, w = on.offsetWidth, h = on.offsetHeight, y = on.offsetTop;
  const key = `${x}|${w}|${y}|${h}`;
  if (seg.dataset.thumb === key) return;
  const prev = seg.dataset.thumb ? seg.dataset.thumb.split('|').map(Number) : null;
  seg.dataset.thumb = key;
  Object.assign(thumb.style, { opacity: '1', width: `${w}px`, height: `${h}px`, transform: `translate(${x}px, ${y}px)` });
  if (prev && prev[1] && !reduced) {
    thumb.animate([{ transform: `translate(${prev[0]}px, ${y}px) scaleX(${prev[1] / w})` }, { transform: `translate(${x}px, ${y}px)` }], { duration: DUR.base, easing: CSS_EASE.out });
  }
}

export function watchSegments(root = document.body) {
  const seen = new WeakSet();
  const prep = (seg) => {
    if (!seen.has(seg)) {
      seen.add(seg);
      if (!seg.querySelector(':scope > .seg-thumb')) seg.insertAdjacentHTML('afterbegin', '<span class="seg-thumb" aria-hidden="true"></span>');
      new ResizeObserver(() => { seg.dataset.thumb = ''; slideThumb(seg); }).observe(seg);
    }
    slideThumb(seg);
  };
  root.querySelectorAll('.seg').forEach(prep);
  let queued = false;
  const pending = new Set();
  new MutationObserver((list) => {
    for (const m of list) {
      const t = m.target instanceof Element ? m.target : null;
      if (!t) continue;
      const seg = t.classList.contains('seg') ? t : t.parentElement && t.parentElement.classList.contains('seg') ? t.parentElement : null;
      if (seg) pending.add(seg);
      if (m.type === 'childList') for (const n of m.addedNodes) if (n instanceof Element) { if (n.classList.contains('seg')) pending.add(n); n.querySelectorAll && n.querySelectorAll('.seg').forEach((s) => pending.add(s)); }
    }
    if (!pending.size || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; for (const s of pending) if (s.isConnected) prep(s); pending.clear(); });
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'aria-pressed', 'class'] });
}

export function slideTab(tabs) {
  const line = tabs.querySelector(':scope > .tab-line');
  const on = tabs.querySelector('[aria-selected="true"]');
  if (!line || !on) return;
  const x = on.offsetLeft, w = on.offsetWidth;
  const prev = line.dataset.at ? line.dataset.at.split('|').map(Number) : null;
  line.dataset.at = `${x}|${w}`;
  Object.assign(line.style, { width: `${w}px`, transform: `translateX(${x}px)`, opacity: '1' });
  if (prev && prev[1] && (prev[0] !== x || prev[1] !== w) && !reduced) {
    line.animate([{ transform: `translateX(${prev[0]}px) scaleX(${prev[1] / w})` }, { transform: `translateX(${x}px)` }], { duration: DUR.base, easing: CSS_EASE.out });
  }
}
