/**
 * Sun and moon shadows (MASTERPROMPT §6.1 pass 4, M5-02 … M5-03): the silhouette of every shadow caster, sheared
 * and stretched by the position of the sun (or the moon at night) – long in the morning and evening, short at
 * noon, wandering over the day –, into a target in the placement of the occluder pass's fields (frame + margin).
 *
 * - **Sprites** of the objects and canopy layers (the sprite batcher's instances) stand as billboards on their
 *   anchor line; each pixel is projected along the shadow vector by its height (`shadow_sprite.*`). Which sprites
 *   cast, and which texels are glass (the panes the build grid's windows sample), comes from a class map of the atlas
 *   (`light/lightClasses.ts`). Crowns let the sun through in swaying flecks (canopy dapple).
 * - **Raised terrain** (the occluder records with the prism flag) casts the area its block sweeps (`shadow_prism.*`).
 * - **The build grid** (`scene.sky.sunCasters`: walls, closed doors and gates, windows, roofs) casts blocks between two
 *   heights (`shadow_block.*`): the house's shadow does not depend on its sprites, which fade and are cut for the view
 *   inside; the roof keeps the sun out of the room, the windows let it in – coloured through stained glass.
 * - Stored per texel: the light let through (rgb, MIN blended) and the highest caster (alpha, MAX blended). A receiver
 *   looks where its own point would project and is shadowed by casters above it – no sprite shadows itself.
 * - Softness, cloud shadows and ambient occlusion are applied where the target is read (`shadow.glsl`).
 *
 * Runs only while a directed light shines (`scene.sky.directional.share > 0`). Render debugger: `sun`, the cloud shadows
 * alone `wolken`.
 */
import { LAYER } from '../batch/spriteLayout';
import { GBUFFER_NORMAL } from '../gbuffer';
import { GpuBuffer } from '../gl/buffer';
import { RenderTarget } from '../gl/framebuffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderProgram } from '../gl/shaders';
import { Texture2D } from '../gl/texture';
import { VertexArray } from '../gl/vertexArray';
import type { AtlasManifest } from '../assets/atlas';
import { lightClassPixels } from '../light/lightClasses';
import { lightStrandDefines, SUN_SHADOW } from '../light/params';
import { INITIAL_SUN_CASTERS, SUN_CASTER_FLOATS, SUN_CASTER_OFFSET, SUN_CASTER_STRIDE } from '../light/sunCasters';
import type { OccluderPass } from './occluderPass';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Render-debugger view of this pass. */
export const SUN_DEBUG_VIEW = 'sun';
/** Render-debugger view of the cloud shadows alone (M5-03: the E2E follows their drift). */
export const CLOUD_DEBUG_VIEW = 'wolken';

/** Clear value: full light, no caster. */
const CLEAR: readonly number[] = [1, 1, 1, 0];
const UNIT_ALBEDO = 0;
const UNIT_CLASS = 1;
const UNIT_LUT = 2;
const UNIT_NORMAL = 3;
const UNIT_SHADOW = 4;
const UNIT_DISTANCE = 5;
const UNIT_INFO = 6;
const UNIT_MASK = 7;
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
/** Attribute locations of shadow_block.vert. */
const BLOCK_LOCATION = { corner: 0, box: 1, span: 2, pane: 3, frame: 4 } as const;

/** Shadow length the renderer draws for the calendar's `length` (capped: the horizon's shadows would cross the view). */
export function drawnShadowLength(length: number): number {
  return Math.max(0, Math.min(SUN_SHADOW.maxLength, length));
}

export class ShadowPass implements RenderPass {
  readonly name = 'shadow';
  enabled = true;
  /**
   * The frame's shadow vector (x, y, drawn length) and cloud field (cover, offset x, y) as the shaders take them: read
   * from `scene.sky` once per frame (`skyRecords`) and uploaded as they are – no float is read back per upload (§30).
   */
  private readonly shadowVec = new Float32Array(3);
  private readonly cloudVec = new Float32Array(4);
  private recordsAt = -1;
  private target: RenderTarget | null = null;
  private debug: RenderTarget | null = null;
  private spriteProgram: ShaderProgram | null = null;
  private prismProgram: ShaderProgram | null = null;
  private blockProgram: ShaderProgram | null = null;
  private debugProgram: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private blocks: GpuBuffer | null = null;
  private blockVao: VertexArray | null = null;
  private classes: Texture2D | null = null;
  private classesOf: AtlasManifest | null = null;
  private resources: GpuResourceRegistry | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private ranAt = -1;
  /** Debug view asked for in the last frame: 0 none, 1 `sun`, 2 `wolken`. */
  private debugWanted = 0;

  /** @param occluder the occluder pass: placement of the target, and the footprints of raised terrain */
  constructor(private readonly occluder: OccluderPass) {}

  /** Whether the target holds this frame's shadows (a directed light shone and the pass ran in `frameIndex`). */
  ranInFrame(frameIndex: number): boolean {
    return this.enabled && this.ranAt === frameIndex;
  }

  /** The silhouette target (rgb light let through, alpha caster height / 128). */
  texture(): Texture2D | null {
    return this.target?.texture(0) ?? null;
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    this.gl = gl;
    this.resources = setup.resources;
    const defines = lightStrandDefines();
    this.target = setup.resources.add(new RenderTarget(gl, { label: 'sun-shadow', width: 1, height: 1, attachments: [{ name: 'shadow', format: 'RGBA8' }], floatTargets: setup.caps.floatTargets }));
    this.debug = setup.resources.add(new RenderTarget(gl, { label: 'sun-debug', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets: setup.caps.floatTargets }));
    this.spriteProgram = setup.shaders.program({ name: 'shadow-sprite', vertex: 'shadow_sprite.vert', fragment: 'shadow_sprite.frag', defines });
    this.prismProgram = setup.shaders.program({ name: 'shadow-prism', vertex: 'shadow_prism.vert', fragment: 'shadow_prism.frag', defines });
    this.blockProgram = setup.shaders.program({ name: 'shadow-block', vertex: 'shadow_block.vert', fragment: 'shadow_block.frag', defines });
    this.quad = setup.resources.add(new GpuBuffer(gl, { label: 'sun-block-quad', target: 'vertex', usage: 'static', data: QUAD }));
    const blocks = setup.resources.add(new GpuBuffer(gl, { label: 'sun-blocks', target: 'vertex', usage: 'stream', byteLength: INITIAL_SUN_CASTERS * SUN_CASTER_STRIDE }));
    this.blocks = blocks;
    const inst = { buffer: blocks, stride: SUN_CASTER_STRIDE, divisor: 1, type: 'f32' } as const;
    this.blockVao = setup.resources.add(
      new VertexArray(gl, {
        label: 'sun-blocks',
        attributes: [
          { location: BLOCK_LOCATION.corner, buffer: this.quad, components: 2, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: BLOCK_LOCATION.box, components: 4, offset: SUN_CASTER_OFFSET.box * FLOAT_BYTES },
          { ...inst, location: BLOCK_LOCATION.span, components: 4, offset: SUN_CASTER_OFFSET.span * FLOAT_BYTES },
          { ...inst, location: BLOCK_LOCATION.pane, components: 4, offset: SUN_CASTER_OFFSET.pane * FLOAT_BYTES },
          { ...inst, location: BLOCK_LOCATION.frame, components: 4, offset: SUN_CASTER_OFFSET.frame * FLOAT_BYTES },
        ],
      }),
    );
    this.debugProgram = setup.shaders.program({ name: 'shadow-debug', vertex: 'fullscreen.vert', fragment: 'shadow_debug.frag', defines });
    const debug = this.debug;
    setup.debugViews.register({
      name: SUN_DEBUG_VIEW,
      mode: 'rgb',
      source: () => {
        this.debugWanted = 1;
        return debug.texture(0);
      },
    });
    setup.debugViews.register({
      name: CLOUD_DEBUG_VIEW,
      mode: 'rgb',
      source: () => {
        this.debugWanted = 2;
        return debug.texture(0);
      },
    });
  }

  resize(size: FrameSize): void {
    const m = 2 * this.occluder.margin;
    this.target?.resize(size.width + m, size.height + m);
    this.debug?.resize(size.width, size.height);
  }

  /** The class map of `manifest`'s atlas (built on first use, replaced with the atlas). */
  private classMap(manifest: AtlasManifest): Texture2D | null {
    if (this.classesOf === manifest) return this.classes;
    const r = this.resources;
    const gl = this.gl;
    if (r === null || gl === null) return null;
    if (this.classes !== null) r.remove(this.classes);
    this.classes = r.add(new Texture2D(gl, { label: 'light-classes', width: manifest.width, height: manifest.height, format: 'R8', pixels: lightClassPixels(manifest) }));
    this.classesOf = manifest;
    return this.classes;
  }

  execute(ctx: RenderContext): void {
    const target = this.target;
    const sky = ctx.scene.sky;
    const wanted = this.debugWanted;
    this.debugWanted = 0;
    if (target === null || !sky.hasDirectional) {
      if (wanted > 0) this.drawDebug(ctx, false, wanted === 2);
      return;
    }
    const gl = ctx.gl;
    const shadow = this.skyRecords(ctx);
    target.bind();
    gl.clearBufferfv(gl.COLOR, 0, CLEAR);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.MIN, gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    const atlas = ctx.atlas;
    const sprites = this.spriteProgram;
    if (atlas !== null && ctx.sprites.size > 0 && sprites !== null && sprites.use()) {
      const classes = this.classMap(atlas.manifest);
      if (classes !== null) {
        atlas.albedo.bind(UNIT_ALBEDO);
        classes.bind(UNIT_CLASS);
        ctx.palette.texture.bind(UNIT_LUT);
        gl.uniform1i(sprites.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
        gl.uniform1i(sprites.uniform('uClass'), UNIT_CLASS);
        gl.uniform1i(sprites.uniform('uPaletteLut'), UNIT_LUT);
        gl.uniform3fv(sprites.uniform('uShadow'), shadow);
        gl.uniform4f(sprites.uniform('uWind'), sky.windX, sky.windY, ctx.frame.time, 0);
        this.occluder.bindFrame(gl, sprites);
        this.bindGround(ctx, sprites);
        ctx.stats.drawCalls += ctx.sprites.drawLayer(LAYER.objects);
        ctx.stats.drawCalls += ctx.sprites.drawLayer(LAYER.canopy);
      }
    }
    const prism = this.prismProgram;
    if (prism !== null && prism.use()) {
      gl.uniform3fv(prism.uniform('uShadow'), shadow);
      this.occluder.bindFrame(gl, prism);
      this.bindGround(ctx, prism);
      ctx.stats.drawCalls += this.occluder.drawFootprints(gl);
    }
    ctx.stats.drawCalls += this.drawBlocks(ctx, shadow);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    this.ranAt = ctx.frame.index;
    if (wanted > 0) this.drawDebug(ctx, true, wanted === 2);
  }

  /** Binds the occluder mask of this frame for `shadow_ground.glsl` (casters under the ground at their texel drop out). */
  private bindGround(ctx: RenderContext, program: ShaderProgram): void {
    const gl = ctx.gl;
    const occ = this.occluder;
    const mask = occ.ranInFrame(ctx.frame.index) ? occ.maskTexture() : null;
    (mask ?? ctx.targets.gbuffer.texture(GBUFFER_NORMAL)).bind(UNIT_MASK);
    gl.uniform1i(program.uniform('uMask'), UNIT_MASK);
    gl.uniform1i(program.uniform('uHasMask'), mask !== null ? 1 : 0);
  }

  /** The build grid's sun casters (walls, doors, windows, roofs) as blocks; returns the draw calls. */
  private drawBlocks(ctx: RenderContext, shadow: Float32Array): number {
    const casters = ctx.scene.sky.sunCasters;
    const n = casters.count;
    const p = this.blockProgram;
    const blocks = this.blocks;
    const vao = this.blockVao;
    const atlas = ctx.atlas;
    if (n === 0 || p === null || blocks === null || vao === null || atlas === null || !p.use()) return 0;
    const classes = this.classMap(atlas.manifest);
    if (classes === null) return 0;
    const gl = ctx.gl;
    blocks.ensureCapacity(n * SUN_CASTER_STRIDE);
    blocks.orphan();
    blocks.upload(casters.records, 0, n * SUN_CASTER_FLOATS);
    atlas.albedo.bind(UNIT_ALBEDO);
    classes.bind(UNIT_CLASS);
    ctx.palette.texture.bind(UNIT_LUT);
    gl.uniform1i(p.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(p.uniform('uClass'), UNIT_CLASS);
    gl.uniform1i(p.uniform('uPaletteLut'), UNIT_LUT);
    gl.uniform3fv(p.uniform('uShadow'), shadow);
    this.occluder.bindFrame(gl, p);
    this.bindGround(ctx, p);
    vao.bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    gl.bindVertexArray(null);
    return 1;
  }

  /** Binds what `shadow.glsl` reads of this frame (`uShadowVec`, `uClouds`) on `program`; returns whether sun shadows exist. */
  bindSky(ctx: RenderContext, program: ShaderProgram): boolean {
    const gl = ctx.gl;
    gl.uniform3fv(program.uniform('uShadowVec'), this.skyRecords(ctx));
    gl.uniform4fv(program.uniform('uClouds'), this.cloudVec);
    return this.ranInFrame(ctx.frame.index);
  }

  /** Reads the shadow vector and the cloud field of the frame from `scene.sky` (once per frame); returns the shadow vector. */
  private skyRecords(ctx: RenderContext): Float32Array {
    const v = this.shadowVec;
    if (this.recordsAt === ctx.frame.index) return v;
    this.recordsAt = ctx.frame.index;
    const sky = ctx.scene.sky;
    if (sky.hasDirectional) {
      const d = sky.directional;
      v[0] = d.shadowX;
      v[1] = d.shadowY;
      v[2] = drawnShadowLength(d.shadowLength);
    } else v.fill(0);
    const c = this.cloudVec;
    const clouds = sky.clouds;
    c[0] = clouds.cover;
    c[1] = clouds.offsetX;
    c[2] = clouds.offsetY;
    return v;
  }

  private drawDebug(ctx: RenderContext, hasSun: boolean, cloudsOnly: boolean): void {
    const debug = this.debug;
    const p = this.debugProgram;
    const occ = this.occluder;
    if (debug === null || p === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const normal = ctx.targets.gbuffer.texture(GBUFFER_NORMAL);
    const fields = occ.ranInFrame(f.index);
    debug.bind();
    normal.bind(UNIT_NORMAL);
    (this.texture() ?? normal).bind(UNIT_SHADOW);
    ((fields ? occ.distanceTexture() : null) ?? normal).bind(UNIT_DISTANCE);
    ((fields ? occ.infoTexture() : null) ?? normal).bind(UNIT_INFO);
    ((fields ? occ.maskTexture() : null) ?? normal).bind(UNIT_MASK);
    gl.uniform1i(p.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(p.uniform('uSunShadow'), UNIT_SHADOW);
    gl.uniform1i(p.uniform('uDistance'), UNIT_DISTANCE);
    gl.uniform1i(p.uniform('uInfo'), UNIT_INFO);
    gl.uniform1i(p.uniform('uMask'), UNIT_MASK);
    gl.uniform2f(p.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1i(p.uniform('uHasSun'), hasSun ? 1 : 0);
    gl.uniform1i(p.uniform('uHasFields'), fields ? 1 : 0);
    gl.uniform1i(p.uniform('uCloudsOnly'), cloudsOnly ? 1 : 0);
    occ.bindFrame(gl, p);
    this.bindSky(ctx, p);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(SUN_DEBUG_VIEW);
    setup.debugViews.unregister(CLOUD_DEBUG_VIEW);
    for (const r of [this.blockVao, this.blocks, this.quad, this.target, this.debug, this.classes]) if (r !== null) setup.resources.remove(r);
    for (const p of [this.spriteProgram, this.prismProgram, this.blockProgram, this.debugProgram]) if (p !== null) setup.shaders.release(p);
    this.blockVao = null;
    this.blocks = null;
    this.quad = null;
    this.blockProgram = null;
    this.target = null;
    this.debug = null;
    this.classes = null;
    this.classesOf = null;
    this.spriteProgram = null;
    this.prismProgram = null;
    this.debugProgram = null;
  }
}
