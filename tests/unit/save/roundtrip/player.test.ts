/**
 * Save roundtrip of the participant `player` (M3-08): the player entity and its body – movement mode,
 * input, roll, cliff transit, swimming – survive save → load, and a loaded player keeps moving exactly
 * like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY, makeEntity } from '../../../../src/engine/ecs';
import type { PlayerSystem } from '../../../../src/game/player/system';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';

const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    sim.events.clear();
  }
}

describe('save roundtrip: player', () => {
  it('restores the player entity and its moving body', () => {
    const report = expectRoundtrip(
      () => createSimulation(CONFIG),
      (sim) => {
        sim.step([{ type: 'player.spawn' }]);
        sim.step([
          { type: 'player.move', dx: 0.6, dy: -0.8 },
          { type: 'player.sprint', on: true },
        ]);
        run(sim, 10);
        sim.step([{ type: 'player.roll', dx: 1, dy: 0 }]);
      },
      (sim) => sim.participant('player'),
    );
    expect(report.id).toBe('player');
    const data = JSON.parse(report.canonical) as { entity: number; body: { state: string; rollTicks: number; sprintHeld: boolean; inputX: number } };
    expect(data.entity).toBe(makeEntity(0, 0));
    expect(data.body.state).toBe('roll');
    expect(data.body.rollTicks).toBeGreaterThan(0);
    expect(data.body.sprintHeld).toBe(true);
    expect(data.body.inputX).toBeCloseTo(0.6, 10);
  });

  it('a world without player saves none, and loading it removes a player', () => {
    const a = createSimulation(CONFIG);
    expect(a.participant('player').serialize()).toEqual({ entity: NULL_ENTITY, body: null });
    const b = createSimulation(CONFIG);
    b.step([{ type: 'player.spawn' }]);
    b.participant('player').deserialize(a.participant('player').serialize());
    expect(b.player).toBe(NULL_ENTITY);
    expect((b.system('player') as PlayerSystem).body(b)).toBeUndefined();
  });

  it('rejects malformed snapshots', () => {
    const sim = createSimulation(CONFIG);
    const p = sim.participant('player');
    expect(() => p.deserialize({ entity: 0 })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: NULL_ENTITY, body: { layer: 0 } })).toThrow(TypeError);
    expect(() => p.deserialize({ entity: 1.5, body: null })).toThrow(TypeError);
  });

  it('save → load → continue reaches the same state as running on', () => {
    const a = createSimulation(CONFIG);
    a.step([{ type: 'player.spawn' }]);
    a.step([{ type: 'player.move', dx: -1, dy: 0.5 }]);
    run(a, 30);
    const b = createSimulation(CONFIG);
    for (const p of a.participants()) b.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.hashState()).toBe(a.hashState());
    for (const sim of [a, b]) {
      sim.step([{ type: 'player.move', dx: 0, dy: 1 }, { type: 'player.sneak', on: true }]);
      run(sim, 45);
    }
    expect(b.hashState()).toBe(a.hashState());
    const pa = { x: 0, y: 0 };
    const pb = { x: 0, y: 0 };
    (a.system('player') as PlayerSystem).position(a, pa);
    (b.system('player') as PlayerSystem).position(b, pb);
    expect(pb).toEqual(pa);
  });
});
