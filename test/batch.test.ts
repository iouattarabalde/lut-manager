import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, makeEntry, outputPath, renderBatch, resolveFields, worstLevel, type BatchEntry, type BatchSettings, type SharedFields } from '../src/batch/batch.js';
import { DEFAULT_TEMPLATE } from '../src/core/naming.js';
import { parseCube } from '../src/format/cube.js';
import { cube3d, identityRows } from './fixtures.js';

const shared: SharedFields = {
  author: 'Ismael Ouattara',
  date: '2026-08-28',
  project: 'Nike Canada',
  notes: '',
  expShift: '+1',
  inputCS: 'ARRI LogC4 / AWG4',
  outputCS: 'Rec.709 Gamma 2.4',
};

const settings: BatchSettings = {
  template: DEFAULT_TEMPLATE,
  lookKind: 'Creative',
  useFolders: true,
};

const fileOf = (name: string, text: string) => new File([text], name, { type: 'text/plain' });

describe('batch entries', () => {
  it('takes the look name from TITLE, falling back to the filename', async () => {
    const withTitle = await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"'])));
    expect(withTitle.look).toBe('Warm');
    const noTitle = await makeEntry(fileOf('CoolTeal.cube', cube3d(3)));
    expect(noTitle.look).toBe('CoolTeal');
  });

  it('surfaces the worst level across parse issues and checks', async () => {
    const broken = ['LUT_3D_SIZE 3', '', ...identityRows(3).slice(0, 10)].join('\n');
    expect(worstLevel(await makeEntry(fileOf('bad.cube', broken)))).toBe('error');
    // A clean identity still warns (it does nothing).
    expect(worstLevel(await makeEntry(fileOf('id.cube', cube3d(17))))).toBe('warning');
  });
});

describe('output naming', () => {
  it('builds the house filename and ColorLibrary path', async () => {
    const e = await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"'])));
    expect(outputPath(e, shared, settings, 0)).toBe(
      'LUTs/LogToDisplay/ArriLogC4_to_Rec709/Creative/Warm_ArriLogC4_Rec709_+E1stop.cube',
    );
  });

  it('can emit a flat list instead', async () => {
    const e = await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"'])));
    expect(outputPath(e, shared, { ...settings, useFolders: false }, 0)).toBe(
      'Warm_ArriLogC4_Rec709_+E1stop.cube',
    );
  });

  it('drops the exposure element when there is no shift', async () => {
    const e = await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"'])));
    expect(outputPath(e, { ...shared, expShift: '0' }, { ...settings, useFolders: false }, 0)).toBe(
      'Warm_ArriLogC4_Rec709.cube',
    );
  });
});

describe('render', () => {
  it('stamps shared fields onto every file', async () => {
    const entries: BatchEntry[] = [
      await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"']))),
      await makeEntry(fileOf('b.cube', cube3d(3, ['TITLE "Cool"']))),
    ];
    const files = renderBatch(entries, shared, settings);
    expect(files.size).toBe(2);
    for (const text of files.values()) {
      expect(text).toContain('# Author: Ismael Ouattara');
      expect(text).toContain('# Project: Nike Canada');
      expect(text).toContain('# InputColorSpace: ARRI LogC4 / AWG4');
    }
    const warm = files.get('LUTs/LogToDisplay/ArriLogC4_to_Rec709/Creative/Warm_ArriLogC4_Rec709_+E1stop.cube');
    expect(warm).toBeDefined();
    expect(warm).toContain('TITLE "Warm"');
  });

  it('preserves each file\'s data table', async () => {
    const src = cube3d(5, ['TITLE "Warm"']);
    const entries = [await makeEntry(fileOf('a.cube', src))];
    const [text] = [...renderBatch(entries, shared, settings).values()];
    const rows = (s: string) => s.split('\n').filter((l) => /^[\d.]/.test(l));
    expect(rows(text)).toEqual(rows(src));
  });

  it('skips excluded entries', async () => {
    const entries = [
      await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"']))),
      await makeEntry(fileOf('b.cube', cube3d(3, ['TITLE "Cool"']))),
    ];
    entries[1].included = false;
    expect(renderBatch(entries, shared, settings).size).toBe(1);
  });

  it('never overwrites a duplicate path', async () => {
    const entries = [
      await makeEntry(fileOf('a.cube', cube3d(3, ['TITLE "Warm"']))),
      await makeEntry(fileOf('b.cube', cube3d(3, ['TITLE "Warm"']))),
    ];
    const files = renderBatch(entries, shared, settings);
    expect(files.size).toBe(2);
    expect([...files.keys()].some((k) => k.endsWith('_02.cube'))).toBe(true);
  });
});

describe('per-file fields', () => {
  it('keeps each file its own value for fields that are not shared', async () => {
    const entries: BatchEntry[] = [
      await makeEntry(fileOf('Warm_+E0_25stop.cube', cube3d(3, ['TITLE "Warm"']))),
      await makeEntry(fileOf('Warm_-E0_5stop.cube', cube3d(3, ['TITLE "Warm"']))),
    ];
    expect(entries[0].own.expShift).toBe('+0.25');
    expect(entries[1].own.expShift).toBe('-0.5');

    const keys = new Set(FIELD_KEYS.filter((k) => k !== 'expShift'));
    const files = [...renderBatch(entries, shared, { ...settings, useFolders: false }, keys).keys()];
    expect(files).toEqual([
      'Warm_ArriLogC4_Rec709_+E0_25stop.cube',
      'Warm_ArriLogC4_Rec709_-E0_5stop.cube',
    ]);
    expect(resolveFields(entries[0], shared, keys).author).toBe('Ismael Ouattara');
  });
});
