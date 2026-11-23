import { $, esc, fmtN, fmtShort, nightMjd } from './kit.js';

const day = (label) => fmtShort(nightMjd(+label));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const STEP_NAMES = { stars: 'stars', asteroids: 'asteroids', dm: 'dark matter', showcase: 'showcase', tonight: 'Tonight' };
const MODE_NAMES = { stars: 'Stars', asteroids: 'Asteroids', dm: 'Dark matter', tonight: 'Tonight' };
const names = (keys, map) => keys.map((k) => map[k] || k).join(', ');

function headline(h) {
  const v = h.verdict || {};
  const live = `<a href="${esc(h.links.rubin)}" target="_blank" rel="noopener">Rubin’s live status ↗</a>`;
  switch (v.code) {
    case 'rubin-silent':
      return v.gap <= 3
        ? `Rubin has sent no alerts since ${day(v.since)}: ${plural(v.gap, 'quiet night', 'quiet nights')}. Short gaps are usually weather. ${live}`
        : `Rubin has sent no alerts since <b>${day(v.since)}</b>: ${plural(v.gap, 'silent night', 'silent nights')}. Both brokers agree, so the pause is at the telescope, not on this site. ${live} says why.`;
    case 'broker-lag':
      return `Rubin is still sending alerts (ANTARES has them up to ${day(v.ahead)}), but Fink stops at <b>${day(v.since)}</b>. This site reads Fink, so it waits for Fink to catch up.`;
    case 'pipeline':
      return `The last nightly refresh failed for <b>${esc(names(v.failed, STEP_NAMES))}</b>. Those parts show the data from the run before.`;
    case 'behind':
      return `Fink has data up to ${day(v.since)}, but ${esc(names(v.behind, MODE_NAMES))} on this page stop earlier. The nightly refresh ran out of time and catches up on the next run.`;
    case 'ok':
    case 'partial':
      return `All in step: Rubin observed on <b>${day(v.since)}</b>, the broker has it, and this page shows it.`;
    default:
      return 'Fink and ANTARES could not be reached during the last check, so the state upstream is unknown.';
  }
}

function spark(h) {
  const n = h.history.nights, W = 300, H = 46, bw = W / n.length, top = Math.max(1, ...n.map(([a]) => a));
  const k = Math.log10(top + 1), start = nightMjd(+h.history.start);
  const last = h.fink.last ? nightMjd(+h.fink.last) - start : -1;
  const bars = n.map(([a, vis], i) => {
    const x = (i * bw + 0.6).toFixed(1), tip = `${fmtShort(start + i)}: ${a ? `${fmtN(a)} alerts in ${vis} visits` : 'no alerts'}`;
    if (!a) return `<circle cx="${(i * bw + bw / 2).toFixed(1)}" cy="${H - 3}" r="0.9" class="z"><title>${tip}</title></circle>`;
    const bh = Math.max(2, (Math.log10(a + 1) / k) * (H - 8));
    return `<rect x="${x}" y="${(H - 2 - bh).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}" class="${i === last ? 'l' : 'b'}"><title>${tip}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rubin alerts per night over the last ${n.length} nights, as counted by Fink">${bars}</svg>
    <div class="hx"><span>${fmtShort(start)}</span><span>alerts per night, log scale</span><span>today</span></div>`;
}

function rows(h) {
  const v = h.verdict || {}, out = [];
  const silent = v.code === 'rubin-silent';
  out.push(['Rubin', silent ? `silent since ${day(v.since)}` : h.fink.last || h.antares.last ? `last alerts ${day(h.fink.last || h.antares.last)}` : 'unknown']);
  out.push(['Fink broker', !h.reachable.fink ? 'unreachable at the last check' : h.fink.last ? `last night ${day(h.fink.last)} · ${fmtN(h.fink.night[0])} alerts, ${h.fink.night[1]} visits` : 'no nights in the last two months']);
  out.push(['ANTARES broker', !h.reachable.antares ? 'unreachable at the last check' : h.antares.last ? `last Rubin alert ${day(h.antares.last)} (cross-check)` : 'no Rubin alerts in the last two months']);
  const failed = Object.entries(h.steps).filter(([, s]) => s === 'failure' || s === 'fallback').map(([k]) => k);
  const ran = Object.values(h.steps).filter((s) => s === 'success').length;
  const when = `${fmtShort(nightMjd(+h.checked.slice(0, 10).replace(/-/g, '')))} ${h.checked.slice(11, 16)} UTC`;
  out.push(['Nightly refresh', `${esc(when)} · ${failed.length ? `<span class="bad">failed: ${esc(names(failed, STEP_NAMES))}</span>` : ran ? `all ${ran} steps ran` : 'steps did not report'}`]);
  const dates = Object.entries(h.site), uniq = [...new Set(dates.map(([, d]) => d))];
  out.push(['This page', uniq.length === 1 ? `every mode up to ${day(uniq[0])}` : dates.map(([m, d]) => `${MODE_NAMES[m] || m} ${day(d)}`).join(' · ')]);
  return out.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');
}

async function load() {
  const box = $('#health'), dot = $('#hDot');
  if (!box) return;
  let h;
  try {
    const r = await fetch('data/health.json');
    if (!r.ok) return;
    h = await r.json();
  } catch {
    return;
  }
  if (!h || !h.verdict || !h.history) return;
  const age = (Date.now() - Date.parse(h.checked.replace('Z', ':00Z'))) / 36e5;
  const stale = age > 36 ? ` <span class="bad">The last check was ${plural(Math.round(age / 24), 'day', 'days')} ago; the nightly refresh may not have run.</span>` : '';
  box.innerHTML = `<h3>Data health</h3><p class="hl">${headline(h)}${stale}</p>${spark(h)}<dl>${rows(h)}</dl>`;
  box.hidden = false;
  const level = stale ? 'warn' : h.verdict.level;
  dot.dataset.level = level;
  dot.title = box.querySelector('.hl').textContent;
  dot.hidden = false;
}

load();
