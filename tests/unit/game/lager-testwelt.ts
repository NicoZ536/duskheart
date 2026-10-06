/**
 * Test support for the base tests (lagerung, herdfeuer, blaupausen, bau-aendern, feuer, grasbett, knochenbruch and the
 * roundtrips `storage`, `hearth`, `fire`): the building test world (bau-testwelt.ts: player, bags, life systems,
 * building and rooms on a drawn map) plus a calendar, drops, gathering (standing trees burn), crafting, the storage,
 * hearth and fire systems wired as in `createSimulation`, with a controllable active zone and climate, and fixture
 * ember cores `glutkern_1` … `glutkern_6` (their items come with the beacons, M7-36 …).
 *
 * Map coordinates are relative to `OFFSET` (spieler-testwelt.ts); `tile(x, y)` gives world tiles.
 */
import { BALANCE } from '../../../src/content/balance';
import { ALL_BUILD_PARTS } from '../../../src/content/buildPartsAlle';
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import { BuildingSystem } from '../../../src/game/building/system';
import { bedRespawnListener } from '../../../src/game/building/beds';
import { blueprintMaterials } from '../../../src/game/blueprints/supply';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { DropSystem } from '../../../src/game/drops/system';
import { climateCode } from '../../../src/game/fire/formulas';
import { FireSystem } from '../../../src/game/fire/system';
import { GatheringSystem } from '../../../src/game/gathering/system';
import { HearthSystem } from '../../../src/game/hearth/system';
import { ItemCatalog } from '../../../src/game/items/catalog';
import type { SlotRef } from '../../../src/game/items/slots';
import type { ItemStack } from '../../../src/game/items/stack';
import { RoomsSystem } from '../../../src/game/rooms/system';
import { StorageSystem } from '../../../src/game/storage/system';
import { Calendar } from '../../../src/world/calendar';
import { createPartCatalog } from '../../../src/world/structures/catalog';
import { PROBE_FURNITURE_ITEMS, PROBE_FURNITURE_PARTS } from './bau-testwelt';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { OFFSET, T } from './spieler-testwelt';
import type { GameCommand } from '../../../src/game/commands';
import { BAG_AREAS } from '../../../src/game/items/slots';
import type { RoomInfo } from '../../../src/game/rooms/system';

/** Fixture ember cores (the real ones come with their beacons: `glutkern_1` with the first, M7-36 – only the missing are probes). */
export const PROBE_CORES = defineItemGroup(
  'probe-glutkerne',
  BALANCE.hearth.coreItems.filter((id) => !ITEMS.some((item) => item.id === id)).map((id) =>
    baseItem({ id, name: { de: `Probe ${id}`, en: `Probe ${id}` }, beschreibung: { de: 'Test-Glutkern.', en: 'Test ember core.' }, kategorie: 'rohstoff', tauschwert: 1, sounds: { aufheben: ITEM_SFX.stein } }),
  ),
);

/** Items of the tests: the game's items, the fixture furniture and the fixture cores. */
export function lagerItemCatalog(): ItemCatalog {
  return new ItemCatalog([...ITEMS, ...PROBE_FURNITURE_ITEMS, ...PROBE_CORES]);
}

/** Climate of the drawn surface (one weather region): rain [0–1], wind [0–1], wind direction (0 north … 7 north-west). */
export interface TestClimate {
  rain: number;
  wind: number;
  dir: number;
}

export interface LagerWelt extends LifeWorld {
  readonly building: BuildingSystem;
  readonly rooms: RoomsSystem;
  readonly calendar: Calendar;
  readonly drops: DropSystem;
  readonly gathering: GatheringSystem;
  readonly crafting: CraftingSystem;
  readonly storage: StorageSystem;
  readonly hearth: HearthSystem;
  /** The fire simulation (`fire` is the life world's camp fire). */
  readonly feuer: FireSystem;
  /** Stacks the systems spilled (chests and hearths destroyed, refunds that did not fit). */
  readonly spilled: Array<{ stack: ItemStack; x: number; y: number }>;
  /** Whether the chunks of the drawn map are in the active zone (hearths burn, fires burn; else they catch up). */
  active: boolean;
  readonly climate: TestClimate;
  /** Steps one tick with the commands and returns the events of that tick by type. */
  act(...commands: GameCommand[]): Map<string, unknown[]>;
  /** Places part `part` with its anchor on drawn tile (x, y) (gives the item first); returns the refusal or null. */
  build(part: string, x: number, y: number, rot?: number): string | null;
  /** The `commandRejected` reason of an event map, or null. */
  rejection(events: Map<string, unknown[]>): string | null;
  give(item: string, count: number): void;
  count(item: string): number;
  /** First bag slot holding `item`. */
  slotOf(item: string): SlotRef;
  /** Puts `item` into the hand (hotbar slot 0 selected). */
  hold(item: string): void;
  roomAt(x: number, y: number): RoomInfo | null;
}

/** A base test world on `rows` (daylight, 20 °C), the player on drawn tile `spawn`. */
export function lagerWelt(rows: readonly string[], spawn: { x: number; y: number } = { x: 4, y: 4 }, seed = 1): LagerWelt {
  const w = lifeWorld(rows, seed, lagerItemCatalog());
  const spilled: LagerWelt['spilled'] = [];
  const spill = (_s: unknown, stack: ItemStack, _layer: number, x: number, y: number): void => {
    spilled.push({ stack, x, y });
  };
  const zone = { active: true };
  const climate: TestClimate = { rain: 0, wind: 0, dir: 0 };
  const building = w.sim.addSystem(
    new BuildingSystem({
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      drops: spill,
      catalog: createPartCatalog([...ALL_BUILD_PARTS, ...PROBE_FURNITURE_PARTS]),
    }),
  );
  w.player.addClimbAids({ ladderAt: (layer, tx, ty) => building.ladderAt(layer, tx, ty) });
  const rooms = w.sim.addSystem(new RoomsSystem({ building, collision: w.collision, player: w.player, outside: () => w.env.air }));
  w.influences.addModifierSource(rooms.modifierSource());
  rooms.useConditions(w.life.conditions);
  w.life.sleep.addSleepPlaces(rooms.sleepPlaces());
  w.life.actions.addSeats(building.seats());
  building.addPartListener(bedRespawnListener(w.life.death));
  const calendar = w.sim.addSystem(new Calendar(w.sim.clock));
  const drops = w.sim.addSystem(new DropSystem(w.sim, { player: w.player, inventory: w.inventory, equipment: w.equipment, collision: w.collision }));
  const gathering = w.sim.addSystem(
    new GatheringSystem(w.sim, {
      collision: w.collision,
      calendar,
      drops,
      catalog: w.inventory.bags.catalog,
      activeChunks: () => (zone.active ? [...w.chunks.map.values()] : []),
      playerAt: (out) => {
        const b = w.player.body(w.sim);
        if (b === undefined || !w.player.position(w.sim, out)) return false;
        out.layer = b.layer;
        return true;
      },
    }),
  );
  const crafting = w.sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill }));
  crafting.useSkills(w.life.skills);
  const storage = w.sim.addSystem(new StorageSystem({ player: w.player, inventory: w.inventory, building, spill }));
  crafting.addStores(storage.storeProvider());
  building.useMaterials(blueprintMaterials({ inventory: w.inventory, storage }));
  const env = { active: () => zone.active };
  const hearth = w.sim.addSystem(new HearthSystem({ player: w.player, inventory: w.inventory, building, storage, spill, environment: env }));
  storage.useBases((layer, tx, ty) => hearth.zoneAt(w.sim, layer, tx, ty));
  gathering.addBaseAreas(hearth.baseAreas());
  w.life.death.addHearths((s) => hearth.respawnSpots(s));
  const feuer = w.sim.addSystem(
    new FireSystem(w.sim, {
      building,
      gathering,
      player: w.player,
      environment: {
        active: () => zone.active,
        region: (_s, layer) => (layer === 0 ? 0 : -1),
        regions: () => 1,
        climate: () => climateCode(climate.rain, climate.wind, climate.dir),
      },
    }),
  );
  feuer.useConditions(w.life.conditions);
  w.spawn(spawn.x, spawn.y);
  const lw: LagerWelt = {
    ...w,
    building,
    rooms,
    calendar,
    drops,
    gathering,
    crafting,
    storage,
    hearth,
    feuer,
    spilled,
    climate,
    get active() {
      return zone.active;
    },
    set active(on: boolean) {
      zone.active = on;
    },
    act(...commands) {
      return w.run(1, commands);
    },
    build(part, x, y, rot) {
      w.inventory.give(w.sim, part, 1);
      return lw.rejection(lw.act({ type: 'build.place', part, tx: OFFSET + x, ty: OFFSET + y, ...(rot === undefined ? {} : { rot }) }));
    },
    rejection(events) {
      const r = events.get('commandRejected') as Array<{ reason: string }> | undefined;
      return r === undefined || r.length === 0 ? null : (r[0] as { reason: string }).reason;
    },
    give(item, count) {
      w.inventory.give(w.sim, item, count);
    },
    count(item) {
      return w.inventory.count(item);
    },
    slotOf(item) {
      const state = w.inventory.state;
      for (const area of BAG_AREAS) {
        const index = state[area].findIndex((s) => s !== null && s.item === item);
        if (index >= 0) return { bereich: area, index };
      }
      throw new Error(`no ${item} in the bags`);
    },
    hold(item) {
      w.inventory.give(w.sim, item, 1);
      w.run(1, [{ type: 'inventory.move', from: lw.slotOf(item), to: { bereich: 'schnellleiste', index: 0 } }, { type: 'player.selectHotbar', index: 0 }]);
    },
    roomAt(x, y) {
      return rooms.roomAt(w.sim, 0, OFFSET + x, OFFSET + y);
    },
  };
  return lw;
}

/** World px of the centre of drawn tile (x, y). */
export function px(x: number, y: number): { x: number; y: number } {
  return { x: (OFFSET + x) * T + T / 2, y: (OFFSET + y) * T + T / 2 };
}
