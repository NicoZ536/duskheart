/**
 * Quality levels of the renderer (MASTERPROMPT §6.3, M5-25): the player settings – the level's preset
 * (`QUALITY_PRESETS` in src/engine/settings.ts) with any single option changed afterwards, plus the accessibility
 * options – resolved into the settings of every strand of the render pipeline, and applied to it in one step. The
 * strands keep their own `…SettingsFrom` (docs/RENDER.md §4 "Einbau"); this module is the one place that calls them
 * all, so a level reaches every pass: light and shadows (`lightSettingsFrom`), particles and weather
 * (`particleSettingsFrom`), water (`waterSettingsFrom`), fog, bloom and post (`atmospherePostSettingsFrom`), the world
 * surface (`surfaceSettingsFrom`).
 *
 * GI (§6.3 "Ultra: Radiance Cascades") has its slot here: `gi.requested` says whether the settings ask for it (Ultra
 * with the option on, `isGiActive`); `gi.available` stays false until the radiance-cascade passes of M13-01/M13-02
 * exist – the F3 overlay and the render debugger's `gi` view say so instead of pretending.
 */
import { applyQualityPreset, isGiActive, matchesQualityPreset, type QualityLevel, type Settings } from '../../engine/settings';
import { lightSettingsFrom, type LightRenderSettings } from '../light/settings';
import { particleSettingsFrom, type ParticleRenderSettings } from '../particles/settings';
import { atmospherePostSettingsFrom, type AtmospherePostSettings } from '../post/settings';
import { surfaceSettingsFrom, type SurfaceRenderSettings } from '../surface/settings';
import { waterSettingsFrom, type WaterRenderSettings } from '../water/settings';

/** The parts of the player settings the render quality reads. */
export type QualityInput = Pick<Settings, 'graphics' | 'accessibility'>;

/** Whether the radiance-cascade GI passes exist (M13-01/M13-02 build them; until then the level only requests GI). */
export const GI_AVAILABLE = false;

/** The GI slot of the quality level (§6.3 column "GI"). */
export interface GiSlot {
  /** The settings ask for GI (quality Ultra with the GI option on). */
  readonly requested: boolean;
  /** The renderer has GI passes (M13); false: nothing is computed, the debugger's `gi` buffer stays empty. */
  readonly available: boolean;
}

/** One quality level resolved for every strand of the render pipeline. */
export interface RenderQuality {
  readonly level: QualityLevel;
  /** The detail options are exactly the level's preset (false: the player changed single options). */
  readonly preset: boolean;
  readonly light: LightRenderSettings;
  readonly particles: ParticleRenderSettings;
  readonly water: WaterRenderSettings;
  readonly atmosphere: AtmospherePostSettings;
  readonly surface: SurfaceRenderSettings;
  readonly gi: GiSlot;
  /** The light buffer may be halved on frame drops (§6.3, setting `graphics.adaptiveLightBuffer`). */
  readonly adaptiveLightBuffer: boolean;
}

/** Resolves the player settings into the settings of every strand. */
export function renderQualityFrom(settings: QualityInput): RenderQuality {
  const g = settings.graphics;
  return {
    level: g.quality,
    preset: matchesQualityPreset(g),
    light: lightSettingsFrom(settings),
    particles: particleSettingsFrom(settings),
    water: waterSettingsFrom(settings),
    atmosphere: atmospherePostSettingsFrom(settings),
    surface: surfaceSettingsFrom(settings),
    gi: { requested: isGiActive(g), available: GI_AVAILABLE },
    adaptiveLightBuffer: g.adaptiveLightBuffer,
  };
}

/** `settings` rendered at `level`: the level's preset over the graphics settings, everything else kept. */
export function atLevel(settings: QualityInput, level: QualityLevel): QualityInput {
  return { graphics: applyQualityPreset(settings.graphics, level), accessibility: settings.accessibility };
}

/** The pipelines a quality level configures (the renderer's strands; `Renderer` has exactly these). */
export interface QualityTargets {
  readonly lighting: { configure(settings: LightRenderSettings): void };
  readonly particles: { configure(settings: ParticleRenderSettings): void };
  readonly water: { configure(settings: WaterRenderSettings): void };
  readonly atmosphere: { configure(settings: AtmospherePostSettings): void };
  readonly surface: { configure(settings: SurfaceRenderSettings): void };
}

/** Configures every strand with its part of `quality` (switching at runtime: the next frame renders at it). */
export function applyRenderQuality(targets: QualityTargets, quality: RenderQuality): void {
  targets.lighting.configure(quality.light);
  targets.particles.configure(quality.particles);
  targets.water.configure(quality.water);
  targets.atmosphere.configure(quality.atmosphere);
  targets.surface.configure(quality.surface);
}
