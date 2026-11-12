# Tests for dgus_lcd.editor_bridge over real HTTP, with tests/fake_screen.py
# as the screen.
import io
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile

from dgus_lcd import dgus_device as d
from dgus_lcd import dgus_protocol as p
from dgus_lcd import editor_bridge as eb

from .fake_screen import FakeScreen

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(REPO, "vendor", "DGUS-reloaded-Klipper", "project", "DWIN_SET")


class _KeepOpen:
    """FakeScreen that survives DGUSDevice closing it (one screen for all
    requests, like the real one)."""

    def __init__(self, screen):
        self.screen = screen

    def __getattr__(self, name):
        return getattr(self.screen, name)

    def close(self):
        pass


def project_zip(pid, name="Test"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("project.json", json.dumps({
            "format": "dgus-studio", "version": 1, "id": pid, "name": name,
            "modified": "2026-11-12T10:00:00Z", "pages": [{}, {}]}))
        z.writestr("assets/000_main.bmp", b"BM")
    return buf.getvalue()


def dwin_set_zip(names):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            with open(os.path.join(VENDOR, n), "rb") as f:
                z.writestr("DWIN_SET/" + n, f.read())
        z.writestr("FLASHING.txt", "notes")
    return buf.getvalue()


class BridgeHttpTest(unittest.TestCase):
    token = None

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="bridge_test_")
        self.dist = os.path.join(self.tmp, "dist")
        os.makedirs(self.dist)
        with open(os.path.join(self.dist, "index.html"), "w") as f:
            f.write("<!doctype html><title>editor</title>")
        self.screen = FakeScreen()
        self.running = False
        self.bridge = eb.Bridge(
            "/dev/fake", 250000, os.path.join(self.tmp, "projects"),
            cache=os.path.join(self.tmp, "cache"),
            device_factory=lambda: d.DGUSDevice(ser=_KeepOpen(self.screen), timeout=0.2),
            service_check=lambda: self.running)
        self.srv = eb.make_server(self.bridge, "127.0.0.1", 0, self.dist, self.token)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)
        # unittest keeps test cases alive until the end; each FakeScreen
        # holds a 64 MB NAND, so let it go now
        del self.screen, self.bridge, self.srv

    def call(self, method, path, body=None, headers=None, raw=False):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        h = dict(headers or {})
        if self.token and "X-Bridge-Token" not in h:
            h["X-Bridge-Token"] = self.token
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path),
                                     data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                out = r.read()
                return r.status, (out if raw else json.loads(out))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def wait_job(self, job_id):
        for _ in range(400):
            st, job = self.call("GET", "/api/jobs/" + job_id)
            if job["state"] != "running":
                return job
            time.sleep(0.05)
        self.fail("flash job didn't finish")


class BridgeTest(BridgeHttpTest):
    def test_info_and_static(self):
        st, info = self.call("GET", "/api/info")
        self.assertEqual(st, 200)
        self.assertEqual(info["baud"], 250000)
        self.assertFalse(info["token_required"])
        self.assertIn("dgus-reloaded", [t["id"] for t in info["templates"]])
        st, html = self.call("GET", "/", raw=True)
        self.assertIn(b"<title>editor</title>", html)
        st, _ = self.call("GET", "/../../etc/passwd")
        self.assertEqual(st, 404)
        st, err = self.call("GET", "/api/nope")
        self.assertEqual(st, 404)

    def test_page_and_vp_preview(self):
        st, _ = self.call("POST", "/api/page", {"page": 9})
        self.assertEqual(st, 200)
        self.assertEqual(self.screen._get(p.VP_PIC_NOW, 2), b"\x00\x09")
        st, _ = self.call("POST", "/api/vp", {"vp": 0x30ff, "words": [215, -1]})
        self.assertEqual(st, 200)
        self.assertEqual(self.screen._get(0x30ff, 4), b"\x00\xd7\xff\xff")
        st, r = self.call("GET", "/api/vp?vp=0x30ff&words=2")
        self.assertEqual(r["words"], [215, 0xffff])
        st, err = self.call("POST", "/api/vp", {"vp": 1, "words": []})
        self.assertEqual(st, 400)
        st, info = self.call("GET", "/api/screen")
        self.assertEqual(info["page"], 9)

    def test_refuses_while_service_runs(self):
        self.running = True
        st, err = self.call("POST", "/api/page", {"page": 1})
        self.assertEqual(st, 409)
        self.assertIn("systemctl stop dgus_lcd", err["error"])
        st, err = self.call("POST", "/api/flash", dwin_set_zip(["24_icons.ico"]))
        self.assertEqual(st, 409)

    def test_projects(self):
        st, out = self.call("PUT", "/api/projects/p123", project_zip("p123", "Mine"))
        self.assertEqual((st, out["name"], out["pages"]), (200, "Mine", 2))
        st, ls = self.call("GET", "/api/projects")
        self.assertEqual([x["id"] for x in ls], ["p123"])
        st, raw = self.call("GET", "/api/projects/p123", raw=True)
        self.assertEqual(raw, project_zip("p123", "Mine"))
        st, _ = self.call("PUT", "/api/projects/other", project_zip("p123"))
        self.assertEqual(st, 400)
        st, _ = self.call("PUT", "/api/projects/..%2Fx", project_zip("x"))
        self.assertEqual(st, 400)
        st, _ = self.call("PUT", "/api/projects/p9", b"not a zip")
        self.assertEqual(st, 400)
        st, _ = self.call("DELETE", "/api/projects/p123")
        self.assertEqual(st, 200)
        self.assertEqual(self.call("GET", "/api/projects")[1], [])

    def test_template(self):
        st, t = self.call("GET", "/api/templates/dgus-reloaded")
        names = [f["name"] for f in t["files"]]
        self.assertIn("13_touch.bin", names)
        self.assertIn("001_home.bmp", names)
        st, raw = self.call("GET", "/api/templates/dgus-reloaded/13_touch.bin", raw=True)
        with open(os.path.join(VENDOR, "13_touch.bin"), "rb") as f:
            self.assertEqual(raw, f.read())
        st, _ = self.call("GET", "/api/templates/dgus-reloaded/..%2F..%2FREADME.md")
        self.assertEqual(st, 400)
        st, _ = self.call("GET", "/api/templates/nope")
        self.assertEqual(st, 404)

    def test_flash_only_changed(self):
        z = dwin_set_zip(["24_icons.ico", "22_config.bin", "T5UID1.CFG"])
        st, job = self.call("POST", "/api/flash", z)
        self.assertEqual(st, 202)
        job = self.wait_job(job["id"])
        self.assertEqual(job["state"], "done", job)
        status = {f["name"]: f["status"] for f in job["files"]}
        self.assertEqual(status, {"24_icons.ico": "done", "22_config.bin": "done", "T5UID1.CFG": "skipped"})
        with open(os.path.join(VENDOR, "24_icons.ico"), "rb") as f:
            ico = f.read()
        start = 24 * 256 * 1024
        self.assertEqual(bytes(self.screen.nand[start:start + len(ico)]), ico)
        self.assertTrue(job["reset"])
        self.assertEqual(self.screen.resets, 1)
        # second time: nothing changed, nothing uploaded, no reset
        job = self.wait_job(self.call("POST", "/api/flash", z)[1]["id"])
        self.assertEqual({f["name"]: f["status"] for f in job["files"]}["24_icons.ico"], "unchanged")
        self.assertFalse(job["reset"])
        self.assertEqual(self.screen.resets, 1)
        # forget the cache, or ask for everything: uploads again
        self.call("POST", "/api/flash/forget")
        job = self.wait_job(self.call("POST", "/api/flash?reset=0", z)[1]["id"])
        self.assertEqual({f["name"]: f["status"] for f in job["files"]}["24_icons.ico"], "done")
        self.assertFalse(job["reset"])
        st, err = self.call("POST", "/api/flash", b"junk")
        self.assertEqual(st, 400)


class BridgeTokenTest(BridgeHttpTest):
    token = "s3cret-token"

    def test_token_required_except_info_and_static(self):
        st, info = self.call("GET", "/api/info", headers={"X-Bridge-Token": "wrong"})
        self.assertEqual((st, info["token_required"]), (200, True))
        st, _ = self.call("GET", "/", headers={"X-Bridge-Token": ""}, raw=True)
        self.assertEqual(st, 200)
        st, err = self.call("GET", "/api/projects", headers={"X-Bridge-Token": "wrong"})
        self.assertEqual(st, 401)
        st, _ = self.call("GET", "/api/projects")
        self.assertEqual(st, 200)


class ServiceBaudTest(unittest.TestCase):
    def test_reads_baud_from_service_config(self):
        with tempfile.NamedTemporaryFile("w", suffix=".cfg", delete=False) as f:
            f.write("[dgus_lcd]\nport: /dev/ttyS1\nbaud: 250000  # fast\n")
        try:
            self.assertEqual(eb.service_baud(f.name), 250000)
        finally:
            os.remove(f.name)
        self.assertEqual(eb.service_baud("/nonexistent.cfg"), 115200)
        self.assertTrue(eb.is_loopback("127.0.0.1"))
        self.assertFalse(eb.is_loopback("0.0.0.0"))


if __name__ == "__main__":
    unittest.main()
