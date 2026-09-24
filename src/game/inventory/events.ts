/**
 * Events of the bags (aggregated into `SimEventMap`, src/game/sim.ts) – the feedback hooks of every
 * bag action (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback"): the UI redraws
 * the bags and flashes the changed slots, the audio plays the SFX of `INVENTORY_FEEDBACK_SFX`.
 * A refused command raises `commandRejected` with an `InventoryRejectReason` instead.
 */
import type { SlotRef } from '../items/slots';

export type { InventoryRejectReason } from './ops';

/** Why `inventory.give` was refused: the item catalog has no such item. */
export type InventoryGiveRejectReason = 'unknownItem';

/** What changed the bags. */
export const INVENTORY_CHANGES = ['add', 'remove', 'move', 'split', 'collect', 'sort', 'quickMove', 'discard'] as const;
/** One kind of bag change. */
export type InventoryChange = (typeof INVENTORY_CHANGES)[number];

/** Bag events by name (payloads carry the tick that produced them). */
export interface InventoryEventMap {
  /** The bags changed (redraw; SFX by `change`). */
  inventoryChanged: { readonly change: InventoryChange; readonly tick: number };
  /** Items arrived in the bags (pick-up message "Feuerstein ×3", §26). */
  itemsAdded: { readonly item: string; readonly count: number; readonly tick: number };
  /** Items did not fit (§11.4 "volle Taschen → klarer Hinweis"). */
  inventoryFull: { readonly item: string; readonly count: number; readonly tick: number };
  /** Another hotbar slot is in the hand. */
  hotbarSelected: { readonly index: number; readonly tick: number };
  /** An equipment, belt or backpack slot got another item (`item` null = emptied). */
  equipmentChanged: { readonly at: SlotRef; readonly item: string | null; readonly tick: number };
}

/** Event names of `InventoryEventMap`. */
export const INVENTORY_EVENT_TYPES = ['inventoryChanged', 'itemsAdded', 'inventoryFull', 'hotbarSelected', 'equipmentChanged'] as const satisfies ReadonlyArray<keyof InventoryEventMap>;

/**
 * Sound of each bag action (docs/SPIEL.md §5 `sfx_<bereich>_<name>`; presets in M3-33). Picking up
 * plays the item's own `sounds.aufheben` instead.
 */
export const INVENTORY_FEEDBACK_SFX = {
  move: 'sfx_inventar_ablegen',
  split: 'sfx_inventar_teilen',
  collect: 'sfx_inventar_sammeln',
  sort: 'sfx_inventar_sortieren',
  quickMove: 'sfx_inventar_ablegen',
  discard: 'sfx_inventar_wegwerfen',
  remove: 'sfx_inventar_entnehmen',
  full: 'sfx_inventar_voll',
  hotbar: 'sfx_inventar_auswahl',
  equip: 'sfx_ausruestung_anlegen',
  unequip: 'sfx_ausruestung_ablegen',
  rejected: 'sfx_ui_fehler',
} as const;
