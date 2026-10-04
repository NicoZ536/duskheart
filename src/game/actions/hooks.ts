/**
 * Hooks of eating and drinking (docs/SPIEL.md §17 "Haken", §21; ADR-0175; strand E – `ActionsSystem.addEatHook`,
 * `addDrinkHook`): the meals change the nutrition of a piece before it is applied (boredom −50 %, salt, the kitchen's
 * +10 %, comfort food) and act after it (meal conditions, `mealEaten`, the boredom counter); drinking from the water skin and
 * the rain collector reaches the water system.
 */
import type { ItemDef } from '../../content/schema/item';
import type { ItemStack } from '../items/stack';
import type { Simulation } from '../sim';

/** The nutrition of one eaten piece, changed in place by eat hooks before it is applied. */
export interface Nutrition {
  satiety: number;
  thirst: number;
  fearRelief: number;
}
export interface EatContext {
  readonly item: string;
  readonly def: ItemDef;
  readonly stack: ItemStack;
  readonly tick: number;
}
export interface EatHook {
  /** Before applying: boredom (−50 %), salt (thirst), kitchen bonus (+10 %), comfort food. */
  nutrition?(sim: Simulation, ctx: EatContext, out: Nutrition): void;
  /** After applying: meal conditions, `mealEaten`, boredom counter. */
  eaten?(sim: Simulation, ctx: EatContext, applied: Readonly<Nutrition>): void;
}
export interface DrinkHook {
  drunk?(sim: Simulation, source: string, tick: number): void;
}
