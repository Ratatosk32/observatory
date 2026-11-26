import { esc, fmtShort, nightMjd } from './kit.js';

export const RUBIN_FLOORS = ['stars', 'asteroids', 'dm'];
const NAME = { stars: 'Stars', asteroids: 'Asteroids', dm: 'Dark matter' };
const MAX_TICKS = 14;
const day = (label) => fmtShort(nightMjd(+label));

let got = null;
export function health() {
  if (!got) got = fetch('data/health.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return got;
}

export function quietNights(h) {
  const v = (h && h.verdict) || {};
  if (v.code !== 'rubin-silent' || !v.since || !h.checked) return 0;
  const checked = nightMjd(+h.checked.slice(0, 10).replace(/-/g, ''));
  return Math.max(0, Math.round(checked - nightMjd(+v.since)));
}

export function ticksHtml(n) {
  if (!n) return '';
  return `<span class="q-ticks" aria-hidden="true"><i class="on"></i>${'<i></i>'.repeat(Math.min(n, MAX_TICKS))}</span>`;
}

export function quietOf(h, floor) {
  if (!h || !h.verdict || !RUBIN_FLOORS.includes(floor)) return null;
  const v = h.verdict;
  switch (v.code) {
    case 'rubin-silent': {
      const n = quietNights(h);
      if (n < 1) return null;
      const since = day(v.since);
      return {
        code: v.code, nights: n,
        text: n <= 3
          ? `Rubin has sent nothing new since ${since}. Short gaps are usually weather.`
          : `Rubin has sent nothing new since ${since}, most likely weather or a technical stop. The sky holds the last light it sent.`,
        chip: `${n} quiet ${n === 1 ? 'night' : 'nights'}`,
      };
    }
    case 'broker-lag':
      if (!v.since) return null;
      return {
        code: v.code, nights: 0, text: `Rubin is still observing${v.ahead ? ` (ANTARES has alerts up to ${day(v.ahead)})` : ''}, but Fink stops at ${day(v.since)}. This floor reads Fink, so it waits for Fink to catch up.`,
        chip: 'Broker behind',
      };
    case 'pipeline':
      if (!(v.failed || []).includes(floor)) return null;
      return {
        code: v.code, nights: 0,
        text: `The nightly refresh failed for ${NAME[floor]}; this is the previous run.`,
        chip: 'Previous run',
      };
    case 'behind': {
      if (!(v.behind || []).includes(floor) || !v.since) return null;
      const at = h.site && h.site[floor];
      return {
        code: v.code, nights: 0,
        text: `Fink has data up to ${day(v.since)}, but this floor stops at ${at ? day(at) : 'an earlier night'}. The nightly refresh ran out of time and catches up on the next run.`,
        chip: 'Catching up',
      };
    }
    case 'unknown':
      return {
        code: v.code, nights: 0,
        text: 'Fink and ANTARES could not be reached at the last check, so whether Rubin observed since is unknown.',
        chip: 'Status unknown',
      };
    default:
      return null;
  }
}

export function openHealth(e) {
  if (e) e.stopPropagation();
  const b = document.getElementById('dataBtn');
  if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
}

export function wireChip(floor, dock, before) {
  if (!dock || !RUBIN_FLOORS.includes(floor)) return;
  health().then((h) => {
    const q = quietOf(h, floor);
    if (!q || dock.querySelector('.q-chip')) return;
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'chip q-chip';
    s.addEventListener('click', openHealth);
    s.setAttribute('aria-label', `${q.chip}. ${q.text}`);
    s.title = q.text;
    s.innerHTML = `<i aria-hidden="true"></i><span aria-hidden="true">${esc(q.chip)}</span>`;
    if (before && before.parentElement === dock) dock.insertBefore(s, before); else dock.appendChild(s);
  });
}
