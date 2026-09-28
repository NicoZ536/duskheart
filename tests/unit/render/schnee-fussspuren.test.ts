/**
 * M5-19 „verblassende Fußspuren im Schnee“: a walking figure leaves a print every few pixels, left and right foot beside
 * its path; the prints are world-fixed, fade over game time and faster while fresh snow falls into them; standing
 * still, walking off the snow or a jump (teleport) leaves nothing. A ring buffer: the oldest go first.
 */
import { describe, expect, it } from 'vitest';
import { FootprintTrail } from '../../../src/render/surface/footprints';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { FOOTPRINT_FIELDS, SurfaceState } from '../../../src/render/surface/state';

const P = SURFACE_PARAMS.footprints;

function walk(trail: FootprintTrail, from: [number, number], to: [number, number], steps: number, minute: number, onSnow = true, snowing = false): void {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    trail.update(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, minute, onSnow, snowing);
  }
}

function prints(trail: FootprintTrail, minute: number): { x: number; y: number; s: number; side: number }[] {
  const state = new SurfaceState();
  trail.emit(state, minute);
  const out: { x: number; y: number; s: number; side: number }[] = [];
  for (let i = 0; i < state.footprintCount; i++) {
    const o = i * FOOTPRINT_FIELDS;
    out.push({ x: state.footprints[o] as number, y: state.footprints[o + 1] as number, s: state.footprints[o + 2] as number, side: state.footprints[o + 3] as number });
  }
  return out;
}

describe('Fußspuren im Schnee', () => {
  it('one print per stride, alternating feet beside the path, on whole pixels', () => {
    const trail = new FootprintTrail();
    walk(trail, [100, 200], [150, 200], 50, 10);
    const p = prints(trail, 10);
    expect(p.length).toBe(Math.floor(50 / P.stridePx));
    for (let i = 0; i < p.length; i++) {
      const q = p[i] as { x: number; y: number; side: number };
      expect(Number.isInteger(q.x) && Number.isInteger(q.y)).toBe(true);
      expect(Math.abs(q.y - 200)).toBe(P.sidePx);
      if (i > 0) expect(q.side).toBe(-(p[i - 1] as { side: number }).side);
    }
  });

  it('fades over game time and faster while it snows', () => {
    const trail = new FootprintTrail();
    walk(trail, [0, 0], [0, 40], 40, 100);
    expect(prints(trail, 100).every((q) => q.s === 1)).toBe(true);
    const half = prints(trail, 100 + P.fadeMinutes / 2);
    expect(half.every((q) => Math.abs(q.s - 0.5) < 1e-9)).toBe(true);
    expect(prints(trail, 100 + P.fadeMinutes)).toEqual([]);
    const snowed = new FootprintTrail();
    walk(snowed, [0, 0], [0, 40], 40, 100);
    snowed.update(0, 40, 110, true, true);
    snowed.update(0, 40, 120, true, true);
    const s = prints(snowed, 120)[0]?.s ?? 0;
    // Twenty minutes of age and twenty minutes of snowfall, each snowing minute filling `fillPerSnowMinute` minutes.
    expect(s).toBeCloseTo(1 - (20 + 20 * P.fillPerSnowMinute) / P.fadeMinutes, 6);
  });

  it('nothing while standing, off the snow or across a jump', () => {
    const trail = new FootprintTrail();
    for (let i = 0; i < 30; i++) trail.update(50, 50, i, true, false);
    expect(trail.size).toBe(0);
    walk(trail, [50, 50], [90, 50], 40, 30, false);
    expect(trail.size).toBe(0);
    trail.update(90, 50, 31, true, false);
    trail.update(900, 50, 32, true, false);
    expect(trail.size).toBe(0);
  });

  it('keeps at most its capacity; the oldest go first', () => {
    const trail = new FootprintTrail(4);
    walk(trail, [0, 0], [60, 0], 60, 1);
    const p = prints(trail, 1);
    expect(p.length).toBe(4);
    expect(p.every((q) => q.x > 35)).toBe(true);
    trail.clear();
    expect(prints(trail, 1)).toEqual([]);
  });
});
