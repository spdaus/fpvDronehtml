import * as THREE from 'three';
import { DEG2RAD } from '../sim/math';

/**
 * Clip planes. The near plane must stay inside the quad's collision sphere together with the camera
 * mount (see fpvCamera.ts), or brushing a wall lets the view cut through it and flash the sky behind.
 */
export const NEAR = 0.02;
export const FAR = 350;

/** Base internal resolution height at scale 1 (FPV goggle-like 720p). */
export const BASE_HEIGHT = 720;

/**
 * WebGL2 renderer with low-latency context hints and an explicit internal resolution that the
 * browser upscales to the window (design.md §9, R9.2, R10.4).
 */
export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  width = 0;
  height = 0;
  private scale = 1;
  private fovH = 110;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    // No `desynchronized`: that low-latency canvas can present a frame while it is still being
    // drawn, which shows up as flashes of the (pale sky) clear colour.
    if (!context) throw new Error('WebGL2 is not available');
    this.three = new THREE.WebGLRenderer({ canvas, context, antialias: false });
    this.three.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, NEAR, FAR);
    this.camera.rotation.order = 'YXZ';
    this.resize();
  }

  get maxAnisotropy(): number {
    return this.three.capabilities.getMaxAnisotropy();
  }

  setScale(scale: number): void {
    if (scale !== this.scale) {
      this.scale = scale;
      this.resize();
    }
  }

  setFov(fovH: number): void {
    this.fovH = fovH;
    this.updateProjection();
  }

  /** Fit the internal resolution to the window aspect at the current scale. */
  resize(): void {
    const aspect = Math.max(0.5, window.innerWidth / Math.max(1, window.innerHeight));
    const h = Math.round(BASE_HEIGHT * this.scale);
    const w = Math.round(h * aspect);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.three.setSize(w, h, false);
    this.updateProjection();
  }

  private updateProjection(): void {
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    this.camera.fov = 2 * Math.atan(Math.tan((this.fovH * DEG2RAD) / 2) / aspect) / DEG2RAD;
    this.camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene): void {
    this.three.render(scene, this.camera);
  }
}
