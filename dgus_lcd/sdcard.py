# Build a complete DWIN_SET folder, ready to copy to an SD card, with every
# screen change this repo provides. Everything comes from the repo; nothing
# is downloaded:
#
#   - the DGUS-reloaded-Klipper 1.0.2 project files from vendor/
#   - the compiled files upstream doesn't commit (13_touch.bin,
#     14_variable.bin, 22_config.bin) from vendor/DGUS-reloaded-Klipper-release/
#   - the Macros and Parameters pages (screen/macros/, or rebuilt)
#   - T5UID1.CFG with the chosen UART baud rate
#
#   ~/dgus-env/bin/python -m dgus_lcd.sdcard            # -> build/sdcard/
#   ~/dgus-env/bin/python -m dgus_lcd.sdcard --baud 115200
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import argparse
import os
import shutil
import sys
import tempfile

from . import macros_screen as ms
from . import screen_files as sf

DEFAULT_OUT = os.path.join(ms.REPO_DIR, "build", "sdcard")
DEFAULT_BAUD = 250000
VENDOR_DWIN_SET = os.path.join(ms.REPO_DIR, "vendor", "DGUS-reloaded-Klipper",
                               "project", "DWIN_SET")
# stock compiled 1.0.2 release files, which the project copy lacks
RELEASE_FILES = os.path.join(ms.REPO_DIR, "vendor",
                             "DGUS-reloaded-Klipper-release", "DWIN_SET")
CFG_NAME = "T5UID1.CFG"
REQUIRED = ("13_touch.bin", "14_variable.bin", "22_config.bin", CFG_NAME,
            "0_DWIN_ASC.HZK")

FLASHING = """\
DWIN_SET for the Ender-6 screen (DMT48270C043_06WT, T5UID1)
Built by moonraker_ender6_lcd: python -m dgus_lcd.sdcard

  Base    : DGUS-reloaded-Klipper 1.0.2 (vendor/)
  Macros  : Macros + Parameters pages ({macros})
  Baud    : {baud} (T5UID1.CFG)

Flashing
  1. Format an SD card (max 32 GB) as FAT32 with 4096-byte clusters.
       Linux: sudo mkfs.vfat -F 32 -s 8 /dev/sdX1
  2. Copy the DWIN_SET folder to the root of the card.
  3. Power off the printer, insert the card into the screen's slot
     (on the back of the screen board) and power on.
  4. Wait until the screen says it has finished (or shows "end"), power
     off, remove the card and power on again.

After flashing
  Set "baud: {baud}" in ~/printer_data/config/dgus_lcd.cfg, then
  restart the service:  sudo systemctl restart dgus_lcd
  Pass "-b {baud}" to dgustool.
"""


def build(out, baud=DEFAULT_BAUD, base=VENDOR_DWIN_SET,
          compiled=RELEASE_FILES, rebuild=False):
    """Write out/DWIN_SET and out/FLASHING.txt. Returns the DWIN_SET path.

    `base` is copied first, then the files of `compiled` that base lacks.
    That stock set is the input of --rebuild.
    """
    with open(os.path.join(base, CFG_NAME), "rb") as f:
        cfg = sf.set_cfg_baud(f.read(), baud)   # validate before writing

    dwin_set = os.path.join(out, "DWIN_SET")
    if os.path.isdir(dwin_set):
        shutil.rmtree(dwin_set)   # no stale files from an earlier build
    shutil.copytree(base, dwin_set)
    for name in sorted(os.listdir(compiled)):
        if not os.path.exists(os.path.join(dwin_set, name)):
            shutil.copy(os.path.join(compiled, name), dwin_set)
    missing = [n for n in REQUIRED
               if not os.path.isfile(os.path.join(dwin_set, n))]
    if missing:
        shutil.rmtree(dwin_set)
        raise SystemExit("incomplete DWIN_SET, missing %s" % ", ".join(missing))

    if rebuild:
        with tempfile.TemporaryDirectory() as tmp:
            for path in ms.build(dwin_set, tmp):   # stock files as input
                shutil.copy(path, dwin_set)
        macros = "rebuilt"
    else:
        for name in ms.FILES:
            shutil.copy(os.path.join(ms.PREBUILT, name), dwin_set)
        macros = "screen/macros"

    with open(os.path.join(dwin_set, CFG_NAME), "wb") as f:
        f.write(cfg)
    with open(os.path.join(out, "FLASHING.txt"), "w") as f:
        f.write(FLASHING.format(macros=macros, baud=baud))
    return dwin_set


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="python -m dgus_lcd.sdcard",
        description="Build an SD-card-ready DWIN_SET with the Macros pages "
        "and the baud rate setting")
    ap.add_argument("--base", default=VENDOR_DWIN_SET,
                    help="DWIN_SET to start from (default: vendor/"
                    "DGUS-reloaded-Klipper/project/DWIN_SET)")
    ap.add_argument("--out", default=DEFAULT_OUT,
                    help="output folder; DWIN_SET/ is created inside it "
                    "(default: build/sdcard in the repo)")
    ap.add_argument("--baud", type=int, default=DEFAULT_BAUD,
                    help="screen UART baud rate (default %(default)s; "
                    "115200 keeps the stock rate)")
    ap.add_argument("--rebuild", action="store_true",
                    help="rebuild the Macros pages instead of using "
                    "screen/macros (needs Pillow)")
    args = ap.parse_args(argv)
    try:
        sf.cfg_baud_value(args.baud)
    except sf.FormatError as e:
        ap.error(str(e))
    dwin_set = build(args.out, args.baud, args.base, rebuild=args.rebuild)
    files = os.listdir(dwin_set)
    size = sum(os.path.getsize(os.path.join(dwin_set, n)) for n in files)
    print("wrote %s (%d files, %.1f MB)" % (dwin_set, len(files),
                                            size / 1e6))
    print("flashing steps: %s" % os.path.join(args.out, "FLASHING.txt"))
    if args.baud != 115200:
        print("NOTE: this sets the screen to %d baud. After flashing, set "
              "'baud: %d' in dgus_lcd.cfg and restart dgus_lcd."
              % (args.baud, args.baud))
    return 0


if __name__ == "__main__":
    sys.exit(main())
