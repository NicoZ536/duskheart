/**
 * Save roundtrip of the participant `light` (M3-21, M3-22, M4-19): the carried torch (slot, mode, burn, rain,
 * heavy-rain minutes), the placed torches and fires (burn, fuel, embers) and the furniture lights of the build grid
 * (lamps with their fuel stock, the fireplace with its footprint) survive save → load, and a loaded world goes on
 * exactly like the uninterrupted one.
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

/** Furniture lights: a resin lamp in the rain and the fireplace under a roof, both burning. */
function furniture(w: LightWorld): void {
  w.spawn(10, 10);
  w.light.addShelter((_s, _layer, tx, ty) => tx >= OFFSET + 11 && tx <= OFFSET + 12 && ty === OFFSET + 11);
  w.give('harz', 3);
  w.give('holz', 6);
  const lamp = w.light.placeFurniture(w.sim, 'harzlampe', 0, OFFSET + 11, OFFSET + 10) ?? 0;
  const kamin = w.light.placeFurniture(w.sim, 'kamin_stein', 0, OFFSET + 11, OFFSET + 11, 2, 1) ?? 0;
  w.step(1, [{ type: 'light.fuel', light: lamp, from: w.slotOf('harz'), count: 3 }]);
  w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
  w.step(1, [{ type: 'light.fuel', light: kamin, from: w.slotOf('holz'), count: 6 }]);
  w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 11 }]);
  w.lenv.precipitation = 0.7;
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

  it('restores lamps and the fireplace with its footprint; loaded, they burn on like the uninterrupted ones', () => {
    const report = expectRoundtrip(
      () => lightWorld(meadow(24, 24)),
      (w) => furniture(w),
      (w) => w.sim.participant('light'),
    );
    const data = JSON.parse(report.canonical) as { placed: Array<{ kind: string; mount: string; groesse?: object; torch: { lit: boolean; rain: string } | null; fire: { lit: boolean } | null }> };
    expect(data.placed.map((l) => [l.kind, l.mount, l.groesse ?? null])).toEqual([
      ['harzlampe', 'stand', null],
      ['kamin_stein', 'boden', { b: 2, t: 1 }],
    ]);
    expect(data.placed[0]?.torch).toMatchObject({ lit: true, rain: 'regen' });
    expect(data.placed[1]?.fire).toMatchObject({ lit: true });
    const a = lightWorld(meadow(24, 24));
    furniture(a);
    const b = lightWorld(meadow(24, 24));
    b.light.addShelter((_s, _layer, tx, ty) => tx >= OFFSET + 11 && tx <= OFFSET + 12 && ty === OFFSET + 11);
    b.lenv.precipitation = a.lenv.precipitation;
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    // The loaded fireplace covers both of its tiles again.
    expect(b.light.lightAt(0, OFFSET + 12, OFFSET + 11)?.kind).toBe('kamin_stein');
    a.step(3000);
    b.step(3000);
    expect(b.sim.participant('light').serialize()).toEqual(a.sim.participant('light').serialize());
    expect(b.light.heatSources()(b.sim).map((h) => [h.x, h.y, h.coreHeatC])).toEqual(a.light.heatSources()(a.sim).map((h) => [h.x, h.y, h.coreHeatC]));
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
    // Furniture lights: only they cover more than one tile; a fireplace is a fire, a lamp is none; no two share a tile.
    const fire = { lit: false, fuel: 0, embers: 0, burned: false, at: 0 };
    const kamin = { id: 1, kind: 'kamin_stein', layer: 0, tx: 1, ty: 1, groesse: { b: 2, t: 1 }, mount: 'boden', torch: null, fire };
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [kamin], carried: null })).not.toThrow();
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...placed, groesse: { b: 2, t: 1 } }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...kamin, mount: 'stand', torch, fire: null }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 2, handSerial: 0, placed: [{ ...placed, kind: 'harzlampe', mount: 'boden', torch: null, fire }], carried: null })).toThrow(TypeError);
    expect(() => p.deserialize({ nextId: 3, handSerial: 0, placed: [kamin, { ...placed, id: 2, tx: 2, ty: 1 }], carried: null })).toThrow(TypeError);
  });
});
