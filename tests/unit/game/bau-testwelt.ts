/**
 * Test support for the building and room tests (bauraster, statik, raeume, raumklima, raumtypen,
 * behaglichkeit, the `building` roundtrip): the life test world (hand-drawn chunks, controllable air, rain,
 * light and night, bags, the life systems) plus the building and rooms systems wired as in `createSimulation`,
 * with the game's build parts and fixture furniture of every category (kettle, trough and garden bed come
 * with later milestones) – validated with the real item and build part schemas.
 *
 * Map coordinates are relative to `OFFSET` (spieler-testwelt.ts); `tile(x, y)` gives world tiles.
 */
import { BUILD_PARTS, defineBuildParts, type FurnitureCategory } from '../../../src/content/buildParts';
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import { BuildingSystem } from '../../../src/game/building/system';
import type { GameCommand } from '../../../src/game/commands';
import { ItemCatalog } from '../../../src/game/items/catalog';
import type { ItemStack } from '../../../src/game/items/stack';
import { RoomsSystem, type RoomInfo } from '../../../src/game/rooms/system';
import { createPartCatalog } from '../../../src/world/structures/catalog';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { OFFSET, T } from './spieler-testwelt';

/** A fixture piece of furniture of each category that the content does not have yet (ids `probe_moebel_*`). */
const FURNITURE: ReadonlyArray<{ id: string; category: FurnitureCategory; b?: number; t?: number; wall?: boolean; sleep?: string; free?: boolean }> = [
  { id: 'probe_moebel_bett', category: 'bett', b: 1, t: 2, sleep: 'bett' },
  { id: 'probe_moebel_stuhl', category: 'sitz' },
  { id: 'probe_moebel_tisch', category: 'tisch', b: 2, t: 1 },
  { id: 'probe_moebel_kiste', category: 'lager' },
  { id: 'probe_moebel_schrank', category: 'schrank' },
  { id: 'probe_moebel_lampe', category: 'licht' },
  { id: 'probe_moebel_kamin', category: 'kamin', b: 2, t: 1 },
  { id: 'probe_moebel_kessel', category: 'kochstelle' },
  { id: 'probe_moebel_station', category: 'station', b: 2, t: 1 },
  { id: 'probe_moebel_vase', category: 'deko' },
  { id: 'probe_moebel_teppich', category: 'teppich', b: 2, t: 2, free: true },
  { id: 'probe_moebel_topfpflanze', category: 'pflanze' },
  { id: 'probe_moebel_beet', category: 'beet', b: 2, t: 1 },
  { id: 'probe_moebel_trog', category: 'trog', b: 2, t: 1 },
  { id: 'probe_moebel_gross', category: 'deko', b: 4, t: 4 },
  { id: 'probe_moebel_bild', category: 'bild', wall: true },
  { id: 'probe_moebel_trophaee', category: 'trophaee', wall: true },
  { id: 'probe_moebel_wandlampe', category: 'licht', wall: true },
];

/** Fixture furniture items. */
export const PROBE_FURNITURE_ITEMS = defineItemGroup(
  'bau-proben',
  FURNITURE.map((f) =>
    baseItem({
      id: f.id,
      name: { de: `Probe ${f.id}`, en: `Probe ${f.id}` },
      beschreibung: { de: 'Testmöbel.', en: 'Test furniture.' },
      kategorie: 'platzierbar',
      tauschwert: 1,
      sounds: { aufheben: ITEM_SFX.holz },
    }),
  ),
);

/** Fixture furniture parts. */
export const PROBE_FURNITURE_PARTS = defineBuildParts(
  'bau-proben',
  FURNITURE.map((f) => ({
    id: f.id,
    art: f.wall === true ? ('wandmoebel' as const) : ('moebel' as const),
    material: 'holz' as const,
    ...(f.b !== undefined || f.t !== undefined ? { groesse: { b: f.b ?? 1, t: f.t ?? 1 } } : {}),
    kategorie: f.category,
    ...(f.sleep !== undefined ? { schlafplatz: f.sleep } : {}),
    ...(f.free === true ? { blockiert: false } : {}),
  })),
);

/** Items of the tests: the game's items plus the fixture furniture. */
export function bauItemCatalog(): ItemCatalog {
  return new ItemCatalog([...ITEMS, ...PROBE_FURNITURE_ITEMS]);
}

/** The life test world with building and rooms. */
export interface BauWelt extends LifeWorld {
  readonly building: BuildingSystem;
  readonly rooms: RoomsSystem;
  /** Refunds that did not fit and collapse rubble, as handed to the drop system. */
  readonly dropped: Array<{ stack: ItemStack; layer: number; x: number; y: number }>;
  /** Steps one tick with the commands and returns the events of that tick by type. */
  act(...commands: GameCommand[]): Map<string, unknown[]>;
  /** Places part `part` with its anchor on drawn tile (x, y) (gives the item first); returns the refusal reason or null. */
  build(part: string, x: number, y: number, rot?: number): string | null;
  /** The `commandRejected` reason of an event map, or null. */
  rejection(events: Map<string, unknown[]>): string | null;
  /** The room on drawn tile (x, y). */
  roomAt(x: number, y: number): RoomInfo | null;
  /** Pieces of `item` in the bags. */
  count(item: string): number;
  /** World px of drawn tile (x, y)'s centre. */
  px(x: number, y: number): { x: number; y: number };
}

/** A building test world on `rows` (daylight, 20 °C; `env.air` is also the outside air of the rooms). */
export function bauWelt(rows: readonly string[], seed = 1): BauWelt {
  const w = lifeWorld(rows, seed, bauItemCatalog());
  const dropped: BauWelt['dropped'] = [];
  const building = w.sim.addSystem(
    new BuildingSystem({
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      drops: (_s, stack, layer, x, y) => dropped.push({ stack, layer, x, y }),
      catalog: createPartCatalog([...BUILD_PARTS, ...PROBE_FURNITURE_PARTS]),
    }),
  );
  w.player.addClimbAids({ ladderAt: (layer, tx, ty) => building.ladderAt(layer, tx, ty) });
  const rooms = w.sim.addSystem(new RoomsSystem({ building, collision: w.collision, player: w.player, outside: () => w.env.air }));
  w.influences.addModifierSource(rooms.modifierSource());
  rooms.addHeatSources(() => w.fires);
  rooms.useConditions(w.life.conditions);
  w.life.fear.addSurroundings(rooms.fearSurroundings());
  w.life.sleep.addSleepPlaces(rooms.sleepPlaces());
  w.life.actions.addSeats(building.seats());
  const bw: BauWelt = {
    ...w,
    building,
    rooms,
    dropped,
    act(...commands) {
      return w.run(1, commands);
    },
    build(part, x, y, rot) {
      w.inventory.give(w.sim, part, 1);
      const events = bw.act({ type: 'build.place', part, tx: OFFSET + x, ty: OFFSET + y, ...(rot === undefined ? {} : { rot }) });
      return bw.rejection(events);
    },
    rejection(events) {
      const r = events.get('commandRejected') as Array<{ reason: string }> | undefined;
      return r === undefined || r.length === 0 ? null : (r[0] as { reason: string }).reason;
    },
    roomAt(x, y) {
      return rooms.roomAt(w.sim, 0, OFFSET + x, OFFSET + y);
    },
    count(item) {
      return w.inventory.count(item);
    },
    px(x, y) {
      return { x: (OFFSET + x) * T + T / 2, y: (OFFSET + y) * T + T / 2 };
    },
  };
  return bw;
}

/**
 * Builds a closed hut on the map: walls of `wall` around the rectangle of inner tiles (x0, y0)–(x1, y1), a door
 * (`door`) in the middle of the south wall, and – when `roof` is given – roof tiles over the whole house including
 * its walls. The player must stand within build reach (the helper builds in the order that keeps roofs carried).
 */
export function hut(w: BauWelt, x0: number, y0: number, x1: number, y1: number, wall = 'wand_holz', door: string | null = 'tuer_holz', roof: string | null = 'dach_stroh'): void {
  const doorX = Math.floor((x0 + x1) / 2);
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const edge = x === x0 - 1 || x === x1 + 1 || y === y0 - 1 || y === y1 + 1;
      if (!edge) continue;
      const part = door !== null && y === y1 + 1 && x === doorX ? door : wall;
      const r = w.build(part, x, y);
      if (r !== null) throw new Error(`hut: ${part} at ${x},${y} refused: ${r}`);
    }
  }
  if (roof === null) return;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      const r = w.build(roof, x, y);
      if (r !== null) throw new Error(`hut: ${roof} at ${x},${y} refused: ${r}`);
    }
  }
}
