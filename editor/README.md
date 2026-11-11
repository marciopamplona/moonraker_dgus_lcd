# DGUS Studio (browser editor for DWIN DGUS II screens)

Work in progress; see [docs/EDITOR_PLAN.md](../docs/EDITOR_PLAN.md).

- **M0** (done): codecs for every file in a T5UID1 `DWIN_SET`, with golden tests.
- **M1** (done): import a DWIN_SET (folder, drop, or zip) as a project, browse
  pages with their controls drawn on top, inspect each control's fields,
  save/open `.dgusproj`, export a DWIN_SET zip, autosave to IndexedDB.
  Import → export is byte-identical for the vendored and Macros sets.
- **M2** (done): editing. Add controls from templates (button/page jump,
  return key, number input, +/-, slider, text, number, variable icon, bit
  icon) with a free VP picked automatically; drag to move, handles to
  resize, arrow keys to nudge; edit every field in the inspector (page
  pickers, colour picker, hex or decimal) or the raw bytes; duplicate,
  reorder, delete; undo/redo. Pages: add, rename, duplicate, delete,
  renumber (updates every reference: Pic_Next, Pic_On, keypad and popup
  pages, CFG boot page), replace the picture with any image. VP table with
  overlap checks. Simulator: click through pages, VPs editable, event log.

- **M3** (done): picture editing. **Picture** mode next to Controls and
  Simulate. Each page can have layers: image (PNG/JPG/BMP/GIF/WebP/SVG,
  scaled), rectangle (rounded corners, gradient, inner border), ellipse,
  line, text (system fonts or uploaded TTF/OTF/WOFF), and paint (brush and
  eraser strokes). Every layer has visibility, lock, opacity and order. Tools:
  select/move/resize, draw shapes by dragging, text, brush, eraser,
  eyedropper. Every change flattens the layers into the page's 24-bit BMP
  in the same undo step. There's optional ordered dithering to RGB565 and an
  RGB565 preview. **Create pressed variant** copies the page (layers
  included) and makes it the `Pic_On` picture of the page's buttons.

  Imported pictures have no layers until you first change them; then the
  original becomes a locked bottom layer, and it flattens back to exactly
  the same pixels (tested), so only pages you edit change. Layer sources
  live in the project as `art/` assets and are never exported to DWIN_SET.

### Keyboard

| Key | |
|---|---|
| Arrows / Shift+arrows | move the selected control 1 / 10 px |
| Delete, Backspace | delete it |
| Ctrl+D | duplicate it |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | undo, redo |
| Esc | deselect |
| Picture mode: V R O L T B X I | select, rectangle, ellipse, line, text, brush, eraser, eyedropper |
| Picture mode: arrows, Delete, Ctrl+D | nudge, delete, duplicate the selected layer |

### Simulator and the host

The screen's own page jumps (`Pic_Next`) always work. Projects like
DGUS-reloaded don't use them: their buttons send a key code, and the printer
service switches pages. **Host rules** in the Simulator panel stand in for
that: "when VP X is written, go to page <value>" or "…to page P when the
value is V". For DGUS-reloaded the rules (VPs 0x2000/0x2002/0x2003, see
`dgus_lcd/firmware/dgus_reloaded/vars_in.cfg`) are detected automatically.
Editing them saves your own set in the project. Double-click in edit mode
follows them too.

### Popups and keypads

Popup menus (touch 0x01) and number/text inputs with a keypad page work like
on the screen: the menu's cut area is pasted over the page, its own touch
keys (in the menu page's coordinates) answer, `0x00FF` cancels, any other
key code is written to the VP; the pressed key flashes from its `Pic_On`
picture. Keypads take digits, `.`, `-`, `0xF2` backspace, `0xF0` cancel and
`0xF1` enter, and show what's typed at the input's cursor. Touches outside
an open popup are ignored. Inputs without a keypad page fall back to a
browser prompt.

### Simulator limits

Apart from host rules it models the screen, not the printer service: VPs
only change when you press controls or type values in the panel. RTC,
text-scroll and graphics aren't simulated. Text is drawn with the browser's monospace
font, not the screen's HZK fonts.

```sh
cd editor
npm install
npm test            # vitest: golden round trips + Python cross-check
npm run test:pi     # the same on the Pi: memory-capped, one worker (use this there)
npm run dev         # dev server on http://<pi-ip>:5173 (listens on the LAN)
npm run preview     # serve the built dist/ on http://<pi-ip>:4173
npm run build       # -> dist/index.html, one self-contained file (committed);
                    #    open it from disk or serve it from anywhere
npm run fixtures    # regenerate test/fixtures from dgus_lcd/screen_files.py
```

## Running tests on the Pi

The Pi has 1 GB shared with Klipper, and parallel test workers have frozen
it. `npm run test:pi` (`scripts/test-pi.sh`) runs vitest with one worker in
a `systemd-run --user` scope capped at 280 MB, so the kernel kills the tests
rather than the board stalling. It refuses to start with less than 300 MB
available (stop `npm run dev` first if needed). `tsc` 7 is a Go binary;
run it with `GOMEMLIMIT=150MiB` (as the script does) or it grows into the
cap and thrashes.

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
| `src/core/controls/describe.ts` | field tables for every touch/display control type (V4.3 guide ch. 7–8), bounds, field read/write |
| `src/core/controls/geometry.ts`, `templates.ts` | move/resize by rewriting position fields; new-control templates |
| `src/core/project/ops.ts`, `vp.ts` | page and control edits, page renumbering; VP usage, overlaps, allocation |
| `src/core/sim/simulator.ts` | VP memory, touch actions, what displays show |
| `src/core/art/` | layer model, Canvas2D renderer (any implementation), RGB565 dithering, flatten/pressed-variant ops |
| `src/core/project/` | project model, `decompile` (DWIN_SET → project), `compile` (project → DWIN_SET), blank template |
| `src/io/` | `.dgusproj` zip, DWIN_SET zip/folder import, IndexedDB store |
| `src/ui/` | Preact app: store + autosave, page list, canvas, inspector |
| `test/` | vitest; `ui.test.tsx` and `picture.test.tsx` render the app in happy-dom; `@napi-rs/canvas` gives the art tests a real Canvas2D |

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

**Data variable (0x10) alignment**: the manuals disagree. The V4.3 guide
says ALI 0 = right, 1 = left. The T5L DGUS II guide 2.921 and the 2016
screen guide say **0 = left, 1 = right, 2 = centred**, with (X, Y) the
upper-left corner of the field for every alignment. The field is
(integer digits + point + decimals + unit) × Font_X wide and 2 × Font_X
high. DGUS-reloaded's home page confirms the T5L/2016 reading: its
temperature fields only fit between the printed "/" and "°C" that way
(`test/datavar.test.ts`).

**ASCII HZK**: for every even height h = 8…128 (w = h/2), 128 glyphs (0x00–0x7F) of `ceil(w/8)·h` bytes each, 1 bpp, MSB = leftmost pixel. 61 sizes add up to exactly 3 082 752 bytes, the size of the file.
