/**
 * Save roundtrip of the participant `death` (M3-26): the difficulty, the player's death while the death
 * screen shows, the respawn point of the bed and the graves with their items survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { createSimulation } from '../../../../src/game/setup';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: death', () => {
  it('restores difficulty, death, respawn point and graves', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(16, 16)),
      (w) => {
        w.spawn(5, 5);
        w.life.death.setDifficulty('hart');
        w.bed(6, 5, 'grasbett');
        w.jumpToHour(20);
        w.run(1, [{ type: 'sleep.start', ...w.tile(6, 5) }]);
        w.run(1, [{ type: 'sleep.wake' }]);
        w.run(1, [{ type: 'inventory.give', item: 'feuerstein', count: 4 }]);
        w.run(1, [{ type: 'death.kill' }]);
      },
      (w) => w.sim.participant('death'),
    );
    expect(report.id).toBe('death');
    const data = JSON.parse(report.canonical) as { difficulty: string; death: { cause: string; grave: number }; respawn: { kind: string }; graves: Array<{ items: unknown[] }> };
    expect(data).toMatchObject({ difficulty: 'hart', death: { cause: 'debug', grave: 1 }, respawn: { kind: 'grasbett' } });
    expect(data.graves[0]?.items).toEqual([{ item: 'feuerstein', count: 4 }]);
  });

  it('a new world starts on Normal without graves; duplicate grave ids are refused', () => {
    const p = createSimulation({ seed: 5 }).participant('death');
    expect(p.serialize()).toEqual({ difficulty: 'normal', death: null, respawn: null, graves: [], nextGraveId: 1 });
    const grave = { id: 1, x: 0, y: 0, layer: 0, items: [{ item: 'stein', count: 1 }], tick: 0 };
    expect(() => p.deserialize({ difficulty: 'normal', death: null, respawn: null, graves: [grave, grave], nextGraveId: 2 })).toThrow(TypeError);
    expect(() => p.deserialize({ difficulty: 'leicht', death: null, respawn: null, graves: [], nextGraveId: 1 })).toThrow(TypeError);
  });
});
