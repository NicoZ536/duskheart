/**
 * Traps (MASTERPROMPT §14 "Fallen (Schlinge, Kastenfalle)"; docs/SPIEL.md §11 "Beute, Jagen, Fallen"; M6-30): which
 * creatures a set trap catches and how often. The id is the trap item (src/content/items/jagd.ts); the trap system is
 * src/game/creatures/traps.ts.
 *
 * - A creature that is `fangbar` and no larger than `groesseMax` walking into a set trap is caught with `chance`.
 * - A trap in a frozen chunk catches analytically: once `fangStunden` (drawn when it was set) have passed and its chunk
 *   holds such a creature (docs/ARCHITEKTUR.md "Aufholen").
 */
import { defineCreatureRecords } from './define';
import { trapSchema } from './schema';

/** Every trap, validated and frozen. */
export const TRAPS = defineCreatureRecords('traps', trapSchema, [
  // The snare is quick to make and holds every other time; small game may slip it.
  { id: 'schlinge', groesseMax: 16, chance: 0.5, fangStunden: [4, 12] },
  // The box trap's door falls reliably behind anything small enough to walk in.
  { id: 'kastenfalle', groesseMax: 16, chance: 0.9, fangStunden: [2, 8] },
]);
