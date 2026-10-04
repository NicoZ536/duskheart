/**
 * Renderer (MASTERPROMPT §6.1): orchestrates one frame at internal resolution + 1 px border –
 * instance data → G-buffer → registered passes (light, composition, …; until they exist: unlit
 * composition) → HDR resolve → presentation (sharp upscaling with subpixel camera offset), or the
 * render debugger's buffer instead of the final image.
 *
 * Every GPU object lives in `resources`; after a context loss `contextRestored()` rebuilds them all
 * (textures from retained data, programs from the shader sources) and the next frame renders as
 * before – the simulation never waits for the renderer.
 */
import { AtlasTextures, type AtlasData } from './assets/atlas';
import { SpriteBatcher } from './batch/spriteBatcher';
import { CAMERA_WORDS, emptySnap, SCENE_BORDER, snapCamera, type Camera } from './camera';
import { bitsChanged } from './uniformBits';
import { DEBUG_VIEW_OFF, DebugViewRenderer, DebugViews } from './debugView';
import { enableExtensions, type TargetCaps } from './gl/context';
import { encodingDefines } from './gl/formats';
import { RenderTarget } from './gl/framebuffer';
import { GpuResourceRegistry } from './gl/resources';
import { ShaderLibrary, type ShaderErrorReporter, type ShaderSourceStore } from './gl/shaders';
import { VertexArray } from './gl/vertexArray';
import { GBUFFER_ALBEDO, GBUFFER_ATTACHMENTS, GBUFFER_EMISSIVE, GBUFFER_MASK, GBUFFER_NORMAL, gbufferDefines } from './gbuffer';
import { Upscaler } from './output/upscaler';
import { identityRow, PaletteLut, type PaletteRow } from './palette/lut';
import { GBufferPass } from './passes/gbufferPass';
import { HdrResolvePass } from './passes/hdrResolvePass';
import { OutlinePass } from './passes/outlinePass';
import { emptyRenderStats, PASS_ORDER, PassRegistry, type FrameInfo, type FrameTargets, type PassSetup, type RenderContext, type RenderStats } from './passes/registry';
import { UnlitPass } from './passes/unlitPass';
import { WorldUiPass } from './passes/worldUiPass';
import { DebugOverlayPass } from './passes/debugOverlayPass';
import { installLightPipeline, type LightPipeline } from './light/pipeline';
import { installAtmospherePost, type AtmospherePost } from './post/pipeline';
import { installSurface, type SurfacePipeline } from './surface/install';
import { installParticles, type ParticlePipeline } from './passes/particlePass';
import { installWater, type WaterPipeline } from './water/install';
import { PassProfiler, PRESENT_TIMING, SPRITES_TIMING } from './quality/profiler';
import { registerGiSlot } from './debug/giSlot';
import type { RenderScene } from './scene';
import { computeViewportInto, type ScaleMode, type ViewportLayout } from './viewport';

export interface RendererOptions {
  readonly caps: TargetCaps;
  readonly sources: ShaderSourceStore;
  readonly errors: ShaderErrorReporter;
  /** Master palette (64 colours, `src/generated/palette.ts`). */
  readonly paletteHex: readonly string[];
}

/** Vertices of the fullscreen triangle (`fullscreen.vert`). */
const FULLSCREEN_VERTICES = 3;

/** The per-frame context handed to the passes (one instance, updated each frame). */
class FrameContext implements RenderContext {
  scene!: RenderScene;
  atlas: AtlasTextures | null = null;

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly frame: FrameInfo,
    readonly targets: FrameTargets,
    readonly caps: TargetCaps,
    readonly palette: PaletteLut,
    readonly sprites: SpriteBatcher,
    readonly stats: RenderStats,
    readonly drawFullscreen: () => void,
  ) {}
}

interface MutableFrame {
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  camera: ReturnType<typeof emptySnap>;
  cameraVersion: number;
  time: number;
  index: number;
}

export class Renderer {
  readonly resources = new GpuResourceRegistry();
  readonly shaders: ShaderLibrary;
  readonly passes: PassRegistry;
  readonly debugViews = new DebugViews();
  readonly palette: PaletteLut;
  readonly targets: FrameTargets;
  readonly stats: RenderStats = emptyRenderStats();
  readonly caps: TargetCaps;
  /** Light pass, composition and post (M1-18/M1-19); `configure` applies the graphics settings. */
  readonly lighting: LightPipeline;
  /** Corruption, fog, distortion, bloom, grading, state effects, CRT (M5-10, M5-13 … M5-16, M5-22); `configure` applies the settings. */
  readonly atmosphere: AtmospherePost;
  /** World surface: grass interaction texture, puddle mirror (M5-17 … M5-20); `configure` applies the graphics settings. */
  readonly surface: SurfacePipeline;
  /** GPU particles, weather particles, lightning, heat shimmer (M5-11, M5-12, M5-21); `configure` applies the graphics settings. */
  readonly particles: ParticlePipeline;
  /** Water: refraction, depth, foam, caustics, reflections, immersion, waves, ice (M5-07 … M5-09); `configure` applies the graphics settings. */
  readonly water: WaterPipeline;
  /** World-near UI on top of the final image (M1-23); needs the glyph atlas (`worldUi.setGlyphs`). */
  readonly worldUi = new WorldUiPass();
  /** Debug overlays of the world view (M2-29); needs the glyph atlas (`debugOverlay.setGlyphs`). */
  readonly debugOverlay = new DebugOverlayPass();
  /** GPU and CPU time of every pass for the F3 overlay (quality strand, M5-30; measures only while asked). */
  readonly profiler = new PassProfiler();
  private readonly batcher: SpriteBatcher;
  private readonly upscaler: Upscaler;
  private readonly debugRenderer: DebugViewRenderer;
  private readonly fullscreenVao: VertexArray;
  private readonly atlases = new Map<AtlasData, AtlasTextures>();
  private paletteSource: AtlasData | null = null;
  private view = DEBUG_VIEW_OFF;
  private lost = false;
  private readonly frame: MutableFrame = { width: 0, height: 0, viewWidth: 0, viewHeight: 0, camera: emptySnap(), cameraVersion: 0, time: 0, index: 0 };
  private readonly ctx: FrameContext;
  private readonly layout: ViewportLayout = { internalWidth: 0, internalHeight: 0, integerScale: 1, outX: 0, outY: 0, outWidth: 0, outHeight: 0 };
  /** The canvas and scale mode `layout` was computed for (−1: none yet). */
  private layoutWidth = -1;
  private layoutHeight = -1;
  private layoutMode: ScaleMode | null = null;
  /** The camera, its words and the internal size `frame.camera` was snapped for. */
  private snapOf: Camera | null = null;
  private readonly snapSeen = new Int32Array(CAMERA_WORDS);
  private snapWidth = -1;
  private snapHeight = -1;
  private readonly drawFullscreen = (): void => {
    this.fullscreenVao.bind();
    this.gl.drawArrays(this.gl.TRIANGLES, 0, FULLSCREEN_VERTICES);
    this.stats.drawCalls++;
  };

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: RendererOptions,
  ) {
    this.caps = options.caps;
    const defines = { ...encodingDefines(options.caps.floatTargets), ...gbufferDefines() };
    this.shaders = new ShaderLibrary(gl, this.resources, options.sources, defines, options.errors);
    this.palette = new PaletteLut(this.resources, gl, options.paletteHex, [identityRow()]);
    const floatTargets = options.caps.floatTargets;
    this.targets = {
      gbuffer: this.resources.add(new RenderTarget(gl, { label: 'gbuffer', width: 1, height: 1, attachments: GBUFFER_ATTACHMENTS, floatTargets })),
      hdr: this.resources.add(new RenderTarget(gl, { label: 'hdr', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA16F' }], floatTargets })),
      ldr: this.resources.add(new RenderTarget(gl, { label: 'ldr', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets })),
    };
    this.fullscreenVao = this.resources.add(new VertexArray(gl, { label: 'fullscreen', attributes: [] }));
    this.batcher = new SpriteBatcher(gl, this.resources, this.shaders);
    this.upscaler = new Upscaler(gl, this.resources, this.shaders);
    this.debugRenderer = new DebugViewRenderer(gl, this.resources, this.shaders);
    const setup: PassSetup = { gl, resources: this.resources, shaders: this.shaders, caps: this.caps, debugViews: this.debugViews };
    this.passes = new PassRegistry(setup);
    this.passes.add(new GBufferPass(), PASS_ORDER.gbuffer);
    this.passes.add(new UnlitPass(), PASS_ORDER.composite);
    this.passes.add(new HdrResolvePass(), PASS_ORDER.resolve);
    this.passes.add(new OutlinePass(), PASS_ORDER.outline);
    this.lighting = installLightPipeline(this.passes);
    this.atmosphere = installAtmospherePost(this.passes, this.upscaler);
    this.surface = installSurface(this.passes);
    this.particles = installParticles(this.passes);
    this.water = installWater(this.passes);
    this.passes.add(this.debugOverlay, PASS_ORDER.debugOverlay);
    this.passes.add(this.worldUi, PASS_ORDER.worldUi);
    this.profiler.init(gl, this.resources);
    this.profiler.useSelfTimed(this.lighting);
    this.registerDebugViews();
    registerGiSlot(setup);
    this.ctx = new FrameContext(gl, this.frame, this.targets, this.caps, this.palette, this.batcher, this.stats, this.drawFullscreen);
  }

  private registerDebugViews(): void {
    const g = this.targets.gbuffer;
    const views = this.debugViews;
    views.register({ name: 'albedo', mode: 'rgb', source: () => g.texture(GBUFFER_ALBEDO) });
    views.register({ name: 'normal', mode: 'normal', source: () => g.texture(GBUFFER_NORMAL) });
    views.register({ name: 'height', mode: 'blue', source: () => g.texture(GBUFFER_NORMAL) });
    views.register({ name: 'material', mode: 'material', source: () => g.texture(GBUFFER_NORMAL) });
    views.register({ name: 'emissive', mode: 'emissive', source: () => g.texture(GBUFFER_EMISSIVE) });
    views.register({ name: 'gloss', mode: 'green', source: () => g.texture(GBUFFER_EMISSIVE) });
    views.register({ name: 'wet', mode: 'blue', source: () => g.texture(GBUFFER_EMISSIVE) });
    views.register({ name: 'water', mode: 'mask', scale: GBUFFER_MASK.water, source: () => g.texture(GBUFFER_EMISSIVE) });
    views.register({ name: 'outline', mode: 'mask', scale: GBUFFER_MASK.outline, source: () => g.texture(GBUFFER_EMISSIVE) });
    views.register({ name: 'hdr', mode: 'hdr', source: () => this.targets.hdr.texture(0) });
  }

  /** Internal resolution and on-screen placement of the last frame (§4.2). */
  get viewport(): Readonly<ViewportLayout> {
    return this.layout;
  }

  /** The render debugger's current buffer (`off` = final image). */
  get debugView(): string {
    return this.view;
  }

  /** Shows one buffer instead of the final image; throws for unknown names. */
  setDebugView(name: string): void {
    if (name !== DEBUG_VIEW_OFF && !this.debugViews.get(name)) throw new Error(`Render-Debugger: unbekannter Puffer „${name}“ (verfügbar: ${this.debugViews.names().join(', ')})`);
    this.view = name;
  }

  get isContextLost(): boolean {
    return this.lost;
  }

  /** GPU textures of an atlas (created on first use, restored with everything else). */
  atlasTextures(data: AtlasData): AtlasTextures {
    let t = this.atlases.get(data);
    if (!t) {
      t = new AtlasTextures(this.resources, this.gl, data, `atlas-${data.manifest.sourceHash}`);
      this.atlases.set(data, t);
    }
    return t;
  }

  private usePaletteRows(atlas: AtlasData | null): void {
    if (atlas === null || atlas === this.paletteSource) return;
    this.paletteSource = atlas;
    const rows: readonly PaletteRow[] = atlas.manifest.paletteRows.length > 0 ? atlas.manifest.paletteRows : [identityRow()];
    this.palette.setRows(rows);
  }

  private resizeTargets(viewWidth: number, viewHeight: number): void {
    const w = viewWidth + 2 * SCENE_BORDER;
    const h = viewHeight + 2 * SCENE_BORDER;
    if (w === this.frame.width && h === this.frame.height) return;
    this.frame.width = w;
    this.frame.height = h;
    this.frame.viewWidth = viewWidth;
    this.frame.viewHeight = viewHeight;
    this.targets.gbuffer.resize(w, h);
    this.targets.hdr.resize(w, h);
    this.targets.ldr.resize(w, h);
    this.passes.resize({ width: w, height: h, viewWidth, viewHeight });
  }

  /** Renders `scene` to the canvas (device pixels `canvasWidth`×`canvasHeight`). */
  render(scene: RenderScene, canvasWidth: number, canvasHeight: number, mode: ScaleMode): void {
    if (this.lost) return;
    const gl = this.gl;
    // The layout and the camera's snap again only when the canvas or the camera changed (§30: a still frame computes
    // neither – their records keep them).
    const layout = this.layout;
    if (canvasWidth !== this.layoutWidth || canvasHeight !== this.layoutHeight || mode !== this.layoutMode) {
      computeViewportInto(layout, canvasWidth, canvasHeight, mode);
      this.layoutWidth = canvasWidth;
      this.layoutHeight = canvasHeight;
      this.layoutMode = mode;
    }
    this.resizeTargets(layout.internalWidth, layout.internalHeight);
    const cam = scene.camera;
    const moved = bitsChanged(cam.words, this.snapSeen, CAMERA_WORDS);
    if (moved || cam !== this.snapOf || layout.internalWidth !== this.snapWidth || layout.internalHeight !== this.snapHeight) {
      snapCamera(this.frame.camera, cam.x, cam.y, cam.focusX, cam.focusY, layout.internalWidth, layout.internalHeight);
      this.frame.cameraVersion++;
      this.snapOf = cam;
      this.snapWidth = layout.internalWidth;
      this.snapHeight = layout.internalHeight;
    }
    this.frame.time = scene.time;
    this.frame.index = this.stats.frames;
    this.stats.drawCalls = 0;
    this.stats.spriteDrawCalls = 0;
    this.stats.sprites = scene.sprites.count;
    this.stats.lights = scene.lights.count;
    this.usePaletteRows(scene.atlas);
    const ctx = this.ctx;
    ctx.scene = scene;
    ctx.atlas = scene.atlas ? this.atlasTextures(scene.atlas) : null;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    const profiler = this.profiler;
    profiler.beginFrame();
    profiler.begin(gl, SPRITES_TIMING);
    this.batcher.prepare(scene.sprites);
    profiler.end(gl, SPRITES_TIMING);
    const passes = this.passes.ordered();
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      if (p?.enabled) {
        profiler.begin(gl, p.name);
        p.execute(ctx);
        profiler.end(gl, p.name);
      }
    }
    let output = this.targets.ldr.texture(0);
    if (this.view !== DEBUG_VIEW_OFF) {
      const v = this.debugViews.get(this.view);
      const shown = v ? this.debugRenderer.render(v, this.targets.gbuffer.texture(GBUFFER_ALBEDO), this.frame.width, this.frame.height, this.drawFullscreen) : null;
      if (shown) output = shown;
    }
    profiler.begin(gl, PRESENT_TIMING);
    this.upscaler.present(output, layout, this.frame.camera.fracX, this.frame.camera.fracY, canvasWidth, canvasHeight, this.drawFullscreen);
    profiler.end(gl, PRESENT_TIMING);
    gl.bindVertexArray(null);
    this.stats.frames++;
  }

  /** `webglcontextlost`: every GL handle is gone; frames are skipped until the restore. */
  contextLost(): void {
    this.lost = true;
    this.resources.loseAll();
    this.stats.contextLosses++;
  }

  /** `webglcontextrestored`: re-enables the extensions and rebuilds every GPU resource from retained data. */
  contextRestored(): void {
    enableExtensions(this.gl);
    this.resources.restoreAll();
    this.lost = false;
    this.stats.contextRestores++;
  }

  dispose(): void {
    this.shaders.dispose();
    this.resources.releaseAll();
    this.atlases.clear();
  }
}
