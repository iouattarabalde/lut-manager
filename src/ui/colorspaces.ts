/**
 * Color space option lists, shared by the single-file editor and the batch
 * panel so the two can never drift apart.
 */

export interface CSGroup {
  label: string;
  options: string[];
}

export const INPUT_GROUPS: CSGroup[] = [
  {
    label: 'Camera',
    options: [
      'ARRI LogC3 / AWG3',
      'ARRI LogC4 / AWG4',
      'RED Log3G10 / REDWideGamutRGB',
      'Sony S-Log3 / S-Gamut3.Cine',
      'Sony S-Log3 / S-Gamut3',
      'Sony S-Log2 / S-Gamut',
      'Canon Log 2 / Cinema Gamut',
      'Canon Log 3 / Cinema Gamut',
      'Panasonic V-Log / V-Gamut',
      'Nikon N-Log / N-Gamut',
      'Blackmagic Film Gen 5 / BWG',
    ],
  },
  {
    label: 'Intermediate',
    options: [
      'DaVinci Intermediate / DaVinci Wide Gamut',
      'ACEScg / AP1',
      'ACES2065-1 / AP0',
      'ACEScc / AP1',
      'ACEScct / AP1',
    ],
  },
  {
    label: 'Standard',
    options: ['Linear', 'sRGB', 'Rec.709 Gamma 2.2', 'Rec.709 Gamma 2.4', 'Rec.2020'],
  },
];

export const OUTPUT_GROUPS: CSGroup[] = [
  {
    label: 'Display',
    options: [
      'Rec.709 Gamma 2.4',
      'Rec.709 Gamma 2.2',
      'sRGB',
      'Rec.2020',
      'P3-D65',
      'P3-DCI',
    ],
  },
  {
    label: 'Intermediate',
    options: [
      'DaVinci Intermediate / DaVinci Wide Gamut',
      'ACEScg / AP1',
      'ACES2065-1 / AP0',
      'ACEScc / AP1',
      'ACEScct / AP1',
    ],
  },
  { label: 'Standard', options: ['Linear'] },
  { label: 'HDR', options: ['Rec.2100-PQ', 'Rec.2100-HLG'] },
  // An inverted display LUT outputs camera log, so these belong here too.
  { label: 'Camera', options: INPUT_GROUPS[0].options },
];

export const EXPOSURE_STOPS: { value: string; label: string }[] = [
  { value: '+0.33', label: '+1/3' },
  { value: '+0.5', label: '+1/2' },
  { value: '+0.67', label: '+2/3' },
  { value: '+1', label: '+1' },
  { value: '+1.33', label: '+1 1/3' },
  { value: '+1.5', label: '+1 1/2' },
  { value: '+1.67', label: '+1 2/3' },
  { value: '+2', label: '+2' },
  { value: '+2.33', label: '+2 1/3' },
  { value: '+2.5', label: '+2 1/2' },
  { value: '+2.67', label: '+2 2/3' },
  { value: '+3', label: '+3' },
];

const opt = (value: string, label = value): HTMLOptionElement =>
  Object.assign(document.createElement('option'), { value, textContent: label });

/** Fill a <select> with the standard color-space list. */
export function populateCS(sel: HTMLSelectElement, dir: 'Input' | 'Output'): void {
  sel.replaceChildren();
  sel.append(opt('', '— unspecified —'));
  if (dir === 'Output') sel.append(opt('__same__', '↳ Same as Input'));

  for (const group of dir === 'Input' ? INPUT_GROUPS : OUTPUT_GROUPS) {
    const g = document.createElement('optgroup');
    g.label = group.label;
    for (const o of group.options) g.append(opt(o));
    sel.append(g);
  }
  sel.append(opt('__custom__', 'Custom…'));
}

/** Fill a <select> with the exposure-shift list. */
export function populateExposure(sel: HTMLSelectElement): void {
  sel.replaceChildren();
  sel.append(opt('0', '0 (no shift)'));

  const positive = document.createElement('optgroup');
  positive.label = 'Positive';
  const negative = document.createElement('optgroup');
  negative.label = 'Negative';

  for (const { value, label } of EXPOSURE_STOPS) {
    positive.append(opt(value, label));
    negative.append(opt(value.replace('+', '-'), label.replace('+', '-')));
  }
  sel.append(positive, negative);
}
