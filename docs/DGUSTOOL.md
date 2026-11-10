# dgustool: screen info, control and upload over serial

`dgustool` is a command-line front end for `dgus_lcd/dgus_device.py`, a
Python port of the features of
[DgusDude](https://github.com/UdiAzulay/DgusDude), a .NET library. With it
you can:

- read device information
- drive pages, touch, backlight, clock and audio
- read and write any variable
- **upload DWIN_SET files without opening the printer to reach the SD card
  slot**

The protocol details are in [PROTOCOL.md](PROTOCOL.md).

## Before you start

The tool needs the serial port to itself, so stop the service first and
start it again when you're done:

```sh
sudo systemctl stop dgus_lcd
~/dgus-env/bin/python -m dgus_lcd.dgustool info
sudo systemctl start dgus_lcd
```

If the service is running, the tool refuses to start (exit code 2). Global
options go before the command:

- `-p /dev/ttyS1`, `-b 115200`: port and baud rate
- `--crc`: the screen has UART CRC enabled
- `--no-ack`: don't wait for `OK` replies
- `--timeout 1.0`: reply timeout in seconds
- `-v`: log every frame

## Commands

| Command | What it does |
|---|---|
| `info [--json]` | device ID, versions, RTC, page, VCC, CPU temperature, ADC, SD folder, config, backlight, touch |
| `read ADDR [WORDS]` | hex dump of VPs, e.g. `read 0x1000 16` |
| `write ADDR HEX…` | write bytes, e.g. `write 0x1000 0001 0002` |
| `page [ID]` | show or switch the current page |
| `save-page ID` | save what's on screen as picture ID |
| `reset [--full]` | reboot the screen |
| `play START [COUNT [VOLUME]]` | play WAV sections (volume 0–255) |
| `beep MS` | buzzer, only on screens configured for buzzer mode |
| `brightness ON [--standby N --timeout MS]` | backlight 0–100 |
| `rtc [ISO-TIME] [--hardware]` | set the clock (default: now) |
| `touch X Y [--mode click/press/release/hold]` | simulate a touch (coordinates at 0° rotation) |
| `control PAGE N KEYCODE on/off` | enable or disable touch control N on a page |
| `config [--rotation 0/90/180/270] [--touch-sound on/off] [--standby-backlight on/off] [--sd-enabled on/off]` | show or change 0x80 config (lost at power-off) |
| `monitor` | print every touch upload (VP + value), handy to map buttons |
| `nand-read OFFSET LENGTH -o FILE` | dump font space; only 16–32 MB (font ids 0x40–0x7F) can be read on T5UID1 |
| `upload PATH… [--dry-run] [--verify] [--no-reset] [--keep-going] [--allow-os] [--screen-size WxH]` | upload files or a whole DWIN_SET folder, then reset |

## Uploading DWIN_SET over serial

The tool puts each file where the screen's SD loader would, following the
T5UID1 naming rules: the leading number in the file name is its id.

| File | Destination |
|---|---|
| `NN*.BIN`, `.HZK`, `.DZK`, `.ICO` | NAND font space at `NN × 256 KB`, written in 32 KB blocks. Includes `13*.BIN` (touch), `14*.BIN` (display), `22*.BIN` (SRAM init) and fonts/icons |
| `NN*.LIB` | NOR database at `NN × 2 Kwords` (id 0–79) |
| `NN*.JPG` | decoded into picture NN (≤ 64 KB, ≤ screen size) |
| `NN*.BMP` | 24/32-bit BMP of exactly 480×272, converted to RGB565, written to the frame buffer and saved as picture NN |
| `DWINOS*.BIN` | DWIN OS code. Only with `--allow-os` |

These are skipped, and the tool says why:

- `T5UID1*.BIN` (GUI core) and `T5UID1*.CFG`: these can only be loaded
  from the SD card.
- `.WAV`: the layout of the audio space isn't documented, and DgusDude's
  own WAV upload doesn't work.
- `.ICL`: T5L only.

Fonts and icons are uploaded first, then pictures, then the screen is
reset so it reloads 13/14/22.

```sh
sudo systemctl stop dgus_lcd
cd ~/moonraker_ender6_lcd
~/dgus-env/bin/python -m dgus_lcd.dgustool upload --dry-run /path/to/DWIN_SET
~/dgus-env/bin/python -m dgus_lcd.dgustool upload /path/to/DWIN_SET
sudo systemctl start dgus_lcd
```

Things to know:

- **Speed:** at 115200 baud the link moves roughly 10 KB/s, so a 256 KB
  font takes about 30 s and a full BMP picture about 30 s.
- **Verify:** `--verify` reads data back where the screen allows it. That's
  the NOR database and font ids 0x40–0x7F; other font ids can't be read
  back on T5UID1.
- **BMP:** must match the panel's native orientation, 480×272. The screen
  uses the image as given, so if your project is set to a rotated display,
  rotate the image the same way first. JPEGs follow the same rule.
- **Recovery:** if an upload goes wrong, the screen can always be
  re-flashed from an SD card (FAT32, 4 KB clusters, `DWIN_SET` folder),
  because the GUI core and CFG are never touched by this tool.
- **Status:** DgusDude was only tested on a T5UID1, and this port has only
  been tested against the simulator in `tests/fake_screen.py`. Try a
  single small file (one picture, or a `--dry-run`) before a full folder.

## Python use

```python
from dgus_lcd.dgus_device import DGUSDevice
from dgus_lcd import dgus_protocol as p

with DGUSDevice("/dev/ttyS1") as dev:
    print(dev.info())
    dev.page = 3
    dev.send(p.cmd_brightness(60))
    key = dev.wait_key(timeout=10)       # next button press, or None
    dev.upload_file("DWIN_SET/13TouchFile.bin")
    dev.reset()
```

Other methods:

- `read_vp`, `write_vp` (split into frames automatically) and `wait_done`
- `touch`, `set_control`, `set_config`, `save_page`
- `nand_write` / `nand_read`, `nor_write` / `nor_read`
- `upload_jpeg`, `upload_pixels`
- `plan_upload(dir)` and `classify(name)` for DWIN_SET folders

## How it differs from DgusDude

- **Picture saving:** BMP pictures are saved with `0x84` mode 2 (save page),
  as the T5UID1 guide says. DgusDude used `0xA6` there.
- **WAV:** not supported (see above).
- **Format (erase all):** not included.
- **K600 and Mini DGUS:** not supported, since they're unrelated to this
  screen.
