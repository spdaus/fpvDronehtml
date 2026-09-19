import type { StickInput } from '../sim/drone';
import { BTN, bit } from './buttons';
import {
  defaultCalibration,
  loadCalibration,
  mapSticks,
  saveCalibration,
  type Calibration,
  type SourceKind,
  type StorageLike,
} from './calibration';
import { MAX_AXES, type SampleBuffer } from './sampleBuffer';
import { BridgeSource, GamepadSource, KeyboardSource } from './sources';

/** Game actions and their default buttons (R1.7). */
export const BIND = {
  arm: bit(BTN.ZR),
  reset: bit(BTN.ZL) | bit(BTN.B),
  camUp: bit(BTN.UP),
  camDown: bit(BTN.DOWN),
  pause: bit(BTN.PLUS),
  calibrate: bit(BTN.MINUS),
  debug: bit(BTN.X),
  select: bit(BTN.A),
  back: bit(BTN.B),
  navUp: bit(BTN.UP),
  navDown: bit(BTN.DOWN),
} as const;

const NAV_STICK_UP = 1 << 30;
const NAV_STICK_DOWN = 1 << 29;

/**
 * Chooses the active source each frame (bridge > gamepad > keyboard), tracks button edges and
 * maps buffered samples to sticks for each physics substep (design.md §3, §6).
 */
export class InputManager {
  readonly bridge: BridgeSource;
  readonly gamepad = new GamepadSource();
  readonly keyboard = new KeyboardSource();
  active: SourceKind = 'keyboard';
  /** Buttons held this frame, and those that went down this frame (unified mask + nav bits). */
  held = 0;
  pressed = 0;
  /** Pilot option: right stick up = nose up. Applied after calibration, to every source. */
  invertPitch = false;
  /** Latest raw axes of the active source (for the calibration screen). */
  readonly raw = new Float32Array(MAX_AXES);
  private readonly cals: Record<SourceKind, Calibration>;
  private readonly saved: Record<SourceKind, boolean>;
  private lastSlot = -2;
  private lastBuf: SampleBuffer | null = null;
  private readonly storage: StorageLike | undefined;

  /** `forced` pins the source (debugging: `?source=keyboard`). */
  constructor(storage?: StorageLike, private readonly forced?: SourceKind) {
    this.storage = storage;
    this.bridge = new BridgeSource();
    const kinds: SourceKind[] = ['bridge', 'gamepad', 'keyboard'];
    this.cals = {} as Record<SourceKind, Calibration>;
    this.saved = {} as Record<SourceKind, boolean>;
    for (const k of kinds) {
      const c = loadCalibration(storage, k);
      this.cals[k] = c ?? defaultCalibration(k);
      this.saved[k] = !!c || k === 'keyboard';
    }
  }

  get buffer(): SampleBuffer {
    return this.active === 'bridge' ? this.bridge.buffer : this.active === 'gamepad' ? this.gamepad.buffer : this.keyboard.buffer;
  }

  get calibration(): Calibration {
    return this.cals[this.active];
  }

  /** True when a physical controller is in use (not the keyboard fallback). */
  get hasController(): boolean {
    return this.active !== 'keyboard';
  }

  /** True if the active source has a saved calibration. */
  get calibrated(): boolean {
    return this.saved[this.active];
  }

  setCalibration(cal: Calibration): void {
    this.cals[this.active] = cal;
    this.saved[this.active] = true;
    this.lastSlot = -2;
    saveCalibration(this.storage, this.active, cal);
  }

  /** Once per frame, before physics. */
  update(now: number): void {
    this.gamepad.poll();
    this.keyboard.poll(now);
    const prev = this.active;
    if (this.forced) this.active = this.forced;
    else if (this.bridge.connected && this.bridge.recent(now)) this.active = 'bridge';
    else if (this.gamepad.connected) this.active = 'gamepad';
    else this.active = 'keyboard';
    if (prev !== this.active) this.lastSlot = -2;

    const buf = this.buffer;
    const slot = buf.latest();
    let held = 0;
    if (slot >= 0) {
      held = buf.buttons[slot];
      for (let i = 0; i < MAX_AXES; i++) this.raw[i] = buf.axis(slot, i);
      // Left stick as menu navigation (uses the calibrated throttle channel, with hysteresis).
      const st: StickInput = this.scratch;
      mapSticks(buf, slot, this.calibration, st);
      const v = st.throttle * 2 - 1;
      const wasUp = (this.held & NAV_STICK_UP) !== 0;
      const wasDown = (this.held & NAV_STICK_DOWN) !== 0;
      if (v > 0.6 || (wasUp && v > 0.3)) held |= NAV_STICK_UP;
      if (v < -0.6 || (wasDown && v < -0.3)) held |= NAV_STICK_DOWN;
      if (held & NAV_STICK_UP) held |= BIND.navUp;
      if (held & NAV_STICK_DOWN) held |= BIND.navDown;
    }
    this.pressed = (held & ~this.held) >>> 0;
    this.held = held >>> 0;
  }

  private readonly scratch: StickInput = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

  /** Sticks from the newest sample at or before page time `t` (R10.3). Returns false if no data. */
  sticksAt(t: number, out: StickInput): boolean {
    const buf = this.buffer;
    const slot = buf.at(t);
    if (slot < 0) return false;
    if (slot !== this.lastSlot || buf !== this.lastBuf) {
      mapSticks(buf, slot, this.calibration, this.cached);
      this.lastSlot = slot;
      this.lastBuf = buf;
    }
    out.throttle = this.cached.throttle;
    out.yaw = this.cached.yaw;
    const pitch = this.cached.pitch;
    out.pitch = this.invertPitch && pitch !== 0 ? -pitch : pitch;
    out.roll = this.cached.roll;
    return true;
  }

  private readonly cached: StickInput = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

  /** Link health for the failsafe (R1.9). */
  linkOk(now: number, source: SourceKind): boolean {
    if (source === 'bridge') return this.active === 'bridge' && this.bridge.connected && this.bridge.alive(now);
    if (source === 'gamepad') return this.active === 'gamepad' && this.gamepad.connected;
    return this.active === 'keyboard';
  }

  /** Age of the newest sample of the active source, ms. */
  inputAge(now: number): number {
    const slot = this.buffer.latest();
    return slot < 0 ? Infinity : now - this.buffer.time[slot];
  }

  sourceLabel(): string {
    if (this.active === 'bridge') return `bridge ${Math.round(this.bridge.rate)} Hz`;
    if (this.active === 'gamepad') return `gamepad${this.gamepad.standard ? '' : ' (non-std)'}`;
    return 'keyboard';
  }
}
