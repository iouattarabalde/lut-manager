/**
 * Rising Sun Research `.csp` (Cineon Space) export.
 *
 * Samples are ordered with RED varying fastest, as in `.cube`. The three
 * shaper ("pre-LUT") blocks are written as pass-through ramps, since the
 * canonical model carries its range in DOMAIN_MIN/MAX rather than a shaper.
 */

import { type Lut, getSample, index3D } from '../core/lut.js';

export function writeCsp(lut: Lut): string {
  if (lut.dims !== 3) {
    throw new Error('.csp export needs a 3D LUT; convert the 1D LUT first.');
  }

  const n = lut.size;
  const lines: string[] = ['CSPLUTV100', '3D', ''];

  // One pass-through shaper per channel, carrying the domain.
  for (let c = 0; c < 3; c++) {
    lines.push('2');
    lines.push(`${lut.domainMin[c]} ${lut.domainMax[c]}`);
    lines.push('0.0 1.0');
  }
  lines.push('');
  lines.push(`${n} ${n} ${n}`);

  // Red fastest.
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const s = getSample(lut, index3D(n, r, g, b));
        lines.push(s.map((v) => v.toFixed(6)).join(' '));
      }
    }
  }

  return lines.join(lut.lineEnding) + lut.lineEnding;
}
