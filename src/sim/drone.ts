import { CELL_FULL_V, cellOcv } from './battery';
import { GRAVITY, clamp, mulberryStep, mulberryValue, pt1Alpha, smoothstep } from './math';
import { mixAirmode } from './mixer';
import { MOTOR_SPIN, MOTOR_SX, MOTOR_SZ, type QuadParams } from './params';
import { RateController } from './pid';
import { DEFAULT_RATES, rateRad, type Rates } from './rates';
import { throttleCurve } from './throttle';

/** Pilot input after calibration and mapping: throttle stick 0..1 (0.5 = centre), others −1..1. */
export interface StickInput {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface FlightSettings {
  rates: Rates;
  /** Throttle expo around hover, 0..1. */
  thrExpo: number;
}

export const DEFAULT_FLIGHT: FlightSettings = { rates: DEFAULT_RATES, thrExpo: 0.3 };

export const PHYSICS_DT = 0.001;

/** White noise → PT1 has std ≈ sqrt(α / (2 − α)) for unit-variance input; used to normalise wash noise. */
function pt1NoiseStd(alpha: number): number {
  return Math.sqrt(alpha / (2 - alpha));
}

/** Hover throttle (curve output, 0..1) for a full pack in free air (design.md §5.7, R2.4). */
export function hoverThrottle(p: QuadParams): number {
  const scale = (p.motorThrustScale[0] + p.motorThrustScale[1] + p.motorThrustScale[2] + p.motorThrustScale[3]) / 4;
  const wNeed = Math.sqrt((p.mass * GRAVITY) / (4 * p.thrustMax * scale));
  const vRef = p.battery.cells * CELL_FULL_V;
  let cmd = wNeed;
  for (let i = 0; i < 6; i++) {
    const current = p.battery.maxCurrent * wNeed * wNeed * Math.sqrt(wNeed) + p.battery.baseCurrent;
    const v = vRef - current * p.battery.internalResistance;
    cmd = (wNeed * vRef) / v;
  }
  return (cmd - p.idle) / (1 - p.idle);
}

/**
 * Rigid-body quad with flight controller, motors, aero, prop wash and battery (design.md §4–5).
 * Frame: Three.js world (Y up); body x right, y up, −z nose. Fixed step, allocation-free, deterministic.
 */
export class Drone {
  // --- state ---
  px = 0; py = 0; pz = 0;
  vx = 0; vy = 0; vz = 0;
  /** Attitude quaternion, body → world. */
  qw = 1; qx = 0; qy = 0; qz = 0;
  /** Body angular rates, rad/s (x pitch-up, y yaw-left, z roll-left). */
  wx = 0; wy = 0; wz = 0;
  readonly motor = new Float64Array(4);
  readonly motorCmd = new Float64Array(4);
  readonly thrust = new Float64Array(4);
  armed = false;
  soc = 1;
  voltage = 0;
  current = 0;
  mAhUsed = 0;
  /** Throttle curve output of the last step, 0..1. */
  throttleOut = 0;
  washSeverity = 0;
  /** Seconds since the last collision contact (set to 0 by the collision module). */
  sinceContact = 1e9;
  /** Last linear acceleration, m/s² (world). */
  ax = 0; ay = 0; az = 0;

  readonly params: QuadParams;
  readonly ctrl: RateController;
  readonly hover: number;
  readonly dt: number;
  settings: FlightSettings;

  private rng: number;
  private readonly wash = new Float64Array(3);
  private readonly aUp: number;
  private readonly aDown: number;
  private readonly aWash: number;
  private readonly washStd: number;
  private readonly vRef: number;

  constructor(params: QuadParams, settings: FlightSettings = DEFAULT_FLIGHT, seed = 1, dt = PHYSICS_DT) {
    this.params = params;
    this.settings = settings;
    this.dt = dt;
    this.ctrl = new RateController(params, dt);
    this.hover = hoverThrottle(params);
    this.aUp = 1 - Math.exp(-dt / params.tauUp);
    this.aDown = 1 - Math.exp(-dt / params.tauDown);
    this.aWash = pt1Alpha(params.propWash.noiseHz, dt);
    this.washStd = pt1NoiseStd(this.aWash) * Math.sqrt(3); // uniform(−√3, √3) has unit variance
    this.vRef = params.battery.cells * CELL_FULL_V;
    this.rng = seed >>> 0;
    this.reset(0, 0, 0, 0);
  }

  /** Place the quad level at a position facing `yaw` (rad, 0 = −Z), disarmed, full pack. */
  reset(x: number, y: number, z: number, yaw: number): void {
    this.px = x; this.py = y; this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.qw = Math.cos(yaw / 2); this.qx = 0; this.qy = Math.sin(yaw / 2); this.qz = 0;
    this.wx = this.wy = this.wz = 0;
    this.motor.fill(0);
    this.motorCmd.fill(0);
    this.thrust.fill(0);
    this.armed = false;
    this.soc = 1;
    this.current = this.params.battery.baseCurrent;
    this.voltage = this.vRef - this.current * this.params.battery.internalResistance;
    this.mAhUsed = 0;
    this.throttleOut = 0;
    this.washSeverity = 0;
    this.wash.fill(0);
    this.sinceContact = 1e9;
    this.ax = this.ay = this.az = 0;
    this.ctrl.reset();
  }

  arm(): void {
    if (!this.armed) this.ctrl.reset();
    this.armed = true;
  }

  disarm(): void {
    this.armed = false;
  }

  /** Advance the simulation by one fixed step. */
  step(input: StickInput): void {
    const p = this.params;
    const dt = this.dt;
    const arm = p.armOffset;

    // ---- flight controller ----
    this.throttleOut = throttleCurve(input.throttle, this.hover, this.settings.thrExpo);
    if (this.armed) {
      const r = this.settings.rates;
      this.ctrl.update(
        -rateRad(input.pitch, r.pitch),
        -rateRad(input.yaw, r.yaw),
        -rateRad(input.roll, r.roll),
        this.wx, this.wy, this.wz,
        this.sinceContact > 0.05,
      );
      const u = this.ctrl.out;
      mixAirmode(this.throttleOut, u[0], u[1], u[2], p.idle, this.motorCmd);
    } else {
      this.motorCmd.fill(0);
    }

    // ---- attitude as a rotation matrix (world = R · body) ----
    const { qw, qx, qy, qz } = this;
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
    const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
    const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);

    // Body-frame airspeed (no wind in the MVP).
    const vbx = r00 * this.vx + r10 * this.vy + r20 * this.vz;
    const vby = r01 * this.vx + r11 * this.vy + r21 * this.vz;
    const vbz = r02 * this.vx + r12 * this.vy + r22 * this.vz;

    // ---- prop wash (design.md §5.6) ----
    let meanW = (this.motor[0] + this.motor[1] + this.motor[2] + this.motor[3]) / 4;
    const horiz = Math.sqrt(vbx * vbx + vbz * vbz);
    const sev = smoothstep(2, 6, -vby) * (1 - smoothstep(3, 10, horiz)) * Math.min(1, meanW / 0.6);
    this.washSeverity = sev;
    const kWash = 1 - p.propWash.thrustLoss * sev;

    // ---- ground effect (Cheeseman–Bennett, ground plane only) ----
    const R = p.propRadius;
    let kGround = 1;
    if (this.py < 4 * R) {
      const q = R / (4 * Math.max(this.py, R));
      kGround = 1 / (1 - q * q);
    }

    // ---- battery voltage from the previous step's draw ----
    const bat = p.battery;
    this.voltage = bat.cells * cellOcv(this.soc) - this.current * bat.internalResistance;
    const vScale = Math.max(0, this.voltage / this.vRef);

    // ---- motors → thrust and torque (body frame) ----
    let sumT = 0;
    let tx = 0, ty = 0, tz = 0;
    let draw = 0;
    const spinTorqueK = p.rotorInertia * p.omegaMax;
    for (let i = 0; i < 4; i++) {
      const target = this.motorCmd[i] * vScale;
      const w0 = this.motor[i];
      const w = w0 + (target - w0) * (target > w0 ? this.aUp : this.aDown);
      this.motor[i] = w;
      const xi = MOTOR_SX[i] * arm;
      const zi = MOTOR_SZ[i] * arm;
      // Axial inflow at this prop, including the rotation-induced part (ω × r)·ŷ = ωz·x − ωx·z.
      const vLocal = vby + this.wz * xi - this.wx * zi;
      const kIn = w > 0.02 ? clamp(1 - vLocal / (p.inflowZeroSpeed * w), 0, 1.15) : 1;
      const T = p.thrustMax * p.motorThrustScale[i] * w * w * kIn * kGround * kWash;
      this.thrust[i] = T;
      sumT += T;
      tx -= zi * T;
      tz += xi * T;
      ty -= MOTOR_SPIN[i] * (p.torqueRatio * T + (spinTorqueK * (w - w0)) / dt);
      draw += w * w * Math.sqrt(w);
    }
    meanW = (this.motor[0] + this.motor[1] + this.motor[2] + this.motor[3]) / 4;

    this.current = (bat.maxCurrent * draw) / 4 + bat.baseCurrent;
    this.soc = Math.max(0, this.soc - (this.current * dt) / (bat.capacityMah * 3.6));
    this.mAhUsed += (this.current * dt) / 3.6;

    // ---- prop-wash torque noise ----
    if (sev > 0) {
      const amp = (sev * p.propWash.torque) / this.washStd;
      for (let j = 0; j < 3; j++) {
        this.rng = mulberryStep(this.rng);
        const n = (mulberryValue(this.rng) * 2 - 1) * 1.7320508075688772;
        this.wash[j] += this.aWash * (n - this.wash[j]);
      }
      tx += amp * this.wash[0];
      ty += amp * 0.4 * this.wash[1];
      tz += amp * this.wash[2];
    } else {
      this.wash[0] *= 1 - this.aWash;
      this.wash[1] *= 1 - this.aWash;
      this.wash[2] *= 1 - this.aWash;
    }

    // ---- forces (body) → world ----
    const rd = p.rotorDrag * meanW;
    const fbx = -p.drag.x * Math.abs(vbx) * vbx - rd * vbx;
    const fby = -p.drag.y * Math.abs(vby) * vby + sumT;
    const fbz = -p.drag.z * Math.abs(vbz) * vbz - rd * vbz;
    const invM = 1 / p.mass;
    this.ax = (r00 * fbx + r01 * fby + r02 * fbz) * invM;
    this.ay = (r10 * fbx + r11 * fby + r12 * fbz) * invM - GRAVITY;
    this.az = (r20 * fbx + r21 * fby + r22 * fbz) * invM;

    // Semi-implicit Euler.
    this.vx += this.ax * dt; this.vy += this.ay * dt; this.vz += this.az * dt;
    this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;

    // ---- rotational dynamics (body frame) ----
    const I = p.inertia;
    const { wx, wy, wz } = this;
    tx -= p.angularDamping * wx;
    ty -= p.angularDamping * wy;
    tz -= p.angularDamping * wz;
    const hx = I.x * wx, hy = I.y * wy, hz = I.z * wz;
    this.wx += ((tx - (wy * hz - wz * hy)) / I.x) * dt;
    this.wy += ((ty - (wz * hx - wx * hz)) / I.y) * dt;
    this.wz += ((tz - (wx * hy - wy * hx)) / I.z) * dt;
    this.integrateAttitude(dt);

    this.sinceContact += dt;
  }

  /** q += ½ q ⊗ (0, ω) dt, then renormalise. */
  integrateAttitude(dt: number): void {
    const { qw, qx, qy, qz, wx, wy, wz } = this;
    const h = 0.5 * dt;
    const nw = qw + h * (-qx * wx - qy * wy - qz * wz);
    const nx = qx + h * (qw * wx + qy * wz - qz * wy);
    const ny = qy + h * (qw * wy + qz * wx - qx * wz);
    const nz = qz + h * (qw * wz + qx * wy - qy * wx);
    const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
    this.qw = nw * inv; this.qx = nx * inv; this.qy = ny * inv; this.qz = nz * inv;
  }

  /** World-space body up vector (thrust axis) y component: 1 = level, −1 = inverted. */
  upY(): number {
    return 1 - 2 * (this.qx * this.qx + this.qz * this.qz);
  }

  speed(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }
}
