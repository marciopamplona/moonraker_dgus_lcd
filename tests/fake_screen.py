# Minimal T5UID1 simulator for tests: 64 Kword SRAM, NAND font space, NOR,
# picture slots, and the "5A = do it once" system variables used by
# dgus_device. Implements the behaviour described in the T5UID1 guide.
import struct

from dgus_lcd import dgus_protocol as p


class FakeScreen:
    def __init__(self, ack=True):
        self.ack = ack
        self.sram = bytearray(0x20000)
        self.nand = bytearray(0x4000000)
        self.nor = bytearray(p.NOR_SIZE)
        self.framebuffer = bytearray(p.PICTURE_BUFFER_WORDS * 2)
        self.pictures = {}
        self.jpegs = {}
        self.os_code = None
        self.resets = 0
        self.touches = []
        self.writes = []      # (address, data) of every 0x82
        self._out = bytearray()
        self._parser = p.FrameParser()
        self._rx = bytearray()
        # some plausible system values
        self._set(p.VP_VERSION, b"\x34\x32")
        self._set(p.VP_PIC_NOW, b"\x00\x05")
        self._set(p.VP_VCC_NOW, struct.pack(">H", 45000))
        self._set(p.VP_SYSTEM_CONFIG, b"\x00\x14\x07\x38")
        self._set(p.VP_LED_CONFIG, b"\x64\x32\x01\x90")
        self._set(p.VP_FOLDER_NAME, b"DWIN_SET")

    # pyserial-like interface
    def write(self, data):
        for f in self._split(bytes(data)):
            self._handle(f)
        return len(data)

    def read(self, n):
        out = bytes(self._out[:n])
        del self._out[:n]
        return out

    def close(self):
        pass

    def upload(self, address, data):
        """Simulate a touch upload from the screen."""
        self._out += p.encode_frame(p.CMD_READ_VAR, struct.pack(
            ">HB", address, len(data) // 2) + data)

    # internals
    def _split(self, data):
        # parse host->screen frames (same framing, different bodies)
        self._rx += data
        while len(self._rx) >= 3 and self._rx[2] + 3 <= len(self._rx):
            n = self._rx[2]
            yield bytes(self._rx[3:3 + n])
            del self._rx[:3 + n]

    def _set(self, vp, data):
        self.sram[vp * 2:vp * 2 + len(data)] = data

    def _get(self, vp, nbytes):
        return bytes(self.sram[vp * 2:vp * 2 + nbytes])

    def _handle(self, body):
        cmd = body[0]
        if cmd == p.CMD_WRITE_VAR:
            addr = struct.unpack(">H", body[1:3])[0]
            data = body[3:]
            self.writes.append((addr, data))
            self._set(addr, data)
            if addr == p.VP_SYSTEM_RESET:
                self.resets += 1
                return  # no reply, screen reboots
            self._side_effect(addr)
            if self.ack:
                self._out += p.encode_frame(cmd, p.ACK)
        elif cmd == p.CMD_READ_VAR:
            addr, words = struct.unpack(">HB", body[1:4])
            self._out += p.encode_frame(cmd, body[1:4]
                                        + self._get(addr, words * 2))

    def _side_effect(self, addr):
        if addr == p.VP_PIC_SET and self._get(addr, 1) == b"\x5a":
            mode, pic = struct.unpack(">BH", self._get(addr + 0, 4)[1:])
            if mode == p.PIC_SWITCH:
                self._set(p.VP_PIC_NOW, struct.pack(">H", pic))
            else:
                self.pictures[pic] = bytes(self.framebuffer)
            self._set(addr, b"\x00")
        elif addr == p.VP_NAND_FLASH and self._get(addr, 1) == b"\x5a":
            d = self._get(addr, 12)
            if d[1] == 0x02:
                block, vp = struct.unpack(">HH", d[2:6])
                off = block * p.NAND_BLOCK
                self.nand[off:off + p.NAND_BLOCK] = self._get(vp, p.NAND_BLOCK)
            else:
                font = d[2]
                woff = int.from_bytes(d[3:6], "big")
                vp, words = struct.unpack(">HH", d[6:10])
                off = font * p.NAND_FONT_SIZE + woff * 2
                self._set(vp, self.nand[off:off + words * 2])
            self._set(addr, b"\x00")
        elif addr == p.VP_NOR_FLASH_RW and self._get(addr, 1) in (b"\x5a",
                                                                   b"\xa5"):
            d = self._get(addr, 8)
            waddr = int.from_bytes(d[1:4], "big")
            vp, words = struct.unpack(">HH", d[4:8])
            if d[0] == 0xa5:
                self.nor[waddr * 2:waddr * 2 + words * 2] = self._get(
                    vp, words * 2)
            else:
                self._set(vp, self.nor[waddr * 2:waddr * 2 + words * 2])
            self._set(addr, b"\x00")
        elif addr == p.VP_BMP_DOWNLOAD and self._get(addr, 1) == b"\x5a":
            d = self._get(addr, 8)
            vp, words = struct.unpack(">HH", d[1:5])
            pos = int.from_bytes(d[5:8], "big") * 2
            self.framebuffer[pos:pos + words * 2] = self._get(vp, words * 2)
            self._set(addr, b"\x00")
        elif addr == p.VP_JPEG_DOWNLOAD and self._get(addr, 1) == b"\x5a":
            d = self._get(addr, 8)
            mode, vp, pic = struct.unpack(">BHH", d[1:6])
            self.jpegs[pic] = self._get(vp, 0x10000)
            self._set(addr, b"\x00")
        elif addr == p.VP_OS_UPDATE and self._get(addr, 1) == b"\x5a":
            vp = struct.unpack(">H", self._get(addr, 4)[2:4])[0]
            self.os_code = self._get(vp, 0x10000)
            self._set(addr, b"\x00")
        elif addr == p.VP_TP_SIMULATE and self._get(addr, 2) == b"\x5a\xa5":
            self.touches.append(struct.unpack(">HHH", self._get(addr, 8)[2:]))
            self._set(addr, b"\x00\x00")
        elif addr == p.VP_TOUCH_CONTROL and self._get(addr, 2) == b"\x5a\xa5":
            self._set(addr, b"\x00\x00")
