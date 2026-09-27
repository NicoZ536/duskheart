/**
 * Where the building site takes its items (MASTERPROMPT §16.6 "Blaupausen: Pläne ohne Material platzieren; mit Hammer
 * … fertigstellen, Material kommt aus Kisten im Umkreis"; M4-24, M4-25): the build grid's material source
 * (`BuildingSystem.useMaterials`) for finishing a blueprint, upgrading a part in place and repairing an area – the
 * carried bags first (usable pieces only), then the chests within `BALANCE.storage.blueprintChestTiles` of the part,
 * nearest first (the storage system raises `chestTaken` with `bau`).
 */
import { BALANCE } from '../../content/balance';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { BuildMaterialSource } from '../building/system';
import { takeUsable, usableCount } from '../crafting/formulas';
import type { InventorySystem } from '../inventory/system';
import type { Simulation } from '../sim';
import type { StorageSystem } from '../storage/system';

/** Radius around a part within which its chests count [px]. */
const CHEST_RADIUS_PX = BALANCE.storage.blueprintChestTiles * TILE_PX;

/** Centre of tile `t` [px]. */
function centre(t: number): number {
  return (t + 1 / 2) * TILE_PX;
}

/** The bags and the chests near the part: the material source of the build grid. */
export function blueprintMaterials(deps: { readonly inventory: InventorySystem; readonly storage: StorageSystem }): BuildMaterialSource {
  const { inventory, storage } = deps;
  const count = (item: string, layer: Layer, tx: number, ty: number): number => usableCount(inventory.state, item) + storage.countNear(item, layer, centre(tx), centre(ty), CHEST_RADIUS_PX);
  return {
    count: (_sim, item, layer, tx, ty) => count(item, layer, tx, ty),
    take: (sim: Simulation, item, n, layer, tx, ty) => {
      if (n < 1 || count(item, layer, tx, ty) < n) return false;
      const fromBags = Math.min(n, usableCount(inventory.state, item));
      if (fromBags > 0) {
        const taken = takeUsable(inventory.state, item, fromBags);
        if (taken === null) throw new Error(`blueprintMaterials: ${fromBags} × "${item}" counted but not taken`);
        inventory.bags.replace(taken.state);
        sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
      }
      const rest = n - fromBags;
      if (rest > 0 && storage.takeNear(sim, item, rest, layer, centre(tx), centre(ty), CHEST_RADIUS_PX, 'bau') === null) throw new Error(`blueprintMaterials: ${rest} × "${item}" counted in chests but not taken`);
      return true;
    },
  };
}
