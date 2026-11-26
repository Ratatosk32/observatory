import { esc, ns, onKey, shell, setCollapsed, reduceMotion, onModeReady, perf, pushPerf } from './kit.js';
import { icon } from './icons.js';
import { popFrom, play, stagger, watchSegments, slideTab, reduced, ease, DUR, EXIT, STAGGER } from './motion.js';
import { stageSnapshot, climbEntrance } from './transition.js';

export const ICON = Object.fromEntries(['chev', 'views', 'book', 'inst', 'info', 'close'].map((k) => [k, icon(k)]));

const INDEP = 'Independent project, not affiliated with or endorsed by the Vera C. Rubin Observatory.';
const CREDITS = {
  stars: {
    line: 'Rubin alerts via Fink · Gaia DR3, ESA/DPAC, CC BY-SA 3.0 IGO · SDSS DR16 · IAU WGSN',
    full: `<p>Stars &amp; beyond: this work uses alert data from the NSF–DOE Vera C. Rubin Observatory Legacy Survey of Space and Time, via the Fink broker (Möller et al. 2021, MNRAS 501, 3272), with crossmatch labels from AAVSO VSX, SIMBAD (CDS), the Transient Name Server, Mangrove and Legacy Surveys DR8 photo-z. This work has made use of data from the European Space Agency (ESA) mission <a href="https://www.cosmos.esa.int/gaia">Gaia</a>, processed by the Gaia Data Processing and Analysis Consortium (<a href="https://www.cosmos.esa.int/web/gaia/dpac/consortium">DPAC</a>). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement. Gaia Collaboration, Vallenari et al. 2023, A&amp;A 674, A1; distances from Bailer-Jones et al. 2021, AJ 161, 147. Gaia-derived grids: CC BY-SA 3.0 IGO. Redshifts: SDSS DR16 (Ahumada et al. 2020) via the GAVO Data Center; funding for the Sloan Digital Sky Survey IV has been provided by the Alfred P. Sloan Foundation, the U.S. Department of Energy Office of Science, and the Participating Institutions. Star names: IAU Catalog of Star Names, IAU Working Group on Star Names (WGSN), compiled by E. Mamajek (CC BY). RR Lyrae M<sub>G</sub> = 0.63 (Muraveva et al. 2018); flat ΛCDM, H<sub>0</sub> = 70, Ω<sub>m</sub> = 0.3.</p>`,
  },
  asteroids: {
    line: 'Rubin alerts via Fink · planets from JPL approximate elements · two-body orbits',
    full: '<p>Data: <a href="https://lsst.fink-broker.org/">Fink</a> LSST broker API (api.lsst.fink-portal.org): SSO alerts, SSOFT, nightly statistics, alert cutouts, from the alert stream of the NSF–DOE Vera C. Rubin Observatory. Planet positions from JPL approximate Keplerian elements (Standish). Orbits are two-body Keplerian; see README for caveats.</p>',
  },
  dm: {
    line: 'Planck (ESA) SMICA and PR4 lensing · ACT DR6 via NASA LAMBDA · SN-like alerts via Fink',
    full: '<p>Dark matter: based on observations obtained with Planck (https://www.esa.int/Planck), an ESA science mission with instruments and contributions directly funded by ESA Member States, NASA, and Canada; SMICA CMB map (Planck 2015 release) and the PR4 lensing reconstruction (Carron, Mirmelstein and Lewis 2022). ACT DR6 SZ cluster catalogue (ACT Collaboration 2025, arXiv:2507.21459), via NASA LAMBDA; the DR5 catalogue (Hilton et al. 2021) for the dashed comparison needle. SN-like alerts from the Fink broker tag most_likely_sn, from the NSF–DOE Vera C. Rubin Observatory alert stream.</p>',
  },
  earth: {
    line: 'NOAA SWPC · GOES GLM via NODD · MTG LI · NASA Black Marble via GIBS · Natural Earth · Contains modified EUMETSAT Meteosat data 2026',
    full: '<p>Earth: space weather from the NOAA Space Weather Prediction Center (OVATION Prime aurora model: Newell et al. 2009, 2010; real-time solar wind from SWFO-L1, ACE and IMAP; GOES XRS X-rays; planetary Kp from the GFZ and NOAA magnetometer network). Lightning from the GOES-R Geostationary Lightning Mapper (GOES-East and GOES-West GLM L2 flashes) via NOAA Open Data Dissemination on AWS. City lights: NASA Black Marble 2016 (Román et al. 2018), NASA Earth Observatory and NOAA NGDC from Suomi NPP VIIRS, via NASA GIBS. Lightning over Europe, Africa and the Atlantic from the MTG-I1 Lightning Imager (LI-2-LFL flashes). Contains modified EUMETSAT Meteosat data 2026 (EUMETSAT Data Policy, CC BY 4.0). Land, country and sea outlines: Natural Earth. Clouds, when switched on: infrared imagery recoloured for this site, based on EUMETSAT Meteosat data, NOAA GOES and Himawari (Japan Meteorological Agency), via EUMETView and NASA GIBS. We acknowledge the use of imagery provided by services from NASA’s Global Imagery Browse Services (GIBS), part of NASA’s Earth Science Data and Information System (ESDIS).</p>',
  },
};

const hudBtn = (cls, icon, label, controls, popup = true) => `<button type="button" class="btn glass ${cls}" aria-expanded="false" aria-controls="${controls}"${popup ? ' aria-haspopup="dialog"' : ''}>${icon}<span class="hb-t">${label}</span></button>`;
const pop = (id, title, body, cls = '') => `<div class="pop ${cls}" id="${id}" role="dialog" aria-label="${esc(title)}" hidden><div class="pop-head"><h3>${esc(title)}</h3><button type="button" class="btn icon quiet sm pop-x" aria-label="Close" title="Close (Esc)">${ICON.close}</button></div><div class="pop-body">${body}</div></div>`;

export function sceneHtml(m, o) {
  const views = `<h4>Guided views</h4><nav class="presets" id="${o.views.nav}" aria-label="${esc(o.views.label)}"></nav>${o.views.legend ? `<h4>Show</h4><div class="legend" id="${o.views.legend}"></div>` : ''}${(o.views.extra || []).map(([h, html]) => `<h4>${esc(h)}</h4>${html}`).join('')}`;
  const stories = o.stories ? hudBtn('hb-stories', ICON.book, 'Stories', `${m}Stories`) + pop(`${m}Stories`, 'Stories', `<p class="pop-note">Guided tours with hands-on tools. Each ends on one number and how sure we are.</p><nav class="chapters shelf" id="chapters" aria-label="Stories"></nav>`, 'pop-wide') : '';
  const info = `<p class="cap">${o.info.cap}</p><div class="about">${o.info.about}</div>${o.info.key ? `<h4>Key</h4><div class="legend" id="${o.info.key}"></div>` : ''}<p class="honest">${o.info.honest}</p><h4 id="${m}Credits">Sources and credits</h4><div class="credits"><p class="indep">${INDEP}</p>${CREDITS[m].full}</div>`;
  const tabs = o.instruments.map((x, i) => `<button type="button" role="tab" class="tab" id="${m}Tab${i}" aria-controls="${m}Inst${i}" aria-selected="false" tabindex="-1">${esc(x.label)}</button>`).join('');
  const panes = o.instruments.map((x, i) => `<section class="inst ${x.cls}" id="${m}Inst${i}" role="tabpanel" aria-labelledby="${m}Tab${i}" hidden>${x.html}</section>`).join('');
  return `
<main class="scene smain${o.mainCls ? ' ' + o.mainCls : ''}"${o.mainId ? ` id="${o.mainId}"` : ''} data-floor="${m}">
  <section class="sc-stage ${o.stageCls}" aria-labelledby="${o.qid}">
    <h2 class="question" id="${o.qid}">${o.question}</h2>
    <div class="map-wrap ${o.wrapCls || ''}">
      ${o.canvas}
      <div class="hud">
        <div class="hud-l">
          <button type="button" class="btn glass hb-view" aria-haspopup="dialog" aria-expanded="false" aria-controls="${m}View" aria-label="Guided views and filters">${ICON.views}<span class="hb-t">${esc(o.views.first)}</span>${ICON.chev}</button>
          ${pop(`${m}View`, 'Views and filters', views, 'pop-view')}
          <div class="pill-host"${o.pillId ? ` id="${o.pillId}"` : ''}></div>
        </div>
        <div class="hud-r">
          ${stories}
          ${hudBtn('hb-inst', ICON.inst, 'Instruments', `${m}Drawer`, false)}
          <button type="button" class="btn glass icon hb-icon hb-info" aria-haspopup="dialog" aria-expanded="false" aria-controls="${m}Info" aria-label="About this view" title="About this view, key and credits">${ICON.info}</button>
          ${pop(`${m}Info`, 'About this view', info, 'pop-info')}
        </div>
      </div>
      ${o.zoom || ''}
      ${o.overlay || ''}
    </div>
    ${o.below || ''}
    <div class="time dock${o.dockCls ? ' ' + o.dockCls : ''}">${o.dock}</div>
    <p class="credit"><span>${esc(CREDITS[m].line)}</span><button type="button" class="link credit-more">Sources and credits</button></p>
    <section class="drawer" id="${m}Drawer" aria-label="Instruments" hidden>
      <div class="dhead"><div class="tabs" role="tablist" aria-label="Instruments">${tabs}<span class="tab-line" aria-hidden="true"></span></div><button type="button" class="btn icon quiet sm dclose" aria-label="Close instruments" title="Close (Esc or I)">${ICON.close}</button></div>
      <div class="dpane">${panes}</div>
    </section>
  </section>
  <aside class="panel card" id="${o.card.id}" aria-labelledby="${o.card.hid}">
    <button type="button" class="grab" aria-label="Expand the card" aria-expanded="false"><span></span></button>
    <div class="phead"><div class="pbar"><h2 id="${o.card.hid}" data-list="${esc(o.card.title)}">${esc(o.card.title)}</h2></div></div>
    <div id="${o.card.body}" aria-live="polite"></div>
  </aside>
</main>`;
}

export function verdictHtml(v) {
  const sg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}σ`;
  const x = (s) => (((Math.max(-2, Math.min(4, s)) + 2) / 6) * 100).toFixed(1);
  const yes = Math.max(v.lens, v.clusters) >= 3;
  const label = `Do Rubin’s explosions follow the dark matter? ${yes ? 'Yes' : 'Not yet'}. Lensing ${sg(v.lens)}, clusters ${sg(v.clusters)}${v.dr5 != null ? `, DR5 clusters ${sg(v.dr5)}` : ''}; 3 sigma would be a detection. ${v.forecast || ''} Open the meters.`;
  return `<button type="button" class="verdict" aria-label="${esc(label)}">
    <span class="q">Do Rubin’s explosions follow the dark matter?</span>
    <span class="a">${yes ? 'Yes' : 'Not yet'}</span>
    <span class="scale" aria-hidden="true"><span class="axis"></span><span class="zero" style="left:${x(0)}%"></span><span class="three" style="left:${x(3)}%"><i>3σ</i></span>${v.dr5 != null ? `<span class="ndl dr5" style="left:${x(v.dr5)}%"></span>` : ''}<span class="ndl lens" style="left:${x(v.lens)}%"><i>κ ${sg(v.lens)}</i></span><span class="ndl cl" style="left:${x(v.clusters)}%"><i>clusters ${sg(v.clusters)}</i></span></span>
    <span class="f">${esc(v.forecast || '')}</span>
  </button>`;
}

const scenes = {};
const body = document.body;
const phoneQ = matchMedia('(max-width: 699.98px)');
let openPop = null, popReturn = null;

function hidePop(p) {
  if (reduced || !p.animate) { p.hidden = true; return; }
  p.style.pointerEvents = 'none';
  const a = play(p, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }], { exit: true, fill: 'forwards' });
  const done = () => { p.style.pointerEvents = ''; if (a) a.cancel(); if (openPop !== p) p.hidden = true; };
  if (a) a.finished.then(done, done); else done();
}
function closePop(restore = true) {
  if (!openPop) return false;
  const p = openPop;
  openPop = null;
  hidePop(p);
  const b = document.querySelector(`[aria-controls="${p.id}"][aria-expanded="true"]`);
  if (b) b.setAttribute('aria-expanded', 'false');
  if (restore && popReturn && popReturn.isConnected && p.contains(document.activeElement)) popReturn.focus({ preventScroll: true });
  popReturn = null;
  return true;
}
function showPop(p, opener) {
  if (openPop === p) { closePop(); return; }
  closePop(false);
  openPop = p; popReturn = opener;
  p.getAnimations().forEach((a) => a.cancel());
  p.style.pointerEvents = '';
  p.hidden = false;
  if (!phoneQ.matches) popFrom(p, opener); else play(p, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { fill: 'backwards' });
  if (opener) opener.setAttribute('aria-expanded', 'true');
  const f = p.querySelector('.pop-body button, .pop-body input, .pop-body select, .pop-body a[href]');
  if (f && !phoneQ.matches) f.focus({ preventScroll: true }); else p.querySelector('.pop-x').focus({ preventScroll: true });
}

function viewName(nav) {
  const on = nav.querySelector('.btn.on');
  return on ? on.textContent.trim() : 'Filtered';
}

export function openInstrument(m, which = null, el = null) {
  const s = scenes[m];
  if (!s || !s.tabs.length) return false;
  let k = which == null ? s.tab : typeof which === 'number' ? which : s.tabs.findIndex((t) => t.textContent.trim().toLowerCase() === String(which).toLowerCase());
  if (el) { const i = s.panes.findIndex((p) => p.contains(el)); if (i >= 0) k = i; }
  if (k < 0) return false;
  closePop(false);
  s.tab = k;
  s.drawer.hidden = false;
  s.stage.classList.add('drawer-open');
  s.inst.setAttribute('aria-expanded', 'true'); s.inst.classList.add('on');
  s.tabs.forEach((t, i) => { t.setAttribute('aria-selected', String(i === k)); t.tabIndex = i === k ? 0 : -1; t.classList.toggle('on', i === k); s.panes[i].hidden = i !== k; });
  slideTab(s.tabs[0].parentElement);
  return true;
}
export function openCredits(m = body.dataset.mode) {
  const s = scenes[m], p = document.getElementById(`${m}Info`);
  if (!s || !p) return false;
  if (openPop !== p) showPop(p, s.stage.querySelector('.hb-info'));
  const h = document.getElementById(`${m}Credits`);
  if (h) h.scrollIntoView({ block: 'start' });
  return true;
}

export function reveal(el) {
  if (!(el instanceof Element)) return false;
  const floor = el.closest('.scene');
  const m = floor ? floor.dataset.floor : body.dataset.mode;
  const s = scenes[m];
  if (!s) return false;
  const p = el.closest('.pop');
  if (p) {
    if (openPop !== p) showPop(p, s.stage.querySelector(`[aria-controls="${p.id}"]`));
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    return true;
  }
  if (s.drawer.contains(el)) {
    openInstrument(m, null, el);
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    return true;
  }
  if (body.classList.contains('zen')) setZen(false);
  if (s.sheet && s.sheet.on() && s.sheet.contains(el)) {
    s.sheet.raise(el.closest('.phead') ? 'half' : 'full');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
  }
  return s.main.contains(el);
}

export function closeInstruments(m = body.dataset.mode, focus = false) {
  const s = scenes[m];
  if (!s || s.drawer.hidden) return false;
  const had = s.drawer.contains(document.activeElement);
  s.drawer.hidden = true;
  s.stage.classList.remove('drawer-open');
  s.inst.setAttribute('aria-expanded', 'false'); s.inst.classList.remove('on');
  if (focus || had) s.inst.focus({ preventScroll: true });
  return true;
}

const SHEET = ['peek', 'half', 'full'];
const SHEET_NAME = { peek: 'peek', half: 'half height', full: 'full height' };
const PEEK_MIN = 76, PEEK_LOW = 48;
const FLING = 0.3, FLICK_MS = 90;
const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

function makeSheet(s, card) {
  const grab = card.querySelector('.grab'), inner = card.lastElementChild, kick = card.querySelector('h2');
  const sh = { pos: 'peek', h: null, on: false, drag: null, moved: false, key: '' };
  grab.setAttribute('aria-controls', inner.id);
  grab.title = 'Drag, tap, or use the arrow keys';

  const visible = () => card.getClientRects().length > 0;
  function measure() {
    const vh = innerHeight, full = Math.round(vh - Math.min(56, vh * 0.08));
    const end = s.stage.getBoundingClientRect().bottom + scrollY, dock = s.stage.querySelector('.dock');
    let peek = clampN(vh - end - 8, PEEK_MIN, vh * 0.5);
    if (dock) peek = Math.min(peek, Math.max(PEEK_LOW, vh - (dock.getBoundingClientRect().bottom + scrollY) - 6));
    peek = Math.round(peek);
    const half = Math.round(Math.min(full, Math.max(vh * 0.58, peek + 140)));
    sh.h = { peek, half, full };
  }
  function label() {
    const next = sh.pos === 'full' ? 'lower it to peek' : `raise it to ${SHEET_NAME[SHEET[SHEET.indexOf(sh.pos) + 1]]}`;
    grab.setAttribute('aria-label', `Card, ${kick.textContent.trim()}: ${SHEET_NAME[sh.pos]}. Activate to ${next}`);
  }
  function apply(pos, speed = 0) {
    const was = current();
    sh.pos = pos;
    grab.setAttribute('aria-expanded', String(pos !== 'peek'));
    label();
    if (!sh.on || !sh.h) return;
    const h = sh.h[pos], key = `${pos}|${h}|${sh.h.full}`;
    if (key !== sh.key || card.style.getPropertyValue('--sheet-h') !== `${h}px`) {
      sh.key = key;
      card.style.setProperty('--sheet-full', `${sh.h.full}px`);
      card.style.setProperty('--sheet-h', `${h}px`);
      card.style.setProperty('--sheet-body', `${Math.max(0, h - inner.offsetTop - 8)}px`);
      card.dataset.sheet = pos;
      if (!reduced && speed > 0 && Number.isFinite(was)) {
        const dur = clampN((4 * Math.abs(h - was)) / speed, DUR.quick, DUR.gentle);
        card.style.transitionDuration = `${Math.round(dur)}ms, ${DUR.travel}ms`;
      } else card.style.removeProperty('transition-duration');
    }
    const pad = `calc(${sh.h.peek}px + env(safe-area-inset-bottom))`;
    if (body.style.paddingBottom !== pad) body.style.paddingBottom = pad;
  }
  function refresh() {
    if (!sh.on || !visible()) return;
    measure();
    apply(sh.pos);
  }
  function enable(on) {
    sh.on = on;
    if (on) { refresh(); return; }
    for (const p of ['--sheet-full', '--sheet-h', '--sheet-body']) card.style.removeProperty(p);
    delete card.dataset.sheet;
    sh.key = '';
    body.style.removeProperty('padding-bottom');
    grab.removeAttribute('aria-expanded');
  }
  function current() { return parseFloat(card.style.getPropertyValue('--sheet-h')) || (sh.h ? sh.h[sh.pos] : NaN); }
  function settle(v) {
    const h = current(), hs = SHEET.map((p) => sh.h[p]);
    let k = hs.reduce((b, x, i) => (Math.abs(x - h) < Math.abs(hs[b] - h) ? i : b), 0);
    if (v < -FLING) { const up = hs.findIndex((x) => x > h + 1); if (up >= 0) k = up; }
    else if (v > FLING) { for (let i = hs.length - 1; i >= 0; i--) if (hs[i] < h - 1) { k = i; break; } }
    apply(SHEET[k], Math.abs(v));
  }
  function velocity(d, now) {
    const pts = d.pts.filter(([t]) => now - t <= FLICK_MS);
    if (pts.length < 2) return 0;
    const [t0, y0] = pts[0], [t1, y1] = pts[pts.length - 1];
    return t1 > t0 ? (y1 - y0) / (t1 - t0) : 0;
  }

  grab.addEventListener('pointerdown', (e) => {
    if (!sh.on || !sh.h || e.button > 0) return;
    sh.drag = { id: e.pointerId, y0: e.clientY, h0: sh.h[sh.pos], pts: [[e.timeStamp, e.clientY]] };
    sh.moved = false;
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    const d = sh.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    if (!sh.moved && Math.abs(dy) < 6) return;
    if (!sh.moved) { sh.moved = true; card.classList.add('dragging'); }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const c of evs.length ? evs : [e]) d.pts.push([c.timeStamp, c.clientY]);
    if (d.pts.length > 24) d.pts.splice(0, d.pts.length - 24);
    card.style.setProperty('--sheet-h', `${clampN(d.h0 - dy, sh.h.peek * 0.6, sh.h.full)}px`);
  });
  const release = (e) => {
    const d = sh.drag;
    if (!d || e.pointerId !== d.id) return;
    sh.drag = null;
    card.classList.remove('dragging');
    if (sh.moved) { d.pts.push([e.timeStamp, e.clientY]); settle(velocity(d, e.timeStamp)); }
  };
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);
  grab.addEventListener('click', () => {
    if (sh.moved) { sh.moved = false; return; }
    if (!sh.on) return;
    apply(SHEET[(SHEET.indexOf(sh.pos) + 1) % SHEET.length]);
  });
  grab.addEventListener('keydown', (e) => {
    if (!sh.on) return;
    const i = SHEET.indexOf(sh.pos);
    const k = { ArrowUp: i + 1, ArrowRight: i + 1, PageUp: i + 1, ArrowDown: i - 1, ArrowLeft: i - 1, PageDown: i - 1, Home: 0, End: SHEET.length - 1 }[e.key];
    if (k == null) return;
    e.preventDefault(); e.stopPropagation();
    apply(SHEET[clampN(k, 0, SHEET.length - 1)]);
  });

  const ro = new ResizeObserver(refresh);
  ro.observe(s.stage);
  ro.observe(body);
  addEventListener('resize', refresh, { passive: true });
  phoneQ.addEventListener('change', () => enable(phoneQ.matches));
  enable(phoneQ.matches);
  label();
  return {
    on: () => sh.on,
    pos: () => sh.pos,
    set: (p) => { if (SHEET.includes(p)) apply(p); },
    raise: (p = 'half') => {
      if (!sh.on || !sh.h || SHEET.indexOf(sh.pos) >= SHEET.indexOf(p)) return 0;
      const top = card.getBoundingClientRect().top;
      apply(p);
      return Math.max(0, top - (innerHeight - sh.h[p]));
    },
    contains: (el) => card.contains(el),
    grab,
  };
}

export function showCard(m = body.dataset.mode) {
  const s = scenes[m];
  if (!s) return false;
  if (s.sheet.on()) { s.sheet.raise('half'); return true; }
  const c = s.main.querySelector('.card'), r = c.getBoundingClientRect();
  if (r.top > innerHeight - 80 || r.bottom < 80) c.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  return true;
}

function lowerSheet() {
  const s = scenes[body.dataset.mode];
  if (!s || !s.sheet.on() || s.sheet.pos() === 'peek') return false;
  const had = s.sheet.contains(document.activeElement);
  s.sheet.set('peek');
  if (had) s.sheet.grab.focus({ preventScroll: true });
  return true;
}

export function wireScene(m, root) {
  const main = root.querySelector('.scene');
  const stage = main.querySelector('.sc-stage');
  const s = { main, stage, tab: 0 };
  s.drawer = stage.querySelector('.drawer');
  s.tabs = [...s.drawer.querySelectorAll('[role=tab]')];
  s.panes = s.tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  s.inst = stage.querySelector('.hb-inst');
  scenes[m] = s;
  stage.querySelectorAll('.hud [aria-haspopup="dialog"]').forEach((b) => b.addEventListener('click', () => showPop(document.getElementById(b.getAttribute('aria-controls')), b)));
  stage.querySelectorAll('.pop-x').forEach((b) => b.addEventListener('click', () => closePop()));
  const viewBtn = stage.querySelector('.hb-view'), nav = stage.querySelector('.pop-view .presets');
  const sync = () => { const t = viewName(nav); viewBtn.querySelector('.hb-t').textContent = t; viewBtn.setAttribute('aria-label', `Guided views and filters: ${t}`); };
  new MutationObserver(sync).observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  nav.addEventListener('click', (e) => { if (e.target.closest('.btn')) closePop(); });
  const shelf = stage.querySelector('#chapters');
  if (shelf) shelf.addEventListener('click', (e) => { if (e.target.closest('[data-c]')) closePop(false); });
  s.inst.addEventListener('click', () => (s.drawer.hidden ? openInstrument(m) : closeInstruments(m)));
  s.tabs.forEach((t, i) => {
    t.addEventListener('click', () => openInstrument(m, i));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const k = (i + d + s.tabs.length) % s.tabs.length;
      openInstrument(m, k); s.tabs[k].focus();
    });
  });
  s.drawer.querySelector('.dclose').addEventListener('click', () => closeInstruments(m, true));
  stage.querySelector('.credit-more').addEventListener('click', (e) => { openCredits(m); e.stopPropagation(); });
  const card = main.querySelector('.card');
  const head = card.querySelector('.pbar');
  const ctl = document.createElement('div');
  ctl.className = 'pctl';
  ctl.innerHTML = `<button type="button" class="btn icon quiet sm col">${icon('chev', 'chev')}</button>`;
  head.appendChild(ctl);
  let stored = false;
  try { stored = localStorage.getItem('observatory-collapsed-' + card.querySelector('h2').id) === '1'; } catch (e) { stored = false; }
  ctl.querySelector('.col').addEventListener('click', () => {
    const v = !card.classList.contains('collapsed');
    setCollapsed(card, v);
    try { if (v) localStorage.setItem('observatory-collapsed-' + card.querySelector('h2').id, '1'); else localStorage.removeItem('observatory-collapsed-' + card.querySelector('h2').id); } catch (e) { return; }
  });
  setCollapsed(card, stored);
  s.sheet = makeSheet(s, card);
  watchKicker(m, card);
  const v = stage.querySelector('.verdict');
  if (v) v.addEventListener('click', () => openInstrument(m, 0));
  sync();
  return s;
}

export const sceneOf = (m) => scenes[m];
watchSegments(document.body);

function kickerOf(body, fallback) {
  const h = [...body.querySelectorAll('h3[data-kind]')].find((x) => !x.closest('.card-ghost'));
  if (h) return h.dataset.kind;
  return fallback;
}

const FLOOR_SRC = { stars: () => import('./stars.js'), asteroids: () => import('./asteroids.js'), dm: () => import('./darkmatter.js'), earth: () => import('./earth.js') };
const floorMods = {};
onModeReady((m) => { if (FLOOR_SRC[m] && !floorMods[m]) FLOOR_SRC[m]().then((x) => { floorMods[m] = x; }, () => {}); });
function markOf(m, sel) {
  const f = floorMods[m];
  if (!f || typeof f.screenOf !== 'function') return null;
  try {
    const p = f.screenOf(sel);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch { return null; }
}

const FRESH = DUR.gentle + DUR.instant;
const FLIGHT = DUR.gentle - STAGGER.each;
const tap = { t: -1e9, wrap: null, snap: null, down: null };
let picked = null, seq = null;
document.addEventListener('pointerdown', (e) => {
  const w = e.isPrimary && e.target instanceof HTMLCanvasElement ? e.target.closest('.scene .map-wrap') : null;
  tap.down = w ? { x: e.clientX, y: e.clientY, t: performance.now(), w } : null;
}, { capture: true, passive: true });
document.addEventListener('pointerup', (e) => {
  const d = tap.down;
  tap.down = null;
  if (!d || reduced || performance.now() - d.t > DUR.travel || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  tap.t = performance.now(); tap.wrap = d.w; tap.snap = stageSnapshot(d.w);
  pushPerf(perf.tapSnap || (perf.tapSnap = []), performance.now() - tap.t);
}, { capture: true, passive: true });
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.scene > .card [data-pick]') : null;
  if (b) picked = { t: performance.now(), r: (b.querySelector('.sw') || b).getBoundingClientRect() };
}, { capture: true });
for (const t of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(t, () => { if (seq) endSeq(); }, { capture: true, passive: true });

function endSeq() {
  const s = seq;
  if (!s) return;
  seq = null;
  for (const a of s.anims) if (a) { try { a.finish(); } catch { a.cancel(); } }
  for (const n of s.nodes) n.remove();
  for (const n of s.hidden) n.style.visibility = '';
}

function bands(root) {
  const out = [];
  for (const el of root.children) {
    if (isGhost(el)) continue;
    if (el.tagName === 'UL') out.push(...el.children); else out.push(el);
  }
  return out;
}

const inView = (els, lift = 0) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom - lift > 0 && r.top - lift < innerHeight; });
const LEAD = 4;
function curtain(s, card, from, delay) {
  const c = card.getBoundingClientRect(), r = from.getBoundingClientRect(), b = from.parentElement.closest('[aria-live]') || from.parentElement;
  const el = document.createElement('i');
  el.className = 'hero-wipe card-veil';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${b.offsetLeft}px`, top: `${Math.max(0, r.top - c.top - card.clientTop)}px`, width: `${b.clientWidth}px`, height: `${Math.max(0, c.bottom - r.top)}px` });
  card.appendChild(el);
  s.nodes.push(el);
  const a = play(el, [{ opacity: 1 }, { opacity: 0 }], { dur: DUR.base, delay, curve: 'out', fill: 'backwards' });
  s.anims.push(a);
  if (a) a.finished.then(() => el.remove(), () => el.remove()); else el.remove();
}
function wipe(s, cv, at) {
  const el = document.createElement('i');
  el.className = 'hero-wipe';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px` });
  cv.after(el);
  s.nodes.push(el);
  const a = play(el, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { dur: DUR.gentle, delay: DUR.quick * 2, curve: 'out', fill: 'backwards' });
  s.anims.push(a);
  if (a) a.finished.then(() => el.remove(), () => el.remove()); else el.remove();
}

const onScreen = (r) => !!r && r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const lifted = (r, dy) => ({ left: r.left, right: r.right, width: r.width, height: r.height, top: r.top - dy, bottom: r.bottom - dy });

function ghostOf(body, old, at) {
  const g = document.createElement('div');
  g.className = 'card-ghost';
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  g.append(...old);
  g.style.left = `${at.x}px`;
  g.style.top = `${at.y}px`;
  g.style.width = `${at.w}px`;
  body.appendChild(g);
  return g;
}

function ring(s, at) {
  const el = document.createElement('i');
  el.className = 'sel-ring';
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${at.x}px`; el.style.top = `${at.y}px`;
  document.body.appendChild(el);
  s.nodes.push(el);
  const a = play(el, [{ transform: 'scale(0.24)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }], { dur: DUR.base, fill: 'forwards' });
  s.anims.push(a);
  if (a) a.finished.then(() => el.remove(), () => el.remove()); else el.remove();
}

function leaderReveal(s, at) {
  const snap = tap.snap, wrap = tap.wrap;
  tap.snap = null; tap.wrap = null;
  if (!snap || !wrap || !wrap.isConnected) return;
  const last = [...wrap.querySelectorAll('canvas')].pop();
  if (!last) return;
  const r = wrap.getBoundingClientRect(), z = getComputedStyle(last).zIndex;
  const op = last.offsetParent || document.body, pr = op.getBoundingClientRect();
  snap.className = 'sel-veil';
  snap.setAttribute('aria-hidden', 'true');
  Object.assign(snap.style, { position: 'absolute', margin: '0', left: `${r.left - pr.left - op.clientLeft}px`, top: `${r.top - pr.top - op.clientTop}px`, width: `${r.width}px`, height: `${r.height}px` });
  if (z !== 'auto') snap.style.zIndex = z;
  last.after(snap);
  snap.style.setProperty('--sel-x', `${at.x - r.left}px`);
  snap.style.setProperty('--sel-y', `${at.y - r.top}px`);
  s.nodes.push(snap);
  const fade = play(snap, [{ opacity: 1 }, { opacity: 0 }], { dur: DUR.gentle, delay: STAGGER.each, curve: 'out', fill: 'both' });
  s.anims.push(fade);
  if (fade) fade.finished.then(() => snap.remove(), () => snap.remove());
}

const ARC_STEPS = 12;
const FOLLOW_MAX = 2 * DUR.travel;
const arcAt = (a, b, p) => {
  const e = ease.io(p), bump = Math.sin(Math.PI * e), up = Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
  return `translate(${(a.x + (b.x - a.x) * e).toFixed(1)}px, ${(a.y + (b.y - a.y) * e - up * bump).toFixed(1)}px) scale(${(1 + 0.5 * bump).toFixed(3)})`;
};
function follow(s, el, a, b, { dur, delay, land, track, t0 = null }) {
  let to = b, born = null, still = 0, over = false, raf = 0;
  const stop = (ok = true) => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    el.remove();
    if (land) land(ok ? to : null);
  };
  const tick = (now) => {
    if (born == null) born = now;
    const nx = track();
    if (nx) { still = to && Math.hypot(nx.x - to.x, nx.y - to.y) < 0.5 ? still + 1 : 0; to = nx; }
    if (to && t0 == null) t0 = now + delay;
    const p = t0 == null ? 0 : Math.min(1, Math.max(0, (now - t0) / dur));
    if (to && now >= t0) { el.style.transform = arcAt(a, to, p); el.style.opacity = '1'; }
    if ((p >= 1 && still >= 2) || now - born > FOLLOW_MAX) { stop(!!to); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  s.anims.push({ finish: () => stop(), cancel: () => stop(false) });
}
function fly(s, color, a, b, { dur, delay, land, track = null }) {
  const el = document.createElement('i');
  el.className = 'sel-fly';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--c', color);
  document.body.appendChild(el);
  s.nodes.push(el);
  if (!b) { follow(s, el, a, b, { dur, delay, land, track }); return; }
  const frames = [];
  for (let i = 0; i <= ARC_STEPS; i++) frames.push({ transform: arcAt(a, b, i / ARC_STEPS), opacity: 1 });
  const t0 = performance.now() + delay;
  const anim = play(el, frames, { dur, delay, curve: 'linear', fill: 'both' });
  let over = false, raf = 0;
  const done = () => { if (over) return; over = true; cancelAnimationFrame(raf); el.remove(); if (land) land(track ? track() || b : b); };
  s.anims.push(anim, { finish: done, cancel: done });
  if (anim) anim.finished.then(done, () => {}); else done();
  if (!track || !anim) return;
  const watch = () => {
    if (over) return;
    const nx = track();
    if (nx && Math.hypot(nx.x - b.x, nx.y - b.y) > 1) { over = true; anim.cancel(); follow(s, el, a, nx, { dur, delay, land, track, t0 }); return; }
    raf = requestAnimationFrame(watch);
  };
  raf = requestAnimationFrame(watch);
}

function choreograph(m, card, body, old, isObj, rise = 0) {
  endSeq();
  const now = performance.now();
  const fromMap = !!tap.wrap && now - tap.t < FRESH && card.parentElement.contains(tap.wrap);
  const pick = picked && now - picked.t < FRESH ? picked : null;
  picked = null;
  if (!fromMap) { tap.snap = null; tap.wrap = null; }
  if (reduced || !card.getClientRects().length) return;
  const s = { anims: [], nodes: [], hidden: [] };
  seq = s;
  const k = isObj ? 1 : EXIT;
  const sw = isObj ? body.querySelector(':scope > .cls .sw') : null;
  const target = sw ? lifted(sw.getBoundingClientRect(), rise) : null;
  const hero = isObj ? [...body.querySelectorAll(':scope > canvas, :scope > * > canvas')].find((c) => c.getClientRects().length) : null;
  const heroAt = hero ? { x: hero.offsetLeft, y: hero.offsetTop - (hero.offsetParent === card ? body.scrollTop : 0), w: hero.offsetWidth, h: hero.offsetHeight } : null;
  const fresh = inView(bands(body), rise);
  const mk = isObj ? markOf(m) : null;
  const slot = { x: body.offsetLeft, y: body.offsetTop - body.scrollTop, w: body.clientWidth };
  const gsw = !isObj && card.selMark && card.selMark.m === m ? old.find((n) => n.nodeType === 1 && n.matches('.cls')) : null;
  if (mk && fromMap) leaderReveal(s, mk);
  if (old.length) {
    const g = ghostOf(body, old, slot);
    s.nodes.push(g);
    const out = play(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${isObj ? -12 : 0}px, ${isObj ? 0 : 8}px)` }], { dur: DUR.base * k, exit: true, fill: 'forwards' });
    s.anims.push(out);
    const gone = () => g.remove();
    if (out) out.finished.then(gone, gone); else gone();
  }
  const enter = (isObj ? DUR.base : DUR.quick) * k;
  s.anims.push(...stagger(fresh.slice(0, LEAD), { dur: DUR.base, each: STAGGER.each * k, y: isObj ? 8 : 6, delay: enter }));
  if (fresh.length > LEAD) curtain(s, card, fresh[LEAD], enter + (LEAD - 1) * STAGGER.each * k);
  if (isObj) {
    if (hero) wipe(s, hero, heroAt);
    card.selMark = mk ? { m, sel: mk.sel } : null;
    const swOk = onScreen(target);
    if (fromMap) {
      if (!mk) return;
      ring(s, mk);
      if (swOk) {
        sw.style.visibility = 'hidden';
        s.hidden.push(sw);
        fly(s, mk.color, mk, centre(target), { dur: FLIGHT, delay: STAGGER.each * 2, land: () => { sw.style.visibility = ''; } });
      }
      return;
    }
    const start = pick && onScreen(pick.r) ? centre(pick.r) : swOk ? centre(target) : null;
    const color = mk ? mk.color : sw ? getComputedStyle(sw).backgroundColor : '';
    if (!start || !color) { if (mk) ring(s, mk); return; }
    fly(s, color, start, mk, {
      dur: FLIGHT, delay: STAGGER.each * 2, track: () => markOf(m),
      land: (at) => { if (!at) return; if (!card.selMark) card.selMark = { m, sel: at.sel }; if (seq === s) ring(s, at); },
    });
    return;
  }
  const back = card.selMark;
  card.selMark = null;
  const src = gsw && gsw.querySelector('.sw'), sr = src && src.getBoundingClientRect();
  const home = gsw ? markOf(m, back.sel) : null;
  if (!home || !onScreen(sr)) return;
  fly(s, home.color, centre(sr), home, { dur: FLIGHT * EXIT, delay: 0 });
}
const HYPHEN_NUM = /(^|[\s(,:=])-(?=\d)/g;
function typeset(root) {
  for (const el of root.querySelectorAll('dd, .why > span, .chead')) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.nodeValue.includes('-')) continue;
      const t = n.nodeValue.replace(HYPHEN_NUM, '$1−');
      if (t !== n.nodeValue) n.nodeValue = t;
    }
  }
}
const isGhost = (n) => n.nodeType === 1 && (n.classList.contains('card-ghost') || n.classList.contains('hero-wipe'));
const ghostOnly = (r) => [...r.addedNodes, ...r.removedNodes].every(isGhost);
function watchKicker(m, card) {
  const h2 = card.querySelector('.pbar h2'), body = card.querySelector('[aria-live]');
  let shown = '', wasObj = false;
  const sync = (recs) => {
    const real = recs ? recs.filter((r) => !ghostOnly(r)) : [];
    if (recs && !real.length) return;
    const t = kickerOf(body, h2.dataset.list);
    if (h2.textContent !== t) h2.textContent = t;
    typeset(body);
    const head = body.querySelector(':scope > h3');
    const isObj = !!head && !head.classList.contains('ph');
    const now = `${t}|${head ? head.textContent : ''}`;
    const climb = climbEntrance(m);
    if (climb != null && real.length) stagger(inView(bands(body)), { y: 8, delay: climb });
    else if (shown && now !== shown && card.getClientRects().length) {
      if (isObj || wasObj) {
        const c0 = performance.now();
        const sc = scenes[m], rise = isObj && sc && sc.sheet ? sc.sheet.raise('half') : 0;
        choreograph(m, card, body, real.length ? [...real[0].removedNodes].filter((n) => !isGhost(n)) : [], isObj, rise);
        pushPerf(perf.select || (perf.select = []), performance.now() - c0);
      }
      else stagger(body.querySelectorAll(':scope > ul > li, :scope > h3, :scope > .cls, :scope > .why, :scope > .chead'));
    }
    shown = now; wasObj = isObj;
  };
  new MutationObserver(sync).observe(body, { childList: true });
  sync();
}

function wake() {
  body.classList.remove('idle');
  clearTimeout(wake.t);
  wake.t = setTimeout(() => {
    const m = body.dataset.mode, s = scenes[m];
    if (openPop || (s && (!s.drawer.hidden || s.main.querySelector('.card [aria-live] > h3:not(.ph)'))) || body.classList.contains('story') || document.querySelector('.sheet:not([hidden]), .lad-peek:not([hidden])')) { wake(); return; }
    body.classList.add('idle');
  }, 9000);
}
for (const t of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin']) document.addEventListener(t, wake, { passive: true, capture: true });
wake();

export function setZen(v = !body.classList.contains('zen')) {
  body.classList.toggle('zen', v);
  if (v) { closePop(false); closeInstruments(); }
  return v;
}

document.addEventListener('focusin', (e) => {
  if (body.classList.contains('zen') && e.target instanceof Element && e.target.closest('.top > :not(.ladder), .hud, .scene > .card, .sc-stage > .credit, .lensbar, .verdict')) setZen(false);
});
document.addEventListener('pointerdown', (e) => {
  if (!openPop) return;
  if (e.target.closest('.pop') || e.target.closest(`[aria-controls="${openPop.id}"]`)) return;
  closePop(false);
});
new MutationObserver(() => { closePop(false); body.classList.remove('idle'); }).observe(body, { attributes: true, attributeFilter: ['data-mode'] });

onKey('escape', () => {
  if (closePop()) return true;
  if (closeInstruments(body.dataset.mode, true)) return true;
  if (lowerSheet()) return true;
  if (body.classList.contains('zen')) { setZen(false); return true; }
  return false;
}, { typing: true });
onKey('h', toggleZen);
function toggleInstruments() {
  const m = body.dataset.mode, s = scenes[m];
  if (!s || body.classList.contains('story')) return false;
  if (s.drawer.hidden) openInstrument(m); else closeInstruments(m, true);
  return true;
}
function toggleView() {
  const m = body.dataset.mode, s = scenes[m];
  if (!s || body.classList.contains('story')) return false;
  const p = document.getElementById(`${m}View`);
  if (openPop === p) closePop(); else showPop(p, s.stage.querySelector('.hb-view'));
  return true;
}
function toggleZen() { return body.classList.contains('story') ? false : (setZen(), true); }
onKey('i', toggleInstruments);
onKey('v', toggleView);
shell.keyHelp = shell.keyHelp || [];
shell.keyHelp.push(
  { keys: ['V'], label: 'Views and filters', kw: 'view menu presets filters show size tools', run: toggleView },
  { keys: ['I'], label: 'Instruments drawer', kw: 'instruments charts drawer census orbits meters space weather', run: toggleInstruments },
  { keys: ['H'], label: 'Hide or show the controls', kw: 'zen hide chrome calm contemplate', run: toggleZen },
);

shell.scene = {
  openInstrument: (m, which, el) => openInstrument(m, which, el),
  reveal,
  closeInstruments: (m) => closeInstruments(m),
  instruments: (m) => (scenes[m] ? scenes[m].tabs.map((t) => t.textContent.trim()) : []),
  views: (m) => (scenes[m] ? [...scenes[m].stage.querySelectorAll('.pop-view .presets .btn')].map((b) => ({ label: b.textContent.trim(), on: b.classList.contains('on'), run: () => b.click() })) : []),
  openInfo: (m = body.dataset.mode) => { const s = scenes[m]; if (s) showPop(document.getElementById(`${m}Info`), s.stage.querySelector('.hb-info')); },
  openView: (m = body.dataset.mode) => { const s = scenes[m]; if (s) showPop(document.getElementById(`${m}View`), s.stage.querySelector('.hb-view')); },
  openCredits,
  showCard,
  sheet: (m = body.dataset.mode) => (scenes[m] && scenes[m].sheet.on() ? scenes[m].sheet.pos() : null),
  setSheet: (p, m = body.dataset.mode) => { if (scenes[m]) scenes[m].sheet.set(p); },
  zen: setZen,
  ready: (m) => !!scenes[m],
};
ns.scene = shell.scene;
