# Bridge between the browser editor (editor/) and the screen on this Pi.
#
#   ~/dgus-env/bin/python -m dgus_lcd.editor_bridge            # localhost only
#   ~/dgus-env/bin/python -m dgus_lcd.editor_bridge --host 0.0.0.0
#
# Serves editor/dist and a small JSON API: screen info, page / VP preview,
# flashing a DWIN_SET over serial (with progress), project storage and the
# vendored DGUS-reloaded template. Standard library only (pyserial for the
# port, as dgustool). The serial port is only opened per operation, and not
# at all while the dgus_lcd service owns it. On a non-local address every
# API call (except /api/info) needs the token printed at start.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import argparse
import configparser
import hashlib
import http.server
import io
import ipaddress
import json
import logging
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import zipfile

from .dgus_device import DGUSDevice, DeviceError, plan_upload

VERSION = 1
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIST = os.path.join(REPO_DIR, "editor", "dist")
TEMPLATES = {
    "dgus-reloaded": ("DGUS-reloaded-Klipper 1.0.2 (Ender-6)",
                      os.path.join(REPO_DIR, "vendor", "DGUS-reloaded-Klipper",
                                   "project", "DWIN_SET")),
}
DEFAULT_PROJECTS = os.path.expanduser("~/dgus_projects")
DEFAULT_CACHE = os.path.expanduser("~/.cache/dgus_editor_bridge")
SERVICE_CFG = os.path.expanduser("~/printer_data/config/dgus_lcd.cfg")
MAX_BODY = 96 * 1024 * 1024
PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
FILE_RE = re.compile(r"^[A-Za-z0-9_. -]{1,80}$")

log = logging.getLogger("editor_bridge")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def service_running():
    try:
        return subprocess.run(["systemctl", "is-active", "--quiet",
                               "dgus_lcd"]).returncode == 0
    except FileNotFoundError:
        return False


def service_baud(path=SERVICE_CFG, default=115200):
    """The baud rate the dgus_lcd service talks at (its config's baud:)."""
    cp = configparser.ConfigParser(inline_comment_prefixes=("#", ";"))
    try:
        cp.read(path)
        for section in cp.sections():
            if cp.has_option(section, "baud"):
                return cp.getint(section, "baud")
    except (configparser.Error, ValueError):
        pass
    return default


def sha256(data):
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Flash jobs
# ---------------------------------------------------------------------------
class FlashJob:
    def __init__(self, job_id, files):
        self.id = job_id
        self.files = files      # list of dicts, see Bridge.start_flash
        self.state = "running"
        self.error = None
        self.cancel = False
        self.started = time.time()
        self.finished = None
        self.reset = False

    def to_json(self):
        return {"id": self.id, "state": self.state, "error": self.error,
                "files": self.files, "reset": self.reset,
                "elapsed": round((self.finished or time.time())
                                 - self.started, 1)}


class Bridge:
    """The API, independent of HTTP (tests call it directly too)."""

    def __init__(self, port="/dev/ttyS1", baud=115200, projects=DEFAULT_PROJECTS,
                 cache=DEFAULT_CACHE, templates=TEMPLATES, force=False,
                 device_factory=None, service_check=service_running):
        self.port = port
        self.baud = baud
        self.projects = projects
        self.cache = cache
        self.templates = templates
        self.force = force
        self.service_check = service_check
        self.device_factory = device_factory or (
            lambda: DGUSDevice(self.port, self.baud))
        self.lock = threading.Lock()        # one serial user at a time
        self.jobs = {}
        self.job = None

    # -- device ---------------------------------------------------------------
    def _check_port(self):
        if not self.force and self.service_check():
            raise ApiError(409, "the dgus_lcd service is using the screen; "
                                "stop it with 'sudo systemctl stop dgus_lcd'")
        if self.job and self.job.state == "running":
            raise ApiError(409, "a flash is in progress")

    def _device(self, fn):
        self._check_port()
        if not self.lock.acquire(blocking=False):
            raise ApiError(409, "the screen is busy")
        try:
            with self.device_factory() as dev:
                return fn(dev)
        except DeviceError as e:
            raise ApiError(502, "screen: %s" % e)
        except OSError as e:
            raise ApiError(502, "serial port %s: %s" % (self.port, e))
        finally:
            self.lock.release()

    def info(self):
        running = self.service_check()
        return {"bridge": VERSION, "serial": self.port, "baud": self.baud,
                "service_running": running, "force": self.force,
                "busy": bool(self.job and self.job.state == "running"),
                "templates": [{"id": k, "name": v[0]}
                              for k, v in self.templates.items()
                              if os.path.isdir(v[1])]}

    def screen(self):
        return self._device(lambda dev: dev.info())

    def show_page(self, page):
        if not isinstance(page, int) or not 0 <= page <= 0xffff:
            raise ApiError(400, "page must be 0-65535")

        def go(dev):
            dev.page = page
            return {"page": page}
        return self._device(go)

    def write_vp(self, vp, words):
        if not isinstance(vp, int) or not 0 <= vp <= 0xffff:
            raise ApiError(400, "vp must be 0-0xFFFF")
        if (not isinstance(words, list) or not words or len(words) > 120
                or not all(isinstance(w, int) and -0x8000 <= w <= 0xffff
                           for w in words)):
            raise ApiError(400, "words: 1-120 integers")
        data = b"".join((w & 0xffff).to_bytes(2, "big") for w in words)
        return self._device(lambda dev: (dev.write_vp(vp, data),
                                         {"vp": vp, "words": len(words)})[1])

    def read_vp(self, vp, words):
        if not 0 <= vp <= 0xffff or not 1 <= words <= 120:
            raise ApiError(400, "vp 0-0xFFFF, words 1-120")
        data = self._device(lambda dev: dev.read_vp(vp, words))
        return {"vp": vp, "words": [int.from_bytes(data[i:i + 2], "big")
                                    for i in range(0, len(data), 2)]}

    # -- flashing -------------------------------------------------------------
    def _cache_path(self):
        key = re.sub(r"[^A-Za-z0-9]+", "_", self.port).strip("_")
        return os.path.join(self.cache, "flashed_%s.json" % key)

    def _load_cache(self):
        try:
            with open(self._cache_path()) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_cache(self, cache):
        os.makedirs(self.cache, exist_ok=True)
        tmp = self._cache_path() + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cache, f, indent=1, sort_keys=True)
        os.replace(tmp, self._cache_path())

    def plan(self, zip_bytes, only_changed=True):
        """Unpack a DWIN_SET zip and list what would be uploaded."""
        tmp = tempfile.mkdtemp(prefix="dgus_flash_")
        try:
            names = _unzip_dwin_set(zip_bytes, tmp)
            files, skipped = plan_upload(tmp)
        except Exception:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        cache = self._load_cache()
        entries = []
        for path, kind, index in files:
            name = os.path.basename(path)
            with open(path, "rb") as f:
                digest = sha256(f.read())
            same = cache.get(name) == digest
            entries.append({
                "name": name, "kind": kind, "id": index,
                "size": os.path.getsize(path), "hash": digest,
                "status": "unchanged" if same and only_changed else "pending",
                "done": 0, "total": 0, "where": None, "error": None})
        for path, reason in skipped:
            entries.append({"name": os.path.basename(path), "kind": None,
                            "id": None, "size": os.path.getsize(path),
                            "status": "skipped", "error": reason, "done": 0,
                            "total": 0, "where": None, "hash": None})
        return tmp, sorted(names), entries

    def start_flash(self, zip_bytes, only_changed=True, verify=False,
                    reset=True):
        self._check_port()
        tmp, _names, entries = self.plan(zip_bytes, only_changed)
        job = FlashJob(secrets.token_hex(6), entries)
        self.jobs[job.id] = job
        self.job = job
        t = threading.Thread(target=self._run_flash,
                             args=(job, tmp, verify, reset), daemon=True)
        t.start()
        return job.to_json()

    def _run_flash(self, job, tmp, verify, reset):
        if not self.lock.acquire(timeout=30):
            job.state, job.error = "error", "the screen is busy"
            job.finished = time.time()
            shutil.rmtree(tmp, ignore_errors=True)
            return
        cache = self._load_cache()
        try:
            with self.device_factory() as dev:
                for f in job.files:
                    if f["status"] != "pending":
                        continue
                    if job.cancel:
                        f["status"] = "cancelled"
                        continue
                    f["status"] = "uploading"

                    def progress(done, total, f=f):
                        f["done"], f["total"] = done, total
                        if job.cancel:
                            raise DeviceError("cancelled")
                    try:
                        f["where"] = dev.upload_file(
                            os.path.join(tmp, f["name"]), verify, progress)
                        f["status"] = "done"
                        cache[f["name"]] = f["hash"]
                        self._save_cache(cache)
                    except DeviceError as e:
                        f["status"] = "cancelled" if job.cancel else "failed"
                        f["error"] = str(e)
                        if not job.cancel:
                            raise
                uploaded = any(f["status"] == "done" for f in job.files)
                if reset and uploaded and not job.cancel:
                    dev.reset()
                    job.reset = True
            job.state = "cancelled" if job.cancel else "done"
        except (DeviceError, OSError) as e:
            job.state, job.error = "error", str(e)
        except Exception as e:  # keep the bridge alive whatever happens
            log.exception("flash job failed")
            job.state, job.error = "error", "%s: %s" % (type(e).__name__, e)
        finally:
            job.finished = time.time()
            self.lock.release()
            shutil.rmtree(tmp, ignore_errors=True)

    def job_status(self, job_id):
        job = self.jobs.get(job_id)
        if not job:
            raise ApiError(404, "no such job")
        return job.to_json()

    def cancel_job(self, job_id):
        job = self.jobs.get(job_id)
        if not job:
            raise ApiError(404, "no such job")
        job.cancel = True
        return job.to_json()

    def forget_flashed(self):
        try:
            os.remove(self._cache_path())
        except FileNotFoundError:
            pass
        return {"ok": True}

    # -- projects -------------------------------------------------------------
    def _project_path(self, pid):
        if not PROJECT_ID_RE.match(pid or ""):
            raise ApiError(400, "bad project id")
        return os.path.join(self.projects, pid + ".dgusproj")

    def list_projects(self):
        out = []
        if not os.path.isdir(self.projects):
            return out
        for name in sorted(os.listdir(self.projects)):
            if not name.endswith(".dgusproj"):
                continue
            path = os.path.join(self.projects, name)
            meta = _project_meta(path)
            if meta:
                meta["size"] = os.path.getsize(path)
                out.append(meta)
        return sorted(out, key=lambda m: m.get("modified", ""), reverse=True)

    def get_project(self, pid):
        path = self._project_path(pid)
        if not os.path.isfile(path):
            raise ApiError(404, "no such project")
        with open(path, "rb") as f:
            return f.read()

    def put_project(self, pid, data):
        path = self._project_path(pid)
        meta = _project_meta(io.BytesIO(data))
        if not meta:
            raise ApiError(400, "not a .dgusproj file")
        if meta["id"] != pid:
            raise ApiError(400, "project id doesn't match the file")
        os.makedirs(self.projects, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return dict(meta, size=len(data))

    def delete_project(self, pid):
        path = self._project_path(pid)
        if not os.path.isfile(path):
            raise ApiError(404, "no such project")
        os.remove(path)
        return {"ok": True}

    # -- templates ------------------------------------------------------------
    def _template_dir(self, tid):
        t = self.templates.get(tid)
        if not t or not os.path.isdir(t[1]):
            raise ApiError(404, "no such template")
        return t[1]

    def template_files(self, tid):
        d = self._template_dir(tid)
        return {"id": tid, "name": self.templates[tid][0],
                "files": [{"name": n, "size": os.path.getsize(os.path.join(d, n))}
                          for n in sorted(os.listdir(d))
                          if os.path.isfile(os.path.join(d, n))
                          and FILE_RE.match(n)]}

    def template_file(self, tid, name):
        d = self._template_dir(tid)
        if not FILE_RE.match(name or "") or name.startswith("."):
            raise ApiError(400, "bad file name")
        path = os.path.join(d, name)
        if not os.path.isfile(path):
            raise ApiError(404, "no such file")
        with open(path, "rb") as f:
            return f.read()


def _project_meta(src):
    try:
        with zipfile.ZipFile(src) as z:
            p = json.loads(z.read("project.json"))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return None
    if p.get("format") != "dgus-studio" or not PROJECT_ID_RE.match(str(p.get("id", ""))):
        return None
    return {"id": p["id"], "name": p.get("name", ""),
            "modified": p.get("modified", ""), "pages": len(p.get("pages", []))}


def _unzip_dwin_set(zip_bytes, dest):
    """Extract the DWIN_SET files of a zip (flat, safe names only)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise ApiError(400, "not a zip file")
    with z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        in_set = [i for i in infos if re.search(r"(^|/)DWIN_SET/", i.filename, re.I)]
        names = []
        for info in in_set or infos:
            base = info.filename.rsplit("/", 1)[-1]
            if base.startswith(".") or not FILE_RE.match(base):
                continue
            if info.file_size > MAX_BODY:
                raise ApiError(400, "%s is too large" % base)
            with z.open(info) as src, open(os.path.join(dest, base), "wb") as dst:
                shutil.copyfileobj(src, dst)
            names.append(base)
    if not names:
        raise ApiError(400, "no DWIN_SET files in the zip")
    return names


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
                ".css": "text/css", ".svg": "image/svg+xml",
                ".png": "image/png", ".ico": "image/x-icon",
                ".json": "application/json"}


def make_handler(bridge, dist, token):
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "dgus-editor-bridge/%d" % VERSION

        def log_message(self, fmt, *args):
            log.info("%s %s", self.address_string(), fmt % args)

        # -- helpers ----------------------------------------------------------
        def _send(self, status, body, ctype="application/json", extra=None):
            if not isinstance(body, (bytes, bytearray)):
                body = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ApiError(413, "request too large")
            return self.rfile.read(n) if n else b""

        def _json(self):
            try:
                return json.loads(self._body() or b"{}")
            except ValueError:
                raise ApiError(400, "body must be JSON")

        def _authorised(self):
            if token is None:
                return True
            got = self.headers.get("X-Bridge-Token", "")
            return secrets.compare_digest(got, token)

        # -- routing ----------------------------------------------------------
        def _route(self, method):
            url = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(url.path)
            q = dict(urllib.parse.parse_qsl(url.query))
            if not path.startswith("/api/"):
                if method not in ("GET", "HEAD"):
                    raise ApiError(405, "method not allowed")
                return self._static(path)
            if path == "/api/info" and method == "GET":
                return self._send(200, dict(bridge.info(), token_required=token is not None))
            if not self._authorised():
                raise ApiError(401, "missing or wrong token (open the URL the bridge printed)")
            # split before decoding, so an encoded "/" stays inside its
            # segment (and is then rejected by the name checks)
            parts = [urllib.parse.unquote(x) for x in url.path.strip("/").split("/")[1:]]
            if parts == ["screen"] and method == "GET":
                return self._send(200, bridge.screen())
            if parts == ["page"] and method == "POST":
                return self._send(200, bridge.show_page(self._json().get("page")))
            if parts == ["vp"] and method == "POST":
                b = self._json()
                return self._send(200, bridge.write_vp(b.get("vp"), b.get("words")))
            if parts == ["vp"] and method == "GET":
                try:
                    vp, n = int(q.get("vp", ""), 0), int(q.get("words", "1"), 0)
                except ValueError:
                    raise ApiError(400, "vp and words must be numbers")
                return self._send(200, bridge.read_vp(vp, n))
            if parts == ["flash"] and method == "POST":
                flag = lambda k, d: q.get(k, d) not in ("0", "false", "no")
                return self._send(202, bridge.start_flash(
                    self._body(), only_changed=flag("only_changed", "1"),
                    verify=flag("verify", "0"), reset=flag("reset", "1")))
            if parts == ["flash", "forget"] and method == "POST":
                return self._send(200, bridge.forget_flashed())
            if len(parts) == 2 and parts[0] == "jobs" and method == "GET":
                return self._send(200, bridge.job_status(parts[1]))
            if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel" and method == "POST":
                return self._send(200, bridge.cancel_job(parts[1]))
            if parts == ["projects"] and method == "GET":
                return self._send(200, bridge.list_projects())
            if len(parts) == 2 and parts[0] == "projects":
                if method == "GET":
                    return self._send(200, bridge.get_project(parts[1]), "application/zip")
                if method == "PUT":
                    return self._send(200, bridge.put_project(parts[1], self._body()))
                if method == "DELETE":
                    return self._send(200, bridge.delete_project(parts[1]))
            if len(parts) == 2 and parts[0] == "templates" and method == "GET":
                return self._send(200, bridge.template_files(parts[1]))
            if len(parts) == 3 and parts[0] == "templates" and method == "GET":
                return self._send(200, bridge.template_file(parts[1], parts[2]),
                                  "application/octet-stream")
            raise ApiError(404, "no such endpoint")

        def _static(self, path):
            if dist is None or not os.path.isdir(dist):
                raise ApiError(404, "editor not built (run npm run build in editor/)")
            rel = os.path.normpath(path.lstrip("/") or "index.html")
            if rel.startswith("..") or os.path.isabs(rel):
                raise ApiError(404, "not found")
            full = os.path.join(dist, rel)
            if os.path.isdir(full):
                full = os.path.join(full, "index.html")
            if not os.path.isfile(full):
                raise ApiError(404, "not found")
            with open(full, "rb") as f:
                data = f.read()
            ctype = STATIC_TYPES.get(os.path.splitext(full)[1], "application/octet-stream")
            self._send(200, data, ctype, {"Referrer-Policy": "no-referrer"})

        def _handle(self, method):
            try:
                self._route(method)
            except ApiError as e:
                self._send(e.status, {"error": str(e)})
            except Exception as e:
                log.exception("request failed")
                self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})

        def do_GET(self):
            self._handle("GET")

        def do_HEAD(self):
            self._handle("HEAD")

        def do_POST(self):
            self._handle("POST")

        def do_PUT(self):
            self._handle("PUT")

        def do_DELETE(self):
            self._handle("DELETE")

    return Handler


def is_loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def make_server(bridge, host="127.0.0.1", port=8090, dist=DEFAULT_DIST,
                token=None):
    srv = http.server.ThreadingHTTPServer((host, port),
                                          make_handler(bridge, dist, token))
    srv.daemon_threads = True
    return srv


def _lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="editor_bridge",
        description="Serve the DGUS editor and connect it to the screen")
    ap.add_argument("--host", default="127.0.0.1",
                    help="address to listen on (0.0.0.0 for the LAN; then a token is required)")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--serial", default="/dev/ttyS1", help="screen serial port")
    ap.add_argument("-b", "--baud", type=int, default=None,
                    help="screen baud rate (default: baud: in %s, else 115200)" % SERVICE_CFG)
    ap.add_argument("--projects", default=DEFAULT_PROJECTS)
    ap.add_argument("--dist", default=DEFAULT_DIST)
    ap.add_argument("--token", default=None,
                    help="API token (default: random when not on localhost)")
    ap.add_argument("--no-token", action="store_true",
                    help="no token even on the LAN (anyone on it can flash the screen)")
    ap.add_argument("--force", action="store_true",
                    help="use the port even if the dgus_lcd service is running")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(message)s")
    baud = args.baud or service_baud()
    token = args.token
    if token is None and not args.no_token and not is_loopback(args.host):
        token = secrets.token_urlsafe(16)
    bridge = Bridge(args.serial, baud, args.projects, force=args.force)
    try:
        srv = make_server(bridge, args.host, args.port, args.dist, token)
    except OSError as e:
        print("can't listen on %s:%d: %s (another bridge running? try --port)"
              % (args.host, args.port, e.strerror or e), file=sys.stderr)
        return 1
    shown = _lan_address() if args.host in ("0.0.0.0", "::") else args.host
    url = "http://%s:%d/" % (shown, args.port)
    if token:
        url += "?token=" + token
    print("DGUS editor bridge: %s" % url, flush=True)
    print("  screen %s at %d baud%s; projects in %s" % (
        args.serial, baud, " (forced)" if args.force else "", args.projects), flush=True)
    if service_running() and not args.force:
        print("  note: the dgus_lcd service is running; stop it to flash or preview", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
