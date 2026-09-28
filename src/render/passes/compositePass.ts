/**
 * Composition (MASTERPROMPT §6.1 pass 6, M1-19, M5-04, M5-06): albedo × light + emission + glints into the HDR
 * target. Light = daylight + the light pass's point/spot light, the latter optionally quantised into 6–10 bands
 * with a world-anchored 4×4 Bayer dither (setting `graphics.lightBanding`). Daylight is the ambient
 * (`scene.env`) split by `scene.sky` into sky light – darkened at the feet of occluders (SDF ambient occlusion) –
 * and the directed light of sun or moon with normal mapping, silhouette shadows (shadow pass) and cloud shadows;
 * both add up to the ambient on a flat sunlit pixel. Daylight and point light are each reflected with their
 * spectral colour (`light/spectral.ts`, M1-26): a saturated light pulls the reflected colour towards its own hue –
 * warm torch light on grass reads golden, the cool night ambient blue – while white light stays the exact RGB
 * product. Emission tops the light up to the pixel's own glow. When the light pass did not run this frame
 * (switched off in the debugger) the scene shows unlit (the albedo itself).
 *
 * The composition replaces the renderer's unlit fallback: while it is enabled, `unlit` is off, and
 * switching the composition off (`__dh.call('renderPass', 'composite', false)`) brings it back.
 */
import { PALETTE_HEX } from '../../generated/palette';
import { GBUFFER_ALBEDO, GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import type { ShaderProgram } from '../gl/shaders';
import { parseHexColor } from '../palette/lut';
import { bandingDefines } from '../light/banding';
import { lightStrandDefines } from '../light/params';
import { daylightParts, type Rgb3 } from '../light/skyMath';
import { DEFAULT_LIGHT_SETTINGS } from '../light/settings';
import { spectralDefines } from '../light/spectral';
import { LIGHT_DIFFUSE, LIGHT_SPECULAR, type LightingPass } from './lightingPass';
import type { OccluderPass } from './occluderPass';
import type { ShadowPass } from './shadowPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

const UNIT_ALBEDO = 0;
const UNIT_SURFACE = 1;
const UNIT_DIFFUSE = 2;
const UNIT_SPECULAR = 3;
const UNIT_NORMAL = 4;
const UNIT_SUN = 5;
const UNIT_DISTANCE = 6;
const UNIT_INFO = 7;
const UNIT_MASK = 8;
const RGB = 3;
const BYTE_MAX = 255;

/** Master palette as 0…1 RGB triples (index 1 at offset 0). */
function paletteRgb(): Float32Array {
  const out = new Float32Array(PALETTE_HEX.length * RGB);
  PALETTE_HEX.forEach((hex, i) => parseHexColor(hex).forEach((v, c) => (out[i * RGB + c] = v / BYTE_MAX)));
  return out;
}

export class CompositePass implements RenderPass {
  readonly name = 'composite';
  /** Light bands on/off, levels per unit, Bayer dither between them (graphics settings). */
  banding = DEFAULT_LIGHT_SETTINGS.banding;
  bands = DEFAULT_LIGHT_SETTINGS.bands;
  dither = DEFAULT_LIGHT_SETTINGS.dither;
  private on = true;
  private program: ShaderProgram | null = null;
  private readonly colors = paletteRgb();
  /** Sky light and directed light of the frame (kept: no allocation per frame). */
  private readonly skyLight: Rgb3 = { r: 1, g: 1, b: 1 };
  private readonly dirLight: Rgb3 = { r: 0, g: 0, b: 0 };
  /**
   * Inputs of the daylight and background uniforms as last uploaded: a program keeps its uniforms, so they are
   * computed and uploaded again only when the ambient, the sky's split or the background change or the program was
   * built again (context restore, shader hot reload: `buildCount`) – no float arithmetic in a frame that changes
   * nothing (§30).
   */
  private readonly uploaded = { epoch: -1, background: -1, r: 0, g: 0, b: 0, intensity: 0, share: 0, skyR: 0, skyG: 0, skyB: 0, dirR: 0, dirG: 0, dirB: 0 };

  /**
   * @param lighting the light pass whose target is composed
   * @param occluder the occluder pass (distance field of the ambient occlusion)
   * @param shadow the shadow pass (silhouettes of sun and moon)
   * @param replaces the unlit pass this one stands in for (switched off while this pass is on)
   */
  constructor(
    private readonly lighting: LightingPass,
    private readonly occluder: OccluderPass,
    private readonly shadow: ShadowPass,
    private readonly replaces: RenderPass | undefined,
  ) {
    this.enabled = true;
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    if (this.replaces) this.replaces.enabled = !on;
  }

  init(setup: PassSetup): void {
    this.uploaded.epoch = -1;
    this.program = setup.shaders.program({ name: 'composite', vertex: 'fullscreen.vert', fragment: 'composite.frag', defines: { ...bandingDefines(), ...spectralDefines(), ...lightStrandDefines() } });
  }

  resize(_size: FrameSize): void {
    // Reads the G-buffer and light target, writes the HDR target – all sized by their owners.
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const env = ctx.scene.env;
    const lit = this.lighting.ranInFrame(f.index);
    const diffuse = this.lighting.texture(LIGHT_DIFFUSE);
    const specular = this.lighting.texture(LIGHT_SPECULAR);
    ctx.targets.hdr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_ALBEDO).bind(UNIT_ALBEDO);
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(UNIT_SURFACE);
    // Without a light target (not initialised) the samplers point at G-buffer attachments; `uLit` 0 ignores them.
    (diffuse ?? ctx.targets.gbuffer.texture(GBUFFER_ALBEDO)).bind(UNIT_DIFFUSE);
    (specular ?? ctx.targets.gbuffer.texture(GBUFFER_ALBEDO)).bind(UNIT_SPECULAR);
    gl.uniform1i(p.uniform('uAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(p.uniform('uSurface'), UNIT_SURFACE);
    gl.uniform1i(p.uniform('uDiffuse'), UNIT_DIFFUSE);
    gl.uniform1i(p.uniform('uSpecular'), UNIT_SPECULAR);
    const sky = ctx.scene.sky;
    const d = sky.directional;
    const dir = sky.hasDirectional;
    const u = this.uploaded;
    const epoch = p.buildCount;
    if (u.epoch !== epoch || u.background !== env.background) {
      const o = Math.max(0, Math.min(PALETTE_HEX.length - 1, env.background - 1)) * RGB;
      const c = this.colors;
      gl.uniform3f(p.uniform('uBackground'), c[o] ?? 0, c[o + 1] ?? 0, c[o + 2] ?? 0);
      u.background = env.background;
    }
    // Daylight: the ambient split into sky light and the directed light of sun or moon (scene.sky).
    const same =
      u.epoch === epoch &&
      u.r === env.ambientR &&
      u.g === env.ambientG &&
      u.b === env.ambientB &&
      u.intensity === env.ambientIntensity &&
      u.share === d.share &&
      u.skyR === d.skyR &&
      u.skyG === d.skyG &&
      u.skyB === d.skyB &&
      u.dirR === d.dirR &&
      u.dirG === d.dirG &&
      u.dirB === d.dirB;
    if (!same) {
      const skyLight = this.skyLight;
      const dirLight = this.dirLight;
      daylightParts(env.ambientR * env.ambientIntensity, env.ambientG * env.ambientIntensity, env.ambientB * env.ambientIntensity, sky, skyLight, dirLight);
      gl.uniform3f(p.uniform('uSkyLight'), skyLight.r, skyLight.g, skyLight.b);
      gl.uniform3f(p.uniform('uDirLight'), dirLight.r, dirLight.g, dirLight.b);
      u.epoch = epoch;
      u.r = env.ambientR;
      u.g = env.ambientG;
      u.b = env.ambientB;
      u.intensity = env.ambientIntensity;
      u.share = d.share;
      u.skyR = d.skyR;
      u.skyG = d.skyG;
      u.skyB = d.skyB;
      u.dirR = d.dirR;
      u.dirG = d.dirG;
      u.dirB = d.dirB;
    }
    gl.uniform3f(p.uniform('uDirDir'), d.lx, d.ly, d.lz);
    gl.uniform1f(p.uniform('uDirRelief'), d.relief);
    gl.uniform1i(p.uniform('uHasDir'), dir ? 1 : 0);
    const normal = ctx.targets.gbuffer.texture(GBUFFER_NORMAL);
    normal.bind(UNIT_NORMAL);
    const sun = this.shadow.bindSky(ctx, p);
    ((sun ? this.shadow.texture() : null) ?? normal).bind(UNIT_SUN);
    const occ = this.occluder;
    const fields = occ.ranInFrame(f.index);
    ((fields ? occ.distanceTexture() : null) ?? normal).bind(UNIT_DISTANCE);
    ((fields ? occ.infoTexture() : null) ?? normal).bind(UNIT_INFO);
    ((fields ? occ.maskTexture() : null) ?? normal).bind(UNIT_MASK);
    occ.bindFrame(gl, p);
    gl.uniform1i(p.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(p.uniform('uSunShadow'), UNIT_SUN);
    gl.uniform1i(p.uniform('uDistance'), UNIT_DISTANCE);
    gl.uniform1i(p.uniform('uInfo'), UNIT_INFO);
    gl.uniform1i(p.uniform('uMask'), UNIT_MASK);
    gl.uniform1i(p.uniform('uHasSun'), sun ? 1 : 0);
    gl.uniform1i(p.uniform('uHasFields'), fields ? 1 : 0);
    gl.uniform1i(p.uniform('uLit'), lit && diffuse !== null && specular !== null ? 1 : 0);
    gl.uniform1f(p.uniform('uBands'), this.banding ? this.bands : 0);
    gl.uniform1i(p.uniform('uDither'), this.dither ? 1 : 0);
    gl.uniform2f(p.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    this.program = null;
    if (this.replaces) this.replaces.enabled = true;
  }
}
