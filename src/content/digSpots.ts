/**
 * Hidden dig spots (MASTERPROMPT §14 "Graben (Schaufel): … versteckte Buddelstellen"; M3-14): a few
 * untouched tiles of open surface ground hide a find that the first shovel stroke brings up. Which tile
 * is a spot follows from the world seed and the tile (`BALANCE.harvest.dig.spotChance`,
 * src/game/gathering/formulas.ts `isDigSpot`), so spots are never stored and never move.
 *
 * The table lists what a spot can yield: every roll picks one entry by its weight and yields `min`–`max`
 * pieces. The finds are the buried things of the start island – flint and ore nuggets washed out of
 * the rock, shells of an older shore, walnuts a squirrel forgot – worth more than the soil around them
 * but no shortcut past the tiers (T0 only, §13.2).
 */
import { z } from 'zod';
import { refSchema } from './schema/common';

/** One entry of the dig spot table. */
export const digSpotLootSchema = z
  .object({
    item: refSchema,
    /** Pieces per roll [items]. */
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    /** Relative weight of the entry among all entries. */
    weight: z.number().int().min(1),
  })
  .strict()
  .refine((e) => e.max >= e.min, { message: 'max must not be below min', path: ['max'] });

/** One validated entry. */
export type DigSpotLoot = z.output<typeof digSpotLootSchema>;

/** The dig spot table (validated at load). */
export const DIG_SPOT_LOOT: readonly DigSpotLoot[] = z.array(digSpotLootSchema).min(1).parse([
  // Flint is the find of the first days: a spot on the way saves a walk to the rocks.
  { item: 'feuerstein', min: 1, max: 3, weight: 4 },
  { item: 'kupfererz', min: 1, max: 2, weight: 2 },
  { item: 'zinnerz', min: 1, max: 2, weight: 2 },
  { item: 'muschel', min: 1, max: 2, weight: 2 },
  { item: 'walnuss', min: 2, max: 4, weight: 1 },
  { item: 'harz', min: 1, max: 2, weight: 1 },
]);
