export const MAX_AXES = 8;

/**
 * Fixed-capacity ring of timestamped controller samples (design.md §3.3, R10.3).
 * Never allocates after construction. Times are forced non-decreasing.
 */
export class SampleBuffer {
  readonly time: Float64Array;
  readonly axes: Float32Array;
  readonly buttons: Uint32Array;
  private head = -1;
  private count = 0;

  constructor(readonly capacity = 128) {
    this.time = new Float64Array(capacity);
    this.axes = new Float32Array(capacity * MAX_AXES);
    this.buttons = new Uint32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.head = -1;
    this.count = 0;
  }

  push(time: number, axes: ArrayLike<number>, buttons: number): void {
    const prev = this.head >= 0 ? this.time[this.head] : -Infinity;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.time[this.head] = time < prev ? prev : time;
    const o = this.head * MAX_AXES;
    const n = Math.min(axes.length, MAX_AXES);
    for (let i = 0; i < MAX_AXES; i++) this.axes[o + i] = i < n ? axes[i] : 0;
    this.buttons[this.head] = buttons >>> 0;
  }

  /** Slot of the newest sample, or −1 if empty. */
  latest(): number {
    return this.head;
  }

  /** Slot of the newest sample with time ≤ t (the oldest one if all are newer), or −1 if empty. */
  at(t: number): number {
    if (this.count === 0) return -1;
    let idx = this.head;
    for (let k = 0; k < this.count; k++) {
      if (this.time[idx] <= t) return idx;
      if (k === this.count - 1) return idx;
      idx = (idx - 1 + this.capacity) % this.capacity;
    }
    return idx;
  }

  axis(slot: number, i: number): number {
    return this.axes[slot * MAX_AXES + i];
  }
}
