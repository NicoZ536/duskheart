import { describe, expect, it } from 'vitest';
import { TYPED_ARRAY_TAG, canonicalJson, hashText64, parseCanonical, stableHash64 } from '../../../src/game/canonical';

describe('canonicalJson', () => {
  it('sorts keys at every level and omits whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('matches JSON for primitives and drops undefined properties', () => {
    for (const v of ['ä"\n', 0, -0, 1.5, 1e21, true, false, null]) expect(canonicalJson(v)).toBe(JSON.stringify(v));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson(Object.assign(Object.create(null) as object, { k: 1 }))).toBe('{"k":1}');
  });

  it('encodes typed arrays as tagged base64 and restores them exactly', () => {
    const data = {
      f32: new Float32Array([1.5, -0, Number.MIN_VALUE, 3.4e38]),
      f64: new Float64Array([Math.PI]),
      u8c: new Uint8ClampedArray([0, 255]),
      u8: new Uint8Array([1, 2, 3]),
      i8: new Int8Array([-128]),
      i16: new Int16Array([-2]),
      u16: new Uint16Array([65535]),
      i32: new Int32Array([-5]),
      u32: new Uint32Array([0xffffffff]),
      sub: new Uint16Array([9, 8, 7, 6]).subarray(1, 3),
    };
    const json = canonicalJson(data);
    expect(json).toContain(`{"${TYPED_ARRAY_TAG}":"f32","b64":"`);
    const back = parseCanonical(json) as typeof data;
    expect(back.f32).toBeInstanceOf(Float32Array);
    expect(Array.from(back.f32)).toEqual(Array.from(data.f32));
    expect(Object.is(back.f32[1], -0)).toBe(true);
    expect(back.u8c).toBeInstanceOf(Uint8ClampedArray);
    expect(back.u8).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.sub)).toEqual([8, 7]);
    expect(canonicalJson(back)).toBe(json);
  });

  it('rejects data that has no canonical JSON form, naming the path', () => {
    expect(() => canonicalJson({ a: [1, Number.NaN] })).toThrow(/non-finite number NaN at a\[1\]/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/\(root\)/);
    expect(() => canonicalJson({ a: 1n })).toThrow(/bigint/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined array element/);
    expect(() => canonicalJson({ m: new Map() })).toThrow(/non-plain object Map at m/);
    expect(() => canonicalJson({ d: new DataView(new ArrayBuffer(2)) })).toThrow(/binary view/);
    expect(() => canonicalJson({ [TYPED_ARRAY_TAG]: 'x' })).toThrow(/reserved key/);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cycle at self/);
    // Shared (non-cyclic) references are fine.
    const shared = { v: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });

  it('parseCanonical rejects unknown typed array tags', () => {
    expect(() => parseCanonical(`{"${TYPED_ARRAY_TAG}":"f16","b64":""}`)).toThrow(/unknown typed array tag/);
  });
});

describe('stableHash64', () => {
  it('is a 16 digit hex FNV-1a 64 of the canonical UTF-8 text', () => {
    // FNV-1a 64 test vectors.
    expect(hashText64('')).toBe('cbf29ce484222325');
    expect(hashText64('a')).toBe('af63dc4c8601ec8c');
    expect(hashText64('foobar')).toBe('85944171f73967e8');
    expect(stableHash64({ b: [1, 2], a: 'x' })).toBe(hashText64('{"a":"x","b":[1,2]}'));
    expect(stableHash64({ a: 1, b: 2 })).toBe(stableHash64({ b: 2, a: 1 }));
    expect(stableHash64({ a: 1 })).not.toBe(stableHash64({ a: 2 }));
    expect(stableHash64('ü')).toBe(hashText64('"ü"'));
  });
});
