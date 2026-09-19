/** Frame-timing + latency overlay (design.md §9, R10.5). Stats in fixed ring buffers. */
export interface DebugInfo {
  source: string;
  inputAgeMs: number;
  physicsMs: number;
  steps: number;
  width: number;
  height: number;
  scale: number;
  calls: number;
  triangles: number;
  speed: number;
  wash: number;
  current: number;
}

const N = 240;

export class DebugOverlay {
  readonly el: HTMLPreElement;
  visible = false;
  private readonly frames = new Float64Array(N);
  private readonly sorted = new Float64Array(N);
  private readonly phys = new Float64Array(N);
  private i = 0;
  private count = 0;
  private next = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.id = 'debug';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  /** Record every frame (cheap); render the text a few times a second when visible. */
  frame(intervalMs: number, physicsMs: number, nowMs: number, info: () => DebugInfo): void {
    this.frames[this.i] = intervalMs;
    this.phys[this.i] = physicsMs;
    this.i = (this.i + 1) % N;
    if (this.count < N) this.count++;
    if (!this.visible || nowMs < this.next) return;
    this.next = nowMs + 250;

    let sum = 0;
    let psum = 0;
    for (let k = 0; k < this.count; k++) {
      sum += this.frames[k];
      psum += this.phys[k];
    }
    this.sorted.set(this.frames);
    const view = this.sorted.subarray(0, this.count).sort();
    const p99 = view[Math.min(this.count - 1, Math.floor(this.count * 0.99))];
    const avg = sum / this.count;
    const d = info();
    this.el.textContent =
      `FPS      ${(1000 / avg).toFixed(1)}\n` +
      `FRAME    avg ${avg.toFixed(2)} ms  p99 ${p99.toFixed(2)} ms\n` +
      `PHYSICS  ${(psum / this.count).toFixed(2)} ms/frame  (${d.steps} steps)\n` +
      `INPUT    ${d.source}  age ${Number.isFinite(d.inputAgeMs) ? d.inputAgeMs.toFixed(1) : '-'} ms\n` +
      `RENDER   ${d.width}x${d.height} (scale ${d.scale.toFixed(2)})\n` +
      `GPU      ${d.calls} calls  ${(d.triangles / 1000).toFixed(1)}k tris\n` +
      `QUAD     ${d.speed.toFixed(1)} m/s  ${d.current.toFixed(0)} A  wash ${d.wash.toFixed(2)}`;
  }
}
