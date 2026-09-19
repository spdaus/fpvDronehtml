import { clamp, pt1Alpha } from './math';
import type { PidAxis, QuadParams } from './params';

/**
 * Three-axis rate PID with feed-forward, RC smoothing and I-term relax (design.md §4.3, R4.4).
 * Axis order is body x (pitch), y (yaw), z (roll). Allocation-free after construction.
 */
export class RateController {
  /** Normalised torque commands, −1..1. */
  readonly out = new Float64Array(3);
  /** Smoothed setpoint actually being tracked, rad/s (exposed for tests and the debug overlay). */
  readonly setpoint = new Float64Array(3);

  private readonly gains: readonly [PidAxis, PidAxis, PidAxis];
  private readonly iTerm = new Float64Array(3);
  private readonly prevGyro = new Float64Array(3);
  private readonly dFilt = new Float64Array(3);
  private readonly prevSp = new Float64Array(3);
  private readonly ffFilt = new Float64Array(3);
  private readonly relaxFilt = new Float64Array(3);
  private readonly aRc: number;
  private readonly aD: number;
  private readonly aFf: number;
  private readonly aRelax: number;
  private readonly relaxThreshold: number;
  private primed = false;

  constructor(p: QuadParams, private readonly dt: number) {
    this.gains = [p.pid.x, p.pid.y, p.pid.z];
    this.aRc = pt1Alpha(p.rcSmoothingHz, dt);
    this.aD = pt1Alpha(p.dtermCutoffHz, dt);
    this.aFf = pt1Alpha(p.ffCutoffHz, dt);
    this.aRelax = pt1Alpha(p.itermRelaxCutoffHz, dt);
    this.relaxThreshold = p.itermRelaxThreshold;
  }

  reset(): void {
    this.out.fill(0);
    this.setpoint.fill(0);
    this.iTerm.fill(0);
    this.prevGyro.fill(0);
    this.dFilt.fill(0);
    this.prevSp.fill(0);
    this.ffFilt.fill(0);
    this.relaxFilt.fill(0);
    this.primed = false;
  }

  /** `sp*` = raw rate setpoints, `g*` = gyro (body rates), both rad/s. */
  update(spX: number, spY: number, spZ: number, gX: number, gY: number, gZ: number, iEnabled: boolean): void {
    if (!this.primed) {
      // Start filters at the current state so arming doesn't produce a derivative kick.
      this.prevGyro[0] = gX; this.prevGyro[1] = gY; this.prevGyro[2] = gZ;
      this.primed = true;
    }
    this.axis(0, spX, gX, iEnabled);
    this.axis(1, spY, gY, iEnabled);
    this.axis(2, spZ, gZ, iEnabled);
  }

  private axis(i: number, rawSp: number, gyro: number, iEnabled: boolean): void {
    const k = this.gains[i];
    const dt = this.dt;

    const sp = this.setpoint[i] + this.aRc * (rawSp - this.setpoint[i]);
    this.setpoint[i] = sp;

    const spDeriv = (sp - this.prevSp[i]) / dt;
    this.prevSp[i] = sp;
    this.ffFilt[i] += this.aFf * (spDeriv - this.ffFilt[i]);

    this.relaxFilt[i] += this.aRelax * (sp - this.relaxFilt[i]);
    const relax = Math.max(0, 1 - Math.abs(sp - this.relaxFilt[i]) / this.relaxThreshold);

    const err = sp - gyro;
    if (iEnabled) {
      this.iTerm[i] = clamp(this.iTerm[i] + k.ki * err * dt * relax, -k.iLimit, k.iLimit);
    } else {
      this.iTerm[i] = 0;
    }

    const gyroDeriv = (gyro - this.prevGyro[i]) / dt;
    this.prevGyro[i] = gyro;
    this.dFilt[i] += this.aD * (gyroDeriv - this.dFilt[i]);

    this.out[i] = clamp(k.kp * err + this.iTerm[i] - k.kd * this.dFilt[i] + k.kff * this.ffFilt[i], -1, 1);
  }
}
