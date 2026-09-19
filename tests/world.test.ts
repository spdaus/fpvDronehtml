import { describe, expect, it } from 'vitest';
import { FREESTYLE_5 } from '../src/sim/params';
import { BANDO } from '../src/world/bando';
import { boxesOverlap, panelWithOpenings } from '../src/world/boxes';
import { buildWorld } from '../src/world/world';

const world = buildWorld(FREESTYLE_5.collisionRadius);

describe('panelWithOpenings', () => {
  it('leaves exactly the requested hole', () => {
    const boxes = panelWithOpenings(0, 1, 0, 10, 0, 5, 0, 0.3, [{ a0: 4, a1: 6, b0: 1, b1: 3 }], 0, 'wall');
    const area = boxes.reduce((s, b) => s + (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]), 0);
    expect(area).toBeCloseTo(10 * 5 - 2 * 2, 9);
    // nothing solid inside the hole
    const probe = { min: [4.01, 1.01, 0] as [number, number, number], max: [5.99, 2.99, 0.3] as [number, number, number] };
    expect(boxes.some((b) => boxesOverlap(b, probe))).toBe(false);
  });

  it('merges strips with the same profile', () => {
    const boxes = panelWithOpenings(0, 1, 0, 10, 0, 5, 0, 0.3, [], 0, 'wall');
    expect(boxes).toHaveLength(1);
  });
});

describe('world', () => {
  it('R6.3 every non-decal render box is a collider with identical bounds', () => {
    const solid = world.boxes.filter((b) => b.kind !== 'decal');
    const colliderBoxes = world.shapes.filter((s) => s.kind === 'box');
    expect(colliderBoxes).toHaveLength(solid.length);
    solid.forEach((b, i) => {
      const s = colliderBoxes[i];
      expect(s.kind === 'box' && s.min).toEqual(b.min);
      expect(s.kind === 'box' && s.max).toEqual(b.max);
    });
  });

  it('R6.2 bando has 3 storeys plus a roof, pillars, partitions and holes', () => {
    const slabs = world.boxes.filter((b) => b.kind === 'slab');
    const slabLevels = new Set(slabs.map((b) => b.max[1]));
    expect([...slabLevels].sort((a, b) => a - b)).toEqual([3.5, 7, 10.5]);
    expect(world.boxes.filter((b) => b.kind === 'pillar').length).toBeGreaterThanOrEqual(8);
    expect(world.flyOpenings.some((o) => o.name === 'missing east wall')).toBe(true);
    expect(world.flyOpenings.some((o) => o.name.includes('hole'))).toBe(true);
  });

  it('R6.4 at least 100 trees, containers and a pad', () => {
    expect(world.trees.length).toBeGreaterThanOrEqual(100);
    expect(world.boxes.filter((b) => b.kind === 'container').length).toBeGreaterThanOrEqual(4);
    expect(world.boxes.some((b) => b.kind === 'pad')).toBe(true);
  });

  it('R6.5 every fly-through opening is at least 0.6 m in its smallest dimension', () => {
    expect(world.flyOpenings.length).toBeGreaterThan(10);
    for (const o of world.flyOpenings) expect(Math.min(o.width, o.height)).toBeGreaterThanOrEqual(0.6);
  });

  it('the spawn point on the pad is clear, and the pad sits outside the bando', () => {
    const s = world.spawn;
    expect(world.collision.sphereOverlaps(s.x, s.y + 0.01, s.z, FREESTYLE_5.collisionRadius)).toBe(false);
    expect(s.z).toBeGreaterThan(BANDO.z1);
  });

  it('no trees inside the bando footprint or on the pad', () => {
    for (const t of world.trees) {
      const inBando = t.x > BANDO.x0 - 3 && t.x < BANDO.x1 + 3 && t.z > BANDO.z0 - 3 && t.z < BANDO.z1 + 3;
      expect(inBando).toBe(false);
      expect(Math.hypot(t.x, t.z)).toBeGreaterThan(10);
    }
  });
});
