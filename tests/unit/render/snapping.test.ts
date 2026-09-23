/**
 * M1-14: subpixel camera and pixel snapping after interpolation (§3.3, §4.2). Simulated 60 Hz ticks
 * rendered at 144 Hz: screen positions of moving objects are monotonic (no jump back), world-fixed
 * content scrolls monotonically, a followed entity stands still on screen.
 */
import { describe, expect, it } from 'vitest';
import { emptySnap, interpolate, SCENE_BORDER, screenPosition, snapCamera, snapToPixel } from '../../../src/render/camera';

const TICK = 1 / 60;
const FRAME = 1 / 144;
const VIEW_W = 480;
const VIEW_H = 270;

/** Runs a fixed-step simulation of `x(t) = x0 + v·t` and yields the interpolated position per 144 Hz frame. */
function* frames(x0: number, speed: number, seconds: number): Generator<number> {
  let acc = 0;
  let prev = x0;
  let cur = x0;
  for (let t = 0; t < seconds; t += FRAME) {
    acc += FRAME;
    while (acc >= TICK) {
      acc -= TICK;
      prev = cur;
      cur += speed * TICK;
    }
    yield interpolate(prev, cur, acc / TICK);
  }
}

describe('Pixel-Snapping nach der Interpolation', () => {
  it('snapToPixel rounds like the sprite shader (floor(v + 0.5))', () => {
    expect([snapToPixel(1.49), snapToPixel(1.5), snapToPixel(-0.5), snapToPixel(-0.51)]).toEqual([1, 2, 0, -1]);
  });

  it('static camera: a walking sprite moves monotonically on screen, at most one pixel per frame', () => {
    const snap = snapCamera(emptySnap(), 100.3, 50.7, Number.NaN, Number.NaN, VIEW_W, VIEW_H);
    let last = Number.NEGATIVE_INFINITY;
    for (const x of frames(10, 37, 3)) {
      const [sx] = screenPosition(snap, x, 0);
      expect(sx).toBeGreaterThanOrEqual(last);
      if (last !== Number.NEGATIVE_INFINITY) expect(sx - last).toBeLessThanOrEqual(1);
      last = sx;
    }
  });

  it('snapping before interpolation would stutter; after interpolation it does not', () => {
    // Positions of consecutive frames never step back (the fixed-step loop alpha resets every tick).
    const xs = [...frames(0, 50, 1)];
    for (let i = 1; i < xs.length; i++) expect(snapToPixel(xs[i] ?? 0)).toBeGreaterThanOrEqual(snapToPixel(xs[i - 1] ?? 0));
  });

  it('panning camera: world-fixed content scrolls monotonically with subpixel steps', () => {
    let last = Number.POSITIVE_INFINITY;
    const snap = emptySnap();
    for (const cx of frames(0, 23, 2)) {
      snapCamera(snap, cx, 0, Number.NaN, Number.NaN, VIEW_W, VIEW_H);
      expect(snap.fracX).toBeGreaterThanOrEqual(0);
      expect(snap.fracX).toBeLessThan(1);
      expect(Number.isInteger(snap.originX)).toBe(true);
      const [sx] = screenPosition(snap, 200, 0);
      expect(sx).toBeLessThanOrEqual(last);
      last = sx;
    }
  });

  it('following an entity: it stands still on screen, the world scrolls without jumping back', () => {
    const snap = emptySnap();
    const offset = 3.25;
    const seen = new Set<number>();
    let lastTree = Number.POSITIVE_INFINITY;
    for (const px of frames(5, 41, 2)) {
      snapCamera(snap, px + offset, 0, px, 0, VIEW_W, VIEW_H);
      const [playerX] = screenPosition(snap, px, 0);
      seen.add(Math.round(playerX * 1000) / 1000);
      const [treeX] = screenPosition(snap, 300, 0);
      expect(treeX).toBeLessThanOrEqual(lastTree);
      lastTree = treeX;
    }
    expect(seen.size).toBe(1);
  });

  it('the target origin includes the 1 px border and the view starts at border + fraction', () => {
    const snap = snapCamera(emptySnap(), 240.25, 135.75, Number.NaN, Number.NaN, VIEW_W, VIEW_H);
    expect(snap.viewLeft).toBeCloseTo(0.25);
    expect(snap.originX).toBe(-SCENE_BORDER);
    expect(snap.fracX).toBeCloseTo(0.25);
    expect(snap.originY).toBe(-SCENE_BORDER);
    expect(snap.fracY).toBeCloseTo(0.75);
  });
});
