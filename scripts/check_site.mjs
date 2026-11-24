import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.py', '.md', '.yml', '.svg', '.txt', '.json']);
const SKIP = new Set(['.git', 'node_modules', 'data', 'shots', '__pycache__']);
const problems = [];
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) && dir === root) continue;
    if (name === '.git' || name === 'node_modules' || name === '__pycache__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function checkText(file) {
  const ext = extname(file);
  if (!TEXT.has(ext)) return;
  const rel = relative(root, file);
  const body = readFileSync(file, 'utf8');
  if (CYRILLIC.test(body)) problems.push(`${rel}: contains Cyrillic text`);
  if (ext === '.json') return;
  if (/\b(TODO|FIXME|XXX)\b/.test(body) && !rel.endsWith('check_site.mjs')) problems.push(`${rel}: contains a TODO marker`);
  if (['.js', '.mjs'].includes(ext) && /\bconsole\.(log|debug|info)\(/.test(body) && !rel.endsWith('check_site.mjs')) problems.push(`${rel}: contains console logging`);
  if (['.js', '.mjs', '.css'].includes(ext)) {
    body.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('/*')) problems.push(`${rel}:${i + 1}: comment line`);
    });
  }
}

function referenced(html) {
  const refs = [];
  for (const m of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    refs.push(url);
  }
  return refs;
}

function checkModules(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const body = readFileSync(file, 'utf8');
  for (const m of body.matchAll(/(?:import\s[^'"]*from\s*|import\()\s*'(\.[^']+)'/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) problems.push(`${relative(root, file)}: imports missing ${m[1]}`);
    else checkModules(target, seen);
  }
  for (const m of body.matchAll(/'(data\/[^'?]+)(?:\?[^']*)?'/g)) {
    if (!existsSync(join(site, m[1]))) problems.push(`${relative(root, file)}: loads missing ${m[1]}`);
  }
}

walk(root).forEach(checkText);
const index = join(site, 'index.html');
for (const ref of referenced(readFileSync(index, 'utf8'))) {
  const target = join(site, ref);
  if (!existsSync(target)) problems.push(`site/index.html: references missing ${ref}`);
  else if (ref.endsWith('.js')) checkModules(target);
}
for (const f of walk(join(site, 'js'))) checkModules(f);

const tonightPath = join(site, 'data', 'tonight.json');
if (existsSync(tonightPath)) {
  try {
    const tn = JSON.parse(readFileSync(tonightPath, 'utf8'));
    if (!Array.isArray(tn.recent) || tn.recent.some((r) => !Number.isFinite(r.ra) || !Number.isFinite(r.dec) || !Array.isArray(r.det) || !r.finder)) problems.push('site/data/tonight.json: a target is incomplete');
  } catch {
    problems.push('site/data/tonight.json: does not parse');
  }
}
const showcasePath = join(site, 'data', 'showcase.json');
if (existsSync(showcasePath)) {
  try {
    const sc = JSON.parse(readFileSync(showcasePath, 'utf8'));
    const st = sc.modes && sc.modes.stars;
    if (!st || !Array.isArray(st.rank) || st.rank.length !== st.n || st.score.length !== st.n || st.why.length !== st.n) problems.push('site/data/showcase.json: stars part is incomplete');
  } catch (e) {
    problems.push('site/data/showcase.json: does not parse');
  }
}
const gz = (v) => gzipSync(Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))).length;
const budgets = [];
try {
  const sc = JSON.parse(readFileSync(showcasePath, 'utf8'));
  for (const [mode, kb] of [['stars', 19], ['asteroids', 10], ['dm', 40]]) if (sc.modes[mode]) budgets.push([`showcase ${mode}`, gz(sc.modes[mode]), kb]);
} catch {}
if (existsSync(tonightPath)) budgets.push(['tonight.json', gz(readFileSync(tonightPath, 'utf8')), 15]);
try {
  const cmb = JSON.parse(readFileSync(join(site, 'data', 'cmb.json'), 'utf8'));
  budgets.push(['cmb.json clusters', gz(cmb.clusters), 190]);
} catch {}
const earthPath = join(site, 'data', 'earth.json');
if (existsSync(earthPath)) {
  try {
    const e = JSON.parse(readFileSync(earthPath, 'utf8'));
    if (!e.meta || !Array.isArray(e.meta.window) || !Array.isArray(e.coverage) || !e.sources) problems.push('site/data/earth.json: lacks meta.window, coverage or sources');
    for (const id of Object.keys(e.tiles || {})) if (!existsSync(join(site, 'data', 'earth-tiles', `${id}.json`))) problems.push(`site/data/earth.json: tile ${id} is in the manifest but missing`);
  } catch {
    problems.push('site/data/earth.json: does not parse');
  }
  for (const [name, kb] of [['earth.json', 30], ['earth-lightning.json', 160], ['earth-aurora.json', 150], ['earth-lights-4096.jpg', 393], ['earth-lights-2048.jpg', 99], ['earth-land-2048.png', 137]]) {
    const f = join(site, 'data', name);
    if (existsSync(f)) budgets.push([name, gzipSync(readFileSync(f)).length, kb]); else problems.push(`site/data/${name}: missing`);
  }
  const tdir = join(site, 'data', 'earth-tiles');
  if (existsSync(tdir)) for (const t of readdirSync(tdir)) budgets.push([`earth-tiles/${t}`, gzipSync(readFileSync(join(tdir, t))).length, 300]);
  const foot = (readFileSync(index, 'utf8').match(/<p class="earth-only">[\s\S]*?<\/p>/) || [''])[0];
  for (const credit of ['NOAA Space Weather Prediction Center', 'OVATION', 'GOES-R Geostationary Lightning Mapper', 'NOAA Open Data Dissemination', 'Black Marble', 'NASA GIBS', 'Natural Earth', 'Contains modified EUMETSAT Meteosat data']) {
    if (!foot.includes(credit)) problems.push(`site/index.html: the Earth credits lack "${credit}"`);
  }
}
for (const [name, bytes, kb] of budgets) if (bytes > 1.25 * kb * 1024) problems.push(`${name}: ${(bytes / 1024).toFixed(1)} KB gzip, over 1.25 x the ${kb} KB budget`);
if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('site checks passed\n');
