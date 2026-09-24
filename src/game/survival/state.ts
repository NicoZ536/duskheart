/**
 * The `vitals` component of the player (docs/SPIEL.md §3; MASTERPROMPT §11.1, §11.2): current values,
 * the timers the rules need, the temperature reading of the last tick (for the HUD thermometer and its
 * tooltip, M3-27) and the stages (to report changes once). Saved by the participant `vitals`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { TEMPERATURE_STAGES, type TemperatureStage } from '../../content/balance/survival';
import { EXHAUSTION_STAGES, SATIETY_STAGES, THIRST_STAGES, WETNESS_STAGES, type ExhaustionStage, type SatietyStage, type ThirstStage, type WetnessStage } from './formulas';

/** Causes of damage over time the vitals system reports once per second (world tick). */
export const CONTINUOUS_DAMAGE_CAUSES = ['hunger', 'durst', 'ertrinken', 'kaelte', 'hitze'] as const;
/** One cause of damage over time. */
export type ContinuousDamageCause = (typeof CONTINUOUS_DAMAGE_CAUSES)[number];

/** Survival values of the player. */
export interface Vitals {
  health: number;
  stamina: number;
  satiety: number;
  thirst: number;
  /** 0–100 %. */
  wetness: number;
  exhaustion: number;
  /** Core temperature [°C]. */
  coreC: number;
  /** Maxima of the last tick (modifiers and temperature stage). */
  maxHealth: number;
  maxStamina: number;
  /** Ticks since stamina was last used (saturates once regeneration may start). */
  staminaRestTicks: number;
  /** Ticks since the last damage (saturates once health may regenerate). */
  damageFreeTicks: number;
  /** A sprint ran the stamina dry; it resumes at `sprintResumeStamina` (§11.1). */
  sprintLocked: boolean;
  /** Temperature reading of the last tick [°C]: ambient air, heat of sources, room value, felt temperature, comfort band. */
  ambientC: number;
  heatC: number;
  roomC: number;
  feltC: number;
  bandLowC: number;
  bandHighC: number;
  /** Change of the core temperature in the last tick [°C/s] (the HUD's trend arrow). */
  coreRateCps: number;
  temperatureStage: TemperatureStage;
  satietyStage: SatietyStage;
  thirstStage: ThirstStage;
  exhaustionStage: ExhaustionStage;
  wetnessStage: WetnessStage;
  /** Swimming without stamina (§11.4 "Ertrinken"). */
  drowning: boolean;
  /** Damage over time not yet reported, per cause [HP] (reported once per second). */
  pendingDamage: Record<ContinuousDamageCause, number>;
}

const S = BALANCE.survival;

/** Vitals of a newly spawned player (§11.1 maxima, §8 the shipwrecked starts fed, rested and dry). */
export function createVitals(): Vitals {
  const T = S.temperature;
  return {
    health: S.health.base,
    stamina: S.stamina.base,
    satiety: S.satiety.start,
    thirst: S.thirst.start,
    wetness: 0,
    exhaustion: 0,
    coreC: T.coreNormalC,
    maxHealth: S.health.base,
    maxStamina: S.stamina.base,
    staminaRestTicks: 0,
    damageFreeTicks: 0,
    sprintLocked: false,
    ambientC: T.comfortLowC,
    heatC: 0,
    roomC: 0,
    feltC: T.comfortLowC,
    bandLowC: T.comfortLowC,
    bandHighC: T.comfortHighC,
    coreRateCps: 0,
    temperatureStage: 'normal',
    satietyStage: 'satt',
    thirstStage: 'getraenkt',
    exhaustionStage: 'wach',
    wetnessStage: 'trocken',
    drowning: false,
    pendingDamage: { hunger: 0, durst: 0, ertrinken: 0, kaelte: 0, hitze: 0 },
  };
}

// zod numbers reject NaN and ±Infinity.
const finite = z.number();
const nonNegative = finite.min(0);
const ticks = z.number().int().min(0);

/** Saved vitals (participant `vitals`, version 1). */
export const vitalsSchema = z
  .object({
    health: nonNegative,
    stamina: nonNegative,
    satiety: nonNegative,
    thirst: nonNegative,
    wetness: nonNegative,
    exhaustion: nonNegative,
    coreC: finite,
    maxHealth: nonNegative,
    maxStamina: nonNegative,
    staminaRestTicks: ticks,
    damageFreeTicks: ticks,
    sprintLocked: z.boolean(),
    ambientC: finite,
    heatC: finite,
    roomC: finite,
    feltC: finite,
    bandLowC: finite,
    bandHighC: finite,
    coreRateCps: finite,
    temperatureStage: z.enum(TEMPERATURE_STAGES),
    satietyStage: z.enum(SATIETY_STAGES),
    thirstStage: z.enum(THIRST_STAGES),
    exhaustionStage: z.enum(EXHAUSTION_STAGES),
    wetnessStage: z.enum(WETNESS_STAGES),
    drowning: z.boolean(),
    pendingDamage: z.object({ hunger: nonNegative, durst: nonNegative, ertrinken: nonNegative, kaelte: nonNegative, hitze: nonNegative }).strict(),
  })
  .strict();

/** Copy of a vitals record (saves and inspectors must not share the live object). */
export function copyVitals(v: Vitals): Vitals {
  return { ...v, pendingDamage: { ...v.pendingDamage } };
}
