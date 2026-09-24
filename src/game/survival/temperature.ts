/**
 * Temperature model of the player (MASTERPROMPT §11.2, M3-18) as pure functions; the vitals system
 * (`system.ts`) applies them every tick.
 *
 * - Felt temperature T_u = ambient (the world's temperature field at the player's tile, §9.3) + heat of
 *   the warmest heat source (fire: +15 °C in its core, falling off linearly to its edge) + room value
 *   (§16.4: a closed room pulls the air towards 18 °C, supplied by the room system).
 * - Comfort band [18 − insulation × (1 − 0,7 × wetness), 26 + cooling]; insulation 0–40 and cooling
 *   0–15 come from clothing, wetness is the fraction 0–1 of §11.1's 0–100 %.
 * - Stress = distance of T_u from the band (0 inside). The core changes by 0,002 °C/s per degree of
 *   stress towards the side of the stress; inside the band it returns to 37,0 °C at 0,01 °C/s without
 *   overshooting. The core stays within [28, 44] °C.
 * - Stages (thresholds exclusive, §11.2): < 36,0 Frierend · < 35,0 Unterkühlt · < 33,0 Erfrierend ·
 *   > 38,0 Erhitzt · > 39,0 Überhitzt · > 40,5 Hitzschlag. Effects of a milder stage stay in force in the
 *   harsher ones of the same side (Unterkühlt also slows work like Frierend); the damage is the stage's
 *   own rate (§11.2 lists −0,5 and −2 HP/s, not their sum).
 */
import { BALANCE } from '../../content/balance';
import { TEMPERATURE_STAGES, type TemperatureStage } from '../../content/balance/survival';

const T = BALANCE.survival.temperature;
const PERCENT = 100;

/** Index of a stage in `TEMPERATURE_STAGES` (coldest 0 … hottest 6). */
const STAGE_INDEX: Readonly<Record<TemperatureStage, number>> = Object.fromEntries(TEMPERATURE_STAGES.map((s, i) => [s, i])) as Record<TemperatureStage, number>;

/** The comfort band [°C]. */
export interface ComfortBand {
  low: number;
  high: number;
}

/** Felt temperature [°C]: ambient air + heat sources + room value (§11.2 "T_u"). */
export function feltTemperatureC(ambientC: number, heatC: number, roomC: number): number {
  return ambientC + heatC + roomC;
}

/**
 * Warmth of one heat source at distance `distancePx` [°C]: `coreHeatC` within `coreRadiusPx`, falling
 * linearly to 0 at `radiusPx` (§11.2 "Feuer +15 °C im Kern, zum Rand abfallend").
 */
export function heatSourceC(distancePx: number, coreHeatC: number, coreRadiusPx: number, radiusPx: number): number {
  if (distancePx <= coreRadiusPx) return coreHeatC;
  if (distancePx >= radiusPx) return 0;
  return (coreHeatC * (radiusPx - distancePx)) / (radiusPx - coreRadiusPx);
}

/** Clothing insulation clamped to its range (§11.2: 0–40). */
export function clampInsulation(insulation: number): number {
  return insulation < 0 ? 0 : insulation > T.maxInsulation ? T.maxInsulation : insulation;
}

/** Clothing cooling clamped to its range (§11.2: 0–15). */
export function clampCooling(cooling: number): number {
  return cooling < 0 ? 0 : cooling > T.maxCooling ? T.maxCooling : cooling;
}

/**
 * Comfort band for clothing and wetness (§11.2): [18 − insulation × (1 − 0,7 × wetness), 26 + cooling].
 * `wetnessPercent` is §11.1's 0–100 %. Writes into `out` (allocation free) and returns it.
 */
export function comfortBand(insulation: number, cooling: number, wetnessPercent: number, out: ComfortBand = { low: 0, high: 0 }): ComfortBand {
  const wet = wetnessPercent <= 0 ? 0 : wetnessPercent >= PERCENT ? 1 : wetnessPercent / PERCENT;
  out.low = T.comfortLowC - clampInsulation(insulation) * (1 - T.wetInsulationLoss * wet);
  out.high = T.comfortHighC + clampCooling(cooling);
  return out;
}

/** Signed thermal stress [°C]: negative below the band (cold), positive above (heat), 0 inside. */
export function thermalStress(feltC: number, low: number, high: number): number {
  if (feltC < low) return feltC - low;
  if (feltC > high) return feltC - high;
  return 0;
}

/**
 * Rate of the core temperature [°C/s]: 0,002 °C/s per degree of stress towards the stress; without
 * stress 0,01 °C/s back towards 37,0 °C (0 at 37,0).
 */
export function coreRatePerSecond(stress: number, coreC: number): number {
  if (stress !== 0) return T.stressRatePerSecond * stress;
  if (coreC < T.coreNormalC) return T.returnRatePerSecond;
  if (coreC > T.coreNormalC) return -T.returnRatePerSecond;
  return 0;
}

/** Core temperature after `dt` seconds under `stress`: the return inside the band stops at 37,0 °C; the result stays in [28, 44] °C. */
export function stepCoreTemperature(coreC: number, stress: number, dt: number): number {
  let next = coreC + coreRatePerSecond(stress, coreC) * dt;
  if (stress === 0 && (coreC - T.coreNormalC) * (next - T.coreNormalC) < 0) next = T.coreNormalC;
  return next < T.coreMinC ? T.coreMinC : next > T.coreMaxC ? T.coreMaxC : next;
}

/** Stage of a core temperature (§11.2; thresholds exclusive: exactly 36,0 °C is still normal). */
export function temperatureStage(coreC: number): TemperatureStage {
  const s = T.stages;
  if (coreC < s.erfrierendBelow) return 'erfrierend';
  if (coreC < s.unterkuehltBelow) return 'unterkuehlt';
  if (coreC < s.frierendBelow) return 'frierend';
  if (coreC > s.hitzschlagAbove) return 'hitzschlag';
  if (coreC > s.ueberhitztAbove) return 'ueberhitzt';
  if (coreC > s.erhitztAbove) return 'erhitzt';
  return 'normal';
}

/** Whether `stage` is `atLeast` or harsher on the same side of normal (cold: towards Erfrierend, heat: towards Hitzschlag). */
export function stageAtLeast(stage: TemperatureStage, atLeast: TemperatureStage): boolean {
  const s = STAGE_INDEX[stage];
  const a = STAGE_INDEX[atLeast];
  const n = STAGE_INDEX.normal;
  if (a < n) return s <= a;
  if (a > n) return s >= a;
  return s === n;
}

/** Health loss of a stage [HP/s] (§11.2: Unterkühlt/Überhitzt 0,5, Erfrierend/Hitzschlag 2). */
export function temperatureDamagePerSecond(stage: TemperatureStage): number {
  return T.stageDamagePerSecond[stage];
}

/** Maximum stamina factor of a stage (§11.2 "Unterkühlt −30 % max. Ausdauer", also while Erfrierend). */
export function temperatureMaxStaminaFactor(stage: TemperatureStage): number {
  return stageAtLeast(stage, 'unterkuehlt') ? T.hypothermiaStaminaFactor : 1;
}

/** Stamina regeneration factor of a stage (§11.2 "Überhitzt −50 % Ausdauerregeneration", also in Hitzschlag). */
export function temperatureStaminaRegenFactor(stage: TemperatureStage): number {
  return stageAtLeast(stage, 'ueberhitzt') ? T.overheatedStaminaRegenFactor : 1;
}

/** Precision and work speed factor of a stage (§11.2 "Frierend −10 % Präzision und Arbeitstempo", also colder). */
export function temperatureWorkFactor(stage: TemperatureStage): number {
  return stageAtLeast(stage, 'frierend') ? T.coldWorkFactor : 1;
}

/** Whether a stage makes the player thirsty faster (§11.2 "Erhitzt: Durst ×1,5", also hotter). */
export function temperatureHeatsThirst(stage: TemperatureStage): boolean {
  return stageAtLeast(stage, 'erhitzt');
}
