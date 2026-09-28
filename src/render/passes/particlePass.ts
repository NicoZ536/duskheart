/**
 * The particle strand's passes at `PASS_ORDER.particles` (after water, before atmosphere; docs/RENDER.md §4; M5-11,
 * M5-12, M5-21), in this order:
 * - `heat-shimmer`: the hot air over fires displaces the lit scene (`particles/shimmer.ts`) – or, while the post chain's
 *   distortion pass runs, goes into its buffer as heat areas (`particles/distortion.ts`);
 * - `particles`: advances the GPU particles to the frame's time and draws them (`particles/system.ts`);
 * - `lightning`: the full-screen flash of a thunderstorm's lightning (every surface reflects it, a veil of its light
 *   lies over the whole picture).
 * Each can be switched off in the debugger (`__dh.call('renderPass', name, false)`); the picture stays complete.
 *
 * `installParticles(passes, settings)` registers them; `configure` applies the player settings
 * (`particleSettingsFrom`: weather and emitter share of the quality level, particle light, flash reduction).
 */
import { GBUFFER_ALBEDO } from '../gbuffer';
import type { ShaderProgram } from '../gl/shaders';
import { forwardHeat, heatShimmerClaimed, POST_DISTORTION_PASS } from '../particles/distortion';
import { DEFAULT_PARTICLE_SETTINGS, type ParticleRenderSettings } from '../particles/settings';
import { HeatShimmer } from '../particles/shimmer';
import { ParticleSystem } from '../particles/system';
import { LIGHTNING } from '../../content/particles';
import { PASS_ORDER, type FrameSize, type PassRegistry, type PassSetup, type RenderContext, type RenderPass } from './registry';

/** Names of the passes. */
export const PARTICLE_PASSES = { shimmer: 'heat-shimmer', particles: 'particles', lightning: 'lightning' } as const;

const UNIT_ALBEDO = 0;

export class ParticlePass implements RenderPass {
  readonly name = PARTICLE_PASSES.particles;
  enabled = true;

  constructor(readonly system: ParticleSystem) {}

  init(setup: PassSetup): void {
    this.system.init(setup);
  }

  resize(_size: FrameSize): void {
    // The particle buffers do not depend on the target size.
  }

  execute(ctx: RenderContext): void {
    this.system.prepare(ctx);
    const gl = ctx.gl;
    gl.enable(gl.BLEND);
    // Ultra: the glowing particles' light on the surfaces first (additive), then the particles themselves on top
    // (premultiplied colour); the HDR target's alpha stays.
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    this.system.drawLights(ctx);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.system.drawParticles(ctx);
    gl.disable(gl.BLEND);
  }

  dispose(setup: PassSetup): void {
    this.system.dispose(setup);
  }
}

export class HeatShimmerPass implements RenderPass {
  readonly name = PARTICLE_PASSES.shimmer;
  enabled = true;
  readonly shimmer = new HeatShimmer();
  /** Columns handed to the post chain's distortion buffer in the last frame. */
  forwarded = 0;
  private post: RenderPass | null = null;

  constructor(private readonly passes: PassRegistry) {}

  init(setup: PassSetup): void {
    this.shimmer.init(setup);
  }

  resize(size: FrameSize): void {
    this.shimmer.resize(size);
  }

  execute(ctx: RenderContext): void {
    this.shimmer.drawn = 0;
    this.forwarded = 0;
    if (heatShimmerClaimed(this.passes)) return;
    const list = ctx.scene.particles.distortion;
    const post = (this.post ??= this.passes.get(POST_DISTORTION_PASS) ?? null);
    if (post !== null && post.enabled) {
      this.forwarded = forwardHeat(list, ctx.scene.post.distortion);
      return;
    }
    this.shimmer.draw(ctx, list);
  }

  dispose(setup: PassSetup): void {
    this.shimmer.dispose(setup);
  }
}

export class LightningPass implements RenderPass {
  readonly name = PARTICLE_PASSES.lightning;
  enabled = true;
  private program: ShaderProgram | null = null;

  constructor(private readonly system: ParticleSystem) {}

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'lightning', vertex: 'fullscreen.vert', fragment: 'particle_flash.frag' });
  }

  resize(_size: FrameSize): void {
    // Reads the G-buffer, writes the HDR target – both sized by the renderer.
  }

  execute(ctx: RenderContext): void {
    this.system.prepare(ctx);
    const flash = this.system.flash;
    const p = this.program;
    if (!(flash > 0) || p === null || !p.use()) return;
    const gl = ctx.gl;
    const c = this.system.flashLight;
    const s = flash * LIGHTNING.staerke;
    ctx.targets.hdr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_ALBEDO).bind(UNIT_ALBEDO);
    gl.uniform1i(p.uniform('uAlbedo'), UNIT_ALBEDO);
    gl.uniform3f(p.uniform('uFlash'), c[0] * s, c[1] * s, c[2] * s);
    const v = s * LIGHTNING.schleier;
    gl.uniform3f(p.uniform('uVeil'), c[0] * v, c[1] * v, c[2] * v);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    ctx.drawFullscreen();
    gl.disable(gl.BLEND);
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    this.program = null;
  }
}

/** The particle strand's passes of one renderer (`installParticles`). */
export class ParticlePipeline {
  constructor(
    readonly system: ParticleSystem,
    readonly shimmer: HeatShimmerPass,
    readonly particles: ParticlePass,
    readonly lightning: LightningPass,
  ) {}

  get settings(): ParticleRenderSettings {
    return this.system.settings;
  }

  /** Applies the player settings (`particleSettingsFrom`). */
  configure(settings: ParticleRenderSettings): void {
    this.system.settings = settings;
  }
}

/** Registers heat shimmer, particles and lightning at `PASS_ORDER.particles` and configures them. */
export function installParticles(passes: PassRegistry, settings: ParticleRenderSettings = DEFAULT_PARTICLE_SETTINGS): ParticlePipeline {
  const system = new ParticleSystem();
  system.passes = passes;
  const shimmer = new HeatShimmerPass(passes);
  const particles = new ParticlePass(system);
  const lightning = new LightningPass(system);
  passes.add(shimmer, PASS_ORDER.particles);
  passes.add(particles, PASS_ORDER.particles);
  passes.add(lightning, PASS_ORDER.particles);
  const pipeline = new ParticlePipeline(system, shimmer, particles, lightning);
  pipeline.configure(settings);
  return pipeline;
}
