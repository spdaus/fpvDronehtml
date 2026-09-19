"""Unit tests for the bridge's packet format (R10.1). Run: python -m unittest bridge/test_bridge.py"""
import importlib.util
import json
import os
import unittest

# Load bridge.py by path: running from the repo root, `import bridge` would resolve to this folder.
_spec = importlib.util.spec_from_file_location(
    "fpv_bridge", os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge.py"))
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)


class NormTest(unittest.TestCase):
    def test_extremes_and_center(self):
        self.assertEqual(bridge.norm(0), -1.0)
        self.assertEqual(bridge.norm(65535), 1.0)
        self.assertAlmostEqual(bridge.norm(32767), 0.0, places=4)
        self.assertAlmostEqual(bridge.norm(32768), 0.0, places=4)


class PacketTest(unittest.TestCase):
    def test_connected_packet(self):
        p = bridge.make_packet(7, 1234.56789, [0, 65535, 32768, 32767, 0, 65535], 0b101, 9000)
        self.assertEqual(p["s"], 7)
        self.assertEqual(p["t"], 1234.568)
        self.assertEqual(p["c"], 1)
        self.assertEqual(len(p["a"]), 6)
        self.assertEqual(p["a"][0], -1.0)
        self.assertEqual(p["a"][1], 1.0)
        self.assertEqual(p["b"], 5)
        self.assertEqual(p["p"], 9000)

    def test_pov_centered_is_minus_one(self):
        p = bridge.make_packet(1, 0, [32768] * 6, 0, bridge.POV_CENTERED)
        self.assertEqual(p["p"], -1)

    def test_disconnected_packet(self):
        self.assertEqual(bridge.make_disconnected(3, 10.0), {"s": 3, "t": 10.0, "c": 0})

    def test_sse_frame_format(self):
        frame = bridge.sse_frame({"s": 1, "c": 0})
        self.assertTrue(frame.startswith(b"data:"))
        self.assertTrue(frame.endswith(b"\n\n"))
        self.assertNotIn(b"\n", frame[:-2])  # one data line per event
        self.assertEqual(json.loads(frame[5:-2]), {"s": 1, "c": 0})


class BrowserArgsTest(unittest.TestCase):
    def test_app_mode_with_own_profile(self):
        a = bridge.browser_args("chrome.exe", "http://localhost:8777/", "C:/p", False, True)
        self.assertIn("--app=http://localhost:8777/", a)
        self.assertIn("--user-data-dir=C:/p", a)
        self.assertIn("--start-fullscreen", a)
        self.assertNotIn("--disable-gpu-vsync", a)

    def test_low_latency_disables_vsync(self):
        a = bridge.browser_args("chrome.exe", "u", "p", True, False)
        self.assertIn("--disable-gpu-vsync", a)
        self.assertIn("--disable-frame-rate-limit", a)
        self.assertNotIn("--start-fullscreen", a)


if __name__ == "__main__":
    unittest.main()
