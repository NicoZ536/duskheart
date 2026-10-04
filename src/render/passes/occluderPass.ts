/**
 * Occluder & SDF pass (MASTERPROMPT §6.1 pass 3, M5-01): the frame's occluders – walls, closed doors, trunks,
 * rocks, large objects, raised terrain and solid rock – as footprints on the ground in an RGBA8 mask, flooded by a
 * jump flood into a distance field (R16F, RG8 fallback) with the kind of the nearest occluder beside it; and a
 * separate distance field of the water to its shore (from the G-buffer's water bit) for shore foam.
 *
 * - **Footprints** come from the sprites of the frame (their `occluder` in the atlas manifest, `SpriteOccluders`)
 *   and from `scene.sky.occluders` (terrain and build grid, filled by the scene). Mask channels: decor top,
 *   structural, terrain top (layout: `shaders/sdf.glsl`).
 * - **Targets** cover the frame plus `SDF.marginPx` on every side, so occluders just outside the picture still cast
 *   shadows into it.
 * - **Jump flood** from `SDF.firstStepPx` down to 1 (two fields at once, 16-bit texel coordinates in RGBA8 – exact
 *   on every device); beyond its reach the distance is `SDF.maxDistancePx`. A frame that can show no water
 *   (`frameMayShowWater`) floods the occluders only: its water field is 0 over the whole frame (every texel land, its
 *   own seed), the margin keeps no seed – read by nobody, the water pass skips such a frame.
 * - **Ring** (M5 review M2, `OCCLUDER_RING`): while the scene has lights or a directed light, the frame's footprints also
 *   go into a coarse RGBA8 target of the mask's layout reaching `OCCLUDER_RING.reachPx` beyond the view (and the G-buffer's
 *   height range further south): a point light's ray that leaves the flood frame is traced on through its walls, cliffs
 *   and roofs, the ground points of the view's tallest pixels find their level there, and a light beside the view finds
 *   the body it burns in among its decor (M5-45; `sdf_ring.glsl`, `ringTexture`, `bindRing`).
 * - The light pass traces point-light shadows through the field and darkens the ambient at occluders' feet
 *   (`lighting.glsl`, `composite.frag`); the water pass reads the water field (`waterTexture`, `bindFrame`).
 *
 * Every GPU object is created through the setup (context loss restores it). Render debugger: `sdf`.
 */
import { GBUFFER_EMISSIVE, GBUFFER_HEIGHT_RANGE_PX } from '../gbuffer';
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { VertexArray } from '../gl/vertexArray';
import { INITIAL_OCCLUDERS, OCCLUDER_FLOATS, OCCLUDER_OFFSET, OCCLUDER_STRIDE, OccluderList, SpriteOccluders } from '../light/occluders';
import { lightStrandDefines, OCCLUDER_RING, SDF } from '../light/params';
import { frameMayShowWater } from '../water/presence';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Render-debugger view of this pass. */
export const SDF_DEBUG_VIEW = 'sdf';
/** Attachments of the field target. */
export const SDF_DISTANCE = 0;
export const SDF_INFO = 1;
export const SDF_WATER = 2;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const ZERO: readonly number[] = [0, 0, 0, 0];
const LOCATION = { corner: 0, box: 1, kind: 2 } as const;
const UNIT_A = 0;
const UNIT_B = 1;
const UNIT_C = 2;
/** Quad reach beyond a footprint's box and the tolerance of its edge [px] (`uSlack`): the mask's pixels, the ring's texels. */
const MASK_SLACK = new Float32Array([0.5, 0.49]);
const RING_SLACK = new Float32Array([OCCLUDER_RING.texelPx / 2, OCCLUDER_RING.texelPx / 2 - 0.01]);

/** Size of the occluder ring in texels for a frame of `width` × `height` px (`OCCLUDER_RING`). */
export function ringSize(width: number, height: number): { width: number; height: number } {
  const r = OCCLUDER_RING.reachPx;
  const t = OCCLUDER_RING.texelPx;
  return { width: Math.ceil((width + 2 * r) / t), height: Math.ceil((height + 2 * r + GBUFFER_HEIGHT_RANGE_PX) / t) };
}

/** Steps of the jump flood: `first`, first/2 … 1. */
export function jumpFloodSteps(first: number): number[] {
  const out: number[] = [];
  for (let s = Math.max(1, Math.floor(first)); s >= 1; s = Math.floor(s / 2)) out.push(s);
  return out;
}

export class OccluderPass implements RenderPass {
  readonly name = 'occluder';
  enabled = true;
  /** Footprints of the last frame: the scene's (terrain, build grid) and the sprites'. */
  readonly footprints = new OccluderList();
  private readonly sprites = new SpriteOccluders();
  private readonly steps = jumpFloodSteps(SDF.firstStepPx);
  private mask: RenderTarget | null = null;
  private seeds: readonly [RenderTarget, RenderTarget] | null = null;
  private fields: RenderTarget | null = null;
  private debug: RenderTarget | null = null;
  /** The coarse ring of walls and cliffs beyond the flood frame (M5 review M2). */
  private ring: RenderTarget | null = null;
  /** Frame whose ring the target holds (−1: none). */
  private ringAt = -1;
  /** World px of the ring's top-left corner and its size in texels (`uRingFrame`). */
  private readonly ringFrame = new Float32Array(4);
  /** The same placement with the size in world px (`uSdfFrame` of the mask program while it draws the ring). */
  private readonly ringDrawFrame = new Float32Array(4);
  private maskProgram: ShaderProgram | null = null;
  private seedProgram: ShaderProgram | null = null;
  private stepProgram: ShaderProgram | null = null;
  /** The step without the water field (`DH_JFA_LAND`), for frames that cannot show water. */
  private landStepProgram: ShaderProgram | null = null;
  /** The last frame flooded the water field too (false: it could show no water, `frameMayShowWater`). */
  private floodedWater = false;
  private resolveProgram: ShaderProgram | null = null;
  private debugProgram: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;
  private ranAt = -1;
  private debugWanted = false;
  /** Footprint records in the instance buffer this frame. */
  private uploaded = 0;
  /** World px of the targets' top-left corner and their size (`uSdfFrame`). */
  private readonly frame = new Float32Array(4);
  private frameW = 1;
  private frameH = 1;

  /** Whether the fields are this frame's (the pass ran in frame `frameIndex`). */
  ranInFrame(frameIndex: number): boolean {
    return this.enabled && this.ranAt === frameIndex;
  }

  /** Margin of the targets around the frame [px]. */
  get margin(): number {
    return SDF.marginPx;
  }

  /** The mask (occluders by class and top). */
  maskTexture(): Texture2D | null {
    return this.mask?.texture(0) ?? null;
  }

  /** Distance to the nearest occluder [px] (R16F, `decodeScalar` with range `SDF.maxDistancePx`). */
  distanceTexture(): Texture2D | null {
    return this.fields?.texture(SDF_DISTANCE) ?? null;
  }

  /** What the nearest occluder is (the mask at it). */
  infoTexture(): Texture2D | null {
    return this.fields?.texture(SDF_INFO) ?? null;
  }

  /** Whether the last run flooded the water field (a frame that could show no water leaves it at its seeds). */
  get waterFlooded(): boolean {
    return this.floodedWater;
  }

  /** The occluder ring (mask layout at `OCCLUDER_RING.texelPx` px per texel), null before `init`. */
  ringTexture(): Texture2D | null {
    return this.ring?.texture(0) ?? null;
  }

  /** Whether the ring holds frame `frameIndex`'s walls and cliffs (drawn only while the scene has lights or a directed light). */
  ringInFrame(frameIndex: number): boolean {
    return this.ranInFrame(frameIndex) && this.ringAt === frameIndex;
  }

  /**
   * Binds the ring for `sdf_ring.glsl` on `program` (bound): the texture to `unit`, `uRing`, `uRingFrame` and `uHasRing`;
   * without this frame's ring `fallback` goes to the unit and `uHasRing` is 0 (the shader then knows the flood frame only).
   */
  bindRing(gl: WebGL2RenderingContext, program: ShaderProgram, unit: number, frameIndex: number, fallback: Texture2D): void {
    const ring = this.ringInFrame(frameIndex) ? this.ringTexture() : null;
    (ring ?? fallback).bind(unit);
    gl.uniform1i(program.uniform('uRing'), unit);
    gl.uniform4fv(program.uniform('uRingFrame'), this.ringFrame);
    gl.uniform1i(program.uniform('uHasRing'), ring !== null ? 1 : 0);
  }

  /** Distance of water to its shore [px] (R16F like the occluder field; 0 on land). */
  waterTexture(): Texture2D | null {
    return this.fields?.texture(SDF_WATER) ?? null;
  }

  /** Sets `uSdfFrame` (sdf.glsl) of `program` – the placement of these targets in the world. */
  bindFrame(gl: WebGL2RenderingContext, program: ShaderProgram): void {
    // Uploaded as it is kept: no float of the record is read in JavaScript (§30).
    gl.uniform4fv(program.uniform('uSdfFrame'), this.frame);
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    const floatTargets = setup.caps.floatTargets;
    const r = setup.resources;
    const defines = lightStrandDefines();
    this.mask = r.add(new RenderTarget(gl, { label: 'occluder-mask', width: 1, height: 1, attachments: [{ name: 'mask', format: 'RGBA8' }], floatTargets }));
    const seedTarget = (label: string): RenderTarget =>
      r.add(
        new RenderTarget(gl, {
          label,
          width: 1,
          height: 1,
          attachments: [
            { name: 'occluder', format: 'RGBA8' },
            { name: 'water', format: 'RGBA8' },
          ],
          floatTargets,
        }),
      );
    this.seeds = [seedTarget('jfa-a'), seedTarget('jfa-b')];
    this.fields = r.add(
      new RenderTarget(gl, {
        label: 'sdf',
        width: 1,
        height: 1,
        attachments: [
          { name: 'distance', format: 'R16F' },
          { name: 'info', format: 'RGBA8' },
          { name: 'water', format: 'R16F' },
        ],
        floatTargets,
      }),
    );
    this.debug = r.add(new RenderTarget(gl, { label: 'sdf-debug', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets }));
    this.ring = r.add(new RenderTarget(gl, { label: 'occluder-ring', width: 1, height: 1, attachments: [{ name: 'ring', format: 'RGBA8' }], floatTargets }));
    this.ringAt = -1;
    this.maskProgram = setup.shaders.program({ name: 'occluder-mask', vertex: 'occluder_mask.vert', fragment: 'occluder_mask.frag', defines });
    this.seedProgram = setup.shaders.program({ name: 'jfa-seed', vertex: 'fullscreen.vert', fragment: 'jfa_seed.frag', defines });
    this.stepProgram = setup.shaders.program({ name: 'jfa-step', vertex: 'fullscreen.vert', fragment: 'jfa_step.frag', defines });
    this.landStepProgram = setup.shaders.program({ name: 'jfa-step-land', vertex: 'fullscreen.vert', fragment: 'jfa_step.frag', defines: { ...defines, DH_JFA_LAND: '1' } });
    this.resolveProgram = setup.shaders.program({ name: 'sdf-resolve', vertex: 'fullscreen.vert', fragment: 'sdf_resolve.frag', defines });
    this.debugProgram = setup.shaders.program({ name: 'sdf-debug', vertex: 'fullscreen.vert', fragment: 'sdf_debug.frag', defines });
    this.quad = r.add(new GpuBuffer(gl, { label: 'occluder-quad', target: 'vertex', usage: 'static', data: QUAD }));
    const instances = r.add(new GpuBuffer(gl, { label: 'occluder-instances', target: 'vertex', usage: 'stream', byteLength: INITIAL_OCCLUDERS * OCCLUDER_STRIDE }));
    this.instances = instances;
    const inst = { buffer: instances, stride: OCCLUDER_STRIDE, divisor: 1, type: 'f32' } as const;
    this.vao = r.add(
      new VertexArray(gl, {
        label: 'occluders',
        attributes: [
          { location: LOCATION.corner, buffer: this.quad, components: 2, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: LOCATION.box, components: 4, offset: OCCLUDER_OFFSET.box * FLOAT_BYTES },
          { ...inst, location: LOCATION.kind, components: 4, offset: OCCLUDER_OFFSET.top * FLOAT_BYTES },
        ],
      }),
    );
    const debug = this.debug;
    setup.debugViews.register({
      name: SDF_DEBUG_VIEW,
      mode: 'rgb',
      source: () => {
        this.debugWanted = true;
        return debug.texture(0);
      },
    });
  }

  resize(size: FrameSize): void {
    const m = 2 * SDF.marginPx;
    this.frameW = size.width;
    this.frameH = size.height;
    this.mask?.resize(size.width + m, size.height + m);
    this.seeds?.[0].resize(size.width + m, size.height + m);
    this.seeds?.[1].resize(size.width + m, size.height + m);
    this.fields?.resize(size.width + m, size.height + m);
    this.debug?.resize(size.width, size.height);
    const ring = ringSize(size.width, size.height);
    this.ring?.resize(ring.width, ring.height);
  }

  execute(ctx: RenderContext): void {
    const mask = this.mask;
    const seeds = this.seeds;
    const fields = this.fields;
    const vao = this.vao;
    const instances = this.instances;
    if (mask === null || seeds === null || fields === null || vao === null || instances === null) return;
    const gl = ctx.gl;
    const cam = ctx.frame.camera;
    const margin = SDF.marginPx;
    const w = mask.width;
    const h = mask.height;
    this.frame[0] = cam.originX - margin;
    this.frame[1] = cam.originY - margin;
    this.frame[2] = w;
    this.frame[3] = h;
    // Footprints: the scene's own and those of the frame's sprites.
    const list = this.footprints;
    list.clear();
    list.append(ctx.scene.sky.occluders);
    if (ctx.scene.atlas !== null) {
      this.sprites.bind(ctx.scene.atlas.manifest);
      this.sprites.collect(ctx.scene.sprites, list);
    }
    mask.bind();
    gl.clearBufferfv(gl.COLOR, 0, ZERO);
    const n = list.count;
    this.uploaded = 0;
    const maskProgram = this.maskProgram;
    if (n > 0 && maskProgram !== null && maskProgram.use()) {
      instances.ensureCapacity(n * OCCLUDER_STRIDE);
      instances.orphan();
      instances.upload(list.records, 0, n * OCCLUDER_FLOATS);
      this.uploaded = n;
      this.bindFrame(gl, maskProgram);
      gl.uniform2fv(maskProgram.uniform('uSlack'), MASK_SLACK);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      ctx.stats.drawCalls++;
    }
    // The ring, while the scene has lights to trace or the sun or moon casts shadows (the ground under the view's tallest
    // pixels): every footprint of the frame – the scene's walls, cliffs and roofs for the rays, the sprites' decor for the
    // housing of a light beside the view (M5-45).
    this.ringAt = -1;
    if (ctx.scene.lights.count > 0 || ctx.scene.sky.hasDirectional) this.drawRing(ctx, n);
    if (!this.flood(ctx, mask, seeds, fields, w, h)) return;
    this.ranAt = ctx.frame.index;
    if (this.debugWanted) this.drawDebug(ctx, mask, fields);
    this.debugWanted = false;
  }

  /**
   * The coarse ring (M5 review M2): the first `count` footprint records into the ring target around the frame, with half
   * a texel of slack – a wall keeps every texel it touches. Decor (the frame's sprites – pushed beyond the view as far as
   * their shadows and bodies reach into it –, the scene's fences) lands in the ring's red channel, read only for the
   * housing of a light beyond the flood frame (`occluderWithDecorAt`, M5-45); rays and ground points there see walls,
   * cliffs and roofs only.
   */
  private drawRing(ctx: RenderContext, count: number): void {
    const ring = this.ring;
    const p = this.maskProgram;
    const vao = this.vao;
    if (ring === null || p === null || vao === null) return;
    const gl = ctx.gl;
    const cam = ctx.frame.camera;
    const f = this.ringFrame;
    // The ring's corner in locals (whole pixels): written to both frames without reading a float back (§30).
    const left = cam.originX - OCCLUDER_RING.reachPx;
    const top = cam.originY - OCCLUDER_RING.reachPx;
    f[0] = left;
    f[1] = top;
    f[2] = ring.width;
    f[3] = ring.height;
    ring.bind();
    gl.clearBufferfv(gl.COLOR, 0, ZERO);
    if (count > 0 && this.uploaded >= count && p.use()) {
      const d = this.ringDrawFrame;
      d[0] = left;
      d[1] = top;
      d[2] = ring.width * OCCLUDER_RING.texelPx;
      d[3] = ring.height * OCCLUDER_RING.texelPx;
      gl.uniform4fv(p.uniform('uSdfFrame'), d);
      gl.uniform2fv(p.uniform('uSlack'), RING_SLACK);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, count);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      ctx.stats.drawCalls++;
    }
    this.ringAt = ctx.frame.index;
  }

  /**
   * Draws the frame's footprint records as instances with the bound program (layout of `occluder_mask.vert`:
   * corner 0, box 1, kind 2) – the shadow pass extrudes the raised terrain from them. Returns the draw calls.
   */
  drawFootprints(gl: WebGL2RenderingContext): number {
    const n = this.footprints.count;
    const vao = this.vao;
    if (n === 0 || vao === null || this.uploaded !== n) return 0;
    vao.bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    gl.bindVertexArray(null);
    return 1;
  }

  /** Seeds, jump flood and resolve into the fields; false when a program is not ready. */
  private flood(ctx: RenderContext, mask: RenderTarget, seeds: readonly [RenderTarget, RenderTarget], fields: RenderTarget, w: number, h: number): boolean {
    const gl = ctx.gl;
    const seed = this.seedProgram;
    // Without a water pixel every texel of the frame is land and its own water seed: the water field is flooded only
    // where the frame can show water (its reader, the water pass, skips such a frame as well).
    const water = frameMayShowWater(ctx);
    this.floodedWater = water;
    const step = water ? this.stepProgram : this.landStepProgram;
    const resolve = this.resolveProgram;
    if (seed === null || step === null || resolve === null || !seed.use()) return false;
    const [a, b] = seeds;
    let current = a;
    current.bind();
    mask.texture(0).bind(UNIT_A);
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(UNIT_B);
    gl.uniform1i(seed.uniform('uMask'), UNIT_A);
    gl.uniform1i(seed.uniform('uSurface'), UNIT_B);
    gl.uniform2i(seed.uniform('uSize'), w, h);
    gl.uniform1i(seed.uniform('uMargin'), SDF.marginPx);
    gl.uniform2i(seed.uniform('uFrameSize'), this.frameW, this.frameH);
    ctx.drawFullscreen();
    if (!step.use()) return false;
    gl.uniform1i(step.uniform('uSeeds'), UNIT_A);
    gl.uniform1i(step.uniform('uWater'), UNIT_B);
    gl.uniform2i(step.uniform('uSize'), w, h);
    const stepLoc = step.uniform('uStep');
    for (let i = 0; i < this.steps.length; i++) {
      const from = current;
      current = current === a ? b : a;
      current.bind();
      from.texture(0).bind(UNIT_A);
      from.texture(1).bind(UNIT_B);
      gl.uniform1i(stepLoc, this.steps[i] ?? 1);
      ctx.drawFullscreen();
    }
    if (!resolve.use()) return false;
    fields.bind();
    current.texture(0).bind(UNIT_A);
    current.texture(1).bind(UNIT_B);
    mask.texture(0).bind(UNIT_C);
    gl.uniform1i(resolve.uniform('uSeeds'), UNIT_A);
    gl.uniform1i(resolve.uniform('uWater'), UNIT_B);
    gl.uniform1i(resolve.uniform('uMask'), UNIT_C);
    ctx.drawFullscreen();
    return true;
  }

  private drawDebug(ctx: RenderContext, mask: RenderTarget, fields: RenderTarget): void {
    const debug = this.debug;
    const p = this.debugProgram;
    if (debug === null || p === null || !p.use()) return;
    const gl = ctx.gl;
    debug.bind();
    fields.texture(SDF_DISTANCE).bind(UNIT_A);
    mask.texture(0).bind(UNIT_B);
    fields.texture(SDF_WATER).bind(UNIT_C);
    gl.uniform1i(p.uniform('uDistance'), UNIT_A);
    gl.uniform1i(p.uniform('uMask'), UNIT_B);
    gl.uniform1i(p.uniform('uWater'), UNIT_C);
    gl.uniform1i(p.uniform('uMargin'), SDF.marginPx);
    this.bindFrame(gl, p);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(SDF_DEBUG_VIEW);
    for (const r of [this.vao, this.instances, this.quad, this.mask, this.seeds?.[0] ?? null, this.seeds?.[1] ?? null, this.fields, this.debug, this.ring]) if (r !== null) setup.resources.remove(r);
    for (const p of [this.maskProgram, this.seedProgram, this.stepProgram, this.landStepProgram, this.resolveProgram, this.debugProgram]) if (p !== null) setup.shaders.release(p);
    this.vao = null;
    this.instances = null;
    this.quad = null;
    this.mask = null;
    this.seeds = null;
    this.fields = null;
    this.debug = null;
    this.ring = null;
    this.ringAt = -1;
    this.maskProgram = null;
    this.seedProgram = null;
    this.stepProgram = null;
    this.landStepProgram = null;
    this.resolveProgram = null;
    this.debugProgram = null;
  }
}
