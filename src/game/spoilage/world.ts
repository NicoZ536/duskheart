/**
 * The world as spoilage reads it in the game (src/game/setup.ts; docs/SPIEL.md §21 "Verderb"): the active zone, the room of a
 * tile (its type for the store room and the ice cellar, whether it is an interior – winter's factor counts only outdoors), the
 * resident chunk of a tile (its biome: a hot biome spoils faster) and the biome names of the world's runtime ids.
 */
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { Simulation } from '../sim';
import type { SpoilageWorld } from './system';

/** A room as spoilage reads it (`RoomInfo` of the rooms system). */
export interface SpoilageRoom {
  readonly type: { readonly id: string } | null;
  readonly region: { readonly interior: boolean };
}

/** The rooms system as spoilage reads it. */
export interface SpoilageRooms {
  roomAt(sim: Simulation, layer: Layer, tx: number, ty: number): SpoilageRoom | null;
}

/** Whether chunk (layer, cx, cy) of the simulation's own world is in the active zone. */
export function simActiveZone(sim: Simulation, layer: Layer, cx: number, cy: number): boolean {
  return sim.world.materialized && sim.world.zone.isActive(layer, cx, cy);
}

/** The resident chunk of tile (tx, ty) of `layer` in the simulation's own world, or `undefined`. */
function simChunkAt(sim: Simulation, layer: Layer, tx: number, ty: number): ChunkData | undefined {
  return sim.world.materialized ? sim.world.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT) : undefined;
}

/** The world of spoilage over the simulation's own world and the rooms system. */
export function gameSpoilageWorld(rooms: SpoilageRooms): SpoilageWorld {
  return {
    active: simActiveZone,
    roomAt: (sim, layer, tx, ty, out) => {
      const room = rooms.roomAt(sim, layer, tx, ty);
      out.type = room?.type?.id ?? null;
      out.outdoors = room === null || !room.region.interior;
    },
    chunkAt: simChunkAt,
    biomeName: (id) => (id === 0 ? null : contentWorldIdTables().biomes.stringId(id)),
  };
}
