import { describe, expect, it } from 'vitest';
import { CollisionWorld, type ContactReport, type Shape } from '../src/sim/collision';
import { Drone } from '../src/sim/drone';
import { FREESTYLE_5 } from '../src/sim/params';
import { CENTER } from './helpers';

const R = FREESTYLE_5.collisionRadius;

/** A thin wall: 0.1 m thick in z, centred at z = −10. */
const WALL: Shape = { kind: 'box', min: [-5, 0, -10.05], max: [5, 10, -9.95] };

function fly(shapes: Shape[], setup: (d: Drone) => void, seconds: number) {
  const world = new CollisionWorld(shapes);
  const d = new Drone(FREESTYLE_5);
  d.reset(0, 5, 0, 0);
  setup(d);
  const report: ContactReport = { contacts: 0, maxImpact: 0 };
  let maxImpact = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < seconds * 1000; i++) {
    d.step(CENTER);
    world.resolve(d, report);
    maxImpact = Math.max(maxImpact, report.maxImpact);
    minZ = Math.min(minZ, d.pz);
    maxZ = Math.max(maxZ, d.pz);
  }
  return { d, maxImpact, minZ, maxZ, world };
}

describe('collision', () => {
  it('R5.2 no tunneling through a 0.1 m wall at 40 m/s', () => {
    const { d, minZ } = fly([WALL], (d) => { d.vz = -40; d.pz = -8; }, 0.3);
    expect(minZ).toBeGreaterThan(-9.95 - 1e-6 + 0); // centre never crossed the wall face…
    expect(d.pz).toBeGreaterThan(-9.95); // …and it ends up on the near side
  });

  it('R5.2 no tunneling at 40 m/s approaching from any angle', () => {
    for (const angle of [0, 0.3, 0.7, 1.2]) {
      const { d } = fly([WALL], (d) => {
        d.pz = -8;
        d.vz = -40 * Math.cos(angle);
        d.vx = 40 * Math.sin(angle);
      }, 0.2);
      expect(d.pz).toBeGreaterThan(-9.95);
    }
  });

  it('R5.3 a light hit bounces back with restitution ~0.3', () => {
    const { d, maxImpact } = fly([WALL], (d) => { d.vz = -3; d.pz = -9; }, 0.4);
    expect(maxImpact).toBeGreaterThan(2.9);
    expect(maxImpact).toBeLessThan(3.1);
    expect(d.vz).toBeGreaterThan(0.5); // moving away
    expect(d.vz).toBeLessThan(1.2);
  });

  it('R5.3 friction slows sliding along a surface', () => {
    const { d } = fly([], (d) => { d.py = R; d.vx = 5; d.vy = -2; }, 0.05);
    expect(Math.abs(d.vx)).toBeLessThan(5);
  });

  it('R5.3 an off-centre hit disturbs the attitude', () => {
    const { d } = fly([WALL], (d) => {
      d.pz = -9;
      d.vz = -4;
      // pitched nose-down 30°, as in forward flight
      d.qw = Math.cos(-0.26); d.qx = Math.sin(-0.26);
    }, 0.25);
    expect(Math.hypot(d.wx, d.wy, d.wz)).toBeGreaterThan(1);
  });

  it('R5.1 collides with the ground, cylinders and spheres', () => {
    const ground = fly([], (d) => { d.py = 1; d.vy = -3; }, 0.6);
    expect(ground.d.py).toBeGreaterThanOrEqual(R - 1e-3);

    const cyl = fly([{ kind: 'cylinder', x: 0, z: -3, r: 0.3, y0: 0, y1: 10 }], (d) => { d.vz = -8; }, 0.6);
    expect(cyl.maxImpact).toBeGreaterThan(4);
    expect(cyl.minZ).toBeGreaterThan(-3 + 0.3);

    const sph = fly([{ kind: 'sphere', x: 0, y: 5, z: -3, r: 1 }], (d) => { d.vz = -8; }, 0.4);
    expect(sph.maxImpact).toBeGreaterThan(4);
    expect(sph.minZ).toBeGreaterThan(-3 + 0.5);
  });

  it('R5.1 sphereOverlaps finds shapes and the ground', () => {
    const w = new CollisionWorld([WALL]);
    expect(w.sphereOverlaps(0, 5, -10, 0.5)).toBe(true);
    expect(w.sphereOverlaps(0, 5, -9.5, 0.5)).toBe(true);
    expect(w.sphereOverlaps(0, 5, -9.4, 0.5)).toBe(false);
    expect(w.sphereOverlaps(0, 0.3, 0, 0.5)).toBe(true);
  });

  it('keeps the quad inside the play area', () => {
    const { d } = fly([], (d) => { d.px = 195; d.vx = 30; }, 0.5);
    expect(d.px).toBeLessThanOrEqual(200 - R + 1e-6);
  });
});
