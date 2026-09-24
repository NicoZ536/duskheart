import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { TILE_PX } from '../../../../src/world/model/coords';
import { ActiveZone } from '../../../../src/world/stream/activeZone';
import { CatchUpRegistry } from '../../../../src/world/stream/catchUp';
import { fixtureManager } from '../../world/streamFixture';

/** Zone over the fixture world with a settable clock (no chunk-bound systems). */
function freshZone(): { zone: ActiveZone; clock: { tick: number } } {
  const clock = { tick: 0 };
  const zone = new ActiveZone({ chunks: fixtureManager().manager, catchUp: new CatchUpRegistry().seal([]), tick: () => clock.tick });
  return { zone, clock };
}

describe('save roundtrip: world-chunks', () => {
  it('restores the frozen ticks of visited chunks, active chunks frozen at the save tick', () => {
    const report = expectRoundtrip(
      freshZone,
      ({ zone, clock }) => {
        clock.tick = 100;
        zone.update(0, 10, 10);
        clock.tick = 5_000;
        zone.update(0, 20, 12);
        clock.tick = 9_000;
        zone.update(-2, 20, 12);
        clock.tick = 12_345;
      },
      (s) => s.zone.save,
    );
    expect(report.id).toBe('world-chunks');
    expect(report.transports).toEqual(['structuredClone', 'json']);
  });

  it('a restored zone starts empty and catches chunks up from their saved ticks', () => {
    const source = freshZone();
    source.clock.tick = 50;
    source.zone.update(0, 4, 4);
    source.clock.tick = 900;
    source.zone.update(0, 12, 4);
    const data = JSON.parse(JSON.stringify(source.zone.save.serialize())) as unknown;

    const calls: string[] = [];
    const clock = { tick: 900 };
    const target = new ActiveZone({
      chunks: fixtureManager().manager,
      catchUp: new CatchUpRegistry().register('probe', (chunk, from, to) => calls.push(`${chunk.key} ${from}→${to}`)).seal([{ id: 'probe', update: () => undefined }]),
      tick: () => clock.tick,
    });
    target.save.deserialize(data);
    expect(target.size).toBe(0);
    clock.tick = 1_000;
    target.update(0, 4, 5);
    expect(calls).toHaveLength(25);
    expect(calls).toContain('0:4:4 900→1000'); // frozen when the player moved on at tick 900
    expect(calls).toContain('0:6:3 900→1000'); // same for the zone's edge
    expect(calls).toContain('0:4:7 0→1000'); // never active: frozen since world creation
  });

  it('roundtrips through the simulation: the zone around the controlled entity, hysteresis ring included', () => {
    const config = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;
    const report = expectRoundtrip(
      () => createSimulation(config),
      (sim) => {
        const { spawn } = sim.world.generated;
        sim.step([{ type: 'spawnDebugMover', x: spawn.x * TILE_PX, y: spawn.y * TILE_PX, controlled: true }]);
        // Walk east across a chunk border: the zone keeps its hysteresis ring.
        sim.step([{ type: 'move', dx: 1, dy: 0 }]);
        for (let i = 0; i < 480; i++) sim.step();
      },
      (sim) => sim.participant('world-chunks'),
    );
    const data = JSON.parse(report.canonical) as { frozen: number[]; active: number[] };
    expect(data.active.length / 3).toBe(30);
  });
});
