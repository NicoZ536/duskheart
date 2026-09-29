/**
 * Settings of the water (docs/RENDER.md §4 "Einbau"): what the quality level (§6.3 "Wasser": vereinfacht / voll ohne
 * Spiegelung / voll) and the accessibility options change in the water pass. The quality strand switches only these
 * settings (`graphics.water`).
 * - "vereinfacht" (Niedrig): depth colouring, shore foam, ice and the ambient waves; no refraction, no reflection,
 *   no simulated waves, no caustics.
 * - "voll ohne Spiegelung" (Mittel): everything but the mirror of objects, moon, stars and the sun's glitter (the plain
 *   sky tint stays, as on "vereinfacht").
 * - "voll" (Hoch, Ultra): everything.
 * - "Reduzierte Bewegung" (§29): calmer and slower ambient waves, slower caustics.
 * - "Blitz- und Flackerreduktion" (§29): the sparkle of the sun's glitter and the moon's path, the twinkle of the
 *   mirrored stars and the churn under waterfalls change at a quarter of their rate (the light strand's flicker scale).
 */
import { defaultSettings, type Settings } from '../../engine/settings';
import { REDUCED_FLICKER_SCALE } from '../light/settings';
import { AMBIENT_WAVES, WATER_MODES } from './params';

export interface WaterRenderSettings {
  /** The ground under the water shifts with the waves. */
  readonly refraction: boolean;
  /** Sky, moon, stars and objects above the shoreline mirror in the water. */
  readonly reflection: boolean;
  /** Interactive waves (wave equation, impulses of figures, rain, arrows, fish). */
  readonly waves: boolean;
  /** Caustics in the shallows. */
  readonly caustics: boolean;
  /** Scale of the ambient wave motion – height and speed of the small waves, drift of the caustics (1 = full). */
  readonly motionScale: number;
  /** Rate of the water's sparkle, twinkle and churn (1 = as authored). */
  readonly flicker: number;
}

/** The water's view of the player settings. */
export function waterSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): WaterRenderSettings {
  const mode = WATER_MODES[settings.graphics.water];
  return {
    refraction: mode.refraction,
    reflection: mode.reflection,
    waves: mode.waves,
    caustics: mode.caustics,
    motionScale: settings.accessibility.reducedMotion ? AMBIENT_WAVES.reducedMotion : 1,
    flicker: settings.accessibility.flashReduction ? REDUCED_FLICKER_SCALE : 1,
  };
}

/** Settings until the page configures the water (a fresh profile's). */
export const DEFAULT_WATER_SETTINGS: WaterRenderSettings = waterSettingsFrom(defaultSettings());
