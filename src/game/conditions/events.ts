/**
 * Events of the condition system (aggregated into `SimEventMap`, src/game/sim.ts) – the feedback hooks of
 * MASTERPROMPT §2.7: the HUD adds and removes the condition icons (`zustand_<id>`) with their timers, the
 * presentation starts and stops the visible effect (`sichtbar`) and plays the condition's `sound`.
 *
 * - `conditionApplied`: a condition began or was applied again (`outcome` of its stack rule).
 * - `conditionRemoved`: it ended – ran out, was cured, its survival stage passed, water put it out, or
 *   death cleared it.
 * - `conditionPulse`: a periodic effect struck (vomiting of food poisoning).
 * - `playerAfflicted`: health lost to a condition (once per second) or a hallucination (at once).
 * Refused condition commands raise `commandRejected` with a `ConditionRejectReason`.
 */
import type { Entity } from '../../engine/ecs';
import type { ApplyOutcome } from './formulas';
import type { PlayerAfflictedEvent } from './harm';

/** Why a condition ended. */
export const CONDITION_END_REASONS = ['abgelaufen', 'geheilt', 'stufe', 'geloescht', 'tod'] as const;
/** One end reason. */
export type ConditionEndReason = (typeof CONDITION_END_REASONS)[number];

/** Why a condition command had no effect. */
export type ConditionRejectReason =
  /** No such condition. */
  | 'unknownCondition'
  /** A `wert` condition follows its survival value and cannot be applied or cured directly. */
  | 'derivedCondition'
  /** The condition is not active (nothing to cure). */
  | 'notActive';

export interface ConditionEventMap {
  conditionApplied: { readonly entity: Entity; readonly id: string; readonly outcome: ApplyOutcome; readonly stacks: number; readonly remainingTicks: number; readonly tick: number };
  conditionRemoved: { readonly entity: Entity; readonly id: string; readonly reason: ConditionEndReason; readonly tick: number };
  conditionPulse: { readonly entity: Entity; readonly id: string; readonly satiety: number; readonly thirst: number; readonly tick: number };
  playerAfflicted: PlayerAfflictedEvent;
}

/** Event names of `ConditionEventMap`. */
export const CONDITION_EVENT_TYPES = ['conditionApplied', 'conditionRemoved', 'conditionPulse', 'playerAfflicted'] as const satisfies ReadonlyArray<keyof ConditionEventMap>;

/**
 * Sounds of the condition feedback besides each condition's own `sound` (`sfx_<bereich>_<name>`,
 * docs/SPIEL.md §5; presets in M3-33): a condition ends, the player throws up, a condition hurts.
 */
export const CONDITION_SFX = {
  removed: 'sfx_zustand_ende',
  pulse: 'sfx_zustand_erbrechen',
  hurt: 'sfx_spieler_schmerz',
} as const;
