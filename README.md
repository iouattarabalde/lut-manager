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

## Image preview

The left panel has three tabs: **Curve** (neutral axis), **Image**, and **Scopes**.

The image preview applies the LUT on the GPU with **tetrahedral** interpolation — what
Resolve and most LUT hardware use — with trilinear available for comparison. Both are done
in the shader with `texelFetch` rather than hardware filtering, which is what makes
tetrahedral possible and avoids depending on `OES_texture_float_linear`.

Sources are five procedurally generated reference charts (grey ramp, ColorChecker, hue and
saturation sweep, skin tones, exposure wedge) or **your own still** — drop a PNG or JPEG onto
the window alongside the LUT. A split slider wipes between before and after.

**On the encoding control.** A still from Finder is display-referred sRGB; a show LUT expects
camera log. Feeding one to the other unconverted shows you something that is not what the LUT
does. So the preview always states what it is converting the source into, defaults to the
encoding implied by the LUT's `InputColorSpace`, and warns when the LUT declares no input
space or declares one that doesn't match. The charts are generated in scene-linear and encoded
on the way in, so the same chart serves a LogC LUT and an S-Log3 LUT honestly.

Supported encodings: scene linear, sRGB, Rec.709, ARRI LogC3 and LogC4, Sony S-Log3,
Panasonic V-Log, RED Log3G10, DaVinci Intermediate. Each is verified against its
manufacturer's published 18% grey code value in `test/transfer.test.ts`.

The Scopes tab shows an RGB-overlay waveform and a vectorscope of the **graded** result.

## Batch mode

Drop several `.cube` files at once to switch into batch mode — the "shipping a look package"
workflow:

- **One shared header** stamped across every file, with a per-file look name.
- **Delivery QC** on load. Each file gets a status dot and its worst problem inline: row
  counts that disagree with the declared size, clipped highlights or crushed shadows, a
  non-monotonic neutral axis, identity LUTs that do nothing, 3D LUTs doing no cross-channel
  work (so they could ship as 1D), and sizes outside 17/33/65 that some LUT boxes reject.
  Click any row to see its curve.
- **Naming** follows the ColorLibrary convention — `[Look]_[Source]_[Destination]_[Exposure]`,
  e.g. `Warm_ArriLogC4_Rec709_+E1stop.cube`. Source and destination come from the color space
  fields, mapped to library tokens. The template is editable with the tokens `{look}`,
  `{source}`, `{dest}`, `{exp}`, `{size}`, `{date}`, `{project}`, `{author}`, `{index}`,
  `{srcname}`; empty tokens collapse along with their separators.
- **Zip export**, laid out as ColorLibrary folders
  (`LUTs/LogToDisplay/ArriLogC4_to_Rec709/Creative/…`) or as a flat list. Files with errors
  can be excluded before export.

Author, project and the naming template are remembered between sessions.

> **Note on the exposure token.** The `resolve-naming-conventions` skill shows `E+00` in its
> LUT-file row (sign after the `E`, zero-padded). The form implemented here — `+E1stop`,
> `+E1_5stop`, `+E1_33stop`, `+E0_33stop` — is the one Ismael confirmed on 2026-08-28. That
> row of the skill is what needs reconciling.

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
src/core/lut.ts        canonical in-memory LUT model, shared by everything
src/core/sample.ts     CPU trilinear and tetrahedral sampling
src/core/analyze.ts    delivery QC metrics and checks
src/core/naming.ts     filename templates, ColorLibrary tokens and folders
src/format/cube.ts     .cube reader and writer (1D and 3D)
src/batch/batch.ts     batch queue, stamping and rendering
src/render/preview.ts  WebGL2 image preview
src/render/transfer.ts camera log and display transfer functions
src/render/charts.ts   procedural reference charts
src/render/scopes.ts   waveform and vectorscope
src/render/curve.ts    neutral-axis plot
src/ui/                shared DOM helpers, color space lists, panels
src/main.ts            mode routing and single-file editor
```

The canonical model keeps both parsed samples (for plotting and analysis) and the original
data rows (for lossless writing); see the comments in `src/core/lut.ts`.

## History

v1 was a single-file HTML/JS artifact deployed on Netlify Drop, migrated to GitHub Pages on
2026-08-25. v2 rebuilt it on Vite with a shared LUT model, added 1D support, lossless header
passthrough, file validation, and offline support, then added batch mode with delivery QC and
ColorLibrary naming, and a GPU image preview with scopes. The v1 source is in the git history.

## Verifying the shader

The GLSL in `src/render/preview.ts` deliberately mirrors `src/core/sample.ts`, which is unit
tested. Vitest has no WebGL context, so the two are checked against each other in a browser:
load a LUT, open the Image tab, and in the console compare `readPixels` output against
`sampleLut` for the same input. On the last run they agreed exactly — zero difference across
all sampled points and channels, in both interpolation modes.
