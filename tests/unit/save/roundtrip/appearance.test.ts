/**
 * Save roundtrip of the participant `appearance` (M7-52; docs/SPIEL.md §27 "Save-Version 4": "Name, Körperform, Paletten,
 * Frisur"): the chosen appearance survives save → load, the lock with it (a loaded world refuses a second choice); a save
 * from before M7 (no data, migration from 0) loads with the figure as drawn up to M6; malformed data is refused.
 */
import { describe, expect, it } from 'vitest';
import { AppearanceSystem, APPEARANCE_MIGRATIONS, defaultAppearance } from '../../../../src/game/appearance';
import type { GameCommand } from '../../../../src/game/commands';
import { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

const WAHL = { type: 'appearance.set', name: 'Ænne Ødegård', form: 'schmal', haut: 'haut_6', frisur: 'zoepfe', haar: 'haar_6', oberteil: 'kleid_3', hose: 'kleid_8' } as const satisfies GameCommand;

function world(): { sim: Simulation; system: AppearanceSystem } {
  const sim = new Simulation({ seed: 9, worldSize: 'small' });
  return { sim, system: sim.addSystem(new AppearanceSystem()) };
}

describe('save roundtrip: appearance', () => {
  it('restores name, body shape, palettes, hairstyle and the lock', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.sim.step([WAHL]);
        w.sim.events.drain(() => undefined);
      },
      (w) => w.system.save,
    );
    expect(report.id).toBe('appearance');
    expect(JSON.parse(report.canonical)).toEqual({ name: 'Ænne Ødegård', form: 'schmal', haut: 'haut_6', frisur: 'zoepfe', haar: 'haar_6', oberteil: 'kleid_3', hose: 'kleid_8', gewaehlt: true });
    // Loaded, the figure is the chosen one and stays it.
    const loaded = world();
    loaded.system.save.deserialize(JSON.parse(report.canonical));
    expect(loaded.system.appearance.frisur).toBe('zoepfe');
    loaded.sim.step([{ ...WAHL, name: 'Otto' }]);
    const rejected: unknown[] = [];
    loaded.sim.events.drain((type, payload) => {
      if (type === 'commandRejected') rejected.push(payload);
    });
    expect(rejected).toEqual([expect.objectContaining({ reason: 'appearanceLocked' })]);
    expect(loaded.system.appearance.name).toBe('Ænne Ødegård');
  });

  it('a save from before M7 (migration from 0) loads the figure as drawn up to M6, not chosen', () => {
    expect(APPEARANCE_MIGRATIONS.map((m) => m.from)).toEqual([0]);
    const migrated = APPEARANCE_MIGRATIONS[0]?.migrate(undefined);
    expect(migrated).toEqual(defaultAppearance());
    const w = world();
    w.system.save.deserialize(migrated);
    expect(w.system.appearance.gewaehlt).toBe(false);
    // Still open for a choice (the character creation of an old world is no M7 feature, the command would take it).
    w.sim.step([WAHL]);
    expect(w.system.appearance.gewaehlt).toBe(true);
  });

  it('malformed snapshots are refused', () => {
    const p = world().system.save;
    const ok = { ...defaultAppearance(), name: 'Mira', gewaehlt: true };
    expect(() => p.deserialize(ok)).not.toThrow();
    expect(() => p.deserialize({ ...ok, form: 'riesig' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...ok, haut: 'haar_1' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...ok, frisur: 'glatze' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...ok, hose: 'kleid_9' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...ok, name: 'x'.repeat(21) })).toThrow(TypeError);
    expect(() => p.deserialize({ ...ok, extra: 1 })).toThrow(TypeError);
    const { gewaehlt: _, ...ohne } = ok;
    expect(() => p.deserialize(ohne)).toThrow(TypeError);
  });
});
