/**
 * Small visualisations for the Analysis panel.
 *
 * A column of numbers doesn't tell a colorist what a LUT does. These answer
 * the same questions by showing them: what happens to a grey ramp, where the
 * curve sits against identity, how much is clipped, and which way the LUT
 * pushes colour through the range.
 */

import { type Lut, type RGB } from '../core/lut.js';
import { sampleLut } from '../core/sample.js';

const SVG = 'http://www.w3.org/2000/svg';

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const to8 = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
const css = (rgb: RGB): string => `rgb(${to8(rgb[0])},${to8(rgb[1])},${to8(rgb[2])})`;

function svgRoot(w: number, h: number): SVGSVGElement {
  const svg = el('svg', {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: 'none',
    width: '100%',
    height: h,
  });
  svg.style.display = 'block';
  return svg;
}

/**
 * The LUT applied to a grey ramp, above the ramp it started from.
 * Contrast, crush, blown highlights and colour cast are all visible at once.
 */
export function rampStrip(lut: Lut, steps = 32): SVGSVGElement {
  const w = steps;
  const h = 10;
  const svg = svgRoot(w, h);
  svg.append(el('rect', {
    x: 0, y: 0, width: w, height: h, fill: 'currentColor', opacity: 0.15,
  }));

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    svg.append(el('rect', { x: i, y: 0, width: 1.02, height: 4.6, fill: css([t, t, t]) }));
    const out = sampleLut(lut, [t, t, t]);
    svg.append(el('rect', { x: i, y: 5.4, width: 1.02, height: 4.6, fill: css(out) }));
  }
  return svg;
}

/**
 * Neutral response against the identity diagonal, with the RGB channels
 * behind it. The gap between the curve and the diagonal is the LUT's contrast.
 */
export function toneCurve(lut: Lut, samples = 64): SVGSVGElement {
  const size = 100;
  const svg = svgRoot(size, size);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  svg.append(
    el('line', {
      x1: 0, y1: size, x2: size, y2: 0,
      stroke: 'currentColor', 'stroke-width': 1,
      'stroke-dasharray': '3 3', opacity: 0.25,
    }),
  );

  const pts: RGB[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    pts.push(sampleLut(lut, [t, t, t]));
  }

  const path = (channel: (rgb: RGB) => number): string =>
    pts
      .map((rgb, i) => {
        const x = (i / (samples - 1)) * size;
        const y = size - Math.max(0, Math.min(1, channel(rgb))) * size;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

  const channels: [(rgb: RGB) => number, string][] = [
    [(c) => c[0], 'rgba(220,80,60,0.75)'],
    [(c) => c[1], 'rgba(80,190,100,0.75)'],
    [(c) => c[2], 'rgba(90,150,230,0.75)'],
  ];
  for (const [fn, stroke] of channels) {
    svg.append(el('path', { d: path(fn), fill: 'none', stroke, 'stroke-width': 1.4 }));
  }
  svg.append(
    el('path', {
      d: path((c) => (c[0] + c[1] + c[2]) / 3),
      fill: 'none', stroke: 'currentColor', 'stroke-width': 2, opacity: 0.9,
    }),
  );
  return svg;
}

/** A meter for a 0-1 fraction, amber past its threshold. */
export function meter(fraction: number, threshold = 0.02): SVGSVGElement {
  const w = 100;
  const h = 6;
  const svg = svgRoot(w, h);
  svg.append(el('rect', { x: 0, y: 0, width: w, height: h, rx: 3, fill: 'currentColor', opacity: 0.12 }));
  const filled = Math.max(fraction > 0 ? 1.5 : 0, Math.min(1, fraction) * w);
  svg.append(
    el('rect', {
      x: 0, y: 0, width: filled, height: h, rx: 3,
      fill: fraction > threshold ? '#c8951a' : 'currentColor',
      opacity: fraction > threshold ? 1 : 0.55,
    }),
  );
  return svg;
}

/**
 * How far the LUT pushes each channel away from neutral across the range —
 * the colour cast, split into shadows, midtones and highlights.
 */
export function castBars(lut: Lut): SVGSVGElement {
  const w = 100;
  const h = 34;
  const svg = svgRoot(w, h);
  const zones: [string, number][] = [['SH', 0.2], ['MID', 0.5], ['HI', 0.8]];
  const colors = ['rgba(220,80,60,0.9)', 'rgba(80,190,100,0.9)', 'rgba(90,150,230,0.9)'];

  // Centre line: no cast.
  svg.append(el('line', { x1: w / 2, y1: 0, x2: w / 2, y2: h, stroke: 'currentColor', 'stroke-width': 0.6, opacity: 0.25 }));

  zones.forEach(([, t], zi) => {
    const out = sampleLut(lut, [t, t, t]);
    const mean = (out[0] + out[1] + out[2]) / 3;
    for (let c = 0; c < 3; c++) {
      // Scaled so a 0.05 deviation reaches the edge — casts are small numbers.
      const dev = Math.max(-1, Math.min(1, (out[c] - mean) / 0.05));
      const y = zi * 11.5 + c * 3 + 1;
      const len = (Math.abs(dev) * w) / 2;
      svg.append(
        el('rect', {
          x: dev >= 0 ? w / 2 : w / 2 - len,
          y, width: Math.max(len, 0.6), height: 2, rx: 1, fill: colors[c],
        }),
      );
    }
  });
  return svg;
}

/** Big swatch pair for a mapped point, e.g. black in -> black out. */
export function swatchPair(input: RGB, output: RGB): SVGSVGElement {
  const svg = svgRoot(100, 26);
  // Outlined, or a black swatch vanishes into a dark card and a white one
  // into a light card.
  const box = (x: number, rgb: RGB) =>
    el('rect', {
      x, y: 0.5, width: 46, height: 25, rx: 3, fill: css(rgb),
      stroke: 'currentColor', 'stroke-width': 1, 'stroke-opacity': 0.25,
    });
  svg.append(box(0, input));
  svg.append(box(54, output));
  svg.append(
    el('path', {
      d: 'M47.5 13 L52.5 13 M50.5 10.5 L53 13 L50.5 15.5',
      stroke: 'currentColor', 'stroke-width': 1, fill: 'none', opacity: 0.5,
    }),
  );
  return svg;
}
