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
