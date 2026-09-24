/**
 * Composition (MASTERPROMPT §6.1 pass 6, M1-19): albedo × light + emission + glints into the HDR
 * target. Light = ambient (`scene.env`) + the light pass's point/spot light, optionally quantised
 * into 6–10 bands with a world-anchored 4×4 Bayer dither (setting `graphics.lightBanding`). Ambient
 * and point light are each reflected with their spectral colour (`light/spectral.ts`, M1-26): a
 * saturated light pulls the reflected colour towards its own hue – warm torch light on grass reads
 * golden, the cool night ambient blue – while white light stays the exact RGB product. Emission tops
 * the light up to the pixel's own glow. When the light pass did not run this frame (switched off in
 * the debugger) the scene shows unlit (the albedo itself).
 *
 * The composition replaces the renderer's unlit fallback: while it is enabled, `unlit` is off, and
 * switching the composition off (`__dh.call('renderPass', 'composite', false)`) brings it back.
 */
import { PALETTE_HEX } from '../../generated/palette';
import { GBUFFER_ALBEDO, GBUFFER_EMISSIVE } from '../gbuffer';
import type { ShaderProgram } from '../gl/shaders';
import { parseHexColor } from '../palette/lut';
import { bandingDefines } from '../light/banding';
import { DEFAULT_LIGHT_SETTINGS } from '../light/settings';
import { spectralDefines } from '../light/spectral';
import { LIGHT_DIFFUSE, LIGHT_SPECULAR, type LightingPass } from './lightingPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

const UNIT_ALBEDO = 0;
const UNIT_SURFACE = 1;
const UNIT_DIFFUSE = 2;
const UNIT_SPECULAR = 3;
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

  /**
   * @param lighting the light pass whose target is composed
   * @param replaces the unlit pass this one stands in for (switched off while this pass is on)
   */
  constructor(
    private readonly lighting: LightingPass,
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
    this.program = setup.shaders.program({ name: 'composite', vertex: 'fullscreen.vert', fragment: 'composite.frag', defines: { ...bandingDefines(), ...spectralDefines() } });
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
    const o = Math.max(0, Math.min(PALETTE_HEX.length - 1, env.background - 1)) * RGB;
    const c = this.colors;
    gl.uniform3f(p.uniform('uBackground'), c[o] ?? 0, c[o + 1] ?? 0, c[o + 2] ?? 0);
    gl.uniform3f(p.uniform('uAmbient'), env.ambientR * env.ambientIntensity, env.ambientG * env.ambientIntensity, env.ambientB * env.ambientIntensity);
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
