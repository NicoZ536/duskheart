/**
 * Atmosphere pass (MASTERPROMPT §6.1 pass 8 "Nebelschichten (Rauschen; Dichte nach Biom/Wetter/Zeit;
 * Lichter streuen im Nebel)", M5-10): fog over the lit scene in two fullscreen steps –
 *
 * 1. **Density** (`fog_density.frag`): three drifting layers of the noise tile, anchored to the ground
 *    under each pixel (the 3/4 view: a pixel h px up belongs to the ground h px further south), thinned
 *    with the height above the fog floor (the ground level at the camera) – tree crowns, walls and high
 *    ground rise out of low mist, lower ground drowns in it. Into its own target; the render debugger
 *    shows it as `fog`.
 * 2. **Fog and scattered light** (`fog_composite.frag`): the density in fine bands with Bayer seams, lit
 *    by the ambient light, blended over the HDR target – plus the light the fog scatters: the point and
 *    spot light of the light pass at the pixel (softened over a few pixels), as strong as the fog is dense
 *    there. Torches glow in the mist, and because the light pass traces its shadows through the occluder
 *    distance field, the glow stops where the light stops: no halo bleeds through a wall.
 *
 * The scene says how much fog there is (`env.fog`, colour `env.fogR/G/B`, thickness `env.fogHeight` above
 * `env.fogFloor`, filled by the game view from biome, daytime and weather); without fog the pass draws
 * nothing. The setting `graphics.fog` switches it (`configure`); the scattered light follows the light
 * pass and with it the quality level's light cap and shadows.
 */
import { GBUFFER_ALBEDO, GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from '../post/settings';
import type { PostShared } from '../post/shared';
import { LIGHT_DIFFUSE, type LightingPass } from './lightingPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Render-debugger view of the fog density. */
export const FOG_DEBUG_VIEW = 'fog';
/** Least fog density that is drawn. */
export const MIN_FOG = 0.004;
/**
 * Look of the fog layers: noise tiles of the low mist, the drifting banks and the high veils [world px],
 * drift speeds [px/s] (a creep without wind and the share of the signed wind), the banks' contrast and the
 * floor of thin fog between them, the bands of the quantised density, the most opacity, the share of the
 * fog a glowing pixel shows (flames shine through), and how much brighter than the ground the mist reads
 * in dim light (it scatters the moonlight of its whole depth: × 1 + lift · (1 − ambient)).
 */
export const FOG_LOOK = {
  tileLow: 144,
  tileMid: 272,
  tileHigh: 448,
  creep: 3,
  wind: 14,
  contrast: 2.6,
  floor: 0.16,
  steps: 16,
  opacity: 0.55,
  emissive: 0.25,
  nightLift: 1.2,
} as const;
/**
 * Light scattered in fog: how strongly a unit of fog scatters the light that reaches it, the distance of
 * the softening taps [px] (the glow is smooth, not the relief of the lit ground), the range the scattered
 * light is quantised over and its steps there (fine: a soft glow with faint Bayer seams, never coarse dots
 * over the bright core).
 */
export const FOG_SCATTER = { strength: 0.3, tapPx: 4, range: 2, steps: 64 } as const;

/**
 * Fog amount 0…1 at `density` for the layers' pattern value `v` (mirror of `fogAmount` in fog.glsl): thin
 * fog lies in banks (down to `FOG_LOOK.floor` of the density between them), thick fog closes up.
 */
export function fogAmount(density: number, v: number): number {
  const banks = Math.max(0, Math.min(1, (v - 0.5) * FOG_LOOK.contrast + 0.5));
  return Math.max(0, Math.min(1, density * (FOG_LOOK.floor + (1 - FOG_LOOK.floor) * banks)));
}

/**
 * Share of the fog a pixel `h` px above level 0 sees under fog `height` px thick lying on the floor
 * `floor` px (mirror of `fogHeightFade`): full at and below the floor, nothing from floor + height up.
 */
export function fogHeightFade(h: number, height: number, floor = 0): number {
  return height <= 0 ? 0 : Math.max(0, Math.min(1, 1 - (h - floor) / height));
}

/**
 * Light scattered towards the viewer by fog of density `density` (0…1) under light of brightness `light`
 * (brightest channel of the light pass at the pixel), before quantisation (mirror of `fogScatter`).
 */
export function fogScatter(density: number, light: number): number {
  return Math.max(0, density) * Math.max(0, light) * FOG_SCATTER.strength;
}

const UNIT_A = 0;
const UNIT_B = 1;
const UNIT_C = 2;
const UNIT_D = 3;
const ZERO: readonly number[] = [0, 0, 0, 0];

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the fog shaders. */
export function fogDefines(): Readonly<Record<string, string>> {
  return {
    DH_FOG_TILE_LOW: glslFloat(FOG_LOOK.tileLow),
    DH_FOG_TILE_MID: glslFloat(FOG_LOOK.tileMid),
    DH_FOG_TILE_HIGH: glslFloat(FOG_LOOK.tileHigh),
    DH_FOG_CREEP: glslFloat(FOG_LOOK.creep),
    DH_FOG_WIND: glslFloat(FOG_LOOK.wind),
    DH_FOG_CONTRAST: glslFloat(FOG_LOOK.contrast),
    DH_FOG_FLOOR: glslFloat(FOG_LOOK.floor),
    DH_FOG_STEPS: glslFloat(FOG_LOOK.steps),
    DH_FOG_OPACITY: glslFloat(FOG_LOOK.opacity),
    DH_FOG_EMISSIVE: glslFloat(FOG_LOOK.emissive),
    DH_SCATTER_STRENGTH: glslFloat(FOG_SCATTER.strength),
    DH_SCATTER_TAP: String(FOG_SCATTER.tapPx),
    DH_SCATTER_RANGE: glslFloat(FOG_SCATTER.range),
    DH_SCATTER_STEPS: glslFloat(FOG_SCATTER.steps),
  };
}

export class AtmospherePass implements RenderPass {
  readonly name = 'atmosphere';
  enabled = DEFAULT_ATMOSPHERE_POST_SETTINGS.fog;
  private density: RenderTarget | null = null;
  private densityProgram: ShaderProgram | null = null;
  private compositeProgram: ShaderProgram | null = null;
  private densityDirty = false;
  /** Whether the last frame drew fog, and whether it scattered the light pass's light (statistics, tests). */
  drewFog = false;
  scattered = false;

  /**
   * @param shared the noise tile of the atmosphere and post passes
   * @param lighting the light pass whose point and spot light the fog scatters (null: fog without glow)
   */
  constructor(
    private readonly shared: PostShared,
    private readonly lighting: LightingPass | null,
  ) {}

  configure(settings: AtmospherePostSettings): void {
    this.enabled = settings.fog;
  }

  /** The density target (null before `init`). */
  get densityTexture(): Texture2D | null {
    return this.density?.texture(0) ?? null;
  }

  init(setup: PassSetup): void {
    this.shared.acquire(setup);
    const defines = fogDefines();
    this.density = setup.resources.add(new RenderTarget(setup.gl, { label: 'fog', width: 1, height: 1, attachments: [{ name: 'density', format: 'RGBA8' }], floatTargets: setup.caps.floatTargets }));
    this.densityProgram = setup.shaders.program({ name: 'fog-density', vertex: 'fullscreen.vert', fragment: 'fog_density.frag', defines });
    this.compositeProgram = setup.shaders.program({ name: 'fog-composite', vertex: 'fullscreen.vert', fragment: 'fog_composite.frag', defines });
    const density = this.density;
    setup.debugViews.register({ name: FOG_DEBUG_VIEW, mode: 'red', source: () => density.texture(0) });
  }

  resize(size: FrameSize): void {
    this.density?.resize(size.width, size.height);
    this.shared.resize(size);
  }

  execute(ctx: RenderContext): void {
    const env = ctx.scene.env;
    const target = this.density;
    const noise = this.shared.noise;
    this.drewFog = false;
    this.scattered = false;
    if (target === null || noise === null) return;
    const gl = ctx.gl;
    if (!(env.fog >= MIN_FOG)) {
      // Keep the debug view truthful: an empty density once the fog is gone.
      if (this.densityDirty) {
        target.bind();
        gl.clearBufferfv(gl.COLOR, 0, ZERO);
        this.densityDirty = false;
      }
      return;
    }
    const dp = this.densityProgram;
    const cp = this.compositeProgram;
    if (dp === null || cp === null || !dp.use()) return;
    const f = ctx.frame;
    const g = ctx.targets.gbuffer;
    target.bind();
    g.texture(GBUFFER_ALBEDO).bind(UNIT_A);
    g.texture(GBUFFER_NORMAL).bind(UNIT_B);
    noise.bind(UNIT_C);
    g.texture(GBUFFER_EMISSIVE).bind(UNIT_D);
    gl.uniform1i(dp.uniform('uAlbedo'), UNIT_A);
    gl.uniform1i(dp.uniform('uNormal'), UNIT_B);
    gl.uniform1i(dp.uniform('uNoise'), UNIT_C);
    gl.uniform1i(dp.uniform('uSurface'), UNIT_D);
    gl.uniform2f(dp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(dp.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1f(dp.uniform('uTime'), f.time);
    gl.uniform4f(dp.uniform('uFog'), env.fog, env.fogHeight, env.wind, env.fogFloor);
    ctx.drawFullscreen();
    this.densityDirty = true;
    if (!cp.use()) return;
    const lighting = this.lighting;
    const light = lighting !== null && lighting.ranInFrame(f.index) ? lighting.texture(LIGHT_DIFFUSE) : null;
    ctx.targets.hdr.bind();
    target.texture(0).bind(UNIT_A);
    // Without the light pass the sampler points at the density (never read: `uScatter` 0).
    (light ?? target.texture(0)).bind(UNIT_B);
    gl.uniform1i(cp.uniform('uFog'), UNIT_A);
    gl.uniform1i(cp.uniform('uLight'), UNIT_B);
    gl.uniform1i(cp.uniform('uScatter'), light !== null ? 1 : 0);
    const ambient = env.ambientIntensity;
    const lit = ambient * (1 + FOG_LOOK.nightLift * Math.max(0, 1 - ambient));
    gl.uniform3f(cp.uniform('uFogColor'), env.fogR * env.ambientR * lit, env.fogG * env.ambientG * lit, env.fogB * env.ambientB * lit);
    gl.uniform2f(cp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(cp.uniform('uTargetSize'), f.width, f.height);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    ctx.drawFullscreen();
    gl.disable(gl.BLEND);
    this.drewFog = true;
    this.scattered = light !== null;
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(FOG_DEBUG_VIEW);
    if (this.density !== null) setup.resources.remove(this.density);
    for (const p of [this.densityProgram, this.compositeProgram]) if (p !== null) setup.shaders.release(p);
    this.density = null;
    this.densityProgram = null;
    this.compositeProgram = null;
    this.shared.release(setup);
  }
}
