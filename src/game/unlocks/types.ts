/**
 * Unlocks at runtime (docs/SPIEL.md §22, ADR-0207; strand F, system `unlocks`): the granted ids with tick and source
 * (participant `unlocks`); crafting shows and allows a recipe with `freischaltung` only after its grant (`crafting.useUnlocks`).
 */
import type { Simulation } from '../sim';

export type UnlockSource = `leuchtfeuer:${number}` | `bauplan:${string}` | `forschung:${string}` | 'haendlerin' | 'debug';
export interface UnlockGrant {
  readonly id: string;
  readonly tick: number;
  readonly source: UnlockSource;
}
/** The unlock registry (§23.1), participant `unlocks`. */
export interface UnlockRegistry {
  has(id: string): boolean;
  /** Grants once (`unlockGranted`); false if already granted or unknown. */
  grant(sim: Simulation, id: string, source: UnlockSource): boolean;
  granted(): readonly UnlockGrant[];
  /** Whether crafting may show and start `recipe` (no `freischaltung`, or granted). */
  recipeAllowed(recipe: string): boolean;
}
