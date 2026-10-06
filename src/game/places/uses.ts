/**
 * E at a place (MASTERPROMPT §11.4 "Interagieren (E)", §21; docs/SPIEL.md §18; M7-07 … M7-09): the marks of a discovered
 * or undiscovered place as use targets of the interaction system – "Öffnen: Alte Truhe", "Erklimmen: Aussichtsturm",
 * "Beten: Schrein" (blocked while the blessing cools down), "Lesen: Notiz" / "Lesen: Inschrift" – each through `place.use`,
 * so every refusal is that command's. An open chest offers nothing.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { UseOffer, UseProvider } from '../interaction/uses';
import type { PlacesSystem } from './system';

/** The places' marks as use targets. */
export function placeUses(places: PlacesSystem): UseProvider {
  const use = places.commands['place.use'];
  if (use === undefined) throw new Error('placeUses: no handler for place.use');
  const hit = { place: 0, marker: 0 };
  return {
    offer: (sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      if (layer !== 0 || !places.markerAtTile(sim, tx, ty, hit)) return false;
      const m = places.marker(hit.place, hit.marker);
      const def = places.defOf(hit.place);
      if (m === undefined || def === undefined) return false;
      out.block = null;
      out.detail = null;
      out.x = (m.tx + 0.5) * TILE_PX;
      out.y = (m.ty + 0.5) * TILE_PX;
      out.aimedOnly = false;
      switch (m.mark) {
        case 'truhe':
          if (places.chestOpen(hit.place, hit.marker)) return false;
          out.action = 'oeffnen';
          out.subject = 'ortstruhe';
          return true;
        case 'aussicht':
          if (def.wirkung !== 'aussicht') return false;
          out.action = 'erklimmen';
          out.subject = 'aussichtsturm';
          return true;
        case 'altar':
          if (def.wirkung !== 'segen') return false;
          out.action = 'beten';
          out.subject = 'schrein';
          if (!places.blessingReady(hit.place, sim.tick)) out.block = 'segenVerbraucht';
          return true;
        case 'tafel':
          if (def.wirkung !== 'tafel') return false;
          out.action = 'lesen';
          out.subject = def.id === 'friedhof' ? 'inschrift' : 'notiz';
          return true;
        default:
          return false;
      }
    },
    use: (sim, layer, tx, ty, tick) => {
      if (layer === 0 && places.markerAtTile(sim, tx, ty, hit)) use(sim, { type: 'place.use', place: hit.place, marker: hit.marker }, tick);
    },
  };
}
