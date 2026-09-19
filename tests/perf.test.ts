import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { DEFAULT_FLIGHT } from '../src/sim/drone';
import { FREESTYLE_5 } from '../src/sim/params';
import { buildWorld } from '../src/world/world';

describe('performance', () => {
  it('R9.4 60 s of sim time (physics + collision vs the full world) runs in < 3 s', () => {
    const world = buildWorld(FREESTYLE_5.collisionRadius);
    const s = new GameSession(world, FREESTYLE_5, DEFAULT_FLIGHT, 1);
    s.toggleArm(0);
    const input = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };
    const t0 = performance.now();
    for (let i = 0; i < 60_000; i++) {
      // Wander around the bando and trees so collision queries hit busy cells.
      const t = i / 1000;
      input.throttle = 0.5 + 0.15 * Math.sin(t * 0.7);
      input.pitch = 0.3 * Math.sin(t * 0.5);
      input.roll = 0.3 * Math.sin(t * 0.9);
      input.yaw = 0.2 * Math.sin(t * 0.3);
      s.step(input, true);
      if (s.state === 'crashed') s.reset();
      if (s.state === 'disarmed') s.toggleArm(0);
    }
    const ms = performance.now() - t0;
    // 60 s = 3600 frames of 60 fps → cost per rendered frame.
    console.log(`physics: ${ms.toFixed(0)} ms for 60 s of flight = ${(ms / 3600).toFixed(3)} ms per 60 fps frame`);
    expect(ms).toBeLessThan(3000);
  });
});
