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
import { checkContent } from '../check';

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
    const r = checkContent(ingredientGroupSchema, raw);
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
  {
    // Strand D (M7-20, docs/SPIEL.md §20 "Kompostkiste … Eingang Gruppe kompostgut"): what rots into compost – leaves, fibres
    // and seaweed (the kitchen adds its spoiled food, M7-29).
    id: 'kompostgut',
    name: { de: 'Kompostgut (Laub, Fasern, Tang, Verdorbenes)', en: 'Compostables (leaves, fibres, seaweed, spoiled food)' },
    // Strand E (M7-29): spoiled food rots into compost too (docs/SPIEL.md §21 "Verdorbenes (Kompost)").
    items: ['laub', 'fasern', 'tang', 'verdorbenes'],
  },
  // ---- Strand E (M7-25 … M7-28, docs/SPIEL.md §21 "Kategorien"): the cooking categories of the kitchen. `fleisch_roh` is what
  // poisons raw (§18 "rohes Fleisch 30 %") and goes into a stew; the others are what a recipe of the cauldron, the oven, the
  // spit, the smokehouse, the fermenting barrel or the herb table asks for "any of a kind".
  {
    id: 'fleisch_roh',
    name: { de: 'Rohes Fleisch oder roher Fisch', en: 'Raw meat or raw fish' },
    items: ['wildfleisch_roh', 'gefluegel_roh', 'krebsfleisch_roh', 'forelle', 'barsch', 'karpfen', 'hecht', 'aal', 'quappe', 'hering', 'makrele'],
  },
  {
    id: 'fleisch',
    name: { de: 'Fleisch (Wild, Geflügel, Krebs)', en: 'Meat (game, fowl, crab)' },
    items: ['wildfleisch_roh', 'gefluegel_roh', 'krebsfleisch_roh'],
  },
  {
    id: 'fisch',
    name: { de: 'Fisch', en: 'Fish' },
    items: ['forelle', 'barsch', 'karpfen', 'hecht', 'aal', 'quappe', 'hering', 'makrele'],
  },
  {
    id: 'gemuese',
    name: { de: 'Gemüse', en: 'Vegetables' },
    items: ['karotte', 'kartoffel', 'ruebe', 'zwiebel', 'knoblauch', 'kohl', 'erbse', 'bohne', 'tomate', 'kuerbis', 'mais'],
  },
  {
    id: 'pilze',
    name: { de: 'Speisepilze', en: 'Edible mushrooms' },
    items: ['steinpilz', 'pfifferling'],
  },
  {
    id: 'beeren',
    name: { de: 'Beeren', en: 'Berries' },
    items: ['himbeeren', 'blaubeeren', 'walderdbeeren', 'erdbeere'],
  },
  {
    id: 'obst',
    name: { de: 'Obst', en: 'Fruit' },
    items: ['apfel', 'birne', 'kirsche'],
  },
  {
    id: 'kraeuter',
    name: { de: 'Heilkräuter', en: 'Healing herbs' },
    items: ['schafgarbe', 'wegerich', 'kamille', 'baerlauch'],
  },
  {
    id: 'getreide',
    name: { de: 'Getreide', en: 'Grain' },
    items: ['weizen', 'gerste', 'roggen'],
  },
]);
