/**
 * Interaction texture of the world surface (MASTERPROMPT §6.2 "Interaktives Gras: Figuren biegen es weg
 * (Interaktionstextur)", "verblassende Fußspuren im Schnee"; M5-17, M5-19). Runs before the G-buffer
 * (`PASS_ORDER.surfaceInteraction`) and writes an RGBA8 texture that covers the frame plus a margin, one texel per
 * world pixel and anchored to the world:
 * - **R – pressure on the grass:** every figure (`scene.surface` benders) stamps a dome at its feet; last frame's
 *   pressure is carried over, shifted by the camera's whole-pixel move and faded with a half-life, so the grass
 *   springs back behind a figure. The sprite program bends grass down the slope of this field.
 * - **G – footprints:** the prints of the frame (`scene.surface` footprints, faded by their age), stamped anew
 *   each frame; the terrain program presses them into snow.
 *
 * Two render targets ping-pong (the previous frame is read while the next is written). Everything lives in the
 * resource registry: after a context loss the targets come back empty and the grass simply stands upright.
 * Nothing to stamp and nothing left to fade: the pass skips its work and the shaders see no texture.
 */
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from '../passes/registry';
import { BENDER_FIELDS, FOOTPRINT_FIELDS } from './state';
import { surfaceFrameOf } from './frame';
import { SURFACE_PARAMS } from './params';
import type { SurfacePipeline } from './install';

const P = SURFACE_PARAMS.grass;
/** Floats per stamp instance: centre x, y, radius, strength, kind, side. */
const STAMP_FLOATS = 6;
const STAMP_STRIDE = STAMP_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const LOCATION = { corner: 0, stamp: 1, kind: 2 } as const;
const KIND_PUSH = 0;
const KIND_PRINT = 1;
/** Radius of a footprint's quad [px] (the sole fits into 2 × 3 px around its centre). */
const PRINT_RADIUS = 2;
/** Half-lives after the last stamp until the pressure is certainly gone (2^−12 < one 8-bit step). */
const QUIET_HALF_LIVES = 12;
/** Longest frame step that still decays smoothly [s] (a longer pause simply lets the grass stand up). */
const MAX_STEP_SECONDS = 1;
const UNIT_PREVIOUS = 0;
/** Slots of the pass's float state. */
const STATE_X = 0;
const STATE_Y = 1;
const STATE_TIME = 2;
const STATE_QUIET = 3;
const STATE_STEP = 4;
/** Name of the render debugger's view of the interaction texture. */
export const INTERACTION_VIEW = 'interaktion';

export class SurfaceInteractionPass implements RenderPass {
  readonly name = 'oberflaeche-interaktion';
  enabled = true;
  /** The pipeline whose settings this frame publishes to the sprite, terrain and puddle programs. */
  pipeline: SurfacePipeline | null = null;
  private targets: RenderTarget[] = [];
  private current = 0;
  private decayProgram: ShaderProgram | null = null;
  private stampProgram: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private packed = new Float32Array((P.maxBenders + SURFACE_PARAMS.footprints.capacity) * STAMP_FLOATS);
  private width = 1;
  private height = 1;
  /**
   * Texture origin of the last frame [world px], its presentation time [s], for how long nothing was stamped [s] and
   * this frame's step [s] (`STATE_*`): doubles kept in a typed array, not in number fields – no boxed number per frame
   * (§30, M5-32).
   */
  private readonly state = new Float64Array([0, 0, Number.NaN, 0, 0]);
  /** Whether the previous target holds pressure that is still fading. */
  private content = false;

  init(setup: PassSetup): void {
    const gl = setup.gl;
    // Render debugger: the texture of the last frame (red: pressure on the grass, green: footprints).
    setup.debugViews.register({ name: INTERACTION_VIEW, mode: 'rgb', source: () => this.targets[this.current]?.texture(0) ?? null });
    const make = (label: string): RenderTarget => setup.resources.add(new RenderTarget(gl, { label, width: this.width, height: this.height, attachments: [{ name: 'wert', format: 'RGBA8' }], floatTargets: setup.caps.floatTargets }));
    this.targets = [make('oberflaeche-interaktion-a'), make('oberflaeche-interaktion-b')];
    this.decayProgram = setup.shaders.program({ name: 'oberflaeche-abklingen', vertex: 'fullscreen.vert', fragment: 'world/interaction_decay.frag' });
    this.stampProgram = setup.shaders.program({ name: 'oberflaeche-stempel', vertex: 'world/interaction_stamp.vert', fragment: 'world/interaction_stamp.frag' });
    const quad = setup.resources.add(new GpuBuffer(gl, { label: 'oberflaeche-quad', target: 'vertex', usage: 'static', data: QUAD }));
    this.quad = quad;
    this.instances = setup.resources.add(new GpuBuffer(gl, { label: 'oberflaeche-stempel', target: 'vertex', usage: 'stream', byteLength: this.packed.byteLength }));
    const inst = { buffer: this.instances, stride: STAMP_STRIDE, divisor: 1 } as const;
    this.vao = setup.resources.add(
      new VertexArray(gl, {
        label: 'oberflaeche-stempel',
        attributes: [
          { location: LOCATION.corner, buffer: quad, components: 2, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: LOCATION.stamp, components: 4, type: 'f32', offset: 0 },
          { ...inst, location: LOCATION.kind, components: 2, type: 'f32', offset: 4 * Float32Array.BYTES_PER_ELEMENT },
        ],
      }),
    );
  }

  resize(size: FrameSize): void {
    this.width = size.width + 2 * P.marginPx;
    this.height = size.height + 2 * P.marginPx;
    for (const t of this.targets) t.resize(this.width, this.height);
    this.content = false;
  }

  /** Packs the frame's pushes and prints; returns the instance count. */
  private pack(ctx: RenderContext): number {
    const s = ctx.scene.surface;
    const out = this.packed;
    let n = 0;
    for (let i = 0; i < s.benderCount; i++) {
      const b = i * BENDER_FIELDS;
      const o = n++ * STAMP_FLOATS;
      out[o] = s.benders[b] as number;
      out[o + 1] = s.benders[b + 1] as number;
      out[o + 2] = s.benders[b + 2] as number;
      out[o + 3] = s.benders[b + 3] as number;
      out[o + 4] = KIND_PUSH;
      out[o + 5] = 0;
    }
    for (let i = 0; i < s.footprintCount; i++) {
      const f = i * FOOTPRINT_FIELDS;
      const o = n++ * STAMP_FLOATS;
      out[o] = s.footprints[f] as number;
      out[o + 1] = s.footprints[f + 1] as number;
      out[o + 2] = PRINT_RADIUS;
      out[o + 3] = s.footprints[f + 2] as number;
      out[o + 4] = KIND_PRINT;
      out[o + 5] = s.footprints[f + 3] as number;
    }
    return n;
  }

  /**
   * Steps the pass's clock to `time` with `n` stamps this frame (the step lands in `STATE_STEP`); false while there is
   * nothing to stamp and nothing left to fade (the pass then skips its work). A method of its own and on the typed
   * array only: the quiet frames of every scene without figures cost no allocation (§30, M5-32).
   */
  private advance(time: number, n: number): boolean {
    const st = this.state;
    const last = st[STATE_TIME] as number;
    const dt = last === last ? Math.min(MAX_STEP_SECONDS, Math.max(0, time - last)) : 0;
    st[STATE_TIME] = time;
    st[STATE_STEP] = dt;
    st[STATE_QUIET] = n > 0 ? 0 : (st[STATE_QUIET] as number) + dt;
    if (n === 0 && (!this.content || (st[STATE_QUIET] as number) > P.springBackSeconds * QUIET_HALF_LIVES)) {
      this.content = false;
      return false;
    }
    return true;
  }

  execute(ctx: RenderContext): void {
    const frame = surfaceFrameOf(ctx.gl);
    frame.rectW = 0;
    if (this.pipeline !== null) frame.settings = this.pipeline.settings;
    const decay = this.decayProgram;
    const stamp = this.stampProgram;
    const vao = this.vao;
    const instances = this.instances;
    if (decay === null || stamp === null || vao === null || instances === null || this.targets.length < 2) return;
    const f = ctx.frame;
    const n = this.pack(ctx);
    if (!this.advance(f.time, n)) return;
    const st = this.state;
    const dt = st[STATE_STEP] as number;
    const gl = ctx.gl;
    const originX = f.camera.originX - P.marginPx;
    const originY = f.camera.originY - P.marginPx;
    const read = this.targets[this.current] as RenderTarget;
    const write = this.targets[1 - this.current] as RenderTarget;
    write.bind();
    if (!decay.use()) return;
    read.texture(0).bind(UNIT_PREVIOUS);
    gl.uniform1i(decay.uniform('uPrevious'), UNIT_PREVIOUS);
    // Without last frame's content the shift points outside the texture: the pressure starts at zero.
    const shiftX = this.content ? originX - (st[STATE_X] as number) : this.width;
    const shiftY = this.content ? originY - (st[STATE_Y] as number) : this.height;
    gl.uniform2i(decay.uniform('uShift'), shiftX, shiftY);
    gl.uniform1f(decay.uniform('uDecay'), dt > 0 ? Math.pow(0.5, dt / P.springBackSeconds) : 1);
    ctx.drawFullscreen();
    if (n > 0 && stamp.use()) {
      instances.ensureCapacity(n * STAMP_STRIDE);
      instances.orphan();
      instances.upload(this.packed, 0, n * STAMP_FLOATS);
      gl.uniform2f(stamp.uniform('uOrigin'), originX, originY);
      gl.uniform2f(stamp.uniform('uSize'), this.width, this.height);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
      ctx.stats.drawCalls++;
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    this.current = 1 - this.current;
    st[STATE_X] = originX;
    st[STATE_Y] = originY;
    this.content = true;
    frame.interaction = write.texture(0);
    frame.rectX = originX;
    frame.rectY = originY;
    frame.rectW = this.width;
    frame.rectH = this.height;
    frame.frame = f.index;
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(INTERACTION_VIEW);
    for (const t of this.targets) setup.resources.remove(t);
    if (this.decayProgram !== null) setup.shaders.release(this.decayProgram);
    if (this.stampProgram !== null) setup.shaders.release(this.stampProgram);
    if (this.vao !== null) setup.resources.remove(this.vao);
    if (this.instances !== null) setup.resources.remove(this.instances);
    if (this.quad !== null) setup.resources.remove(this.quad);
    this.targets = [];
    this.quad = null;
    this.decayProgram = null;
    this.stampProgram = null;
    this.vao = null;
    this.instances = null;
  }
}
