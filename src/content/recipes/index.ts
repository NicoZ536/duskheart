/**
 * All recipes (MASTERPROMPT §15; docs/SPIEL.md §6): the group files joined into the registry collection
 * `recipes` (src/content/index.ts; each record counts once as `recipes`, ADR-0006). A new group file
 * validates its records with `defineRecipeGroup` and adds one entry to `RECIPE_GROUPS`.
 */
import type { RecipeDef } from './schema';
import { GRUNDLAGEN_REZEPTE } from './grundlagen';

/** Recipe groups in registry order (one entry per group file). */
export const RECIPE_GROUPS = {
  grundlagen: GRUNDLAGEN_REZEPTE,
} as const satisfies Record<string, readonly RecipeDef[]>;

/** Every recipe, in group order. */
export const RECIPES: readonly RecipeDef[] = Object.values(RECIPE_GROUPS).flat();

export { defineRecipeGroup, RecipeGroupError } from './define';
export {
  isRecipeIdFor,
  RECIPE_ENVIRONMENTS,
  RECIPE_ID_PREFIX,
  recipeAmountSchema,
  recipeBlueprintSchema,
  recipeIdFor,
  recipeSchema,
  type RecipeAmount,
  type RecipeDef,
  type RecipeEnvironment,
  type RecipeInput,
} from './schema';
