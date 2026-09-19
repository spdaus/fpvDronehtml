import * as THREE from 'three';
import { TARGET_RADIUS } from '../game/targets';
import { mulberry32 } from '../sim/math';
import type { Box } from '../world/boxes';
import type { Tree } from '../world/park';
import { WORLD_HALF, type World } from '../world/world';

/**
 * Static world → a handful of draw calls (design.md §9, R9.3): all boxes merged into one mesh,
 * trees as two InstancedMeshes, ground, sky, and the target (sphere + halo).
 */

export const SKY_ZENITH = 0x4f86cf;
export const SKY_HORIZON = 0xc9dcea;

export interface WorldView {
  scene: THREE.Scene;
  target: THREE.Group;
  sky: THREE.Mesh;
}

export function buildScene(world: World, maxAnisotropy: number): WorldView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(SKY_HORIZON, 70, 330);

  // Three's lights are physically based (Lambert divides by π), hence the large intensities.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a4034, 2.6));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.position.set(-0.45, 1, 0.55).normalize();
  scene.add(sun);

  scene.add(boxesMesh(world.boxes));
  scene.add(groundMesh(maxAnisotropy));
  for (const m of treeMeshes(world.trees)) scene.add(m);

  const sky = skyDome();
  scene.add(sky);

  const target = targetMesh();
  scene.add(target);

  return { scene, target, sky };
}

/** One non-indexed geometry for every box, with vertex colours and a grime gradient on walls. */
function boxesMesh(boxes: readonly Box[]): THREE.Mesh {
  const n = boxes.length * 36;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const rnd = mulberry32(99);
  const c = new THREE.Color();
  let v = 0;

  // Faces: [normal axis, sign, the two in-plane axes]
  const faces: Array<[number, 1 | -1]> = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  const corner = [0, 0, 0];

  for (const b of boxes) {
    c.setHex(b.color);
    const vary = b.kind === 'decal' ? 1 : 0.92 + rnd() * 0.16;
    const grime = b.kind === 'wall' || b.kind === 'pillar' || b.kind === 'container' || b.kind === 'rubble';
    const h = b.max[1] - b.min[1];
    for (const [axis, sign] of faces) {
      const u = (axis + 1) % 3;
      const w = (axis + 2) % 3;
      // Two triangles, wound counter-clockwise when viewed from outside.
      const quad: Array<[number, number]> = sign > 0
        ? [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
        : [[0, 0], [1, 1], [1, 0], [0, 0], [0, 1], [1, 1]];
      const shade = axis === 1 ? (sign > 0 ? 1 : 0.55) : 0.9; // ceilings darker (fake occlusion)
      for (const [qu, qw] of quad) {
        corner[axis] = sign > 0 ? b.max[axis] : b.min[axis];
        corner[u] = qu ? b.max[u] : b.min[u];
        corner[w] = qw ? b.max[w] : b.min[w];
        pos[v * 3] = corner[0];
        pos[v * 3 + 1] = corner[1];
        pos[v * 3 + 2] = corner[2];
        nor[v * 3 + axis] = sign;
        let k = vary * shade;
        if (grime && h > 0.5) {
          const rel = Math.min(1, (corner[1] - b.min[1]) / Math.min(h, 3));
          k *= 0.78 + 0.22 * rel;
        }
        col[v * 3] = c.r * k;
        col[v * 3 + 1] = c.g * k;
        col[v * 3 + 2] = c.b * k;
        v++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Grass: a fine procedural detail texture (speed cues) × coarse vertex-colour patches (no tiling look). */
function groundMesh(maxAnisotropy: number): THREE.Mesh {
  const size = WORLD_HALF * 2 + 200;
  const seg = 80;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const count = g.attributes.position.count;
  const col = new Float32Array(count * 3);
  const base = new THREE.Color(0x587634);
  const dry = new THREE.Color(0x807e48);
  const dark = new THREE.Color(0x3c5827);
  const tmp = new THREE.Color();
  const p = g.attributes.position;
  for (let i = 0; i < count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const n1 = valueNoise(x / 60, z / 60, 1);
    const n2 = valueNoise(x / 17, z / 17, 2);
    tmp.copy(base).lerp(dry, Math.max(0, n1 - 0.45) * 1.6).lerp(dark, Math.max(0, n2 - 0.55) * 1.2);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const tex = grassTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 6, size / 6);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function grassTexture(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const rnd = mulberry32(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Tileable blotches + per-pixel speckle, near-white so vertex colours set the hue.
      const n = tileNoise(x / S, y / S, 8) * 0.5 + tileNoise(x / S, y / S, 32) * 0.3;
      const v = 0.62 + n * 0.3 + (rnd() - 0.5) * 0.18;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, v * 255);
      img.data[i + 1] = Math.min(255, v * 262);
      img.data[i + 2] = Math.min(255, v * 235);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

function treeMeshes(trees: readonly Tree[]): THREE.InstancedMesh[] {
  const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const deep = new THREE.Color(0x2f5a2a);
  const light = new THREE.Color(0x5f8a3a);
  trees.forEach((t, i) => {
    m.makeScale(t.trunkR, t.trunkH, t.trunkR).setPosition(t.x, 0, t.z);
    trunks.setMatrixAt(i, m);
    trunks.setColorAt(i, c.setHex(0x5a4330).multiplyScalar(0.85 + t.tint * 0.3));
    m.makeScale(t.canopyR, t.canopyH, t.canopyR).setPosition(t.x, t.trunkH - 0.3, t.z);
    cones.setMatrixAt(i, m);
    cones.setColorAt(i, c.copy(deep).lerp(light, t.tint));
  });
  for (const im of [trunks, cones]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
  }
  return [trunks, cones];
}

function skyDome(): THREE.Mesh {
  const g = new THREE.SphereGeometry(380, 24, 12);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const zen = new THREE.Color(SKY_ZENITH);
  const hor = new THREE.Color(SKY_HORIZON);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i) / 380);
    tmp.copy(hor).lerp(zen, Math.pow(t, 0.6));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

function targetMesh(): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(TARGET_RADIUS, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xff2d6f, fog: false }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(TARGET_RADIUS * 1.9, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0xff7aa8,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  halo.name = 'halo';
  group.add(core, halo);
  return group;
}

// --- tiny deterministic noise helpers ---

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Value noise that tiles on the unit square with `cells` cells per side. */
function tileNoise(u: number, v: number, cells: number): number {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % cells) + cells) % cells;
  const a = hash2(w(xi), w(yi), cells), b = hash2(w(xi + 1), w(yi), cells);
  const c = hash2(w(xi), w(yi + 1), cells), d = hash2(w(xi + 1), w(yi + 1), cells);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
