import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { MIN_RESPAWN_DISTANCE, TARGET_CLEARANCE, TARGET_RADIUS, TargetGame } from '../src/game/targets';
import { DEFAULT_FLIGHT } from '../src/sim/drone';
import { mulberry32 } from '../src/sim/math';
import { FREESTYLE_5 } from '../src/sim/params';
import { buildWorld } from '../src/world/world';
import { CENTER, stick } from './helpers';

const world = buildWorld(FREESTYLE_5.collisionRadius);

function session(seed = 5) {
  return new GameSession(world, FREESTYLE_5, DEFAULT_FLIGHT, seed);
}

function steps(s: GameSession, input = CENTER, seconds = 1, linkOk = true) {
  for (let i = 0; i < seconds * 1000; i++) s.step(input, linkOk);
}

describe('targets', () => {
  it('R7.1/R7.2 1000 seeded spawns are inside a spawn volume and clear of every collider', () => {
    const t = new TargetGame(world.spawnVolumes, world.collision, mulberry32(99));
    t.reset(0);
    const clear = TARGET_RADIUS + TARGET_CLEARANCE;
    for (let i = 0; i < 1000; i++) {
      if (i > 0) t.spawn(i);
      expect(t.fellBack).toBe(false);
      const inside = world.spawnVolumes.some(
        (v) => t.x >= v.min[0] && t.x <= v.max[0] && t.y >= v.min[1] && t.y <= v.max[1] && t.z >= v.min[2] && t.z <= v.max[2],
      );
      expect(inside).toBe(true);
      expect(world.collision.sphereOverlaps(t.x, t.y, t.z, clear)).toBe(false);
    }
  });

  it('R7.1 spawns use every storey', () => {
    const t = new TargetGame(world.spawnVolumes, world.collision, mulberry32(3));
    t.reset(0);
    const floors = new Set<number>();
    for (let i = 0; i < 300; i++) {
      t.spawn(i);
      floors.add(Math.floor(t.y / 3.5));
    }
    expect([...floors].sort()).toEqual([0, 1, 2]);
  });

  it('R7.3 touching the target scores, records the time and respawns ≥ 5 m away', () => {
    const t = new TargetGame(world.spawnVolumes, world.collision, mulberry32(11));
    t.reset(10);
    const { x, y, z } = t;
    expect(t.check(x + 5, y, z, 0.12, 12)).toBe(false);
    expect(t.check(x + 0.55, y, z, 0.12, 12.5)).toBe(true);
    expect(t.score).toBe(1);
    expect(t.lastTime).toBeCloseTo(2.5, 9);
    expect(t.bestTime).toBeCloseTo(2.5, 9);
    expect(Math.hypot(t.x - x, t.y - y, t.z - z)).toBeGreaterThanOrEqual(MIN_RESPAWN_DISTANCE);
  });
});

describe('session state machine', () => {
  it('arms with the throttle stick short of full travel (Pro Controller sticks reach ~70%)', () => {
    const s = session();
    // Full down on a stick that only reaches 70% of its range: s = (1 - 0.7) / 2 = 0.15.
    expect(s.toggleArm(0.15)).toBe(true);
    expect(s.drone.throttleOut).toBeLessThan(s.drone.hover);
  });

  it('refuses to arm with throttle up, arms with throttle low', () => {
    const s = session();
    expect(s.toggleArm(0.5)).toBe(false);
    expect(s.toggleArm(0.25)).toBe(false);
    expect(s.state).toBe('disarmed');
    expect(s.armWarnUntil).toBeGreaterThan(s.time);
    expect(s.toggleArm(0)).toBe(true);
    expect(s.state).toBe('armed');
    expect(s.toggleArm(0.8)).toBe(true); // disarming is always allowed
    expect(s.state).toBe('disarmed');
  });

  it('sits still on the pad while disarmed', () => {
    const s = session();
    const y0 = s.drone.py;
    steps(s, CENTER, 2);
    expect(Math.abs(s.drone.py - y0)).toBeLessThan(0.01);
    expect(s.drone.speed()).toBeLessThan(0.05);
  });

  it('takes off, flies and the flight timer runs only while armed', () => {
    const s = session();
    s.toggleArm(0);
    steps(s, stick({ throttle: 0.8 }), 1);
    expect(s.drone.py).toBeGreaterThan(3);
    expect(s.flightTime).toBeCloseTo(1, 3);
  });

  it('R5.4 a hard hit crashes: disarms and keeps simulating the body', () => {
    const s = session();
    s.toggleArm(0);
    const d = s.drone;
    d.px = -6; d.py = 2; d.pz = -22; d.vz = -12; // straight into the south wall, between windows
    steps(s, CENTER, 0.5);
    expect(s.state).toBe('crashed');
    expect(d.armed).toBe(false);
    expect(s.crashImpact).toBeGreaterThanOrEqual(FREESTYLE_5.crashSpeed);
    const y = d.py;
    steps(s, CENTER, 0.3);
    expect(d.py).toBeLessThan(y); // falling
    expect(s.toggleArm(0)).toBe(false); // can't re-arm a crashed quad
  });

  it('R5.3 a gentle bump does not crash', () => {
    const s = session();
    s.toggleArm(0);
    const d = s.drone;
    d.px = -6; d.py = 2; d.pz = -24; d.vz = -3;
    steps(s, CENTER, 0.5);
    expect(s.state).toBe('armed');
  });

  it('R5.5/R7.6 reset after a crash: pad, level, disarmed, full pack, timer and score cleared', () => {
    const s = session();
    s.toggleArm(0);
    s.targets.score = 4;
    s.drone.px = -6; s.drone.py = 2; s.drone.pz = -22; s.drone.vz = -12;
    steps(s, CENTER, 0.5);
    expect(s.state).toBe('crashed');
    s.reset();
    const d = s.drone;
    expect(s.state).toBe('disarmed');
    expect([d.px, d.pz]).toEqual([world.spawn.x, world.spawn.z]);
    expect(d.speed()).toBe(0);
    expect(d.upY()).toBeCloseTo(1, 9);
    expect(d.soc).toBe(1);
    expect(s.flightTime).toBe(0);
    expect(s.targets.score).toBe(0);
  });

  it('R1.9 failsafe: link loss holds sticks centred, then disarms after 0.5 s', () => {
    const s = session();
    s.toggleArm(0);
    steps(s, stick({ throttle: 0.9 }), 0.5);
    steps(s, stick({ throttle: 1, roll: 1 }), 0.3, false); // stale full-roll input is ignored
    expect(s.failsafe).toBe(true);
    expect(s.state).toBe('armed');
    expect(Math.abs(s.drone.wz)).toBeLessThan(1);
    steps(s, stick({ throttle: 1 }), 0.25, false);
    expect(s.state).toBe('disarmed');
  });

  it('hitting the target while armed scores', () => {
    const s = session();
    s.toggleArm(0);
    const t = s.targets;
    s.drone.px = t.x; s.drone.py = t.y; s.drone.pz = t.z;
    steps(s, CENTER, 0.002);
    expect(t.score).toBe(1);
  });
});
