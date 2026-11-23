import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const MODES = (opt('modes', 'asteroids,stars')).split(',');
const SITE = resolve(opt('site', join(ROOT, 'site')));
const STATE = resolve(opt('state', join(ROOT, 'data', 'site-state')));
const LIMIT_MIN = +opt('minutes', '9');

class Req { constructor() { this.result = undefined; } }
class MemStore {
  constructor() { this.map = new Map(); }
  get(k) { const r = new Req(); r.result = this.map.get(k); return r; }
  getAll() { const r = new Req(); r.result = [...this.map.values()]; return r; }
  count() { const r = new Req(); r.result = this.map.size; return r; }
  put(v, k) { this.map.set(k, v); return new Req(); }
  clear() { this.map.clear(); return new Req(); }
}
class MemDb {
  constructor() { this.stores = new Map(); this.objectStoreNames = { contains: (n) => this.stores.has(n) }; }
  createObjectStore(n) { const s = new MemStore(); this.stores.set(n, s); return s; }
  transaction(name) {
    const tx = { objectStore: () => this.stores.get(name), oncomplete: null, onerror: null, onabort: null };
    setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
    return tx;
  }
}
const dbs = new Map();
globalThis.indexedDB = {
  open(name) {
    const rq = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      let db = dbs.get(name);
      if (!db) { db = new MemDb(); dbs.set(name, db); rq.result = db; if (rq.onupgradeneeded) rq.onupgradeneeded(); }
      rq.result = db;
      if (rq.onsuccess) rq.onsuccess();
    }, 0);
    return rq;
  },
};

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const say = (msg) => process.stdout.write(msg + '\n');
const warn = (msg) => process.stdout.write(`::warning::${msg}\n`);

function loadBase(file) {
  const committed = readFileSync(join(SITE, 'data', file), 'utf8');
  const base = sha(committed);
  const statePath = join(STATE, file), basePath = join(STATE, file + '.base');
  if (existsSync(statePath) && existsSync(basePath) && readFileSync(basePath, 'utf8').trim() === base) {
    say(`${file}: continuing from the cached refresh of this snapshot`);
    return { data: JSON.parse(readFileSync(statePath, 'utf8')), base };
  }
  say(`${file}: starting from the committed snapshot`);
  return { data: JSON.parse(committed), base };
}
function save(file, data, base) {
  const body = JSON.stringify(data);
  writeFileSync(join(SITE, 'data', file), body);
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, file), body);
  writeFileSync(join(STATE, file + '.base'), base);
  return body.length;
}
function withTimeout(minutes) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), minutes * 60000);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}
let lastLog = 0;
const progress = (label) => (p) => {
  const now = Date.now();
  if (now - lastLog < 15000 && p.done !== p.batches) return;
  lastLog = now;
  say(`${label}: ${p.msg} ${p.done}/${p.batches} requests, ${p.rows} rows, ${p.failed} failed`);
};

async function refreshAsteroids() {
  const { createSync } = await import(pathToFileURL(join(SITE, 'js', 'sync.js')).href);
  const { data: R, base } = loadBase('asteroids.json');
  const before = { nobj: R.meta.nobj, ndet: R.meta.ndet, tmax: R.meta.tmax, nights: R.nights.length };
  const sync = createSync(R);
  await sync.ready;
  const t = withTimeout(LIMIT_MIN);
  try {
    const info = await sync.update({ refresh: true, extra: 0, signal: t.signal, onProgress: progress('asteroids') });
    await sync.loadStored();
    const size = save('asteroids.json', R, base);
    say(`asteroids: ${before.ndet} -> ${R.meta.ndet} detections, ${before.nights} -> ${R.nights.length} nights, latest ${R.meta.dmax}, ${info.failed} failed requests, ${size} bytes`);
    if (info.failed) warn(`asteroids: ${info.failed} Fink requests failed after retries; kept what arrived`);
  } finally { t.done(); }
}

async function refreshStars() {
  const { createStarSync } = await import(pathToFileURL(join(SITE, 'js', 'starsync.js')).href);
  const { data: S, base } = loadBase('stars.json');
  const before = { nobj: S.objects.id.length, nal: S.alerts.t.length, nights: S.nights.length };
  const sync = createStarSync(S);
  await sync.loadStored();
  const t = withTimeout(LIMIT_MIN);
  try {
    const info = await sync.update({ refresh: true, extra: 0, signal: t.signal, onProgress: progress('stars') });
    await sync.loadStored();
    S.meta.updated = new Date().toISOString().slice(0, 10);
    const size = save('stars.json', S, base);
    say(`stars: ${before.nal} -> ${S.alerts.t.length} sample alerts, ${info.changed} objects with new detections, ${before.nights} -> ${S.nights.length} nights, ${info.failed} failed requests, ${size} bytes`);
    if (info.failed) warn(`stars: ${info.failed} Fink requests failed after retries; kept what arrived`);
  } finally { t.done(); }
}

const JOBS = { asteroids: refreshAsteroids, stars: refreshStars };
let failures = 0;
for (const m of MODES) {
  const t0 = Date.now();
  try {
    await JOBS[m]();
    say(`${m}: done in ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    failures++;
    const file = `${m}.json`, statePath = join(STATE, file), basePath = statePath + '.base';
    const committed = sha(readFileSync(join(SITE, 'data', file), 'utf8'));
    if (existsSync(statePath) && existsSync(basePath) && readFileSync(basePath, 'utf8').trim() === committed) {
      writeFileSync(join(SITE, 'data', file), readFileSync(statePath));
      warn(`${m}: refresh failed (${e && e.message ? e.message : e}); deploying the last good refresh`);
    } else {
      warn(`${m}: refresh failed (${e && e.message ? e.message : e}); the committed ${m} data is kept`);
    }
  }
}
process.exitCode = 0;
say(`refresh finished, ${failures} mode(s) kept their committed data`);
