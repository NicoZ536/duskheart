/**
 * Save roundtrip of the participant `light` (M3-21, M3-22): the carried torch (slot, mode, burn, rain,
 * heavy-rain minutes) and the placed torches and fires (burn, fuel, embers) survive save → load, and a
 * loaded world goes on exactly like the uninterrupted one.
 */
import { describe, expect, it } from 'vitest';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lightWorld, type LightWorld } from '../../game/licht-testwelt';
import { meadow, OFFSET } from '../../game/spieler-testwelt';

/** A camp: a burning torch in hand (heavy rain), a torch on its stake, a fuelled camp fire. */
function camp(w: LightWorld): void {
  w.spawn(10, 10);
  w.give('fackel', 2);
  w.give('lagerfeuer', 1);
  w.give('holz', 4);
  const fire = w.place('lagerfeuer', 11, 11);
  w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz'), count: 2 }]);
  w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 11 }]);
  w.place('fackel', 14, 9);
  w.equipTorch();
  w.lenv.precipitation = 1;
  w.step(1, [{ type: 'light.toggle' }]);
  w.step(700);
}

describe('save roundtrip: light', () => {
  it('restores the carried torch, placed torches and fires', () => {
    const report = expectRoundtrip(
      () => lightWorld(meadow(24, 24)),
      (w) => camp(w),
      (w) => w.sim.participant('light'),
    );
    expect(report.id).toBe('light');
    const data = JSON.parse(report.canonical) as { carried: { mode: string; burn: { lit: boolean; rain: string } }; placed: Array<{ kind: string; mount: string }>; nextId: number };
    expect(data.carried).toMatchObject({ mode: 'hand', burn: { lit: true, rain: 'starkregen' } });
    expect(data.placed.map((l) => [l.kind, l.mount])).toEqual([
      ['lagerfeuer', 'boden'],
      ['fackel', 'stand'],
    ]);
    expect(data.nextId).toBe(3);
  });

  it('save → load → continue: the same lights, sources and hash as the uninterrupted run', () => {
    const a = lightWorld(meadow(24, 24));
    camp(a);
    const b = lightWorld(meadow(24, 24));
    // The weather is the world's (not the light system's): the loaded world rains the same.
    b.lenv.precipitation = a.lenv.precipitation;
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    a.step(4000);
    b.step(4000);
    expect(b.sim.participant('light').serialize()).toEqual(a.sim.participant('light').serialize());
    expect(b.light.sources(b.sim).map((s) => [s.id, s.x, s.y, s.radius, s.brenndauer])).toEqual(a.light.sources(a.sim).map((s) => [s.id, s.x, s.y, s.radius, s.brenndauer]));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('rejects malformed snapshots', () => {
    const p = lightWorld(meadow(4, 4)).sim.participant('light');
    const torch = { lit: true, rest: 10, at: 0, rain: 'trocken', heavyTicks: 0 };
    const placed = { id: 1, kind: 'fackel', layer: 0, tx: 1, ty: 1, mount: 'stand', torch, fire: null };
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [placed], carried: null })).not.toThrow();
    expect(() => p.deserialize({ nextId: 1, handSerial: 0, placed: [placed], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...placed, mount: 'boden' }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...placed, fire: { lit: false, fuel: 0, embers: 0, burned: false, at: 0 } }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 3, handSerial: 0, placed: [placed, { ...placed, id: 2 }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...placed, kind: 'laterne' }], carried: null })).toThrow();
    expect(() => p.deserialize({ nextId: 1, handSerial: 0, placed: [], carried: { ref: { bereich: 'ausruestung', index: 5 }, item: 'fackel', kind: 'fackel', startRest: null, serial: 1, mode: 'hand', burn: torch } })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 1, handSerial: 0 })).toThrow(TypeError);
  });
});
