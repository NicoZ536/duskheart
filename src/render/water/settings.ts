/**
 * Settings of the water (docs/RENDER.md §4 "Einbau"): what the quality level (§6.3 "Wasser": vereinfacht / voll ohne
 * Spiegelung / voll) and the accessibility options change in the water pass. The quality strand switches only these
 * settings (`graphics.water`).
 * - "vereinfacht" (Niedrig): depth colouring, shore foam, ice and the ambient waves; no refraction, no reflection,
 *   no simulated waves, no caustics.
 * - "voll ohne Spiegelung" (Mittel): everything but the mirror of sky, moon, stars and objects.
 * - "voll" (Hoch, Ultra): everything.
 * - "Reduzierte Bewegung" (§29): calmer ambient waves.
 */
import { defaultSettings, type Settings } from '../../engine/settings';
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
  /** Scale of the ambient wave motion (1 = full). */
  readonly motionScale: number;
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
  };
}

/** Settings until the page configures the water (a fresh profile's). */
export const DEFAULT_WATER_SETTINGS: WaterRenderSettings = waterSettingsFrom(defaultSettings());
