import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
for (const file of readdirSync(join(siteDir, 'js')).filter((f) => f.endsWith('.js'))) {
  changed += rewrite(join('js', file), /((?:from\s*|import\s*\(\s*)['"])(\.\/[\w-]+\.js)(['"])/g);
}
console.log(`stamped ${changed} files with v=${version}`);
