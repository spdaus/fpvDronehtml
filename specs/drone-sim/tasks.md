# Tasks — FPV Drone Simulator (MVP)

Status: **DRAFT — awaiting review**
Specs: [requirements.md](requirements.md) · [design.md](design.md)

Rules:
- Do the tasks in order. A task is done only when its listed tests pass and `npm test` is green.
- Tick the box and note any deviation from the design inline, and update design.md if the design changed.
- Test names include the R-id they verify, for example `it('R2.1 center stick maps to hover throttle')`.

---

- [ ] **1. Scaffold**
  - Set up Vite + TypeScript (strict) + Three.js (pinned) + Vitest.
  - Add `npm run dev|build|test|bench` scripts, and `vite.config.ts` with a `/stream` + `/state` proxy to
    `:8765`.
  - Leave the `pro controller setup test/` folder untouched.
  - *Done when:* `npm test` runs a placeholder test and `npm run build` emits `dist/`.

- [ ] **2. Bridge** (R10.1, R1.1)
  - Build `bridge/bridge.py`: a 1 kHz poll thread, SSE `/stream` with TCP_NODELAY and a heartbeat,
    `/state`, and static `dist/`.
  - Write `bridge/test_bridge.py` covering normalisation, bitmask packing and the SSE frame format.
  - *Done when:* `python -m unittest bridge/test_bridge.py` passes, and `curl -N localhost:8765/stream`
    shows events while the sticks move (manual).

- [ ] **3. Input pipeline** (R1.2–R1.6, R1.9, R10.3)
  - Write `sampleBuffer`, `mapping`, `calibration`, `bindings`, `bridgeSource`, `gamepadSource` and
    `keyboardSource`.
  - Tests: `mapping.test.ts`, `calibration.test.ts`, `sampleBuffer.test.ts`, `failsafe.test.ts`.

- [ ] **4. Flight-control math** (R2.1–R2.4, R3.1–R3.3, R4.6)
  - Write `sim/math`, `params`, `rates`, `throttle`, `pid` and `mixer`.
  - Tests: `rates.test.ts` (Betaflight reference table), `throttle.test.ts`, `mixer.test.ts`.

- [ ] **5. Physics core** (R4.1–R4.3, R4.7–R4.13)
  - Write `motors`, `aero` (drag, rotor drag, damping, ground effect, prop wash), `battery`, and `drone`
    (state, `step`, integrator, seeded PRNG).
  - Tests: `motors.test.ts`, `aero.test.ts`, `propwash.test.ts`, `battery.test.ts`, `drone.test.ts`.

- [ ] **6. Closed-loop flight tuning** (R2.5, R3.4, R4.4, R4.5)
  - Tune the PID and feed-forward gains in `params.ts` until the flight tests pass.
  - Tests: `flight.test.ts` (hover at center, attitude hold, roll step response, flip time, yaw kick).

- [ ] **7. Collision** (R5.1–R5.4)
  - Write `sim/collision`: flat collider arrays, a grid broadphase, sphere-vs-AABB/cylinder/sphere/ground,
    and the impulse response and crash detection.
  - Tests: `collision.test.ts` (bounce below the threshold, crash at or above it, no tunneling at 40 m/s
    into a 0.1 m wall, all shapes).

- [ ] **8. World** (R6.1–R6.5)
  - Write `world/boxes` (`wallWithOpenings`), `bando`, `park` and `colliders`.
  - Tests: `world.test.ts` (render boxes and colliders come from the same list, opening sizes ≥ 0.6 m, the
    pad and spawn point are clear of colliders).
  - *Perf gate:* `bench/sim.bench.ts` plus `perf.test.ts` (R9.4), with collision against the full world.

- [ ] **9. Game layer** (R5.5, R7.1–R7.3, R7.6)
  - Write the `game/state` machine (DISARMED/ARMED/CRASHED, arm needs throttle low, reset) and
    `game/targetGame` (spawn, hit, score, timings).
  - Tests: `game.test.ts` and `targets.test.ts` (1000 seeded spawns).

- [ ] **10. Rendering, OSD and loop** (R8, R9.1–R9.3, R9.5, R10.2, R10.4, R10.5)
  - Write `render/renderer` (low-latency context, internal resolution), `scene` (merged static meshes,
    instanced trees, ground texture, target), `fpvCamera`, `osd`, `debugOverlay`, `dynamicResolution`,
    `loop.ts` and `main.ts`.
  - Write `ui/calibrationScreen`.
  - Tests: `dynamicResolution.test.ts`.
  - *Browser check:* build, serve with the bridge, then open in the preview. Confirm no console errors, the
    debug overlay shows fewer than 100 draw calls and a stable frame time, and the target is visible inside
    the bando.

- [ ] **11. Launcher, docs and manual flight checklist** (R10.6, R1.1, R1.7, R1.8, R9.1)
  - Write `play.bat` (normal and low-latency profiles) and a `README.md` covering setup, controls, GPU
    selection and troubleshooting.
  - Manual checklist for the user on the target laptop:
    - [ ] The bridge detects the controller, and the overlay shows source = bridge at about 1000 Hz.
    - [ ] Calibration flow completes, and the sticks read ±1 at full deflection.
    - [ ] Arming is refused with throttle high and works with throttle low.
    - [ ] At stick center, the quad roughly holds altitude.
    - [ ] Rolls and flips feel crisp, with no wobble at rest.
    - [ ] Dropping vertically into your own wash causes a visible wobble.
    - [ ] A punch-out shows voltage sag on the OSD.
    - [ ] A light wall tap bounces, and a hard hit crashes; reset works.
    - [ ] Targets appear inside the bando and score when hit.
    - [ ] The overlay shows 59–60 fps with p99 ≤ 17.5 ms at the chosen render scale.

- [ ] **12. Feel pass** (all of R4)
  - Adjust `params.ts` defaults from your fly-test feedback, keeping every test green.
