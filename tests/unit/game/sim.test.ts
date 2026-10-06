import { describe, expect, it } from 'vitest';
import { makeEntity } from '../../../src/engine/ecs';
import type { EventArgs } from '../../../src/engine/events';
import { GAME_COMMAND_TYPES } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import { Simulation, resolveSimConfig, type SimEventMap, type SimSystem } from '../../../src/game/sim';
import { systemOrderViolation } from '../../../src/game/systemOrder';
import { laterCommandsOutsideM7, M6_COMMAND_TYPES, M6_PARTICIPANTS, M6_SYSTEMS, M7_SYSTEMS, ofM6, S27_NEW_PARTICIPANTS, sinceM6 } from './sim-stand';

function drain(sim: Simulation): Array<EventArgs<SimEventMap>> {
  const out: Array<EventArgs<SimEventMap>> = [];
  sim.events.drain((...e) => out.push(e));
  return out;
}

describe('resolveSimConfig', () => {
  it('fills defaults from BALANCE and normalizes the seed', () => {
    expect(resolveSimConfig({ seed: 7 })).toEqual({ seed: 7, worldSize: 'medium', dayLengthMinutes: 24 });
    expect(resolveSimConfig({ seed: -1 }).seed).toBe(0xffffffff);
    expect(resolveSimConfig({ seed: 1, worldSize: 'small', dayLengthMinutes: 12 })).toEqual({ seed: 1, worldSize: 'small', dayLengthMinutes: 12 });
    expect(Object.isFrozen(resolveSimConfig({ seed: 1 }))).toBe(true);
  });

  it('rejects invalid config', () => {
    expect(() => resolveSimConfig({ seed: 1.5 })).toThrow(RangeError);
    expect(() => resolveSimConfig({ seed: 1, dayLengthMinutes: 20 as 24 })).toThrow(TypeError);
    expect(() => resolveSimConfig({ seed: 1, worldSize: 'huge' as 'small' })).toThrow(TypeError);
  });
});

describe('Simulation', () => {
  it('owns config, rng, ecs, clock, events and systems', () => {
    const sim = createSimulation({ seed: 42 });
    expect(sim.config.seed).toBe(42);
    expect(sim.rng.seed).toBe(42);
    expect(sim.tick).toBe(0);
    expect(sim.clock.hour).toBe(6);
    expect(sim.dt).toBeCloseTo(1 / 60, 15);
    // Fixed order of createSimulation (src/game/setup.ts, docs/ARCHITEKTUR.md "Simulation"); M4 adds stations and repair after
    // light, then building, rooms, storage, hearth and fire; M6 the fight (combat), the creatures, traps and the bestiary before
    // the player's life systems. The systems of M6 stay exactly these, in this order (tests/unit/game/sim-stand.ts, ADR-0208);
    // every later one is a system M7 adds to SYSTEM_ORDER (docs/SPIEL.md §16) at its place there.
    const systems = sim.systems.map((s) => s.id);
    expect(ofM6(systems, M6_SYSTEMS)).toEqual(M6_SYSTEMS);
    expect(sinceM6(systems, M6_SYSTEMS).filter((id) => !M7_SYSTEMS.has(id))).toEqual([]);
    expect(systemOrderViolation(systems)).toBeNull();
    // Repair and rooms keep no state of their own (rooms are derived from the buildings). The participants of M6 stay exactly
    // these, in this order; every later one is the participant of an M7 system (§16 "System-Id = Teilnehmer") listed as new in
    // docs/SPIEL.md §27 at its data version, in the order of the systems.
    const participants = sim.participants();
    const ids = participants.map((p) => p.id);
    expect(ofM6(ids, M6_PARTICIPANTS)).toEqual(M6_PARTICIPANTS);
    expect(ids.slice(0, 3)).toEqual(['clock', 'rng', 'ecs']);
    expect(systemOrderViolation(ids.slice(3))).toBeNull();
    const later = participants.filter((p) => !M6_PARTICIPANTS.includes(p.id));
    expect(later.filter((p) => !M7_SYSTEMS.has(p.id) || S27_NEW_PARTICIPANTS.get(p.id) !== p.version).map((p) => `${p.id} ${p.version}`)).toEqual([]);
    expect(sim.unhandledCommandTypes()).toEqual([]);
    // The commands of M6 come first, exactly these in this order; every later one is handled by a system M7 adds to
    // SYSTEM_ORDER (no duplicates).
    expect(GAME_COMMAND_TYPES.slice(0, M6_COMMAND_TYPES.length)).toEqual(M6_COMMAND_TYPES);
    expect(new Set(GAME_COMMAND_TYPES).size).toBe(GAME_COMMAND_TYPES.length);
    expect(laterCommandsOutsideM7(sim, GAME_COMMAND_TYPES)).toEqual([]);
  });

  it('runs the tick phases in the documented order', () => {
    const sim = new Simulation({ seed: 1, dayLengthMinutes: 12 });
    const log: string[] = [];
    const system: SimSystem = {
      id: 'probe',
      commands: {
        spawnDebugMover: (_s, _cmd, tick) => log.push(`cmd@${tick}`),
      },
      update: (s) => log.push(`update@${s.tick}`),
      worldTick: (s) => log.push(`world@${s.tick}`),
      dailyTick: (s, day) => log.push(`daily@${s.tick}:day${day}`),
    };
    sim.addSystem(system);
    sim.ecs.onDestroy((e) => log.push(`destroy:${e}`));
    const doomed = sim.ecs.create();
    sim.clock.setTick(sim.clock.ticksPerDay - 1);
    sim.ecs.queueDestroy(doomed);
    sim.step([{ type: 'spawnDebugMover', x: 0, y: 0 }]);
    const t = sim.clock.ticksPerDay;
    expect(log).toEqual([`cmd@${t - 1}`, `update@${t - 1}`, `world@${t}`, `daily@${t}:day2`, `destroy:${doomed}`]);
    expect(sim.tick).toBe(t);
    const events = drain(sim);
    expect(events).toEqual([
      ['worldTick', { tick: t - 1 }],
      ['dailyTick', { day: 2, tick: t - 1 }],
      ['entityDespawned', { entity: doomed, tick: t - 1 }],
    ]);
  });

  it('fires worldTick every 60 ticks and dailyTick once per day', () => {
    const sim = new Simulation({ seed: 1, dayLengthMinutes: 12 });
    let world = 0;
    const days: number[] = [];
    sim.addSystem({ id: 'probe', worldTick: () => world++, dailyTick: (_s, d) => days.push(d) });
    const ticks = sim.clock.ticksPerDay * 2;
    for (let i = 0; i < ticks; i++) {
      sim.step();
      sim.events.clear();
    }
    expect(world).toBe(ticks / 60);
    expect(days).toEqual([2, 3]);
  });

  it('applies queued commands in FIFO order before explicit ones and records them', () => {
    const sim = new Simulation({ seed: 1 });
    const seen: string[] = [];
    sim.onCommand('move', (_s, cmd) => seen.push(`move ${cmd.dx},${cmd.dy}`));
    sim.onCommand('spawnDebugMover', (_s, cmd) => seen.push(`spawn ${cmd.x}`));
    const recorded: Array<[number, string]> = [];
    sim.commands.setSink({ record: (tick, cmd) => recorded.push([tick, cmd.type]) });
    sim.commands.push({ type: 'move', dx: 1, dy: 0 });
    sim.step([{ type: 'spawnDebugMover', x: 5, y: 5 }]);
    sim.step();
    expect(seen).toEqual(['move 1,0', 'spawn 5']);
    expect(recorded).toEqual([
      [0, 'move'],
      [0, 'spawnDebugMover'],
    ]);
  });

  it('rejects duplicate systems, handlers and participants and missing handlers', () => {
    const sim = new Simulation({ seed: 1 });
    sim.addSystem({ id: 'a', commands: { move: () => undefined } });
    expect(() => sim.addSystem({ id: 'a' })).toThrow(/already registered/);
    expect(() => sim.addSystem({ id: 'b', commands: { move: () => undefined } })).toThrow(/already has a handler/);
    expect(() => sim.onCommand('despawn', () => undefined)).toThrow(/already has a handler/);
    expect(() => sim.addSystem({ id: 'c', save: { id: 'clock', version: 1, serialize: () => null, deserialize: () => undefined } })).toThrow(/already registered/);
    expect(() => sim.addSystem({ id: 'd', save: { id: 'Bad Id', version: 1, serialize: () => null, deserialize: () => undefined } })).toThrow(/kebab-case/);
    // A failed registration leaves no trace.
    expect(sim.systems.map((s) => s.id)).toEqual(['a']);
    // Every declared type but `move` (system `a`) and `despawn` (the simulation's own), in declaration order: the commands of M6
    // (tests/unit/game/sim-stand.ts) and after them every later one (ADR-0208).
    expect(sim.unhandledCommandTypes()).toEqual([...M6_COMMAND_TYPES.filter((t) => t !== 'move' && t !== 'despawn'), ...GAME_COMMAND_TYPES.slice(M6_COMMAND_TYPES.length)]);
    expect(() => sim.step([{ type: 'spawnDebugMover', x: 0, y: 0 }])).toThrow(/no handler registered for command "spawnDebugMover"/);
    expect(sim.system('a').id).toBe('a');
    expect(() => sim.system('zzz')).toThrow(/unknown system/);
    expect(() => sim.participant('zzz')).toThrow(/unknown save participant/);
  });

  it('despawns live entities at the end of the tick and rejects dead ones', () => {
    const sim = createSimulation({ seed: 3 });
    sim.step([{ type: 'spawnDebugMover', x: 10, y: 10 }]);
    const e = makeEntity(0, 0);
    expect(sim.ecs.alive(e)).toBe(true);
    drain(sim);
    sim.step([{ type: 'despawn', entity: e }]);
    expect(sim.ecs.alive(e)).toBe(false);
    sim.step([{ type: 'despawn', entity: e }]);
    expect(drain(sim)).toEqual([
      ['entityDespawned', { entity: e, tick: 1 }],
      ['commandRejected', { type: 'despawn', reason: 'deadEntity', tick: 2 }],
    ]);
  });

  it('hashState depends on the complete state and nothing else', () => {
    const a = createSimulation({ seed: 5 });
    const b = createSimulation({ seed: 5 });
    expect(a.hashState()).toMatch(/^[0-9a-f]{16}$/);
    expect(a.hashState()).toBe(b.hashState());
    a.step();
    expect(a.hashState()).not.toBe(b.hashState());
    b.step();
    expect(a.hashState()).toBe(b.hashState());
    // Draining or leaving events does not change the state hash.
    a.events.clear();
    expect(a.hashState()).toBe(b.hashState());
    // Looking up a random stream (debug inspectors) is not a state change; drawing from it is.
    a.rng.stream('probe');
    expect(a.hashState()).toBe(b.hashState());
    a.rng.stream('probe').nextU32();
    expect(a.hashState()).not.toBe(b.hashState());
    expect(createSimulation({ seed: 6 }).hashState()).not.toBe(createSimulation({ seed: 5 }).hashState());
    expect(createSimulation({ seed: 5, worldSize: 'small' }).hashState()).not.toBe(createSimulation({ seed: 5 }).hashState());
  });

  it('snapshot contains config and every participant with its version', () => {
    const sim = createSimulation({ seed: 9 });
    const snap = sim.snapshot();
    expect(snap.config).toBe(sim.config);
    // Every participant in its order: those of M6 exactly (tests/unit/game/sim-stand.ts, ADR-0208), the later ones between them.
    expect(Object.keys(snap.participants)).toEqual(sim.participants().map((p) => p.id));
    expect(ofM6(Object.keys(snap.participants), M6_PARTICIPANTS)).toEqual(M6_PARTICIPANTS);
    for (const p of sim.participants()) expect(snap.participants[p.id]?.version).toBe(p.version);
  });
});
