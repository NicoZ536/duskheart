/**
 * Events of the meals (aggregated into `SimEventMap`, docs/SPIEL.md §17 "mealEaten"): what a piece did beyond its nutrition –
 * the observers count and tell it (statistics, achievements, chronicle; strand G), the tooltips and the HUD show the boredom.
 *
 * - `mealEaten`: a piece was eaten or a potion drunk (`itemEaten` reports its nutrition): the conditions it gave (`effekte`),
 *   how much boredom took from it (`ueberdruss` 0–1: 0,5 = half the nutrition), whether it came from a kitchen (`kueche`),
 *   whether raw meat poisoned (`roh`).
 */
export interface MealEventMap {
  mealEaten: { readonly item: string; readonly effekte: readonly string[]; readonly ueberdruss: number; readonly kueche: boolean; readonly roh: boolean; readonly tick: number };
}

/** Event names of `MealEventMap`. */
export const MEAL_EVENT_TYPES = ['mealEaten'] as const satisfies ReadonlyArray<keyof MealEventMap>;
