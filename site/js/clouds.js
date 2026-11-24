const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const EUMV = 'https://view.eumetsat.int/geoserver/wms';
const CACHE = 'observatory-clouds';
const META = 'observatory.earth.clouds.set';
const KEEP_MS = 8 * 3600e3;
export const W = 1024, H = 512;

export const SOURCES = [
  { id: 'mtg', label: 'Meteosat MTG', url: EUMV, layer: 'mtg_fd:ir105_hrfi', lon: 0, box: [-80, -80, 80, 80], kind: 'gray' },
  { id: 'iodc', label: 'Meteosat IODC', url: EUMV, layer: 'msg_iodc:ir108', lon: 45.5, box: [-80, -35, 80, 125], kind: 'gray' },
  { id: 'goese', label: 'GOES-East', url: GIBS, layer: 'GOES-East_ABI_Band13_Clean_Infrared', lon: -75.2, box: [-80, -155, 80, 5], kind: 'enhanced', timed: true },
  { id: 'goesw', label: 'GOES-West', url: GIBS, layer: 'GOES-West_ABI_Band13_Clean_Infrared', lon: -137.0, box: [-80, -180, 80, -60], kind: 'enhanced', timed: true },
  { id: 'hima', label: 'Himawari', url: GIBS, layer: 'Himawari_AHI_Band13_Clean_Infrared', lon: 140.7, box: [-80, 60, 80, 180], kind: 'enhanced', timed: true },
];

const pad = (x) => String(x).padStart(2, '0');
function isoMin(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`; }
function urlOf(s, time) {
  const [la0, lo0, la1, lo1] = s.box, w = Math.round((lo1 - lo0) / 160 * 512), h = Math.round((la1 - la0) / 160 * 512);
  const q = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: s.layer, STYLES: '', CRS: 'EPSG:4326', BBOX: `${la0},${lo0},${la1},${lo1}`, WIDTH: String(w), HEIGHT: String(h), FORMAT: 'image/png', TRANSPARENT: 'TRUE' });
  if (s.timed) q.set('TIME', time);
  return `${s.url}?${q}`;
}
function readMeta() { try { return JSON.parse(localStorage.getItem(META) || 'null'); } catch { return null; } }
function writeMeta(v) { try { localStorage.setItem(META, JSON.stringify(v)); } catch {} }

async function openCache() { try { return 'caches' in window ? await caches.open(CACHE) : null; } catch { return null; } }
async function getBlob(cache, url) {
  if (cache) { try { const hit = await cache.match(url); if (hit) return hit.blob(); } catch {} }
  const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(String(r.status));
  if (!/^image\//.test(r.headers.get('content-type') || '')) throw new Error('not an image');
  if (cache) { try { await cache.put(url, r.clone()); } catch {} }
  return r.blob();
}

const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
function decodePx(kind, r, g, b) {
  if (kind === 'gray') { const v = r / 255; return [smooth(0.4, 0.86, v), smooth(0.72, 1, v)]; }
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 28) { const v = mx / 255; return mx < 40 ? [0, 0] : [smooth(0.45, 0.9, v), smooth(0.8, 1, v) * 0.6]; }
  let h;
  if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
  h *= 60;
  const cold = h > 270 ? 1 : 0.6 + 0.4 * (1 - Math.min(240, h) / 240);
  return [1, cold];
}

async function compose(parts) {
  const acc = new Float32Array(W * H * 3);
  for (const { s, bmp } of parts) {
    const [la0, lo0, la1, lo1] = s.box;
    const x0 = Math.round((lo0 + 180) / 360 * W), w = Math.round((lo1 - lo0) / 360 * W);
    const y0 = Math.round((90 - la1) / 180 * H), h = Math.round((la1 - la0) / 180 * H);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, cl = Math.cos(s.lon * Math.PI / 180), sl = Math.sin(s.lon * Math.PI / 180);
    for (let y = 0; y < h; y++) {
      const lat = 90 - (y0 + y + 0.5) / H * 180, cla = Math.cos(lat * Math.PI / 180);
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (d[o + 3] < 128) continue;
        const lon = (x0 + x + 0.5) / W * 360 - 180, lr = lon * Math.PI / 180;
        const ang = Math.acos(Math.max(-1, Math.min(1, cla * (Math.cos(lr) * cl + Math.sin(lr) * sl)))) * 180 / Math.PI;
        const wt = smooth(78, 60, ang);
        if (wt <= 0) continue;
        const [op, cold] = decodePx(s.kind, d[o], d[o + 1], d[o + 2]);
        const k = ((y0 + y) * W + (((x0 + x) % W) + W) % W) * 3;
        acc[k] += op * wt; acc[k + 1] += cold * wt; acc[k + 2] += wt;
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const out = new Uint8Array(W * H * 2);
  for (let i = 0; i < W * H; i++) {
    const wt = acc[3 * i + 2];
    if (wt <= 0) continue;
    out[2 * i] = Math.round(acc[3 * i] / wt * 255 * Math.min(1, wt * 1.5));
    out[2 * i + 1] = Math.round(acc[3 * i + 1] / wt * 255);
  }
  return out;
}

export async function loadClouds({ fresh = false } = {}) {
  const now = Date.now();
  let meta = readMeta();
  if (fresh || !meta || !(now - meta.at < KEEP_MS) || !Array.isArray(meta.urls) || meta.urls.length !== SOURCES.length) {
    const time = isoMin(Math.floor((now - 40 * 60e3) / 600e3) * 600e3);
    meta = { at: now, time, urls: SOURCES.map((s) => urlOf(s, time)) };
    writeMeta(meta);
  }
  const cache = await openCache();
  if (cache) { try { for (const req of await cache.keys()) if (!meta.urls.includes(req.url)) await cache.delete(req); } catch {} }
  const status = {};
  const parts = (await Promise.all(SOURCES.map(async (s, k) => {
    try {
      const bmp = await createImageBitmap(await getBlob(cache, meta.urls[k]));
      status[s.id] = true;
      return { s, bmp };
    } catch { status[s.id] = false; return null; }
  }))).filter(Boolean);
  if (!parts.length) throw new Error('no cloud imagery could be loaded');
  const data = await compose(parts);
  parts.forEach((p) => p.bmp.close && p.bmp.close());
  return { data, time: Date.parse(meta.time), at: meta.at, status };
}
