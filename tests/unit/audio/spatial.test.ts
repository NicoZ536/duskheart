/**
 * M3-33 spatial audio (§27 "räumliches Panning + Distanzdämpfung; Tiefpass bei Verdeckung"): distance
 * gain, stereo pan, occlusion low-pass and the layer rule as pure functions.
 */
import { describe, expect, it } from 'vitest';
import {
  CLOSED_CUTOFF_HZ,
  CLOSED_GAIN,
  MAX_PAN,
  NEAR_FRACTION,
  OPEN_CUTOFF_HZ,
  PAN_SPREAD_TILES,
  distanceGain,
  occlusionCutoffHz,
  occlusionGain,
  place,
  stereoPan,
  type Placement,
} from '../../../src/audio/spatial';
import { TILE_PX } from '../../../src/world/model/coords';

describe('räumlicher Klang', () => {
  it('Distanz: voll im Nahbereich, fällt monoton, still am Rand der Reichweite', () => {
    const range = 20;
    expect(distanceGain(0, range)).toBe(1);
    expect(distanceGain(range * NEAR_FRACTION * TILE_PX, range)).toBe(1);
    let last = 1;
    for (let d = 0; d <= range * TILE_PX; d += 8) {
      const g = distanceGain(d, range);
      expect(g).toBeLessThanOrEqual(last);
      expect(g).toBeGreaterThanOrEqual(0);
      last = g;
    }
    expect(distanceGain(range * TILE_PX, range)).toBe(0);
    expect(distanceGain(range * TILE_PX * 2, range)).toBe(0);
    // Half-way between the near zone and the edge: a quarter (quadratic fade).
    expect(distanceGain(((NEAR_FRACTION + 1) / 2) * range * TILE_PX, range)).toBeCloseTo(0.25);
  });

  it('Panorama: links negativ, rechts positiv, nie ganz auf einer Seite', () => {
    expect(stereoPan(0)).toBe(0);
    expect(stereoPan(-64)).toBeLessThan(0);
    expect(stereoPan(64)).toBeGreaterThan(0);
    expect(stereoPan(PAN_SPREAD_TILES * TILE_PX)).toBeCloseTo(MAX_PAN);
    expect(stereoPan(10_000)).toBeCloseTo(MAX_PAN);
    expect(stereoPan(-10_000)).toBeCloseTo(-MAX_PAN);
    expect(MAX_PAN).toBeLessThan(1);
  });

  it('Verdeckung schließt den Tiefpass exponentiell und senkt den Pegel', () => {
    expect(occlusionCutoffHz(0)).toBeCloseTo(OPEN_CUTOFF_HZ);
    expect(occlusionCutoffHz(1)).toBeCloseTo(CLOSED_CUTOFF_HZ);
    expect(occlusionCutoffHz(0.5)).toBeCloseTo(Math.sqrt(OPEN_CUTOFF_HZ * CLOSED_CUTOFF_HZ));
    expect(occlusionCutoffHz(-1)).toBeCloseTo(OPEN_CUTOFF_HZ);
    expect(occlusionGain(0)).toBe(1);
    expect(occlusionGain(1)).toBeCloseTo(CLOSED_GAIN);
  });

  it('place: andere Ebene ist stumm; Position, Verdeckung und Reichweite wirken zusammen', () => {
    const out: Placement = { gain: 0, pan: 0, cutoffHz: 0 };
    const listener = { x: 1000, y: 1000, layer: 0 };
    expect(place(1000, 1000, -1, 20, listener, 0, out).gain).toBe(0);
    const near = place(1000 + 3 * TILE_PX, 1000, 0, 20, listener, 0, out);
    expect(near.gain).toBe(1);
    expect(near.pan).toBeGreaterThan(0);
    expect(near.cutoffHz).toBeCloseTo(OPEN_CUTOFF_HZ);
    const walled = place(1000 - 10 * TILE_PX, 1000, 0, 20, listener, 1, out);
    expect(walled.gain).toBeCloseTo(distanceGain(10 * TILE_PX, 20) * CLOSED_GAIN);
    expect(walled.pan).toBeLessThan(0);
    expect(walled.cutoffHz).toBeCloseTo(CLOSED_CUTOFF_HZ);
    expect(place(1000, 1000 + 40 * TILE_PX, 0, 20, listener, 0, out).gain).toBe(0);
  });
});
