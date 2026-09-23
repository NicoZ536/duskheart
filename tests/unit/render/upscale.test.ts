/**
 * M1-14: sharp upscaling – when the linear step is needed, and where the visible image sits in the
 * bordered target (GL orientation) for a subpixel camera.
 */
import { describe, expect, it } from 'vitest';
import { needsSmoothStep, presentOffsetX, presentOffsetY } from '../../../src/render/output/upscaler';
import { computeViewport } from '../../../src/render/viewport';

describe('scharfes Hochskalieren', () => {
  it.each([
    [1920, 1080, 'sharp', false],
    [3840, 2160, 'sharp', false],
    [2560, 1440, 'sharp', true],
    [1600, 900, 'sharp', true],
    [2560, 1440, 'pixelPerfect', false],
    [1600, 900, 'pixelPerfect', false],
  ] as const)('%i×%i %s: linear step %s', (w, h, mode, smooth) => {
    expect(needsSmoothStep(computeViewport(w, h, mode))).toBe(smooth);
  });

  it('pixel-perfect output is an integer multiple centred with bars', () => {
    const vp = computeViewport(1600, 900, 'pixelPerfect');
    expect(vp.integerScale).toBe(3);
    expect([vp.outWidth, vp.outHeight]).toEqual([480 * 3, 270 * 3]);
    expect(vp.outX).toBe((1600 - 1440) / 2);
  });

  it('the visible image starts at the border plus the camera fraction (y flipped for GL)', () => {
    expect([presentOffsetX(0), presentOffsetY(0)]).toEqual([1, 1]);
    expect(presentOffsetX(0.25)).toBeCloseTo(1.25);
    expect(presentOffsetY(0.75)).toBeCloseTo(0.25);
  });
});
