import { describe, expect, it } from 'vitest';
import { canonicalDiff, canonicalEqual, canonicalJson, stableHash64 } from '../../../src/save/canonical';

describe('canonicalDiff', () => {
  it('returns null for canonically equal data', () => {
    expect(canonicalDiff({ a: 1, b: [1, { c: new Uint8Array([1]) }] }, { b: [1, { c: new Uint8Array([1]) }], a: 1 })).toBeNull();
    expect(canonicalDiff({ a: undefined, b: 0 }, { b: -0 })).toBeNull();
    expect(canonicalEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
  });

  it('names the first differing path', () => {
    expect(canonicalDiff({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe('a.b[1]: number 2 ≠ number 3');
    expect(canonicalDiff({ a: 1 }, { a: 1, z: 'x' })).toBe('z: missing ≠ string "x"');
    expect(canonicalDiff([1], [1, 2])).toBe('[1]: missing ≠ number 2');
    expect(canonicalDiff({ f: new Float32Array([1]) }, { f: new Float32Array([2]) })).toBe('f: Float32Array(1) ≠ Float32Array(1)');
    expect(canonicalDiff({ f: new Float32Array([1]) }, { f: new Float64Array([1]) })).toBe('f: Float32Array(1) ≠ Float64Array(1)');
    expect(canonicalDiff({ a: [1] }, { a: { 0: 1 } })).toBe('a: array(1) ≠ object');
    expect(canonicalDiff(1, '1')).toBe('(root): number 1 ≠ string "1"');
    expect(canonicalDiff(null, {})).toBe('(root): null ≠ object');
  });

  it('re-exports the canonical encoder and hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableHash64({ b: 1, a: 2 })).toBe(stableHash64({ a: 2, b: 1 }));
  });
});
