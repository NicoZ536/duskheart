/**
 * Light map views of the render debugger (MASTERPROMPT §12.1 "Ein Debug-Overlay vergleicht Gameplay-Licht
 * mit gerendertem Licht (müssen übereinstimmen)", docs/RENDER.md §3 `lightmap`; M3-21):
 * `__dh.call('renderDebug', 'lightmap')` compares the whole light – the light map's level (ambient of
 * §12.1 + light sources) with the frame's ambient plus the light the lighting pass drew;
 * `'lightmap-quellen'` compares the light sources alone (the ambient of the view is an art choice of the
 * scene and may differ from §12.1 at dusk and at night).
 *
 * Encoding (see `lightmapShader.ts`): R = gameplay light / `LIGHTMAP_RANGE`, G = rendered light / range,
 * B = 0 agree (≤ `LIGHTMAP_TOLERANCE`), 255 differ, 128 not comparable (sprites, tilted surfaces) – so
 * agreeing ground reads yellow to olive, a difference blue, and tests read both values from any pixel.
 *
 * The pass runs only while one of its views is shown (the debugger asks for the view's texture each
 * frame; the pass draws in the next one) and only after the lighting pass. The gameplay values come from
 * a feed (`setFeed`, the game view's light bridge): point samples of the light map every `LATTICE_STEP_PX`
 * over the visible window, uploaded as an R32F texture (between them the shader interpolates – a few
 * pixels apart, the interpolation stays far below the tolerance even in the hot core of a light).
 */
import { GBUFFER_NORMAL } from '../gbuffer';
import { RenderTarget } from '../gl/framebuffer';
import type { GpuResource } from '../gl/resources';
import type { ShaderProgram } from '../gl/shaders';
import { LIGHT_DIFFUSE, type LightingPass } from '../passes/lightingPass';
import { PASS_ORDER, type FrameSize, type PassSetup, type RenderContext, type RenderPass } from '../passes/registry';
import { LIGHTMAP_SHADER_FILE, LIGHTMAP_SHADER_SOURCE } from './lightmapShader';

/** Debug view of the whole light (ambient + sources). */
export const LIGHTMAP_VIEW = 'lightmap';
/** Debug view of the light sources alone. */
export const LIGHTMAP_SOURCES_VIEW = 'lightmap-quellen';
/** Order of the pass: right after the lighting pass, whose target it reads. */
export const LIGHTMAP_PASS_ORDER = PASS_ORDER.lighting + (PASS_ORDER.composite - PASS_ORDER.lighting) / 2;
/** Light levels the encoding spans (a fire's core reaches about 2). */
export const LIGHTMAP_RANGE = 2;
/** Largest difference that still counts as agreement [light level] (M3-21 acceptance: ≤ 0,05). */
export const LIGHTMAP_TOLERANCE = 0.05;
/** Least normal z of a flat pixel (8-bit normals: a flat normal decodes to ≈ 0,99998). */
const FLAT_NORMAL_Z = 0.999;
/** Values of the mark channel. */
export const LIGHTMAP_MARK = { agree: 0, differ: 255, skipped: 128 } as const;
/** Spacing of the gameplay samples [px]. */
export const LATTICE_STEP_PX = 4;
/** Extra lattice points around the view: the bilinear sample of an edge pixel reads its neighbours. */
const WINDOW_MARGIN = 2;

const UNIT_LIGHT = 0;
const UNIT_NORMAL = 1;
const UNIT_TILES = 2;

/** Where the gameplay light comes from (the game view's light bridge). */
export interface LightmapFeed {
  /**
   * Light levels at world px (x0 + i · step, y0 + j · step) into `out[j · w + i]`; `ambient` false = the
   * sources alone.
   */
  fill(x0: number, y0: number, step: number, w: number, h: number, ambient: boolean, out: Float32Array): void;
}

/** A float texture of one channel for the lattice levels (R32F, nearest; read with `texelFetch`). */
class TileLevelTexture implements GpuResource {
  readonly kind = 'texture';
  readonly label = 'lightmap-lattice';
  private handleValue: WebGLTexture | null = null;
  private w = 1;
  private h = 1;
  private data: Float32Array = new Float32Array(1);

  constructor(private readonly gl: WebGL2RenderingContext) {}

  create(): void {
    const gl = this.gl;
    const tex = gl.createTexture();
    this.handleValue = tex;
    if (tex === null) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.allocate();
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Replaces the levels (`w × h`, row-major; the first row is the lattice's northmost). */
  upload(w: number, h: number, data: Float32Array): void {
    this.w = w;
    this.h = h;
    this.data = data;
    if (this.handleValue === null) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.handleValue);
    this.allocate();
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.handleValue);
  }

  private allocate(): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, this.w, this.h, 0, gl.RED, gl.FLOAT, this.data.subarray(0, this.w * this.h));
  }

  release(): void {
    if (this.handleValue !== null) this.gl.deleteTexture(this.handleValue);
    this.handleValue = null;
  }

  forget(): void {
    this.handleValue = null;
  }

  bytes(): number {
    return this.w * this.h * Float32Array.BYTES_PER_ELEMENT;
  }
}

export class LightmapDebugPass implements RenderPass {
  readonly name = 'lightmap-debug';
  enabled = true;
  private target: RenderTarget | null = null;
  private program: ShaderProgram | null = null;
  private tiles: TileLevelTexture | null = null;
  private feed: LightmapFeed | null = null;
  private levels: Float32Array = new Float32Array(1);
  /** View asked for in the last frame (`null`: none shown). */
  private requested: 'full' | 'sources' | null = null;
  /** Whether the last frame drew the comparison. */
  private drewValue = false;

  constructor(private readonly lighting: () => LightingPass | null) {}

  /** Whether one of the views was shown in the last frame (the feed is read in this one). */
  get wanted(): boolean {
    return this.requested !== null;
  }

  /** Whether the last executed frame drew the comparison. */
  get drew(): boolean {
    return this.drewValue;
  }

  /** Where the gameplay light comes from (`null`: nothing to compare – the views stay black). */
  setFeed(feed: LightmapFeed | null): void {
    this.feed = feed;
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    if (!setup.shaders.sources.has(LIGHTMAP_SHADER_FILE)) setup.shaders.sources.set(LIGHTMAP_SHADER_FILE, LIGHTMAP_SHADER_SOURCE);
    const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    this.program = setup.shaders.program({
      name: 'lightmap-debug',
      vertex: 'fullscreen.vert',
      fragment: LIGHTMAP_SHADER_FILE,
      defines: { DH_LM_RANGE: f(LIGHTMAP_RANGE), DH_LM_TOLERANCE: f(LIGHTMAP_TOLERANCE), DH_LM_FLAT_NZ: f(FLAT_NORMAL_Z) },
    });
    this.target = setup.resources.add(new RenderTarget(gl, { label: 'lightmap-debug', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets: false }));
    this.tiles = setup.resources.add(new TileLevelTexture(gl));
    const target = this.target;
    setup.debugViews.register({
      name: LIGHTMAP_VIEW,
      mode: 'rgb',
      source: () => {
        this.requested = 'full';
        return target.texture(0);
      },
    });
    setup.debugViews.register({
      name: LIGHTMAP_SOURCES_VIEW,
      mode: 'rgb',
      source: () => {
        this.requested = 'sources';
        return target.texture(0);
      },
    });
  }

  resize(size: FrameSize): void {
    this.target?.resize(size.width, size.height);
  }

  execute(ctx: RenderContext): void {
    const view = this.requested;
    this.requested = null;
    this.drewValue = false;
    const target = this.target;
    const program = this.program;
    const tiles = this.tiles;
    const feed = this.feed;
    const lighting = this.lighting();
    if (view === null || target === null || program === null || tiles === null || feed === null || lighting === null) return;
    const light = lighting.texture(LIGHT_DIFFUSE);
    if (light === null || !program.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const step = LATTICE_STEP_PX;
    const x0 = (Math.floor(f.camera.originX / step) - WINDOW_MARGIN) * step;
    const y0 = (Math.floor(f.camera.originY / step) - WINDOW_MARGIN) * step;
    const w = Math.ceil(f.width / step) + 2 * WINDOW_MARGIN + 1;
    const h = Math.ceil(f.height / step) + 2 * WINDOW_MARGIN + 1;
    if (this.levels.length < w * h) this.levels = new Float32Array(w * h);
    feed.fill(x0, y0, step, w, h, view === 'full', this.levels);
    tiles.upload(w, h, this.levels);
    target.bind();
    light.bind(UNIT_LIGHT);
    ctx.targets.gbuffer.texture(GBUFFER_NORMAL).bind(UNIT_NORMAL);
    tiles.bind(UNIT_TILES);
    gl.uniform1i(program.uniform('uLight'), UNIT_LIGHT);
    gl.uniform1i(program.uniform('uNormal'), UNIT_NORMAL);
    gl.uniform1i(program.uniform('uLattice'), UNIT_TILES);
    gl.uniform2f(program.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(program.uniform('uTargetSize'), f.width, f.height);
    gl.uniform2f(program.uniform('uLattice0'), x0, y0);
    gl.uniform1f(program.uniform('uStep'), step);
    gl.uniform2i(program.uniform('uLatticeCount'), w, h);
    gl.uniform1f(program.uniform('uAmbient'), view === 'full' ? ctx.scene.env.ambientIntensity : 0);
    gl.uniform1f(program.uniform('uLightRan'), lighting.ranInFrame(f.index) ? 1 : 0);
    ctx.drawFullscreen();
    this.drewValue = true;
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(LIGHTMAP_VIEW);
    setup.debugViews.unregister(LIGHTMAP_SOURCES_VIEW);
    for (const r of [this.target, this.tiles]) if (r !== null) setup.resources.remove(r);
    if (this.program !== null) setup.shaders.release(this.program);
    this.target = null;
    this.tiles = null;
    this.program = null;
  }
}
