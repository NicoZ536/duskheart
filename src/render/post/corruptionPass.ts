/**
 * Corruption pass (MASTERPROMPT §6.2 "Verderbnis", M5-22; `PASS_ORDER.corruption`, after the composition
 * and before water, particles and fog): shifts the lit scene of the corrupted area into the palette row
 * `verderbnis` and lets veins glow in its ground (atmosphere_corruption.frag, `corruption.ts`). Reads a
 * copy of the HDR target and writes the target. Draws nothing while the frame's corruption
 * (`scene.corruption.strength`) is 0.
 *
 * The palette-shift lookup is built from the atlas's palette rows (rebuilt when the atlas changes;
 * without an atlas the generic violet shift). Veins crack only the terrain's open ground (G2.A `terrain`); the patches
 * are sampled at each pixel's ground point, found through the occluder pass's mask (its ground heights) when that ran,
 * and beyond the mask's frame through its occluder ring (M5-44).
 */
import { PALETTE_HEX } from '../../generated/palette';
import { GBUFFER_ALBEDO, GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import type { ShaderProgram } from '../gl/shaders';
import { lightStrandDefines } from '../light/params';
import type { OccluderPass } from '../passes/occluderPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from '../passes/registry';
import type { AtlasManifest } from '../assets/atlas';
import { buildCorruptionLut, CORRUPTION_EDGE, CORRUPTION_KEY_SHIFT, CORRUPTION_LUT_SIZE, CORRUPTION_NOISE_CONTRAST, CORRUPTION_PATCH_PX, CORRUPTION_ROW, VEIN_FIELD, VEINS } from './corruption';
import { Texture3D } from './lut3d';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from './settings';
import type { PostShared } from './shared';

/** Least strength that is drawn. */
export const MIN_CORRUPTION = 0.002;
/** Keeps the ratio finite for black channels (one 8-bit step). */
const RATIO_EPS = 1 / 255;
const UNIT_SCENE = 0;
const UNIT_ALBEDO = 1;
const UNIT_NORMAL = 2;
const UNIT_SURFACE = 3;
const UNIT_NOISE = 4;
const UNIT_SHIFT = 5;
const UNIT_MASK = 6;
const UNIT_RING = 7;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the corruption shader (with the light strand's: the occluder mask of sdf.glsl). */
export function corruptionDefines(): Readonly<Record<string, string>> {
  return {
    ...lightStrandDefines(),
    DH_CORRUPTION_EDGE: glslFloat(CORRUPTION_EDGE),
    DH_CORRUPTION_CONTRAST: glslFloat(CORRUPTION_NOISE_CONTRAST),
    DH_CORRUPTION_PATCH_PX: glslFloat(CORRUPTION_PATCH_PX),
    DH_CORRUPTION_KEY_SHIFT: String(CORRUPTION_KEY_SHIFT),
    DH_CORRUPTION_EPS: glslFloat(RATIO_EPS),
    DH_VEIN_TILE_PX: glslFloat(VEINS.tilePx),
    DH_VEIN_TILE2_PX: glslFloat(VEIN_FIELD.tilePx),
    DH_VEIN_COS: glslFloat(Math.cos((VEIN_FIELD.angleDeg * Math.PI) / 180)),
    DH_VEIN_SIN: glslFloat(Math.sin((VEIN_FIELD.angleDeg * Math.PI) / 180)),
    DH_VEIN_OFFSET_X: glslFloat(VEIN_FIELD.offsetPx[0]),
    DH_VEIN_OFFSET_Y: glslFloat(VEIN_FIELD.offsetPx[1]),
    DH_VEIN_WEIGHT: glslFloat(VEIN_FIELD.weight),
    DH_VEIN_CRACK_THIN: glslFloat(VEINS.crack[0]),
    DH_VEIN_CRACK_WIDE: glslFloat(VEINS.crack[1]),
    DH_VEIN_CORE_THIN: glslFloat(VEINS.core[0]),
    DH_VEIN_CORE_WIDE: glslFloat(VEINS.core[1]),
    DH_VEIN_HOT: glslFloat(VEINS.hot),
    DH_VEIN_DEPTH: glslFloat(VEINS.depth),
    DH_VEIN_SWELL_MIN: glslFloat(VEINS.swell[0]),
    DH_VEIN_SWELL_MAX: glslFloat(VEINS.swell[1]),
    DH_VEIN_SWELL_FROM: glslFloat(VEINS.swellFrom),
    DH_VEIN_SWELL_TO: glslFloat(VEINS.swellTo),
    DH_VEIN_MIN_GRADIENT: glslFloat(VEINS.minGradient),
    DH_VEIN_STEP: glslFloat(VEINS.stepPx),
    DH_VEIN_DARK: glslFloat(VEINS.dark),
    DH_VEIN_FLAT: glslFloat(VEINS.flat),
    DH_VEIN_GLOW: glslFloat(VEINS.glow),
    DH_VEIN_REST: glslFloat(VEINS.rest),
    DH_VEIN_PHASES: glslFloat(VEINS.phases),
  };
}

export class CorruptionPass implements RenderPass {
  readonly name = 'corruption';
  enabled = true;
  /** Pulse speed of the veins (still with reduced motion). */
  pulseSpeed = VEINS.speed * (DEFAULT_ATMOSPHERE_POST_SETTINGS.motionScale === 1 ? 1 : 0);
  private program: ShaderProgram | null = null;
  private lut: Texture3D | null = null;
  private lutFor: AtlasManifest | null | undefined = undefined;
  /** Whether the last frame drew corruption (statistics, tests). */
  drew = false;
  /** Whether the last drawn frame found its pixels' ground points through the occluder mask (tests). */
  groundFromMask = false;
  /** Whether it knew the ground beyond the mask's frame from the occluder ring (M5-44; tests). */
  groundFromRing = false;

  /**
   * @param shared the noise tile and HDR copy of the atmosphere and post passes
   * @param occluder the light strand's occluder pass, whose mask holds the ground heights (null: level 0 everywhere)
   */
  constructor(
    private readonly shared: PostShared,
    private readonly occluder: OccluderPass | null = null,
  ) {}

  configure(settings: AtmospherePostSettings): void {
    this.pulseSpeed = settings.motionScale === 1 ? VEINS.speed : 0;
  }

  init(setup: PassSetup): void {
    this.shared.acquire(setup);
    this.program = setup.shaders.program({ name: 'corruption', vertex: 'fullscreen.vert', fragment: 'atmosphere_corruption.frag', defines: corruptionDefines() });
    this.lut = setup.resources.add(new Texture3D(setup.gl, { label: 'corruption-shift', size: CORRUPTION_LUT_SIZE, filter: 'nearest', pixels: buildCorruptionLut(PALETTE_HEX, null) }));
    this.lutFor = null;
  }

  resize(size: FrameSize): void {
    this.shared.resize(size);
  }

  /** Rebuilds the palette-shift lookup when the scene's atlas (its palette rows) changed. */
  private followAtlas(manifest: AtlasManifest | null): void {
    const lut = this.lut;
    if (lut === null || manifest === this.lutFor) return;
    this.lutFor = manifest;
    const row = manifest?.paletteRows.find((r) => r.name === CORRUPTION_ROW)?.map ?? null;
    lut.setPixels(buildCorruptionLut(PALETTE_HEX, row));
  }

  execute(ctx: RenderContext): void {
    this.drew = false;
    this.groundFromMask = false;
    this.groundFromRing = false;
    const strength = ctx.scene.corruption.strength;
    const p = this.program;
    const lut = this.lut;
    const noise = this.shared.noise;
    if (!(strength >= MIN_CORRUPTION) || p === null || lut === null || noise === null) return;
    this.followAtlas(ctx.scene.atlas?.manifest ?? null);
    const copy = this.shared.copyHdr(ctx);
    if (copy === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const g = ctx.targets.gbuffer;
    copy.bind(UNIT_SCENE);
    g.texture(GBUFFER_ALBEDO).bind(UNIT_ALBEDO);
    g.texture(GBUFFER_NORMAL).bind(UNIT_NORMAL);
    g.texture(GBUFFER_EMISSIVE).bind(UNIT_SURFACE);
    noise.bind(UNIT_NOISE);
    lut.bind(UNIT_SHIFT);
    gl.uniform1i(p.uniform('uScene'), UNIT_SCENE);
    gl.uniform1i(p.uniform('uAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(p.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(p.uniform('uSurface'), UNIT_SURFACE);
    gl.uniform1i(p.uniform('uNoise'), UNIT_NOISE);
    gl.uniform1i(p.uniform('uShift'), UNIT_SHIFT);
    // The ground heights of the occluder mask and, beyond its frame, of the occluder ring (M5-44; without them the
    // samplers point at G1 and are never read).
    const occ = this.occluder;
    const normal = g.texture(GBUFFER_NORMAL);
    const fields = occ !== null && occ.ranInFrame(f.index) ? occ.maskTexture() : null;
    (fields ?? normal).bind(UNIT_MASK);
    gl.uniform1i(p.uniform('uMask'), UNIT_MASK);
    gl.uniform1i(p.uniform('uHasFields'), fields !== null ? 1 : 0);
    if (occ !== null && fields !== null) {
      occ.bindFrame(gl, p);
      occ.bindRing(gl, p, UNIT_RING, f.index, normal);
      this.groundFromRing = occ.ringInFrame(f.index);
    } else {
      normal.bind(UNIT_RING);
      gl.uniform1i(p.uniform('uRing'), UNIT_RING);
      gl.uniform1i(p.uniform('uHasRing'), 0);
    }
    this.groundFromMask = fields !== null;
    gl.uniform2f(p.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1f(p.uniform('uTime'), f.time);
    gl.uniform1f(p.uniform('uStrength'), Math.min(1, strength));
    gl.uniform1f(p.uniform('uPulse'), this.pulseSpeed);
    ctx.drawFullscreen();
    // Leave the 3D unit unbound for passes that only know 2D textures.
    gl.activeTexture(gl.TEXTURE0 + UNIT_SHIFT);
    gl.bindTexture(gl.TEXTURE_3D, null);
    this.drew = true;
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    if (this.lut !== null) setup.resources.remove(this.lut);
    this.program = null;
    this.lut = null;
    this.lutFor = undefined;
    this.shared.release(setup);
  }
}
