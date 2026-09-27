/**
 * E on a station (MASTERPROMPT §11.4 "Interagieren (E)", §15.1, §15.2; M4-05 … M4-07): a use target of the interaction
 * system – "Benutzen: Werkbank" on every tile of its footprint – that opens the station's screen through `station.use`
 * (`stationOpened`; every refusal is that command's). The campfire station is the light system's camp fire, which E
 * feeds and lights.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { UseOffer, UseProvider } from '../interaction/uses';
import type { StationSystem } from './system';

/** The placed stations as use targets: use. */
export function stationUses(stations: StationSystem): UseProvider {
  const use = stations.commands['station.use'];
  if (use === undefined) throw new Error('stationUses: no handler for station.use');
  return {
    offer: (_sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const p = stations.stationAt(layer, tx, ty);
      if (p === undefined) return false;
      const size = stations.footprintOf(p);
      out.action = 'benutzen';
      out.subject = p.station;
      out.block = null;
      out.detail = null;
      out.x = (p.tx + size.b / 2) * TILE_PX;
      out.y = (p.ty + size.t / 2) * TILE_PX;
      out.aimedOnly = false;
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      const p = stations.stationAt(layer, tx, ty);
      if (p !== undefined) use(sim, { type: 'station.use', station: p.id }, tick);
    },
  };
}
