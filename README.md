# LUT Header Editor

A browser tool for editing the metadata header of `.cube` LUT files without touching the
LUT data itself.

**Live: https://iouattarabalde.github.io/lut-header-editor/**

## What it does

Drop in a `.cube` file and edit its header fields:

- **Identity** — `TITLE`, LUT name, author, date, project, notes
- **Exposure shift** — stop increments from -2 2/3 to +2 2/3, also appended to the filename
- **Color space** — `InputColorSpace` / `OutputColorSpace`, with presets for ARRI LogC3/C4,
  RED Log3G10, Sony S-Log2/3, Canon Log 2/3, Panasonic V-Log, Nikon N-Log, Blackmagic Film
  Gen 5, DaVinci Intermediate, the ACES spaces, and the Rec./P3 display spaces (or a custom
  string)

`LUT_3D_SIZE`, `DOMAIN_MIN`, `DOMAIN_MAX` and the entire data table are preserved verbatim —
only header lines are rewritten. A live preview shows the header you're about to write, and
there's a 3D visualizer for inspecting the cube.

## Notes

Single-file HTML/JS, no build step, no dependencies. Everything runs client-side: the LUT
never leaves the browser, and nothing is uploaded anywhere.

To run it locally, open `index.html` in a browser — that's the whole thing.

## History

v1 was built as a standalone artifact and deployed on Netlify Drop. Migrated to GitHub Pages
on 2026-08-25 so it has a source of truth and a version history.
