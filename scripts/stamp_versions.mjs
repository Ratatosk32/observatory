import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [siteDir = 'site', version = 'dev'] = process.argv.slice(2);
const stamp = (url) => `${url}?v=${version}`;

const rewrite = (file, pattern) => {
  const path = join(siteDir, file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(pattern, (whole, before, url, after) => before + stamp(url) + after);
  writeFileSync(path, next);
  return text === next ? 0 : 1;
};

let changed = rewrite('index.html', /((?:src|href)=")((?:js\/[\w-]+\.js)|style\.css)(")/g);
const dataHash = new Map();
const hashOf = (name) => {
  if (!dataHash.has(name)) {
    const path = join(siteDir, 'data', name);
    dataHash.set(name, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10) : null);
  }
  return dataHash.get(name);
};
let data = 0;
for (const file of readdirSync(join(siteDir, 'js')).filter((f) => f.endsWith('.js'))) {
  changed += rewrite(join('js', file), /((?:from\s*|import\s*\(\s*|import\s+)['"])(\.\/[\w-]+\.js)(['"])/g);
  const path = join(siteDir, 'js', file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/(['"])data\/([\w.-]+\.(?:json|png|jpg))(['"])/g, (whole, q1, name, q2) => {
    const h = hashOf(name);
    if (!h) return whole;
    data++;
    return `${q1}data/${name}?v=${h}${q2}`;
  });
  if (next !== text) writeFileSync(path, next);
}
process.stdout.write(`stamped ${changed} files with v=${version} and ${data} data URLs with content hashes
`);
