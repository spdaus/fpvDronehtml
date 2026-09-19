# FPV Sim — Bando Freestyle

A realistic FPV acro drone simulator, flown with a Nintendo Switch Pro Controller.
It runs in the browser: Three.js for rendering, 1 kHz physics, and a tiny Python bridge that reads
the controller through Windows. Specs are in [`specs/drone-sim/`](specs/drone-sim/).

## Play

1. Connect the Pro Controller to Windows (Bluetooth or USB).
2. Double-click **`play.bat`**. It builds the game on first run, starts the controller bridge and
   opens the game fullscreen in a Chrome app window. **Exit** on the title screen closes both.
   - `play.bat lowlatency` turns vsync off for the lowest input lag (the image may tear).
   - `play.bat windowed` opens a window instead of fullscreen.
3. The first **New Game** walks you through stick calibration (about 30 s), then you're on the pad.

Needs Node.js (first build only), Python 3.11+ and Chrome or Edge. The bridge uses only Python's
standard library.

## Flying

Sticks are Mode 2 acro (rate mode): the quad holds whatever attitude you leave it in, and nothing
self-levels.

| Control | Action |
|---|---|
| Left stick | Throttle (up/down), yaw (left/right). Centre = hover |
| Right stick | Pitch (up = nose down), roll |
| **ZR** | Arm / disarm (hold the throttle stick **down** to arm) |
| **ZL** or **B** | Reset to the pad (hold for 0.6 s while armed) |
| **D-pad ↑ / ↓** | Camera uptilt ±5° (default 30°) |
| **+** | Pause |
| **−** | Calibrate sticks (title screen, or from the pause menu) |
| **X** | Performance / latency overlay |

**Goal:** a pink target appears somewhere inside the bando. Fly into it to score, and the next one
spawns elsewhere. Your last and best times are on the OSD, and a pink bracket or edge arrow points
to the target. A hard hit (≥ 7 m/s into something) is a crash: press B to reset.

The flight model covers:
- Betaflight rates (1.0 / 0.70 / 0, about 667°/s at full stick).
- Rate PID with feed-forward and airmode.
- Motors that spool up faster than they spin down.
- Prop wash when you drop into your own air.
- A 6S battery that sags under load and drains over a flight.
- Momentum and drag tuned to a 650 g, 8:1 thrust-to-weight 5" freestyle quad, with a top speed of
  about 145 km/h.

## Troubleshooting

- **"NO CONTROLLER"** means the bridge isn't running or can't see the controller. Start the game
  with `play.bat`; the bridge console window prints `Controller found` when it connects.
- **"Can't listen on port 8777"** means another bridge is still running. Close its console window.
  The old prototype (`pro controller setup test/controller-bridge.py`) uses port 8765 and doesn't
  conflict.
- **Sticks feel off-centre or don't reach full rates:** recalibrate with **−**.
- **Stutter:** press **X**. The overlay shows fps, p99 frame time, render resolution and input age.
  The game lowers its render resolution automatically if frames run long.
- **Input rate:** over Bluetooth the Pro Controller reports about 66 times a second (every ~15 ms),
  and the overlay shows this as `bridge 65 Hz`. The bridge polls at 1 kHz, so it adds under 1 ms on
  top.

## Develop

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev
```

- `npm test` runs the unit and physics tests (each named after its requirement ID).
- `npm run dev` starts Vite on :5173 and proxies `/stream` to the bridge. Run
  `python bridge/bridge.py` alongside it.
- `npm run build` writes to `dist/`, which the bridge serves on :8777.
- `npm run bench` reports the physics cost per frame.
- `python -m unittest bridge/test_bridge.py` runs the bridge tests.
- URL flags for testing: `?source=keyboard` flies with the keyboard (W/S throttle, A/D yaw, arrows
  pitch/roll, Space arm, R reset); `?autopause=0` stops the game pausing when the tab is hidden.
- In the console, `window.__fpv` exposes the session, input and renderer.

Layout:
- `src/sim`: physics, flight controller and collision. Pure TypeScript, no DOM, deterministic.
- `src/world`: the bando, park and colliders.
- `src/game`: state machine and targets.
- `src/input`: bridge, gamepad and keyboard sources, plus calibration.
- `src/render`: renderer, scene, OSD and overlay.
- `src/ui`: menus and calibration.
