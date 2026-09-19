import * as THREE from 'three';
import { ARM_THROTTLE_MAX, type GameSession } from '../game/session';
import { TARGET_RADIUS } from '../game/targets';
import { DEG2RAD } from '../sim/math';

/**
 * Betaflight-style OSD as a DOM layer (design.md §9, R7.5, R8.3–R8.4). Text updates at ≤ 20 Hz and
 * only when a value changes; the target bracket/chevron move by transform every frame.
 */

const FIELDS = ['score', 'times', 'dist', 'volt', 'mah', 'timer', 'thr', 'speed', 'alt', 'warn', 'hint', 'cam'] as const;
type Field = (typeof FIELDS)[number];

const tmp = new THREE.Vector3();
const inv = new THREE.Matrix4();

export class Osd {
  readonly root: HTMLElement;
  private readonly el = {} as Record<Field, HTMLElement>;
  private readonly last = {} as Record<Field, string>;
  private readonly bracket: HTMLElement;
  private readonly chevron: HTMLElement;
  private nextText = 0;
  private camMsgUntil = 0;
  private hitFlashUntil = 0;
  private lastHits = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'osd';
    this.root.innerHTML = `
      <div class="osd-crosshair"></div>
      <div class="osd-bracket"><i></i><i></i><i></i><i></i></div>
      <div class="osd-chevron"></div>`;
    for (const f of FIELDS) {
      const e = document.createElement('div');
      e.className = `osd-f osd-${f}`;
      this.root.appendChild(e);
      this.el[f] = e;
      this.last[f] = '';
    }
    this.bracket = this.root.querySelector('.osd-bracket')!;
    this.chevron = this.root.querySelector('.osd-chevron')!;
    parent.appendChild(this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  flashCamera(nowMs: number): void {
    this.camMsgUntil = nowMs + 1200;
    this.nextText = 0;
  }

  private text(f: Field, s: string): void {
    if (this.last[f] !== s) {
      this.last[f] = s;
      this.el[f].textContent = s;
    }
  }

  update(nowMs: number, s: GameSession, camera: THREE.PerspectiveCamera, tilt: number, hasController: boolean): void {
    this.updateMarker(s, camera);
    if (s.targets.hits !== this.lastHits) {
      this.lastHits = s.targets.hits;
      this.hitFlashUntil = nowMs + 700;
      this.nextText = 0;
    }
    if (nowMs < this.nextText) return;
    this.nextText = nowMs + 50;

    const d = s.drone;
    const t = s.targets;
    this.text('score', `SCORE ${t.score}`);
    const fmt = (v: number | null) => (v === null ? '--.-' : v.toFixed(1));
    this.text('times', `LAST ${fmt(t.lastTime)}  BEST ${fmt(t.bestTime)}`);
    const dist = Math.hypot(t.x - d.px, t.y - d.py, t.z - d.pz);
    this.text('dist', nowMs < this.hitFlashUntil ? 'TARGET HIT!' : `TGT ${dist < 10 ? dist.toFixed(1) : dist.toFixed(0)}M`);
    const cells = d.params.battery.cells;
    const lowBat = d.voltage / cells < 3.5;
    this.text('volt', `${d.voltage.toFixed(1)}V${lowBat ? ' LOW' : ''}`);
    this.text('mah', `${Math.round(d.mAhUsed)}MAH`);
    const secs = Math.floor(s.flightTime);
    this.text('timer', `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`);
    this.text('thr', `THR ${Math.round(d.throttleOut * 100)}%`);
    this.text('speed', `${Math.round(d.speed() * 3.6)}KM/H`);
    this.text('alt', `${d.py.toFixed(1)}M`);
    this.text('cam', nowMs < this.camMsgUntil ? `CAM ${tilt}°` : '');

    let warn = '';
    let hint = '';
    if (s.failsafe) warn = 'FAILSAFE';
    else if (s.state === 'crashed') {
      warn = 'CRASHED';
      hint = hasController ? 'PRESS B OR ZL TO RESET' : 'PRESS R TO RESET';
    } else if (s.time < s.armWarnUntil) warn = 'THROTTLE LOW TO ARM';
    else if (!hasController) {
      warn = s.state === 'disarmed' ? 'NO CONTROLLER' : '';
      hint = 'KEYBOARD: W/S THR  A/D YAW  ARROWS PITCH/ROLL  SPACE ARM  R RESET';
    } else if (s.state === 'disarmed') {
      warn = 'DISARMED';
      const stickPct = Math.round(s.throttleStick * 100);
      hint = `THROTTLE STICK ${stickPct}% · HOLD IT DOWN (< ${Math.round(ARM_THROTTLE_MAX * 100)}%) + ZR TO ARM`;
    } else if (lowBat) warn = 'LOW BATTERY';
    this.text('warn', warn);
    this.text('hint', hint);
    this.el.warn.classList.toggle('blink', warn === 'CRASHED' || warn === 'FAILSAFE' || warn === 'LOW BATTERY');
    this.el.dist.classList.toggle('hit', nowMs < this.hitFlashUntil);
  }

  private updateMarker(s: GameSession, camera: THREE.PerspectiveCamera): void {
    const t = s.targets;
    camera.updateMatrixWorld();
    inv.copy(camera.matrixWorld).invert();
    tmp.set(t.x, t.y, t.z).applyMatrix4(inv); // camera space: x right, y up, −z forward
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dist = tmp.length();
    const tanV = Math.tan((camera.fov * DEG2RAD) / 2);
    const tanH = tanV * camera.aspect;
    const ahead = tmp.z < -0.01;
    const nx = ahead ? tmp.x / (-tmp.z * tanH) : 0;
    const ny = ahead ? tmp.y / (-tmp.z * tanV) : 0;
    if (ahead && Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95) {
      const px = ((nx + 1) / 2) * W;
      const py = ((1 - ny) / 2) * H;
      const size = Math.max(18, Math.min(220, ((TARGET_RADIUS * 2.6) / Math.max(dist, 0.1) / tanV) * (H / 2)));
      this.bracket.style.display = '';
      this.bracket.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`;
      this.bracket.style.width = this.bracket.style.height = `${size}px`;
      this.chevron.style.display = 'none';
    } else {
      // Off screen: chevron on an ellipse, pointing toward the target.
      let dx = tmp.x;
      let dy = tmp.y;
      if (Math.abs(dx) + Math.abs(dy) < 1e-6) dy = -1;
      const a = Math.atan2(dy, dx);
      const px = W / 2 + Math.cos(a) * W * 0.36;
      const py = H / 2 - Math.sin(a) * H * 0.34;
      this.chevron.style.display = '';
      this.chevron.style.transform = `translate(${px}px, ${py}px) rotate(${-a}rad)`;
      this.bracket.style.display = 'none';
    }
  }
}
