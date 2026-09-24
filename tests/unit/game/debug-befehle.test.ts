/**
 * Debug world commands of the console (M2-29; src/game/commands.ts, src/game/world.ts,
 * src/game/systems/motion.ts): `teleport` moves the controlled entity and the active zone to another
 * spot and layer, `setTime`/`advanceTime`/`setSeason` jump the clock forward (global systems get the
 * daily ticks, the frozen zone catches up analytically), `setWeather` forces a region's weather.
 * Everything is a command: replays and save → load → continue reproduce the same `hashState()`.
 */
import { describe, expect, it } from 'vitest';
import { CommandRecorder, ReplayPlayer } from '../../../src/engine/commands';
import type { GameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { MotionSystem } from '../../../src/game/systems/motion';
import { TILE_PX, tileToChunk } from '../../../src/world/model/coords';

const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;
const TIMEOUT_MS = 30_000;

type Drained = Array<[keyof SimEventMap, unknown]>;

function step(sim: Simulation, commands: GameCommand[] = []): Drained {
  sim.step(commands);
  const out: Drained = [];
  sim.events.drain((type, payload) => out.push([type, payload]));
  return out;
}

function hhmm(sim: Simulation): string {
  const { hour, minute } = sim.clock;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function centre(t: number): number {
  return t * TILE_PX + TILE_PX / 2;
}

describe('debug world commands', () => {
  it(
    'teleport moves the controlled entity and the active zone, also onto a cave layer',
    () => {
      const sim = createSimulation(CONFIG);
      const { spawn, underground } = sim.world.generated;
      step(sim, [{ type: 'spawnDebugMover', x: centre(spawn.x), y: centre(spawn.y), controlled: true }]);
      expect(sim.world.zone.layer).toBe(0);
      // A way up of layer −1 is open floor there.
      const link = underground.links.find((l) => l.kind === 'eingang');
      expect(link).toBeDefined();
      const tx = link?.tx ?? 0;
      const ty = link?.ty ?? 0;
      step(sim, [{ type: 'teleport', x: centre(tx), y: centre(ty), layer: -1 }]);
      const motion = sim.system('motion') as MotionSystem;
      expect(motion.controlledLayer).toBe(-1);
      expect(motion.position.get(motion.controlled, 'x')).toBe(centre(tx));
      expect(sim.world.zone.layer).toBe(-1);
      expect(sim.world.zone.isActive(-1, tileToChunk(tx), tileToChunk(ty))).toBe(true);
      expect(sim.world.zone.isTileActive(0, spawn.x, spawn.y)).toBe(false);
      // Outside the world, or without a controlled entity: rejected.
      const rejected = step(sim, [{ type: 'teleport', x: -5, y: 10, layer: 0 }]);
      expect(rejected).toContainEqual(['commandRejected', { type: 'teleport', reason: 'outOfBounds', tick: sim.tick - 1 }]);
      const fresh = createSimulation(CONFIG);
      expect(step(fresh, [{ type: 'teleport', x: 10, y: 10, layer: 0 }])).toContainEqual(['commandRejected', { type: 'teleport', reason: 'noControlledEntity', tick: 0 }]);
    },
    TIMEOUT_MS,
  );

  it('setTime jumps forward to the next occurrence; crossed dawns raise daily ticks', () => {
    const sim = createSimulation(CONFIG);
    expect(hhmm(sim)).toBe('06:00');
    step(sim, [{ type: 'setTime', hour: 18, minute: 30 }]);
    expect(hhmm(sim)).toBe('18:30');
    expect(sim.clock.day).toBe(1);
    // The same time again is the next day's 18:30 – one 06:00 crossed.
    const events = step(sim, [{ type: 'setTime', hour: 18, minute: 30 }]);
    expect(hhmm(sim)).toBe('18:30');
    expect(sim.clock.day).toBe(2);
    expect(events.filter(([t]) => t === 'dailyTick')).toEqual([['dailyTick', { day: 2, tick: sim.tick - 1 }]]);
    // Past midnight into the early morning: the day number changes at midnight.
    step(sim, [{ type: 'setTime', hour: 2, minute: 0 }]);
    expect([hhmm(sim), sim.clock.day]).toEqual(['02:00', 3]);
    step(sim, [{ type: 'advanceTime', minutes: 90 }]);
    expect(hhmm(sim)).toBe('03:30');
  });

  it('setSeason jumps to 06:00 of the first day of the next season of that kind', () => {
    const sim = createSimulation(CONFIG);
    step(sim, [{ type: 'setSeason', season: 'sommer' }]);
    const cal = sim.world.calendar;
    expect([cal.season, cal.dayOfSeason, hhmm(sim), sim.clock.day]).toEqual(['sommer', 1, '06:00', 8]);
    // Spring again: the next year (4 seasons × 7 days after day 1).
    step(sim, [{ type: 'setSeason', season: 'fruehling' }]);
    expect([cal.season, cal.dayOfSeason, cal.year, sim.clock.day]).toEqual(['fruehling', 1, 2, 29]);
    step(sim, [{ type: 'setSeason', season: 'winter' }]);
    expect([cal.season, cal.dayOfSeason, sim.clock.day]).toEqual(['winter', 1, 50]);
  });

  it(
    'setWeather forces the weather of the region under a tile, or of every region; at sea it is rejected',
    () => {
      const sim = createSimulation(CONFIG);
      const { spawn } = sim.world.generated;
      const region = sim.world.regionAt(spawn.x, spawn.y);
      expect(region).toBeGreaterThanOrEqual(0);
      step(sim, [{ type: 'setWeather', state: 'gewitter', tx: spawn.x, ty: spawn.y }]);
      expect(sim.world.weather.state(region)).toBe('gewitter');
      step(sim, [{ type: 'setWeather', state: 'nebel' }]);
      for (let r = 0; r < sim.world.weather.regionCount; r++) expect(sim.world.weather.state(r)).toBe('nebel');
      // The world's corner is open sea.
      expect(step(sim, [{ type: 'setWeather', state: 'klar', tx: 0, ty: 0 }])).toContainEqual(['commandRejected', { type: 'setWeather', reason: 'noWeatherRegion', tick: sim.tick - 1 }]);
      expect(sim.world.weather.state(region)).toBe('nebel');
      // Weather sets the temperature: fog adds nothing, a thunderstorm −5 °C (§10) after its blend.
      step(sim, [{ type: 'setWeather', state: 'gewitter', tx: spawn.x, ty: spawn.y }]);
      step(sim, [{ type: 'advanceTime', minutes: 60 }]);
      expect(sim.world.weather.temperatureOffsetAt(region, sim.world.weather.nowMinute())).toBe(-5);
    },
    TIMEOUT_MS,
  );

  it(
    'debug commands replay to the same state, and save → load → continue after a jump matches',
    () => {
      const script = (sim: Simulation): Array<[number, GameCommand]> => {
        const { spawn } = sim.world.generated;
        return [
          [0, { type: 'spawnDebugMover', x: centre(spawn.x), y: centre(spawn.y), controlled: true }],
          [3, { type: 'setTime', hour: 21, minute: 15 }],
          [4, { type: 'teleport', x: centre(spawn.x + 40), y: centre(spawn.y - 40), layer: 0 }],
          [6, { type: 'setWeather', state: 'regen', tx: spawn.x, ty: spawn.y }],
          [8, { type: 'setSeason', season: 'herbst' }],
          [9, { type: 'advanceTime', minutes: 45 }],
        ];
      };
      const run = (ticks: number): { sim: Simulation; recorder: CommandRecorder<GameCommand> } => {
        const sim = createSimulation(CONFIG);
        const recorder = new CommandRecorder<GameCommand>();
        sim.commands.setSink(recorder);
        const cmds = script(sim);
        for (let t = 0; t < ticks; t++) {
          for (const [at, c] of cmds) if (at === t) sim.commands.push(c);
          step(sim);
        }
        return { sim, recorder };
      };
      const a = run(12);
      const replayed = createSimulation(CONFIG);
      const player = new ReplayPlayer(a.recorder);
      for (let t = 0; t < 12; t++) {
        player.feed(replayed.tick, replayed.commands);
        step(replayed);
      }
      expect(replayed.hashState()).toBe(a.sim.hashState());
      expect(a.sim.world.calendar.season).toBe('herbst');

      // Save after the jumps, load into a fresh simulation, continue both.
      const loaded = createSimulation(CONFIG);
      for (const p of a.sim.participants()) loaded.participant(p.id).deserialize(structuredClone(p.serialize()));
      for (let t = 0; t < 70; t++) {
        step(a.sim);
        step(loaded);
      }
      expect(loaded.hashState()).toBe(a.sim.hashState());
    },
    TIMEOUT_MS,
  );
});
