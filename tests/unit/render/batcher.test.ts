/**
 * M1-12/M1-28: instanced sprite batcher – instance layout and capacity math, 5 000 sprites in at most
 * four draw calls (one per layer), records uploaded in sorted order and bit for bit as pushed, and no
 * reallocation in the frame path once the capacity is reached. M5-17 … M5-24: the record carries the surface
 * attribute (second palette row, row blend, surface flags, grass bend). M5-32: the depth range lives in a typed
 * array that the batcher hands to the y-sort (no boxed number per frame); a new `SpriteDesc` has the defaults of
 * `reset()` (its number fields start as doubles so their layout never changes). M5-51: the instance buffer is never
 * orphaned; only the spans of records that changed since the last frame are uploaded (the buffer, replayed from the
 * GL calls, always holds exactly the frame's records), and each layer's vertex array is re-pointed only when its
 * first record moves.
 */
import { describe, expect, it } from 'vitest';
import { SpriteBatcher, UPLOAD_SPANS } from '../../../src/render/batch/spriteBatcher';
import { drawCallsFor, grownCapacity, INSTANCE_STRIDE, INSTANCE_WORDS, instanceBytes, LAYER_COUNT, OFFSET, SPRITE_FLAG, SPRITE_LAYERS, SURFACE_FLAG } from '../../../src/render/batch/spriteLayout';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { SHADERS } from '../../../src/render/shaderLib';
import { Rng } from '../../../src/engine/rng';
import { YSorter } from '../../../src/render/sort/ysort';
import { createFakeGl, type FakeGl } from './fakeGl';

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
  it('one instance is 48 bytes (12 words); n sprites need n × 48 bytes', () => {
    expect(INSTANCE_STRIDE).toBe(48);
    expect(INSTANCE_WORDS).toBe(12);
    expect(instanceBytes(5000)).toBe(240_000);
    expect(OFFSET.misc + 4).toBe(OFFSET.surface);
    expect(OFFSET.surface + 4).toBe(INSTANCE_STRIDE);
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
    // No surface: no second row, no blend, no flags, no bend.
    expect([...u8.subarray(OFFSET.surface, OFFSET.surface + 4)]).toEqual([0, 0, 0, 0]);
    d.paletteRow = 256;
    expect(() => list.push(d)).toThrow(/Palettenzeile/);
  });

  it('SpriteList writes the surface attribute: second row and blend swap, shed dissolves, weathered, grass bend', () => {
    const list = new SpriteList(4);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.paletteRow = 3;
    d.paletteRow2 = 7;
    d.rowBlend = 0.5;
    d.weathered = true;
    d.bend = 1;
    list.push(d);
    d.shed = true;
    d.paletteRow2 = -1;
    d.rowBlend = 0.25;
    d.weathered = false;
    d.bend = 0.35;
    list.push(d);
    const u8 = new Uint8Array(list.words.buffer);
    expect([...u8.subarray(OFFSET.surface, OFFSET.surface + 4)]).toEqual([7, 128, SURFACE_FLAG.swap | SURFACE_FLAG.weathered, 255]);
    expect([...u8.subarray(INSTANCE_STRIDE + OFFSET.surface, INSTANCE_STRIDE + OFFSET.surface + 4)]).toEqual([0, 64, SURFACE_FLAG.shed, 89]);
    d.paletteRow2 = 256;
    expect(() => list.push(d)).toThrow(/Palettenzeile/);
    // `reset` clears the surface fields.
    d.reset();
    expect([d.paletteRow2, d.rowBlend, d.shed, d.weathered, d.bend]).toEqual([-1, 0, false, false, 0]);
  });

  it('M5-32: the depth range is a typed array, reset by clear', () => {
    const list = new SpriteList(4);
    const d = new SpriteDesc();
    d.frame = FRAME;
    expect(list.depthRange).toBeInstanceOf(Float64Array);
    expect([...list.depthRange]).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    for (const y of [12.5, -3, 40]) {
      d.y = y;
      list.push(d);
    }
    d.depth = Number.POSITIVE_INFINITY;
    list.push(d);
    expect([...list.depthRange]).toEqual([-3, 40]);
    expect([list.depthMin, list.depthMax]).toEqual([-3, 40]);
    list.clear();
    expect([...list.depthRange]).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  });

  it('M5-32: a new SpriteDesc carries exactly the defaults of reset() – the double its number fields start with never shows', () => {
    const fresh = new SpriteDesc();
    const used = new SpriteDesc();
    used.frame = FRAME;
    used.x = 12.5;
    used.depth = 3;
    used.paletteRow = 4;
    used.paletteRow2 = 2;
    used.rowBlend = 0.75;
    used.tintStrength = 0.5;
    used.mirror = true;
    used.creep = true;
    used.reset();
    expect({ ...fresh }).toEqual({ ...used });
    for (const [key, value] of Object.entries(fresh)) {
      if (typeof value !== 'number') continue;
      if (key === 'depth') expect(value, key).toBeNaN();
      else expect(Number.isFinite(value), key).toBe(true);
    }
    expect([fresh.x, fresh.y, fresh.paletteRow, fresh.paletteRow2, fresh.fade, fresh.bend]).toEqual([0, 0, 0, -1, 0, 0]);
  });
});

/** Frames of up to 5 000 sorted sprites and their replayed uploads: room for a loaded machine. */
const BATCH_TIMEOUT_MS = 30_000;

describe('SpriteBatcher', { timeout: BATCH_TIMEOUT_MS }, () => {
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

  it('uploads every record bit for bit in sorted order, frame after frame, while the list grows', () => {
    const { fake, b } = batcher();
    const list = new SpriteList(8);
    const d = new SpriteDesc();
    const rng = new Rng(2028);
    for (const n of [5, 700, 3000, 64]) {
      list.clear();
      for (let i = 0; i < n; i++) {
        d.reset();
        d.frame = { x: Math.floor(rng.next() * 512), y: Math.floor(rng.next() * 512), w: 16, h: 24, ax: 8, ay: 23 };
        d.layer = SPRITE_LAYERS[Math.floor(rng.next() * LAYER_COUNT)] ?? 'objects';
        d.x = rng.next() * 900 - 450;
        d.y = rng.next() * 500 - 250;
        d.mirror = rng.next() < 0.5;
        d.windAmplitude = rng.next() < 0.3 ? rng.next() * 2 : 0;
        d.emissiveBoost = rng.next();
        d.tintR = Math.floor(rng.next() * 256);
        d.paletteRow = Math.floor(rng.next() * 8);
        d.paletteRow2 = rng.next() < 0.5 ? Math.floor(rng.next() * 8) : -1;
        d.rowBlend = rng.next();
        d.weathered = rng.next() < 0.5;
        d.bend = rng.next() < 0.3 ? rng.next() : 0;
        list.push(d);
      }
      fake.calls.length = 0;
      b.prepare(list);
      const order = new YSorter().sort(list.layerKeys, list.depthKeys, n);
      const expected = new Uint32Array(n * INSTANCE_WORDS);
      for (let i = 0; i < n; i++) expected.set(list.words.subarray((order[i] ?? 0) * INSTANCE_WORDS, ((order[i] ?? 0) + 1) * INSTANCE_WORDS), i * INSTANCE_WORDS);
      const upload = fake.calls.find((c) => c.name === 'bufferSubData');
      expect(upload?.args[4]).toBe(n * INSTANCE_WORDS);
      expect((upload?.args[2] as Uint32Array).subarray(0, n * INSTANCE_WORDS)).toEqual(expected);
    }
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
    // M5-51: no bufferData in the frame path at all – no growth and no orphaning.
    expect(fake.count('bufferData') - allocations).toBe(0);
  });

  it('M5-32: the batcher hands the list\'s depth range to the y-sort without reading the depth getters', () => {
    const { b } = batcher();
    const list = new SpriteList();
    fill(list, 300);
    const reference = [...new YSorter().sort(list.layerKeys, list.depthKeys, list.count).subarray(0, list.count)];
    const boxed = (): number => {
      throw new Error('depthMin/depthMax im Frame-Pfad gelesen');
    };
    Object.defineProperty(list, 'depthMin', { get: boxed });
    Object.defineProperty(list, 'depthMax', { get: boxed });
    expect(() => b.prepare(list)).not.toThrow();
    const sorter = new YSorter();
    expect([...sorter.sortInRange(list.layerKeys, list.depthKeys, list.count, list.depthRange).subarray(0, list.count)]).toEqual(reference);
  });

  /**
   * The instance buffer as the GPU holds it: the batcher's GL calls replayed (bufferData allocates zeroed storage,
   * bufferSubData copies) for the buffer bound to ARRAY_BUFFER. `sync` replays the calls since the last one at once –
   * the batcher reuses its arrays, so a later frame would overwrite what an earlier call handed over.
   */
  function mirror(fake: FakeGl) {
    const stores = new Map<unknown, Uint8Array>();
    let bound: unknown = null;
    let seen = 0;
    let bufferDatas = 0;
    let subDatas = 0;
    return {
      sync(): void {
        for (; seen < fake.calls.length; seen++) {
          const c = fake.calls[seen] as { name: string; args: readonly unknown[] };
          if (c.name === 'bindBuffer' && c.args[0] === fake.gl.ARRAY_BUFFER) bound = c.args[1];
          else if (c.name === 'bufferData' && c.args[0] === fake.gl.ARRAY_BUFFER) {
            bufferDatas++;
            const size = typeof c.args[1] === 'number' ? c.args[1] : (c.args[1] as ArrayBufferView).byteLength;
            stores.set(bound, new Uint8Array(size));
          } else if (c.name === 'bufferSubData' && c.args[0] === fake.gl.ARRAY_BUFFER) {
            subDatas++;
            const dst = stores.get(bound);
            if (dst === undefined) throw new Error('bufferSubData ohne Speicher');
            const src = c.args[2] as Uint32Array;
            const off = c.args[3] as number;
            const len = c.args[4] as number;
            dst.set(new Uint8Array(src.buffer, src.byteOffset + off * 4, len * 4), c.args[1] as number);
          }
        }
      },
      /** Words of the last buffer that received instance data. */
      words(handle: unknown): Uint32Array {
        const b = stores.get(handle);
        if (b === undefined) throw new Error('kein Instanzpuffer');
        return new Uint32Array(b.buffer);
      },
      get bufferDatas() {
        return bufferDatas;
      },
      get subDatas() {
        return subDatas;
      },
    };
  }

  /** The handle of the instance buffer (the target of the batcher's bufferSubData calls). */
  function instanceHandle(fake: FakeGl): unknown {
    for (let i = fake.calls.length - 1; i >= 0; i--) {
      const c = fake.calls[i];
      if (c?.name === 'bufferSubData') {
        for (let j = i; j >= 0; j--) if (fake.calls[j]?.name === 'bindBuffer' && fake.calls[j]?.args[0] === fake.gl.ARRAY_BUFFER) return fake.calls[j]?.args[1];
      }
    }
    return null;
  }

  /** The records of `list` in the batcher's draw order. */
  function sorted(list: SpriteList): Uint32Array {
    const n = list.count;
    const order = new YSorter().sort(list.layerKeys, list.depthKeys, n);
    const out = new Uint32Array(n * INSTANCE_WORDS);
    for (let i = 0; i < n; i++) out.set(list.words.subarray((order[i] ?? 0) * INSTANCE_WORDS, ((order[i] ?? 0) + 1) * INSTANCE_WORDS), i * INSTANCE_WORDS);
    return out;
  }

  /** A scene of `n` sprites: `moved` of them walked `step` px down, `animated` show another frame. */
  function scene(list: SpriteList, n: number, moved: ReadonlySet<number>, step: number, animated: ReadonlySet<number>): void {
    const d = new SpriteDesc();
    list.clear();
    for (let i = 0; i < n; i++) {
      d.reset();
      d.frame = animated.has(i) ? { ...FRAME, x: 48 } : FRAME;
      d.layer = SPRITE_LAYERS[i % LAYER_COUNT] ?? 'objects';
      d.x = (i * 37) % 480;
      d.y = ((i * 7919) % 1000) + (moved.has(i) ? step : 0);
      list.push(d);
    }
  }

  it('M5-51: ein unveränderter Frame lädt nichts hoch; der Puffer hält immer genau die Datensätze des Frames', () => {
    const { fake, b } = batcher();
    const m = mirror(fake);
    const list = new SpriteList();
    scene(list, 3000, new Set(), 0, new Set());
    b.prepare(list);
    m.sync();
    const handle = instanceHandle(fake);
    expect(b.uploadedRecords).toBe(3000);
    expect(b.uploadSpans).toBe(1);
    expect(m.words(handle).subarray(0, 3000 * INSTANCE_WORDS)).toEqual(sorted(list));
    const subDatas = m.subDatas;
    for (let frame = 0; frame < 5; frame++) {
      scene(list, 3000, new Set(), 0, new Set());
      b.prepare(list);
      m.sync();
      expect(b.uploadedRecords).toBe(0);
      expect(b.uploadSpans).toBe(0);
    }
    expect(m.subDatas).toBe(subDatas);
    expect(m.words(handle).subarray(0, 3000 * INSTANCE_WORDS)).toEqual(sorted(list));
  });

  it('M5-51: nur die geänderten Spannen – ein Sprite mit neuem Frame lädt einen Datensatz, verstreute Änderungen höchstens maxSpans Spannen', () => {
    const { fake, b } = batcher();
    const m = mirror(fake);
    const list = new SpriteList();
    scene(list, 4000, new Set(), 0, new Set());
    b.prepare(list);
    m.sync();
    const handle = instanceHandle(fake);
    // One sprite shows another frame: its record alone.
    scene(list, 4000, new Set(), 0, new Set([1234]));
    b.prepare(list);
    m.sync();
    expect(b.uploadSpans).toBe(1);
    expect(b.uploadedRecords).toBe(1);
    expect(m.words(handle).subarray(0, 4000 * INSTANCE_WORDS)).toEqual(sorted(list));
    // Changes far apart: one span each, up to `maxSpans`; the rest joins the last span.
    const rng = new Rng(51);
    for (const changes of [3, UPLOAD_SPANS.maxSpans, 40, 400]) {
      const animated = new Set<number>();
      while (animated.size < changes) animated.add(Math.floor(rng.next() * 4000));
      scene(list, 4000, new Set(), 0, animated);
      b.prepare(list);
      m.sync();
      expect(b.uploadSpans).toBeLessThanOrEqual(UPLOAD_SPANS.maxSpans);
      expect(b.uploadedRecords).toBeLessThan(4000);
      expect(m.words(handle).subarray(0, 4000 * INSTANCE_WORDS), `${changes} Änderungen`).toEqual(sorted(list));
    }
    // Everything walks: the y-order shifts everywhere – one span of all records.
    const all = new Set(Array.from({ length: 4000 }, (_, i) => i));
    scene(list, 4000, all, 0.25, new Set());
    b.prepare(list);
    m.sync();
    expect(m.words(handle).subarray(0, 4000 * INSTANCE_WORDS)).toEqual(sorted(list));
    expect(m.bufferDatas).toBe(fake.count('bufferData'));
  });

  it('M5-51: ein wachsender Puffer und ein wiederhergestellter Kontext laden einmal alles, danach wieder nur Änderungen', () => {
    const { fake, b } = batcher();
    const m = mirror(fake);
    const list = new SpriteList();
    scene(list, 500, new Set(), 0, new Set());
    b.prepare(list);
    // Grows: the buffer is re-specified (bufferData), every record comes again.
    scene(list, 3000, new Set(), 0, new Set());
    b.prepare(list);
    m.sync();
    expect(b.uploadedRecords).toBe(3000);
    expect(m.words(instanceHandle(fake)).subarray(0, 3000 * INSTANCE_WORDS)).toEqual(sorted(list));
    // Fewer sprites: no reallocation, at most the 1 000 records of the frame.
    scene(list, 1000, new Set(), 0, new Set());
    b.prepare(list);
    expect(b.uploadedRecords).toBeLessThanOrEqual(1000);
    m.sync();
    expect(m.words(instanceHandle(fake)).subarray(0, 1000 * INSTANCE_WORDS)).toEqual(sorted(list));
    // Context lost and restored: the registry recreates the buffer (a new handle, fresh storage) – all records again.
    const buffer = (b as unknown as { instances: { forget(): void; create(): void } }).instances;
    buffer.forget();
    buffer.create();
    scene(list, 1000, new Set(), 0, new Set());
    b.prepare(list);
    m.sync();
    expect(b.uploadedRecords).toBe(1000);
    expect(m.words(instanceHandle(fake)).subarray(0, 1000 * INSTANCE_WORDS)).toEqual(sorted(list));
    scene(list, 1000, new Set(), 0, new Set());
    b.prepare(list);
    expect(b.uploadedRecords).toBe(0);
  });

  it('M5-51: jede Ebene hat ihr eigenes Vertex-Array, neu ausgerichtet nur wenn ihr erster Datensatz wandert (auch im Schattenpass kein Umzeigen)', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    fill(list, 400);
    b.prepare(list);
    const pointers = (): number => fake.count('vertexAttribPointer') + fake.count('vertexAttribIPointer');
    const before = pointers();
    for (let l = 0; l < LAYER_COUNT; l++) b.drawLayer(l);
    // Layer 0 starts at record 0 like a fresh vertex array – the other three point at their first record once.
    const first = pointers() - before;
    expect(first).toBeGreaterThan(0);
    // The shadow pass draws objects and canopy again, the next frame all layers: no pointer moves.
    const steady = pointers();
    b.drawLayer(2);
    b.drawLayer(3);
    list.clear();
    fill(list, 400);
    b.prepare(list);
    for (let l = 0; l < LAYER_COUNT; l++) b.drawLayer(l);
    expect(pointers()).toBe(steady);
    // One more sprite in the ground layer: every later layer's first record moves.
    list.clear();
    fill(list, 401);
    b.prepare(list);
    const moved = pointers();
    for (let l = 0; l < LAYER_COUNT; l++) b.drawLayer(l);
    expect(pointers()).toBeGreaterThan(moved);
    // Each draw binds its layer's own vertex array.
    const vaos = fake.calls.filter((c) => c.name === 'bindVertexArray').slice(-LAYER_COUNT).map((c) => c.args[0]);
    expect(new Set(vaos).size).toBe(LAYER_COUNT);
    // A restored context has new vertex arrays: they are pointed again.
    const again = pointers();
    for (let l = 0; l < LAYER_COUNT; l++) b.drawLayer(l);
    expect(pointers()).toBe(again);
    const vaoOf = (b as unknown as { vaos: Array<{ forget(): void; create(): void }> }).vaos;
    for (const v of vaoOf) {
      v.forget();
      v.create();
    }
    const created = pointers();
    for (let l = 0; l < LAYER_COUNT; l++) b.drawLayer(l);
    expect(pointers()).toBeGreaterThan(created);
  });

  it('empty layers issue no draw call', () => {
    const { fake, b } = batcher();
    const list = new SpriteList();
    b.prepare(list);
    for (let l = 0; l < LAYER_COUNT; l++) expect(b.drawLayer(l)).toBe(0);
    expect(fake.count('drawArraysInstanced')).toBe(0);
  });
});
