/**
 * Installation of the world surface in a renderer (docs/RENDER.md §4 "Einbau"): the interaction texture before the
 * G-buffer (`PASS_ORDER.surfaceInteraction`) and the puddle mirror after the composition (`PASS_ORDER.surfacePuddles`),
 * configured from the player settings (`surfaceSettingsFrom`). The sprite and terrain programs read the surface
 * through `frame.ts`; the scene part is `RenderScene.surface`, filled by `world/surfaceScene.ts`.
 */
import { PASS_ORDER, type PassRegistry } from '../passes/registry';
import { SurfaceInteractionPass } from './interactionPass';
import { SurfacePuddlePass } from './puddlePass';
import { DEFAULT_SURFACE_SETTINGS, type SurfaceRenderSettings } from './settings';

export class SurfacePipeline {
  private current: SurfaceRenderSettings;

  constructor(
    readonly interaction: SurfaceInteractionPass,
    readonly puddles: SurfacePuddlePass,
    settings: SurfaceRenderSettings,
  ) {
    this.current = settings;
  }

  get settings(): SurfaceRenderSettings {
    return this.current;
  }

  /** Applies the graphics and accessibility settings (puddle mirror, fireflies, flash, motion). */
  configure(settings: SurfaceRenderSettings): void {
    this.current = settings;
  }
}

/** Registers the surface passes on `passes`. */
export function installSurface(passes: PassRegistry, settings: SurfaceRenderSettings = DEFAULT_SURFACE_SETTINGS): SurfacePipeline {
  const interaction = new SurfaceInteractionPass();
  const puddles = new SurfacePuddlePass();
  const pipeline = new SurfacePipeline(interaction, puddles, settings);
  interaction.pipeline = pipeline;
  passes.add(interaction, PASS_ORDER.surfaceInteraction);
  passes.add(puddles, PASS_ORDER.surfacePuddles);
  return pipeline;
}
