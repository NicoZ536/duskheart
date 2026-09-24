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
 * a chunk was first seen (its word view and memo entry are kept in weak maps).
 */
import type { ChunkData, ObjectState } from '../../world/model/chunk';

/** FNV-1a 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** Scale of the fractional object state values before hashing (growth is a fraction). */
const STATE_SCALE = 1024;

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

/** Signature of a chunk's current content (tile arrays and object states). */
export function chunkSignature(chunk: ChunkData, words: Uint32Array = new Uint32Array(chunk.buffer)): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ (words[i] as number), FNV_PRIME);
  stateHash = h;
  chunk.objectState.forEach(hashState);
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

  /** Signature of `chunk` in this frame. */
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
      m.value = chunkSignature(chunk, w);
      m.frame = this.frame;
      this.hashed++;
    }
    return m.value;
  }
}
