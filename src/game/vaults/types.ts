/**
 * The vaults at runtime (docs/SPIEL.md §19 "Laufzeit", ADR-0207; strand C, system `vaults`): doors and locks, keys valid in
 * their own vault, puzzle states through the pure rules of src/game/puzzles/, traps, chests, guards and the mini-boss (owned
 * creatures, `gewoelbe:<slot>`). Closed doors, crates and undiscovered hidden walls lie on the collision grid as an overlay.
 * Saved per entered vault (participant `vaults`).
 */
import type { Layer } from '../../world/model/coords';
import type { VaultPlan } from '../../world/gen/vaults/types';
import type { Simulation } from '../sim';

/** Saved state of an entered vault (participant `vaults`). */
export interface VaultState {
  readonly slot: number;
  entered: boolean;
  completed: boolean;
  /** Bits by door id / chest id / hidden wall id. */
  doorsOpen: number;
  chestsOpened: number;
  hiddenFound: number;
  keysTaken: number;
  /** Encoded state per puzzle id (`PuzzleRules.encode`), empty when untouched. */
  puzzles: number[][];
  /** Per trap id: tick it is ready again (−1 = ready); collapsed floors stay in the chunk diff. */
  trapReadyTick: number[];
  /** Crate positions of `kisten` puzzles live in `puzzles`; the mini-boss is owned (`gewoelbe:<slot>`). */
  bossDefeated: boolean;
  /** Ergänzung (C): the ember shard was taken from its pedestal. */
  shardTaken: boolean;
  /** Ergänzung (C): the guards rose (on the first entry; they live on as owned creatures). */
  guardsRisen: boolean;
  /** Ergänzung (C): per trap id the tick its warning began (−1 = not warning). */
  trapArmedTick: number[];
  /** Ergänzung (C): per puzzle id the tick it takes the next step (a lever's spring, the reset after a wrong step). */
  puzzleReadyTick: number[];
  /** Ergänzung (C): the bell tune an inscription plays – `[puzzle, start tick]`, empty when none plays. */
  hint: number[];
}
export interface VaultsApi {
  /** Slot of the vault whose box holds the tile, or −1. */
  vaultAt(layer: Layer, tx: number, ty: number): number;
  planOf(slot: number): VaultPlan | undefined;
  state(slot: number): Readonly<VaultState> | undefined;
  /** Whether a closed door, a crate or an undiscovered hidden wall blocks the tile (collision overlay). */
  blocks(layer: Layer, tx: number, ty: number): boolean;
  /** `vault.use {tx, ty}`: lever, bowl, bell, hidden wall; false if nothing usable. */
  use(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): boolean;
}
