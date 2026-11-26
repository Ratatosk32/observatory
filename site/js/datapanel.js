import { $, MON, fmtN, fmtDate, fmtShort } from './kit.js';
import { persistOnce, openStore } from './net.js';
import { resetStore as resetAsteroids } from './sync.js';
import { resetStore as resetStars } from './starsync.js';

const providers = {};
let active = null, ctl = null;
const btn = $('#dataBtn'), panel = $('#dataPanel');
const fmtWhen = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const fmtBytes = (b) => b == null ? 'unknown' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' kB';
const signed = (n) => `${n >= 0 ? '+' : ''}${fmtN(n)}`;

export function register(mode, p) {
  providers[mode] = p;
  if (document.body.dataset.mode === mode || (!document.body.dataset.mode && mode === 'asteroids')) activate(mode);
}

export function activate(mode) {
  if (ctl && active !== providers[mode]) return;
  active = providers[mode] || null;
  btn.disabled = !active;
  if (!active) { $('#dataLbl').textContent = 'Data'; openData(false); return; }
  refresh();
}

const optBox = $('#optRefresh');
function showStandard(v) {
  $('#doUpdate').closest('.actions').hidden = !v;
  panel.querySelector('.store').hidden = !v;
}
function refreshLive(P) {
  if (optBox.dataset.saved == null) optBox.dataset.saved = optBox.checked ? '1' : '0';
  optBox.checked = P.optChecked();
  $('#dataTtl').textContent = P.title;
  $('#dataLbl').textContent = P.label();
  btn.setAttribute('aria-label', `${P.title}: ${P.label()}`);
  btn.title = `${P.title}. Click for details.`;
  btn.classList.remove('fresh');
  $('#dataStatus').innerHTML = P.status();
  $('#optRefreshTxt').textContent = P.optText;
  $('#optRefreshN').textContent = '';
  $('#optExtra').closest('label').hidden = true;
  $('#dataNote').textContent = P.note;
  showStandard(false);
}
optBox.addEventListener('change', () => { if (active && active.live) active.onOpt(optBox.checked); });

export function refresh(p) {
  if (!active || (p && p !== active)) return;
  if (active.live) { refreshLive(active); return; }
  if (optBox.dataset.saved != null) { optBox.checked = optBox.dataset.saved === '1'; delete optBox.dataset.saved; }
  showStandard(true);
  const P = active, c = P.counts(), B = P.bundled, info = P.info();
  const plus = c.nunit - B.nunit;
  $('#dataTtl').textContent = P.title;
  if (info && info.at) {
    $('#dataLbl').textContent = `Updated · ${signed(plus)}`;
    btn.setAttribute('aria-label', `${P.title}: updated, ${signed(plus)} ${P.unit}`);
    btn.title = `${P.title} updated ${fmtWhen(info.at)}: ${signed(plus)} ${P.unit}. Click for details and updates.`;
    btn.classList.add('fresh');
    $('#dataStatus').innerHTML = `Updated <b>${fmtWhen(info.at)}</b>: ${fmtN(c.nobj)} ${P.noun} (${fmtN(c.nobj - B.nobj)} new), ${fmtN(c.nunit)} ${P.unit} (${signed(plus)}), data up to <b>${fmtDate(c.tmax)}</b>.`;
  } else {
    $('#dataLbl').textContent = `Data · ${fmtShort(c.tmax)}`;
    btn.setAttribute('aria-label', `${P.title}: up to ${fmtDate(c.tmax)}`);
    btn.title = `${P.title}: bundled snapshot up to ${fmtDate(c.tmax)}. Click for details and updates.`;
    btn.classList.remove('fresh');
    $('#dataStatus').innerHTML = `Bundled snapshot: ${fmtN(c.nobj)} ${P.noun}, ${fmtN(c.nunit)} ${P.unit}, up to <b>${fmtDate(c.tmax)}</b>.`;
  }
  $('#optRefreshTxt').textContent = P.refreshText;
  $('#optRefreshN').textContent = P.refreshHint();
  $('#optExtraTxt').textContent = P.extraText;
  $('#optExtra').closest('label').hidden = !P.extraText;
  $('#optExtra').setAttribute('aria-label', P.extraAria);
  $('#dataNote').textContent = P.note;
  $('#doReset').textContent = `Reset ${P.short} to bundled data`;
}

async function storeLabel() {
  if (!active || !active.storage) return;
  const P = active;
  const txt = await P.storage();
  if (P === active) $('#storeTxt').textContent = txt;
}

let openedAt = 0;
function openData(v) {
  if (v) openedAt = performance.now();
  panel.hidden = !v; btn.setAttribute('aria-expanded', String(v));
  if (v) panel.scrollTop = 0;
  if (v && active) { refresh(); storeLabel(); (active.live ? $('#dataClose') : $('#doUpdate')).focus({ preventScroll: true }); }
}

btn.addEventListener('click', () => openData(panel.hidden));
$('#dataClose').addEventListener('click', () => { openData(false); btn.focus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !ctl) { openData(false); btn.focus(); } });
document.addEventListener('click', (e) => { if (!panel.hidden && !ctl && e.timeStamp > openedAt && !e.target.closest('#dataPanel, #dataBtn')) openData(false); });

$('#doUpdate').addEventListener('click', async () => {
  if (!active || ctl) return;
  const P = active;
  ctl = new AbortController();
  $('#doUpdate').disabled = true; $('#doCancel').hidden = false; $('#prog').hidden = false; $('#doReset').disabled = true; $('#doResetAll').disabled = true;
  document.querySelectorAll('#altLadder [role=radio]').forEach((b) => { b.disabled = true; });
  const bar = $('#progBar'), txt = $('#progTxt');
  persistOnce();
  try {
    const before = P.counts();
    const info = await P.update({
      refresh: $('#optRefresh').checked, extra: +$('#optExtra').value, signal: ctl.signal,
      onProgress: (p) => {
        const frac = p.batches ? p.done / p.batches : 0;
        bar.style.width = (5 + 95 * frac).toFixed(1) + '%';
        txt.textContent = `${p.msg}${p.batches ? ` · request ${p.done} of ${p.batches}` : ''} · ${fmtN(p.rows)} rows${p.failed ? ` · ${p.failed} failed (kept going)` : ''}`;
      },
      onMerge: () => { txt.textContent = 'Merging…'; },
    });
    const after = P.counts();
    txt.textContent = `Done: ${signed(after.nunit - before.nunit)} ${P.unit}, ${signed(after.nobj - before.nobj)} ${P.noun}${P.doneExtra ? P.doneExtra(info) : ''}${info.nights ? `, ${fmtN(info.nights)} nights of statistics` : ''}${info.failed ? `, ${info.failed} requests failed after retries` : ''}.`;
  } catch (e) {
    txt.textContent = e.name === 'AbortError' ? 'Cancelled. Rows already fetched are kept and merged next time.' : `Update failed: ${e.message || e}. The data on the page is unchanged.`;
  } finally {
    ctl = null;
    $('#doUpdate').disabled = false; $('#doCancel').hidden = true; $('#doReset').disabled = false; $('#doResetAll').disabled = false;
    document.querySelectorAll('#altLadder [role=radio]').forEach((b) => { b.disabled = false; });
    bar.style.width = '100%';
    refresh(P); storeLabel();
  }
});
$('#doCancel').addEventListener('click', () => { if (ctl) ctl.abort(); });
$('#doReset').addEventListener('click', async () => {
  if (!active) return;
  await active.reset().catch(() => null);
  location.reload();
});
$('#doResetAll').addEventListener('click', async () => {
  await resetAsteroids().catch(() => null);
  await resetStars().catch(() => null);
  await openStore('observatory-dm', ['points', 'meta']).clearAll().catch(() => null);
  location.reload();
});
