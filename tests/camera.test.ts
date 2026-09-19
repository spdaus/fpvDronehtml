import { describe, expect, it } from 'vitest';
import { MOUNT } from '../src/render/fpvCamera';
import { FAR, NEAR } from '../src/render/renderer';
import { SKY_RADIUS } from '../src/render/scene';
import { FREESTYLE_5 } from '../src/sim/params';

const DEG = Math.PI / 180;

describe('FPV camera clipping', () => {
  // If mount offset + the near plane's corner distance reached past the collision sphere, touching a
  // wall would let the view cut through it (white flashes of sky). Check every plausible window shape.
  it.each([0.5, 1, 16 / 9, 21 / 9])('R8.1 near plane stays inside the collision sphere at aspect %f', (aspect) => {
    const fovH = 110;
    const tanH = Math.tan((fovH / 2) * DEG);
    const tanV = tanH / aspect;
    const corner = NEAR * Math.sqrt(1 + tanH * tanH + tanV * tanV);
    const reach = MOUNT.length() + corner;
    expect(reach).toBeLessThan(FREESTYLE_5.collisionRadius * 0.9);
  });

  it('the sky dome sits inside the far plane (else its centre is clipped to a pale blob)', () => {
    expect(SKY_RADIUS).toBeLessThan(FAR * 0.9);
  });
});
