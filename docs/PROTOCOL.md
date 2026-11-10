# DWIN DGUS II serial protocol (DMT48270C043_06WT)

This page describes the UART protocol of the Ender-6 touchscreen and how
`dgus_lcd/dgus_protocol.py` implements it.

The screen is a DWIN DMT48270C043_06WT: 4.3", 480×272, resistive touch,
T5L ASIC running DGUS II. The reference manual is
[`T5L_DGUSII-Application-Development-Guide-V2.921.pdf`](T5L_DGUSII-Application-Development-Guide-V2.921.pdf):
chapter 4 covers the protocol (p. 44) and chapter 5 the system variables
(p. 48). Every byte example on this page comes from that guide and is
checked in `tests/test_dgus_protocol.py`.

## Link

- UART2, 8N1, 115200 baud by default, TTL levels (10-pin 1.0 mm connector,
  5 V supply).
- On this machine: `/dev/ttyS1`. Screen TX → SBC RX, screen RX → SBC TX.
- All multi-byte values are **big-endian**, except the CRC (see below).
- The screen is variable-driven: everything, including page changes,
  backlight and sound, is done by reading and writing 16-bit words in its
  variable space (VP addresses 0x0000–0xFFFF).

## Frame format

```
5A A5 | LEN | CMD | DATA ...      | CRC lo CRC hi
header  1 B   1 B   up to 249 B     optional
```

- `LEN` counts `CMD` + `DATA`, plus 2 if CRC is on. The maximum is 255.
- CRC is **CRC-16/MODBUS** (poly x¹⁶+x¹⁵+x²+1, init 0xFFFF, reflected),
  computed over `CMD` + `DATA` and sent **low byte first**.
  `83 00 0F 01` → `ED 90`.
- CRC mode is set by bit 7 of CFG-file byte 0x05 (`T5L_CFG.CFG` on the SD
  card). It can also be changed at runtime through VP 0x000C, but that
  setting is lost at power-off. Both ends must agree. This screen runs with
  **CRC off**.

## Instructions

| CMD  | Request DATA                         | Reply                                   | Use |
|------|--------------------------------------|-----------------------------------------|-----|
| 0x82 | `addr(2)` + words                    | `82 4F 4B` ("OK")                       | Write variables |
| 0x83 | `addr(2)` + `count(1)` (words)       | `83 addr(2) count(1) data(count×2)`     | Read variables |
| 0x80 | `page(1)` + `reg(1)` + bytes         | `80 4F 4B`                              | Write OS registers (debug) |
| 0x81 | `page(1)` + `reg(1)` + `nbytes(1)`   | `81 page reg n data(n)`                 | Read OS registers (debug) |
| 0x84 | `CH_Mode(1)` + samples               | `84 4F 4B`                              | Append curve samples |
| 0x86 | `daddr(3)` + data                    | `86 4F 4B`                              | Write via double-word address |
| 0x87 | `daddr(3)` + `count(1)` (dwords)     | `87 daddr count data`                   | Read via double-word address |

Notes:

- The guide calls the 0x83 length a "byte length", but it is really a **word
  count**: up to 0x7D with CRC off, 0x7C with CRC on (so the reply still
  fits in 255 bytes).
- **Touch upload:** when a touch control changes a variable that has
  "data auto-upload" enabled in the screen project, the screen sends an
  unsolicited frame that looks exactly like a 0x83 reply:
  `5A A5 06 83 1001 01 000A` means VP 0x1001 now holds 0x000A. This is how
  every button press reaches the service.
- Writes are always acknowledged with `4F 4B`. The service doesn't wait for
  the ACK, since the link is full duplex.
- 0x80/0x81 register pages: 0x00–0x07 are the DWIN OS data registers
  R0–R255, and 0x08 holds the interface registers.
- `CH_Mode` is a bit mask of the channels present. Samples are interleaved
  per sample, lowest channel first. Example: `83` = channels 0, 1 and 7.
- 0x86/0x87 are only documented in the instruction table. Their 3-byte
  address encoding follows the guide's range "0x000000–0x00FFFF", but
  hasn't been tested on hardware.

## System variables (0x0000–0x0FFF)

Lengths are in words. A first byte of `5A` usually means "do it once": the
screen clears it when the action is done, and you can poll for that.

| VP     | Name (constant)                   | R/W | Len | Data |
|--------|-----------------------------------|-----|-----|------|
| 0x0004 | `VP_SYSTEM_RESET`                 | W   | 2   | `55AA 5AA5` reboots the screen |
| 0x0006 | `VP_OS_UPDATE`                    | W   | 2   | DWIN OS / 8051 code update |
| 0x0008 | `VP_NOR_FLASH_RW`                 | W   | 4   | `mode(5A read / A5 write) flash_addr(3) vp(2) words(2)` |
| 0x000C | `VP_UART2_CONFIG`                 | W   | 2   | `5A mode div(2)`, where mode bit 7 = CRC and div = 206438400 / (64 × baud) |
| 0x000E | `VP_VERSION_EXT`                  | R   | 2   | `00 CTP GUI OS` |
| 0x000F | `VP_VERSION`                      | R   | 1   | `GUI OS` (this screen: v34 / v32) |
| 0x0010 | `VP_RTC`                          | R/W | 4   | `YY MM DD WW hh mm ss 00` (hex, not BCD; week 0 = Sunday) |
| 0x0014 | `VP_PIC_NOW`                      | R   | 1   | current page id |
| 0x0015 | `VP_GUI_STATUS`                   | R   | 1   | 0 idle, 1 busy |
| 0x0016 | `VP_TP_STATUS`                    | R/W | 4   | `flag(5A = new) state x(2) y(2) 0000`. State: 0 released, 1 pressed, 2 lifted, 3 pressing |
| 0x0031 | `VP_LED_NOW`                      | R   | 1   | `5A brightness` |
| 0x0032 | `VP_AD_VALUES`                    | R   | 8   | AD0–AD7 |
| 0x007A | `VP_LCD_HOR`                      | R   | 1   | 480 |
| 0x007B | `VP_LCD_VER`                      | R   | 1   | 272 |
| 0x0080 | `VP_SYSTEM_CONFIG`                | R/W | 2   | `5A sens mode flags`. Flags: .7 CRC (ro), .5 load 22 file (ro), .4 auto upload, .3 touch sound, .2 backlight standby, .1-0 rotation |
| 0x0082 | `VP_LED_CONFIG`                   | R/W | 2   | `on standby time(2, ×10 ms)`, brightness 0–100 |
| 0x0084 | `VP_PIC_SET`                      | R/W | 2   | `5A 01 page(2)` switches page |
| 0x0086 | `VP_PWM0_SET`                     | R/W | 2   | `5A div precision(2)` |
| 0x0088 | `VP_PWM1_SET`                     | R/W | 2   | same as PWM0 |
| 0x0092 | `VP_PWM0_OUT` / 0x0093 `VP_PWM1_OUT` | R/W | 1 | duty (high-level width) |
| 0x009C | `VP_RTC_SET`                      | W   | 4   | `5AA5 YY MM DD hh mm ss` (hardware RTC) |
| 0x00A0 | `VP_MUSIC_PLAY`                   | R/W | 4   | Buzzer: `00 time/8ms`. WAE: `segment count volume(0–0x40) status` |
| 0x00AA | `VP_EXT_FLASH`                    | R/W | 6   | 16 MB SPI flash / font operations |
| 0x00B0 | `VP_TOUCH_CONTROL`                | W   | –   | `5AA5 page(2) control(1) keycode(1) mode(2)`. Mode: 0 off, 1 on, 2 read, 3 write |
| 0x00D4 | `VP_TP_SIMULATE`                  | W   | 4   | `5AA5 mode(2) x(2) y(2)`. Mode: 1 press, 2 release, 3 hold, 4 click |
| 0x00D8 | `VP_POINTER_ICON`                 | W   | 4   | `5A icl icon(2) x(2) y(2)` |
| 0x00DC | `VP_WAE_SWITCH`                   | W   | 2   | `5A 00 wae_id(2)` |
| 0x00DE | `VP_ICL_SWITCH`                   | W   | 2   | background ICL switch |
| 0x00E0 | `VP_MEMORY_CRC`                   | R/W | 2   | font / OS code CRC check |
| 0x00FC | `VP_DGUS_STOP`                    | W   | 2   | `55AA 5A5A` touch off, `0000 0000` touch on, `55AA 5AA5` stop refresh |
| 0x00FE | `VP_UART1_DOWNLOAD`               | W   | 2   | `5AA5` high-speed download on UART1 |
| 0x0100 | `VP_FSK_BUS`                      | R/W | 512 | FSK bus devices |
| 0x0300 | `VP_CURVE_STATUS`                 | R   | 16  | per channel: write pointer, length |
| 0x0310 | `VP_CURVE_WRITE`                  | W   | –   | `5AA5 blocks 00`, then blocks from 0x0312: `ch len data…` |
| 0x0400 | `VP_NETWORK`                      | R/W | 256 | WiFi interface |
| 0x0500 | `VP_MULTIMEDIA`                   | R/W | 192 | |
| 0x05C0 | `VP_EXT_MEMORY`                   | R/W | 64  | USB disk etc. |
| 0x0F00 | `VP_VAR_CHANGED`                  | R   | 2   | `5A vp(2) words` of the last upload |
| 0x1000+ | user variables                   |     |     | defined by the screen project. Curve buffers are 0x1000–0x4FFF when curves are used |

The DGUS-reloaded screen firmware uses VPs from 0x1000 up for its own
variables; they are listed in `dgus_lcd/firmware/dgus_reloaded/vars_*.cfg`.

## Python API (`dgus_lcd/dgus_protocol.py`)

The module is pure byte handling with no I/O, so it can be used from tests,
scripts or the service.

**Encoders** return complete frames (`bytes`). Each takes `crc=False`.

```python
from dgus_lcd import dgus_protocol as p

p.read_var(0x000F, 1)              # 5A A5 04 83 00 0F 01
p.write_var(0x1000, b"\x31\x32")   # 5A A5 05 82 10 00 31 32
p.write_words(0x1001, 10, 11)      # 16-bit values, negatives as int16
p.read_reg(0, 0x0A, 4)             # 0x81
p.write_reg(0, 0x0A, b"\x01")      # 0x80
p.write_curve({0: [1, 2], 1: [3, 4]})
p.write_dvar(addr, data); p.read_dvar(addr, n)
p.encode_frame(cmd, body)          # anything else
p.crc16(b"\x83\x00\x0f\x01")       # 0x90ED
```

**System-variable helpers** return `(address, data)`, which you pass to
`p.write_var(*cmd)` or `DGUSSerial.send(cmd)`:

| Helper | Effect |
|---|---|
| `cmd_reset()` | reboot the screen |
| `cmd_page(n)` | switch to page n |
| `cmd_brightness(on, standby=None, timeout_ms=None)` | backlight, 0–100 |
| `cmd_beep(ms)` | buzzer |
| `cmd_play_music(segment, count=1, volume=0x40)` | WAE playback |
| `cmd_rtc_write(dt)` / `cmd_rtc_set(dt)` | software / hardware RTC |
| `cmd_touch(x, y, mode=TOUCH_CLICK)` | simulate a touch |
| `cmd_touch_control(page, control, keycode, CTRL_ENABLE/DISABLE)` | one touch control |
| `cmd_touch_enable(bool)` | all touch on/off |
| `cmd_system_config(flags)` | 0x0080 flags (`CFG_*`) |
| `cmd_uart2(baud=None, crc=False)` | runtime baud / CRC change |
| `cmd_nor_flash(write, flash_addr, vp, words)` | NOR flash ↔ VP copy |
| `cmd_pointer_icon(icl, icon, x, y, show=True)` | icon overlay |

**Decoding:** `FrameParser(crc=False).feed(bytes)` returns a list of
`Frame(cmd, kind, address, data, page)` objects. The parser handles split
reads and leading garbage, and with CRC on it drops bad frames and counts
them in `crc_errors`. `kind` is one of:

- `"ack"`: write reply
- `"var"`: 0x83 reply or touch upload
- `"reg"`: 0x81 reply
- `"dvar"`: 0x87 reply
- `"raw"`: anything else

`Frame.words` gives the data as 16-bit values. There are helper parsers for
common reads: `parse_version`, `parse_touch_status`, `parse_rtc` and
`parse_system_config`.

### Transport (`dgus_lcd/serial_link.py`)

`DGUSSerial(port, baud, on_read, on_open=None, on_frame=None, crc=False)`
owns the port, reopens it when it's lost, and runs `FrameParser` on the
asyncio loop:

- `on_read(address, data)` is called for every `"var"` frame, which is what
  the engine uses.
- `on_frame(frame)` is an optional callback that receives every frame,
  including ACKs and 0x81/0x87 replies.
- `write_var`, `read_var`, `send((addr, data))`, `send_raw(frame)`,
  `set_crc(bool)`.

### Changing baud or CRC at runtime

The screen applies a 0x000C write as soon as it receives it. Send the
command at the old settings, switch the host port right after, then read
VP 0x000F to confirm the link. The change is lost on power-off. To make it
permanent, edit byte 0x05 (CRC) or 0x0A–0x0B (baud) in the CFG file on the
SD card.

## Quick test from the shell

Stop the service first, since only one process can own the port.

```sh
sudo systemctl stop dgus_lcd
~/dgus-env/bin/python - <<'EOF'
import serial, time
from dgus_lcd import dgus_protocol as p
s = serial.Serial("/dev/ttyS1", 115200, timeout=0.5)
s.write(p.read_var(p.VP_VERSION, 1))
time.sleep(0.2)
for f in p.FrameParser().feed(s.read(64)):
    print(f, p.parse_version(f.data) if f.address == p.VP_VERSION else "")
s.write(p.write_var(*p.cmd_beep(200)))
EOF
sudo systemctl start dgus_lcd
```

## Manuals

The PDFs aren't kept in git (they're DWIN's copyright and large). To get
them again:

- T5L DGUS II guide V2.9 (the main reference):
  https://ecdn6.globalso.com/upload/p/1355/source/2026-03/T5L_DGUSII-Application-Development-Guide-V2.921.pdf
- T5L ASIC development guide:
  https://ecdn6.globalso.com/upload/p/1355/source/2024-11/Development-Guide-of-T5L-ASIC-2024-09-25.pdf
- More DWIN guides: https://www.dwin-global.com/development-guide/
- DMG48270C043_06WTR datasheet (closest to this screen):
  https://evelta.com/content/datasheets/353-DMG48270C043_06WTR.pdf
- Older T5UID1 / DGUS guides (CR-10S Pro project):
  https://github.com/juliandroid/DWIN_CR_10s_Pro/tree/master/tools

## Running the tests

```sh
~/dgus-env/bin/python -m unittest discover -s tests -t .
```
