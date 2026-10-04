/**
 * Bosses at runtime (docs/SPIEL.md §22, ADR-0175; strand F, system `bosses`): one instance per boss in its arena – asleep,
 * awake through its phases, defeated –, fought through the combat provider `boss` (team `feind`), servants as owned
 * creatures (`boss:<id>`), the arena sealed as a collision overlay while awake, a reset on the player's death or flight.
 * Saved per boss (participant `bosses`); the HUD and the renderer read one held record (`GameSession.sampleBoss`).
 */
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';

export const BOSS_STATES = ['schlafend', 'erwacht', 'besiegt'] as const;
export type BossStateId = (typeof BOSS_STATES)[number];
/** Saved per boss (participant `bosses`). The fight runs through `CombatTargetProvider` `boss` (team `feind`). */
export interface BossState {
  readonly boss: string;
  entity: Entity;
  state: BossStateId;
  phase: number;
  health: number;
  sealed: boolean;
  awakenedTick: number;
  defeatedTick: number;
  /** Transition until (invulnerable), next attack, the running attack and its telegraph end. */
  transitionUntilTick: number;
  nextAttackTick: number;
  attack: string;
  attackEndTick: number;
  lootGiven: boolean;
}
/** HUD (bar with phase marks, title card) and renderer read this (held record, `GameSession.sampleBoss`). */
export interface BossSample {
  active: boolean;
  boss: string;
  health: number;
  maxHealth: number;
  phase: number;
  /** Health shares of the phase starts after the first (bar marks). */
  phaseMarks: number[];
  titleUntilTick: number;
}
export interface BossesApi {
  /** The awake boss, or null (music, travel ban, HUD). */
  awake(): string | null;
  defeated(boss: string): boolean;
  /** Boss whose arena holds the tile, or null (spawn blocker, respawn "before the arena"). */
  arenaAt(layer: Layer, tx: number, ty: number): string | null;
}
