// SVG AHA 16-segment bullseye, each segment split into inner (endo) and outer (epi) halves.
import { SEGMENTS } from './logic.js';

// Colour scale requested: lowest = black -> purple -> blue -> yellow -> white = highest.
const STOPS = [
  [0, [0, 0, 0]],
  [0.25, [96, 26, 150]],
  [0.5, [30, 90, 255]],
  [0.75, [255, 215, 0]],
  [1, [255, 255, 255]],
];

export function colourFor(v, max) {
  if (!Number.isFinite(v)) return '#9a9a9a';
  const t = Math.min(1, Math.max(0, v / max));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * k));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(255,255,255)';
}

function textColourFor(v, max) {
  const t = Number.isFinite(v) ? v / max : 0.5;
  return t > 0.6 ? '#000' : '#fff';
}

// Ring radii (basal outermost). Apex (segment 17) left empty.
const RINGS = [
  [76, 106],
  [46, 76],
  [16, 46],
];

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (r, deg) => [+(r * Math.cos(rad(deg))).toFixed(2), +(-r * Math.sin(rad(deg))).toFixed(2)];

function sector(r0, r1, a0, a1) {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  // SVG y is flipped, so increasing math angle is sweep-flag 0.
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 1 ${x3},${y3} Z`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * data: { [segId]: { endo, epi } }
 * opts: { max, abnormal: Set<segId>, title, unit, cutoff, cutoffLabel, idPrefix }
 */
export function bullseyeSVG(data, opts) {
  const { max, abnormal = new Set(), title = '', idPrefix = 'be' } = opts;
  const parts = [];
  const outlines = [];
  const labels = [];
  for (const seg of SEGMENTS) {
    const [r0, r1] = RINGS[seg.ring];
    const rm = (r0 + r1) / 2;
    const d = data[seg.id] || {};
    const tip = `${seg.id} ${seg.name}: endo ${fmt(d.endo)}, epi ${fmt(d.epi)}`;
    parts.push(
      `<path class="be-seg" data-seg="${seg.id}" d="${sector(r0, rm, seg.start, seg.end)}" fill="${colourFor(d.endo, max)}"><title>${esc(tip)}</title></path>`,
      `<path class="be-seg" data-seg="${seg.id}" d="${sector(rm, r1, seg.start, seg.end)}" fill="${colourFor(d.epi, max)}"><title>${esc(tip)}</title></path>`
    );
    if (abnormal.has(seg.id)) {
      outlines.push(`<path class="be-abn" d="${sector(r0, r1, seg.start, seg.end)}"/>`);
    }
    const [lx, ly] = pt(rm, (seg.start + seg.end) / 2);
    const avg = (d.endo + d.epi) / 2;
    labels.push(
      `<text x="${lx}" y="${ly}" class="be-label" fill="${textColourFor(avg, max)}" pointer-events="none">${seg.id}</text>`
    );
  }
  return `<svg class="bullseye" viewBox="-112 -112 224 224" role="img" aria-label="${esc(title)} bullseye" id="${idPrefix}">
  <g>${parts.join('')}</g>
  <g pointer-events="none">${outlines.join('')}</g>
  <g>${labels.join('')}</g>
</svg>`;
}

export function legendSVG({ max, unit = '', cutoff, cutoffLabel = 'cut-off' }) {
  const id = `lg${Math.random().toString(36).slice(2, 8)}`;
  const W = 220;
  const x0 = 10;
  const w = W - 20;
  const stops = STOPS.map(([t]) => `<stop offset="${t * 100}%" stop-color="${colourFor(t * max, max)}"/>`).join('');
  const ticks = [];
  const step = max <= 2 ? 0.5 : 1;
  for (let v = 0; v <= max + 1e-9; v += step) {
    const x = x0 + (v / max) * w;
    ticks.push(`<line x1="${x}" x2="${x}" y1="22" y2="26" class="lg-tick"/><text x="${x}" y="37" class="lg-text">${+v.toFixed(1)}</text>`);
  }
  let cut = '';
  if (Number.isFinite(cutoff) && cutoff <= max) {
    const x = x0 + (cutoff / max) * w;
    cut = `<line x1="${x}" x2="${x}" y1="4" y2="24" class="lg-cut"/><text x="${x}" y="50" class="lg-text lg-cuttext">${esc(cutoffLabel)} ${cutoff}</text>`;
  }
  return `<svg class="legend" viewBox="0 0 ${W} 56" role="img" aria-label="Colour legend 0 to ${max} ${esc(unit)}">
  <defs><linearGradient id="${id}">${stops}</linearGradient></defs>
  <rect x="${x0}" y="8" width="${w}" height="14" fill="url(#${id})" class="lg-bar"/>
  ${ticks.join('')}${cut}
  <text x="${W - 10}" y="50" class="lg-text lg-unit">${esc(unit)}</text>
</svg>`;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(2) : '–';
}
