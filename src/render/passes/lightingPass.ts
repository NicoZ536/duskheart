/**
 * Light pass (MASTERPROMPT §6.1 pass 5, M1-18): the frame's point and spot lights (`scene.lights`,
 * the shared light source list of §12.1) as instanced screen quads with soft falloff, soft cone edge,
 * flicker and normal mapping (light height), added into a light target at internal resolution –
 * one value per internal pixel, so light stays pixel-sized.
 *
 * Target (RGBA16F each, RGBA8 `encodeHdr` fallback without float targets): attachment 0 = diffuse
 * light of the point/spot lights, attachment 1 = glints (specular) of glossy pixels. Ambient light
 * is added by the composition (it is one value per frame until SDF-AO arrives). The render debugger
 * shows both as `light` and `specular`.
 */
import { GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { VertexArray } from '../gl/vertexArray';
import { lightingDefines } from '../light/falloff';
import { INITIAL_LIGHT_CAPACITY, LightBatch, LIGHT_INSTANCE_FLOATS, LIGHT_INSTANCE_STRIDE, LIGHT_LOCATION, LIGHT_OFFSET, type LightBatchLimits, type LightView } from '../light/lightBatch';
import { DEFAULT_LIGHT_SETTINGS } from '../light/settings';
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
const ZERO: readonly number[] = [0, 0, 0, 0];

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
  private target: RenderTarget | null = null;
  private program: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private readonly batch = new LightBatch();
  private readonly view = new MutableView();
  private ranAt = -1;

  /** Whether the pass drew the light target in frame `frameIndex` (the composition falls back to full light otherwise). */
  ranInFrame(frameIndex: number): boolean {
    return this.enabled && this.ranAt === frameIndex;
  }

  /** Lights drawn in the last frame (after culling and the quality cap). */
  get drawnLights(): number {
    return this.batch.count;
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
    this.program = setup.shaders.program({ name: 'lighting-point', vertex: 'lighting_point.vert', fragment: 'lighting_point.frag', defines: lightingDefines() });
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
  }

  execute(ctx: RenderContext): void {
    const target = this.target;
    const program = this.program;
    const instances = this.instances;
    const vao = this.vao;
    if (target === null || program === null || instances === null || vao === null) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    target.bind();
    gl.clearBufferfv(gl.COLOR, LIGHT_DIFFUSE, ZERO);
    gl.clearBufferfv(gl.COLOR, LIGHT_SPECULAR, ZERO);
    this.ranAt = f.index;
    const view = this.view;
    view.left = f.camera.originX;
    view.top = f.camera.originY;
    view.width = f.width;
    view.height = f.height;
    const n = this.batch.pack(ctx.scene.lights, view, f.time, this);
    if (n === 0 || !program.use()) return;
    instances.ensureCapacity(n * LIGHT_INSTANCE_STRIDE);
    instances.orphan();
    instances.upload(this.batch.data, 0, n * LIGHT_INSTANCE_FLOATS);
    ctx.targets.gbuffer.texture(GBUFFER_NORMAL).bind(UNIT_NORMAL);
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(UNIT_SURFACE);
    gl.uniform1i(program.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(program.uniform('uSurface'), UNIT_SURFACE);
    gl.uniform2f(program.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(program.uniform('uTargetSize'), f.width, f.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    vao.bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    ctx.stats.drawCalls++;
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(LIGHT_DEBUG_VIEWS.light);
    setup.debugViews.unregister(LIGHT_DEBUG_VIEWS.specular);
    for (const r of [this.vao, this.instances, this.quad, this.target]) if (r !== null) setup.resources.remove(r);
    if (this.program !== null) setup.shaders.release(this.program);
    this.vao = null;
    this.instances = null;
    this.quad = null;
    this.target = null;
    this.program = null;
  }
}
