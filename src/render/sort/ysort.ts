/**
 * y-sort + layer order (MASTERPROMPT §6.1 pass 2): ground → water mask → y-sorted objects →
 * roofs/canopy. Within a layer sprites are ordered by their anchor depth (the foot point: whoever
 * stands lower on screen is drawn later, i.e. in front); equal depths keep submission order, so the
 * order is stable from frame to frame and nothing flickers.
 *
 * Implementation (M1-28): a compact integer key – depth quantised to 1/16 px relative to the frame's
 * smallest depth in the low bits, the layer right above the bits the frame's depth range needs –
 * sorted with a stable LSD radix sort into preallocated typed arrays. One pass builds the keys and
 * the histograms of every digit at once; each digit then costs one scatter pass, and digits every key
 * shares are skipped. A frame spanning less than 1 024 px of depth sorts in two passes. O(n), no
 * allocation per frame.
 */
import { LAYER_COUNT } from '../batch/spriteLayout';

/** Depth resolution of the sort key: 1/16 px (interpolated positions differ by fractions of a pixel). */
export const DEPTH_STEPS_PER_PX = 16;
/** Most bits of the depth part of the key (a depth range of 2^28 / 16 px = 16.7 million px). */
export const DEPTH_BITS = 28;
/** Bits of the layer part of the key (LAYER_COUNT layers, a power of two). */
const LAYER_BITS = Math.ceil(Math.log2(LAYER_COUNT));
const LAYER_MASK = (1 << LAYER_BITS) - 1;
const RADIX_BITS = 8;
const RADIX = 1 << RADIX_BITS;
const RADIX_MASK = RADIX - 1;
/** Digits of the widest key (depth + layer bits); the histogram pass below handles up to four. */
const MAX_DIGITS = Math.ceil((DEPTH_BITS + LAYER_BITS) / RADIX_BITS);

/** Bits needed to hold the unsigned integer `v` (0 for 0). */
function bitLength(v: number): number {
  return v <= 0 ? 0 : Math.floor(Math.log2(v)) + 1;
}

export class YSorter {
  private keysA = new Uint32Array(0);
  private keysB = new Uint32Array(0);
  private idxA = new Uint32Array(0);
  private idxB = new Uint32Array(0);
  /** Histograms of all digits, `RADIX` counters per digit. */
  private readonly counts = new Uint32Array(RADIX * MAX_DIGITS);
  /** First sorted position of each layer. */
  readonly layerStart = new Uint32Array(LAYER_COUNT);
  /** Number of sprites in each layer. */
  readonly layerCount = new Uint32Array(LAYER_COUNT);

  private ensure(n: number): void {
    if (this.idxA.length >= n) return;
    let cap = Math.max(1, this.idxA.length);
    while (cap < n) cap *= 2;
    this.keysA = new Uint32Array(cap);
    this.keysB = new Uint32Array(cap);
    this.idxA = new Uint32Array(cap);
    this.idxB = new Uint32Array(cap);
  }

  /**
   * Sorts `count` sprites by (layer, depth, submission index). Returns the permutation (first
   * `count` entries valid; the array is reused by the next call). `minDepth`/`maxDepth` are the
   * smallest and largest finite depth (as `SpriteList` tracks them while sprites are pushed); left
   * out, they are found here. Non-finite depths sort first in their layer.
   */
  sort(layers: ArrayLike<number>, depths: ArrayLike<number>, count: number, minDepth = Number.NaN, maxDepth = Number.NaN): Uint32Array {
    this.ensure(count);
    let lo = minDepth;
    let hi = maxDepth;
    if (!(lo <= hi)) {
      lo = Number.POSITIVE_INFINITY;
      hi = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < count; i++) {
        const d = depths[i] ?? 0;
        if (d < lo && d !== Number.NEGATIVE_INFINITY) lo = d;
        if (d > hi && d !== Number.POSITIVE_INFINITY) hi = d;
      }
      if (!(lo <= hi)) lo = hi = 0;
    }
    const depthBits = Math.min(DEPTH_BITS, bitLength(Math.floor((hi - lo) * DEPTH_STEPS_PER_PX)));
    // Largest depth part of this frame's keys: a depth beyond the given maximum cannot reach the layer bits.
    const qMax = 2 ** depthBits - 1;
    const digits = Math.max(1, Math.ceil((depthBits + LAYER_BITS) / RADIX_BITS));
    const counts = this.counts;
    counts.fill(0, 0, digits * RADIX);
    const layerCount = this.layerCount;
    layerCount.fill(0);
    let keys = this.keysA;
    let idx = this.idxA;
    // Keys and the histograms of every digit in one pass.
    for (let i = 0; i < count; i++) {
      const layer = (layers[i] ?? 0) & LAYER_MASK;
      const off = ((depths[i] ?? lo) - lo) * DEPTH_STEPS_PER_PX;
      // Non-finite depths (and, with a wrong minimum, smaller ones) go first; larger ones than the maximum last.
      const q = off >= 0 && off < Number.POSITIVE_INFINITY ? (off < qMax ? Math.floor(off) : qMax) : 0;
      const k = ((layer << depthBits) | q) >>> 0;
      keys[i] = k;
      idx[i] = i;
      layerCount[layer] = (layerCount[layer] ?? 0) + 1;
      let c = k & RADIX_MASK;
      counts[c] = (counts[c] ?? 0) + 1;
      if (digits > 1) {
        c = RADIX + ((k >>> RADIX_BITS) & RADIX_MASK);
        counts[c] = (counts[c] ?? 0) + 1;
      }
      if (digits > 2) {
        c = 2 * RADIX + ((k >>> (2 * RADIX_BITS)) & RADIX_MASK);
        counts[c] = (counts[c] ?? 0) + 1;
      }
      if (digits > 3) {
        c = 3 * RADIX + (k >>> (3 * RADIX_BITS));
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    let keysOut = this.keysB;
    let idxOut = this.idxB;
    for (let g = 0, shift = 0; g < digits; g++, shift += RADIX_BITS) {
      const base = g * RADIX;
      // A digit every key shares changes nothing.
      if (count === 0 || counts[base + (((keys[0] ?? 0) >>> shift) & RADIX_MASK)] === count) continue;
      let sum = 0;
      for (let b = base; b < base + RADIX; b++) {
        const c = counts[b] ?? 0;
        counts[b] = sum;
        sum += c;
      }
      for (let i = 0; i < count; i++) {
        const k = keys[i] ?? 0;
        const b = base + ((k >>> shift) & RADIX_MASK);
        const pos = counts[b] ?? 0;
        counts[b] = pos + 1;
        keysOut[pos] = k;
        idxOut[pos] = idx[i] ?? 0;
      }
      const tk = keys;
      keys = keysOut;
      keysOut = tk;
      const ti = idx;
      idx = idxOut;
      idxOut = ti;
    }
    let start = 0;
    for (let l = 0; l < LAYER_COUNT; l++) {
      this.layerStart[l] = start;
      start += layerCount[l] ?? 0;
    }
    return idx;
  }
}
