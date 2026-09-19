"""Serves controller-test.html on http://localhost:8765 and exposes the first Windows
joystick (read via winmm, which handles this controller correctly) as JSON at /state."""
import ctypes, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class JOYINFOEX(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in (
        "dwSize", "dwFlags", "dwXpos", "dwYpos", "dwZpos", "dwRpos", "dwUpos", "dwVpos",
        "dwButtons", "dwButtonNumber", "dwPOV", "dwReserved1", "dwReserved2")]

winmm = ctypes.windll.winmm
HERE = os.path.dirname(os.path.abspath(__file__))

def norm(v):
    return round((v - 32767.5) / 32767.5, 4)

def read_state():
    info = JOYINFOEX()
    info.dwSize = ctypes.sizeof(info)
    info.dwFlags = 255
    if winmm.joyGetPosEx(0, ctypes.byref(info)) != 0:
        return {"connected": False}
    pov = info.dwPOV
    return {
        "connected": True,
        "axes": [norm(info.dwXpos), norm(info.dwYpos), norm(info.dwRpos), norm(info.dwUpos)],
        "buttons": [bool(info.dwButtons >> i & 1) for i in range(32)],
        "pov": None if pov == 65535 else pov / 100,  # degrees, 0 = up
    }

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/state"):
            body, ctype = json.dumps(read_state()).encode(), "application/json"
        else:
            # "/" -> 2D test, "/3d" -> 3D test
            name = {"/": "controller-test.html", "/3d": "controller-test-3d.html"}.get(self.path.split("?")[0])
            if name is None:
                self.send_error(404)
                return
            with open(os.path.join(HERE, name), "rb") as f:
                body, ctype = f.read(), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    print("Serving on http://localhost:8765  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
