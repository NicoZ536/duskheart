/**
 * The lit pipeline of the renderer (M1-18/M1-19): light pass (`PASS_ORDER.lighting`), composition
 * (`PASS_ORDER.composite`, replaces the unlit fallback) and the post chain's closing tonemap
 * (`PASS_ORDER.post`, replaces the plain HDR resolve). Every pass can be switched off on its own in
 * the debugger (`__dh.call('renderPass', name, false)`); the image stays complete: without the light
 * pass the composition shows the scene unlit, without the composition the unlit pass returns, without
 * post the plain resolve.
 */
import type { PassRegistry } from '../passes/registry';
import { PASS_ORDER } from '../passes/registry';
import { CompositePass } from '../passes/compositePass';
import { LightingPass } from '../passes/lightingPass';
import { PostPass } from '../passes/postPass';
import { DEFAULT_LIGHT_SETTINGS, type LightRenderSettings } from './settings';

/** Names of the renderer's built-in passes the pipeline stands in for (passes/unlitPass.ts, passes/hdrResolvePass.ts). */
export const UNLIT_PASS = 'unlit';
export const RESOLVE_PASS = 'resolve';

export class LightPipeline {
  private current: LightRenderSettings = DEFAULT_LIGHT_SETTINGS;

  constructor(
    readonly lighting: LightingPass,
    readonly composite: CompositePass,
    readonly post: PostPass,
  ) {}

  get settings(): LightRenderSettings {
    return this.current;
  }

  /** Applies the graphics/accessibility settings (bands, dither, light cap, flicker reduction). */
  configure(settings: LightRenderSettings): void {
    this.current = settings;
    this.lighting.maxLights = settings.maxLights;
    this.lighting.flickerScale = settings.flickerScale;
    this.composite.banding = settings.banding;
    this.composite.bands = settings.bands;
    this.composite.dither = settings.dither;
  }
}

/** Installed pipelines by pass registry (one per renderer). */
const installed = new WeakMap<PassRegistry, LightPipeline>();

/** The pipeline installed on `passes` (null when there is none), e.g. for scenes and tools. */
export function findLightPipeline(passes: PassRegistry): LightPipeline | null {
  const p = installed.get(passes);
  return p !== undefined && passes.get(p.lighting.name) === p.lighting ? p : null;
}

/** Registers light pass, composition and post on `passes` and configures them. */
export function installLightPipeline(passes: PassRegistry, settings: LightRenderSettings = DEFAULT_LIGHT_SETTINGS): LightPipeline {
  const lighting = new LightingPass();
  const composite = new CompositePass(lighting, passes.get(UNLIT_PASS));
  const post = new PostPass(passes.get(RESOLVE_PASS));
  passes.add(lighting, PASS_ORDER.lighting);
  passes.add(composite, PASS_ORDER.composite);
  passes.add(post, PASS_ORDER.post);
  const pipeline = new LightPipeline(lighting, composite, post);
  pipeline.configure(settings);
  installed.set(passes, pipeline);
  return pipeline;
}
