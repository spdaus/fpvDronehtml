/**
 * Unified button bitmask (design.md §3.4). Bits 0–11 follow the Switch Pro / standard-gamepad order;
 * the D-pad is always bits 12–15 whatever the source (winmm POV hat, standard buttons, or hat axis).
 */
export const BTN = {
  B: 0,
  A: 1,
  Y: 2,
  X: 3,
  L: 4,
  R: 5,
  ZL: 6,
  ZR: 7,
  MINUS: 8,
  PLUS: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
  CAPTURE: 17,
} as const;

export const bit = (b: number) => 1 << b;

const DPAD_MASK = bit(BTN.UP) | bit(BTN.DOWN) | bit(BTN.LEFT) | bit(BTN.RIGHT);

/** winmm POV (hundredths of a degree clockwise from up, −1 = centred) → D-pad bits. */
export function povToDpad(pov: number): number {
  if (pov < 0 || pov > 36000) return 0;
  let m = 0;
  if (pov >= 31500 || pov <= 4500) m |= bit(BTN.UP);
  if (pov >= 4500 && pov <= 13500) m |= bit(BTN.RIGHT);
  if (pov >= 13500 && pov <= 22500) m |= bit(BTN.DOWN);
  if (pov >= 22500 && pov <= 31500) m |= bit(BTN.LEFT);
  return m;
}

/** winmm buttons (B A Y X L R ZL ZR − + LS RS Home Capture) + POV → unified mask. */
export function fromWinmm(buttons: number, pov: number): number {
  const low = buttons & 0xfff;
  const home = buttons & bit(12) ? bit(BTN.HOME) : 0;
  const capture = buttons & bit(13) ? bit(BTN.CAPTURE) : 0;
  return (low | home | capture | povToDpad(pov)) >>> 0;
}

/** Non-standard browser mapping: D-pad as a hat on one axis (−1 = up, clockwise in steps of 2/7). */
export function hatAxisToDpad(h: number): number {
  if (!(h >= -1.05 && h <= 1.05)) return 0; // neutral reads ≈ 1.29
  const dir = Math.round((h + 1) * 3.5) % 8; // 0 up, 1 up-right, … 7 up-left
  return povToDpad(dir * 4500);
}

export function withDpad(mask: number, dpad: number): number {
  return ((mask & ~DPAD_MASK) | dpad) >>> 0;
}
