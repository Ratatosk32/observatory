import { $, esc, ns, shell, setUrl, initTheme, applyTheme, fullscreenPanel, exitFs, modeReady, onKey, onBrand, slot } from './kit.js';
import './scene.js';
import { activate as activateData } from './datapanel.js';
import { initLadder, MODES as FLOORS } from './ladder.js';
import './health.js';
import { floorTransition } from './transition.js';

const sIn = $('#search'), sBox = $('#searchbox'), sList = $('#sugg'), sClear = $('#clear');
let provider = { items: () => [], empty: '' };
let sugg = [], sAct = -1;

function highlight(name, q) {
  const v = q.trim().toLowerCase();
  const i = v ? name.toLowerCase().indexOf(v) : -1;
  return i < 0 ? esc(name) : esc(name.slice(0, i)) + '<b>' + esc(name.slice(i, i + v.length)) + '</b>' + esc(name.slice(i + v.length));
}
function openSuggestions() {
  const q = sIn.value;
  sugg = provider.items(q);
  sAct = -1;
  const head = !q.trim() ? '<li class="hint" role="presentation">Worth a look</li>' : '';
  sList.innerHTML = head + (sugg.length
    ? sugg.map((o, i) => `<li role="option" id="sg${i}" data-i="${i}" aria-selected="false"><span class="dot" style="background:${o.color}"></span><span class="nm">${highlight(o.label, q)}${o.des ? ` <span class="meta">(${esc(o.des)})</span>` : ''}</span><span class="meta">${esc(o.meta)}</span></li>`).join('')
    : `<li class="hint" role="presentation">${esc(provider.empty)}</li>`);
  sList.hidden = false;
  sBox.classList.add('open');
  sIn.setAttribute('aria-expanded', 'true');
  sIn.removeAttribute('aria-activedescendant');
}
function closeSuggestions() {
  sList.hidden = true; sBox.classList.remove('open'); sIn.setAttribute('aria-expanded', 'false'); sIn.removeAttribute('aria-activedescendant'); sAct = -1;
}
function setActive(i) {
  sAct = sugg.length ? (i + sugg.length) % sugg.length : -1;
  sList.querySelectorAll('[role=option]').forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === sAct)));
  if (sAct >= 0) sIn.setAttribute('aria-activedescendant', 'sg' + sAct);
}
function pick(o) {
  if (!o) return;
  closeSuggestions();
  sIn.value = o.label; sClear.hidden = false;
  o.pick();
  sIn.blur();
}
sIn.addEventListener('focus', () => { sBox.classList.add('focus'); sIn.select(); openSuggestions(); });
sIn.addEventListener('blur', () => { sBox.classList.remove('focus'); setTimeout(closeSuggestions, 120); });
sIn.addEventListener('input', () => { sClear.hidden = !sIn.value; openSuggestions(); });
sIn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (sList.hidden) openSuggestions(); setActive(sAct + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(sAct - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); pick(sugg[sAct >= 0 ? sAct : 0]); }
  else if (e.key === 'Escape') { if (!sList.hidden) { e.stopPropagation(); closeSuggestions(); } else sIn.blur(); }
});
sList.addEventListener('mousedown', (e) => e.preventDefault());
sList.addEventListener('click', (e) => { const li = e.target.closest('[role=option]'); if (li) pick(sugg[+li.dataset.i]); });
sClear.addEventListener('click', () => { sIn.value = ''; sClear.hidden = true; sIn.focus(); openSuggestions(); });
shell.setSearch = (p, placeholder) => { provider = p; sIn.placeholder = placeholder; };
shell.search = () => provider;

const palette = () => import('./palette.js'), brief = () => import('./brief.js');
const LADDER = ['dm', 'stars', 'asteroids', 'earth'], MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
shell.keyHelp = shell.keyHelp || [];
onKey('k', () => { palette().then((p) => p.togglePalette(document.activeElement === sIn ? sIn.value : '')); }, { mod: true, typing: true });
onKey('/', () => { palette().then((p) => p.openPalette()); });
onKey('?', () => { palette().then((p) => p.openKeys()); });
onKey('n', () => { brief().then((b) => b.toggleBrief()); });
onBrand((e) => { brief().then((b) => b.toggleBrief(e.currentTarget)); }, 'Above you: one line per floor (N)');
slot('search')?.insertAdjacentHTML('beforeend', `<button type="button" class="btn quiet sm pl-hint" data-ux="palette" aria-haspopup="dialog" aria-expanded="false" aria-label="Search and commands on every floor" title="Everything: objects, views, stories, tools (${MOD_KEY} K)"><kbd>${MOD_KEY}</kbd><kbd>K</kbd></button>`);
slot('header')?.insertAdjacentHTML('afterbegin', '<button type="button" class="btn icon pl-open" data-ux="palette" aria-haspopup="dialog" aria-expanded="false" aria-label="Search and commands" title="Search and commands"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button>');
document.addEventListener('mousedown', (e) => { if (e.target.closest('.pl-hint')) e.preventDefault(); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ux="palette"]'); if (b) palette().then((p) => p.togglePalette(sIn.value, b)); });
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target.closest?.('input, select, textarea')) return;
  const next = LADDER[LADDER.indexOf(mode) + (e.key === 'ArrowUp' ? -1 : 1)];
  if (next) { e.preventDefault(); setMode(next); }
});

initTheme();

const params = new URLSearchParams(location.search);
let mode = null;
const MODES = ['stars', 'asteroids', 'dm', 'earth'];
const loaders = {
  asteroids: () => import('./asteroids.js'),
  stars: () => import('./stars.js').then(async (m) => { await import('./story.js'); return m; }),
  dm: () => import('./darkmatter.js'),
  earth: () => import('./earth.js'),
};
const LOADING = { stars: ['#starsLoading', '#starsRoot', 'the stars data'], dm: ['#dmLoading', '#dmRoot', 'the dark-matter data'], earth: ['#earthLoading', '#earthRoot', 'the Earth data'], asteroids: ['#astLoading', '#astRoot', 'the asteroid data'] };
const modules = {}, started = new Set();
const loadMode = (m) => (modules[m] ||= loaders[m]());

function skeleton(m) {
  const root = $(LOADING[m][1]);
  if (!root.querySelector('.scene')) root.innerHTML = `<main class="scene skel" data-floor="${m}" aria-hidden="true"><section class="sc-stage"><h2 class="question">&nbsp;</h2><div class="map-wrap"></div><div class="time dock"></div></section><aside class="panel card"></aside></main>`;
  return root.querySelector('.scene');
}
function failCard(m, err, retry) {
  const [sel, , what] = LOADING[m];
  $(sel).hidden = true;
  const scene = skeleton(m), wrap = scene.querySelector('.map-wrap');
  scene.classList.add('skel');
  scene.removeAttribute('aria-hidden');
  wrap.querySelector('.floor-error')?.remove();
  const why = navigator.onLine === false ? 'This device seems to be offline.' : 'The data did not arrive' + (err && err.message ? ` (${err.message}).` : '.');
  wrap.insertAdjacentHTML('beforeend', `<div class="floor-error" role="alert"><p class="fe-t">Could not load ${esc(what)}</p><p class="fe-d">${esc(why)} The other floors still work.</p><button type="button" class="btn fe-retry">Retry</button></div>`);
  wrap.querySelector('.fe-retry').addEventListener('click', retry);
}
function reloadFloor(m) {
  const u = new URL(location.href);
  u.searchParams.set('mode', m);
  for (const k of ['obj', 'sel', 'play']) u.searchParams.delete(k);
  location.assign(u);
}
function enterFloor(m, mod, obj) {
  const scene = $(LOADING[m][1]).querySelector('.scene');
  if (scene) { scene.classList.remove('skel'); scene.querySelector('.floor-error')?.remove(); }
  let entering;
  try { entering = mod.api.enter(obj); } catch (e) { entering = Promise.reject(e); }
  Promise.resolve(entering).catch((e) => { if (mode === m) failCard(m, e, () => enterFloor(m, mod, obj)); });
}

const SUBS = {
  earth: 'Lightning, aurora and the solar wind above you',
  asteroids: 'The asteroids Rubin is watching',
  stars: 'Variable stars, supernovae and quasars from Rubin’s alerts',
  dm: 'The oldest light and the dark matter that bends it',
};
const ladder = initLadder({ onPick: (m) => setMode(m) });
function syncModeUi() {
  ladder.select(mode);
  document.title = `Look up · ${FLOORS[mode].name}`;
  $('#sub').textContent = SUBS[mode];
}
async function leaveMode(m) {
  if (!m || !modules[m]) return;
  try {
    const mod = await modules[m];
    if (m === 'asteroids') mod.hide(); else mod.api.leave();
  } catch { return; }
}
async function setMode(m, opts = {}) {
  if (m === mode && !opts.force) return;
  const prev = mode;
  floorTransition(prev, m);
  mode = m;
  document.body.dataset.mode = m;
  syncModeUi();
  ladder.mode(m, loadMode(m));
  closeSuggestions(); sIn.value = '';
  if (fullscreenPanel()) exitFs();
  if (prev !== m) await leaveMode(prev);
  activateData(m);
  const [sel] = LOADING[m];
  skeleton(m);
  $(sel).hidden = false;
  try {
    const mod = await loadMode(m);
    $(sel).hidden = true;
    if (mode !== m) return;
    activateData(m);
    if (m === 'asteroids') {
      if (!started.has(m)) { started.add(m); mod.start(opts.params || new URLSearchParams()); }
      shell.setSearch(mod.provider, `Search ${mod.count()} asteroids, e.g. 2026 CZ10`);
      mod.show(opts.params);
    } else {
      setUrl({ mode: m, sel: null });
      enterFloor(m, mod, opts.obj);
    }
    modeReady(m);
  } catch (e) {
    failCard(m, e, () => reloadFloor(m));
  }
}
shell.setMode = setMode;
shell.mode = () => mode;
if (params.get('theme')) applyTheme(params.get('theme'));
const wanted = params.get('mode');
const first = MODES.includes(wanted) ? wanted : params.has('sel') ? 'asteroids' : 'stars';
await setMode(first, { obj: params.get('obj'), params, force: true });
ns.ready = true;
