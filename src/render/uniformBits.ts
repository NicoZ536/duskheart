/**
 * Change detection of uniform inputs without reading a float (MASTERPROMPT §30 "keine Allokation im Frame-Pfad"): a
 * pass writes the frame's inputs into a `Float32Array` – the precision its uniforms have anyway – and compares an
 * `Int32Array` view of it with the bits of its last upload. Integers only: in V8's baseline tier, where code that runs
 * once a frame stays for a long time, every float read back from a record would be a new heap number.
 */

/**
 * Whether the first `n` bit patterns of `now` differ from `last`; copies them into `last`. A change below float32
 * precision is no change for a uniform.
 */
export function bitsChanged(now: Int32Array, last: Int32Array, n: number): boolean {
  let changed = false;
  for (let i = 0; i < n; i++) {
    const v = now[i] as number;
    if (v !== last[i]) {
      last[i] = v;
      changed = true;
    }
  }
  return changed;
}

/**
 * Float inputs of a frame – a camera position, a figure's feet – remembered by their bits, so code that runs once a
 * frame can tell a still frame from a moving one without reading a float back: `set` stores a value (the caller's own
 * heap number, no new one), `changed` compares the bit patterns with those of its last call. Bit for bit: −0 differs from
 * 0 and a NaN equals the same NaN – a change then only costs a computation that gives the same result. The first call
 * (and the first after `reset`) reports a change.
 */
export class FloatKey {
  private readonly values: Float64Array;
  private readonly bits: Int32Array;
  private readonly last: Int32Array;
  private known = false;

  constructor(size: number) {
    this.values = new Float64Array(size);
    this.bits = new Int32Array(this.values.buffer);
    this.last = new Int32Array(this.bits.length);
  }

  /** Sets value `i` of this frame. */
  set(i: number, v: number): this {
    this.values[i] = v;
    return this;
  }

  /** Whether a value differs from the last call's; remembers them. */
  changed(): boolean {
    const moved = bitsChanged(this.bits, this.last, this.bits.length);
    const first = !this.known;
    this.known = true;
    return moved || first;
  }

  /** Forgets the values: the next `changed` reports a change. */
  reset(): void {
    this.known = false;
  }
}

/** High word of the double 1 (`Float64Array` slots seen through an `Int32Array`: low word first on little-endian hosts). */
const ONE_HIGH_WORD = 0x3ff00000;

/**
 * Whether the double in slot `slot` of the `Float64Array` that `words` views is exactly +0 – told from its bits, no float
 * is read (§30). −0 and NaN are not.
 */
export function zeroAt(words: Int32Array, slot: number): boolean {
  return (words[2 * slot] as number) === 0 && (words[2 * slot + 1] as number) === 0;
}

/**
 * Whether the double in slot `slot` of the `Float64Array` that `words` views is exactly 1 – told from its bits (§30). On
 * a big-endian host it never says so (the caller then reads the value: slower, the same result).
 */
export function oneAt(words: Int32Array, slot: number): boolean {
  return (words[2 * slot] as number) === 0 && (words[2 * slot + 1] as number) === ONE_HIGH_WORD;
}
