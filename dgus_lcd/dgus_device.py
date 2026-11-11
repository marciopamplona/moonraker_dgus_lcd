# Synchronous request/response client for a DWIN T5UID1 DGUS II screen.
#
# Python port of the feature set of DgusDude (github.com/UdiAzulay/DgusDude,
# a .NET library): device info, page/touch/audio/backlight control, and
# uploading DWIN_SET files over the serial port instead of an SD card.
#
# This needs the port to itself: stop the dgus_lcd service first. The
# service's own transport (serial_link.py) is asynchronous and never waits
# for replies; this module does, so it can poll "busy" flags and verify.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import collections
import logging
import os
import re
import struct
import time

from . import dgus_protocol as p

log = logging.getLogger("dgus.device")

WRITE_CHUNK = 240           # bytes of data per 0x82 frame
BUFFER_VP = 0x8000          # SRAM staging area: VP 0x8000-0xFFFF = 64 KB
BUFFER_BYTES = 0x10000
SCREEN_SIZE = (480, 272)    # DMT48270C043 native panel resolution


class DeviceError(Exception):
    pass


class DGUSDevice:
    """Blocking client. `ser` is any object with pyserial's read/write
    (tests pass a fake); otherwise `port` is opened with pyserial.

    ack: True = every write must be answered with "OK", False = don't wait,
    "auto" = wait, but stop waiting if the first write is not answered
    (DgusDude notes some firmware never ACKs).
    """

    def __init__(self, port="/dev/ttyS1", baud=115200, crc=False,
                 timeout=1.0, ack="auto", ser=None):
        if ser is None:
            import serial
            ser = serial.Serial(port, baud, timeout=0.05, write_timeout=2)
            ser.reset_input_buffer()
        self.ser = ser
        self.crc = crc
        self.timeout = timeout
        self.ack = ack
        self._parser = p.FrameParser(crc)
        self._pending = collections.deque()
        # unsolicited 0x83 frames (touch uploads) seen while waiting
        self.events = collections.deque(maxlen=256)

    # -- context manager ----------------------------------------------------
    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- low level ----------------------------------------------------------
    def _next_frame(self, deadline):
        while not self._pending:
            if time.monotonic() > deadline:
                return None
            data = self.ser.read(256)
            if data:
                self._pending.extend(self._parser.feed(data))
        return self._pending.popleft()

    def _wait(self, match, what):
        deadline = time.monotonic() + self.timeout
        while True:
            frame = self._next_frame(deadline)
            if frame is None:
                raise DeviceError("timeout waiting for %s" % what)
            if match(frame):
                return frame
            if frame.kind == "var":
                self.events.append(frame)
            else:
                log.debug("ignored frame %s", frame)

    def _write_frame(self, frame, desc):
        self.ser.write(frame)
        if self.ack is False:
            time.sleep(len(frame) * 10 / 115200 + 0.002)
            return
        try:
            self._wait(lambda f: f.kind == "ack" and f.cmd == frame[3],
                       "ACK of %s" % desc)
        except DeviceError:
            if self.ack == "auto":
                log.warning("No ACK from screen, continuing without ACKs")
                self.ack = False
                return
            raise
        if self.ack == "auto":
            self.ack = True

    def write_vp(self, address, data):
        """Write any even number of bytes, split into frames as needed."""
        data = bytes(data)
        if len(data) % 2:
            raise ValueError("data length must be even")
        for off in range(0, len(data), WRITE_CHUNK):
            chunk = data[off:off + WRITE_CHUNK]
            addr = address + off // 2
            self._write_frame(p.write_var(addr, chunk, self.crc),
                              "write 0x%04x" % addr)

    def read_vp(self, address, words):
        """Read `words` words (any count), returns bytes."""
        out = bytearray()
        step = p.MAX_READ_WORDS_CRC if self.crc else p.MAX_READ_WORDS
        while words > 0:
            n = min(step, words)
            self.ser.write(p.read_var(address, n, self.crc))
            f = self._wait(lambda f, a=address, n=n: f.kind == "var"
                           and f.address == a and len(f.data) == n * 2,
                           "read 0x%04x" % address)
            out += f.data
            address += n
            words -= n
        return bytes(out)

    def read_word(self, address):
        return struct.unpack(">H", self.read_vp(address, 1))[0]

    def send(self, command):
        """Write an (address, data) pair from dgus_protocol.cmd_*()."""
        self.write_vp(*command)

    def wait_done(self, address, timeout=5.0, busy=0x5a, index=0, words=1):
        """Poll `address` until byte `index` is no longer `busy` (the
        screen clears 0x5A "do it once" flags when an operation ends)."""
        deadline = time.monotonic() + timeout
        while True:
            if self.read_vp(address, words)[index] != busy:
                return
            if time.monotonic() > deadline:
                raise DeviceError("operation at 0x%04x did not finish"
                                  % address)
            time.sleep(0.02)

    def poll_events(self, timeout=0.0):
        """Return the queued touch uploads plus any arriving in `timeout`."""
        deadline = time.monotonic() + timeout
        while True:
            frame = self._next_frame(deadline)
            if frame is None:
                break
            if frame.kind == "var":
                self.events.append(frame)
        out = list(self.events)
        self.events.clear()
        return out

    def wait_key(self, timeout=None):
        """Block until the screen uploads a variable (button press);
        returns the Frame or None on timeout."""
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            if self.events:
                return self.events.popleft()
            left = 0.5 if deadline is None else deadline - time.monotonic()
            if left <= 0:
                return None
            self.poll_events(min(left, 0.5))

    # -- information --------------------------------------------------------
    def info(self):
        """Everything DgusDude's DeviceInfo/GetDeviceConfig report."""
        sysvars = self.read_vp(0x0000, 0x38)
        cfg = self.read_vp(p.VP_SYSTEM_CONFIG, 4)
        rtc = p.parse_rtc(sysvars[0x20:0x28])
        updated, state, x, y = p.parse_touch_status(sysvars[0x2c:0x34])
        on, standby, timeout_ms = p.parse_led_config(cfg[4:8])
        folder = self.read_vp(p.VP_FOLDER_NAME, 4)
        return {
            "device_id": sysvars[0:8].hex(),
            "version": p.parse_version(sysvars[0x1e:0x20]),
            "rtc": rtc,
            "page": struct.unpack(">H", sysvars[0x28:0x2a])[0],
            "idle": sysvars[0x2a:0x2c] == b"\x00\x00",
            "touch": {"updated": updated, "state": state, "x": x, "y": y},
            "vcc": round(p.parse_vcc(sysvars[0x60:0x62]), 3),
            "brightness_now": sysvars[0x63],
            "adc_mv": [round(v) for v in p.parse_adc(sysvars[0x64:0x6c])],
            "core_temp": round(p.parse_core_temp(sysvars[0x6e:0x70]), 1),
            "folder": folder.rstrip(b"\x00\xff").decode("ascii", "replace"),
            "config": p.parse_system_config(cfg[:4]),
            "backlight": {"on": on, "standby": standby,
                          "timeout_ms": timeout_ms},
        }

    # -- control ------------------------------------------------------------
    @property
    def page(self):
        return self.read_word(p.VP_PIC_NOW)

    @page.setter
    def page(self, page_id):
        self.send(p.cmd_page(page_id))
        self.wait_done(p.VP_PIC_SET)

    def save_page(self, picture_id):
        """Store what is on screen now as picture `picture_id`."""
        self.send(p.cmd_page(picture_id, p.PIC_SAVE))
        self.wait_done(p.VP_PIC_SET, timeout=10)

    def reset(self, full=False):
        """Reboot the screen. No ACK comes back, so don't wait for one."""
        self.ser.write(p.write_var(*p.cmd_reset(full), crc=self.crc))

    def touch(self, x, y, mode=p.TOUCH_CLICK):
        self.send(p.cmd_touch(x, y, mode))
        self.wait_done(p.VP_TP_SIMULATE)

    def touch_status(self):
        return p.parse_touch_status(self.read_vp(p.VP_TP_STATUS, 4))

    def set_control(self, page, control, ctype, enable):
        self.send(p.cmd_touch_control(page, control, ctype,
                                      p.CTRL_ENABLE if enable
                                      else p.CTRL_DISABLE))
        self.wait_done(p.VP_TOUCH_CONTROL)

    def set_config(self, **changes):
        """Change writable 0x0080 bits: rotation, touch_sound,
        standby_backlight, sd_enabled. Not kept after power off."""
        flags = self.read_vp(p.VP_SYSTEM_CONFIG, 2)[3]
        bits = {"sd_enabled": p.CFG_SD_ENABLED,
                "touch_sound": p.CFG_TOUCH_SOUND,
                "standby_backlight": p.CFG_STANDBY_BACKLIGHT}
        for key, val in changes.items():
            if key == "rotation":
                flags = (flags & ~p.CFG_ROTATION_MASK) | (val // 90 & 3)
            elif key in bits:
                flags = flags | bits[key] if val else flags & ~bits[key]
            else:
                raise ValueError("unknown config field %s" % key)
        self.send(p.cmd_system_config(flags))

    # -- NAND (font / icon / audio space) -------------------------------------
    def nand_write(self, offset, data, verify=False, progress=None):
        """Write `data` at byte `offset` of the 64 MB font space.

        The screen writes whole 32 KB blocks, so `offset` must be 32 KB
        aligned and the last block is padded with 0xFF.
        """
        if offset % p.NAND_BLOCK:
            raise ValueError("NAND offset must be 32 KB aligned")
        data = bytes(data)
        total = len(data)
        for off in range(0, total, p.NAND_BLOCK):
            block = data[off:off + p.NAND_BLOCK]
            block += b"\xff" * (p.NAND_BLOCK - len(block))
            self.write_vp(BUFFER_VP, block)
            self.send(p.cmd_nand_write((offset + off) // p.NAND_BLOCK,
                                       BUFFER_VP))
            self.wait_done(p.VP_NAND_FLASH, timeout=10)
            if verify:
                self._verify_nand(offset + off, block)
            if progress:
                progress(min(off + p.NAND_BLOCK, total), total)

    def nand_read(self, offset, length):
        """Read back font space bytes. T5UID1 can only read font ids
        0x40-0x7F, i.e. offsets 16 MB-32 MB."""
        if offset % 4:
            raise ValueError("NAND read offset must be a multiple of 4")
        want = length
        length = (length + 3) // 4 * 4   # the screen reads even word counts
        out = bytearray()
        while length > 0:
            font_id, in_font = divmod(offset, p.NAND_FONT_SIZE)
            if not 0x40 <= font_id <= 0x7f:
                raise DeviceError("T5UID1 can only read NAND font ids "
                                  "0x40-0x7F")
            n = min(length, BUFFER_BYTES, p.NAND_FONT_SIZE - in_font)
            self.send(p.cmd_nand_read(font_id, in_font // 2, BUFFER_VP,
                                      n // 2))
            self.wait_done(p.VP_NAND_FLASH, timeout=10)
            out += self.read_vp(BUFFER_VP, n // 2)
            offset += n
            length -= n
        return bytes(out[:want])

    def _verify_nand(self, offset, block):
        if not 0x40 <= offset // p.NAND_FONT_SIZE <= 0x7f:
            return  # not readable on T5UID1
        if self.nand_read(offset, len(block)) != block:
            raise DeviceError("verify failed at NAND offset 0x%x" % offset)

    # -- NOR (user database, .LIB files) ------------------------------------
    def nor_write(self, word_addr, data, verify=False, progress=None):
        data = bytes(data)
        data += b"\x00" * (-len(data) % 4)
        total = len(data)
        for off in range(0, total, BUFFER_BYTES):
            chunk = data[off:off + BUFFER_BYTES]
            self.write_vp(BUFFER_VP, chunk)
            self.send(p.cmd_nor_flash(True, word_addr + off // 2, BUFFER_VP,
                                      len(chunk) // 2))
            self.wait_done(p.VP_NOR_FLASH_RW, busy=0xa5, timeout=10)
            if verify and self.nor_read(word_addr + off // 2,
                                        len(chunk)) != chunk:
                raise DeviceError("verify failed at NOR word 0x%x"
                                  % (word_addr + off // 2))
            if progress:
                progress(off + len(chunk), total)

    def nor_read(self, word_addr, length):
        want = length
        length = (length + 3) // 4 * 4
        out = bytearray()
        while length > 0:
            n = min(length, BUFFER_BYTES)
            self.send(p.cmd_nor_flash(False, word_addr, BUFFER_VP, n // 2))
            self.wait_done(p.VP_NOR_FLASH_RW, timeout=10)
            out += self.read_vp(BUFFER_VP, n // 2)
            word_addr += n // 2
            length -= n
        return bytes(out[:want])

    # -- pictures -----------------------------------------------------------
    def upload_jpeg(self, picture_id, data):
        """Decode a JPEG (max 64 KB, <= screen size) into picture slot."""
        if len(data) > BUFFER_BYTES:
            raise DeviceError("JPEG larger than 64 KB")
        self.write_vp(BUFFER_VP, data + b"\x00" * (len(data) % 2))
        self.send(p.cmd_jpeg_download(BUFFER_VP, p.JPEG_SAVE, picture_id))
        self.wait_done(p.VP_JPEG_DOWNLOAD, timeout=10)

    def upload_pixels(self, picture_id, rgb565, progress=None, blank_page=0):
        """Write a full-screen big-endian RGB565 frame into the picture
        buffer and save it as picture `picture_id`.

        Switches to page 0 first: it has no display variables in
        DGUS-reloaded, so the screen won't draw text over the frame buffer
        before it is saved.
        """
        self.page = blank_page
        total = len(rgb565)
        for off in range(0, total, BUFFER_BYTES):
            chunk = rgb565[off:off + BUFFER_BYTES]
            self.write_vp(BUFFER_VP, chunk)
            self.send(p.cmd_bmp_download(BUFFER_VP, len(chunk) // 2,
                                         off // 2))
            self.wait_done(p.VP_BMP_DOWNLOAD, timeout=10)
            if progress:
                progress(off + len(chunk), total)
        self.save_page(picture_id)

    # -- DWIN_SET upload ----------------------------------------------------
    def upload_file(self, path, verify=False, progress=None,
                    allow_os=False, screen_size=SCREEN_SIZE):
        """Upload one DWIN_SET file to where the SD loader would put it.

        Returns a short description, raises DeviceError for files that
        can't be sent over serial.
        """
        kind, index = classify(os.path.basename(path), allow_os)
        with open(path, "rb") as f:
            data = f.read()
        if kind == "nand":
            self.nand_write(index * p.NAND_FONT_SIZE, data, verify, progress)
            return "font space id %d (%d bytes)" % (index, len(data))
        if kind == "nor":
            self.nor_write(index * (p.NOR_LIB_SIZE // 2), data, verify,
                           progress)
            return "NOR database id %d (%d bytes)" % (index, len(data))
        if kind == "jpg":
            self.upload_jpeg(index, data)
            return "picture %d (JPEG)" % index
        if kind == "bmp":
            pixels = bmp_to_rgb565(data, screen_size)
            self.upload_pixels(index, pixels, progress)
            return "picture %d (BMP)" % index
        if kind == "os":
            self._upload_os(data)
            return "DWIN OS (%d bytes)" % len(data)
        raise DeviceError("cannot upload %s" % path)

    def _upload_os(self, data):
        code = data[0x1000:]   # DWIN OS code starts at 0x1000 in the file
        if len(code) > BUFFER_BYTES:
            raise DeviceError("DWIN OS image too large")
        self.write_vp(BUFFER_VP, code + b"\x00" * (len(code) % 2))
        self.send(p.cmd_os_update(BUFFER_VP))
        time.sleep(0.2)
        self.wait_done(p.VP_OS_UPDATE, timeout=10)


# ---------------------------------------------------------------------------
# DWIN_SET file handling
# ---------------------------------------------------------------------------
_ID_RE = re.compile(r"^(\d+)")


def classify(name, allow_os=False):
    """Map a DWIN_SET file name to (kind, id) following the T5UID1 SD
    rules; raises DeviceError with the reason for files we skip."""
    upper = name.upper()
    ext = os.path.splitext(upper)[1].lstrip(".")
    if upper.startswith("T5") and ext in ("BIN", "CFG"):
        raise DeviceError("%s: core firmware/CFG can only be loaded from "
                          "the SD card" % name)
    if upper.startswith("DWINOS") and ext == "BIN":
        if not allow_os:
            raise DeviceError("%s: DWIN OS upload needs allow_os" % name)
        return "os", None
    m = _ID_RE.match(name)
    if not m:
        raise DeviceError("%s: name must start with its id number" % name)
    index = int(m.group(1))
    if ext in ("BIN", "HZK", "DZK", "ICO"):
        if not 0 <= index < p.NAND_BLOCKS * p.NAND_BLOCK // p.NAND_FONT_SIZE:
            raise DeviceError("%s: font id out of range" % name)
        return "nand", index
    if ext == "LIB":
        if not 0 <= index < p.NOR_SIZE // p.NOR_LIB_SIZE:
            raise DeviceError("%s: LIB id must be 0-79" % name)
        return "nor", index
    if ext in ("JPG", "JPEG"):
        return "jpg", index
    if ext == "BMP":
        return "bmp", index
    if ext == "WAV":
        raise DeviceError("%s: WAV upload is not supported (format of the "
                          "audio space is undocumented)" % name)
    if ext == "ICL":
        raise DeviceError("%s: ICL files are for T5L screens" % name)
    raise DeviceError("%s: unknown file type" % name)


def plan_upload(directory, allow_os=False):
    """List (path, kind, id) for a DWIN_SET folder plus skipped files
    as (path, reason). Pictures go last so fonts/icons are in place."""
    order = {"os": 0, "nor": 1, "nand": 2, "jpg": 3, "bmp": 3}
    files, skipped = [], []
    for name in sorted(os.listdir(directory)):
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            continue
        try:
            kind, index = classify(name, allow_os)
        except DeviceError as e:
            skipped.append((path, str(e)))
            continue
        files.append((path, kind, index))
    files.sort(key=lambda f: (order[f[1]], f[2] or 0))
    return files, skipped


def bmp_to_rgb565(data, size=SCREEN_SIZE):
    """Convert an uncompressed 24/32-bit BMP to big-endian RGB565 rows,
    top to bottom. The image must be exactly `size` (w, h)."""
    if data[:2] != b"BM":
        raise DeviceError("not a BMP file")
    pix_off = struct.unpack_from("<I", data, 10)[0]
    w, h, _planes, bpp, comp = struct.unpack_from("<iiHHI", data, 18)
    if comp not in (0, 3) or bpp not in (24, 32):
        raise DeviceError("BMP must be uncompressed 24 or 32 bit")
    top_down = h < 0
    h = abs(h)
    if (w, h) != tuple(size):
        raise DeviceError("BMP is %dx%d, screen is %dx%d" % (w, h, *size))
    bpp //= 8
    stride = (w * bpp + 3) & ~3
    out = bytearray(w * h * 2)
    o = 0
    for row in range(h):
        src = pix_off + (row if top_down else h - 1 - row) * stride
        for x in range(w):
            b, g, r = data[src:src + 3]
            v = (r >> 3) << 11 | (g >> 2) << 5 | b >> 3
            out[o] = v >> 8
            out[o + 1] = v & 0xff
            o += 2
            src += bpp
    return bytes(out)
