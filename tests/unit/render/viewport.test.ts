import { describe, expect, it } from 'vitest';
import { computeViewport } from '../../../src/render/viewport';

describe('computeViewport (§4.2)', () => {
  it.each([
    [1920, 1080, 480],
    [2560, 1440, 480],
    [3440, 1440, 640],
    [3840, 2160, 480],
  ])('%i×%i → %i×270', (w, h, iw) => {
    const vp = computeViewport(w, h, 'sharp');
    expect(vp.internalWidth).toBe(iw);
    expect(vp.internalHeight).toBe(270);
  });

  it('clamps 4:3 to 360 wide and ultra-wide to 640 with side bars', () => {
    expect(computeViewport(1024, 768, 'sharp').internalWidth).toBe(360);
    const wide = computeViewport(5120, 1440, 'sharp');
    expect(wide.internalWidth).toBe(640);
    expect(wide.outX).toBeGreaterThan(0);
  });

  it('pixel-perfect mode uses integer scale only', () => {
    const vp = computeViewport(1920, 1080, 'pixelPerfect');
    expect(vp.integerScale).toBe(4);
    expect(vp.outWidth).toBe(480 * 4);
    expect(vp.outHeight).toBe(270 * 4);
  });

  it('sharp mode fills the screen height for 16:9', () => {
    const vp = computeViewport(2560, 1440, 'sharp');
    expect(vp.outHeight).toBe(1440);
    expect(vp.integerScale).toBe(5);
  });
});
