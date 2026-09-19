import { fromWinmm, hatAxisToDpad, withDpad } from './buttons';
import { MAX_AXES, SampleBuffer } from './sampleBuffer';

/** Bridge packet (bridge/bridge.py make_packet). */
interface Packet {
  s: number;
  t: number;
  c: 0 | 1;
  a?: number[];
  b?: number;
  p?: number;
}

/**
 * winmm controller via the bridge's SSE stream (design.md §3.2). Samples are stamped in the page's
 * clock by mapping bridge time with the smallest observed transit offset, so bursts that the main
 * thread handles late keep their true spacing (R10.3).
 */
export class BridgeSource {
  readonly buffer = new SampleBuffer(256);
  /** The bridge reports a controller. */
  connected = false;
  /** Page time of the last message of any kind (packets and heartbeats). */
  lastMessageAt = -Infinity;
  /** Controller packets per second (≈ the controller's report rate). */
  rate = 0;
  private offset = Infinity;
  private count = 0;
  private rateT0 = 0;
  private readonly es: EventSource | null;

  constructor(url = '/stream') {
    this.es = typeof EventSource === 'undefined' ? null : new EventSource(url);
    this.es?.addEventListener('message', (e) => this.onPacket(e.data as string));
    this.es?.addEventListener('hb', () => { this.lastMessageAt = performance.now(); });
    this.es?.addEventListener('error', () => { this.connected = false; });
  }

  /** Link is healthy (heartbeats every 250 ms): used by the failsafe. */
  alive(now: number): boolean {
    return now - this.lastMessageAt < 600;
  }

  /** Recently heard from: used to pick the source, so a brief gap doesn't flip to the gamepad. */
  recent(now: number): boolean {
    return now - this.lastMessageAt < 2000;
  }

  private onPacket(data: string): void {
    const now = performance.now();
    this.lastMessageAt = now;
    let p: Packet;
    try {
      p = JSON.parse(data) as Packet;
    } catch {
      return;
    }
    if (p.c !== 1 || !p.a) {
      this.connected = false;
      return;
    }
    this.connected = true;
    this.offset = Math.min(this.offset + 0.001, now - p.t);
    this.buffer.push(p.t + this.offset, p.a, fromWinmm(p.b ?? 0, p.p ?? -1));
    this.count++;
    if (now - this.rateT0 >= 1000) {
      this.rate = (this.count * 1000) / (now - this.rateT0);
      this.count = 0;
      this.rateT0 = now;
    }
  }
}

/** Browser Gamepad API fallback, polled once per frame. Sample time = the pad's own timestamp. */
export class GamepadSource {
  readonly buffer = new SampleBuffer(64);
  connected = false;
  id = '';
  standard = false;
  private lastTs = -1;
  private readonly axes = new Float32Array(MAX_AXES);

  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.connected = false;
      return;
    }
    this.connected = true;
    this.id = pad.id;
    this.standard = pad.mapping === 'standard';
    if (pad.timestamp === this.lastTs) return;
    this.lastTs = pad.timestamp;

    for (let i = 0; i < MAX_AXES; i++) this.axes[i] = i < pad.axes.length ? pad.axes[i] : 0;
    let mask = 0;
    const nb = Math.min(pad.buttons.length, this.standard ? 18 : 12);
    for (let i = 0; i < nb; i++) if (pad.buttons[i].pressed) mask |= 1 << i;
    if (!this.standard && pad.axes.length > 9) mask = withDpad(mask, hatAxisToDpad(pad.axes[9]));
    this.buffer.push(pad.timestamp, this.axes, mask >>> 0);
  }
}

/**
 * Keyboard flying, for debugging without a controller (R1.8). Keys ramp the virtual sticks so it is
 * at least flyable: W/S throttle, A/D yaw, arrows pitch/roll.
 */
export class KeyboardSource {
  readonly buffer = new SampleBuffer(16);
  private readonly down = new Set<string>();
  private readonly axes = new Float32Array(MAX_AXES);
  private last = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => this.down.add(e.code));
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  poll(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const k = (c: string) => (this.down.has(c) ? 1 : 0);
    const ramp = (i: number, target: number, speed: number) => {
      const v = this.axes[i];
      const step = speed * dt;
      this.axes[i] = Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
    };
    ramp(0, k('KeyW') - k('KeyS'), 3);
    ramp(1, k('KeyD') - k('KeyA'), 4);
    ramp(2, k('ArrowUp') - k('ArrowDown'), 4);
    ramp(3, k('ArrowRight') - k('ArrowLeft'), 4);
    this.buffer.push(now, this.axes, 0);
  }
}
