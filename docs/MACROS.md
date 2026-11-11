# Macros screen

The Macros screen adds a **Macros** tile to the touchscreen's "More" page
(Settings → More). It opens a page that lists your Klipper `[gcode_macro]`s,
6 at a time, and runs the one you tap.

```
┌──────────────────────────────────────────────┐
│ ←  Macros                     Running PARK   │  title + message bar
├──────────────────────────────────────────────┤
│     ┌────────┐  ┌────────┐  ┌────────┐       │
│     │ CLEAN  │  │  LOAD  │  │  PARK  │       │
│  <  │ NOZZLE │  │FILAMENT│  │        │   >   │  < > change page
│     └────────┘  └────────┘  └────────┘       │
│     ┌────────┐  ┌────────┐  ┌────────┐       │
│     │PURGE   │  │ UNLOAD │  │        │  1/2  │
│     └────────┘  └────────┘  └────────┘       │
└──────────────────────────────────────────────┘
```

## Behaviour

- **Which macros:** every `[gcode_macro]` Klipper has loaded, sorted by name.
  Names starting with `_` are hidden, as are any listed in `macro_exclude`
  in `dgus_lcd.cfg`:
  ```ini
  [dgus_lcd]
  macro_exclude: M300, DGUS_PLAY_SOUND, PAUSE, RESUME, CANCEL_PRINT
  ```
  The list is read again each time the page opens, so new macros appear
  after a Klipper restart. There's no need to touch the screen.
- **Labels:** `_` becomes a space and names wrap onto 2 lines of 12
  characters. If a name is longer than that, the second line ends in `~`.
- **Tap:** a macro without parameters runs at once and shows "Running
  NAME" in the message bar. A macro that takes parameters opens the
  **Parameters** page first (see below).
  - While a print is running or paused, it shows "Not while printing"
    instead.
  - While other G-code from the screen is still running, it shows "Busy".
- **< >:** step through pages, wrapping around at the ends. The page number
  is shown bottom right.

## Parameters

Parameters are found by reading the macro's G-Code template, the same way
Mainsail does: every `params.NAME` (or `params["NAME"]`), with its
`|default(...)` and `|int`/`|float` filters.

```
┌──────────────────────────────────────────────┐
│ ←  Parameters                                │
│                  PRINT_DOT                   │
│  X                ┌──────────────────────┐   │
│                   │ (125)                │   │  (125) = macro default
│  Y                ├──────────────────────┤   │
│                   │ 140                  │   │  140 = you typed it
│  Z                ├──────────────────────┤   │
│                   │ 0.25                 │   │
│  TEMP             ├──────────────────────┤   │
│                   │ -                    │   │  - = macro decides
│  [ < ]  1/2    [Reset]  [ Run ]  [ > ]      │
└──────────────────────────────────────────────┘
```

- **Entering a value:** tap a value box to open the screen's number keypad.
  Values have up to 5 integer digits and 2 decimals, and can be negative
  with the ± key. `|int` parameters are rounded.
- **Values shown:**
  - `(125)` is the literal default from `|default(125)`.
  - `-` means the default is an expression the macro works out itself,
    e.g. `default(printer.save_variables...)`.
- **Run:** sends only the values you entered, e.g.
  `PRINT_DOT Y=140 Z=0.25`, so the macro keeps its own defaults for the
  rest. Like the tiles, it's refused while printing or while the screen
  is busy.
- **Reset:** forgets the values you entered.
- **< >:** step through the parameters, 4 per page.
- **←:** back to the macro list.
- **Text parameters** (`|string`, or a quoted default) are listed but
  can't be edited, because the screen has no text keyboard. The macro uses
  its default for them.

## Installing

The service side is already part of the service: the page definitions are
in `dgus_lcd/firmware/dgus_reloaded/macros.cfg`. Restart the service to load
them:

```sh
sudo systemctl restart dgus_lcd
```

The screen also needs four updated files: the new page and the tile on the
More page. They are **committed, ready to flash, in `screen/macros/`**:

| File | Change |
|---|---|
| `13_touch.bin` | Macros tile touch area on page 18; back, 6 tiles and < > on page 21; back, 4 keypad inputs and 4 buttons on page 22 |
| `14_variable.bin` | 12 label lines, page number and message bar on page 21; macro name, 4 parameter names and values, page number and message bar on page 22 |
| `018_settings_menu2.bmp` | "More" page with the Macros tile (bottom middle) and its caption |
| `021_macros.bmp` | the new page background with its "Macros" title |
| `022_macro_params.bmp` | the Parameters page (value boxes, Reset/Run, < >) |

The `.png` files next to them are previews. The macro labels are drawn by
the screen, so they aren't in the previews.

The files are generated from the stock DGUS-reloaded-Klipper 1.0.2 files by
`dgus_lcd/macros_screen.py`. To rebuild them, e.g. after changing the
script:

```sh
cd ~/moonraker_ender6_lcd
~/dgus-env/bin/python -m dgus_lcd.macros_screen --preview                    # -> build/dgus_macros/ (not in git)
~/dgus-env/bin/python -m dgus_lcd.macros_screen --out screen/macros --preview  # update the committed copy
```

The stock input is the vendored
`vendor/DGUS-reloaded-Klipper/project/DWIN_SET`, so nothing is downloaded;
pass `--release DIR` to use another copy. Building needs Pillow (`~/dgus-env/bin/pip install pillow`);
the service itself doesn't. The test `test_prebuilt_is_current` fails if
`screen/macros/` no longer matches a fresh build.

### Flash over serial

```sh
sudo systemctl stop dgus_lcd
cd ~/moonraker_ender6_lcd
~/dgus-env/bin/python -m dgus_lcd.dgustool upload --dry-run screen/macros
~/dgus-env/bin/python -m dgus_lcd.dgustool upload screen/macros
sudo systemctl start dgus_lcd
```

This takes a couple of minutes, mostly for the two pictures. The screen
resets at the end.

### Or flash from the SD card

1. Run `./make_sdcard.sh --baud 115200` to build `build/sdcard/DWIN_SET`
   (the `vendor/` DWIN_SET with the Macros files already in it). Leave out `--baud`
   to also switch the screen to 250000 baud (see PROTOCOL.md, "Baud
   rate").
2. Copy that `DWIN_SET` folder to a FAT32 card formatted with 4 KB
   clusters.
3. Insert the card into the screen and power-cycle the printer.
4. When the screen shows it has finished, remove the card and power-cycle
   again.

### If something goes wrong

Re-flash the unmodified release `DWIN_SET` from the SD card. The serial
upload never touches the screen's core firmware, so this always recovers
the screen.

Things that are untested on real hardware:

- **Serial picture upload:** it writes into the frame buffer and then saves
  it as a picture. If a picture comes out with leftovers from the page that
  was showing, flash the two `.bmp` files from the SD card instead.
- **Release version:** the build assumes the screen runs the 1.0.2 release
  files. If yours has an older DWIN_SET, flash the full 1.0.2 set from SD
  first.

## How it works

| VP | Use |
|---|---|
| `0x2000` = 21 | Macros tile on page 18 → the existing page-switch input |
| `0x2000` = 18 | back arrow on page 21 |
| `0x51A0` | key: 1–6 tile, 7 previous, 8 next (`__macros_key`) |
| `0x5110 + (tile×2 + line)×8` | label lines, 12 characters (`macro_label_T_L`) |
| `0x5100` | page number `n/m` |
| `0x5200` | Parameters page: macro name |
| `0x5220 + row×0x10` | parameter names (`param_name_R`) |
| `0x5260 + row×0x10` | parameter values (`param_value_R`) |
| `0x52A0` | parameter page number |
| `0x52B0 + row×2` | keypad input, int32 = value × 100 (`__param_input_R`) |
| `0x52C0` | key: 1 previous, 2 next, 3 run, 4 reset (`__param_key`) |
| `0x3000` | the firmware's message bar |

- **Building the screen files:** `dgus_lcd/macros_screen.py` uses
  `dgus_lcd/screen_files.py`, a reader/writer for the compiled `13*.BIN`
  touch file, the `14*.BIN` variable file (DGUS_2 layout) and 24-bit BMPs.
  The touch and variable files round-trip byte for byte.
- **Backgrounds:** the new page reuses the Settings page's 6-tile grid with
  the icons erased. The More-page tile is a blank tile plus a drawn icon.
- **Fonts:**
  - The original titles and captions are Segoe UI, baked into the page
    images. The static "Macros" title and caption are drawn the same way,
    with **Selawik** (`screen/fonts/`). Selawik is Microsoft's
    open-licensed (OFL) Segoe UI substitute, and it matches size, colour
    and position.
  - Macro names change, so the screen draws them at runtime with its
    built-in font, the same one used for temperatures and messages.
- **Keypad inputs:** they are standard DGUS "data input" controls. The
  encoder reproduces the firmware's own temperature-input entries byte for
  byte, with the same keypad page (202).
- **Parameter parsing:** `dgus_lcd/macro_params.py` reads the macro
  templates (from `configfile.settings`, which the service already
  subscribes to) and builds the command line.
- **Page logic:** `macros.cfg` holds the page logic as ordinary
  `t5uid1_page`/`t5uid1_var` sections. To change the behaviour, copy a
  section into `dgus_lcd.cfg` and edit it there.
