import { describe, expect, it } from 'vitest';
import { BTN, bit, fromWinmm, hatAxisToDpad, povToDpad } from '../src/input/buttons';
import {
  defaultCalibration,
  detectAxis,
  loadCalibration,
  mapSticks,
  normalizeAxis,
  saveCalibration,
  type StorageLike,
} from '../src/input/calibration';
import { InputManager } from '../src/input/inputManager';
import { SampleBuffer } from '../src/input/sampleBuffer';
import type { StickInput } from '../src/sim/drone';

const CAL = { center: -0.127, min: -0.82, max: 0.7 };

describe('axis normalisation', () => {
  it('R1.4 full physical deflection → exactly ±1, rest → 0, asymmetric sides', () => {
    expect(normalizeAxis(CAL.center, CAL, 0.03)).toBe(0);
    expect(normalizeAxis(CAL.max, CAL, 0.03)).toBeCloseTo(1, 12);
    expect(normalizeAxis(CAL.min, CAL, 0.03)).toBeCloseTo(-1, 12);
    expect(normalizeAxis(0.9, CAL, 0.03)).toBe(1); // beyond calibrated range clamps
    // half-way on each side is ~0.5 even though the sides differ in length
    const up = normalizeAxis((CAL.center + CAL.max) / 2, CAL, 0);
    const down = normalizeAxis((CAL.center + CAL.min) / 2, CAL, 0);
    expect(up).toBeCloseTo(0.5, 9);
    expect(down).toBeCloseTo(-0.5, 9);
  });

  it('R1.5 continuous deadzone: 0 inside, no step at the edge, rescaled to reach ±1', () => {
    const cal = { center: 0, min: -1, max: 1 };
    expect(normalizeAxis(0.029, cal, 0.03)).toBe(0);
    expect(normalizeAxis(0.0301, cal, 0.03)).toBeLessThan(0.001);
    let prev = normalizeAxis(-1, cal, 0.03);
    for (let x = -1; x <= 1; x += 0.001) {
      const v = normalizeAxis(x, cal, 0.03);
      expect(Math.abs(v - prev)).toBeLessThan(0.0021);
      prev = v;
    }
  });
});

describe('Mode 2 mapping', () => {
  it('R1.2 bridge defaults: left = throttle/yaw, right = pitch/roll, up is forward/more throttle', () => {
    const cal = defaultCalibration('bridge');
    const buf = new SampleBuffer();
    const out: StickInput = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    // winmm axes [X, Y, Z, R, U, V]: left stick up, left stick right, right stick up, right stick right
    buf.push(0, [0.5, -1, 0, -1, 1, 0], 0);
    mapSticks(buf, buf.latest(), cal, out);
    expect(out.throttle).toBeCloseTo(1, 9);
    expect(out.yaw).toBeGreaterThan(0.45);
    expect(out.pitch).toBeCloseTo(1, 9);
    expect(out.roll).toBeCloseTo(1, 9);
    buf.push(1, [0, 0, 0, 0, 0, 0], 0);
    mapSticks(buf, buf.latest(), cal, out);
    expect(out).toEqual({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });
  });
});

describe('invert pitch option', () => {
  it('R1.10 flips only pitch, after calibration mapping', () => {
    const input = new InputManager(undefined, 'keyboard');
    // keyboard axes: throttle, yaw, pitch, roll
    input.keyboard.buffer.push(0, [0.4, 0.3, 0.5, 0.2], 0);
    const out: StickInput = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    const expectSticks = (want: StickInput) => {
      input.sticksAt(1, out);
      for (const k of ['throttle', 'yaw', 'pitch', 'roll'] as const) expect(out[k]).toBeCloseTo(want[k], 6);
    };
    expectSticks({ throttle: 0.7, yaw: 0.3, pitch: 0.5, roll: 0.2 });
    input.invertPitch = true;
    expectSticks({ throttle: 0.7, yaw: 0.3, pitch: -0.5, roll: 0.2 });
  });
});

describe('calibration', () => {
  function memStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('R1.6 round-trips through storage per source; defaults when missing', () => {
    const s = memStorage();
    expect(loadCalibration(s, 'bridge')).toBeNull();
    const cal = defaultCalibration('bridge');
    cal.axes[3] = { ...CAL };
    cal.pitch = { axis: 5, invert: false };
    saveCalibration(s, 'bridge', cal);
    expect(loadCalibration(s, 'bridge')).toEqual(cal);
    expect(loadCalibration(s, 'gamepad')).toBeNull();
  });

  it('R1.6 ignores corrupt or foreign data', () => {
    const s = memStorage();
    s.setItem('fpvsim.calib.bridge', '{"version":1,"axes":[]}');
    expect(loadCalibration(s, 'bridge')).toBeNull();
    s.setItem('fpvsim.calib.bridge', 'not json');
    expect(loadCalibration(s, 'bridge')).toBeNull();
  });

  it('R1.3 detects the pushed axis and its sign, skipping taken axes', () => {
    // Centres as captured by the "let go" step; winmm Z and V are unused and rest at −1.
    const rest = [0.02, -0.05, -1, -0.127, 0.012, -1, 0, 0];
    const axes = rest.map((c) => ({ center: c, min: -1, max: 1 }));
    const raw = [0.02, -0.9, -1, -0.1, 0.05, -1, 0, 0];
    expect(detectAxis(raw, axes, new Set())).toEqual({ axis: 1, sign: -1 });
    expect(detectAxis(raw, axes, new Set([1]))).toBeNull();
    expect(detectAxis([0, 0, 0, 0, 0.8, 0, 0, 0], axes, new Set([1]))).toEqual({ axis: 4, sign: 1 });
  });
});

describe('sample buffer', () => {
  it('R10.3 picks the newest sample at or before a time', () => {
    const b = new SampleBuffer(4);
    expect(b.at(0)).toBe(-1);
    b.push(10, [1], 0);
    b.push(20, [2], 0);
    b.push(30, [3], 0);
    expect(b.axis(b.at(25), 0)).toBe(2);
    expect(b.axis(b.at(30), 0)).toBe(3);
    expect(b.axis(b.at(5), 0)).toBe(1); // older than everything → oldest
    b.push(40, [4], 0);
    b.push(50, [5], 0); // overwrites the oldest
    expect(b.axis(b.at(15), 0)).toBe(2);
  });

  it('keeps time non-decreasing', () => {
    const b = new SampleBuffer(4);
    b.push(10, [1], 0);
    b.push(5, [2], 0);
    expect(b.time[b.latest()]).toBe(10);
  });
});

describe('buttons', () => {
  it('POV hat → D-pad bits, including diagonals', () => {
    expect(povToDpad(-1)).toBe(0);
    expect(povToDpad(0)).toBe(bit(BTN.UP));
    expect(povToDpad(9000)).toBe(bit(BTN.RIGHT));
    expect(povToDpad(18000)).toBe(bit(BTN.DOWN));
    expect(povToDpad(27000)).toBe(bit(BTN.LEFT));
    expect(povToDpad(4500)).toBe(bit(BTN.UP) | bit(BTN.RIGHT));
  });

  it('winmm Home/Capture move out of the D-pad bits', () => {
    const m = fromWinmm(bit(12) | bit(13) | bit(BTN.ZR), -1);
    expect(m & bit(BTN.HOME)).toBeTruthy();
    expect(m & bit(BTN.CAPTURE)).toBeTruthy();
    expect(m & bit(BTN.ZR)).toBeTruthy();
    expect(m & (bit(12) | bit(13))).toBe(0);
  });

  it('non-standard hat axis → D-pad; neutral reads as nothing', () => {
    expect(hatAxisToDpad(-1)).toBe(bit(BTN.UP));
    expect(hatAxisToDpad(-1 + (2 / 7) * 2)).toBe(bit(BTN.RIGHT));
    expect(hatAxisToDpad(1.2857)).toBe(0);
  });
});
