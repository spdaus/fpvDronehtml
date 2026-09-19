import { describe, expect, it } from 'vitest';
import { mixAirmode } from '../src/sim/mixer';
import { MOTOR_SPIN, MOTOR_SX, MOTOR_SZ } from '../src/sim/params';

const IDLE = 0.05;

/** Body torque direction from motor commands (thrust ∝ cmd²), in the design.md §2 convention. */
function torque(cmd: Float64Array): { x: number; y: number; z: number } {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < 4; i++) {
    const t = cmd[i] * cmd[i];
    x += -MOTOR_SZ[i] * t;
    z += MOTOR_SX[i] * t;
    y += -MOTOR_SPIN[i] * t;
  }
  return { x, y, z };
}

describe('mixer', () => {
  const out = new Float64Array(4);

  it('equal commands with no torque request', () => {
    mixAirmode(0.4, 0, 0, 0, IDLE, out);
    for (const c of out) expect(c).toBeCloseTo(IDLE + (1 - IDLE) * 0.4, 12);
  });

  it('each torque command produces torque about the right axis only', () => {
    mixAirmode(0.4, 0.2, 0, 0, IDLE, out);
    let t = torque(out);
    expect(t.x).toBeGreaterThan(0);
    expect(Math.abs(t.y)).toBeLessThan(1e-9);
    expect(Math.abs(t.z)).toBeLessThan(1e-9);

    mixAirmode(0.4, 0, 0, -0.2, IDLE, out);
    t = torque(out);
    expect(t.z).toBeLessThan(0);
    expect(Math.abs(t.x)).toBeLessThan(1e-9);

    mixAirmode(0.4, 0, 0.2, 0, IDLE, out);
    t = torque(out);
    expect(t.y).toBeGreaterThan(0);
  });

  it('keeps every motor inside 0..1 even when saturated', () => {
    mixAirmode(0.9, 1, 1, 1, IDLE, out);
    for (const c of out) {
      expect(c).toBeGreaterThanOrEqual(IDLE - 1e-12);
      expect(c).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('R4.6 airmode keeps ≥ 50% of full-throttle roll authority at zero throttle', () => {
    mixAirmode(0, 0, 0, 1, IDLE, out);
    const zero = torque(out).z;
    mixAirmode(1, 0, 0, 1, IDLE, out);
    const full = torque(out).z;
    expect(zero).toBeGreaterThan(0);
    expect(zero / full).toBeGreaterThanOrEqual(0.5);
  });
});
