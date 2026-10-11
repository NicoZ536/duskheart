/**
 * Test support for the kitchen tests (kochen, mahlzeiten, traenke, verderb, wasser, raumwirkungen and the kitchen roundtrips):
 * the life test world of leben-testwelt.ts (hand-drawn chunks, the player's life) plus the systems of strand E on it –
 * crafting and the stations (with the kitchen's fire check, product mark and room tempo), spoilage (the bags and drawn test
 * containers), water (rain collectors fed by a hand-written climate log) and meals (eat hook, group limit, salve).
 *
 * The surroundings are drawn by the test: `room(x, y, type, outdoors)` puts drawn tile (x, y) into a room of `type`,
 * `fire(x, y)` lights a fire on it (the cauldron's fire check), `roof(x, y)` covers it; `active` says which chunks count as the
 * active zone (default: all). Containers are drawn too: `container(kind, x, y)` returns a list of slots that spoil like a
 * chest, a pantry barrel or a dropped stack lying there.
 *
 * Time: the default day of the life world (24 real minutes, 3600 ticks per game hour); `hours(n)` skips whole game hours
 * (`Simulation.skipTicks`) and steps one tick so the hourly pass runs.
 */
import { FarmClimateLog } from '../../../src/game/farming/climateLog';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { StationSystem } from '../../../src/game/stations/system';
import { MealsSystem, kitchenFireCheck, kitchenProductMark } from '../../../src/game/meals/index';
import { SpoilageSystem, bagSource } from '../../../src/game/spoilage/index';
import type { PerishableContainer, PerishableContainerSource } from '../../../src/game/spoilage/types';
import { WaterSystem, waterUses } from '../../../src/game/water/index';
import { contentItemCatalog, type ItemCatalog } from '../../../src/game/items/catalog';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import type { SlotRef } from '../../../src/game/items/slots';
import { slotAt, withSlot } from '../../../src/game/inventory/bags';
import { roomCraftTempo } from '../../../src/game/rooms/formulas';
import { BALANCE } from '../../../src/content/balance';
import { Calendar } from '../../../src/world/calendar';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import type { UseProvider } from '../../../src/game/interaction/uses';
import type { ItemUseHandler, ItemUseOutcome } from '../../../src/game/tools/itemUses';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

/** The game's items. */
export const kuecheKatalog: ItemCatalog = contentItemCatalog();

/** A drawn test container: its slots spoil where it stands. */
export interface TestContainer {
  readonly kind: PerishableContainer;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly slots: (ItemStack | null)[];
}

/** A room drawn on a tile. */
export interface TestRoom {
  readonly type: string | null;
  readonly outdoors: boolean;
}

export interface KuecheWelt extends LifeWorld {
  readonly calendar: Calendar;
  readonly crafting: CraftingSystem;
  readonly stations: StationSystem;
  readonly spoilage: SpoilageSystem;
  readonly water: WaterSystem;
  readonly meals: MealsSystem;
  readonly climate: FarmClimateLog;
  readonly waterUses: UseProvider;
  /** Rooms by world tile `tx,ty`. */
  readonly rooms: Map<string, TestRoom>;
  /** Burning fires by world tile `tx,ty` (the fire check). */
  readonly fireTiles: Set<string>;
  /** Roofs by world tile `tx,ty`. */
  readonly roofs: Set<string>;
  /** Test containers. */
  readonly containers: TestContainer[];
  /** Chunks outside the active zone (`layer:cx:cy`). */
  readonly frozen: Set<string>;
  /** Biome of every drawn tile (runtime id) – default Grünhain. */
  biome(name: string): void;
  room(x: number, y: number, type: string | null, outdoors?: boolean): void;
  fireAt(x: number, y: number): void;
  roof(x: number, y: number): void;
  container(kind: PerishableContainer, x: number, y: number, slots?: number): TestContainer;
  /** Puts `stack` into bag slot `ref` (default inventar 0). */
  put(stack: ItemStack, ref?: SlotRef): void;
  /** A new stack of `item`. */
  stack(item: string, count?: number): ItemStack;
  /** The stack in bag slot `ref` (default inventar 0). */
  slot(ref?: SlotRef): ItemStack | null;
  /** Skips `n` whole game hours and steps one tick (the hourly pass). */
  hours(n: number): void;
  /**
   * Uses the item in bag slot `ref` like `player.useItem` does with the handlers of strand E (the salve, the water vessels):
   * `target` is the aimed or named tile (map coordinates), `named` whether the command named it (E). Returns the outcome; the
   * events wait in the queue for the next `run`.
   */
  useItem(ref?: SlotRef, target?: { x: number; y: number } | null, named?: boolean, primary?: boolean): ItemUseOutcome;
}

const key = (tx: number, ty: number): string => `${tx},${ty}`;
const chunkKey = (layer: number, cx: number, cy: number): string => `${layer}:${cx}:${cy}`;

/** A kitchen world on `rows` (default: a 30 × 30 meadow) with the player at drawn tile (10, 10). */
export function kuecheWelt(rows: readonly string[] = meadow(30, 30), seed = 1): KuecheWelt {
  const w = lifeWorld(rows, seed, kuecheKatalog);
  const sim = w.sim;
  const calendar = new Calendar(sim.clock);
  const rooms = new Map<string, TestRoom>();
  const fireTiles = new Set<string>();
  const roofs = new Set<string>();
  const containers: TestContainer[] = [];
  const frozen = new Set<string>();
  const spilled: ItemStack[] = [];
  const spill = (_s: unknown, stack: ItemStack): void => {
    spilled.push(stack);
  };
  const active = (_s: unknown, layer: Layer, cx: number, cy: number): boolean => !frozen.has(chunkKey(layer, cx, cy));
  const roomTypeAt = (_s: unknown, _layer: Layer, tx: number, ty: number): string | null => rooms.get(key(tx, ty))?.type ?? null;

  const crafting = sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill }));
  const stations = sim.addSystem(new StationSystem({ player: w.player, inventory: w.inventory, collision: w.collision, crafting, spill, environment: { active } }));
  crafting.addStations((_s, layer, x, y, radiusPx, station, exact) => stations.stationAtHand(layer, x, y, radiusPx, station, exact));
  crafting.useWorkshops((s, layer, tx, ty, station) => roomCraftTempo(roomTypeAt(s, layer, tx, ty), station));
  crafting.useFire(kitchenFireCheck({ fireLit: (_layer, tx, ty) => fireTiles.has(key(tx, ty)), hearthLit: () => false }));
  crafting.useProductMark(kitchenProductMark(kuecheKatalog, roomTypeAt));
  crafting.useSkills(w.life.skills);

  const spoilage = sim.addSystem(
    new SpoilageSystem(sim, {
      catalog: kuecheKatalog,
      seasons: calendar,
      stations,
      world: {
        active,
        roomAt: (_s, _layer, tx, ty, out) => {
          const r = rooms.get(key(tx, ty));
          out.type = r?.type ?? null;
          out.outdoors = r === undefined ? true : r.outdoors;
        },
        chunkAt: (_s, layer, tx, ty) => w.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT),
        biomeName: (id) => (id === 0 ? null : contentWorldIdTables().biomes.stringId(id)),
      },
    }),
  );
  stations.useSpoilage(spoilage.stationHook());
  spoilage.addSource(bagSource(w.inventory, w.player));
  const testSource: PerishableContainerSource = {
    id: 'kiste',
    forEachPerishable(s, chunk, visit) {
      for (const c of containers) {
        const cx = c.tx >> CHUNK_SHIFT;
        const cy = c.ty >> CHUNK_SHIFT;
        if (chunk === null ? !active(s, c.layer, cx, cy) : chunk.layer !== c.layer || chunk.cx !== cx || chunk.cy !== cy) continue;
        for (let i = 0; i < c.slots.length; i++) {
          const st = c.slots[i] ?? null;
          if (st === null || st.frische === undefined) continue;
          visit({ container: c.kind, key: `test:${containers.indexOf(c)}:${i}`, layer: c.layer, tx: c.tx, ty: c.ty, stack: st }, (next) => {
            c.slots[i] = next;
          });
        }
      }
    },
  };
  spoilage.addSource(testSource);

  const climate = new FarmClimateLog(calendar);
  const water = sim.addSystem(
    new WaterSystem(sim, {
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      catalog: kuecheKatalog,
      world: { active, roofed: (_layer, tx, ty) => roofs.has(key(tx, ty)), regionAt: () => 0 },
      climate,
    }),
  );
  water.useActions(w.life.actions);
  w.life.actions.addDrinkHook(water.drinkHook);
  crafting.addWaterSource(water.craftWaterSource());
  const uses = waterUses(water, w.inventory, kuecheKatalog);

  const meals = sim.addSystem(new MealsSystem({ components: w.components, inventory: w.inventory, player: w.player, diningHall: (s) => {
    const p = { x: 0, y: 0 };
    if (!w.player.position(s, p)) return false;
    return roomTypeAt(s, 0, Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX)) === 'speisesaal';
  } }));
  meals.useLife({ conditions: w.life.conditions, fear: w.life.fear });
  w.life.actions.addEatHook(meals.eatHook);
  w.life.conditions.addGroupLimit('mahlzeit', BALANCE.meals.maxMealEffects);

  const itemUses: ItemUseHandler[] = [meals.itemUse(), water.itemUse()];
  const kw: KuecheWelt = {
    ...w,
    calendar,
    crafting,
    stations,
    spoilage,
    water,
    meals,
    climate,
    waterUses: uses,
    rooms,
    fireTiles,
    roofs,
    containers,
    frozen,
    biome(name) {
      const id = contentWorldIdTables().biomes.runtimeId(name);
      for (const c of w.chunks.map.values()) c.biome.fill(id);
    },
    room(x, y, type, outdoors = false) {
      rooms.set(key(OFFSET + x, OFFSET + y), { type, outdoors });
    },
    fireAt(x, y) {
      fireTiles.add(key(OFFSET + x, OFFSET + y));
    },
    roof(x, y) {
      roofs.add(key(OFFSET + x, OFFSET + y));
    },
    container(kind, x, y, slots = 4) {
      const c: TestContainer = { kind, layer: 0, tx: OFFSET + x, ty: OFFSET + y, slots: Array.from({ length: slots }, () => null) };
      containers.push(c);
      return c;
    },
    put(stack, ref = { bereich: 'inventar', index: 0 }) {
      w.inventory.bags.replace(withSlot(w.inventory.state, ref, stack));
    },
    stack(item, count = 1) {
      return newStack(kuecheKatalog.get(item), count);
    },
    slot(ref = { bereich: 'inventar', index: 0 }) {
      return slotAt(w.inventory.state, ref);
    },
    useItem(ref = { bereich: 'inventar', index: 0 }, target = null, named = false, primary = false) {
      const st = slotAt(w.inventory.state, ref);
      if (st === null) throw new Error('useItem: empty slot');
      const def = kuecheKatalog.get(st.item);
      const ctx = { slot: ref, stack: st, def, target: target === null ? null : { layer: 0 as Layer, tx: OFFSET + target.x, ty: OFFSET + target.y }, tick: sim.tick, named, primary };
      for (const h of itemUses) {
        if (!h.handles(def)) continue;
        const r = h.use(sim, ctx);
        if (r !== 'pass') return r;
      }
      return 'pass';
    },
    hours(n) {
      const per = sim.clock.ticksPerGameHour;
      const into = sim.tick % per;
      sim.skipTicks(n * per - into);
      w.run(1);
    },
  };
  return kw;
}
