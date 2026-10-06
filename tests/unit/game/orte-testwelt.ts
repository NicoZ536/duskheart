/**
 * Test support for the place tests (orte, the roundtrip of `places`; strand B, M7-07 … M7-09): the creature test world of
 * kreatur-testwelt.ts (hand-drawn meadow, player, bags, combat, the player's life, the content's creatures) plus the places
 * system wired as in `createSimulation`, on a `PlaceWorld` the test draws: four slots with the content's layouts placed
 * unturned at fixed spots of the meadow – a farmstead (two wolves, two chests, the farmer's note), a shrine, a look-out
 * tower and a dig site. The layouts' objects are stamped into the drawn chunks like the chunk generator does.
 *
 * Map coordinates are relative to `OFFSET` (spieler-testwelt.ts); `PLACES` names each slot's centre on the drawn map.
 */
import type { PlaceLayoutDef } from '../../../src/content/places/schema';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { ItemStack } from '../../../src/game/items/stack';
import { PlacesSystem, type PlaceWorld } from '../../../src/game/places/system';
import type { Simulation } from '../../../src/game/sim';
import type { LocationSlot, LocationType } from '../../../src/world/gen/locations';
import { compileLayout, layoutCellAt, placementOf, STAMP_ALL } from '../../../src/world/gen/places';
import type { PlacePlacement } from '../../../src/world/gen/places/types';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { TILE_PX } from '../../../src/world/model/coords';
import { kreaturWelt, meadow, OFFSET, T, type KreaturWelt } from './kreatur-testwelt';

export { OFFSET, T };

/** The drawn places: slot id, location type, layout and centre (map tile). */
export const PLACES = {
  gehoeft: { slot: 0, type: 'gehoeft', layout: 'gehoeft_gruenhain_01', x: 14, y: 14 },
  schrein: { slot: 1, type: 'schrein', layout: 'schrein_gruenhain_01', x: 46, y: 12 },
  aussichtsturm: { slot: 2, type: 'aussichtsturm', layout: 'aussichtsturm_gruenhain_01', x: 46, y: 40 },
  buddelstelle: { slot: 3, type: 'buddelstelle', layout: 'buddelstelle_gruenhain_01', x: 14, y: 42 },
} as const satisfies Record<string, { slot: number; type: LocationType; layout: string; x: number; y: number }>;
/** Width and height of the drawn meadow [tiles]. */
export const MAP = { w: 60, h: 54 } as const;

/** A drop the places handed to the drop system. */
export interface Dropped {
  readonly stack: ItemStack;
  readonly x: number;
  readonly y: number;
}

/** The world of a place test. */
export interface OrteWelt extends KreaturWelt {
  readonly places: PlacesSystem;
  readonly slots: readonly LocationSlot[];
  readonly placements: readonly PlacePlacement[];
  readonly dropped: Dropped[];
  /** Puts the player on drawn tile (x, y) (teleport, one tick); returns the events of that tick. */
  goTo(x: number, y: number): Map<string, unknown[]>;
  /** Index of the first marker `mark` of the place in `slot`. */
  markerIndex(slot: number, mark: string, nth?: number): number;
  /** Puts the player beside marker `marker` of `slot` and uses it (`place.use`); returns the events of that tick. */
  use(slot: number, marker: number): Map<string, unknown[]>;
  /** The object id on world tile (tx, ty). */
  objectAt(tx: number, ty: number): string | null;
  /** The `commandRejected` reasons of an event map. */
  rejections(events: Map<string, unknown[]>): string[];
}

function slotOf(p: (typeof PLACES)[keyof typeof PLACES]): LocationSlot {
  const rule = { radius: p.type === 'gehoeft' ? 7 : p.type === 'buddelstelle' ? 1 : 3 };
  return { id: p.slot, type: p.type, variant: '', x: OFFSET + p.x, y: OFFSET + p.y, radius: rule.radius, level: 0, region: 0, biome: 'gruenhain', tier: 0, landmass: 0, link: -1 };
}

/** A place test world on a meadow of `MAP` tiles, the player on drawn tile `spawnAt` (far from every place by default). */
export function orteWelt(options: { spawnAt?: { x: number; y: number }; seed?: number } = {}): OrteWelt {
  const spawnAt = options.spawnAt ?? { x: 30, y: 27 };
  const k = kreaturWelt(meadow(MAP.w, MAP.h), spawnAt, options.seed ?? 1, 'inhalt');
  const ids = contentWorldIdTables();
  const slots = Object.values(PLACES).map(slotOf);
  const placements: PlacePlacement[] = Object.values(PLACES).map((p) => {
    const layout = compileLayout(CONTENT.collection('placeLayouts').get(p.layout) as PlaceLayoutDef);
    const slot = slots[p.slot] as LocationSlot;
    return placementOf(slot, layout, 0, false, slot.x - Math.floor(layout.w / 2), slot.y - Math.floor(layout.h / 2), () => STAMP_ALL);
  });
  // Stamp the layouts' objects into the drawn chunks (the chunk generator's job in the game).
  for (const p of placements) {
    const layout = compileLayout(CONTENT.collection('placeLayouts').get(p.layout) as PlaceLayoutDef);
    for (let v = 0; v < p.height; v++) {
      for (let u = 0; u < p.width; u++) {
        const cell = layoutCellAt(layout, p.rotation, p.mirror, u, v);
        const o = layout.object[cell];
        if (o === null || o === undefined) continue;
        const { chunk, i } = k.chunks.at(p.x0 + u, p.y0 + v);
        chunk.object[i] = ids.objects.runtimeId(o);
      }
    }
  }
  const world: PlaceWorld = {
    slots: () => slots,
    placements: () => placements,
    chunk: (_s, layer, cx, cy) => k.chunks.get(layer, cx, cy),
    objectRuntimeId: (id) => ids.objects.runtimeId(id),
  };
  const dropped: Dropped[] = [];
  const places = k.sim.addSystem(
    new PlacesSystem(k.sim, {
      player: k.player,
      creatures: k.creatures,
      collision: k.collision,
      catalog: k.inventory.bags.catalog,
      spill: (_s: Simulation, stack: ItemStack, _layer, x: number, y: number) => {
        dropped.push({ stack, x, y });
        return NULL_ENTITY;
      },
      world,
    }),
  );
  places.useConditions(k.life.conditions);
  const teleport = k.player.commands['player.teleport'];
  if (teleport === undefined) throw new Error('no player.teleport');
  const w: OrteWelt = Object.assign(k, {
    places,
    slots,
    placements,
    dropped,
    goTo(x: number, y: number): Map<string, unknown[]> {
      return k.run(1, [{ type: 'player.teleport', x: (OFFSET + x + 0.5) * TILE_PX, y: (OFFSET + y + 0.5) * TILE_PX, layer: 0 }]);
    },
    markerIndex(slot: number, mark: string, nth = 0): number {
      const markers = (placements[slot] as PlacePlacement).markers;
      let seen = 0;
      for (let i = 0; i < markers.length; i++) {
        if ((markers[i] as { mark: string }).mark !== mark) continue;
        if (seen++ === nth) return i;
      }
      throw new Error(`place ${slot} has no ${mark} #${nth}`);
    },
    use(slot: number, marker: number): Map<string, unknown[]> {
      const m = (placements[slot] as PlacePlacement).markers[marker];
      if (m === undefined) throw new Error(`place ${slot} has no marker ${marker}`);
      // Beside the mark (the tile south of it is walkable meadow or the layout's floor).
      k.run(1, [{ type: 'player.teleport', x: (m.tx + 0.5) * TILE_PX, y: (m.ty + 1.5) * TILE_PX, layer: 0 }]);
      return k.run(1, [{ type: 'place.use', place: slot, marker }]);
    },
    objectAt(tx: number, ty: number): string | null {
      const { chunk, i } = k.chunks.at(tx, ty);
      const id = chunk.object[i] as number;
      return id === 0 ? null : ids.objects.stringId(id);
    },
    rejections(events: Map<string, unknown[]>): string[] {
      return ((events.get('commandRejected') ?? []) as { reason: string }[]).map((e) => e.reason);
    },
  });
  return w;
}
