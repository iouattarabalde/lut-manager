# LUT Manager

A browser tool for working with `.cube` LUTs: inspect them, edit their metadata headers
without touching the data, batch-stamp and QC a delivery, see them applied to an image, and
convert between formats. Everything runs client-side — LUTs never leave the browser.

**Live: https://iouattarabalde.github.io/lut-manager/**

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

One caveat: the LUT's output is written straight to an sRGB canvas, so for a Rec.709 gamma 2.4
output LUT there is a small gamma mismatch against a true 2.4 monitor. This is for judging a
LUT, not for final QC on a calibrated display.

**Keyboard:** `1`–`4` switch tabs, `d` downloads, `Esc` clears. The interface follows your
system light/dark setting.

## Operations

Staged transforms, kept separate from the header fields because the two make
opposite promises: header edits return the data table byte-for-byte, operations rewrite it.
Whenever any operation is active the panel says so.

- **Resample** to 17 / 33 / 65 with tetrahedral interpolation, reporting the worst and mean
  deviation from the original so you can tell whether a downsample is safe for a LUT box.
- **Chain** a second `.cube` to bake a trim onto a show LUT. The direction selector spells out
  both LUTs by name, since this is the easiest thing here to get backwards.
- **Clamp** to 0–1 or to broadcast-legal (64–940 in 10-bit), reporting what fraction moved.
- **Invert** (approximate). 3D inversion is ill-posed — a LUT that clips maps many inputs to
  one output — so this reports the worst round-trip error and warns explicitly when the source
  is non-injective rather than pretending the result is exact.
- **Extract 1D** at 1024 points, exact only when the source does no cross-channel work.

Operations that change the transform's direction rewrite the color space fields, so an
inverted LogC→Rec.709 LUT ships declaring Rec.709→LogC rather than the original direction.

### Export formats

`.cube` (1D and 3D), `.3dl` (Lustre / Flame), `.csp` (Cineon Space), and ACES `.clf`.

Sample ordering differs between them — `.cube` and `.csp` vary red fastest, `.3dl` and `.clf`
vary blue fastest. Getting that backwards produces a file that loads without complaint and
grades completely wrong, so each writer's ordering is asserted in `test/exporters.test.ts`.

## Analysis

A readout of black, white and mid points, contrast slope at mid, clipped fractions, maximum
deviation from identity, neutral monotonicity, and whether the LUT is genuinely 3D or
reducible to 1D — alongside the same checks batch mode runs.

The **Cube** tab plots the LUT's output positions in RGB space as an orbitable point cloud
inside a wireframe of the input domain. Gamut warping, clipping (points pinned flat against a
face) and channel inversions read as shape here in a way no 1D curve shows.

Loading a second LUT into **Chain** also overlays its neutral response on the curve, dashed,
for comparison.

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

**Look sheet** exports a self-contained HTML contact sheet — every LUT in the queue applied to
the same reference frame, with its metadata and any flags beneath. It uses your dropped still
if there is one, otherwise the skin-tone chart, since patch charts make looks hard to tell
apart. Something to send with a package so the people receiving it can see what they were
given without opening Resolve.

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
src/core/lut.ts          canonical in-memory LUT model, shared by everything
src/core/sample.ts       CPU trilinear and tetrahedral sampling
src/core/ops.ts          resample, chain, clamp, extract 1D, invert
src/core/analyze.ts      delivery QC metrics and checks
src/core/naming.ts       filename templates, ColorLibrary tokens and folders
src/format/cube.ts       .cube reader and writer (1D and 3D)
src/format/lustre3dl.ts  .3dl export      (blue fastest)
src/format/csp.ts        .csp export      (red fastest)
src/format/clf.ts        ACES .clf export (blue fastest)
src/batch/batch.ts       batch queue, stamping and rendering
src/batch/looksheet.ts   HTML contact sheet
src/render/preview.ts    WebGL2 image preview
src/render/cube3d.ts     WebGL2 3D cube viewer
src/render/transfer.ts   camera log and display transfer functions
src/render/charts.ts     procedural reference charts
src/render/scopes.ts     waveform and vectorscope
src/render/curve.ts      neutral-axis plot
src/ui/                  shared DOM helpers, color space lists, panels
src/main.ts              mode routing and single-file editor
```

The canonical model keeps both parsed samples (for plotting and analysis) and the original
data rows (for lossless writing); see the comments in `src/core/lut.ts`.

## History

Named "LUT Header Editor" until it outgrew the name. v1 was a single-file HTML/JS artifact deployed on Netlify Drop, migrated to GitHub Pages on
2026-08-25. v2 rebuilt it on Vite with a shared LUT model, added 1D support, lossless header
passthrough, file validation, and offline support, then added batch mode with delivery QC and
ColorLibrary naming, a GPU image preview with scopes, LUT operations with multi-format export,
and analysis with a 3D cube viewer. The v1 source is in the git history.

## Not included

**DCTL export.** Resolve's DCTL LUT mechanism can't be verified from here, and an export that
silently fails to compile on set is worse than no export. Happy to add it if you can test the
output in Resolve.

## Verifying the shader

The GLSL in `src/render/preview.ts` deliberately mirrors `src/core/sample.ts`, which is unit
tested. Vitest has no WebGL context, so the two are checked against each other in a browser:
load a LUT, open the Image tab, and in the console compare `readPixels` output against
`sampleLut` for the same input. On the last run they agreed exactly — zero difference across
all sampled points and channels, in both interpolation modes.
