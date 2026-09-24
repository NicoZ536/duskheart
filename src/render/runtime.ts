/**
 * Render runtime for the browser page (composition root side of `src/render`): owns the renderer,
 * the active scene source, the pixel probe and the shader error overlay, handles
 * `webglcontextlost`/`webglcontextrestored` (frames are skipped while lost – the simulation keeps
 * ticking – and every GPU resource is rebuilt on restore), and offers the renderer's debug
 * extensions for `window.__dh` (`renderDebug`, `renderInfo`, `glErrors`, `renderScene`, `renderPass`,
 * `shaderSource`, `shaderEdit`, and for the world views `worldCamera`, `worldInfo`, `worldOverlay`).
 *
 * The default scene is the game view `spiel` (M2-29): the session's world, which the page generates
 * in the world worker and attaches with `attachGame`; behind the title it shows the start beach. The
 * world debug scenes (M2-28) share one generated world of their own per page; it is generated in the
 * world worker on first use. In debug mode the arrow keys pan the debug camera of a world debug scene,
 * and of the game view while no figure is controlled.
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
import { DebugPanKeys } from './world/debugCamera';
import { isLayer, TILE_PX, type Layer } from '../world/model/coords';
import { WORLD_SCENE_PRESET, WORLD_SCENE_SEED, WorldHost } from './world/worldHost';
import { WorldScene, type WorldSceneInfo } from './world/worldScene';
import { GameWorldScene, type GameCameraStart, type GameViewInfo, type GameWorldBinding } from './world/gameScene';
import { isWorldOverlay, WORLD_OVERLAYS, type WorldOverlay } from './debugOverlay';

export interface RenderRuntimeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly caps: GlCaps;
  readonly flags: RenderFlags;
  /** DOM parent of the shader error overlay (stays visible in screenshot mode: `document.body`). */
  readonly overlayHost: HTMLElement;
  readonly t: Translate;
  /** Debug mode (`?debug=1`, developer mode): the arrow keys pan the debug camera of the world views. */
  readonly debugCamera?: boolean;
}

/** What screenshot scenarios may change (src/debug/scenarios.ts). */
export interface ScenarioRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  /** Whether the shown scene has everything it draws (screenshots wait for it). */
  sceneReady(): boolean;
  /** Debug overlays of the game view. */
  setOverlay(name: WorldOverlay, on: boolean): void;
  /** Where the game view's free camera starts (title picture or a biome's showcase window). */
  startGameCamera(start: GameCameraStart): void;
  /** Layer and tile the game view's camera looks at (null while another scene is shown). */
  gameCamera(): { layer: Layer; tx: number; ty: number } | null;
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

/** Scene shown when no scenario picks one: the game view – behind the title card the start beach of the session's world. */
export const DEFAULT_RENDER_SCENE: RenderSceneId = 'spiel';

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
  private worldHost: WorldHost | null = null;
  private readonly panKeys = new DebugPanKeys();
  private readonly pan: [number, number] = [0, 0];
  private readonly keyTarget: Window | null;
  private readonly debugCamera: boolean;
  private game: GameWorldBinding | null = null;
  private gameStart: GameCameraStart = { kind: 'titel' };
  /** Overlays switched on (kept across scene switches: a new game view gets them). */
  private readonly overlays = new Set<WorldOverlay>();

  private readonly gl: WebGL2RenderingContext;

  constructor(options: RenderRuntimeOptions) {
    const { gl, canvas } = options;
    this.gl = gl;
    this.sceneDeps = { gameAtlas: () => this.gameAtlas, t: options.t, worldHost: () => this.world(), gameWorld: () => this.game };
    this.keyTarget = canvas.ownerDocument.defaultView;
    this.debugCamera = options.debugCamera ?? false;
    this.caps = resolveTargetCaps(options.caps, options.flags);
    this.overlay = new ShaderErrorOverlay(canvas.ownerDocument, options.overlayHost, options.t);
    this.renderer = new Renderer(gl, { caps: this.caps, sources: shaderSources, errors: this.overlay, paletteHex: PALETTE_HEX });
    this.probe = new PixelProbe(gl);
    this.source = createSceneSource(this.sceneId, this.sceneDeps);
    this.source.activate?.(this.renderer);
    this.followWorldScene();
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

  /** The generated world of the world scenes: created on first use, generated in the world worker. */
  private world(): WorldHost {
    this.worldHost ??= new WorldHost({
      seed: WORLD_SCENE_SEED,
      preset: WORLD_SCENE_PRESET,
      spawnWorker: () => new Worker(new URL('../world/gen/world.worker.ts', import.meta.url), { type: 'module' }),
      now: () => performance.now(),
    });
    return this.worldHost;
  }

  /** The shown world debug scene, if the current scene is one. */
  private worldScene(): WorldScene | null {
    return this.source instanceof WorldScene ? this.source : null;
  }

  /** The shown game view, if the current scene is it. */
  private gameScene(): GameWorldScene | null {
    return this.source instanceof GameWorldScene ? this.source : null;
  }

  /** The session and the host streaming its world: the game view shows them from now on. */
  attachGame(binding: GameWorldBinding): void {
    this.game = binding;
  }

  /** Arrow keys pan the debug camera while a world view is shown (debug mode). */
  private followWorldScene(): void {
    const game = this.gameScene();
    if (game !== null) {
      for (const o of WORLD_OVERLAYS) game.overlays.enabled[o] = this.overlays.has(o);
      game.startAt(this.gameStart);
    }
    if ((this.worldScene() !== null || game !== null) && this.debugCamera && this.keyTarget !== null) this.panKeys.attach(this.keyTarget);
    else this.panKeys.detach();
  }

  /** Loads the pixel font and hands the baked glyph atlas to the world UI pass. */
  private loadWorldUiFont(fonts: FontLoader): void {
    loadPixelFont(PIXEL_FONT, fonts).then(
      () => {
        const glyphs = new GlyphAtlas(PIXEL_FONT, createCanvasRasterizer(PIXEL_FONT), { preload: WORLD_UI_PRELOAD });
        this.renderer.worldUi.setGlyphs(glyphs);
        this.renderer.debugOverlay.setGlyphs(glyphs);
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
    const game = this.gameScene();
    if (game !== null) game.setViewSize(this.renderer.viewport.internalWidth, this.renderer.viewport.internalHeight);
    const world = this.worldScene() ?? game;
    if (world !== null) {
      const pan = this.panKeys.step(this.pan);
      if ((pan[0] !== 0 || pan[1] !== 0) && !(world instanceof GameWorldScene && world.followsFigure)) world.pan(pan[0], pan[1]);
    }
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
    this.followWorldScene();
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
      worldCamera: (x?: number, y?: number, layer?: number) => {
        const world = this.worldScene() ?? this.gameScene();
        if (world === null) throw new Error(`worldCamera: die Szene ${this.sceneId} zeigt keine Welt`);
        if (x !== undefined || y !== undefined) {
          if (typeof x !== 'number' || typeof y !== 'number') throw new TypeError('worldCamera erwartet (x, y) in Weltpixeln');
          if (world instanceof GameWorldScene) {
            if (layer !== undefined && !isLayer(layer)) throw new TypeError(`worldCamera: Ebene ${String(layer)} gibt es nicht (0, −1, −2, −3)`);
            world.moveTo(x, y, layer);
          } else world.moveTo(x, y);
        }
        return { x: world.camera[0], y: world.camera[1], layer: world.layer };
      },
      worldInfo: (): WorldSceneInfo | GameViewInfo | null => this.worldScene()?.info() ?? this.gameScene()?.info() ?? null,
      worldPoints: () => {
        const world = this.game?.host.world ?? null;
        if (world === null) return null;
        return {
          spawn: { tx: world.spawn.x, ty: world.spawn.y },
          caveEntrances: world.underground.links.filter((l) => l.kind === 'eingang').map((l) => ({ tx: l.tx, ty: l.ty })),
        };
      },
      worldOverlay: (name?: string, on?: boolean) => {
        if (name !== undefined) {
          if (typeof name !== 'string' || !isWorldOverlay(name)) throw new Error(`worldOverlay: unbekanntes Overlay „${String(name)}“ (verfügbar: ${WORLD_OVERLAYS.join(', ')})`);
          const next = on ?? !this.overlays.has(name);
          if (typeof next !== 'boolean') throw new TypeError('worldOverlay erwartet (Name, an/aus)');
          this.setOverlay(name, next);
        }
        return this.overlayState();
      },
      shaderEdit: (file: string, source: string | null) => {
        if (typeof file !== 'string' || (source !== null && typeof source !== 'string')) throw new TypeError('shaderEdit erwartet (Datei, Quelltext | null)');
        shaderSources.override(file, source);
        return { shaderErrors: this.overlay.programs() };
      },
    };
  }

  /** Switches a debug overlay of the game view on or off (console `overlay`, `__dh.call('worldOverlay', …)`). */
  setOverlay(name: WorldOverlay, on: boolean): void {
    if (on) this.overlays.add(name);
    else this.overlays.delete(name);
    const game = this.gameScene();
    if (game !== null) game.overlays.enabled[name] = on;
  }

  /** Where the game view's free camera starts (a game view shown later starts there too). */
  startGameCamera(start: GameCameraStart): void {
    this.gameStart = start;
    this.gameScene()?.startAt(start);
  }

  /** Layer and tile the game view's camera looks at (null while another scene is shown). */
  gameCamera(): { layer: Layer; tx: number; ty: number } | null {
    const game = this.gameScene();
    if (game === null) return null;
    const [x, y] = game.camera;
    return { layer: game.layer, tx: Math.floor(x / TILE_PX), ty: Math.floor(y / TILE_PX) };
  }

  /** Which debug overlays are on. */
  overlayState(): Readonly<Record<WorldOverlay, boolean>> {
    return Object.fromEntries(WORLD_OVERLAYS.map((o) => [o, this.overlays.has(o)])) as Record<WorldOverlay, boolean>;
  }

  /** Re-renders DOM texts after a language switch. */
  refreshTexts(): void {
    this.overlay.refresh();
  }

  dispose(): void {
    this.stopWatching();
    this.panKeys.detach();
    this.worldHost?.dispose();
    this.source.deactivate?.(this.renderer);
    this.renderer.setDebugView(DEBUG_VIEW_OFF);
    this.renderer.dispose();
    this.overlay.dispose();
  }
}

export function createRenderRuntime(options: RenderRuntimeOptions): RenderRuntime {
  return new RenderRuntime(options);
}
