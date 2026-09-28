/**
 * Light pass (MASTERPROMPT §6.1 pass 5, M1-18, M5-05): the frame's point and spot lights (`scene.lights`,
 * the shared light source list of §12.1) as instanced screen quads with soft falloff, soft cone edge,
 * flicker and normal mapping (light height), added into a light target at internal resolution –
 * one value per internal pixel, so light stays pixel-sized. A light stands on the terrain under it
 * (its height counts from the raised level there) and casts shadows through the occluder distance field
 * of the occluder pass: walls, closed doors and cliffs block at every quality level (the gameplay light map's rule),
 * trunks, rocks and furniture from §6.3 "Mittel" (`hard`) up, with a penumbra at `soft`.
 *
 * Target (RGBA16F each, RGBA8 `encodeLight` fallback without float targets): attachment 0 = diffuse
 * light of the point/spot lights, attachment 1 = glints (specular) of glossy pixels; their alpha channels keep
 * the light map comparison's bookkeeping (`lighting_point.frag`). Ambient, sun and moon light are added by the
 * composition. The render debugger shows both as `light` and `specular`.
 *
 * Halved light buffer (§6.3 "bei Frame-Einbrüchen dynamisch Lichtpuffer halbieren", M5-26): while the quality strand
 * sets `halfResolution`, the lights are drawn into a target of half the size per axis – one fragment lights the first
 * pixel of its 2 × 2 block, a quarter of the work – and one fullscreen draw (`quality/light_upsample.frag`) writes the
 * full target from it, each pixel taking the light of the neighbouring block whose lit pixel stands at the most similar
 * height (a trunk keeps its light, the ground beside it its own). Readers of the light target see no difference in
 * size or encoding. Frames the light map debugger compares always run at full resolution.
 */
import { GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { VertexArray } from '../gl/vertexArray';
import { lightingDefines } from '../light/falloff';
import { INITIAL_LIGHT_CAPACITY, LightBatch, LIGHT_INSTANCE_FLOATS, LIGHT_INSTANCE_STRIDE, LIGHT_LOCATION, LIGHT_OFFSET, type LightBatchLimits, type LightView } from '../light/lightBatch';
import { lightStrandDefines } from '../light/params';
import { DEFAULT_LIGHT_SETTINGS, type ShadowMode } from '../light/settings';
import { HALF_LIGHT_BUFFER_DIVISOR } from '../quality/params';
import type { OccluderPass } from './occluderPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Attachments of the light target. */
export const LIGHT_DIFFUSE = 0;
export const LIGHT_SPECULAR = 1;
/** Render-debugger views of this pass. */
export const LIGHT_DEBUG_VIEWS = { light: 'light', specular: 'specular' } as const;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
const GEOM_COMPONENTS = 4;
const COLOR_COMPONENTS = 3;
const CONE_COMPONENTS = 4;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const UNIT_NORMAL = 0;
const UNIT_SURFACE = 1;
const UNIT_DISTANCE = 2;
const UNIT_INFO = 3;
const UNIT_MASK = 4;
/** `uShadows` of lighting_point.frag per shadow mode (walls and cliffs block in every mode). */
export const SHADOW_CODE: Readonly<Record<ShadowMode, number>> = { sun: 0, hard: 1, soft: 2 };
const ZERO: readonly number[] = [0, 0, 0, 0];
const UNIT_HALF_DIFFUSE = 0;
const UNIT_HALF_SPECULAR = 1;
const UNIT_HALF_NORMAL = 2;
/** Fragment shader of the halved light buffer's upsampling (quality strand, M5-26). */
export const LIGHT_UPSAMPLE_SHADER = 'quality/light_upsample.frag';

class MutableView implements LightView {
  left = 0;
  top = 0;
  width = 0;
  height = 0;
}

export class LightingPass implements RenderPass, LightBatchLimits {
  readonly name = 'lighting';
  enabled = true;
  maxLights = DEFAULT_LIGHT_SETTINGS.maxLights;
  flickerScale = DEFAULT_LIGHT_SETTINGS.flickerScale;
  /** Point-light shadows of the quality level (§6.3). */
  shadows: ShadowMode = DEFAULT_LIGHT_SETTINGS.shadows;
  /** Draw the lights at half the resolution per axis (the quality strand's dynamic light buffer, §6.3, M5-26). */
  halfResolution = false;
  private target: RenderTarget | null = null;
  private half: RenderTarget | null = null;
  private upsample: ShaderProgram | null = null;
  private halfRan = false;
  private program: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private readonly batch = new LightBatch();
  private readonly view = new MutableView();
  private ranAt = -1;

  /** @param occluder the occluder pass whose distance field the shadows are traced through */
  constructor(private readonly occluder: OccluderPass) {}

  /**
   * Set by the light map debugger for the next frame (M5-28): keep the comparison's bookkeeping in the alpha channels
   * (the structural visibility past decor, the uncertainty mark); read and cleared by `execute`.
   */
  compareNext = false;

  /** The occluder pass the shadows are traced through (the light map debugger reads its ground heights). */
  get occluders(): OccluderPass {
    return this.occluder;
  }

  /** Whether the pass drew the light target in frame `frameIndex` (the composition falls back to full light otherwise). */
  ranInFrame(frameIndex: number): boolean {
    return this.enabled && this.ranAt === frameIndex;
  }

  /** Lights drawn in the last frame (after culling and the quality cap). */
  get drawnLights(): number {
    return this.batch.count;
  }

  /** Whether the last frame drew the lights into the halved buffer. */
  get halvedInLastFrame(): boolean {
    return this.halfRan;
  }

  /** Lights on screen in the last frame before the quality cap. */
  get visibleLights(): number {
    return this.batch.visibleCount;
  }

  /** Attachment `i` of the light target (`LIGHT_DIFFUSE`, `LIGHT_SPECULAR`), null before `init`. */
  texture(i: number): Texture2D | null {
    return this.target?.texture(i) ?? null;
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    this.target = setup.resources.add(
      new RenderTarget(gl, {
        label: 'light',
        width: 1,
        height: 1,
        attachments: [
          { name: 'diffuse', format: 'RGBA16F' },
          { name: 'specular', format: 'RGBA16F' },
        ],
        floatTargets: setup.caps.floatTargets,
      }),
    );
    this.half = setup.resources.add(
      new RenderTarget(gl, {
        label: 'light-half',
        width: 1,
        height: 1,
        attachments: [
          { name: 'diffuse', format: 'RGBA16F' },
          { name: 'specular', format: 'RGBA16F' },
        ],
        floatTargets: setup.caps.floatTargets,
      }),
    );
    this.program = setup.shaders.program({ name: 'lighting-point', vertex: 'lighting_point.vert', fragment: 'lighting_point.frag', defines: { ...lightingDefines(), ...lightStrandDefines() } });
    this.upsample = setup.shaders.program({ name: 'light-upsample', vertex: 'fullscreen.vert', fragment: LIGHT_UPSAMPLE_SHADER });
    this.quad = setup.resources.add(new GpuBuffer(gl, { label: 'light-quad', target: 'vertex', usage: 'static', data: QUAD }));
    const instances = setup.resources.add(new GpuBuffer(gl, { label: 'light-instances', target: 'vertex', usage: 'stream', byteLength: INITIAL_LIGHT_CAPACITY * LIGHT_INSTANCE_STRIDE }));
    this.instances = instances;
    const inst = { buffer: instances, stride: LIGHT_INSTANCE_STRIDE, divisor: 1, type: 'f32' } as const;
    this.vao = setup.resources.add(
      new VertexArray(gl, {
        label: 'lights',
        attributes: [
          { location: LIGHT_LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: LIGHT_LOCATION.geom, components: GEOM_COMPONENTS, offset: LIGHT_OFFSET.geom * FLOAT_BYTES },
          { ...inst, location: LIGHT_LOCATION.color, components: COLOR_COMPONENTS, offset: LIGHT_OFFSET.color * FLOAT_BYTES },
          { ...inst, location: LIGHT_LOCATION.cone, components: CONE_COMPONENTS, offset: LIGHT_OFFSET.cone * FLOAT_BYTES },
        ],
      }),
    );
    const target = this.target;
    setup.debugViews.register({ name: LIGHT_DEBUG_VIEWS.light, mode: 'hdr', source: () => target.texture(LIGHT_DIFFUSE) });
    setup.debugViews.register({ name: LIGHT_DEBUG_VIEWS.specular, mode: 'hdr', source: () => target.texture(LIGHT_SPECULAR) });
  }

  resize(size: FrameSize): void {
    this.target?.resize(size.width, size.height);
    this.half?.resize(Math.ceil(size.width / HALF_LIGHT_BUFFER_DIVISOR), Math.ceil(size.height / HALF_LIGHT_BUFFER_DIVISOR));
  }

  execute(ctx: RenderContext): void {
    const target = this.target;
    const program = this.program;
    const instances = this.instances;
    const vao = this.vao;
    const compare = this.compareNext;
    this.compareNext = false;
    if (target === null || program === null || instances === null || vao === null) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    // The light map debugger compares full-resolution light (M5-28): its frames never use the halved buffer.
    const half = this.halfResolution && !compare && this.upsample !== null ? this.half : null;
    const draw = half ?? target;
    this.halfRan = half !== null;
    draw.bind();
    gl.clearBufferfv(gl.COLOR, LIGHT_DIFFUSE, ZERO);
    gl.clearBufferfv(gl.COLOR, LIGHT_SPECULAR, ZERO);
    this.ranAt = f.index;
    const view = this.view;
    view.left = f.camera.originX;
    view.top = f.camera.originY;
    view.width = f.width;
    view.height = f.height;
    const n = this.batch.pack(ctx.scene.lights, view, f.time, this);
    if (n === 0 || !program.use()) {
      if (half !== null) this.clearFull(gl, target);
      return;
    }
    instances.ensureCapacity(n * LIGHT_INSTANCE_STRIDE);
    instances.orphan();
    instances.upload(this.batch.data, 0, n * LIGHT_INSTANCE_FLOATS);
    ctx.targets.gbuffer.texture(GBUFFER_NORMAL).bind(UNIT_NORMAL);
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(UNIT_SURFACE);
    gl.uniform1i(program.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(program.uniform('uSurface'), UNIT_SURFACE);
    // Occluder fields of this frame; without them (pass off) the samplers point at G-buffer textures that
    // `uHasMask` 0 never reads.
    const occ = this.occluder;
    const fields = occ.ranInFrame(f.index);
    const normal = ctx.targets.gbuffer.texture(GBUFFER_NORMAL);
    ((fields ? occ.distanceTexture() : null) ?? normal).bind(UNIT_DISTANCE);
    ((fields ? occ.infoTexture() : null) ?? normal).bind(UNIT_INFO);
    ((fields ? occ.maskTexture() : null) ?? normal).bind(UNIT_MASK);
    gl.uniform1i(program.uniform('uDistance'), UNIT_DISTANCE);
    gl.uniform1i(program.uniform('uInfo'), UNIT_INFO);
    gl.uniform1i(program.uniform('uMask'), UNIT_MASK);
    gl.uniform1i(program.uniform('uHasMask'), fields ? 1 : 0);
    gl.uniform1i(program.uniform('uShadows'), SHADOW_CODE[this.shadows]);
    gl.uniform1i(program.uniform('uCompare'), compare ? 1 : 0);
    gl.uniform1i(program.uniform('uDivisor'), half !== null ? HALF_LIGHT_BUFFER_DIVISOR : 1);
    occ.bindFrame(gl, program);
    gl.uniform2f(program.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(program.uniform('uTargetSize'), f.width, f.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    vao.bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    ctx.stats.drawCalls++;
    if (half !== null) this.upsampleInto(ctx, target, half);
  }

  /** Clears the full light target (the halved buffer drew nothing this frame). */
  private clearFull(gl: WebGL2RenderingContext, target: RenderTarget): void {
    target.bind();
    gl.clearBufferfv(gl.COLOR, LIGHT_DIFFUSE, ZERO);
    gl.clearBufferfv(gl.COLOR, LIGHT_SPECULAR, ZERO);
  }

  /** Writes the full light target from the halved buffer, edge-aware by the G-buffer heights (one fullscreen draw). */
  private upsampleInto(ctx: RenderContext, target: RenderTarget, half: RenderTarget): void {
    const gl = ctx.gl;
    const p = this.upsample;
    if (p === null || !p.use()) {
      this.clearFull(gl, target);
      return;
    }
    target.bind();
    half.texture(LIGHT_DIFFUSE).bind(UNIT_HALF_DIFFUSE);
    half.texture(LIGHT_SPECULAR).bind(UNIT_HALF_SPECULAR);
    ctx.targets.gbuffer.texture(GBUFFER_NORMAL).bind(UNIT_HALF_NORMAL);
    gl.uniform1i(p.uniform('uHalfDiffuse'), UNIT_HALF_DIFFUSE);
    gl.uniform1i(p.uniform('uHalfSpecular'), UNIT_HALF_SPECULAR);
    gl.uniform1i(p.uniform('uNormal'), UNIT_HALF_NORMAL);
    gl.uniform1i(p.uniform('uDivisor'), HALF_LIGHT_BUFFER_DIVISOR);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(LIGHT_DEBUG_VIEWS.light);
    setup.debugViews.unregister(LIGHT_DEBUG_VIEWS.specular);
    for (const r of [this.vao, this.instances, this.quad, this.target, this.half]) if (r !== null) setup.resources.remove(r);
    if (this.program !== null) setup.shaders.release(this.program);
    if (this.upsample !== null) setup.shaders.release(this.upsample);
    this.vao = null;
    this.instances = null;
    this.quad = null;
    this.target = null;
    this.half = null;
    this.program = null;
    this.upsample = null;
  }
}
