/**
 * What the blueprints of an area still need (MASTERPROMPT §16.6 "Blaupausen"; M4-24): per part the blueprints waiting
 * in a tile rectangle and the pieces at hand for them (the bags and the chests near the first of them) – the build
 * mode lists it, and the Siedler-Baumeister of M9 plans its fetching with it. Read-only.
 */
import { BUILD_LAYER_COUNT, cellBlueprint, cellCovered, cellPart } from '../../world/structures/cells';
import type { Layer } from '../../world/model/coords';
import type { BuildMaterialSource, BuildingSystem } from '../building/system';
import type { Simulation } from '../sim';

/** The blueprints of one part in an area. */
export interface BlueprintNeed {
  /** The part (= its item). */
  readonly part: string;
  /** Blueprints of it waiting [blueprints]. */
  readonly blueprints: number;
  /** Pieces at hand for the first of them [pieces]. */
  readonly atHand: number;
  /** Pieces still missing [pieces]. */
  readonly missing: number;
}

/** The blueprints anchored in the rectangle (tx0, ty0)–(tx1, ty1) of `layer`, per part in id order. */
export function blueprintNeeds(sim: Simulation, building: BuildingSystem, source: BuildMaterialSource, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number): BlueprintNeed[] {
  const found = new Map<string, { count: number; tx: number; ty: number }>();
  for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
    for (let ty = Math.min(ty0, ty1); ty <= Math.max(ty0, ty1); ty++) {
      for (let tx = Math.min(tx0, tx1); tx <= Math.max(tx0, tx1); tx++) {
        const cell = building.structures.cell(layer, li, tx, ty);
        if (cell === 0 || cellCovered(cell) || !cellBlueprint(cell)) continue;
        const part = building.catalog.byRuntimeId(cellPart(cell));
        if (part === undefined) continue;
        const f = found.get(part.id);
        if (f === undefined) found.set(part.id, { count: 1, tx, ty });
        else f.count++;
      }
    }
  }
  return [...found]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([part, f]) => {
      const atHand = source.count(sim, part, layer, f.tx, f.ty);
      return { part, blueprints: f.count, atHand, missing: Math.max(0, f.count - atHand) };
    });
}
