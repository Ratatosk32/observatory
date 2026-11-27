import { $, esc, ns, shell, reduceMotion, onTheme } from './kit.js';
import { DUR, play, stagger, ticker } from './motion.js';
import { health, quietNights, ticksHtml } from './quiet.js';
import { waiting } from './curtain.js';

export const FLOOR_NAME = { dm: 'Dark matter', stars: 'Stars & beyond', asteroids: 'Asteroids', earth: 'Earth' };
export const FLOOR_ORDER = ['dm', 'stars', 'asteroids', 'earth'];
const NAV = { stars: '#sPresets', asteroids: '#presets', dm: '#dPresets', earth: '#ePresets' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SWPC = 'https://services.swpc.noaa.gov/';
const MINUS = '−';
export const CLOSE_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const STATE_WORD = { live: 'live', nightly: 'nightly', model: 'model', static: 'reference' };

let cssReady = null;
export function css() {
  if (cssReady) return cssReady;
  const have = document.getElementById('paletteCss');
  if (have) return (cssReady = Promise.resolve());
  const l = document.createElement('link');
  l.id = 'paletteCss'; l.rel = 'stylesheet';
  l.href = new URL('../palette.css' + new URL(import.meta.url).search, import.meta.url).href;
  cssReady = new Promise((done) => { l.onload = done; l.onerror = done; });
  document.head.appendChild(l);
  return cssReady;
}

export const mode = () => (shell.mode && shell.mode()) || document.body.dataset.mode;
export const visible = (e) => !!e && e.isConnected && !e.closest('[hidden]') && e.getClientRects().length > 0;

export function waitFor(test, ms = 15000) {
  return new Promise((done) => {
    const t0 = performance.now();
    const tick = () => {
      let v = null;
      try { v = test(); } catch { v = null; }
      if (v) done(v); else if (performance.now() - t0 > ms) done(null); else setTimeout(tick, 100);
    };
    tick();
  });
}

export async function toFloor(m) {
  if (mode() !== m) await shell.setMode(m);
  await waitFor(() => !waiting(m));
}

export function reveal(el, focus = true) {
  if (!el) return false;
  if (shell.scene && typeof shell.scene.reveal === 'function' && shell.scene.reveal(el) !== false) {
    if (focus) focusIn(el);
    return true;
  }
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  const panel = el.closest('.panel');
  if (panel && panel.classList.contains('collapsed')) { const b = panel.querySelector('.pctl .col'); if (b) b.click(); }
  el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  if (focus) focusIn(el);
  return true;
}
function focusIn(el) {
  const f = el.matches('input, select, button, a, [tabindex]') ? el : el.querySelector('h2, h3, summary') || el;
  if (!f.matches('input, select, button, a, summary, [tabindex]')) f.tabIndex = -1;
  f.focus({ preventScroll: true });
}

export function findPreset(m, key) {
  const nav = $(NAV[m]);
  if (!nav) return null;
  return [...nav.querySelectorAll('.btn')].find((b) => b.dataset.p === key || b.dataset.preset === key || b.textContent.trim() === key) || null;
}
export async function runPreset(m, key, label) {
  await toFloor(m);
  const b = await waitFor(() => findPreset(m, key) || (label && findPreset(m, label)));
  if (b) b.click();
  return !!b;
}

export async function pickObject(m, query, label) {
  const before = mode() === m ? null : shell.search();
  await toFloor(m);
  const it = await waitFor(() => {
    const p = shell.search();
    if (!p || p === before) return null;
    const items = p.items(query) || [];
    const want = (label || query).toLowerCase();
    return items.find((o) => o.label.toLowerCase() === want) || items.find((o) => o.label.toLowerCase().includes(want)) || items[0];
  });
  if (it) it.pick();
  return !!it;
}

export const INSTRUMENTS = {
  stars: [['Distances', '.s-ladder'], ['Census', '.s-census'], ['HR diagram', '.s-hr'], ['Season', '.s-ribbon']],
  asteroids: [['Orbits', '.el-panel'], ['Colours', '.col-panel'], ['Cadence', '.cad-panel'], ['Stamps', '.stamp-panel']],
  dm: [['Meters', '.d-meter'], ['The story so far', '.d-story']],
  earth: [['Space weather', '.e-sw'], ['Regions', '.e-reg']],
};
export async function openInstrument(m, label) {
  const sel = (INSTRUMENTS[m].find((x) => x[0] === label) || [])[1];
  if (!sel) return false;
  await toFloor(m);
  const el = await waitFor(() => document.querySelector(sel));
  if (shell.scene && typeof shell.scene.openInstrument === 'function' && shell.scene.openInstrument(m, label, el) !== false) return true;
  return reveal(el);
}

export async function go(m, g = {}) {
  if (g.inst) return openInstrument(m, g.inst);
  if (g.preset) return runPreset(m, g.preset);
  if (g.find) return pickObject(m, g.find, g.label);
  await toFloor(m);
  return true;
}

const pad = (n) => String(n).padStart(2, '0');
export function asOf(s) {
  if (!s) return '';
  if (/^\d{8}$/.test(s)) return `night of ${+s.slice(6)} ${MON[+s.slice(4, 6) - 1]}`;
  const d = new Date(/Z$/.test(s) && s.length === 17 ? s.replace('Z', ':00Z') : s);
  if (isNaN(d)) return String(s);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
const ageH = (s) => { const d = Date.parse(/Z$/.test(s || '') && s.length === 17 ? s.replace('Z', ':00Z') : s); return isNaN(d) ? 0 : (Date.now() - d) / 36e5; };

const ALT = { dm: '0.7–13.5 Gyr of light', stars: '0.1–11 Gyr of light', asteroids: '0.02–6 AU', sw: '1.5 million km', hp: '100–300 km', lightning: '10–15 km' };
const altOf = (f) => ALT[f.live] || (f.mode === 'earth' ? ALT.lightning : ALT[f.mode]) || '';
const DAY_FMT = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
const isoOf = (s) => (/Z$/.test(s || '') && s.length === 17 ? s.replace('Z', ':00Z') : s);

let data = null, quietN = 0, el = null, opener = null, liveT = 0, live = {};

async function load() {
  if (data) return data;
  const [b, h] = await Promise.all([
    fetch('data/brief.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).catch(() => null),
    health(),
  ]);
  data = b && Array.isArray(b.floors) ? b : { floors: [], failed: true };
  quietN = quietNights(h);
  return data;
}

const MW_W = 1440, MW_BAND = 240, MW_TOP = 240, MW_OUT_W = 720, MW_OUT_H = 120;
let mwPx = null, mwLoad = null;
function loadMw() {
  if (!mwLoad) {
    mwLoad = new Promise((done) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = MW_W; c.height = MW_BAND;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, -MW_TOP);
          const px = g.getImageData(0, 0, MW_W, MW_BAND).data, out = new Uint8Array(MW_W * MW_BAND);
          for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
          mwPx = out;
        } catch { mwPx = null; }
        done(!!mwPx);
      };
      im.onerror = () => done(false);
      im.src = 'data/milkyway.png';
    });
  }
  return mwLoad;
}
function rgbOf(c) {
  const g = document.createElement('canvas').getContext('2d');
  g.fillStyle = c;
  const h = g.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) : [128, 128, 128];
}
function paintMw() {
  const cv = el && el.querySelector('.ab-mw');
  if (!cv || !mwPx) return;
  const dark = document.documentElement.dataset.theme !== 'light';
  const [r, g, b] = rgbOf(getComputedStyle(el).getPropertyValue('--gold').trim());
  const [lo, peak, pw] = dark ? [0.34, 0.8, 1.8] : [0.28, 0.62, 1.7];
  cv.width = MW_OUT_W; cv.height = MW_OUT_H;
  const x = cv.getContext('2d'), img = x.createImageData(MW_OUT_W, MW_OUT_H), o = img.data;
  const sy = MW_BAND / MW_OUT_H;
  for (let oy = 0; oy < MW_OUT_H; oy++) {
    const y0 = Math.min(MW_BAND - 2, Math.floor(oy * sy)), t = oy / MW_OUT_H, fade = t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55) ** 2;
    for (let ox = 0; ox < MW_OUT_W; ox++) {
      const l = (180 - (ox / MW_OUT_W) * 360 + 360) % 360, sx = Math.floor(l * 4) % MW_W, sx1 = (sx + 1) % MW_W;
      const v = (mwPx[y0 * MW_W + sx] + mwPx[y0 * MW_W + sx1] + mwPx[(y0 + 1) * MW_W + sx] + mwPx[(y0 + 1) * MW_W + sx1]) / 1020;
      const a = peak * Math.max(0, Math.min(1, (v - lo) / (1 - lo))) ** pw * fade;
      const k = (oy * MW_OUT_W + ox) * 4;
      o[k] = r; o[k + 1] = g; o[k + 2] = b; o[k + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  cv.classList.add('on');
}
onTheme(() => { if (el && !el.hidden) paintMw(); });

const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const tOf = (s) => Date.parse(String(s || '').replace(' ', 'T').replace(/(\.\d+)?Z?$/, 'Z'));
async function grab(path, text) {
  const r = await fetch(SWPC + path, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(String(r.status));
  return text ? r.text() : r.json();
}
function fromEarth() {
  const L = ns.earth && ns.earth.live && ns.earth.live.st;
  if (!L) return {};
  const out = {};
  if (L.speed.data) out.speed = { v: L.speed.data.v, t: L.speed.data.t * 1000 };
  if (L.mag.data) out.bz = { v: L.mag.data.bz, t: L.mag.data.t * 1000 };
  const kp = L.kp1m.data && L.kp1m.data[L.kp1m.data.length - 1];
  if (kp) out.kp = { v: kp[1], t: kp[0] * 1000 };
  const hp = L.hp.data && L.hp.data[L.hp.data.length - 1];
  if (hp) out.hp = { v: hp[1], t: hp[0] * 1000 };
  return out;
}
async function fetchLive() {
  const got = fromEarth();
  const jobs = [];
  if (!got.speed) jobs.push(grab('products/summary/solar-wind-speed.json').then((j) => { const r = Array.isArray(j) ? j[0] : j; const v = r && num(r.proton_speed); if (v != null) got.speed = { v, t: tOf(r.time_tag) }; }));
  if (!got.bz) jobs.push(grab('products/summary/solar-wind-mag-field.json').then((j) => { const r = Array.isArray(j) ? j[0] : j; const v = r && num(r.bz_gsm); if (v != null) got.bz = { v, t: tOf(r.time_tag) }; }));
  if (!got.kp) jobs.push(grab('json/planetary_k_index_1m.json').then((j) => { const r = Array.isArray(j) && j[j.length - 1]; const v = r && num(r.estimated_kp); if (v != null) got.kp = { v, t: tOf(r.time_tag) }; }));
  if (!got.hp) jobs.push(grab('text/aurora-nowcast-hemi-power.txt', true).then((txt) => {
    const rows = String(txt).split('\n').filter((l) => l && l[0] !== '#').map((l) => l.trim().split(/\s+/));
    const r = rows.filter((p) => p.length >= 4 && Number.isFinite(+p[2])).pop();
    if (r) got.hp = { v: +r[2], t: tOf(r[0].replace('_', 'T')) };
  }));
  await Promise.allSettled(jobs);
  live = got;
  if (el && !el.hidden) paintLive();
}
function liveLoop() {
  clearTimeout(liveT);
  if (!el || el.hidden) return;
  if (!document.hidden) fetchLive();
  liveT = setTimeout(liveLoop, 60000);
}
const kpWord = (kp) => (kp < 3 ? 'Quiet space weather' : kp < 4 ? 'Unsettled space weather' : kp < 5 ? 'Active space weather' : 'Geomagnetic storm');
function paintLive() {
  const sw = el.querySelector('[data-live="sw"]');
  if (sw && (live.speed || live.bz || live.kp)) {
    const t = Math.max(...[live.speed, live.bz, live.kp].filter(Boolean).map((x) => x.t).filter(Number.isFinite), 0);
    if (live.kp) {
      sw.querySelector('.ab-fh').textContent = `${kpWord(live.kp.v)}: Kp ${live.kp.v.toFixed(1)}`;
      setBig(sw, live.kp.v.toFixed(1), 'Kp, planetary index');
    }
    const parts = [];
    if (live.speed) parts.push(`Solar wind ${Math.round(live.speed.v)} km/s`);
    if (live.bz) parts.push(`Bz ${live.bz.v < 0 ? MINUS : '+'}${Math.abs(live.bz.v).toFixed(1)} nT, ${live.bz.v < 0 ? 'south' : 'north'}`);
    sw.querySelector('.ab-fd').textContent = parts.join(', ') + '.';
    setProv(sw, 'live', t ? new Date(t).toISOString() : '');
  }
  const au = el.querySelector('[data-live="hp"]');
  if (au && live.hp) {
    au.querySelector('.ab-fh').textContent = `Aurora power ${Math.round(live.hp.v)} GW in the north`;
    setBig(au, String(Math.round(live.hp.v)), 'GW of aurora, north');
    setProv(au, 'model', Number.isFinite(live.hp.t) ? new Date(live.hp.t).toISOString() : '', 'model, live');
  }
}
function setProv(li, state, iso, word) {
  const p = li.querySelector('.ab-prov');
  p.className = `ab-prov st-${state}`;
  p.innerHTML = `<i></i>${esc(word || STATE_WORD[state] || state)}${iso ? ` · ${esc(asOf(iso))}` : ''}`;
}

const NUM_RE = /^([+−-]?)(\d[\d,]*(?:\.\d+)?)(.*)$/;
function parseBig(s) {
  const m = NUM_RE.exec(String(s));
  if (!m) return null;
  return { sign: m[1], n: +m[2].replace(/,/g, ''), dec: (m[2].split('.')[1] || '').length, comma: m[2].includes(','), rest: m[3] };
}
const fmtBig = (p) => (v) => p.sign + v.toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec, useGrouping: p.comma }) + p.rest;
function countUp(v) {
  const p = parseBig(v.dataset.v);
  if (!p) return;
  const f = fmtBig(p);
  ticker(v, 0, { format: f, first: true });
  ticker(v, p.n, { format: f, dur: DUR.travel });
}
function setBig(li, v, unit) {
  const b = li.querySelector('.ab-big');
  const vEl = b && b.querySelector('.ab-v');
  if (!vEl) return;
  const p = parseBig(v);
  vEl.dataset.v = v;
  if (p) ticker(vEl, p.n, { format: fmtBig(p) }); else vEl.textContent = v;
  b.querySelector('.ab-u').textContent = unit;
}
function sigmaAxis([lens, clusters]) {
  const X = (s) => (8 + ((Math.max(-2, Math.min(4, s)) + 2) / 6) * 196).toFixed(1);
  return `<svg class="ab-axis" viewBox="0 0 212 22" aria-hidden="true"><path class="a0" d="M8 11H204"/><path class="a3" d="M${X(3)} 3V19"/><path class="az" d="M${X(0)} 7V15"/><path class="al" d="M${X(lens)} 5V17"/><path class="ac" d="M${X(clusters)} 5V17"/></svg>`;
}

function linksHtml(links) {
  return (links || []).filter((l) => l && /^https:\/\//.test(l.url)).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('');
}
function statusHtml(st, stale) {
  const text = esc(st.text), k = text.indexOf(': ');
  const lead = k > 0 && k < 80 ? `<b>${text.slice(0, k)}</b>${text.slice(k)}` : text;
  const checked = st.asOf ? `<span class="ab-chk">${esc(st.source || 'Checked')} · checked ${esc(asOf(st.asOf))}</span>` : '';
  return `<div class="ab-status lvl-${esc(st.level || '')}">${ticksHtml(quietN)}<p>${lead}${stale}${checked}</p>${st.link ? linksHtml([st.link]) : ''}</div>`;
}
function rowHtml(f, i) {
  const state = STATE_WORD[f.state] ? f.state : 'nightly';
  const big = f.big && f.big.v ? f.big : null;
  const axis = big && Array.isArray(big.axis) && big.axis.length === 2 && big.axis.every(Number.isFinite) ? sigmaAxis(big.axis) : '';
  return `<li class="ab-row${i === 0 ? ' lead' : ''}" data-i="${i}"${f.live ? ` data-live="${esc(f.live)}"` : ''}>
    <span class="ab-h">${esc(altOf(f))}</span>
    <div class="ab-main">
      <div class="ab-fl"><span>${esc(f.floor)}</span><span class="ab-prov st-${state}"><i></i>${esc(STATE_WORD[state])}${f.asOf ? ` · ${esc(asOf(f.asOf))}` : ''}</span></div>
      <h3 class="ab-hd"><button type="button" class="ab-fh" data-go="${i}" aria-describedby="abd${i}">${esc(f.headline)}</button></h3>
      <p class="ab-fd" id="abd${i}">${esc(f.detail || '')}</p>
      ${f.alt && f.alt.label ? `<button type="button" class="ab-alt" data-alt="${i}">${esc(f.alt.label)} ›</button>` : ''}
      <p class="ab-fa"><span>${esc(f.source || '')}</span>${linksHtml(f.links || (f.link ? [f.link] : []))}</p>
    </div>
    ${big ? `<p class="ab-big"><span class="ab-v num-d" data-v="${esc(big.v)}">${esc(big.v)}</span><span class="ab-u">${esc(big.unit || '')}</span>${axis}</p>` : ''}
  </li>`;
}
function render(b) {
  const st = b.status || (b.rubin && b.rubin.status ? { text: b.rubin.status, level: b.rubin.level } : null);
  const age = b.built ? ageH(b.built) : 0;
  const stale = age > 36 ? `<span class="ab-stale"> Built ${Math.round(age / 24)} days ago: the nightly refresh may not have run.</span>` : '';
  const when = b.built ? new Date(isoOf(b.built)) : null;
  const ok = when && !isNaN(when);
  const date = ok ? when.toLocaleDateString('en-GB', DAY_FMT).replace(',', '') : 'Above you';
  const built = ok ? `Built ${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())} UTC from the nightly run · space weather refreshes live from NOAA while this is open` : 'Space weather refreshes live from NOAA while this is open';
  el.innerHTML = `<header class="ab-mast"><canvas class="ab-mw" aria-hidden="true"></canvas>
      <div class="ab-in"><p class="ab-kick">Above you · one line per floor, top to bottom</p><h2 class="ab-date" id="abTitle">${esc(date)}</h2><p class="ab-built">${esc(built)}</p></div>
    </header>
    <button type="button" class="btn icon glass ab-close" aria-label="Close Above you" title="Close (Esc)">${CLOSE_IC}</button>
    <div class="ab-body">
      ${st ? statusHtml(st, stale) : ''}
      ${b.failed ? '<p class="ab-fd ab-fail">The brief could not be loaded. Each floor still shows its own data.</p>' : `<ol class="ab-floors">${b.floors.map(rowHtml).join('')}</ol>`}
      <p class="ab-foot"><span class="ab-prov st-live"><i></i>Live</span> straight from the source in your browser. <span class="ab-prov st-nightly"><i></i>Nightly</span> refreshed once a day. <span class="ab-prov st-model"><i></i>Model</span> a forecast, not a sighting.</p>
    </div>`;
}

const PASS_KEYS = ['n', '?', '/'];
function focusables() {
  return [...el.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.getClientRects().length);
}
function onDocKey(e) {
  if (!el || el.hidden) return;
  if (document.querySelector('.pl-scrim:not([hidden])')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeBrief(); return; }
  if (e.key !== 'Tab') {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!(mod && k === 'k') && !PASS_KEYS.includes(k)) e.stopImmediatePropagation();
    return;
  }
  const f = focusables();
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || !el.contains(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
}

function build() {
  el = document.createElement('aside');
  el.className = 'ab-brief';
  el.id = 'aboveYou';
  el.hidden = true;
  el.tabIndex = -1;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'abTitle');
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('ab-close')) { closeBrief(); return; }
    const f = data.floors[+(b.dataset.go ?? b.dataset.alt)];
    if (!f) return;
    closeBrief(false);
    go(f.mode, b.dataset.alt != null ? f.alt.go : f.go);
  });
}

let opening = null;
export function openBrief(from) {
  if (isBriefOpen()) return Promise.resolve();
  if (opening) return opening;
  opener = from || (document.activeElement !== document.body ? document.activeElement : null);
  if (!el) build();
  opening = Promise.all([load(), css()]).then(([b]) => {
    opening = null;
    render(b);
    if (Object.keys(live).length) paintLive();
    el.hidden = false;
    document.documentElement.classList.add('ab-open');
    el.scrollTop = 0;
    document.querySelectorAll('[data-ux="brief"]').forEach((x) => x.setAttribute('aria-expanded', 'true'));
    document.addEventListener('keydown', onDocKey, true);
    el.querySelector('.ab-close').focus({ preventScroll: true });
    play(el, [{ opacity: 0 }, { opacity: 1 }], { fill: 'backwards' });
    stagger(el.querySelectorAll('.ab-in > *, .ab-status, .ab-row'), { y: 10, dur: DUR.gentle });
    el.querySelectorAll('.ab-v[data-v]').forEach(countUp);
    if (mwPx) paintMw(); else loadMw().then(() => { if (el && !el.hidden) paintMw(); });
    liveLoop();
  });
  return opening;
}

export function closeBrief(restore = true) {
  if (!el || el.hidden) return;
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.hidden = true;
  document.documentElement.classList.remove('ab-open');
  clearTimeout(liveT);
  document.querySelectorAll('[data-ux="brief"]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
  document.removeEventListener('keydown', onDocKey, true);
  if (restore && opener && opener.isConnected && visible(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

export const isBriefOpen = () => !!el && !el.hidden;
export function toggleBrief(from) { if (isBriefOpen()) closeBrief(); else openBrief(from); }
