/**
 * Commands of water (docs/SPIEL.md §21 "Wasser"), aggregated by src/game/commands.ts. E on water or a rain collector reaches
 * them through the water's use targets (src/game/water/uses.ts); drinking from a skin or a bucket is `player.useItem`.
 *
 * - `water.fill {tx, ty}`: fill the vessel in the hand (water skin, bucket of boiled water, an empty bucket at a collector) at
 *   the fresh water of tile (tx, ty) or at the rain collector standing there.
 * - `water.drink {tx, ty}`: a sip of the rain collector on (tx, ty) – clean water, no fever.
 */
import { z } from 'zod';

export const waterFillCommandSchema = z.object({ type: z.literal('water.fill'), tx: z.number().int(), ty: z.number().int() }).strict();
export const waterDrinkCommandSchema = z.object({ type: z.literal('water.drink'), tx: z.number().int(), ty: z.number().int() }).strict();

/** Schemas of the water commands (aggregated by `gameCommandSchema`). */
export const WATER_COMMAND_SCHEMAS = [waterFillCommandSchema, waterDrinkCommandSchema] as const;
