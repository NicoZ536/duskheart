/**
 * Atmosphere pass (MASTERPROMPT §6.1 pass 8 "Nebelschichten (Rauschen; Dichte nach Biom/Wetter/Zeit;
 * Lichter streuen im Nebel)", M5-10): fog over the lit scene in two fullscreen steps –
 *
 * 1. **Density** (`fog_density.frag`): three drifting layers of the noise tile, anchored to the ground
 *    under each pixel (the 3/4 view: a pixel h px above the ground of its occluder-mask texel belongs to the
 *    ground h px further south – `sdfGroundPoint`; raised levels are drawn where they lie), thinned
 *    with the height above the fog floor (the ground level at the camera) – tree crowns, walls and high
 *    ground rise out of low mist, lower ground drowns in it. In a roofed room of the build grid the air is
 *    still: its fog is `FOG_ROOM.density` of the open air's (`fogIndoors`). Into its own target (r density, g open
 *    air); the render debugger shows the density as `fog`.
 * 2. **Fog and scattered light** (`fog_composite.frag`): the density in fine bands with Bayer seams, lit
 *    by the ambient light, blended over the HDR target – plus the light the fog scatters: the point and
 *    spot light of the light pass at the pixel (softened over a few pixels), as strong as the fog is dense
 *    there. Torches glow in the mist, and because the light pass traces its shadows through the occluder
 *    distance field, the glow stops where the light stops: no halo bleeds through a wall – and the softening
 *    takes only neighbours in the same air (`fogSameAir`), none across the wall of a room. A room's fog is lit by
 *    the sky's share of the ambient that a roof lets in (`fogRoofedLight`), not by the open air's light.
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
import { frameAmbient } from '../light/frameAmbient';
import { BUILDING_SUN, lightStrandDefines } from '../light/params';
import { bitsChanged } from '../uniformBits';
import { DRIFT_UNITS } from '../world/drift';
import { LIGHT_DIFFUSE, type LightingPass } from './lightingPass';
import type { OccluderPass } from './occluderPass';
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
  /** Southward share of the creep (the banks roll a little towards the viewer). */
  creepSouth: 0.4,
  /** Drift of the low mist, the banks and the high veils against the banks' (parallax). */
  layerDrift: [0.6, 1, 1.8],
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
 * Fog in the rooms of the build grid (M5 review M5): the share of the open air's density a roofed room keeps (still air
 * behind walls and doors – a faint haze, no veil), how far roof must reach on every side of a point for it to count as
 * inside [px] (a wall's tile is roofed beyond its band too: that strip outside the wall is open air), and how far south of
 * a wall's footprint the air lies that its visible south face shows [px] (past the 6-px band, `WALL_BAND`).
 */
export const FOG_ROOM = { density: 0.15, reachPx: 6, facePx: 7 } as const;

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

/** Weight of a softening tap in air `tapOpen` for a pixel in air `open` (1 open air, 0 a room; mirror of `fogSameAir`). */
export function fogSameAir(tapOpen: number, open: number): number {
  return Math.abs(tapOpen - open) <= 0.5 ? 1 : 0;
}

/** What the fog needs of the occluder mask (`OccluderField` of light/lightMath.ts is one): walls and roofs at world points. */
export interface FogRooms {
  /** Whether a wall stands at world point (x, y) (`sdfOccluder(…).y`). */
  wall(x: number, y: number): boolean;
  /** Whether a roof covers world point (x, y) (`sdfRoofed`). */
  roofed(x: number, y: number): boolean;
}

/**
 * Whether a pixel whose ground point is (x, y) shows the air of a roofed room (mirror of fog_density.frag): the air in
 * front of a wall lies `FOG_ROOM.facePx` south of its footprint, and it is a room's where roof reaches
 * `FOG_ROOM.reachPx` on every side. `top`: the pixel is a roof or crown above its ground (open air).
 */
export function fogIndoors(rooms: FogRooms, x: number, y: number, top: boolean): boolean {
  if (top) return false;
  const ay = rooms.wall(x, y) ? y + FOG_ROOM.facePx : y;
  const r = FOG_ROOM.reachPx;
  return rooms.roofed(x, ay) && rooms.roofed(x + r, ay) && rooms.roofed(x - r, ay) && rooms.roofed(x, ay + r) && rooms.roofed(x, ay - r);
}

/**
 * Light of a room's fog per channel as a share of the open air's (mirror of the upload of `uFogColorRoofed`): the sky's
 * part of the ambient (`skyTint`, the ambient's multiplier for it; 1 without a directed light) that the roof lets in
 * (`BUILDING_SUN.roofSkyShare`) – the sun or moon does not reach under the roof.
 */
export function fogRoofedLight(skyTint: number): number {
  return skyTint * BUILDING_SUN.roofSkyShare;
}

const UNIT_A = 0;
const UNIT_B = 1;
const UNIT_C = 2;
const UNIT_D = 3;
const UNIT_MASK = 4;
const ZERO: readonly number[] = [0, 0, 0, 0];
/** Slots of the colour inputs: fog r, g, b, –, the frame's ambient record (4), the sky's tint r, g, b and whether a directed light shines. */
const IN_AMBIENT = 4;
const IN_SKY = 8;
const IN_DIRECTED = 11;
const COLOR_INPUTS = 12;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the fog shaders (with the light strand's: the occluder mask of sdf.glsl). */
export function fogDefines(): Readonly<Record<string, string>> {
  return {
    ...lightStrandDefines(),
    DH_FOG_TILE_LOW: glslFloat(FOG_LOOK.tileLow),
    DH_FOG_TILE_MID: glslFloat(FOG_LOOK.tileMid),
    DH_FOG_TILE_HIGH: glslFloat(FOG_LOOK.tileHigh),
    DH_DRIFT_UNITS: glslFloat(DRIFT_UNITS),
    DH_FOG_CONTRAST: glslFloat(FOG_LOOK.contrast),
    DH_FOG_FLOOR: glslFloat(FOG_LOOK.floor),
    DH_FOG_STEPS: glslFloat(FOG_LOOK.steps),
    DH_FOG_OPACITY: glslFloat(FOG_LOOK.opacity),
    DH_FOG_EMISSIVE: glslFloat(FOG_LOOK.emissive),
    DH_SCATTER_STRENGTH: glslFloat(FOG_SCATTER.strength),
    DH_SCATTER_TAP: String(FOG_SCATTER.tapPx),
    DH_SCATTER_RANGE: glslFloat(FOG_SCATTER.range),
    DH_SCATTER_STEPS: glslFloat(FOG_SCATTER.steps),
    DH_FOG_ROOFED: glslFloat(FOG_ROOM.density),
    DH_FOG_ROOM_PX: glslFloat(FOG_ROOM.reachPx),
    DH_FOG_FACE_PX: glslFloat(FOG_ROOM.facePx),
  };
}

export class AtmospherePass implements RenderPass {
  readonly name = 'atmosphere';
  enabled = DEFAULT_ATMOSPHERE_POST_SETTINGS.fog;
  private density: RenderTarget | null = null;
  private densityProgram: ShaderProgram | null = null;
  private compositeProgram: ShaderProgram | null = null;
  private densityDirty = false;
  /**
   * Inputs of the fog colours (fog r, g, b, then the frame's ambient record, the sky's tint and whether a directed light
   * shines) as float32 and their bits at the last upload, with the program build it went to: the colours are computed
   * again only when one of them changed (§30).
   */
  private readonly colorInputs = new Float32Array(COLOR_INPUTS);
  private readonly colorBits = new Int32Array(this.colorInputs.buffer);
  private readonly colorUploaded = new Int32Array(COLOR_INPUTS);
  private colorAt = -1;
  /** Builds of the two programs whose sampler units are set. */
  private densitySamplersAt = -1;
  private compositeSamplersAt = -1;
  /**
   * Whether the last frame drew fog, whether it scattered the light pass's light, and whether it knew the rooms and the
   * ground heights from the occluder mask (statistics, tests).
   */
  drewFog = false;
  scattered = false;
  roomsKnown = false;

  /**
   * @param shared the noise tile of the atmosphere and post passes
   * @param lighting the light pass whose point and spot light the fog scatters (null: fog without glow)
   * @param occluder the occluder pass whose mask holds ground heights, walls and roofs (null: flat open ground everywhere)
   */
  constructor(
    private readonly shared: PostShared,
    private readonly lighting: LightingPass | null,
    private readonly occluder: OccluderPass | null = null,
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
    this.roomsKnown = false;
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
    // Ground heights, walls and roofs of the occluder mask (without it the sampler points at G1 and is never read).
    const occ = this.occluder;
    const mask = occ !== null && occ.ranInFrame(f.index) ? occ.maskTexture() : null;
    (mask ?? g.texture(GBUFFER_NORMAL)).bind(UNIT_MASK);
    if (this.densitySamplersAt !== dp.buildCount) {
      gl.uniform1i(dp.uniform('uAlbedo'), UNIT_A);
      gl.uniform1i(dp.uniform('uNormal'), UNIT_B);
      gl.uniform1i(dp.uniform('uNoise'), UNIT_C);
      gl.uniform1i(dp.uniform('uSurface'), UNIT_D);
      gl.uniform1i(dp.uniform('uMask'), UNIT_MASK);
      this.densitySamplersAt = dp.buildCount;
    }
    gl.uniform1i(dp.uniform('uHasFields'), mask !== null ? 1 : 0);
    if (mask !== null) occ?.bindFrame(gl, dp);
    gl.uniform2f(dp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(dp.uniform('uTargetSize'), f.width, f.height);
    gl.uniform2fv(dp.uniform('uFogDrift'), ctx.scene.sky.fogDrift);
    gl.uniform3f(dp.uniform('uFog'), env.fog, env.fogHeight, env.fogFloor);
    ctx.drawFullscreen();
    this.densityDirty = true;
    if (!cp.use()) return;
    const lighting = this.lighting;
    const light = lighting !== null && lighting.ranInFrame(f.index) ? lighting.texture(LIGHT_DIFFUSE) : null;
    ctx.targets.hdr.bind();
    target.texture(0).bind(UNIT_A);
    // Without the light pass the sampler points at the density (never read: `uScatter` 0).
    (light ?? target.texture(0)).bind(UNIT_B);
    if (this.compositeSamplersAt !== cp.buildCount) {
      gl.uniform1i(cp.uniform('uFog'), UNIT_A);
      gl.uniform1i(cp.uniform('uLight'), UNIT_B);
      this.compositeSamplersAt = cp.buildCount;
      this.colorAt = -1;
    }
    gl.uniform1i(cp.uniform('uScatter'), light !== null ? 1 : 0);
    const inputs = this.colorInputs;
    inputs[0] = env.fogR;
    inputs[1] = env.fogG;
    inputs[2] = env.fogB;
    inputs.set(frameAmbient(ctx), IN_AMBIENT);
    const sky = ctx.scene.sky;
    const directed = sky.hasDirectional;
    const d = sky.directional;
    if (directed) {
      inputs[IN_SKY] = d.skyR;
      inputs[IN_SKY + 1] = d.skyG;
      inputs[IN_SKY + 2] = d.skyB;
    } else {
      inputs.fill(1, IN_SKY, IN_DIRECTED);
    }
    inputs[IN_DIRECTED] = directed ? 1 : 0;
    if (bitsChanged(this.colorBits, this.colorUploaded, COLOR_INPUTS) || this.colorAt !== cp.buildCount) {
      // Fog colour lit by the ambient, lifted a little at night (the same product as ever, from the scene's doubles);
      // a room's fog by the sky's share the roof lets in.
      const ambient = env.ambientIntensity;
      const lit = ambient * (1 + FOG_LOOK.nightLift * Math.max(0, 1 - ambient));
      const r = env.fogR * env.ambientR * lit;
      const gg = env.fogG * env.ambientG * lit;
      const b = env.fogB * env.ambientB * lit;
      gl.uniform3f(cp.uniform('uFogColor'), r, gg, b);
      gl.uniform3f(cp.uniform('uFogColorRoofed'), r * fogRoofedLight(directed ? d.skyR : 1), gg * fogRoofedLight(directed ? d.skyG : 1), b * fogRoofedLight(directed ? d.skyB : 1));
      this.colorAt = cp.buildCount;
    }
    gl.uniform2f(cp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(cp.uniform('uTargetSize'), f.width, f.height);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    ctx.drawFullscreen();
    gl.disable(gl.BLEND);
    this.drewFog = true;
    this.scattered = light !== null;
    this.roomsKnown = mask !== null;
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
