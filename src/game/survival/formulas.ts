/**
 * Survival stats of the player (MASTERPROMPT §11.1, M3-17) as pure functions of their inputs; the vitals
 * system (`system.ts`) applies them every tick. Rates are per simulated second (see
 * src/content/balance/survival.ts for the time base).
 *
 * | stat       | range          | course (§11.1)                                                              |
 * |------------|----------------|-----------------------------------------------------------------------------|
 * | health     | 0 … max        | +0,5/s if satiety > 50, thirst > 30 and 5 s without damage; ×2 resting        |
 * | stamina    | 0 … max        | +25/s after 0,8 s without use; −50 % below satiety 20; costs sprint/roll/swim |
 * | satiety    | 0 … 100        | −100 in 36 min; ×2 sprint, ×1,25 fight/mining, ×1,3 cold stress, ×0,5 sleep   |
 * | thirst     | 0 … 100        | −100 in 24 min; ×1,5 in heat                                                 |
 * | wetness    | 0 … 100 %      | rain +2 %/s, swimming → 100; dries 1 %/s at a fire, 0,2 indoors, 0,1 outdoors |
 * | exhaustion | 0 … 100        | +100 in 36 min awake (sleep lowers it, M3-24)                                 |
 *
 * Stages (ids = condition ids of docs/SPIEL.md §6): satiety < 20 `hungrig`, 0 `verhungernd` (−1 HP/2 s);
 * thirst < 20 `durstig`, 0 `verdurstend` (−1 HP/s); exhaustion > 70 `muede` (−15 % stamina regeneration),
 * > 90 `erschoepft` (−25 % action speed); wetness ≥ 50 % `durchnaesst`.
 */
import { BALANCE } from '../../content/balance';
import type { TemperatureStage } from '../../content/balance/survival';
import { SECONDS_PER_MINUTE } from '../../engine/time';
import { temperatureHeatsThirst, temperatureMaxStaminaFactor, temperatureStaminaRegenFactor, temperatureWorkFactor } from './temperature';

const S = BALANCE.survival;
/** Full scale of satiety, thirst, wetness and exhaustion (§11.1 "0–100"). */
export const STAT_MAX = 100;

/** Satiety stages (§11.1). */
export const SATIETY_STAGES = ['satt', 'hungrig', 'verhungernd'] as const;
export type SatietyStage = (typeof SATIETY_STAGES)[number];
/** Thirst stages (§11.1). */
export const THIRST_STAGES = ['getraenkt', 'durstig', 'verdurstend'] as const;
export type ThirstStage = (typeof THIRST_STAGES)[number];
/** Exhaustion stages (§11.1). */
export const EXHAUSTION_STAGES = ['wach', 'muede', 'erschoepft'] as const;
export type ExhaustionStage = (typeof EXHAUSTION_STAGES)[number];
/** Wetness stages (§11.1). */
export const WETNESS_STAGES = ['trocken', 'durchnaesst'] as const;
export type WetnessStage = (typeof WETNESS_STAGES)[number];

/** Rate that moves a 0–100 stat across its whole range in `minutes` simulated minutes [points/s]. */
export function fullScalePerSecond(minutes: number): number {
  return STAT_MAX / (minutes * SECONDS_PER_MINUTE);
}

// ---------------------------------------------------------------------------------------------
// Maxima
// ---------------------------------------------------------------------------------------------

/** Maximum health [HP]: (100 + bonus) × factor (§11.1 "+10 je Boss-Herzsplitter; + Ausrüstung/Mahlzeit"; "Erschüttert" −15 %, §11.6). */
export function maxHealth(bonus: number, factor: number): number {
  return (S.health.base + bonus) * factor;
}

/** Maximum stamina [points]: (100 + bonus) × factor × the temperature stage's factor (§11.2 "Unterkühlt −30 % max. Ausdauer"). */
export function maxStamina(bonus: number, factor: number, stage: TemperatureStage): number {
  return (S.stamina.base + bonus) * factor * temperatureMaxStaminaFactor(stage);
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

/** Inputs of the health regeneration. */
export interface HealthRegenInput {
  readonly satiety: number;
  readonly thirst: number;
  /** Seconds since the last damage. */
  readonly damageFreeSeconds: number;
  /** Sitting at a fire or lying in a bed (§11.1 "×2 sitzend am Feuer oder im Bett"). */
  readonly resting: boolean;
  /** Further factor of conditions and equipment (1 = none). */
  readonly factor: number;
}

/** Health regeneration [HP/s] (§11.1): 0,5/s if satiety > 50, thirst > 30 and 5 s without damage, ×2 resting. */
export function healthRegenPerSecond(i: HealthRegenInput): number {
  const h = S.health;
  if (i.satiety <= h.regenAboveSatiety || i.thirst <= h.regenAboveThirst || i.damageFreeSeconds < h.regenDamageFreeSeconds) return 0;
  return h.regenPerSecond * (i.resting ? h.restingRegenFactor : 1) * i.factor;
}

// ---------------------------------------------------------------------------------------------
// Stamina
// ---------------------------------------------------------------------------------------------

/** Inputs of the stamina regeneration. */
export interface StaminaRegenInput {
  readonly satiety: number;
  readonly exhaustion: number;
  readonly temperature: TemperatureStage;
  /** Seconds since stamina was last used. */
  readonly restSeconds: number;
  /** Further factor (e.g. "Ausgeruht" +25 %, §11.5; 1 = none). */
  readonly factor: number;
}

/**
 * Stamina regeneration [points/s] (§11.1): +25/s once 0,8 s passed without use; ×0,5 below satiety 20,
 * ×0,85 when tired (exhaustion > 70), ×0,5 overheated (§11.2); the factors multiply.
 */
export function staminaRegenPerSecond(i: StaminaRegenInput): number {
  const st = S.stamina;
  if (i.restSeconds < st.regenDelaySeconds) return 0;
  let rate = st.regenPerSecond * i.factor * temperatureStaminaRegenFactor(i.temperature);
  if (i.satiety < st.hungryBelowSatiety) rate *= st.hungryRegenFactor;
  if (exhaustionStage(i.exhaustion) !== 'wach') rate *= S.exhaustion.tiredStaminaRegenFactor;
  return rate;
}

/** Whether a sprint may run (§11.1): stamina left, and after running dry at least 25 points back. */
export function sprintAllowed(stamina: number, lockedSinceEmpty: boolean): boolean {
  return lockedSinceEmpty ? stamina >= S.stamina.sprintResumeStamina : stamina > 0;
}

/** Whether a roll may start (§11.1 "Rolle 20": the full cost in reserve). */
export function rollAllowed(stamina: number): boolean {
  return stamina >= S.stamina.rollCost;
}

// ---------------------------------------------------------------------------------------------
// Satiety, thirst, exhaustion
// ---------------------------------------------------------------------------------------------

/** What speeds up or slows down hunger. */
export interface SatietyDrainInput {
  readonly sprinting: boolean;
  /** Fighting or mining (§11.1 "×1,25 bei Kampf/Abbau"). */
  readonly exertion: boolean;
  /** Felt temperature below the comfort band (§11.1 "×1,3 bei Kältestress"). */
  readonly coldStress: boolean;
  readonly sleeping: boolean;
}

/** Satiety loss [points/s] (§11.1): 100 in 36 min, the applicable factors multiplied. */
export function satietyDrainPerSecond(i: SatietyDrainInput): number {
  const s = S.satiety;
  let rate = fullScalePerSecond(s.minutesToEmpty);
  if (i.sprinting) rate *= s.sprintFactor;
  if (i.exertion) rate *= s.exertionFactor;
  if (i.coldStress) rate *= s.coldFactor;
  if (i.sleeping) rate *= s.sleepFactor;
  return rate;
}

/**
 * Thirst loss [points/s] (§11.1): 100 in 24 min, ×1,5 in heat – felt temperature above the comfort band
 * or a core from Erhitzt on (§11.2); one factor, however hot.
 */
export function thirstDrainPerSecond(heatStress: boolean, temperature: TemperatureStage): number {
  const rate = fullScalePerSecond(S.thirst.minutesToEmpty);
  return heatStress || temperatureHeatsThirst(temperature) ? rate * S.thirst.heatFactor : rate;
}

/** Exhaustion gain [points/s] (§11.1): 100 in 36 min awake, nothing while asleep (sleep lowers it, §11.5). */
export function exhaustionGainPerSecond(sleeping: boolean): number {
  return sleeping ? 0 : fullScalePerSecond(S.exhaustion.minutesToFull);
}

// ---------------------------------------------------------------------------------------------
// Wetness
// ---------------------------------------------------------------------------------------------

/** What wets or dries the player. */
export interface WetnessInput {
  /** Rain on the player relative to the reference rain (§11.1 "Regen +2 %/s"): 0 = dry sky or under a roof. */
  readonly rain: number;
  /** Inside the warmth of a heat source (§11.1 "trocknet 1 %/s am Feuer"). */
  readonly nearFire: boolean;
  readonly indoors: boolean;
}

/**
 * Change of wetness [%/s] outside the water (swimming soaks at once, `SWIMMING_WETNESS`): rain wets at
 * 2 %/s × rain; without rain the player dries at the fastest applicable rate – 1 %/s at a fire,
 * 0,2 %/s indoors, 0,1 %/s outdoors.
 */
export function wetnessChangePerSecond(i: WetnessInput): number {
  const w = S.wetness;
  if (i.rain > 0) return w.rainPercentPerSecond * i.rain;
  if (i.nearFire) return -w.dryAtFirePercentPerSecond;
  return i.indoors ? -w.dryIndoorsPercentPerSecond : -w.dryOutdoorsPercentPerSecond;
}

/** Wetness of a swimmer [%] (§11.1 "Schwimmen → 100"). */
export const SWIMMING_WETNESS = STAT_MAX;

// ---------------------------------------------------------------------------------------------
// Damage over time
// ---------------------------------------------------------------------------------------------

/** Starvation damage [HP/s] (§11.1 "0 Verhungernd (−1 HP/2 s)"). */
export function starvationDamagePerSecond(satiety: number): number {
  return satiety <= 0 ? S.satiety.starvingDamagePerSecond : 0;
}

/** Dehydration damage [HP/s] (§11.1 "0 Verdurstend (−1 HP/s)"). */
export function dehydrationDamagePerSecond(thirst: number): number {
  return thirst <= 0 ? S.thirst.dehydratedDamagePerSecond : 0;
}

/** Drowning damage [HP/s] (§11.4 "bei 0 Ertrinken −5 HP/s"): swimming with no stamina left. */
export function drowningDamagePerSecond(swimming: boolean, stamina: number): number {
  return swimming && stamina <= 0 ? S.drowning.damagePerSecond : 0;
}

// ---------------------------------------------------------------------------------------------
// Stages and their effects
// ---------------------------------------------------------------------------------------------

/** Satiety stage (§11.1): < 20 hungrig, 0 verhungernd. */
export function satietyStage(satiety: number): SatietyStage {
  if (satiety <= 0) return 'verhungernd';
  return satiety < S.satiety.hungryBelow ? 'hungrig' : 'satt';
}

/** Thirst stage (§11.1): < 20 durstig, 0 verdurstend. */
export function thirstStage(thirst: number): ThirstStage {
  if (thirst <= 0) return 'verdurstend';
  return thirst < S.thirst.thirstyBelow ? 'durstig' : 'getraenkt';
}

/** Exhaustion stage (§11.1): > 70 müde, > 90 erschöpft. */
export function exhaustionStage(exhaustion: number): ExhaustionStage {
  if (exhaustion > S.exhaustion.exhaustedAbove) return 'erschoepft';
  return exhaustion > S.exhaustion.tiredAbove ? 'muede' : 'wach';
}

/** Wetness stage: soaked from 50 %. */
export function wetnessStage(wetness: number): WetnessStage {
  return wetness >= S.wetness.soakedFromPercent ? 'durchnaesst' : 'trocken';
}

/** Speed factor of actions (gathering, crafting, attacks): §11.1 "Erschöpft −25 % Aktionstempo", §11.2 "Frierend −10 % Arbeitstempo". */
export function actionSpeedFactor(exhaustion: number, temperature: TemperatureStage): number {
  return (exhaustionStage(exhaustion) === 'erschoepft' ? S.exhaustion.exhaustedActionFactor : 1) * temperatureWorkFactor(temperature);
}

/** Precision factor (aim spread, crits): §11.2 "Frierend −10 % Präzision". */
export function precisionFactor(temperature: TemperatureStage): number {
  return temperatureWorkFactor(temperature);
}

/** Clamps `v` into [0, max]. */
export function clampStat(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}
