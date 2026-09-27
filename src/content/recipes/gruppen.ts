/**
 * Ingredient groups (MASTERPROMPT §15.1 "Zutaten konkret oder als Kategorie (Gemüse/Fleisch/Fisch …)"; M4-01):
 * a recipe may ask for "any wood" instead of one item – `{ gruppe, anzahl }` in its `zutaten`
 * (src/content/recipes/schema.ts). A group names its member items; one craft may mix them (two logs and two
 * pieces of driftwood make four). A group ingredient counts as owned once any member was owned (§15.1
 * visibility), the game takes the members in the group's order, a cancel refunds exactly the pieces taken.
 *
 * Registry collection `ingredientGroups` (src/content/index.ts); its `items[]` references make every member
 * usable as an ingredient (src/content/items/relations.ts). Every group is used by at least one recipe and
 * members never overlap with another ingredient of the same recipe (tests/unit/content/rezepte-t0-t1.test.ts,
 * the game's recipe book). Later cooking (§18) adds Gemüse, Fleisch, Fisch …
 */
import { z } from 'zod';
import { deepFreeze } from '../freeze';
import { idSchema, localizedTextSchema, refSchema } from '../schema/common';

/** Schema of one ingredient group. */
export const ingredientGroupSchema = z
  .object({
    id: idSchema,
    /** What a recipe shows for the ingredient ("Bauholz"). */
    name: localizedTextSchema,
    /** Which items belong to it, in taking order [item ids]. */
    items: z.array(refSchema).min(2),
  })
  .strict()
  .refine((g) => new Set(g.items).size === g.items.length, { message: 'members must be unique', path: ['items'] });

/** One ingredient group. */
export type IngredientGroup = z.output<typeof ingredientGroupSchema>;
/** Group data as written here. */
export type IngredientGroupInput = z.input<typeof ingredientGroupSchema>;

/** Error in the ingredient groups. */
export class IngredientGroupError extends Error {
  override readonly name = 'IngredientGroupError';
}

/** Validates ingredient groups (schema, unique ids) and freezes them. */
export function defineIngredientGroups(records: readonly IngredientGroupInput[]): readonly IngredientGroup[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = ingredientGroupSchema.safeParse(raw);
    if (!r.success) throw new IngredientGroupError(`Ingredient group [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new IngredientGroupError(`duplicate ingredient group "${r.data.id}"`);
    seen.add(r.data.id);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/** The ingredient groups of the game. */
export const INGREDIENT_GROUPS = defineIngredientGroups([
  {
    // Sawing and charring take any sound wood: split logs or the sun-dried driftwood of the beach.
    id: 'bauholz',
    name: { de: 'Bauholz (Holzscheit oder Treibholz)', en: 'Timber (log or driftwood)' },
    items: ['holz', 'treibholz'],
  },
]);
