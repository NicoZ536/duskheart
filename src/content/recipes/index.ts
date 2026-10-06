/**
 * All recipes (MASTERPROMPT §15; docs/SPIEL.md §6, §8): the group files joined into the registry collection
 * `recipes` (src/content/index.ts; each record counts once as `recipes`, ADR-0006), plus the ingredient
 * groups (`ingredientGroups`, gruppen.ts). A new group file validates its records with `defineRecipeGroup`
 * and adds one entry to `RECIPE_GROUPS`.
 */
import type { RecipeDef } from './schema';
import { BRONZE_REZEPTE } from './bronze';
import { GRUNDLAGEN_REZEPTE } from './grundlagen';
import { STATIONEN_REZEPTE } from './stationen';
import { VERARBEITUNG_REZEPTE } from './verarbeitung';
import { BAUTEIL_REZEPTE } from './bauteile';
import { BASIS_REZEPTE } from './basis';
import { MOEBEL_REZEPTE } from './moebel';
import { WAFFEN_REZEPTE, WAFFEN_REZEPTE_JAGD } from './waffen';
import { RUESTUNG_REZEPTE, RUESTUNG_REZEPTE_JAGD } from './ruestung';
import { JAGD_REZEPTE } from './jagd';
import { JAGD_GRUENHAIN_REZEPTE } from './jagd_gruenhain';
import { JAGD_KUESTE_REZEPTE } from './jagd_kueste';
import { TROPHAEEN_REZEPTE } from './trophaeen';
import { BORKENVATER_REZEPTE } from './borkenvater';
import { LUMEN_REZEPTE } from './lumen';
import { FELD_REZEPTE } from './feld';
import { FANG_REZEPTE } from './fang';
import { INSTRUMENTE_REZEPTE } from './instrumente';

/** Recipe groups in registry order (one entry per group file). */
export const RECIPE_GROUPS = {
  grundlagen: GRUNDLAGEN_REZEPTE,
  stationen: STATIONEN_REZEPTE,
  verarbeitung: VERARBEITUNG_REZEPTE,
  bronze: BRONZE_REZEPTE,
  // Build part items T0–T1 (M4-12, src/content/items/bauteile.ts).
  bauteile: BAUTEIL_REZEPTE,
  // Storage, the hearth fire and the splint (M4-20, M4-21, M4-35; src/content/recipes/basis.ts).
  basis: BASIS_REZEPTE,
  // Furniture, lights and decoration T0–T1 (M4-19; src/content/recipes/moebel.ts).
  moebel: MOEBEL_REZEPTE,
  // The armoury (M6-08 … M6-12, M6-31; src/content/recipes/waffen.ts, ruestung.ts).
  waffen: WAFFEN_REZEPTE,
  ruestung: RUESTUNG_REZEPTE,
  // … and what the armoury makes from the hunting goods (src/content/items/jagd.ts): bone weapons, arrows, the composite
  // bow, leather and everything sewn from it.
  waffen_jagd: WAFFEN_REZEPTE_JAGD,
  ruestung_jagd: RUESTUNG_REZEPTE_JAGD,
  // Traps (M6-30; src/content/recipes/jagd.ts, the creature strand).
  jagd: JAGD_REZEPTE,
  // Arrow poison from wasp stings (M6-22; src/content/recipes/jagd_gruenhain.ts, the Grünhain creature strand).
  jagd_gruenhain: JAGD_GRUENHAIN_REZEPTE,
  // Arrow poison from the jellyfish's stinging threads (M6 gate; src/content/recipes/jagd_kueste.ts).
  jagd_kueste: JAGD_KUESTE_REZEPTE,
  // Jewellery from the wolf's fangs and the boar's tusks (M6-30d; src/content/recipes/trophaeen.ts).
  trophaeen: TROPHAEEN_REZEPTE,
  // Strand F (M7-34, M7-36): the bronze pickaxe of the Kernholz; the Lumen workbench, lantern and waystone of the first beacon.
  borkenvater: BORKENVATER_REZEPTE,
  lumen: LUMEN_REZEPTE,
  // Strand D (M7-19 … M7-24): the watering can, compost, bone meal, herb brew, flax fibres, the compost box, the garden beds
  // and the scarecrow; the bone hook, the stick rod and the fish trap (src/content/recipes/feld.ts, fang.ts).
  feld: FELD_REZEPTE,
  fang: FANG_REZEPTE,
  // Strand A (M7-31): flute, lute, the net and the firefly jar.
  instrumente: INSTRUMENTE_REZEPTE,
} as const satisfies Record<string, readonly RecipeDef[]>;

/** Every recipe, in group order. */
export const RECIPES: readonly RecipeDef[] = Object.values(RECIPE_GROUPS).flat();

export { defineRecipeGroup, recipe, RecipeGroupError, type RecipeSpec } from './define';
export { defineIngredientGroups, INGREDIENT_GROUPS, IngredientGroupError, ingredientGroupSchema, type IngredientGroup, type IngredientGroupInput } from './gruppen';
export {
  concreteIngredients,
  isGroupIngredient,
  isRecipeIdFor,
  RECIPE_ENVIRONMENTS,
  RECIPE_ID_PREFIX,
  recipeAmountSchema,
  recipeBlueprintSchema,
  recipeGroupAmountSchema,
  recipeIdFor,
  recipeIngredientSchema,
  recipeSchema,
  type RecipeAmount,
  type RecipeDef,
  type RecipeEnvironment,
  type RecipeGroupAmount,
  type RecipeIngredient,
  type RecipeInput,
} from './schema';
