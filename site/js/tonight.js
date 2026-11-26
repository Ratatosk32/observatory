import * as K from './kit.js';
import { icon } from './icons.js';
import * as SKY from './skycalc.js';
import * as SL from './starlight.js';
import { PICK, RUBIN, guessSite } from './places.js';

const { esc, MON, clamp } = K;
const C = () => K.C;
const KEY = 'observatory.site';
const FRESH_DAYS = 7;

export async function loadTonight() {
  try {
    const T = await K.loadJson('data/tonight.json');
    return T && Array.isArray(T.recent) ? T : null;
  } catch { return null; }
}

function browserZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
function readSite() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v;
  } catch {}
  return guessSite();
}
function writeSite(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }
const round5 = (x) => Math.round(x * 2) / 2;
const nowMjd = () => Date.now() / 864e5 + 40587;
const fmtDay = (mjd) => { const d = new Date((mjd - 40587) * 864e5); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const pad2 = (x) => String(x).padStart(2, '0');
const sexa = (deg, hours) => {
  const sign = deg < 0 ? '−' : hours ? '' : '+';
  let v = Math.abs(hours ? deg / 15 : deg);
  const a = Math.floor(v); v = (v - a) * 60; const b = Math.floor(v); const c = (v - b) * 60;
  return `${sign}${pad2(a)}${hours ? 'h' : '°'} ${pad2(b)}${hours ? 'm' : '′'} ${c.toFixed(hours ? 1 : 0).padStart(hours ? 4 : 2, '0')}${hours ? 's' : '″'}`;
};
const reachOf = (r) => { const gr = r.det.filter((d) => (d[1] === 'g' || d[1] === 'r') && d[0] >= r.last - 3.5); if (!gr.length) return null; const b = gr.reduce((a, d) => (d[2] < a[2] ? d : a)); return [b[2], b[1]]; };
const scopeOf = (m) => (m <= 17.5 ? '20 cm scope' : m <= 19.0 ? '30 cm scope' : '');
const shortType = (t) => (t ? t.replace(/^SN /, '').replace(/-like$/, '') : 'transient');
function zoneOffsetMin(tz, mjd) {
  const d = new Date((mjd - 40587) * 864e5);
  try {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
    const loc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    return Math.round((loc - Math.floor(d.getTime() / 6e4) * 6e4) / 6e4);
  } catch { return null; }
}

export function createTonight(T, env) {
  const recent = T.recent;
  const st = { site: readSite(), note: '', picker: false, preview: null, showRecent: false };
  let calc = [], start = 0, dataLate = false;
  const site = () => st.preview || st.site;
  function compute() {
    const s = site();
    start = SKY.nightStart(nowMjd(), s.lon);
    calc = recent.map((r) => SKY.night(r.ra, r.dec, s.lat, s.lon, start));
    calc.sunOnly = SKY.night(null, null, s.lat, s.lon, start);
    dataLate = nowMjd() - (T.refNight + 1) > 2;
  }
  compute();
  const fresh = (k) => nowMjd() - recent[k].last <= FRESH_DAYS;
  const flagged = () => recent.map((r, k) => k).filter((k) => recent[k].tonight);
  const targets = () => flagged().filter(fresh);
  const observable = () => targets().filter((k) => calc[k].hours >= 1);
  const siteName = () => { const s = site(); return `${s.label}, ${Math.abs(s.lat).toFixed(1)}° ${s.lat >= 0 ? 'N' : 'S'}`; };
  function siteLine() {
    const s = st.site;
    if (st.preview) return `Preview from ${siteName()} · <button type="button" class="link" data-endpreview>back to ${esc(s.label)}</button>`;
    if (s.src === 'tz-unknown') return `From ${esc(RUBIN.label)} · set your place`;
    const tail = s.src === 'gps' ? 'your location, kept in this browser' : s.src === 'tz' ? 'guessed from your time zone' : 'your choice, kept in this browser';
    return `From ${esc(siteName())} · ${tail}`;
  }
  const zoneOf = (s) => (s.src === 'custom' ? '' : s.src === 'gps' ? (s.tz || browserZone()) : s.tz || '');
  function offsetMin(mjd) {
    const s = site(), z = zoneOf(s), o = z ? zoneOffsetMin(z, mjd) : null;
    return o == null ? s.lon / 360 * 1440 : o;
  }
  const solar = () => !zoneOf(site()) || zoneOffsetMin(zoneOf(site()), start) == null;
  const localMin = (mjd) => ((((mjd - Math.floor(mjd)) * 1440 + offsetMin(mjd)) % 1440) + 1440) % 1440;
  const clock = (mjd) => { const m = Math.round(localMin(mjd) / 10) * 10 % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
  const ago = (mjd) => { const d = Math.floor(nowMjd() - mjd); return d <= 1 ? 'last night' : `${d} days ago`; };
  function chipLabel() {
    const n = observable().length;
    return n ? `Tonight · ${n}` : 'Tonight';
  }
  function pillLabel() {
    const n = targets().length, o = observable().length, place = site().label;
    if (!n) return 'Tonight · nothing confirmed this week';
    if (!o) return `Tonight · ${n} target${n === 1 ? '' : 's'}, none high from ${place}`;
    return `Tonight · ${o} up from ${place}`;
  }
  function lanternTarget() {
    const s = site(), mid = start + 0.5;
    return { ra: ((SKY.gmst(mid) + s.lon) % 360 + 360) % 360, dec: s.lat };
  }
  function sparkline(cv, k) {
    const g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), w = 80, h = 26;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = calc[k], n = c.alt.length;
    const ks = []; for (let i = 0; i < n; i++) if (c.sun[i] < -12) ks.push(i);
    if (!ks.length) return;
    const X = (q) => (q - ks[0]) / Math.max(1, ks[ks.length - 1] - ks[0]) * (w - 2) + 1, Y = (a) => h - 1 - clamp(a, 0, 90) / 90 * (h - 2);
    g.strokeStyle = C().grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(30) + 0.5); g.lineTo(w, Y(30) + 0.5); g.stroke();
    g.strokeStyle = C().gold; g.lineJoin = 'round'; g.beginPath();
    ks.forEach((i, q) => { const x = X(i), y = Y(c.alt[i]); if (q) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }
  function rowHtml(k, muted, stale) {
    const r = recent[k], c = calc[k];
    const sub = `${esc(shortType(r.type))} · ${r.lastBand} ${r.lastMag.toFixed(1)} · ${stale ? `seen ${ago(r.last)}, may have faded` : ago(r.last)}`;
    const right = stale ? '' : muted ? (c.best > 0 ? `highest ${Math.round(c.best)}° at ${clock(c.bestAt)}` : 'never rises') : `${c.hours.toFixed(1)} h`;
    return `<li class="${muted ? 'muted' : ''}${stale ? ' stale' : ''}${env.selected() === k ? ' on' : ''}"><button type="button" data-t="${k}"><span class="sw${muted ? ' hollow' : ''}"></span><span class="nm"><b>${esc(r.name)}</b><small>${sub}</small></span>${stale ? '' : `<canvas data-spark="${k}" aria-hidden="true"></canvas><span class="hrs">${right}</span>`}</button></li>`;
  }
  function renderList(body) {
    compute();
    const s = site();
    const all = targets(), obs = observable(), stale = flagged().filter((k) => !fresh(k));
    const dark = calc.sunOnly && calc.sunOnly.dark;
    let lead = '', rows = '', late = dataLate;
    if (!dark) {
      lead = `<p class="cap">No full darkness tonight at ${Math.abs(s.lat).toFixed(0)}° ${s.lat >= 0 ? 'N' : 'S'}, so nothing to plan.</p>`;
      rows = all.map((k) => rowHtml(k, true)).join('');
    } else if (!all.length && stale.length) {
      lead = `<p class="cap">Nothing confirmed bright this week.${dataLate ? ` Rubin has had no data since ${fmtDay(T.refNight)}.` : ''}</p><h4>Last targets</h4>`;
      late = false;
      rows = stale.sort((a, b) => recent[b].last - recent[a].last).map((k) => rowHtml(k, true, true)).join('');
    } else if (!all.length) {
      const last = recent[0];
      lead = `<p class="cap">Nothing bright enough tonight. Rubin finds about two targets a week brighter than 19th magnitude${last ? `; the last was ${esc(last.name)}, ${ago(last.last)}` : ''}.</p>`;
      rows = st.showRecent ? recent.map((r, k) => rowHtml(k, true, true)).join('') : '';
      if (recent.length && !st.showRecent) rows = `<li class="more"><button type="button" class="link" data-recent>Show the last 30 days (${recent.length})</button></li>`;
    } else if (!obs.length) {
      lead = `<p class="cap">None of tonight’s ${all.length} targets climbs above 30° in the dark from ${esc(s.label)}. Rubin watches the southern sky; north of about 40° N most of its targets stay low.</p>`;
      rows = all.map((k) => rowHtml(k, true)).join('') + (st.preview ? '' : `<li class="more"><button type="button" class="link" data-preview>See them from La Serena</button></li>`);
    } else {
      const order = [...obs].sort((a, b) => calc[b].hours - calc[a].hours || recent[a].lastMag - recent[b].lastMag);
      rows = order.map((k) => rowHtml(k, false)).join('') + all.filter((k) => !obs.includes(k)).map((k) => rowHtml(k, true)).join('');
    }
    body.innerHTML = `<h3 class="ph">Tonight</h3>
      <p class="note site">${siteLine()}</p>
      <div class="sitebtns"><button class="btn" type="button" data-gps>Use my location</button><button class="btn" type="button" data-pick>Change place</button></div>
      ${st.note ? `<p class="note">${esc(st.note)}</p>` : ''}
      ${st.picker ? `<div class="picker"><select aria-label="Place">${PICK.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}<option value="custom">Custom…</option></select>
        <span class="custom" hidden><input type="number" step="0.1" min="-90" max="90" aria-label="Latitude" placeholder="lat"><input type="number" step="0.1" min="-180" max="180" aria-label="Longitude" placeholder="lon"></span><button class="btn" type="button" data-apply>Apply</button></div>` : ''}
      ${late ? `<p class="note">No new Rubin data since ${fmtDay(T.refNight)}.</p>` : ''}
      ${lead}
      <ul class="tonight">${rows}</ul>
      <p class="note">All of these are already on TNS. What this adds: picking targets for your sky, timing and a finder.</p>
      <p class="note"><button type="button" class="link" data-map>↑ Map</button></p>`;
    body.querySelectorAll('[data-spark]').forEach((cv) => sparkline(cv, +cv.dataset.spark));
    body.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => env.pick(+b.dataset.t)));
    const on = (sel, fn) => { const el = body.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('[data-gps]', useGps);
    on('[data-pick]', () => { st.picker = !st.picker; env.changed(); });
    on('[data-recent]', () => { st.showRecent = true; env.changed(); });
    on('[data-preview]', () => { st.preview = { ...PICK[0], src: 'pick' }; compute(); env.changed(); });
    on('[data-endpreview]', () => { st.preview = null; compute(); env.changed(); });
    on('[data-map]', () => env.toMap());
    const sel = body.querySelector('.picker select');
    if (sel) {
      const cust = body.querySelector('.picker .custom');
      sel.addEventListener('change', () => { cust.hidden = sel.value !== 'custom'; });
      on('[data-apply]', () => {
        let v;
        if (sel.value === 'custom') {
          const [la, lo] = [...cust.querySelectorAll('input')].map((x) => parseFloat(x.value));
          if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
          v = { label: 'your place', lat: round5(la), lon: round5(lo), src: 'custom' };
        } else v = { ...PICK[+sel.value], src: 'pick' };
        setSite(v);
      });
    }
  }
  function setSite(v) {
    st.site = v; st.preview = null; st.picker = false; st.note = '';
    writeSite(v); compute(); env.changed();
  }
  function useGps() {
    const denied = () => { st.note = 'Location not shared. Pick a place instead.'; st.picker = true; env.changed(); };
    if (!navigator.geolocation) { denied(); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      setSite({ label: 'your location', lat: round5(p.coords.latitude), lon: round5(p.coords.longitude), src: 'gps', tz: browserZone() });
    }, denied, { maximumAge: 3.6e6, timeout: 10000, enableHighAccuracy: false });
  }

  function altChart(s, k) {
    const g = s.ctx, w = s.w, h = s.h, c = calc[k];
    g.clearRect(0, 0, w, h);
    const L = 30, R = 8, T0 = 8, B = 20;
    const i0 = Math.round(0.25 * 1440 / c.step), i1 = Math.round(0.75 * 1440 / c.step);
    const X = (i) => L + (i - i0) / (i1 - i0) * (w - L - R), Y = (a) => T0 + (1 - clamp(a, 0, 90) / 90) * (h - T0 - B);
    const tAt = (i) => c.start + i * c.step / 1440;
    const shadeOf = (sun) => (sun > 0 ? 4 : sun > -6 ? 3 : sun > -12 ? 2 : sun > -18 ? 1 : 0);
    for (let i = i0; i < i1;) {
      const shade = shadeOf(c.sun[i]);
      let j = i + 1;
      while (j < i1 && shadeOf(c.sun[j]) === shade) j++;
      if (shade) {
        g.fillStyle = C().ink3; g.globalAlpha = 0.07 * shade;
        const xa = Math.round(X(i)), xb = Math.round(X(j));
        g.fillRect(xa, T0, xb - xa, h - T0 - B);
      }
      i = j;
    }
    g.globalAlpha = 1;
    g.setLineDash([3, 3]); g.strokeStyle = C().ink3; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(30)); g.lineTo(w - R, Y(30)); g.stroke(); g.setLineDash([]);
    for (const a of [0, 30, 60, 90]) K.text(g, `${a}°`, L - 4, Y(a) + 4, { size: 11, color: C().ink3, align: 'right' });
    for (let i = i0; i <= i1; i++) {
      const m0 = localMin(tAt(i)), m1 = localMin(tAt(i - 1));
      if (Math.floor(m0 / 180) === Math.floor(m1 / 180) && i > i0) continue;
      if (i === i0) continue;
      const hh = Math.floor(m0 / 60) % 24;
      K.text(g, `${pad2(hh)}:00`, clamp(X(i), L + 16, w - R - 16), h - 5, { size: 11, color: C().ink3, align: 'center' });
    }
    if (solar()) K.text(g, 'local solar time', w - R, T0 + 10, { size: 11, color: C().ink3, align: 'right' });
    const seg = (good) => {
      g.beginPath();
      let open = false;
      for (let i = i0; i <= i1; i++) {
        const a = c.alt[i], ok = a >= 0 && (good ? c.sun[i] < -12 && a > 30 : true);
        if (ok) { if (open) g.lineTo(X(i), Y(a)); else { g.moveTo(X(i), Y(a)); open = true; } } else open = false;
      }
    };
    g.lineJoin = 'round'; g.lineCap = 'round';
    seg(false); g.strokeStyle = C().gold; g.lineWidth = 1; g.globalAlpha = 0.5; g.stroke();
    seg(true); g.lineWidth = 2.2; g.globalAlpha = 1; g.stroke();
    g.lineCap = 'butt';
    const nowI = (nowMjd() - c.start) * 1440 / c.step;
    if (nowI > i0 + 0.5 && nowI < i1 - 0.5) {
      g.strokeStyle = C().ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(X(nowI), T0); g.lineTo(X(nowI), h - B); g.stroke();
      K.text(g, 'now', X(nowI) + 3, T0 + 10, { size: 11, color: C().ink2 });
    }
    s.cv.onmousemove = (e) => {
      const r = s.cv.getBoundingClientRect(), i = Math.round(i0 + (e.clientX - r.left - L) / (w - L - R) * (i1 - i0));
      if (i < i0 || i >= i1) { K.hideTip(); return; }
      K.showTip(`${clock(tAt(i))} · ${Math.round(c.alt[i])}° · ${c.sun[i] < -12 ? 'dark' : c.sun[i] < 0 ? 'twilight' : 'day'}`, e.clientX, e.clientY);
    };
    s.cv.onmouseleave = () => K.hideTip();
  }
  function lcChart(s, k) {
    const g = s.ctx, w = s.w, h = s.h, r = recent[k], today = nowMjd();
    g.clearRect(0, 0, w, h);
    const ts = r.det.map((d) => d[0]), ms = r.det.map((d) => d[2]);
    const t0 = Math.min(...ts) - 1, t1 = Math.max(Math.max(...ts), today) + 1;
    let m0 = Math.min(...ms, 18.5), m1 = Math.max(...ms, 18.5);
    if (m1 - m0 < 1.5) { const mid = (m0 + m1) / 2; m0 = mid - 0.75; m1 = mid + 0.75; }
    m0 = Math.floor((m0 - 0.1) * 2) / 2; m1 = Math.ceil((m1 + 0.1) * 2) / 2;
    const few = r.det.length <= 4, L = 34, R = 8, T0 = 8, B = 20;
    const X = (t) => L + (t - t0) / (t1 - t0) * (w - L - R), Y = (m) => T0 + (m - m0) / (m1 - m0) * (h - T0 - B);
    g.setLineDash([4, 3]); g.strokeStyle = C().ink3; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, Y(18.5)); g.lineTo(w - R, Y(18.5)); g.stroke();
    g.beginPath(); g.moveTo(X(today), T0); g.lineTo(X(today), h - B); g.stroke(); g.setLineDash([]);
    K.text(g, '~18.5', X(today) - 6, Y(18.5) - 4, { size: 11, color: C().ink3, align: 'right' });
    K.text(g, 'today', X(today) - 3, h - 5, { size: 11, color: C().ink3, align: 'right' });
    const stepM = (h - T0 - B) / ((m1 - m0) / 0.5) >= 14 ? 0.5 : 1;
    for (let m = Math.ceil(m0 / stepM) * stepM; m <= m1 + 1e-9; m += stepM) K.text(g, Number.isInteger(m) ? String(m) : m.toFixed(1), L - 4, Y(m) + 4, { size: 11, color: C().ink3, align: 'right' });
    K.text(g, fmtDay(t0 + 1), L, h - 5, { size: 11, color: C().ink3 });
    for (const [t, b, m] of r.det) { g.fillStyle = C().band[b] || C().gold; g.beginPath(); g.arc(X(t), Y(m), 3, 0, 6.283); g.fill(); }
    if (few) {
      const [t, b, m] = r.det[r.det.length - 1], lab = `${b} ${m.toFixed(2)} · ${fmtDay(t)}`;
      g.font = K.font(11);
      const tw = g.measureText(lab).width, right = X(t) + 8 + tw < w - R;
      K.text(g, lab, right ? X(t) + 8 : X(t) - 8, Y(m) + 4, { size: 11, color: C().ink2, align: right ? 'left' : 'right', halo: true });
    }
  }
  function decodeFinder(r) {
    const raw = Uint8Array.from(atob(r.finder.stars || ''), (c) => c.charCodeAt(0)), dv = new DataView(raw.buffer), out = [];
    for (let o = 0; o + 6 <= raw.length; o += 6) out.push([dv.getInt16(o, true) / 10, dv.getInt16(o + 2, true) / 10, (dv.getUint8(o + 4) + 100) / 10, dv.getInt8(o + 5) / 20]);
    return out;
  }
  function drawFinder(g, size, r, { dark = C().dark, title = false } = {}) {
    const top = title ? 60 : 0, H = size + top;
    g.fillStyle = title ? (dark ? '#000' : '#fff') : C().bg;
    g.fillRect(0, 0, size, H);
    const sc = size / (r.finder.fieldArcmin * 60), cx = size / 2, cy = top + size / 2, atlas = env.atlas();
    const stars = decodeFinder(r);
    for (const [dx, dy, G, c] of stars) {
      const x = cx - dx * sc, y = cy - dy * sc, rad = clamp(1.2 + (19.5 - G) * 0.85, 1.2, 6) * 0.55 * size / 380;
      if (dark && atlas) { const R = rad * 3; g.globalAlpha = 1; g.drawImage(atlas.core[SL.bucketOf(c)], x - R, y - R, 2 * R, 2 * R); }
      else { g.fillStyle = dark ? '#eee' : '#111'; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }
    }
    const u = size / 380;
    g.strokeStyle = C().gold; g.lineWidth = 2.5 * u;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(cx + ax * 7 * u, cy + ay * 7 * u); g.lineTo(cx + ax * 19 * u, cy + ay * 19 * u); g.stroke(); }
    const discs = stars.map(([dx, dy, G]) => [cx - dx * sc, cy - dy * sc, clamp(1.2 + (19.5 - G) * 0.85, 1.2, 6) * 0.55 * size / 380]);
    const clear = (b) => discs.every(([x, y, rr]) => rr <= 1.5 * u || x + rr + 3 * u < b[0] || x - rr - 3 * u > b[2] || y + rr + 3 * u < b[1] || y - rr - 3 * u > b[3]);
    g.font = K.font(11 * u);
    let lab = 0;
    for (const [dx, dy, G] of stars) {
      const d = Math.hypot(dx, dy);
      if (lab >= 4 || G < 14 || G > 17 || d < 40 || d > 240) continue;
      const x = cx - dx * sc, y = cy - dy * sc, str = G.toFixed(1), tw = g.measureText(str).width;
      if (Math.hypot(x - cx, y - cy) < 24 * u) continue;
      if (!clear([x + 8 * u, y - 5 * u, x + 8 * u + tw, y + 4 * u])) continue;
      K.text(g, str, x + 8 * u, y + 4 * u, { size: 11 * u, color: title ? (dark ? '#bbb' : '#555') : C().ink3 });
      lab++;
    }
    const ink = title ? (dark ? '#bbb' : '#555') : C().ink3;
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1 * u;
    const ox = size - 40 * u, oy = top + 40 * u;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox, oy - 26 * u); g.moveTo(ox, oy); g.lineTo(ox - 26 * u, oy); g.stroke();
    K.text(g, 'N', ox, oy - 30 * u, { size: 11 * u, color: ink, align: 'center' });
    K.text(g, 'E', ox - 32 * u, oy + 4 * u, { size: 11 * u, color: ink, align: 'right' });
    const bar = 60 * sc;
    let by = top + size - 14 * u;
    if (discs.some(([x, y, rr]) => x + rr > 12 * u && x - rr < 12 * u + bar && Math.abs(y - by) < rr + 3 * u)) by -= 6 * u;
    g.beginPath(); g.moveTo(12 * u, by); g.lineTo(12 * u + bar, by); g.stroke();
    K.text(g, '1′', 12 * u + bar / 2, by - 6 * u, { size: 11 * u, color: ink, align: 'center' });
    K.text(g, 'Gaia DR3 · G < 19.5', size - 10 * u, top + size - 10 * u, { size: 11 * u, color: ink, align: 'right' });
    if (title) K.text(g, `${r.name} · RA ${sexa(r.ra, true)} Dec ${sexa(r.dec, false)} · 12′, N up E left · observatory.noetx.com`, 16, 36, { size: 18, color: dark ? '#eee' : '#111' });
  }
  function savePng(r) {
    const size = 1200, cv = document.createElement('canvas');
    cv.width = size; cv.height = size + 60;
    cardTokens(() => drawFinder(cv.getContext('2d'), size, r, { title: true, dark: C().dark }))();
    cv.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${r.name.replace(/\s+/g, '_')}_finder.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
  }
  let cardEl = null;
  const cardTokens = (fn) => (...a) => (cardEl ? K.withTokensOf(cardEl, fn)(...a) : fn(...a));
  function renderTarget(body, k) {
    cardEl = body.closest('.card') || body;
    compute();
    const r = recent[k], c = calc[k], chips = [], isFresh = fresh(k);
    if (c.hours >= 1) chips.push(`Up ${c.hours.toFixed(1)} h tonight`);
    else chips.push(c.best > 0 ? `Highest ${Math.round(c.best)}° tonight` : 'Below the horizon tonight');
    const reach = reachOf(r); if (reach && scopeOf(reach[0])) chips.push(`${reach[1]} ${reach[0].toFixed(1)} · ${scopeOf(reach[0])}`);
    const first = r.det[0][2];
    if (isFresh && first - r.peakMag >= 0.5) chips.push(`Brightened ${(first - r.peakMag).toFixed(1)} mag`);
    if (!isFresh) chips.push(`Seen ${ago(r.last)}, may have faded`);
    const tnsName = r.name.replace(/^(SN|AT|TDE)\s+/, '');
    const facts = [
      ['RA, Dec', `${sexa(r.ra, true)} ${sexa(r.dec, false)} <small>(${r.ra.toFixed(4)}°, ${r.dec.toFixed(4)}°)</small>`],
      ['Last', `${r.lastBand} ${r.lastMag.toFixed(2)} on ${fmtDay(r.last)}`],
      ['Peak', `${r.peakMag.toFixed(2)}`],
      ['Host z', r.z != null ? r.z.toFixed(3) : '—'],
      ['TNS', `<a href="https://www.wis-tns.org/object/${encodeURIComponent(tnsName)}" target="_blank" rel="noopener">${esc(r.name)}</a>`],
    ];
    body.innerHTML = `<h3>${esc(r.name)}</h3>
      <div class="cls"><span class="sw" style="background:var(--gold)"></span>${esc(r.type || 'Transient')} <span style="color:var(--ink3)">· Rubin ${esc(r.id)}</span></div>
      ${chips.length ? `<div class="why">${chips.slice(0, 3).map((t, i) => `<span class="${i ? '' : 'best'}">${esc(t)}</span>`).join('')}</div>` : ''}
      <dl>${facts.map(([a, b]) => `<div style="grid-column:span ${b.length > 40 ? 3 : 1}"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
      <h4>Tonight from ${esc(siteName())}</h4>
      <p class="cap">Altitude through the night. Shaded: twilight. Best above 30°.</p>
      <canvas class="altc" aria-label="Altitude through the night"></canvas>
      <h4>Rubin light curve</h4>
      <p class="cap">Difference magnitude. Dashed: what a 30–50 cm scope reaches.</p>
      <canvas class="lcc${r.det.length <= 4 ? ' few' : ''}" aria-label="Rubin light curve"></canvas>
      <h4>Finder chart</h4>
      <p class="cap">12′ field, north up, east left. Gaia DR3 stars to G 19.5.</p>
      <canvas class="finder" aria-label="Finder chart"></canvas>
      <p class="note sexa">${sexa(r.ra, true)} ${sexa(r.dec, false)}</p>
      <p class="links"><button class="btn" type="button" data-save>Save finder (PNG)</button> <span class="note">Report: <a href="https://www.wis-tns.org/object/${encodeURIComponent(tnsName)}" target="_blank" rel="noopener">TNS</a> · <a href="https://www.aavso.org/webobs" target="_blank" rel="noopener">AAVSO</a></span></p>
      <p class="note"><button type="button" class="link lk" data-back>${icon('back')}Tonight’s list</button></p>`;
    const altS = K.setupCanvas(body.querySelector('.altc'), (s) => altChart(s, k));
    const lcS = K.setupCanvas(body.querySelector('.lcc'), (s) => lcChart(s, k));
    const finderS = K.setupCanvas(body.querySelector('.finder'), cardTokens((s) => { s.ctx.save(); drawFinder(s.ctx, s.w, r); s.ctx.restore(); }));
    body.querySelector('[data-save]').addEventListener('click', () => savePng(r));
    body.querySelector('[data-back]').addEventListener('click', () => env.pick(-1));
    return [altS, lcS, finderS];
  }
  function drawSky(g, project, nowS, sk) {
    for (const k of targets()) {
      const r = recent[k], p = project(r.ra, r.dec);
      if (!p) continue;
      const obs = calc[k].hours >= 1, base = 4 * sk;
      g.fillStyle = C().gold; g.globalAlpha = 0.95; g.beginPath(); g.arc(p[0], p[1], 2.2 * sk, 0, 6.283); g.fill();
      g.lineWidth = 1;
      if (!obs) { g.strokeStyle = C().ink3; g.globalAlpha = 0.4; g.beginPath(); g.arc(p[0], p[1], base + 6, 0, 6.283); g.stroke(); continue; }
      g.strokeStyle = C().gold;
      if (K.reduceMotion) { g.globalAlpha = 0.5; g.beginPath(); g.arc(p[0], p[1], base + 6, 0, 6.283); g.stroke(); continue; }
      const ph = (nowS / 2.4) % 1;
      g.globalAlpha = 0.6 * (1 - ph); g.beginPath(); g.arc(p[0], p[1], base + 4 + 8 * ph, 0, 6.283); g.stroke();
    }
    g.globalAlpha = 1;
  }
  function hit(x, y, project) {
    let best = -1, bd = 14 * 14;
    for (const k of targets()) { const p = project(recent[k].ra, recent[k].dec); if (!p) continue; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  const pulsing = () => observable().length > 0;
  return { T, recent, targets, observable, chipLabel, pillLabel, lanternTarget, renderList, renderTarget, drawSky, hit, pulsing, site, compute };
}
