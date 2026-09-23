/**
 * M1-18: light instances – culling against the target, the quality cap (§6.3: nearest lights win),
 * canonical flicker with the accessibility scale, cone cosines, no reallocation per frame.
 */
import { describe, expect, it } from 'vitest';
import { lightConeInner, lightConeOuter, lightFlicker, LIGHT_FULL_CIRCLE } from '../../../src/engine/lightFalloff';
import { LightBatch, lightQuadLift, lightTouchesView, LIGHT_INSTANCE_FLOATS, LIGHT_OFFSET, type LightView } from '../../../src/render/light/lightBatch';
import { LightDesc, LightList } from '../../../src/render/scene';

const VIEW: LightView = { left: -241, top: -136, width: 482, height: 272 };
const ALL = { maxLights: 256, flickerScale: 1 };

function light(x: number, y: number, radius = 50, patch: Partial<LightDesc> = {}): LightDesc {
  const l = new LightDesc();
  l.x = x;
  l.y = y;
  l.radius = radius;
  l.height = 10;
  Object.assign(l, patch);
  return l;
}

function list(...lights: LightDesc[]): LightList {
  const out = new LightList(2);
  for (const l of lights) out.push(l);
  return out;
}

const xs = (b: LightBatch): number[] => Array.from({ length: b.count }, (_, i) => b.data[i * LIGHT_INSTANCE_FLOATS + LIGHT_OFFSET.geom] ?? NaN);

describe('LightBatch', () => {
  it('packs position, height, radius, colour × intensity and open cone of a point light', () => {
    const b = new LightBatch();
    const n = b.pack(list(light(10, 20, 64, { height: 14, r: 1, g: 0.5, b: 0.25, intensity: 2 })), VIEW, 0, ALL);
    expect(n).toBe(1);
    const d = Array.from(b.data.subarray(0, LIGHT_INSTANCE_FLOATS));
    expect(d.slice(LIGHT_OFFSET.geom, LIGHT_OFFSET.geom + 4)).toEqual([10, 20, 14, 64]);
    expect(d.slice(LIGHT_OFFSET.color, LIGHT_OFFSET.color + 3)).toEqual([2, 1, 0.5]);
    expect(d.slice(LIGHT_OFFSET.cone)).toEqual([1, 0, lightConeOuter(LIGHT_FULL_CIRCLE), lightConeInner(LIGHT_FULL_CIRCLE)]);
  });

  it('drops lights off screen, without radius or without intensity', () => {
    const b = new LightBatch();
    b.pack(list(light(0, 0), light(400, 0), light(0, 0, 0), light(5, 5, 30, { intensity: 0 }), light(-280, 0, 50)), VIEW, 0, ALL);
    expect(xs(b)).toEqual([0, -280]);
    expect(b.visibleCount).toBe(2);
  });

  it('keeps lights below the view whose quad reaches up into it (tall things are lit from below)', () => {
    const r = 40;
    const y = VIEW.top + VIEW.height + r - 1;
    expect(lightTouchesView(0, y, 10, r, VIEW)).toBe(true);
    // A light far above the view never reaches it: the quad extends upwards only.
    expect(lightTouchesView(0, VIEW.top - r - lightQuadLift(10, r) - 1, 10, r, VIEW)).toBe(false);
    expect(lightQuadLift(200, 100)).toBe(128);
  });

  it('caps at maxLights, keeping the lights nearest to the view centre (stable order)', () => {
    const b = new LightBatch();
    const lights = list(light(200, 0, 20), light(0, 0, 20), light(-100, 0, 20), light(50, 50, 20), light(-230, 100, 20));
    b.pack(lights, VIEW, 0, { maxLights: 3, flickerScale: 1 });
    expect(b.visibleCount).toBe(5);
    expect(xs(b)).toEqual([0, -100, 50]);
    b.pack(lights, VIEW, 0, { maxLights: 0, flickerScale: 1 });
    expect(b.count).toBe(0);
  });

  it('applies the canonical flicker, scaled down by flicker reduction', () => {
    const b = new LightBatch();
    const lights = list(light(0, 0, 50, { flicker: 0.4, seed: 3 }));
    const t = 1.3;
    b.pack(lights, VIEW, t, ALL);
    expect(b.data[LIGHT_OFFSET.color]).toBeCloseTo(lightFlicker(0.4, 3, t), 6);
    b.pack(lights, VIEW, t, { maxLights: 256, flickerScale: 0.25 });
    expect(b.data[LIGHT_OFFSET.color]).toBeCloseTo(lightFlicker(0.1, 3, t), 6);
  });

  it('packs cone axis and border cosines of spot lights', () => {
    const b = new LightBatch();
    b.pack(list(light(0, 0, 80, { coneDirection: Math.PI / 2, coneAngle: Math.PI / 3 })), VIEW, 0, ALL);
    const cone = Array.from(b.data.subarray(LIGHT_OFFSET.cone, LIGHT_OFFSET.cone + 4));
    expect(cone[0]).toBeCloseTo(0, 6);
    expect(cone[1]).toBeCloseTo(1, 6);
    expect(cone[2]).toBeCloseTo(lightConeOuter(Math.PI / 3), 6);
    expect(cone[3]).toBeCloseTo(lightConeInner(Math.PI / 3), 6);
  });

  it('grows once for more lights, then packs without reallocating', () => {
    const b = new LightBatch();
    const many = new LightList(4);
    for (let i = 0; i < 300; i++) many.push(light((i % 30) * 8 - 120, Math.floor(i / 30) * 8 - 40, 12));
    b.pack(many, VIEW, 0, ALL);
    expect(b.count).toBe(256);
    const data = b.data;
    b.pack(many, VIEW, 0.5, ALL);
    expect(b.data).toBe(data);
  });
});
