import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  classifySpace,
  csToken,
  DEFAULT_TEMPLATE,
  exposureSuffix,
  exposureToken,
  libraryFolder,
  pascalCase,
} from '../src/core/naming.js';

describe('exposure token', () => {
  // The form Ismael confirmed on 2026-08-28.
  it('matches the house convention', () => {
    expect(exposureToken('+1')).toBe('+E1stop');
    expect(exposureToken('+1.5')).toBe('+E1_5stop');
    expect(exposureToken('+1.33')).toBe('+E1_33stop');
    expect(exposureToken('+0.33')).toBe('+E0_33stop');
    expect(exposureToken('-0.67')).toBe('-E0_67stop');
    expect(exposureToken('-2.67')).toBe('-E2_67stop');
  });

  it('is empty at zero', () => {
    expect(exposureToken('0')).toBe('');
    expect(exposureToken('')).toBe('');
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
