import { describe, expect, it } from 'vitest';
import {
  ColumnStore,
  Ecs,
  MAX_ENTITIES,
  MAX_GENERATION,
  NULL_ENTITY,
  Query,
  SparseSet,
  columnStoreSerializer,
  entityGeneration,
  entityIndex,
  isEntityHandle,
  makeEntity,
  queryEach,
  sparseSetSerializer,
  type Entity,
} from '../../../src/engine/ecs';

interface Health {
  hp: number;
  max: number;
}

function parseHealth(raw: unknown): Health {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('bad health');
  const { hp, max } = raw as { hp?: unknown; max?: unknown };
  if (typeof hp !== 'number' || typeof max !== 'number') throw new TypeError('bad health');
  return { hp, max };
}

describe('entity handles', () => {
  it('pack index and generation', () => {
    const e = makeEntity(12345, 17);
    expect(entityIndex(e)).toBe(12345);
    expect(entityGeneration(e)).toBe(17);
    const top = makeEntity(MAX_ENTITIES - 1, MAX_GENERATION);
    expect(top).toBe(0xffffffff);
    expect(entityIndex(top)).toBe(MAX_ENTITIES - 1);
    expect(entityGeneration(top)).toBe(MAX_GENERATION);
    expect(isEntityHandle(top)).toBe(true);
    expect(isEntityHandle(NULL_ENTITY)).toBe(false);
    expect(isEntityHandle(1.5)).toBe(false);
  });
});

describe('Ecs allocator', () => {
  it('creates, destroys and detects stale handles', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 0 });
    const a = ecs.create();
    const b = ecs.create();
    expect(ecs.count).toBe(2);
    expect(ecs.alive(a)).toBe(true);
    expect(ecs.destroy(a)).toBe(true);
    expect(ecs.destroy(a)).toBe(false);
    expect(ecs.alive(a)).toBe(false);
    expect(ecs.count).toBe(1);
    const c = ecs.create();
    expect(entityIndex(c)).toBe(entityIndex(a));
    expect(entityGeneration(c)).toBe(entityGeneration(a) + 1);
    expect(ecs.alive(a)).toBe(false);
    expect(ecs.alive(c)).toBe(true);
    expect(ecs.alive(b)).toBe(true);
    expect(ecs.alive(NULL_ENTITY)).toBe(false);
    expect(ecs.alive(makeEntity(999, 0))).toBe(false);
  });

  it('delays index reuse until enough indices are free (FIFO)', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 3 });
    const es = Array.from({ length: 5 }, () => ecs.create());
    for (const e of es.slice(0, 4)) ecs.destroy(e);
    // 4 free > 3: reuse starts with the oldest freed index.
    const n1 = ecs.create();
    expect(entityIndex(n1)).toBe(entityIndex(es[0] as Entity));
    // 3 free left, not > 3: fresh index.
    const n2 = ecs.create();
    expect(entityIndex(n2)).toBe(5);
    expect(ecs.indexCount).toBe(6);
  });

  it('wraps generations', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 0 });
    let e = ecs.create();
    for (let i = 0; i < MAX_GENERATION; i++) {
      ecs.destroy(e);
      e = ecs.create();
    }
    expect(entityGeneration(e)).toBe(MAX_GENERATION);
    ecs.destroy(e);
    e = ecs.create();
    expect(entityGeneration(e)).toBe(0);
    expect(ecs.alive(e)).toBe(true);
  });

  it('grows past the initial capacity', () => {
    const ecs = new Ecs();
    const list: Entity[] = [];
    for (let i = 0; i < 5000; i++) list.push(ecs.create());
    expect(ecs.count).toBe(5000);
    expect(list.every((e) => ecs.alive(e))).toBe(true);
    expect(new Set(list).size).toBe(5000);
  });

  it('deferred destruction runs at flush', () => {
    const ecs = new Ecs();
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const a = ecs.create();
    const b = ecs.create();
    hp.add(a, { hp: 1, max: 1 });
    ecs.queueDestroy(a);
    ecs.queueDestroy(a);
    ecs.queueDestroy(b);
    expect(ecs.alive(a)).toBe(true);
    expect(ecs.pendingDestroyCount).toBe(3);
    expect(ecs.flushDestroyed()).toBe(2);
    expect(ecs.alive(a)).toBe(false);
    expect(hp.has(a)).toBe(false);
    expect(ecs.count).toBe(0);
  });

  it('destroy removes from all stores and notifies listeners first', () => {
    const ecs = new Ecs();
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32', y: 'f32' }));
    const e = ecs.create();
    hp.add(e, { hp: 5, max: 5 });
    pos.add(e);
    const seen: number[] = [];
    const off = ecs.onDestroy((d) => seen.push(hp.get(d)?.hp ?? -1));
    ecs.destroy(e);
    expect(seen).toEqual([5]);
    expect(hp.size).toBe(0);
    expect(pos.size).toBe(0);
    off();
    const f = ecs.create();
    ecs.destroy(f);
    expect(seen).toEqual([5]);
  });

  it('a destroy listener that destroys the same entity again cannot double free its index', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 0 });
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const parent = ecs.create();
    const child = ecs.create();
    hp.add(parent, { hp: 3, max: 3 });
    const seenAlive: boolean[] = [];
    const readable: number[] = [];
    ecs.onDestroy((e) => {
      seenAlive.push(ecs.alive(e));
      readable.push(hp.get(e)?.hp ?? -1);
      // Cascading destruction (e.g. parent ↔ child links) re-enters destroy for `e` itself.
      expect(ecs.destroy(e)).toBe(false);
      if (e === parent) ecs.destroy(child);
      if (e === child) ecs.destroy(parent);
    });
    expect(ecs.destroy(parent)).toBe(true);
    expect(seenAlive).toEqual([false, false]);
    expect(readable).toEqual([3, -1]);
    expect(ecs.count).toBe(0);
    // Each index was freed exactly once: two creates reuse two distinct indices.
    const a = ecs.create();
    const b = ecs.create();
    expect(entityIndex(a)).not.toBe(entityIndex(b));
    expect(ecs.count).toBe(2);
    expect(ecs.alive(parent)).toBe(false);
    expect(ecs.alive(child)).toBe(false);
  });

  it('completes the destroy when a listener throws', () => {
    const ecs = new Ecs();
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const e = ecs.create();
    hp.add(e, { hp: 1, max: 1 });
    ecs.onDestroy(() => {
      throw new Error('listener failed');
    });
    expect(() => ecs.destroy(e)).toThrow('listener failed');
    expect(ecs.alive(e)).toBe(false);
    expect(hp.size).toBe(0);
    expect(ecs.count).toBe(0);
  });

  it('stale handles never reach the component of a reused index', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 0 });
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32' }));
    const old = ecs.create();
    hp.add(old, { hp: 1, max: 1 });
    pos.add(old);
    ecs.destroy(old);
    const reused = ecs.create();
    expect(entityIndex(reused)).toBe(entityIndex(old));
    expect(entityGeneration(reused)).toBe(entityGeneration(old) + 1);
    hp.add(reused, { hp: 9, max: 9 });
    pos.add(reused);
    pos.set(reused, 'x', 4);
    expect(hp.get(old)).toBeUndefined();
    expect(hp.has(old)).toBe(false);
    expect(pos.has(old)).toBe(false);
    expect(() => pos.get(old, 'x')).toThrow(RangeError);
    expect(hp.remove(old)).toBe(false);
    expect(pos.remove(old)).toBe(false);
    expect(ecs.destroy(old)).toBe(false);
    expect(hp.get(reused)?.hp).toBe(9);
    expect(pos.get(reused, 'x')).toBe(4);
  });

  it('rejects duplicate registrations', () => {
    const ecs = new Ecs();
    const s = new SparseSet<number>();
    ecs.registerComponent('a', s);
    expect(() => ecs.registerComponent('a', new SparseSet<number>())).toThrow();
    expect(() => ecs.registerComponent('b', s)).toThrow();
    expect(ecs.component('a')).toBe(s);
    expect(ecs.componentNames()).toEqual(['a']);
  });

  it('forEachAlive visits live entities in index order', () => {
    const ecs = new Ecs({ minFreeBeforeReuse: 0 });
    const es = [ecs.create(), ecs.create(), ecs.create()];
    ecs.destroy(es[1] as Entity);
    const seen: Entity[] = [];
    ecs.forEachAlive((e) => seen.push(e));
    expect(seen).toEqual([es[0], es[2]]);
  });
});

describe('SparseSet', () => {
  it('add/get/has/remove with swap-back', () => {
    const set = new SparseSet<string>();
    const es = [1, 2, 3, 4].map((i) => makeEntity(i, 0));
    es.forEach((e, i) => set.add(e, `v${i}`));
    expect(set.size).toBe(4);
    expect(set.get(es[2] as Entity)).toBe('v2');
    expect(set.remove(es[0] as Entity)).toBe(true);
    expect(set.remove(es[0] as Entity)).toBe(false);
    expect(set.size).toBe(3);
    expect(set.entityAt(0)).toBe(es[3]);
    expect(set.valueAt(0)).toBe('v3');
    expect(set.get(es[3] as Entity)).toBe('v3');
    set.add(es[1] as Entity, 'replaced');
    expect(set.size).toBe(3);
    expect(set.get(es[1] as Entity)).toBe('replaced');
    expect(Array.from(set.entities.subarray(0, set.size)).sort()).toEqual([es[1], es[2], es[3]].sort());
  });

  it('distinguishes generations and overwrites stale handles', () => {
    const set = new SparseSet<number>();
    const old = makeEntity(7, 0);
    const fresh = makeEntity(7, 1);
    set.add(old, 1);
    expect(set.has(fresh)).toBe(false);
    expect(set.get(fresh)).toBeUndefined();
    set.add(fresh, 2);
    expect(set.size).toBe(1);
    expect(set.has(old)).toBe(false);
    expect(set.get(fresh)).toBe(2);
    expect(set.has(NULL_ENTITY)).toBe(false);
    expect(() => set.add(NULL_ENTITY, 3)).toThrow(RangeError);
  });

  it('handles large sparse indices and clear', () => {
    const set = new SparseSet<number>();
    const far = makeEntity(MAX_ENTITIES - 1, 3);
    set.add(far, 9);
    for (let i = 0; i < 1000; i++) set.add(makeEntity(i, 0), i);
    expect(set.get(far)).toBe(9);
    expect(set.size).toBe(1001);
    set.clear();
    expect(set.size).toBe(0);
    expect(set.has(far)).toBe(false);
  });

  it('forEach allows removing the current entry', () => {
    const set = new SparseSet<number>();
    for (let i = 0; i < 10; i++) set.add(makeEntity(i, 0), i);
    const seen: number[] = [];
    set.forEach((v, e) => {
      seen.push(v);
      if (v % 2 === 0) set.remove(e);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(set.size).toBe(5);
  });
});

describe('ColumnStore', () => {
  it('stores typed columns with swap-back removal', () => {
    const store = new ColumnStore({ x: 'f32', y: 'f32', hp: 'i32', flags: 'u8' }, 2);
    const es = [0, 1, 2, 3].map((i) => makeEntity(i, 0));
    for (const [i, e] of es.entries()) {
      const row = store.add(e);
      const { x, y, hp } = store.columns;
      x[row] = i + 0.5;
      y[row] = -i;
      hp[row] = 100 + i;
    }
    expect(store.capacity).toBeGreaterThanOrEqual(4);
    expect(store.columns.x).toBeInstanceOf(Float32Array);
    expect(store.columns.hp).toBeInstanceOf(Int32Array);
    expect(store.columns.flags).toBeInstanceOf(Uint8Array);
    expect(store.get(es[2] as Entity, 'x')).toBe(2.5);
    expect(store.remove(es[0] as Entity)).toBe(true);
    expect(store.size).toBe(3);
    expect(store.indexOf(es[3] as Entity)).toBe(0);
    expect(store.get(es[3] as Entity, 'hp')).toBe(103);
    store.set(es[3] as Entity, 'y', 42);
    expect(store.column('y')[0]).toBe(42);
    expect(store.add(es[3] as Entity)).toBe(0); // existing row
    expect(() => store.get(es[0] as Entity, 'x')).toThrow(RangeError);
    // New rows are zeroed even when reusing memory.
    const row = store.add(es[0] as Entity);
    expect(store.column('hp')[row]).toBe(0);
    expect(() => store.column('nope' as 'x')).toThrow(RangeError);
  });

  it('rejects empty schemas and bad capacities', () => {
    expect(() => new ColumnStore({})).toThrow(RangeError);
    expect(() => new ColumnStore({ x: 'f32' }, 0)).toThrow(RangeError);
  });

  it('reuses a stale row for a newer generation', () => {
    const store = new ColumnStore({ v: 'f64' });
    const old = makeEntity(3, 0);
    store.columns.v[store.add(old)] = 7;
    const fresh = makeEntity(3, 1);
    expect(store.has(fresh)).toBe(false);
    const row = store.add(fresh);
    expect(store.size).toBe(1);
    expect(store.columns.v[row]).toBe(0);
    expect(store.has(old)).toBe(false);
  });
});

describe('queries', () => {
  it('iterate the intersection via the smallest store', () => {
    const ecs = new Ecs();
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32', y: 'f32' }));
    const tag = ecs.registerComponent('tag', new SparseSet<true>());
    const hp = ecs.registerComponent('hp', new SparseSet<Health>());
    const es: Entity[] = [];
    for (let i = 0; i < 100; i++) {
      const e = ecs.create();
      es.push(e);
      pos.add(e);
      if (i % 2 === 0) hp.add(e, { hp: i, max: 100 });
      if (i % 10 === 0) tag.add(e, true);
    }
    const seen: Entity[] = [];
    const stores = [pos, hp, tag];
    queryEach(stores, (e) => seen.push(e));
    expect(seen.sort((a, b) => a - b)).toEqual(es.filter((_, i) => i % 10 === 0));
    const q = new Query([pos, hp]);
    expect(q.count()).toBe(50);
    expect(new Query([pos, hp, tag]).count()).toBe(10);
    expect(new Query([]).count()).toBe(0);
    let n = 0;
    ecs.query([pos], () => n++);
    expect(n).toBe(100);
    queryEach([], () => {
      throw new Error('must not be called');
    });
  });

  it('allows removing the current entity during iteration', () => {
    const ecs = new Ecs();
    const a = ecs.registerComponent('a', new SparseSet<number>());
    const b = ecs.registerComponent('b', new SparseSet<number>());
    for (let i = 0; i < 20; i++) {
      const e = ecs.create();
      a.add(e, i);
      b.add(e, i);
    }
    let visited = 0;
    queryEach([a, b], (e) => {
      visited++;
      ecs.destroy(e);
    });
    expect(visited).toBe(20);
    expect(a.size).toBe(0);
    expect(ecs.count).toBe(0);
  });
});

describe('snapshot / restore', () => {
  function build(): { ecs: Ecs; hp: SparseSet<Health>; pos: ColumnStore<{ x: 'f32'; y: 'f32'; id: 'u32' }>; cache: SparseSet<number> } {
    const ecs = new Ecs({ minFreeBeforeReuse: 2 });
    const hp = ecs.registerComponent('hp', new SparseSet<Health>(), sparseSetSerializer(parseHealth));
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32', y: 'f32', id: 'u32' }), columnStoreSerializer());
    const cache = ecs.registerComponent('cache', new SparseSet<number>());
    return { ecs, hp, pos, cache };
  }

  it('roundtrips allocator and components through JSON', () => {
    const src = build();
    const es: Entity[] = [];
    for (let i = 0; i < 40; i++) {
      const e = src.ecs.create();
      es.push(e);
      src.hp.add(e, { hp: i, max: 50 });
      const row = src.pos.add(e);
      src.pos.columns.x[row] = i * 1.1;
      src.pos.columns.y[row] = -i / 3;
      src.pos.columns.id[row] = 4_000_000_000 - i;
      src.cache.add(e, i);
    }
    for (let i = 0; i < 40; i += 3) src.ecs.destroy(es[i] as Entity);
    src.ecs.queueDestroy(es[1] as Entity);
    const json = JSON.stringify(src.ecs.snapshot());

    const dst = build();
    dst.cache.add(dst.ecs.create(), 1);
    dst.ecs.restore(JSON.parse(json) as unknown);
    expect(dst.ecs.count).toBe(src.ecs.count);
    expect(dst.ecs.pendingDestroyCount).toBe(1);
    expect(dst.cache.size).toBe(0); // not serialized: cleared
    for (const e of es) {
      expect(dst.ecs.alive(e)).toBe(src.ecs.alive(e));
      expect(dst.hp.get(e)).toEqual(src.hp.get(e));
      if (src.pos.has(e)) {
        expect(dst.pos.get(e, 'x')).toBe(src.pos.get(e, 'x'));
        expect(dst.pos.get(e, 'y')).toBe(src.pos.get(e, 'y'));
        expect(dst.pos.get(e, 'id')).toBe(src.pos.get(e, 'id'));
      } else expect(dst.pos.has(e)).toBe(false);
    }
    // Dense order is preserved, so iteration order matches.
    expect(Array.from(dst.hp.entities.subarray(0, dst.hp.size))).toEqual(Array.from(src.hp.entities.subarray(0, src.hp.size)));
    // Allocation continues identically.
    const nextSrc = Array.from({ length: 30 }, () => src.ecs.create());
    const nextDst = Array.from({ length: 30 }, () => dst.ecs.create());
    expect(nextDst).toEqual(nextSrc);
    expect(JSON.stringify(dst.ecs.snapshot())).toBe(JSON.stringify(src.ecs.snapshot()));
  });

  it('rejects malformed or inconsistent snapshots', () => {
    const { ecs } = build();
    const good = ecs.snapshot();
    expect(() => ecs.restore(null)).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, version: 99 })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, highWater: 3 })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, components: { unknown: {} } })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, components: { cache: {} } })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, pendingDestroy: ['x'] })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, pendingDestroy: [-1] })).toThrow(TypeError);
    expect(() => ecs.restore({ ...good, pendingDestroy: [1.5] })).toThrow(TypeError);

    const src = build();
    const a = src.ecs.create();
    src.hp.add(a, { hp: 1, max: 1 });
    const snap = src.ecs.snapshot();
    const dst = build();
    const dangling = { ...snap, components: { ...snap.components, hp: { e: [makeEntity(0, 5)], v: [{ hp: 1, max: 1 }] } } };
    expect(() => dst.ecs.restore(dangling)).toThrow(/dead entity/);
    expect(dst.ecs.count).toBe(0);
    expect(dst.hp.size).toBe(0);
    const badValue = { ...snap, components: { ...snap.components, hp: { e: [a], v: [{ hp: 'x' }] } } };
    expect(() => dst.ecs.restore(badValue)).toThrow(TypeError);
  });
});
