/**
 * Save roundtrip of the participant `instruments` (M7-31, version 1 in save version 4): the music being played (instrument,
 * song, start tick, slot), the number of plays (the songs' turn), the net's swing counter (the cricket draw) and the
 * fireflies taken per swarm and night survive save → load; malformed snapshots are refused; version 0 migrates to the
 * empty state.
 */
import { describe, expect, it } from 'vitest';
import { InstrumentsSystem, INSTRUMENTS_SAVE_VERSION } from '../../../../src/game/instruments/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { SAVE_VERSIONS } from '../../../../src/save/versions';
import { lifeWorld, type LifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

function world(): LifeWorld & { instruments: InstrumentsSystem } {
  const w = lifeWorld(meadow(16, 16));
  const instruments = w.sim.addSystem(new InstrumentsSystem({ player: w.player, inventory: w.inventory, collision: w.collision, night: () => true }));
  w.player.addMotionHold(instruments.holdsPlayer);
  return Object.assign(w, { instruments });
}

describe('save roundtrip: instruments', () => {
  it('restores the song being played, the turn of the songs and the net’s counters', () => {
    const report = expectRoundtrip(
      () => world(),
      (w) => {
        w.spawn(8, 8);
        w.run(1, [{ type: 'inventory.give', item: 'floete', count: 1 }]);
        w.run(1, [{ type: 'instrument.play', from: { bereich: 'inventar', index: 0 } }]);
        w.run(1, [{ type: 'instrument.play', from: { bereich: 'inventar', index: 0 } }]);
        w.instruments.save.deserialize({ ...(w.instruments.save.serialize() as object), netzZuege: 17, schwaerme: [{ serial: 4, nacht: 2, gefangen: 3 }] });
        w.run(5);
      },
      (w) => w.sim.participant('instruments'),
    );
    expect(report.id).toBe('instruments');
    const data = JSON.parse(report.canonical) as { spielt: { instrument: string; lied: string }; gespielt: number; netzZuege: number; schwaerme: unknown[] };
    expect(data.spielt).toMatchObject({ instrument: 'floete', lied: 'lied_2' });
    expect(data.gespielt).toBe(2);
    expect(data.netzZuege).toBe(17);
    expect(data.schwaerme).toEqual([{ serial: 4, nacht: 2, gefangen: 3 }]);
  });

  it('version 1 in save version 4; malformed snapshots are refused, version 0 migrates to nothing played', () => {
    expect(INSTRUMENTS_SAVE_VERSION).toBe(1);
    const latest = SAVE_VERSIONS[SAVE_VERSIONS.length - 1] as { version: number; participants: Record<string, number> };
    expect(latest.version).toBe(4);
    expect(latest.participants.instruments).toBe(INSTRUMENTS_SAVE_VERSION);
    const p = world().sim.participant('instruments');
    expect(p.serialize()).toEqual({ spielt: null, gespielt: 0, netzZuege: 0, schwaerme: [] });
    expect(() => p.deserialize({ spielt: null, gespielt: -1, netzZuege: 0, schwaerme: [] })).toThrow(TypeError);
    expect(() => p.deserialize({ spielt: { instrument: 'floete', lied: 'lied_1', startTick: 0, from: { bereich: 'nirgends', index: 0 } }, gespielt: 1, netzZuege: 0, schwaerme: [] })).toThrow(TypeError);
    expect(() => p.deserialize({ spielt: null, gespielt: 0, netzZuege: 0 })).toThrow(TypeError);
    const migration = p.migrations?.find((m) => m.from === 0);
    expect(migration?.migrate({})).toEqual({ spielt: null, gespielt: 0, netzZuege: 0, schwaerme: [] });
  });
});
