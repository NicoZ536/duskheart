/**
 * Filling dug ground back in with E (M4-40; ADR-0042 "Zuschütten eines Grabens mit Erde"): with earth
 * (`DIG_REFILL_ITEM`) in the hand, a pit, a path, a dry trench or a water ditch on the aimed tile or the tile ahead –
 * like digging, never a side effect of the nearest tile – is a use target of the interaction system: "Zuschütten:
 * Trockengraben", named like digging names it. E uses the earth through `player.useItem` on that tile, so the tools
 * system fills it (the gathering system restores the tile's generated ground) and raises its refusals and `itemUsed`.
 * `createSimulation` registers it before the other use targets: with earth in the hand, filling a water ditch wins over
 * drinking from it.
 */
import { DIG_REFILL_ITEM } from '../../content/terrain';
import type { Layer } from '../../world/model/coords';
import type { GatheringSystem } from '../gathering/system';
import type { InventorySystem } from '../inventory/system';
import { setOffer, type UseOffer, type UseProvider } from '../interaction/uses';
import type { Simulation } from '../sim';
import type { ToolsSystem } from './system';

/** Dug tiles as use targets while earth is in the hand: fill them back in. */
export function refillUses(tools: ToolsSystem, gathering: Pick<GatheringSystem, 'refillable'>, inventory: Pick<InventorySystem, 'selected'>): UseProvider {
  const useItem = tools.commands['player.useItem'];
  if (useItem === undefined) throw new Error('refillUses: no handler for player.useItem');
  return {
    offer: (sim: Simulation, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      if (inventory.selected()?.item !== DIG_REFILL_ITEM) return false;
      const kind = gathering.refillable(sim, layer, tx, ty);
      return kind !== null && setOffer(out, 'zuschuetten', kind, null, tx, ty, true);
    },
    use: (sim, _layer, tx, ty, tick) => useItem(sim, { type: 'player.useItem', tx, ty }, tick),
  };
}
