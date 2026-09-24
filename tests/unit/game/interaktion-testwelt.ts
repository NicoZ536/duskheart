/**
 * Test support for the interaction and gathering tests (interaktion, baeume, steine, pflanzen, graben,
 * drops): the player's systems plus bags, drops, gathering and interaction on a hand-drawn world (the
 * chunks and legend of the player tests, src: tests/unit/game/spieler-testwelt.ts) with world objects
 * placed by character, a calendar on the simulation's clock and fixture tools of every kind.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { SeasonId } from '../../../src/content/balance';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { Calendar } from '../../../src/world/calendar';
import { type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { InventorySystem } from '../../../src/game/inventory/system';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import { WorldCollision } from '../../../src/game/player/collision';
import { registerPlayerComponents } from '../../../src/game/player/components';
import type { PlayerBody } from '../../../src/game/player/state';
import { PlayerSystem } from '../../../src/game/player/system';
import { Simulation } from '../../../src/game/sim';
import { PlayerInfluences } from '../../../src/game/survival/modifiers';
import { VitalsSystem } from '../../../src/game/survival/system';
import { MotionSystem } from '../../../src/game/systems/motion';
import { DropSystem } from '../../../src/game/drops/system';
import { GatheringSystem } from '../../../src/game/gathering/system';
import { InteractionSystem } from '../../../src/game/interaction/system';
import type { GameCommand } from '../../../src/game/commands';
import { OFFSET, TestChunks, WORLD_TILES, draw, testEnvironment } from './spieler-testwelt';
import { PROBE_ITEMS } from './items-fixtures';

export { OFFSET, TILE_PX };

const IDS = contentWorldIdTables();

function tool(id: string, art: 'axt' | 'spitzhacke' | 'schaufel' | 'sichel' | 'hacke', abbaukraft: number, haltbarkeit = 60): ReturnType<typeof baseItem> {
  return baseItem({
    id,
    name: { de: `Probe ${id}`, en: `Probe ${id}` },
    beschreibung: { de: 'Testwerkzeug.', en: 'Test tool.' },
    kategorie: 'werkzeug',
    haltbarkeit,
    werkzeug: { art, abbaukraft },
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  });
}

/** Fixture tools (ids `probe_*`): one of each harvesting kind at tier T0, a bronze axe and pickaxe (power 2), an axe with 2 uses. */
export const TOOL_ITEMS = defineItemGroup('probe-werkzeuge', [
  tool('probe_steinaxt', 'axt', 1),
  tool('probe_bronzeaxt', 'axt', 2),
  tool('probe_spitzhacke', 'spitzhacke', 1),
  tool('probe_bronzespitzhacke', 'spitzhacke', 2),
  tool('probe_schaufel', 'schaufel', 1),
  tool('probe_sichel', 'sichel', 1),
  tool('probe_hacke', 'hacke', 1),
  tool('probe_zerbrechlich', 'axt', 1, 2),
]);

/** Content items, the fixture pieces of the bag tests (spear, ring, backpacks …) and the fixture tools. */
export function gatherCatalog(): ItemCatalog {
  return new ItemCatalog([...ITEMS, ...PROBE_ITEMS, ...TOOL_ITEMS]);
}

/** Characters for world objects in `draw` maps, besides the legend of spieler-testwelt (`.`, `w`, `s`, `T` birch, `#`, `S` sand …). */
export const OBJECT_LEGEND: Readonly<Record<string, string>> = {
  E: 'baum_eiche',
  K: 'baum_kiefer',
  A: 'baum_apfelbaum',
  B: 'busch_beeren',
  H: 'busch_hasel',
  F: 'pflanze_fasergras',
  P: 'pflanze_steinpilz',
  Q: 'pflanze_kraeuter',
  R: 'fels_klein_gruenhain',
  G: 'fels_gross_gruenhain',
  C: 'erz_kupfer',
  D: 'deko_steinchen',
  M: 'deko_moos',
  X: 'kristall_eis',
  Z: 'pflanze_schilf',
  L: 'deko_blumen',
  Y: 'pflanze_kaktus',
  U: 'deko_pilze',
  N: 'busch_dornbusch',
};

/** The world of a gathering test. */
export interface GatherWorld {
  readonly sim: Simulation;
  readonly chunks: TestChunks;
  readonly calendar: Calendar;
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly drops: DropSystem;
  readonly gathering: GatheringSystem;
  readonly interaction: InteractionSystem;
  readonly collision: WorldCollision;
  /** Chunks the gathering system treats as active (default: every drawn chunk). */
  active: ChunkData[];
  /** Steps `n` ticks (commands go into the first); returns the events of all ticks by type. */
  run(n: number, commands?: readonly GameCommand[]): Map<string, unknown[]>;
  /** Runs until `pred` holds or `max` ticks passed; returns the events. */
  runUntil(pred: () => boolean, max: number, commands?: readonly GameCommand[]): Map<string, unknown[]>;
  /** Spawns the player on the centre of map tile (x, y) (or the free tile nearest to it). */
  spawn(x: number, y: number): void;
  /** Spawns the player if needed and puts it exactly on the centre of map tile (x, y). */
  place(x: number, y: number): void;
  /** Puts `count` of `item` into the hotbar slot `index` and selects it. */
  hold(item: string, index?: number): void;
  pos(): { x: number; y: number };
  body(): PlayerBody;
  /** World tile of map tile (x, y). */
  tile(x: number, y: number): { tx: number; ty: number };
  /** Chunk and index of map tile (x, y). */
  at(x: number, y: number, layer?: Layer): { chunk: ChunkData; i: number };
  /** World object id on map tile (x, y), or '' when empty. */
  objectAt(x: number, y: number): string;
  /** Terrain id of the ground (or solid) of map tile (x, y). */
  groundAt(x: number, y: number): string;
  /** Drop entities in the world. */
  dropList(): { entity: Entity; item: string; count: number; x: number; y: number; flying: boolean }[];
  /** Sets the season: jumps the clock to the first day of it (keeps the hour). */
  season(s: SeasonId): void;
  /** Walks (teleports) the player onto every landed drop until the magnet took what fits, then back. */
  collect(): void;
}

/** Draws `rows` (objects by `OBJECT_LEGEND`, the rest by spieler-testwelt's legend) and builds the systems. */
export function gatherWorld(rows: readonly string[], seed = 1): GatherWorld {
  const sim = new Simulation({ seed, worldSize: 'small' });
  const chunks = new TestChunks();
  const objects: { x: number; y: number; id: string }[] = [];
  const base = rows.map((row, y) =>
    [...row]
      .map((ch, x) => {
        const id = OBJECT_LEGEND[ch];
        if (id === undefined) return ch;
        objects.push({ x, y, id });
        return '.';
      })
      .join(''),
  );
  draw(chunks, base);
  for (const o of objects) {
    const { chunk, i } = chunks.at(OFFSET + o.x, OFFSET + o.y);
    chunk.object[i] = IDS.objects.runtimeId(o.id);
  }
  const motion = sim.addSystem(new MotionSystem(sim));
  const collision = sim.addSystem(new WorldCollision(sim, { chunks, worldTiles: WORLD_TILES }));
  const components = registerPlayerComponents(sim.ecs);
  const influences = new PlayerInfluences();
  const vitals = new VitalsSystem({ components, influences, motion, environment: testEnvironment() });
  const player = sim.addSystem(new PlayerSystem(sim, { motion, collision, components, influences, vitals }));
  sim.addSystem(vitals);
  const calendar = sim.addSystem(new Calendar(sim.clock));
  const bags = new PlayerBags(gatherCatalog());
  const inventory = sim.addSystem(new InventorySystem(bags));
  const equipment = sim.addSystem(new EquipmentSystem(bags));
  const drops = sim.addSystem(new DropSystem(sim, { player, inventory, equipment, collision }));
  const zone = { active: [...chunks.map.values()] };
  const gathering = sim.addSystem(
    new GatheringSystem(sim, {
      collision,
      calendar,
      drops,
      catalog: bags.catalog,
      activeChunks: () => zone.active,
      playerAt: (out) => {
        const b = player.body(sim);
        if (b === undefined || !player.position(sim, out)) return false;
        out.layer = b.layer;
        return true;
      },
    }),
  );
  const interaction = sim.addSystem(new InteractionSystem(sim, { player, inventory, equipment, drops, gathering }));
  influences.addModifierSource(interaction.exertionSource);
  const w: GatherWorld = {
    sim,
    chunks,
    calendar,
    player,
    inventory,
    equipment,
    drops,
    collision,
    gathering,
    interaction,
    get active() {
      return zone.active;
    },
    set active(list) {
      zone.active = list;
    },
    run(n, commands) {
      const events = new Map<string, unknown[]>();
      for (let i = 0; i < n; i++) {
        sim.step(i === 0 ? commands : undefined);
        sim.events.drain((type, payload) => {
          const list = events.get(type) ?? [];
          list.push(payload);
          events.set(type, list);
        });
      }
      return events;
    },
    runUntil(pred, max, commands) {
      const events = new Map<string, unknown[]>();
      for (let i = 0; i < max && (i === 0 || !pred()); i++) {
        sim.step(i === 0 ? commands : undefined);
        sim.events.drain((type, payload) => {
          const list = events.get(type) ?? [];
          list.push(payload);
          events.set(type, list);
        });
      }
      return events;
    },
    spawn(x, y) {
      w.run(1, [{ type: 'player.spawn', tx: OFFSET + x, ty: OFFSET + y }]);
      if (sim.player === NULL_ENTITY) throw new Error('player did not spawn');
    },
    hold(item, index = 0) {
      inventory.give(sim, item, 1);
      const inHotbar = inventory.state.schnellleiste.findIndex((s) => s?.item === item);
      if (inHotbar >= 0 && inHotbar !== index) w.run(1, [{ type: 'inventory.move', from: { bereich: 'schnellleiste', index: inHotbar }, to: { bereich: 'schnellleiste', index } }]);
      const slot = inventory.state.inventar.findIndex((s) => s?.item === item);
      if (inHotbar < 0 && slot >= 0) w.run(1, [{ type: 'inventory.move', from: { bereich: 'inventar', index: slot }, to: { bereich: 'schnellleiste', index } }]);
      w.run(1, [{ type: 'player.selectHotbar', index }]);
      if (inventory.selected()?.item !== item) throw new Error(`could not put ${item} into the hand`);
    },
    place(x, y) {
      if (sim.player === NULL_ENTITY) w.spawn(x, y);
      const c = centre(x, y);
      w.run(1, [{ type: 'player.teleport', x: c.x, y: c.y, layer: 0 }]);
    },
    pos() {
      const p = { x: 0, y: 0 };
      if (!player.position(sim, p)) throw new Error('no player');
      return p;
    },
    body() {
      const b = player.body(sim);
      if (b === undefined) throw new Error('no player');
      return b;
    },
    tile(x, y) {
      return { tx: OFFSET + x, ty: OFFSET + y };
    },
    at(x, y, layer = 0) {
      return chunks.at(OFFSET + x, OFFSET + y, layer);
    },
    objectAt(x, y) {
      const { chunk, i } = chunks.at(OFFSET + x, OFFSET + y);
      const r = chunk.object[i] as number;
      return r === 0 ? '' : IDS.objects.stringId(r);
    },
    groundAt(x, y) {
      const { chunk, i } = chunks.at(OFFSET + x, OFFSET + y);
      const solid = chunk.solid[i] as number;
      return IDS.terrain.stringId(solid !== 0 ? solid : (chunk.ground[i] as number));
    },
    dropList() {
      const out: { entity: Entity; item: string; count: number; x: number; y: number; flying: boolean }[] = [];
      const store = drops.store;
      for (let i = 0; i < store.size; i++) {
        const d = store.valueAt(i);
        out.push({ entity: store.entityAt(i), item: d.stack.item, count: d.stack.count, x: d.x, y: d.y, flying: d.flightTicks < d.flightTotal });
      }
      return out.sort((a, b) => a.entity - b.entity);
    },
    season(s) {
      while (calendar.season !== s) sim.skipTicks(sim.clock.ticksPerDay);
    },
    collect() {
      w.run(sim.clock.tickHz);
      const home = w.pos();
      const layer = w.body().layer;
      for (const d of w.dropList()) {
        w.run(1, [{ type: 'player.teleport', x: d.x, y: d.y, layer }]);
        w.run(sim.clock.tickHz / 2);
      }
      w.run(1, [{ type: 'player.teleport', x: home.x, y: home.y, layer }]);
    },
  };
  return w;
}

/** Local index of world tile (tx, ty) in its chunk. */
export function localIndex(tx: number, ty: number): number {
  return ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
}

/** World px of the centre of map tile (x, y). */
export function centre(x: number, y: number): { x: number; y: number } {
  return { x: (OFFSET + x) * TILE_PX + TILE_PX / 2, y: (OFFSET + y) * TILE_PX + TILE_PX / 2 };
}

/** An open meadow of `w × h` tiles with `extra` rows drawn over its top left. */
export function field(w: number, h: number, extra: readonly string[] = []): string[] {
  return Array.from({ length: h }, (_, y) => {
    const row = extra[y] ?? '';
    return row + '.'.repeat(Math.max(0, w - row.length));
  });
}
