# T5UID1.CFG baud rate helpers and the committed screen/cfg file.
import os
import unittest

from dgus_lcd import screen_files as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STOCK = os.path.join(ROOT, "vendor", "DGUS-reloaded-Klipper", "project",
                     "DWIN_SET", "T5UID1.CFG")
PREBUILT = os.path.join(ROOT, "screen", "cfg", "T5UID1.CFG")


def stock_cfg():
    with open(STOCK, "rb") as f:
        return f.read()


class CfgBaudTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(sf.cfg_baud_value(115200), 0x44)
        self.assertEqual(sf.cfg_baud_value(250000), 0x1f)
        self.assertEqual(sf.cfg_baud_value(9600), 816)

    def test_rejects_inexact_and_out_of_range(self):
        for baud in (500000, 921600, 1500000, 7000):
            with self.assertRaises(sf.FormatError):
                sf.cfg_baud_value(baud)

    def test_stock_is_115200(self):
        self.assertEqual(sf.cfg_baud(stock_cfg()), 115200)

    def test_set_changes_only_baud(self):
        data = stock_cfg()
        out = sf.set_cfg_baud(data, 250000)
        self.assertEqual(out[9:11], b"\x00\x1f")
        self.assertEqual(out[:9] + out[11:], data[:9] + data[11:])

    def test_rejects_other_files(self):
        with self.assertRaises(sf.FormatError):
            sf.cfg_baud(b"\x00" * 128)

    def test_prebuilt_is_current(self):
        with open(PREBUILT, "rb") as f:
            self.assertEqual(f.read(), sf.set_cfg_baud(stock_cfg(), 250000))


if __name__ == "__main__":
    unittest.main()
