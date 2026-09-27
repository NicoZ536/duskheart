/**
 * The campfire as a station (MASTERPROMPT §15.2 "Lagerfeuer"; docs/SPIEL.md §8 "`lagerfeuer` (als Station)";
 * M4-05). The light system keeps placed campfires with their fuel and flame (src/game/light); a recipe of a
 * station that works only while it burns (`brennt`, src/content/stations.ts) is at hand where a lit fire
 * stands within reach – the embers char wood into charcoal. `campfireStations` is the crafting system's
 * station provider for them (src/game/setup.ts registers it).
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { StationAtHand, StationProvider } from '../crafting/sources';
import type { StationCatalog } from './catalog';

/** Where lit fires burn: the id of the nearest lit fire within `radiusTiles` of (x, y) on `layer`, 0 if none. */
export interface FireSource {
  cookingFireNear(layer: Layer, x: number, y: number, radiusTiles: number): number;
}

/** Station provider for the burning stations (`brennt`): a lit fire of `fires` within reach. */
export function campfireStations(fires: FireSource, stations: StationCatalog): StationProvider {
  const burning = stations.list.filter((s) => s.brennt === true);
  return (_sim, layer, x, y, radiusPx, station, exact = false) => {
    let best: StationAtHand | null = null;
    for (const s of burning) {
      if ((exact ? s.id !== station : !stations.satisfies(station, s.id)) || fires.cookingFireNear(layer, x, y, radiusPx / TILE_PX) === 0) continue;
      const stage = stations.stage(s.id);
      if (best === null || stage.qualitaet > best.qualitaet) best = { station: s.id, platz: 0, tempo: stage.tempo, qualitaet: stage.qualitaet };
    }
    return best;
  };
}
