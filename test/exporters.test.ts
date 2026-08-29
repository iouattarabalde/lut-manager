import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { createIdentity } from '../src/core/lut.js';
import { write3dl } from '../src/format/lustre3dl.js';
import { writeCsp } from '../src/format/csp.js';
import { writeClf } from '../src/format/clf.js';

/**
 * An identity LUT makes ordering verifiable: the sample at grid (r,g,b) is
 * exactly (r,g,b)/(N-1), so reading a row tells you which grid point the
 * writer thought it was emitting.
 */
const N = 5;
const identity = () => {
  const lut = createIdentity(N);
  lut.meta.title = 'Ordering Probe';
  lut.meta.author = 'Ismael';
  lut.meta.inputCS = 'ARRI LogC3 / AWG3';
  lut.meta.outputCS = 'Rec.709 Gamma 2.4';
  return lut;
};

const dataRows = (text: string, pred: (l: string) => boolean) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && pred(l));

describe('.3dl (Lustre)', () => {
  const text = write3dl(identity(), { bitDepth: 12 });
  const rows = dataRows(text, (l) => /^\d+ \d+ \d+$/.test(l));

  it('emits the input mesh on a 10-bit scale', () => {
    // The mesh is the first non-comment line of N integers.
    const mesh = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => !l.startsWith('#') && /^\d+( \d+)*$/.test(l) && l.split(' ').length === N)!;
    expect(mesh.split(' ').map(Number)).toEqual([0, 256, 512, 767, 1023]);
  });

  it('writes N^3 rows', () => {
    expect(rows).toHaveLength(N * N * N);
  });

  // The ordering trap: .3dl is blue-fastest, unlike .cube.
  it('orders samples with blue varying fastest', () => {
    const max = 4095;
    for (let k = 0; k < rows.length; k++) {
      const r = Math.floor(k / (N * N));
      const g = Math.floor(k / N) % N;
      const b = k % N;
      const expected = [r, g, b].map((i) => Math.round((i / (N - 1)) * max));
      expect(rows[k].split(/\s+/).map(Number), `row ${k}`).toEqual(expected);
    }
  });

  it('honours the requested bit depth', () => {
    const ten = write3dl(identity(), { bitDepth: 10 });
    const last = dataRows(ten, (l) => /^\d+ \d+ \d+$/.test(l)).at(-1)!;
    expect(last.split(/\s+/).map(Number)).toEqual([1023, 1023, 1023]);
  });

  it('refuses a 1D LUT with a clear message', () => {
    expect(() => write3dl(createIdentity(64, 1))).toThrow(/1D/);
  });
});

describe('.csp (Cineon Space)', () => {
  const text = writeCsp(identity());
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rows = lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l) && l.includes('.'));

  it('starts with the format signature', () => {
    expect(lines[0]).toBe('CSPLUTV100');
    expect(lines[1]).toBe('3D');
  });

  it('declares the cube dimensions', () => {
    expect(lines).toContain(`${N} ${N} ${N}`);
  });

  // .csp is red-fastest, like .cube and unlike .3dl.
  it('orders samples with red varying fastest', () => {
    const data = rows.slice(-(N * N * N));
    expect(data).toHaveLength(N * N * N);
    for (let k = 0; k < data.length; k++) {
      const b = Math.floor(k / (N * N));
      const g = Math.floor(k / N) % N;
      const r = k % N;
      const got = data[k].split(/\s+/).map(Number);
      const expected = [r, g, b].map((i) => i / (N - 1));
      for (let c = 0; c < 3; c++) expect(got[c], `row ${k} ch ${c}`).toBeCloseTo(expected[c], 5);
    }
  });

  it('refuses a 1D LUT', () => {
    expect(() => writeCsp(createIdentity(64, 1))).toThrow(/1D/);
  });
});

describe('.clf (ACES Common LUT Format)', () => {
  const text = writeClf(identity());

  const parse = (xml: string) => {
    const errors: string[] = [];
    const doc = new DOMParser({
      onError: (_level, msg) => errors.push(String(msg)),
    }).parseFromString(xml, 'application/xml');
    return { doc, errors };
  };

  it('is well-formed XML with the expected elements', () => {
    const { doc, errors } = parse(text);
    expect(errors).toEqual([]);
    expect(doc.documentElement!.tagName).toBe('ProcessList');
    expect(doc.documentElement!.getAttribute('compCLFversion')).toBe('3.0');
    const lut3d = doc.getElementsByTagName('LUT3D')[0];
    expect(lut3d).toBeTruthy();
    expect(lut3d.getAttribute('interpolation')).toBe('tetrahedral');
    expect(doc.getElementsByTagName('Array')[0].getAttribute('dim')).toBe(`${N} ${N} ${N} 3`);
  });

  // CLF indexes [r][g][b], so blue varies fastest.
  it('orders samples with blue varying fastest', () => {
    const { doc } = parse(text);
    const nums = doc.getElementsByTagName('Array')[0].textContent!.trim().split(/\s+/).map(Number);
    expect(nums).toHaveLength(N * N * N * 3);
    for (let k = 0; k < N * N * N; k++) {
      const r = Math.floor(k / (N * N));
      const g = Math.floor(k / N) % N;
      const b = k % N;
      const expected = [r, g, b].map((i) => i / (N - 1));
      for (let c = 0; c < 3; c++) {
        expect(nums[k * 3 + c], `sample ${k} ch ${c}`).toBeCloseTo(expected[c], 5);
      }
    }
  });

  it('escapes metadata rather than breaking the XML', () => {
    const lut = identity();
    lut.meta.title = 'Look <v2> & "final"';
    lut.meta.notes = 'a & b';
    const { doc, errors } = parse(writeClf(lut));
    expect(errors).toEqual([]);
    expect(doc.documentElement!.getAttribute('name')).toBe('Look <v2> & "final"');
  });

  it('refuses a 1D LUT', () => {
    expect(() => writeClf(createIdentity(64, 1))).toThrow(/1D/);
  });
});
