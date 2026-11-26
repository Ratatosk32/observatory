import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes('--' + name);

const LIMITS = {
  fontSizes: 8,
  fontWeights: 5,
  radiusTokens: 4,
  borderColours: 8,
  rawDurations: 0,
  rawEasings: 0,
  jsEasingHelpers: 0,
  jsRawMotion: 0,
  buttonClasses: 4,
  contrast: 4.5,
};
const PROBE_LIMITS = { goldBorders: 2, goldTexts: 6, fontSizes: 7, radii: 4, truncated: 0 };

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

function splitTop(s, sep) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseCss(src, file) {
  src = stripComments(src);
  const out = [];
  let i = 0;
  const block = (media, kf) => {
    while (i < src.length) {
      const open = src.indexOf('{', i), close = src.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const head = src.slice(i, open).trim();
      i = open + 1;
      if (/^@(media|supports|layer|container)/.test(head)) { block([...media, head], kf); continue; }
      if (head.startsWith('@keyframes')) { block(media, head.slice(10).trim()); continue; }
      const end = src.indexOf('}', i);
      const body = src.slice(i, end);
      i = end + 1;
      const decls = splitTop(body, ';').map((d) => {
        const k = d.indexOf(':');
        return k < 0 ? null : { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim().replace(/\s*!important$/, '') };
      }).filter(Boolean);
      out.push({ sel: head, decls, media, kf, file });
    }
  };
  block([], null);
  return out;
}

const isRootSel = (sel) => /^:root(\[data-theme="(light|dark)"\])?$/.test(sel.trim());
const themeOf = (sel) => (/data-theme="light"/.test(sel) ? 'light' : 'dark');

function varsOf(rules) {
  const v = { dark: {}, light: {} };
  for (const r of rules) {
    if (r.kf || r.media.length || !isRootSel(r.sel)) continue;
    const t = themeOf(r.sel);
    for (const d of r.decls) if (d.prop.startsWith('--')) v[t][d.prop] = d.value;
  }
  v.light = { ...v.dark, ...v.light };
  return v;
}

function resolveVars(value, vars, depth = 0) {
  if (depth > 12) return value;
  let out = '', i = 0;
  while (i < value.length) {
    const k = value.indexOf('var(', i);
    if (k < 0) { out += value.slice(i); break; }
    out += value.slice(i, k);
    let depthP = 0, j = k + 3;
    for (; j < value.length; j++) {
      if (value[j] === '(') depthP++;
      else if (value[j] === ')') { depthP--; if (depthP === 0) break; }
    }
    const inner = value.slice(k + 4, j);
    const parts = splitTop(inner, ',');
    const name = parts[0].trim();
    const fb = parts.slice(1).join(',').trim();
    const got = vars[name] != null ? vars[name] : fb;
    out += resolveVars(got, vars, depth + 1);
    i = j + 1;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const HEX = /#[0-9a-f]{3,8}\b/gi;
const FUNC = /\b(?:rgba?|hsla?)\([^)]*\)/gi;

export function toRgba(c) {
  c = c.trim().toLowerCase();
  if (c === 'transparent') return [0, 0, 0, 0];
  let m = c.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join('');
    const n = (k) => parseInt(h.slice(k, k + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = c.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
  }
  return null;
}

function colourMix(value) {
  const m = value.match(/^color-mix\(in srgb,\s*(.+)\)$/);
  if (!m) return null;
  const parts = splitTop(m[1], ',').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const parse = (p) => { const k = p.match(/^(.*?)(?:\s+([\d.]+)%)?$/); return { c: toRgba(k[1]) || colourMix(k[1]), w: k[2] == null ? null : +k[2] / 100 }; };
  const a = parse(parts[0]), b = parse(parts[1]);
  if (!a.c || !b.c) return null;
  let wa = a.w, wb = b.w;
  if (wa == null && wb == null) { wa = 0.5; wb = 0.5; } else if (wa == null) wa = 1 - wb; else if (wb == null) wb = 1 - wa;
  const alpha = a.c[3] * wa + b.c[3] * wb;
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (k) => (a.c[k] * a.c[3] * wa + b.c[k] * b.c[3] * wb) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}

export function colourOf(value) { return toRgba(value) || colourMix(value); }

function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((k) => fg[k] * a + bg[k] * (1 - a)).concat(1);
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(fg, bg) {
  const c = over(fg, bg), a = lum(c), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SIZE_RE = /(?:^|\s)(\d+(?:\.\d+)?(?:px|rem|em))(?:\/[^\s]+)?\s+['"a-z]/i;
const TIME_RE = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/g;
const EASE_RE = /cubic-bezier\(|steps\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/g;
const MOTION_PROPS = /^(transition|animation)(-duration|-delay|-timing-function)?$/;
const BORDER_PROPS = /^(border|border-(top|right|bottom|left)|border-color|border-(top|right|bottom|left)-color|outline|outline-color)$/;

function buttonFamilies(rules, sources) {
  const fam = new Map();
  const add = (name, why) => { if (!fam.has(name)) fam.set(name, { name, from: new Set(), decls: [] }); fam.get(name).from.add(why); };
  for (const [file, body] of sources) {
    for (const m of body.matchAll(/<button\b[^>]*?\bclass="([^"]*)"/g)) {
      const first = m[1].replace(/\$\{[^}]*\}/g, ' ').trim().split(/\s+/)[0];
      if (first) add(first, file);
    }
    for (const m of body.matchAll(/createElement\('button'\)[\s\S]{0,200}?\.className\s*=\s*'([^']+)'/g)) add(m[1].trim().split(/\s+/)[0], file);
  }
  const subjects = [];
  for (const r of rules) {
    if (r.kf) continue;
    for (const sel of splitTop(r.sel, ',')) {
      const parts = sel.trim().split(/\s*[>+~\s]\s*/).filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const bare = /^button(?![.\w-])/.test(last);
      if (bare && parts.length > 1) {
        let parent = '';
        for (let q = parts.length - 2; q >= 0 && !parent; q--) parent = [...parts[q].matchAll(/\.([\w-]+)/g)].map((x) => x[1]).find((c) => !/^(on|done|hot|sel|open|active)$/.test(c)) || '';
        if (parent) { add(parent + ' button', 'css'); subjects.push([parent + ' button', r, /:(hover|focus|active)|\[aria|\.on\b/.test(last)]); }
        continue;
      }
      const cls = (last.match(/^(?:button)?\.([\w-]+)/) || [])[1];
      if (cls && fam.has(cls)) subjects.push([cls, r, /:(hover|focus|active)|\[aria|\.on\b|\.(sm|lg|play|icon|quiet|primary|active)\b/.test(last.slice(cls.length + 1))]);
    }
  }
  for (const [name, r, state] of subjects) if (!state && !r.media.length) fam.get(name).decls.push(...r.decls);
  const kind = (f) => {
    const d = Object.fromEntries(f.decls.map((x) => [x.prop, x.value]));
    const none = (v) => v == null || /^(none|0|0px|transparent)$/.test(v.trim());
    if (d.width === '100%' && /left/.test(d['text-align'] || '')) return 'row';
    if (d.display === 'contents') return 'row';
    const box = !none(d.border) || !none(d['border-color']) || !none(d.background) || !none(d['background-color']) || !none(d['box-shadow']);
    if (!box && !d.height && !d['min-height'] && !d['border-radius']) return 'bare';
    if (!box && !d.height && !d['min-height'] && /^0(px)?$/.test((d.padding || '0').trim())) return 'bare';
    return 'control';
  };
  const out = { control: [], row: [], bare: [], unstyled: [] };
  for (const f of fam.values()) {
    if (!f.decls.length) { out.unstyled.push(f.name); continue; }
    out[kind(f)].push(f.name);
  }
  for (const k in out) out[k].sort();
  return out;
}

function jsMotion() {
  const helpers = [], raw = [], beziers = [];
  const dir = join(site, 'js');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js') || name === 'motion.js') continue;
    const body = readFileSync(join(dir, name), 'utf8');
    body.split('\n').forEach((line, i) => {
      const at = `${name}:${i + 1}`;
      if (/(?:const|let)\s+(ease\w*|smooth|smooth01|smoothstep)\s*=\s*\(|function\s+(ease\w*|smooth|smoothstep)\s*\(/i.test(line)) helpers.push(at);
      if (/cubic-bezier\(/.test(line)) beziers.push(at);
      const div = [...line.matchAll(/\((?:ts|now|t|performance\.now\(\))\s*-\s*\w+\)\s*\/\s*(\d{2,4})\b/g)].some((m) => +m[1] >= 50 && +m[1] <= 3000 && +m[1] !== 1000 && +m[1] !== 900);
      if (/\bduration:\s*\d/.test(line) || div || /transition\s*=\s*['`][^'`]*\d+m?s/.test(line)) raw.push(at);
    });
  }
  return { helpers, raw, beziers };
}

export function lintStatic() {
  const files = ['style.css', 'palette.css'];
  const rules = files.flatMap((f) => parseCss(readFileSync(join(site, f), 'utf8'), f));
  const vars = varsOf(rules);
  const sizes = new Map(), weights = new Set(), radii = new Map(), borders = new Set(), radiusTokens = new Set();
  const rawDur = [], rawEase = [], rawCol = [], rawRadii = [];
  let hovers = 0, transitions = 0, tabular = 0;
  const note = (map, k, where) => { if (!map.has(k)) map.set(k, []); map.get(k).push(where); };
  for (const r of rules) {
    if (r.sel.startsWith('@font-face')) continue;
    const where = `${r.file}: ${r.sel.slice(0, 60)}`;
    const rootish = !r.kf && isRootSel(r.sel);
    if (/:hover/.test(r.sel)) hovers++;
    for (const d of r.decls) {
      if (d.prop.startsWith('--')) {
        if (/^--r-/.test(d.prop) && rootish) radiusTokens.add(d.prop);
        continue;
      }
      const vv = resolveVars(d.value, vars.dark);
      if (d.prop === 'font-size') note(sizes, vv, where);
      if (d.prop === 'font') { const m = vv.match(SIZE_RE); if (m) note(sizes, m[1], where); const w = vv.match(/^(?:italic\s+)?(\d{3})\b/); if (w) weights.add(w[1]); }
      if (d.prop === 'font-weight') weights.add(vv);
      if (d.prop === 'border-radius') { note(radii, d.value.replace(/\s+/g, ' '), where); if (!rootish && /\d(px|em|rem)/.test(d.value)) rawRadii.push(`${where} → ${d.value}`); }
      if (d.prop === 'font-variant-numeric' && /tabular/.test(vv)) tabular++;
      if (BORDER_PROPS.test(d.prop)) {
        const cols = [...vv.matchAll(/color-mix\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(currentcolor|transparent)\b/gi)].map((m) => m[0].toLowerCase());
        for (const c of cols) if (c !== 'transparent') borders.add(c.replace(/\s+/g, ' '));
      }
      if (MOTION_PROPS.test(d.prop)) {
        transitions++;
        if (!rootish) {
          for (const m of d.value.matchAll(TIME_RE)) if (+m[1] > 0) rawDur.push(`${where} → ${m[0]}`);
          for (const m of d.value.matchAll(EASE_RE)) rawEase.push(`${where} → ${m[0]}`);
        }
      }
      if (!rootish && !d.prop.startsWith('--')) {
        const lits = [...d.value.replace(/url\([^)]*\)/g, '').matchAll(HEX), ...d.value.matchAll(FUNC)].map((m) => m[0]);
        for (const c of lits) rawCol.push(`${where} → ${d.prop}: ${c}`);
      }
    }
  }
  const sources = [['index.html', readFileSync(join(site, 'index.html'), 'utf8')], ...readdirSync(join(site, 'js')).filter((n) => n.endsWith('.js')).map((n) => [n, readFileSync(join(site, 'js', n), 'utf8')])];
  const buttons = buttonFamilies(rules, sources);
  const contrastRows = [];
  for (const theme of ['dark', 'light']) {
    const v = vars[theme];
    const paper = colourOf(resolveVars('var(--paper)', v));
    for (const ink of ['--ink', '--ink2', '--ink3']) {
      const fg = colourOf(resolveVars(`var(${ink})`, v));
      if (paper && fg) contrastRows.push({ theme, ink, on: '--paper', ratio: +contrast(fg, paper).toFixed(2) });
      for (const surf of ['--field', '--paper-deep']) {
        const bg = colourOf(resolveVars(`var(${surf})`, v));
        if (bg && fg && bg[3] === 1) contrastRows.push({ theme, ink, on: surf, ratio: +contrast(fg, bg).toFixed(2) });
      }
    }
  }
  const js = jsMotion();
  const pxRadii = new Set();
  for (const k of radii.keys()) for (const m of resolveVars(k, vars.dark).matchAll(/(\d+(?:\.\d+)?)(px|%)/g)) pxRadii.add(m[0]);
  return {
    fontSizes: [...sizes.keys()].sort((a, b) => parseFloat(a) - parseFloat(b)),
    fontWeights: [...weights].sort(),
    radii: [...radii.keys()],
    radiusLengths: [...pxRadii].sort((a, b) => parseFloat(a) - parseFloat(b)),
    radiusTokens: [...radiusTokens],
    rawRadii,
    borderColours: [...borders],
    rawDurations: rawDur,
    rawEasings: rawEase,
    rawColours: rawCol,
    hoverRules: hovers,
    motionDecls: transitions,
    tabularRules: tabular,
    buttons,
    contrast: contrastRows,
    js,
  };
}

function staticReport(s) {
  const rows = [
    ['Distinct font sizes (style + palette)', s.fontSizes.length, LIMITS.fontSizes, s.fontSizes.join(' ')],
    ['Font weights', s.fontWeights.length, LIMITS.fontWeights, s.fontWeights.join(' ')],
    ['Distinct border-radius values', s.radii.length, null, s.radiusLengths.join(' ')],
    ['Radius tokens on :root', s.radiusTokens.length, LIMITS.radiusTokens, s.radiusTokens.join(' ')],
    ['Raw radius lengths outside :root', s.rawRadii.length, 0, ''],
    ['Border colours', s.borderColours.length, LIMITS.borderColours, ''],
    ['Raw durations outside :root', s.rawDurations.length, LIMITS.rawDurations, ''],
    ['Raw easings outside :root', s.rawEasings.length, LIMITS.rawEasings, ''],
    ['Raw colours outside :root', s.rawColours.length, null, ''],
    ['Hover rules', s.hoverRules, null, ''],
    ['Transition / animation declarations', s.motionDecls, null, ''],
    ['tabular-nums rules', s.tabularRules, null, ''],
    ['Button classes (controls)', s.buttons.control.length, LIMITS.buttonClasses, s.buttons.control.join(' ')],
    ['  list rows', s.buttons.row.length, null, s.buttons.row.join(' ')],
    ['  bare (text links, handles)', s.buttons.bare.length, null, s.buttons.bare.join(' ')],
    ['JS easing helpers outside motion.js', s.js.helpers.length, LIMITS.jsEasingHelpers, s.js.helpers.join(' ')],
    ['JS raw motion timings / beziers', s.js.raw.length + s.js.beziers.length, LIMITS.jsRawMotion, [...s.js.raw, ...s.js.beziers].join(' ')],
  ];
  const lines = ['| Measure | Value | Limit | Detail |', '|---|---|---|---|'];
  for (const [k, v, lim, det] of rows) lines.push(`| ${k} | ${v} | ${lim == null ? '-' : lim} | ${det} |`);
  lines.push('', '| Theme | Ink | On | Contrast |', '|---|---|---|---|');
  for (const c of s.contrast) lines.push(`| ${c.theme} | ${c.ink} | ${c.on} | ${c.ratio} |`);
  return lines.join('\n');
}

function staticFailures(s) {
  const f = [];
  const over = (name, v, lim) => { if (v > lim) f.push(`${name}: ${v} > ${lim}`); };
  over('font sizes', s.fontSizes.length, LIMITS.fontSizes);
  over('font weights', s.fontWeights.length, LIMITS.fontWeights);
  over('radius tokens', s.radiusTokens.length, LIMITS.radiusTokens);
  over('raw radius lengths', s.rawRadii.length, 0);
  over('border colours', s.borderColours.length, LIMITS.borderColours);
  over('raw durations', s.rawDurations.length, LIMITS.rawDurations);
  over('raw easings', s.rawEasings.length, LIMITS.rawEasings);
  over('button classes', s.buttons.control.length, LIMITS.buttonClasses);
  over('JS easing helpers', s.js.helpers.length, LIMITS.jsEasingHelpers);
  over('JS raw motion', s.js.raw.length + s.js.beziers.length, LIMITS.jsRawMotion);
  for (const c of s.contrast) if (c.on === '--paper' && c.ink !== '--ink' && c.ratio < LIMITS.contrast) f.push(`contrast ${c.theme} ${c.ink} on paper: ${c.ratio} < ${LIMITS.contrast}`);
  if (flag('verbose')) {
    for (const x of [...s.rawDurations, ...s.rawEasings]) f.push('  ' + x);
  }
  return f;
}

function probeInPage() {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return false;
    if (e.closest('[hidden]')) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false;
    }
    return true;
  };
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]*)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; };
  const gold = (s) => {
    const c = rgba(s);
    if (!c || c[3] < 0.25) return false;
    const [r, g, b] = c.slice(0, 3).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.08) return false;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return h >= 30 && h <= 55 && sat >= 0.45 && l >= 0.2 && l <= 0.85;
  };
  const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const all = [...document.body.querySelectorAll('*')].filter((e) => !(e instanceof SVGElement) && e.tagName !== 'CANVAS' && vis(e));
  const sizes = new Set(), radii = new Set(), borderCols = new Set(), heights = new Set(), weights = new Set();
  const goldTexts = [], goldBorders = [];
  const label = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].join('.') : ''} "${(e.textContent || '').trim().slice(0, 24)}"`;
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (ownText(e)) {
      sizes.add(cs.fontSize); weights.add(cs.fontWeight);
      if (gold(cs.color)) goldTexts.push(label(e));
    }
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((k) => parseFloat(cs[`border${k}Width`]) > 0 && cs[`border${k}Style`] !== 'none' && (rgba(cs[`border${k}Color`]) || [0, 0, 0, 0])[3] > 0.02);
    const ring = (cs.boxShadow || '').match(/rgba?\([^)]*\)[^,]*inset|inset[^,]*rgba?\([^)]*\)/g) || [];
    const hasBg = (rgba(cs.backgroundColor) || [0, 0, 0, 0])[3] > 0.02 || cs.backgroundImage !== 'none';
    for (const k of sides) borderCols.add(cs[`border${k}Color`]);
    const goldSide = sides.some((k) => gold(cs[`border${k}Color`]));
    const goldRing = ring.some((x) => gold(x));
    if (goldSide || goldRing) goldBorders.push(label(e));
    if ((sides.length || hasBg || ring.length) && cs.borderTopLeftRadius !== '0px') radii.add(cs.borderRadius);
    if (e.matches('button, [role=button], [role=radio], [role=tab], select, input[type=search]') && !e.closest('ul, ol, #sCardBody, #cardBody, #dCardBody, #eCardBody')) heights.add(Math.round(e.getBoundingClientRect().height));
  }
  return {
    fontSizes: [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
    weights: [...weights].sort(),
    radii: [...radii],
    borderColours: [...borderCols],
    goldTexts, goldBorders,
    controlHeights: [...heights].sort((a, b) => a - b),
    hscroll: document.scrollingElement.scrollWidth > W + 1,
  };
}

function truncInPage() {
  const body = document.querySelector(`.scene[data-floor="${document.body.dataset.mode}"] .card [aria-live]`);
  if (!body) return { width: 0, cut: ['no card'] };
  const cut = [];
  for (const e of body.querySelectorAll('*')) {
    if (!e.getClientRects().length || e instanceof SVGElement || e.tagName === 'CANVAS') continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') cut.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${e.textContent.trim().slice(0, 30)}"`);
  }
  const b = body.getBoundingClientRect();
  for (const e of body.querySelectorAll('dd')) {
    const t = e.textContent.trim();
    if (!t || t.length > 40 || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    const rg = document.createRange();
    rg.selectNodeContents(e);
    const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top)));
    if (tops.size > 1) cut.push(`wrapped dd "${t.slice(0, 30)}"`);
    else if (e.scrollWidth > e.clientWidth + 1 || r.right > b.right + 1) cut.push(`overflow dd "${t.slice(0, 30)}"`);
  }
  return { width: Math.round(body.closest('.card').getBoundingClientRect().width), cut };
}

async function probe() {
  const BASE = opt('base', 'http://127.0.0.1:8102/');
  const MODES = opt('modes', 'stars,asteroids,dm,earth').split(',');
  const SIZES = opt('sizes', '1440x900,390x844').split(',').map((s) => s.split('x').map(Number));
  const THEMES = opt('themes', 'dark').split(',');
  const LIMIT_MS = +opt('timeout', 240000);
  const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const PUP = process.env.PUPPETEER_CORE || 'puppeteer-core';
  const { default: puppeteer } = await import(PUP.includes('/') || PUP.includes('\\') ? pathToFileURL(resolve(PUP, 'lib/esm/puppeteer/puppeteer-core.js')).href : PUP);
  const results = {}, errors = [];
  let browser;
  const waitReady = async (page, mode) => {
    await page.waitForFunction(() => window.Observatory && window.Observatory.ready, { timeout: 60000 });
    await page.waitForFunction((m) => document.body.dataset.mode === m && !document.querySelector('.loading:not([hidden])'), { timeout: 60000 }, mode);
    await new Promise((r) => setTimeout(r, 2000));
  };
  const run = (async () => {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=512'] });
    for (const theme of THEMES) {
      for (const [w, h] of SIZES) {
        for (const mode of MODES) {
          const page = await browser.newPage();
          page.on('pageerror', (e) => errors.push(`${mode}@${w}: ${e.message}`));
          try {
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
            await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
            await page.goto(`${BASE}?mode=${mode}&theme=${theme}`, { waitUntil: 'load', timeout: 60000 });
            await page.evaluate((t) => { try { localStorage.setItem('observatory-theme', t); } catch (e) { return; } }, theme);
            await page.reload({ waitUntil: 'load', timeout: 60000 });
            await waitReady(page, mode);
            results[`${mode}@${w}-${theme}`] = await page.evaluate(probeInPage);
            if (!flag('no-trunc') && w >= 700) {
              const tr = [];
              for (const cw of [1440, 1100]) {
                await page.setViewport({ width: cw, height: 900, deviceScaleFactor: 1 });
                await new Promise((r) => setTimeout(r, 400));
                const picked = await page.evaluate(() => {
                  const b = document.querySelector(`.scene[data-floor="${document.body.dataset.mode}"] .card ul.hooks li button, .scene[data-floor="${document.body.dataset.mode}"] .card ul.tonight li button`);
                  if (b) { b.click(); return true; }
                  return false;
                });
                await new Promise((r) => setTimeout(r, 900));
                tr.push({ viewport: cw, picked, ...(await page.evaluate(truncInPage)) });
              }
              results[`${mode}@${w}-${theme}`].trunc = tr;
            }
          } catch (e) {
            errors.push(`${mode}@${w}-${theme}: ${e.message}`);
          } finally {
            await page.close();
          }
        }
      }
    }
  })();
  const limit = new Promise((_, rej) => setTimeout(() => rej(new Error(`style_lint probe: over ${LIMIT_MS} ms`)), LIMIT_MS));
  try {
    await Promise.race([run, limit]);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { results, errors };
}

function probeReport({ results, errors }) {
  const lines = ['| Screen | Font sizes | Weights | Radii | Border colours | Gold borders | Gold texts | Control heights | Truncated (card px) | H-scroll |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [k, r] of Object.entries(results)) {
    const tr = (r.trunc || []).map((t) => `${t.width}: ${t.cut.length}`).join(', ') || '-';
    lines.push(`| ${k} | ${r.fontSizes.length} | ${r.weights.length} | ${r.radii.length} | ${r.borderColours.length} | ${r.goldBorders.length} | ${r.goldTexts.length} | ${r.controlHeights.join(' ')} | ${tr} | ${r.hscroll ? 'YES' : 'no'} |`);
  }
  if (flag('verbose')) {
    for (const [k, r] of Object.entries(results)) {
      lines.push('', `${k} sizes: ${r.fontSizes.join(' ')}`, `${k} gold borders: ${r.goldBorders.join(' | ')}`, `${k} gold texts: ${r.goldTexts.join(' | ')}`);
      for (const t of r.trunc || []) if (t.cut.length) lines.push(`${k} truncated at ${t.width}: ${t.cut.join(' | ')}`);
    }
  }
  if (errors.length) lines.push('', 'Errors:', ...errors);
  return lines.join('\n');
}

function probeFailures({ results }) {
  const f = [];
  for (const [k, r] of Object.entries(results)) {
    if (r.goldBorders.length > PROBE_LIMITS.goldBorders) f.push(`${k}: ${r.goldBorders.length} gold borders > ${PROBE_LIMITS.goldBorders}`);
    if (r.goldTexts.length > PROBE_LIMITS.goldTexts) f.push(`${k}: ${r.goldTexts.length} gold texts > ${PROBE_LIMITS.goldTexts}`);
    if (r.fontSizes.length > PROBE_LIMITS.fontSizes) f.push(`${k}: ${r.fontSizes.length} font sizes > ${PROBE_LIMITS.fontSizes}`);
    if (r.radii.length > PROBE_LIMITS.radii + 1) f.push(`${k}: ${r.radii.length} radii > ${PROBE_LIMITS.radii} + circle`);
    for (const t of r.trunc || []) if (t.cut.length > PROBE_LIMITS.truncated) f.push(`${k}: ${t.cut.length} truncated values at card width ${t.width}`);
    if (r.hscroll) f.push(`${k}: horizontal scroll`);
  }
  return f;
}

async function main() {
  const s = lintStatic();
  const out = { static: s };
  process.stdout.write(staticReport(s) + '\n');
  let fails = flag('report') ? [] : staticFailures(s);
  if (flag('probe')) {
    const p = await probe();
    out.probe = p;
    process.stdout.write('\n' + probeReport(p) + '\n');
    if (!flag('report')) fails = fails.concat(probeFailures(p));
  }
  if (opt('json', null)) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
  if (fails.length) {
    process.stderr.write('style lint failed:\n' + fails.join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('style lint passed\n');
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
