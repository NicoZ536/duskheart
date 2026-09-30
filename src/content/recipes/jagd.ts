/**
 * Recipes of the traps (MASTERPROMPT §14 "Fallen (Schlinge, Kastenfalle)"; docs/SPIEL.md §11 "Beute, Jagen, Fallen"; M6-30):
 * both are made at the workbench, the first station (§15.2).
 *
 * - **Schlinge**: a running noose of fibre rope on a sharpened twig – the trap of the first days.
 * - **Kastenfalle**: a box of logs with a drop door, rope for the hinge and sinew for the trigger – it needs a first
 *   hunt (sinew from carving, src/content/creatures/beute.ts), and catches far more reliably.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the traps. */
export const JAGD_REZEPTE = defineRecipeGroup('jagd', [
  recipe({ item: 'schlinge', zutaten: { faserseil: 2, zweig: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'kastenfalle', zutaten: { holz: 6, faserseil: 1, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
