import { wireChip, health, quietNights, RUBIN_FLOORS } from './quiet.js';
import { C, MON, clamp, nightMjd, esc, onKey, onTheme, shell, hatch, text, font, setupCanvas, showTip, hideTip, pencilLine } from './kit.js';

const PLAY_D = 'M8 5.5v13l10.5-6.5z', PAUSE_D = 'M8 5.5v13M16 5.5v13';
const docks = {};
const body = document.body;

export function dockHtml({ play, date, track, speed, label, live = false }) {
  const pin = live ? `<button id="${live}" class="btn elive" type="button" aria-pressed="false" aria-label="Live: now" title="Live: now (L)"><i aria-hidden="true"></i><span>Live</span></button>` : '';
  return `<button id="${play}" class="btn play" type="button" aria-label="Play" title="Play or pause (Space)"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path class="pl" d="${PLAY_D}"/></svg><span>Play</span></button>
<output id="${date}" class="date"></output>
<div class="trk"><canvas id="${track}" class="track" tabindex="0" role="slider" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="0"></canvas>${pin}</div>
<button id="${speed}" class="btn spd" type="button" title="Playback speed: click, or [ and ]"></button>`;
}

export const fmtSpeed = (unit, units) => (v) => `${v} ${v === 1 ? unit : units}/s`;

export const LOOP_NIGHTS = 30;
export const LOOP_NOTE = `Replaying the last ${LOOP_NIGHTS} nights with data`;
export function dataLoop(days, gaps = []) {
  const d = [...new Set(days.map((t) => Math.floor(t)))].sort((a, b) => a - b);
  if (!d.length) return null;
  return { from: d[Math.max(0, d.length - LOOP_NIGHTS)], end: d[d.length - 1] + 1, gap: (t) => gaps.find(([a, b]) => t >= a && t < b) || null };
}

function showNote(d, txt) {
  if (!d.note) {
    d.note = document.createElement('span');
    d.note.className = 'dock-note';
    d.note.setAttribute('role', 'status');
    (d.root.querySelector('.trk') || d.root).appendChild(d.note);
  }
  d.note.textContent = txt;
  d.note.classList.add('on');
  clearTimeout(d.noteT);
  d.noteT = setTimeout(() => { d.note.classList.remove('on'); d.noteT = setTimeout(() => { d.note.textContent = ''; }, 400); }, 3000);
}

function speedIdx(d) {
  const v = d.o.speed(), L = d.o.speeds;
  let k = 0;
  for (let i = 1; i < L.length; i++) if (Math.abs(Math.log(L[i] / v)) < Math.abs(Math.log(L[k] / v))) k = i;
  return k;
}
function setSpeedIdx(d, k) {
  const L = d.o.speeds;
  d.o.setSpeed(L[clamp(k, 0, L.length - 1)]);
  sync(d, true);
}

function geometry(d) {
  if (d.o.paint) return d.geo;
  const s = d.o.trackState && d.o.trackState();
  return s && s.__inv ? { T: s.__inv, X: s.__X } : null;
}

function dateEm(d, list) {
  const m = d.root.appendChild(document.createElement('output'));
  m.className = 'date';
  m.style.cssText = 'position:absolute;visibility:hidden;min-width:0;width:auto;flex:none';
  let w = 0;
  for (const s of list) { m.textContent = s; w = Math.max(w, m.getBoundingClientRect().width); }
  const fs = parseFloat(getComputedStyle(m).fontSize) || 16;
  m.remove();
  return w / fs;
}
function fitDate(d, a, b, txt) {
  const key = `${a}|${b}`;
  if (d.dateKey !== key) {
    d.dateKey = key;
    const list = [txt];
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) for (let i = 0; i <= 96; i++) list.push(d.o.fmt(a + (b - a) * i / 96));
    d.dateMax = Math.max(...list.map((s) => s.length));
    d.dateW = dateEm(d, list);
  } else if (txt.length > d.dateMax) {
    d.dateMax = txt.length;
    d.dateW = Math.max(d.dateW, dateEm(d, [txt]));
  } else return;
  d.date.style.minWidth = `${(d.dateW + 0.1).toFixed(2)}em`;
}

if (document.fonts) document.fonts.ready.then(() => { for (const d of Object.values(docks)) if (d.dateKey) { d.dateKey = ''; fitDate(d, d.o.t0(), d.o.t1(), d.date.textContent); } });

function sync(d, force = false) {
  const now = performance.now();
  if (!force && now - d.at < 200) {
    if (!d.later) d.later = setTimeout(() => { d.later = 0; sync(d, true); }, 200 - (now - d.at));
    return;
  }
  if (d.later) { clearTimeout(d.later); d.later = 0; }
  d.at = now;
  const o = d.o, p = o.playing();
  if (p !== d.wasP) {
    d.wasP = p;
    d.play.querySelector('span').textContent = p ? 'Pause' : 'Play';
    d.play.querySelector('path.pl').setAttribute('d', p ? PAUSE_D : PLAY_D);
    d.play.setAttribute('aria-label', p ? 'Pause' : 'Play');
    d.play.classList.toggle('on', p);
  }
  const t = o.get(), txt = o.fmt(t);
  const a = o.t0(), b = o.t1();
  if (d.date.textContent !== txt) { d.date.textContent = txt; fitDate(d, a, b, txt); }
  d.cv.setAttribute('aria-valuenow', String(Math.round(clamp((t - a) / (b - a), 0, 1) * 1000)));
  d.cv.setAttribute('aria-valuetext', o.valueText ? o.valueText(t) : txt);
  const v = o.speed(), sl = o.speedText(v);
  if (d.spd.textContent !== sl) {
    d.spd.textContent = sl;
    d.spd.setAttribute('aria-label', `Playback speed ${sl}. Click for ${speedIdx(d) === o.speeds.length - 1 ? 'the slowest' : 'faster'}.`);
  }
  if (d.live) {
    const on = !!o.live.on();
    d.live.classList.toggle('on', on);
    d.live.setAttribute('aria-pressed', String(on));
  }
}

function paintStatic(d, s) {
  const P = d.o.paint, [a, b0] = P.domain(), quiet = d.quiet, L = 6, R = s.w - 6;
  const b = quiet.length ? Math.max(b0, quiet[quiet.length - 1] + 1) : b0;
  const X = (t) => L + (t - a) / (b - a) * (R - L);
  const marks = P.marks ? P.marks() : null, lane = P.lane ? P.lane() : null;
  const top = 8, lbl = 13, base = s.h - lbl - (marks || quiet.length ? 10 : 4);
  const split = lane ? Math.round(top + (base - top) * 0.46) : base;
  d.geo = { X, T: (x) => a + (x - L) / (R - L) * (b - a), top, base, L, R };
  const off = d.off && d.off.width === s.cv.width && d.off.height === s.cv.height ? d.off : document.createElement('canvas');
  off.width = s.cv.width; off.height = s.cv.height;
  const g = off.getContext('2d');
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); g.clearRect(0, 0, s.w, s.h);
  const shade = (x0, x1, words) => {
    if (x1 - x0 < 1) return;
    g.fillStyle = hatch(g, C.line, 5, 45, 1); g.fillRect(x0, top, x1 - x0, base - top);
    g.font = font(11);
    if (words && x1 - x0 > g.measureText(words).width + 12 && s.w >= 420) text(g, words, (x0 + x1) / 2, top + 12, { size: 11, color: C.ink2, align: 'center', halo: true });
  };
  const win = P.solid ? P.solid() : [a, b];
  shade(X(a), X(Math.max(a, win[0])), P.outBefore || '');
  shade(X(Math.min(b, win[1])), X(b), P.outAfter || '');
  for (const [g0, g1] of P.gaps ? P.gaps() : []) shade(X(g0), X(g1), s.w >= 600 ? `no data · ${Math.round(g1 - g0)} nights` : '');
  const bars = P.bars();
  let mx = 0;
  for (const [, v] of bars) if (v > mx) mx = v;
  if (mx > 0) {
    const sc = P.scale === 'log' ? (v) => Math.log10(1 + v) / Math.log10(1 + mx) : (v) => Math.sqrt(v / mx);
    const bw = Math.max(1, (R - L) * (P.bin || 1) / (b - a) - 0.4), h = split - top - 2;
    g.fillStyle = P.barColor ? P.barColor() : C.ink3; g.globalAlpha = 0.75;
    for (const [t, v] of bars) { if (v <= 0) continue; const y = Math.max(1, sc(v) * h); g.fillRect(X(t), split - y, bw, y); }
    g.globalAlpha = 1;
  }
  pencilLine(g, L, split, R, split, { color: C.goldSoft, width: 1.1 });
  if (lane && lane.pts.length) {
    const y0 = split + 2, y1 = base, mid = (y0 + y1) / 2, lim = lane.lim(lane.pts), Y = (v) => mid - clamp(v / lim, -1, 1) * (y1 - y0) / 2;
    g.fillStyle = C.accent; g.globalAlpha = 0.32;
    let prev = null;
    for (const [t, v] of lane.pts) { if (v < 0 && (prev == null || t - prev <= lane.gap)) g.fillRect(X(t) - 0.5, mid, Math.max(1, X(t + lane.step) - X(t)), Y(v) - mid); prev = t; }
    g.globalAlpha = 1;
    pencilLine(g, L, mid, R, mid, { color: C.grid, width: 1 });
    g.strokeStyle = C.ink2; g.lineWidth = 1; g.beginPath(); prev = null;
    for (const [t, v] of lane.pts) { const x = X(t), y = Y(v); if (prev == null || t - prev > lane.gap) g.moveTo(x, y); else g.lineTo(x, y); prev = t; }
    g.stroke();
    if (s.w >= 360) text(g, lane.label, L + 2, y1 - 1, { size: 10.5, color: C.ink3, halo: true });
  }
  if (marks && marks.length) {
    let pm = 0;
    for (const [, v] of marks) if (v > pm) pm = v;
    g.fillStyle = C.gold;
    for (const [t, v] of marks) { const r = 0.7 + Math.sqrt(v / pm) * 2.4; g.beginPath(); g.arc(X(t + 0.5), base + 6, r, 0, 6.283); g.fill(); }
  }
  if (quiet.length) {
    const qr = clamp((R - L) / (b - a) * 0.42, 1, 2.2);
    g.fillStyle = C.paper; g.strokeStyle = C.ink3; g.lineWidth = 1; g.beginPath();
    for (const t of quiet) { if (t < a) continue; const x = X(t + 0.5); g.moveTo(x + qr, base + 6); g.arc(x, base + 6, qr, 0, 6.283); }
    g.fill(); g.stroke();
  }
  ticks(g, s, P.ticks, a, b, X);
  d.off = off;
}

function ticks(g, s, kind, a, b, X) {
  const y = s.h - 2, out = [];
  if (kind === 'hour') {
    const step = s.w < 420 ? 6 : 3;
    for (let t = Math.ceil(a / 3600) * 3600; t <= b; t += 3600) {
      const h = new Date(t * 1000).getUTCHours();
      if (h % step) continue;
      out.push([t, `${String(h).padStart(2, '0')}:00`]);
    }
  } else {
    const d0 = new Date((a - 40587) * 864e5);
    for (let y0 = d0.getUTCFullYear(), m = d0.getUTCMonth(); ; m++) {
      const t = Date.UTC(y0, m, 1) / 864e5 + 40587;
      if (t > b) break;
      if (t < a - 0.01) continue;
      const mm = ((m % 12) + 12) % 12;
      out.push([t, mm === 0 ? `${MON[0]} ${y0 + Math.floor(m / 12)}` : MON[mm], mm]);
    }
  }
  if (!out.length) return;
  const gap = (X(b) - X(a)) / out.length, every = kind === 'hour' ? 1 : gap > 34 ? 1 : gap > 17 ? 2 : gap > 9 ? 3 : 6;
  g.font = font(11);
  let lastR = -1e9;
  for (const [t, l, mm] of out) {
    const x = X(t);
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, y - 12); g.lineTo(Math.round(x) + 0.5, y - 9); g.stroke();
    if (kind !== 'hour' && mm % every && mm !== 0) continue;
    const w = g.measureText(l).width;
    if (x + 2 < lastR + 6 || x + 2 + w > s.w) continue;
    text(g, l, x + 2, y, { size: 11, color: C.ink3 });
    lastR = x + 2 + w;
  }
}

function paint(d, s) {
  if (!s.w) return;
  const P = d.o.paint, key = [s.w, s.h, s.dpr, C.dark, d.quiet.length, P.key()].join('|');
  if (key !== d.key || !d.off) { d.key = key; paintStatic(d, s); }
  const g = s.ctx, { X, top, base } = d.geo;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(d.off, 0, 0, s.w, s.h);
  const sel = P.sel ? P.sel() : null;
  if (sel && sel.length) { g.fillStyle = C.hi; for (const t of sel) g.fillRect(X(t) - 0.5, base + 2, 2, 4); }
  const x = Math.round(X(d.o.cursor ? d.o.cursor() : d.o.get())) + 0.5;
  const cc = P.cursorColor ? P.cursorColor() : C.hi;
  g.strokeStyle = cc; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, base + 4); g.stroke();
  g.fillStyle = cc; g.beginPath(); g.moveTo(x - 5, top - 6); g.lineTo(x + 5, top - 6); g.lineTo(x, top); g.fill();
}

function step(d, dir, big) {
  const o = d.o;
  if (o.step) { o.step(dir, big); return; }
  const n = big ? o.big : o.unit, t = o.get() + dir * n;
  o.set(o.snap ? o.snap(t) : t);
}

function scrubTo(d, e) {
  const geo = geometry(d);
  if (!geo) return;
  const r = d.cv.getBoundingClientRect(), t = geo.T(e.clientX - r.left);
  if (d.o.scrub) d.o.scrub(t); else d.o.set(clamp(t, d.o.t0(), d.o.t1()));
  update(d, true);
}

function wire(d) {
  const { o, cv } = d;
  d.play.addEventListener('click', () => { o.play(!o.playing()); sync(d, true); });
  d.spd.addEventListener('click', () => { const k = speedIdx(d); setSpeedIdx(d, k === o.speeds.length - 1 ? 0 : k + 1); });
  if (d.live) d.live.addEventListener('click', () => { o.live.set(!o.live.on()); update(d, true); });
  let drag = false;
  cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); scrubTo(d, e); });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { scrubTo(d, e); return; }
    if (e.pointerType !== 'mouse' || !o.tip) return;
    const geo = geometry(d);
    if (!geo) return;
    const r = cv.getBoundingClientRect(), html = o.tip(geo.T(e.clientX - r.left));
    if (html) showTip(html, e.clientX, e.clientY); else hideTip();
  });
  const end = () => { drag = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (o.tip) hideTip(); });
  cv.addEventListener('keydown', (e) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); step(d, e.key === 'PageUp' ? 1 : -1, true); update(d, true); }
  });
}

export function makeDock(m, o) {
  const root = document.querySelector(`.scene[data-floor="${m}"] .dock`);
  const d = {
    m, o, root, at: 0, wasP: null, key: '', off: null, geo: null, quiet: [],
    play: root.querySelector('.btn.play'), date: root.querySelector('output.date'), cv: root.querySelector('canvas.track'),
    spd: root.querySelector('.spd'), live: root.querySelector('.elive'),
  };
  o.speedText = o.speedText || ((v) => String(v));
  if (o.paint) d.s = setupCanvas(d.cv, (s) => paint(d, s));
  docks[m] = d;
  wire(d);
  wireChip(m, root, d.spd);
  if (o.paint && RUBIN_FLOORS.includes(m)) loadQuiet(d);
  const api = {
    update: (force) => update(d, force),
    sync: () => sync(d, true),
    invalidate: () => { d.key = ''; update(d, true); },
    resize: () => { if (d.s) d.s.resize(); },
    setSpeed: (v) => { o.setSpeed(v); sync(d, true); },
    note: (txt) => showNote(d, txt),
    el: root,
  };
  sync(d, true);
  return api;
}

function loadQuiet(d) {
  health().then((h) => {
    const n = quietNights(h);
    if (!n) return;
    const since = nightMjd(+h.verdict.since);
    d.quiet = Array.from({ length: n }, (_, k) => since + 1 + k);
    d.key = '';
    if (d.s && d.s.w) update(d, true);
  });
}

function update(d, force = false) {
  if (d.s) paint(d, d.s);
  sync(d, force);
}

const active = () => { const d = docks[body.dataset.mode]; return d && d.root.isConnected && d.root.getClientRects().length ? d : null; };
const OWN_ARROWS = '.drawer, .pop, [role=dialog], [role=tablist], [role=radiogroup], [role=radio], [role=listbox], [role=menu], [role=slider]:not(.track), .ladder, .card, button:not(.dock button)';
const PRESSABLE = 'button, a[href], summary, [role=button], [role=tab], [role=radio], [role=option], [role=checkbox], [role=switch], [role=menuitem]';
const targetOf = (e) => (e.target instanceof Element ? e.target : body);

function togglePlay(e) {
  const d = active();
  if (!d || (e && targetOf(e).closest(PRESSABLE))) return false;
  d.o.play(!d.o.playing());
  sync(d, true);
  return true;
}
function arrow(dir) {
  return (e) => {
    const d = active();
    if (!d || targetOf(e).closest(OWN_ARROWS)) return false;
    step(d, dir, e.shiftKey);
    update(d, true);
    return true;
  };
}
function jump(end) {
  return (e) => {
    const d = active();
    if (!d || (e && targetOf(e).closest(OWN_ARROWS))) return false;
    d.o.set(end ? (d.o.end ? d.o.end() : d.o.t1()) : d.o.t0());
    update(d, true);
    return true;
  };
}
function speedBy(k) {
  return () => {
    const d = active();
    if (!d) return false;
    setSpeedIdx(d, speedIdx(d) + k);
    return true;
  };
}
function goLive() {
  const d = active();
  if (!d || !d.o.live) return false;
  d.o.live.set(!d.o.live.on());
  update(d, true);
  return true;
}

onKey(' ', togglePlay);
onKey('arrowleft', arrow(-1));
onKey('arrowright', arrow(1));
onKey('home', jump(false));
onKey('end', jump(true));
onKey('[', speedBy(-1));
onKey(']', speedBy(1));
onKey('l', goLive);
onTheme(() => { for (const m in docks) { docks[m].key = ''; if (docks[m].s && docks[m].s.w) update(docks[m], true); } });

shell.keyHelp = shell.keyHelp || [];
shell.keyHelp.push(
  { keys: ['['], label: 'Play slower', kw: 'speed slower playback time dock', run: speedBy(-1) },
  { keys: [']'], label: 'Play faster', kw: 'speed faster playback time dock', run: speedBy(1) },
  { keys: ['Home'], label: 'Go to the start of the time track', kw: 'time start beginning season first', run: () => jump(false)() },
  { keys: ['End'], label: 'Go to the latest data', kw: 'time end latest night last newest', run: () => jump(true)() },
);
