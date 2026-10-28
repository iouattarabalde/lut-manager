import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  classifySpace,
  csToken,
  DEFAULT_TEMPLATE,
  exposureSuffix,
  exposureToken,
  normalizeStops,
  stopsFromName,
  libraryFolder,
  pascalCase,
} from '../src/core/naming.js';

describe('exposure token', () => {
  /**
   * Every row of the Exposure Compensation table in the
   * resolve-naming-conventions skill. If the skill changes, this fails.
   */
  const SKILL_TABLE: [string, string, string][] = [
    ['0',     '',           'Warm_ArriLogC4_Rec709'],
    ['+0.33', '+E0_33stop', 'Warm_ArriLogC4_Rec709_+E0_33stop'],
    ['+0.5',  '+E0_5stop',  'Warm_ArriLogC4_Rec709_+E0_5stop'],
    ['+0.67', '+E0_67stop', 'Warm_ArriLogC4_Rec709_+E0_67stop'],
    ['+1',    '+E1stop',    'Warm_ArriLogC4_Rec709_+E1stop'],
    ['+1.33', '+E1_33stop', 'Warm_ArriLogC4_Rec709_+E1_33stop'],
    ['+1.5',  '+E1_5stop',  'Warm_ArriLogC4_Rec709_+E1_5stop'],
    ['-0.67', '-E0_67stop', 'Warm_ArriLogC4_Rec709_-E0_67stop'],
    ['-2.67', '-E2_67stop', 'Warm_ArriLogC4_Rec709_-E2_67stop'],
  ];

  for (const [shift, token, filename] of SKILL_TABLE) {
    it(`${shift} renders as ${token || '(omitted)'}`, () => {
      expect(exposureToken(shift)).toBe(token);
      expect(
        applyTemplate(DEFAULT_TEMPLATE, {
          look: 'Warm',
          source: 'ArriLogC4',
          dest: 'Rec709',
          exp: token,
        }),
      ).toBe(filename);
    });
  }

  it('omits the token for a missing or unparseable value', () => {
    expect(exposureToken('')).toBe('');
    expect(exposureToken('nonsense')).toBe('');
    expect(exposureSuffix('0')).toBe('');
    expect(exposureSuffix('+1')).toBe('_+E1stop');
  });
});

describe('color space tokens', () => {
  it('maps UI labels onto ColorLibrary folder names', () => {
    expect(csToken('ARRI LogC4 / AWG4')).toBe('ArriLogC4');
    expect(csToken('Rec.709 Gamma 2.4')).toBe('Rec709');
    expect(csToken('P3-D65')).toBe('P3D65');
    expect(csToken('Sony S-Log3 / S-Gamut3.Cine')).toBe('SonySLog3');
    expect(csToken('ACES2065-1 / AP0')).toBe('ACES2065');
  });

  it('falls back to PascalCase for a custom space', () => {
    expect(csToken('My Custom Space')).toBe('MyCustomSpace');
  });

  it('classifies spaces', () => {
    expect(classifySpace('ArriLogC4')).toBe('log');
    expect(classifySpace('Rec709')).toBe('display');
    expect(classifySpace('ACEScg')).toBe('linear');
  });
});

describe('templates', () => {
  it('renders the house convention', () => {
    expect(
      applyTemplate(DEFAULT_TEMPLATE, {
        look: 'Warm',
        source: 'ArriLogC4',
        dest: 'Rec709',
        exp: '+E1stop',
      }),
    ).toBe('Warm_ArriLogC4_Rec709_+E1stop');
  });

  it('collapses separators around empty tokens', () => {
    expect(
      applyTemplate(DEFAULT_TEMPLATE, { look: 'Warm', source: 'ArriLogC4', dest: 'Rec709' }),
    ).toBe('Warm_ArriLogC4_Rec709');
    expect(applyTemplate(DEFAULT_TEMPLATE, { look: 'Warm' })).toBe('Warm');
  });

  it('pascal-cases free text but keeps existing caps', () => {
    expect(pascalCase('warm contrast')).toBe('WarmContrast');
    expect(pascalCase('ARRI log')).toBe('ARRILog');
    expect(pascalCase('Show LUT v3')).toBe('ShowLUTV3');
  });
});

describe('library folders', () => {
  it('routes log to display', () => {
    expect(libraryFolder('ArriLogC4', 'Rec709')).toBe(
      'LUTs/LogToDisplay/ArriLogC4_to_Rec709/Creative',
    );
    expect(libraryFolder('ArriLogC4', 'Rec709', 'Technical')).toBe(
      'LUTs/LogToDisplay/ArriLogC4_to_Rec709/Technical',
    );
  });

  it('routes log to log and display to display', () => {
    expect(libraryFolder('ArriLogC3', 'SonySLog3')).toBe('LUTs/LogToLog/ArriLogC3');
    expect(libraryFolder('Rec709', 'P3D65')).toBe('LUTs/DisplayToDisplay/Rec709_to_P3D65');
  });

  it('falls back to Utility when the pairing is unknown', () => {
    expect(libraryFolder('ACEScg', 'Rec709')).toBe('LUTs/Utility');
    expect(libraryFolder('', 'Rec709')).toBe('LUTs/Utility');
  });
});

describe('free-form exposure', () => {
  it('reads decimals, fractions and mixed numbers', () => {
    expect(normalizeStops('0.25')).toBe('+0.25');
    expect(normalizeStops('+1/4')).toBe('+0.25');
    expect(normalizeStops('-1/4')).toBe('-0.25');
    expect(normalizeStops('1 1/3')).toBe('+1.33');
    expect(normalizeStops('-2 2/3')).toBe('-2.67');
    expect(normalizeStops('+1.5 stops')).toBe('+1.5');
    expect(normalizeStops('-E0_25stop')).toBe('-0.25');
    expect(normalizeStops('')).toBe('0');
    expect(normalizeStops('0')).toBe('0');
    expect(normalizeStops('abc')).toBeNull();
  });

  it('builds the filename token from any spelling', () => {
    expect(exposureToken('+1/4')).toBe('+E0_25stop');
    expect(exposureToken('-0.75')).toBe('-E0_75stop');
    expect(exposureToken('1/3')).toBe('+E0_33stop');
  });

  it('recovers a shift from a filename', () => {
    expect(stopsFromName('Warm_ArriLogC4_Rec709_+E0_25stop.cube')).toBe('+0.25');
    expect(stopsFromName('Warm_-E1stop.cube')).toBe('-1');
    expect(stopsFromName('Warm.cube')).toBe('0');
  });
});
