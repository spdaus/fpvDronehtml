import { box, panelWithOpenings, type Box, type Opening, type Vec3 } from './boxes';

/**
 * The bando: a 3-storey abandoned concrete building (design.md §8, R6.2).
 * Footprint x −15..15, z −43..−25 (south face 25 m north of the launch pad at the origin).
 */

export const BANDO = {
  x0: -15,
  x1: 15,
  z0: -43,
  z1: -25,
  wall: 0.3,
  storey: 3.5,
  slab: 0.3,
  storeys: 3,
  parapet: 0.8,
} as const;

const CONCRETE = 0xb4b0a6;
const CONCRETE_DARK = 0xa29e94;
const SLAB = 0x9d9990;
const PILLAR = 0x8f8b83;
const PARTITION = 0xbdb8ae;
const FLOOR = 0x77736c;
const RUBBLE = 0x9a948a;

export interface SpawnVolume {
  min: Vec3;
  max: Vec3;
}

/** An opening meant to be flown through, with its size (smallest two dimensions) for R6.5. */
export interface FlyOpening {
  name: string;
  width: number;
  height: number;
}

export interface Bando {
  boxes: Box[];
  spawnVolumes: SpawnVolume[];
  flyOpenings: FlyOpening[];
}

export function buildBando(): Bando {
  const { x0, x1, z0, z1, wall: T, storey: H, slab: S, storeys, parapet } = BANDO;
  const top = storeys * H + parapet;
  const boxes: Box[] = [];
  const fly: FlyOpening[] = [];

  const windowsAlong = (centers: number[], w = 1.6): Opening[] => {
    const out: Opening[] = [];
    for (let s = 0; s < storeys; s++) {
      const f = s * H;
      for (const c of centers) out.push({ a0: c - w / 2, a1: c + w / 2, b0: f + 1.0, b1: f + 2.4 });
    }
    return out;
  };
  const note = (name: string, o: Opening) => fly.push({ name, width: o.a1 - o.a0, height: o.b1 - o.b0 });

  // --- exterior walls (south/north span full x incl. corners; east/west fit between) ---
  const southOpen = windowsAlong([-12, -8, -4, 4, 8, 12]);
  southOpen.push(...windowsAlong([0]).filter((o) => o.b0 > 1.5)); // upper-floor windows over the door
  const garage: Opening = { a0: -1.5, a1: 1.5, b0: 0, b1: 2.6 };
  southOpen.push(garage);
  boxes.push(...panelWithOpenings(0, 1, x0, x1, 0, top, z1 - T, z1, southOpen, CONCRETE, 'wall'));

  const northOpen = windowsAlong([-12, -8, -4, 0, 4, 8, 12]);
  const backDoor: Opening = { a0: 5.4, a1: 6.6, b0: 0, b1: 2.2 };
  northOpen.push(backDoor);
  boxes.push(...panelWithOpenings(0, 1, x0, x1, 0, top, z0, z0 + T, northOpen, CONCRETE, 'wall'));

  const sideWindows = windowsAlong([-39, -34, -29]);
  boxes.push(...panelWithOpenings(2, 1, z0 + T, z1 - T, 0, top, x0, x0 + T, sideWindows, CONCRETE_DARK, 'wall'));
  const missing: Opening = { a0: -38, a1: -30, b0: H, b1: 2 * H - S };
  boxes.push(
    ...panelWithOpenings(2, 1, z0 + T, z1 - T, 0, top, x1 - T, x1, [...sideWindows, missing], CONCRETE_DARK, 'wall'),
  );

  note('window', southOpen[0]);
  note('garage door', garage);
  note('back door', backDoor);
  note('missing east wall', missing);

  // --- slabs (floors 1, 2 and the roof) with holes ---
  const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
  const stair: Opening = { a0: 10, a1: 12.4, b0: -41, b1: -36 };
  const holes: Opening[][] = [
    [stair, { a0: -8.5, a1: -5.5, b0: -36, b1: -33 }],
    [stair, { a0: 4.5, a1: 7.5, b0: -30, b1: -27 }],
    [stair, { a0: -2, a1: 2, b0: -36, b1: -32 }],
  ];
  for (let k = 1; k <= storeys; k++) {
    const hs = holes[k - 1];
    boxes.push(...panelWithOpenings(0, 2, ix0, ix1, iz0, iz1, k * H - S, k * H, hs, SLAB, 'slab'));
    for (const h of hs) fly.push({ name: `slab ${k} hole`, width: h.a1 - h.a0, height: h.b1 - h.b0 });
  }
  // Ground-floor concrete (thin; keeps the interior from looking like grass).
  boxes.push(box([ix0, 0, iz0], [ix1, 0.05, iz1], FLOOR, 'floor'));

  // --- pillars on a 6 m grid, every storey ---
  for (let s = 0; s < storeys; s++) {
    const y0 = s === 0 ? 0.05 : s * H;
    const y1 = (s + 1) * H - S;
    for (const px of [-9, -3, 3, 9]) {
      for (const pz of [-37, -31]) boxes.push(box([px - 0.25, y0, pz - 0.25], [px + 0.25, y1, pz + 0.25], PILLAR, 'pillar'));
    }
  }

  // --- interior partitions with doorways ---
  const pt = 0.1;
  const p0 = [
    { a0: -40, a1: -38.8, b0: 0, b1: 2.2 },
    { a0: -33, a1: -30.5, b0: 0, b1: 2.6 },
  ];
  boxes.push(...panelWithOpenings(2, 1, iz0, iz1, 0.05, H - S, -5 - pt, -5 + pt, p0, PARTITION, 'wall'));
  const p1 = [
    { a0: -11, a1: -9.8, b0: H, b1: H + 2.2 },
    { a0: -8.6, a1: -5.4, b0: H, b1: 2 * H - S }, // over the slab-1 hole
    { a0: 0, a1: 2.5, b0: H, b1: H + 2.6 },
    { a0: 6, a1: 7.2, b0: H, b1: H + 2.2 },
  ];
  boxes.push(...panelWithOpenings(0, 1, ix0, ix1, H, 2 * H - S, -34 - pt, -34 + pt, p1, PARTITION, 'wall'));
  const p2 = [
    { a0: -40, a1: -38.8, b0: 2 * H, b1: 2 * H + 2.2 },
    { a0: -31, a1: -28.5, b0: 2 * H, b1: 2 * H + 2.6 },
  ];
  boxes.push(...panelWithOpenings(2, 1, iz0, iz1, 2 * H, 3 * H - S, 4 - pt, 4 + pt, p2, PARTITION, 'wall'));
  for (const o of [...p0, ...p1, ...p2]) note('doorway', o);

  // --- rubble on the ground floor ---
  const rubble: Array<[number, number, number, number, number]> = [
    [-12, -41, 1.2, 0.6, 0.9],
    [-11, -28, 0.8, 0.5, 1.4],
    [7, -40, 1.6, 0.8, 1.0],
    [12.5, -28.5, 1.0, 1.1, 1.0],
    [-1, -39, 2.0, 0.4, 0.8],
  ];
  for (const [cx, cz, w, h, d] of rubble) {
    boxes.push(box([cx - w / 2, 0.05, cz - d / 2], [cx + w / 2, 0.05 + h, cz + d / 2], RUBBLE, 'rubble'));
  }

  // --- graffiti (paint only: not colliders) ---
  const paint = (x: number, y: number, w: number, h: number, c: number) =>
    boxes.push(box([x, y, z1], [x + w, y + h, z1 + 0.02], c, 'decal'));
  paint(-10.6, 0.3, 1.8, 1.1, 0xd94f8a);
  paint(-6.2, 0.4, 1.5, 0.9, 0x39b8c9);
  paint(5.4, 0.3, 2.0, 1.2, 0xf2c14e);
  paint(9.4, 3.9, 1.2, 0.9, 0x7bd35a);

  // --- target spawn volumes: interior of each storey, 0.6 m in from every surface ---
  const m = 0.6;
  const spawnVolumes: SpawnVolume[] = [];
  for (let s = 0; s < storeys; s++) {
    const floor = s === 0 ? 0.05 : s * H;
    spawnVolumes.push({ min: [ix0 + m, floor + m, iz0 + m], max: [ix1 - m, (s + 1) * H - S - m, iz1 - m] });
  }

  return { boxes, spawnVolumes, flyOpenings: fly };
}
