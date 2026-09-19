import { CollisionWorld, type Shape } from '../sim/collision';
import { buildBando, type FlyOpening, type SpawnVolume } from './bando';
import type { Box } from './boxes';
import { PAD, buildPark, type Tree } from './park';

export interface World {
  /** Every static box; render geometry is built from exactly this list. */
  boxes: Box[];
  trees: Tree[];
  /** Collider shapes: all non-decal boxes plus tree cylinders. */
  shapes: Shape[];
  collision: CollisionWorld;
  spawnVolumes: SpawnVolume[];
  flyOpenings: FlyOpening[];
  /** Where the quad starts: on the pad, facing the bando (−Z). */
  spawn: { x: number; y: number; z: number; yaw: number };
}

export const WORLD_HALF = 200;

export function buildWorld(collisionRadius: number): World {
  const bando = buildBando();
  const park = buildPark();
  const boxes = [...bando.boxes, ...park.boxes];
  const shapes: Shape[] = boxes
    .filter((b) => b.kind !== 'decal')
    .map((b) => ({ kind: 'box' as const, min: b.min, max: b.max }));
  shapes.push(...park.shapes);
  return {
    boxes,
    trees: park.trees,
    shapes,
    collision: new CollisionWorld(shapes, { half: WORLD_HALF, ceiling: 120 }),
    spawnVolumes: bando.spawnVolumes,
    flyOpenings: bando.flyOpenings,
    spawn: { x: PAD.x, y: PAD.height + collisionRadius + 0.001, z: PAD.z, yaw: 0 },
  };
}
