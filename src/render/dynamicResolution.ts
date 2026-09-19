/**
 * Dynamic resolution controller (design.md §9, R9.2): watches frame intervals and trades render
 * resolution for a steady frame rate. Pure logic, no DOM.
 */
export interface DynResOptions {
  min: number;
  max: number;
  /** Lower the scale when the recent average interval exceeds this, ms. */
  slowMs: number;
  /** Raise it when the 90th percentile of a long window is at or below this, ms. */
  fastMs: number;
  shortWindow: number;
  longWindow: number;
  stepDown: number;
  stepUp: number;
  cooldownMs: number;
  /** After lowering from a scale, don't climb back to it for this long, ms. */
  retryMs: number;
}

export const DYNRES_DEFAULTS: DynResOptions = {
  min: 0.5,
  max: 1,
  slowMs: 18.5,
  fastMs: 17.4,
  shortWindow: 30,
  longWindow: 180,
  stepDown: 0.1,
  stepUp: 0.05,
  cooldownMs: 2000,
  retryMs: 30000,
};

export class DynamicResolution {
  scale: number;
  private readonly ring: Float64Array;
  private readonly sorted: Float64Array;
  private n = 0;
  private head = 0;
  private cooldownUntil = 0;
  private ceiling = Infinity;
  private ceilingUntil = 0;
  readonly opts: DynResOptions;

  constructor(opts: Partial<DynResOptions> = {}) {
    this.opts = { ...DYNRES_DEFAULTS, ...opts };
    this.scale = this.opts.max;
    this.ring = new Float64Array(this.opts.longWindow);
    this.sorted = new Float64Array(this.opts.longWindow);
  }

  setMax(max: number): void {
    this.opts.max = max;
    if (this.scale > max) this.scale = max;
  }

  /** Feed one frame interval. Returns true if the scale changed. */
  frame(intervalMs: number, now: number): boolean {
    const o = this.opts;
    this.ring[this.head] = intervalMs;
    this.head = (this.head + 1) % o.longWindow;
    if (this.n < o.longWindow) this.n++;
    if (now < this.cooldownUntil) return false;
    if (now >= this.ceilingUntil) this.ceiling = Infinity;

    if (this.n >= o.shortWindow) {
      let sum = 0;
      for (let k = 1; k <= o.shortWindow; k++) sum += this.ring[(this.head - k + o.longWindow) % o.longWindow];
      if (sum / o.shortWindow > o.slowMs && this.scale > o.min + 1e-9) {
        this.ceiling = this.scale;
        this.ceilingUntil = now + o.retryMs;
        this.scale = Math.max(o.min, round2(this.scale - o.stepDown));
        return this.changed(now);
      }
    }
    if (this.n >= o.longWindow && this.scale < o.max - 1e-9) {
      this.sorted.set(this.ring);
      this.sorted.sort();
      const p90 = this.sorted[Math.floor(o.longWindow * 0.9)];
      const next = Math.min(o.max, round2(this.scale + o.stepUp));
      if (p90 <= o.fastMs && next < this.ceiling - 1e-9) {
        this.scale = next;
        return this.changed(now);
      }
    }
    return false;
  }

  private changed(now: number): boolean {
    this.cooldownUntil = now + this.opts.cooldownMs;
    this.n = 0; // judge the new scale on fresh frames only
    return true;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
