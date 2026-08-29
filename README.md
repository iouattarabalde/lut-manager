# LUT Header Editor

A browser tool for editing the metadata header of `.cube` LUT files without touching the
LUT data itself.

**Live: https://iouattarabalde.github.io/lut-header-editor/**

## What it does

Drop in a `.cube` file — 1D or 3D — and edit its header fields:

- **Identity** — `TITLE`, LUT name, author, date, project, notes
- **Exposure shift** — stop increments from -3 to +3, also appended to the filename.
  This is an **annotation only**: it records a shift applied elsewhere and never modifies
  the LUT data.
- **Color space** — `InputColorSpace` / `OutputColorSpace`, with presets for ARRI LogC3/C4,
  RED Log3G10, Sony S-Log2/3, Canon Log 2/3, Panasonic V-Log, Nikon N-Log, Blackmagic Film
  Gen 5, DaVinci Intermediate, the ACES spaces, and the Rec./P3 display spaces (or a custom
  string)

A live preview shows the header you're about to write, and a plot of the neutral axis shows
the LUT's response.

### What it guarantees

- **A header-only edit leaves the data table byte-for-byte identical.** The original rows are
  written back verbatim, not re-serialised from parsed floats.
- **Unrecognised header keywords survive.** Anything the tool doesn't model — `LUT_1D_SIZE`,
  the legacy `LUT_3D_INPUT_RANGE`, vendor-specific keys — is passed through rather than
  dropped.
- **Malformed files are reported, not silently mangled.** Row counts that disagree with the
  declared size, missing size keywords, unparseable domains and unknown keywords all surface
  as errors or warnings on load.

Everything runs client-side: the LUT never leaves the browser, and nothing is uploaded
anywhere. The app is a PWA with its fonts self-hosted, so it works with no network — useful
on set.

## Development

```bash
npm install
npm run dev
```

Other scripts: `npm test` (Vitest), `npm run build` (typecheck + production build),
`npm run preview` (serve the built output).

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Layout

```
src/core/lut.ts      canonical in-memory LUT model, shared by everything
src/format/cube.ts   .cube reader and writer (1D and 3D)
src/render/curve.ts  neutral-axis plot
src/main.ts          UI wiring
```

The canonical model keeps both parsed samples (for plotting and analysis) and the original
data rows (for lossless writing); see the comments in `src/core/lut.ts`.

## History

v1 was a single-file HTML/JS artifact deployed on Netlify Drop, migrated to GitHub Pages on
2026-08-25. v2 rebuilt it on Vite with a shared LUT model, added 1D support, lossless header
passthrough, file validation, and offline support. The v1 source is in the git history.
