/**
 * Render runtime for the browser page (composition root side of `src/render`): owns the renderer,
 * the active scene source, the pixel probe and the shader error overlay, handles
 * `webglcontextlost`/`webglcontextrestored` (frames are skipped while lost – the simulation keeps
 * ticking – and every GPU resource is rebuilt on restore), and offers the renderer's debug
 * extensions for `window.__dh` (`renderDebug`, `renderInfo`, `glErrors`, `renderScene`, `renderPass`,
 * `shaderSource`, `shaderEdit`).
 */
import { PALETTE_HEX } from '../generated/palette';
import { resolveTargetCaps, watchContextLoss, type GlCaps, type RenderFlags, type TargetCaps } from './gl/context';
import { PixelProbe, type Rgba } from './gl/pixelProbe';
import { ShaderErrorOverlay, type Translate } from './errorOverlay';
import { DEBUG_VIEW_OFF } from './debugView';
import type { RenderStats } from './passes/registry';
import { Renderer } from './renderer';
import { RenderScene } from './scene';
import type { AtlasData } from './assets/atlas';
import { loadGeneratedAtlas } from './assets/generated';
import { createSceneSource, isRenderSceneId, RENDER_SCENE_IDS, type RenderSceneId, type SceneDeps } from './scenes';
import type { SceneSource } from './scenes/sceneSource';
import { shaderSources } from './shaderLib';
import { charRange, createCanvasRasterizer, GlyphAtlas, loadPixelFont, PIXEL_FONT, type FontLoader } from './text';
import type { ScaleMode, ViewportLayout } from './viewport';
import type { LightRenderSettings } from './light/settings';

export interface RenderRuntimeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly caps: GlCaps;
  readonly flags: RenderFlags;
  /** DOM parent of the shader error overlay (stays visible in screenshot mode: `document.body`). */
  readonly overlayHost: HTMLElement;
  readonly t: Translate;
}

/** What screenshot scenarios may change (src/debug/scenarios.ts). */
export interface ScenarioRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  /** Whether the shown scene has everything it draws (screenshots wait for it). */
  sceneReady(): boolean;
}

/** A `__dh.call` extension (arguments come from untyped E2E scripts and are validated). */
export type RenderDebugExtension = (...args: never[]) => unknown;

export interface RenderInfo {
  readonly floatTargets: boolean;
  readonly forcedRgba8: boolean;
  readonly hdrFormat: string;
  readonly scene: string;
  readonly debugView: string;
  readonly frames: number;
  readonly drawCalls: number;
  readonly spriteDrawCalls: number;
  readonly sprites: number;
  /** Lights in the scene and lights drawn after culling and the quality cap. */
  readonly lights: number;
  readonly lightsDrawn: number;
  readonly contextLost: boolean;
  readonly contextLosses: number;
  readonly contextRestores: number;
  readonly resources: number;
  readonly resourceRestores: number;
  readonly shaderErrors: readonly string[];
  /** Game atlas of `npm run assets`: missing, loading, ready or failed. */
  readonly gameAtlas: GameAtlasState;
  /** Pixel font of the world UI: loading, ready (glyph atlas baked) or failed. */
  readonly worldUiFont: FontState;
  /** Internal resolution and on-screen placement of the last frame (§4.2). */
  readonly viewport: Readonly<ViewportLayout>;
  /** Whether the shown scene has everything it draws (`sceneReady`). */
  readonly sceneReady: boolean;
}

/** Most errors `glErrors` drains at once (a context reports each error flag once; this ends the loop). */
const MAX_GL_ERRORS = 32;

export type GameAtlasState = 'fehlt' | 'laedt' | 'bereit' | 'fehler';
export type FontState = 'laedt' | 'bereit' | 'fehler';

/** First and last printable ASCII character. */
const ASCII_FIRST = 0x20;
const ASCII_LAST = 0x7e;
/**
 * Glyphs baked right after the font has loaded: ASCII, umlauts and the signs of numbers and markers.
 * Everything else is baked on first use (one glyph costs a fraction of a millisecond).
 */
export const WORLD_UI_PRELOAD = `${charRange(ASCII_FIRST, ASCII_LAST)}ÄÖÜäöüß–−×`;

/** Scene shown when no scenario picks one: the Grünhain clearing behind the title card. */
export const DEFAULT_RENDER_SCENE: RenderSceneId = 'gruenhain';

export class RenderRuntime implements ScenarioRender {
  readonly renderer: Renderer;
  readonly caps: TargetCaps;
  private readonly scene = new RenderScene();
  private source: SceneSource;
  private sceneId: RenderSceneId = DEFAULT_RENDER_SCENE;
  private readonly probe: PixelProbe;
  private readonly overlay: ShaderErrorOverlay;
  private readonly stopWatching: () => void;
  private gameAtlas: AtlasData | null = null;
  private gameAtlasState: GameAtlasState = 'laedt';
  private fontState: FontState = 'laedt';
  private readonly sceneDeps: SceneDeps;

  private readonly gl: WebGL2RenderingContext;

  constructor(options: RenderRuntimeOptions) {
    const { gl, canvas } = options;
    this.gl = gl;
    this.sceneDeps = { gameAtlas: () => this.gameAtlas, t: options.t };
    this.caps = resolveTargetCaps(options.caps, options.flags);
    this.overlay = new ShaderErrorOverlay(canvas.ownerDocument, options.overlayHost, options.t);
    this.renderer = new Renderer(gl, { caps: this.caps, sources: shaderSources, errors: this.overlay, paletteHex: PALETTE_HEX });
    this.probe = new PixelProbe(gl);
    this.source = createSceneSource(this.sceneId, this.sceneDeps);
    this.source.activate?.(this.renderer);
    loadGeneratedAtlas().then(
      (atlas) => {
        this.gameAtlas = atlas;
        this.gameAtlasState = atlas ? 'bereit' : 'fehlt';
      },
      (err: unknown) => {
        this.gameAtlasState = 'fehler';
        console.error(`Spielatlas: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    this.loadWorldUiFont(canvas.ownerDocument.fonts);
    this.stopWatching = watchContextLoss(
      canvas,
      () => {
        this.renderer.contextLost();
        this.probe.abort('Grafikkontext verloren');
      },
      () => this.renderer.contextRestored(),
    );
  }

  /** Loads the pixel font and hands the baked glyph atlas to the world UI pass. */
  private loadWorldUiFont(fonts: FontLoader): void {
    loadPixelFont(PIXEL_FONT, fonts).then(
      () => {
        this.renderer.worldUi.setGlyphs(new GlyphAtlas(PIXEL_FONT, createCanvasRasterizer(PIXEL_FONT), { preload: WORLD_UI_PRELOAD }));
        this.fontState = 'bereit';
      },
      (err: unknown) => {
        this.fontState = 'fehler';
        console.error(`Pixelschrift der Welt-UI: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }

  get stats(): RenderStats {
    return this.renderer.stats;
  }

  get contextLost(): boolean {
    return this.renderer.isContextLost;
  }

  /** Renders one frame; false while the context is lost (nothing drawn). */
  render(canvasWidth: number, canvasHeight: number, timeSeconds: number, mode: ScaleMode): boolean {
    if (this.renderer.isContextLost) return false;
    this.scene.beginFrame(timeSeconds);
    this.source.fill(this.scene, timeSeconds);
    this.renderer.render(this.scene, canvasWidth, canvasHeight, mode);
    this.probe.afterFrame(canvasWidth, canvasHeight);
    return true;
  }

  /** Pixel (x, y) of the next rendered frame (`__dh.readPixel`). */
  readPixel(x: number, y: number): Promise<Rgba> {
    return this.probe.request(x, y);
  }

  showScene(id: RenderSceneId): void {
    if (id === this.sceneId) return;
    this.source.deactivate?.(this.renderer);
    this.source = createSceneSource(id, this.sceneDeps);
    this.sceneId = id;
    this.source.activate?.(this.renderer);
  }

  setDebugView(name: string): void {
    this.renderer.setDebugView(name);
  }

  /** The shown scene has all its data and the last frame drew all of its world UI (font loaded). */
  sceneReady(): boolean {
    return (this.source.ready?.() ?? true) && this.renderer.worldUi.complete;
  }

  /** Light bands, dither, light cap and flicker reduction from the player settings (`lightSettingsFrom`). */
  configureLighting(settings: LightRenderSettings): void {
    this.renderer.lighting.configure(settings);
  }

  info(): RenderInfo {
    const s = this.renderer.stats;
    return {
      floatTargets: this.caps.floatTargets,
      forcedRgba8: this.caps.forcedRgba8,
      hdrFormat: this.renderer.targets.hdr.formats[0]?.actual ?? '',
      scene: this.sceneId,
      debugView: this.renderer.debugView,
      frames: s.frames,
      drawCalls: s.drawCalls,
      spriteDrawCalls: s.spriteDrawCalls,
      sprites: s.sprites,
      lights: s.lights,
      lightsDrawn: this.renderer.lighting.lighting.drawnLights,
      contextLost: this.renderer.isContextLost,
      contextLosses: s.contextLosses,
      contextRestores: s.contextRestores,
      resources: this.renderer.resources.count,
      resourceRestores: this.renderer.resources.restoreCount,
      shaderErrors: this.overlay.programs(),
      gameAtlas: this.gameAtlasState,
      worldUiFont: this.fontState,
      viewport: { ...this.renderer.viewport },
      sceneReady: this.sceneReady(),
    };
  }

  /**
   * Drains the WebGL error flags (`gl.getError()` until `NO_ERROR`) and returns their names – the
   * E2E proof of "keine GL-Fehler" (M1-19). A synchronous GPU query: debug and tests only.
   */
  glErrors(): string[] {
    const gl = this.gl;
    const names: Readonly<Record<number, string>> = {
      [gl.INVALID_ENUM]: 'INVALID_ENUM',
      [gl.INVALID_VALUE]: 'INVALID_VALUE',
      [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
      [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
      [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
      [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL',
    };
    const out: string[] = [];
    for (let e = gl.getError(); e !== gl.NO_ERROR && out.length < MAX_GL_ERRORS; e = gl.getError()) out.push(names[e] ?? `0x${e.toString(16)}`);
    return out;
  }

  /** Extensions for `window.__dh.call(name, …)`. */
  debugExtensions(): Readonly<Record<string, RenderDebugExtension>> {
    return {
      renderDebug: (buffer?: string) => {
        if (buffer !== undefined) {
          if (typeof buffer !== 'string') throw new TypeError('renderDebug erwartet einen Puffernamen');
          this.setDebugView(buffer);
        }
        return { current: this.renderer.debugView, available: this.renderer.debugViews.names() };
      },
      renderInfo: () => this.info(),
      glErrors: () => this.glErrors(),
      renderScene: (id?: string) => {
        if (id !== undefined) {
          if (typeof id !== 'string' || !isRenderSceneId(id)) throw new Error(`renderScene: unbekannte Szene „${String(id)}“ (verfügbar: ${RENDER_SCENE_IDS.join(', ')})`);
          this.showScene(id);
        }
        return { current: this.sceneId, available: [...RENDER_SCENE_IDS] };
      },
      renderPass: (name?: string, enabled?: boolean) => {
        if (name !== undefined) {
          if (typeof name !== 'string' || typeof enabled !== 'boolean') throw new TypeError('renderPass erwartet (Name, an/aus)');
          this.renderer.passes.setEnabled(name, enabled);
        }
        return this.renderer.passes.list();
      },
      shaderSource: (file: string) => {
        const src = shaderSources.get(file);
        if (src === undefined) throw new Error(`shaderSource: ${String(file)} gibt es nicht (verfügbar: ${shaderSources.files().join(', ')})`);
        return src;
      },
      shaderEdit: (file: string, source: string | null) => {
        if (typeof file !== 'string' || (source !== null && typeof source !== 'string')) throw new TypeError('shaderEdit erwartet (Datei, Quelltext | null)');
        shaderSources.override(file, source);
        return { shaderErrors: this.overlay.programs() };
      },
    };
  }

  /** Re-renders DOM texts after a language switch. */
  refreshTexts(): void {
    this.overlay.refresh();
  }

  dispose(): void {
    this.stopWatching();
    this.source.deactivate?.(this.renderer);
    this.renderer.setDebugView(DEBUG_VIEW_OFF);
    this.renderer.dispose();
    this.overlay.dispose();
  }
}

export function createRenderRuntime(options: RenderRuntimeOptions): RenderRuntime {
  return new RenderRuntime(options);
}
