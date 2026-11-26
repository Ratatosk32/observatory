import { $, esc, ns, shell, reduceMotion } from './kit.js';

export const FLOOR_NAME = { dm: 'Dark matter', stars: 'Stars & beyond', asteroids: 'Asteroids', earth: 'Earth' };
export const FLOOR_ORDER = ['dm', 'stars', 'asteroids', 'earth'];
const NAV = { stars: '#sPresets', asteroids: '#presets', dm: '#dPresets', earth: '#ePresets' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SWPC = 'https://services.swpc.noaa.gov/';
const MINUS = '−';
const ICON = {
  dm: '<circle cx="12" cy="12" r="3"/><path d="M3 12c3-5 6-7.5 9-7.5s6 2.5 9 7.5M3 12c3 5 6 7.5 9 7.5s6-2.5 9-7.5"/>',
  stars: '<path d="M12 3.5l1.9 5.2 5.4.3-4.2 3.4 1.4 5.3L12 14.7l-4.5 3 1.4-5.3-4.2-3.4 5.4-.3z"/>',
  asteroids: '<ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-20 12 12)"/><circle cx="12" cy="12" r="2.2"/>',
  earth: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5c-3.2 2.6-4.6 5.4-4.6 8.5s1.4 5.9 4.6 8.5M3.5 12h17"/>',
};
export const CLOSE_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const STATE_WORD = { live: 'live', nightly: 'nightly', model: 'model', static: 'reference' };

export function css() {
  if (document.getElementById('paletteCss')) return;
  const l = document.createElement('link');
  l.id = 'paletteCss'; l.rel = 'stylesheet';
  l.href = new URL('../palette.css' + new URL(import.meta.url).search, import.meta.url).href;
  document.head.appendChild(l);
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

let data = null, el = null, opener = null, liveT = 0, live = {};

async function load() {
  if (data) return data;
  try {
    const r = await fetch('data/brief.json');
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
    if (!data || !Array.isArray(data.floors)) throw new Error('shape');
  } catch {
    data = { floors: [], failed: true };
  }
  return data;
}

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
    if (live.kp) sw.querySelector('.ab-fh').textContent = `${kpWord(live.kp.v)}: Kp ${live.kp.v.toFixed(1)}`;
    const parts = [];
    if (live.speed) parts.push(`Solar wind ${Math.round(live.speed.v)} km/s`);
    if (live.bz) parts.push(`Bz ${live.bz.v < 0 ? MINUS : '+'}${Math.abs(live.bz.v).toFixed(1)} nT, ${live.bz.v < 0 ? 'south' : 'north'}`);
    sw.querySelector('.ab-fd').textContent = parts.join(', ') + '.';
    setProv(sw, 'live', t ? new Date(t).toISOString() : '');
  }
  const au = el.querySelector('[data-live="hp"]');
  if (au && live.hp) {
    au.querySelector('.ab-fh').textContent = `Aurora power ${Math.round(live.hp.v)} GW in the north`;
    setProv(au, 'model', Number.isFinite(live.hp.t) ? new Date(live.hp.t).toISOString() : '', 'model, live');
  }
}
function setProv(li, state, iso, word) {
  const p = li.querySelector('.ab-prov');
  p.className = `ab-prov st-${state}`;
  p.innerHTML = `<i></i>${esc(word || STATE_WORD[state] || state)}${iso ? ` · ${esc(asOf(iso))}` : ''}`;
}

function linksHtml(links) {
  return (links || []).filter((l) => l && /^https:\/\//.test(l.url)).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('');
}
function render(b) {
  const st = b.status || (b.rubin && b.rubin.status ? { text: b.rubin.status, level: b.rubin.level } : null);
  const stale = b.built && ageH(b.built) > 36 ? `<span class="ab-stale"> Built ${Math.round(ageH(b.built) / 24)} days ago: the nightly refresh may not have run.</span>` : '';
  const floors = b.floors.map((f, i) => {
    const m = FLOOR_NAME[f.mode] ? f.mode : 'stars';
    const state = STATE_WORD[f.state] ? f.state : 'nightly';
    return `<li data-i="${i}"${f.live ? ` data-live="${esc(f.live)}"` : ''}>
      <div class="ab-fl"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[m]}</svg><span>${esc(f.floor)}</span><span class="ab-prov st-${state}"><i></i>${esc(STATE_WORD[state])}${f.asOf ? ` · ${esc(asOf(f.asOf))}` : ''}</span></div>
      <button type="button" class="ab-fh" data-go="${i}" aria-describedby="abd${i}">${esc(f.headline)}</button>
      <p class="ab-fd" id="abd${i}">${esc(f.detail || '')}</p>
      ${f.alt && f.alt.label ? `<button type="button" class="ab-alt" data-alt="${i}">${esc(f.alt.label)} ›</button>` : ''}
      <p class="ab-fa"><span>${esc(f.source || '')}</span><span>${linksHtml(f.links || (f.link ? [f.link] : []))}</span></p>
    </li>`;
  }).join('');
  el.innerHTML = `<div class="ab-head"><div><h2 id="abTitle">Above you</h2><p>One line per floor, top to bottom${b.built ? ` · built ${esc(asOf(b.built))}` : ''}</p></div><button type="button" class="btn icon quiet sm ab-close" aria-label="Close Above you" title="Close (Esc)">${CLOSE_IC}</button></div>
    ${st ? `<div class="ab-status lvl-${esc(st.level || '')}"><p>${esc(st.text)}${stale}</p>${st.link ? `<p class="ab-fa"><span>${esc(st.source || '')}${st.asOf ? ` · checked ${esc(asOf(st.asOf))}` : ''}</span><span>${linksHtml([st.link])}</span></p>` : ''}</div>` : ''}
    ${b.failed ? '<p class="ab-fd">The brief could not be loaded. Each floor still shows its own data.</p>' : `<ol class="ab-floors">${floors}</ol>`}
    <p class="ab-foot">Live: straight from the source in your browser. Nightly: refreshed once a day. Model: a forecast, not a sighting.</p>`;
}

function onDocKey(e) {
  if (e.key !== 'Escape' || !el || el.hidden) return;
  if (document.querySelector('.pl-scrim:not([hidden])')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  closeBrief();
}
function onDocDown(e) {
  if (!el || el.hidden || el.contains(e.target) || e.target.closest('.brand h1, [data-ux="brief"], .pl-scrim')) return;
  closeBrief(false);
}

export async function openBrief(from) {
  css();
  opener = from || (document.activeElement !== document.body ? document.activeElement : null);
  if (!el) {
    el = document.createElement('aside');
    el.className = 'ab-brief';
    el.id = 'aboveYou';
    el.hidden = true;
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
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
  const b = await load();
  render(b);
  if (Object.keys(live).length) paintLive();
  el.hidden = false;
  document.querySelectorAll('[data-ux="brief"]').forEach((x) => x.setAttribute('aria-expanded', 'true'));
  document.addEventListener('keydown', onDocKey, true);
  document.addEventListener('pointerdown', onDocDown, true);
  el.focus({ preventScroll: true });
  liveLoop();
}

export function closeBrief(restore = true) {
  if (!el || el.hidden) return;
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.hidden = true;
  clearTimeout(liveT);
  document.querySelectorAll('[data-ux="brief"]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
  document.removeEventListener('keydown', onDocKey, true);
  document.removeEventListener('pointerdown', onDocDown, true);
  if (restore && opener && opener.isConnected && visible(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

export const isBriefOpen = () => !!el && !el.hidden;
export function toggleBrief(from) { if (isBriefOpen()) closeBrief(); else openBrief(from); }
