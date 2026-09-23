/**
 * y-sort + layer order (MASTERPROMPT §6.1 pass 2): ground → water mask → y-sorted objects →
 * roofs/canopy. Within a layer sprites are ordered by their anchor depth (the foot point: whoever
 * stands lower on screen is drawn later, i.e. in front); equal depths keep submission order, so the
 * order is stable from frame to frame and nothing flickers.
 *
 * Implementation: a 32-bit key (layer in the top bits, depth quantised to 1/16 px relative to the
 * frame's smallest depth) sorted with a stable LSD radix sort into preallocated arrays – O(n), no
 * allocation per frame.
 */
import { LAYER_COUNT } from '../batch/spriteLayout';

/** Depth resolution of the sort key: 1/16 px (interpolated positions differ by fractions of a pixel). */
export const DEPTH_STEPS_PER_PX = 16;
/** Bits of the depth part of the key; the layer occupies the bits above. */
export const DEPTH_BITS = 28;
const DEPTH_MAX = 2 ** DEPTH_BITS - 1;
const RADIX_BITS = 8;
const RADIX = 1 << RADIX_BITS;
const RADIX_MASK = RADIX - 1;
const KEY_BITS = 32;
const PASSES = KEY_BITS / RADIX_BITS;

export class YSorter {
  private keysA = new Uint32Array(0);
  private keysB = new Uint32Array(0);
  private idxA = new Uint32Array(0);
  private idxB = new Uint32Array(0);
  private readonly counts = new Uint32Array(RADIX);
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
   * `count` entries valid; the array is reused by the next call).
   */
  sort(layers: ArrayLike<number>, depths: ArrayLike<number>, count: number): Uint32Array {
    this.ensure(count);
    this.layerCount.fill(0);
    let minDepth = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const d = depths[i] ?? 0;
      if (d < minDepth) minDepth = d;
    }
    if (!Number.isFinite(minDepth)) minDepth = 0;
    let keys = this.keysA;
    let idx = this.idxA;
    for (let i = 0; i < count; i++) {
      const layer = layers[i] ?? 0;
      const d = depths[i] ?? minDepth;
      const q = Math.min(DEPTH_MAX, Math.max(0, Math.floor((Number.isFinite(d) ? d - minDepth : 0) * DEPTH_STEPS_PER_PX)));
      keys[i] = ((layer << DEPTH_BITS) | q) >>> 0;
      idx[i] = i;
      this.layerCount[layer] = (this.layerCount[layer] ?? 0) + 1;
    }
    let keysOut = this.keysB;
    let idxOut = this.idxB;
    const counts = this.counts;
    for (let pass = 0; pass < PASSES; pass++) {
      const shift = pass * RADIX_BITS;
      counts.fill(0);
      for (let i = 0; i < count; i++) {
        const b = ((keys[i] ?? 0) >>> shift) & RADIX_MASK;
        counts[b] = (counts[b] ?? 0) + 1;
      }
      // A pass where every key has the same digit changes nothing.
      let skip = false;
      for (let b = 0; b < RADIX; b++) if (counts[b] === count) skip = true;
      if (skip) continue;
      let sum = 0;
      for (let b = 0; b < RADIX; b++) {
        const c = counts[b] ?? 0;
        counts[b] = sum;
        sum += c;
      }
      for (let i = 0; i < count; i++) {
        const k = keys[i] ?? 0;
        const b = (k >>> shift) & RADIX_MASK;
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
      start += this.layerCount[l] ?? 0;
    }
    return idx;
  }
}
