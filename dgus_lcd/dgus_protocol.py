# DWIN T5L DGUS II serial (UART2) protocol: frame codec, CRC, stream
# parser and system-variable helpers.
#
# Pure byte-level code, no I/O. See docs/PROTOCOL.md for the full
# description; the reference is "T5L_DGUSII Application Development
# Guide V2.9", chapters 4 (Communication Protocol) and 5 (System Variable
# Interface).
#
# Frame:  5A A5 | LEN | CMD | DATA... | [CRC16 lo, hi]
#   LEN counts CMD + DATA (+ 2 CRC bytes when CRC mode is on).
#   CRC is CRC-16/MODBUS (poly x16+x15+x2+1, init 0xFFFF, reflected) over
#   CMD + DATA, transmitted low byte first.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import struct
from dataclasses import dataclass

HEADER = b"\x5a\xa5"
ACK = b"\x4f\x4b"  # "OK", the reply to every write instruction

# Instructions (chapter 4.2)
CMD_WRITE_REG = 0x80     # write OS register page    (debug use)
CMD_READ_REG = 0x81      # read OS register page     (debug use)
CMD_WRITE_VAR = 0x82     # write word variables
CMD_READ_VAR = 0x83      # read word variables / touch upload
CMD_WRITE_CURVE = 0x84   # append data to curve buffers
CMD_WRITE_DVAR = 0x86    # write via double-word address (256 KB space)
CMD_READ_DVAR = 0x87     # read via double-word address

# The LEN byte limits CMD + DATA (+ CRC) to 255 bytes.
MAX_LEN = 0xff
MAX_READ_WORDS = 0x7d        # 0x83 word count, CRC off
MAX_READ_WORDS_CRC = 0x7c    # 0x83 word count, CRC on (reply must fit)
MAX_REG_READ_BYTES = 0xfb    # 0x81 byte count

# ---------------------------------------------------------------------------
# System variables (VP 0x0000-0x0FFF, chapter 5.1). Lengths are in words.
# ---------------------------------------------------------------------------
VP_SYSTEM_RESET = 0x0004     # W 2   write 55AA 5AA5 -> CPU reset
VP_OS_UPDATE = 0x0006        # W 2   DWIN OS / 8051 code update
VP_NOR_FLASH_RW = 0x0008     # W 4   NOR flash <-> variable space copy
VP_UART2_CONFIG = 0x000C     # W 2   baud rate + CRC mode, not persisted
VP_VERSION = 0x000F          # R 1   hi = GUI version, lo = OS version
VP_VERSION_EXT = 0x000E      # R 2   D2 = CTP driver, D1 = GUI, D0 = OS
VP_RTC = 0x0010              # R/W 4 Y M D W h m s 0 (hex, not BCD)
VP_PIC_NOW = 0x0014          # R 1   current page id
VP_GUI_STATUS = 0x0015       # R 1   0 = idle, 1 = busy
VP_TP_STATUS = 0x0016        # R/W 4 touch flag/state/x/y
VP_LED_NOW = 0x0031          # R 1   5A + current brightness
VP_AD_VALUES = 0x0032        # R 8   AD0..AD7
VP_LCD_HOR = 0x007A          # R 1   horizontal resolution
VP_LCD_VER = 0x007B          # R 1   vertical resolution
VP_SYSTEM_CONFIG = 0x0080    # R/W 2 runtime system config
VP_LED_CONFIG = 0x0082       # R/W 2 on/standby brightness + timeout
VP_PIC_SET = 0x0084          # R/W 2 page switch
VP_PWM0_SET = 0x0086         # R/W 2
VP_PWM1_SET = 0x0088         # R/W 2
VP_PWM0_OUT = 0x0092         # R/W 1
VP_PWM1_OUT = 0x0093         # R/W 1
VP_RTC_SET = 0x009C          # W 4   set hardware RTC
VP_MUSIC_PLAY = 0x00A0       # R/W 4 buzzer / WAE playback
VP_MUSIC_VOLUME = 0x00A1     #       (byte D5 of the 0xA0 block)
VP_EXT_FLASH = 0x00AA        # R/W 6 16 MB SPI flash / font operations
VP_TOUCH_CONTROL = 0x00B0    # W     enable/disable/read/modify a touch control
VP_TP_SIMULATE = 0x00D4      # W 4   simulate a touch
VP_POINTER_ICON = 0x00D8     # W 4   pointer icon overlay
VP_WAE_SWITCH = 0x00DC       # W 2
VP_ICL_SWITCH = 0x00DE       # W 2   background ICL switch
VP_MEMORY_CRC = 0x00E0       # R/W 2
VP_DGUS_STOP = 0x00FC        # W 2   stop refresh / stop touch handling
VP_UART1_DOWNLOAD = 0x00FE   # W 2
VP_FSK_BUS = 0x0100          # R/W 512
VP_CURVE_STATUS = 0x0300     # R 16  2 words per channel: pointer, length
VP_CURVE_WRITE = 0x0310      # W     5AA5 + block count, blocks from 0x0312
VP_NETWORK = 0x0400          # R/W 256
VP_MULTIMEDIA = 0x0500       # R/W 192
VP_EXT_MEMORY = 0x05C0       # R/W 64
VP_VAR_CHANGED = 0x0F00      # R 2   5A + VP + word count of last upload
VP_USER_START = 0x1000       # first user variable address

# 0x0080 System_Config D0 bits
CFG_CRC = 0x80               # read only
CFG_LOAD_22 = 0x20           # read only
CFG_AUTO_UPLOAD = 0x10
CFG_TOUCH_SOUND = 0x08
CFG_STANDBY_BACKLIGHT = 0x04
CFG_ROTATION_MASK = 0x03     # 0, 90, 180, 270 degrees

# 0x0016 touch panel states
TP_RELEASED, TP_PRESSED, TP_LIFTED, TP_PRESSING = 0, 1, 2, 3
# 0x00D4 touch simulation modes
TOUCH_PRESS, TOUCH_RELEASE, TOUCH_HOLD, TOUCH_CLICK = 1, 2, 3, 4
# 0x00B0 touch control access modes
CTRL_DISABLE, CTRL_ENABLE, CTRL_READ, CTRL_WRITE = 0, 1, 2, 3

# CPU clock used in the 0x000C baud divisor
T5L_CPU_HZ = 206438400


class ProtocolError(ValueError):
    pass


# ---------------------------------------------------------------------------
# CRC
# ---------------------------------------------------------------------------
def _make_crc_table():
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ 0xa001 if c & 1 else c >> 1
        table.append(c)
    return table


_CRC_TABLE = _make_crc_table()


def crc16(data):
    """CRC-16/MODBUS as used by DGUS (returned as an int)."""
    crc = 0xffff
    for b in data:
        crc = (crc >> 8) ^ _CRC_TABLE[(crc ^ b) & 0xff]
    return crc


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Frame:
    """A decoded frame.

    `kind` says how the body was interpreted:
      "ack"       0x80/0x82/0x84/0x86 reply "OK"
      "var"       0x83 read reply or touch upload: address, data
      "dvar"      0x87 read reply: address (double-word), data
      "reg"       0x81 read reply: page, address (in `address`), data
      "raw"       anything else (data = everything after cmd)
    """
    cmd: int
    kind: str
    address: int = 0
    data: bytes = b""
    page: int = 0

    @property
    def words(self):
        """data as a tuple of big-endian unsigned 16-bit words."""
        n = len(self.data) // 2
        return struct.unpack(">%dH" % n, self.data[:n * 2])


def encode_frame(cmd, body=b"", crc=False):
    """Build a complete frame from a command byte and its data."""
    body = bytes(body)
    length = 1 + len(body) + (2 if crc else 0)
    if length > MAX_LEN:
        raise ProtocolError("frame too long (%d bytes)" % length)
    payload = bytes([cmd]) + body
    out = HEADER + bytes([length]) + payload
    if crc:
        out += struct.pack("<H", crc16(payload))
    return out


def _check_addr(address, maximum=0xffff):
    if not 0 <= address <= maximum:
        raise ProtocolError("invalid address 0x%x" % address)


def write_var(address, data, crc=False):
    """0x82: write word data starting at a VP address."""
    _check_addr(address)
    data = bytes(data)
    if not data or len(data) % 2:
        raise ProtocolError("data length must be even and >0 (got %d)"
                            % len(data))
    return encode_frame(CMD_WRITE_VAR, struct.pack(">H", address) + data, crc)


def write_words(address, *words, crc=False):
    """0x82 with 16-bit values (negative values are written as int16)."""
    data = b"".join(struct.pack(">h" if w < 0 else ">H", w) for w in words)
    return write_var(address, data, crc)


def read_var(address, words, crc=False):
    """0x83: request `words` 16-bit words starting at `address`."""
    _check_addr(address)
    limit = MAX_READ_WORDS_CRC if crc else MAX_READ_WORDS
    if not 1 <= words <= limit:
        raise ProtocolError("word count must be 1..%d" % limit)
    return encode_frame(CMD_READ_VAR, struct.pack(">HB", address, words), crc)


def write_reg(page, reg, data, crc=False):
    """0x80: write OS registers (page 0x00-0x08, register 0x00-0xFF)."""
    if not 0 <= page <= 8 or not 0 <= reg <= 0xff:
        raise ProtocolError("invalid register page/address")
    data = bytes(data)
    if not data:
        raise ProtocolError("no data")
    return encode_frame(CMD_WRITE_REG, bytes([page, reg]) + data, crc)


def read_reg(page, reg, nbytes, crc=False):
    """0x81: read `nbytes` bytes of OS registers."""
    if not 0 <= page <= 8 or not 0 <= reg <= 0xff:
        raise ProtocolError("invalid register page/address")
    if not 1 <= nbytes <= MAX_REG_READ_BYTES:
        raise ProtocolError("byte count must be 1..%d" % MAX_REG_READ_BYTES)
    return encode_frame(CMD_READ_REG, bytes([page, reg, nbytes]), crc)


def write_curve(channels, crc=False):
    """0x84: append samples to curve buffers.

    `channels` maps channel number (0-7) to a list of samples; all lists
    must have the same length. Samples are interleaved per CH_Mode, low
    channel first.
    """
    if not channels:
        raise ProtocolError("no channels")
    chans = sorted(channels)
    if chans[0] < 0 or chans[-1] > 7:
        raise ProtocolError("channel must be 0..7")
    n = {len(channels[c]) for c in chans}
    if len(n) != 1 or 0 in n:
        raise ProtocolError("all channels need the same, non-zero length")
    mode = 0
    for c in chans:
        mode |= 1 << c
    body = bytearray([mode])
    for i in range(n.pop()):
        for c in chans:
            body += struct.pack(">H", channels[c][i] & 0xffff)
    return encode_frame(CMD_WRITE_CURVE, body, crc)


def write_dvar(address, data, crc=False):
    """0x86: write data at a double-word address (0x000000-0x00FFFF)."""
    _check_addr(address)
    data = bytes(data)
    if not data or len(data) % 4:
        raise ProtocolError("data length must be a multiple of 4")
    return encode_frame(CMD_WRITE_DVAR,
                        address.to_bytes(3, "big") + data, crc)


def read_dvar(address, dwords, crc=False):
    """0x87: read `dwords` double words from a double-word address."""
    _check_addr(address)
    if not 1 <= dwords <= 0x3e:
        raise ProtocolError("double-word count must be 1..62")
    return encode_frame(CMD_READ_DVAR,
                        address.to_bytes(3, "big") + bytes([dwords]), crc)


def decode_body(cmd, body):
    """Interpret the bytes after CMD of a received frame."""
    body = bytes(body)
    if body == ACK and cmd in (CMD_WRITE_REG, CMD_WRITE_VAR,
                               CMD_WRITE_CURVE, CMD_WRITE_DVAR):
        return Frame(cmd, "ack")
    if cmd == CMD_READ_VAR and len(body) >= 3:
        address, wc = struct.unpack(">HB", body[:3])
        data = body[3:3 + wc * 2]
        if len(data) < wc * 2:
            raise ProtocolError("truncated 0x83 reply: %s" % body.hex())
        return Frame(cmd, "var", address, data)
    if cmd == CMD_READ_REG and len(body) >= 3:
        page, reg, n = body[0], body[1], body[2]
        data = body[3:3 + n]
        if len(data) < n:
            raise ProtocolError("truncated 0x81 reply: %s" % body.hex())
        return Frame(cmd, "reg", reg, data, page)
    if cmd == CMD_READ_DVAR and len(body) >= 4:
        address = int.from_bytes(body[:3], "big")
        n = body[3] * 4
        data = body[4:4 + n]
        if len(data) < n:
            raise ProtocolError("truncated 0x87 reply: %s" % body.hex())
        return Frame(cmd, "dvar", address, data)
    return Frame(cmd, "raw", data=body)


class FrameParser:
    """Incremental parser for the byte stream coming from the screen.

    feed() returns the list of complete frames found. Garbage before a
    header is skipped. With crc=True each frame's CRC is checked and bad
    frames are counted in `crc_errors` and dropped.
    """

    def __init__(self, crc=False):
        self.crc = crc
        self.crc_errors = 0
        self.bad_frames = 0
        self._buf = bytearray()

    def reset(self):
        self._buf.clear()

    def feed(self, data):
        buf = self._buf
        buf.extend(data)
        frames = []
        while True:
            idx = buf.find(HEADER)
            if idx < 0:
                # keep a trailing 0x5A, it may start the next header
                del buf[:len(buf) - 1 if buf[-1:] == HEADER[:1] else len(buf)]
                return frames
            if idx:
                del buf[:idx]
            if len(buf) < 4:
                return frames
            flen = buf[2]
            if len(buf) < 3 + flen:
                return frames
            raw = bytes(buf[3:3 + flen])
            if flen == 0 or (self.crc and flen < 3):
                # not a real frame, resync after this header
                del buf[:2]
                self.bad_frames += 1
                continue
            if self.crc:
                payload, tail = raw[:-2], raw[-2:]
                if struct.unpack("<H", tail)[0] != crc16(payload):
                    # a stray 5A A5 inside data can land here; resync
                    del buf[:2]
                    self.crc_errors += 1
                    continue
            else:
                payload = raw
            del buf[:3 + flen]
            try:
                frames.append(decode_body(payload[0], payload[1:]))
            except ProtocolError:
                self.bad_frames += 1
        return frames


# ---------------------------------------------------------------------------
# System-variable helpers. Each returns (address, data) for write_var(),
# so they work with both the codec above and DGUSSerial.write_var().
# ---------------------------------------------------------------------------
def cmd_reset():
    """Reboot the T5L (same as a power cycle)."""
    return VP_SYSTEM_RESET, b"\x55\xaa\x5a\xa5"


def cmd_page(page_id):
    """Switch to page `page_id`."""
    return VP_PIC_SET, struct.pack(">BBH", 0x5a, 0x01, page_id)


def cmd_brightness(on, standby=None, timeout_ms=None):
    """Backlight: `on` (0-100), optional standby level and timeout.

    Without standby/timeout only the first word is written, which sets the
    brightness directly.
    """
    on = _pct(on)
    if standby is None and timeout_ms is None:
        return VP_LED_CONFIG, bytes([on, on])
    standby = _pct(on if standby is None else standby)
    ticks = max(0, min(0xffff, int((timeout_ms or 0) // 10)))
    return VP_LED_CONFIG, struct.pack(">BBH", on, standby, ticks)


def cmd_beep(ms):
    """Buzzer beep for `ms` milliseconds (8 ms resolution, max ~2 s)."""
    return VP_MUSIC_PLAY, bytes([0x00, max(1, min(0xff, ms // 8))])


def cmd_play_music(segment, count=1, volume=0x40):
    """Play WAE `segment` (volume 0-0x40 = 0-100%)."""
    return VP_MUSIC_PLAY, bytes([segment & 0xff, count & 0xff,
                                 volume & 0xff, 0])


def cmd_rtc_write(dt):
    """Write the software RTC at 0x0010 from a datetime (no hw RTC).

    Week is 0 = Sunday; the screen also derives it from the date itself.
    """
    return VP_RTC, bytes([dt.year % 100, dt.month, dt.day,
                          dt.isoweekday() % 7,
                          dt.hour, dt.minute, dt.second, 0])


def cmd_rtc_set(dt):
    """Set the hardware RTC (0x009C) from a datetime."""
    return VP_RTC_SET, bytes([0x5a, 0xa5, dt.year % 100, dt.month, dt.day,
                              dt.hour, dt.minute, dt.second])


def cmd_touch(x, y, mode=TOUCH_CLICK):
    """Simulate a touch at (x, y). After PRESS/HOLD you must RELEASE."""
    return VP_TP_SIMULATE, struct.pack(">HHHH", 0x5aa5, mode, x, y)


def cmd_touch_control(page, control, ctype, mode):
    """Enable/disable (CTRL_*) touch control number `control` on a page.

    `ctype` is the control's key code (0x01 = popup menu, ...). Basic
    touch controls do not count in `control` and can't be switched.
    """
    return VP_TOUCH_CONTROL, struct.pack(">HHBBH", 0x5aa5, page, control,
                                         ctype, mode)


def cmd_touch_enable(enable):
    """Enable or disable all touch processing."""
    return VP_DGUS_STOP, (b"\x00\x00\x00\x00" if enable
                          else b"\x55\xaa\x5a\x5a")


def cmd_system_config(flags):
    """Write 0x0080 System_Config D0 (CFG_AUTO_UPLOAD | ... | rotation)."""
    return VP_SYSTEM_CONFIG, bytes([0x5a, 0x00, 0x00, flags & 0x7f])


def cmd_uart2(baud=None, crc=False):
    """Change UART2 baud rate and/or CRC mode (lost on power off).

    With baud=None only the CRC flag changes. The reply to this write
    already uses the *old* settings; switch the host side right after.
    """
    mode = 0x80 if crc else 0x00
    if baud is None:
        return VP_UART2_CONFIG, bytes([0x5a, mode])
    div = round(T5L_CPU_HZ / (64 * baud))
    if not 1 <= div <= 0xffff:
        raise ProtocolError("unsupported baud rate %d" % baud)
    return VP_UART2_CONFIG, struct.pack(">BBH", 0x5a, mode, div)


def cmd_nor_flash(write, flash_addr, vp, words):
    """Copy `words` words between NOR flash and variable space.

    write=True stores VP -> flash, False loads flash -> VP. Addresses and
    length must be even. Poll 0x0008 until its first byte is 0 before the
    next operation.
    """
    if flash_addr % 2 or vp % 2 or words % 2:
        raise ProtocolError("flash address, VP and length must be even")
    return VP_NOR_FLASH_RW, (bytes([0xa5 if write else 0x5a])
                             + flash_addr.to_bytes(3, "big")
                             + struct.pack(">HH", vp, words))


def cmd_pointer_icon(icl, icon, x, y, show=True):
    """Overlay icon `icon` of ICL file `icl` at (x, y)."""
    return VP_POINTER_ICON, struct.pack(">BBHHH", 0x5a if show else 0,
                                        icl, icon, x, y)


def _pct(v):
    return max(0, min(100, int(v)))


# ---------------------------------------------------------------------------
# Decoders for common reads
# ---------------------------------------------------------------------------
def parse_version(data):
    """0x000F reply -> (gui_version, os_version)."""
    return data[0], data[1]


def parse_touch_status(data):
    """0x0016 reply -> (updated, state, x, y)."""
    flag, state, x, y = struct.unpack(">BBHH", data[:6])
    return flag == 0x5a, state, x, y


def parse_rtc(data):
    """0x0010 reply -> (year, month, day, weekday, hour, minute, second)."""
    y, mo, d, wd, h, mi, s = data[:7]
    return 2000 + y, mo, d, wd, h, mi, s


def parse_system_config(data):
    """0x0080 reply -> dict of the configuration fields."""
    flags = data[3]
    return {
        "touch_sensitivity": data[1],
        "touch_mode": data[2],
        "crc": bool(flags & CFG_CRC),
        "load_22": bool(flags & CFG_LOAD_22),
        "auto_upload": bool(flags & CFG_AUTO_UPLOAD),
        "touch_sound": bool(flags & CFG_TOUCH_SOUND),
        "standby_backlight": bool(flags & CFG_STANDBY_BACKLIGHT),
        "rotation": (flags & CFG_ROTATION_MASK) * 90,
    }
