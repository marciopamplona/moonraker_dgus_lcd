# Minimal Moonraker websocket JSON-RPC client
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import asyncio
import itertools
import json
import logging

from websockets.asyncio.client import connect

log = logging.getLogger("dgus.moonraker")


class MoonrakerError(Exception):
    pass


class Moonraker:
    def __init__(self, url, api_key=None, on_connect=None,
                 on_disconnect=None, on_notify=None):
        self.url = url
        self.api_key = api_key
        self._on_connect = on_connect        # async callback()
        self._on_disconnect = on_disconnect  # callback()
        self._on_notify = on_notify          # callback(method, params)
        self._ws = None
        self._ids = itertools.count(1)
        self._pending = {}
        self.connected = False

    async def run(self):
        headers = {"X-Api-Key": self.api_key} if self.api_key else None
        while True:
            try:
                async with connect(self.url, additional_headers=headers,
                                   max_size=None, ping_interval=20) as ws:
                    self._ws = ws
                    self.connected = True
                    log.info("Connected to %s", self.url)
                    if self._on_connect is not None:
                        asyncio.create_task(self._safe_connect())
                    async for raw in ws:
                        self._handle(raw)
            except Exception as e:
                if self.connected:
                    log.warning("Moonraker connection lost: %s", e)
                else:
                    log.debug("Moonraker connect failed: %s", e)
            finally:
                was_connected = self.connected
                self.connected = False
                self._ws = None
                for fut in self._pending.values():
                    if not fut.done():
                        fut.set_exception(MoonrakerError("disconnected"))
                self._pending.clear()
                if was_connected and self._on_disconnect is not None:
                    self._on_disconnect()
            await asyncio.sleep(3)

    async def _safe_connect(self):
        try:
            await self._on_connect()
        except Exception:
            log.exception("Error in connect handler")

    def _handle(self, raw):
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        if "id" in msg and msg["id"] in self._pending:
            fut = self._pending.pop(msg["id"])
            if fut.done():
                return
            if "error" in msg:
                err = msg["error"]
                fut.set_exception(MoonrakerError(err.get("message", str(err))))
            else:
                fut.set_result(msg.get("result"))
        elif "method" in msg and self._on_notify is not None:
            try:
                self._on_notify(msg["method"], msg.get("params") or [])
            except Exception:
                log.exception("Error handling %s", msg["method"])

    async def call(self, method, params=None, timeout=None):
        if self._ws is None:
            raise MoonrakerError("not connected")
        req_id = next(self._ids)
        fut = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        req = {"jsonrpc": "2.0", "method": method, "id": req_id}
        if params is not None:
            req["params"] = params
        await self._ws.send(json.dumps(req))
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(req_id, None)
