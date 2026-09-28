/**
 * The lit pipeline of the renderer (M1-18/M1-19, M5-01 … M5-06): occluder mask and distance fields
 * (`PASS_ORDER.occluder`), sun and moon shadows with clouds and canopy flecks (`PASS_ORDER.shadow`), light pass
 * (`PASS_ORDER.lighting`), composition (`PASS_ORDER.composite`, replaces the unlit fallback) and the post
 * chain's closing tonemap (`PASS_ORDER.post`, replaces the plain HDR resolve). Every pass can be switched off on
 * its own in the debugger (`__dh.call('renderPass', name, false)`); the image stays complete: without the
 * occluder pass lights cast no shadows, without the shadow pass the sun shines everywhere, without the light
 * pass the composition shows the scene unlit, without the composition the unlit pass returns, without post the
 * plain resolve.
 */
import type { PassRegistry } from '../passes/registry';
import { PASS_ORDER } from '../passes/registry';
import { CompositePass } from '../passes/compositePass';
import { LightingPass } from '../passes/lightingPass';
import { OccluderPass } from '../passes/occluderPass';
import { ShadowPass } from '../passes/shadowPass';
import { PostPass } from '../passes/postPass';
import { PassTimer, TimingGate, timePass, type LightPassTimings } from './passTimer';
import { DEFAULT_LIGHT_SETTINGS, type LightRenderSettings } from './settings';

/** Names of the renderer's built-in passes the pipeline stands in for (passes/unlitPass.ts, passes/hdrResolvePass.ts). */
export const UNLIT_PASS = 'unlit';
export const RESOLVE_PASS = 'resolve';

export class LightPipeline {
  private current: LightRenderSettings = DEFAULT_LIGHT_SETTINGS;
  /** Timers of the strand's passes (occluder, shadow, lighting, composite), in pass order. */
  readonly timers: ReadonlyArray<{ readonly name: string; readonly timer: PassTimer }>;
  private readonly times: LightPassTimings;
  /** The timers measure while someone reads their times (`timings`). */
  private readonly gate = new TimingGate();

  constructor(
    readonly occluder: OccluderPass,
    readonly shadow: ShadowPass,
    readonly lighting: LightingPass,
    readonly composite: CompositePass,
    readonly post: PostPass,
  ) {
    this.timers = [occluder, shadow, lighting, composite].map((p, i) => ({ name: p.name, timer: new PassTimer(this.gate, i === 0) }));
    this.times = { passes: this.timers.map((t) => ({ name: t.name, gpuMs: null, cpuMs: 0 })), gpuMs: null, cpuMs: 0 };
  }

  /**
   * GPU (where timer queries exist) and CPU times of the strand's passes, smoothed; the record is reused. Asking keeps
   * the timers measuring for the next `TIMING_WINDOW_FRAMES` frames (the first answer after a pause is the last one).
   */
  timings(): LightPassTimings {
    this.gate.request();
    const t = this.times;
    let gpu: number | null = null;
    let cpu = 0;
    for (let i = 0; i < this.timers.length; i++) {
      const timer = (this.timers[i] as { readonly timer: PassTimer }).timer;
      const out = t.passes[i];
      if (out === undefined) continue;
      out.gpuMs = timer.gpuMs;
      out.cpuMs = timer.cpuMs;
      if (timer.gpuMs !== null) gpu = (gpu ?? 0) + timer.gpuMs;
      cpu += timer.cpuMs;
    }
    t.gpuMs = gpu;
    t.cpuMs = cpu;
    return t;
  }

  get settings(): LightRenderSettings {
    return this.current;
  }

  /** Applies the graphics/accessibility settings (bands, dither, light cap, flicker reduction). */
  configure(settings: LightRenderSettings): void {
    this.current = settings;
    this.lighting.maxLights = settings.maxLights;
    this.lighting.flickerScale = settings.flickerScale;
    this.lighting.shadows = settings.shadows;
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

/** Registers occluder pass, light pass, composition and post on `passes` and configures them. */
export function installLightPipeline(passes: PassRegistry, settings: LightRenderSettings = DEFAULT_LIGHT_SETTINGS): LightPipeline {
  const occluder = new OccluderPass();
  const shadow = new ShadowPass(occluder);
  const lighting = new LightingPass(occluder);
  const composite = new CompositePass(lighting, occluder, shadow, passes.get(UNLIT_PASS));
  const post = new PostPass(passes.get(RESOLVE_PASS));
  const pipeline = new LightPipeline(occluder, shadow, lighting, composite, post);
  // GPU and CPU time of each pass (the F3 overlay): wrapped before registering, so `init` sets the timer up too.
  for (const [i, pass] of [occluder, shadow, lighting, composite].entries()) {
    const t = pipeline.timers[i];
    if (t !== undefined) timePass(pass, t.timer);
  }
  passes.add(occluder, PASS_ORDER.occluder);
  passes.add(shadow, PASS_ORDER.shadow);
  passes.add(lighting, PASS_ORDER.lighting);
  passes.add(composite, PASS_ORDER.composite);
  passes.add(post, PASS_ORDER.post);
  pipeline.configure(settings);
  installed.set(passes, pipeline);
  return pipeline;
}
