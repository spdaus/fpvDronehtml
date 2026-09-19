import type { CollisionWorld } from '../sim/collision';
import type { SpawnVolume } from '../world/bando';

export const TARGET_RADIUS = 0.5;
export const TARGET_CLEARANCE = 0.3;
export const MIN_RESPAWN_DISTANCE = 5;
const MAX_ATTEMPTS = 200;

/** One target at a time, somewhere inside the bando (design.md §10, R7). */
export class TargetGame {
  x = 0;
  y = 0;
  z = 0;
  score = 0;
  /** Seconds taken to reach the last target, or null before the first hit. */
  lastTime: number | null = null;
  bestTime: number | null = null;
  /** Sim time the current target appeared. */
  spawnedAt = 0;
  /** Increments on every hit (lets the renderer/OSD react without callbacks). */
  hits = 0;
  /** True if the last spawn had to fall back to a volume centre (never expected with the shipped map). */
  fellBack = false;

  private readonly weights: number[];

  constructor(
    private readonly volumes: readonly SpawnVolume[],
    private readonly collision: CollisionWorld,
    private readonly rng: () => number,
  ) {
    const vols = volumes.map((v) => (v.max[0] - v.min[0]) * (v.max[1] - v.min[1]) * (v.max[2] - v.min[2]));
    const total = vols.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.weights = vols.map((v) => (acc += v / total));
  }

  reset(now: number): void {
    this.score = 0;
    this.lastTime = null;
    this.bestTime = null;
    this.hits = 0;
    this.spawn(now, true);
  }

  spawn(now: number, first = false): void {
    const px = this.x, py = this.y, pz = this.z;
    const clear = TARGET_RADIUS + TARGET_CLEARANCE;
    this.fellBack = false;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const u = this.rng();
      const v = this.volumes[this.weights.findIndex((w) => u <= w)] ?? this.volumes[this.volumes.length - 1];
      const x = v.min[0] + this.rng() * (v.max[0] - v.min[0]);
      const y = v.min[1] + this.rng() * (v.max[1] - v.min[1]);
      const z = v.min[2] + this.rng() * (v.max[2] - v.min[2]);
      if (!first && (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2 < MIN_RESPAWN_DISTANCE ** 2) continue;
      if (this.collision.sphereOverlaps(x, y, z, clear)) continue;
      this.x = x; this.y = y; this.z = z;
      this.spawnedAt = now;
      return;
    }
    const v = this.volumes[Math.floor(this.rng() * this.volumes.length)];
    this.x = (v.min[0] + v.max[0]) / 2;
    this.y = (v.min[1] + v.max[1]) / 2;
    this.z = (v.min[2] + v.max[2]) / 2;
    this.spawnedAt = now;
    this.fellBack = true;
  }

  /** Check for a hit by a sphere of radius `r`; on a hit, score and respawn. */
  check(px: number, py: number, pz: number, r: number, now: number): boolean {
    const reach = TARGET_RADIUS + r;
    const dx = px - this.x, dy = py - this.y, dz = pz - this.z;
    if (dx * dx + dy * dy + dz * dz >= reach * reach) return false;
    const t = now - this.spawnedAt;
    this.score++;
    this.hits++;
    this.lastTime = t;
    if (this.bestTime === null || t < this.bestTime) this.bestTime = t;
    this.spawn(now);
    return true;
  }
}
