# Tests for dgus_lcd.dgus_device and dgustool against tests/fake_screen.py.
import os
import struct
import tempfile
import unittest

from dgus_lcd import dgus_protocol as p
from dgus_lcd import dgus_device as d
from dgus_lcd import dgustool

from .fake_screen import FakeScreen


def make_bmp(w, h, color=(255, 0, 0), bpp=24, top_down=False):
    stride = (w * bpp // 8 + 3) & ~3
    row = bytes(color[::-1] + ((0,) if bpp == 32 else ())) * w
    row += b"\x00" * (stride - len(row))
    pixels = row * h
    hdr = struct.pack("<2sIHHI", b"BM", 54 + len(pixels), 0, 0, 54)
    info = struct.pack("<IiiHHIIiiII", 40, w, -h if top_down else h, 1, bpp,
                       0, len(pixels), 0, 0, 0, 0)
    return hdr + info + pixels


class DeviceTest(unittest.TestCase):
    def setUp(self):
        self.screen = FakeScreen()
        self.dev = d.DGUSDevice(ser=self.screen, timeout=0.2)

    def test_read_write_chunked(self):
        data = bytes(range(256)) * 3
        self.dev.write_vp(0x2000, data)
        self.assertEqual(self.dev.read_vp(0x2000, len(data) // 2), data)
        self.assertTrue(all(len(w[1]) <= d.WRITE_CHUNK
                            for w in self.screen.writes))
        self.assertTrue(self.dev.ack)

    def test_no_ack_auto(self):
        dev = d.DGUSDevice(ser=FakeScreen(ack=False), timeout=0.05)
        dev.write_vp(0x2000, b"\x00\x01")
        self.assertIs(dev.ack, False)
        dev.write_vp(0x2000, b"\x00\x02")
        self.assertEqual(dev.read_word(0x2000), 2)

    def test_info(self):
        info = self.dev.info()
        self.assertEqual(info["version"], (0x34, 0x32))
        self.assertEqual(info["page"], 5)
        self.assertEqual(info["folder"], "DWIN_SET")
        self.assertEqual(info["backlight"], {"on": 100, "standby": 50,
                                             "timeout_ms": 2000})
        self.assertTrue(info["config"]["sd_enabled"])
        self.assertAlmostEqual(info["vcc"], 3.296, places=2)

    def test_page_touch_controls(self):
        self.dev.page = 12
        self.assertEqual(self.dev.page, 12)
        self.dev.touch(100, 50)
        self.assertEqual(self.screen.touches, [(p.TOUCH_CLICK, 100, 50)])
        self.dev.set_control(3, 2, 1, False)
        self.dev.set_config(rotation=180, touch_sound=False)
        self.assertEqual(self.screen.sram[0x103], 0x38 & ~0x08 | 2)

    def test_events_kept_during_transactions(self):
        self.screen.upload(0x1001, b"\x00\x0a")
        self.assertEqual(self.dev.page, 5)
        ev = self.dev.wait_key(0.1)
        self.assertEqual((ev.address, ev.data), (0x1001, b"\x00\x0a"))
        self.assertIsNone(self.dev.wait_key(0.05))

    def test_nand_write_and_read(self):
        data = os.urandom(70000)   # 3 blocks, last one padded
        off = 0x40 * p.NAND_FONT_SIZE
        self.dev.nand_write(off, data, verify=True)
        self.assertEqual(bytes(self.screen.nand[off:off + 70000]), data)
        self.assertEqual(self.screen.nand[off + 70000:off + 3 * 0x8000],
                         b"\xff" * (3 * 0x8000 - 70000))
        self.assertEqual(self.dev.nand_read(off + 4, 10), data[4:14])
        with self.assertRaises(d.DeviceError):
            self.dev.nand_read(0, 4)       # not readable on T5UID1
        with self.assertRaises(ValueError):
            self.dev.nand_write(100, b"x")

    def test_nor(self):
        data = os.urandom(5000)
        self.dev.nor_write(0x800, data, verify=True)
        self.assertEqual(bytes(self.screen.nor[0x1000:0x1000 + 5000]), data)
        self.assertEqual(self.dev.nor_read(0x800, 5000), data)

    def test_bmp_upload(self):
        bmp = make_bmp(480, 272, (255, 0, 0))
        px = d.bmp_to_rgb565(bmp)
        self.assertEqual(px[:2], b"\xf8\x00")      # pure red in RGB565
        self.assertEqual(len(px), 480 * 272 * 2)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "7_splash.bmp")
            with open(path, "wb") as f:
                f.write(bmp)
            self.dev.upload_file(path)
        self.assertEqual(self.screen.pictures[7][:len(px)], px)

    def test_bmp_orientation_and_checks(self):
        # bottom-up file: first stored row is the bottom of the image
        w, h = 4, 2
        bmp = bytearray(make_bmp(w, h, (0, 0, 0)))
        bmp[54:57] = b"\xff\xff\xff"                # bottom-left white
        px = d.bmp_to_rgb565(bytes(bmp), (w, h))
        self.assertEqual(px[w * 2:w * 2 + 2], b"\xff\xff")  # row 1, x 0
        self.assertEqual(px[:2], b"\x00\x00")
        self.assertEqual(d.bmp_to_rgb565(make_bmp(4, 2, (0, 255, 0), 32,
                                                  True), (4, 2))[:2],
                         b"\x07\xe0")
        with self.assertRaises(d.DeviceError):
            d.bmp_to_rgb565(make_bmp(10, 10))

    def test_upload_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = {"13_touch.bin": os.urandom(1000),
                     "14ShowFile.bin": os.urandom(40000),
                     "32.ico": os.urandom(100),
                     "3_db.lib": os.urandom(64),
                     "2_pic.jpg": b"\xff\xd8" + os.urandom(500),
                     "T5UID1.CFG": b"x", "T5UID1_V20.BIN": b"x",
                     "DWINOS_x.BIN": b"\x00" * 0x1000 + b"\x12\x34",
                     "0_sound.wav": b"x", "readme.txt": b"x"}
            for name, data in files.items():
                with open(os.path.join(tmp, name), "wb") as f:
                    f.write(data)
            plan, skipped = d.plan_upload(tmp)
            kinds = [(os.path.basename(f), k, i) for f, k, i in plan]
            self.assertEqual(kinds, [("3_db.lib", "nor", 3),
                                     ("13_touch.bin", "nand", 13),
                                     ("14ShowFile.bin", "nand", 14),
                                     ("32.ico", "nand", 32),
                                     ("2_pic.jpg", "jpg", 2)])
            self.assertEqual(len(skipped), 5)
            for path, _k, _i in plan:
                self.dev.upload_file(path)
            self.dev.upload_file(os.path.join(tmp, "DWINOS_x.BIN"),
                                 allow_os=True)
        n = self.screen.nand
        self.assertEqual(bytes(n[13 * 0x40000:13 * 0x40000 + 1000]),
                         files["13_touch.bin"])
        self.assertEqual(bytes(n[14 * 0x40000:14 * 0x40000 + 40000]),
                         files["14ShowFile.bin"])
        self.assertEqual(bytes(self.screen.nor[3 * 0x1000:3 * 0x1000 + 64]),
                         files["3_db.lib"])
        self.assertEqual(self.screen.jpegs[2][:502], files["2_pic.jpg"])
        self.assertEqual(self.screen.os_code[:2], b"\x12\x34")

    def test_reset(self):
        self.dev.reset()
        self.assertEqual(self.screen.resets, 1)
        self.assertEqual(self.screen.writes[-1],
                         (p.VP_SYSTEM_RESET, b"\x55\xaa\x5a\xa5"))


class ToolTest(unittest.TestCase):
    def test_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "13.bin"), "wb").close()
            self.assertEqual(dgustool.main(["upload", "--dry-run", tmp]), 0)

    def test_parser(self):
        args = dgustool.build_parser().parse_args(
            ["config", "--rotation", "90", "--touch-sound", "off"])
        self.assertEqual((args.rotation, args.touch_sound), (90, "off"))


if __name__ == "__main__":
    unittest.main()
