/**
 * Synthetic fixtures. We generate rather than commit vendor LUTs so the repo
 * carries no third-party licensing questions.
 */

export function identityRows(size: number): string[] {
  const rows: string[] = [];
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        rows.push(
          `${(r * step).toFixed(6)} ${(g * step).toFixed(6)} ${(b * step).toFixed(6)}`,
        );
  return rows;
}

export function cube3d(size = 3, header: string[] = []): string {
  return [...header, `LUT_3D_SIZE ${size}`, '', ...identityRows(size)].join('\n') + '\n';
}

export function cube1d(size = 4, header: string[] = []): string {
  const rows: string[] = [];
  for (let i = 0; i < size; i++) {
    const v = (i / (size - 1)).toFixed(6);
    rows.push(`${v} ${v} ${v}`);
  }
  return [...header, `LUT_1D_SIZE ${size}`, '', ...rows].join('\n') + '\n';
}
