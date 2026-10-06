/**
 * Balance values of the presets and the world settings (MASTERPROMPT §29 "Modi, Schwierigkeit", docs/SPIEL.md §25 "Neue
 * Welt"; M7-51) – group `BALANCE.difficulty` (src/content/balance.ts re-exports it). The difficulty itself lives in the
 * participant `death` (its penalties in `BALANCE.death.penalties`); this group holds what the preset sets besides (hunger
 * and thirst, enemy damage, the shadow flood) and the ranges a world may override them in. Every value states its unit
 * and the reason for it.
 */
import type { Difficulty } from './death';

/** What a preset sets besides its death penalty (§29 table, columns "Hunger/Durst", "Gegnerschaden", "Schattenflut"). */
export interface DifficultyPreset {
  /** Drain of satiety and thirst [× the values of `BALANCE.survival`]. */
  readonly hungerThirst: number;
  /** Damage of creatures and bosses [× their data's damage]. */
  readonly enemyDamage: number;
  /** A shadow flood every n-th night [nights], `null` = none. */
  readonly shadowFloodNights: number | null;
}

/** An override range of the world settings screen (slider). */
export interface OverrideRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const DIFFICULTY_BALANCE = {
  /**
   * The presets of §29 [hungerThirst: × the drain of satiety and thirst; enemyDamage: × the damage of creatures and bosses;
   * shadowFloodNights: a shadow flood every n-th night, null = none]. §29 verbatim: Entspannt ×0,6 / ×0,6 / aus, Normal ×1 /
   * ×1 / jede 7. Nacht, Hart ×1,25 / ×1,3 / jede 5. Nacht, Unbarmherzig ×1,25 / ×1,5 / jede 5. Nacht. Normal is the reference
   * of every other balance value (§D), so its factors are exactly 1 and a Normal world plays bit for bit as before M7.
   */
  presets: {
    entspannt: { hungerThirst: 0.6, enemyDamage: 0.6, shadowFloodNights: null },
    normal: { hungerThirst: 1, enemyDamage: 1, shadowFloodNights: 7 },
    hart: { hungerThirst: 1.25, enemyDamage: 1.3, shadowFloodNights: 5 },
    unbarmherzig: { hungerThirst: 1.25, enemyDamage: 1.5, shadowFloodNights: 5 },
  } satisfies Record<Difficulty, DifficultyPreset>,
  /**
   * Range of the hunger and thirst override [× the drain]. From half the Normal drain (below the gentlest preset's 0,6:
   * a player who only wants to build) to double (a harsh survival run); steps of 5 % are fine enough to feel and coarse
   * enough to read on the slider.
   */
  hungerThirstRange: { min: 0.5, max: 2, step: 0.05 } satisfies OverrideRange,
  /**
   * Range of the enemy damage override [× the damage]. A quarter (a fight that never threatens, for players who want the
   * story) up to double (beyond Unbarmherzig's 1,5 for a self-made challenge); steps of 5 % like the hunger slider.
   */
  enemyDamageRange: { min: 0.25, max: 2, step: 0.05 } satisfies OverrideRange,
  /**
   * Range of the shadow flood interval [nights]. Every third night (the shortest season of §10 has three days, one flood
   * per season at least) to every 14th (the longest season); "aus" is a separate choice. §29 "eigene Regler für alles".
   */
  shadowFloodRange: { min: 3, max: 14, step: 1 } satisfies OverrideRange,
  /**
   * Preset a new world starts with [preset]. §29: Normal is the reference of the balance; the new-world screen offers the
   * others beside it.
   */
  newWorldDifficulty: 'normal' as Difficulty,
  /**
   * Presets whose difficulty can no longer be changed once the world runs [presets]. §29 "Schwierigkeit jederzeit änderbar
   * (außer Unbarmherzig)": the permadeath world keeps its rules, so the overrides that would soften it stay locked too.
   */
  lockedDifficulties: ['unbarmherzig'] as readonly Difficulty[],
};
