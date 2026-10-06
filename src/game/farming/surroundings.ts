/**
 * The surroundings of the plots in the game (src/game/farming/system.ts `FarmSurroundings`, docs/SPIEL.md §20): a greenhouse
 * is a room of type `gewaechshaus` (rooms system), an enclosure the fence ring of `RoomsSystem.enclosedAt`, a scarecrow the
 * build part `vogelscheuche` on the object layer within the radius.
 */
import { SCARECROW_PART } from '../../content/bauteileFeld';
import type { Layer } from '../../world/model/coords';
import type { BuildingSystem } from '../building/system';
import type { RoomsSystem } from '../rooms/system';
import type { FarmSurroundings } from './system';

/** Furniture category of the garden beds: a placed bed is a plot (src/content/bauteileFeld.ts). */
export const FARM_BED_CATEGORY = 'beet';
/** Room type whose plots ignore season and frost (src/content/roomTypes.ts). */
export const GREENHOUSE_ROOM = 'gewaechshaus';

/** The surroundings over the rooms and the build grid. */
export function farmSurroundings(rooms: Pick<RoomsSystem, 'roomAt' | 'enclosedAt'>, building: Pick<BuildingSystem, 'partAt'>): FarmSurroundings {
  return {
    greenhouseAt: (sim, layer, tx, ty) => rooms.roomAt(sim, layer, tx, ty)?.type?.id === GREENHOUSE_ROOM,
    enclosedAt: (_sim, layer, tx, ty) => rooms.enclosedAt(layer, tx, ty),
    scarecrowNear(layer: Layer, tx: number, ty: number, radius: number): boolean {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          if (building.partAt(layer, 'objekt', tx + dx, ty + dy)?.id === SCARECROW_PART) return true;
        }
      }
      return false;
    },
  };
}
