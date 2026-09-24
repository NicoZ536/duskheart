/**
 * Recipe schema (MASTERPROMPT §15.1; docs/SPIEL.md §6 "Rezepte `rezept_<itemId>`"; M3-16).
 *
 * A recipe turns ingredients into one product:
 * - `id`: `rezept_<product>` – a second recipe of the same product (another station) appends a suffix,
 *   `rezept_<product>_<suffix>` (ADR-0006: every recipe record counts once).
 * - `ergebnis`: the product and how many pieces one craft makes; `zutaten`: the ingredients per craft
 *   (each item once). Items with durability count only while they are intact.
 * - `station`: the placeable item the player must stand at (§15.2), or `null` for the basics made in the
 *   hand (§15.1 "Ohne Station herstellbar").
 * - `umgebung`: what the surroundings must offer – `wasser`: open fresh water within reach (filling a
 *   bucket; `BALANCE.crafting.waterReachTiles`).
 * - `dauer`: crafting time class of one craft (`BALANCE.crafting.durationSeconds`).
 * - `behaelt: 'haltbarkeit'`: the product keeps the durability and quality of its single ingredient with
 *   durability (a bucket filled with water is the same bucket).
 * - `bauplan`: the recipe is only known once its blueprint was found – where blueprints come from, in the
 *   syntax of item sources (`ort:<ortstyp>`, `drop:<kreatur>`, `haendlerin` …; §15.1 "Baupläne (Dungeons,
 *   Händlerin, Tafeln)"). Without it the recipe becomes visible by the rule of §15.1: every ingredient
 *   owned once and the station known.
 * - `name`: only when the product's name does not describe the recipe ("Eimer füllen").
 * - `sound`: sound of the finished craft when it is not the crafting chime (`sfx_handwerk_fertig`).
 *
 * The tier of a recipe is the tier of its product; the content validator checks that no ingredient comes
 * from a higher tier (tools/validator/tiers.ts) and that every recipe can be reached from the world
 * (tools/validator/reachability.ts).
 */
import { z } from 'zod';
import { CRAFT_TIME_CLASSES } from '../balance/crafting';
import { idSchema, localizedTextSchema, refSchema } from '../schema/common';
import { itemSourceSchema, parseItemSource, sfxIdSchema } from '../schema/item';

/** Id prefix of recipes. */
export const RECIPE_ID_PREFIX = 'rezept_';

/** What the surroundings of a recipe must offer. */
export const RECIPE_ENVIRONMENTS = ['wasser'] as const;
/** One environment requirement. */
export type RecipeEnvironment = (typeof RECIPE_ENVIRONMENTS)[number];

/** An item and a count [pieces]. */
export const recipeAmountSchema = z.object({ item: refSchema, anzahl: z.number().int().min(1) }).strict();
/** An item and a count. */
export type RecipeAmount = z.output<typeof recipeAmountSchema>;

/** Where the blueprint of a recipe is found. */
export const recipeBlueprintSchema = z.object({ quellen: z.array(itemSourceSchema).min(1) }).strict();

/** Whether `id` is a valid recipe id for the product `item` (`rezept_<item>` or `rezept_<item>_<suffix>`). */
export function isRecipeIdFor(id: string, item: string): boolean {
  const base = `${RECIPE_ID_PREFIX}${item}`;
  return id === base || (id.startsWith(`${base}_`) && id.length > base.length + 1);
}

/** The id of the (first) recipe of `item`. */
export function recipeIdFor(item: string): string {
  return `${RECIPE_ID_PREFIX}${item}`;
}

/** Schema of one recipe. */
export const recipeSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema.optional(),
    ergebnis: recipeAmountSchema,
    zutaten: z.array(recipeAmountSchema).min(1),
    station: refSchema.nullable(),
    umgebung: z.enum(RECIPE_ENVIRONMENTS).optional(),
    dauer: z.enum(CRAFT_TIME_CLASSES),
    behaelt: z.literal('haltbarkeit').optional(),
    bauplan: recipeBlueprintSchema.optional(),
    sound: sfxIdSchema.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (!isRecipeIdFor(r.id, r.ergebnis.item)) issue('id', `recipe of "${r.ergebnis.item}" must be named ${recipeIdFor(r.ergebnis.item)} or ${recipeIdFor(r.ergebnis.item)}_<suffix>`);
    const items = r.zutaten.map((z) => z.item);
    if (new Set(items).size !== items.length) issue('zutaten', 'each ingredient is listed once (add up the counts)');
    if (items.includes(r.ergebnis.item)) issue('zutaten', 'the product cannot be its own ingredient');
    if (r.station !== null && items.includes(r.station)) issue('station', 'a station is not an ingredient');
    if (r.behaelt !== undefined && (r.ergebnis.anzahl !== 1 || r.zutaten.every((z) => z.anzahl !== 1))) {
      issue('behaelt', 'a product that keeps the durability of an ingredient is one piece made from one piece');
    }
    for (const source of r.bauplan?.quellen ?? []) {
      if (parseItemSource(source)?.kind === 'rezept') issue('bauplan', `blueprints are found, not crafted: ${source}`);
    }
  });

/** One recipe (validated). */
export type RecipeDef = z.output<typeof recipeSchema>;
/** Recipe data as written in the content files. */
export type RecipeInput = z.input<typeof recipeSchema>;
