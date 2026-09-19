import { clamp } from './math';
import { MOTOR_SPIN, MOTOR_SX, MOTOR_SZ } from './params';

/**
 * Quad-X mixer with airmode (design.md §4.4, R4.6).
 * ux/uy/uz are normalised torque commands about body x (pitch), y (yaw), z (roll).
 * Writes motor commands (0..1, including idle) into `out` (FR, FL, RR, RL).
 */
export function mixAirmode(
  throttle: number,
  ux: number,
  uy: number,
  uz: number,
  idle: number,
  out: Float64Array,
): void {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < 4; i++) {
    const m = 0.5 * (ux * -MOTOR_SZ[i] + uz * MOTOR_SX[i] + uy * -MOTOR_SPIN[i]);
    out[i] = m;
    if (m < mn) mn = m;
    if (m > mx) mx = m;
  }
  const range = mx - mn;
  if (range > 1) {
    // Attitude authority beats throttle: shrink the mix to fit the 0..1 motor range.
    const s = 1 / range;
    for (let i = 0; i < 4; i++) out[i] *= s;
    mn *= s;
    mx *= s;
  }
  // Airmode: slide the throttle so every motor stays inside 0..1 (can raise it above zero-stick).
  const t = clamp(throttle, -mn, 1 - mx);
  for (let i = 0; i < 4; i++) out[i] = idle + (1 - idle) * clamp(t + out[i], 0, 1);
}
