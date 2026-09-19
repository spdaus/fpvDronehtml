# Tasks — FPV Drone Simulator (MVP)

Status: **Playtest build complete.** Tasks 1–11 are done. Task 11's manual checklist and Task 12 (feel
pass) need your controller time.
Specs: [requirements.md](requirements.md) · [design.md](design.md)

Rules:
- Do the tasks in order. A task is done only when its listed tests pass and `npm test` is green.
- Tick the box and note any deviation from the design inline, and update design.md if the design changed.
- Test names include the R-id they verify, for example `it('R2.1 center stick maps to hover throttle')`.

Current state:
- `npm test`: **86 tests passing** across 11 files.
- `python -m unittest bridge/test_bridge.py`: 7 passing.
- `tsc --noEmit`: clean.

---

- [x] **1. Scaffold**
  - Vite 8, TypeScript 7 (strict), Three.js r186, Vitest 5, all pinned.
  - Scripts: `npm run dev|build|test|bench`. The dev proxy forwards `/stream`, `/state` and `/quit` to
    `:8777`.

- [x] **2. Bridge** (R10.1, R1.1)
  - `bridge/bridge.py`: a 1 kHz winmm poll thread (1000 Hz measured) and SSE `/stream` with
    TCP_NODELAY and `hb` heartbeat events. It also serves `/state`, a guarded `POST /quit`, static
    `dist/`, and `--launch`.
  - `bridge/test_bridge.py` covers normalisation, packets, SSE framing and browser args.
  - *Deviations:* port **8777** with exclusive bind (the old prototype held 8765); six axes in each
    packet; the heartbeat is a named event.

- [x] **3. Input pipeline** (R1.2–R1.6, R1.9, R10.3)
  - `sampleBuffer`, `calibration`, `buttons`, `sources` (bridge/gamepad/keyboard) and `inputManager`.
  - Tests: `input.test.ts`, plus `game.test.ts` for the failsafe.
  - *Deviation:* bridge samples are re-timed with a min-transit clock offset, so late-dispatched
    events keep their true spacing.

- [x] **4. Flight-control math** (R2.1–R2.4, R3.1–R3.3, R4.6)
  - Tests: `rates.test.ts` (Betaflight reference table), `throttle.test.ts`, `mixer.test.ts`.

- [x] **5. Physics core** (R4.1–R4.3, R4.7–R4.13)
  - Tests: `physics.test.ts`.
  - Measured values:

    | Measure | Result |
    |---|---|
    | Hover throttle | 32% |
    | Hover current | 9.4 A |
    | Voltage under punch | 22.8 V at 94 A |
    | Top speed | 41 m/s |
    | Wash recovery wobble | ~28°/s RMS |

- [x] **6. Closed-loop flight tuning** (R2.5, R3.4, R4.4, R4.5)
  - Tests: `flight.test.ts`.
  - Measured values:

    | Measure | Result |
    |---|---|
    | Roll step to 90% | 64 ms |
    | Overshoot | 8% |
    | Flip time | 0.58 s |
    | Hover drift over 5 s | 0.21 m |

- [x] **7. Collision** (R5.1–R5.4)
  - Tests: `collision.test.ts`, covering no tunneling at 40 m/s from several angles.

- [x] **8. World** (R6.1–R6.5)
  - Built from 400+ boxes: the bando, containers, pad and 150 trees.
  - Tests: `world.test.ts`.
  - *Perf gate:* `perf.test.ts` gives **0.039 ms** of physics per 60 fps frame (budget 1.5 ms).
    `bench/` was dropped because Vitest 5 removed `bench()`.

- [x] **9. Game layer** (R5.5, R7.1–R7.3, R7.6)
  - Tests: `game.test.ts` (state machine, crash/reset, failsafe, 1000 seeded target spawns).

- [x] **10. Rendering, OSD and loop** (R8, R9.1–R9.3, R9.5, R10.2, R10.4, R10.5)
  - Title screen (New Game / Exit), pause menu, calibration flow, OSD, debug overlay (X / F3), and
    dynamic resolution.
  - Tests: `dynamicResolution.test.ts`.
  - *Browser check (in-app browser, GT 750M):*
    - No console errors; 7 draw calls, 22 k triangles.
    - 1280×720 GPU frame p50 ≤ 4.8 ms, p95 ≤ 7.5 ms.
    - Arm → climb → fly → crash → OSD verified with the keyboard source.
    - Exit stopped the bridge and closed the window.
  - *Deviations:*
    - The calibration range step auto-advances once the sticks are released.
    - The OSD shows CRASHED/FAILSAFE ahead of "NO CONTROLLER".
    - URL flags `?source=keyboard` and `?autopause=0` were added for testing.

- [x] **11. Launcher and docs** (R10.6, R1.8)
  - `play.bat` (normal / `lowlatency` / `windowed`): the bridge opens Chrome in app mode with its own
    profile and forces the high-performance GPU.
  - `README.md`.
  - [ ] **R1.7 rebinding:** not built. Default bindings only.
  - Manual checklist for you on the target laptop:
    - [ ] The bridge detects the controller, and the overlay shows `bridge ~65 Hz` over Bluetooth.
    - [ ] Calibration flow completes, and the sticks read ±1 at full deflection.
    - [ ] Arming is refused with throttle high and works with throttle low.
    - [ ] At stick center, the quad roughly holds altitude.
    - [ ] Rolls and flips feel crisp, with no wobble at rest.
    - [ ] Dropping vertically into your own wash causes a visible wobble.
    - [ ] A punch-out shows voltage sag on the OSD.
    - [ ] A light wall tap bounces, and a hard hit crashes; reset works.
    - [ ] Targets appear inside the bando and score when hit.
    - [ ] The overlay shows 59–60 fps with p99 ≤ 17.5 ms in Chrome via `play.bat` (R9.1).

- [ ] **12. Feel pass** (all of R4)
  - Adjust `src/sim/params.ts` from your fly-test feedback, keeping every test green.
