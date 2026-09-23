/**
 * Deterministic pseudo random numbers (MASTERPROMPT §2.6, docs/ARCHITEKTUR.md "Determinismus").
 *
 * - `Rng`: sfc32 generator with 128 bit state, seeded through splitmix32.
 * - `hashString`, `hash2`, `hash3`, `hashCombine`: stateless 32 bit integer hashes for
 *   coordinate based determinism (world generation, per-tile variation).
 * - `RngStreams`: one named, independently seeded `Rng` per system, fully serializable.
 *
 * Nothing in here touches `Math.random` or wall clock time.
 */

/** splitmix32 increment: 2^32 / golden ratio. */
const SPLITMIX_INCREMENT = 0x9e3779b9;
/** splitmix32 first finalizer multiplier. */
const SPLITMIX_MUL_A = 0x21f0aaad;
/** splitmix32 second finalizer multiplier. */
const SPLITMIX_MUL_B = 0x735a2d97;

/** murmur3 fmix32 first multiplier. */
const FMIX_MUL_A = 0x85ebca6b;
/** murmur3 fmix32 second multiplier. */
const FMIX_MUL_B = 0xc2b2ae35;
/** murmur3 body constant c1. */
const MURMUR_C1 = 0xcc9e2d51;
/** murmur3 body constant c2. */
const MURMUR_C2 = 0x1b873593;
/** murmur3 body additive constant. */
const MURMUR_N = 0xe6546b64;
/** Seed mixed into coordinate hashes so that `hash2(0, 0, 0)` is not trivially zero. */
const COORD_HASH_BASIS = 0x2545f491;

/** FNV-1a 32 bit offset basis. */
const FNV32_OFFSET = 0x811c9dc5;
/** FNV-1a 32 bit prime. */
const FNV32_PRIME = 0x01000193;

/** 2^32 as a float; divides a u32 into [0, 1). */
export const U32_RANGE = 4294967296;
/** Largest u32 value. */
export const U32_MAX = 0xffffffff;
/** Outputs discarded after seeding so that neighbouring seeds decorrelate completely. */
export const RNG_WARMUP_ROUNDS = 12;
/** Full turn in radians (local copy so this module has no dependency on math.ts). */
const TAU = Math.PI * 2;

/** The four 32 bit words of an sfc32 state, each stored as an unsigned integer. */
export type RngState = readonly [number, number, number, number];

/** murmur3 32 bit finalizer: full avalanche of a 32 bit integer. Returns a u32. */
export function fmix32(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, FMIX_MUL_A);
  x ^= x >>> 13;
  x = Math.imul(x, FMIX_MUL_B);
  x ^= x >>> 16;
  return x >>> 0;
}

/** splitmix32 output function for a given (already incremented) state word. Returns a u32. */
export function splitmix32(state: number): number {
  let z = state | 0;
  z ^= z >>> 16;
  z = Math.imul(z, SPLITMIX_MUL_A);
  z ^= z >>> 15;
  z = Math.imul(z, SPLITMIX_MUL_B);
  z ^= z >>> 15;
  return z >>> 0;
}

/** One murmur3 body round: mixes the 32 bit key `k` into the running hash `h`. */
function murmurRound(h: number, k: number): number {
  let key = Math.imul(k | 0, MURMUR_C1);
  key = (key << 15) | (key >>> 17);
  key = Math.imul(key, MURMUR_C2);
  let x = (h | 0) ^ key;
  x = (x << 13) | (x >>> 19);
  return (Math.imul(x, 5) + MURMUR_N) | 0;
}

/** Validates and normalizes a seed to a u32. Accepts any safe integer (negative values wrap). */
export function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new RangeError(`Seed must be a safe integer, got ${String(seed)}`);
  return seed >>> 0;
}

/** Hashes a string (UTF-16 code units, FNV-1a) and avalanches the result. Returns a u32. */
export function hashString(s: string): number {
  let h = FNV32_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV32_PRIME);
  }
  return fmix32(h);
}

/** Combines two 32 bit values into one well mixed u32 (order dependent). */
export function hashCombine(a: number, b: number): number {
  return fmix32(murmurRound(murmurRound(COORD_HASH_BASIS, a), b) ^ 2);
}

/** Integer hash of a 2D lattice coordinate. Inputs are truncated to int32. Returns a u32. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = murmurRound(COORD_HASH_BASIS ^ (seed | 0), x);
  h = murmurRound(h, y);
  return fmix32(h ^ 2);
}

/** Integer hash of a 3D lattice coordinate. Inputs are truncated to int32. Returns a u32. */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = murmurRound(COORD_HASH_BASIS ^ (seed | 0), x);
  h = murmurRound(h, y);
  h = murmurRound(h, z);
  return fmix32(h ^ 3);
}

/** Maps a u32 hash to a float in [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / U32_RANGE;
}

function isU32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= U32_MAX;
}

/** Validates an unknown value as an `RngState` (four u32 integers). Throws on malformed input. */
export function parseRngState(value: unknown): RngState {
  if (!Array.isArray(value) || value.length !== 4) throw new TypeError('RNG state must be an array of four u32 values');
  const [a, b, c, d] = value as unknown[];
  if (!isU32(a) || !isU32(b) || !isU32(c) || !isU32(d)) throw new TypeError('RNG state words must be u32 integers');
  return [a, b, c, d];
}

/**
 * Small fast counter based PRNG (sfc32, Chris Doty-Humphrey). 128 bit state, period ≥ 2^32,
 * passes PractRand. All state lives in four int32 fields so cloning and serialization are trivial.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  /** Seeds the generator from a 32 bit seed via splitmix32. */
  constructor(seed = 0) {
    this.seed(seed);
  }

  /** Creates a generator directly from a saved state. */
  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.setState(state);
    return rng;
  }

  /** Re-seeds this generator in place. */
  seed(seed: number): void {
    let s = normalizeSeed(seed);
    s = (s + SPLITMIX_INCREMENT) | 0;
    this.a = splitmix32(s) | 0;
    s = (s + SPLITMIX_INCREMENT) | 0;
    this.b = splitmix32(s) | 0;
    s = (s + SPLITMIX_INCREMENT) | 0;
    this.c = splitmix32(s) | 0;
    s = (s + SPLITMIX_INCREMENT) | 0;
    this.d = splitmix32(s) | 0;
    for (let i = 0; i < RNG_WARMUP_ROUNDS; i++) this.nextU32();
  }

  /** Next raw output as an unsigned 32 bit integer. */
  nextU32(): number {
    const t0 = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const t = (t0 + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. */
  next(): number {
    return this.nextU32() / U32_RANGE;
  }

  /** Uniform float in [min, max). Returns `min` when the range is empty. */
  float(min: number, max: number): number {
    const v = min + (max - min) * this.next();
    // Rounding can land exactly on `max` for huge ranges; keep the half open contract.
    return v < max ? v : min;
  }

  /**
   * Uniform integer in [minIncl, maxExcl). Unbiased (rejection sampling).
   * Both bounds must be integers and the range must be in 1..2^32.
   */
  int(minIncl: number, maxExcl: number): number {
    const range = maxExcl - minIncl;
    if (!Number.isInteger(minIncl) || !Number.isInteger(maxExcl) || range < 1 || range > U32_RANGE) {
      throw new RangeError(`Rng.int: invalid range [${String(minIncl)}, ${String(maxExcl)})`);
    }
    const limit = U32_RANGE - (U32_RANGE % range);
    let x = this.nextU32();
    while (x >= limit) x = this.nextU32();
    return minIncl + (x % range);
  }

  /** `true` with probability `p` (clamped to [0, 1]). */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(0, items.length)] as T;
  }

  /** Fisher–Yates shuffle in place. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Picks an index with probability proportional to `weights[i]`.
   * Weights must be finite and ≥ 0 with a positive sum.
   */
  weightedIndex(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError(`Rng.weightedIndex: invalid weight at ${i}`);
      total += w;
    }
    if (!(total > 0)) throw new RangeError('Rng.weightedIndex: weights must have a positive sum');
    let r = this.next() * total;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (w <= 0) continue;
      last = i;
      if (r < w) return i;
      r -= w;
    }
    // Floating point residue: fall back to the last item with positive weight.
    return last;
  }

  /** Picks one item with probability proportional to `weightFn(item, index)`. */
  weighted<T>(items: readonly T[], weightFn: (item: T, index: number) => number): T {
    if (items.length === 0) throw new RangeError('Rng.weighted: empty array');
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i] as T, i);
      if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError(`Rng.weighted: invalid weight at ${i}`);
      total += w;
    }
    if (!(total > 0)) throw new RangeError('Rng.weighted: weights must have a positive sum');
    let r = this.next() * total;
    let last = -1;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const w = weightFn(item, i);
      if (w <= 0) continue;
      last = i;
      if (r < w) return item;
      r -= w;
    }
    return items[last] as T;
  }

  /**
   * Normally distributed sample (Box–Muller). The second Box–Muller value is discarded on
   * purpose so that the complete generator state stays the 128 bit sfc32 state.
   */
  gaussian(mean = 0, sd = 1): number {
    const u1 = 1 - this.next(); // (0, 1] so the logarithm is finite
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
  }

  /** Current state as four u32 words. */
  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** Restores a state produced by `getState()`. */
  setState(state: RngState): void {
    const [a, b, c, d] = parseRngState(state);
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
  }

  /** Independent copy with identical state. */
  clone(): Rng {
    return Rng.fromState(this.getState());
  }
}

/** Serialized form of `RngStreams` (plain JSON data). */
export interface RngStreamsSnapshot {
  readonly seed: number;
  readonly streams: Readonly<Record<string, RngState>>;
}

/**
 * Named random streams derived from one world seed. Every system asks for its own stream
 * (`streams.stream('weather')`) so adding random calls in one system never shifts another.
 * The same name always yields the same `Rng` instance; `deserialize` updates instances in place
 * so cached references stay valid.
 */
export class RngStreams {
  private seedValue: number;
  private readonly streams = new Map<string, Rng>();

  constructor(worldSeed: number) {
    this.seedValue = normalizeSeed(worldSeed);
  }

  /** Restores a complete set of streams from a snapshot. */
  static fromSnapshot(snapshot: unknown): RngStreams {
    const streams = new RngStreams(0);
    streams.deserialize(snapshot);
    return streams;
  }

  /** The (u32 normalized) world seed. */
  get seed(): number {
    return this.seedValue;
  }

  /** Seed used for the stream with the given name. */
  streamSeed(name: string): number {
    return hashCombine(this.seedValue, hashString(name));
  }

  /** Returns the stream for `name`, creating it lazily. */
  stream(name: string): Rng {
    let rng = this.streams.get(name);
    if (rng === undefined) {
      rng = new Rng(this.streamSeed(name));
      this.streams.set(name, rng);
    }
    return rng;
  }

  /** Whether a stream with this name has been created. */
  has(name: string): boolean {
    return this.streams.has(name);
  }

  /** Names of all created streams, sorted. */
  names(): string[] {
    return [...this.streams.keys()].sort();
  }

  /** Plain JSON snapshot of the seed and all stream states (keys sorted for stable output). */
  serialize(): RngStreamsSnapshot {
    const out: Record<string, RngState> = {};
    for (const name of this.names()) {
      const rng = this.streams.get(name);
      if (rng !== undefined) out[name] = rng.getState();
    }
    return { seed: this.seedValue, streams: out };
  }

  /**
   * Restores a snapshot. Existing instances are updated in place; streams missing from the
   * snapshot are reset to their freshly seeded state (they had not been used when it was taken).
   */
  deserialize(snapshot: unknown): void {
    if (typeof snapshot !== 'object' || snapshot === null) throw new TypeError('RngStreams snapshot must be an object');
    const { seed, streams } = snapshot as { seed?: unknown; streams?: unknown };
    if (!isU32(seed)) throw new TypeError('RngStreams snapshot seed must be a u32');
    if (typeof streams !== 'object' || streams === null || Array.isArray(streams)) {
      throw new TypeError('RngStreams snapshot streams must be an object');
    }
    const parsed = new Map<string, RngState>();
    for (const [name, state] of Object.entries(streams as Record<string, unknown>)) parsed.set(name, parseRngState(state));
    this.seedValue = seed;
    for (const [name, rng] of this.streams) {
      if (!parsed.has(name)) rng.seed(this.streamSeed(name));
    }
    for (const [name, state] of parsed) this.stream(name).setState(state);
  }
}
