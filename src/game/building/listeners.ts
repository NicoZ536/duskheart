/**
 * What the build grid tells the systems whose things stand on it (MASTERPROMPT §16.1 "Objekte (1×1 bis 4×4)",
 * §15.2, §12.2; M4-05, M4-06, M4-19): part listeners of the building system (`addPartListener`) that hand a placed or
 * removed part to the system keeping its state.
 *
 * - **Stations as parts** (`stationGridListener`): a part whose item is a station starts working as that station
 *   (`StationSystem.attach`, with its footprint turned as it stands) and stops when it leaves the grid (`detach`: what
 *   lies in its slots goes into the bags); an upgrade recipe that turns the station into its next stage (Werkbank I →
 *   II) swaps the part in place (`addUpgradeListener`, `BuildingSystem.swapPart`); `station.remove` leaves such a
 *   station to the grid (`addBuiltIn`: taken down in build mode, its part the refund), and the grid keeps a station
 *   part at which a crafting order is worked standing (`addRemovalRule`: `inUse`, the rule of `station.remove`). The
 *   stations of M4 are set up by `station.place`; a station that is a build part (the grid's catalog lists it) runs
 *   through here.
 * - **Furniture lights** (`furnitureLightListener`): lamps and the stone fireplace become lights of the light system
 *   (`LightSystem.placeFurniture` / `removeFurniture`) – whatever took the part down (dismantled, burned, replaced,
 *   fallen off its wall; the reason decides where a lamp's fuel goes).
 *
 * Chests and the hearth fire register their own listeners (src/game/storage, src/game/hearth); beds only answer
 * queries (src/game/rooms, src/game/building/beds.ts).
 */
import type { Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import { cellRot, rotatedSize } from '../../world/structures/cells';
import type { LightSystem } from '../light/system';
import type { StationSystem } from '../stations/system';
import type { BuildingSystem, PartListener } from './system';

/** The footprint of the part anchored on (tx, ty) of `layer` as it stands (turned by its rotation). */
function footprint(building: BuildingSystem, part: PartDef, layer: Layer, tx: number, ty: number): { w: number; h: number } {
  return rotatedSize(part.w, part.h, cellRot(building.structures.cell(layer, part.layerIndex, tx, ty)));
}

/**
 * Connects the stations to the build grid: station parts attach and detach, upgrades swap the part. Returns the
 * part listener (registered here already).
 */
export function stationGridListener(building: BuildingSystem, stations: StationSystem): PartListener {
  const listener: PartListener = {
    placed: (sim, part, layer, tx, ty) => {
      if (!stations.stations.has(part.id)) return;
      const size = footprint(building, part, layer, tx, ty);
      stations.attach(sim, part.id, layer, tx, ty, { b: size.w, t: size.h });
    },
    removed: (sim, part, layer, tx, ty) => {
      if (stations.stations.has(part.id)) stations.detach(sim, layer, tx, ty);
    },
  };
  building.addPartListener(listener);
  // A station part comes down with its part (build mode), never alone through `station.remove`.
  stations.addBuiltIn((st) => building.partAt(st.layer, 'objekt', st.tx, st.ty)?.id === st.station);
  // …and not while a crafting order is worked at it (`inUse`, the rule of `station.remove`, ADR-0046).
  building.addRemovalRule((_sim, part, layer, tx, ty) => stations.partRemovalProblem(part, layer, tx, ty));
  stations.addUpgradeListener((sim, station, from, to) => {
    if (building.partAt(station.layer, 'objekt', station.tx, station.ty)?.id === from) building.swapPart(sim, station.layer, 'objekt', station.tx, station.ty, to);
  });
  return listener;
}

/** Connects the furniture lights to the build grid (registered here already); returns the part listener. */
export function furnitureLightListener(building: BuildingSystem, light: LightSystem): PartListener {
  const listener: PartListener = {
    placed: (sim, part, layer, tx, ty) => {
      const size = footprint(building, part, layer, tx, ty);
      light.placeFurniture(sim, part.id, layer, tx, ty, size.w, size.h);
    },
    removed: (sim, _part, layer, tx, ty, reason) => {
      light.removeFurniture(sim, layer, tx, ty, reason);
    },
  };
  building.addPartListener(listener);
  return listener;
}
