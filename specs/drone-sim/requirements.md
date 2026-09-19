# Requirements — FPV Drone Simulator (MVP)

Status: **DRAFT — awaiting review**
Companion docs: [design.md](design.md) · [tasks.md](tasks.md)

## Purpose

A realistic FPV (first-person-view) acro drone simulator, flown with a Nintendo Switch Pro Controller on a
Windows laptop. Realism of the flight model and low input-to-photon latency are the top priorities; the
game layer is deliberately small: one freestyle map with an abandoned building ("bando") and a target that
appears at a random spot inside it.

## Target platform

| Item | Value |
|---|---|
| Machine | Windows 10 laptop, NVIDIA GeForce GT 750M (+ Intel HD 4600), 4K display @ 59 Hz |
| Runtime | Chromium-based browser (Chrome/Edge), WebGL2 |
| Controller | Switch Pro Controller, read via Windows winmm (bridge) or the browser Gamepad API |

## Conventions

Criteria use EARS phrasing: *ubiquitous* ("The system shall…"), *event* ("When…, the system shall…"),
*state* ("While…, the system shall…"), and *unwanted* ("If…, then the system shall…").
Each criterion has an ID (`R<n>.<m>`). Tests and tasks reference these IDs.
**[T]** marks a criterion that must be covered by an automated test; **[M]** marks one that is verified
manually or in the browser.

## Out of scope for the MVP

Race gates and lap timing, in-game rate/tuning UI, angle/horizon (self-level) modes, multiple quad presets
in the UI, replays and DVR, sound, wind, multiplayer, mobile support, and analog video effects (static, breakup).
The design must not block adding them later.

---

## R1 — Controller input

**User story:** As a pilot, I want to fly with my Switch Pro Controller using standard Mode 2 sticks so my
muscle memory matches a real radio.

- **R1.1** The system shall read controller state from the local bridge (winmm) when it is reachable, and
  otherwise fall back to the browser Gamepad API. **[M]**
- **R1.2** The system shall map the sticks as Mode 2: left stick vertical is throttle, left stick horizontal
  is yaw, right stick vertical is pitch, right stick horizontal is roll. **[T]**
- **R1.3** The system shall provide a calibration flow that records each axis's center, minimum and maximum,
  and learns which physical axis (and sign) drives throttle, yaw, pitch and roll. **[T]** (math) **[M]** (flow)
- **R1.4** The system shall normalise each calibrated axis so that full physical deflection gives exactly ±1
  and rest gives 0, with an asymmetric scale on each side of center. **[T]**
- **R1.5** The system shall apply a deadzone of 0.03 (configurable) around center and rescale beyond it, so
  output stays continuous (no step at the deadzone edge). **[T]**
- **R1.6** The system shall persist calibration and bindings in localStorage per input source, and shall
  load built-in defaults when none are saved. **[T]**
- **R1.7** The system shall support these actions, bound by default as follows, with rebinding in the
  calibration flow: **[M]**

  | Action | Default |
  |---|---|
  | Arm / disarm (toggle) | ZR |
  | Reset to launch pad | ZL or B |
  | Camera uptilt +5° / −5° | D-pad up / down |
  | Pause / menu | + |
  | Calibrate | − |
  | Toggle the debug overlay | X |
- **R1.8** When no controller is connected, the system shall show a clear "No controller" message, and shall
  offer keyboard controls for debugging (not intended as a way to fly). **[M]**
- **R1.9** If the controller disconnects in flight, then the system shall treat sticks as centered and
  throttle as hover-neutral for 0.5 s, and then disarm (failsafe). **[T]**

## R2 — Throttle ("center = hover")

**User story:** As a pilot using a self-centering stick, I want stick center to hold roughly level
altitude, so releasing the stick doesn't send the quad to the moon or the floor.

- **R2.1** The throttle curve shall map stick center to the quad's hover throttle, full down to 0 and full
  up to 1. **[T]**
- **R2.2** The throttle curve shall be continuous and monotonically non-decreasing. **[T]**
- **R2.3** The throttle curve shall support an expo parameter (default 0.3) that flattens the curve around
  hover for finer altitude control. **[T]**
- **R2.4** The hover throttle shall be derived from the quad's physical parameters (mass, max thrust, motor
  idle) at full-charge voltage, not hard-coded. **[T]**
- **R2.5** While the quad is armed, level, and in free air at full charge, with the throttle stick centered
  and the motors settled, the magnitude of its vertical acceleration shall be ≤ 0.3 m/s². **[T]**

## R3 — Acro rates

**User story:** As a pilot used to Betaflight, I want the same rate math so my rates feel familiar.

- **R3.1** The system shall convert stick deflection to a body-rate setpoint with the Betaflight rate formula
  ("Betaflight" rates type: RC rate, super rate, RC expo), per axis. **[T]**
- **R3.2** Default rates shall be RC rate 1.0, super rate 0.70 and expo 0.0 on all axes (max ≈ 667°/s).
  **[T]**
- **R3.3** Computed rates shall match the Betaflight reference formula within 1% across the stick range.
  **[T]**
- **R3.4** The system shall always fly in acro (rate) mode: centered sticks hold the current attitude, and
  there is no self-levelling. **[T]**

## R4 — Flight dynamics realism

**User story:** As a pilot, I want the quad to carry momentum, spool, sag and wash out like a real 5"
freestyle quad.

- **R4.1** The physics shall run at a fixed step of 1 ms (1 kHz), independent of frame rate. **[T]**
- **R4.2** The simulation shall be deterministic: identical initial state and input sequence produce
  bit-identical state. **[T]**
- **R4.3** The default airframe shall model a 5" freestyle quad: about 650 g all-up weight, a
  thrust-to-weight ratio of about 8:1, and a 6S battery. All values live in one parameter file. **[T]**
- **R4.4** A rate PID controller with feed-forward shall track the setpoint. After a full-stick roll step
  from hover, measured roll rate shall reach 90% of the setpoint within 80 ms, with overshoot ≤ 15%. **[T]**
- **R4.5** A full-stick roll from level shall complete a 360° flip in 0.55–0.75 s (including spool-up).
  **[T]**
- **R4.6** Airmode shall keep full attitude authority at zero throttle: at zero throttle, a full roll
  command shall still produce ≥ 50% of the full-throttle roll acceleration. **[T]**
- **R4.7** Each motor shall be modelled as a first-order lag toward its commanded speed, spinning up faster
  (τ ≈ 30 ms) than it spins down (τ ≈ 50 ms). Thrust shall be ∝ ω². **[T]**
- **R4.8** Thrust shall fall as axial inflow speed through the props rises (climbing or diving fast along
  the thrust axis). **[T]**
- **R4.9** Body drag shall be quadratic in airspeed and differ between the top, front and side faces. Top
  speed in a full-throttle dive-free sprint shall be about 35–50 m/s. **[T]**
- **R4.10** Motor reaction torque and spin-acceleration torque shall act on the yaw axis. A sudden throttle
  punch shall produce a small yaw kick that the controller corrects. **[T]**
- **R4.11** While descending into its own prop wash (axial descent above about 2 m/s with low horizontal
  speed), the quad shall experience a random torque disturbance and a thrust loss that grow with severity.
  Outside that regime there shall be none. **[T]**
- **R4.12** Battery voltage shall sag with current draw (internal resistance) and fall with capacity used,
  reducing available thrust. Reset shall restore a full pack. **[T]**
- **R4.13** Near the ground plane, the quad shall get a small ground-effect thrust increase. **[T]**

## R5 — Collisions and crashes

**User story:** As a pilot, I want to bump into things, bounce off lightly, and crash for real on a hard
hit.

- **R5.1** The quad shall collide as a sphere (radius 0.12 m) with the ground and all world colliders
  (boxes, vertical cylinders, spheres). **[T]**
- **R5.2** The quad shall not pass through any collider of thickness ≥ 0.1 m at speeds up to 40 m/s. **[T]**
- **R5.3** When the quad hits something at a normal impact speed below the crash threshold (default 7 m/s),
  it shall bounce (restitution about 0.3, with friction), take an attitude disturbance, and stay armed.
  **[T]**
- **R5.4** When the quad hits something at a normal impact speed at or above the crash threshold, the
  system shall enter the CRASHED state: disarm the motors, keep simulating the body (tumble, fall, settle),
  and show "CRASHED" on the OSD. **[T]**
- **R5.5** When reset is pressed, the system shall place the quad disarmed and level on the launch pad with
  zero velocity, a full battery and a cleared flight timer. **[T]**

## R6 — World

**User story:** As a pilot, I want a freestyle spot with a proper bando to dive, gap and weave through.

- **R6.1** The world shall contain a textured ground plane of at least 400 × 400 m, bounded so the quad
  cannot leave it. **[M]**
- **R6.2** The world shall contain a bando: at least 3 floors plus a roof, with window openings, door
  openings, at least one missing wall section, floor holes, a stairwell gap, interior partition walls and
  pillars. **[M]**
- **R6.3** The bando's render geometry and colliders shall be generated from the same box list, so what you
  see is what you hit. **[T]**
- **R6.4** The world shall contain instanced trees (at least 100) with trunk colliders, a launch pad, and a
  few extra obstacles (for example shipping containers). **[M]**
- **R6.5** Every opening meant to be flown through (windows, doors, floor holes, stairwell) shall be at least
  0.6 m in its smallest dimension. **[T]**

## R7 — Target game

**User story:** As a pilot, I want a reason to fly into the building: find and hit a target that turns up
somewhere inside.

- **R7.1** The system shall spawn one target (sphere, radius 0.5 m) at a uniformly random point inside the
  bando's interior spawn volumes. **[T]**
- **R7.2** A spawned target shall not intersect any collider, with a clearance of at least 0.3 m. **[T]**
- **R7.3** When the quad's sphere touches the target, the system shall add 1 to the score, record the time
  since that target spawned, and spawn a new target at least 5 m from the old one. **[T]**
- **R7.4** The target shall be visually unmistakable (bright, emissive, pulsing) and cost ≤ 2 draw calls.
  **[M]**
- **R7.5** The OSD shall show the score, the last and best time-to-target, the distance to the target, and a
  direction indicator: a bracket when the target is on screen, an edge chevron when it is off screen. **[M]**
- **R7.6** The score shall reset when the quad is reset after a crash. **[T]**

## R8 — FPV camera and OSD

**User story:** As a pilot, I want the view from a real FPV camera, with an OSD like Betaflight's.

- **R8.1** The camera shall be rigidly attached to the quad (no smoothing or stabilisation), slightly ahead of
  center, tilted up by a configurable angle (default 30°, range 0–60°, D-pad adjusts in 5° steps). **[M]**
- **R8.2** The horizontal FOV shall be configurable (default 110°). **[M]**
- **R8.3** The OSD shall show battery voltage, throttle %, flight timer (running while armed), speed (km/h),
  altitude (m), a center crosshair, and state warnings: DISARMED, "THROTTLE LOW TO ARM", CRASHED, and
  "NO CONTROLLER". **[M]**
- **R8.4** The OSD's text elements shall update at no more than 20 Hz. Transform-only elements (the chevron)
  may update every frame. **[M]**

## R9 — Performance

**User story:** As a pilot on an older laptop, I want a locked, smooth frame rate, because stutter ruins FPV.

- **R9.1** On the target laptop, the game shall hold 59–60 fps with a 99th-percentile frame time ≤ 17.5 ms
  during normal flight. **[M]**
- **R9.2** The internal render resolution shall be at most 1280 × 720 (matching FPV goggle resolution),
  upscaled to the window. A dynamic resolution controller shall lower it (to no less than 640 × 360) when
  frames run long, and raise it when there is headroom. **[M]** (behaviour) **[T]** (controller logic)
- **R9.3** A frame shall use fewer than 100 draw calls. **[M]** (via the debug overlay)
- **R9.4** The physics shall use ≤ 1.5 ms of CPU per 16.7 ms frame (≤ 9% of real time) on the target
  laptop. The Node benchmark shall show 60 s of sim time taking < 3 s. **[T]**
- **R9.5** The per-frame hot path (input, physics, collision, camera sync, OSD) shall allocate no objects in
  steady state. **[M]** (checked with a DevTools allocation profile)

## R10 — Latency

**User story:** As a pilot, I want stick movements to show on screen as fast as the hardware allows.

- **R10.1** The bridge shall sample the controller at ≥ 500 Hz (target 1 kHz) and push changes to the
  browser immediately (streamed, not polled), with Nagle's algorithm disabled. **[T]** (format) **[M]** (rate)
- **R10.2** Each frame shall consume the newest input sample immediately before stepping physics, and render
  immediately after. No stage shall add a frame of buffering. **[M]**
- **R10.3** Input samples received during a frame shall be applied to the physics substeps matching their
  arrival times, rather than all at once at the frame boundary. **[T]**
- **R10.4** The WebGL context shall be created with low-latency hints (`desynchronized`, no MSAA,
  high-performance GPU preference). **[M]**
- **R10.5** The debug overlay shall show fps, average and p99 frame time, physics ms per frame, input source,
  input sample rate, input age (ms since the newest sample arrived), render resolution and draw calls. **[M]**
- **R10.6** The project shall provide a launcher (`play.bat`) that starts the bridge and opens the game in a
  Chrome app window. It shall also offer an optional low-latency profile that disables vsync and the frame
  rate limit. **[M]**
