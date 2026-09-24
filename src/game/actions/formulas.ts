/**
 * The player's actions as pure functions (MASTERPROMPT §11.4 "Aktionen", §12.3, §18; M3-25;
 * tests/unit/game/aktionen.test.ts).
 *
 * - Eating: a piece takes 1,5 s (raw food), 2,5 s (dishes), 1 s (potions) or 1,5 s (medicine); its
 *   nutrition counts fully when fresh (≥ 60 %), ×0,75 when old (20–60 %), ×0,5 when rotten (< 20 %).
 *   Raw food (category `nahrung`: not cooked, §18 "roh") and rotten food frighten (+5 fear, §12.3); rotten
 *   food poisons with 40 % (§18 "Faulig … Vergiftungsrisiko").
 * - Drinking: a sip from a river, lake or spring takes 2 s and quenches 20 thirst; river and lake water is
 *   unfiltered – 10 % fever risk, 50 % in the Nebelmoor (§18) – spring water is clean. The sea is salty,
 *   ice must be melted first.
 * - Throwing: one piece flies to the aimed point, at most 8 tiles, at 10 tiles/s, and stops in front of
 *   the first wall, rock or tree on its way.
 */
import { BALANCE } from '../../content/balance';
import type { ConsumableCategory } from '../../content/balance/actions';
import type { ItemDef } from '../../content/schema/item';
import { WATER_DEPTH_MASK, WATER_DEPTH_NONE, WATER_FROZEN, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../world/model/chunk';
import { TILE_PX } from '../../world/model/coords';
import { secondsToTicks } from '../player/formulas';

const A = BALANCE.actions;

/** Freshness stages of food (§18). */
export const FRESHNESS_STAGES = ['frisch', 'alt', 'faulig'] as const;
/** One freshness stage. */
export type FreshnessStage = (typeof FRESHNESS_STAGES)[number];

/** Freshness stage of a stack's freshness [percent]; `null` for items that do not spoil. */
export function freshnessStage(freshness: number | undefined): FreshnessStage | null {
  if (freshness === undefined) return null;
  const f = A.freshness;
  if (freshness < f.rottenBelow) return 'faulig';
  return freshness < f.oldBelow ? 'alt' : 'frisch';
}

/** Share of the nutrition a piece still gives at its freshness stage [factor]. */
export function nutritionFactor(stage: FreshnessStage | null): number {
  if (stage === 'alt') return A.freshness.oldFactor;
  return stage === 'faulig' ? A.freshness.rottenFactor : 1;
}

/** Satiety and thirst one eaten piece changes [points]. */
export interface Nutrition {
  satiety: number;
  thirst: number;
}

/** Nutrition of one piece of `def` at `stage` (0 for items that are not edible). */
export function eatenNutrition(def: ItemDef, stage: FreshnessStage | null, out: Nutrition = { satiety: 0, thirst: 0 }): Nutrition {
  const food = def.essbar;
  const k = nutritionFactor(stage);
  out.satiety = food === undefined ? 0 : food.saettigung * k;
  out.thirst = food === undefined ? 0 : food.durst * k;
  return out;
}

/** Whether `def` is raw food (§18 "roh": not cooked – the category of gathered food). */
export function isRawFood(def: ItemDef): boolean {
  return def.kategorie === 'nahrung';
}

/** Fear from eating [points] (§12.3 "rohe oder verdorbene Nahrung +5"): once, raw or rotten. */
export function eatingFright(raw: boolean, stage: FreshnessStage | null): number {
  return raw || stage === 'faulig' ? BALANCE.fear.rise.badFood : 0;
}

/**
 * Calming of a dish [fear points] (§12.3 "Wohlfühlessen −10 bis −25"): a cooked dish comforts at least by
 * the lower bound; dishes with a stronger comfort of their own (Beerenkuchen −20, §18) bring it with their
 * meal effects. Raw food and potions do not comfort.
 */
export function dishComfort(def: ItemDef): number {
  return def.kategorie === 'gericht' ? BALANCE.fear.decay.comfortFoodMin : 0;
}

/** Chance of food poisoning from one piece [probability] (§18 "Faulig … Vergiftungsrisiko"). */
export function foodPoisonChance(stage: FreshnessStage | null): number {
  return stage === 'faulig' ? A.freshness.rottenPoisonChance : 0;
}

/** Time to eat or drink one piece of a consumable category [ticks]. */
export function consumeTicks(category: ConsumableCategory): number {
  return secondsToTicks(A.consumeSeconds[category]);
}

/** Time of one sip of water [ticks]. */
export function sipTicks(): number {
  return secondsToTicks(A.drinkSeconds);
}

/** Where water comes from. */
export const WATER_SOURCES = ['fluss', 'see', 'quelle', 'meer', 'eis'] as const;
/** One water source. */
export type WaterSource = (typeof WATER_SOURCES)[number];

/** The water of a tile (its `water` byte, docs/WORLD.md §3); `null` without water. */
export function waterSource(water: number): WaterSource | null {
  if ((water & WATER_DEPTH_MASK) === WATER_DEPTH_NONE) return null;
  if ((water & WATER_FROZEN) !== 0) return 'eis';
  if ((water & WATER_SEA) !== 0) return 'meer';
  if ((water & WATER_SPRING) !== 0) return 'quelle';
  if ((water & WATER_LAKE) !== 0) return 'see';
  return (water & WATER_RIVER) !== 0 ? 'fluss' : 'see';
}

/** Whether a water source can be drunk from (§18: not the salty sea, not ice). */
export function drinkable(source: WaterSource): boolean {
  return source === 'fluss' || source === 'see' || source === 'quelle';
}

/** Fever risk of one sip [probability]: spring 0, the Nebelmoor 50 %, other rivers and lakes 10 % (§18). */
export function feverChance(source: WaterSource, biome: string | null): number {
  const w = A.water;
  if (source === 'quelle') return w.springFeverChance;
  if (biome !== null && Object.hasOwn(w.feverChanceByBiome, biome)) return w.feverChanceByBiome[biome] as number;
  return w.feverChance;
}

/** Longest throw [px]. */
export const THROW_MAX_PX = A.throw.maxTiles * TILE_PX;

/** Flight time of a throw over `distancePx` [ticks, ≥ 1]. */
export function throwFlightTicks(distancePx: number): number {
  return secondsToTicks(distancePx / (A.throw.speedTilesPerSecond * TILE_PX));
}

/** `u × (1 − u)` peaks at 1/4 halfway; this factor scales it to the peak height. */
const PARABOLA_PEAK_SCALE = 4;

/** Height of a thrown piece above the ground at flight progress `t` 0–1 [px] (a parabola, highest halfway). */
export function throwArcPx(t: number, distancePx: number): number {
  const peak = (A.throw.arcPxPerTile * distancePx) / TILE_PX;
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return PARABOLA_PEAK_SCALE * peak * u * (1 - u);
}
