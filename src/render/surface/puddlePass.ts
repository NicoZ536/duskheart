/**
 * Puddles mirror the lights (MASTERPROMPT §6.2 "Pfützen in Senken, die Lichter spiegeln", M5-20). The terrain
 * program marks puddle pixels in the G-buffer (G2.A `puddle`, dark wet ground with high gloss – the composition
 * gives them the glints of the light pass like any glossy surface); this pass, right after the composition
 * (`PASS_ORDER.surfacePuddles`), adds what a level water surface shows on top:
 * - the sky: a share of the ambient light on every puddle pixel;
 * - the lights: each light of the frame mirrored at its footprint – a light at (x, y) and height h appears at
 *   (x, y + h) – as a vertical streak of dashes, flickering with the light, wobbling while it rains.
 * Additive into the HDR target through `encodeHdr` (the RGBA8 fallback stays linear). Only with the water quality
 * "voll" (§6.3: lower levels have no reflections); off, the puddles stay dark and glossy.
 */
import { GBUFFER_EMISSIVE, GBUFFER_MASK } from '../gbuffer';
import type { RenderTarget } from '../gl/framebuffer';
import type { Texture2D } from '../gl/texture';
import { GpuBuffer } from '../gl/buffer';
import type { ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import { lightFlicker } from '../light/falloff';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from '../passes/registry';
import { surfaceFrameOf } from './frame';
import { SURFACE_PARAMS } from './params';

const P = SURFACE_PARAMS.puddleMirror;
/** Floats per mirrored light: mirror point x, y, half width, half length, colour r, g, b. */
const MIRROR_FLOATS = 7;
const MIRROR_STRIDE = MIRROR_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const LOCATION = { corner: 0, mirror: 1, color: 2 } as const;
const UNIT_SURFACE = 0;
/** Initial capacity of mirrored lights (grows by doubling). */
const INITIAL_LIGHTS = 64;
/** Names of the render debugger's views of the snow and puddle masks. */
export const SNOW_VIEW = 'schnee';
export const PUDDLE_VIEW = 'pfuetze';
/** Rain that sets the image wobbling (`env.wetness` is the falling rain). */
const RIPPLE_FROM_RAIN = 0.05;

/** Half extents [px] of the mirror image of a light `height` px above the ground. */
export function mirrorExtent(height: number, out: { halfWidth: number; halfLength: number }): { halfWidth: number; halfLength: number } {
  out.halfWidth = P.halfWidthPx;
  out.halfLength = Math.max(P.minLengthPx, Math.max(0, height) * P.lengthPerHeight) / 2;
  return out;
}

export class SurfacePuddlePass implements RenderPass {
  readonly name = 'pfuetzen';
  enabled = true;
  /** Mirrored lights drawn in the last frame (tests, `worldInfo`). */
  mirrored = 0;
  private mirrorProgram: ShaderProgram | null = null;
  private skyProgram: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private packed = new Float32Array(INITIAL_LIGHTS * MIRROR_FLOATS);
  private readonly extent = { halfWidth: 0, halfLength: 0 };
  /** The G-buffer of the last frame (the debugger's mask views read it). */
  private gbuffer: RenderTarget | null = null;

  init(setup: PassSetup): void {
    const gl = setup.gl;
    // Render debugger: where snow lies and where puddles stand (G2.A mask bits of the world surface).
    const g2 = (): Texture2D | null => this.gbuffer?.texture(GBUFFER_EMISSIVE) ?? null;
    setup.debugViews.register({ name: SNOW_VIEW, mode: 'mask', scale: GBUFFER_MASK.snow, source: g2 });
    setup.debugViews.register({ name: PUDDLE_VIEW, mode: 'mask', scale: GBUFFER_MASK.puddle, source: g2 });
    this.mirrorProgram = setup.shaders.program({ name: 'pfuetzen-spiegel', vertex: 'world/puddle_mirror.vert', fragment: 'world/puddle_mirror.frag' });
    this.skyProgram = setup.shaders.program({ name: 'pfuetzen-himmel', vertex: 'fullscreen.vert', fragment: 'world/puddle_sky.frag' });
    this.quad = setup.resources.add(new GpuBuffer(gl, { label: 'pfuetzen-quad', target: 'vertex', usage: 'static', data: QUAD }));
    this.instances = setup.resources.add(new GpuBuffer(gl, { label: 'pfuetzen-lichter', target: 'vertex', usage: 'stream', byteLength: this.packed.byteLength }));
    const inst = { buffer: this.instances, stride: MIRROR_STRIDE, divisor: 1 } as const;
    this.vao = setup.resources.add(
      new VertexArray(gl, {
        label: 'pfuetzen-lichter',
        attributes: [
          { location: LOCATION.corner, buffer: this.quad, components: 2, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: LOCATION.mirror, components: 4, type: 'f32', offset: 0 },
          { ...inst, location: LOCATION.color, components: 3, type: 'f32', offset: 4 * Float32Array.BYTES_PER_ELEMENT },
        ],
      }),
    );
  }

  resize(_size: FrameSize): void {
    // Reads the G-buffer and adds to the HDR target, both sized by the renderer.
  }

  /** Mirror images of the frame's lights whose streak reaches into the view; returns their number. */
  private pack(ctx: RenderContext, flickerScale: number): number {
    const lights = ctx.scene.lights;
    const f = ctx.frame;
    const left = f.camera.originX;
    const top = f.camera.originY;
    const right = left + f.width;
    const bottom = top + f.height;
    if (this.packed.length < lights.count * MIRROR_FLOATS) this.packed = new Float32Array(Math.max(lights.count, this.packed.length / MIRROR_FLOATS * 2) * MIRROR_FLOATS);
    const out = this.packed;
    let n = 0;
    for (let i = 0; i < lights.count; i++) {
      const h = lights.height[i] as number;
      const e = mirrorExtent(h, this.extent);
      const mx = lights.x[i] as number;
      const my = (lights.y[i] as number) + h;
      if (mx + e.halfWidth < left || mx - e.halfWidth > right || my + e.halfLength < top || my - e.halfLength > bottom) continue;
      const k = (lights.intensity[i] as number) * lightFlicker((lights.flicker[i] as number) * flickerScale, lights.seed[i] as number, f.time) * P.strength;
      const o = n++ * MIRROR_FLOATS;
      out[o] = mx;
      out[o + 1] = my;
      out[o + 2] = e.halfWidth;
      out[o + 3] = e.halfLength;
      out[o + 4] = (lights.r[i] as number) * k;
      out[o + 5] = (lights.g[i] as number) * k;
      out[o + 6] = (lights.b[i] as number) * k;
    }
    return n;
  }

  execute(ctx: RenderContext): void {
    this.mirrored = 0;
    this.gbuffer = ctx.targets.gbuffer;
    const surface = ctx.scene.surface;
    const frame = surfaceFrameOf(ctx.gl);
    if (surface.puddles <= 0 || !frame.settings.puddleMirror) return;
    const sky = this.skyProgram;
    const mirror = this.mirrorProgram;
    const vao = this.vao;
    const instances = this.instances;
    if (sky === null || mirror === null || vao === null || instances === null) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const env = ctx.scene.env;
    ctx.targets.hdr.bind();
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(UNIT_SURFACE);
    if (sky.use()) {
      gl.uniform1i(sky.uniform('uSurface'), UNIT_SURFACE);
      const a = env.ambientIntensity * P.sky;
      gl.uniform3f(sky.uniform('uSky'), env.ambientR * a, env.ambientG * a, env.ambientB * a);
      ctx.drawFullscreen();
    }
    const n = this.pack(ctx, frame.settings.flickerScale);
    if (n > 0 && mirror.use()) {
      instances.ensureCapacity(n * MIRROR_STRIDE);
      instances.orphan();
      instances.upload(this.packed, 0, n * MIRROR_FLOATS);
      const ripple = env.wetness > RIPPLE_FROM_RAIN ? P.ripplePx : 0;
      gl.uniform1i(mirror.uniform('uSurface'), UNIT_SURFACE);
      gl.uniform2f(mirror.uniform('uOrigin'), f.camera.originX, f.camera.originY);
      gl.uniform2f(mirror.uniform('uTargetSize'), f.width, f.height);
      gl.uniform1f(mirror.uniform('uRipple'), ripple);
      gl.uniform1f(mirror.uniform('uTime'), f.time);
      gl.uniform1f(mirror.uniform('uRippleSpeed'), P.rippleSpeed);
      vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
      ctx.stats.drawCalls++;
      gl.bindVertexArray(null);
      this.mirrored = n;
    }
    gl.disable(gl.BLEND);
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(SNOW_VIEW);
    setup.debugViews.unregister(PUDDLE_VIEW);
    if (this.mirrorProgram !== null) setup.shaders.release(this.mirrorProgram);
    if (this.skyProgram !== null) setup.shaders.release(this.skyProgram);
    if (this.vao !== null) setup.resources.remove(this.vao);
    if (this.instances !== null) setup.resources.remove(this.instances);
    if (this.quad !== null) setup.resources.remove(this.quad);
    this.mirrorProgram = null;
    this.skyProgram = null;
    this.vao = null;
    this.instances = null;
    this.quad = null;
  }
}
