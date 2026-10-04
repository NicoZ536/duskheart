/**
 * Atmosphere pass (MASTERPROMPT §6.1 pass 8 "Nebelschichten (Rauschen; Dichte nach Biom/Wetter/Zeit;
 * Lichter streuen im Nebel)", M5-10): fog over the lit scene in two fullscreen steps –
 *
 * 1. **Density** (`fog_density.frag`): three drifting layers of the noise tile, anchored to the ground
 *    under each pixel (the 3/4 view: a pixel h px above the ground it stands on belongs to the ground h px further
 *    south – `groundPointAt`: the occluder mask in the flood frame, the occluder ring beyond it, M5-44; raised levels
 *    are drawn where they lie), thinned with the height above the fog floor (the ground level at the camera) – tree
 *    crowns, walls and high ground rise out of low mist, lower ground drowns in it. In a roofed room of the build grid
 *    the air is still: its fog is `FOG_ROOM.density` of the open air's (`fogIndoors`: a wall's face shows the air past
 *    its band – the side walls seen from inside the room's, M5-49 –, a doorway's floor the open air). Into its own
 *    target (r density, g open air); the render debugger shows the density as `fog`.
 * 2. **Fog and scattered light** (`fog_composite.frag`): the density in fine bands with Bayer seams, lit
 *    by the ambient light, blended over the HDR target – plus the light the fog scatters: the point and
 *    spot light of the light pass at the pixel (softened over a few pixels), as strong as the fog is dense
 *    there. Torches glow in the mist, and because the light pass traces its shadows through the occluder
 *    distance field, the glow stops where the light stops: no halo bleeds through a wall – and the softening
 *    takes only neighbours in the same air (`fogSameAir`), none across the wall of a room. A room's fog is lit by
 *    the sky's share of the ambient that a roof lets in (`fogRoofedLight`), not by the open air's light. The scattered
 *    light adds softly over the daylight that lights the fog (M5-41, `fogScatterShare`, the composition's
 *    `pointOverDaylight`): no torch glow in the sunlit noon's mist, nearly all of it at night and in caves.
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
import { dayLevel, pointOverAmbient, pointOverDaylight } from '../light/banding';
import { frameAmbient, frameDayLevel } from '../light/frameAmbient';
import { BUILDING_SUN, lightStrandDefines } from '../light/params';
import { bitsChanged } from '../uniformBits';
import type { DirectionalRecord } from '../light/sky';
import { ENV_SLOT } from '../scene';
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
 * inside [px] (a wall's tile is roofed beyond its band too: that strip outside the wall is open air), and how far past a
 * wall's band the air lies that its faces show [px] (past the 6-px band, `WALL_BAND`: south of an east–west run, east
 * and west of a north–south run).
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

/**
 * Share of the light pass's light the fog scatters over its own daylight (M5-41, mirror of fog_composite.frag with
 * `pointOverDaylight` of composite_daylight.glsl): the open air's fog is lit by the ambient `ar, ag, ab` (colour ×
 * strength) – `pointOverAmbient` –, a room's by the sky's share through the roof (`skyR…`: the ambient's multiplier for
 * the sky, 1 without a directed light; `fogRoofedLight`), both against the scene's daylight level. Sunlit noon 0: no
 * torch glow in the day's mist.
 */
export function fogScatterShare(open: boolean, ar: number, ag: number, ab: number, skyR = 1, skyG = 1, skyB = 1): number {
  if (open) return pointOverAmbient(ar, ag, ab);
  return pointOverDaylight(ar * fogRoofedLight(skyR), ag * fogRoofedLight(skyG), ab * fogRoofedLight(skyB), dayLevel(ar, ag, ab));
}

/**
 * What the fog needs of the occluders at world points (`FrameOccluders` of post/frameOccluders.ts: the occluder mask in
 * the flood frame, the ring beyond it).
 */
export interface FogRooms {
  /** Whether the band of a wall, closed door or gate lies at world point (x, y) (the structural channel at 1). */
  wall(x: number, y: number): boolean;
  /** Whether an opening of a wall – a window, an open door or gate – lies at world point (x, y) (`DH_OPENING_MARK`). */
  opening(x: number, y: number): boolean;
  /** Whether a roof covers world point (x, y) (`roofedAt`). */
  roofed(x: number, y: number): boolean;
}

/** Directions of the probes past a wall's band, in steps of `FOG_ROOM.facePx`: south, east, west, south-east, south-west. */
export const FOG_FACE_PROBES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
];

/** Whether the air at world point (x, y) lies in a roofed room: roof there and `FOG_ROOM.reachPx` on every side (`fogRoomAir`). */
export function fogRoomAir(rooms: FogRooms, x: number, y: number): boolean {
  const r = FOG_ROOM.reachPx;
  return rooms.roofed(x, y) && rooms.roofed(x + r, y) && rooms.roofed(x - r, y) && rooms.roofed(x, y + r) && rooms.roofed(x, y - r);
}

/**
 * Whether a pixel whose ground point is (x, y) shows the air of a roofed room (mirror of `fogIndoors` in
 * fog_density.frag). `top`: the pixel is a roof or crown above its ground (open air). `raised`: the pixel stands above its
 * ground (a wall's face, a window, a door leaf – not the floor).
 * - Off the bands of the walls: a room's where roof reaches `FOG_ROOM.reachPx` on every side (`fogRoomAir`).
 * - On a wall's or window's band the pixel shows the air past the band (M5-49): south of an east–west run (the view
 *   looks north onto the walls' south faces), east or west of a north–south run (the side walls seen from inside show
 *   the room), diagonally at a corner – the first probe `FOG_ROOM.facePx` away that lies off every band and in a room
 *   makes it the room's.
 * - The floor of a doorway (an opening's band seen on the ground) lies in the open air: the door stands open.
 */
export function fogIndoors(rooms: FogRooms, x: number, y: number, top: boolean, raised: boolean): boolean {
  if (top) return false;
  const wall = rooms.wall(x, y);
  if (!wall && !rooms.opening(x, y)) return fogRoomAir(rooms, x, y);
  if (!raised && !wall) return false;
  const f = FOG_ROOM.facePx;
  for (const [dx, dy] of FOG_FACE_PROBES) {
    const qx = x + dx * f;
    const qy = y + dy * f;
    if (!rooms.wall(qx, qy) && !rooms.opening(qx, qy) && fogRoomAir(rooms, qx, qy)) return true;
  }
  return false;
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
const UNIT_RING = 5;
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
  /**
   * The directed light whose sky colour is in the colour inputs (its record and version, whether it shone): a frame whose
   * light was not written reads none of its floats (§30).
   */
  private skyOf: DirectionalRecord | null = null;
  private skyVersion = -1;
  private skyLit = false;
  /** Fog density, thickness and floor of the frame (`uFog`, copied from the environment: no float read, §30). */
  private readonly fogUniform = new Float32Array(3);
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
  /** Whether the last frame knew the ground, walls and roofs beyond the mask's frame from the occluder ring (M5-44). */
  ringKnown = false;

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
    this.ringKnown = false;
    if (target === null || noise === null) return;
    const gl = ctx.gl;
    // No fog (exactly 0 – told from its bits, no float read, §30 – or too thin).
    if (env.zero(ENV_SLOT.fog) || !(env.fog >= MIN_FOG)) {
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
    // Ground heights, walls and roofs of the occluder mask and, beyond its frame, of the occluder ring (M5-44; without
    // them the samplers point at G1 and are never read).
    const occ = this.occluder;
    const normal = g.texture(GBUFFER_NORMAL);
    const mask = occ !== null && occ.ranInFrame(f.index) ? occ.maskTexture() : null;
    (mask ?? normal).bind(UNIT_MASK);
    if (this.densitySamplersAt !== dp.buildCount) {
      gl.uniform1i(dp.uniform('uAlbedo'), UNIT_A);
      gl.uniform1i(dp.uniform('uNormal'), UNIT_B);
      gl.uniform1i(dp.uniform('uNoise'), UNIT_C);
      gl.uniform1i(dp.uniform('uSurface'), UNIT_D);
      gl.uniform1i(dp.uniform('uMask'), UNIT_MASK);
      this.densitySamplersAt = dp.buildCount;
    }
    gl.uniform1i(dp.uniform('uHasFields'), mask !== null ? 1 : 0);
    if (occ !== null && mask !== null) {
      occ.bindFrame(gl, dp);
      occ.bindRing(gl, dp, UNIT_RING, f.index, normal);
      this.ringKnown = occ.ringInFrame(f.index);
    } else {
      normal.bind(UNIT_RING);
      gl.uniform1i(dp.uniform('uRing'), UNIT_RING);
      gl.uniform1i(dp.uniform('uHasRing'), 0);
    }
    gl.uniform2f(dp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(dp.uniform('uTargetSize'), f.width, f.height);
    gl.uniform2fv(dp.uniform('uFogDrift'), ctx.scene.sky.fogDrift);
    const fog = this.fogUniform;
    fog.set(env.fogValues);
    gl.uniform3fv(dp.uniform('uFog'), fog);
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
    // The colour inputs by copies (fog colour, ambient) and, when the sky's directed light was written, its sky colour.
    const inputs = this.colorInputs;
    inputs.set(env.fogColorValues, 0);
    inputs.set(frameAmbient(ctx), IN_AMBIENT);
    const sky = ctx.scene.sky;
    const directed = sky.hasDirectional;
    const d = sky.directional;
    if (d !== this.skyOf || d.version !== this.skyVersion || directed !== this.skyLit) {
      this.skyOf = d;
      this.skyVersion = d.version;
      this.skyLit = directed;
      if (directed) {
        inputs[IN_SKY] = d.skyR;
        inputs[IN_SKY + 1] = d.skyG;
        inputs[IN_SKY + 2] = d.skyB;
      } else {
        inputs.fill(1, IN_SKY, IN_DIRECTED);
      }
      inputs[IN_DIRECTED] = directed ? 1 : 0;
    }
    if (bitsChanged(this.colorBits, this.colorUploaded, COLOR_INPUTS) || this.colorAt !== cp.buildCount) {
      // Fog colour lit by the ambient, lifted a little at night (the same product as ever, from the scene's doubles);
      // a room's fog by the sky's share the roof lets in.
      const ambient = env.ambientIntensity;
      const lit = ambient * (1 + FOG_LOOK.nightLift * Math.max(0, 1 - ambient));
      const r = env.fogR * env.ambientR * lit;
      const gg = env.fogG * env.ambientG * lit;
      const b = env.fogB * env.ambientB * lit;
      const roofR = fogRoofedLight(directed ? d.skyR : 1);
      const roofG = fogRoofedLight(directed ? d.skyG : 1);
      const roofB = fogRoofedLight(directed ? d.skyB : 1);
      gl.uniform3f(cp.uniform('uFogColor'), r, gg, b);
      gl.uniform3f(cp.uniform('uFogColorRoofed'), r * roofR, gg * roofG, b * roofB);
      // The daylight the scattered light adds over (M5-41): the ambient in the open air, the sky's share through a roof,
      // against the scene's daylight level (the composition's `uDayLevel`).
      gl.uniform3fv(cp.uniform('uFogDay'), inputs, IN_AMBIENT, 3);
      gl.uniform3f(cp.uniform('uFogDayRoofed'), (inputs[IN_AMBIENT] ?? 0) * roofR, (inputs[IN_AMBIENT + 1] ?? 0) * roofG, (inputs[IN_AMBIENT + 2] ?? 0) * roofB);
      gl.uniform1fv(cp.uniform('uDayLevel'), frameDayLevel(ctx));
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
