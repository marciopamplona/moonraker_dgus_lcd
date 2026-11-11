# DGUS II web editor ("dgus-studio") — plan

## Context
Today, screen changes (e.g. the Macros pages) are written as Python scripts
(`dgus_lcd/macros_screen.py`) that patch the compiled DGUS-reloaded files,
because the only official editor is the Windows DGUS tool. Goal: a browser-based
editor that can build a whole T5UID1 HMI project from scratch, or start from a
template / an imported DWIN_SET, then export it for the SD card or flash it to the
screen over serial.

Decisions made:
- **Both**: the format core is TypeScript and runs in the browser (works standalone
  from any static host or `file://`). An optional **Python bridge** on the Pi does
  serial flashing and live preview.
- **T5UID1 first** (DMT48270C043_06WT: BMP, ICO, HZK, 13/14/22 bins, CFG). Everything
  device-specific goes behind a `DeviceProfile` so a T5L profile (ICL/JPEG,
  different sysvars) can be added later.
- **TypeScript + Vite + Preact**. The built `editor/dist/` is committed, so the Pi
  only serves static files (Node isn't on the Pi).
- **v1 = import, page/bitmap editor, controls editor, icons/fonts/config.**

## Guiding principles
1. **Lossless round trip.** Decompiling DWIN_SET and compiling it again must give
   byte-identical files. Control types and fields we don't model yet stay as raw
   bytes (`{kind:"raw", bytes}`), so we never lose data.
2. **Project source ≠ compiled output.** The project keeps lossless sources (PNG
   layers, TTF, WAV, typed control objects). The compiler turns them into
   DWIN_SET. Importing a DWIN_SET is the reverse: it builds "flattened" sources
   (a single bitmap layer per page).
3. **Golden fixtures are already in the repo.** `vendor/DGUS-reloaded-Klipper/project`
   has the compiled DWIN_SET *and* the source BMP folders (`24_icons/`,
   `27_buttons/`, `30_progress_left/`…), so every codec can be checked byte for byte.
   `dgus_lcd/screen_files.py` is the reference for 13/14/BMP/CFG.

## Layout
```
editor/
  package.json, vite.config.ts, tsconfig.json, vitest config
  src/core/            # pure TS, no DOM; also runs under vitest in Node
    profile/t5uid1.ts  # resolution, file ids, sysvar map, control catalogue
    formats/
      touch13.ts       # 13*.BIN   (port of TouchFile / return_key / data_input)
      var14.ts         # 14*.BIN   DGUS_2 indexed (port of VariableFile)
      bmp.ts           # 24-bit BMP read/write (port of Bitmap)
      ico.ts           # DWIN icon library: 256 KB index of 8-byte entries
                       #   (w, h, word address…) + RGB565 data; layout to be
                       #   confirmed against 24_icons.ico vs 24_icons/*.bmp
      hzk.ts           # DWIN font libraries (ASCII multi-size lib like
                       #   0_DWIN_ASC.HZK, and GBK/Unicode 1-bpp libs)
      cfg.ts           # T5UID1.CFG fields (port of cfg_baud/set_cfg_baud + the
                       #   rest from "T5UID1 Application Guide")
      config22.ts      # 22*.BIN SRAM init image (VP -> word values)
      dwinset.ts       # filename conventions (NN_name.ext, page numbers)
    controls/          # typed model + encode/decode per control type
      touch/*.ts       # page key, return key 0x05, data input 0x00, popup
                       #   menu 0x01, incremental 0x02, slider 0x03, others raw
      display/*.ts     # var icon 0x00, anim icon 0x01, slider 0x02, art
                       #   number 0x03, bit icon 0x06, data 0x10, text 0x11,
                       #   RTC 0x12, HEX 0x13, scroll text 0x14, graphics 0x2x…
    project/
      schema.ts        # Project JSON types + version + migrations
      compile.ts       # Project -> Map<filename, Uint8Array>
      decompile.ts     # DWIN_SET files -> Project
      vp.ts            # VP allocator, overlap/conflict checks, symbol names
      validate.ts      # limits (255 vars/page, NAND id clashes, sizes)
    raster/            # layer flattening, RGB565 quantize preview, TTF text
  src/ui/              # Preact app
    App, ProjectTree (pages / icon libs / fonts / audio / config)
    PageCanvas         # zoomable 480x272 stage: background + control overlays,
                       #   select/move/resize, snapping, multi-select
    BitmapEditor       # layers: image, rect/rounded, line, ellipse, text (TTF),
                       #   fill, eyedropper, brush; "pressed" variant pages (Pic_On)
    Inspector          # property panel generated from control descriptors
    IconEditor         # icon libs: import PNGs, reorder, pixel edit, key colour
    FontEditor         # TTF -> HZK: size(s), charset ranges, live preview
    ConfigEditor       # CFG form (baud, orientation, backlight, buzzer…), 22 init table
    VpTable            # every VP in use, its controls, conflicts
    Simulator          # click through pages in the browser: page jumps, key
                       #   codes and VP writes shown in a log, editable fake VP values
    Bridge panel       # connect to Pi, flash, live preview
  src/io/              # .dgusproj (zip: project.json + assets/), DWIN_SET zip
                       #   export, folder import (drag-drop or directory picker)
  templates/           # blank-480x272, dgus-reloaded (made by decompile)
  test/                # vitest golden tests against vendor/ + Python fixtures
  dist/                # committed build output
dgus_lcd/editor_bridge.py   # optional Pi bridge
```
Dependencies stay small: preact, @preact/signals, fflate (zip), opentype.js (or
canvas `FontFace`) for TTF rasterising. Undo/redo is a command stack on the project
store.

## Project model (summary)
`Project { version, profile:"t5uid1", screen:{w,h,rotation}, cfg:{…},
pages:[{id, name, background:{layers[]}, pressed?:{layers[]}, touch[], display[]}],
iconLibs:[{fileId, name, icons:[{name, png, keyColor}]}],
fonts:[{fileId, kind, source:{ttf, size, ranges} | raw}], audio:[{id, wav}],
sramInit:[{vp, words}], symbols:{name -> vp}}`.
Each control is `{type, rect, props…, vpSymbol?}`, built from a descriptor table:
the same table drives encode/decode, the Inspector form, and how the simulator
renders it.

## Pi bridge (`python -m dgus_lcd.editor_bridge`)
- Stdlib `http.server` (no new deps). It serves `editor/dist/` plus a small JSON API:
  `GET /api/info` (screen versions via `dgus_device`), `POST /api/flash` (DWIN_SET
  zip, upload via the existing dgustool upload path, progress via SSE),
  `POST /api/page`, `POST /api/vp` (live preview: jump to page / write VP),
  `GET/PUT /api/projects/*` (save projects under `~/dgus_projects`).
- Reuses `dgus_lcd/dgus_device.py` upload and `dgustool._service_running()`, and
  refuses to flash while the `dgus_lcd` service holds ttyS1 (it tells you to stop it).
- Binds to 127.0.0.1 by default; `--host 0.0.0.0` to reach it from the LAN.
- SD-card export stays in the browser (zip), equivalent to `sdcard.py`/`make_sdcard.sh`.

## Milestones
- **Step 0 – commit the plan.** Copy this plan to `docs/EDITOR_PLAN.md` on a new
  branch `feat/web-editor` and commit it before any code is written.
- **M0 – scaffold + codecs.** ✅ Done (see editor/README.md for the format findings). Vite/TS/vitest setup. Port touch13, var14, bmp and cfg
  from `screen_files.py`. Reverse-engineer ico, hzk and config22. Golden tests:
  parse→build is byte-identical for every file in the vendored DWIN_SET. A Python
  script (`editor/test/gen_fixtures.py`) emits JSON from `screen_files.py` to
  cross-check the decoded fields.
- **M1 – import + viewer.** ✅ Done, plus an IndexedDB autosave (requested 2026-11-11). Open a DWIN_SET folder or zip, decompile it into a
  Project, browse pages with control overlays, save/load `.dgusproj`, export a
  DWIN_SET zip. Done when import→export of DGUS-reloaded (and our Macros-patched
  set) is byte-identical.
- **M2 – controls editor.** Canvas placement/resizing, Inspector, VP table +
  conflict checks, undo/redo, page add/remove/reorder (renumbers references),
  simulator.
- **M3 – bitmap editor.** Layers, shapes, TTF text, image import with resize, a
  pressed-state variant, RGB565 preview.
- **M4 – icons, fonts, config.** Icon library editor + ICO encoder, TTF→HZK
  generator, CFG form, 22_config table. Templates: blank and DGUS-reloaded.
- **M5 – bridge.** `editor_bridge.py`, flash with progress, live page/VP preview,
  project storage on the Pi, docs (`docs/EDITOR.md`, README section).
- **Later:** T5L profile, importing the Windows `DWprj.hmi` (INI-style; maps page
  names), collaborative/hosted builds.

## Risks / open items
- ICO/HZK/22 layouts aren't in our docs in full. Mitigation: work them out from the
  vendored pairs (source BMP ↔ .ico, TTF guess ↔ 0_DWIN_ASC.HZK), and fall back
  to treating them as raw passthrough until they're verified.
- Control fields seen nowhere in DGUS-reloaded: encode them from the DGUS V4.3 /
  T5UID1 guides, and only mark them "verified" once tested on the real screen.
- Flashing a full set over serial is slow (~30 s per BMP). The bridge should upload
  only the files that changed since the last flash (hash cache).

## Verification
- `cd editor && npx vitest run`: golden round trip for every vendored file, plus
  the Python cross-check fixtures.
- Existing `python -m pytest tests/` keeps passing (the bridge gets its own test
  using `tests/fake_screen.py`).
- Manual: `npm run build`, then `python -m dgus_lcd.editor_bridge`, then open it in
  a browser. Import the vendored DWIN_SET, export it, and check with
  `diff -r` that it's identical. Then add a button and a text variable on a new
  page, flash through the bridge (with the service stopped), and check on the real
  Ender-6 screen that the page shows and the touch sends the expected VP/key.
