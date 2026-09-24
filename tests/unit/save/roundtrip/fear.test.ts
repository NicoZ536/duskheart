/**
 * Save roundtrip of the participant `fear` (M3-23): fear, its stage, the hallucinations around the player
 * and the Nachtmahr's pursuit survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../../src/content/balance';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: fear', () => {
  it('restores fear, stage, hallucinations and the pursuit', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(24, 24)),
      (w) => {
        w.spawn(12, 12);
        w.env.light = 0;
        w.env.night = true;
        w.run(1, [{ type: 'fear.set', value: 99 }]);
        for (let i = 0; i < 20 * BALANCE.time.tickHz && w.life.fear.state.hallucinations.length === 0; i++) w.run(1);
      },
      (w) => w.sim.participant('fear'),
    );
    expect(report.id).toBe('fear');
    const data = JSON.parse(report.canonical) as { fear: { value: number; stage: string; pursued: boolean; hallucinations: unknown[] } };
    expect(data.fear).toMatchObject({ stage: 'nachtmahr', pursued: true, value: 100 });
    expect(data.fear.hallucinations.length).toBeGreaterThan(0);
  });

  it('rejects malformed snapshots', () => {
    const p = lifeWorld(meadow(4, 4)).sim.participant('fear');
    const fear = { value: 30, stage: 'unruhig', pursued: false, hallucinations: [], nextHallucinationTicks: 0, nextHallucinationId: 1 };
    expect(() => p.deserialize({ entity: 0, fear: { ...fear, stage: 'ruhig' } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0, fear: { ...fear, value: 130, stage: 'nachtmahr' } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0 })).toThrow(TypeError);
  });
});
