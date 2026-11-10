# Tests for dgus_lcd.dgus_protocol. Expected bytes are the worked examples
# from "T5L_DGUSII Application Development Guide V2.9" (chapters 4 and 5).
#
# Run: ~/dgus-env/bin/python -m unittest discover -s tests
import datetime
import unittest

from dgus_lcd import dgus_protocol as p


def h(s):
    return bytes.fromhex(s.replace(" ", ""))


class CRCTest(unittest.TestCase):
    def test_guide_vectors(self):
        # (CMD + DATA, CRC bytes as sent)
        for body, crc in [("83 000F 01", "ED90"),
                          ("82 0082 0A", "C8FB"),
                          ("82 1000 3132", "CC9B"),
                          ("82 4F4B", "A5EF"),
                          ("83 1001 01 005A", "0E2C"),
                          ("83 000F 01 6322", "E5D5")]:
            self.assertEqual(p.crc16(h(body)).to_bytes(2, "little"), h(crc))


class EncodeTest(unittest.TestCase):
    def test_read_var(self):
        self.assertEqual(p.read_var(0x000f, 1), h("5AA5 04 83 000F 01"))
        self.assertEqual(p.read_var(0x000f, 1, crc=True),
                         h("5AA5 06 83 000F 01 ED90"))

    def test_write_var(self):
        self.assertEqual(p.write_var(0x1000, h("3132")),
                         h("5AA5 05 82 1000 3132"))
        self.assertEqual(p.write_var(0x1000, h("3132"), crc=True),
                         h("5AA5 07 82 1000 3132 CC9B"))
        self.assertEqual(p.write_words(0x1001, 0x000a, 0x000b),
                         h("5AA5 07 82 1001 000A 000B"))
        self.assertEqual(p.write_words(0x1000, -1), h("5AA5 05 82 1000 FFFF"))

    def test_write_var_limits(self):
        with self.assertRaises(p.ProtocolError):
            p.write_var(0x1000, b"\x01")       # odd length
        with self.assertRaises(p.ProtocolError):
            p.write_var(0x1000, b"")
        with self.assertRaises(p.ProtocolError):
            p.write_var(0x10000, b"\x00\x00")
        p.write_var(0x1000, bytes(252))        # LEN = 255, fits
        with self.assertRaises(p.ProtocolError):
            p.write_var(0x1000, bytes(252), crc=True)

    def test_read_var_limits(self):
        p.read_var(0x1000, 0x7d)
        with self.assertRaises(p.ProtocolError):
            p.read_var(0x1000, 0x7d, crc=True)
        with self.assertRaises(p.ProtocolError):
            p.read_var(0x1000, 0)

    def test_read_reg(self):
        self.assertEqual(p.read_reg(0, 0x0a, 4), h("5AA5 04 81 00 0A 04"))

    def test_write_curve(self):
        # CH_Mode 0x83 = channels 0, 1, 7, low channel first
        self.assertEqual(p.write_curve({7: [3], 0: [1], 1: [2]}),
                         h("5AA5 08 84 83 0001 0002 0003"))
        with self.assertRaises(p.ProtocolError):
            p.write_curve({0: [1, 2], 1: [1]})


class CommandTest(unittest.TestCase):
    def frame(self, cmd, crc=False):
        return p.write_var(*cmd, crc=crc)

    def test_guide_examples(self):
        cases = [
            (p.cmd_reset(), "5AA5 07 82 0004 55AA 5AA5"),
            (p.cmd_page(1), "5AA5 07 82 0084 5A01 0001"),
            (p.cmd_beep(1000), "5AA5 05 82 00A0 007D"),
            (p.cmd_play_music(3), "5AA5 07 82 00A0 03 01 40 00"),
            (p.cmd_brightness(0x64, 0x32, 10000), "5AA5 07 82 0082 6432 03E8"),
            (p.cmd_touch(0xee, 0x8f), "5AA5 0B 82 00D4 5AA5 0004 00EE 008F"),
            (p.cmd_touch_control(0, 2, 1, p.CTRL_DISABLE),
             "5AA5 0B 82 00B0 5AA5 0000 02 01 0000"),
            (p.cmd_touch_enable(False), "5AA5 07 82 00FC 55AA 5A5A"),
            (p.cmd_touch_enable(True), "5AA5 07 82 00FC 0000 0000"),
            (p.cmd_system_config(0x38), "5AA5 07 82 0080 5A 00 00 38"),
            (p.cmd_uart2(9600), "5AA5 07 82 000C 5A00 0150"),
            (p.cmd_uart2(115200), "5AA5 07 82 000C 5A00 001C"),
            (p.cmd_uart2(crc=True), "5AA5 05 82 000C 5A80"),
            (p.cmd_nor_flash(True, 2, 0x1002, 2),
             "5AA5 0B 82 0008 A500 0002 1002 0002"),
            (p.cmd_nor_flash(False, 2, 0x2000, 2),
             "5AA5 0B 82 0008 5A00 0002 2000 0002"),
            (p.cmd_pointer_icon(0x2d, 1, 0x64, 0x64),
             "5AA5 0B 82 00D8 5A 2D 0001 0064 0064"),
        ]
        for cmd, expected in cases:
            self.assertEqual(self.frame(cmd), h(expected), expected)

    def test_guide_crc_examples(self):
        self.assertEqual(self.frame(p.cmd_uart2(), crc=True),
                         h("5AA5 07 82 000C 5A00 A6BD"))
        self.assertEqual(self.frame(p.cmd_uart2(115200), crc=True),
                         h("5AA5 09 82 000C 5A00 001C BA18"))

    def test_rtc(self):
        dt = datetime.datetime(2019, 10, 1, 11, 12, 13)
        # a Tuesday -> week 2 (the guide's example just writes 00)
        self.assertEqual(self.frame(p.cmd_rtc_write(dt)),
                         h("5AA5 0B 82 0010 13 0A 01 02 0B 0C 0D 00"))
        self.assertEqual(p.parse_rtc(h("13 0A 01 00 0B 0C 0D 00")),
                         (2019, 10, 1, 0, 11, 12, 13))


class ParserTest(unittest.TestCase):
    def test_guide_replies(self):
        fp = p.FrameParser()
        frames = fp.feed(h("5AA5 03 82 4F4B"
                           "5AA5 06 83 000F 01 1410"
                           "5AA5 06 83 1001 01 005A"
                           "5AA5 0C 83 0010 04 130A 0100 0B0C 0D00"))
        self.assertEqual([f.kind for f in frames], ["ack", "var", "var", "var"])
        self.assertEqual(frames[1].address, 0x000f)
        self.assertEqual(p.parse_version(frames[1].data), (0x14, 0x10))
        self.assertEqual(frames[2].words, (0x005a,))
        self.assertEqual(frames[3].address, 0x0010)

    def test_crc_mode(self):
        fp = p.FrameParser(crc=True)
        frames = fp.feed(h("5AA5 05 82 4F4B A5EF 5AA5 08 83 000F 01 6322 E5D5"))
        self.assertEqual([f.kind for f in frames], ["ack", "var"])
        self.assertEqual(frames[1].data, h("6322"))
        # corrupted CRC is dropped and counted
        self.assertEqual(fp.feed(h("5AA5 08 83 000F 01 6322 E5D6")), [])
        self.assertEqual(fp.crc_errors, 1)

    def test_split_and_garbage(self):
        fp = p.FrameParser()
        data = h("00 FF 5A 5AA5 06 83 0014 01 0007 5A")
        out = []
        for b in data:
            out += fp.feed(bytes([b]))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].words, (7,))
        out = fp.feed(h("A5 03 82 4F4B"))  # header split across feeds
        self.assertEqual([f.kind for f in out], ["ack"])

    def test_reg_reply(self):
        f = p.FrameParser().feed(h("5AA5 07 81 00 0A 03 010203"))[0]
        self.assertEqual((f.kind, f.page, f.address, f.data),
                         ("reg", 0, 0x0a, h("010203")))

    def test_decoders(self):
        self.assertEqual(p.parse_touch_status(h("5A02 0255 00E5 0000")),
                         (True, p.TP_LIFTED, 0x0255, 0x00e5))
        cfg = p.parse_system_config(h("00 14 10 38"))
        self.assertTrue(cfg["auto_upload"] and cfg["touch_sound"])
        self.assertEqual(cfg["rotation"], 0)


if __name__ == "__main__":
    unittest.main()
