/**
 * Color space option lists, shared by the single-file editor and the batch
 * panel so the two can never drift apart.
 */

import { formatStops, normalizeStops } from '../core/naming.js';

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

/** Quarter and third stops out to ±3, offered as suggestions; any value can be typed. */
const FRACTIONS: [number, string][] = [
  [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'],
];

function exposureSuggestions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const sign of [1, -1]) {
    for (let whole = 0; whole <= 3; whole++) {
      const steps: [number, string][] = whole === 0 ? FRACTIONS : [[0, ''], ...(whole < 3 ? FRACTIONS : [])];
      for (const [f, frac] of steps) {
        const n = sign * (whole + f);
        const s = sign > 0 ? '+' : '-';
        out.push({ value: formatStops(n), label: `${s}${whole ? whole : ''}${whole && frac ? ' ' : ''}${frac}` });
      }
    }
  }
  return out;
}

/** One shared <datalist> per page, created on first use. */
function datalist(id: string, fill: (list: HTMLDataListElement) => void): string {
  if (!document.getElementById(id)) {
    const list = document.createElement('datalist');
    list.id = id;
    fill(list);
    document.body.append(list);
  }
  return id;
}

/**
 * Turn a text input into an exposure-shift field. Takes `0.25`, `+1/4`,
 * `-1 1/3` and so on; normalises on commit and flags anything unreadable.
 */
export function wireExposure(input: HTMLInputElement, onChange: () => void): void {
  input.setAttribute(
    'list',
    datalist('expStopsList', (list) => {
      for (const { value, label } of exposureSuggestions()) list.append(opt(value, label));
    }),
  );
  input.autocomplete = 'off';
  input.placeholder = '0 — e.g. +1/4, -0.5, +1 1/3';
  input.addEventListener('input', () => {
    input.classList.toggle('invalid', normalizeStops(input.value) === null);
    onChange();
  });
  input.addEventListener('change', () => {
    const canon = normalizeStops(input.value);
    if (canon === null) return;
    input.value = canon === '0' ? '' : canon;
    input.classList.remove('invalid');
    onChange();
  });
}

/** The value of an exposure field in canonical form, `0` when empty or invalid. */
export function exposureValue(input: HTMLInputElement): string {
  return normalizeStops(input.value) ?? '0';
}

/** A datalist of every preset color space, for free-text color space inputs. */
export function csListId(): string {
  return datalist('csList', (list) => {
    const seen = new Set<string>();
    for (const g of [...INPUT_GROUPS, ...OUTPUT_GROUPS])
      for (const o of g.options) if (!seen.has(o)) (seen.add(o), list.append(opt(o)));
  });
}
