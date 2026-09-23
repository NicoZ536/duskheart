/**
 * M1-18: the canonical light model (falloff, cone, flicker) that the renderer and the gameplay light
 * map (§12.1) share – `src/engine/lightFalloff.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  coneCosine,
  LIGHT_CONE_SOFT_EDGE,
  LIGHT_FULL_CIRCLE,
  lightCone,
  lightConeInner,
  lightConeOuter,
  lightDistance,
  lightFalloff,
  lightFlicker,
  lightLevelAt,
  smoothstep,
  type LightSource,
} from '../../../src/engine/lightFalloff';

const torch: LightSource = { x: 100, y: 50, height: 12, radius: 96, intensity: 1, flicker: 0, seed: 0, coneDirection: 0, coneAngle: LIGHT_FULL_CIRCLE };

describe('lightFalloff', () => {
  it('is 1 at the light and 0 at and beyond the radius', () => {
    expect(lightFalloff(0, 96)).toBe(1);
    expect(lightFalloff(96, 96)).toBe(0);
    expect(lightFalloff(200, 96)).toBe(0);
  });

  it('falls strictly and smoothly between light and radius', () => {
    let prev = 1;
    for (let d = 1; d < 96; d++) {
      const f = lightFalloff(d, 96);
      expect(f).toBeLessThan(prev);
      expect(f).toBeGreaterThan(0);
      prev = f;
    }
  });

  it('has zero slope at the radius (no hard rim) and a hot core', () => {
    const r = 100;
    const slopeAtEdge = (lightFalloff(r - 0.01, r) - lightFalloff(r - 0.02, r)) / 0.01;
    const slopeNearLight = (lightFalloff(10.01, r) - lightFalloff(10, r)) / 0.01;
    expect(Math.abs(slopeAtEdge)).toBeLessThan(1e-5);
    expect(slopeNearLight).toBeLessThan(-0.005);
    // Half way out a light has lost well over half of its brightness.
    expect(lightFalloff(r / 2, r)).toBeLessThan(0.5);
  });

  it('scales with the radius and is 0 without a radius', () => {
    expect(lightFalloff(30, 60)).toBeCloseTo(lightFalloff(60, 120), 12);
    expect(lightFalloff(0, 0)).toBe(0);
    expect(lightFalloff(5, -3)).toBe(0);
  });
});

describe('cone', () => {
  it('point lights are open in every direction', () => {
    for (const cos of [-1, -0.3, 0, 0.7, 1]) expect(lightCone(cos, lightConeOuter(LIGHT_FULL_CIRCLE), lightConeInner(LIGHT_FULL_CIRCLE))).toBe(1);
  });

  it('a 60° cone is full inside, dark outside, soft across its border', () => {
    const angle = Math.PI / 3;
    const outer = lightConeOuter(angle);
    const inner = lightConeInner(angle);
    const at = (deg: number): number => lightCone(Math.cos((deg * Math.PI) / 180), outer, inner);
    expect(at(0)).toBe(1);
    expect(at(25)).toBe(1);
    expect(at(40)).toBe(0);
    const edge = at(30);
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
    const soft = (LIGHT_CONE_SOFT_EDGE / 2) * (180 / Math.PI);
    expect(at(30 - soft - 0.01)).toBe(1);
    expect(at(30 + soft + 0.01)).toBe(0);
  });

  it('measures the direction clockwise from east with y pointing south', () => {
    expect(coneCosine(10, 0, 0)).toBeCloseTo(1, 12);
    expect(coneCosine(0, 10, Math.PI / 2)).toBeCloseTo(1, 12);
    expect(coneCosine(-10, 0, 0)).toBeCloseTo(-1, 12);
    expect(coneCosine(0, 0, 1)).toBe(1);
  });

  it('smoothstep matches GLSL', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 2, 0.5)).toBeCloseTo(0.15625, 12);
  });
});

describe('flicker', () => {
  it('a steady light does not flicker', () => {
    for (const t of [0, 0.3, 7.1]) expect(lightFlicker(0, 3, t)).toBe(1);
  });

  it('stays within [1 − amount, 1], is deterministic and moves over time', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      const f = lightFlicker(0.3, 1.7, t);
      expect(f).toBeGreaterThanOrEqual(0.7 - 1e-12);
      expect(f).toBeLessThanOrEqual(1);
      expect(lightFlicker(0.3, 1.7, t)).toBe(f);
      seen.add(Math.round(f * 100));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('different seeds do not pulse in step', () => {
    expect(lightFlicker(0.3, 1, 2)).not.toBe(lightFlicker(0.3, 2, 2));
  });
});

describe('lightLevelAt (gameplay light map)', () => {
  it('combines distance (with the light height), intensity and flicker', () => {
    expect(lightDistance(torch, 100, 50, 0)).toBe(12);
    expect(lightLevelAt(torch, 100, 50, 0, 0)).toBeCloseTo(lightFalloff(12, 96), 12);
    expect(lightLevelAt({ ...torch, intensity: 2 }, 130, 50, 0, 0)).toBeCloseTo(2 * lightFalloff(Math.hypot(30, 12), 96), 12);
    expect(lightLevelAt(torch, 100 + 96, 50, 0, 0)).toBe(0);
    const flickering = { ...torch, flicker: 0.3, seed: 2 };
    expect(lightLevelAt(flickering, 110, 50, 0, 1.25)).toBeCloseTo(lightFalloff(Math.hypot(10, 12), 96) * lightFlicker(0.3, 2, 1.25), 12);
  });

  it('a spot light only lights its cone', () => {
    const spot: LightSource = { ...torch, coneDirection: 0, coneAngle: Math.PI / 3 };
    expect(lightLevelAt(spot, 150, 50, 0, 0)).toBeGreaterThan(0.1);
    expect(lightLevelAt(spot, 50, 50, 0, 0)).toBe(0);
    expect(lightLevelAt(spot, 100, 100, 0, 0)).toBe(0);
  });
});
