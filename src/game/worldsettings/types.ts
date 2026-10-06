/**
 * World settings (docs/SPIEL.md §25 "Neue Welt", MASTERPROMPT §29; ADR-0207; strand H, system `world-settings`): the
 * difficulty stays in the participant `death` (saved since v1, `DeathSystem.setDifficulty` with the lock "never away from
 * Unbarmherzig") – `world.setDifficulty` delegates there –, this system saves only what may change per world: peaceful (no
 * foes, no shadow brood – a spawn blocker – animals stay), overrides of the preset's factors, the shadow flood interval and
 * logistics realism (participant `world-settings`). Readers of the factors (`vitals`, `creatures`, `bosses`) ask `factors()`.
 * The resource density is immutable world config (`SimConfig.resourceDensity`).
 */
import type { Difficulty } from '../../content/balance/death';

export const RESOURCE_DENSITIES = ['gering', 'normal', 'reich'] as const;
export type ResourceDensity = (typeof RESOURCE_DENSITIES)[number];
/** Effective factors (preset of the difficulty, overridden per world). */
export interface DifficultyFactors {
  readonly hungerThirst: number;
  readonly enemyDamage: number;
  /** Shadow flood every n nights, or null (off; acts from M9). */
  readonly shadowFloodNights: number | null;
}
/** Saved overrides (participant `world-settings`); the difficulty itself stays in `death`. */
export interface WorldSettings {
  peaceful: boolean;
  hungerThirst: number | null;
  enemyDamage: number | null;
  shadowFloodNights: number | null | 'voreinstellung';
  logisticsRealism: boolean;
}
export interface WorldSettingsApi {
  difficulty(): Difficulty;
  factors(): DifficultyFactors;
  peaceful(): boolean;
  logisticsRealism(): boolean;
}
// src/game/sim.ts simConfigSchema (H, additive): resourceDensity: z.enum(RESOURCE_DENSITIES).default('normal').
