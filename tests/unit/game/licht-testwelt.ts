/**
 * Test support for the light tests (lichtkarte, lichtquellen): the player test world of spieler-testwelt.ts
 * (hand-drawn chunks) plus bags, equipment and the light system with a controllable environment – rain,
 * ambient light and which chunks are frozen – and helpers to give, equip and place lights.
 */
import { InventorySystem } from '../../../src/game/inventory/system';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import type { LightEnvironment } from '../../../src/game/light/environment';
import { LightSystem } from '../../../src/game/light/system';
import type { SlotRef } from '../../../src/game/items/slots';
import { equipmentRef } from '../../../src/game/items/slots';
import type { GameCommand } from '../../../src/game/commands';
import { CHUNK_SHIFT, packChunkId, type Layer } from '../../../src/world/model/coords';
import { testCatalog } from './items-fixtures';
import { OFFSET, testEnvironment, testWorld, type TestWorld } from './spieler-testwelt';

/** The light environment of a test: rain, ambient, frozen chunks – changeable by the test. */
export interface LightTestEnvironment extends LightEnvironment {
  /** Falling rain everywhere on the surface [precipitation 0–1]. */
  precipitation: number;
  /** Ambient light everywhere [light level]. */
  ambientLevel: number;
  /** Packed ids of the frozen chunks (all others are active). */
  readonly frozen: Set<number>;
}

export interface LightWorld extends TestWorld {
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly light: LightSystem;
  readonly lenv: LightTestEnvironment;
  /** Events of the last `run`, by type. */
  last: Map<string, unknown[]>;
  /** Runs `n` ticks (commands into the first) and keeps the events in `last`. */
  step(n: number, commands?: readonly GameCommand[]): Map<string, unknown[]>;
  /** Tile coordinates of drawn tile (x, y). */
  tile(x: number, y: number): { tx: number; ty: number };
  /** Gives `count` of `item` into the bags (between two ticks). */
  give(item: string, count: number): void;
  /** Slot of the first stack of `item` in the carried bags. */
  slotOf(item: string): SlotRef;
  /** Puts the first torch of the bags into the off hand (one tick). */
  equipTorch(): void;
  /** Places the light item `item` from the bags on drawn tile (x, y); returns the new light's id. */
  place(item: string, x: number, y: number): number;
  /** Freezes or activates the chunk of drawn tile (x, y). */
  setFrozen(x: number, y: number, frozen: boolean, layer?: Layer): void;
}

/** A light test world on `rows`: daylight 0, dry, every chunk active. */
export function lightWorld(rows: readonly string[], seed = 1): LightWorld {
  const w = testWorld(rows, testEnvironment(), seed);
  const bags = new PlayerBags(testCatalog());
  const inventory = w.sim.addSystem(new InventorySystem(bags));
  const equipment = w.sim.addSystem(new EquipmentSystem(bags));
  const lenv: LightTestEnvironment = {
    precipitation: 0,
    ambientLevel: 0,
    frozen: new Set<number>(),
    rain: (_sim, layer) => (layer === 0 ? lenv.precipitation : 0),
    ambient: () => lenv.ambientLevel,
    active: (_sim, layer, cx, cy) => !lenv.frozen.has(packChunkId(layer, cx, cy)),
  };
  const light = w.sim.addSystem(new LightSystem(w.sim, { player: w.player, inventory, collision: w.collision, environment: lenv }));
  w.influences.addHeatSources(light.heatSources());
  const lw: LightWorld = {
    ...w,
    inventory,
    equipment,
    light,
    lenv,
    last: new Map(),
    step(n, commands) {
      lw.last = w.run(n, commands);
      return lw.last;
    },
    tile: (x, y) => ({ tx: OFFSET + x, ty: OFFSET + y }),
    give(item, count) {
      inventory.give(w.sim, item, count);
      w.sim.events.drain(() => undefined);
    },
    slotOf(item) {
      const s = inventory.state;
      for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach', 'ausruestung'] as const) {
        const index = s[bereich].findIndex((x) => x !== null && x.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`${item} not in the bags`);
    },
    equipTorch() {
      lw.step(1, [{ type: 'inventory.move', from: lw.slotOf('fackel'), to: equipmentRef('nebenhand') }]);
    },
    place(item, x, y) {
      const before = light.state.nextId;
      lw.step(1, [{ type: 'light.place', from: lw.slotOf(item), tx: OFFSET + x, ty: OFFSET + y }]);
      if (light.state.nextId === before) throw new Error(`${item} was not placed: ${JSON.stringify(lw.last.get('commandRejected'))}`);
      return before;
    },
    setFrozen(x, y, frozen, layer = 0) {
      const id = packChunkId(layer, (OFFSET + x) >> CHUNK_SHIFT, (OFFSET + y) >> CHUNK_SHIFT);
      if (frozen) lenv.frozen.add(id);
      else lenv.frozen.delete(id);
    },
  };
  return lw;
}
