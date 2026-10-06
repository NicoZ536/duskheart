/**
 * E at a way stone (MASTERPROMPT §25 "Schnellreise … Wegsteinen"; docs/SPIEL.md §22 "Schnellreise"; M7-37): "Reisen:
 * Wegstein" opens the travel screen (`travel.open`, so every refusal is that command's). The lit beacon offers the same
 * through its own use target (src/game/beacons/uses.ts); a burning hearth through its screen.
 */
import type { Layer } from '../../world/model/coords';
import type { BuildingSystem } from '../building/system';
import { setOffer, type UseOffer, type UseProvider } from '../interaction/uses';
import type { TravelSystem } from './system';
import { WAYSTONE_PART } from './system';

/** The way stones of the build grid as use targets. */
export function waystoneUses(travel: TravelSystem, building: Pick<BuildingSystem, 'partAt'>): UseProvider {
  const open = travel.commands['travel.open'];
  if (open === undefined) throw new Error('waystoneUses: no handler for travel.open');
  return {
    offer: (_sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      if (building.partAt(layer, 'objekt', tx, ty)?.id !== WAYSTONE_PART) return false;
      setOffer(out, 'reisen', WAYSTONE_PART, null, tx, ty);
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      if (building.partAt(layer, 'objekt', tx, ty)?.id === WAYSTONE_PART) open(sim, { type: 'travel.open' }, tick);
    },
  };
}
