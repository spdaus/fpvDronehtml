import { clamp } from './math';

/**
 * Hover-pivoted throttle curve (design.md §4.2, R2): stick centre → hover, full down → 0, full up → 1.
 * `stick` is 0..1 (0.5 = centre). `expo` flattens the curve around hover for finer altitude control.
 */
export function throttleCurve(stick: number, hover: number, expo: number): number {
  const x = clamp(2 * stick - 1, -1, 1);
  const shaped = x * (1 - expo + expo * x * x);
  return shaped >= 0 ? hover + shaped * (1 - hover) : hover + shaped * hover;
}
