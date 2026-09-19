import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/render/dynamicResolution';

function feed(d: DynamicResolution, ms: number, frames: number, t0: number): number {
  let t = t0;
  for (let i = 0; i < frames; i++) {
    t += ms;
    d.frame(ms, t);
  }
  return t;
}

describe('dynamic resolution', () => {
  it('R9.2 holds full scale while frames are on time', () => {
    const d = new DynamicResolution();
    feed(d, 16.9, 2000, 0);
    expect(d.scale).toBe(1);
  });

  it('R9.2 steps down on slow frames, never below the minimum', () => {
    const d = new DynamicResolution();
    let t = feed(d, 33.3, 60, 0);
    expect(d.scale).toBeCloseTo(0.9, 9);
    t = feed(d, 33.3, 5000, t);
    expect(d.scale).toBeCloseTo(0.5, 9);
  });

  it('R9.2 climbs back when there is headroom, but not straight back to a scale that failed', () => {
    const d = new DynamicResolution();
    let t = feed(d, 33.3, 60, 0); // 1.0 failed → 0.9
    expect(d.scale).toBeCloseTo(0.9, 9);
    t = feed(d, 16.7, 1000, t); // healthy, but 1.0 is on cool-down
    expect(d.scale).toBeCloseTo(0.95, 9);
    t = feed(d, 16.7, 2000, t); // after the retry window it tries 1.0 again
    expect(d.scale).toBe(1);
  });

  it('ignores the odd hitch', () => {
    const d = new DynamicResolution();
    let t = feed(d, 16.9, 200, 0);
    t = feed(d, 50, 1, t);
    feed(d, 16.9, 200, t);
    expect(d.scale).toBe(1);
  });
});
