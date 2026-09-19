import { DEG2RAD, clamp } from './math';

/** Betaflight "Betaflight"-type rates for one axis. Spec: design.md §4.1 (R3). */
export interface AxisRates {
  rcRate: number;
  superRate: number;
  expo: number;
}

export interface Rates {
  roll: AxisRates;
  pitch: AxisRates;
  yaw: AxisRates;
}

export const DEFAULT_RATES: Rates = {
  roll: { rcRate: 1.0, superRate: 0.7, expo: 0 },
  pitch: { rcRate: 1.0, superRate: 0.7, expo: 0 },
  yaw: { rcRate: 1.0, superRate: 0.7, expo: 0 },
};

const RC_RATE_INCREMENTAL = 14.54;
const SETPOINT_RATE_LIMIT = 1998;

/** Stick deflection in [-1, 1] → rate in deg/s, exactly as Betaflight's applyBetaflightRates(). */
export function betaflightRateDeg(stick: number, r: AxisRates): number {
  const ax = Math.min(Math.abs(stick), 1);
  let x = clamp(stick, -1, 1);
  if (r.expo > 0) x = x * ax * ax * ax * r.expo + x * (1 - r.expo);
  let rc = r.rcRate;
  if (rc > 2) rc += RC_RATE_INCREMENTAL * (rc - 2);
  let deg = 200 * rc * x;
  if (r.superRate > 0) deg *= 1 / clamp(1 - ax * r.superRate, 0.01, 1);
  return clamp(deg, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
}

export function rateRad(stick: number, r: AxisRates): number {
  return betaflightRateDeg(stick, r) * DEG2RAD;
}

/** Max rate at full stick, deg/s. */
export function maxRateDeg(r: AxisRates): number {
  return betaflightRateDeg(1, r);
}
