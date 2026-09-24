/**
 * Save roundtrip of the participant `cheats` (M3-35): the switches of the console's cheats `god` and
 * `noclip` survive save → load (a game saved in god mode loads in god mode).
 */
import { describe, expect, it } from 'vitest';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: cheats', () => {
  it('restores the cheat switches', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(4, 4)),
      (w) => {
        w.run(1, [
          { type: 'debug.god', on: true },
          { type: 'debug.noclip', on: true },
        ]);
      },
      (w) => w.sim.participant('cheats'),
    );
    expect(report.id).toBe('cheats');
    expect(JSON.parse(report.canonical)).toEqual({ god: true, noclip: true });
  });

  it('malformed snapshots are refused', () => {
    const p = lifeWorld(meadow(4, 4)).sim.participant('cheats');
    expect(p.serialize()).toEqual({ god: false, noclip: false });
    expect(() => p.deserialize({ god: true })).toThrow(TypeError);
    expect(() => p.deserialize({ god: 1, noclip: false })).toThrow(TypeError);
    expect(() => p.deserialize({ god: false, noclip: false, fly: true })).toThrow(TypeError);
  });
});
