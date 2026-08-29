/**
 * Renders a LUT applied to a reference chart into a PNG data URL, off screen.
 * Used by the look sheet, which needs one thumbnail per LUT without touching
 * the visible preview.
 */

import { type Lut } from '../core/lut.js';
import { PreviewRenderer } from './preview.js';
import { type ChartId, renderChart } from './charts.js';
import { ENCODINGS, type EncodingId } from './transfer.js';

let canvas: HTMLCanvasElement | null = null;
let renderer: PreviewRenderer | null = null;

function ensure(w: number, h: number): PreviewRenderer | null {
  if (!canvas) {
    canvas = document.createElement('canvas');
    // Kept out of the layout but still rendered by the GPU.
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    document.body.append(canvas);
  }
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  if (!renderer) {
    try {
      renderer = new PreviewRenderer(canvas);
    } catch {
      return null;
    }
  }
  return renderer;
}

export interface ThumbnailSource {
  /** Scene-linear RGB at exactly w * h, or a chart id to generate one. */
  linear?: Float32Array;
  chart?: ChartId;
}

export function renderThumbnail(
  lut: Lut,
  source: ThumbnailSource,
  encoding: EncodingId,
  w = 480,
  h = 270,
): string | null {
  const r = ensure(w, h);
  if (!r) return null;

  const linear = source.linear ?? renderChart(source.chart ?? 'checker', w, h);
  const encode = ENCODINGS[encoding].fromLinear;
  const encoded = new Float32Array(linear.length);
  for (let i = 0; i < linear.length; i++) encoded[i] = encode(linear[i]);

  r.imageRect = [0, 0, 1, 1];
  r.showSplit = false;
  r.setSource(encoded, w, h);
  r.setLut(lut);
  r.draw();

  return canvas!.toDataURL('image/png');
}
