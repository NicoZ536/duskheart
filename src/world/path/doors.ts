/**
 * Doors for the path finding (M6-17, §19.4 "Türen (für bestimmte Gegner brechbar)"; docs/SPIEL.md §11 "Steuerung"):
 * where a closed door or gate stands, so that a creature that opens or breaks doors (`PathRequest.opensDoors`) may
 * plan through it while the others go round. The collision grid only knows that the tile is solid; the building's
 * structure store knows that it is a door.
 */
import type { Layer } from '../model/coords';
import type { PartCatalog } from '../structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellOpen, cellPart } from '../structures/cells';
import type { StructureStore } from '../structures/store';

/** Where closed doors stand. */
export interface PathDoorSource {
  /** Whether a closed (built, not blueprint) door or gate stands on the tile. */
  closedDoorAt(layer: Layer, tx: number, ty: number): boolean;
  /** Quick test per chunk: `false` when no door can stand in it (nothing built there). */
  mayHaveDoors(layer: Layer, cx: number, cy: number): boolean;
}

/** Index of the structure layer (walls, doors, gates). */
const STRUCTURE_LAYER = BUILD_LAYER_INDEX.struktur;

/** Doors of the building grid (src/world/structures): doors and gates in the structure layer that stand closed. */
export function structureDoorSource(store: StructureStore, catalog: PartCatalog): PathDoorSource {
  return {
    closedDoorAt(layer, tx, ty) {
      const cell = store.cell(layer, STRUCTURE_LAYER, tx, ty);
      if (cell === 0 || cellOpen(cell) || cellBlueprint(cell)) return false;
      const kind = catalog.byRuntimeId(cellPart(cell))?.kind;
      return kind === 'tuer' || kind === 'tor';
    },
    mayHaveDoors(layer, cx, cy) {
      return store.chunk(layer, cx, cy) !== undefined;
    },
  };
}
