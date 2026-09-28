/**
 * Settings of the atmosphere and post passes (M5-10, M5-13 … M5-16, M5-22), derived from the player
 * settings: `graphics.fog`, `graphics.bloom`, `graphics.crt` (§29 "Grafik: … CRT", default off), the
 * colour-blind mode (§29 "Farbenblind-Modi", folded into the grading LUT) and the accessibility options
 * (§29): "Blitz- und Flackerreduktion" holds the heartbeat and the grain still,
 * "Bewegungsreduktion" calms every wobble, wave and shimmer, "Screenshake 0–100 %" scales shock waves.
 * The quality strand switches only these settings.
 */
import { defaultSettings, type Settings } from '../../engine/settings';
import type { ColorblindMode } from './grading';
import { REDUCED_MOTION_SCALE } from './state';

export interface AtmospherePostSettings {
  /** Fog layers and the light they scatter (pass `atmosphere`). */
  readonly fog: boolean;
  /** Bloom (pass `bloom`). */
  readonly bloom: boolean;
  /** CRT filter of the presentation (pass `crt`). */
  readonly crt: boolean;
  /** Colour-blind correction of the picture (in the grading LUT of the post pass). */
  readonly colorblind: ColorblindMode;
  /** Pulses held steady, grain still (flash reduction). */
  readonly steady: boolean;
  /** Scale of wobbles, waves and heat shimmer (1, or `REDUCED_MOTION_SCALE` with reduced motion). */
  readonly motionScale: number;
  /** Scale of shock waves (the screen shake setting, 0…1). */
  readonly shockwaveScale: number;
}

/** The renderer's view of the player settings. */
export function atmospherePostSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): AtmospherePostSettings {
  const g = settings.graphics;
  const a = settings.accessibility;
  return {
    fog: g.fog,
    bloom: g.bloom,
    crt: g.crt,
    colorblind: a.colorblind,
    steady: a.flashReduction || a.reducedMotion,
    motionScale: a.reducedMotion ? REDUCED_MOTION_SCALE : 1,
    shockwaveScale: Math.max(0, Math.min(1, a.screenshake)),
  };
}

/** Settings until the page configures the pipeline (the defaults of a fresh profile: CRT off). */
export const DEFAULT_ATMOSPHERE_POST_SETTINGS: AtmospherePostSettings = atmospherePostSettingsFrom(defaultSettings());
