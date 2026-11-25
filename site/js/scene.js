import { esc, ns, onKey, shell, setCollapsed, reduceMotion } from './kit.js';

const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  chev: svg('<path d="M7 10l5 5 5-5"/>'),
  views: svg('<path d="M4 7h16M7 12h10M10 17h4"/>'),
  book: svg('<path d="M4 5.5c2.5-1 5.5-1 8 .8 2.5-1.8 5.5-1.8 8-.8v13c-2.5-1-5.5-1-8 .8-2.5-1.8-5.5-1.8-8-.8z"/><path d="M12 6.3v13"/>'),
  inst: svg('<path d="M4 19h16M6 16V9M10 16V5M14 16v-5M18 16V8"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

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

const hudBtn = (cls, icon, label, controls, popup = true) => `<button type="button" class="hb ${cls}" aria-expanded="false" aria-controls="${controls}"${popup ? ' aria-haspopup="dialog"' : ''}>${icon}<span class="hb-t">${label}</span></button>`;
const pop = (id, title, body, cls = '') => `<div class="pop ${cls}" id="${id}" role="dialog" aria-label="${esc(title)}" hidden><div class="pop-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn sm pop-x" aria-label="Close" title="Close (Esc)">${ICON.close}</button></div><div class="pop-body">${body}</div></div>`;

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
          <button type="button" class="hb hb-view" aria-haspopup="dialog" aria-expanded="false" aria-controls="${m}View" aria-label="Guided views and filters">${ICON.views}<span class="hb-t">${esc(o.views.first)}</span>${ICON.chev}</button>
          ${pop(`${m}View`, 'Views and filters', views, 'pop-view')}
          <div class="pill-host"${o.pillId ? ` id="${o.pillId}"` : ''}></div>
        </div>
        <div class="hud-r">
          ${stories}
          ${hudBtn('hb-inst', ICON.inst, 'Instruments', `${m}Drawer`, false)}
          <button type="button" class="hb hb-icon hb-info" aria-haspopup="dialog" aria-expanded="false" aria-controls="${m}Info" aria-label="About this view" title="About this view, key and credits">${ICON.info}</button>
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
      <div class="dhead"><div class="tabs" role="tablist" aria-label="Instruments">${tabs}</div><button type="button" class="icon-btn sm dclose" aria-label="Close instruments" title="Close (Esc or I)">${ICON.close}</button></div>
      <div class="dpane">${panes}</div>
    </section>
  </section>
  <aside class="panel card" id="${o.card.id}" aria-labelledby="${o.card.hid}">
    <button type="button" class="grab" aria-label="Expand the card" aria-expanded="false"><span></span></button>
    <div class="phead"><div class="pbar"><h2 id="${o.card.hid}">${esc(o.card.title)}</h2></div></div>
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

function closePop(restore = true) {
  if (!openPop) return false;
  const p = openPop;
  openPop = null;
  p.hidden = true;
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
  p.hidden = false;
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
  ctl.innerHTML = `<button type="button" class="icon-btn sm col"><svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;
  head.appendChild(ctl);
  let stored = false;
  try { stored = localStorage.getItem('observatory-collapsed-' + card.querySelector('h2').id) === '1'; } catch (e) { stored = false; }
  ctl.querySelector('.col').addEventListener('click', () => {
    const v = !card.classList.contains('collapsed');
    setCollapsed(card, v);
    try { if (v) localStorage.setItem('observatory-collapsed-' + card.querySelector('h2').id, '1'); else localStorage.removeItem('observatory-collapsed-' + card.querySelector('h2').id); } catch (e) { return; }
  });
  setCollapsed(card, stored);
  const grab = card.querySelector('.grab');
  grab.addEventListener('click', () => {
    const o = card.classList.toggle('open');
    grab.setAttribute('aria-expanded', String(o));
    grab.setAttribute('aria-label', o ? 'Collapse the card' : 'Expand the card');
    if (o) card.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  const v = stage.querySelector('.verdict');
  if (v) v.addEventListener('click', () => openInstrument(m, 0));
  sync();
  return s;
}

export const sceneOf = (m) => scenes[m];

function wake() {
  body.classList.remove('idle');
  clearTimeout(wake.t);
  wake.t = setTimeout(() => {
    const m = body.dataset.mode, s = scenes[m];
    if (openPop || (s && !s.drawer.hidden) || body.classList.contains('story') || document.querySelector('.sheet:not([hidden]), .lad-peek:not([hidden])')) { wake(); return; }
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
  zen: setZen,
  ready: (m) => !!scenes[m],
};
ns.scene = shell.scene;
