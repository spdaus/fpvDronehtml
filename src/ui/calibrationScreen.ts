import { BTN, bit } from '../input/buttons';
import {
  detectAxis,
  normalizeAxis,
  type AxisCal,
  type Calibration,
  type Channel,
} from '../input/calibration';
import type { InputManager } from '../input/inputManager';
import { MAX_AXES } from '../input/sampleBuffer';

/**
 * Guided stick calibration (design.md §3.4, R1.3): rest centres → full range → which axis is
 * which (push-and-hold per channel) → live check → save.
 */

type Step = 'center' | 'range' | Channel | 'check';

const STEPS: Step[] = ['center', 'range', 'throttle', 'yaw', 'pitch', 'roll', 'check'];

const PROMPT: Record<Step, [string, string]> = {
  center: ['Let go of both sticks', 'Hands off. Hold still for a moment while the rest positions are measured.'],
  range: ['Circle both sticks', 'Slowly roll both sticks around their outer edge 2–3 times, then let go.'],
  throttle: ['Throttle: LEFT stick UP', 'Push the left stick all the way up and hold it.'],
  yaw: ['Yaw: LEFT stick RIGHT', 'Push the left stick all the way right and hold it.'],
  pitch: ['Pitch: RIGHT stick UP', 'Push the right stick all the way up (forward) and hold it.'],
  roll: ['Roll: RIGHT stick RIGHT', 'Push the right stick all the way right and hold it.'],
  check: ['Check your sticks', 'Move the sticks: the dots should follow. Press A to save, B to cancel.'],
};

const STILL_TOLERANCE = 0.03;
const STILL_TIME = 800;
const HOLD_TIME = 350;
const RELEASE = 0.2;
const MIN_TRAVEL = 0.35;

export class CalibrationScreen {
  readonly el: HTMLElement;
  open = false;
  private step: Step = 'center';
  private work!: Calibration;
  private readonly ref = new Float32Array(MAX_AXES);
  private readonly sum = new Float64Array(MAX_AXES);
  private sumN = 0;
  private stillSince = 0;
  private holdAxis = -1;
  private holdSince = 0;
  private waitRelease = false;
  private readonly taken = new Set<number>();
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly stepLabel: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly sticks: HTMLElement;
  private readonly dotL: HTMLElement;
  private readonly dotR: HTMLElement;
  private readonly barEls: Array<{ fill: HTMLElement; mark: HTMLElement; row: HTMLElement }> = [];
  private readonly buttonsEl: HTMLElement;
  private lastHeld = -1;
  private onClose: (saved: boolean) => void = () => {};

  constructor(parent: HTMLElement, private readonly input: InputManager) {
    this.el = document.createElement('div');
    this.el.id = 'calibration';
    this.el.className = 'screen hidden';
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-kicker"><span class="cal-step"></span> · STICK CALIBRATION</div>
        <h2 class="cal-title"></h2>
        <p class="cal-body"></p>
        <div class="cal-progress"><i></i></div>
        <div class="cal-bars"></div>
        <div class="cal-sticks">
          <div class="stick"><span class="stick-label">L</span><i class="dot-l"></i></div>
          <div class="stick"><span class="stick-label">R</span><i class="dot-r"></i></div>
        </div>
        <div class="panel-foot"><span>B / Esc — cancel</span><span class="cal-buttons"></span></div>
      </div>`;
    parent.appendChild(this.el);
    this.title = this.el.querySelector('.cal-title')!;
    this.body = this.el.querySelector('.cal-body')!;
    this.stepLabel = this.el.querySelector('.cal-step')!;
    this.progress = this.el.querySelector('.cal-progress i')!;
    this.bars = this.el.querySelector('.cal-bars')!;
    this.sticks = this.el.querySelector('.cal-sticks')!;
    this.dotL = this.el.querySelector('.dot-l')!;
    this.dotR = this.el.querySelector('.dot-r')!;
    this.buttonsEl = this.el.querySelector('.cal-buttons')!;
    for (let i = 0; i < MAX_AXES; i++) {
      const row = document.createElement('div');
      row.className = 'cal-bar';
      row.innerHTML = `<span>AXIS ${i}</span><div><b></b><i></i></div>`;
      this.bars.appendChild(row);
      this.barEls.push({ row, fill: row.querySelector('b')!, mark: row.querySelector('i')! });
    }
  }

  start(onClose: (saved: boolean) => void): void {
    this.onClose = onClose;
    this.open = true;
    const base = this.input.calibration;
    this.work = {
      ...base,
      axes: Array.from({ length: MAX_AXES }, () => ({ center: 0, min: 0, max: 0 })),
      throttle: { ...base.throttle },
      yaw: { ...base.yaw },
      pitch: { ...base.pitch },
      roll: { ...base.roll },
    };
    this.taken.clear();
    this.el.classList.remove('hidden');
    this.goto('center', performance.now());
  }

  private close(saved: boolean): void {
    this.open = false;
    this.el.classList.add('hidden');
    this.onClose(saved);
  }

  private goto(step: Step, now: number): void {
    this.step = step;
    this.stillSince = now;
    this.ref.set(this.input.raw);
    this.sum.fill(0);
    this.sumN = 0;
    this.holdAxis = -1;
    this.waitRelease = false;
    const [t, b] = PROMPT[step];
    this.title.textContent = t;
    this.body.textContent = b;
    this.stepLabel.textContent = `STEP ${STEPS.indexOf(step) + 1} / ${STEPS.length}`;
    this.bars.style.display = step === 'range' ? '' : 'none';
    this.sticks.style.display = step === 'check' ? '' : 'none';
    this.setProgress(0);
  }

  private setProgress(p: number): void {
    this.progress.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
  }

  /** Per frame, after input.update(). */
  update(now: number): void {
    if (!this.open) return;
    const raw = this.input.raw;
    const pressed = this.input.pressed;
    this.showHeld(this.input.held);
    if (pressed & bit(BTN.B)) {
      this.close(false);
      return;
    }
    if (!this.input.hasController) {
      this.title.textContent = 'No controller detected';
      this.body.textContent = 'Connect the controller and make sure the bridge (play.bat) is running.';
      return;
    }
    if (this.title.textContent === 'No controller detected') this.goto(this.step, now);

    switch (this.step) {
      case 'center': {
        let moved = false;
        for (let i = 0; i < MAX_AXES; i++) if (Math.abs(raw[i] - this.ref[i]) > STILL_TOLERANCE) moved = true;
        if (moved) {
          this.ref.set(raw);
          this.stillSince = now;
          this.sum.fill(0);
          this.sumN = 0;
        }
        for (let i = 0; i < MAX_AXES; i++) this.sum[i] += raw[i];
        this.sumN++;
        this.setProgress((now - this.stillSince) / STILL_TIME);
        if (now - this.stillSince >= STILL_TIME) {
          for (let i = 0; i < MAX_AXES; i++) {
            const c = this.sum[i] / this.sumN;
            this.work.axes[i] = { center: c, min: c, max: c };
          }
          this.goto('range', now);
        }
        break;
      }
      case 'range': {
        let ready = 0;
        for (let i = 0; i < MAX_AXES; i++) {
          const a = this.work.axes[i];
          if (raw[i] < a.min) a.min = raw[i];
          if (raw[i] > a.max) a.max = raw[i];
          const ok = a.max - a.center > MIN_TRAVEL && a.center - a.min > MIN_TRAVEL;
          if (ok) ready++;
          this.drawBar(i, a, raw[i], ok);
        }
        this.setProgress(ready / 4);
        // Done once four axes have full travel and the sticks are back at rest for a moment.
        let atRest = true;
        for (let i = 0; i < MAX_AXES; i++) {
          if (Math.abs(normalizeAxis(raw[i], this.work.axes[i], 0)) > RELEASE) atRest = false;
        }
        if (ready < 4 || !atRest) this.stillSince = now;
        this.body.textContent = ready >= 4 ? 'Great — now let go of both sticks.' : PROMPT.range[1];
        if (ready >= 4 && (now - this.stillSince > 600 || pressed & bit(BTN.A))) this.goto('throttle', now);
        break;
      }
      case 'throttle':
      case 'yaw':
      case 'pitch':
      case 'roll': {
        const ch = this.step;
        if (this.waitRelease) {
          let released = true;
          for (const i of this.taken) if (Math.abs(normalizeAxis(raw[i], this.work.axes[i], 0)) > RELEASE) released = false;
          if (released) this.goto(STEPS[STEPS.indexOf(ch) + 1], now);
          break;
        }
        const hit = detectAxis(raw, this.work.axes, this.taken);
        if (!hit || hit.axis !== this.holdAxis) {
          this.holdAxis = hit ? hit.axis : -1;
          this.holdSince = now;
        }
        this.setProgress(hit ? (now - this.holdSince) / HOLD_TIME : 0);
        if (hit && now - this.holdSince >= HOLD_TIME) {
          this.work[ch] = { axis: hit.axis, invert: hit.sign < 0 };
          this.taken.add(hit.axis);
          this.waitRelease = true;
          this.body.textContent = 'Got it — now let go.';
        }
        break;
      }
      case 'check': {
        const v = (c: Channel) => {
          const m = this.work[c];
          const n = normalizeAxis(raw[m.axis], this.work.axes[m.axis], this.work.deadzone);
          return m.invert ? -n : n;
        };
        this.dotL.style.transform = `translate(${v('yaw') * 36}px, ${-v('throttle') * 36}px)`;
        this.dotR.style.transform = `translate(${v('roll') * 36}px, ${-v('pitch') * 36}px)`;
        this.setProgress(1);
        if (pressed & bit(BTN.A)) {
          this.input.setCalibration(this.work);
          this.close(true);
        }
        break;
      }
    }
  }

  private showHeld(held: number): void {
    if (held === this.lastHeld) return;
    this.lastHeld = held;
    const names = Object.entries(BTN)
      .filter(([, b]) => held & bit(b))
      .map(([n]) => n);
    this.buttonsEl.textContent = names.length ? `HELD: ${names.join(' ')}` : '';
  }

  private drawBar(i: number, a: AxisCal, raw: number, ok: boolean): void {
    const e = this.barEls[i];
    const pct = (x: number) => `${((x + 1) / 2) * 100}%`;
    e.fill.style.left = pct(a.min);
    e.fill.style.width = `${((a.max - a.min) / 2) * 100}%`;
    e.mark.style.left = pct(raw);
    e.row.classList.toggle('ok', ok);
  }
}
