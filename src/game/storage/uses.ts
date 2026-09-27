/**
 * E on a chest (MASTERPROMPT §11.4 "Interagieren (E)", §16.7; M4-21): a use target of the interaction system – "Öffnen:
 * Holzkiste" – that opens the lid for the chest screen through `storage.open` (every refusal is that command's).
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { UseOffer, UseProvider } from '../interaction/uses';
import type { StorageSystem } from './system';

/** The chests as use targets: open. */
export function storageUses(storage: StorageSystem): UseProvider {
  const open = storage.commands['storage.open'];
  if (open === undefined) throw new Error('storageUses: no handler for storage.open');
  return {
    offer: (_sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const c = storage.chestAt(layer, tx, ty);
      if (c === undefined) return false;
      out.action = 'oeffnen';
      out.subject = c.item;
      out.block = null;
      out.detail = null;
      out.x = (c.tx + c.w / 2) * TILE_PX;
      out.y = (c.ty + c.h / 2) * TILE_PX;
      out.aimedOnly = false;
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      const c = storage.chestAt(layer, tx, ty);
      if (c !== undefined) open(sim, { type: 'storage.open', chest: c.id }, tick);
    },
  };
}
