/**
 * Recipes of the Borkenvater's spoils (MASTERPROMPT §13.2 "Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des
 * Bosses dieser Stufe"; docs/SPIEL.md §22 "Drops `kernholz` (Gating: nur `rezept_bronzespitzhacke` braucht es, §13.2)";
 * M7-34): the bronze pickaxe – three bronze bars hammered at the bronze anvil onto a haft of the Borkenvater's Kernholz. The
 * gating check (tools/validator/gating.ts over src/content/gating.ts) proves no other way to the T1 pickaxe exists and no
 * weapon or armour needs the boss drop.
 */
import { defineRecipeGroup, recipe } from './define';

/** The bronze pickaxe. */
export const BORKENVATER_REZEPTE = defineRecipeGroup('borkenvater', [recipe({ item: 'bronzespitzhacke', zutaten: { bronzebarren: 3, kernholz: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' })]);
