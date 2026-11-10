# Serial transport for the DWIN DGUS II screen.
#
# Frame encoding/decoding lives in dgus_protocol.py; this file only owns the
# port (open/reopen, asyncio reader) and dispatches decoded frames.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import asyncio
import logging

import serial

from . import dgus_protocol as proto

log = logging.getLogger("dgus.serial")


class DGUSSerial:
    def __init__(self, port, baud, on_read, on_open=None, on_frame=None,
                 crc=False):
        self.port = port
        self.baud = baud
        self.crc = crc
        self._on_read = on_read    # callback(address, bytes) for 0x83 frames
        self._on_open = on_open    # callback()
        self._on_frame = on_frame  # callback(Frame) for every frame
        self._ser = None
        self._parser = proto.FrameParser(crc)
        self._loop = None
        self.is_open = False

    async def run(self):
        """Keep the port open, reopening it on failure."""
        self._loop = asyncio.get_running_loop()
        while True:
            if not self.is_open:
                try:
                    self._open()
                    if self._on_open is not None:
                        self._on_open()
                except Exception as e:
                    log.warning("Cannot open %s: %s", self.port, e)
                    self._close()
            await asyncio.sleep(5)

    def _open(self):
        self._ser = serial.Serial(self.port, self.baud, timeout=0,
                                  write_timeout=1)
        self._ser.reset_input_buffer()
        self._parser.reset()
        self._loop.add_reader(self._ser.fileno(), self._readable)
        self.is_open = True
        log.info("Opened %s @ %d%s", self.port, self.baud,
                 " (CRC)" if self.crc else "")

    def _close(self):
        if self._ser is not None:
            try:
                self._loop.remove_reader(self._ser.fileno())
            except Exception:
                pass
            try:
                self._ser.close()
            except Exception:
                pass
        self._ser = None
        self.is_open = False

    def close(self):
        self._close()

    def set_crc(self, enabled):
        """Switch host-side CRC mode (use after proto.cmd_uart2())."""
        self.crc = enabled
        self._parser = proto.FrameParser(enabled)

    def _readable(self):
        try:
            data = self._ser.read(4096)
        except Exception as e:
            log.error("Serial read failed: %s", e)
            self._close()
            return
        if not data:
            return
        for frame in self._parser.feed(data):
            self._handle_frame(frame)

    def _handle_frame(self, frame):
        if self._on_frame is not None:
            try:
                self._on_frame(frame)
            except Exception:
                log.exception("Error in frame callback")
        if frame.kind != "var":
            if frame.kind == "raw":
                log.debug("RX unhandled cmd 0x%02x %s", frame.cmd,
                          frame.data.hex())
            return
        log.debug("RX addr=0x%04x data=%s", frame.address, frame.data.hex())
        try:
            self._on_read(frame.address, frame.data)
        except Exception:
            log.exception("Error handling data for 0x%04x", frame.address)

    def send_raw(self, frame):
        """Write an already encoded frame."""
        if not self.is_open:
            return
        log.debug("TX %s", frame.hex())
        try:
            self._ser.write(frame)
        except Exception as e:
            log.error("Serial write failed: %s", e)
            self._close()

    def write_var(self, address, data):
        self.send_raw(proto.write_var(address, data, self.crc))

    def read_var(self, address, wlen):
        self.send_raw(proto.read_var(address, wlen, self.crc))

    def send(self, command):
        """Send an (address, data) pair from one of proto.cmd_*()."""
        address, data = command
        self.write_var(address, data)
