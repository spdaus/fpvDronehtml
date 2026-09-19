import { clamp } from './math';

/** LiPo open-circuit voltage per cell vs state of charge (design.md §5.8, R4.12). */
const OCV_SOC = [0, 0.05, 0.2, 0.5, 0.8, 1];
const OCV_V = [3.3, 3.55, 3.73, 3.85, 4.0, 4.2];

export const CELL_FULL_V = 4.2;

export function cellOcv(soc: number): number {
  const s = clamp(soc, 0, 1);
  for (let i = 1; i < OCV_SOC.length; i++) {
    if (s <= OCV_SOC[i]) {
      const t = (s - OCV_SOC[i - 1]) / (OCV_SOC[i] - OCV_SOC[i - 1]);
      return OCV_V[i - 1] + t * (OCV_V[i] - OCV_V[i - 1]);
    }
  }
  return OCV_V[OCV_V.length - 1];
}
