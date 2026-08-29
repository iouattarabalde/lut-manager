/**
 * ACES Common LUT Format (`.clf`) export.
 *
 * The Array is declared `dim="R G B 3"` and its values are indexed [r][g][b],
 * so BLUE varies fastest — the same ordering as `.3dl`, not `.cube`.
 */

import { type Lut, getSample, index3D } from '../core/lut.js';

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Stable-ish id derived from the title, since CLF wants one per element. */
function idFor(lut: Lut, fallback: string): string {
  const base = (lut.meta.title || fallback).replace(/[^A-Za-z0-9_-]+/g, '_');
  return base.replace(/^_+|_+$/g, '') || fallback;
}

export function writeClf(lut: Lut): string {
  if (lut.dims !== 3) {
    throw new Error('.clf export needs a 3D LUT; convert the 1D LUT first.');
  }

  const n = lut.size;
  const id = idFor(lut, 'lut3d');
  const rows: string[] = [];

  // Blue fastest.
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        const s = getSample(lut, index3D(n, r, g, b));
        rows.push(`        ${s.map((v) => v.toFixed(6)).join(' ')}`);
      }
    }
  }

  const description: string[] = [];
  if (lut.meta.notes) description.push(lut.meta.notes.replace(/\r?\n/g, ' '));
  if (lut.meta.inputCS) description.push(`Input: ${lut.meta.inputCS}`);
  if (lut.meta.outputCS) description.push(`Output: ${lut.meta.outputCS}`);

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ProcessList id="${esc(id)}" name="${esc(lut.meta.title || id)}" compCLFversion="3.0">`,
    ...(description.length
      ? [`  <Description>${esc(description.join(' — '))}</Description>`]
      : []),
    ...(lut.meta.author ? [`  <InputDescriptor>${esc(lut.meta.author)}</InputDescriptor>`] : []),
    `  <LUT3D id="${esc(id)}_lut" inBitDepth="32f" outBitDepth="32f" interpolation="tetrahedral">`,
    `    <Array dim="${n} ${n} ${n} 3">`,
    ...rows,
    '    </Array>',
    '  </LUT3D>',
    '</ProcessList>',
  ];

  return out.join(lut.lineEnding) + lut.lineEnding;
}
