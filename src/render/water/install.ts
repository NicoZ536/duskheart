/**
 * Installs the water strand on the renderer (docs/RENDER.md §4 "Einbau"): the water pass at `PASS_ORDER.water`,
 * reading the occluder pass's water distance field when the light pipeline is installed. `configure` applies the
 * graphics settings (`waterSettingsFrom`, §6.3); the pass can be switched off in the debugger
 * (`__dh.call('renderPass', 'water', false)`) – the image stays complete, the water then shows as the terrain drew it.
 */
import { findLightPipeline } from '../light/pipeline';
import { PASS_ORDER, type PassRegistry } from '../passes/registry';
import { WaterPass } from '../passes/waterPass';
import { DEFAULT_WATER_SETTINGS, type WaterRenderSettings } from './settings';

export class WaterPipeline {
  private current: WaterRenderSettings = DEFAULT_WATER_SETTINGS;

  constructor(readonly pass: WaterPass) {}

  get settings(): WaterRenderSettings {
    return this.current;
  }

  /** Applies the graphics settings (refraction, reflection, waves, caustics, reduced motion). */
  configure(settings: WaterRenderSettings): void {
    this.current = settings;
    this.pass.settings = settings;
  }
}

/** Installed water pipelines by pass registry (one per renderer). */
const installed = new WeakMap<PassRegistry, WaterPipeline>();

/** The water installed on `passes` (null when there is none). */
export function findWater(passes: PassRegistry): WaterPipeline | null {
  const w = installed.get(passes);
  return w !== undefined && passes.get(w.pass.name) === w.pass ? w : null;
}

/** Registers the water pass on `passes` (after the light pipeline, whose distance field it reads) and configures it. */
export function installWater(passes: PassRegistry, settings: WaterRenderSettings = DEFAULT_WATER_SETTINGS): WaterPipeline {
  const pass = new WaterPass(findLightPipeline(passes)?.occluder ?? null);
  passes.add(pass, PASS_ORDER.water);
  const pipeline = new WaterPipeline(pass);
  pipeline.configure(settings);
  installed.set(passes, pipeline);
  return pipeline;
}
