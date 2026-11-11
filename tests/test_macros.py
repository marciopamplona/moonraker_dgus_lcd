# Macros page: service scripts (macros.cfg) and the screen-file builder.
import asyncio
import os
import struct
import tempfile
import unittest

from dgus_lcd import __main__ as main_mod
from dgus_lcd import engine as eng
from dgus_lcd import macros_screen as ms
from dgus_lcd import screen_files as sf


class FakeSerial:
    is_open = True

    def __init__(self):
        self.writes = {}

    def write_var(self, address, data):
        self.writes[address] = bytes(data)

    def read_var(self, address, wlen):
        pass


def make_engine(extra=""):
    tmp = tempfile.mkdtemp()
    cfg = os.path.join(tmp, "dgus_lcd.cfg")
    with open(cfg, "w") as f:
        f.write("[dgus_lcd]\nstate_file: %s/state.json\n%s" % (tmp, extra))
    opts, fw, user = main_mod.parse_config(cfg)
    ser = FakeSerial()
    e = eng.Engine(opts, fw, user, ser, None)
    return e, ser


MACROS = ["gcode_macro LOAD_FILAMENT", "gcode_macro PARK",
          "gcode_macro _HIDDEN", "gcode_macro M300", "gcode_macro a_lower",
          "gcode_macro CLEAN_NOZZLE_AND_PURGE_LINE", "gcode_macro M1",
          "gcode_macro M2", "gcode_macro M3", "toolhead", "extruder"]


def read(path):
    with open(path, "rb") as f:
        return f.read()


def text(ser, vp, n=12):
    return ser.writes[vp][:n].decode().strip()


class MacrosPageTest(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.e, self.ser = make_engine("macro_exclude: m300, M1\n")
        self.e._objects = set(MACROS)
        self.e.klippy_ready = True

    def tearDown(self):
        for t in asyncio.all_tasks(self.loop):
            t.cancel()
        self.loop.close()

    def press(self, vp, key):
        async def run():
            self.e.handle_received(vp, struct.pack(">H", key))
        self.loop.run_until_complete(run())

    def test_list_filters_and_sorts(self):
        self.assertEqual(self.e.macro_list(),
                         ["a_lower", "CLEAN_NOZZLE_AND_PURGE_LINE",
                          "LOAD_FILAMENT", "M2", "M3", "PARK"])

    def test_page_render_and_paging(self):
        self.e.switch_page("macros")
        self.assertEqual(text(self.ser, ms.VP_PAGE_INDICATOR, 8), "1/1")
        self.assertEqual(text(self.ser, ms.label_vp(0, 0)), "a lower")
        self.assertEqual(text(self.ser, ms.label_vp(0, 1)), "")
        self.assertEqual(text(self.ser, ms.label_vp(1, 0)), "CLEAN NOZZLE")
        self.assertEqual(text(self.ser, ms.label_vp(1, 1)), "AND PURGE~")
        self.assertEqual(text(self.ser, ms.label_vp(2, 0)), "LOAD")
        self.assertEqual(text(self.ser, ms.label_vp(2, 1)), "FILAMENT")
        self.assertEqual(text(self.ser, ms.label_vp(5, 0)), "PARK")

        self.e._objects |= {"gcode_macro Z%d" % i for i in range(3)}
        self.press(ms.VP_MACRO_KEY, 8)
        self.assertEqual(text(self.ser, ms.VP_PAGE_INDICATOR, 8), "2/2")
        self.assertEqual(text(self.ser, ms.label_vp(0, 0)), "Z0")
        self.assertEqual(text(self.ser, ms.label_vp(3, 0)), "")
        self.press(ms.VP_MACRO_KEY, 8)
        self.assertEqual(text(self.ser, ms.VP_PAGE_INDICATOR, 8), "1/2")
        self.press(ms.VP_MACRO_KEY, 7)
        self.assertEqual(text(self.ser, ms.VP_PAGE_INDICATOR, 8), "2/2")

    def test_tap_runs_macro(self):
        self.e.switch_page("macros")
        self.press(ms.VP_MACRO_KEY, 3)
        self.assertEqual(self.e._gcode_queue.get_nowait(), "LOAD_FILAMENT")
        self.assertIn(b"Running LOAD_FILAMENT", self.ser.writes[0x3000])
        # still running -> second tap is refused
        self.press(ms.VP_MACRO_KEY, 6)
        self.assertTrue(self.e._gcode_queue.empty())
        self.assertIn(b"Busy", self.ser.writes[0x3000])
        self.e._gcode_pending = 0
        self.press(ms.VP_MACRO_KEY, 6)
        self.assertEqual(self.e._gcode_queue.get_nowait(), "PARK")

    def test_empty_tile_does_nothing(self):
        self.e._objects = {"gcode_macro A", "gcode_macro B"}
        self.e.switch_page("macros")
        self.assertEqual(text(self.ser, ms.label_vp(2, 0)), "")
        self.press(ms.VP_MACRO_KEY, 3)
        self.assertTrue(self.e._gcode_queue.empty())

    def test_blocked_while_printing(self):
        self.e.status["print_stats"] = {"state": "printing"}
        self.e.switch_page("macros")
        self.press(ms.VP_MACRO_KEY, 1)
        self.assertTrue(self.e._gcode_queue.empty())
        self.assertIn(b"Not while printing", self.ser.writes[0x3000])

    def test_more_page_switch(self):
        self.e.switch_page("settings_menu2")
        self.press(ms.VP_SWITCH_PAGE, ms.PAGE_MACROS)
        self.assertEqual(self.e._current_page, "macros")


class BuilderTest(unittest.TestCase):
    def _release(self, tmp):
        bm = sf.Bitmap(480, 272)
        for name in ("009_settings_menu.bmp", "018_settings_menu2.bmp"):
            with open(os.path.join(tmp, name), "wb") as f:
                f.write(bm.save())
        touch = sf.TouchFile([sf.return_key(18, (0, 0, 39, 39), 0x2000, 9),
                              sf.return_key(20, (0, 0, 39, 39), 0x2000, 18)])
        with open(os.path.join(tmp, "13_touch.bin"), "wb") as f:
            f.write(touch.build())
        msg = sf.text_var(0x3000, 181, 7, (181, 7, 476, 26), 32, size=18)
        var = sf.VariableFile(b"\x14DGUS_2\x10\x00\xfa" + bytes(6),
                              {18: [msg], 20: [msg]})
        with open(os.path.join(tmp, "14_variable.bin"), "wb") as f:
            f.write(var.build())

    def test_build_is_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._release(tmp)
            out = os.path.join(tmp, "out")
            ms.build(tmp, out)
            first = {n: read(os.path.join(out, n)) for n in ms.FILES}
            # building on top of its own output gives the same files
            import shutil
            shutil.copy(os.path.join(tmp, "009_settings_menu.bmp"), out)
            ms.build(out, out)
            for n in ("13_touch.bin", "14_variable.bin"):
                self.assertEqual(read(os.path.join(out, n)), first[n], n)
            touch = sf.TouchFile.parse(first["13_touch.bin"])
            pages = [touch.page_of(e) for e in touch.entries]
            self.assertEqual(pages, sorted(pages))   # grouping kept
            self.assertEqual(sum(1 for e in touch.entries
                                 if touch.page_of(e) == ms.PAGE_PARAMS
                                 and e[14:16] == b"\xfe\x00"),
                             ms.PARAM_ROWS)
            keys = [k for k in map(sf.parse_return_key, touch.entries) if k]
            p21 = [k for k in keys if k["page"] == 21]
            self.assertEqual(sorted(k["key"] for k in p21
                                    if k["vp"] == ms.VP_MACRO_KEY),
                             [1, 2, 3, 4, 5, 6, 7, 8])
            self.assertIn({"page": 18, "vp": 0x2000, "key": 21},
                          [{x: k[x] for x in ("page", "vp", "key")}
                           for k in keys])
            # page order is kept: 18 entries, then 20, then 21
            self.assertEqual([k["page"] for k in keys],
                             sorted(k["page"] for k in keys))
            var = sf.VariableFile.parse(first["14_variable.bin"])
            vps = {sf.parse_text_var(e)["vp"] for e in var.pages[21]}
            self.assertEqual(vps, {0x3000, ms.VP_PAGE_INDICATOR}
                             | {ms.label_vp(i, j) for i in range(6)
                                for j in range(2)})
            # static text is in the BMPs, not in text fields
            self.assertEqual({sf.parse_text_var(e)["vp"]
                              for e in var.pages[18]}, {0x3000})

    def test_prebuilt_is_current(self):
        """screen/macros must match a fresh build (rebuild with
        `python -m dgus_lcd.macros_screen --out screen/macros`)."""
        rel = os.environ.get("DGUS_RELEASE") or os.path.expanduser(
            "~/.cache/dgus_lcd/release-1.0.2/DWIN_SET")
        if not os.path.isdir(rel):
            self.skipTest("1.0.2 release not available")
        with tempfile.TemporaryDirectory() as tmp:
            ms.build(rel, tmp)
            for n in ms.FILES:
                self.assertEqual(read(os.path.join(tmp, n)),
                                 read(os.path.join(ms.PREBUILT, n)),
                                 "screen/macros/%s is out of date" % n)

    def test_real_release_roundtrip(self):
        rel = os.environ.get("DGUS_RELEASE")
        if not rel:
            self.skipTest("set DGUS_RELEASE to an unpacked 1.0.2 DWIN_SET")
        for name, cls in (("13_touch.bin", sf.TouchFile),
                          ("14_variable.bin", sf.VariableFile)):
            data = read(os.path.join(rel, name))
            self.assertEqual(cls.parse(data).build(), data)


if __name__ == "__main__":
    unittest.main()


from dgus_lcd import macro_params as mp  # noqa: E402

PRINT_DOT = """
{% set x = params.X|default(125)|float %}
{% set y = params.Y | default(125) | float %}
{% set z = params.Z|default(0.3)|float %}
{% set t = params['TEMP']|default(200)|int %}
{% set m = params.MACRO|default(printer.foo.bar, True)|string %}
{% set v = params.VELOCITY|default(printer["x"].speed) %}
{% if params.X is defined %}{% endif %}
"""


class MacroParamsTest(unittest.TestCase):
    def test_parse(self):
        got = [(p["name"], p["default"], p["type"])
               for p in mp.parse_params(PRINT_DOT)]
        self.assertEqual(got, [("X", "125", "float"), ("Y", "125", "float"),
                               ("Z", "0.3", "float"), ("TEMP", "200", "int"),
                               ("MACRO", None, "str"),
                               ("VELOCITY", None, "num")])

    def test_format_and_command(self):
        self.assertEqual(mp.format_value(0.3), "0.3")
        self.assertEqual(mp.format_value(125.0), "125")
        self.assertEqual(mp.format_value(-0.001), "0")
        self.assertEqual(mp.format_value(2.6, "int"), "3")
        params = mp.parse_params(PRINT_DOT)
        self.assertEqual(mp.build_command("PRINT_DOT", params,
                                          {"Z": 0.25, "TEMP": 210.0}),
                         "PRINT_DOT Z=0.25 TEMP=210")
        self.assertEqual(mp.build_command("PRINT_DOT", params, {}),
                         "PRINT_DOT")


class ParamsPageTest(MacrosPageTest):
    def setUp(self):
        super().setUp()
        self.e._objects = {"gcode_macro PRINT_DOT", "gcode_macro PARK"}
        self.e.status["configfile"] = {"settings": {
            "gcode_macro print_dot": {"gcode": PRINT_DOT},
            "gcode_macro park": {"gcode": "G0 X0"}}}

    def press32(self, vp, value):
        async def run():
            self.e.handle_received(vp, struct.pack(">i", value))
        self.loop.run_until_complete(run())

    def test_flow(self):
        self.e.switch_page("macros")
        # PARK has no parameters: runs at once
        self.press(ms.VP_MACRO_KEY, 1)
        self.assertEqual(self.e._gcode_queue.get_nowait(), "PARK")
        self.e._gcode_pending = 0
        # PRINT_DOT opens the parameters page
        self.press(ms.VP_MACRO_KEY, 2)
        self.assertEqual(self.e._current_page, "macro_params")
        self.assertTrue(self.e._gcode_queue.empty())
        w = lambda vp, n=16: text(self.ser, vp, n)  # noqa: E731
        self.assertEqual(w(ms.VP_PARAM_MACRO, 32), "PRINT_DOT")
        self.assertEqual([w(ms.param_name_vp(r)) for r in range(4)],
                         ["X", "Y", "Z", "TEMP"])
        self.assertEqual(w(ms.param_value_vp(2)), "(0.3)")
        self.assertEqual(w(ms.VP_PARAM_INDICATOR, 8), "1/2")
        # keypad entries arrive as int32 x 100
        self.press32(ms.param_input_vp(2), 25)        # Z = 0.25
        self.press32(ms.param_input_vp(3), 21049)     # TEMP 210.49 -> 210
        self.assertEqual(w(ms.param_value_vp(2)), "0.25")
        self.assertEqual(w(ms.param_value_vp(3)), "210")
        # page 2: MACRO (text) and VELOCITY (no default)
        self.press(ms.VP_PARAM_KEY, ms.PKEY_NEXT)
        self.assertEqual([w(ms.param_name_vp(r)) for r in range(4)],
                         ["MACRO", "VELOCITY", "", ""])
        self.assertEqual(w(ms.param_value_vp(1)), "-")
        self.press32(ms.param_input_vp(0), 100)
        self.assertIn(b"can't be typed", self.ser.writes[0x3000])
        self.press32(ms.param_input_vp(1), -150)      # VELOCITY -1.5
        self.press32(ms.param_input_vp(2), 100)       # empty row: ignored
        self.press(ms.VP_PARAM_KEY, ms.PKEY_RUN)
        self.assertEqual(self.e._gcode_queue.get_nowait(),
                         "PRINT_DOT Z=0.25 TEMP=210 VELOCITY=-1.5")
        self.assertIn(b"Running PRINT_DOT", self.ser.writes[0x3000])
        # reset clears entered values
        self.e._gcode_pending = 0
        self.press(ms.VP_PARAM_KEY, ms.PKEY_RESET)
        self.press(ms.VP_PARAM_KEY, ms.PKEY_RUN)
        self.assertEqual(self.e._gcode_queue.get_nowait(), "PRINT_DOT")
        # back arrow goes to the macro list
        self.press(ms.VP_SWITCH_PAGE, ms.PAGE_MACROS)
        self.assertEqual(self.e._current_page, "macros")

    def test_run_blocked_while_printing(self):
        self.e.switch_page("macros")
        self.press(ms.VP_MACRO_KEY, 2)
        self.e.status["print_stats"] = {"state": "printing"}
        self.press(ms.VP_PARAM_KEY, ms.PKEY_RUN)
        self.assertTrue(self.e._gcode_queue.empty())

    # inherited MacrosPageTest tests assume other macros
    test_list_filters_and_sorts = test_page_render_and_paging = None
    test_tap_runs_macro = test_empty_tile_does_nothing = None
    test_blocked_while_printing = test_more_page_switch = None
