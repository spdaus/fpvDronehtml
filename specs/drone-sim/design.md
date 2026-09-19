# Design — FPV Drone Simulator (MVP)

Status: **APPROVED — MVP implemented** (implementation deviations are marked *Δ*)
Implements: [requirements.md](requirements.md) · Work breakdown: [tasks.md](tasks.md)

## 1. Architecture

```
 Switch Pro ──USB/BT──► Windows winmm ──► bridge/bridge.py ──SSE /stream──┐
                                         (1 kHz poll thread)              │
                        browser Gamepad API (fallback) ───────────────────┤
                                                                          ▼
 ┌──────────────────────────── browser (one rAF loop) ─────────────────────────────┐
 │ input/  sources → sample ring buffer → calibration → Mode 2 mapping → StickState│
 │ sim/    (pure TS, no DOM)  rates · throttle · PID · mixer · motors · aero ·     │
 │         battery · rigid body · collision            ── 1 kHz fixed step ──►     │
 │ world/  bando + park box lists → colliders (sim) + merged meshes (render)       │
 │ game/   state machine (DISARMED/ARMED/CRASHED) · targets · score                │
 │ render/ WebGL2 renderer · FPV camera · OSD (DOM) · debug overlay                │
 └─────────────────────────────────────────────────────────────────────────────────┘
```

**Stack.** Vite, TypeScript (strict), Three.js (version pinned), Vitest. The bridge uses only the Python
standard library, so there is nothing to pip install. `sim/`, `world/` (the geometry-list part) and
`input/` mapping are pure modules with no DOM or WebGL, so they can be unit tested in Node.

### Directory layout

```
bridge/bridge.py            winmm poller + HTTP server (SSE /stream, /state, static dist/)
bridge/test_bridge.py       unittest: normalisation, packet format
src/main.ts                 bootstrap
src/loop.ts                 frame loop (input → physics substeps → game → render)
src/config.ts               user-facing settings (rates, camera, deadzone…) + persistence
src/input/{bridgeSource,gamepadSource,keyboardSource,sampleBuffer,calibration,mapping,bindings}.ts
src/sim/{math,params,rates,throttle,pid,mixer,motors,aero,battery,collision,drone}.ts
src/world/{boxes,bando,park,colliders,targets}.ts
src/game/{state,targetGame}.ts
src/render/{renderer,scene,materials,fpvCamera,osd,debugOverlay,dynamicResolution}.ts
src/ui/calibrationScreen.ts
tests/*.test.ts             Vitest (one file per module; test names carry R-ids)
tests/perf.test.ts          physics throughput gate (`npm run bench`) — *Δ Vitest 5 dropped `bench()`*
play.bat                    launcher
```

## 2. Coordinate frames and sign conventions

The simulation uses **Three.js's own frame**, so no conversion is needed at the render boundary.

| Frame | +X | +Y | −Z |
|---|---|---|---|
| World | east | up | north ("forward" at spawn) |
| Body | right | up (thrust axis) | nose (forward) |

- Attitude is a unit quaternion `q` (body → world). Angular velocity `ω` is kept in the **body** frame.
- Positive rotation about +X raises the nose, so **pitch rate `ω_x`** is positive when the nose goes up.
- **Roll right** is a negative rotation about +Z (the right arm drops), so roll right is `ω_z < 0`.
- **Yaw right** is a negative rotation about +Y (the nose swings right), so yaw right is `ω_y < 0`.
- The sticks (after mapping) use this convention: `roll` +1 = right, `pitch` +1 = forward (nose down),
  `yaw` +1 = right, `throttle` 0…1. The rate setpoint is therefore:
  `ω_sp = ( −rate(pitch), −rate(yaw), −rate(roll) )`.

**Motor layout (quad-X).** Arm offset `a = 0.0795 m` on each axis (225 mm wheelbase); spin direction is
viewed from above.

| # | Position (x, z) | Spin | Roll sign `sgn(x)` | Pitch sign `sgn(−z)` | Yaw sign `−s` |
|---|---|---|---|---|---|
| FR | (+a, −a) | CCW (s = +1) | + | + | − |
| FL | (−a, −a) | CW (s = −1) | − | + | + |
| RR | (+a, +a) | CW (s = −1) | + | − | + |
| RL | (−a, +a) | CCW (s = +1) | − | − | − |

A motor at `(x, 0, z)` producing thrust `T` along body +Y creates torque `(−zT, 0, xT)`. Its reaction
(drag) torque about +Y is `−s·Q`.

## 3. Input pipeline (R1, R10)

### 3.1 Bridge (`bridge/bridge.py`)

- **Poll thread.** It calls `timeBeginPeriod(1)`, then loops at 1 kHz (`time.sleep(0.001)`; Python ≥3.11
  uses high-resolution waitable timers on Windows) calling `joyGetPosEx` (the code comes from
  `pro controller setup test/controller-bridge.py`).
  - While disconnected, it rescans joystick ids 0–15 once per second instead of hammering missing ids.
  - When the state changes, it bumps `seq`, stores the packet, and wakes all waiting clients with
    `threading.Condition.notify_all()`.
- **`GET /stream`** is Server-Sent Events: `Content-Type: text/event-stream` with `TCP_NODELAY` set on the
  socket.
  - Each change is sent as `data:{"s":seq,"t":bridge_ms,"c":1,"a":[X,Y,Z,R,U,V],"b":buttons_bitmask,"p":pov_or_-1}\n\n`,
    followed by an immediate flush. *Δ All six winmm axes are sent; Z and V are unused on this
    controller and rest at −1.*
  - A heartbeat goes out every 250 ms as a named event (`event:hb`). *Δ Not an SSE comment:
    `EventSource` never surfaces comments, so the page couldn't use them for link health.* When the
    controller is absent it sends `data:{"s":seq,"c":0}`.
  - *Δ The bridge listens on **port 8777**, bound with `SO_EXCLUSIVEADDRUSE`. The prototype bridge
    uses 8765, and Windows' `SO_REUSEADDR` let two servers silently share that port.*
  - `POST /quit` (header `X-FPV: quit`) stops the bridge. The title screen's Exit uses it.
  - `--launch [--low-latency] [--windowed]` opens the game in Chrome/Edge (see §12).
- **`GET /state`** returns the same JSON once. It is kept for tools and debugging.
- **`GET /*`** serves `dist/`, with `index.html` as the fallback. Everything is sent with `Cache-Control: no-store`.
- Axis normalisation is `(v − 32767.5) / 32767.5`, rounded to 4 decimal places. Axis order is
  `[X, Y, Z, R, U, V]`; on this controller the right stick reports X on U (4) and Y on R (3), and the
  calibration step learns that anyway. Measured over Bluetooth, the controller reports about every
  15 ms (≈66 Hz), and the right stick rests at about −0.13 on R, which is why centre calibration is
  mandatory.

### 3.2 Browser sources

| Source | Mechanism | Sample timestamp |
|---|---|---|
| `bridgeSource` | `EventSource('/stream')`; `onmessage` parses and pushes into the sample ring buffer | `performance.now()` on arrival |
| `gamepadSource` | `navigator.getGamepads()` polled at the top of each frame; handles `mapping === 'standard'` and the non-standard layout seen in testing (hat switch on axis 9: `dir = round((h+1)·3.5)`, neutral ≈ 1.29) | poll time |
| `keyboardSource` | debug only (R1.8) | event time |

Source selection is automatic: use the bridge if it has delivered a packet in the last 1 s, otherwise the
Gamepad API. The active source is shown in the debug overlay.

### 3.3 Sample ring buffer (R10.3)

This is a fixed-capacity (128) buffer of `Float32Array` slots holding `{time, axes[6], buttons, pov}`; it
never allocates after start-up. Each physics substep at simulated wall-time `t_k` uses the **newest sample
with `time ≤ t_k`**, so samples that arrive mid-frame are spread across the substeps (see §6). Buttons are
edge-detected once per frame, not per substep.

### 3.4 Calibration and mapping (R1.2–R1.6)

For each raw axis `i`, the calibration stores `{center, min, max}`. The mapped value is:

```
d = raw − center
n = d ≥ 0 ? d / (max − center) : d / (center − min)      // asymmetric, R1.4
n = clamp(n, −1, 1)
out = |n| < dz ? 0 : sign(n)·(|n| − dz)/(1 − dz)          // continuous deadzone, R1.5
```

**Channel assignment.** Each of `throttle`, `yaw`, `pitch` and `roll` has `{axis, invert}`. The throttle
stick value `s = (out+1)/2 ∈ [0,1]` goes into the throttle curve (§4.2).

**Calibration flow** (`ui/calibrationScreen.ts`), opened with − or on first run:
1. "Rotate both sticks in full circles" records min and max.
2. "Let go" records center (averaged over 0.5 s).
3. "Push the throttle stick up", "yaw right", "pitch forward", "roll right": each step picks the axis with
   the largest deviation and records its sign.
4. Optionally, "press the button for ARM / RESET".

Everything is saved to `localStorage["fpvsim.calib.<source>"]`.

**Defaults** (no saved calibration):
- Bridge: throttle = axis 1 inverted, yaw = 0, pitch = 3 inverted, roll = 4.
- Standard gamepad: 1 inverted, 0, 3 inverted, 2.
- Center 0, range ±1 on every axis.

**Buttons** (winmm and standard mapping share the order B0 A1 Y2 X3 L4 R5 ZL6 ZR7 −8 +9 LS10 RS11). The
D-pad reads from the POV hat (bridge), from buttons 12–15 (standard mapping), or from hat axis 9
(non-standard mapping).

### 3.5 Failsafe (R1.9)

If no sample arrives for more than 100 ms while armed, or the source reports it is disconnected, the
system:
- holds the sticks centered, with throttle at `s = 0.5` (hover);
- disarms after 0.5 s;
- shows "FAILSAFE" on the OSD.

## 4. Flight control (R2, R3, R4.4, R4.6)

### 4.1 Rates (R3). Betaflight "Betaflight" rates type, per axis

```
x   = stick ∈ [−1,1],  ax = |x|
if expo > 0:  x = x·ax³·expo + x·(1 − expo)
rc  = rcRate; if rc > 2: rc += 14.54·(rc − 2)
deg = 200·rc·x
if superRate > 0: deg *= 1 / clamp(1 − ax·superRate, 0.01, 1)
rate = clamp(deg, −1998, 1998) · π/180    [rad/s]
```

With the defaults (1.0 / 0.70 / 0.0), a full stick gives `200 / 0.3 = 666.7 °/s`.

### 4.2 Throttle curve (R2). Hover-pivoted Betaflight-style expo

```
x      = 2s − 1                         // stick s ∈ [0,1], center → 0
shaped = x·(1 − e + e·x²)               // e = thrExpo (default 0.3); monotonic for e ∈ [0,1]
thr    = shaped ≥ 0 ? h + shaped·(1 − h) : h + shaped·h
```

`h` is the hover throttle (§5.7). This gives `thr(0) = 0`, `thr(0.5) = h` and `thr(1) = 1`.

### 4.3 Rate PID (R4.4)

The controller runs every physics step (1 kHz) on each axis. The error is `e = ω_sp − ω_gyro`, and the
output is a normalised torque command `u ∈ [−1,1]`:

```
P  = Kp·e
I  = clamp(I + Ki·e·dt·relax, ±Imax) (I-term relax: relax = 0 while |ω_sp − LPF_10Hz(ω_sp)| > 0.5 rad/s, i.e. during fast stick moves, else 1)
D  = −Kd·LPF_D(dω_gyro/dt)            (derivative on measurement, PT1 @ 100 Hz)
F  = Kff·LPF_F(dω_sp/dt)              (feed-forward on setpoint derivative, PT1 @ 40 Hz)
u  = clamp(P + I + D + F, −1, 1)
```

- The setpoint first passes an RC-smoothing PT1 at 60 Hz, which adds about 2.7 ms of delay.
- On the ground and while disarmed, `I` is held at 0.
- The initial gains come from the plant model. The roll plant gain near hover is about 570 rad/s² per unit
  command, with motor lag τ = 30 ms. We aim for a crossover near 30 rad/s, which gives
  `Kp ≈ 0.05, Ki ≈ 0.25, Kd ≈ 0.0006, Kff ≈ 0.0015` for roll and pitch, and yaw at about 2× P and 0 D.
- Task 10 tunes these against the R4.4/R4.5 tests. The gains live in `params.ts`.

### 4.4 Mixer with airmode (R4.6)

```
mix_i = 0.5·( u_roll·Rsgn_i + u_pitch·Psgn_i + u_yaw·Ysgn_i )     // signs from §2 table; u_roll acts on −Z torque etc.
range = max(mix) − min(mix)
if range > 1: mix *= 1/range                                        // keep attitude authority over throttle
t = clamp(thr, −min(mix), 1 − max(mix))                             // airmode: shift throttle to fit
cmd_i = idle + (1 − idle)·(t + mix_i)                               // idle = 0.05 (DShot idle)
```

The roll and pitch commands map onto torque axes as follows:
- The PID outputs `u_x`, `u_y` and `u_z` are **torque** commands about body X, Y and Z.
- `mix_i = 0.5·( u_x·sgn(−z_i) + u_z·sgn(x_i) + u_y·(−s_i) )`.

When disarmed, `cmd_i = 0`, meaning the motors are stopped.

## 5. Physics (R4)

### 5.1 Integration

The integrator is **semi-implicit Euler** at `dt = 0.001 s`:

```
v  += (F_world / m + g) · dt
p  += v · dt
ω  += I⁻¹ · (τ − ω × (I·ω)) · dt           // body frame, diagonal inertia
q  += 0.5 · q ⊗ (0, ω) · dt ; normalize(q)
```

All vectors and quaternions are preallocated module-level temporaries, so the loop has zero allocations
(R9.5). Randomness comes from a seeded PRNG (mulberry32) stored in the drone state, which keeps the
simulation deterministic (R4.2).

### 5.2 Default parameters (`params.ts`, preset `freestyle5`) (R4.3)

| Symbol | Value | Notes |
|---|---|---|
| m | 0.650 kg | all-up weight, 6S 1300 mAh |
| I | diag(0.0028, 0.0045, 0.0026) kg·m² | x (pitch), y (yaw), z (roll) |
| a | 0.0795 m | arm offset per axis |
| T_max | 12.75 N per motor | 1.3 kgf, at 25.2 V, static; total 51 N gives TWR ≈ 8.0 |
| c_Q | 0.016 m | torque/thrust ratio: Q = c_Q·T |
| J_rotor | 6e-6 kg·m² | prop + bell |
| ω_max | 3140 rad/s | about 30 k rpm at 25.2 V |
| τ_up / τ_down | 0.030 / 0.050 s | motor lag |
| idle | 0.05 | |
| V_0 | 65 m/s | effective zero-thrust axial inflow speed at ω_max (5×4.3" geometric pitch speed ≈ 55 m/s; props keep producing thrust past it) |
| R_prop | 0.0635 m | |
| C_drag (x, y, z) | 0.0085, 0.012, 0.0074 N/(m/s)² | ½ρC_dA per body axis: side, top, front |
| k_rotorDrag | 0.10 N/(m/s) | linear H-force per unit mean ω̂, ⟂ thrust axis |
| k_angDamp | 0.0004 N·m/(rad/s) | aerodynamic rotational damping |
| r_col | 0.12 m | collision sphere |
| e, μ | 0.3, 0.4 | restitution, friction |
| v_crash | 7.0 m/s | normal impact speed threshold |
| Battery | 6S, 1300 mAh, R_int 0.030 Ω, I_max 120 A | |

### 5.3 Motors (R4.7, R4.10)

Each motor's state is its normalised speed `ω̂_i ∈ [0,1]`. The steady-state target is `cmd_i · V/V_ref`,
with `V_ref = 25.2 V` (R4.12).

```
τ      = target > ω̂ ? τ_up : τ_down
ω̂_i   += (target − ω̂_i) · (1 − exp(−dt/τ))
T_i    = T_max · ω̂_i² · k_inflow_i · k_ground · k_wash        (§5.4–5.6)
Q_i    = c_Q · T_i
τ_body += (−z_i·T_i, −s_i·Q_i − s_i·J_rotor·ω_max·dω̂_i/dt, x_i·T_i)
```

### 5.4 Inflow thrust loss (R4.8)

```
v_ax      = dot(v_world, bodyUp)                  // + when moving along thrust direction
k_inflow  = clamp(1 − v_ax / (V_0·ω̂_i), 0, 1.15)   // (ω̂_i ≥ 0.05 guard)
```

When the drone descends (`v_ax < 0`) this factor rises a little above 1. The cap is 1.15, and prop wash
(§5.6) is the separate penalty for that regime.

### 5.5 Aerodynamics (R4.9, R4.13)

```
v_b         = q⁻¹ · v_world                                        // body-frame airspeed (no wind in MVP)
F_drag_b    = −(Cx·|v_bx|·v_bx, Cy·|v_by|·v_by, Cz·|v_bz|·v_bz)
F_rotor_b   = −k_rotorDrag·mean(ω̂)·(v_bx, 0, v_bz)
τ_damp      = −k_angDamp·ω
k_ground    = h < 2R ? 1 / (1 − (R/(4·max(h, R)))²) : 1             // Cheeseman–Bennett, ground plane only
```

**Top-speed check (R4.9).** Lock the attitude at 70° forward tilt, set full throttle, keep gravity on, and
simulate 15 s. Horizontal speed must land in 35–50 m/s, with |vertical speed| < 10 m/s. A hand calculation
with these parameters gives about 40 m/s (144 km/h), which is limited by drag on the top face and by inflow
loss.

### 5.6 Prop wash (R4.11)

```
descent   = −v_ax                                    // axial descent speed into own wash
horiz     = |v_b ⟂ bodyUp|
severity  = smoothstep(2, 6, descent) · (1 − smoothstep(3, 10, horiz)) · mean(ω̂)
k_wash    = 1 − 0.30·severity
τ_wash    = severity · 0.25 N·m · n(t)                // n = 3-axis white noise → PT1 @ 12 Hz, seeded
```

Outside the regime, `severity = 0`, so there is no noise and no thrust loss.

### 5.7 Hover throttle (R2.4)

```
ω̂_h = sqrt( m·g / (4·T_max) )           // at V = V_ref, k_* = 1
h   = (ω̂_h − idle) / (1 − idle)
```

For the default airframe this gives `ω̂_h ≈ 0.354` and `h ≈ 0.320`.

### 5.8 Battery (R4.12)

```
I_draw  = I_max · mean(ω̂_i^2.5) + 0.5 A
V_oc    = 6 · ocv(SoC)       // per-cell LUT: 100%→4.20, 80%→4.00, 50%→3.85, 20%→3.73, 5%→3.55, 0%→3.30
V       = V_oc − I_draw·R_int
SoC    −= I_draw·dt / (capacity·3.6)
```

With these values the pack gives about 9 A at hover and about 3.6 V of sag at full punch.

## 6. Frame loop (R4.1, R10)

```
onFrame(now):
  input.pollFrameSources(now)              // gamepad poll; bridge samples already queued
  buttons.detectEdges(); game.handleActions()
  acc += min(now − last, 50 ms); last = now          // clamp: a stall of more than 50 ms is dropped, not replayed
  n = floor(acc / 1 ms)
  for k in 1..n:                                     // substep k corresponds to wall time t_k = now − acc + k·1 ms
     sticks = mapping(sampleBuffer.at(t_k))          // R10.3
     drone.step(sticks, 1 ms); collide(); targetGame.check()
  acc −= n·1 ms
  camera.syncFrom(drone); osd.update(now); renderer.render()
```

There is no interpolation between physics states: at 1 kHz the rendered state is ≤ 1 ms old.

## 7. Collision (R5)

- **Colliders.** These are `AABB{min,max}`, `VCylinder{x,z,r,y0,y1}` and `Sphere{c,r}`, plus the ground plane
  `y = 0`. They are stored in flat typed arrays.
- **Broadphase.** A uniform XZ grid with 4 m cells lists the collider indices per cell. The query covers the
  3×3 neighbourhood around the drone.
- **Narrowphase.** Each substep finds the closest point on the collider to the sphere center. On penetration:
  - `n` = the separation normal, `depth` = r − distance, and the drone is pushed out along `n` by `depth`.
  - `vn = dot(v, n)`. If `vn < 0`:
    - `impact = −vn`
    - `v −= (1+e)·vn·n`, and tangential friction `v_t *= max(0, 1 − μ·impact/|v_t|)`.
    - Angular jolt: `ω += I⁻¹·(r_c × J)·k`, where `r_c = −n·r_col` and `k = 0.5`.
    - If `impact ≥ v_crash`, the drone becomes CRASHED (R5.4).
- **No tunneling (R5.2).** At 40 m/s the drone moves 4 cm per step. The thinnest collider is 0.1 m, so the
  penetration window (0.24 m sphere diameter + 0.1 m) is at least 8× the step, and the MVP needs no swept
  test.
- **World bounds.** The world is enclosed by invisible AABB walls at ±200 m and a ceiling at 120 m.

## 8. World (R6)

- **`boxes.ts`.** This file provides `Box{min,max,color,kind}` and a `wallWithOpenings(axis, from, to, y0,
  height, thickness, openings[])` helper. The helper splits a wall into solid boxes around rectangular holes,
  so openings are exact.
- **`bando.ts`.** It builds a deterministic box list for a 30 × 18 m footprint:
  - 3 storeys of 3.5 m, 0.3 m slabs, and 0.3 m walls. There are 1.6 × 1.4 m windows every 4 m, doors
    1.2 × 2.2 m on the ground floor, and one 8 m missing section on the east wall of floor 2.
  - Each slab has a 3 × 3 m floor hole, and there is a 2.4 × 5 m stairwell gap through every slab.
  - A roof slab has a 4 × 4 m hole. There are 0.5 × 0.5 m pillars on a 6 m grid and interior partition walls
    with 1.2 m doorways.
  - The same list supplies both the render mesh and the AABB colliders (R6.3).
- **Interior spawn volumes.** These are one AABB per floor, the interior footprint shrunk by 0.6 m, from the
  slab top + 0.6 m to the slab above − 0.6 m (R7.1).
- **`park.ts`** contains:
  - a 400 × 400 m ground with a procedural grass or dirt canvas texture (1024², mipmapped, anisotropy 4).
    The texture detail matters for speed perception in FPV.
  - 150 trees placed with seeded Poisson-disk sampling, kept out of the bando area and away from the pad.
    Each tree is a cylinder trunk plus a cone canopy, drawn as InstancedMeshes, with colliders being a
    VCylinder trunk and a Sphere canopy.
  - 6 shipping containers (AABBs) arranged to form a gap.
  - a 1.5 m launch pad 25 m south of the bando, facing it.

## 9. Rendering (R8, R9, R10.4)

- **Context.** Created manually with `canvas.getContext('webgl2', {antialias:false, alpha:false, depth:true,
  stencil:false, desynchronized:true, powerPreference:'high-performance', preserveDrawingBuffer:false})`
  and passed to `new WebGLRenderer({canvas, context})`.
- **Resolution.** The canvas is sized in CSS to fill the window. The drawing buffer is set explicitly to the
  internal resolution: 1280×720 at `scale = 1`, fitted to the window's aspect, with `pixelRatio` 1.
- **Materials.** `MeshLambertMaterial` with vertex colours. There are no realtime shadows. Fake AO comes from
  per-box vertex-colour darkening near the floor. The scene uses a hemisphere light plus a directional light,
  linear fog (the far plane is 300 m, so fog hides the pop), and a sky from `scene.background` plus the fog
  colour.
- **Draw calls.**

  | Object | Calls |
  |---|---|
  | Merged bando | 1 |
  | Merged containers + pad | 1 |
  | Ground | 1 |
  | Trees (2 InstancedMeshes) | 2 |
  | Target (sphere + additive halo) | 2 |
  | **Total** | **≈ 7** |
- **Dynamic resolution (R9.2).**
  - The controller watches the average frame interval over 30 frames. If it exceeds 17.5 ms, scale drops by
    0.1, to no lower than 0.5. If 180 consecutive frames run under 16.9 ms, scale rises by 0.05, to no more
    than 1.0.
  - After any change there is a hysteresis cool-down of 2 s.
- **FPV camera (R8.1–R8.2).**
  - The camera is a child transform of the drone at body offset `(0, 0.02, −0.06)`, rotated about body X
    by +uptilt.
  - `PerspectiveCamera.fov` (vertical) is `2·atan(tan(hfov/2)/aspect)`, with near 0.05 and far 300.
- **OSD (R8.3–R8.4).** An absolutely positioned DOM layer uses monospace text in a Betaflight-like layout.
  - Text is written through cached `textContent` nodes, and only when the value changes, at up to 20 Hz.
  - The chevron and bracket move by `transform` only, every frame, with no layout reads.
- **Debug overlay (R10.5).**
  - It is toggled with X or F3.
  - Its stats come from ring buffers of the last 240 frame intervals (avg, p99), and it reads
    `renderer.info.render.calls`.

## 10. Game layer (R5.5, R7)

**States.**

```
DISARMED ──arm (throttle s < 0.05)──► ARMED ──disarm──► DISARMED
    ▲                                    │
    └────────── reset ◄── CRASHED ◄──impact ≥ v_crash
```

- Reset works from any state.
- If the pilot tries to arm with throttle high, the OSD shows "THROTTLE LOW TO ARM" for 1.5 s.

**Targets.**
- Spawning picks a volume weighted by its volume, then a uniform point inside it. The candidate is rejected
  if the sphere of radius `0.5 + 0.3` hits any collider, or if it lies within 5 m of the previous target.
  Up to 200 attempts are made; after that, the center of a random volume is used (tested so this never
  happens with the shipped map).
- A hit means `|p_drone − p_target| < 0.5 + r_col`.
- The PRNG is seeded from the time at start-up and can be injected in tests.

## 11. Performance budget (R9)

| Stage | Budget per frame (60 fps) |
|---|---|
| Input + mapping | < 0.1 ms |
| Physics 17 × 1 ms steps (incl. collision) | < 1.5 ms |
| Game + camera + OSD | < 0.3 ms |
| Three.js scene traversal + submit | < 2 ms |
| GPU (720p, ~7 draw calls, ~60 k tris) | < 10 ms |
| **Headroom** | ≥ 3 ms |

## 12. Latency budget (R10)

| Stage | Typical |
|---|---|
| Controller → Windows (BT / USB) | 4–15 ms (hardware, outside our control) |
| winmm poll (1 kHz) | ≤ 1 ms |
| SSE over loopback, `TCP_NODELAY` | < 1 ms |
| Wait for next frame | 0–16.7 ms (avg 8.3) |
| Physics + render submit | ~4 ms |
| Compositor + scan-out (vsync) | 16–33 ms; lower with `desynchronized` and the low-latency profile |

`play.bat` runs `python bridge/bridge.py --launch`. The bridge starts listening first, then opens
Chrome (or Edge) with:
- `--app=http://localhost:8777/`
- `--user-data-dir=.chrome-profile`: a separate process, so the flags apply even with Chrome already
  open, and a one-entry history so `window.close()` works for Exit.
- `--force_high_performance_gpu` and `--start-fullscreen`.

`play.bat lowlatency` adds `--disable-gpu-vsync --disable-frame-rate-limit`, which may tear. *Δ The
bridge launches the browser instead of the batch file doing it, so the page never loads before the
server is up.*

**Measured on the target laptop** (in-app browser, ANGLE D3D11 on the GT 750M):
- Render plus a forced GPU finish at 1280×720: p50 1.3–4.8 ms, p95 ≤ 7.5 ms.
- 7 draw calls, 22 k triangles.
- Physics: 0.04 ms per frame (Node), 0.11 ms in the browser.

## 13. Traceability: requirement → verification

| Req | Verified by |
|---|---|
| R1.2, R1.4, R1.5 | `tests/mapping.test.ts` |
| R1.3, R1.6 | `tests/calibration.test.ts` (fit from recorded samples; persistence round-trip with a fake storage) |
| R1.9 | `tests/failsafe.test.ts` |
| R2.1–R2.4 | `tests/throttle.test.ts` |
| R2.5 | `tests/flight.test.ts › hover at center stick` |
| R3.1–R3.3 | `tests/rates.test.ts` (table of Betaflight reference values) |
| R3.4 | `tests/flight.test.ts › attitude hold with centered sticks` |
| R4.1, R4.2 | `tests/drone.test.ts › fixed step, determinism` |
| R4.4, R4.5 | `tests/flight.test.ts › roll step response, flip time` |
| R4.6 | `tests/mixer.test.ts › airmode authority at zero throttle` |
| R4.7, R4.10 | `tests/motors.test.ts` |
| R4.8, R4.9, R4.13 | `tests/aero.test.ts` |
| R4.11 | `tests/propwash.test.ts` |
| R4.12 | `tests/battery.test.ts` |
| R5.1–R5.5 | `tests/collision.test.ts`, `tests/game.test.ts` |
| R6.3, R6.5 | `tests/world.test.ts` |
| R7.1–R7.3, R7.6 | `tests/targets.test.ts` (1000 seeded spawns) |
| R9.2 | `tests/dynamicResolution.test.ts` |
| R9.4 | `tests/perf.test.ts` (60 s sim < 3 s; `npm run bench` prints ms/frame) |
| R10.1 | `bridge/test_bridge.py` |
| R10.3 | `tests/sampleBuffer.test.ts` |
| R1.1, R1.7, R1.8, R6.1–R6.4, R7.4–R7.5, R8, R9.1, R9.3, R9.5, R10.2, R10.4–R10.6 | browser check + manual flight checklist (tasks.md, Task 11) |
