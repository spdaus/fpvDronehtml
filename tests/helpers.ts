import { Drone, type StickInput } from '../src/sim/drone';
import { FREESTYLE_5 } from '../src/sim/params';

export const CENTER: StickInput = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

export function stick(p: Partial<StickInput>): StickInput {
  return { ...CENTER, ...p };
}

/** An armed quad hovering level in free air at 50 m, motors spooled to hover. */
export function hoveringDrone(seed = 1): Drone {
  const d = new Drone(FREESTYLE_5, undefined, seed);
  d.reset(0, 50, 0, 0);
  d.arm();
  const hw = Math.sqrt((FREESTYLE_5.mass * 9.81) / (4 * FREESTYLE_5.thrustMax));
  d.motor.fill(hw);
  run(d, CENTER, 1.0);
  return d;
}

/** Step `seconds` of sim time with a constant input; `each` sees the drone after every step. */
export function run(d: Drone, input: StickInput, seconds: number, each?: (d: Drone, t: number) => void): void {
  const n = Math.round(seconds / d.dt);
  for (let k = 1; k <= n; k++) {
    d.step(input);
    each?.(d, k * d.dt);
  }
}

/** Set the attitude from an axis-angle rotation (axis must be unit length). */
export function setAttitude(d: Drone, ax: number, ay: number, az: number, angle: number): void {
  const s = Math.sin(angle / 2);
  d.qw = Math.cos(angle / 2);
  d.qx = ax * s;
  d.qy = ay * s;
  d.qz = az * s;
}
