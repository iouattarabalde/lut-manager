/**
 * Canonical in-memory LUT model.
 *
 * Every format reader produces one of these and every writer consumes one, so
 * operations (resample, concat, analyse) are written once against this shape
 * rather than once per file format.
 */

export type Dims = 1 | 3;
export type RGB = [number, number, number];

/** Header fields the editor manages. Everything else rides in `passthrough`. */
export interface LutMeta {
  title: string;
  author: string;
  date: string;
  project: string;
  notes: string;
  /** Annotation only — never applied to `data`. See docs/exposure-shift.md. */
  expShift: string;
  inputCS: string;
  outputCS: string;
}

export interface Lut {
  dims: Dims;
  /** Samples per axis. 3D LUTs hold size**3 samples, 1D LUTs hold size. */
  size: number;
  /** RGB interleaved, length === sampleCount(lut) * 3. */
  data: Float32Array;
  domainMin: RGB;
  domainMax: RGB;
  meta: LutMeta;
  /**
   * Header lines we did not recognise, kept verbatim and re-emitted on write.
   * This is what stops the writer from silently dropping keywords it has never
   * heard of (e.g. LUT_3D_INPUT_RANGE) and corrupting the file.
   */
  passthrough: string[];
  /**
   * The original data rows, verbatim.
   *
   * The tool's core promise is that a header-only edit leaves the data table
   * byte-for-byte identical, which reformatting parsed floats would break. So
   * we keep both: `data` for viz/analysis/operations, `rawData` for writing.
   * Any operation that changes samples must call `invalidateRawData`, after
   * which the writer re-serialises from `data` instead.
   */
  rawData: string[] | null;
  lineEnding: '\n' | '\r\n';
}

/** Call after mutating `data` so the writer stops emitting the stale raw rows. */
export function invalidateRawData(lut: Lut): void {
  lut.rawData = null;
}

export function emptyMeta(): LutMeta {
  return {
    title: '',
    author: '',
    date: '',
    project: '',
    notes: '',
    expShift: '',
    inputCS: '',
    outputCS: '',
  };
}

/** Number of RGB triplets a LUT of these dimensions holds. */
export function sampleCount(dims: Dims, size: number): number {
  return dims === 1 ? size : size * size * size;
}

export function lutSampleCount(lut: Pick<Lut, 'dims' | 'size'>): number {
  return sampleCount(lut.dims, lut.size);
}

/**
 * Flat sample index for a 3D grid coordinate.
 *
 * `.cube` orders samples with RED varying fastest, then green, then blue —
 * so the neutral axis (r === g === b === i) lands at i*size^2 + i*size + i.
 */
export function index3D(size: number, r: number, g: number, b: number): number {
  return b * size * size + g * size + r;
}

export function getSample(lut: Lut, i: number): RGB {
  const o = i * 3;
  return [lut.data[o], lut.data[o + 1], lut.data[o + 2]];
}

export function setSample(lut: Lut, i: number, rgb: RGB): void {
  const o = i * 3;
  lut.data[o] = rgb[0];
  lut.data[o + 1] = rgb[1];
  lut.data[o + 2] = rgb[2];
}

/** The neutral (grey) axis of a LUT: input t in 0..1 against its RGB output. */
export function neutralAxis(lut: Lut): { t: number; rgb: RGB }[] {
  const out: { t: number; rgb: RGB }[] = [];
  const n = lut.size;
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const idx = lut.dims === 1 ? i : index3D(n, i, i, i);
    out.push({ t: i / (n - 1), rgb: getSample(lut, idx) });
  }
  return out;
}

export function createIdentity(size: number, dims: Dims = 3): Lut {
  const count = sampleCount(dims, size);
  const data = new Float32Array(count * 3);
  const step = size > 1 ? 1 / (size - 1) : 0;

  if (dims === 1) {
    for (let i = 0; i < size; i++) {
      const v = i * step;
      data[i * 3] = v;
      data[i * 3 + 1] = v;
      data[i * 3 + 2] = v;
    }
  } else {
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const o = index3D(size, r, g, b) * 3;
          data[o] = r * step;
          data[o + 1] = g * step;
          data[o + 2] = b * step;
        }
      }
    }
  }

  return {
    dims,
    size,
    data,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    meta: emptyMeta(),
    passthrough: [],
    rawData: null,
    lineEnding: '\n',
  };
}

export function cloneLut(lut: Lut): Lut {
  return {
    ...lut,
    data: new Float32Array(lut.data),
    domainMin: [...lut.domainMin] as RGB,
    domainMax: [...lut.domainMax] as RGB,
    meta: { ...lut.meta },
    passthrough: [...lut.passthrough],
    rawData: lut.rawData ? [...lut.rawData] : null,
  };
}
