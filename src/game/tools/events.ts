/**
 * Events of using items (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback"; M3-15,
 * M3-16). `itemUsed`: an item was used from slot `from` – `heilen` (a bandage ended a condition),
 * `ausgiessen` (a bucket of water poured out over the player at (x, y) on `layer`), `zuschuetten` (earth filled
 * the dug tile whose centre is (x, y) back in, M4-40). The presentation plays the item's own sound
 * (`sounds.benutzen`) and shows the effect (a splash of water); a bucket worn out by the pour raises `itemBroken`
 * (src/game/equipment/events.ts).
 */
import type { Layer } from '../../world/model/coords';
import type { SlotRef } from '../items/slots';

/** What using an item did. */
export const ITEM_USES = ['heilen', 'ausgiessen', 'zuschuetten'] as const;
/** One kind of item use. */
export type ItemUseEffect = (typeof ITEM_USES)[number];

/**
 * Why `player.useItem` was refused (eating and drinking are refused by the actions system): earth has nothing dug to
 * fill on its tile (`nothingToFill`), or the tile named lies beyond reach (`outOfReach`; M4-40).
 */
export const TOOL_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'notUsable', 'nothingToCure', 'nothingToFill', 'outOfReach'] as const;
/** One rejection reason of using an item. */
export type ToolRejectReason = (typeof TOOL_REJECT_REASONS)[number];

export interface ToolEventMap {
  itemUsed: {
    readonly item: string;
    readonly from: SlotRef;
    readonly use: ItemUseEffect;
    /** Conditions the use ended (`heilen`). */
    readonly cured: readonly string[];
    readonly layer: Layer;
    readonly x: number;
    readonly y: number;
    readonly tick: number;
  };
}

/** Event names of `ToolEventMap`. */
export const TOOL_EVENT_TYPES = ['itemUsed'] as const satisfies ReadonlyArray<keyof ToolEventMap>;
