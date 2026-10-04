/**
 * Content signatures of resident chunks (M2-28 "Chunk-Meshes nur bei Änderung neu bauen").
 *
 * Chunk data has no change counter: the simulation writes its typed arrays directly (digging,
 * felling, building), and the chunk manager replaces a chunk object when it streams back in. The
 * renderer therefore fingerprints what it shows: a 32-bit FNV-1a hash over the chunk's 8 KiB tile
 * buffer (read as 2 048 words) and its object states. A mesh or object list remembers the
 * signatures it was built from and is rebuilt only when one of them differs.
 *
 * Signatures are memoised per frame (`beginFrame`), so a chunk is hashed at most once per frame
 * however many meshes depend on it (a mesh depends on its eight neighbours as well). Hashing the
 * ~20 chunks around the view costs a few hundredths of a millisecond and allocates nothing after
 * a chunk was first seen (its word view and memo entry are kept in weak maps). The memo hands out
 * the hash folded to 30 bits (`ChunkSignatures.of`): a small integer in every engine, so neither
 * keeping nor returning it makes a heap number (§30; a 32-bit hash above 2^30 is one).
 */
import type { ChunkData, ObjectState } from '../../world/model/chunk';

/** FNV-1a 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** Scale of the fractional object state values before hashing (growth is a fraction). */
const STATE_SCALE = 1024;
/** Bits of a memoised signature (`ChunkSignatures.of`): a small integer (V8's Smi holds 31 bits with pointer compression). */
const MEMO_BITS = 30;
const MEMO_MASK = (1 << MEMO_BITS) - 1;

interface Memo {
  frame: number;
  value: number;
}

/** Accumulator of `hashState` (module state: no closure per call). */
let stateHash = 0;

function hashState(s: ObjectState, index: number): void {
  let h = Math.imul(stateHash ^ index, FNV_PRIME);
  h = Math.imul(h ^ Math.round(s.hp * STATE_SCALE), FNV_PRIME);
  h = Math.imul(h ^ Math.round(s.growth * STATE_SCALE), FNV_PRIME);
  stateHash = Math.imul(h ^ s.regrowAtTick, FNV_PRIME);
}

/** Hashes a chunk's content into `stateHash` (a signed 32-bit integer). */
function hashChunk(chunk: ChunkData, words: Uint32Array): void {
  let h = FNV_OFFSET;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ (words[i] as number), FNV_PRIME);
  stateHash = h;
  chunk.objectState.forEach(hashState);
}

/** Signature of a chunk's current content (tile arrays and object states; the full 32-bit hash). */
export function chunkSignature(chunk: ChunkData, words: Uint32Array = new Uint32Array(chunk.buffer)): number {
  hashChunk(chunk, words);
  return stateHash >>> 0;
}

/** Per-frame memo of chunk signatures. */
export class ChunkSignatures {
  private frame = 0;
  private readonly memo = new WeakMap<ChunkData, Memo>();
  private readonly words = new WeakMap<ChunkData, Uint32Array>();
  private hashed = 0;

  /** Starts a frame: every signature is computed afresh on first use. */
  beginFrame(): void {
    this.frame++;
    this.hashed = 0;
  }

  /** Chunks hashed since `beginFrame`. */
  get hashedThisFrame(): number {
    return this.hashed;
  }

  /**
   * Signature of `chunk` in this frame: its 32-bit hash folded to 30 bits (the top two bits into the bottom two) – a
   * whole number 0 … 2^30 − 1 that compares like the hash and never allocates.
   */
  of(chunk: ChunkData): number {
    let m = this.memo.get(chunk);
    if (m === undefined) {
      m = { frame: -1, value: 0 };
      this.memo.set(chunk, m);
    }
    if (m.frame !== this.frame) {
      let w = this.words.get(chunk);
      if (w === undefined) {
        w = new Uint32Array(chunk.buffer);
        this.words.set(chunk, w);
      }
      hashChunk(chunk, w);
      const h = stateHash;
      m.value = (h & MEMO_MASK) ^ (h >>> MEMO_BITS);
      m.frame = this.frame;
      this.hashed++;
    }
    return m.value;
  }
}
