import { describe, expect, it } from 'vitest';
import type { SaveParticipant } from '../../../src/save/registry';
import { expectRoundtrip } from '../../../src/save/roundtrip';

interface Box {
  values: number[];
  buf: Float32Array;
  participant: SaveParticipant;
}

function box(lossy = false): Box {
  const b: Box = {
    values: [],
    buf: new Float32Array(2),
    participant: {
      id: 'box',
      version: 1,
      serialize: () => ({ values: b.values.slice(), buf: b.buf.slice() }),
      deserialize: (data) => {
        const d = data as { values: number[]; buf: Float32Array };
        b.values = lossy ? d.values.slice(0, 1) : d.values.slice();
        b.buf = Float32Array.from(d.buf);
      },
    },
  };
  return b;
}

describe('expectRoundtrip', () => {
  it('passes for a faithful participant, including typed arrays, via clone and JSON', () => {
    const report = expectRoundtrip(
      () => box(),
      (b) => {
        b.values.push(1, 2, 3);
        b.buf[1] = 0.25;
      },
      (b) => b.participant,
    );
    expect(report.id).toBe('box');
    expect(report.transports).toEqual(['structuredClone', 'json']);
    expect(report.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('accepts a participant factory directly', () => {
    let state = 0;
    const make = (): SaveParticipant => ({
      id: 'direct',
      version: 1,
      serialize: () => ({ state }),
      deserialize: (d) => {
        state = (d as { state: number }).state;
      },
    });
    expect(expectRoundtrip(make, () => (state = 5)).id).toBe('direct');
  });

  it('reports the first difference of a lossy participant', () => {
    expect(() =>
      expectRoundtrip(
        () => box(true),
        (b) => b.values.push(1, 2),
        (b) => b.participant,
      ),
    ).toThrow(/Roundtrip "box" via structuredClone: restored state differs at values\[1\]: number 2 ≠ missing/);
  });

  it('refuses a mutation that changes nothing', () => {
    expect(() =>
      expectRoundtrip(
        () => box(),
        () => undefined,
        (b) => b.participant,
      ),
    ).toThrow(/did not change the serialized state/);
  });

  it('detects unstable serialization', () => {
    let n = 0;
    const make = (): SaveParticipant => ({ id: 'unstable', version: 1, serialize: () => ({ n: n++ }), deserialize: () => undefined });
    expect(() => expectRoundtrip(make, () => undefined)).toThrow(/serialize\(\) is not stable/);
  });

  it('checks that the factory builds the same participant', () => {
    let calls = 0;
    const make = (): SaveParticipant => {
      calls++;
      return { id: 'p', version: calls > 2 ? 2 : 1, serialize: () => ({ calls }), deserialize: () => undefined };
    };
    expect(() => expectRoundtrip(make, () => undefined)).toThrow(/expected v1/);
  });
});
