import type { Drone } from './drone';

/**
 * Sphere-vs-world collision (design.md §7, R5). Colliders live in flat typed arrays with a uniform
 * XZ grid broadphase. Each collider is inserted into every cell its XZ footprint (grown by
 * `QUERY_MARGIN`) touches, so a query for any sphere up to that radius needs exactly one cell.
 */

export type Shape =
  | { kind: 'box'; min: readonly [number, number, number]; max: readonly [number, number, number] }
  | { kind: 'cylinder'; x: number; z: number; r: number; y0: number; y1: number }
  | { kind: 'sphere'; x: number; y: number; z: number; r: number };

const BOX = 0;
const CYL = 1;
const SPH = 2;
const STRIDE = 6;

export const QUERY_MARGIN = 1.0;

export interface ContactReport {
  contacts: number;
  /** Largest normal impact speed this step, m/s. */
  maxImpact: number;
}

export interface WorldBounds {
  /** Half-size of the square play area, m. */
  half: number;
  ceiling: number;
}

export class CollisionWorld {
  readonly count: number;
  private readonly type: Uint8Array;
  private readonly data: Float64Array;
  private readonly cellSize = 4;
  private readonly dim: number;
  private readonly origin: number;
  private readonly cellStart: Int32Array;
  private readonly items: Int32Array;

  constructor(shapes: readonly Shape[], readonly bounds: WorldBounds = { half: 200, ceiling: 120 }) {
    this.count = shapes.length;
    this.type = new Uint8Array(shapes.length);
    this.data = new Float64Array(shapes.length * STRIDE);
    shapes.forEach((s, i) => {
      const o = i * STRIDE;
      if (s.kind === 'box') {
        this.type[i] = BOX;
        this.data.set([s.min[0], s.min[1], s.min[2], s.max[0], s.max[1], s.max[2]], o);
      } else if (s.kind === 'cylinder') {
        this.type[i] = CYL;
        this.data.set([s.x, s.z, s.r, s.y0, s.y1, 0], o);
      } else {
        this.type[i] = SPH;
        this.data.set([s.x, s.y, s.z, s.r, 0, 0], o);
      }
    });

    this.origin = -bounds.half;
    this.dim = Math.ceil((2 * bounds.half) / this.cellSize);
    const cells: number[][] = Array.from({ length: this.dim * this.dim }, () => []);
    shapes.forEach((s, i) => {
      const [x0, z0, x1, z1] = footprint(s);
      const c0 = this.cellCoord(x0 - QUERY_MARGIN), c1 = this.cellCoord(x1 + QUERY_MARGIN);
      const r0 = this.cellCoord(z0 - QUERY_MARGIN), r1 = this.cellCoord(z1 + QUERY_MARGIN);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * this.dim + c].push(i);
    });
    this.cellStart = new Int32Array(cells.length + 1);
    let n = 0;
    cells.forEach((list, k) => {
      this.cellStart[k] = n;
      n += list.length;
    });
    this.cellStart[cells.length] = n;
    this.items = new Int32Array(n);
    let w = 0;
    for (const list of cells) for (const i of list) this.items[w++] = i;
  }

  private cellCoord(v: number): number {
    return Math.min(this.dim - 1, Math.max(0, Math.floor((v - this.origin) / this.cellSize)));
  }

  private cellOf(x: number, z: number): number {
    return this.cellCoord(z) * this.dim + this.cellCoord(x);
  }

  /** True if a sphere overlaps any collider or the ground (r ≤ QUERY_MARGIN). */
  sphereOverlaps(x: number, y: number, z: number, r: number): boolean {
    if (y < r) return true;
    const cell = this.cellOf(x, z);
    for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
      if (this.closest(this.items[k], x, y, z) < r * r) return true;
    }
    return false;
  }

  // Closest point on collider i to (x, y, z) is written here by closest().
  private cx = 0;
  private cy = 0;
  private cz = 0;

  /** Squared distance from a point to collider i; closest point left in cx/cy/cz. Inside → 0. */
  private closest(i: number, x: number, y: number, z: number): number {
    const d = this.data;
    const o = i * STRIDE;
    const t = this.type[i];
    if (t === BOX) {
      this.cx = x < d[o] ? d[o] : x > d[o + 3] ? d[o + 3] : x;
      this.cy = y < d[o + 1] ? d[o + 1] : y > d[o + 4] ? d[o + 4] : y;
      this.cz = z < d[o + 2] ? d[o + 2] : z > d[o + 5] ? d[o + 5] : z;
    } else if (t === CYL) {
      const ax = d[o], az = d[o + 1], r = d[o + 2];
      this.cy = y < d[o + 3] ? d[o + 3] : y > d[o + 4] ? d[o + 4] : y;
      const rx = x - ax, rz = z - az;
      const rd = Math.sqrt(rx * rx + rz * rz);
      if (rd > r) {
        this.cx = ax + (rx / rd) * r;
        this.cz = az + (rz / rd) * r;
      } else {
        this.cx = x;
        this.cz = z;
      }
    } else {
      const sx = d[o], sy = d[o + 1], sz = d[o + 2], r = d[o + 3];
      const vx = x - sx, vy = y - sy, vz = z - sz;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (len > r) {
        this.cx = sx + (vx / len) * r;
        this.cy = sy + (vy / len) * r;
        this.cz = sz + (vz / len) * r;
      } else {
        this.cx = x; this.cy = y; this.cz = z;
      }
    }
    const dx = x - this.cx, dy = y - this.cy, dz = z - this.cz;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Push-out direction for a centre that ended up inside collider i (should not happen at ≤ 40 m/s). */
  private insideNormal(i: number, x: number, y: number, z: number, out: Float64Array): number {
    const d = this.data;
    const o = i * STRIDE;
    const t = this.type[i];
    if (t === BOX) {
      const pen = [x - d[o], d[o + 3] - x, y - d[o + 1], d[o + 4] - y, z - d[o + 2], d[o + 5] - z];
      let best = 0;
      for (let k = 1; k < 6; k++) if (pen[k] < pen[best]) best = k;
      out[0] = best === 0 ? -1 : best === 1 ? 1 : 0;
      out[1] = best === 2 ? -1 : best === 3 ? 1 : 0;
      out[2] = best === 4 ? -1 : best === 5 ? 1 : 0;
      return pen[best];
    }
    if (t === CYL) {
      const rx = x - d[o], rz = z - d[o + 1];
      const rd = Math.sqrt(rx * rx + rz * rz) || 1e-9;
      out[0] = rx / rd; out[1] = 0; out[2] = rz / rd;
      return d[o + 2] - rd;
    }
    out[0] = 0; out[1] = 1; out[2] = 0;
    return d[o + 3];
  }

  private readonly n = new Float64Array(3);

  /** Resolve all contacts for the drone's sphere this step, applying impulses in place. */
  resolve(drone: Drone, report: ContactReport): void {
    report.contacts = 0;
    report.maxImpact = 0;
    const r = drone.params.collisionRadius;
    const n = this.n;

    // Ground plane.
    if (drone.py < r) {
      n[0] = 0; n[1] = 1; n[2] = 0;
      applyContact(drone, n, r - drone.py, report);
    }
    // Play-area walls and ceiling.
    const B = this.bounds.half;
    if (drone.px > B - r) { n[0] = -1; n[1] = 0; n[2] = 0; applyContact(drone, n, drone.px - (B - r), report); }
    if (drone.px < -B + r) { n[0] = 1; n[1] = 0; n[2] = 0; applyContact(drone, n, -B + r - drone.px, report); }
    if (drone.pz > B - r) { n[0] = 0; n[1] = 0; n[2] = -1; applyContact(drone, n, drone.pz - (B - r), report); }
    if (drone.pz < -B + r) { n[0] = 0; n[1] = 0; n[2] = 1; applyContact(drone, n, -B + r - drone.pz, report); }
    if (drone.py > this.bounds.ceiling - r) { n[0] = 0; n[1] = -1; n[2] = 0; applyContact(drone, n, drone.py - (this.bounds.ceiling - r), report); }

    const cell = this.cellOf(drone.px, drone.pz);
    for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
      const i = this.items[k];
      const d2 = this.closest(i, drone.px, drone.py, drone.pz);
      if (d2 >= r * r) continue;
      let depth: number;
      if (d2 > 1e-18) {
        const dist = Math.sqrt(d2);
        n[0] = (drone.px - this.cx) / dist;
        n[1] = (drone.py - this.cy) / dist;
        n[2] = (drone.pz - this.cz) / dist;
        depth = r - dist;
      } else {
        depth = this.insideNormal(i, drone.px, drone.py, drone.pz, n) + r;
      }
      applyContact(drone, n, depth, report);
    }
  }
}

function footprint(s: Shape): [number, number, number, number] {
  if (s.kind === 'box') return [s.min[0], s.min[2], s.max[0], s.max[2]];
  return [s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r];
}

/** Motor radius from centre (quad-X arm offset × √2): where prop strikes happen. */
const PROP_ARM = 0.1125;
const MAX_JOLT = 30;

/**
 * Positional correction + restitution + Coulomb friction, plus an angular jolt for real hits: the
 * contact is placed at the prop tips nearest the obstacle, so off-centre hits tumble the quad.
 */
function applyContact(d: Drone, n: Float64Array, depth: number, report: ContactReport): void {
  const p = d.params;
  const nx = n[0], ny = n[1], nz = n[2];
  d.px += nx * depth;
  d.py += ny * depth;
  d.pz += nz * depth;
  d.sinceContact = 0;
  report.contacts++;

  const vn = d.vx * nx + d.vy * ny + d.vz * nz;
  if (vn >= 0) return;
  const impact = -vn;
  if (impact > report.maxImpact) report.maxImpact = impact;

  const v0x = d.vx, v0y = d.vy, v0z = d.vz;
  const e = p.restitution;
  d.vx -= (1 + e) * vn * nx;
  d.vy -= (1 + e) * vn * ny;
  d.vz -= (1 + e) * vn * nz;
  const vn2 = d.vx * nx + d.vy * ny + d.vz * nz;
  const tx = d.vx - vn2 * nx, ty = d.vy - vn2 * ny, tz = d.vz - vn2 * nz;
  const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (vt > 1e-9) {
    const dv = Math.min(vt, p.friction * (1 + e) * impact) / vt;
    d.vx -= tx * dv;
    d.vy -= ty * dv;
    d.vz -= tz * dv;
  }

  // Resting contact: bleed off spin so a quad lying on the ground settles.
  const damp = 0.995;
  d.wx *= damp; d.wy *= damp; d.wz *= damp;

  if (impact < 0.5) return;

  // Rotation matrix columns (world = R·body); body = Rᵀ·world.
  const { qw, qx, qy, qz } = d;
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
  const nbx = r00 * nx + r10 * ny + r20 * nz;
  const nby = r01 * nx + r11 * ny + r21 * nz;
  const nbz = r02 * nx + r12 * ny + r22 * nz;

  // Contact arm: toward the obstacle, in the prop plane when the hit is edge-on.
  let cx = -nbx, cy = -nby, cz = -nbz;
  const planar = Math.sqrt(nbx * nbx + nbz * nbz);
  if (planar > 0.2) {
    cx = (-nbx / planar) * PROP_ARM;
    cy = 0;
    cz = (-nbz / planar) * PROP_ARM;
  } else {
    cx *= p.collisionRadius; cy *= p.collisionRadius; cz *= p.collisionRadius;
  }

  // Impulse (body frame) = m·Δv.
  const jx = p.mass * (d.vx - v0x), jy = p.mass * (d.vy - v0y), jz = p.mass * (d.vz - v0z);
  const jbx = r00 * jx + r10 * jy + r20 * jz;
  const jby = r01 * jx + r11 * jy + r21 * jz;
  const jbz = r02 * jx + r12 * jy + r22 * jz;
  const k = 0.5;
  let dwx = (k * (cy * jbz - cz * jby)) / p.inertia.x;
  let dwy = (k * (cz * jbx - cx * jbz)) / p.inertia.y;
  let dwz = (k * (cx * jby - cy * jbx)) / p.inertia.z;
  const mag = Math.sqrt(dwx * dwx + dwy * dwy + dwz * dwz);
  if (mag > MAX_JOLT) {
    const s = MAX_JOLT / mag;
    dwx *= s; dwy *= s; dwz *= s;
  }
  d.wx += dwx; d.wy += dwy; d.wz += dwz;
}
