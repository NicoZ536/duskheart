/**
 * Settings of the world surface (docs/RENDER.md §4 "Einbau"): what the quality level (§6.3) and the accessibility
 * options change in the surface effects. The quality strand switches only these settings.
 * - Water "vereinfacht" (Niedrig) and "ohne Spiegelung" (Mittel): puddles stay dark and glossy, but mirror no lights
 *   or sky.
 * - Weather particles "reduziert": half as many fireflies.
 * - "Blitz- und Flackerreduktion": the white hit flash is softened.
 * - "Reduzierte Bewegung": no gust fronts and a calmer flutter of cloth.
 */
import { defaultSettings, type Settings } from '../../engine/settings';
import { REDUCED_FLICKER_SCALE } from '../light/settings';
import { SURFACE_PARAMS } from './params';

export interface SurfaceRenderSettings {
  /** Puddles mirror lights and the sky (pass `pfuetzen`). */
  readonly puddleMirror: boolean;
  /** Share of the fireflies drawn (1 = all). */
  readonly fireflyShare: number;
  /** Strength of the white hit flash (1 = full white). */
  readonly flashStrength: number;
  /** Scale of gust fronts and cloth flutter (1 = full). */
  readonly motionScale: number;
  /** Flicker of the lights mirrored in puddles, as the light pass flickers them (flash reduction calms it). */
  readonly flickerScale: number;
}

/** Motion left with "Reduzierte Bewegung". */
export const REDUCED_MOTION_SCALE = 0.35;
/** Fireflies left with reduced weather particles. */
export const REDUCED_FIREFLY_SHARE = 0.5;

/** The surface's view of the player settings. */
export function surfaceSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): SurfaceRenderSettings {
  const g = settings.graphics;
  const a = settings.accessibility;
  return {
    puddleMirror: g.water === 'full',
    fireflyShare: g.weatherParticles === 'reduced' ? REDUCED_FIREFLY_SHARE : 1,
    flashStrength: a.flashReduction ? SURFACE_PARAMS.effects.reducedFlash : 1,
    motionScale: a.reducedMotion ? REDUCED_MOTION_SCALE : 1,
    flickerScale: a.flashReduction ? REDUCED_FLICKER_SCALE : 1,
  };
}

/** Settings until the page configures the surface (a fresh profile). */
export const DEFAULT_SURFACE_SETTINGS: SurfaceRenderSettings = surfaceSettingsFrom(defaultSettings());
