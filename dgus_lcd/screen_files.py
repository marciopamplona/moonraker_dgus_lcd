# Readers/writers for compiled DGUS II screen project files, so pages can
# be added without the Windows DGUS editor:
#
#   13*.BIN  touch configuration  (DGUS Development Guide V4.3, ch. 7)
#   14*.BIN  display variables    (ch. 8; "DGUS_2" indexed layout)
#   *.BMP    24-bit page backgrounds, with a few drawing helpers
#
# Formats were checked against the DGUS-reloaded 1.0.2 release files.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import struct

# ---------------------------------------------------------------------------
# 13*.BIN: list of touch entries, terminated by FF FF
#   0  flags(1) page(1)     flags 0x08 = click sound
#   2  Xs Ys Xe Ye (2 each)
#   10 Pic_Next(2)  Pic_On(2)   0xFF.. = none
#   14 TP_Code(2)               0xFE../0xFD.. function, 0x00.. plain key
#   16 function data (size depends on the function)
# ---------------------------------------------------------------------------
TOUCH_SIZES = {
    0x00: 64,   # variable data input
    0x01: 48,   # popup menu
    0x02: 32,   # incremental adjustment
    0x03: 32,   # slider adjustment
    0x05: 32,   # return key code
}
FLAG_SOUND = 0x08


class FormatError(ValueError):
    pass


def _touch_size(entry_head):
    code = struct.unpack(">H", entry_head[14:16])[0]
    if code >> 8 in (0xfe, 0xfd):
        size = TOUCH_SIZES.get(code & 0xff)
        if size is None:
            raise FormatError("unknown touch function 0x%04x" % code)
        return size
    return 16


class TouchFile:
    """13*.BIN as a list of raw entries (bytes)."""

    def __init__(self, entries):
        self.entries = list(entries)

    @classmethod
    def parse(cls, data):
        entries, i = [], 0
        while True:
            if data[i:i + 2] == b"\xff\xff":
                if i + 2 != len(data):
                    raise FormatError("data after terminator at 0x%x" % i)
                return cls(entries)
            if i + 16 > len(data):
                raise FormatError("truncated entry at 0x%x" % i)
            size = _touch_size(data[i:i + 16])
            entries.append(bytes(data[i:i + size]))
            i += size

    def build(self):
        return b"".join(self.entries) + b"\xff\xff"

    @staticmethod
    def page_of(entry):
        return entry[1]

    def pages(self):
        return sorted({self.page_of(e) for e in self.entries})

    def for_page(self, page):
        return [e for e in self.entries if self.page_of(e) == page]

    def add(self, entry):
        """Insert after the last entry of the same page (keeps grouping)."""
        page = self.page_of(entry)
        pos = len(self.entries)
        for i, e in enumerate(self.entries):
            if self.page_of(e) <= page:
                pos = i + 1
        self.entries.insert(pos, entry)

    def remove_page(self, page):
        self.entries = [e for e in self.entries if self.page_of(e) != page]


def return_key(page, area, vp, key, sound=True, mode=0x00, upload=True):
    """A "return key code" (0x05) touch area writing `key` to `vp`."""
    xs, ys, xe, ye = area
    return (struct.pack(">BBHHHHHHH", FLAG_SOUND if sound else 0, page,
                        xs, ys, xe, ye, 0xff00, 0xff00,
                        0xfe05 if upload else 0xfd05)
            + struct.pack(">BHBH", 0xfe, vp, mode, key) + bytes(10))


def parse_return_key(entry):
    """-> dict for a 0x05 entry, or None."""
    if len(entry) != 32 or entry[15] != 0x05:
        return None
    xs, ys, xe, ye = struct.unpack(">4H", entry[2:10])
    vp, mode, key = struct.unpack(">HBH", entry[17:22])
    return {"page": entry[1], "area": (xs, ys, xe, ye), "vp": vp,
            "mode": mode, "key": key, "sound": bool(entry[0] & FLAG_SOUND)}


# ---------------------------------------------------------------------------
# 14*.BIN (DGUS_2 layout)
#   0x00  header (16 bytes: 14 'DGUS_2' ... max page id at 0x08)
#   0x10  index, 4 bytes per page: count(1) + byte offset(3)
#   0x4000 32-byte display variable entries, grouped by page
# ---------------------------------------------------------------------------
INDEX_OFF = 0x10
DATA_OFF = 0x4000
VAR_SIZE = 32
MAX_PAGES = (DATA_OFF - INDEX_OFF) // 4


class VariableFile:
    """14*.BIN as {page: [32-byte entries]}."""

    def __init__(self, header, pages, trailer=b""):
        self.header = bytes(header)
        self.pages = {p: list(v) for p, v in pages.items() if v}
        self.trailer = trailer

    @classmethod
    def parse(cls, data):
        if data[1:7] != b"DGUS_2":
            raise FormatError("not a DGUS_2 variable file")
        pages, used_end = {}, DATA_OFF
        for page in range(MAX_PAGES):
            i = INDEX_OFF + page * 4
            count = data[i]
            off = int.from_bytes(data[i + 1:i + 4], "big")
            if not count:
                continue
            end = off + count * VAR_SIZE
            if off < DATA_OFF or end > len(data):
                raise FormatError("bad index for page %d" % page)
            pages[page] = [bytes(data[off + k * VAR_SIZE:
                                      off + (k + 1) * VAR_SIZE])
                           for k in range(count)]
            used_end = max(used_end, end)
        return cls(data[:INDEX_OFF], pages, bytes(data[used_end:]))

    def build(self):
        index = bytearray(DATA_OFF - INDEX_OFF)
        body = bytearray()
        off = DATA_OFF
        for page in range(MAX_PAGES):
            entries = self.pages.get(page, [])
            if len(entries) > 255:
                raise FormatError("too many variables on page %d" % page)
            index[page * 4] = len(entries)
            index[page * 4 + 1:page * 4 + 4] = off.to_bytes(3, "big")
            for e in entries:
                if len(e) != VAR_SIZE:
                    raise FormatError("variable entry must be 32 bytes")
                body += e
            off += len(entries) * VAR_SIZE
        header = bytearray(self.header)
        top = max(self.pages) if self.pages else 0
        if struct.unpack(">H", header[8:10])[0] < top:
            header[8:10] = struct.pack(">H", top)
        return bytes(header) + bytes(index) + bytes(body) + self.trailer

    def add(self, page, entry):
        self.pages.setdefault(page, []).append(entry)


def text_var(vp, x, y, box, length, size=20, color=0xb5b6, encode=0x02,
             font0=0, font1=0):
    """A text (0x11) display variable, laid out like DGUS-reloaded's."""
    xs, ys, xe, ye = box
    return struct.pack(">BBHHHHHHHHHHHBBBBBBBB", 0x5a, 0x11, 0xffff, 0x000d,
                       vp, x, y, color, xs, ys, xe, ye, length,
                       font0, font1, size, size, encode, 0, 0, 0)


def parse_text_var(entry):
    if entry[:2] != b"\x5a\x11":
        return None
    (vp, x, y, color, xs, ys, xe, ye, length) = struct.unpack(
        ">9H", entry[6:24])
    return {"vp": vp, "pos": (x, y), "color": color,
            "box": (xs, ys, xe, ye), "length": length, "size": entry[27]}


# ---------------------------------------------------------------------------
# 24-bit BMP with simple drawing
# ---------------------------------------------------------------------------
class Bitmap:
    def __init__(self, width, height, pixels=None):
        self.w, self.h = width, height
        # rows top to bottom, RGB
        self.px = bytearray(pixels) if pixels else bytearray(width * height * 3)

    @classmethod
    def load(cls, data):
        if data[:2] != b"BM":
            raise FormatError("not a BMP")
        off = struct.unpack_from("<I", data, 10)[0]
        w, h, _, bpp, comp = struct.unpack_from("<iiHHI", data, 18)
        if bpp != 24 or comp != 0:
            raise FormatError("only 24-bit uncompressed BMP supported")
        top_down = h < 0
        h = abs(h)
        stride = (w * 3 + 3) & ~3
        bm = cls(w, h)
        for y in range(h):
            src = off + (y if top_down else h - 1 - y) * stride
            row = data[src:src + w * 3]
            # BGR -> RGB
            out = bytearray(w * 3)
            out[0::3], out[1::3], out[2::3] = row[2::3], row[1::3], row[0::3]
            bm.px[y * w * 3:(y + 1) * w * 3] = out
        return bm

    def save(self):
        stride = (self.w * 3 + 3) & ~3
        pad = b"\x00" * (stride - self.w * 3)
        rows = []
        for y in range(self.h - 1, -1, -1):
            row = self.px[y * self.w * 3:(y + 1) * self.w * 3]
            out = bytearray(self.w * 3)
            out[0::3], out[1::3], out[2::3] = row[2::3], row[1::3], row[0::3]
            rows.append(bytes(out) + pad)
        pixels = b"".join(rows)
        return (struct.pack("<2sIHHI", b"BM", 54 + len(pixels), 0, 0, 54)
                + struct.pack("<IiiHHIIiiII", 40, self.w, self.h, 1, 24, 0,
                              len(pixels), 2835, 2835, 0, 0)
                + pixels)

    def copy(self):
        return Bitmap(self.w, self.h, self.px)

    def get(self, x, y):
        i = (y * self.w + x) * 3
        return tuple(self.px[i:i + 3])

    def set(self, x, y, rgb):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i:i + 3] = bytes(rgb)

    def blit(self, src, sx, sy, w, h, dx, dy):
        """Copy a w*h block from `src` (sx, sy) to (dx, dy)."""
        for row in range(h):
            s = ((sy + row) * src.w + sx) * 3
            d = ((dy + row) * self.w + dx) * 3
            self.px[d:d + w * 3] = src.px[s:s + w * 3]

    def fill_from_strip(self, x0, y0, x1, y1, src, sx, sy, strip_h):
        """Fill (x0..x1, y0..y1) by repeating rows sy..sy+strip_h of `src`
        at column offset sx (keeps background texture)."""
        w = x1 - x0 + 1
        for y in range(y0, y1 + 1):
            ry = sy + (y - y0) % strip_h
            s = (ry * src.w + sx) * 3
            d = (y * self.w + x0) * 3
            self.px[d:d + w * 3] = src.px[s:s + w * 3]

    def line(self, x0, y0, x1, y1, rgb, width=1):
        """Thick line (square brush), Bresenham."""
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        r0 = -(width // 2)
        while True:
            for oy in range(r0, r0 + width):
                for ox in range(r0, r0 + width):
                    self.set(x0 + ox, y0 + oy, rgb)
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def rect(self, x0, y0, x1, y1, rgb, width=1):
        self.line(x0, y0, x1, y0, rgb, width)
        self.line(x1, y0, x1, y1, rgb, width)
        self.line(x1, y1, x0, y1, rgb, width)
        self.line(x0, y1, x0, y0, rgb, width)

    def to_png(self):
        import zlib
        raw = b"".join(b"\x00" + bytes(self.px[y * self.w * 3:
                                                (y + 1) * self.w * 3])
                       for y in range(self.h))

        def chunk(t, c):
            return (struct.pack(">I", len(c)) + t + c
                    + struct.pack(">I", zlib.crc32(t + c) & 0xffffffff))
        return (b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h,
                                             8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw))
                + chunk(b"IEND", b""))


def data_input(page, area, vp, v_type=0x01, n_int=5, n_dot=2,
               limits=(-9999999, 9999999), sound=True, keypad=0xca,
               kb_area=(0x90, 0x32, 0x14f, 0xfc), kb_pos=(0x90, 0x28),
               cursor=(0x142, 0x31), color=0x1082, font_w=0x0e):
    """A "variable data input" (0x00) touch area that pops up the numeric
    keypad page `keypad` and writes the value to `vp`.

    v_type 0x00 = int16, 0x01 = int32; the stored value is the typed number
    times 10**n_dot. Keypad geometry defaults are DGUS-reloaded's (page 202).
    """
    xs, ys, xe, ye = area
    head = struct.pack(">BBHHHHHHH", FLAG_SOUND if sound else 0, page,
                       xs, ys, xe, ye, 0xff00, 0xff00, 0xfe00)
    fmt = struct.pack(">BHBBBHHHBBBB", 0xfe, vp, v_type, n_int, n_dot,
                      cursor[0], cursor[1], color, 0x00, font_w, 0x00, 0x01)
    kb = struct.pack(">BBH4H2H", 0xfe, 0x01, keypad, *kb_area, *kb_pos)
    lo, hi = limits if limits else (0, 0)
    lim = struct.pack(">BBii6x", 0xfe, 0xff if limits else 0x00, lo, hi)
    return head + fmt + kb + lim


def fill_texture(bm, x0, y0, x1, y1, src, sx, sy, sw, sh):
    """Fill a rectangle by tiling the sw*sh patch of `src` at (sx, sy)."""
    for y in range(y0, y1 + 1):
        ry = sy + (y - y0) % sh
        x = x0
        while x <= x1:
            n = min(sw, x1 - x + 1)
            s = (ry * src.w + sx) * 3
            d = (y * bm.w + x) * 3
            bm.px[d:d + n * 3] = src.px[s:s + n * 3]
            x += n
