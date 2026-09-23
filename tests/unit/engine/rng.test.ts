import { describe, expect, it } from 'vitest';
import {
  Rng,
  RngStreams,
  hash2,
  hash3,
  hashCombine,
  hashString,
  hashToUnit,
  normalizeSeed,
  parseRngState,
  splitmix32,
  type RngState,
} from '../../../src/engine/rng';

/** Straight port of the public-domain reference sfc32 (bryc/code, PRNGs.md). */
function referenceSfc32(a0: number, b0: number, c0: number, d0: number): () => number {
  let a = a0 >>> 0;
  let b = b0 >>> 0;
  let c = c0 >>> 0;
  let d = d0 >>> 0;
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/** Reference splitmix32 generator (bryc/code). */
function referenceSplitmix32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

describe('Rng determinism', () => {
  it('matches the reference sfc32 for a given state', () => {
    const state: RngState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 12345];
    const rng = Rng.fromState(state);
    const ref = referenceSfc32(...state);
    const ours = Array.from({ length: 1000 }, () => rng.nextU32());
    const theirs = Array.from({ length: 1000 }, () => ref());
    expect(ours).toEqual(theirs);
  });

  it('seeds through splitmix32 plus warm-up exactly like the reference', () => {
    const sm = referenceSplitmix32(777);
    const ref = referenceSfc32(sm(), sm(), sm(), sm());
    for (let i = 0; i < 12; i++) ref();
    const rng = new Rng(777);
    expect(Array.from({ length: 100 }, () => rng.nextU32())).toEqual(Array.from({ length: 100 }, () => ref()));
    expect(splitmix32((0 + 0x9e3779b9) | 0)).toBe(referenceSplitmix32(0)());
  });

  it('produces stable known values (golden)', () => {
    const rng = new Rng(12345);
    expect(rng.getState()).toEqual([2174754244, 3003473489, 1049220443, 516375449]);
    expect([rng.nextU32(), rng.nextU32(), rng.nextU32(), rng.nextU32(), rng.nextU32()]).toEqual([
      1399635887, 83665100, 1191331904, 1206599336, 2617022538,
    ]);
    const zero = new Rng(0);
    expect([zero.nextU32(), zero.nextU32(), zero.nextU32()]).toEqual([1101400650, 3019924254, 1223568846]);
  });

  it('same seed gives the same sequence, different seeds differ', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('normalizes negative seeds and rejects non-integer seeds', () => {
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(new Rng(-1).getState()).toEqual(new Rng(0xffffffff).getState());
    expect(() => new Rng(1.5)).toThrow(RangeError);
    expect(() => new Rng(Number.NaN)).toThrow(RangeError);
  });
});

describe('Rng helpers', () => {
  it('next() stays in [0, 1) with mean ≈ 0.5', () => {
    const rng = new Rng(1);
    let sum = 0;
    let outside = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      if (!(v >= 0 && v < 1)) outside++;
      sum += v;
    }
    expect(outside).toBe(0);
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it('float(min, max) respects the half open range', () => {
    const rng = new Rng(2);
    let outside = 0;
    for (let i = 0; i < 5000; i++) {
      const v = rng.float(-3, 5);
      if (v < -3 || v >= 5) outside++;
    }
    expect(outside).toBe(0);
    expect(rng.float(2, 2)).toBe(2);
  });

  it('int() is uniform and within bounds', () => {
    const rng = new Rng(3);
    const counts = new Array<number>(10).fill(0);
    const n = 100_000;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.int(0, 10);
      if (!Number.isInteger(v)) bad++;
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(bad).toBe(0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(n);
    for (const c of counts) expect(Math.abs(c - n / 10)).toBeLessThan((n / 10) * 0.05);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(-5, -2);
      if (v < -5 || v >= -2) bad++;
    }
    expect(bad).toBe(0);
    expect(rng.int(7, 8)).toBe(7);
    expect(rng.int(0, 2 ** 32)).toBeLessThan(2 ** 32);
  });

  it('passes a χ² uniformity test for next(), int() and every named stream', () => {
    /** χ² statistic of `n` samples in `bins` equally likely bins. */
    const chiSquare = (sample: () => number, bins: number, n: number): number => {
      const counts = new Array<number>(bins).fill(0);
      for (let i = 0; i < n; i++) {
        const b = sample();
        counts[b] = (counts[b] ?? 0) + 1;
      }
      const expected = n / bins;
      return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    };
    // Critical value of χ² with 99 degrees of freedom at p = 0.001 (tables: 148.23).
    const CRITICAL_99_DOF = 148.23;
    const BINS = 100;
    const N = 100_000;
    const rng = new Rng(20260923);
    expect(chiSquare(() => Math.floor(rng.next() * BINS), BINS, N)).toBeLessThan(CRITICAL_99_DOF);
    expect(chiSquare(() => rng.int(0, BINS), BINS, N)).toBeLessThan(CRITICAL_99_DOF);
    const streams = new RngStreams(77);
    for (const name of ['weather', 'loot', 'ai', 'spawn']) {
      const s = streams.stream(name);
      expect(chiSquare(() => Math.floor(s.next() * BINS), BINS, N), name).toBeLessThan(CRITICAL_99_DOF);
    }
    // Independence: pairs from two streams drawn in lockstep are uniform on the 10×10 grid.
    const a = streams.stream('weather');
    const b = streams.stream('loot');
    expect(chiSquare(() => a.int(0, 10) * 10 + b.int(0, 10), BINS, N)).toBeLessThan(CRITICAL_99_DOF);
  });

  it('int() rejects invalid ranges', () => {
    const rng = new Rng(3);
    expect(() => rng.int(5, 5)).toThrow(RangeError);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0, 1.5)).toThrow(RangeError);
    expect(() => rng.int(0, 2 ** 32 + 1)).toThrow(RangeError);
  });

  it('bool(p) approximates the probability', () => {
    const rng = new Rng(4);
    let hits = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) if (rng.bool(0.3)) hits++;
    expect(hits / n).toBeCloseTo(0.3, 1.5);
    expect(rng.bool(0)).toBe(false);
    expect(rng.bool(1)).toBe(true);
  });

  it('pick() returns members and throws on empty arrays', () => {
    const rng = new Rng(5);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() permutes in place deterministically', () => {
    const a = Array.from({ length: 20 }, (_, i) => i);
    const b = a.slice();
    const ra = new Rng(6);
    const rb = new Rng(6);
    expect(ra.shuffle(a)).toBe(a);
    rb.shuffle(b);
    expect(a).toEqual(b);
    expect(a.slice().sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(a).not.toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('weighted() follows weights and never picks zero weights', () => {
    const rng = new Rng(7);
    const items = [
      { id: 'common', w: 6 },
      { id: 'rare', w: 1 },
      { id: 'never', w: 0 },
      { id: 'uncommon', w: 3 },
    ];
    const counts: Record<string, number> = {};
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const it = rng.weighted(items, (x) => x.w);
      counts[it.id] = (counts[it.id] ?? 0) + 1;
    }
    expect(counts['never']).toBeUndefined();
    expect((counts['common'] ?? 0) / n).toBeCloseTo(0.6, 1.5);
    expect((counts['uncommon'] ?? 0) / n).toBeCloseTo(0.3, 1.5);
    expect((counts['rare'] ?? 0) / n).toBeCloseTo(0.1, 1.5);
    expect(() => rng.weighted([], () => 1)).toThrow(RangeError);
    expect(() => rng.weighted([1, 2], () => 0)).toThrow(RangeError);
    expect(() => rng.weighted([1], () => -1)).toThrow(RangeError);
    expect(() => rng.weighted([1], () => Number.NaN)).toThrow(RangeError);
  });

  it('weightedIndex() works on typed arrays', () => {
    const rng = new Rng(8);
    const w = new Float32Array([0, 1, 0]);
    for (let i = 0; i < 100; i++) expect(rng.weightedIndex(w)).toBe(1);
    expect(() => rng.weightedIndex([0, 0])).toThrow(RangeError);
  });

  it('gaussian() has the requested mean and deviation', () => {
    const rng = new Rng(9);
    const n = 40_000;
    let sum = 0;
    let sq = 0;
    let nonFinite = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.gaussian(10, 2);
      if (!Number.isFinite(v)) nonFinite++;
      sum += v;
      sq += v * v;
    }
    expect(nonFinite).toBe(0);
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(2, 1);
  });
});

describe('Rng state', () => {
  it('getState/setState roundtrip reproduces the continuation, also via JSON', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 17; i++) rng.next();
    rng.gaussian();
    const state = rng.getState();
    const expected = Array.from({ length: 30 }, () => rng.nextU32());
    const restored = Rng.fromState(JSON.parse(JSON.stringify(state)) as RngState);
    expect(Array.from({ length: 30 }, () => restored.nextU32())).toEqual(expected);
    rng.setState(state);
    expect(Array.from({ length: 30 }, () => rng.nextU32())).toEqual(expected);
  });

  it('clone() is independent', () => {
    const rng = new Rng(100);
    const copy = rng.clone();
    const a = rng.nextU32();
    expect(copy.nextU32()).toBe(a);
    copy.nextU32();
    expect(rng.getState()).not.toEqual(copy.getState());
  });

  it('parseRngState rejects malformed states', () => {
    expect(() => parseRngState([1, 2, 3])).toThrow(TypeError);
    expect(() => parseRngState([1, 2, 3, -1])).toThrow(TypeError);
    expect(() => parseRngState([1, 2, 3, 2 ** 32])).toThrow(TypeError);
    expect(() => parseRngState('nope')).toThrow(TypeError);
    expect(parseRngState([0, 1, 2, 0xffffffff])).toEqual([0, 1, 2, 0xffffffff]);
  });
});

describe('hashes', () => {
  it('are stable (golden values)', () => {
    expect(hashString('')).toBe(2872998923);
    expect(hashString('weather')).toBe(2457918669);
    expect(hash2(0, 0, 0)).toBe(3093067987);
    expect(hash2(-5, 7, 42)).toBe(4266644374);
    expect(hash3(1, 2, 3, 4)).toBe(3277784388);
    expect(hashCombine(1, 2)).toBe(2116853470);
  });

  it('are u32 and sensitive to every input', () => {
    const values = new Set<number>();
    let notU32 = 0;
    for (let x = -8; x < 8; x++) {
      for (let y = -8; y < 8; y++) {
        const h = hash2(x, y, 1);
        if (h >>> 0 !== h) notU32++;
        values.add(h);
      }
    }
    expect(notU32).toBe(0);
    expect(values.size).toBe(256);
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 2, 4));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 3, 2));
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
    expect(hashString('ab')).not.toBe(hashString('ba'));
  });

  it('hashToUnit maps into [0, 1) with a balanced low bit', () => {
    let ones = 0;
    let outside = 0;
    for (let i = 0; i < 10_000; i++) {
      const h = hash2(i, 0, 5);
      const u = hashToUnit(h);
      if (!(u >= 0 && u < 1)) outside++;
      ones += h & 1;
    }
    expect(outside).toBe(0);
    expect(ones / 10_000).toBeCloseTo(0.5, 1);
    expect(hashToUnit(0xffffffff)).toBeLessThan(1);
  });
});

describe('RngStreams', () => {
  it('returns the same instance per name and different sequences per name', () => {
    const streams = new RngStreams(2024);
    const a = streams.stream('loot');
    expect(streams.stream('loot')).toBe(a);
    const b = streams.stream('weather');
    expect(a.getState()).not.toEqual(b.getState());
    expect(streams.names()).toEqual(['loot', 'weather']);
    expect(streams.has('combat')).toBe(false);
  });

  it('streams are independent of each other', () => {
    const s1 = new RngStreams(5);
    const s2 = new RngStreams(5);
    // In s1, the loot stream is used heavily before weather is created.
    const loot = s1.stream('loot');
    for (let i = 0; i < 1000; i++) loot.next();
    const w1 = Array.from({ length: 20 }, () => s1.stream('weather').nextU32());
    const w2 = Array.from({ length: 20 }, () => s2.stream('weather').nextU32());
    expect(w1).toEqual(w2);
  });

  it('depends on the world seed', () => {
    expect(new RngStreams(1).stream('x').getState()).not.toEqual(new RngStreams(2).stream('x').getState());
  });

  it('serialize/deserialize roundtrip keeps instances and continues identically', () => {
    const streams = new RngStreams(77);
    const loot = streams.stream('loot');
    const ai = streams.stream('ai');
    loot.int(0, 100);
    ai.next();
    const snap = JSON.parse(JSON.stringify(streams.serialize())) as unknown;
    expect(Object.keys((snap as { streams: object }).streams)).toEqual(['ai', 'loot']);
    const expectedLoot = Array.from({ length: 10 }, () => loot.nextU32());
    const late = streams.stream('late');
    late.next();

    streams.deserialize(snap);
    expect(streams.stream('loot')).toBe(loot);
    expect(Array.from({ length: 10 }, () => loot.nextU32())).toEqual(expectedLoot);
    // A stream missing from the snapshot is reset to its freshly seeded state.
    expect(late.getState()).toEqual(new RngStreams(77).stream('late').getState());

    const restored = RngStreams.fromSnapshot(snap);
    expect(restored.seed).toBe(77);
    expect(restored.stream('ai').getState()).toEqual((snap as { streams: Record<string, RngState> }).streams['ai']);
  });

  it('looking up a stream without drawing leaves the snapshot unchanged', () => {
    const streams = new RngStreams(9);
    streams.stream('loot').next();
    const before = JSON.stringify(streams.serialize());
    streams.stream('weather');
    expect(streams.has('weather')).toBe(true);
    expect(JSON.stringify(streams.serialize())).toBe(before);
    streams.stream('weather').next();
    expect(Object.keys(streams.serialize().streams)).toEqual(['loot', 'weather']);
  });

  it('deserializing under another seed resets unused streams to that seed', () => {
    const streams = new RngStreams(1);
    const cached = streams.stream('ai');
    streams.deserialize({ seed: 2, streams: {} });
    expect(cached.getState()).toEqual(new RngStreams(2).stream('ai').getState());
    expect(streams.serialize()).toEqual({ seed: 2, streams: {} });
  });

  it('rejects malformed snapshots', () => {
    const streams = new RngStreams(1);
    expect(() => streams.deserialize(null)).toThrow(TypeError);
    expect(() => streams.deserialize({ seed: -1, streams: {} })).toThrow(TypeError);
    expect(() => streams.deserialize({ seed: 1, streams: [] })).toThrow(TypeError);
    expect(() => streams.deserialize({ seed: 1, streams: { a: [1, 2] } })).toThrow(TypeError);
  });
});
