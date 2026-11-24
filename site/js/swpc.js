const BASE = 'https://services.swpc.noaa.gov/';
const MIN = 60e3;

const tOf = (s) => {
  if (typeof s !== 'string') return NaN;
  const v = s.replace('_', 'T').replace(/Z?$/, 'Z');
  return Date.parse(v.length === 17 ? v.replace('Z', ':00Z') : v) / 1000;
};
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const rows = (j) => (Array.isArray(j) ? j.filter((r) => r && typeof r === 'object') : null);

function first(j) { const r = rows(j); return r && r.length ? r[0] : null; }

const PARSE = {
  speed: (j) => { const r = first(j); const v = r && num(r.proton_speed); return v == null ? null : { t: tOf(r.time_tag), v }; },
  mag: (j) => { const r = first(j); const v = r && num(r.bz_gsm); return v == null ? null : { t: tOf(r.time_tag), bz: v, bt: num(r.bt) }; },
  scales: (j) => {
    if (!j || !j['0'] || !j['0'].G) return null;
    const pick = (d) => { const o = {}; for (const k of ['R', 'S', 'G']) o[k] = d && d[k] && d[k].Scale != null && d[k].Scale !== '' ? +d[k].Scale : null; return o; };
    return { now: pick(j['0']), max24: pick(j['-1']), at: tOf(`${j['0'].DateStamp}T${String(j['0'].TimeStamp).slice(0, 5)}Z`), forecast: ['1', '2', '3'].filter((k) => j[k]).map((k) => ({ day: j[k].DateStamp, G: pick(j[k]).G })) };
  },
  kp1m: (j) => { const r = rows(j); if (!r || !r.length || !('estimated_kp' in r[0])) return null; return r.map((x) => [tOf(x.time_tag), num(x.estimated_kp)]).filter((x) => Number.isFinite(x[0]) && x[1] != null); },
  kp3: (j) => { const r = rows(j); if (!r || !r.length || !('Kp' in r[0])) return null; return r.map((x) => [tOf(x.time_tag), num(x.Kp)]).filter((x) => Number.isFinite(x[0]) && x[1] != null); },
  kpf: (j) => { const r = rows(j); if (!r || !r.length || !('kp' in r[0])) return null; return r.filter((x) => x.observed === 'predicted').map((x) => [tOf(x.time_tag), num(x.kp)]).filter((x) => x[1] != null); },
  flares: (j) => { const r = rows(j); if (!r) return null; return r.filter((x) => x.max_time && x.max_class).map((x) => [tOf(x.max_time), x.max_class, num(x.max_xrlong)]); },
  xray: (j) => { const r = rows(j); if (!r || !r.length || !('flux' in r[0])) return null; return r.filter((x) => x.energy === '0.1-0.8nm' && num(x.flux) > 0).map((x) => [tOf(x.time_tag), +x.flux]); },
  wind: (j) => { const r = rows(j); if (!r || !r.length || !('proton_speed' in r[0])) return null; return { rows: r.filter((x) => x.active).map((x) => [tOf(x.time_tag), num(x.proton_speed), num(x.proton_density)]).sort((a, b) => a[0] - b[0]), sources: [...new Set(r.map((x) => x.source).filter(Boolean))], active: (r.find((x) => x.active) || {}).source || null }; },
  magfull: (j) => { const r = rows(j); if (!r || !r.length || !('bz_gsm' in r[0])) return null; return { rows: r.filter((x) => x.active).map((x) => [tOf(x.time_tag), num(x.bz_gsm)]).sort((a, b) => a[0] - b[0]), sources: [...new Set(r.map((x) => x.source).filter(Boolean))], active: (r.find((x) => x.active) || {}).source || null }; },
  hp: (txt) => {
    if (typeof txt !== 'string' || !txt.includes('Hemispheric')) return null;
    const out = [];
    for (const line of txt.split('\n')) {
      if (!line || line[0] === '#') continue;
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const t = tOf(p[0]);
      if (Number.isFinite(t) && Number.isFinite(+p[2]) && Number.isFinite(+p[3])) out.push([t, +p[2], +p[3]]);
    }
    return out.length ? out : null;
  },
  ovation: (j) => {
    if (!j || !Array.isArray(j.coordinates) || j.coordinates.length < 60000) return null;
    const g = new Uint8Array(362 * 181);
    for (const c of j.coordinates) {
      const lon = ((c[0] % 360) + 360) % 360, lat = c[1] + 90, v = Math.max(0, Math.min(100, c[2] | 0));
      if (lat < 0 || lat > 180) continue;
      g[lat * 362 + lon] = v;
    }
    for (let r = 0; r < 181; r++) { g[r * 362 + 360] = g[r * 362]; g[r * 362 + 361] = g[r * 362 + 1]; }
    return { grid: g, obs: tOf(j['Observation Time']), valid: tOf(j['Forecast Time']) };
  },
};

const ENDPOINTS = [
  ['speed', 'products/summary/solar-wind-speed.json', 1],
  ['mag', 'products/summary/solar-wind-mag-field.json', 1],
  ['scales', 'products/noaa-scales.json', 1],
  ['kp1m', 'json/planetary_k_index_1m.json', 1],
  ['flares', 'json/goes/primary/xray-flares-latest.json', 1],
  ['xray', 'json/goes/primary/xrays-6-hour.json', 5],
  ['hp', 'text/aurora-nowcast-hemi-power.txt', 5],
  ['ovation', 'json/ovation_aurora_latest.json', 10],
  ['kp3', 'products/noaa-planetary-k-index.json', 10],
  ['kpf', 'products/noaa-planetary-k-index-forecast.json', 60],
  ['wind', 'json/rtsw/rtsw_wind_1m.json', 0, 'desktop'],
  ['magfull', 'json/rtsw/rtsw_mag_1m.json', 0, 'desktop'],
];

export function createLive({ desktop, onUpdate }) {
  const st = {};
  for (const [id] of ENDPOINTS) st[id] = { data: null, at: 0, last: 0, fails: 0, timer: 0, ok: null };
  let running = false, enabled = true;
  const req = { count: 0, log: [] };

  async function hit(id) {
    const [, path, every, only] = ENDPOINTS.find((e) => e[0] === id);
    const s = st[id];
    s.timer = 0;
    if (!running || document.hidden) return;
    s.last = Date.now();
    req.count++; req.log.push([id, s.last]); if (req.log.length > 200) req.log.shift();
    let ok = false;
    try {
      const r = await fetch(BASE + path, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error(String(r.status));
      const body = id === 'hp' ? await r.text() : await r.json();
      const v = PARSE[id](body);
      if (v == null) throw new Error('shape');
      s.data = v; s.at = Date.now(); s.fails = 0; s.ok = true; ok = true;
    } catch {
      s.fails++; s.ok = false;
    }
    if (running) onUpdate(id, ok);
    if (!running || (only && ok)) return;
    const base = every ? every * MIN : MIN;
    const wait = ok ? base : Math.min(15 * MIN, Math.max(base, MIN * 2 ** (s.fails - 1)));
    if (!every && ok) return;
    s.timer = setTimeout(() => hit(id), wait);
  }

  function schedule() {
    const now = Date.now();
    ENDPOINTS.forEach(([id, , every, only], k) => {
      const s = st[id];
      if (s.timer || (only === 'desktop' && !desktop)) return;
      if (!every && s.ok) return;
      const due = Math.max(0, (s.last ? s.last + (every || 1) * MIN : 0) - now);
      s.timer = setTimeout(() => hit(id), Math.max(due, (only ? 1500 : 0) + k * 120));
    });
  }
  function halt() { for (const id in st) { clearTimeout(st[id].timer); st[id].timer = 0; } }
  function start() { if (running || !enabled) return; running = true; if (!document.hidden) schedule(); }
  function stop() { running = false; halt(); }
  document.addEventListener('visibilitychange', () => { if (!running) return; if (document.hidden) halt(); else schedule(); });
  return {
    st, req,
    start, stop,
    get running() { return running; },
    get enabled() { return enabled; },
    setEnabled(v) { enabled = v; if (!v) stop(); },
    anyOk: () => Object.values(st).some((s) => s.ok),
    allFailed: () => Object.values(st).every((s) => s.ok === false || s.ok === null) && Object.values(st).some((s) => s.ok === false),
  };
}
