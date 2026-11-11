# SD card DWIN_SET builder.
import os
import shutil
import tempfile
import unittest
from unittest import mock

from dgus_lcd import macros_screen as ms
from dgus_lcd import screen_files as sf
from dgus_lcd import sdcard

from .test_screen_cfg import STOCK


def fake_dir(root, sub, names):
    d = os.path.join(root, sub)
    os.makedirs(d)
    for name in names:
        with open(os.path.join(d, name), "wb") as f:
            f.write(sub.encode() + b" " + name.encode())
    shutil.copy(STOCK, d)
    return d


def read(path):
    with open(path, "rb") as f:
        return f.read()


class SdcardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        # like vendor/: no compiled 13/14/22 files
        self.base = fake_dir(self.tmp, "base",
                             ("0_DWIN_ASC.HZK", "001_home.bmp"))
        self.compiled = fake_dir(self.tmp, "compiled",
                                 ("13_touch.bin", "14_variable.bin",
                                  "22_config.bin", "001_home.bmp"))
        os.remove(os.path.join(self.compiled, "T5UID1.CFG"))
        self.out = os.path.join(self.tmp, "out")

    def build(self, **kw):
        kw.setdefault("base", self.base)
        kw.setdefault("compiled", self.compiled)
        return sdcard.build(self.out, **kw)

    def test_layout(self):
        d = self.build()
        self.assertEqual(d, os.path.join(self.out, "DWIN_SET"))
        self.assertTrue(os.path.isfile(os.path.join(self.out,
                                                    "FLASHING.txt")))
        self.assertEqual(read(os.path.join(d, "22_config.bin")),
                         b"compiled 22_config.bin")
        # base wins over compiled, macro files from screen/macros
        self.assertEqual(read(os.path.join(d, "001_home.bmp")),
                         b"base 001_home.bmp")
        for name in ms.FILES:
            self.assertEqual(read(os.path.join(d, name)),
                             read(os.path.join(ms.PREBUILT, name)))
        self.assertEqual(sf.cfg_baud(read(os.path.join(d, "T5UID1.CFG"))),
                         sf.CFG_BAUD_CLOCK / 0x1f)

    def test_stock_baud(self):
        d = self.build(baud=115200)
        self.assertEqual(read(os.path.join(d, "T5UID1.CFG")), read(STOCK))

    def test_removes_stale_files(self):
        stale = os.path.join(self.out, "DWIN_SET", "99_old.bin")
        os.makedirs(os.path.dirname(stale))
        open(stale, "wb").close()
        self.build()
        self.assertFalse(os.path.exists(stale))

    def test_bad_baud_writes_nothing(self):
        with self.assertRaises(sf.FormatError):
            self.build(baud=921600)
        self.assertFalse(os.path.exists(self.out))

    def test_incomplete(self):
        os.remove(os.path.join(self.compiled, "22_config.bin"))
        with self.assertRaises(SystemExit):
            self.build()
        self.assertFalse(os.path.exists(os.path.join(self.out, "DWIN_SET")))


class RepoSdcardTest(unittest.TestCase):
    """The real build from vendor/, with no network."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        patcher = mock.patch("urllib.request.urlopen",
                             side_effect=AssertionError("network used"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_complete(self):
        d = sdcard.build(self.tmp)
        names = set(os.listdir(d))
        self.assertTrue(set(sdcard.REQUIRED) <= names)
        self.assertTrue(set(ms.FILES) <= names)
        self.assertIn("24_icons.ico", names)

    def test_release_files_are_stock(self):
        # the vendored release holds the unpatched files the builder starts from
        touch = sf.TouchFile.parse(read(os.path.join(sdcard.RELEASE_FILES,
                                                     "13_touch.bin")))
        self.assertEqual(touch.for_page(ms.PAGE_MACROS), [])

    def test_rebuild_matches_prebuilt(self):
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed")
        d = sdcard.build(self.tmp, rebuild=True)
        for name in ms.FILES:
            self.assertEqual(read(os.path.join(d, name)),
                             read(os.path.join(ms.PREBUILT, name)), name)


if __name__ == "__main__":
    unittest.main()
