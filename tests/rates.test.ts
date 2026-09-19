import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, betaflightRateDeg, maxRateDeg } from '../src/sim/rates';

// Reference values hand-computed from Betaflight's applyBetaflightRates() (rc.c).
const REF: Array<[stick: number, rcRate: number, superRate: number, expo: number, degPerSec: number]> = [
  [0, 1.0, 0.7, 0, 0],
  [0.25, 1.0, 0.7, 0, 60.606],
  [0.5, 1.0, 0.7, 0, 153.846],
  [0.75, 1.0, 0.7, 0, 315.789],
  [1.0, 1.0, 0.7, 0, 666.667],
  [-0.5, 1.0, 0.7, 0, -153.846],
  [0.5, 1.0, 0.7, 0.5, 86.538],
  [0.6, 0.8, 0.75, 0.2, 147.18],
  [0.1, 2.5, 0, 0, 195.4], // rcRate > 2 uses the incremental boost
  [1.0, 2.5, 0.1, 0, 1998], // clamped at the setpoint limit
];

describe('rates', () => {
  it.each(REF)('R3.1/R3.3 stick %f rc %f super %f expo %f → %f deg/s (±1%)', (s, rc, sr, ex, want) => {
    const got = betaflightRateDeg(s, { rcRate: rc, superRate: sr, expo: ex });
    if (want === 0) expect(got).toBe(0);
    else expect(Math.abs(got - want) / Math.abs(want)).toBeLessThan(0.01);
  });

  it('R3.2 defaults are 1.0 / 0.70 / 0 with ~667 deg/s max on every axis', () => {
    for (const axis of [DEFAULT_RATES.roll, DEFAULT_RATES.pitch, DEFAULT_RATES.yaw]) {
      expect(axis).toEqual({ rcRate: 1.0, superRate: 0.7, expo: 0 });
      expect(maxRateDeg(axis)).toBeCloseTo(666.667, 2);
    }
  });

  it('R3.1 curve is odd and monotonic', () => {
    let prev = -Infinity;
    for (let s = -1; s <= 1.0001; s += 0.01) {
      const v = betaflightRateDeg(s, DEFAULT_RATES.roll);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(betaflightRateDeg(-s, DEFAULT_RATES.roll)).toBeCloseTo(-v, 9);
      prev = v;
    }
  });
});
