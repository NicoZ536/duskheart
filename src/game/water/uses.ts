/**
 * E at water things (MASTERPROMPT §11.4 "Interagieren (E)", §18; docs/SPIEL.md §21 "E füllt Eimer/Schlauch"; M7-30): use targets
 * of the interaction system for the rain collector and – with a water skin in the hand – fresh water.
 * - A rain collector: "Füllen: <vessel>" with a water skin, a bucket of boiled water or an empty bucket in the hand (blocked when
 *   the vessel is full or the collector dry), else "Trinken: Regensammler" (blocked when dry).
 * - Fresh water with the water skin in the hand: "Füllen: Trinkschlauch" (only on the aimed tile; the sea is salty, a full skin
 *   is full). Without a skin the water's own use (drinking at the bank) answers.
 * Every use runs through the water's commands (`water.fill`, `water.drink`), so every refusal is that command's.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { UseOffer, UseProvider } from '../interaction/uses';
import { slotAt } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { ItemCatalog } from '../items/catalog';
import { collectorSips, EMPTY_BUCKET, isVessel, vesselSips } from './formulas';
import type { WaterSystem } from './system';
import { BALANCE } from '../../content/balance';
import { RAIN_COLLECTOR } from '../../content/items/wasser';

/** The water's use targets. */
export function waterUses(water: WaterSystem, inventory: InventorySystem, catalog: ItemCatalog): UseProvider {
  const fill = water.commands['water.fill'];
  const drink = water.commands['water.drink'];
  if (fill === undefined || drink === undefined) throw new Error('waterUses: the water system handles no water.fill / water.drink');
  /** The vessel in the hand (an empty bucket counts at a collector), or `null`. */
  const hand = (): { id: string; sips: number; max: number; empty: boolean } | null => {
    const s = slotAt(inventory.state, { bereich: 'schnellleiste', index: inventory.state.auswahl });
    if (s === null) return null;
    const def = catalog.get(s.item);
    if (def.id === EMPTY_BUCKET) return { id: def.id, sips: 0, max: BALANCE.water.boiled.sips, empty: true };
    if (!isVessel(def)) return null;
    return { id: def.id, sips: vesselSips(s, def), max: def.ladungen?.max ?? 0, empty: false };
  };
  return {
    offer: (_sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const c = water.collectorAt(layer, tx, ty);
      const h = hand();
      if (c !== undefined) {
        const sips = collectorSips(c.fill);
        out.x = (tx + 1 / 2) * TILE_PX;
        out.y = (ty + 1 / 2) * TILE_PX;
        out.detail = null;
        out.aimedOnly = false;
        if (h !== null) {
          out.action = 'fuellen';
          out.subject = h.id;
          out.block = h.empty ? (sips < BALANCE.water.collector.sipsPerBucket ? 'sammlerLeer' : null) : h.sips >= h.max ? 'gefaessVoll' : sips < 1 ? 'sammlerLeer' : null;
        } else {
          out.action = 'trinken';
          out.subject = RAIN_COLLECTOR;
          out.block = sips < 1 ? 'sammlerLeer' : null;
        }
        return true;
      }
      if (h === null || h.empty || h.id !== 'trinkschlauch') return false;
      const w = water.freshWaterAt(layer, tx, ty);
      if (w === null) return false;
      out.action = 'fuellen';
      out.subject = h.id;
      out.detail = null;
      out.x = (tx + 1 / 2) * TILE_PX;
      out.y = (ty + 1 / 2) * TILE_PX;
      out.aimedOnly = true;
      out.block = w === 'meer' ? 'salzwasser' : w === 'eis' ? 'gefroren' : h.sips >= h.max ? 'gefaessVoll' : null;
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      const c = water.collectorAt(layer, tx, ty);
      if (c === undefined || hand() !== null) fill(sim, { type: 'water.fill', tx, ty }, tick);
      else drink(sim, { type: 'water.drink', tx, ty }, tick);
    },
  };
}
