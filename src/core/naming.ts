/**
 * Filename and folder naming, following Ismael's ColorLibrary conventions:
 *
 *   [Look]_[Source]_[Destination]_[ExposureComp].cube
 *   PascalCase elements, underscores as the only separator.
 *
 * See the resolve-naming-conventions skill. Where this file and that skill
 * disagree, the discrepancy is called out in a comment rather than silently
 * resolved.
 */

/** UI color-space label -> ColorLibrary token. */
const CS_TOKENS: Record<string, string> = {
  'ARRI LogC3 / AWG3': 'ArriLogC3',
  'ARRI LogC4 / AWG4': 'ArriLogC4',
  'RED Log3G10 / REDWideGamutRGB': 'RedLog3G10',
  'Sony S-Log3 / S-Gamut3.Cine': 'SonySLog3',
  'Sony S-Log3 / S-Gamut3': 'SonySLog3',
  'Sony S-Log2 / S-Gamut': 'SonySLog2',
  'Canon Log 2 / Cinema Gamut': 'CanonCLog2',
  'Canon Log 3 / Cinema Gamut': 'CanonCLog3',
  'Panasonic V-Log / V-Gamut': 'PanasonicVLog',
  'Nikon N-Log / N-Gamut': 'NikonNLog',
  'Blackmagic Film Gen 5 / BWG': 'BlackmagicFilmGen5',
  'DaVinci Intermediate / DaVinci Wide Gamut': 'DaVinciIntermediate',
  'ACEScg / AP1': 'ACEScg',
  'ACES2065-1 / AP0': 'ACES2065',
  'ACEScc / AP1': 'ACEScc',
  'ACEScct / AP1': 'ACEScct',
  Linear: 'Linear',
  sRGB: 'sRGB',
  // The library folder is plain `Rec709`; gamma 2.4 is the standard display
  // transform, so it takes the bare token and 2.2 is disambiguated.
  'Rec.709 Gamma 2.4': 'Rec709',
  'Rec.709 Gamma 2.2': 'Rec709G22',
  'Rec.2020': 'Rec2020',
  'P3-D65': 'P3D65',
  'P3-DCI': 'P3DCI',
  'Rec.2100-PQ': 'Rec2100PQ',
  'Rec.2100-HLG': 'Rec2100HLG',
};

const LOG_SPACES = new Set([
  'ArriLogC3', 'ArriLogC4', 'RedLog3G10', 'SonySLog2', 'SonySLog3',
  'CanonCLog2', 'CanonCLog3', 'PanasonicVLog', 'NikonNLog',
  'BlackmagicFilmGen5', 'DaVinciIntermediate', 'ACEScc', 'ACEScct',
]);

const DISPLAY_SPACES = new Set([
  'Rec709', 'Rec709G22', 'sRGB', 'Rec2020', 'P3D65', 'P3DCI',
  'Rec2100PQ', 'Rec2100HLG',
]);

const SCENE_LINEAR = new Set(['Linear', 'ACEScg', 'ACES2065']);

export type SpaceClass = 'log' | 'display' | 'linear' | 'unknown';

export function classifySpace(token: string): SpaceClass {
  if (LOG_SPACES.has(token)) return 'log';
  if (DISPLAY_SPACES.has(token)) return 'display';
  if (SCENE_LINEAR.has(token)) return 'linear';
  return 'unknown';
}

/** PascalCase a free-text value, dropping anything that isn't alphanumeric. */
export function pascalCase(input: string): string {
  return input
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
}

/** Color-space label -> library token, falling back to a PascalCased label. */
export function csToken(label: string): string {
  if (!label) return '';
  return CS_TOKENS[label] ?? pascalCase(label.split('/')[0]);
}

/**
 * Exposure compensation token: `+E1stop`, `+E1_5stop`, `+E1_33stop`,
 * `+E0_33stop`. Sign first, decimal point written as `_`, no fractional part
 * on a whole stop, and omitted entirely at zero.
 *
 * Matches the Exposure Compensation table in the resolve-naming-conventions
 * skill, which was corrected to this form on 2026-08-29. Every row of that
 * table is asserted in test/naming.test.ts.
 */
export function exposureToken(raw: string): string {
  const n = parseStops(raw);
  if (n === null) return '';
  const canon = formatStops(n);
  if (canon === '0') return '';
  return `${canon[0]}E${canon.slice(1).replace('.', '_')}stop`;
}

/**
 * Read an exposure shift however it was typed: `0.25`, `+1/4`, `-1 1/3`,
 * `1.5 stops`, `+E0_25stop`. Returns null when it isn't a number of stops.
 */
export function parseStops(raw: string): number | null {
  const s = raw.trim().replace(/\s*stops?$/i, '').replace(/^([+-]?)E/i, '$1').replace('_', '.');
  if (!s) return 0;
  const m = s.match(/^([+-])?\s*(?:(\d+(?:\.\d+)?)|(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+))$/);
  if (!m) return null;
  let n: number;
  if (m[2] !== undefined) n = parseFloat(m[2]);
  else if (m[3] !== undefined) n = +m[3] + +m[4] / +m[5];
  else n = +m[6] / +m[7];
  if (!Number.isFinite(n)) return null;
  return m[1] === '-' ? -n : n;
}

/**
 * Canonical form of a shift, rounded to hundredths: `+0.25`, `-1.33`, `+2`,
 * or `0` for none. This is what the header and the filename token are built
 * from, so `1/3` and `0.333` land on the same `+E0_33stop`.
 */
export function formatStops(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '-'}${String(Math.abs(r))}`;
}

/** `parseStops` then `formatStops`; null when the input isn't valid. */
export function normalizeStops(raw: string): string | null {
  const n = parseStops(raw);
  return n === null ? null : formatStops(n);
}

/** An exposure token left in a filename, e.g. `Warm_+E0_25stop.cube`. */
export function stopsFromName(name: string): string {
  const m = name.match(/([+-])E(\d+(?:_\d+)?)stop/);
  return m ? formatStops(parseFloat(`${m[1]}${m[2].replace('_', '.')}`)) : '0';
}

/** As above, with the leading separator, for direct concatenation. */
export function exposureSuffix(raw: string): string {
  const token = exposureToken(raw);
  return token ? `_${token}` : '';
}

export interface NameTokens {
  look: string;
  source: string;
  dest: string;
  exp: string;
  size: string;
  date: string;
  project: string;
  author: string;
  index: string;
  srcname: string;
}

export const DEFAULT_TEMPLATE = '{look}_{source}_{dest}_{exp}';

export const TEMPLATE_TOKENS: readonly (keyof NameTokens)[] = [
  'look', 'source', 'dest', 'exp', 'size', 'date', 'project', 'author',
  'index', 'srcname',
];

/**
 * Fill a template. Empty tokens collapse along with their separators, so
 * `{look}_{source}_{dest}_{exp}` with no exposure yields `Look_Src_Dst`
 * rather than a trailing underscore.
 */
export function applyTemplate(template: string, tokens: Partial<NameTokens>): string {
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = tokens[key as keyof NameTokens];
    return v ? String(v) : '';
  });
  return filled
    .replace(/_{2,}/g, '_')
    .replace(/^[_\-]+|[_\-]+$/g, '')
    .trim();
}

export type LookKind = 'Creative' | 'Technical';

/**
 * ColorLibrary destination folder for a transform, mirroring the tree in the
 * resolve-naming-conventions skill. Returns null when the pairing does not map
 * onto a known branch, in which case the caller should fall back to Utility.
 */
export function libraryFolder(
  source: string,
  dest: string,
  kind: LookKind = 'Creative',
): string {
  if (!source || !dest) return 'LUTs/Utility';

  const sc = classifySpace(source);
  const dc = classifySpace(dest);

  if (sc === 'log' && dc === 'log') return `LUTs/LogToLog/${source}`;
  if (sc === 'log' && dc === 'display')
    return `LUTs/LogToDisplay/${source}_to_${dest}/${kind}`;
  if (sc === 'display' && dc === 'display')
    return `LUTs/DisplayToDisplay/${source}_to_${dest}`;

  return 'LUTs/Utility';
}
