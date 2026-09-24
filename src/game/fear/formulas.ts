/**
 * Fear as pure functions (MASTERPROMPT §12.3, M3-23; tests/unit/game/furcht.test.ts).
 *
 * - Rise [points/s]: in the dark (light < 0,15, §12.1) +1,0/s at night on the surface, +0,5/s underground;
 *   +0,5/s in a corrupted area. Equipment's fear resistance lowers the rise by its fraction. Asleep, the
 *   dark does not frighten (the eyes are closed in a place the player chose).
 * - Decay [points/s]: the strongest calming place – bright light −0,5, at a fire or hearth −1, a cosy room up
 *   to −1,5 (× comfort / 20) – plus music −2, a companion −0,2 and sleep −5 per game hour.
 * - Instant changes: sighting an elite or boss +10, raw or spoiled food +5, a settler's death +20; comfort
 *   food −10 … −25.
 * - Stages (§12.3, §26): < 20 ruhig · 20 unruhig (HUD eye) · 40 flüstern (whispers, shadows at the screen
 *   edge) · 60 trugbilder (hallucinations, desaturation) · 80 bedrohlich (hallucinations hurt) · 100 nachtmahr.
 */
import { BALANCE } from '../../content/balance';
import { FEAR_STAGES, type FearStage } from '../../content/balance/fear';

// Fear reads the stages of the gameplay light map (§12.1, one definition: src/world/lightmap/stages.ts).
export { LIGHT_STAGES, lightStage, type LightStage } from '../../world/lightmap/stages';

const F = BALANCE.fear;
/** Light stage borders of the gameplay light map [0–1] (`BALANCE.light.map.stages`). */
const LIGHT = BALANCE.light.map.stages;

/** What the player's surroundings do to fear this tick. */
export interface FearSurroundings {
  /** Light level at the player [0–1]. */
  light: number;
  /** Night on the surface (§12.3 "Dunkel +1,0/s nachts"). */
  night: boolean;
  /** Below the surface (layer < 0, §12.3 "+0,5/s in Höhlen"). */
  underground: boolean;
  /** In a corrupted area. */
  corruption: boolean;
  /** Within the warmth of a fire or hearth. */
  atFire: boolean;
  /** Comfort of the room the player is in [0–20]; 0 outdoors. */
  roomComfort: number;
  /** Music is played nearby. */
  music: boolean;
  /** A companion is nearby. */
  companion: boolean;
  sleeping: boolean;
}

/** Neutral surroundings: daylight on the surface, nothing else. */
export function createFearSurroundings(): FearSurroundings {
  return { light: 1, night: false, underground: false, corruption: false, atFire: false, roomComfort: 0, music: false, companion: false, sleeping: false };
}

/** Rise of fear [points/s] before resistance (see module comment). */
export function fearRisePerSecond(s: FearSurroundings): number {
  let rate = 0;
  if (!s.sleeping && s.light < LIGHT.darkBelow) {
    if (s.underground) rate += F.rise.darkCavePerSecond;
    else if (s.night) rate += F.rise.darkNightPerSecond;
  }
  if (s.corruption) rate += F.rise.corruptionPerSecond;
  return rate;
}

/** Calming of a cosy room [points/s]: up to 1,5/s, scaled by its comfort 0–20. */
export function roomDecayPerSecond(comfort: number): number {
  const c = comfort <= 0 ? 0 : comfort >= F.decay.roomComfortForMax ? F.decay.roomComfortForMax : comfort;
  return (F.decay.roomMaxPerSecond * c) / F.decay.roomComfortForMax;
}

/** Decay of fear [points/s]; `secondsPerGameHour` converts sleep's rate per game hour. */
export function fearDecayPerSecond(s: FearSurroundings, secondsPerGameHour: number): number {
  let place = 0;
  if (s.light >= LIGHT.brightFrom) place = F.decay.brightPerSecond;
  if (s.atFire && F.decay.firePerSecond > place) place = F.decay.firePerSecond;
  const room = roomDecayPerSecond(s.roomComfort);
  if (room > place) place = room;
  let rate = place;
  if (s.music) rate += F.decay.musicPerSecond;
  if (s.companion) rate += F.decay.companionPerSecond;
  if (s.sleeping) rate += F.decay.sleepPerGameHour / secondsPerGameHour;
  return rate;
}

/**
 * Net change of fear [points/s]: rise × (1 − resistance) − decay + the conditions' own rate (Erleuchtet,
 * Morgenrot calm). `resistance` is the equipment's fear resistance 0–1.
 */
export function fearRatePerSecond(s: FearSurroundings, resistance: number, conditionRate: number, secondsPerGameHour: number): number {
  const r = resistance <= 0 ? 0 : resistance >= 1 ? 1 : resistance;
  return fearRisePerSecond(s) * (1 - r) - fearDecayPerSecond(s, secondsPerGameHour) + conditionRate;
}

/** A sudden fright [points] after resistance (sighting, bad food, a settler's death). */
export function frightAmount(amount: number, resistance: number): number {
  const r = resistance <= 0 ? 0 : resistance >= 1 ? 1 : resistance;
  return amount * (1 - r);
}

/** Calming of a comfort food [points]: its value clamped to §12.3's "−10 bis −25". */
export function comfortFoodCalm(amount: number): number {
  const d = F.decay;
  return amount < d.comfortFoodMin ? d.comfortFoodMin : amount > d.comfortFoodMax ? d.comfortFoodMax : amount;
}

/** Fear clamped to 0–100. */
export function clampFear(value: number): number {
  return value < 0 ? 0 : value > F.max ? F.max : value;
}

/** Stage of a fear value (§12.3 thresholds). */
export function fearStage(value: number): FearStage {
  const s = F.stages;
  if (value >= s.nightmareAt) return 'nachtmahr';
  if (value >= s.harmfulFrom) return 'bedrohlich';
  if (value >= s.hallucinationFrom) return 'trugbilder';
  if (value >= s.whisperFrom) return 'fluestern';
  return value >= s.eyeFrom ? 'unruhig' : 'ruhig';
}

/** Index of a stage (ruhig 0 … nachtmahr 5). */
export function fearStageIndex(stage: FearStage): number {
  return FEAR_STAGES.indexOf(stage);
}

/** What a stage shows and does (§12.3 "Effekte", §26 "Furcht-Auge (ab 20)"); effects of lower stages stay on. */
export interface FearStageEffects {
  /** The HUD's fear eye is visible. */
  readonly eye: boolean;
  /** Whispers and shadows at the screen edge. */
  readonly whispers: boolean;
  /** Hallucinations appear and the picture loses colour. */
  readonly hallucinations: boolean;
  /** Hallucinations can deal real damage. */
  readonly harmful: boolean;
}

/** Effects of `stage`. */
export function fearStageEffects(stage: FearStage): FearStageEffects {
  const i = fearStageIndex(stage);
  return {
    eye: i >= fearStageIndex('unruhig'),
    whispers: i >= fearStageIndex('fluestern'),
    hallucinations: i >= fearStageIndex('trugbilder'),
    harmful: i >= fearStageIndex('bedrohlich'),
  };
}

/** Mean time between two hallucinations at `stage` [s]; `null` below Trugbilder. */
export function hallucinationIntervalSeconds(stage: FearStage): number | null {
  const e = fearStageEffects(stage);
  if (!e.hallucinations) return null;
  return e.harmful ? F.hallucinations.harmfulIntervalSeconds : F.hallucinations.intervalSeconds;
}

/**
 * Desaturation of the picture [0–1] (§12.3 "ab 60 … Entsättigung"): 0 below 60, rising linearly to full at
 * 100 – the presentation reads it for the post effect.
 */
export function desaturation(value: number): number {
  const from = F.stages.hallucinationFrom;
  if (value <= from) return 0;
  return value >= F.max ? 1 : (value - from) / (F.max - from);
}
