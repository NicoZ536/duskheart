/**
 * Heat shimmer (M5-21, §6.2 "Feuer … Hitzeflimmern"): the columns of hot air of `scene.particles.distortion` displace
 * the lit scene behind them by whole pixels (`particle_shimmer.*`). The pixels under the columns are copied into a
 * scratch target first (one blit of their bounding box), then each column is one instance of a quad that reads the
 * copy and writes the scene. Stands in for the post chain's distortion buffer while that pass is off (`distortion.ts`);
 * with reduced motion (§29) the columns sway at `motionScale` of their strength, as they do in the distortion buffer.
 */
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import type { FrameSize, PassSetup, RenderContext } from '../passes/registry';
import { particleDefines } from './defines';
import type { DistortionList } from './sceneParticles';

/** Floats per column instance: rectangle (left, top, width, height in target px), strength [px], phase [rad]. */
const INSTANCE_FLOATS = 6;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
/** Initial columns of the instance buffer (grows by doubling). */
const INITIAL_COLUMNS = 32;
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const UNIT_SCENE = 0;
/** Phase step between columns [rad] (neighbouring columns do not waver in step). */
const PHASE_STEP = 2.39;

/**
 * Screen rectangles of the columns of `list` for a target whose pixel (0, 0) is world (originX, originY), their strength
 * scaled by `motion` (reduced motion); returns the columns on screen.
 */
export function shimmerColumns(list: DistortionList, originX: number, originY: number, width: number, height: number, out: Float32Array, motion = 1): number {
  let n = 0;
  for (let i = 0; i < list.count && (n + 1) * INSTANCE_FLOATS <= out.length; i++) {
    const w = list.width[i] as number;
    const h = list.height[i] as number;
    const left = Math.round((list.x[i] as number) - w / 2 - originX);
    const bottom = Math.round((list.y[i] as number) - (list.z[i] as number) - originY);
    const top = bottom - Math.round(h);
    if (left + w <= 0 || left >= width || bottom <= 0 || top >= height) continue;
    const o = n * INSTANCE_FLOATS;
    out[o] = left;
    out[o + 1] = top;
    out[o + 2] = Math.round(w);
    out[o + 3] = Math.round(h);
    out[o + 4] = (list.strength[i] as number) * motion;
    out[o + 5] = i * PHASE_STEP;
    n++;
  }
  return n;
}

export class HeatShimmer {
  private scratch: RenderTarget | null = null;
  private program: ShaderProgram | null = null;
  private instances: GpuBuffer | null = null;
  private quad: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private data = new Float32Array(INITIAL_COLUMNS * INSTANCE_FLOATS);
  private setup: PassSetup | null = null;
  /** Columns drawn in the last frame. */
  drawn = 0;
  /** Scale of the sway (1, or `REDUCED_MOTION_SCALE` with reduced motion; `ParticlePipeline.configure`). */
  motionScale = 1;

  init(setup: PassSetup): void {
    const gl = setup.gl;
    this.setup = setup;
    this.scratch = setup.resources.add(new RenderTarget(gl, { label: 'heat-shimmer', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA16F' }], floatTargets: setup.caps.floatTargets }));
    this.program = setup.shaders.program({ name: 'heat-shimmer', vertex: 'particle_shimmer.vert', fragment: 'particle_shimmer.frag', defines: particleDefines() });
    this.createGeometry(setup, this.data.length);
  }

  private createGeometry(setup: PassSetup, floats: number): void {
    const gl = setup.gl;
    if (this.vao !== null) setup.resources.remove(this.vao);
    if (this.instances !== null) setup.resources.remove(this.instances);
    this.quad ??= setup.resources.add(new GpuBuffer(gl, { label: 'heat-shimmer-quad', target: 'vertex', usage: 'static', data: QUAD }));
    const instances = setup.resources.add(new GpuBuffer(gl, { label: 'heat-shimmer-columns', target: 'vertex', usage: 'stream', byteLength: floats * FLOAT_BYTES }));
    this.instances = instances;
    const stride = INSTANCE_FLOATS * FLOAT_BYTES;
    this.vao = setup.resources.add(
      new VertexArray(gl, {
        label: 'heat-shimmer',
        attributes: [
          { location: 0, buffer: this.quad, components: 2, type: 'f32', stride: 0, offset: 0 },
          { location: 1, buffer: instances, components: 4, type: 'f32', stride, offset: 0, divisor: 1 },
          { location: 2, buffer: instances, components: 2, type: 'f32', stride, offset: 4 * FLOAT_BYTES, divisor: 1 },
        ],
      }),
    );
  }

  resize(size: FrameSize): void {
    this.scratch?.resize(size.width, size.height);
  }

  /** Displaces the scene under the columns of `list`. */
  draw(ctx: RenderContext, list: DistortionList): void {
    this.drawn = 0;
    const p = this.program;
    const scratch = this.scratch;
    const setup = this.setup;
    if (p === null || scratch === null || setup === null || list.count === 0) return;
    if (list.count * INSTANCE_FLOATS > this.data.length) {
      let cap = this.data.length;
      while (cap < list.count * INSTANCE_FLOATS) cap *= 2;
      this.data = new Float32Array(cap);
      this.createGeometry(setup, cap);
    }
    const f = ctx.frame;
    const n = shimmerColumns(list, f.camera.originX, f.camera.originY, f.width, f.height, this.data, this.motionScale);
    if (n === 0 || !p.use()) return;
    // Bounding box of the columns in GL framebuffer coordinates (origin bottom-left), clamped to the target.
    let x0 = f.width;
    let x1 = 0;
    let y0 = f.height;
    let y1 = 0;
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_FLOATS;
      const left = this.data[o] as number;
      const top = this.data[o + 1] as number;
      const reach = Math.ceil(this.data[o + 4] as number) + 1;
      x0 = Math.min(x0, left - reach);
      x1 = Math.max(x1, left + (this.data[o + 2] as number) + reach);
      y0 = Math.min(y0, f.height - (top + (this.data[o + 3] as number)));
      y1 = Math.max(y1, f.height - top);
    }
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(f.width, x1);
    y1 = Math.min(f.height, y1);
    if (x1 <= x0 || y1 <= y0) return;
    const gl = ctx.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ctx.targets.hdr.handle);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scratch.handle);
    gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    ctx.targets.hdr.bind();
    scratch.texture(0).bind(UNIT_SCENE);
    gl.uniform1i(p.uniform('uScene'), UNIT_SCENE);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1f(p.uniform('uTime'), f.time % SHIMMER_TIME_WRAP_S);
    (this.instances as GpuBuffer).upload(this.data, 0, n * INSTANCE_FLOATS);
    (this.vao as VertexArray).bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    ctx.stats.drawCalls++;
    this.drawn = n;
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    for (const r of [this.vao, this.instances, this.quad, this.scratch]) if (r !== null) setup.resources.remove(r);
    this.program = null;
    this.vao = null;
    this.instances = null;
    this.quad = null;
    this.scratch = null;
    this.setup = null;
  }
}

/** Presentation time is wrapped to this period for the wave (float precision) [s]. */
const SHIMMER_TIME_WRAP_S = 3600;
