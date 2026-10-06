/**
 * Save roundtrip of the participant `world-events` (M7-38 … M7-40): the phase and run of every world event, the forced run of
 * the console, the minute lightning and the Lumen rain have drawn up to and whether the rain's meteorite fell survive
 * save → load; a loaded world continues the eclipse's darkness and the rain's shards exactly like the uninterrupted one.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import type { WorldEventsSnapshot } from '../../../../src/game/worldevents/state';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { ereignisWelt, type EreignisWelt } from '../../game/ereignisse-testwelt';

/** Noon with the eclipse running from the console, a few minutes in. */
function eclipse(w: EreignisWelt): void {
  w.jumpTo(12);
  w.run(1, [{ type: 'worldEvent.start', event: 'sonnenfinsternis' }]);
  w.seconds(10);
}

describe('save roundtrip: world-events', () => {
  it('restores phases, runs, forced runs and the drawn minute', () => {
    const report = expectRoundtrip(() => ereignisWelt(), eclipse, (w) => w.events.save);
    expect(report.id).toBe('world-events');
    const data = JSON.parse(report.canonical) as WorldEventsSnapshot;
    expect(data.events.find((e) => e.id === 'sonnenfinsternis')?.phase).toBe('aktiv');
    expect(data.forced.map((f) => f.event)).toEqual(['sonnenfinsternis']);
    expect(data.runStarts.sonnenfinsternis).toBeGreaterThan(0);
    expect(data.drawnMinute).toBeGreaterThan(0);
  });

  it('save → load → continue: the loaded day is as dark as the uninterrupted one and brightens on the same tick', () => {
    const a = ereignisWelt();
    eclipse(a);
    const b = ereignisWelt();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.calendar.daylight).toBe(a.calendar.daylight);
    expect(b.calendar.dayPhase).toBe('nacht');
    const ea = a.seconds(60).get('worldEventEnded') as { tick: number }[] | undefined;
    const eb = b.seconds(60).get('worldEventEnded') as { tick: number }[] | undefined;
    expect(ea).toHaveLength(1);
    expect(eb).toEqual(ea);
    expect(b.events.save.serialize()).toEqual(a.events.save.serialize());
  });

  it('the Lumen rain continues with the same shards after loading', () => {
    const rain = (w: EreignisWelt): void => {
      w.sim.skipTicks(w.sim.clock.ticksPerDay);
      w.jumpTo(23);
      w.run(1, [{ type: 'worldEvent.start', event: 'lumenregen' }]);
      w.seconds(10);
    };
    const a = ereignisWelt();
    rain(a);
    const b = ereignisWelt();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    const shards = (w: EreignisWelt): string =>
      ((w.seconds(30).get('lumenShardFell') ?? []) as { x: number; y: number }[]).map((s) => `${s.x},${s.y}`).join(' ');
    expect(shards(b)).toBe(shards(a));
  });

  it('the game simulation has the participant (every event at rest at the start)', () => {
    const data = createSimulation({ seed: 3 }).participant('world-events').serialize() as WorldEventsSnapshot;
    expect(data.events.map((e) => [e.id, e.phase])).toEqual([
      ['finstermond', 'ruhe'],
      ['lumenregen', 'ruhe'],
      ['sonnenfinsternis', 'ruhe'],
      ['waldbrand', 'ruhe'],
    ]);
    expect(data.forced).toEqual([]);
  });

  it('rejects malformed snapshots and unknown events, keeping the state it had', () => {
    const w = ereignisWelt();
    eclipse(w);
    const good = w.events.save.serialize() as WorldEventsSnapshot;
    const bad: unknown[] = [
      null,
      { ...good, events: [{ id: 'gibtsnicht', phase: 'ruhe', announceTick: -1, startTick: -1, endTick: -1 }] },
      { ...good, events: good.events.map((e) => ({ ...e, phase: 'aktiv', startTick: -1 })) },
      { ...good, runStarts: {} },
      { ...good, forced: [{ event: 'gibtsnicht', start: 1, end: 2 }] },
      { ...good, drawnMinute: -5 },
    ];
    for (const data of bad) expect(() => w.events.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.events.save.serialize()).toEqual(good);
  });
});
