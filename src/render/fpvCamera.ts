import * as THREE from 'three';
import type { Drone } from '../sim/drone';
import { DEG2RAD } from '../sim/math';

/**
 * Camera mount in the body frame: slightly up and ahead of centre (design.md §9, R8.1). Kept close to
 * the centre so the near plane never reaches a surface the collision sphere is touching.
 */
export const MOUNT = new THREE.Vector3(0, 0.02, -0.03);

const qDrone = new THREE.Quaternion();
const qTilt = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);
const offset = new THREE.Vector3();

/** Rigidly attach the camera to the quad: no smoothing, uptilt about body X. */
export function syncFpvCamera(camera: THREE.Camera, d: Drone, tiltDeg: number): void {
  qDrone.set(d.qx, d.qy, d.qz, d.qw);
  offset.copy(MOUNT).applyQuaternion(qDrone);
  camera.position.set(d.px + offset.x, d.py + offset.y, d.pz + offset.z);
  qTilt.setFromAxisAngle(xAxis, tiltDeg * DEG2RAD);
  camera.quaternion.copy(qDrone).multiply(qTilt);
}

/** Slow cinematic orbit around a point (title screen backdrop). */
export function orbitCamera(camera: THREE.Camera, t: number, cx: number, cy: number, cz: number): void {
  const a = t * 0.06 + 2.2;
  const r = 46;
  camera.position.set(cx + Math.cos(a) * r, cy + 9 + Math.sin(t * 0.13) * 3, cz + Math.sin(a) * r);
  camera.lookAt(cx, cy, cz);
}
