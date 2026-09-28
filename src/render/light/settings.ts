/**
 * Light and post settings of the renderer, derived from the player settings (§29 "Grafik: …
 * Licht-Bänderung/Dither", quality level §6.3, accessibility "Blitz- und Flackerreduktion").
 */
import { defaultSettings, SETTING_RANGES, type GraphicsSettings, type Settings } from '../../engine/settings';

/** Shadow quality (§6.3 "Schatten"). */
export type ShadowMode = GraphicsSettings['shadows'];

export interface LightRenderSettings {
  /** Quantise the light into bands (§6.1 pass 6). */
  readonly banding: boolean;
  /** Light levels per unit of light, 6–10. */
  readonly bands: number;
  /** 4×4 Bayer dither between the bands (off: plain rounding). */
  readonly dither: boolean;
  /** Point/spot lights drawn at most (quality level). */
  readonly maxLights: number;
  /** Scale of every light's flicker (1 = as authored). */
  readonly flickerScale: number;
  /**
   * Shadows of the quality level (§6.3): `sun` – sun and moon silhouettes only; `hard` – point lights also cast
   * shadows through the occluder SDF, with a hard edge; `soft` – with a penumbra (sphere tracing).
   */
  readonly shadows: ShadowMode;
}

/** Flicker left over with "Blitz- und Flackerreduktion" (a quarter: fire still breathes, no strobing). */
export const REDUCED_FLICKER_SCALE = 0.25;

/** The renderer's view of the player settings. */
export function lightSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): LightRenderSettings {
  const g = settings.graphics;
  const range = SETTING_RANGES['graphics.lightBands'];
  return {
    banding: g.lightBanding,
    bands: Math.min(range.max, Math.max(range.min, Math.round(g.lightBands))),
    dither: g.dither,
    maxLights: g.maxLights,
    flickerScale: settings.accessibility.flashReduction ? REDUCED_FLICKER_SCALE : 1,
    shadows: g.shadows,
  };
}

/** Settings until the page configures the pipeline (the defaults of a fresh profile). */
export const DEFAULT_LIGHT_SETTINGS: LightRenderSettings = lightSettingsFrom(defaultSettings());
