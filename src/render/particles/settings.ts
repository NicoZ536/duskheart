/**
 * Particle settings of the renderer (§6.3 quality table: "Wetter/Partikel reduziert/voll", Ultra "Partikellicht";
 * §29 accessibility "Blitz- und Flackerreduktion", "reduzierte Bewegung"), derived from the player settings by
 * `particleSettingsFrom`.
 */
import { PARTICLE_WORLD } from '../../content/particles';
import { defaultSettings, type Settings } from '../../engine/settings';
import { REDUCED_MOTION_SCALE } from '../post/state';

export interface ParticleRenderSettings {
  /** Share of the weather particles drawn (1 = full, "reduziert" keeps half). */
  readonly weatherShare: number;
  /** Share of every source's rate (1 = full). */
  readonly emitterShare: number;
  /** Emissive particles light their surroundings (Ultra). */
  readonly particleLights: boolean;
  /** Flash reduction: lightning is one soft pulse at a quarter of its strength, no flicker of emissive particles. */
  readonly flashReduction: boolean;
  /**
   * Reduced motion: scale of the heat shimmer's sway where the particle strand draws it itself (1, or
   * `REDUCED_MOTION_SCALE` like the post chain's distortion).
   */
  readonly motionScale: number;
}

/** The renderer's view of the player settings. */
export function particleSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): ParticleRenderSettings {
  const reduced = settings.graphics.weatherParticles === 'reduced';
  return {
    weatherShare: reduced ? PARTICLE_WORLD.reduced.weather : 1,
    emitterShare: reduced ? PARTICLE_WORLD.reduced.emitters : 1,
    particleLights: settings.graphics.particleLights,
    flashReduction: settings.accessibility.flashReduction,
    motionScale: settings.accessibility.reducedMotion ? REDUCED_MOTION_SCALE : 1,
  };
}

/** Settings until the page configures the particles (a fresh profile's). */
export const DEFAULT_PARTICLE_SETTINGS: ParticleRenderSettings = particleSettingsFrom(defaultSettings());
