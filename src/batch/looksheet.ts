/**
 * Look sheet: a self-contained HTML contact sheet showing every LUT in the
 * batch applied to the same reference frame, with its metadata beneath.
 *
 * This is the client-facing artifact — something to send with a look package
 * so the people receiving it can see what they were given without loading
 * anything into Resolve.
 */

import { type BatchEntry, type SharedFields, worstLevel } from './batch.js';
import { analyze } from '../core/analyze.js';

export interface LookSheetTile {
  entry: BatchEntry;
  /** PNG data URL of the LUT applied to the reference frame. */
  image: string;
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildLookSheet(
  tiles: LookSheetTile[],
  shared: SharedFields,
  sourceLabel: string,
): string {
  const title = shared.project ? `${shared.project} — Look Sheet` : 'Look Sheet';

  const cards = tiles
    .map(({ entry, image }) => {
      const m = analyze(entry.lut);
      const level = worstLevel(entry);
      const notes: string[] = [];
      if (m.clippedHigh > 0.02) notes.push(`${(m.clippedHigh * 100).toFixed(1)}% clipped high`);
      if (m.clippedLow > 0.02) notes.push(`${(m.clippedLow * 100).toFixed(1)}% crushed`);
      if (!m.neutralMonotonic) notes.push('neutral reverses');
      if (m.isIdentity) notes.push('identity');

      return `    <figure class="tile ${level}">
      <img src="${image}" alt="${esc(entry.look)}">
      <figcaption>
        <div class="name">${esc(entry.look)}</div>
        <div class="meta">${entry.lut.dims}D · ${entry.lut.size} · contrast ${m.midSlope.toFixed(2)}×</div>
        ${notes.length ? `<div class="flags">${esc(notes.join(' · '))}</div>` : ''}
      </figcaption>
    </figure>`;
    })
    .join('\n');

  const stamp = [shared.project, shared.author, shared.date].filter(Boolean).map(esc);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #f2f0eb; --surface: #fff; --border: #d0ccc2;
    --text: #1a1814; --dim: #7a7468; --faint: #a8a29a; --accent: #c8390a;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17161a; --surface: #1f1e23; --border: #34323a;
            --text: #ece9e3; --dim: #9a948a; --faint: #6b6660; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Barlow Condensed', 'Helvetica Neue', sans-serif;
    background: var(--bg); color: var(--text); padding: 32px;
    -webkit-font-smoothing: antialiased;
  }
  header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 14px; }
  h1 { font-size: 26px; font-weight: 700; letter-spacing: 0.02em; }
  .stamp {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px;
    color: var(--dim); margin-top: 5px; letter-spacing: 0.05em;
  }
  .source {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px;
    color: var(--faint); margin-top: 3px;
  }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 18px;
  }
  .tile {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px; overflow: hidden;
  }
  .tile.error { border-color: var(--accent); }
  .tile img { width: 100%; display: block; aspect-ratio: 16 / 9; object-fit: cover; }
  figcaption { padding: 9px 11px; }
  .name { font-size: 15px; font-weight: 600; }
  .meta, .flags {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px;
    color: var(--dim); margin-top: 3px; letter-spacing: 0.03em;
  }
  .flags { color: var(--accent); }
  footer {
    margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--border);
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 10px; color: var(--faint);
  }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  ${stamp.length ? `<div class="stamp">${stamp.join(' · ')}</div>` : ''}
  <div class="source">Reference: ${esc(sourceLabel)}${
    shared.inputCS ? ` · ${esc(shared.inputCS)} → ${esc(shared.outputCS || 'unspecified')}` : ''
  }</div>
</header>
<div class="grid">
${cards}
</div>
<footer>${tiles.length} look${tiles.length === 1 ? '' : 's'} · previews are approximate, for reference only</footer>
</body>
</html>
`;
}
