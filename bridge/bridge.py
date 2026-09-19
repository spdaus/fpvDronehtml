"""Controller bridge for the FPV sim.

Polls the first Windows joystick through winmm (which reads the Switch Pro Controller
correctly) at ~1 kHz and pushes every change to the browser over Server-Sent Events.
Also serves the built game from ../dist.

    GET  /stream   text/event-stream, one `data:` packet per state change, `hb` events every 250 ms
    GET  /state    the latest packet as JSON
    POST /quit     stop the bridge (needs header `X-FPV: quit`; used by the title screen's Exit)
    GET  /*        static files from dist/

Standard library only. Spec: specs/drone-sim/design.md §3.1 (R10.1, R1.1).
"""
from __future__ import annotations

import argparse
import ctypes
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.normpath(os.path.join(HERE, "..", "dist"))

POLL_HZ = 1000
RESCAN_S = 1.0
HEARTBEAT_S = 0.25
MAX_JOYSTICKS = 16
JOY_RETURNALL = 0xFF
POV_CENTERED = 0xFFFF


class JOYINFOEX(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in (
        "dwSize", "dwFlags", "dwXpos", "dwYpos", "dwZpos", "dwRpos", "dwUpos", "dwVpos",
        "dwButtons", "dwButtonNumber", "dwPOV", "dwReserved1", "dwReserved2")]


# ---------- pure helpers (unit-tested) ----------

def norm(v: int) -> float:
    """Map a winmm axis value 0..65535 to -1..1."""
    return round((v - 32767.5) / 32767.5, 4)


def make_packet(seq: int, t_ms: float, raw_axes, buttons: int, pov: int) -> dict:
    """Connected-state packet. Axes are [X, Y, Z, R, U, V] normalised to -1..1;
    buttons is the winmm bitmask; pov is hundredths of a degree, or -1 when centred."""
    return {
        "s": seq,
        "t": round(t_ms, 3),
        "c": 1,
        "a": [norm(v) for v in raw_axes],
        "b": int(buttons) & 0xFFFFFFFF,
        "p": -1 if pov == POV_CENTERED else int(pov),
    }


def make_disconnected(seq: int, t_ms: float) -> dict:
    return {"s": seq, "t": round(t_ms, 3), "c": 0}


HEARTBEAT = b"event:hb\ndata:1\n\n"


def sse_frame(packet: dict) -> bytes:
    return b"data:" + json.dumps(packet, separators=(",", ":")).encode() + b"\n\n"


# ---------- controller polling ----------

class Poller(threading.Thread):
    """Reads the joystick at POLL_HZ and publishes a new packet whenever anything changes."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="joystick-poller")
        self.cond = threading.Condition()
        self.seq = 0
        self.packet = make_disconnected(0, time.perf_counter() * 1000)
        self.rate_hz = 0.0
        self._winmm = ctypes.windll.winmm if sys.platform == "win32" else None
        self._info = JOYINFOEX()
        self._info.dwSize = ctypes.sizeof(JOYINFOEX)
        self._joy_id = -1

    def _read(self, joy_id: int) -> bool:
        self._info.dwFlags = JOY_RETURNALL
        return self._winmm.joyGetPosEx(joy_id, ctypes.byref(self._info)) == 0

    def _scan(self) -> int:
        for joy_id in range(MAX_JOYSTICKS):
            if self._read(joy_id):
                return joy_id
        return -1

    def _publish(self, packet: dict) -> None:
        with self.cond:
            self.seq += 1
            packet["s"] = self.seq
            self.packet = packet
            self.cond.notify_all()

    def run(self) -> None:
        if self._winmm is None:
            print("winmm unavailable (not Windows): serving 'disconnected' only")
            return
        ctypes.windll.winmm.timeBeginPeriod(1)
        period = 1.0 / POLL_HZ
        last_key = None
        next_scan = 0.0
        next_t = time.perf_counter()
        polls, rate_t0 = 0, next_t
        while True:
            now = time.perf_counter()
            if self._joy_id < 0:
                if now >= next_scan:
                    self._joy_id = self._scan()
                    next_scan = now + RESCAN_S
                    if self._joy_id >= 0:
                        print(f"Controller found (winmm joystick id {self._joy_id})", flush=True)
                        last_key = None
                if self._joy_id < 0:
                    time.sleep(0.05)
                    next_t = time.perf_counter()
                    continue
            if self._read(self._joy_id):
                i = self._info
                key = (i.dwXpos, i.dwYpos, i.dwZpos, i.dwRpos, i.dwUpos, i.dwVpos, i.dwButtons, i.dwPOV)
                if key != last_key:
                    last_key = key
                    self._publish(make_packet(0, now * 1000, key[:6], key[6], key[7]))
            else:
                print("Controller disconnected", flush=True)
                self._joy_id = -1
                last_key = None
                self._publish(make_disconnected(0, now * 1000))
            polls += 1
            if now - rate_t0 >= 1.0:
                self.rate_hz = polls / (now - rate_t0)
                polls, rate_t0 = 0, now
            next_t += period
            delay = next_t - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            elif delay < -0.02:  # fell far behind (system stall): resync instead of bursting
                next_t = time.perf_counter()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second server silently share the port (the old
    # controller-bridge.py would keep receiving requests). Bind exclusively so conflicts fail loudly.
    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


POLLER: Poller | None = None
SERVER: Server | None = None


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "FPVBridge/1.0"

    def log_message(self, *args) -> None:  # keep the console quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/stream":
            self._stream()
        elif path == "/state":
            with POLLER.cond:
                packet = dict(POLLER.packet)
            packet["hz"] = round(POLLER.rate_hz)
            self._send(200, json.dumps(packet).encode(), "application/json")
        else:
            self._static(path)

    def do_POST(self) -> None:
        if self.path == "/quit" and self.headers.get("X-FPV") == "quit":
            self._send(200, b"bye", "text/plain")
            print("Exit requested by the game. Bye!", flush=True)
            threading.Thread(target=SERVER.shutdown, daemon=True).start()
        else:
            self._send(403, b"forbidden", "text/plain")

    def _stream(self) -> None:
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            self.wfile.write(b"retry: 500\n\n")
            with POLLER.cond:
                seq, packet = POLLER.seq, POLLER.packet
            self.wfile.write(sse_frame(packet))
            self.wfile.flush()
            while True:
                with POLLER.cond:
                    POLLER.cond.wait_for(lambda: POLLER.seq != seq, timeout=HEARTBEAT_S)
                    new_seq, packet = POLLER.seq, POLLER.packet
                if new_seq != seq:
                    seq = new_seq
                    self.wfile.write(sse_frame(packet))
                else:
                    self.wfile.write(HEARTBEAT)  # a named event: EventSource ignores comment lines
                self.wfile.flush()
        except (ConnectionError, OSError):
            pass  # browser went away

    def _static(self, path: str) -> None:
        if not os.path.isdir(DIST):
            msg = b"<h1>Game not built</h1><p>Run <code>npm run build</code>, then reload.</p>"
            self._send(503, msg, "text/html; charset=utf-8")
            return
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(DIST, rel))
        if not full.startswith(DIST + os.sep) or not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")  # SPA fallback; also blocks path traversal
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            body = f.read()
        try:
            self._send(200, body, ctype)
        except (ConnectionError, OSError):
            pass  # browser cancelled the request (e.g. a source map it no longer wants)


# ---------- browser launch (play.bat) ----------

BROWSERS = (
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
)


def browser_args(exe: str, url: str, profile: str, low_latency: bool, fullscreen: bool) -> list[str]:
    """Chrome/Edge in app mode with its own profile: a separate browser process, so the flags
    apply even if the browser is already open, and a one-entry history so Exit can close it."""
    args = [
        exe,
        f"--app={url}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--force_high_performance_gpu",  # the GT 750M, not the Intel iGPU
    ]
    if fullscreen:
        args.append("--start-fullscreen")
    if low_latency:
        args += ["--disable-gpu-vsync", "--disable-frame-rate-limit"]  # lower latency, may tear
    return args


def launch_browser(url: str, low_latency: bool, fullscreen: bool) -> None:
    exe = next((p for p in (os.path.expandvars(b) for b in BROWSERS) if os.path.isfile(p)), None)
    if exe is None:
        print("Chrome/Edge not found; opening the default browser instead.", flush=True)
        webbrowser.open(url)
        return
    profile = os.path.normpath(os.path.join(HERE, "..", ".chrome-profile"))
    subprocess.Popen(browser_args(exe, url, profile, low_latency, fullscreen))
    print(f"Opened {os.path.basename(exe)}{' (low-latency: vsync off)' if low_latency else ''}", flush=True)


def main() -> None:
    global POLLER, SERVER
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--launch", action="store_true", help="open the game in a Chrome/Edge app window")
    ap.add_argument("--low-latency", action="store_true", help="with --launch: disable vsync (may tear)")
    ap.add_argument("--windowed", action="store_true", help="with --launch: don't start fullscreen")
    args = ap.parse_args()
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    try:
        SERVER = Server(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print(f"Can't listen on port {args.port} ({e.strerror}). Another program is using it;"
              f" close it or pass --port.", flush=True)
        sys.exit(1)
    POLLER = Poller()
    POLLER.start()
    print(f"FPV bridge on http://localhost:{args.port}  (Ctrl+C to stop)", flush=True)
    if args.launch:
        launch_browser(f"http://localhost:{args.port}/", args.low_latency, not args.windowed)
    try:
        SERVER.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        SERVER.server_close()


if __name__ == "__main__":
    main()
