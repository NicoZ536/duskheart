/**
 * Pure rules of the world settings (MASTERPROMPT §29, docs/SPIEL.md §25; M7-51): the effective factors of a world – the
 * preset of its difficulty (`BALANCE.difficulty.presets`) with the world's overrides on top –, the spawn veto of a peaceful
 * world and the lock of Unbarmherzig.
 */
import { BALANCE } from '../../content/balance';
import type { Difficulty } from '../../content/balance/death';
import type { CreatureFamily } from '../../content/creatures/schema';
import type { DifficultyFactors, WorldSettings } from './types';

/** A factors record the caller owns (`resolveFactors` writes into it). */
export interface MutableDifficultyFactors {
  hungerThirst: number;
  enemyDamage: number;
  shadowFloodNights: number | null;
}

/** The settings of a world nobody changed: not peaceful, no override, the preset's shadow flood, logistics realism off (§25). */
export function defaultWorldSettings(): WorldSettings {
  return { peaceful: false, hungerThirst: null, enemyDamage: null, shadowFloodNights: 'voreinstellung', logisticsRealism: false };
}

/** The factors of difficulty `difficulty` with the overrides of `settings`, written into `out` (returned). */
export function resolveFactors(difficulty: Difficulty, settings: Readonly<WorldSettings>, out: MutableDifficultyFactors): DifficultyFactors {
  const preset = BALANCE.difficulty.presets[difficulty];
  out.hungerThirst = settings.hungerThirst ?? preset.hungerThirst;
  out.enemyDamage = settings.enemyDamage ?? preset.enemyDamage;
  out.shadowFloodNights = settings.shadowFloodNights === 'voreinstellung' ? preset.shadowFloodNights : settings.shadowFloodNights;
  return out;
}

/** Whether a peaceful world keeps creatures of `family` from spawning: everything but the animals (§29 "Friedlich-Schalter"). */
export function peacefulBlocks(family: CreatureFamily): boolean {
  return family !== 'friedlich';
}

/** Whether the difficulty and the overrides that would soften it are locked (§29 "außer Unbarmherzig"). */
export function difficultyLocked(difficulty: Difficulty): boolean {
  return BALANCE.difficulty.lockedDifficulties.includes(difficulty);
}

/** Whether `value` lies on the slider of `range` (within it and on a step from its start, up to float noise). */
export function onRange(value: number, range: { readonly min: number; readonly max: number; readonly step: number }): boolean {
  if (!Number.isFinite(value) || value < range.min - STEP_EPSILON || value > range.max + STEP_EPSILON) return false;
  const steps = (value - range.min) / range.step;
  return Math.abs(steps - Math.round(steps)) < STEP_EPSILON;
}

/** Tolerance of `onRange` against the binary representation of decimal steps (0.05 is not exact) [steps]. */
const STEP_EPSILON = 1e-6;
