import { describe, expect, it } from 'vitest';
import { FloatRing, Pool } from '../../../src/engine/pool';

interface Particle {
  x: number;
  alive: boolean;
}

describe('Pool', () => {
  it('reuses released objects after resetting them', () => {
    const pool = new Pool<Particle>(() => ({ x: 0, alive: false }), {
      reset: (p) => {
        p.x = 0;
        p.alive = false;
      },
    });
    const a = pool.acquire();
    a.x = 5;
    a.alive = true;
    expect(pool.created).toBe(1);
    pool.release(a);
    expect(pool.idleCount).toBe(1);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(b).toEqual({ x: 0, alive: false });
    expect(pool.created).toBe(1);
    expect(pool.idleCount).toBe(0);
  });

  it('prewarms and caps idle objects', () => {
    const pool = new Pool<Particle>(() => ({ x: 0, alive: false }), { maxIdle: 3 });
    pool.prewarm(10);
    expect(pool.idleCount).toBe(3);
    expect(pool.created).toBe(3);
    const objs = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
    expect(pool.created).toBe(4);
    for (const o of objs) pool.release(o);
    expect(pool.idleCount).toBe(3);
    pool.clear();
    expect(pool.idleCount).toBe(0);
    expect(() => new Pool(() => 1, { maxIdle: -1 })).toThrow(RangeError);
  });
});

describe('FloatRing', () => {
  it('keeps the newest values in order', () => {
    const ring = new FloatRing(3);
    expect(ring.length).toBe(0);
    expect(ring.average()).toBe(0);
    expect(ring.last(-1)).toBe(-1);
    ring.push(1);
    ring.push(2);
    expect([ring.get(0), ring.get(1)]).toEqual([1, 2]);
    ring.push(3);
    ring.push(4);
    expect(ring.length).toBe(3);
    expect(ring.capacity).toBe(3);
    expect([ring.get(0), ring.get(1), ring.get(2)]).toEqual([2, 3, 4]);
    expect(ring.last()).toBe(4);
    expect(() => ring.get(3)).toThrow(RangeError);
  });

  it('computes statistics', () => {
    const ring = new FloatRing(5);
    for (const v of [5, 1, 9, 3, 7, 2]) ring.push(v);
    // Retained: 1, 9, 3, 7, 2
    expect(ring.sum()).toBe(22);
    expect(ring.average()).toBeCloseTo(4.4, 12);
    expect(ring.min()).toBe(1);
    expect(ring.max()).toBe(9);
    expect(ring.percentile(0.5)).toBe(3);
    expect(ring.percentile(1)).toBe(9);
    expect(ring.percentile(0)).toBe(1);
    const out = new Float32Array(10);
    expect(ring.copyTo(out)).toBe(5);
    expect(Array.from(out.subarray(0, 5))).toEqual([1, 9, 3, 7, 2]);
    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.min()).toBe(0);
    expect(ring.max()).toBe(0);
    expect(ring.percentile(0.5)).toBe(0);
    expect(() => new FloatRing(0)).toThrow(RangeError);
  });
});
