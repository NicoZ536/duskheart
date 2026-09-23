import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import { SpatialHash } from '../../../src/engine/spatialHash';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bruteRect(boxes: Map<number, Box>, minX: number, minY: number, maxX: number, maxY: number): number[] {
  const out: number[] = [];
  for (const [id, b] of boxes) if (b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY) out.push(id);
  return out.sort((a, b) => a - b);
}

function bruteCircle(boxes: Map<number, Box>, cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (const [id, b] of boxes) {
    const px = Math.min(Math.max(cx, b.minX), b.maxX);
    const py = Math.min(Math.max(cy, b.minY), b.maxY);
    if ((cx - px) ** 2 + (cy - py) ** 2 <= r * r) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

describe('SpatialHash', () => {
  it('inserts, queries, updates and removes', () => {
    const h = new SpatialHash(32);
    h.insert(1, 0, 0, 10, 10);
    h.insert(2, 100, 100, 110, 110);
    h.insert(3, -50, -50, 70, 70); // spans several cells
    const out: number[] = [];
    expect(h.queryRect(5, 5, 6, 6, out)).toBe(2);
    expect(out.sort()).toEqual([1, 3]);
    expect(h.queryCircle(105, 105, 2, out)).toBe(1);
    expect(out).toEqual([2]);
    h.update(2, 0, 0, 4, 4);
    h.queryRect(1, 1, 2, 2, out);
    expect(out.sort()).toEqual([1, 2, 3]);
    h.queryRect(100, 100, 110, 110, out);
    expect(out).toEqual([]);
    expect(h.remove(3)).toBe(true);
    expect(h.remove(3)).toBe(false);
    h.queryRect(-40, -40, -30, -30, out);
    expect(out).toEqual([]);
    expect(h.size).toBe(2);
    const b = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(h.getBounds(2, b)).toBe(true);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
    expect(h.getBounds(99, b)).toBe(false);
  });

  it('reports each id once even when it spans many cells', () => {
    const h = new SpatialHash(8);
    h.insert(7, 0, 0, 100, 100);
    const out: number[] = [];
    expect(h.queryRect(-10, -10, 200, 200, out)).toBe(1);
    expect(out).toEqual([7]);
  });

  it('touching counts as overlap for queries', () => {
    const h = new SpatialHash(16);
    h.insert(1, 0, 0, 10, 10);
    const out: number[] = [];
    expect(h.queryRect(10, 10, 20, 20, out)).toBe(1);
    expect(h.queryCircle(13, 14, 5, out)).toBe(1);
    expect(h.queryCircle(13, 14, 4.99, out)).toBe(0);
  });

  it('matches brute force under random movement', () => {
    const rng = new Rng(31);
    const h = new SpatialHash(24);
    const boxes = new Map<number, Box>();
    const makeBox = (): Box => {
      const x = rng.float(-500, 500);
      const y = rng.float(-500, 500);
      const w = rng.float(1, 60);
      const hh = rng.float(1, 60);
      return { minX: x, minY: y, maxX: x + w, maxY: y + hh };
    };
    for (let id = 0; id < 300; id++) {
      const b = makeBox();
      boxes.set(id, b);
      h.insert(id, b.minX, b.minY, b.maxX, b.maxY);
    }
    const out: number[] = [];
    for (let round = 0; round < 30; round++) {
      for (let k = 0; k < 40; k++) {
        const id = rng.int(0, 300);
        const b = boxes.get(id);
        if (b === undefined) {
          const nb = makeBox();
          boxes.set(id, nb);
          h.upsert(id, nb.minX, nb.minY, nb.maxX, nb.maxY);
        } else if (rng.bool(0.1)) {
          boxes.delete(id);
          h.remove(id);
        } else {
          const dx = rng.float(-40, 40);
          const dy = rng.float(-40, 40);
          const nb = { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
          boxes.set(id, nb);
          h.update(id, nb.minX, nb.minY, nb.maxX, nb.maxY);
        }
      }
      const qx = rng.float(-500, 500);
      const qy = rng.float(-500, 500);
      h.queryRect(qx, qy, qx + 120, qy + 80, out);
      expect(out.slice().sort((a, b) => a - b)).toEqual(bruteRect(boxes, qx, qy, qx + 120, qy + 80));
      h.queryCircle(qx, qy, 70, out);
      expect(out.slice().sort((a, b) => a - b)).toEqual(bruteCircle(boxes, qx, qy, 70));
    }
    expect(h.size).toBe(boxes.size);
  });

  it('answers huge and unbounded queries without walking every cell', () => {
    const h = new SpatialHash(16);
    const boxes = new Map<number, Box>();
    const rng = new Rng(3);
    for (let id = 0; id < 200; id++) {
      const x = rng.float(-5000, 5000);
      const y = rng.float(-5000, 5000);
      const b = { minX: x, minY: y, maxX: x + rng.float(0, 40), maxY: y + rng.float(0, 40) };
      boxes.set(id, b);
      h.insert(id, b.minX, b.minY, b.maxX, b.maxY);
    }
    const out: number[] = [];
    // Unbounded: without the linear-scan path this would iterate ~2^50 cells and hang.
    expect(h.queryRect(-Infinity, -Infinity, Infinity, Infinity, out)).toBe(200);
    expect(out.slice().sort((a, b) => a - b)).toEqual(bruteRect(boxes, -Infinity, -Infinity, Infinity, Infinity));
    h.queryRect(-4000, -1e9, 1e9, 2500, out);
    expect(out.slice().sort((a, b) => a - b)).toEqual(bruteRect(boxes, -4000, -1e9, 1e9, 2500));
    h.queryCircle(100, -200, 1e8, out);
    expect(out.slice().sort((a, b) => a - b)).toEqual(bruteCircle(boxes, 100, -200, 1e8));
    h.queryCircle(0, 0, Infinity, out);
    expect(out.length).toBe(200);
    // Degenerate queries return nothing.
    expect(h.queryRect(Number.NaN, 0, 10, 10, out)).toBe(0);
    expect(h.queryRect(10, 10, 0, 0, out)).toBe(0);
    // Normal small queries still agree with brute force after the linear-scan queries.
    h.queryRect(-100, -100, 100, 100, out);
    expect(out.slice().sort((a, b) => a - b)).toEqual(bruteRect(boxes, -100, -100, 100, 100));
  });

  it('keeps bounds and cells consistent when an update stays in its cells or fails', () => {
    const h = new SpatialHash(32);
    h.insert(1, 1, 1, 5, 5);
    const buckets = h.bucketCount;
    h.update(1, 10, 10, 20, 20); // same cell: only the bounds change
    expect(h.bucketCount).toBe(buckets);
    const out: number[] = [];
    expect(h.queryRect(0, 0, 4, 4, out)).toBe(0);
    expect(h.queryRect(15, 15, 16, 16, out)).toBe(1);
    // A rejected update leaves the entry untouched.
    expect(() => h.update(1, 0, 0, 1e12, 1)).toThrow(RangeError);
    expect(() => h.update(1, 5, 5, 0, 0)).toThrow(RangeError);
    const b = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(h.getBounds(1, b)).toBe(true);
    expect(b).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(h.queryRect(15, 15, 16, 16, out)).toBe(1);
    // Removing and re-inserting reuses the pooled entry without leaking the old cells.
    h.update(1, 100, 100, 110, 110);
    expect(h.queryRect(15, 15, 16, 16, out)).toBe(0);
    expect(h.remove(1)).toBe(true);
    expect(h.remove(1)).toBe(false);
    h.insert(2, 15, 15, 16, 16);
    expect(h.queryRect(100, 100, 110, 110, out)).toBe(0);
    expect(h.queryRect(15, 15, 16, 16, out)).toBe(1);
    expect(out).toEqual([2]);
  });

  it('validates input and supports prune/clear', () => {
    const h = new SpatialHash(10);
    expect(() => new SpatialHash(0)).toThrow(RangeError);
    h.insert(1, 0, 0, 5, 5);
    expect(() => h.insert(1, 0, 0, 5, 5)).toThrow();
    expect(() => h.update(2, 0, 0, 5, 5)).toThrow();
    expect(() => h.insert(3, 5, 5, 0, 0)).toThrow(RangeError);
    expect(() => h.insert(4, Number.NaN, 0, 1, 1)).toThrow(RangeError);
    expect(() => h.insert(5, 0, 0, 1e12, 1)).toThrow(RangeError);
    h.update(1, 500, 500, 505, 505);
    expect(h.bucketCount).toBe(2);
    expect(h.prune()).toBe(1);
    expect(h.bucketCount).toBe(1);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.has(1)).toBe(false);
    const out = [9, 9, 9];
    expect(h.queryRect(0, 0, 1000, 1000, out)).toBe(0);
    expect(out).toEqual([]);
  });
});
