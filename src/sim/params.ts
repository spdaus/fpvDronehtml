/**
 * Airframe + flight-controller parameters. Spec: design.md §5.2 (R4.3).
 * Body axes: x = right (pitch axis), y = up (yaw axis / thrust), z = back (roll axis about −z = nose).
 */

export interface PidAxis {
  kp: number;
  ki: number;
  kd: number;
  kff: number;
  iLimit: number;
}

export interface BatteryParams {
  cells: number;
  capacityMah: number;
  /** Pack internal resistance incl. wiring, Ω. */
  internalResistance: number;
  /** Total current at full throttle on all motors, A. */
  maxCurrent: number;
  /** Electronics draw (FC, VTX, camera), A. */
  baseCurrent: number;
}

export interface QuadParams {
  name: string;
  /** All-up weight, kg. */
  mass: number;
  /** Diagonal inertia about body x (pitch), y (yaw), z (roll), kg·m². */
  inertia: { x: number; y: number; z: number };
  /** Motor offset from centre along each body axis (quad-X), m. */
  armOffset: number;
  /** Static thrust per motor at full speed on a full pack, N. */
  thrustMax: number;
  /** Prop torque / thrust ratio, m. */
  torqueRatio: number;
  /** Prop + bell inertia, kg·m². */
  rotorInertia: number;
  /** Motor speed at full command on a full pack, rad/s. */
  omegaMax: number;
  /** Motor time constants, s. Spin-up is faster than spin-down. */
  tauUp: number;
  tauDown: number;
  /** Motor idle command while armed (DShot idle), 0..1. */
  idle: number;
  /** Axial inflow speed at which a prop at full speed makes no thrust, m/s. */
  inflowZeroSpeed: number;
  propRadius: number;
  /** ½ρC_dA per body axis (x side, y top, z front), N/(m/s)². */
  drag: { x: number; y: number; z: number };
  /** Rotor H-force drag per unit mean motor speed, N/(m/s). */
  rotorDrag: number;
  /** Aerodynamic rotational damping, N·m/(rad/s). */
  angularDamping: number;
  /** Per-motor thrust scale (FR, FL, RR, RL): real motors and props are never identical. */
  motorThrustScale: readonly [number, number, number, number];
  battery: BatteryParams;
  /** Prop-wash disturbance (design.md §5.6). */
  propWash: { torque: number; thrustLoss: number; noiseHz: number };
  /** Collision sphere radius, m. */
  collisionRadius: number;
  restitution: number;
  friction: number;
  /** Normal impact speed at or above which the quad crashes, m/s. */
  crashSpeed: number;
  /** Rate PID per body axis: x = pitch, y = yaw, z = roll. Outputs are normalised torque commands. */
  pid: { x: PidAxis; y: PidAxis; z: PidAxis };
  /** Flight-controller filter cutoffs, Hz. */
  rcSmoothingHz: number;
  dtermCutoffHz: number;
  ffCutoffHz: number;
  /** I-term relax: I stops accumulating while the setpoint moves faster than this, rad/s (high-passed). */
  itermRelaxCutoffHz: number;
  itermRelaxThreshold: number;
}

/** 5" freestyle quad on 6S: ~650 g, ~8:1 thrust-to-weight. */
export const FREESTYLE_5: QuadParams = {
  name: '5" freestyle 6S',
  mass: 0.65,
  inertia: { x: 0.0028, y: 0.0045, z: 0.0026 },
  armOffset: 0.0795,
  thrustMax: 12.75,
  torqueRatio: 0.016,
  rotorInertia: 6e-6,
  omegaMax: 3140,
  tauUp: 0.03,
  tauDown: 0.05,
  idle: 0.05,
  inflowZeroSpeed: 65,
  propRadius: 0.0635,
  drag: { x: 0.0085, y: 0.010, z: 0.0074 },
  rotorDrag: 0.1,
  angularDamping: 0.0004,
  motorThrustScale: [1.003, 0.998, 0.999, 1.001],
  battery: { cells: 6, capacityMah: 1300, internalResistance: 0.025, maxCurrent: 120, baseCurrent: 0.5 },
  propWash: { torque: 0.12, thrustLoss: 0.3, noiseHz: 12 },
  collisionRadius: 0.12,
  restitution: 0.3,
  friction: 0.4,
  crashSpeed: 7,
  pid: {
    x: { kp: 0.065, ki: 0.5, kd: 0.0009, kff: 0.0016, iLimit: 0.3 },
    y: { kp: 0.3, ki: 2.0, kd: 0, kff: 0.01, iLimit: 0.3 },
    z: { kp: 0.06, ki: 0.5, kd: 0.0008, kff: 0.0015, iLimit: 0.3 },
  },
  rcSmoothingHz: 60,
  dtermCutoffHz: 100,
  ffCutoffHz: 40,
  itermRelaxCutoffHz: 10,
  itermRelaxThreshold: 0.5,
};

/** Motor layout (design.md §2): FR, FL, RR, RL. Position signs and spin (+1 = CCW from above). */
export const MOTOR_SX = [1, -1, 1, -1] as const;
export const MOTOR_SZ = [-1, -1, 1, 1] as const;
export const MOTOR_SPIN = [1, -1, -1, 1] as const;
