/**
 * Save roundtrip of the participant `vitals` (M3-17, M3-18): health, stamina, satiety, thirst, wetness,
 * exhaustion, core temperature, the timers of regeneration, the stages and the damage not yet reported
 * survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY, makeEntity } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import type { VitalsSystem } from '../../../../src/game/survival/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    sim.events.clear();
  }
}

describe('save roundtrip: vitals', () => {
  it('restores every survival value of the player', () => {
    const report = expectRoundtrip(
      () => createSimulation(CONFIG),
      (sim) => {
        sim.step([{ type: 'player.spawn' }]);
        sim.step([{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }]);
        run(sim, 90);
        // Starving and thirsty: damage over time that is not yet reported is part of the state.
        const v = (sim.system('vitals') as VitalsSystem).vitalsOf(sim);
        if (v === undefined) throw new Error('no player');
        v.satiety = 0;
        v.thirst = 0;
        run(sim, 7);
      },
      (sim) => sim.participant('vitals'),
    );
    expect(report.id).toBe('vitals');
    const data = JSON.parse(report.canonical) as { entity: number; vitals: { stamina: number; satietyStage: string; thirstStage: string; pendingDamage: { hunger: number; durst: number }; coreC: number } };
    expect(data.entity).toBe(makeEntity(0, 0));
    expect(data.vitals.stamina).toBeLessThan(100);
    expect([data.vitals.satietyStage, data.vitals.thirstStage]).toEqual(['verhungernd', 'verdurstend']);
    expect(data.vitals.pendingDamage.hunger).toBeGreaterThan(0);
    expect(data.vitals.pendingDamage.durst).toBeGreaterThan(0);
    expect(data.vitals.coreC).not.toBe(37);
  });

  it('a world without player has no vitals', () => {
    const sim = createSimulation(CONFIG);
    expect(sim.participant('vitals').serialize()).toEqual({ entity: NULL_ENTITY, vitals: null });
  });

  it('rejects malformed snapshots', () => {
    const p = createSimulation(CONFIG).participant('vitals');
    expect(() => p.deserialize({ entity: 0, vitals: null })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 0, vitals: { health: 5 } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: NULL_ENTITY })).toThrow(TypeError);
  });
});
