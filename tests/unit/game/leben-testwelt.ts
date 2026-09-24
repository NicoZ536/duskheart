/**
 * Test support for the player's life systems (zustaende, furcht, schlaf, aktionen, tod, skills): the player
 * test world of spieler-testwelt.ts (hand-drawn chunks, controllable air and rain) plus bags, equipment and
 * the six life systems of `addPlayerLifeSystems`, with a controllable light, night flag and start beach,
 * and recorders for landed throws, seats and beds; last the `cheats` system of the console's cheats (its
 * switches are the test world's `cheats`).
 */
import { contentItemCatalog, type ItemCatalog } from '../../../src/game/items/catalog';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { InventorySystem } from '../../../src/game/inventory/system';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import { equipmentModifierSource } from '../../../src/game/equipment/modifiers';
import { addPlayerLifeSystems, type PlayerLife } from '../../../src/game/death/life';
import { CheatsSystem } from '../../../src/game/cheats/system';
import type { ItemStack } from '../../../src/game/items/stack';
import type { SleepPlace } from '../../../src/game/sleep/state';
import type { Seat } from '../../../src/game/actions/state';
import type { HeatSource } from '../../../src/game/survival/modifiers';
import { OFFSET, T, testEnvironment, testWorld, type TestEnvironment, type TestWorld } from './spieler-testwelt';

/** Environment of a life test: air and rain (vitals), light and night (fear). */
export interface LifeEnvironment extends TestEnvironment {
  light: number;
  night: boolean;
}

/** A landed throw handed to the drop system. */
export interface Landing {
  readonly stack: ItemStack;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

export interface LifeWorld extends TestWorld {
  readonly life: PlayerLife;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly env: LifeEnvironment;
  readonly landings: Landing[];
  /** Beds by `tx,ty` (map coordinates are added to OFFSET by `bed`). */
  readonly beds: Map<string, SleepPlace>;
  readonly seats: Map<string, Seat>;
  /** Heat sources (fires) around the player. */
  readonly fires: HeatSource[];
  /** Places a bed of `kind` on drawn tile (x, y). */
  bed(x: number, y: number, kind: SleepPlace['kind'], comfort?: number, bedroom?: boolean): SleepPlace;
  /** Places a seat on drawn tile (x, y). */
  seat(x: number, y: number): Seat;
  /** Lights a camp fire on drawn tile (x, y). */
  fire(x: number, y: number): void;
  /** Tile coordinates of drawn tile (x, y). */
  tile(x: number, y: number): { tx: number; ty: number };
  /** Jumps the clock to the next `hour`:00 (a debug time jump: `Simulation.skipTicks`). */
  jumpToHour(hour: number): void;
}

/** Hour of the daily tick (06:00). */
const DAWN_HOUR = 6;

/** A life test world on `rows`, daylight, 20 °C; `catalog` for fixture items (default: the game's items). */
export function lifeWorld(rows: readonly string[], seed = 1, catalog: ItemCatalog = contentItemCatalog()): LifeWorld {
  const base = testEnvironment();
  const env = base as LifeEnvironment;
  env.light = 1;
  env.night = false;
  const w = testWorld(rows, env, seed);
  const bags = new PlayerBags(catalog);
  const inventory = w.sim.addSystem(new InventorySystem(bags));
  const equipment = w.sim.addSystem(new EquipmentSystem(bags));
  w.influences.addModifierSource(equipmentModifierSource(equipment));
  const landings: Landing[] = [];
  const life = addPlayerLifeSystems(w.sim, {
    components: w.components,
    influences: w.influences,
    motion: w.motion,
    collision: w.collision,
    player: w.player,
    inventory,
    equipment,
    landing: (_sim, stack, layer, x, y) => landings.push({ stack, layer, x, y }),
    cheats: w.cheats,
    environment: {
      lightAt: () => env.light,
      night: () => env.night,
      beach: () => ({ tx: OFFSET + 1, ty: OFFSET + 1 }),
    },
  });
  w.sim.addSystem(new CheatsSystem({ cheats: w.cheats, skills: life.skills }));
  const beds = new Map<string, SleepPlace>();
  const seats = new Map<string, Seat>();
  const fires: HeatSource[] = [];
  life.sleep.addSleepPlaces((_sim, _layer, tx, ty) => beds.get(`${tx},${ty}`) ?? null);
  life.actions.addSeats((_sim, _layer, tx, ty) => seats.get(`${tx},${ty}`) ?? null);
  w.influences.addHeatSources(() => fires);
  const lw: LifeWorld = {
    ...w,
    env,
    life,
    inventory,
    equipment,
    landings,
    beds,
    seats,
    fires,
    bed(x, y, kind, comfort = 0, bedroom = false) {
      const c = w.centre(x, y);
      const place: SleepPlace = { kind, x: c.x, y: c.y, layer: 0, comfort, bedroom };
      beds.set(`${OFFSET + x},${OFFSET + y}`, place);
      return place;
    },
    seat(x, y) {
      const c = w.centre(x, y);
      const s: Seat = { x: c.x, y: c.y, layer: 0 };
      seats.set(`${OFFSET + x},${OFFSET + y}`, s);
      return s;
    },
    fire(x, y) {
      const c = w.centre(x, y);
      fires.push({ x: c.x, y: c.y, layer: 0, coreHeatC: 15, coreRadiusPx: 1.5 * T, radiusPx: 5 * T });
    },
    tile(x, y) {
      return { tx: OFFSET + x, ty: OFFSET + y };
    },
    jumpToHour(hour) {
      // Ticks since 06:00 of the target hour, and how far ahead of the clock it lies within one day.
      const clock = w.sim.clock;
      const day = clock.ticksPerDay;
      const target = (((hour - DAWN_HOUR) * clock.ticksPerGameHour) % day + day) % day;
      const ahead = (target - clock.dayTick + day) % day;
      w.sim.skipTicks(ahead === 0 ? day : ahead);
    },
  };
  return lw;
}
