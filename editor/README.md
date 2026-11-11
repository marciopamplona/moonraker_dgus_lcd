# DGUS Studio (browser editor for DWIN DGUS II screens)

Work in progress; see [docs/EDITOR_PLAN.md](../docs/EDITOR_PLAN.md).

- **M0** (done): codecs for every file in a T5UID1 `DWIN_SET`, with golden tests.
- **M1** (done): import a DWIN_SET (folder, drop, or zip) as a project, browse
  pages with their controls drawn on top, inspect each control's fields,
  save/open `.dgusproj`, export a DWIN_SET zip, autosave to IndexedDB.
  Import → export is byte-identical for the vendored and Macros sets.

```sh
cd editor
npm install
npm test            # vitest: golden round trips + Python cross-check
npm run dev         # dev server
npm run build       # -> dist/index.html, one self-contained file (committed);
                    #    open it from disk or serve it from anywhere
npm run fixtures    # regenerate test/fixtures from dgus_lcd/screen_files.py
```

## Where files go

Nothing is uploaded. Files you pick or drop are read into the tab's memory.
The open project is autosaved in this browser's IndexedDB (database
`dgus-studio`), so it survives a reload; it lives only in this browser
profile, and clearing site data removes it. Projects there are listed on
the start page and can be deleted from it. **Save .dgusproj** and
**Export DWIN_SET** download files through the browser.

A `.dgusproj` is a zip: `project.json` plus `assets/<DWIN_SET file name>`.
Controls are stored as their raw entry bytes (hex), so nothing is lost
before typed editing (M2) exists.

## Layout

| Path | |
|---|---|
| `src/core/formats/` | file codecs (no DOM) |
| `src/core/controls/describe.ts` | field tables for every touch/display control type (V4.3 guide ch. 7–8), bounds for the canvas |
| `src/core/project/` | project model, `decompile` (DWIN_SET → project), `compile` (project → DWIN_SET), blank template |
| `src/io/` | `.dgusproj` zip, DWIN_SET zip/folder import, IndexedDB store |
| `src/ui/` | Preact app: store + autosave, page list, canvas, inspector |
| `test/` | vitest; `ui.test.tsx` renders the app in happy-dom |

## File formats (T5UID1)

| File | Module | Notes |
|---|---|---|
| `13*.BIN` touch | `core/formats/touch13.ts` | Port of `screen_files.TouchFile`. Function sizes 0x00–0x03, 0x05 checked against DGUS-reloaded; 0x04, 0x06–0x09 from the V4.3 guide (unverified) |
| `14*.BIN` variables | `core/formats/var14.ts` | DGUS_2 index layout, 32-byte entries, trailer kept |
| `*.BMP` pictures | `core/formats/bmp.ts` | 24-bit; `save()` matches `screen_files.Bitmap.save()` |
| `*.ICO` icon library | `core/formats/ico.ts` | Found by comparing the files with their source BMPs (see below) |
| `0_DWIN_ASC.HZK` | `core/formats/hzk.ts` | Found the same way (see below) |
| `T5UID1.CFG` | `core/formats/cfg.ts` | Named fields from the T5UID1 Application Guide ch. 5; unmodelled bytes kept |
| `22*.BIN` SRAM init | `core/formats/config22.ts` | Word n = VP n, big-endian; length kept (DGUS-reloaded: 0x20004 bytes) |

**ICO**: 0x40000-byte index of 32768 × 8-byte entries, where entry *n* = icon id *n*: `w(1) h(1) addr(4, BE, in 16-bit words from the start of the file) 0000`. An all-zero entry means no icon. After the index comes RGB565 big-endian pixel data (channel truncation, no dithering). The DWIN tool writes the data in *string* order of the source file names (`0, 1, 10, 11, …, 2`). Building from `vendor/…/project/27_buttons/*.bmp` in that order reproduces `27_buttons.ico` byte for byte. Icons are at most 255×255.

**ASCII HZK**: for every even height h = 8…128 (w = h/2), 128 glyphs (0x00–0x7F) of `ceil(w/8)·h` bytes each, 1 bpp, MSB = leftmost pixel. 61 sizes add up to exactly 3 082 752 bytes, the size of the file.
