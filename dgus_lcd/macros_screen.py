# Build the "Macros" screen add-on for the DGUS-reloaded screen firmware.
#
# Takes the release DWIN_SET (DGUS-reloaded-Klipper 1.0.2) and writes the
# four files that change:
#
#   13_touch.bin          + Macros tile on page 18, touch areas of page 21
#   14_variable.bin       + text fields of page 21 and the tile label
#   018_settings_menu2.bmp  "More" page with a Macros tile
#   021_macros.bmp        new page: 6 macro tiles, < > arrows, back arrow
#
# The service side lives in dgus_lcd/firmware/dgus_reloaded/macros.cfg;
# the VP addresses below must match it.
#
#   ~/dgus-env/bin/python -m dgus_lcd.macros_screen            # -> build/
#   ~/dgus-env/bin/python -m dgus_lcd.macros_screen --out screen/macros
#
# A prebuilt copy is committed in screen/macros/; rebuild it with the
# second command after changing this file.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import argparse
import io
import os
import shutil
import sys
import tarfile
import urllib.request

from . import screen_files as sf

RELEASE_URL = ("https://github.com/Desuuuu/DGUS-reloaded-Klipper/releases/"
               "download/1.0.2/DWIN_SET.tar.gz")

PAGE_MORE = 18          # settings_menu2
PAGE_MACROS = 21        # new page id (free in 1.0.2)
PAGE_TEMPLATE = 9       # settings_menu: 6-tile grid used as background
VP_SWITCH_PAGE = 0x2000  # firmware's __switch_page input

# VP map of the add-on (all free in DGUS-reloaded, which stops at 0x5001)
VP_PAGE_INDICATOR = 0x5100   # str 8   "2/3"
VP_LABELS = 0x5110           # 12 x str 12, stride 8 words: tile i line j
LABEL_STRIDE = 0x08
_OLD_TEXT_VPS = (0x5180, 0x5190)  # title/caption fields of earlier builds

# Parameters page (opened for macros that take parameters)
PAGE_PARAMS = 22
PARAM_ROWS = 4
VP_PARAM_MACRO = 0x5200      # str 32  macro name
VP_PARAM_NAMES = 0x5220      # 4 x str 16, stride 0x10
VP_PARAM_VALUES = 0x5260     # 4 x str 16, stride 0x10
VP_PARAM_INDICATOR = 0x52A0  # str 8   "1/2"
VP_PARAM_INPUT = 0x52B0      # 4 x int32 (value x 100), stride 2
VP_PARAM_KEY = 0x52C0        # input: 1 previous, 2 next, 3 run, 4 reset
PKEY_PREV, PKEY_NEXT, PKEY_RUN, PKEY_RESET = 1, 2, 3, 4
PARAM_ROW_Y = [70 + r * 40 for r in range(PARAM_ROWS)]   # row tops, 34 high
PARAM_BOX_X = (240, 450)     # value box
PARAM_BUTTONS = {            # bottom bar buttons, y 232..265
    PKEY_PREV: (30, 90), PKEY_RESET: (190, 270), PKEY_RUN: (290, 370),
    PKEY_NEXT: (390, 450)}
PARAM_BAR_Y = (232, 265)
VP_MACRO_KEY = 0x51A0        # input: 1-6 tile, 7 previous, 8 next
KEY_PREV, KEY_NEXT = 7, 8
LABEL_CHARS = 12
TILES_PER_PAGE = 6

# Tile grid of the settings pages (inclusive pixel bounds)
TILE_COLS = [(57, 158), (189, 290), (321, 422)]
TILE_ROWS = [(45, 146), (158, 259)]
TOUCH_COLS = [(56, 158), (189, 291), (321, 423)]   # as in 13_touch.bin
TOUCH_ROWS = [(45, 147), (158, 260)]
BACK_AREA = (0, 0, 39, 39)
PREV_AREA = (0, 96, 54, 208)
NEXT_AREA = (425, 96, 479, 208)
ICON = (170, 170, 170)

# Static text is drawn into the BMPs like the original pages: Segoe UI there,
# Selawik (its open-licensed metric twin) here. Values measured on 1.0.2.
FONT = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "vendor", "selawik", "selawk.ttf")
FONT_SIZE = 17
TITLE_POS = (39, 4)          # text origin of "Settings" on page 9
TITLE_COLOR = (190, 190, 190)
CAPTION_DY = 76              # caption origin below the tile's top border
CAPTION_COLOR = (170, 170, 170)

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_DIR, "build", "dgus_macros")
PREBUILT = os.path.join(REPO_DIR, "screen", "macros")

FILES = ("13_touch.bin", "14_variable.bin", "018_settings_menu2.bmp",
         "021_macros.bmp", "022_macro_params.bmp")


def label_vp(tile, line):
    return VP_LABELS + (tile * 2 + line) * LABEL_STRIDE


def param_name_vp(row):
    return VP_PARAM_NAMES + row * 0x10


def param_value_vp(row):
    return VP_PARAM_VALUES + row * 0x10


def param_input_vp(row):
    return VP_PARAM_INPUT + row * 2


def draw_text(bm, text, xy, color, center_x=None):
    """Anti-aliased text in the pages' font, blended onto `bm`."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise SystemExit("Pillow is needed to build the screen files: "
                         "~/dgus-env/bin/pip install pillow")
    font = ImageFont.truetype(FONT, FONT_SIZE,
                              layout_engine=ImageFont.Layout.BASIC)
    x, y = xy
    if center_x is not None:
        x = round(center_x - font.getlength(text) / 2)
    img = Image.frombytes("RGB", (bm.w, bm.h), bytes(bm.px))
    ImageDraw.Draw(img).text((x, y), text, font=font, fill=color)
    bm.px[:] = img.tobytes()


def _blank_tile(bm, col, row, clean):
    """Erase icon + caption inside a tile, keeping its texture."""
    (x0, x1), (y0, y1) = TILE_COLS[col], TILE_ROWS[row]
    # rows just under the top border are clean interior
    bm.fill_from_strip(x0 + 2, y0 + 3, x1 - 2, y1 - 2, clean, x0 + 2,
                       y0 + 3, 12)


def build_macros_bitmap(template):
    bm = template.copy()
    for row in range(2):
        for col in range(3):
            _blank_tile(bm, col, row, template)
    # header: erase the "Settings" title, keep the back arrow (x < 32)
    bm.fill_from_strip(32, 2, 175, 30, template, 200, 2, 26)
    draw_text(bm, "Macros", TITLE_POS, TITLE_COLOR)
    # < and > in the side margins
    cy = (PREV_AREA[1] + PREV_AREA[3]) // 2
    bm.line(36, cy - 22, 16, cy, ICON, 4)
    bm.line(16, cy, 36, cy + 22, ICON, 4)
    bm.line(443, cy - 22, 463, cy, ICON, 4)
    bm.line(463, cy, 443, cy + 22, ICON, 4)
    return bm


def _tile_color(template):
    """Average colour of a clean strip inside the first tile."""
    (x0, x1), (y0, _) = TILE_COLS[0], TILE_ROWS[0]
    px = [template.get(x, y) for x in range(x0 + 3, x1 - 2)
          for y in range(y0 + 3, y0 + 15)]
    return tuple(round(sum(c[i] for c in px) / len(px)) for i in range(3))


def _box(bm, x0, y0, x1, y1, template):
    """A tile-style box: 1 px dark border, flat tile-coloured inside."""
    color = _tile_color(template)
    row = bytes(color) * (x1 - x0 - 1)
    for y in range(y0 + 1, y1):
        d = (y * bm.w + x0 + 1) * 3
        bm.px[d:d + len(row)] = row
    bm.rect(x0, y0, x1, y1, (22, 22, 22), 1)


def _chevron(bm, cx, cy, left, size=9):
    d = -size if left else size
    bm.line(cx - d // 2, cy - size, cx + d // 2, cy, ICON, 3)
    bm.line(cx + d // 2, cy, cx - d // 2, cy + size, ICON, 3)


def build_params_bitmap(template):
    bm = template.copy()
    # plain background below the header, from the empty left margin
    sf.fill_texture(bm, 0, 33, bm.w - 1, bm.h - 1, template, 2, 40, 50, 200)
    bm.fill_from_strip(32, 2, 175, 30, template, 200, 2, 26)
    draw_text(bm, "Parameters", TITLE_POS, TITLE_COLOR)
    for y in PARAM_ROW_Y:
        _box(bm, PARAM_BOX_X[0], y, PARAM_BOX_X[1], y + 33, template)
    y0, y1 = PARAM_BAR_Y
    for key, (x0, x1) in PARAM_BUTTONS.items():
        _box(bm, x0, y0, x1, y1, template)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        if key in (PKEY_PREV, PKEY_NEXT):
            _chevron(bm, cx, cy, key == PKEY_PREV)
        else:
            draw_text(bm, "Run" if key == PKEY_RUN else "Reset",
                      (0, y0 + 5), CAPTION_COLOR, center_x=(x0 + x1) / 2)
    return bm


def build_more_bitmap(more, template):
    """Add a Macros tile in the free bottom-middle slot of page 18."""
    bm = more.copy()
    (x0, x1), (y0, y1) = TILE_COLS[1], TILE_ROWS[1]
    m = 3   # include the tile's border and a bit of surrounding background
    blank = template.copy()
    _blank_tile(blank, 1, 1, template)
    bm.blit(blank, x0 - m, y0 - m, x1 - x0 + 1 + 2 * m, y1 - y0 + 1 + 2 * m,
            x0 - m, y0 - m)
    # icon: a script page with lines and a play triangle
    cx, top = (x0 + x1) // 2, y0 + 18
    bm.rect(cx - 22, top, cx + 22, top + 50, ICON, 3)
    for k, ln in enumerate((26, 20, 26)):
        yy = top + 12 + k * 10
        bm.line(cx - 14, yy, cx - 14 + ln, yy, ICON, 3)
    for k in range(9):   # small filled triangle bottom right
        bm.line(cx + 12, top + 34 + k // 2, cx + 12 + k, top + 34 + k // 2,
                ICON, 1)
        bm.line(cx + 12, top + 46 - k // 2, cx + 12 + k, top + 46 - k // 2,
                ICON, 1)
    draw_text(bm, "Macros", (0, y0 + CAPTION_DY), CAPTION_COLOR,
              center_x=(x0 + x1) / 2)
    return bm


def patch_touch(touch):
    touch.remove_page(PAGE_MACROS)
    # drop an earlier Macros tile so the build is repeatable
    touch.entries = [e for e in touch.entries
                     if not (sf.parse_return_key(e) or {}).get("key") ==
                     PAGE_MACROS or touch.page_of(e) != PAGE_MORE]
    (tx0, tx1), (ty0, ty1) = TOUCH_COLS[1], TOUCH_ROWS[1]
    touch.add(sf.return_key(PAGE_MORE, (tx0, ty0, tx1, ty1),
                            VP_SWITCH_PAGE, PAGE_MACROS))
    touch.add(sf.return_key(PAGE_MACROS, BACK_AREA, VP_SWITCH_PAGE,
                            PAGE_MORE))
    for i in range(TILES_PER_PAGE):
        (x0, x1), (y0, y1) = TOUCH_COLS[i % 3], TOUCH_ROWS[i // 3]
        touch.add(sf.return_key(PAGE_MACROS, (x0, y0, x1, y1),
                                VP_MACRO_KEY, i + 1))
    touch.add(sf.return_key(PAGE_MACROS, PREV_AREA, VP_MACRO_KEY, KEY_PREV))
    touch.add(sf.return_key(PAGE_MACROS, NEXT_AREA, VP_MACRO_KEY, KEY_NEXT))

    touch.remove_page(PAGE_PARAMS)
    touch.add(sf.return_key(PAGE_PARAMS, BACK_AREA, VP_SWITCH_PAGE,
                            PAGE_MACROS))
    for r, y in enumerate(PARAM_ROW_Y):
        touch.add(sf.data_input(PAGE_PARAMS, (PARAM_BOX_X[0], y,
                                              PARAM_BOX_X[1], y + 33),
                                param_input_vp(r)))
    for key, (x0, x1) in PARAM_BUTTONS.items():
        touch.add(sf.return_key(PAGE_PARAMS, (x0, PARAM_BAR_Y[0], x1,
                                              PARAM_BAR_Y[1]),
                                VP_PARAM_KEY, key))
    return touch


def patch_variables(var):
    more = [e for e in var.pages.get(PAGE_MORE, [])
            if (sf.parse_text_var(e) or {}).get("vp") not in _OLD_TEXT_VPS]
    var.pages[PAGE_MORE] = more
    message = next(e for e in more
                   if (sf.parse_text_var(e) or {}).get("vp") == 0x3000)

    entries = [message]
    for i in range(TILES_PER_PAGE):
        (x0, x1), (y0, y1) = TILE_COLS[i % 3], TILE_ROWS[i // 3]
        mid = (y0 + y1) // 2
        for line in range(2):
            y = mid - 18 + line * 20
            entries.append(sf.text_var(label_vp(i, line), x0 + 3, y,
                                       (x0 + 2, y, x1 - 2, y + 16),
                                       LABEL_CHARS, size=16))
    entries.append(sf.text_var(VP_PAGE_INDICATOR, 428, 214,
                               (426, 214, 478, 230), 8, size=16))
    var.pages[PAGE_MACROS] = entries

    entries = [message,
               sf.text_var(VP_PARAM_MACRO, 20, 42, (20, 42, 460, 61), 32)]
    for r, y in enumerate(PARAM_ROW_Y):
        entries.append(sf.text_var(param_name_vp(r), 30, y + 7,
                                   (30, y + 7, 230, y + 26), 16))
        entries.append(sf.text_var(param_value_vp(r), PARAM_BOX_X[0] + 8,
                                   y + 7, (PARAM_BOX_X[0] + 4, y + 7,
                                           PARAM_BOX_X[1] - 4, y + 26), 16))
    x0, x1 = PARAM_BUTTONS[PKEY_PREV][1] + 4, PARAM_BUTTONS[PKEY_RESET][0] - 4
    entries.append(sf.text_var(VP_PARAM_INDICATOR, x0 + 10, 240,
                               (x0, 240, x1, 256), 8, size=16))
    var.pages[PAGE_PARAMS] = entries
    return var


def build(release_dir, out_dir, preview=False):
    def rd(name):
        with open(os.path.join(release_dir, name), "rb") as f:
            return f.read()
    template = sf.Bitmap.load(rd("009_settings_menu.bmp"))
    more = sf.Bitmap.load(rd("018_settings_menu2.bmp"))
    touch = patch_touch(sf.TouchFile.parse(rd("13_touch.bin")))
    var = patch_variables(sf.VariableFile.parse(rd("14_variable.bin")))
    out = {
        "13_touch.bin": touch.build(),
        "14_variable.bin": var.build(),
        "018_settings_menu2.bmp": build_more_bitmap(more, template),
        "021_macros.bmp": build_macros_bitmap(template),
        "022_macro_params.bmp": build_params_bitmap(template),
    }
    os.makedirs(out_dir, exist_ok=True)
    for name, data in out.items():
        if isinstance(data, sf.Bitmap):
            if preview:
                with open(os.path.join(out_dir, name[:-4] + ".png"),
                          "wb") as f:
                    f.write(data.to_png())
            data = data.save()
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(data)
    return [os.path.join(out_dir, n) for n in FILES]


def fetch_release(dest):
    """Download and unpack the 1.0.2 DWIN_SET into dest/DWIN_SET."""
    with urllib.request.urlopen(RELEASE_URL, timeout=60) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        for m in tf.getmembers():
            name = os.path.normpath(m.name)
            if (not m.isfile() or name.startswith("..")
                    or os.path.isabs(name)):
                continue   # only plain files inside dest
            target = os.path.join(dest, name)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with tf.extractfile(m) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return os.path.join(dest, "DWIN_SET")


RELEASE_CACHE = os.path.expanduser("~/.cache/dgus_lcd/release-1.0.2")


def release_dir():
    """The cached 1.0.2 DWIN_SET folder, downloaded on first use."""
    release = os.path.join(RELEASE_CACHE, "DWIN_SET")
    if not os.path.isdir(release):
        print("downloading %s" % RELEASE_URL)
        fetch_release(RELEASE_CACHE)
    return release


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the Macros screen files")
    ap.add_argument("--release", help="unpacked DGUS-reloaded-Klipper 1.0.2 "
                    "DWIN_SET folder (downloaded if omitted)")
    ap.add_argument("--out", default=DEFAULT_OUT,
                    help="output folder (default: build/dgus_macros in the "
                    "repo; the committed copy is screen/macros)")
    ap.add_argument("--preview", action="store_true",
                    help="also write PNG previews of the pages")
    args = ap.parse_args(argv)
    release = args.release or release_dir()
    for path in build(release, args.out, args.preview):
        print("wrote %s" % path)
    print("upload with: ~/dgus-env/bin/python -m dgus_lcd.dgustool upload "
          + " ".join(os.path.join(args.out, n) for n in FILES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
