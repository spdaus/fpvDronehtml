export type Vec3 = [number, number, number];

export type BoxKind = 'wall' | 'slab' | 'pillar' | 'floor' | 'rubble' | 'container' | 'pad' | 'decal';

/** An axis-aligned box: the single source for both render geometry and colliders (R6.3). */
export interface Box {
  min: Vec3;
  max: Vec3;
  color: number;
  kind: BoxKind;
}

/** A rectangular hole in a panel, in the panel's (a, b) coordinates. */
export interface Opening {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

type Axis = 0 | 1 | 2;

/**
 * Build a flat panel (wall or slab) as solid boxes around rectangular openings, so holes are exact.
 * The panel spans a0..a1 on `axisA`, b0..b1 on `axisB`, and c0..c1 (thickness) on the third axis.
 * Adjacent strips with the same vertical profile are merged to keep the box count low.
 */
export function panelWithOpenings(
  axisA: Axis,
  axisB: Axis,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  c0: number,
  c1: number,
  openings: readonly Opening[],
  color: number,
  kind: BoxKind,
): Box[] {
  const axisC = (3 - axisA - axisB) as Axis;
  const eps = 1e-6;
  const cuts = new Set<number>([a0, a1]);
  for (const o of openings) {
    if (o.a1 > a0 && o.a0 < a1) {
      cuts.add(Math.min(a1, Math.max(a0, o.a0)));
      cuts.add(Math.min(a1, Math.max(a0, o.a1)));
    }
  }
  const us = [...cuts].sort((x, y) => x - y);
  const out: Box[] = [];
  let prev: Array<{ v0: number; v1: number; box: Box }> = [];

  for (let k = 0; k < us.length - 1; k++) {
    const u0 = us[k];
    const u1 = us[k + 1];
    if (u1 - u0 < eps) continue;
    const mid = (u0 + u1) / 2;
    const holes = openings
      .filter((o) => o.a0 < mid && o.a1 > mid)
      .map((o) => [Math.max(o.b0, b0), Math.min(o.b1, b1)] as const)
      .filter(([h0, h1]) => h1 > h0)
      .sort((x, y) => x[0] - y[0]);

    const solids: Array<[number, number]> = [];
    let cur = b0;
    for (const [h0, h1] of holes) {
      if (h0 > cur + eps) solids.push([cur, h0]);
      cur = Math.max(cur, h1);
    }
    if (b1 > cur + eps) solids.push([cur, b1]);

    const next: typeof prev = [];
    for (const [v0, v1] of solids) {
      const match = prev.find(
        (p) => Math.abs(p.v0 - v0) < eps && Math.abs(p.v1 - v1) < eps && Math.abs(p.box.max[axisA] - u0) < eps,
      );
      if (match) {
        match.box.max[axisA] = u1;
        next.push(match);
        continue;
      }
      const min: Vec3 = [0, 0, 0];
      const max: Vec3 = [0, 0, 0];
      min[axisA] = u0; max[axisA] = u1;
      min[axisB] = v0; max[axisB] = v1;
      min[axisC] = c0; max[axisC] = c1;
      const box: Box = { min, max, color, kind };
      out.push(box);
      next.push({ v0, v1, box });
    }
    prev = next;
  }
  return out;
}

export function box(min: Vec3, max: Vec3, color: number, kind: BoxKind): Box {
  return { min, max, color, kind };
}

export function boxesOverlap(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, margin = 0): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.max[i] + margin <= b.min[i] || b.max[i] + margin <= a.min[i]) return false;
  }
  return true;
}
