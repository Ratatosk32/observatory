import { $, esc, ns, shell, setUrl, initTheme, applyTheme, panelControls, fullscreenPanel, exitFs } from './kit.js';
import { activate as activateData } from './datapanel.js';

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

initTheme();
panelControls();

const params = new URLSearchParams(location.search);
const asteroids = await import('./asteroids.js');
let mode = 'asteroids';
const MODES = ['asteroids', 'stars', 'dm'];
const loaders = {
  stars: () => import('./stars.js').then(async (m) => { await import('./story.js'); return m; }),
  dm: () => import('./darkmatter.js'),
};
const LOADING = { stars: ['#starsLoading', 'the stars data'], dm: ['#dmLoading', 'the dark-matter data'] };
const modules = {};
const loadMode = (m) => (modules[m] ||= loaders[m]());

function syncModeUi() {
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
  });
}
async function setMode(m, opts = {}) {
  if (m === mode && !opts.force) return;
  const prev = mode;
  mode = m;
  document.body.dataset.mode = m;
  syncModeUi();
  closeSuggestions(); sIn.value = '';
  if (fullscreenPanel()) exitFs();
  if (prev !== m && modules[prev]) (await modules[prev]).api.leave();
  if (prev === 'asteroids' && m !== 'asteroids') asteroids.hide();
  activateData(m);
  if (m === 'asteroids') {
    shell.setSearch(asteroids.provider, `Search ${asteroids.count()} asteroids, e.g. 2026 CZ10`);
    asteroids.show(opts.params);
    return;
  }
  setUrl({ mode: m, sel: null });
  const [sel, what] = LOADING[m];
  $(sel).hidden = false;
  try {
    const mod = await loadMode(m);
    $(sel).hidden = true;
    if (mode === m) { activateData(m); mod.api.enter(opts.obj); }
  } catch (e) {
    $(sel).textContent = `Could not load ${what}: ${e.message}`;
  }
}
shell.setMode = setMode;
document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const k = MODES.indexOf(b.dataset.mode), next = MODES[(k + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
    setMode(next);
    document.querySelector(`#modeSeg [data-mode="${next}"]`).focus();
  });
});

shell.setSearch(asteroids.provider, `Search ${asteroids.count()} asteroids, e.g. 2026 CZ10`);
asteroids.start(params);
syncModeUi();
if (params.get('theme')) applyTheme(params.get('theme'));
if (params.get('mode') === 'stars' || params.get('mode') === 'dm') setMode(params.get('mode'), { obj: params.get('obj') });
else asteroids.show(params);
ns.ready = true;
