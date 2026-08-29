import { describe, expect, it } from 'vitest';
import { parseCube, writeCube, sanitizeTitle } from '../src/format/cube.js';
import { createIdentity, invalidateRawData, neutralAxis } from '../src/core/lut.js';
import { cube1d, cube3d, identityRows } from './fixtures.js';

describe('round-trip fidelity', () => {
  it('preserves the data table byte-for-byte on a header-only edit', () => {
    const src = cube3d(5, ['TITLE "Original"']);
    const { lut } = parseCube(src);
    lut.meta.title = 'Renamed';
    const out = writeCube(lut);

    const srcRows = src.trim().split('\n').filter((l) => /^[\d.]/.test(l));
    const outRows = out.trim().split('\n').filter((l) => /^[\d.]/.test(l));
    expect(outRows).toEqual(srcRows);
  });

  // Defect 1: the old writer kept only LUT_3D_SIZE / DOMAIN_*, silently
  // dropping every other keyword.
  it('keeps unrecognised keywords instead of dropping them', () => {
    const src = cube3d(3, ['TITLE "X"', 'LUT_3D_INPUT_RANGE 0.0 1.0', 'WEIRD_KEYWORD 42']);
    const out = writeCube(parseCube(src).lut);
    expect(out).toContain('WEIRD_KEYWORD 42');
  });

  it('survives a 1D LUT, which previously came out with no size line at all', () => {
    const { lut, issues } = parseCube(cube1d(4, ['TITLE "Shaper"']));
    expect(lut.dims).toBe(1);
    expect(lut.size).toBe(4);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);

    const out = writeCube(lut);
    expect(out).toContain('LUT_1D_SIZE 4');
    expect(out).not.toContain('LUT_3D_SIZE');

    // And it must re-parse to the same thing.
    const again = parseCube(out).lut;
    expect(again.dims).toBe(1);
    expect(again.size).toBe(4);
  });

  it('round-trips CRLF files without producing mixed line endings', () => {
    const src = cube3d(3, ['TITLE "CRLF"']).replace(/\n/g, '\r\n');
    const out = writeCube(parseCube(src).lut);
    expect(out.includes('\r\n')).toBe(true);
    // No bare LF anywhere: every \n must be preceded by \r.
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('maps the legacy LUT_3D_INPUT_RANGE onto the domain', () => {
    const { lut } = parseCube(cube3d(3, ['LUT_3D_INPUT_RANGE 0.0 4.0']));
    expect(lut.domainMax).toEqual([4, 4, 4]);
  });
});

describe('header writing', () => {
  // Defect 2: a newline in Notes emitted a bare, uncommented line, which the
  // parser then read back as LUT data.
  it('comments every line of a multi-line Notes value', () => {
    const { lut } = parseCube(cube3d(3));
    lut.meta.notes = 'first line\n0.5 0.5 0.5\nthird line';
    const out = writeCube(lut);

    const headerLines = out.split('\n').slice(0, out.split('\n').indexOf('LUT_3D_SIZE 3'));
    for (const line of headerLines) {
      if (line.trim()) expect(line.startsWith('#') || line.startsWith('TITLE')).toBe(true);
    }
    // The data table must still be exactly 27 rows, not 28.
    const reparsed = parseCube(out);
    expect(reparsed.lut.size).toBe(3);
    expect(reparsed.issues.filter((i) => i.code === 'size-mismatch')).toEqual([]);
    expect(reparsed.lut.meta.notes.split('\n')).toHaveLength(3);
  });

  // Defect 3
  it('sanitises quotes and newlines out of TITLE', () => {
    expect(sanitizeTitle('Foo "Bar"')).toBe("Foo 'Bar'");
    expect(sanitizeTitle('a\nb')).toBe('a b');
    expect(sanitizeTitle('x'.repeat(500))).toHaveLength(240);

    const { lut } = parseCube(cube3d(3));
    lut.meta.title = 'Show "Look" v2';
    const reparsed = parseCube(writeCube(lut)).lut;
    expect(reparsed.meta.title).toBe("Show 'Look' v2");
  });

  it('preserves metadata across a round-trip', () => {
    const { lut } = parseCube(cube3d(3));
    Object.assign(lut.meta, {
      title: 'Test',
      author: 'Ismael',
      project: 'Feature',
      inputCS: 'ARRI LogC3 / AWG3',
      outputCS: 'Rec.709 Gamma 2.4',
      expShift: '+1',
    });
    const back = parseCube(writeCube(lut)).lut;
    expect(back.meta.author).toBe('Ismael');
    expect(back.meta.inputCS).toBe('ARRI LogC3 / AWG3');
    expect(back.meta.expShift).toBe('+1');
  });
});

describe('validation', () => {
  // Defect 5: a truncated table used to pass through silently.
  it('flags a row count that disagrees with the declared size', () => {
    const rows = identityRows(3).slice(0, 20);
    const src = ['LUT_3D_SIZE 3', '', ...rows].join('\n');
    const { issues } = parseCube(src);
    const mismatch = issues.find((i) => i.code === 'size-mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('27 rows');
  });

  it('flags a missing size keyword but still recovers the cube', () => {
    const src = identityRows(3).join('\n');
    const { lut, issues } = parseCube(src);
    expect(issues.some((i) => i.code === 'missing-size')).toBe(true);
    expect(lut.dims).toBe(3);
    expect(lut.size).toBe(3);
  });

  it('refuses to hand back rawData when the table is incomplete', () => {
    const src = ['LUT_3D_SIZE 3', '', ...identityRows(3).slice(0, 20)].join('\n');
    expect(parseCube(src).lut.rawData).toBeNull();
  });
});

describe('core model', () => {
  it('reads the neutral axis of an identity LUT as a straight ramp', () => {
    const axis = neutralAxis(createIdentity(9));
    for (const { t, rgb } of axis) {
      expect(rgb[0]).toBeCloseTo(t, 5);
      expect(rgb[1]).toBeCloseTo(t, 5);
      expect(rgb[2]).toBeCloseTo(t, 5);
    }
  });

  it('orders 3D samples with red varying fastest, matching the .cube spec', () => {
    const { lut } = parseCube(cube3d(3));
    // Second row is r=1 step, g=b=0.
    expect(Array.from(lut.data.slice(3, 6))).toEqual([0.5, 0, 0]);
  });

  it('re-serialises from data once rawData is invalidated', () => {
    const { lut } = parseCube(cube3d(3));
    lut.data[0] = 0.25;
    invalidateRawData(lut);
    const out = writeCube(lut);
    expect(out).toContain('0.250000 0.000000 0.000000');
  });
});
