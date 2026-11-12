# DGUS Studio: the screen editor

A browser editor for DWIN DGUS II (T5UID1) screen projects: pages and
their pictures, buttons and displays, icon libraries, fonts and the
screen configuration. You can start from scratch, from the DGUS-reloaded
set, or from any DWIN_SET folder. Developer notes and file formats are in
[editor/README.md](../editor/README.md); the roadmap is in
[EDITOR_PLAN.md](EDITOR_PLAN.md).

## Running it

The editor is a single page, `editor/dist/index.html`. It works three ways:

| How | What you get |
|---|---|
| Open `editor/dist/index.html` from disk | Everything except the screen: export a DWIN_SET zip for the SD card |
| **Bridge on the Pi** (below) | Also: flash over serial, show pages and VP values on the screen, keep projects on the Pi, DGUS-reloaded template |
| `cd editor && npm run dev` | For editor development; with a bridge running, `/api` is passed to it |

### The bridge

```sh
cd ~/moonraker_ender6_lcd
~/dgus-env/bin/python -m dgus_lcd.editor_bridge --host 0.0.0.0
```

It prints the address to open, e.g. `http://192.168.1.90:8090/?token=…`.
Open that exact URL. The token keeps other machines on your network from
using the screen: every request except the info call needs it. The page
keeps the token for the browser tab and removes it from the address bar.
Without `--host` the bridge listens on the Pi itself only, and needs no
token.

| Option | |
|---|---|
| `--port 8090` | HTTP port |
| `--serial /dev/ttyS1`, `-b BAUD` | the screen; the baud defaults to `baud:` in `~/printer_data/config/dgus_lcd.cfg` |
| `--projects ~/dgus_projects` | where "Save to Pi" keeps projects |
| `--token T` / `--no-token` | a fixed token / no token even on the LAN (anyone can then flash the screen) |
| `--force` | use the port even if the dgus_lcd service seems to run |

The serial port is opened only for a flash or a preview, and never while
the `dgus_lcd` service owns it. To use those features:

```sh
sudo systemctl stop dgus_lcd      # the printer screen stops responding
# … flash / preview from the editor …
sudo systemctl start dgus_lcd
```

The toolbar's **Pi** badge is green when the screen is free, amber when the
service has it (hover for details).

## Using the screen from the editor

- **Flash…** compiles the project and uploads it: fonts and icons first,
  then pictures, then the screen restarts. With "only files changed since
  the last flash" (the default) the bridge skips files whose contents it
  has already sent; "Forget what was flashed" sends everything next time.
  A full DGUS-reloaded set takes several minutes (about 30 s per picture);
  changing a few pages takes seconds.
  **T5UID1.CFG and sounds can't go over serial.** Use **Export DWIN_SET**
  and an SD card for those (see FLASHING.txt in the zip).
- **Show on screen** switches the real screen to the page you're editing
  (it shows what was last flashed).
- **Simulate → Mirror to the screen** sends what the simulator does (VP
  writes, page switches) to the real screen, so you can try displays with
  real fonts and icons.
- **Save to Pi** stores the project in `~/dgus_projects`; the start page
  lists those projects, and offers **New from DGUS-reloaded** (the files in
  `vendor/`).

Projects are also kept in the browser (IndexedDB) and can be downloaded as
`.dgusproj` files.

## Recovery

A bad upload can't harm the screen for good: copying a known-good DWIN_SET
to an SD card restores it (`./make_sdcard.sh` builds one). See
"Recovery" in [DGUSTOOL.md](DGUSTOOL.md).
