import { describe, expect, it } from 'vitest';
import { hoverThrottle } from '../src/sim/drone';
import { FREESTYLE_5 } from '../src/sim/params';
import { throttleCurve } from '../src/sim/throttle';

const H = 0.32;

describe('throttle curve', () => {
  it('R2.1 centre → hover, bottom → 0, top → 1', () => {
    for (const e of [0, 0.3, 1]) {
      expect(throttleCurve(0.5, H, e)).toBeCloseTo(H, 12);
      expect(throttleCurve(0, H, e)).toBeCloseTo(0, 12);
      expect(throttleCurve(1, H, e)).toBeCloseTo(1, 12);
    }
  });

  it('R2.2 continuous and monotonically non-decreasing', () => {
    for (const e of [0, 0.3, 0.7, 1]) {
      let prev = throttleCurve(0, H, e);
      for (let s = 0.001; s <= 1; s += 0.001) {
        const v = throttleCurve(s, H, e);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v - prev).toBeLessThan(0.01); // no jumps
        prev = v;
      }
    }
  });

  it('R2.3 expo flattens the curve around hover', () => {
    const linear = Math.abs(throttleCurve(0.6, H, 0) - H);
    const expo = Math.abs(throttleCurve(0.6, H, 0.3) - H);
    expect(expo).toBeLessThan(linear);
    expect(Math.abs(throttleCurve(0.4, H, 0.3) - H)).toBeLessThan(Math.abs(throttleCurve(0.4, H, 0) - H));
  });

  it('R2.4 hover throttle is derived from mass, thrust and idle', () => {
    const h = hoverThrottle(FREESTYLE_5);
    expect(h).toBeGreaterThan(0.25);
    expect(h).toBeLessThan(0.4);
    const heavier = hoverThrottle({ ...FREESTYLE_5, mass: FREESTYLE_5.mass * 1.5 });
    expect(heavier).toBeGreaterThan(h);
    const moreIdle = hoverThrottle({ ...FREESTYLE_5, idle: 0.1 });
    expect(moreIdle).toBeLessThan(h);
  });
});
