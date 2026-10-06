/**
 * The item blocks of M7 (docs/SPIEL.md §29 "Neue Item-Blöcke", ADR-0207): optional fields of `itemSchema`
 * (src/content/schema/item.ts) for what a strand's items do. Each block has one owner who may extend it here – the schema,
 * its type and its rules in `checkItemBlocks` – without touching item.ts:
 *
 * | block | owner | what it says |
 * |---|---|---|
 * | `saat` | D | the seed grows into a crop (`crops`) |
 * | `duenger` | D | fertility points, the pest it cures |
 * | `koeder` | D | bite bonus, preferred fish (`fish`) |
 * | `mahlzeit` | E | conditions of group `mahlzeit`, comfort food, salt |
 * | `trank` | E | conditions given and cured, instant effects |
 * | `ladungen` | E (D's watering can reads it) | charges held in `ItemStack.daten.ladungen` |
 * | `instrument` | A | the songs it can play (`songs`) |
 * | `bauplan` | C | using it grants an unlock (`unlocks`) |
 * | `ortskarte` | C | using it reveals the nearest undiscovered place of a type (`locationTypes`) |
 * | `splitter` | F | heart shard (+10 max. health) or ember shard (+5 max. stamina) |
 *
 * Their references are declared with the `items` collection (src/content/index.ts); `player.useItem` reaches them through
 * the strands' item uses (`ToolsSystem.addItemUse`, src/game/tools/itemUses.ts).
 */
import { z } from 'zod';
import { idSchema } from './common';

/** `mahlzeit` (E): what a dish does when eaten (conditions of group `mahlzeit`, comfort food, salt). */
export interface MealBlock {
  readonly zustaende: readonly { readonly id: string; readonly sekunden: number }[];
  /** Fear relief when eaten [points, 10–25]. */
  readonly wohlfuehl?: number;
  /** Thirst points the salt adds [points]. */
  readonly salz?: number;
}
/** `trank` (E): potions and medicine. */
export interface PotionBlock {
  readonly gibt: readonly { readonly id: string; readonly sekunden: number }[];
  readonly heilt: readonly string[];
  readonly sofort?: { readonly leben?: number; readonly ausdauer?: number; readonly furcht?: number };
}
/** `saat` (D): what the seed grows into (`crops` id). */
export interface SeedBlock {
  readonly pflanze: string;
}
/** `duenger` (D): fertility points, optionally the pest it cures. */
export interface FertilizerBlock {
  readonly fruchtbarkeit: number;
  readonly heilt?: 'mehltau';
}
/** `koeder` (D): bite bonus and preferred fish. */
export interface BaitBlock {
  readonly biss: number;
  readonly fische?: readonly string[];
}
/** `ladungen` (E; D's watering can uses it too): charges held in `ItemStack.daten.ladungen`. */
export interface ChargesBlock {
  readonly max: number;
  readonly inhalt: 'wasser';
  readonly fuellen: readonly ('wasser' | 'regensammler')[];
}
/** `instrument` (A): the songs it can play. */
export interface InstrumentBlock {
  readonly lieder: readonly string[];
}
/** `bauplan` (C): using it grants an unlock (`unlocks` id). */
export interface BlueprintBlock {
  readonly freischaltung: string;
}
/** `ortskarte` (C): using it reveals the nearest undiscovered place of this type. */
export interface MapScrollBlock {
  readonly ortstyp: string;
}
/** `splitter` (F): heart (+10 max health) or ember shard (+5 max stamina). */
export interface ShardBlock {
  readonly art: 'herz' | 'glut';
}

/** Comfort food relieves fear by 10–25 points (MASTERPROMPT §12 "Wohlfühlessen −10 bis −25"). */
export const COMFORT_MIN = 10;
export const COMFORT_MAX = 25;
/** Fertility is 0–100 (docs/SPIEL.md §20); a fertiliser adds at most all of it. */
const FERTILITY_MAX = 100;

/** A condition with its duration [s]. */
const timedConditionSchema = z.object({ id: idSchema, sekunden: z.number().positive() }).strict();

export const mealBlockSchema = z
  .object({
    zustaende: z.array(timedConditionSchema),
    wohlfuehl: z.number().min(COMFORT_MIN).max(COMFORT_MAX).optional(),
    salz: z.number().positive().optional(),
  })
  .strict()
  .refine((m) => m.zustaende.length > 0 || m.wohlfuehl !== undefined || m.salz !== undefined, { message: 'a meal block does something: conditions, comfort or salt' }) satisfies z.ZodType<MealBlock>;

export const potionBlockSchema = z
  .object({
    gibt: z.array(timedConditionSchema),
    heilt: z.array(idSchema),
    sofort: z
      .object({ leben: z.number().optional(), ausdauer: z.number().optional(), furcht: z.number().optional() })
      .strict()
      .refine((s) => s.leben !== undefined || s.ausdauer !== undefined || s.furcht !== undefined, { message: 'sofort names at least one instant effect' })
      .optional(),
  })
  .strict()
  .refine((p) => p.gibt.length > 0 || p.heilt.length > 0 || p.sofort !== undefined, { message: 'a potion block does something: gives, cures or acts at once' }) satisfies z.ZodType<PotionBlock>;

export const seedBlockSchema = z.object({ pflanze: idSchema }).strict() satisfies z.ZodType<SeedBlock>;

export const fertilizerBlockSchema = z
  .object({ fruchtbarkeit: z.number().positive().max(FERTILITY_MAX), heilt: z.literal('mehltau').optional() })
  .strict() satisfies z.ZodType<FertilizerBlock>;

export const baitBlockSchema = z.object({ biss: z.number().positive(), fische: z.array(idSchema).min(1).optional() }).strict() satisfies z.ZodType<BaitBlock>;

export const chargesBlockSchema = z
  .object({ max: z.number().int().min(1), inhalt: z.literal('wasser'), fuellen: z.array(z.enum(['wasser', 'regensammler'])).min(1) })
  .strict() satisfies z.ZodType<ChargesBlock>;

export const instrumentBlockSchema = z.object({ lieder: z.array(idSchema).min(1) }).strict() satisfies z.ZodType<InstrumentBlock>;

export const blueprintBlockSchema = z.object({ freischaltung: idSchema }).strict() satisfies z.ZodType<BlueprintBlock>;

export const mapScrollBlockSchema = z.object({ ortstyp: idSchema }).strict() satisfies z.ZodType<MapScrollBlock>;

export const shardBlockSchema = z.object({ art: z.enum(['herz', 'glut']) }).strict() satisfies z.ZodType<ShardBlock>;

/** The fields of an item the block rules read (structural: item.ts calls `checkItemBlocks` with every parsed item). */
export interface ItemBlockHost {
  readonly kategorie: string;
  readonly essbar?: object;
  readonly pflanzt?: string;
  readonly saat?: SeedBlock;
  readonly duenger?: FertilizerBlock;
  readonly koeder?: BaitBlock;
  readonly mahlzeit?: MealBlock;
  readonly trank?: PotionBlock;
  readonly ladungen?: ChargesBlock;
  readonly instrument?: InstrumentBlock;
  readonly bauplan?: BlueprintBlock;
  readonly ortskarte?: MapScrollBlock;
  readonly splitter?: ShardBlock;
}

/** Categories that may carry a `trank` block (potions and medicine are consumed like food, docs/SPIEL.md §21). */
const POTION_CATEGORIES: ReadonlySet<string> = new Set(['trank', 'medizin']);

/** Consistency of the M7 blocks with the rest of the item (the owners extend it with their rules). */
export function checkItemBlocks(item: ItemBlockHost, issue: (path: string, message: string) => void): void {
  // D: a seed is sown – its category is `saatgut` (item.ts: exactly the seeds and saplings say what they grow into).
  if (item.saat !== undefined && item.pflanzt !== undefined) issue('saat', 'a seed grows a crop (saat) or a world object (pflanzt), not both');
  // E: a meal acts when it is eaten (`action.eat`).
  if (item.mahlzeit !== undefined && item.essbar === undefined) issue('mahlzeit', 'a meal block needs essbar: it acts when eaten');
  // E: potions and medicine.
  if (item.trank !== undefined && !POTION_CATEGORIES.has(item.kategorie)) issue('trank', 'only potions and medicine (kategorie trank, medizin) carry a potion block');
}
