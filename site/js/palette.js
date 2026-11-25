import { $, esc, ns, shell, C } from './kit.js';
import { css, mode, visible, waitFor, toFloor, reveal, runPreset, pickObject, openInstrument, openBrief, INSTRUMENTS, FLOOR_NAME, FLOOR_ORDER, CLOSE_IC } from './brief.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';
const SEARCH_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
const ROOT = { stars: '#starsRoot', asteroids: '#astMain', dm: '#dmRoot', earth: '#earthRoot' };
const PLAY = { stars: '#sPlay', asteroids: '#play', dm: '#dPlay', earth: '#ePlay' };
const TAG = { stars: 'Stars', asteroids: 'Asteroids', dm: 'Dark matter', earth: 'Earth' };
const NOUN = { stars: 'the stars and transients', asteroids: 'the asteroids', dm: 'the ACT clusters', earth: 'storms and places' };
const FLOOR_KW = {
  dm: 'cmb dark matter lensing clusters planck act oldest light',
  stars: 'stars beyond supernova variable quasar agn transient gaia sky milky way',
  asteroids: 'asteroids solar system orbits minor planets neo belt',
  earth: 'earth lightning aurora space weather solar wind globe storms',
};
const VIEWS = {
  stars: [['all', 'Everything'], ['tonight', 'Tonight', 'telescope observe finder targets night sky small scope'], ['puls', 'Pulsating stars', 'rr lyrae cepheid delta scuti variable'], ['expl', 'Explosions', 'supernova transient sn'], ['bh', 'Black holes', 'agn quasar tde'], ['ddf', 'Deep drilling fields', 'cosmos xmm ecdfs elais edfs'], ['halo', 'Halo RR Lyrae', 'distance halo milky way'], ['far', 'Farthest 20', 'distance redshift oldest'], ['near', 'Nearest 20', 'distance closest parallax'], ['tour', 'Tour', 'guided tour autoplay']],
  asteroids: [['all', 'Whole sample'], ['cz10', 'Follow 2026 CZ10'], ['hj4', '2020 HJ4 close pass', 'flyby near earth'], ['neo', 'Near-Earth & Mars-crossers', 'neo hazardous'], ['hun', 'Hungarias'], ['hil', 'Hildas'], ['tro', 'Jupiter Trojans'], ['kirk', 'Edges of the 3:1 gap', 'kirkwood resonance']],
  dm: [['True bending', 'True bending', 'lens'], ['Bend it ×50', 'Bend it ×50', 'lensing amplify lens magnify'], ['The shadow', 'The shadow', 'kappa convergence mass'], ['Busiest cluster', 'Busiest cluster', 'act alerts'], ['Heaviest cluster', 'Heaviest cluster', 'act mass m500']],
  earth: [['all', 'Everything'], ['north', 'Northern lights', 'aurora oval north borealis'], ['south', 'Southern lights', 'aurora oval south australis'], ['amer', 'Storms of the Americas', 'lightning thunderstorm'], ['gap', 'Where we can’t see', 'coverage gap lightning hatch'], ['night', 'A storm’s night', 'lightning thunderstorm']],
};
const VIEW_KW = { flare: 'flare x-ray sun', coming: 'aurora forecast kp geomagnetic storm' };
const STORIES = [
  ['sn', 'How a supernova rises and fades', 'A white dwarf explodes in a deep field'],
  ['core', 'A core sample through the Universe', 'One 3° patch, from a red dwarf to 7.9 billion years'],
  ['beat', 'Find the beat', 'Turn the period dial until two stars snap into focus'],
  ['halo', 'The halo in 3D', 'Pulsating stars 2 to 100 kpc out'],
  ['old', 'Light older than the Sun', 'A superluminous supernova and quasars'],
  ['cant', 'What Rubin can’t see', 'The north, daylight gaps, dust, wrong labels'],
];
const INST_KW = {
  Distances: 'distance ladder parallax redshift', Census: 'families counts sample selection', 'HR diagram': 'hertzsprung russell colour magnitude gaia', Season: 'ribbon nights filters cadence alerts per night',
  Orbits: 'orbital elements kirkwood resonance eccentricity inclination', Colours: 'taxonomy s-type c-type composition', Cadence: 'nights observing log', Stamps: 'cutouts difference image template science',
  Meters: 'significance sigma lensing test verdict needle', 'The story so far': 'narrative beats',
  'Space weather': 'solar wind kp bz aurora power x-rays flares swpc scales lanes', Regions: 'lightning countries flashes per region',
};
const GROUPS = ['Recent', 'Worth a look', 'Objects', 'Go to a floor', 'Guided views', 'Stories', 'Instruments', 'Actions', 'Objects on other floors', 'Search other floors'];
const RECENT_KEY = 'observatory-palette-recent';

let box = null, scrim = null, input = null, list = null, status = null, items = [], act = 0, opener = null, index = null, indexLoading = null, lastQ = '';
let keysEl = null, keysOpener = null;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '\'');

function near(a, b) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > 2) return 9;
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}
function typo(t, q) {
  if (q.length < 4 || /\s/.test(q)) return 0;
  const limit = q.length >= 7 ? 2 : 1;
  for (const w of t.split(/[\s\-(·:/]+/)) if (w.length >= 3 && (near(w, q) <= limit || near(w.slice(0, q.length), q) <= limit)) return 220;
  return 0;
}
function score(text, q, fuzzy = true) {
  const t = norm(text);
  if (!q || !t) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - Math.min(100, t.length - q.length);
  const at = t.indexOf(q);
  if (at > 0 && /[\s\-(·:/]/.test(t[at - 1])) return 760 - Math.min(60, at);
  if (at > 0) return 560 - Math.min(60, at);
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 480;
  if (!fuzzy || q.length < 2) return 0;
  const ty = typo(t, q);
  if (ty) return ty;
  let i = 0, run = 0, best = 0, gaps = 0, first = -1, last = -1;
  for (let k = 0; k < t.length && i < q.length; k++) {
    if (t[k] === q[i]) { if (first < 0) first = k; last = k; i++; run++; best = Math.max(best, run); } else if (i > 0) { run = 0; gaps++; }
  }
  if (i < q.length || last - first + 1 > q.length * 2 + 2 || best < Math.min(3, q.length)) return 0;
  return 120 + best * 25 - gaps * 4 - first;
}
function rate(it, q) {
  if (!q) return 1;
  const s = Math.max(score(it.label, q), score(it.kw || '', q, false) * 0.7, score(`${it.tag || ''} ${it.label}`, q, false) * 0.8, it.meta ? score(it.meta, q, false) * 0.5 : 0);
  return s > 0 ? s + (it.m === mode() ? 40 : 0) : 0;
}
function mark(label, q) {
  if (!q) return esc(label);
  const t = norm(label);
  const at = t.indexOf(q);
  if (at >= 0 && t.length === label.length) return esc(label.slice(0, at)) + '<b>' + esc(label.slice(at, at + q.length)) + '</b>' + esc(label.slice(at + q.length));
  if (t.length !== label.length) return esc(label);
  let i = 0, out = '';
  for (let k = 0; k < label.length; k++) {
    if (i < q.length && t[k] === q[i]) { out += '<b>' + esc(label[k]) + '</b>'; i++; } else out += esc(label[k]);
  }
  return i === q.length ? out : esc(label);
}

const click = (sel) => () => { const b = typeof sel === 'string' ? $(sel) : sel(); if (b) b.click(); return !!b; };
async function onFloor(m, find) {
  await toFloor(m);
  const el = await waitFor(find);
  return el;
}
const floorClick = (m, sel) => async () => { const b = await onFloor(m, () => document.querySelector(sel)); if (b) b.click(); };
const floorFocus = (m, sel, focusSel) => async () => { const b = await onFloor(m, () => document.querySelector(sel)); if (b) { reveal(b, false); const f = focusSel ? $(focusSel) : b; if (f) f.focus({ preventScroll: true }); } };
function rootOf(m) { return $(ROOT[m]); }
function pillButton(m) {
  const r = rootOf(m);
  return r ? [...r.querySelectorAll('.showcase button')].find(visible) || r.querySelector('.showcase button') : null;
}
function stagePanel(m) { const r = rootOf(m); return r && r.querySelector('.panel.map-panel'); }

function climb(d) {
  const k = FLOOR_ORDER.indexOf(mode());
  const next = FLOOR_ORDER[k - d];
  if (next) shell.setMode(next);
}

function openLadder() {
  const track = $('.lad-track');
  if (track && getComputedStyle(track).pointerEvents !== 'none') { track.click(); return; }
  const r = $('.lad-group [aria-checked="true"]');
  if (r) r.focus();
}
function aboutView() {
  const p = stagePanel(mode());
  const d = p && p.querySelector('details.about');
  if (d) { d.open = true; reveal(d); return; }
  const cap = p && p.querySelector('.cap');
  if (cap) reveal(cap);
}
function credits() {
  const m = mode();
  const cls = { stars: 'stars-only', dm: 'dm-only', earth: 'earth-only', asteroids: 'indep' }[m];
  const p = document.querySelector(`.foot p.${cls}`) || document.querySelector('.foot');
  reveal(p);
}
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); flash('Link copied'); } catch { flash('Copy the address bar to share this view'); }
}
function flash(text) {
  if (!status) return;
  status.textContent = text;
}

function actions() {
  const m = mode();
  const out = [
    { id: 'act:brief', label: 'Above you: one line per floor', kw: 'morning brief now headlines summary status news', kbd: ['N'], run: () => openBrief(opener) },
    { id: 'act:keys', label: 'Keyboard shortcuts', kw: 'help keys hotkeys', kbd: ['?'], run: () => openKeys(opener) },
    { id: 'act:theme', label: C.dark ? 'Switch to day paper' : 'Switch to night paper', kw: 'theme light dark colour color mode paper', run: click('#theme') },
    { id: 'act:data', label: 'Data sources, health and updates', kw: 'data refresh update health status pipeline reset bundled indexeddb broker fink', run: () => { const b = $('#dataBtn'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); } },
    { id: 'act:ladder', label: 'Distance ladder, floor by floor', kw: 'distance light travel comoving scale ladder peek', run: openLadder },
    { id: 'act:up', label: 'Climb a floor (farther out)', kw: 'up next floor', kbd: ['Alt', '↑'], run: () => climb(1) },
    { id: 'act:down', label: 'Descend a floor (closer in)', kw: 'down previous floor', kbd: ['Alt', '↓'], run: () => climb(-1) },
    { id: 'act:play', label: 'Play or pause time', kw: 'animate time start stop pause play', kbd: ['Space'], m, run: click(() => $(PLAY[m])) },
    { id: 'act:about', label: 'About this view: caption and caveats', kw: 'info caption honesty caveats help legend explain sample not the survey two-body model', m, run: aboutView },
    { id: 'act:credits', label: 'Sources and credits', kw: 'licence license attribution footer gaia eumetsat noaa planck act credits', m, run: credits },
    { id: 'act:link', label: 'Copy a link to this view', kw: 'share url deep link permalink address', run: copyLink },
  ];
  const pill = pillButton(m);
  if (pill && pill.textContent.trim()) {
    const txt = pill.parentElement.querySelector('.sc-txt');
    out.push({ id: 'act:pill', label: `${pill.textContent.trim()}${txt && txt.textContent ? ` (${txt.textContent.trim()})` : ''}`, kw: 'show all most unusual showcase honesty everything why flashes drawn rate budget', m, run: click(() => pillButton(m)) });
  } else {
    out.push({ id: 'act:pill', label: 'Show all, not only the most unusual', kw: 'show all most unusual showcase honesty everything', m, run: async () => { const b = await waitFor(() => pillButton(mode())); if (b) b.click(); } });
  }
  const fs = stagePanel(m);
  if (fs && fs.querySelector('.pctl .fsb')) out.push({ id: 'act:fs', label: 'Show the scene full screen', kw: 'full screen expand zen big', m, run: click(() => stagePanel(mode()).querySelector('.pctl .fsb')) });
  for (const h of shell.keyHelp || []) if (typeof h.run === 'function' && h.label) out.push({ id: 'key:' + h.label, label: h.label, kw: h.kw || '', kbd: h.keys || [], m: h.mode || null, run: h.run });
  out.push(
    { id: 'stars:drop', label: 'Drop the stars to their distances', kw: 'distance 3d parallax animation', m: 'stars', run: floorClick('stars', '#dropBtn') },
    { id: 'stars:pulse', label: 'Pulse time scale', kw: 'pulses period animation speed', m: 'stars', run: floorFocus('stars', '#sPulse') },
    { id: 'ast:size', label: 'Filter the asteroids by size', kw: 'diameter histogram km albedo filter', m: 'asteroids', run: floorFocus('asteroids', '#sizebar', '#dMin') },
    { id: 'ast:z1', label: 'Zoom to the inner Solar System', kw: 'inner planets zoom earth mars', m: 'asteroids', run: floorClick('asteroids', '[data-zoom="1.8"]') },
    { id: 'ast:z2', label: 'Zoom to the asteroid belt', kw: 'belt zoom main', m: 'asteroids', run: floorClick('asteroids', '[data-zoom="3.9"]') },
    { id: 'ast:z3', label: 'Zoom out to Jupiter', kw: 'jupiter trojans zoom outer', m: 'asteroids', run: floorClick('asteroids', '[data-zoom="6.2"]') },
    { id: 'dm:shadow', label: 'Show the shadow (projected mass κ)', kw: 'kappa convergence mass dark matter map', m: 'dm', run: floorClick('dm', '#dShadow') },
    { id: 'dm:amp', label: 'Amplify the bending', kw: 'lens magnify lensing slider true bending', m: 'dm', run: floorFocus('dm', '#lensbar', '#dAmp') },
    { id: 'earth:clouds', label: 'Clouds from five weather satellites', kw: 'clouds satellite infrared layer weather', m: 'earth', run: floorClick('earth', '#eClouds') },
    { id: 'earth:live', label: 'Live space weather and aurora', kw: 'live now real time aurora solar wind swpc', kbd: ['L'], m: 'earth', run: floorClick('earth', '#eLive') },
  );
  const legend = $('#sLegend');
  const fams = legend ? [...legend.querySelectorAll('[data-g]')] : [];
  if (fams.length) for (const b of fams) { const name = b.textContent.trim().replace(/\s[\d,]+$/, ''); out.push({ id: 'stars:fam:' + b.dataset.g, label: `Show or hide ${name}`, kw: 'family filter legend toggle', m: 'stars', run: floorClick('stars', `#sLegend [data-g="${b.dataset.g}"]`) }); }
  else out.push({ id: 'stars:fams', label: 'Filter the stars by family', kw: 'family filter legend pulsating explosions black holes', m: 'stars', run: floorFocus('stars', '#sLegend', '#sLegend [data-g]') });
  const cls = [...document.querySelectorAll('#legend-map [data-cls]')];
  if (cls.length) for (const b of cls) { const name = b.textContent.trim().replace(/\s[\d,]+$/, ''); out.push({ id: 'ast:cls:' + b.dataset.cls, label: `Only ${name} asteroids`, kw: 'orbit class filter legend', m: 'asteroids', run: floorClick('asteroids', `#legend-map [data-cls="${b.dataset.cls}"]`) }); }
  else out.push({ id: 'ast:classes', label: 'Filter the asteroids by orbit class', kw: 'orbit class filter legend neo hungaria hilda trojan', m: 'asteroids', run: floorFocus('asteroids', '#legend-map', '#legend-map [data-cls]') });
  const regions = [...document.querySelectorAll('#eRegions [data-region]')].map((b) => [b.dataset.region, (b.querySelector('.nm') || b).textContent.trim()]);
  for (const [id, name] of regions.length ? regions : (index && index.regions) || []) out.push({ id: 'earth:reg:' + id, label: `Fly to ${name}`, kw: 'region lightning flashes', m: 'earth', run: floorClick('earth', `#eRegions [data-region="${id}"]`) });
  if (ns.story && ns.story.chapter && ns.story.chapter !== 'free') out.push({ id: 'stars:free', label: 'Leave the story (free sky)', kw: 'exit story free sky', m: 'stars', run: () => ns.story.exitStory() });
  return out;
}

function views() {
  const out = [];
  for (const m of FLOOR_ORDER) {
    const nav = document.querySelector({ stars: '#sPresets', asteroids: '#presets', dm: '#dPresets', earth: '#ePresets' }[m]);
    const live = nav ? [...nav.querySelectorAll('.btn')] : [];
    const list = live.length ? live.map((b) => {
      const id = b.dataset.p || b.dataset.preset || b.textContent.trim();
      const known = VIEWS[m].find((v) => v[0] === id);
      return [id, known ? known[1] : b.textContent.trim(), (known && known[2]) || VIEW_KW[id] || '', b.classList.contains('on')];
    }) : VIEWS[m].map((v) => [v[0], v[1], v[2] || '', false]);
    for (const [id, label, kw, on] of list) out.push({ id: `view:${m}:${id}`, g: 'Guided views', label, kw, m, tag: TAG[m], meta: on ? 'showing' : '', run: () => runPreset(m, id, label) });
  }
  return out;
}
function stories() {
  return STORIES.map(([key, title, hook], i) => ({ id: 'story:' + key, g: 'Stories', label: `${i + 1} · ${title}`, kw: `story chapter guided ${hook}`, meta: hook, m: 'stars', tag: 'Stars', run: floorClick('stars', `#chapters [data-c="${key}"]`) }));
}
function instruments() {
  const out = [];
  for (const m of FLOOR_ORDER) for (const [label] of INSTRUMENTS[m]) out.push({ id: `inst:${m}:${label}`, g: 'Instruments', label, kw: `instrument chart panel ${INST_KW[label] || ''}`, m, tag: TAG[m], run: () => openInstrument(m, label) });
  return out;
}
function floors() {
  return FLOOR_ORDER.map((m) => ({ id: 'floor:' + m, g: 'Go to a floor', label: FLOOR_NAME[m], kw: `go to floor mode ${FLOOR_KW[m]}`, m, tag: m === mode() ? 'here' : '', run: () => shell.setMode(m) }));
}

function objects(q, raw) {
  const m = mode();
  const p = shell.search();
  let got = [];
  try { got = (p && p.items(raw)) || []; } catch { got = []; }
  return got.slice(0, q ? 7 : 5).map((o) => ({ id: `obj:${m}:${o.label}`, g: q ? 'Objects' : 'Worth a look', label: o.label + (o.des ? ` (${o.des})` : ''), meta: o.meta || '', dot: o.color, m, tag: TAG[m], score: 2000, run: () => o.pick(), recent: /^Rubin object/.test(o.label) ? null : { m, q: o.label } }));
}

function loadIndex() {
  if (index || indexLoading) return indexLoading;
  indexLoading = fetch('data/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    index = j && typeof j === 'object' ? j : {};
    if (box && !scrim.hidden && input.value.trim()) render(input.value);
    return index;
  });
  return indexLoading;
}
function elsewhere(q) {
  if (!index || q.length < 2) return [];
  const out = [], here = mode(), nq = q.replace(/\s+/g, '');
  const hit = (name) => { const t = norm(name); return t.includes(q) || t.replace(/\s+/g, '').includes(nq); };
  for (const m of FLOOR_ORDER) {
    if (m === here) continue;
    const rows = m === 'stars' ? index.stars || [] : m === 'asteroids' ? index.asteroids || [] : m === 'dm' ? index.dm || [] : index.earth || [];
    let n = 0;
    for (const r of rows) {
      const name = Array.isArray(r) ? r[0] : r;
      if (!hit(name)) continue;
      const query = Array.isArray(r) ? r[1] : name;
      out.push({ id: `obj:${m}:${name}`, g: 'Objects on other floors', label: name, m, tag: TAG[m], score: 1500 - n, run: () => pickObject(m, query, name), recent: { m, q: query, label: name } });
      if (++n >= 3) break;
    }
  }
  return out;
}
function searchOthers(raw) {
  const q = raw.trim();
  if (!q) return [];
  return FLOOR_ORDER.filter((m) => m !== mode()).map((m) => ({
    id: 'look:' + m, g: 'Search other floors', label: `Look for “${q}” among ${NOUN[m]}`, m, tag: TAG[m], score: 1,
    run: async () => { const before = shell.search(); await toFloor(m); await waitFor(() => shell.search() !== before); openPalette(q, opener); },
  }));
}

function recents() {
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; }
}
function remember(it) {
  if (!it || !it.id || it.g === 'Search other floors') return;
  const rec = { id: it.id, label: it.label, tag: it.tag || '', m: it.m || null, obj: it.recent || null };
  if (it.id.startsWith('obj:') && !it.recent) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([rec, ...recents().filter((r) => r.id !== it.id)].slice(0, 6))); } catch { return; }
}

function collect(raw) {
  const q = norm(raw.trim());
  const pool = [...floors(), ...views(), ...stories(), ...instruments(), ...actions().map((a) => ({ g: 'Actions', ...a, tag: a.tag || (a.m && a.m !== mode() ? TAG[a.m] : '') }))];
  const byId = new Map(pool.map((it) => [it.id, it]));
  let out = [];
  if (!q) {
    const here = mode();
    for (const r of recents()) {
      const it = byId.get(r.id);
      if (it) out.push({ ...it, g: 'Recent' });
      else if (r.obj && r.obj.m) out.push({ id: r.id, g: 'Recent', label: r.label, tag: r.tag, m: r.obj.m, recent: r.obj, run: () => pickObject(r.obj.m, r.obj.q, r.obj.label || r.obj.q) });
    }
    out.push(...objects('', ''));
    out.push(...pool.filter((it) => it.g === 'Go to a floor'));
    out.push(...pool.filter((it) => (it.g === 'Guided views' || it.g === 'Instruments' || it.g === 'Stories') && it.m === here));
    out.push(...pool.filter((it) => it.g === 'Actions' && (!it.m || it.m === here) && !it.id.startsWith('earth:reg:') && !it.id.startsWith('stars:fam:') && !it.id.startsWith('ast:cls:')));
    return out;
  }
  out = objects(q, raw);
  for (const it of pool) { const s = rate(it, q); if (s > 0) out.push({ ...it, score: s }); }
  out.push(...elsewhere(q));
  if (!index) loadIndex();
  const cap = { 'Guided views': 8, Stories: 6, Instruments: 6, Actions: 8, 'Go to a floor': 4 };
  const grouped = GROUPS.map((g) => out.filter((it) => it.g === g).sort((a, b) => b.score - a.score).slice(0, cap[g] || 7)).flat();
  return [...grouped, ...searchOthers(raw)];
}

function render(raw) {
  lastQ = raw;
  items = collect(raw);
  const q = norm(raw.trim());
  let g = '', html = '';
  items.forEach((it, i) => {
    if (it.g !== g) { g = it.g; html += `<li class="pl-g" role="presentation">${esc(g === 'Objects' ? `Objects on ${FLOOR_NAME[mode()]}` : g)}</li>`; }
    const kbd = it.kbd && it.kbd.length ? `<span class="pl-k" aria-hidden="true">${it.kbd.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : '';
    html += `<li role="option" id="plo${i}" data-i="${i}" aria-selected="false"><span class="pl-d"${it.dot ? ` style="background:${esc(it.dot)}"` : ''}></span><span class="pl-l">${mark(it.label, q)}${it.meta ? `<small>${esc(it.meta)}</small>` : ''}</span>${kbd}${it.tag ? `<span class="pl-t">${esc(it.tag)}</span>` : '<span></span>'}</li>`;
  });
  list.innerHTML = html || `<li class="pl-empty" role="presentation">Nothing matches “${esc(raw.trim())}”. Try a class (RR Lyrae), a name (2026 CZ10) or a verb (play).</li>`;
  let best = 0;
  if (q) { let top = -1; items.forEach((it, i) => { const s = it.g === 'Search other floors' ? 0 : (it.score || 0); if (s > top) { top = s; best = i; } }); }
  setAct(best, false);
  if (status) status.textContent = items.length ? `${items.length} results` : 'No results';
}
function setAct(i, scroll = true) {
  const opts = list.querySelectorAll('[role=option]');
  if (!items.length) { input.removeAttribute('aria-activedescendant'); return; }
  act = (i + items.length) % items.length;
  opts.forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === act)));
  const li = list.querySelector(`#plo${act}`);
  if (li) { input.setAttribute('aria-activedescendant', li.id); if (scroll || act > 0) li.scrollIntoView({ block: 'nearest' }); }
}
function run(it) {
  if (!it) return;
  remember(it);
  closePalette();
  Promise.resolve().then(() => it.run());
}

function build() {
  css();
  scrim = document.createElement('div');
  scrim.className = 'pl-scrim';
  scrim.hidden = true;
  scrim.innerHTML = `<div class="pl-box" role="dialog" aria-modal="true" aria-label="Search and commands">
    <div class="pl-field">${SEARCH_IC}<input type="text" role="combobox" aria-expanded="true" aria-controls="plList" aria-autocomplete="list" aria-label="Search objects, views, stories, instruments and actions" placeholder="Objects, views, stories, instruments, settings…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="button" class="pl-esc" aria-label="Close"><kbd>Esc</kbd></button></div>
    <ul id="plList" role="listbox" aria-label="Results"></ul>
    <p class="pl-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>${MOD}</kbd><kbd>K</kbd> or <kbd>/</kbd> from anywhere</span><button type="button" class="pl-keys">All shortcuts <kbd>?</kbd></button></p>
    <p class="sr" aria-live="polite"></p></div>`;
  document.body.appendChild(scrim);
  box = scrim.firstElementChild;
  input = scrim.querySelector('input');
  list = scrim.querySelector('ul');
  status = scrim.querySelector('.sr');
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); setAct(act + (k === 'ArrowDown' ? 1 : -1)); }
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); setAct(Math.max(0, Math.min(items.length - 1, act + (k === 'PageDown' ? 6 : -6)))); }
    else if (k === 'Tab') { e.preventDefault(); setAct(act + (e.shiftKey ? -1 : 1)); }
    else if (k === 'Enter') { e.preventDefault(); run(items[act]); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else if ((k === 'k' || k === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) { e.preventDefault(); closePalette(); } });
  scrim.querySelector('.pl-esc').addEventListener('click', () => closePalette());
  scrim.querySelector('.pl-keys').addEventListener('click', () => { const o = opener; closePalette(); openKeys(o); });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(items[+li.dataset.i]); });
  list.addEventListener('mousemove', (e) => { const li = e.target.closest('[data-i]'); if (li && +li.dataset.i !== act) setAct(+li.dataset.i, false); });
}

export function openPalette(q = '', from) {
  if (!scrim) build();
  if (keysEl && !keysEl.hidden) closeKeys(false);
  if (scrim.hidden) opener = from || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
  scrim.hidden = false;
  document.querySelectorAll('[data-ux="palette"]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  input.value = q;
  render(q);
  input.focus({ preventScroll: true });
  if (q.trim()) loadIndex();
}
export function closePalette() {
  if (!scrim || scrim.hidden) return;
  input.blur();
  scrim.hidden = true;
  document.querySelectorAll('[data-ux="palette"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (opener && opener.isConnected && visible(opener)) opener.focus({ preventScroll: true });
}
export const isPaletteOpen = () => !!scrim && !scrim.hidden;
export function togglePalette(q = '', from) { if (isPaletteOpen()) closePalette(); else openPalette(q, from); }
export const paletteItems = (q = '') => collect(q).map((it) => ({ id: it.id, group: it.g, label: it.label, tag: it.tag || '' }));
export function runById(id, q = '') { const it = collect(q).find((x) => x.id === id); if (it) run(it); return !!it; }

function keyRows() {
  const own = [[[MOD, 'K', 'or', '/'], 'Search and commands'], [['N'], 'Above you: one line per floor'], [['?'], 'This list of shortcuts'], [['Alt', '↑'], 'Climb a floor'], [['Alt', '↓'], 'Descend a floor'], [['Esc'], 'Close the topmost panel']];
  const theirs = (shell.keyHelp || []).filter((h) => h.keys && h.label).map((h) => [h.keys, h.label]);
  return { anywhere: [...own, ...theirs], floor: [[['Space'], 'Play or pause time (Stars, Dark matter, Earth)'], [['←', '→'], 'Step a night on the season ribbon, or 10 minutes on Earth; Shift for a week or an hour'], [['L'], 'Live space weather and aurora (Earth)'], [['+', '−', '0'], 'Zoom in, out and reset (sky, HR diagram, globe)'], [['↑', '↓'], 'Move between floors when the ladder has focus']], story: [[['←', '→'], 'Previous or next step'], [['Esc'], 'Leave the story']] };
}
function dl(rows) { return `<dl>${rows.map(([k, v]) => `<dt>${k.map((x) => (x === 'or' ? '<span>or</span>' : `<kbd>${esc(x)}</kbd>`)).join('')}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`; }
function keysKey(e) { if (e.key === 'Escape' && keysEl && !keysEl.hidden) { e.preventDefault(); e.stopImmediatePropagation(); closeKeys(); } else if (e.key === 'Tab' && keysEl && !keysEl.hidden) { e.preventDefault(); keysEl.querySelector('.ky-close').focus(); } }
export function openKeys(from) {
  css();
  if (isPaletteOpen()) closePalette();
  keysOpener = from || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
  if (!keysEl) {
    keysEl = document.createElement('div');
    keysEl.className = 'pl-scrim';
    keysEl.hidden = true;
    keysEl.addEventListener('mousedown', (e) => { if (e.target === keysEl) closeKeys(); });
    document.body.appendChild(keysEl);
  }
  const r = keyRows();
  keysEl.innerHTML = `<div class="ky-box" role="dialog" aria-modal="true" aria-labelledby="kyTitle"><div class="ky-head"><h2 id="kyTitle">Keyboard shortcuts</h2><button type="button" class="icon-btn sm ky-close" aria-label="Close shortcuts" title="Close (Esc)">${CLOSE_IC}</button></div>
    <h3>Anywhere</h3>${dl(r.anywhere)}<h3>On a floor</h3>${dl(r.floor)}<h3>In a story</h3>${dl(r.story)}
    <p>Letter keys are ignored while you type in a field. Everything here is also in the palette (${esc(MOD)} K).</p></div>`;
  keysEl.querySelector('.ky-close').addEventListener('click', () => closeKeys());
  keysEl.hidden = false;
  document.addEventListener('keydown', keysKey, true);
  keysEl.querySelector('.ky-close').focus();
}
export function closeKeys(restore = true) {
  if (!keysEl || keysEl.hidden) return;
  if (keysEl.contains(document.activeElement)) document.activeElement.blur();
  keysEl.hidden = true;
  document.removeEventListener('keydown', keysKey, true);
  if (restore && keysOpener && keysOpener.isConnected && visible(keysOpener)) keysOpener.focus({ preventScroll: true });
}

