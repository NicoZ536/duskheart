/**
 * M1-12: instanced sprite batcher – instance layout and capacity math, 5 000 sprites in at most
 * four draw calls (one per layer), records uploaded in sorted order, and no reallocation in the
 * frame path once the capacity is reached.
 */
import { describe, expect, it } from 'vitest';
import { SpriteBatcher } from '../../../src/render/batch/spriteBatcher';
import { drawCallsFor, grownCapacity, INSTANCE_STRIDE, INSTANCE_WORDS, instanceBytes, LAYER_COUNT, OFFSET, SPRITE_FLAG, SPRITE_LAYERS } from '../../../src/render/batch/spriteLayout';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

const FRAME = { x: 16, y: 32, w: 16, h: 24, ax: 8, ay: 23 };

function fill(list: SpriteList, n: number): void {
  const d = new SpriteDesc();
  for (let i = 0; i < n; i++) {
    d.reset();
    d.frame = FRAME;
    d.layer = SPRITE_LAYERS[i % LAYER_COUNT] ?? 'objects';
    d.x = i;
    d.y = (i * 7919) % 1000;
    list.push(d);
  }
}

describe('Instanz-Layout und Kapazität', () => {
  it('one instance is 44 bytes (11 words); n sprites need n × 44 bytes', () => {
    expect(INSTANCE_STRIDE).toBe(44);
    expect(INSTANCE_WORDS).toBe(11);
    expect(instanceBytes(5000)).toBe(220_000);
    expect(OFFSET.misc + 4).toBe(INSTANCE_STRIDE);
  });

  it('grows by doubling', () => {
    expect(grownCapacity(1024, 5000)).toBe(8192);
    expect(grownCapacity(1024, 1024)).toBe(1024);
    expect(grownCapacity(0, 3)).toBe(4);
  });

  it('draw calls = non-empty layers', () => {
    expect(drawCallsFor([10, 0, 4990, 0])).toBe(2);
    expect(drawCallsFor([1, 1, 1, 1])).toBe(4);
    expect(drawCallsFor([0, 0, 0, 0])).toBe(0);
  });

  it('SpriteList writes the documented fields', () => {
    const list = new SpriteList(2);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.x = 10.5;
    d.y = -3;
    d.mirror = true;
    d.windAmplitude = 2;
    d.paletteRow = 5;
    d.emissiveBoost = 1;
    d.fade = 0.5;
    d.tintR = 200;
    d.tintStrength = 1;
    list.push(d);
    const f32 = new Float32Array(list.words.buffer);
    const u16 = new Uint16Array(list.words.buffer);
    const i16 = new Int16Array(list.words.buffer);
    const u8 = new Uint8Array(list.words.buffer);
    expect([f32[0], f32[1]]).toEqual([10.5, -3]);
    expect(f32[OFFSET.params / 4 + 1]).toBe(2);
    expect([...u16.subarray(OFFSET.rect / 2, OFFSET.rect / 2 + 4)]).toEqual([16, 32, 16, 24]);
    expect([i16[OFFSET.anchor / 2], i16[OFFSET.anchor / 2 + 1]]).toEqual([8, 23]);
    expect([...u8.subarray(OFFSET.tint, OFFSET.tint + 4)]).toEqual([200, 0, 0, 255]);
    expect([...u8.subarray(OFFSET.misc, OFFSET.misc + 4)]).toEqual([5, SPRITE_FLAG.mirror | SPRITE_FLAG.wind, 255, 128]);
    d.paletteRow = 256;
    expect(() => list.push(d)).toThrow(/Palettenzeile/);
  });
});

describe('SpriteBatcher', () => {
  function batcher() {
    const fake = createFakeGl();
    const registry = new GpuResourceRegistry();
    const shaders = new ShaderLibrary(fake.gl, registry, new ShaderSourceStore(SHADERS), {}, { report: () => undefined });
    return { fake, b: new SpriteBatcher(fake.gl, registry, shaders) };
  }

  it('draws 5 000 sprites in four instanced draw calls, one per layer', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    fill(list, 5000);
    b.prepare(list);
    let calls = 0;
    for (let l = 0; l < LAYER_COUNT; l++) calls += b.drawLayer(l);
    expect(calls).toBe(4);
    expect(fake.count('drawArraysInstanced')).toBe(4);
    const counts = fake.calls.filter((c) => c.name === 'drawArraysInstanced').map((c) => c.args[3]);
    expect(counts).toEqual([1250, 1250, 1250, 1250]);
  });

  it('uploads the records in (layer, depth) order', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    fill(list, 12);
    b.prepare(list);
    const upload = fake.calls.find((c) => c.name === 'bufferSubData');
    const words = upload?.args[2] as Uint32Array;
    const f32 = new Float32Array(words.buffer);
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      const x = f32[i * INSTANCE_WORDS] ?? 0;
      seen.push([x % LAYER_COUNT, f32[i * INSTANCE_WORDS + 1] ?? 0]);
    }
    for (let i = 1; i < seen.length; i++) {
      const [la, da] = seen[i - 1] ?? [0, 0];
      const [lb, db] = seen[i] ?? [0, 0];
      expect(lb > la || (lb === la && db >= da)).toBe(true);
    }
    expect(upload?.args[4]).toBe(12 * INSTANCE_WORDS);
  });

  it('the frame path does not reallocate once the capacity is reached', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    fill(list, 5000);
    b.prepare(list);
    const capacity = b.capacity;
    const buffer = list.words;
    const allocations = fake.count('bufferData');
    for (let frame = 0; frame < 20; frame++) {
      list.clear();
      fill(list, 5000);
      b.prepare(list);
    }
    expect(b.capacity).toBe(capacity);
    expect(list.words).toBe(buffer);
    // Only the per-frame orphaning (one bufferData per frame), never a growth.
    expect(fake.count('bufferData') - allocations).toBe(20);
  });

  it('empty layers issue no draw call', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    b.prepare(list);
    for (let l = 0; l < LAYER_COUNT; l++) expect(b.drawLayer(l)).toBe(0);
    expect(fake.count('drawArraysInstanced')).toBe(0);
  });
});
