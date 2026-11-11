# DGUS T5UID1 touchscreen engine driven by Moonraker
#
# Port of Desuuuu's Klipper "t5uid1" module (klippy/extras/t5uid1) to a
# standalone host service: the same var/page/routine definitions and Jinja
# scripts are evaluated against printer state obtained through Moonraker, and
# G-Code is sent through Moonraker instead of running inside Klippy.
#
# Copyright (C) 2020  Desuuuu <contact@desuuuu.com> (original module)
# This file may be distributed under the terms of the GNU GPLv3 license.
import asyncio
import collections
import configparser
import logging
import os
import re
import struct
import textwrap
import time

import jinja2

from . import dgus_protocol as proto
from . import macro_params

log = logging.getLogger("dgus.engine")

ADDR_VERSION = proto.VP_VERSION
ADDR_PIC_NOW = proto.VP_PIC_NOW
ADDR_BRIGHTNESS = proto.VP_LED_CONFIG
ADDR_PAGE = proto.VP_PIC_SET
ADDR_SOUND = proto.VP_MUSIC_PLAY
ADDR_VOLUME = proto.VP_MUSIC_VOLUME
ADDR_CONTROL = proto.VP_TOUCH_CONTROL

ABORT_MARKER = "DGUS_ABORT_PAGE_SWITCH"

CONTROL_TYPES = {
    'variable_data_input': 0x00,
    'popup_window':        0x01,
    'incremental_adjust':  0x02,
    'slider_adjust':       0x03,
    'rtc_settings':        0x04,
    'return_key_code':     0x05,
    'text_input':          0x06,
    'firmware_settings':   0x07,
}

TYPES_LEN = {'int16': 2, 'uint16': 2, 'int32': 4, 'uint32': 4, 'float': 4}
TYPES_FMT = {'int16': '>h', 'uint16': '>H', 'int32': '>i', 'uint32': '>I',
             'float': '>f'}

ROUTINE_TRIGGERS = ["enter_pre", "enter", "leave", "manual"]

# Printer objects the UI scripts read
SUBSCRIBE_OBJECTS = [
    "webhooks", "toolhead", "gcode_move", "extruder", "extruder1",
    "heater_bed", "fan", "pause_resume", "virtual_sdcard", "print_stats",
    "display_status", "idle_timeout", "bed_mesh", "stepper_enable",
]
CONFIGFILE_FIELDS = ["settings", "save_config_pending_items"]

Coord = collections.namedtuple("Coord", ("x", "y", "z", "e"))
COORD_FIELDS = {
    "gcode_move": ("gcode_position", "position", "homing_origin"),
    "toolhead": ("position", "axis_minimum", "axis_maximum"),
}

PROBE_RE = re.compile(r"probe at [-\d.]+,[-\d.]+ is z=")


class ConfigError(Exception):
    pass


def map_value_range(x, in_min, in_max, out_min, out_max):
    return int(round((x - in_min) * (out_max - out_min) // (in_max - in_min)
                     + out_min))


def get_duration(seconds):
    seconds = max(0, int(seconds))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    days %= 365
    result = "%ds" % seconds
    if minutes:
        result = "%dm %s" % (minutes, result)
    if hours:
        result = "%dh %s" % (hours, result)
    if days:
        result = "%dd %s" % (days, result)
    return result


def bitwise_and(lhs, rhs):
    return lhs & rhs


def bitwise_or(lhs, rhs):
    return lhs | rhs


class Section:
    """Small helper around a configparser section."""

    def __init__(self, name, items):
        self.name = name
        self.items = items

    def get(self, key, default=ConfigError):
        if key in self.items:
            return self.items[key]
        if default is ConfigError:
            raise ConfigError("Option '%s' missing in section '%s'"
                              % (key, self.name))
        return default

    def getint(self, key, default=ConfigError):
        val = self.get(key, default)
        return None if val is None else int(val)

    def getboolean(self, key, default=False):
        val = self.get(key, None)
        if val is None:
            return default
        return val.strip().lower() in ("1", "true", "yes", "on")

    def short_name(self):
        parts = self.name.split()
        if len(parts) != 2:
            raise ConfigError("Section name '%s' is not valid" % self.name)
        return parts[1]


class Template:
    def __init__(self, env, name, script):
        self.name = name
        try:
            self.template = env.from_string(script)
        except jinja2.TemplateError as e:
            raise ConfigError("Error loading template '%s': %s" % (name, e))

    def render(self, context):
        return str(self.template.render(context))


class Var:
    def __init__(self, engine, section):
        self.engine = engine
        self.name = section.short_name()
        self.type = section.get("type")
        if self.type not in ("input", "output"):
            raise ConfigError("Invalid type in '%s'" % section.name)
        try:
            self.address = int(section.get("address"), 16)
            assert 0x1000 <= self.address <= 0xffff
        except Exception:
            raise ConfigError("Invalid address in '%s'" % section.name)
        data_types = list(TYPES_LEN) + ["str"]
        if self.type == "input":
            data_types.append("none")
        self.data_type = section.get("data_type")
        self.array_len = 1
        if (self.data_type.startswith("array[") and self.data_type.endswith("]")
                and self.type == "output"):
            self.data_type = self.data_type[6:-1]
            self.array_len = section.getint("array_len")
        if self.data_type not in data_types:
            raise ConfigError("Invalid data_type in '%s'" % section.name)
        if self.data_type == "none":
            self.data_len = 0
        elif self.data_type == "str":
            self.data_len = section.getint("data_len")
        else:
            self.data_len = TYPES_LEN[self.data_type]
        self.template = Template(engine.jinja, section.name + ":script",
                                 section.get("script"))
        self.run_as_gcode = (self.type == "input"
                             and section.getboolean("run_as_gcode"))

    def data_received(self, data):
        context = self.engine.context("input")
        if self.data_type != "none" and self.data_len:
            if self.data_type == "str":
                buf = bytearray()
                for i, b in enumerate(data[:self.data_len]):
                    if b == 0x00:
                        break
                    if b == 0xff and i + 1 < len(data) and data[i + 1] == 0xff:
                        break
                    buf.append(b)
                value = buf.decode("ascii", "replace")
            elif len(data) != self.data_len:
                raise ValueError("Expected %d bytes, got %d"
                                 % (self.data_len, len(data)))
            else:
                value = struct.unpack(TYPES_FMT[self.data_type], data)[0]
            context["data"] = value
        result = self.template.render(context).strip()
        if self.run_as_gcode:
            self.engine.run_gcode(result)

    def prepare_data(self):
        result = self.template.render(self.engine.context("output"))
        if self.data_type == "str":
            out = bytearray(result.replace("\n", ""), "ascii", "replace")
            target = self.data_len + (self.data_len % 2)
            if len(out) > target:
                out = out[:target]
            else:
                out.extend(b"\0" * (target - len(out)))
            return out
        out = bytearray()
        count = 0
        for part in result.strip().split(","):
            part = part.strip()
            if not part:
                continue
            val = float(part) if self.data_type == "float" else int(float(part))
            out.extend(struct.pack(TYPES_FMT[self.data_type], val))
            count += 1
        if count != self.array_len:
            raise ValueError("Expected %d values, got %d"
                             % (self.array_len, count))
        return out


class Page:
    def __init__(self, var_names, section):
        self.name = section.short_name()
        self.id = section.getint("id")
        self.is_boot = section.getboolean("boot")
        self.is_timeout = section.getboolean("timeout")
        self.is_shutdown = section.getboolean("shutdown")
        self.var_auto = []
        self.var = []
        for key, target in (("var_auto", self.var_auto), ("var", self.var)):
            for name in section.get(key, "").split(","):
                name = name.strip()
                if not name or name in self.var_auto or name in self.var:
                    continue
                if name not in var_names:
                    raise ConfigError("Invalid var '%s' in '%s'"
                                      % (name, section.name))
                target.append(name)


class Routine:
    def __init__(self, engine, page_names, section):
        self.engine = engine
        self.name = section.short_name()
        self.trigger = section.get("trigger")
        if self.trigger not in ROUTINE_TRIGGERS:
            raise ConfigError("Invalid trigger in '%s'" % section.name)
        self.page = None
        if self.trigger != "manual":
            self.page = section.get("page")
            if self.page not in page_names:
                raise ConfigError("Invalid page in '%s'" % section.name)
        self.delay = (section.getint("delay", None)
                      if self.trigger != "enter_pre" else None)
        self.interval = (section.getint("interval", 0)
                         if self.trigger in ("enter", "manual") else 0)
        self.template = Template(engine.jinja, section.name + ":script",
                                 section.get("script"))
        self.run_as_gcode = section.getboolean("run_as_gcode")
        self._should_stop = False
        self._handle = None

    def _schedule(self, delay):
        self._cancel()
        loop = asyncio.get_running_loop()
        self._handle = loop.call_later(max(0, delay), self._timer_run)

    def _cancel(self):
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None

    def _timer_run(self):
        self._handle = None
        if self._should_stop:
            return
        try:
            self.run(is_timer=True)
        except Exception:
            log.exception("Error in routine '%s'", self.name)
        if not self._should_stop and self.interval > 0 and self._handle is None:
            self._schedule(self.interval)

    def run(self, repeat=True, is_timer=False):
        if not is_timer:
            self._should_stop = False
            if self.delay is not None:
                self._schedule(self.delay)
                return None
        context = self.engine.context("routine")
        context["is_timer"] = is_timer
        result = self.template.render(context).strip()
        if self.run_as_gcode:
            self.engine.run_gcode(result)
        if not is_timer and self.interval > 0:
            if repeat:
                self._schedule(self.interval)
            return None
        if self.trigger == "enter_pre":
            lines = [l.strip() for l in result.split("\n")]
            return ABORT_MARKER not in lines
        return None

    def stop(self):
        self._should_stop = True
        self._cancel()


class Engine:
    def __init__(self, options, firmware, user_sections, serial, moonraker):
        self.opts = options
        self.firmware = firmware
        self.serial = serial
        self.moonraker = moonraker

        self.jinja = jinja2.Environment(
            block_start_string="{%", block_end_string="%}",
            variable_start_string="{", variable_end_string="}",
            trim_blocks=True, lstrip_blocks=True,
            extensions=["jinja2.ext.do"])

        self._volume = options["volume"]
        self._brightness = options["brightness"]
        self._gui_version = 0
        self._os_version = 0
        self._current_page = ""
        self._variable_data = {}
        self._vars = {}
        self._pages = {}
        self._routines = {}
        self._boot_page = self._shutdown_page = None

        # Printer state (from Moonraker)
        self.klippy_ready = False
        self.status = {}
        self._objects = set()
        self._version = ""
        self._last_print_state = None
        self._last_message = None
        self._probe_count = 0

        # G-Code queue
        self._gcode_queue = asyncio.Queue()
        self._gcode_pending = 0

        # Screen liveness
        self._last_rx = 0.0
        self._screen_lost = True
        self._next_update = None
        self._stopping = False

        g = {
            'get_variable': self.get_variable,
            'set_variable': self.set_variable,
            'enable_control': self.enable_control,
            'disable_control': self.disable_control,
            'start_routine': self.start_routine,
            'stop_routine': self.stop_routine,
            'set_message': self.set_message,
            'bitwise_and': bitwise_and,
            'bitwise_or': bitwise_or,
            'macro_params': self.macro_params,
            'macro_command': self.macro_command,
            'format_param': macro_params.format_value,
        }
        self._ctx = {
            "input": dict(g, page_name=self.page_name,
                          switch_page=self.switch_page,
                          play_sound=self.play_sound,
                          set_volume=self.set_volume,
                          set_brightness=self.set_brightness,
                          limit_extrude=self.limit_extrude,
                          heater_min_temp=self.heater_min_temp,
                          heater_max_temp=self.heater_max_temp,
                          heater_min_extrude_temp=self.heater_min_extrude_temp,
                          is_busy=self.is_busy),
            "output": dict(g, all_steppers_enabled=self.all_steppers_enabled,
                           heater_min_temp=self.heater_min_temp,
                           heater_max_temp=self.heater_max_temp,
                           probed_matrix=self.probed_matrix,
                           pid_param=self.pid_param,
                           get_duration=get_duration),
            "routine": dict(g, page_name=self.page_name,
                            switch_page=self.switch_page,
                            play_sound=self.play_sound,
                            set_volume=self.set_volume,
                            set_brightness=self.set_brightness,
                            abort_page_switch=self.abort_page_switch,
                            full_update=self.full_update,
                            is_busy=self.is_busy,
                            check_paused=self.check_paused),
        }
        self._load_config(user_sections)

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    def _load_config(self, user_sections):
        fw_dir = self.firmware.directory
        sections = list(user_sections)
        seen = {s.name for s in sections}
        for fname in self.firmware.configuration["config_files"]:
            cp = configparser.RawConfigParser(strict=False)
            cp.optionxform = str
            path = os.path.join(fw_dir, fname)
            if not cp.read(path):
                raise ConfigError("Cannot load '%s'" % path)
            for name in cp.sections():
                if name not in seen:
                    sections.append(Section(name, dict(cp.items(name))))
                    seen.add(name)
        by_prefix = lambda p: [s for s in sections if s.name.startswith(p)]
        for s in by_prefix("t5uid1_var "):
            v = Var(self, s)
            self._vars[v.name] = v
        for s in by_prefix("t5uid1_page "):
            p = Page(self._vars, s)
            self._pages[p.name] = p
            if p.is_boot:
                self._boot_page = p.name
            if p.is_shutdown:
                self._shutdown_page = p.name
        for s in by_prefix("t5uid1_routine "):
            r = Routine(self, self._pages, s)
            self._routines[r.name] = r
        if self._boot_page is None:
            raise ConfigError("No boot page found")
        if self._shutdown_page is None:
            self._shutdown_page = self._boot_page
        log.info("Loaded %d vars, %d pages, %d routines", len(self._vars),
                 len(self._pages), len(self._routines))

    # ------------------------------------------------------------------
    # Template context
    # ------------------------------------------------------------------
    def context(self, kind):
        printer = dict(self.status)
        printer["t5uid1"] = self.get_status()
        ctx = dict(self._ctx[kind])
        ctx["printer"] = printer
        return ctx

    def _settings(self, name):
        cf = self.status.get("configfile", {})
        return cf.get("settings", {}).get(name, {})

    def limits(self):
        th = self.status.get("toolhead", {})
        amin = th.get("axis_minimum") or Coord(0, 0, 0, 0)
        amax = th.get("axis_maximum") or Coord(0, 0, 0, 0)
        res = {}
        for i, axis in enumerate("xyz"):
            lo, hi = amin[i], amax[i]
            o_lo = self.opts.get(axis + "_min")
            o_hi = self.opts.get(axis + "_max")
            if o_lo is not None and lo < o_lo < hi:
                lo = o_lo
            if o_hi is not None and lo < o_hi < hi:
                hi = o_hi
            res[axis + "_min"] = lo
            res[axis + "_max"] = hi
        for axis in "xy":
            half = (res[axis + "_max"] - res[axis + "_min"]) / 2.0
            for side in ("min", "max"):
                key = "%s_%s_inset" % (axis, side)
                res[key] = min(self.opts[key], half)
        return res

    def get_status(self):
        ps = self.status.get("print_stats", {})
        state = ps.get("state", "standby")
        progress = self.status.get("display_status", {}).get("progress", 0)
        return {
            'controls': self.firmware.configuration["controls"],
            'constants': self.firmware.configuration["constants"],
            'limits': self.limits(),
            'has_bltouch': "bltouch" in self.status.get(
                "configfile", {}).get("settings", {}),
            'version': self._version,
            'machine_name': self.opts["machine_name"],
            'gui_version': self._gui_version,
            'os_version': self._os_version,
            'notification_sound': self.opts["notification_sound"],
            'page': self._current_page,
            'volume': self._volume,
            'brightness': self._brightness,
            'pages': {p: self._pages[p].id for p in self._pages},
            'control_types': CONTROL_TYPES,
            'is_printing': state in ("printing", "paused"),
            'print_progress': min(100, max(0, int(round((progress or 0)
                                                        * 100)))),
            'print_duration': max(0, ps.get("print_duration", 0) or 0),
            'macros': self.macro_list(),
        }

    def macro_params(self, name):
        """Parameters of a macro, parsed from its G-Code template."""
        settings = self.status.get("configfile", {}).get("settings", {})
        return macro_params.macro_params(settings, name or "")

    def macro_command(self, name, values):
        return macro_params.build_command(name, self.macro_params(name),
                                          values or {})

    def macro_list(self):
        """User-visible [gcode_macro] names: no '_' prefix, minus
        macro_exclude, sorted."""
        exclude = self.opts.get("macro_exclude", ())
        names = [o.split(" ", 1)[1] for o in self._objects
                 if o.startswith("gcode_macro ")]
        return sorted((n for n in names if not n.startswith("_")
                       and n.upper() not in exclude), key=str.upper)

    # ------------------------------------------------------------------
    # Template helpers
    # ------------------------------------------------------------------
    class _Sentinel:
        pass

    def get_variable(self, name, default=_Sentinel):
        if name not in self._variable_data:
            if default is not self._Sentinel:
                return default
            raise Exception("Variable '%s' not found" % name)
        return self._variable_data[name]

    def set_variable(self, name, value):
        self._variable_data[name] = value

    def page_name(self, page_id):
        page_id = int(page_id)
        for name, page in self._pages.items():
            if page.id == page_id:
                return name
        raise Exception("Page %d not found" % page_id)

    def abort_page_switch(self):
        return ABORT_MARKER

    def check_paused(self):
        pass  # print_stats.print_duration already excludes pauses

    def is_busy(self):
        if self._gcode_pending > 0:
            return True
        return self.status.get("idle_timeout", {}).get("state") == "Printing"

    def all_steppers_enabled(self):
        steppers = self.status.get("stepper_enable", {}).get("steppers", {})
        return all(steppers.get(n, False)
                   for n in ("stepper_x", "stepper_y", "stepper_z"))

    def heater_min_temp(self, heater):
        return self._settings(heater).get("min_temp", 0)

    def heater_max_temp(self, heater, margin=0):
        max_temp = self._settings(heater).get("max_temp")
        return 0 if max_temp is None else max(0, max_temp - margin)

    def heater_min_extrude_temp(self, heater):
        return self._settings(heater).get("min_extrude_temp", 170.)

    def limit_extrude(self, extruder, val):
        s = self._settings(extruder)
        if not s:
            return 0
        return min(s.get("max_extrude_only_distance", 50.), val)

    def pid_param(self, heater, param):
        if param not in ("p", "i", "d"):
            raise ValueError("Invalid param")
        key = "pid_k" + param
        pending = self.status.get("configfile", {}).get(
            "save_config_pending_items", {}).get(heater, {})
        try:
            if key in pending:
                return float(pending[key])
            return float(self._settings(heater).get(key, 0))
        except (TypeError, ValueError):
            return 0

    def probed_matrix(self):
        points_map = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14,
                      19, 18, 17, 16, 15, 20, 21, 22, 23, 24]
        res = 0
        for i in range(25):
            if self._probe_count > points_map[i]:
                res |= 1 << (i + 16) if i < 16 else 1 << (i - 16)
        return res

    # ------------------------------------------------------------------
    # Screen commands
    # ------------------------------------------------------------------
    def send_var(self, name):
        var = self._vars[name]
        self.serial.write_var(var.address, var.prepare_data())

    def send_page_vars(self, page=None, complete=False):
        page = self._pages[page or self._current_page]
        names = (page.var if complete else []) + page.var_auto
        for name in names:
            try:
                self.send_var(name)
            except Exception as e:
                log.warning("Cannot send var '%s': %s", name, e)

    def full_update(self):
        if self._current_page:
            self.send_page_vars(complete=True)
        self._next_update = time.monotonic() + self.opts["update_interval"]

    def start_routine(self, name):
        routine = self._routines[name]
        if routine.trigger != "manual":
            raise Exception("Routine '%s' cannot be started manually" % name)
        routine.run()

    def stop_routine(self, name):
        self._routines[name].stop()

    def _start_page_routines(self, page, trigger):
        results = []
        for r in self._routines.values():
            if r.page == page and r.trigger == trigger:
                try:
                    res = r.run()
                except Exception:
                    log.exception("Error in routine '%s'", r.name)
                    res = False if trigger == "enter_pre" else None
                if res is not None:
                    results.append(res)
        return all(results)

    def _stop_page_routines(self, page):
        for r in self._routines.values():
            if r.page == page:
                r.stop()

    def _page_cmd(self, name):
        return bytearray([0x5a, 0x01, 0x00, self._pages[name].id])

    def switch_page(self, name, force=False):
        if name not in self._pages:
            raise ValueError("invalid page '%s'" % name)
        if name == self._current_page and not force:
            return
        if not self._start_page_routines(name, "enter_pre"):
            return
        self.send_page_vars(name, complete=True)
        self.serial.write_var(ADDR_PAGE, self._page_cmd(name))
        if self._current_page:
            self._stop_page_routines(self._current_page)
            self._start_page_routines(self._current_page, "leave")
        log.info("Page: %s", name)
        self._current_page = name
        self._start_page_routines(name, "enter")
        self._next_update = time.monotonic() + self.opts["update_interval"]

    def play_sound(self, start, slen=1, volume=-1):
        if volume is None or volume < 0:
            volume = self._volume
        val = map_value_range(volume, 0, 100, 0, 255)
        self.serial.write_var(ADDR_SOUND, bytearray([start & 0xff, slen & 0xff,
                                                     val, 0]))

    def _control(self, page, ctype, control, enable):
        self.serial.write_var(ADDR_CONTROL, bytearray([
            0x5a, 0xa5, 0, page, control, ctype, 0, 1 if enable else 0]))

    def enable_control(self, page, ctype, control):
        self._control(page, ctype, control, True)

    def disable_control(self, page, ctype, control):
        self._control(page, ctype, control, False)

    def set_brightness(self, brightness):
        brightness = max(0, min(100, int(brightness)))
        val = map_value_range(brightness, 0, 100, 5, 100)
        self.serial.write_var(ADDR_BRIGHTNESS, bytearray([val, val]))
        if brightness != self._brightness:
            self._brightness = brightness
            self.opts["save_state"](volume=self._volume,
                                    brightness=self._brightness)

    def set_volume(self, volume):
        volume = max(0, min(100, int(volume)))
        val = map_value_range(volume, 0, 100, 0, 255)
        self.serial.write_var(ADDR_VOLUME, bytearray([val, 0]))
        if volume != self._volume:
            self._volume = volume
            self.opts["save_state"](volume=self._volume,
                                    brightness=self._brightness)

    def set_message(self, message):
        self.set_variable("message", message)
        if "message" in self._vars:
            try:
                self.send_var("message")
            except Exception as e:
                log.warning("Cannot send message: %s", e)
        if message and "message_timeout" in self._routines:
            self.start_routine("message_timeout")

    def show_lines(self, lines, page=None):
        lines = list(lines)[:4]
        while len(lines) < 4:
            lines.append("")
        for i, line in enumerate(lines):
            self.set_variable("line%d" % (i + 1), line.strip())
        page = page or self._shutdown_page
        if self._current_page == page:
            self.send_page_vars(complete=True)
        else:
            self.switch_page(page)

    def show_error(self, message):
        msg = (message or "").strip()
        parts = textwrap.wrap(msg, 32)[:4]
        self.show_lines(parts)

    # ------------------------------------------------------------------
    # G-Code execution through Moonraker
    # ------------------------------------------------------------------
    def run_gcode(self, script):
        lines = [l.strip() for l in script.split("\n")]
        lines = [l for l in lines if l and l != ABORT_MARKER]
        if not lines:
            return
        if any(l.upper().startswith("BED_MESH_CALIBRATE") for l in lines):
            self._probe_count = 0
        self._gcode_pending += 1
        self._gcode_queue.put_nowait("\n".join(lines))

    async def gcode_worker(self):
        while True:
            script = await self._gcode_queue.get()
            try:
                log.info("G-Code: %s", script.replace("\n", " | "))
                await self.moonraker.call("printer.gcode.script",
                                          {"script": script})
            except Exception as e:
                log.warning("G-Code failed (%s): %s",
                            script.replace("\n", " | "), e)
                if self.klippy_ready:
                    self.set_message(str(e).split("\n")[0][:32])
            finally:
                self._gcode_pending -= 1

    # ------------------------------------------------------------------
    # Screen input
    # ------------------------------------------------------------------
    def handle_received(self, address, data):
        self._last_rx = time.monotonic()
        if address == ADDR_VERSION and len(data) >= 2:
            self._gui_version, self._os_version = data[0], data[1]
            if self._screen_lost:
                self._screen_lost = False
                log.info("Screen detected (GUI v%d, OS v%d)",
                         self._gui_version, self._os_version)
                self.init_screen()
            return
        if address == ADDR_PIC_NOW and len(data) >= 2:
            page_id = struct.unpack(">H", data[:2])[0]
            cur = self._pages.get(self._current_page)
            if cur is not None and page_id != cur.id and page_id == 0:
                log.warning("Screen reset detected, re-initializing")
                self.init_screen()
            return
        if not self.klippy_ready:
            log.debug("Ignoring input 0x%04x, Klipper not ready", address)
            return
        handled = False
        for var in self._vars.values():
            if var.address != address or var.type != "input":
                continue
            handled = True
            try:
                var.data_received(data)
            except Exception:
                log.exception("Error in '%s' receive handler", var.name)
        if not handled:
            log.warning("Unhandled input for address 0x%04x", address)

    def on_serial_open(self):
        self._screen_lost = True
        self.serial.read_var(ADDR_VERSION, 1)

    def init_screen(self):
        """(Re)initialize the screen: brightness, volume, first page."""
        self.set_brightness(self._brightness)
        self._current_page = ""
        if self.klippy_ready:
            self.switch_page(self._boot_page)
            if self.opts["boot_sound"] >= 0:
                self.play_sound(self.opts["boot_sound"])
            self.set_volume(self._volume)
        else:
            self.set_volume(self._volume)
            self.show_error(self._not_ready_msg)

    _not_ready_msg = "Waiting for Moonraker..."

    async def screen_task(self):
        """Periodic var updates and screen liveness check."""
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.2)
            now = time.monotonic()
            if not self.serial.is_open:
                continue
            if now - last_ping >= 5:
                last_ping = now
                if self._screen_lost:
                    self.serial.read_var(ADDR_VERSION, 1)
                else:
                    self.serial.read_var(ADDR_PIC_NOW, 1)
                    if now - self._last_rx > 16:
                        log.warning("Screen not responding")
                        self._screen_lost = True
            if (self._current_page and self._next_update is not None
                    and now >= self._next_update and not self._screen_lost):
                self._next_update = now + self.opts["update_interval"]
                if self.klippy_ready or (self._current_page
                                         == self._shutdown_page):
                    self.send_page_vars(complete=False)

    # ------------------------------------------------------------------
    # Moonraker events
    # ------------------------------------------------------------------
    def _merge_status(self, status):
        for obj, fields in status.items():
            if not isinstance(fields, dict):
                continue
            conv = COORD_FIELDS.get(obj, ())
            for key in conv:
                val = fields.get(key)
                if isinstance(val, list) and len(val) == 4:
                    fields[key] = Coord(*val)
            self.status.setdefault(obj, {}).update(fields)

    async def on_moonraker_connect(self):
        await self.moonraker.call("server.connection.identify", {
            "client_name": "dgus_lcd", "version": "1.0.0",
            "type": "other", "url": "https://github.com/Desuuuu/DGUS-reloaded-Klipper"})
        await self.sync_klippy()

    def on_moonraker_disconnect(self):
        self._set_not_ready("Moonraker disconnected")

    async def sync_klippy(self):
        try:
            info = await self.moonraker.call("server.info")
        except Exception as e:
            log.warning("server.info failed: %s", e)
            return
        state = info.get("klippy_state")
        if state == "ready":
            if not self.klippy_ready:
                await self._on_klippy_ready()
            return
        msg = "Klipper %s" % state
        if state in ("shutdown", "error", "startup"):
            try:
                pinfo = await self.moonraker.call("printer.info")
                msg = pinfo.get("state_message", msg)
            except Exception:
                pass
        self._set_not_ready(msg)

    def _set_not_ready(self, message):
        was_ready = self.klippy_ready
        self.klippy_ready = False
        if self._stopping:
            return
        first_line = (message or "").strip().split("\n")[0]
        if not was_ready and self._not_ready_msg == first_line:
            return
        self._not_ready_msg = first_line
        log.info("Klipper not ready: %s", first_line)
        if self.serial.is_open and not self._screen_lost:
            self.show_error(first_line)
            if was_ready and self.opts["notification_sound"] >= 0:
                self.play_sound(self.opts["notification_sound"])

    async def _on_klippy_ready(self):
        objs = (await self.moonraker.call("printer.objects.list"))["objects"]
        self._objects = set(objs)
        pinfo = await self.moonraker.call("printer.info")
        self._version = pinfo.get("software_version", "")
        sub = {o: None for o in SUBSCRIBE_OBJECTS if o in self._objects}
        sub["configfile"] = CONFIGFILE_FIELDS
        res = await self.moonraker.call("printer.objects.subscribe",
                                        {"objects": sub})
        self.status = {o: {} for o in self._objects}
        self._merge_status(res["status"])
        ps = self.status.get("print_stats", {})
        self._last_print_state = ps.get("state")
        self._last_message = self.status.get("display_status", {}).get(
            "message")
        self.klippy_ready = True
        self._not_ready_msg = ""
        log.info("Klipper ready (%s)", self._version)
        if self.serial.is_open and not self._screen_lost:
            self.init_screen()

    def on_notify(self, method, params):
        if method == "notify_status_update":
            if self.klippy_ready and params:
                self._merge_status(params[0])
                self._check_transitions()
        elif method == "notify_gcode_response":
            for line in params:
                self._handle_gcode_response(str(line))
        elif method == "notify_klippy_ready":
            asyncio.create_task(self.sync_klippy())
        elif method == "notify_klippy_shutdown":
            asyncio.create_task(self.sync_klippy())
        elif method == "notify_klippy_disconnected":
            self._set_not_ready("Klipper disconnected")

    async def klippy_poll_task(self):
        """Poll Klipper state while not ready (startup/error states)."""
        while True:
            await asyncio.sleep(5)
            if not self.klippy_ready and self.moonraker.connected:
                await self.sync_klippy()

    def _check_transitions(self):
        state = self.status.get("print_stats", {}).get("state")
        prev = self._last_print_state
        if state != prev:
            self._last_print_state = state
            log.info("Print state: %s -> %s", prev, state)
            active = ("printing", "paused")
            try:
                if state == "printing" and prev not in active:
                    if "print_start" in self._routines:
                        self.start_routine("print_start")
                elif (state in ("complete", "cancelled", "error")
                      and prev in active):
                    if "print_end" in self._routines:
                        self.start_routine("print_end")
                elif self._current_page in ("print_status", "print_adjust"):
                    self.full_update()
            except Exception:
                log.exception("Error handling print state change")
        msg = self.status.get("display_status", {}).get("message")
        if msg != self._last_message:
            self._last_message = msg
            self.set_message(msg or "")

    def _handle_gcode_response(self, line):
        if PROBE_RE.search(line):
            self._probe_count += 1
            return
        if not line.startswith("dgus "):
            return
        # Commands emitted by the helper macros in dgus_macros.cfg
        parts = line.split()
        try:
            if parts[1] == "sound":
                start = int(parts[2]) if len(parts) > 2 else -1
                slen = int(parts[3]) if len(parts) > 3 else 1
                vol = int(parts[4]) if len(parts) > 4 else -1
                if start < 0 or start > 255:
                    start = self.opts["notification_sound"]
                if start >= 0:
                    self.play_sound(start, max(1, slen), vol)
            elif parts[1] == "page" and len(parts) > 2:
                self.switch_page(parts[2])
            elif parts[1] == "message":
                self.set_message(line.split(None, 2)[2]
                                 if len(parts) > 2 else "")
        except Exception as e:
            log.warning("Bad dgus command '%s': %s", line, e)

    def shutdown(self):
        self._stopping = True
        self.klippy_ready = False
        if self.serial.is_open:
            try:
                self._current_page = ""
                self.show_lines(["", "LCD service stopped"])
            except Exception:
                pass
