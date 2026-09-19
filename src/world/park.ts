import type { Shape } from '../sim/collision';
import { mulberry32 } from '../sim/math';
import { box, type Box } from './boxes';

/** Park around the bando: launch pad, shipping containers and trees (design.md §8, R6.1/R6.4). */

export const PAD = { x: 0, z: 0, half: 0.75, height: 0.05 } as const;

export interface Tree {
  x: number;
  z: number;
  trunkR: number;
  trunkH: number;
  canopyR: number;
  canopyH: number;
  /** 0..1, used for per-tree colour variation. */
  tint: number;
}

export interface Park {
  boxes: Box[];
  trees: Tree[];
  /** Tree colliders (trunk + two stacked cylinders approximating the cone). */
  shapes: Shape[];
}

// 20 ft container: 6.06 × 2.59 × 2.44 m.
const CL = 6.06, CH = 2.59, CW = 2.44;

/** Areas kept clear of trees: [x0, z0, x1, z1]. */
const CLEAR: Array<[number, number, number, number]> = [
  [-24, -54, 24, -16], // bando
  [-10, -16, 10, 10], // pad + run-up to the bando
  [20, -16, 37, 2], // container yard
  [-40, 0, -24, 12], // lone container
];

export function buildPark(seed = 1337, treeCount = 150): Park {
  const boxes: Box[] = [];
  const { x, z, half, height } = PAD;
  boxes.push(box([x - half, 0, z - half], [x + half, height, z + half], 0x2b2d31, 'pad'));
  // Pad markings (paint).
  boxes.push(box([x - 0.5, height, z - 0.06], [x + 0.5, height + 0.01, z + 0.06], 0xf2c14e, 'decal'));
  boxes.push(box([x - 0.06, height, z - 0.5], [x + 0.06, height + 0.01, z - 0.06], 0xf2c14e, 'decal'));

  // Container yard: two stacks with a container bridging them → a tunnel gap underneath.
  const yard: Array<[number, number, number, number, number, number, number]> = [
    [25, 0, -12, 25 + CL, CH, -12 + CW, 0xa8392c],
    [25, CH, -12, 25 + CL, 2 * CH, -12 + CW, 0x3e7d41],
    [25, 0, -6, 25 + CL, CH, -6 + CW, 0x2c58a8],
    [25, CH, -6, 25 + CL, 2 * CH, -6 + CW, 0xc9a227],
    [26.8, 2 * CH, -10.8, 26.8 + CW, 3 * CH, -10.8 + CL, 0x8a4fa8], // bridge across both stacks, rotated along z
    [-35, 0, 4, -35 + CL, CH, 4 + CW, 0xd98c1f],
  ];
  for (const [x0, y0, z0, x1, y1, z1, c] of yard) boxes.push(box([x0, y0, z0], [x1, y1, z1], c, 'container'));

  const rnd = mulberry32(seed);
  const trees: Tree[] = [];
  const shapes: Shape[] = [];
  const minSpacing = 5;
  let attempts = 0;
  while (trees.length < treeCount && attempts++ < 20000) {
    const a = rnd() * Math.PI * 2;
    const r = 18 + Math.sqrt(rnd()) * 150;
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    if (CLEAR.some(([x0, z0, x1, z1]) => tx > x0 && tx < x1 && tz > z0 && tz < z1)) continue;
    if (trees.some((t) => (t.x - tx) ** 2 + (t.z - tz) ** 2 < minSpacing * minSpacing)) continue;
    const t: Tree = {
      x: tx,
      z: tz,
      trunkR: 0.12 + rnd() * 0.13,
      trunkH: 1.5 + rnd() * 1.5,
      canopyR: 1.3 + rnd() * 1.3,
      canopyH: 4 + rnd() * 4,
      tint: rnd(),
    };
    trees.push(t);
    const base = t.trunkH - 0.3;
    shapes.push({ kind: 'cylinder', x: tx, z: tz, r: t.trunkR, y0: 0, y1: base });
    shapes.push({ kind: 'cylinder', x: tx, z: tz, r: t.canopyR * 0.8, y0: base, y1: base + t.canopyH * 0.4 });
    shapes.push({ kind: 'cylinder', x: tx, z: tz, r: t.canopyR * 0.45, y0: base + t.canopyH * 0.4, y1: base + t.canopyH * 0.75 });
  }
  return { boxes, trees, shapes };
}
