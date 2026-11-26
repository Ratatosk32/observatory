import { reduceMotion, esc, ns, perf, pushPerf } from './kit.js';
import { lookbackGyr, comovingLy, KM_PER_LY, KM_PER_AU } from './cosmo.js';

const uKm = (km) => Math.log10(km);
const uLy = (ly) => Math.log10(ly * KM_PER_LY);
const uLt = (z) => uLy(lookbackGyr(z) * 1e9);
const uCm = (z) => uLy(comovingLy(z));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (p) => p * p * (3 - 2 * p);
const r1 = (v) => Math.round(v * 10) / 10;

export const U = { max: uCm(1090) + 0.05, fork: uLt(0.03), cmbLt: uLt(1090), cmbCm: uCm(1090), hidden: uKm(70) };
export const FLOORS = [
  { name: 'Lightning', sub: '10–15 km', a: uKm(10), b: uKm(15) },
  { name: 'Aurora', sub: '100–300 km', a: uKm(100), b: uKm(300) },
  { name: 'Solar wind at L1', sub: '1.5 million km', a: uKm(1.5e6), b: uKm(1.5e6), tick: true },
  { name: 'Asteroids', sub: '0.02–6 AU from Earth', a: uKm(0.02 * KM_PER_AU), b: uKm(6 * KM_PER_AU) },
  { name: 'Variable stars', sub: '30–100,000 ly', a: uLy(30), b: uLy(1e5) },
  { name: 'Supernovae, AGN', sub: '0.1–11 Gyr of light', a: uLy(1e8), b: uLt(3) },
  { name: 'Galaxy clusters', sub: '0.7–10 Gyr of light', a: uLt(0.05), b: uLt(2) },
  { name: 'The CMB', sub: '13.5 Gyr of light', extra: 'now ~44 Gly away (comoving)', a: uLt(1090), b: uLt(1090), tick: true, cmb: true },
];
const LANDMARKS = [['Moon', uKm(384400)], ['Voyager 1', uKm(2.5e10)], ['1 light-year', uLy(1)], ['Galactic centre', uLy(26000)], ['Andromeda', uLy(2.5e6)]];
const DECADES = [[uKm(10), '10 km'], [uKm(1000), '1,000 km'], [uKm(1e6), '1 M km'], [uKm(KM_PER_AU), '1 AU'], [uLy(1), '1 ly'], [uLy(1000), '1,000 ly'], [uLy(1e6), '1 Mly'], [uLy(1e9), '1 Gly'], [uLy(1e10), '10 Gly']];
const ZTICKS = [0.1, 0.5, 1, 2, 1090];
const FLOOR_ORDER = ['earth', 'asteroids', 'stars', 'dm'];
export const MODES = {
  dm: { name: 'Dark matter', floor: 'dark matter', band: [uLt(0.05), U.cmbCm], icon: 23.25, inner: true, measure: 'light travel' },
  stars: { name: 'Stars & beyond', floor: 'stars', band: [uLy(30), uLt(3)], icon: 19.6, measure: 'light travel' },
  asteroids: { name: 'Asteroids', floor: 'asteroids', band: [uKm(0.02 * KM_PER_AU), uKm(6.2 * KM_PER_AU)], measure: 'from Earth' },
  earth: { name: 'Earth', floor: 'Earth', band: [uKm(5), uKm(1.6e6)], measure: 'above the ground' },
};
for (const k in MODES) { const m = MODES[k]; if (m.icon == null) m.icon = (m.band[0] + m.band[1]) / 2; }
const HOW_WORDS = { measured: 'measured', indirect: 'indirect', weak: 'weak', typical: 'typical, not measured', model: 'from a model', live: 'live' };

function fmtParts(u) {
  const km = 10 ** u, ly = km / KM_PER_LY;
  if (km < 1e7) return km >= 1e6 ? [`${r1(km / 1e6)}`, 'M km'] : [Math.round(km).toLocaleString('en-US'), 'km'];
  if (ly < 0.05) { const au = km / KM_PER_AU; return [au < 10 ? au.toFixed(2) : Math.round(au).toLocaleString('en-US'), 'AU']; }
  if (ly < 1e6) return [ly < 10 ? ly.toFixed(1) : Math.round(ly).toLocaleString('en-US'), 'ly'];
  if (ly < 1e9) return [ly < 1e7 ? (ly / 1e6).toFixed(1) : Math.round(ly / 1e6).toLocaleString('en-US'), 'Mly'];
  return [(ly / 1e9).toFixed(1), 'Gyr'];
}
const fmtU = (u) => fmtParts(u).join(' ');
function wordsOf(u, light) {
  const km = 10 ** u, ly = km / KM_PER_LY;
  if (!light || ly < 0.05) return fmtU(u).replace(' M km', ' million km');
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(1)} billion years`;
  if (ly >= 1e6) return `${Math.round(ly / 1e6).toLocaleString('en-US')} million years`;
  return `${Math.round(ly).toLocaleString('en-US')} years`;
}

function labelLayout(y, top, bottom) {
  const items = FLOORS.map((f) => ({ y: (y(f.a) + y(f.b)) / 2, f, h: f.extra ? 44 : 30 }))
    .concat(LANDMARKS.map(([name, u]) => ({ y: y(u), name, h: 16 })))
    .sort((a, b) => a.y - b.y);
  const placed = [];
  let last = top - 4;
  for (const it of items) {
    const ty = Math.max(it.y - it.h / 2, last + 4);
    if (!it.f && (ty - (it.y - it.h / 2) > 10 || ty + it.h > bottom)) continue;
    placed.push({ ...it, ty });
    last = ty + it.h;
  }
  return placed;
}

function vertical(svg, g) {
  const { W, H, X, labels, decades, foot } = g;
  const top = 10, bot = H - foot;
  const y = (u) => bot - (u / U.max) * (bot - top);
  const cmX = X + 10, yf = y(U.fork);
  let s = '';
  for (const k in MODES) {
    const m = MODES[k], a = y(m.band[0]), b = y(m.band[1]), bx = m.inner ? X - 9 : X - 14;
    s += `<path class="brk" data-mode="${k}" d="M${bx} ${a}h3V${b}h-3"/>`;
  }
  s += `<path class="ax" d="M${X} ${y(0)}V${y(U.cmbLt)}"/><path class="axc" d="M${X} ${yf}L${cmX} ${yf - 14}V${y(U.cmbCm)}"/>`;
  for (const z of ZTICKS) s += `<path class="zh" d="M${X} ${y(uLt(z))}L${cmX} ${Math.min(y(uCm(z)), yf - 14 * clamp((uCm(z) - U.fork) / 0.6, 0, 1))}"/>`;
  for (const [u, lab] of DECADES) {
    s += `<path class="dt" d="M${X - 3} ${y(u)}h3"/>`;
    if (decades) s += `<text class="dec" x="${X - 18}" y="${y(u) + 4}">${lab}</text>`;
  }
  FLOORS.forEach((f, i) => {
    const a = y(f.a), b = y(f.b);
    const d = f.tick ? `M${X + 2} ${a}h6${f.cmb ? `M${cmX - 3} ${y(U.cmbCm)}h6` : ''}` : `M${X + 5} ${a}V${Math.min(b, a - 2)}`;
    s += `<path class="fl" d="${d}"/><path class="fl lit" data-i="${i}" d="${d}"/>`;
  });
  s += `<path class="h7" d="M${X + 3} ${y(U.hidden)}h3"/>`;
  for (const [, u] of LANDMARKS) s += `<circle class="lm" cx="${X + 4}" cy="${y(u)}" r="0.8"/>`;
  if (labels) {
    const lx = labels;
    for (const it of labelLayout(y, top, bot)) {
      if (it.f) {
        if (Math.abs(it.ty + 8 - it.y) > 3) s += `<path class="lead" d="M${X + 9} ${it.y}L${lx - 4} ${it.ty + 8}"/>`;
        s += `<text class="ln" x="${lx}" y="${it.ty + 12}">${esc(it.f.name)}</text><text class="ls" x="${lx}" y="${it.ty + 27}">${esc(it.f.sub)}</text>`;
        if (it.f.extra) s += `<text class="ls" x="${lx}" y="${it.ty + 41}">${esc(it.f.extra)}</text>`;
      } else s += `<text class="ll" x="${lx}" y="${it.ty + 12}">${esc(it.name)}</text>`;
    }
  }
  s += `<rect class="vb" x="${X - 1.5}" width="3" y="0" height="0"/><rect class="vb" x="${X - 1.5}" width="3" y="0" height="0"/>`;
  s += `<path class="hair" d=""/><circle class="ring" cx="${cmX}" cy="0" r="3"/>`;
  const chev = `<path class="cv" d="M${X - 9} -4.5V4.5L${X - 2.5} 0Z"/><path class="ct" d="M${X - 3} 0H${X + 9}"/><path class="cd" d="M${X + 10} 0h6"/>`;
  s += `<g class="chev ghost">${chev}</g><g class="chev main">${chev}</g>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = s;
  return finish(svg, {
    y, place: (el, p) => el.setAttribute('transform', `translate(0 ${p})`),
    bar: (el, a, b) => { const ya = y(a), yb = y(b), h = Math.max(3, ya - yb); el.setAttribute('y', (ya + yb) / 2 - h / 2); el.setAttribute('height', h); },
    ring: (el, hair, u, cu) => { el.setAttribute('cy', y(cu)); hair.setAttribute('d', `M${X + 2} ${y(u)}L${cmX - 2.5} ${y(cu)}`); },
  });
}

function horizontal(svg, g) {
  const { W } = g, H = 16, ty = 8, x0 = 2, x1 = W - 2;
  const x = (u) => x0 + (u / U.max) * (x1 - x0);
  const xf = x(U.fork), yc = ty + 3.5;
  const fade = `<linearGradient id="ladFade" gradientUnits="userSpaceOnUse" x1="${x0}" x2="${x1}" y1="0" y2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="0.05" stop-color="currentColor"/><stop offset="0.975" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient>`;
  const knock = `<mask id="ladKnock" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><rect class="knock" x="0" y="0" width="0" height="${H}" fill="#000"/></mask>`;
  let s = `<defs>${fade}${knock}</defs><g mask="url(#ladKnock)">`;
  s += `<path class="hl" d="M${x0} ${ty}H${x(U.cmbLt)}"/><path class="hl hlc" d="M${xf} ${ty}Q${xf + 5} ${ty} ${xf + 8} ${yc}H${x(U.cmbCm)}"/>`;
  s += `<rect class="vb" y="${ty - 0.75}" height="1.5" x="0" width="0"/><rect class="vb" y="${ty - 0.75}" height="1.5" x="0" width="0"/>`;
  s += `<path class="h7" d="M${x(U.hidden)} ${ty - 3}v2"/></g>`;
  s += `<path class="hair" d=""/><circle class="ring" cy="${yc}" cx="0" r="2"/>`;
  const dot = `<circle class="halo" cx="0" cy="${ty}" r="6"/><circle class="cv" cx="0" cy="${ty}" r="2.6"/>`;
  s += `<g class="chev ghost">${dot}</g><g class="chev main">${dot}</g><text class="val" y="${ty + 3.8}" x="0"><tspan class="vv"></tspan><tspan class="vm"></tspan></text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = s;
  const val = svg.querySelector('.val'), vv = val.querySelector('.vv'), vm = val.querySelector('.vm'), hole = svg.querySelector('.knock');
  let key = '', tw = 0;
  return finish(svg, {
    y: x, val,
    place: (el, p) => el.setAttribute('transform', `translate(${p} 0)`),
    bar: (el, a, b) => { const xa = x(a), xb = x(b), w = Math.max(2, xb - xa); el.setAttribute('x', (xa + xb) / 2 - w / 2); el.setAttribute('width', w); },
    ring: (el, hair, u, cu) => { el.setAttribute('cx', x(cu)); hair.setAttribute('d', ''); },
    label: (u, text, sub = '') => {
      const p = Math.round(x(u) * 2) / 2, tail = sub ? ` · ${sub}` : '', k = `${p}|${text}|${tail}`;
      if (k === key) return;
      key = k;
      if (vv.textContent !== text || vm.textContent !== tail) { vv.textContent = text; vm.textContent = tail; tw = text ? val.getComputedTextLength() : 0; }
      const right = p + 11 + tw <= x1 || p - 11 - tw < x0, lx = right ? p + 11 : p - 11;
      val.setAttribute('x', lx);
      val.setAttribute('text-anchor', right ? 'start' : 'end');
      const a = Math.min(p - 9, right ? lx : lx - tw) - 4, b = Math.max(p + 9, right ? lx + tw : lx) + 4;
      hole.setAttribute('x', a); hole.setAttribute('width', b - a);
    },
  });
}

function finish(svg, v) {
  v.svg = svg;
  v.main = svg.querySelector('.chev.main');
  v.ghost = svg.querySelector('.chev.ghost');
  v.vb = [...svg.querySelectorAll('.vb')];
  v.lit = [...svg.querySelectorAll('.fl.lit')];
  v.ringEl = svg.querySelector('.ring');
  v.hair = svg.querySelector('.hair');
  v.brk = [...svg.querySelectorAll('[data-mode]')];
  v.litOp = new Float32Array(v.lit.length).fill(-1);
  v.py = null; v.vbKey = [null, null];
  return v;
}


export function initLadder({ onPick }) {
  const nav = document.getElementById('altLadder');
  const group = nav.querySelector('[role=radiogroup]');
  const radios = [...group.querySelectorAll('[role=radio]')];
  const track = nav.querySelector('.lad-track');
  const railSvg = nav.querySelector('.lad-svg');
  const read = nav.querySelector('.lad-read');
  const readV = read.querySelector('b'), readM = read.querySelector('span');
  const now = document.getElementById('ladderNow');
  const peek = document.getElementById('ladderPeek');
  const peekSvg = peek.querySelector('.lp-body > svg');
  const peekGroup = peek.querySelector('[role=radiogroup]');
  const peekBody = peek.querySelector('.lp-body');
  const peekSel = peek.querySelector('.lp-sel');
  const peekClose = peek.querySelector('.lp-close');
  const wideQ = matchMedia('(min-width: 1200px)'), pinQ = matchMedia('(min-width: 1760px)');
  radios.forEach((b) => { const c = b.cloneNode(true); c.removeAttribute('id'); c.querySelector('.lw').setAttribute('aria-hidden', 'true'); c.setAttribute('aria-label', MODES[b.dataset.mode].name); c.removeAttribute('title'); peekGroup.appendChild(c); });
  const peekRadios = [...peekGroup.querySelectorAll('[role=radio]')];

  const S = { mode: null, shown: null, u: null, target: null, cm: null, how: 'measured', info: null, segs: [null, null], segT: [null, null], anim: null, raf: 0, last: 0, mod: null, token: 0, announced: '' };
  let rail = null, pk = null, wide = wideQ.matches, pinned = pinQ.matches, peekOpen = false, sheetOpen = false;

  function layout() {
    wide = wideQ.matches; pinned = pinQ.matches;
    nav.classList.toggle('rail', wide); nav.classList.toggle('strip', !wide); nav.classList.toggle('pinned', wide && pinned);
    track.tabIndex = wide ? -1 : 0;
    if (wide) track.setAttribute('aria-hidden', 'true'); else track.removeAttribute('aria-hidden');
    if (wide) {
      const H = Math.max(360, Math.round(nav.clientHeight)), W = pinned ? 220 : 64;
      rail = vertical(railSvg, { W, H, X: 44.5, labels: pinned ? 76 : 0, decades: false, foot: 72 });
      radios.forEach((b) => { b.style.setProperty('--y', `${Math.round(rail.y(MODES[b.dataset.mode].icon) - 20)}px`); });
      if (sheetOpen) closePeek(false);
    } else {
      rail = horizontal(railSvg, { W: Math.max(200, Math.round(nav.clientWidth)) });
      radios.forEach((b) => b.style.removeProperty('--y'));
      if (peekOpen && !sheetOpen) closePeek(false);
    }
    pk = null;
    if (peekOpen) buildPeek();
    applyShown();
    render(performance.now(), true);
  }
  function buildPeek() {
    const H = Math.round(peekBody.clientHeight), W = 300;
    if (H < 200) { pk = null; return; }
    pk = vertical(peekSvg, { W, H, X: 108.5, labels: 140, decades: true, foot: sheetOpen ? 12 : 0 });
    peekRadios.forEach((b) => { b.style.setProperty('--y', `${Math.round(pk.y(MODES[b.dataset.mode].icon) - 20)}px`); });
    applyShown();
  }
  const views = () => [rail, peekOpen ? pk : null].filter(Boolean);

  function applyShown() {
    for (const v of [rail, pk]) if (v) v.brk.forEach((el) => el.classList.toggle('on', el.dataset.mode === S.shown));
    radios.concat(peekRadios).forEach((b) => b.classList.toggle('on', b.dataset.mode === S.shown));
  }
  function setShown(m) { if (S.shown === m) return; S.shown = m; applyShown(); }

  function select(m) {
    for (const list of [radios, peekRadios]) list.forEach((b) => { const on = b.dataset.mode === m; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    if (!wide && !sheetOpen) peekRadios.forEach((b) => { b.tabIndex = -1; });
  }

  function normalize(r) {
    const m = MODES[S.mode];
    if (!r) return { approx: true, u: (m.band[0] + m.band[1]) / 2, segs: [null, null], how: 'measured', sel: null };
    const seg = (v) => (v && v[0] > 0 && v[1] > 0 ? [uKm(Math.min(v[0], v[1])), uKm(Math.max(v[0], v[1]))] : null);
    const segs = [seg(r.view), seg(r.also)];
    const sel = r.sel && r.sel.km > 0 ? r.sel : null;
    const trueU = sel ? uKm(sel.km) : r.rest > 0 ? uKm(r.rest) : segs[0] ? (segs[0][0] + segs[0][1]) / 2 : (m.band[0] + m.band[1]) / 2;
    const u = clamp(trueU, m.band[0], m.band[1]);
    const cm = sel && sel.comovingKm > 0 && sel.z != null && sel.z >= 0.03 ? uKm(sel.comovingKm) : null;
    return { approx: !sel, u, trueU, segs, how: sel ? sel.how || 'measured' : 'measured', cm, sel };
  }

  function readoutText(info) {
    const m = MODES[S.mode], [v, unit] = fmtParts(info.trueU != null ? info.trueU : info.u);
    const light = unit === 'Gyr' || ((S.mode === 'stars' || S.mode === 'dm') && (unit === 'ly' || unit === 'Mly'));
    const value = `${info.approx ? '≈ ' : ''}${v} ${unit === 'Gyr' ? 'Gyr' : unit}`;
    const measure = info.sel && info.sel.note ? info.sel.note : light ? 'light travel' : unit === 'AU' || unit === 'M km' ? 'from Earth' : m.measure;
    return [value, measure];
  }

  function announce(info) {
    const m = MODES[S.mode];
    let t = `You are on the ${m.floor} floor.`;
    if (info.sel) {
      const light = S.mode === 'stars' || S.mode === 'dm';
      t += ` Selected: ${info.sel.label}, ${light ? `light travel ${wordsOf(info.trueU, true)}` : `${wordsOf(info.trueU, false)} ${info.sel.note || m.measure}`}`;
      if (info.cm != null) t += `, now ${(10 ** info.cm / KM_PER_LY / 1e9).toFixed(1)} billion light-years away`;
      t += '.';
    }
    if (t !== S.announced) { S.announced = t; now.textContent = t; }
  }

  function peekLines(info) {
    if (!info || !info.sel) {
      peekSel.innerHTML = `<p class="lp-n">${esc(MODES[S.mode] ? MODES[S.mode].name : '')}</p><p>${esc(readoutText(info || { u: 0, approx: true }).join(' · '))}</p><p class="lp-note">Above the fork: left, how long the light travelled; right, where that matter is now (comoving).</p>`;
      return;
    }
    const s = info.sel, light = S.mode === 'stars' || S.mode === 'dm';
    const l2 = light ? `light travel ${fmtU(info.trueU)}${s.z != null ? ` (z = ${s.z >= 100 ? Math.round(s.z) : s.z.toFixed(s.z < 0.1 ? 3 : 2)})` : ''}` : `${fmtU(info.trueU)} ${s.note || MODES[S.mode].measure}`;
    const l3 = info.cm != null ? `now ${(10 ** info.cm / KM_PER_LY / 1e9).toFixed(1)} Gly away, comoving` : '';
    peekSel.innerHTML = `<p class="lp-n">${esc(s.label)}</p><p>${esc(l2)}</p>${l3 ? `<p class="lp-c">${esc(l3)}</p>` : ''}<p class="lp-h">${esc(s.words || HOW_WORDS[s.how] || '')}</p>`;
  }

  function pull(kind) {
    const c0 = performance.now();
    update(kind);
    pushPerf(perf.ladderPull || (perf.ladderPull = []), performance.now() - c0);
  }
  function update(kind) {
    if (!S.mod || typeof S.mod.ladder !== 'function') return;
    let r = null;
    try { r = S.mod.ladder(); } catch { r = null; }
    if (r === null && kind !== 'force') { if (S.anim && S.anim.wait) return; }
    const info = normalize(r);
    const prev = S.info;
    S.info = info;
    S.segT = info.segs;
    S.cm = info.cm; S.how = info.how;
    const selKey = info.sel ? info.sel.label : '';
    const prevKey = prev && prev.sel ? prev.sel.label : '';
    if (S.anim && S.anim.wait) {
      if (r === null) return;
      startClimb(info.u);
    } else if (S.anim && S.anim.climb) {
      S.target = info.u;
    } else if (S.u == null) {
      S.u = info.u;
    } else if (selKey !== prevKey || Math.abs(info.u - S.u) > 0.6) {
      if (reduceMotion) crossFade(info.u); else S.anim = { from: S.u, to: info.u, t0: performance.now(), dur: 400 };
    } else S.target = info.u;
    if (!S.anim || !S.anim.climb) { finalRead(); if (selKey !== prevKey || kind === 'mode') announce(info); }
    if (peekOpen) peekLines(info);
    paintMarker();
    kick();
  }

  function finalRead() {
    if (!S.info) return;
    const [v, m] = readoutText(S.info);
    if (readV.textContent !== v) readV.textContent = v;
    if (readM.textContent !== m) readM.textContent = m;
    if (rail && rail.label) rail.label(S.u, v, m);
  }

  function paintMarker() {
    for (const v of views()) {
      v.main.setAttribute('class', `chev main how-${S.how}${S.anim && S.anim.wait ? ' wait' : ''}`);
      v.main.classList.toggle('none', S.u == null);
      const showRing = S.cm != null && !(S.anim && (S.anim.climb || S.anim.wait));
      v.ringEl.classList.toggle('on', showRing); v.hair.classList.toggle('on', showRing);
    }
  }

  function crossFade(to) {
    for (const v of views()) {
      if (S.u != null) { v.place(v.ghost, v.y(S.u)); v.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }); }
      v.main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    }
    S.u = to; S.target = null; S.anim = null;
  }

  function startClimb(to) {
    if (S.u == null || reduceMotion) { setShown(S.mode); crossFade(to); finalRead(); announce(S.info); paintMarker(); return; }
    const d = Math.abs(to - S.u);
    S.target = null;
    S.anim = { from: S.u, to, t0: performance.now(), dur: Math.min(1400, 600 + 35 * d), climb: true };
    ns.lastClimb = { from: S.u, to, dur: S.anim.dur, t0: S.anim.t0 };
  }

  function mode(m, modPromise) {
    if (m === S.mode) return;
    S.mode = m;
    const token = ++S.token;
    S.mod = null;
    if (S.shown == null || reduceMotion) setShown(m);
    S.anim = { wait: true };
    paintMarker();
    Promise.resolve(modPromise).then((mod) => {
      if (token !== S.token) return;
      S.mod = mod;
      setTimeout(() => { if (token === S.token) pull('mode'); }, 0);
    }, () => { if (token === S.token) { S.anim = null; setShown(m); paintMarker(); } });
  }

  function render(t, force) {
    const dt = Math.min(100, S.last ? t - S.last : 16);
    S.last = t;
    let moving = false;
    const a = S.anim;
    if (a && !a.wait) {
      const p = Math.max(a.p || 0, clamp((t - a.t0) / a.dur, 0, 1)), u = a.from + (a.to - a.from) * smooth(p);
      a.p = p;
      S.u = u;
      if (a.climb) {
        if (p >= 0.5) setShown(S.mode);
        FLOORS.forEach((f, i) => { if (u >= Math.min(f.a, f.b) - 0.15 && u <= Math.max(f.a, f.b) + 0.15) litAt[i] = t; });
        const [v, unit] = fmtParts(u);
        readV.textContent = v; readM.textContent = unit;
        if (ns.ladderFrame) ns.ladderFrame(u, t);
      }
      if (p >= 1) {
        S.anim = null; S.u = a.to;
        if (a.climb) { setShown(S.mode); finalRead(); if (S.info) announce(S.info); paintMarker(); if (S.target != null) moving = true; }
      } else moving = true;
    } else if (!a && S.target != null && S.u != null) {
      const d = S.target - S.u;
      if (Math.abs(d) < 0.01) { S.u = S.target; S.target = null; } else { S.u += d * (1 - Math.exp(-dt / 250)); moving = true; }
    }
    if (rail && rail.label && S.u != null) { const c = S.anim && (S.anim.climb || S.anim.wait); if (c) rail.label(S.u, '', ''); else if (S.info) rail.label(S.u, readV.textContent, readM.textContent); }
    for (let k = 0; k < 2; k++) {
      const tg = S.segT[k], cur = S.segs[k];
      if (!tg) { S.segs[k] = null; continue; }
      if (!cur || reduceMotion || force) { S.segs[k] = tg.slice(); continue; }
      const f = 1 - Math.exp(-dt / 250);
      let still = true;
      for (let e = 0; e < 2; e++) { const d = tg[e] - cur[e]; if (Math.abs(d) > 0.01) { cur[e] += d * f; still = false; } else cur[e] = tg[e]; }
      if (!still) moving = true;
    }
    for (const v of views()) {
      if (S.u != null) { const py = Math.round(v.y(S.u) * 4) / 4; if (py !== v.py) { v.py = py; v.place(v.main, py); } }
      v.vb.forEach((el, k) => {
        const s = S.segs[k], key = s ? `${Math.round(v.y(s[0]) * 2)},${Math.round(v.y(s[1]) * 2)}` : '';
        if (key === v.vbKey[k]) return;
        v.vbKey[k] = key; el.classList.toggle('on', !!s); if (s) v.bar(el, s[0], s[1]);
      });
      if (S.cm != null && S.u != null) v.ring(v.ringEl, v.hair, S.u, S.cm);
      for (let i = 0; i < v.lit.length; i++) {
        const op = reduceMotion ? 0 : clamp(1 - (t - litAt[i]) / 300, 0, 1);
        if (op > 0 && (t - litAt[i]) > 0) moving = true;
        if (Math.abs(op - v.litOp[i]) > 0.01) { v.litOp[i] = op; v.lit[i].style.opacity = op; }
      }
    }
    return moving;
  }
  const litAt = new Float64Array(FLOORS.length).fill(-1e9);

  function loop(t) {
    S.raf = 0;
    const c0 = performance.now(), more = render(t);
    pushPerf(perf.ladder || (perf.ladder = []), performance.now() - c0);
    if (more) S.raf = requestAnimationFrame(loop);
    else S.last = 0;
  }
  function kick() { if (!S.raf) { S.last = 0; S.raf = requestAnimationFrame(loop); } }

  let openT = 0, closeT = 0, lastFocus = null;
  function openPeek(asSheet) {
    clearTimeout(closeT); clearTimeout(openT);
    if (peekOpen) return;
    peekOpen = true; sheetOpen = !!asSheet;
    peek.classList.toggle('sheet-mode', sheetOpen);
    peek.setAttribute('aria-modal', sheetOpen ? 'true' : 'false');
    peekGroup.toggleAttribute('aria-hidden', !sheetOpen);
    peek.hidden = false;
    peekLines(S.info);
    buildPeek();
    paintMarker();
    render(performance.now(), true);
    if (sheetOpen) {
      lastFocus = document.activeElement;
      peekRadios.forEach((b) => { b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1; });
      (peekRadios.find((b) => b.tabIndex === 0) || peekClose).focus();
    } else peekRadios.forEach((b) => { b.tabIndex = -1; });
  }
  function closePeek(restore = true) {
    clearTimeout(openT); clearTimeout(closeT);
    if (!peekOpen) return;
    const wasSheet = sheetOpen;
    peekOpen = false; sheetOpen = false; peek.hidden = true;
    if (wasSheet && restore) (lastFocus && lastFocus.isConnected ? lastFocus : track).focus();
  }
  nav.addEventListener('pointerenter', (e) => { if (!wide || pinned || e.pointerType !== 'mouse') return; clearTimeout(closeT); openT = setTimeout(() => openPeek(false), 120); });
  nav.addEventListener('pointerleave', () => { if (!wide || sheetOpen) return; clearTimeout(openT); closeT = setTimeout(() => closePeek(), 300); });
  group.addEventListener('focusin', () => { if (wide && !pinned) openPeek(false); });
  nav.addEventListener('focusout', (e) => { if (!sheetOpen && wide && !nav.contains(e.relatedTarget)) closePeek(); });
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && peekOpen) { e.stopPropagation(); closePeek(); return; }
    if (e.key === 'Tab' && sheetOpen) {
      const f = [peekClose, ...peekRadios.filter((b) => b.tabIndex === 0)];
      const i = f.indexOf(document.activeElement), n = e.shiftKey ? i - 1 : i + 1;
      e.preventDefault(); f[(n + f.length) % f.length].focus();
    }
  });
  track.addEventListener('click', () => { if (!wide) openPeek(true); });
  track.addEventListener('keydown', (e) => { if (!wide && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPeek(true); } });
  peekClose.addEventListener('click', () => closePeek());

  function keyNav(list, isVertical) {
    return (e) => {
      const vertical = isVertical();
      const b = e.target.closest('[role=radio]');
      if (!b) return;
      const k = FLOOR_ORDER.indexOf(b.dataset.mode);
      const up = vertical ? ['ArrowUp', 'ArrowRight'] : ['ArrowRight', 'ArrowUp'];
      const down = vertical ? ['ArrowDown', 'ArrowLeft'] : ['ArrowLeft', 'ArrowDown'];
      let next = null;
      if (up.includes(e.key)) next = FLOOR_ORDER[(k + 1) % 4];
      else if (down.includes(e.key)) next = FLOOR_ORDER[(k + 3) % 4];
      else if (e.key === 'Home') next = FLOOR_ORDER[0];
      else if (e.key === 'End') next = FLOOR_ORDER[3];
      if (!next) return;
      e.preventDefault();
      onPick(next);
      list().find((x) => x.dataset.mode === next).focus();
    };
  }
  group.addEventListener('keydown', keyNav(() => radios, () => wide));
  peekGroup.addEventListener('keydown', keyNav(() => peekRadios, () => true));
  group.addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (b) onPick(b.dataset.mode); });
  peekGroup.addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (b) onPick(b.dataset.mode); });

  window.addEventListener('ladder', () => pull('event'));
  let relayout = 0;
  new ResizeObserver(() => { cancelAnimationFrame(relayout); relayout = requestAnimationFrame(() => { layout(); pull('event'); }); }).observe(nav);
  wideQ.addEventListener('change', layout); pinQ.addEventListener('change', layout);
  layout();

  return { select, mode, get state() { return S; } };
}

