import type { StickInput } from '../sim/drone';
import { MAX_AXES, type SampleBuffer } from './sampleBuffer';

/** Per-axis calibration (design.md §3.4, R1.3–R1.6). */
export interface AxisCal {
  center: number;
  min: number;
  max: number;
}

export interface ChannelMap {
  axis: number;
  invert: boolean;
}

export type SourceKind = 'bridge' | 'gamepad' | 'keyboard';

export interface Calibration {
  version: 1;
  axes: AxisCal[];
  throttle: ChannelMap;
  yaw: ChannelMap;
  pitch: ChannelMap;
  roll: ChannelMap;
  deadzone: number;
}

export const DEFAULT_DEADZONE = 0.03;
export const CHANNELS = ['throttle', 'yaw', 'pitch', 'roll'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Raw axis → −1..1 with an asymmetric scale either side of centre and a continuous deadzone. */
export function normalizeAxis(raw: number, cal: AxisCal, deadzone: number): number {
  const d = raw - cal.center;
  const span = d >= 0 ? cal.max - cal.center : cal.center - cal.min;
  let n = span > 1e-6 ? d / span : 0;
  if (n > 1) n = 1;
  else if (n < -1) n = -1;
  const a = Math.abs(n);
  if (a < deadzone) return 0;
  return (Math.sign(n) * (a - deadzone)) / (1 - deadzone);
}

export function channelValue(buf: SampleBuffer, slot: number, cal: Calibration, ch: ChannelMap): number {
  const v = normalizeAxis(buf.axis(slot, ch.axis), cal.axes[ch.axis], cal.deadzone);
  return ch.invert && v !== 0 ? -v : v;
}

/** Map one buffered sample to Mode 2 sticks (R1.2). Throttle becomes 0..1 (0.5 = centre). */
export function mapSticks(buf: SampleBuffer, slot: number, cal: Calibration, out: StickInput): void {
  out.throttle = (channelValue(buf, slot, cal, cal.throttle) + 1) / 2;
  out.yaw = channelValue(buf, slot, cal, cal.yaw);
  out.pitch = channelValue(buf, slot, cal, cal.pitch);
  out.roll = channelValue(buf, slot, cal, cal.roll);
}

function identityAxes(): AxisCal[] {
  return Array.from({ length: MAX_AXES }, () => ({ center: 0, min: -1, max: 1 }));
}

/**
 * Built-in defaults. Bridge axes are winmm [X, Y, Z, R, U, V]; this controller's right stick
 * reports X on U and Y on R. Up is negative on every stick, hence the inverts.
 */
export function defaultCalibration(source: SourceKind): Calibration {
  const base = { version: 1 as const, axes: identityAxes(), deadzone: DEFAULT_DEADZONE };
  switch (source) {
    case 'bridge':
      return { ...base, throttle: { axis: 1, invert: true }, yaw: { axis: 0, invert: false }, pitch: { axis: 3, invert: true }, roll: { axis: 4, invert: false } };
    case 'gamepad':
      return { ...base, throttle: { axis: 1, invert: true }, yaw: { axis: 0, invert: false }, pitch: { axis: 3, invert: true }, roll: { axis: 2, invert: false } };
    case 'keyboard':
      return { ...base, deadzone: 0, throttle: { axis: 0, invert: false }, yaw: { axis: 1, invert: false }, pitch: { axis: 2, invert: false }, roll: { axis: 3, invert: false } };
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const key = (source: SourceKind) => `fpvsim.calib.${source}`;

function isValid(c: unknown): c is Calibration {
  const x = c as Calibration;
  return (
    !!x && x.version === 1 && Array.isArray(x.axes) && x.axes.length === MAX_AXES &&
    CHANNELS.every((ch) => x[ch] && Number.isInteger(x[ch].axis) && x[ch].axis >= 0 && x[ch].axis < MAX_AXES) &&
    typeof x.deadzone === 'number'
  );
}

/** Saved calibration for a source, or null if none (or unreadable). */
export function loadCalibration(storage: StorageLike | undefined, source: SourceKind): Calibration | null {
  try {
    const raw = storage?.getItem(key(source));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCalibration(storage: StorageLike | undefined, source: SourceKind, cal: Calibration): void {
  try {
    storage?.setItem(key(source), JSON.stringify(cal));
  } catch {
    // storage blocked (private mode): calibration lasts for this session only
  }
}

/**
 * Pick the axis a "push this way and hold" step refers to: the one (not already taken) that moved
 * furthest from centre, in normalised units. Returns null until a deflection ≥ `threshold`.
 */
export function detectAxis(
  raw: ArrayLike<number>,
  axes: readonly AxisCal[],
  taken: ReadonlySet<number>,
  threshold = 0.6,
): { axis: number; sign: 1 | -1 } | null {
  let best = -1;
  let bestMag = threshold;
  let sign: 1 | -1 = 1;
  for (let i = 0; i < MAX_AXES; i++) {
    if (taken.has(i)) continue;
    const v = normalizeAxis(raw[i] ?? 0, axes[i], 0);
    if (Math.abs(v) > bestMag) {
      bestMag = Math.abs(v);
      best = i;
      sign = v > 0 ? 1 : -1;
    }
  }
  return best < 0 ? null : { axis: best, sign };
}
