/**
 * Particle settings of the renderer (§6.3 quality table: "Wetter/Partikel reduziert/voll", Ultra "Partikellicht";
 * §29 accessibility "Blitz- und Flackerreduktion"), derived from the player settings by `particleSettingsFrom`.
 */
import { PARTICLE_WORLD } from '../../content/particles';
import { defaultSettings, type Settings } from '../../engine/settings';

export interface ParticleRenderSettings {
  /** Share of the weather particles drawn (1 = full, "reduziert" keeps half). */
  readonly weatherShare: number;
  /** Share of every source's rate (1 = full). */
  readonly emitterShare: number;
  /** Emissive particles light their surroundings (Ultra; the Radiance-Cascades GI of M13 takes them up). */
  readonly particleLights: boolean;
  /** Flash reduction: lightning is one soft pulse at a quarter of its strength, no flicker of emissive particles. */
  readonly flashReduction: boolean;
}

/** The renderer's view of the player settings. */
export function particleSettingsFrom(settings: Pick<Settings, 'graphics' | 'accessibility'>): ParticleRenderSettings {
  const reduced = settings.graphics.weatherParticles === 'reduced';
  return {
    weatherShare: reduced ? PARTICLE_WORLD.reduced.weather : 1,
    emitterShare: reduced ? PARTICLE_WORLD.reduced.emitters : 1,
    particleLights: settings.graphics.particleLights,
    flashReduction: settings.accessibility.flashReduction,
  };
}

/** Settings until the page configures the particles (a fresh profile's). */
export const DEFAULT_PARTICLE_SETTINGS: ParticleRenderSettings = particleSettingsFrom(defaultSettings());
