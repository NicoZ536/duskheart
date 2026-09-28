/**
 * The atmosphere and post passes of the renderer (M5-10, M5-13 … M5-16, M5-22), installed by
 * `installAtmospherePost` after the light pipeline (which registers the closing post pass):
 *
 * | Pass | Order | Does |
 * |---|---|---|
 * | `corruption` | `PASS_ORDER.corruption` | palette shift and glowing veins of the corrupted area |
 * | `atmosphere` | `PASS_ORDER.atmosphere` | fog layers, the light pass's light scattered in the fog |
 * | `distortion` | `PASS_ORDER.distortion` | offset field: shock waves, heat, under water |
 * | `bloom` | `PASS_ORDER.bloom` | bright pass, four levels, glow over the scene |
 * | `post` | `PASS_ORDER.post` | (light pipeline) reads through the field, tonemaps, grades, state effects |
 * | `crt` | `PASS_ORDER.crt` | arms the optional CRT filter of the presentation |
 *
 * `configure` applies the player settings (`atmospherePostSettingsFrom`); every pass can be switched off
 * on its own in the debugger and the picture stays complete.
 */
import type { PresentationFinish } from '../output/upscaler';
import { AtmospherePass } from '../passes/atmospherePass';
import { BloomPass } from '../passes/bloomPass';
import { DistortionPass } from '../passes/distortionPass';
import { PostPass } from '../passes/postPass';
import { findLightPipeline } from '../light/pipeline';
import { PASS_ORDER, type PassRegistry } from '../passes/registry';
import { CorruptionPass } from './corruptionPass';
import { CrtPass } from './crtPass';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from './settings';
import { PostShared } from './shared';

/** The name of the light pipeline's closing post pass. */
export const POST_PASS = 'post';

export class AtmospherePost {
  private current: AtmospherePostSettings = DEFAULT_ATMOSPHERE_POST_SETTINGS;

  constructor(
    readonly corruption: CorruptionPass,
    readonly atmosphere: AtmospherePass,
    readonly distortion: DistortionPass,
    readonly bloom: BloomPass,
    readonly post: PostPass | null,
    readonly crt: CrtPass,
  ) {}

  get settings(): AtmospherePostSettings {
    return this.current;
  }

  /** Applies the graphics and accessibility settings. */
  configure(settings: AtmospherePostSettings): void {
    this.current = settings;
    this.corruption.configure(settings);
    this.atmosphere.configure(settings);
    this.distortion.configure(settings);
    this.bloom.configure(settings);
    this.post?.configure(settings);
    this.crt.configure(settings);
  }
}

/** Where the presentation takes its final step from (the renderer's upscaler). */
export interface PresentationHost {
  finish: PresentationFinish | null;
}

/**
 * Registers the atmosphere and post passes on `passes`, connects them to the post pass of the light
 * pipeline and the CRT filter to the presentation, and configures them.
 */
export function installAtmospherePost(passes: PassRegistry, presentation: PresentationHost | null = null, settings: AtmospherePostSettings = DEFAULT_ATMOSPHERE_POST_SETTINGS): AtmospherePost {
  const shared = new PostShared();
  const corruption = new CorruptionPass(shared);
  const atmosphere = new AtmospherePass(shared, findLightPipeline(passes)?.lighting ?? null);
  const distortion = new DistortionPass(shared);
  const bloom = new BloomPass(shared);
  const crt = new CrtPass();
  passes.add(corruption, PASS_ORDER.corruption);
  passes.add(atmosphere, PASS_ORDER.atmosphere);
  passes.add(distortion, PASS_ORDER.distortion);
  passes.add(bloom, PASS_ORDER.bloom);
  passes.add(crt, PASS_ORDER.crt);
  const found = passes.get(POST_PASS);
  const post = found instanceof PostPass ? found : null;
  post?.attach({ shared, distortion });
  if (presentation !== null) presentation.finish = crt;
  const pipeline = new AtmospherePost(corruption, atmosphere, distortion, bloom, post, crt);
  pipeline.configure(settings);
  return pipeline;
}
