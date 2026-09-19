import { describe, expect, it } from 'vitest';
import { rateRad } from '../src/sim/rates';
import { DEFAULT_RATES } from '../src/sim/rates';
import { CENTER, hoveringDrone, run, stick } from './helpers';

const FULL_RATE = rateRad(1, DEFAULT_RATES.roll); // ≈ 11.64 rad/s

describe('closed-loop flight', () => {
  it('R2.5 centred throttle holds altitude: |vertical accel| ≤ 0.3 m/s² once settled', () => {
    const d = hoveringDrone();
    let sumAy = 0;
    let n = 0;
    run(d, CENTER, 0.5, (dd) => {
      sumAy += dd.ay;
      n++;
    });
    expect(Math.abs(sumAy / n)).toBeLessThanOrEqual(0.3);
  });

  it('R2.5 hover drifts < 0.5 m over 5 s with centred sticks', () => {
    const d = hoveringDrone();
    const x0 = d.px, y0 = d.py, z0 = d.pz;
    run(d, CENTER, 5);
    expect(Math.hypot(d.px - x0, d.py - y0, d.pz - z0)).toBeLessThan(0.5);
  });

  it('R3.4 acro: centred sticks hold the current attitude (no self-level)', () => {
    const d = hoveringDrone();
    run(d, stick({ roll: 0.5 }), 0.15);
    run(d, CENTER, 0.2);
    const tilted = d.upY();
    expect(tilted).toBeLessThan(0.95); // really tilted
    run(d, CENTER, 1.0);
    expect(Math.abs(d.upY() - tilted)).toBeLessThan(0.02);
    expect(Math.hypot(d.wx, d.wy, d.wz)).toBeLessThan(0.05);
  });

  it('R4.4 full roll step: 90% of setpoint within 80 ms, overshoot ≤ 15%', () => {
    const d = hoveringDrone();
    let t90 = -1;
    let peak = 0;
    run(d, stick({ roll: 1 }), 0.3, (dd, t) => {
      const rate = -dd.wz; // roll right is −z
      if (t90 < 0 && rate >= 0.9 * FULL_RATE) t90 = t;
      peak = Math.max(peak, rate);
    });
    expect(t90).toBeGreaterThan(0);
    expect(t90).toBeLessThanOrEqual(0.08);
    expect(peak).toBeLessThanOrEqual(1.15 * FULL_RATE);
  });

  it('R4.4 pitch and yaw track too', () => {
    const d = hoveringDrone();
    run(d, stick({ pitch: -1 }), 0.15); // pull back = nose up = +x
    expect(d.wx).toBeGreaterThan(0.85 * FULL_RATE);
    const e = hoveringDrone();
    run(e, stick({ yaw: 0.5 }), 0.3);
    expect(-e.wy).toBeGreaterThan(0.85 * rateRad(0.5, DEFAULT_RATES.yaw));
  });

  it('R4.5 a full-stick roll completes 360° in 0.55–0.75 s', () => {
    const d = hoveringDrone();
    let angle = 0;
    let done = -1;
    run(d, stick({ roll: 1, throttle: 0.6 }), 1.0, (dd, t) => {
      angle += -dd.wz * dd.dt;
      if (done < 0 && angle >= 2 * Math.PI) done = t;
    });
    expect(done).toBeGreaterThanOrEqual(0.55);
    expect(done).toBeLessThanOrEqual(0.75);
  });

  it('stays stable: no oscillation at rest after aggressive input', () => {
    const d = hoveringDrone();
    run(d, stick({ roll: 1, pitch: 0.7, yaw: -0.8, throttle: 0.9 }), 0.4);
    run(d, CENTER, 1.0);
    let maxRate = 0;
    run(d, CENTER, 0.5, (dd) => {
      maxRate = Math.max(maxRate, Math.hypot(dd.wx, dd.wy, dd.wz));
    });
    expect(maxRate).toBeLessThan(0.05);
  });
});
