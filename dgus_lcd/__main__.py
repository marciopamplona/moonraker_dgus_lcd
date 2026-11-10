# DGUS Reloaded touchscreen service for Klipper/Moonraker
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import argparse
import asyncio
import configparser
import json
import logging
import logging.handlers
import os
import signal
import sys

from . import engine as eng
from .firmware import dgus_reloaded
from .moonraker import Moonraker
from .serial_link import DGUSSerial

log = logging.getLogger("dgus")

FIRMWARES = {"dgus_reloaded": dgus_reloaded}


class Firmware:
    def __init__(self, module):
        self.configuration = module.configuration
        self.directory = os.path.dirname(os.path.abspath(module.__file__))


def load_state(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def make_state_saver(path):
    def save(**values):
        state = load_state(path)
        state.update(values)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(state, f)
            os.replace(tmp, path)
        except OSError as e:
            log.warning("Cannot save state to %s: %s", path, e)
    return save


def parse_config(path):
    cp = configparser.RawConfigParser(strict=False)
    cp.optionxform = str
    if not cp.read(path):
        raise SystemExit("Cannot read config file %s" % path)
    if not cp.has_section("dgus_lcd"):
        raise SystemExit("Missing [dgus_lcd] section in %s" % path)
    s = dict(cp.items("dgus_lcd"))

    def f(key, default=None):
        val = s.get(key)
        return default if val in (None, "") else float(val)

    def i(key, default):
        val = s.get(key)
        return default if val in (None, "") else int(val)

    fw_name = s.get("firmware", "dgus_reloaded")
    if fw_name not in FIRMWARES:
        raise SystemExit("Unknown firmware '%s'" % fw_name)
    fw = Firmware(FIRMWARES[fw_name])

    state_file = os.path.expanduser(s.get(
        "state_file", "~/printer_data/dgus_lcd/state.json"))
    state = load_state(state_file)

    opts = {
        "serial": s.get("serial", "/dev/ttyS1"),
        "baud": i("baud", 115200),
        "moonraker_url": s.get("moonraker_url",
                               "ws://127.0.0.1:7125/websocket"),
        "api_key": s.get("api_key") or None,
        "machine_name": s.get("machine_name", "Generic 3D printer"),
        "update_interval": max(1, min(10, i("update_interval", 2))),
        "volume": int(state.get("volume", i("volume", 75))),
        "brightness": int(state.get("brightness", i("brightness", 100))),
        "boot_sound": i("boot_sound", fw.configuration["boot_sound"]),
        "notification_sound": i("notification_sound",
                                fw.configuration["notification_sound"]),
        "save_state": make_state_saver(state_file),
        "log_level": s.get("log_level", "INFO").upper(),
    }
    for axis in ("x", "y", "z"):
        opts[axis + "_min"] = f(axis + "_min")
        opts[axis + "_max"] = f(axis + "_max")
    for key in ("x_min_inset", "x_max_inset", "y_min_inset", "y_max_inset"):
        opts[key] = f(key, 30.0)

    # Any t5uid1_var / t5uid1_page / t5uid1_routine sections in the user
    # config override the built-in ones of the same name.
    user_sections = [eng.Section(name, dict(cp.items(name)))
                     for name in cp.sections()
                     if name.split(" ")[0] in ("t5uid1_var", "t5uid1_page",
                                               "t5uid1_routine")]
    return opts, fw, user_sections


def setup_logging(level, logfile):
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(getattr(logging, level, logging.INFO))
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    if logfile:
        os.makedirs(os.path.dirname(os.path.abspath(logfile)), exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(
            logfile, maxBytes=2 * 1024 * 1024, backupCount=2)
        fh.setFormatter(fmt)
        root.addHandler(fh)
    logging.getLogger("websockets").setLevel(logging.WARNING)


async def main_async(opts, fw, user_sections):
    holder = {}

    def on_read(address, data):
        holder["engine"].handle_received(address, data)

    def on_open():
        holder["engine"].on_serial_open()

    serial_link = DGUSSerial(opts["serial"], opts["baud"], on_read, on_open)
    moonraker = Moonraker(opts["moonraker_url"], opts["api_key"])
    engine = eng.Engine(opts, fw, user_sections, serial_link, moonraker)
    holder["engine"] = engine
    moonraker._on_connect = engine.on_moonraker_connect
    moonraker._on_disconnect = engine.on_moonraker_disconnect
    moonraker._on_notify = engine.on_notify

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    tasks = [asyncio.create_task(c) for c in (
        serial_link.run(), moonraker.run(), engine.gcode_worker(),
        engine.screen_task(), engine.klippy_poll_task())]
    await stop.wait()
    log.info("Stopping")
    engine.shutdown()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    serial_link.close()


def main():
    ap = argparse.ArgumentParser(description="DGUS Reloaded LCD service")
    ap.add_argument("-c", "--config",
                    default=os.path.expanduser(
                        "~/printer_data/config/dgus_lcd.cfg"))
    ap.add_argument("-l", "--logfile",
                    default=os.path.expanduser(
                        "~/printer_data/logs/dgus_lcd.log"))
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    opts, fw, user_sections = parse_config(args.config)
    setup_logging("DEBUG" if args.verbose else opts["log_level"],
                  args.logfile)
    try:
        asyncio.run(main_async(opts, fw, user_sections))
    except eng.ConfigError as e:
        log.error("Config error: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
