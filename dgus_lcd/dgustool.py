# Command-line tool for the DGUS screen: info, control and serial upload
# of DWIN_SET files (DgusDude features). Run:
#
#   ~/dgus-env/bin/python -m dgus_lcd.dgustool --help
#
# The dgus_lcd service must be stopped while this runs.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import argparse
import datetime
import json
import logging
import os
import subprocess
import sys
import time

from . import dgus_protocol as p
from .dgus_device import (DGUSDevice, DeviceError, SCREEN_SIZE, classify,
                          plan_upload)


def _int(s):
    return int(s, 0)


def _service_running():
    try:
        return subprocess.run(["systemctl", "is-active", "--quiet",
                               "dgus_lcd"]).returncode == 0
    except FileNotFoundError:
        return False


def _progress(label):
    start = time.monotonic()

    def cb(done, total):
        rate = done / max(time.monotonic() - start, 1e-3) / 1024
        sys.stderr.write("\r  %s %3d%% %d/%d bytes %.1f KB/s" % (
            label, done * 100 // max(total, 1), done, total, rate))
        if done >= total:
            sys.stderr.write("\n")
        sys.stderr.flush()
    return cb


# -- commands ----------------------------------------------------------------
def cmd_info(dev, args):
    info = dev.info()
    if args.json:
        print(json.dumps(info, indent=2))
        return
    y, mo, d, wd, h, mi, s = info["rtc"]
    cfg, bl, t = info["config"], info["backlight"], info["touch"]
    print("Device ID    : %s" % info["device_id"])
    print("Version      : GUI 0x%02x, OS 0x%02x" % info["version"])
    print("RTC          : %04d-%02d-%02d %02d:%02d:%02d" % (y, mo, d, h, mi, s))
    print("Page         : %d (%s)" % (info["page"],
                                      "idle" if info["idle"] else "busy"))
    print("VCC          : %.3f V" % info["vcc"])
    print("Core temp    : %.1f C" % info["core_temp"])
    print("ADC (mV)     : %s" % info["adc_mv"])
    print("SD folder    : %s" % info["folder"])
    print("Config       : rotation %d, touch sound %s, standby backlight %s,"
          " SD %s, %d controls/page, load 22.bin %s, touch mode 0x%02x,"
          " sensitivity %d" % (
              cfg["rotation"], cfg["touch_sound"], cfg["standby_backlight"],
              cfg["sd_enabled"], cfg["controls_per_page"], cfg["load_22"],
              cfg["touch_mode"], cfg["touch_sensitivity"]))
    print("Backlight    : now %d, on %d, standby %d after %d ms" % (
        info["brightness_now"], bl["on"], bl["standby"], bl["timeout_ms"]))
    print("Touch        : x=%d y=%d state=%d" % (t["x"], t["y"], t["state"]))


def cmd_read(dev, args):
    data = dev.read_vp(args.address, args.words)
    for i in range(0, len(data), 16):
        print("%04x: %s" % (args.address + i // 2, data[i:i + 16].hex(" ")))


def cmd_write(dev, args):
    dev.write_vp(args.address, bytes.fromhex("".join(args.hex)))


def cmd_page(dev, args):
    if args.id is None:
        print(dev.page)
    else:
        dev.page = args.id


def cmd_save_page(dev, args):
    dev.save_page(args.id)


def cmd_reset(dev, args):
    dev.reset(args.full)


def cmd_play(dev, args):
    dev.send(p.cmd_play_music(args.start, args.count, args.volume))


def cmd_beep(dev, args):
    dev.send(p.cmd_beep(args.ms))


def cmd_brightness(dev, args):
    dev.send(p.cmd_brightness(args.on, args.standby, args.timeout))


def cmd_rtc(dev, args):
    dt = (datetime.datetime.fromisoformat(args.time) if args.time
          else datetime.datetime.now())
    dev.send(p.cmd_rtc_set(dt) if args.hardware else p.cmd_rtc_write(dt))


def cmd_touch(dev, args):
    modes = {"click": p.TOUCH_CLICK, "press": p.TOUCH_PRESS,
             "release": p.TOUCH_RELEASE, "hold": p.TOUCH_HOLD}
    dev.touch(args.x, args.y, modes[args.mode])


def cmd_control(dev, args):
    dev.set_control(args.page, args.control, args.keycode,
                    args.state == "on")


def cmd_config(dev, args):
    changes = {}
    if args.rotation is not None:
        changes["rotation"] = args.rotation
    for key in ("touch_sound", "standby_backlight", "sd_enabled"):
        val = getattr(args, key)
        if val is not None:
            changes[key] = val == "on"
    if not changes:
        print(json.dumps(p.parse_system_config(
            dev.read_vp(p.VP_SYSTEM_CONFIG, 2)), indent=2))
        return
    dev.set_config(**changes)


def cmd_monitor(dev, args):
    print("Waiting for touch uploads, Ctrl-C to stop")
    try:
        while True:
            f = dev.wait_key(1.0)
            if f is not None:
                print("VP 0x%04x = %s" % (f.address, f.data.hex(" ")))
    except KeyboardInterrupt:
        pass


def cmd_nand_read(dev, args):
    data = dev.nand_read(args.offset, args.length)
    with open(args.output, "wb") as f:
        f.write(data)
    print("%d bytes -> %s" % (len(data), args.output))


def cmd_upload(dev, args):
    files, skipped = [], []
    for path in args.paths:
        if os.path.isdir(path):
            f, s = plan_upload(path, args.allow_os)
            files += f
            skipped += s
        else:
            try:
                kind, index = classify(os.path.basename(path), args.allow_os)
            except DeviceError as e:
                skipped.append((path, str(e)))
                continue
            files.append((path, kind, index))
    for path, reason in skipped:
        print("skip  %s" % reason)
    if args.dry_run:
        for path, kind, index in files:
            print("would upload %s (%s %s)" % (path, kind or "?",
                                               "" if index is None else index))
        return
    if dev is None:
        return
    for path, _kind, _index in files:
        print("upload %s" % os.path.basename(path))
        try:
            where = dev.upload_file(path, args.verify,
                                    _progress(os.path.basename(path)),
                                    args.allow_os, args.screen_size)
            print("  -> %s" % where)
        except DeviceError as e:
            print("  failed: %s" % e)
            if not args.keep_going:
                raise
    if not args.no_reset:
        print("resetting screen")
        dev.reset()


def build_parser():
    ap = argparse.ArgumentParser(
        prog="dgustool", description="DWIN DGUS (T5UID1) screen tool")
    ap.add_argument("-p", "--port", default="/dev/ttyS1")
    ap.add_argument("-b", "--baud", type=int, default=115200)
    ap.add_argument("--crc", action="store_true",
                    help="screen has UART CRC enabled")
    ap.add_argument("--no-ack", action="store_true",
                    help="don't wait for 4F 4B replies")
    ap.add_argument("--timeout", type=float, default=1.0)
    ap.add_argument("--force", action="store_true",
                    help="run even if the dgus_lcd service is active")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info", help="show device information")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_info)

    s = sub.add_parser("read", help="read VP words")
    s.add_argument("address", type=_int)
    s.add_argument("words", type=_int, nargs="?", default=1)
    s.set_defaults(func=cmd_read)

    s = sub.add_parser("write", help="write hex bytes to a VP")
    s.add_argument("address", type=_int)
    s.add_argument("hex", nargs="+")
    s.set_defaults(func=cmd_write)

    s = sub.add_parser("page", help="show or switch the current page")
    s.add_argument("id", type=_int, nargs="?")
    s.set_defaults(func=cmd_page)

    s = sub.add_parser("save-page", help="save the screen as picture ID")
    s.add_argument("id", type=_int)
    s.set_defaults(func=cmd_save_page)

    s = sub.add_parser("reset", help="reboot the screen")
    s.add_argument("--full", action="store_true",
                   help="also pulse /RST_OUT")
    s.set_defaults(func=cmd_reset)

    s = sub.add_parser("play", help="play audio sections")
    s.add_argument("start", type=_int)
    s.add_argument("count", type=_int, nargs="?", default=1)
    s.add_argument("volume", type=_int, nargs="?", default=0xff)
    s.set_defaults(func=cmd_play)

    s = sub.add_parser("beep", help="buzzer (buzzer-mode screens only)")
    s.add_argument("ms", type=_int)
    s.set_defaults(func=cmd_beep)

    s = sub.add_parser("brightness", help="set backlight 0-100")
    s.add_argument("on", type=_int)
    s.add_argument("--standby", type=_int)
    s.add_argument("--timeout", type=_int, help="standby after N ms")
    s.set_defaults(func=cmd_brightness)

    s = sub.add_parser("rtc", help="set the clock (default: now)")
    s.add_argument("time", nargs="?", help="ISO time, e.g. 2026-11-10T12:00")
    s.add_argument("--hardware", action="store_true",
                   help="set the hardware RTC (0x9C) instead of 0x10")
    s.set_defaults(func=cmd_rtc)

    s = sub.add_parser("touch", help="simulate a touch")
    s.add_argument("x", type=_int)
    s.add_argument("y", type=_int)
    s.add_argument("--mode", default="click",
                   choices=["click", "press", "release", "hold"])
    s.set_defaults(func=cmd_touch)

    s = sub.add_parser("control", help="enable/disable a touch control")
    s.add_argument("page", type=_int)
    s.add_argument("control", type=_int)
    s.add_argument("keycode", type=_int)
    s.add_argument("state", choices=["on", "off"])
    s.set_defaults(func=cmd_control)

    s = sub.add_parser("config", help="show/change 0x80 system config")
    s.add_argument("--rotation", type=int, choices=[0, 90, 180, 270])
    for name in ("touch-sound", "standby-backlight", "sd-enabled"):
        s.add_argument("--" + name, choices=["on", "off"])
    s.set_defaults(func=cmd_config)

    s = sub.add_parser("monitor", help="print touch uploads")
    s.set_defaults(func=cmd_monitor)

    s = sub.add_parser("nand-read", help="dump font space (16-32 MB only)")
    s.add_argument("offset", type=_int)
    s.add_argument("length", type=_int)
    s.add_argument("-o", "--output", required=True)
    s.set_defaults(func=cmd_nand_read)

    s = sub.add_parser("upload", help="upload DWIN_SET files or folders")
    s.add_argument("paths", nargs="+")
    s.add_argument("--verify", action="store_true",
                   help="read back (only possible for some areas)")
    s.add_argument("--dry-run", action="store_true",
                   help="only show what would be uploaded")
    s.add_argument("--no-reset", action="store_true")
    s.add_argument("--keep-going", action="store_true")
    s.add_argument("--allow-os", action="store_true",
                   help="also flash DWINOS*.BIN")
    s.add_argument("--screen-size", type=lambda v: tuple(
        int(x) for x in v.lower().split("x")), default=SCREEN_SIZE,
        help="BMP size WxH (default 480x272)")
    s.set_defaults(func=cmd_upload)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose
                        else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    if getattr(args, "dry_run", False):
        args.func(None, args)
        return 0
    if not args.force and _service_running():
        print("dgus_lcd service is running and owns the port; stop it with "
              "'sudo systemctl stop dgus_lcd' (or pass --force)",
              file=sys.stderr)
        return 2
    try:
        with DGUSDevice(args.port, args.baud, args.crc, args.timeout,
                        False if args.no_ack else "auto") as dev:
            args.func(dev, args)
    except DeviceError as e:
        print("error: %s" % e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
