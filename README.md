# moonraker_ender6_lcd

Runs the [DGUS-reloaded-Klipper](https://github.com/Desuuuu/DGUS-reloaded-Klipper)
touchscreen firmware with **stock Klipper**. A small Python service on the SBC
talks to the screen over a UART (`/dev/ttyS1`) and to Klipper through
Moonraker's websocket API. You don't need Desuuuu's Klipper fork.

The UI logic (pages, variables, routines) is the fork's own
`klippy/extras/t5uid1/dgus_reloaded/*.cfg`, used unchanged except that the boot
page goes straight to the print status page when a print is running. The
`t5uid1` runtime that ran those files inside Klippy is ported to
`dgus_lcd/engine.py`.

## Screen protocol and tools

The screen is a DWIN DMT48270C043_06WT (T5UID1, DGUS II). Its serial
protocol and system variables are documented in
[docs/PROTOCOL.md](docs/PROTOCOL.md) and implemented in
`dgus_lcd/dgus_protocol.py`.

`dgustool` ([docs/DGUSTOOL.md](docs/DGUSTOOL.md)) reads device info,
controls the screen and uploads DWIN_SET files over the serial port, so no
SD card is needed. Stop the service while you use it:

```
sudo systemctl stop dgus_lcd
~/dgus-env/bin/python -m dgus_lcd.dgustool info
sudo systemctl start dgus_lcd
```

A **Macros** screen (More → Macros) lists your Klipper macros and runs
them. It needs a small screen update; see [docs/MACROS.md](docs/MACROS.md).

### SD card image

`./make_sdcard.sh` builds a complete, ready-to-copy `build/sdcard/DWIN_SET`.
It contains the stock DGUS-reloaded 1.0.2 files from `vendor/`, the Macros
and Parameters pages, and a `T5UID1.CFG` set to 250000 baud. Nothing is
downloaded. Use `--baud 115200` to keep the stock rate. Flashing steps are written to `build/sdcard/FLASHING.txt`.
With the 250000 CFG, set `baud: 250000` in `dgus_lcd.cfg` after flashing.

Tests: `~/dgus-env/bin/python -m unittest discover -s tests -t .`

## Wiring

Screen TX → SBC RX, screen RX → SBC TX, GND, 5V. 115200 baud.

## Install

```
./install.sh
```

This creates `~/dgus-env` and installs `dgus_lcd.cfg` and `dgus_macros.cfg`
into `~/printer_data/config/`. It also installs and starts the `dgus_lcd`
systemd service and adds it to `moonraker.asvc`, so you can restart it from
Mainsail.

Optional: add `[include dgus_macros.cfg]` to `printer.cfg` to get `M300` and
`DGUS_PLAY_SOUND`, which play sounds on the screen.

Logs are written to `~/printer_data/logs/dgus_lcd.log`. For a debug run in the
foreground:

```
sudo systemctl stop dgus_lcd
~/dgus-env/bin/python -m dgus_lcd -v
```

## How it differs from the Klippy module

| Klippy module                         | This service                                    |
|---------------------------------------|-------------------------------------------------|
| `DGUS_PRINT_START` / `DGUS_PRINT_END` | Detected from `print_stats.state` changes       |
| `M73` progress                        | `display_status.progress`                       |
| `M117` message                        | `display_status.message`                        |
| `M300` / `DGUS_PLAY_SOUND`            | Macros in `dgus_macros.cfg` (`RESPOND PREFIX=dgus`) |
| `is_busy()` (toolhead lookahead)      | `idle_timeout.state == "Printing"` or G-code from the screen still running |
| Probe progress icons                  | Counts `probe at ... is z=` console lines       |
| Volume/brightness saved to printer.cfg| Saved to `~/printer_data/dgus_lcd/state.json`   |

The service also detects when the screen is power-cycled or reconnected, and
re-initializes it. When Klipper is in shutdown or error, or Moonraker is down,
the screen shows the reason.

## License

GPLv3, the same as the original project. The UI config and parts of the engine
are © Desuuuu.
