/**
 * Research (MASTERPROMPT §21 "Relikte → Forschungspult → Rezepte", "Karten von Orten (Kartentisch)"; docs/SPIEL.md §19
 * "Forschungspult", "Kartentisch"; M7-18): the research desk is a processing station (relic in, a blueprint out after its time,
 * src/content/recipes/forschung.ts) and the map table a crafting station (maps of the places) – both work through the stations
 * and crafting systems. What is new here is the use of what they make, two handlers of the item-use chain
 * (`ToolsSystem.addItemUse`, docs/SPIEL.md §17):
 *
 * - a **blueprint** (`bauplan` block) is read and used up: its unlock is granted with the source `bauplan:<item>`
 *   (`unlockGranted`; crafting shows the recipes it opens). Refused when it is known already (`alreadyUnlocked`).
 * - a **map** (`ortskarte` block) is unrolled and used up: the nearest place of its type that the player neither discovered nor
 *   saw on a map is revealed (`PlacesApi.reveal`, source `kartentisch` → `placeRevealed`, a map marker). Refused when there is
 *   none left (`noPlaceLeft`).
 */
import type { ItemDef } from '../../content/schema/item';
import { TILE_PX } from '../../world/model/coords';
import { discard } from '../inventory/ops';
import type { InventorySystem } from '../inventory/system';
import type { PlacesSystem } from '../places/system';
import type { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import type { UnlocksSystem } from '../unlocks/system';

/** The systems research works with. */
export interface ResearchDeps {
  readonly inventory: InventorySystem;
  readonly unlocks: Pick<UnlocksSystem, 'has' | 'grant'>;
  readonly places: Pick<PlacesSystem, 'nearestHidden' | 'reveal'>;
  readonly player: Pick<PlayerSystem, 'position'>;
}

/** Uses up one piece of the stack in the context's slot; the reason when that fails. */
function useUp(sim: Simulation, deps: ResearchDeps, ctx: ItemUseContext): ItemUseOutcome | null {
  const inv = deps.inventory;
  const consumed = discard(inv.state, inv.bags.catalog, ctx.slot, 1);
  if (!consumed.ok) return { reject: consumed.reason };
  inv.bags.replace(consumed.state);
  sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
  return null;
}

/** The item uses of research: blueprints and maps. */
export function researchItemUses(deps: ResearchDeps): ItemUseHandler[] {
  const at = { x: 0, y: 0 };
  const blueprint: ItemUseHandler = {
    id: 'bauplan',
    handles: (def: ItemDef) => def.bauplan !== undefined,
    use: (sim, ctx) => {
      const unlock = ctx.def.bauplan?.freischaltung;
      if (unlock === undefined) return 'pass';
      if (deps.unlocks.has(unlock)) return { reject: 'alreadyUnlocked' };
      const refused = useUp(sim, deps, ctx);
      if (refused !== null) return refused;
      deps.unlocks.grant(sim, unlock, `bauplan:${ctx.def.id}`);
      return 'used';
    },
  };
  const map: ItemUseHandler = {
    id: 'ortskarte',
    handles: (def: ItemDef) => def.ortskarte !== undefined,
    use: (sim, ctx) => {
      const type = ctx.def.ortskarte?.ortstyp;
      if (type === undefined) return 'pass';
      if (!deps.player.position(sim, at)) return { reject: 'noPlayer' };
      // The places lie on the surface: a map unrolled underground shows the nearest one above the player's head.
      const slot = deps.places.nearestHidden(type, 0, Math.floor(at.x / TILE_PX), Math.floor(at.y / TILE_PX));
      if (slot < 0) return { reject: 'noPlaceLeft' };
      const refused = useUp(sim, deps, ctx);
      if (refused !== null) return refused;
      deps.places.reveal(sim, slot, 'kartentisch');
      return 'used';
    },
  };
  return [blueprint, map];
}
