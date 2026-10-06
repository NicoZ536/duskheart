/**
 * Test support for the world event tests (ereignisse, ereignisse-lumenregen, blitze, waldbrand and the roundtrip of
 * `world-events`; strand B, M7-38 … M7-40): the storage test world of lager-testwelt.ts (hand-drawn chunks, the player's
 * life, building, gathering with the drawn trees, the fire simulation with a test climate, the calendar) plus the world
 * events system wired as in `createSimulation`, on a `WorldEventsWorld` the test sets: one weather region, its weather and
 * period, every drawn tile active; shards and meteorites land on open, dry drawn tiles. The calendar's daylight modifier is
 * the system's eclipse, as in the game.
 */
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import type { WeatherStateId } from '../../../src/content/weather';
import type { ItemStack } from '../../../src/game/items/stack';
import type { Simulation } from '../../../src/game/sim';
import { WorldEventsSystem, type WorldEventsWorld } from '../../../src/game/worldevents/system';
import type { WorldEventDef } from '../../../src/content/worldEvents/schema';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from './lager-testwelt';
import { OFFSET } from './spieler-testwelt';

export { OFFSET };

/** The weather of the drawn world's one region. */
export interface TestWeather {
  state: WeatherStateId;
  /** Start and end of the current period [absolute game minutes]. */
  start: number;
  end: number;
  biome: string;
}

/** The world of a world event test. */
export interface EreignisWelt extends LagerWelt {
  readonly events: WorldEventsSystem;
  readonly weather: TestWeather;
  /** Drops the world events let fall (shards, star ore). */
  readonly fallen: Array<{ stack: ItemStack; x: number; y: number }>;
  /** Jumps the clock to game minute `minute` of the day (forward, to the next such minute) and runs one world tick. */
  jumpTo(hour: number, minute?: number): Map<string, unknown[]>;
  /** Runs `seconds` world ticks; returns all events by type. */
  seconds(n: number): Map<string, unknown[]>;
  /** The object id on drawn tile (x, y), or null. */
  objectAt(x: number, y: number): string | null;
  /** The `commandRejected` reasons of an event map. */
  rejections(events: Map<string, unknown[]>): string[];
}

/** A world event test world on `rows` (default: a meadow of 40 × 30 tiles), the player on drawn tile `spawn`. */
export function ereignisWelt(rows: readonly string[] = Array.from({ length: 30 }, () => '.'.repeat(40)), spawn = { x: 20, y: 15 }, options: { seed?: number; events?: readonly WorldEventDef[] } = {}): EreignisWelt {
  const w = lagerWelt(rows, spawn, options.seed ?? 1);
  const ids = contentWorldIdTables();
  const weather: TestWeather = { state: 'klar', start: 0, end: 1e9, biome: 'gruenhain' };
  const fallen: EreignisWelt['fallen'] = [];
  const objectAt = (_s: Simulation, tx: number, ty: number): string | null => {
    const chunk = w.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    const o = chunk === undefined ? 0 : (chunk.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
    return o === 0 ? null : ids.objects.stringId(o);
  };
  const inside = (tx: number, ty: number): boolean => tx >= OFFSET && ty >= OFFSET && tx < OFFSET + (rows[0]?.length ?? 0) && ty < OFFSET + rows.length;
  const world: WorldEventsWorld = {
    regionAt: (_s, tx, ty) => (inside(tx, ty) ? 0 : -1),
    weather: (_s, region) => (region === 0 ? weather.state : null),
    periodStart: () => weather.start,
    periodEnd: () => weather.end,
    active: (_s, tx, ty) => inside(tx, ty),
    landsOn: (s, tx, ty) => {
      if (!inside(tx, ty)) return false;
      const chunk = w.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
      return chunk !== undefined && chunk.water[i] === 0 && objectAt(s, tx, ty) === null;
    },
    regionBiome: () => weather.biome,
  };
  const events = w.sim.addSystem(
    new WorldEventsSystem({
      calendar: w.calendar,
      player: w.player,
      catalog: w.inventory.bags.catalog,
      spill: (_s, stack, _layer, x, y) => {
        fallen.push({ stack, x, y });
      },
      gathering: w.gathering,
      building: w.building,
      fire: w.feuer,
      vitals: w.vitals,
      objectAt,
      world,
      ...(options.events === undefined ? {} : { events: options.events }),
    }),
  );
  w.calendar.addDaylightModifier((minute) => events.daylightFactor(minute));
  const ticksPerMinute = w.sim.clock.ticksPerGameMinute;
  const e: EreignisWelt = Object.assign(w, {
    events,
    weather,
    fallen,
    jumpTo(hour: number, minute = 0): Map<string, unknown[]> {
      const target = hour * 60 + minute;
      const now = w.sim.clock.minuteOfDay;
      const ahead = (target - now + 1440) % 1440 || 1440;
      w.sim.skipTicks(ahead * ticksPerMinute - (w.sim.tick % ticksPerMinute) - 1);
      return w.run(w.sim.clock.worldTickInterval);
    },
    seconds(n: number): Map<string, unknown[]> {
      return w.run(n * w.sim.clock.worldTickInterval);
    },
    objectAt(x: number, y: number): string | null {
      return objectAt(w.sim, OFFSET + x, OFFSET + y);
    },
    rejections(map: Map<string, unknown[]>): string[] {
      return ((map.get('commandRejected') ?? []) as { reason: string }[]).map((r) => r.reason);
    },
  });
  return e;
}
