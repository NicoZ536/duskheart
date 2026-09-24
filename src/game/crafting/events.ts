/**
 * Events of crafting (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback", §15.1;
 * M3-16). The presentation maps them to sounds (`CRAFTING_SFX`, a recipe's own `sound` for the finished
 * piece), particles at the player and notifications; the UI reads the queue from the crafting system.
 *
 * - `recipeDiscovered`: a recipe became visible (every ingredient owned once, station known, or its
 *   blueprint learned) – notification "Neues Rezept".
 * - `craftQueued`: an order of `count` pieces joined the queue at position `index`.
 * - `craftStarted`: work on one piece began (it takes `ticks`).
 * - `craftCompleted`: one piece is done; `count` items of `item` went into the bags (or, when they were
 *   full, onto the ground at the player's feet – `inventoryFull`, `dropSpawned`).
 * - `craftCancelled`: an order was cancelled (`abgebrochen`: by the player; `tod`: the player died) and
 *   its reserved ingredients of `pieces` pieces went back.
 */
import type { RecipeDef } from '../../content/recipes/schema';

/** Why a crafting command was refused. */
export const CRAFT_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'unknownRecipe', 'recipeHidden', 'notEnough', 'queueFull', 'noStation', 'noWater', 'noOrder'] as const;
/** One rejection reason of crafting. */
export type CraftRejectReason = (typeof CRAFT_REJECT_REASONS)[number];

/** Why an order ended before all pieces were made. */
export type CraftCancelReason = 'abgebrochen' | 'tod';

export interface CraftingEventMap {
  recipeDiscovered: { readonly recipe: string; readonly tick: number };
  craftQueued: { readonly recipe: string; readonly count: number; readonly index: number; readonly tick: number };
  craftStarted: { readonly recipe: string; readonly ticks: number; readonly tick: number };
  craftCompleted: { readonly recipe: string; readonly item: string; readonly count: number; readonly tick: number };
  craftCancelled: { readonly recipe: string; readonly pieces: number; readonly reason: CraftCancelReason; readonly tick: number };
}

/** Event names of `CraftingEventMap`. */
export const CRAFTING_EVENT_TYPES = ['recipeDiscovered', 'craftQueued', 'craftStarted', 'craftCompleted', 'craftCancelled'] as const satisfies ReadonlyArray<keyof CraftingEventMap>;

/**
 * Sounds of crafting (`sfx_<bereich>_<name>`, presets of the audio kernel): the knocking and binding of the
 * work on a piece, the chime of a finished piece (a recipe's `sound` replaces it, e.g. scooping water), a
 * cancelled order, the notification of a new recipe and the click of a queued order.
 */
export const CRAFTING_SFX = {
  working: 'sfx_handwerk_arbeiten',
  done: 'sfx_handwerk_fertig',
  cancelled: 'sfx_aktion_abbruch',
  discovered: 'sfx_ui_meldung',
  queued: 'sfx_ui_klick',
} as const;

/** Sound of a finished piece of `recipe`: its own `sound` (filling a bucket scoops water) or the crafting chime. */
export function craftCompletedSound(recipe: Pick<RecipeDef, 'sound'> | undefined): string {
  return recipe?.sound ?? CRAFTING_SFX.done;
}
