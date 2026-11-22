export const API = 'https://api.lsst.fink-portal.org/api/v1/';
export const CONCURRENCY = 3;
const BIG_IDS = /"(r:diaSourceId|r:diaObjectId)":\s*(\d+)/g;

export function openStore(name, stores) {
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open(name, 1);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          for (const st of stores) if (!db.objectStoreNames.contains(st)) db.createObjectStore(st);
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  };
  const run = async (store, mode, fn) => {
    const db = await open();
    if (!db) throw new Error('IndexedDB is not available');
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode), st = tx.objectStore(store);
      let out;
      try { out = fn(st); } catch (e) { rej(e); return; }
      tx.oncomplete = () => res(out && 'result' in out ? out.result : out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('aborted'));
    });
  };
  return {
    available: async () => !!(await open()),
    get: (store, key) => run(store, 'readonly', (st) => st.get(key)),
    getAll: (store) => run(store, 'readonly', (st) => st.getAll()),
    count: (store) => run(store, 'readonly', (st) => st.count()),
    put: (store, key, val) => run(store, 'readwrite', (st) => { st.put(val, key); }),
    putMany: (store, entries) => run(store, 'readwrite', (st) => { for (const [k, v] of entries) st.put(v, k); }),
    clear: (store) => run(store, 'readwrite', (st) => { st.clear(); }),
    clearAll: async () => { for (const st of stores) await run(st, 'readwrite', (s) => { s.clear(); }); },
  };
}

export const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

export async function post(endpoint, body, { signal, timeout = 90000, retries = 3, as = 'json' } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(API + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (as === 'blob') {
        const b = await r.blob();
        if (!b.type.startsWith('image/')) throw new Error('not an image');
        return b;
      }
      const txt = await r.text();
      if (txt.trimStart().startsWith('<')) throw new Error('HTML error page');
      return JSON.parse(txt.replace(BIG_IDS, '"$1":"$2"'));
    } catch (e) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      last = e;
      if (attempt < retries) await sleep([2000, 5000, 12000][attempt] || 15000, signal);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw last;
}

export async function pool(tasks, n, signal) {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      if (signal.aborted) return;
      const k = i++;
      await tasks[k]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

export function monthsSince(night) {
  const y0 = Math.floor(night / 10000), m0 = Math.floor(night / 100) % 100;
  const now = new Date(), out = [];
  for (let y = y0, m = m0; y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth() + 1); m === 12 ? (y++, m = 1) : m++) out.push(`${y}${String(m).padStart(2, '0')}`);
  return out;
}

export async function storageUsage() {
  try { if (navigator.storage && navigator.storage.estimate) return (await navigator.storage.estimate()).usage; } catch {}
  return null;
}

export async function persistOnce() {
  try {
    if (localStorage.getItem('rubin-persist-asked')) return;
    localStorage.setItem('rubin-persist-asked', '1');
  } catch {}
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}
