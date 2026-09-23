import { describe, expect, it } from 'vitest';
import {
  Fnv1a64,
  base64ToBytes,
  base64ToTypedArray,
  bytesToBase64,
  fnv1a32,
  fnv1a32String,
  fnv1a64Hex,
  rleDecodeU16,
  rleDecodeU8,
  rleEncodeU16,
  rleEncodeU8,
  typedArrayBytes,
  typedArrayToBase64,
} from '../../../src/engine/binary';
import { Rng } from '../../../src/engine/rng';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('base64', () => {
  it('matches the RFC 4648 test vectors', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, enc] of vectors) {
      expect(bytesToBase64(utf8(plain))).toBe(enc);
      expect(Array.from(base64ToBytes(enc))).toEqual(Array.from(utf8(plain)));
    }
  });

  it('agrees with Node Buffer on random data and accepts missing padding', () => {
    const rng = new Rng(3);
    for (let len = 0; len < 70; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = rng.int(0, 256);
      const enc = bytesToBase64(bytes);
      expect(enc).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(enc))).toEqual(Array.from(bytes));
      expect(Array.from(base64ToBytes(enc.replace(/=+$/, '')))).toEqual(Array.from(bytes));
    }
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('Zm9v!')).toThrow(SyntaxError);
    expect(() => base64ToBytes('Z')).toThrow(SyntaxError);
    expect(() => base64ToBytes('Zg===')).toThrow(SyntaxError);
    expect(() => base64ToBytes('Zg=')).toThrow(SyntaxError);
    expect(() => base64ToBytes('Zm9vä')).toThrow(SyntaxError);
  });

  it('roundtrips typed arrays exactly (little endian)', () => {
    const f32 = new Float32Array([0, -1.5, Math.PI, Number.POSITIVE_INFINITY, 1e-40]);
    expect(Array.from(base64ToTypedArray(typedArrayToBase64(f32), Float32Array))).toEqual(Array.from(f32));
    const f64 = new Float64Array([Math.E, -0, Number.MAX_VALUE]);
    const f64back = base64ToTypedArray(typedArrayToBase64(f64), Float64Array);
    expect(Array.from(f64back)).toEqual(Array.from(f64));
    expect(Object.is(f64back[1], -0)).toBe(true);
    const u16 = new Uint16Array([1, 0xffff, 0x1234]);
    expect(typedArrayToBase64(u16)).toBe(bytesToBase64(new Uint8Array([1, 0, 0xff, 0xff, 0x34, 0x12])));
    expect(Array.from(base64ToTypedArray(typedArrayToBase64(u16), Uint16Array))).toEqual([1, 0xffff, 0x1234]);
    const i32 = new Int32Array([-1, 2 ** 31 - 1, -(2 ** 31)]);
    expect(Array.from(base64ToTypedArray(typedArrayToBase64(i32), Int32Array))).toEqual(Array.from(i32));
    // Views into larger buffers only encode their own window.
    const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
    expect(typedArrayToBase64(big.subarray(2, 5))).toBe(bytesToBase64(new Uint8Array([1, 2, 3])));
    expect(() => base64ToTypedArray(bytesToBase64(new Uint8Array(3)), Uint16Array)).toThrow(RangeError);
  });

  it('typedArrayBytes exposes little endian bytes', () => {
    expect(Array.from(typedArrayBytes(new Uint32Array([0x01020304])))).toEqual([4, 3, 2, 1]);
  });
});

describe('RLE', () => {
  it('roundtrips u8 data with long and short runs', () => {
    const data = new Uint8Array(1024);
    data.fill(3, 0, 600);
    data.fill(7, 600, 601);
    data.fill(0, 601, 1000);
    for (let i = 1000; i < 1024; i++) data[i] = i & 0xff;
    const enc = rleEncodeU8(data);
    expect(enc.length).toBeLessThan(data.length / 8);
    expect(enc[0]).toBe(255); // runs are split at 255
    expect(Array.from(rleDecodeU8(enc, 1024))).toEqual(Array.from(data));
  });

  it('roundtrips u16 data', () => {
    const data = new Uint16Array(70_000).fill(0x1234);
    data[5] = 1;
    data[69_999] = 65_535;
    const enc = rleEncodeU16(data);
    expect(enc.length).toBe(10);
    expect(Array.from(rleDecodeU16(enc))).toEqual(Array.from(data));
  });

  it('handles empty input and validates encoded data', () => {
    expect(rleEncodeU8(new Uint8Array(0)).length).toBe(0);
    expect(rleDecodeU8(new Uint8Array(0)).length).toBe(0);
    expect(() => rleDecodeU8(new Uint8Array([1]))).toThrow(RangeError);
    expect(() => rleDecodeU8(new Uint8Array([0, 5]))).toThrow(RangeError);
    expect(() => rleDecodeU8(new Uint8Array([2, 5]), 3)).toThrow(RangeError);
    expect(() => rleDecodeU16(new Uint16Array([0, 1]))).toThrow(RangeError);
  });

  it('roundtrips random data', () => {
    const rng = new Rng(8);
    const data = new Uint8Array(4096);
    for (let i = 0; i < data.length; i++) data[i] = rng.bool(0.9) && i > 0 ? (data[i - 1] as number) : rng.int(0, 4);
    expect(Array.from(rleDecodeU8(rleEncodeU8(data), data.length))).toEqual(Array.from(data));
  });
});

describe('FNV-1a', () => {
  it('matches the reference 32 bit vectors', () => {
    expect(fnv1a32(utf8(''))).toBe(0x811c9dc5);
    expect(fnv1a32(utf8('a'))).toBe(0xe40c292c);
    expect(fnv1a32(utf8('foobar'))).toBe(0xbf9cf968);
  });

  it('matches the reference 64 bit vectors', () => {
    expect(fnv1a64Hex(utf8(''))).toBe('cbf29ce484222325');
    expect(fnv1a64Hex(utf8('a'))).toBe('af63dc4c8601ec8c');
    expect(fnv1a64Hex(utf8('foobar'))).toBe('85944171f73967e8');
  });

  it('chains across arrays like one stream', () => {
    const a = utf8('foo');
    const b = utf8('bar');
    expect(fnv1a32(b, fnv1a32(a))).toBe(fnv1a32(utf8('foobar')));
    expect(fnv1a64Hex(a, b)).toBe('85944171f73967e8');
    const h = new Fnv1a64().update(a).update(b);
    expect(h.hex()).toBe('85944171f73967e8');
    expect(h.high).toBe(0x85944171);
    expect(h.low).toBe(0xf73967e8);
  });

  it('hashes typed arrays by their little endian bytes', () => {
    const u16 = new Uint16Array([0x6261]); // bytes 'a', 'b'
    expect(fnv1a32(u16)).toBe(fnv1a32(utf8('ab')));
    expect(fnv1a64Hex(new Float32Array([1, 2]))).not.toBe(fnv1a64Hex(new Float32Array([2, 1])));
  });

  it('hashes strings by UTF-16 code units', () => {
    expect(fnv1a32String('ab')).toBe(fnv1a32(new Uint16Array([0x61, 0x62])));
    expect(fnv1a32String('ab')).not.toBe(fnv1a32String('ba'));
  });
});
