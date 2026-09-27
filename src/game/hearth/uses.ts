/**
 * E on the hearth fire (MASTERPROMPT §11.4 "Interagieren (E)", §16.5; M4-20): a use target of the interaction system –
 * E opens its screen ("Öffnen: Herdfeuer", `hearth.use`: fuel store, lighting and dousing, cores, the overview of the
 * base), burning or cold, with or without fuel. Lighting is the screen's button (`hearth.ignite`): a cold hearth with
 * fuel stays open for taking the fuel out instead. Every refusal is that command's.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { UseOffer, UseProvider } from '../interaction/uses';
import { HEARTH_ITEM, type HearthSystem } from './system';

/** The hearths as use targets: E opens one. */
export function hearthUses(hearth: HearthSystem): UseProvider {
  const open = hearth.commands['hearth.use'];
  if (open === undefined) throw new Error('hearthUses: no handler for hearth.use');
  return {
    offer: (_sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const h = hearth.hearthAt(layer, tx, ty);
      if (h === undefined) return false;
      out.action = 'oeffnen';
      out.subject = HEARTH_ITEM;
      out.block = null;
      out.detail = null;
      out.x = (h.tx + h.w / 2) * TILE_PX;
      out.y = (h.ty + h.h / 2) * TILE_PX;
      out.aimedOnly = false;
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      const h = hearth.hearthAt(layer, tx, ty);
      if (h !== undefined) open(sim, { type: 'hearth.use', hearth: h.id }, tick);
    },
  };
}
