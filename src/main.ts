import './style.css';
import { loadSettings, saveSettings } from './config';
import { GameSession } from './game/session';
import { BTN, bit } from './input/buttons';
import type { SourceKind, StorageLike } from './input/calibration';
import { BIND, InputManager } from './input/inputManager';
import { DebugOverlay, type DebugInfo } from './render/debugOverlay';
import { DynamicResolution } from './render/dynamicResolution';
import { orbitCamera, syncFpvCamera } from './render/fpvCamera';
import { Osd } from './render/osd';
import { Renderer } from './render/renderer';
import { buildScene } from './render/scene';
import type { StickInput } from './sim/drone';
import { FREESTYLE_5 } from './sim/params';
import { CalibrationScreen } from './ui/calibrationScreen';
import { Menu } from './ui/menu';
import { BANDO } from './world/bando';
import { buildWorld } from './world/world';

type Mode = 'title' | 'playing' | 'paused' | 'calibrating' | 'exited';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');

function fatal(message: string): never {
  $('fatal-text').textContent = message;
  $('fatal').classList.remove('hidden');
  $('title').classList.add('hidden');
  throw new Error(message);
}

function storage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// ---------- setup ----------

const settings = loadSettings();
let renderer: Renderer;
try {
  renderer = new Renderer($<HTMLCanvasElement>('view'));
} catch (e) {
  fatal(`This browser can't run WebGL2 here (${(e as Error).message}). Use Chrome or Edge with hardware acceleration on.`);
}
renderer.setFov(settings.fovH);

const world = buildWorld(FREESTYLE_5.collisionRadius);
const view = buildScene(world, renderer.maxAnisotropy);
const params = new URLSearchParams(location.search);
const forcedSource = params.get('source');
const autoPause = params.get('autopause') !== '0';
const input = new InputManager(
  storage(),
  forcedSource === 'bridge' || forcedSource === 'gamepad' || forcedSource === 'keyboard' ? forcedSource : undefined,
);
const osd = new Osd(app);
osd.visible = false;
const debug = new DebugOverlay(app);
const dynres = new DynamicResolution({ max: settings.maxRenderScale });
const calibration = new CalibrationScreen(app, input);

let mode: Mode = 'title';
let session: GameSession | null = null;
let armSource: SourceKind = 'keyboard';
let simWall = performance.now();
let resetHeldSince = -1;
const sticks: StickInput = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

// ---------- screens ----------

const titleEl = $('title');
const pauseEl = $('pause');
const titleMenu = new Menu(titleEl.querySelector<HTMLElement>('.title-menu-slot')!, [
  { label: 'New Game', action: newGame },
  { label: 'Exit', action: exitGame },
]);
const pauseMenu = new Menu(pauseEl.querySelector<HTMLElement>('.menu-slot')!, [
  { label: 'Resume', action: resume },
  { label: 'Restart', action: restart },
  { label: 'Calibrate sticks', action: () => openCalibration(() => setMode('paused')) },
  { label: 'Quit to title', action: quitToTitle },
]);

function setMode(m: Mode): void {
  mode = m;
  titleEl.classList.toggle('hidden', m !== 'title');
  pauseEl.classList.toggle('hidden', m !== 'paused');
  $('bye').classList.toggle('hidden', m !== 'exited');
  osd.visible = session !== null && (m === 'playing' || m === 'paused');
  if (m === 'title') titleMenu.select(0);
  if (m === 'paused') pauseMenu.select(0);
}

function newGame(): void {
  if (input.hasController && !input.calibrated) {
    openCalibration((saved) => (saved ? beginGame() : setMode('title')));
  } else {
    beginGame();
  }
}

function beginGame(): void {
  session = new GameSession(world, FREESTYLE_5, settings.flight);
  simWall = performance.now();
  setMode('playing');
}

function resume(): void {
  simWall = performance.now(); // don't simulate the time spent paused
  setMode('playing');
}

function restart(): void {
  session?.reset(true);
  resume();
}

function quitToTitle(): void {
  session = null;
  setMode('title');
}

function openCalibration(done: (saved: boolean) => void): void {
  setMode('calibrating');
  calibration.start(done);
}

async function exitGame(): Promise<void> {
  setMode('exited');
  try {
    await fetch('/quit', { method: 'POST', headers: { 'X-FPV': 'quit' } });
  } catch {
    // bridge not running (dev server): nothing to stop
  }
  window.close();
  setTimeout(() => {
    $('bye-text').textContent = 'Bridge stopped. You can close this window.';
  }, 400);
}

// ---------- keyboard (menus + hotkeys; flying keys live in KeyboardSource) ----------

let keyPresses = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const inMenu = mode === 'title' || mode === 'paused' || mode === 'calibrating';
  let b = 0;
  switch (e.code) {
    case 'ArrowUp':
    case 'KeyW':
      if (inMenu) b = BIND.navUp;
      break;
    case 'ArrowDown':
    case 'KeyS':
      if (inMenu) b = BIND.navDown;
      break;
    case 'Enter':
      b = BIND.select;
      break;
    case 'Escape':
      b = mode === 'playing' ? BIND.pause : BIND.back;
      break;
    case 'Space':
      if (mode === 'playing') b = BIND.arm;
      else if (inMenu) b = BIND.select;
      break;
    case 'KeyR':
      if (mode === 'playing') b = bit(BTN.ZL);
      break;
    case 'PageUp':
      b = BIND.camUp;
      break;
    case 'PageDown':
      b = BIND.camDown;
      break;
    case 'F3':
      b = BIND.debug;
      break;
    case 'KeyC':
      if (mode === 'title') b = BIND.calibrate;
      break;
    default:
      return;
  }
  if (b) {
    keyPresses |= b;
    e.preventDefault();
  }
});

document.addEventListener('visibilitychange', () => {
  if (autoPause && document.hidden && mode === 'playing') setMode('paused');
});
window.addEventListener('resize', () => renderer.resize());

// ---------- per-mode frame logic ----------

function menuNav(menu: Menu, pressed: number): void {
  if (pressed & BIND.navUp) menu.move(-1);
  if (pressed & BIND.navDown) menu.move(1);
  if (pressed & BIND.select) menu.activate();
}

let statusNext = 0;
function updateTitleStatus(now: number): void {
  if (now < statusNext) return;
  statusNext = now + 250;
  const el = $('title-status');
  if (!input.hasController) {
    el.innerHTML = '<b class="bad">NO CONTROLLER</b>  Start play.bat and connect the Pro Controller.\nKeyboard works for testing: Enter selects.';
    return;
  }
  const cal = input.calibrated ? '<b>CALIBRATED</b>' : '<b class="bad">NOT CALIBRATED</b> (New Game will guide you)';
  el.innerHTML = `CONTROLLER <b>${input.sourceLabel().toUpperCase()}</b>\n${cal}  ·  − to recalibrate`;
}

function tilt(delta: number): void {
  settings.cameraTilt = Math.max(0, Math.min(60, settings.cameraTilt + delta));
  saveSettings(settings);
}

function playFrame(now: number, pressed: number): number {
  const s = session!;
  if (pressed & BIND.pause) {
    setMode('paused');
    return 0;
  }
  if (pressed & BIND.camUp) {
    tilt(5);
    osd.flashCamera(now);
  }
  if (pressed & BIND.camDown) {
    tilt(-5);
    osd.flashCamera(now);
  }
  if (pressed & BIND.arm) {
    input.sticksAt(now, sticks);
    if (s.toggleArm(sticks.throttle) && s.state === 'armed') armSource = input.active;
  }
  // Reset: instant when not flying; while armed it must be held (no accidental respawns).
  if (pressed & BIND.reset) {
    if (s.state !== 'armed' || !(input.held & BIND.reset)) s.reset();
    else resetHeldSince = now;
  }
  if (input.held & BIND.reset) {
    if (s.state === 'armed' && resetHeldSince > 0 && now - resetHeldSince > 600) {
      s.reset();
      resetHeldSince = -1;
    }
  } else {
    resetHeldSince = -1;
  }

  // Physics: fixed 1 ms steps up to "now", each fed the input sample matching its time (R10.3).
  const t0 = performance.now();
  if (now - simWall > 50) simWall = now - 50;
  let steps = 0;
  while (simWall + 1 <= now) {
    simWall += 1;
    input.sticksAt(simWall, sticks);
    const linkOk = s.state === 'armed' ? input.linkOk(now, armSource) : true;
    s.step(sticks, linkOk);
    steps++;
  }
  lastSteps = steps;
  syncFpvCamera(renderer.camera, s.drone, settings.cameraTilt);
  return performance.now() - t0;
}

// ---------- main loop ----------

let last = performance.now();
let lastSteps = 0;
const debugInfo = (): DebugInfo => {
  const info = renderer.three.info.render;
  const d = session?.drone;
  return {
    source: input.sourceLabel(),
    inputAgeMs: input.inputAge(performance.now()),
    physicsMs: 0,
    steps: lastSteps,
    width: renderer.width,
    height: renderer.height,
    scale: dynres.scale,
    calls: info.calls,
    triangles: info.triangles,
    speed: d ? d.speed() : 0,
    wash: d ? d.washSeverity : 0,
    current: d ? d.current : 0,
  };
};

function frame(): void {
  const now = performance.now();
  const interval = now - last;
  last = now;

  input.update(now);
  input.pressed |= keyPresses;
  keyPresses = 0;
  const pressed = input.pressed;
  if (pressed & BIND.debug) debug.toggle();

  let physicsMs = 0;
  switch (mode) {
    case 'title':
      updateTitleStatus(now);
      if (pressed & BIND.calibrate && input.hasController) openCalibration(() => setMode('title'));
      else menuNav(titleMenu, pressed);
      orbitCamera(renderer.camera, now / 1000, 0, 5, (BANDO.z0 + BANDO.z1) / 2);
      break;
    case 'paused':
      if (pressed & (BIND.back | BIND.pause)) resume();
      else menuNav(pauseMenu, pressed);
      break;
    case 'calibrating':
      calibration.update(now);
      if (!session) orbitCamera(renderer.camera, now / 1000, 0, 5, (BANDO.z0 + BANDO.z1) / 2);
      break;
    case 'playing':
      physicsMs = playFrame(now, pressed);
      break;
    case 'exited':
      break;
  }

  // Target: pulsing sphere + halo.
  view.target.visible = session !== null;
  if (session) {
    const t = session.targets;
    view.target.position.set(t.x, t.y, t.z);
    const pulse = 1 + 0.08 * Math.sin(now / 160);
    view.target.scale.setScalar(pulse);
    view.target.children[1].scale.setScalar(1 + 0.25 * Math.sin(now / 320));
  }
  view.sky.position.copy(renderer.camera.position);

  if (session && (mode === 'playing' || mode === 'paused')) {
    osd.update(now, session, renderer.camera, settings.cameraTilt, input.hasController);
  }

  if (mode === 'playing' && dynres.frame(interval, now)) renderer.setScale(dynres.scale);
  renderer.render(view.scene);
  debug.frame(interval, physicsMs, now, debugInfo);

  requestAnimationFrame(frame);
}

// Console/debug handle (read-only use): window.__fpv.session.drone etc.
Object.assign(window, {
  __fpv: {
    input,
    renderer,
    view,
    dynres,
    get session() { return session; },
    get mode() { return mode; },
  },
});

setMode('title');
requestAnimationFrame(frame);
