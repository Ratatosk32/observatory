import { esc } from './kit.js';

const HOW = { measured: 'measured', indirect: 'indirect', weak: 'weak', typical: 'typical, not measured', model: 'model', live: 'live' };

export function provMark(how) {
  return `<svg class="pv how-${how}" viewBox="0 0 24 10" aria-hidden="true"><path class="cv" d="M1 0.5V9.5L7.5 5Z"/><path class="ct" d="M7 5H17"/><path class="cd" d="M18 5h6"/></svg>`;
}

export function cardHead({ name, sw, cls, note, chips = '', how = 'measured', prov, ladder, links = [] }) {
  const out = [`<h3>${esc(name)}</h3>`];
  if (cls) out.push(`<div class="cls"><span class="sw" style="background:${sw}"></span>${cls}${note ? ` <span class="cls-n">· ${note}</span>` : ''}</div>`);
  if (chips) out.push(chips);
  out.push('<div class="chead">');
  if (prov) out.push(`<p class="ch-prov" title="${esc(HOW[how] || how)}">${provMark(how)}<span><b>${esc(HOW[how] || how)}</b> · ${prov}</span></p>`);
  if (ladder) out.push(`<p class="ch-lad" data-ladline>${ladder}</p>`);
  const ok = links.filter((l) => l && l.href);
  if (ok.length) out.push(`<p class="ch-links">${ok.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} <span aria-hidden="true">↗</span></a>`).join('')}</p>`);
  out.push('</div>');
  return out.join('\n');
}
