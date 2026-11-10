# DWIN DGUS II serial protocol (DMT48270C043_06WT)

This page describes the UART protocol of the Ender-6 touchscreen and how
`dgus_lcd/dgus_protocol.py` implements it. For the command-line tool and
serial uploads, see [DGUSTOOL.md](DGUSTOOL.md).

The screen is a DWIN **DMT48270C043_06WT**: 4.3", 480×272, resistive
touch, **T5UID1**, i.e. a T5 CPU running DGUS II. The DGUS-reloaded
firmware targets it, and DgusDude identifies this part number as T5UID1.

**References:**

- **Primary:** [`T5UID1 Application Guide.pdf`](T5UID1%20Application%20Guide.pdf).
  Section 2.3 covers the serial protocol, 3 the system variables, 4 the SD
  files and 5 the CFG file.
- **Secondary:** the newer T5L manual,
  [`T5L_DGUSII-Application-Development-Guide-V2.921.pdf`](T5L_DGUSII-Application-Development-Guide-V2.921.pdf)
  (chapter 4 p. 44, chapter 5 p. 48). It uses the same frame format, but
  some system variables differ. Those are marked **T5L** below; don't use
  them on this screen.

Every byte example on this page comes from those guides and is checked in
`tests/test_dgus_protocol.py`.

## Link

- UART2, 8N1, 115200 baud, TTL levels (10-pin 1.0 mm connector, 5 V).
- On this machine: `/dev/ttyS1`. Screen TX → SBC RX, screen RX → SBC TX.
- All multi-byte values are **big-endian**, except the CRC.
- The screen is variable-driven: everything, including page changes,
  backlight and sound, is done by reading and writing 16-bit words in its
  128 KB SRAM (VP addresses 0x0000–0xFFFF).

## Frame format

```
5A A5 | LEN | CMD | DATA ...      | CRC lo CRC hi
header  1 B   1 B                   optional
```

- `LEN` counts `CMD` + `DATA`, plus 2 if CRC is on. The maximum is 255.
- CRC is **CRC-16/MODBUS** (poly x¹⁶+x¹⁵+x²+1, init 0xFFFF, reflected),
  computed over `CMD` + `DATA` and sent **low byte first**. Example:
  `83 00 10 04` → `25 A3`.
- On T5UID1, CRC is switched on by bit 6 of byte 0x2C in `T5UID1*.CFG`, and
  there is no runtime switch. This screen runs with **CRC off**.

## Instructions

| CMD  | Request DATA                         | Reply                                   | Use |
|------|--------------------------------------|-----------------------------------------|-----|
| 0x82 | `addr(2)` + words                    | `82 4F 4B` ("OK")                       | Write SRAM variables |
| 0x83 | `addr(2)` + `count(1)` (words)       | `83 addr(2) count(1) data(count×2)`     | Read SRAM variables |
| 0x80 | `page(1)` + `reg(1)` + bytes         | `80 4F 4B`                              | Write OS registers (debug) |
| 0x81 | `page(1)` + `reg(1)` + `nbytes(1)`   | `81 page reg n data(n)`                 | Read OS registers (debug) |
| 0x84 | `CH_Mode(1)` + samples               | `84 4F 4B`                              | **T5L**: append curve samples |
| 0x86 | `daddr(3)` + data                    | `86 4F 4B`                              | **T5L**: double-word write |
| 0x87 | `daddr(3)` + `count(1)`              | `87 daddr count data`                   | **T5L**: double-word read |

Notes:

- The guides call the 0x83 length a "byte length", but it is a **word
  count**: up to 0x7D with CRC off, 0x7C with CRC on.
- **Touch upload:** when a touch control changes a variable that has
  data auto-upload enabled, the screen sends an unsolicited frame that
  looks exactly like a 0x83 reply. `5A A5 06 83 1001 01 000A` means VP
  0x1001 now holds 0x000A. Auto-upload is on when CFG byte 0x08 bit 7 is 0.
- Writes are acknowledged with `4F 4B`. The service doesn't wait for the
  ACK. `dgustool` waits by default, but stops waiting if the screen never
  answers; DgusDude reports some firmware doesn't ACK.
- 0x80/0x81 register pages: 0x00–0x07 are the DWIN OS data registers
  R0–R255, and 0x08 holds the port registers.

## System variables (0x0000–0x0FFF), T5UID1

Lengths are in words. A first byte (or word) of `5A` / `5AA5` means "do it
once": the screen clears it when the action is done, and `dgus_device`
polls for that.

| VP     | Constant                | R/W | Len | Data |
|--------|-------------------------|-----|-----|------|
| 0x0000 | `VP_DEVICE_ID`          | R   | 4   | unique CPU ID |
| 0x0004 | `VP_SYSTEM_RESET`       | W   | 2   | `55AA 5AA5` reboot CPU, `55AA 5A5A` also pulse /RST_OUT |
| 0x0006 | `VP_OS_UPDATE`          | W   | 2   | `5A 10 sram_vp(2)`: flash DWIN OS code from SRAM |
| 0x0008 | `VP_NOR_FLASH_RW`       | W   | 4   | `mode(5A read / A5 write) nor_word_addr(3) vp(2) words(2)`. NOR is 160 Kwords |
| 0x000F | `VP_VERSION`            | R   | 1   | `GUI OS` (this screen: 0x34 / 0x32) |
| 0x0010 | `VP_RTC`                | R/W | 4   | `YY MM DD WW hh mm ss 00` (hex, not BCD; week 0 = Sunday) |
| 0x0014 | `VP_PIC_NOW`            | R   | 1   | current page |
| 0x0015 | `VP_GUI_STATUS`         | R   | 1   | 0 idle, 1 busy |
| 0x0016 | `VP_TP_STATUS`          | R/W | 4   | `flag(5A = new) state x(2) y(2) 0000`. State: 0 released, 1 pressed, 2 lifted, 3 pressing |
| 0x0030 | `VP_VCC_NOW`            | R   | 1   | 3.3 V rail: value × 4800 / 65532 mV |
| 0x0031 | `VP_LED_NOW`            | R   | 1   | `5A brightness` |
| 0x0032 | `VP_AD_VALUES`          | R   | 4   | AD0–AD3, × 4800 / 65532 mV |
| 0x0036 | `VP_AD_UPDATED`         | R   | 1   | `5A` = AD compute and temperature updated |
| 0x0037 | `VP_CORE_TEMP`          | R   | 1   | CPU temperature: value × 240 / 929, in 0.1 °C |
| 0x0038 | `VP_AD_COMPUTE`         | R   | 16  | AD0–AD7: DC average and RMS |
| 0x0048 | `VP_IRDA`               | R   | 4   | IR remote data |
| 0x007C | `VP_FOLDER_NAME`        | R   | 4   | SD update folder name, e.g. `DWIN_SET` |
| 0x0080 | `VP_SYSTEM_CONFIG`      | R/W | 2   | `00 sens mode flags`. Flags: .6 128 controls/page (ro), .5 load 22.bin (ro), .4 SD on, .3 touch sound, .2 backlight standby, .1-0 rotation. Not saved |
| 0x0082 | `VP_LED_CONFIG`         | R/W | 2   | `on standby time(2, × 5 ms)`, brightness 0–100 |
| 0x0084 | `VP_PIC_SET`            | R/W | 2   | `5A 01 id(2)` switch page, `5A 02 id(2)` save the screen as picture id |
| 0x0086 | `VP_PWM1_SET`           | R/W | 4   | `5A div precision(2) 0…`: carrier 501.35 MHz / (div × precision). PWM2 at 0x8A, PWM3 at 0x8E |
| 0x0092 | `VP_PWM1_OUT`           | R/W | 1   | PWM1–3 outputs at 0x92–0x94. PWMV1/2 at 0x95/0x96 |
| 0x009C | `VP_RTC_SET`            | W   | 4   | `5AA5 YY MM DD hh mm ss` (hardware RTC) |
| 0x00A0 | `VP_MUSIC_PLAY`         | R/W | 2   | `start count volume(1/256) remaining`. In buzzer mode, count is the beep time in 8 ms units. `00 00` stops |
| 0x00A2 | `VP_BMP_DOWNLOAD`       | W   | 4   | `5A sram_vp(2) words(2) buf_addr(3)`: RGB565 SRAM → picture buffer (150 Kwords) |
| 0x00A6 | `VP_JPEG_DOWNLOAD`      | W   | 4   | `5A mode sram_vp(2) param(2) 0000`. Mode 1 shows the JPEG on the current page (param = position), mode 2 saves it as picture `param`. 64 KB max |
| 0x00AA | `VP_NAND_FLASH`         | R/W | 6   | Write: `5A 02 block(2) sram_vp(2) 0001 0000 0000` (32 KB block of the 64 MB font space). Read: `5A 01 font(1) word_off(3) vp(2) words(2) 0000` (font ids 0x40–0x7F only) |
| 0x00B0 | `VP_TOUCH_CONTROL`      | W   | 36  | `5AA5 page(2) control(1) keycode(1) mode(2)`. Mode: 0 off, 1 on, 2 read to 0xB4, 3 write from 0xB4 |
| 0x00D4 | `VP_TP_SIMULATE`        | W   | 4   | `5AA5 mode(2) x(2) y(2)`. Mode: 1 press, 2 release, 3 hold, 4 click. Coordinates are at 0° rotation |
| 0x0300 | `VP_CURVE_STATUS`       | R   | 16  | per channel: write pointer, length |
| 0x0310 | `VP_CURVE_WRITE`        | W   | –   | `5AA5 blocks 00`, then blocks from 0x0312: `ch len data…` |
| 0x1000+ | user variables         |     |     | defined by the screen project. Curve buffers are 0x1000–0x4FFF when used |

DGUS-reloaded uses VPs 0x1000–0x5001; they are listed in
`dgus_lcd/firmware/dgus_reloaded/vars_*.cfg`. `dgus_device` uses
0x8000–0xFFFF as a 64 KB staging buffer for uploads.

### T5L-only variables (not on this screen)

| VP | Constant | Purpose |
|----|----------|---------|
| 0x000C | `VP_UART2_CONFIG` | runtime baud and CRC (`cmd_uart2`) |
| 0x000E | `VP_VERSION_EXT` | CTP / GUI / OS versions |
| 0x007A / 0x007B | `VP_LCD_HOR` / `VP_LCD_VER` | resolution |
| 0x00D8 | `VP_POINTER_ICON` | icon overlay |
| 0x00DC / 0x00DE | `VP_WAE_SWITCH` / `VP_ICL_SWITCH` | WAE / ICL switch |
| 0x00E0 | `VP_MEMORY_CRC` | flash CRC check |
| 0x00FC | `VP_DGUS_STOP` | stop refresh or touch (`cmd_touch_enable`) |
| 0x00FE | `VP_UART1_DOWNLOAD` | UART1 download |
| 0x0100–0x05FF | | FSK bus, network, multimedia, external memory |
| 0x0F00 | `VP_VAR_CHANGED` | last upload info |

On T5L, the 0x80 D3 byte must be `5A`, bit 4 means auto-upload, and the
0x82 timeout counts 10 ms steps. Pass `t5l=True` / `tick_ms=10` to the
helpers for those screens.

## Memory map (T5UID1)

| Area | Size | How it is written |
|---|---|---|
| SRAM (VPs) | 128 KB | 0x82 / 0x83 |
| NAND font space | 64 MB, 256 font ids × 256 KB | 0xAA in 32 KB blocks (block n = offset n × 32 KB) |
| Audio | upper 32 MB of the font space, 128 KB per WAV id | same NAND |
| Picture memory | 64 MB, about 250 full-screen pictures | 0xA2 + 0x84 save, or 0xA6 JPEG |
| NOR database | 160 Kwords (320 KB), 2 Kwords per .LIB id | 0x08 |
| DWIN OS code | separate NOR | 0x06 |

## Python API (`dgus_lcd/dgus_protocol.py`)

The module is pure byte handling with no I/O.

**Encoders** return complete frames (`bytes`). Each takes `crc=False`.

```python
from dgus_lcd import dgus_protocol as p

p.read_var(0x000F, 1)              # 5A A5 04 83 00 0F 01
p.write_var(0x1000, b"\x31\x32")   # 5A A5 05 82 10 00 31 32
p.write_words(0x1001, 10, 11)      # 16-bit values, negatives as int16
p.read_reg(0, 0x0A, 4); p.write_reg(0, 0x0A, b"\x01")
p.encode_frame(cmd, body)          # anything else
p.crc16(b"\x83\x00\x0f\x01")       # 0x90ED
```

**System-variable helpers** return `(address, data)`, which you pass to
`p.write_var(*cmd)`, `DGUSSerial.send(cmd)` or `DGUSDevice.send(cmd)`:

| Helper | Effect |
|---|---|
| `cmd_reset(full=False)` | reboot the screen |
| `cmd_page(n, mode=PIC_SWITCH)` | switch to page n, or with `PIC_SAVE` save the screen as picture n |
| `cmd_brightness(on, standby=None, timeout_ms=None)` | backlight, 0–100 |
| `cmd_play_music(start, count=1, volume=0xFF)` / `cmd_beep(ms)` | audio / buzzer |
| `cmd_rtc_write(dt)` / `cmd_rtc_set(dt)` | software / hardware RTC |
| `cmd_touch(x, y, mode=TOUCH_CLICK)` | simulate a touch |
| `cmd_touch_control(page, control, keycode, CTRL_ENABLE/DISABLE)` | one touch control |
| `cmd_system_config(flags)` | 0x0080 flags (`CFG_*`) |
| `cmd_nor_flash(write, word_addr, vp, words)` | NOR ↔ SRAM copy |
| `cmd_nand_write(block, vp)` / `cmd_nand_read(font, word_off, vp, words)` | NAND |
| `cmd_bmp_download(vp, words, buf_addr)` / `cmd_jpeg_download(vp, mode, param)` | pictures |
| `cmd_os_update(vp)` | DWIN OS |
| `cmd_pwm(ch, div, precision)` / `cmd_pwm_out(ch, width)` | PWM |
| `cmd_uart2`, `cmd_touch_enable`, `cmd_pointer_icon` | T5L only |

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
common reads: `parse_version`, `parse_touch_status`, `parse_rtc`,
`parse_system_config`, `parse_led_config`, `parse_vcc`, `parse_core_temp`
and `parse_adc`.

### Transports

- `dgus_lcd/serial_link.py` (`DGUSSerial`) is the asyncio transport the
  service uses. It never waits for replies. Callbacks: `on_read(address,
  data)` for `"var"` frames, and optionally `on_frame(frame)` for every
  frame. Methods: `write_var`, `read_var`, `send`, `send_raw`, `set_crc`.
- `dgus_lcd/dgus_device.py` (`DGUSDevice`) is a blocking request/response
  client used by `dgustool`. It waits for ACKs, polls busy flags and
  verifies. See [DGUSTOOL.md](DGUSTOOL.md).

## Manuals

The PDFs aren't kept in git (they're DWIN's copyright and large). To get
them again:

- T5UID1 Application Guide (primary for this screen) and older DGUS guides:
  https://github.com/juliandroid/DWIN_CR_10s_Pro/tree/master/tools
- T5L DGUS II guide V2.9:
  https://ecdn6.globalso.com/upload/p/1355/source/2026-03/T5L_DGUSII-Application-Development-Guide-V2.921.pdf
- T5L ASIC development guide:
  https://ecdn6.globalso.com/upload/p/1355/source/2024-11/Development-Guide-of-T5L-ASIC-2024-09-25.pdf
- More DWIN guides: https://www.dwin-global.com/development-guide/
- DMG48270C043_06WTR datasheet (newer T5F0 sibling, hardware reference):
  https://evelta.com/content/datasheets/353-DMG48270C043_06WTR.pdf
- DgusDude (.NET library these features are ported from):
  https://github.com/UdiAzulay/DgusDude

## Running the tests

```sh
~/dgus-env/bin/python -m unittest discover -s tests -t .
```
