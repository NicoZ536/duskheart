/**
 * Commands of farming (docs/SPIEL.md §20, §30 "Debug: grow [tage]"), aggregated by src/game/commands.ts. Sowing, watering,
 * fertilising and planting saplings go through `player.useItem` (the item uses of src/game/farming/uses.ts) or E on the plot.
 *
 * - `farm.plant {tx, ty}`: sow the seed in the hand (hotbar selection) on the empty plot (tx, ty) within reach (§20 "Säen mit
 *   Saat → farm.plant"); one piece of the seed is used up.
 * - `farm.harvest {tx, ty}`: E on a plot within reach – harvest a ripe crop, or clear a dead one.
 * - `farm.grow {tage}` (debug console `grow [tage]`): every plot and sapling of the active zone grows `tage` days as if the days
 *   had been good (moist, in season, mild) – nothing dries, freezes or catches pests.
 */
import { z } from 'zod';

/** Most days one debug `grow` adds. */
export const MAX_DEBUG_GROW_DAYS = 60;

export const farmPlantCommandSchema = z.object({ type: z.literal('farm.plant'), tx: z.number().int(), ty: z.number().int() }).strict();

export const farmHarvestCommandSchema = z.object({ type: z.literal('farm.harvest'), tx: z.number().int(), ty: z.number().int() }).strict();

export const farmGrowCommandSchema = z.object({ type: z.literal('farm.grow'), tage: z.number().int().min(1).max(MAX_DEBUG_GROW_DAYS) }).strict();

/** Schemas of the farming commands (aggregated by `gameCommandSchema`). */
export const FARMING_COMMAND_SCHEMAS = [farmPlantCommandSchema, farmHarvestCommandSchema, farmGrowCommandSchema] as const;
