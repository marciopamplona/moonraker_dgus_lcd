# DGUS Studio (browser editor for DWIN DGUS II screens)

Work in progress; see [docs/EDITOR_PLAN.md](../docs/EDITOR_PLAN.md).
**M0** (done): codecs for every file in a T5UID1 `DWIN_SET`, with golden tests.

```sh
cd editor
npm install
npm test            # vitest: golden round trips + Python cross-check
npm run dev         # dev server
npm run build       # -> dist/ (committed; open dist/index.html or serve it)
npm run fixtures    # regenerate test/fixtures from dgus_lcd/screen_files.py
```

The M0 page (`dist/index.html`) opens a DWIN_SET folder, runs every file
through its codec in the browser, and reports whether it comes back
byte-identical.

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
