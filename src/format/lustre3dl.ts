/**
 * Autodesk Lustre / Flame `.3dl` export.
 *
 * The ordering trap: `.cube` stores samples with RED varying fastest, `.3dl`
 * with BLUE varying fastest. Getting this backwards produces a file that loads
 * without complaint and grades completely wrong, so it is tested explicitly.
 */

import { type Lut, getSample, index3D } from '../core/lut.js';

export interface Lustre3dlOptions {
  /** Output bit depth. Lustre commonly uses 12-bit; Flame accepts 10 or 16. */
  bitDepth?: 10 | 12 | 16;
}

export function write3dl(lut: Lut, options: Lustre3dlOptions = {}): string {
  if (lut.dims !== 3) {
    throw new Error('.3dl export needs a 3D LUT; convert the 1D LUT first.');
  }

  const bitDepth = options.bitDepth ?? 12;
  const maxOut = (1 << bitDepth) - 1;
  const n = lut.size;
  const lines: string[] = [];

  if (lut.meta.title) lines.push(`# ${lut.meta.title}`);
  if (lut.meta.author) lines.push(`# Author: ${lut.meta.author}`);
  if (lut.meta.inputCS) lines.push(`# InputColorSpace: ${lut.meta.inputCS}`);
  if (lut.meta.outputCS) lines.push(`# OutputColorSpace: ${lut.meta.outputCS}`);
  if (lines.length) lines.push('');

  // Input mesh, expressed on a 10-bit scale as Lustre expects.
  const mesh: number[] = [];
  for (let i = 0; i < n; i++) mesh.push(Math.round((i / (n - 1)) * 1023));
  lines.push(mesh.join(' '));

  // Blue fastest.
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        const [sr, sg, sb] = getSample(lut, index3D(n, r, g, b));
        lines.push(
          [sr, sg, sb]
            .map((v) => Math.max(0, Math.min(maxOut, Math.round(v * maxOut))))
            .join(' '),
        );
      }
    }
  }

  return lines.join(lut.lineEnding) + lut.lineEnding;
}
