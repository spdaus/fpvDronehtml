export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const GRAVITY = 9.81;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smoothing factor for a first-order low-pass (PT1) filter with cutoff `hz`, stepped every `dt` s. */
export function pt1Alpha(hz: number, dt: number): number {
  return dt / (dt + 1 / (2 * Math.PI * hz));
}

/** Seeded PRNG (mulberry32): returns a function yielding uniform numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One step of mulberry32 on an explicit state, for hot loops that keep the state in a number field. */
export function mulberryStep(state: number): number {
  return (state + 0x6d2b79f5) >>> 0;
}
export function mulberryValue(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
