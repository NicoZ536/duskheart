/**
 * Pure puzzle rules (docs/SPIEL.md §19 "Rätseltypen M7", ADR-0207; strand C): one rule set per puzzle type – crates on
 * pressure plates, lever sequence, fire bowls, hidden walls, bells – with a solver; the vault system keeps their encoded
 * state per puzzle (participant `vaults`). No simulation, no state of their own.
 */
import type { PuzzleVariantDef } from '../../content/dungeons/schema';

/** Pure rules of one puzzle type: state transitions and a solver (test per variant: `solve` finds a solution, applying it solves). */
export interface PuzzleRules<V extends PuzzleVariantDef, S, A> {
  readonly type: V['typ'];
  init(variant: V): S;
  /** Next state after `action`; a wrong lever or bell order resets to `init`. */
  act(variant: V, state: S, action: A): S;
  solved(variant: V, state: S): boolean;
  /** A shortest solution, or null if none (the validator then fails). */
  solve(variant: V): readonly A[] | null;
  /** Compact form for the save (participant `vaults`). */
  encode(state: S): readonly number[];
  decode(variant: V, data: readonly number[]): S;
}
