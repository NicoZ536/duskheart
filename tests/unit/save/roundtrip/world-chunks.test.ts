import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { TILE_PX } from '../../../../src/world/model/coords';
import { ActiveZone, type ZoneListener } from '../../../../src/world/stream/activeZone';
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

  it('a restored zone starts empty; its saved active chunks come back caught up from their saved ticks before the zone moves on', () => {
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
    expect(target.resuming).toBe(25);
    clock.tick = 1_000;
    target.update(0, 4, 5);
    // The 25 chunks active at the save come back first (caught up from the save tick, as if they had ticked on), then
    // freeze beyond radius + hysteresis like those of a zone the player left; the 25 around the player activate.
    expect(calls).toHaveLength(50);
    expect(calls).toContain('0:12:4 900→1000'); // active at the save
    expect(calls).toContain('0:4:4 900→1000'); // frozen when the player moved on at tick 900
    expect(calls).toContain('0:6:3 900→1000'); // same for the zone's edge
    expect(calls).toContain('0:4:7 0→1000'); // never active: frozen since world creation
    expect(target.size).toBe(25);
    expect(target.isActive(0, 12, 4)).toBe(false);
    expect(target.resuming).toBe(0);
  });

  it('resumeSaved: exactly the saved active set before the first tick, unheard by the listeners; then the zone moves like the uninterrupted one', () => {
    const heard = (log: string[]): ZoneListener => ({
      onActivate: (chunk, tick) => log.push(`+${chunk.key}@${tick}`),
      onDeactivate: (chunk, tick) => log.push(`-${chunk.key}@${tick}`),
    });
    const source = freshZone();
    source.clock.tick = 50;
    source.zone.update(0, 4, 4);
    source.clock.tick = 900;
    // One chunk east: the hysteresis ring keeps the western column (30 active chunks).
    source.zone.update(0, 5, 4);
    expect(source.zone.size).toBe(30);
    const data = JSON.parse(JSON.stringify(source.zone.save.serialize())) as unknown;

    const calls: string[] = [];
    const clock = { tick: 900 };
    const target = new ActiveZone({
      chunks: fixtureManager().manager,
      catchUp: new CatchUpRegistry().register('probe', (chunk, from, to) => calls.push(`${chunk.key} ${from}→${to}`)).seal([{ id: 'probe', update: () => undefined }]),
      tick: () => clock.tick,
    });
    const loadedLog: string[] = [];
    target.addListener(heard(loadedLog));
    target.save.deserialize(data);
    const versionBefore = target.version;
    expect(target.resumeSaved()).toBe(30);
    expect(target.resumeSaved()).toBe(0);
    expect(target.size).toBe(30);
    expect(target.layer).toBe(0);
    expect(target.isActive(0, 2, 4)).toBe(true);
    expect(target.isActive(0, 7, 6)).toBe(true);
    // Active at the save tick: nothing to catch up, and no listener hears chunks that never left the zone.
    expect(calls).toEqual([]);
    expect(loadedLog).toEqual([]);
    expect(target.version).toBeGreaterThan(versionBefore);
    // Same place in the next tick: nothing changes, as in the uninterrupted zone.
    clock.tick = 901;
    source.clock.tick = 901;
    expect(target.update(0, 5, 4)).toBe(0);
    expect(source.zone.update(0, 5, 4)).toBe(0);
    expect(loadedLog).toEqual([]);
    // The player goes on east: both freeze the western column and activate the next one, heard alike.
    const uninterruptedLog: string[] = [];
    source.zone.addListener(heard(uninterruptedLog));
    clock.tick = 902;
    source.clock.tick = 902;
    expect(target.update(0, 6, 4)).toBe(10);
    source.zone.update(0, 6, 4);
    expect(loadedLog).toEqual(uninterruptedLog);
    expect(loadedLog.filter((l) => l.startsWith('-'))).toHaveLength(5);
    expect(target.save.serialize()).toEqual(source.zone.save.serialize());
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
