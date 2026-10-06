/**
 * Beobachter eines Simulationsschritts (M7-01, docs/SPIEL.md §17 „Beobachter“, ADR-0207): `SimSystem.observeStep` sieht nach
 * `dailyTick` und `flushDestroyed` genau die Ereignisse des laufenden Schritts – in Registrierreihenfolge, einschließlich der
 * soeben von früheren Beobachtern geschobenen, nie die eigenen desselben Aufrufs –, nach den Morgengrauen von `skipTicks`
 * die bis dahin geschobenen und am Schrittende den Rest; Ereignisse älterer, nicht geleerter Schritte (headless leert
 * niemand) sieht kein Beobachter doppelt. Dazu `EventQueue.forEachFrom`: liefert ab einem Index, ohne zu entfernen, bis zur
 * Größe beim Aufruf.
 */
import { describe, expect, it } from 'vitest';
import { EventQueue } from '../../../src/engine/events';
import type { StepEvents } from '../../../src/game/observe';
import { Simulation, type SimEventMap, type SimSystem } from '../../../src/game/sim';

type Seen = { type: keyof SimEventMap; tick: number };

/** An observer that records every event of every call (`log`: one list per call) and which calls it got. */
class Recorder implements SimSystem {
  readonly log: Seen[][] = [];
  constructor(
    readonly id: string,
    private readonly calls: string[],
    private readonly push?: (sim: Simulation) => void,
  ) {}

  observeStep(sim: Simulation, events: StepEvents): void {
    this.calls.push(this.id);
    const seen: Seen[] = [];
    events.forEach((type, payload) => {
      seen.push({ type, tick: (payload as { tick: number }).tick });
    });
    expect(events.count).toBe(seen.length);
    this.log.push(seen);
    this.push?.(sim);
  }
}

/** A system that pushes one `entitySpawned` per tick in `update` (a stand-in for any game event). */
function pusher(): SimSystem {
  return {
    id: 'schieber',
    timeScope: 'global',
    update: (sim) => sim.events.push('entitySpawned', { entity: 1, tick: sim.eventTick }),
  };
}

function sim(): Simulation {
  return new Simulation({ seed: 1, dayLengthMinutes: 24 });
}

describe('EventQueue.forEachFrom', () => {
  it('liefert ab dem Index in Schiebereihenfolge, entfernt nichts, endet bei der Größe des Aufrufs', () => {
    type M = { a: { n: number }; b: { n: number } };
    const q = new EventQueue<M>();
    q.push('a', { n: 0 });
    q.push('b', { n: 1 });
    q.push('a', { n: 2 });
    const got: string[] = [];
    q.forEachFrom(1, (type, p) => {
      got.push(`${type}${p.n}`);
      // Pushed during the call: not delivered by it.
      q.push('b', { n: 9 });
    });
    expect(got).toEqual(['b1', 'a2']);
    expect(q.size).toBe(5);
    const all: number[] = [];
    q.forEachFrom(-3, (_t, p) => all.push(p.n));
    expect(all).toEqual([0, 1, 2, 9, 9]);
    const none: number[] = [];
    q.forEachFrom(5, (_t, p) => none.push(p.n));
    q.forEachFrom(99, (_t, p) => none.push(p.n));
    expect(none).toEqual([]);
    const typed: number[] = [];
    q.forEachOfTypeFrom(2, 'b', (p) => typed.push(p.n));
    expect(typed).toEqual([9, 9]);
    // After a drain the indices count from the new buffer.
    q.drain(() => undefined);
    q.push('a', { n: 7 });
    const fresh: number[] = [];
    q.forEachFrom(0, (_t, p) => fresh.push(p.n));
    expect(fresh).toEqual([7]);
  });
});

describe('Simulation: observeStep (M7-01, ADR-0207)', () => {
  it('Beobachter laufen nach dailyTick und flushDestroyed in Registrierreihenfolge; Systeme ohne Haken nicht', () => {
    const s = sim();
    const calls: string[] = [];
    const order: string[] = [];
    s.addSystem({ id: 'vorher', timeScope: 'global', update: () => order.push('update'), dailyTick: () => order.push('daily') });
    s.addSystem(pusher());
    const a = s.addSystem(new Recorder('a', calls));
    const b = s.addSystem(new Recorder('b', calls));
    // The despawn of an entity destroyed in this step is flushed before the observers see the step.
    const e = s.ecs.create();
    s.step([{ type: 'despawn', entity: e }]);
    expect(calls).toEqual(['a', 'b']);
    expect(a.log[0]?.map((x) => x.type)).toEqual(['entitySpawned', 'entityDespawned']);
    expect(b.log[0]).toEqual(a.log[0]);
    // The step that reaches 06:00: the observers see its daily tick, after the systems' daily ticks ran.
    s.skipTicks(s.clock.ticksPerDay - s.clock.dayTick - 1);
    order.length = 0;
    s.step();
    expect(a.log.at(-1)?.map((x) => x.type)).toEqual(['entitySpawned', 'worldTick', 'dailyTick']);
    expect(order).toEqual(['update', 'daily']);
    expect(calls.slice(-2)).toEqual(['a', 'b']);
  });

  it('ein früherer Beobachter schiebt im selben Schritt – spätere sehen es, er selbst und frühere nicht', () => {
    const s = sim();
    const calls: string[] = [];
    s.addSystem(pusher());
    const first = s.addSystem(new Recorder('erster', calls));
    const middle = s.addSystem(new Recorder('mitte', calls, (x) => x.events.push('commandRejected', { type: 'despawn', reason: 'deadEntity', tick: x.eventTick })));
    const last = s.addSystem(new Recorder('letzter', calls));
    s.step();
    s.step();
    for (let step = 0; step < 2; step++) {
      expect(first.log[step]?.map((x) => x.type)).toEqual(['entitySpawned']);
      expect(middle.log[step]?.map((x) => x.type)).toEqual(['entitySpawned']);
      expect(last.log[step]?.map((x) => x.type)).toEqual(['entitySpawned', 'commandRejected']);
    }
    // Nobody saw an event of the other step: the pushes of the middle one are not seen again.
    expect(last.log.flat().map((x) => x.tick)).toEqual([0, 0, 1, 1]);
  });

  it('headless ohne Leeren: jeder Schritt nur seine Ereignisse, nichts doppelt; Ereignisse außerhalb eines Schritts sieht niemand', () => {
    const s = sim();
    s.addSystem(pusher());
    const r = s.addSystem(new Recorder('r', []));
    for (let i = 0; i < 5; i++) s.step();
    // Pushed between two steps (by no step): no observer counts it.
    s.events.push('entitySpawned', { entity: 2, tick: -7 });
    s.step();
    expect(s.events.size).toBeGreaterThanOrEqual(7);
    expect(r.log.map((l) => l.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(r.log.flat().map((x) => x.tick)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('skipTicks außerhalb eines Schritts: die Beobachter sehen die Morgengrauen des Sprungs genau einmal', () => {
    const s = sim();
    s.addSystem(pusher());
    const r = s.addSystem(new Recorder('r', []));
    s.step();
    s.skipTicks(3 * s.clock.ticksPerDay);
    expect(r.log.map((l) => l.map((x) => x.type))).toEqual([['entitySpawned'], ['dailyTick', 'dailyTick', 'dailyTick']]);
    s.step();
    expect(r.log.at(-1)?.map((x) => x.type)).toEqual(['entitySpawned']);
    // Nothing of the jump came back.
    expect(r.log.flat().filter((x) => x.type === 'dailyTick')).toHaveLength(3);
  });

  it('skipTicks in einem Schritt: nach den Morgengrauen alles bis dahin, am Schrittende nur der Rest', () => {
    const s = sim();
    const jumpAt = 2;
    s.addSystem({
      id: 'springer',
      timeScope: 'global',
      update: (x) => {
        x.events.push('entitySpawned', { entity: 1, tick: x.eventTick });
        if (x.eventTick === jumpAt) x.skipTicks(2 * x.clock.ticksPerDay);
        x.events.push('entityDespawned', { entity: 1, tick: x.eventTick });
      },
    });
    const r = s.addSystem(new Recorder('r', []));
    for (let i = 0; i <= jumpAt; i++) s.step();
    const types = r.log.map((l) => l.map((x) => x.type));
    expect(types).toEqual([
      ['entitySpawned', 'entityDespawned'],
      ['entitySpawned', 'entityDespawned'],
      // Inside the jump's step: what the step pushed before the jump and the two dawns …
      ['entitySpawned', 'dailyTick', 'dailyTick'],
      // … and at its end the rest.
      ['entityDespawned'],
    ]);
  });

  it('Beobachter ohne eigene Ereignisse kosten nichts: die Sicht ist ein gehaltener Datensatz', () => {
    const s = sim();
    const views = new Set<StepEvents>();
    s.addSystem({ id: 'sicht', observeStep: (_x, ev) => views.add(ev) });
    for (let i = 0; i < 3; i++) s.step();
    s.skipTicks(s.clock.ticksPerDay);
    expect(views.size).toBe(1);
  });
});
