/**
 * Meals (docs/SPIEL.md §21 "Mahlzeit-Effekte", ADR-0175; strand E, system `meals`): meal effects are conditions of the group
 * `mahlzeit` (at most two different at once, the oldest gives way), boredom per dish (participant `meals`), salt, comfort
 * food, raw meat – all through the eat hooks of the actions system (src/game/actions/hooks.ts).
 */

/** A meal effect: a condition of group `mahlzeit` (at most 2 different at once, the oldest gives way). */
export interface MealEffect {
  readonly condition: string;
  readonly seconds: number;
}
export interface MealsApi {
  /** Boredom counter of a dish (≥ 2 before eating ⇒ −50 % nutrition). */
  boredom(item: string): number;
  /** The comfort value the next piece would give (tooltips). */
  comfortOf(item: string): number;
}
// src/game/conditions/system.ts (E, additive): addGroupLimit(group: string, max: number): void; conditions get an optional `gruppe`.
