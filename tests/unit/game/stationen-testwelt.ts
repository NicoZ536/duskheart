/**
 * Test support for crafting at stations, processing and repair (M4-01 … M4-06, M4-09): the life test world
 * (leben-testwelt.ts: player, bags, life systems on a drawn meadow) plus crafting, the station system with a
 * controllable active zone, repair, a stand-in for lit campfires and chests that are listed to crafting by
 * their distance to the player.
 */
import { BALANCE } from '../../../src/content/balance';
import type { RecipeBook } from '../../../src/game/crafting/recipes';
import type { CraftingStore } from '../../../src/game/crafting/sources';
import { CraftingSystem } from '../../../src/game/crafting/system';
import type { GameCommand } from '../../../src/game/commands';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import type { SlotRef } from '../../../src/game/items/slots';
import { newStack, type ItemStack, type NewStackOptions } from '../../../src/game/items/stack';
import { RepairSystem } from '../../../src/game/repair/system';
import { campfireStations } from '../../../src/game/stations/campfire';
import type { PlacedStation } from '../../../src/game/stations/state';
import { StationSystem } from '../../../src/game/stations/system';
import { TILE_PX } from '../../../src/world/model/coords';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';

export const catalog = contentItemCatalog();
export const TICK_HZ = BALANCE.time.tickHz;

/** A chest stand-in on a drawn tile. */
export interface TestChest extends CraftingStore {
  readonly x: number;
  readonly y: number;
  /** What it holds [item → pieces]. */
  readonly left: Record<string, number>;
}

export interface StationWorld extends LifeWorld {
  readonly crafting: CraftingSystem;
  readonly stations: StationSystem;
  readonly repair: RepairSystem;
  readonly spilled: { stack: ItemStack; x: number; y: number }[];
  readonly chests: TestChest[];
  /** Whether the chunks of the drawn map are in the active zone (their stations tick). */
  active: boolean;
  /** Tiles (drawn coordinates) with a lit campfire. */
  readonly litFires: Set<string>;
  give(item: string, count: number, options?: NewStackOptions): void;
  has(item: string): number;
  /** Sets up station `station` with its north-west corner on drawn tile (x, y) (no bags involved); returns its id. */
  place(station: string, x: number, y: number): number;
  /** The placed station `id`. */
  st(id: number): Readonly<PlacedStation>;
  /** Puts a chest with `items` on drawn tile (x, y). */
  chest(x: number, y: number, items: Record<string, number>): TestChest;
  /** First bag slot holding `item`. */
  slotOf(item: string): SlotRef;
  /** Runs one tick with the command and returns the rejection reasons. */
  refused(cmd: GameCommand): string[];
}

/** A station test world on `rows` (default: a 20 × 14 meadow), the player on drawn tile (4, 4). */
export function stationWorld(rows: readonly string[] = meadow(20, 14), recipes?: RecipeBook, spawn: { x: number; y: number } = { x: 4, y: 4 }): StationWorld {
  const w = lifeWorld(rows);
  const spilled: StationWorld['spilled'] = [];
  const crafting = w.sim.addSystem(
    new CraftingSystem({
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      spill: (_s, stack, _layer, x, y) => spilled.push({ stack, x, y }),
      ...(recipes === undefined ? {} : { recipes }),
    }),
  );
  crafting.useSkills(w.life.skills);
  const world = { active: true };
  const stations = w.sim.addSystem(
    new StationSystem({
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      crafting,
      spill: (_s, stack, _layer, x, y) => spilled.push({ stack, x, y }),
      environment: { active: () => world.active },
    }),
  );
  const repair = w.sim.addSystem(new RepairSystem({ player: w.player, inventory: w.inventory, crafting, stations }));
  const litFires = new Set<string>();
  crafting.addStations(
    campfireStations(
      {
        cookingFireNear: (_layer, x, y, radiusTiles) => {
          for (const key of litFires) {
            const [fx, fy] = key.split(',').map(Number) as [number, number];
            const cx = (OFFSET + fx + 0.5) * TILE_PX;
            const cy = (OFFSET + fy + 0.5) * TILE_PX;
            if (Math.hypot(cx - x, cy - y) <= radiusTiles * TILE_PX) return 1;
          }
          return 0;
        },
      },
      crafting.recipes.stations,
    ),
  );
  const chests: TestChest[] = [];
  crafting.addStores((_s, _layer, x, y, radiusPx) => chests.filter((c) => Math.hypot(c.x - x, c.y - y) <= radiusPx).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)));
  w.spawn(spawn.x, spawn.y);
  const sw: StationWorld = {
    ...w,
    crafting,
    stations,
    repair,
    spilled,
    chests,
    litFires,
    get active() {
      return world.active;
    },
    set active(on: boolean) {
      world.active = on;
    },
    give(item, count, options) {
      w.inventory.give(w.sim, item, count, options);
    },
    has(item) {
      return w.inventory.count(item);
    },
    place(station, x, y) {
      const id = stations.placeAt(w.sim, station, 0, OFFSET + x, OFFSET + y);
      if (typeof id !== 'number') throw new Error(`cannot place ${station} at ${x},${y}: ${id}`);
      return id;
    },
    st(id) {
      const s = stations.station(id);
      if (s === undefined) throw new Error(`no station ${id}`);
      return s;
    },
    chest(x, y, items) {
      const c = w.centre(x, y);
      const left = { ...items };
      const chest: TestChest = {
        x: c.x,
        y: c.y,
        left,
        count: (item) => left[item] ?? 0,
        take: (_sim, item, n) => {
          left[item] = (left[item] ?? 0) - n;
          return [newStack(catalog.get(item), n)];
        },
      };
      chests.push(chest);
      return chest;
    },
    slotOf(item) {
      const s = w.inventory.state;
      for (const bereich of ['schnellleiste', 'inventar'] as const) {
        const index = s[bereich].findIndex((x) => x?.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`no ${item} in the bags`);
    },
    refused(cmd) {
      return (w.run(1, [cmd]).get('commandRejected') ?? []).map((e) => (e as { reason: string }).reason);
    },
  };
  return sw;
}

/** Rejection reasons among `events`. */
export function rejections(events: Map<string, unknown[]>): string[] {
  return (events.get('commandRejected') ?? []).map((e) => (e as { reason: string }).reason);
}

/** Payloads of the events of `type`. */
export function eventsOf<T = Record<string, unknown>>(events: Map<string, unknown[]>, type: string): T[] {
  return (events.get(type) ?? []) as T[];
}
