/**
 * Save roundtrip of the participant `sleep` (M3-24): a sleep in progress – its place, comfort, nap flag and
 * the morning it waits for – survives save → load.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../../src/engine/ecs';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: sleep', () => {
  it('restores a sleep in progress', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(12, 12)),
      (w) => {
        w.spawn(5, 5);
        w.bed(6, 5, 'bett', 7, true);
        w.jumpToHour(22);
        w.run(1, [{ type: 'sleep.start', ...w.tile(6, 5) }]);
        w.run(30);
      },
      (w) => w.sim.participant('sleep'),
    );
    expect(report.id).toBe('sleep');
    const data = JSON.parse(report.canonical) as { slumber: { place: { kind: string; comfort: number; bedroom: boolean }; nap: boolean } };
    expect(data.slumber).toMatchObject({ nap: false, place: { kind: 'bett', comfort: 7, bedroom: true } });
  });

  it('a world without player sleeps nobody; malformed snapshots are refused', () => {
    const p = lifeWorld(meadow(4, 4)).sim.participant('sleep');
    expect(p.serialize()).toEqual({ entity: NULL_ENTITY, slumber: null });
    const place = { kind: 'bett', x: 8, y: 8, layer: 0, comfort: 0, bedroom: false };
    expect(() => p.deserialize({ entity: NULL_ENTITY, slumber: { place, nap: false, sinceTick: 0, dawns: 0 } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0, slumber: { place: { ...place, kind: 'heuhaufen' }, nap: false, sinceTick: 0, dawns: 0 } })).toThrow(TypeError);
  });
});
