/**
 * The game view (scene `spiel`, M2-29/M2-30): the session's own world – the world the simulation runs
 * on, generated in the world worker and streamed from the simulation's chunk store – drawn with the
 * same terrain meshes and y-sorted objects as the world debug scenes (`worldScene.ts`).
 *
 * - Camera: follows the figure – the player (M3-08), interpolated between two ticks by the session –
 *   on its layer; the player's sprite shows the clip of its movement mode (`../game/playerFigure.ts`),
 *   a debug mover of M2 the idle clips. Without a figure it
 *   rests on a free camera, which starts on the start beach (`GeneratedWorld.spawn`) – the picture
 *   behind the title – and is moved with `moveTo`/`pan` (debug camera: arrow keys in debug mode,
 *   `__dh.call('worldCamera', x, y)`).
 * - Light from the calendar: daylight blends the ambient from the moonlight of the night to the
 *   white of the day (the palette colours exactly as painted), the moon brightens the night, the
 *   weather at the camera dims it (`lightFactor`), sets wind, wetness and fog; caves stay dark
 *   (§6.2 "Höhlen: Umgebungslicht ≈ 0"). The lights are the simulation's light sources (M3-21/M3-22,
 *   `../game/lights.ts`: the player's torch, torches and camp fires, one list with the gameplay light
 *   map); a debug mover of M2 carries a stand-in hand light at dusk, at night and in caves.
 * - Season of the objects (foliage rows, bare winter trees) from the calendar.
 * - Debug overlays (chunks, collision, temperature field) on request (`overlays.ts`).
 * - Gathering (`../game/objects.ts`, M3-10 … M3-15): outline of the target in reach and under the cursor,
 *   the aim sent as `player.aim`, the interaction marker and progress ring, the dropped items, particles,
 *   falling trees and messages of harvesting.
 *
 * Reads the simulation, never writes it: streaming around the camera changes residency only, which is
 * neither content nor part of `hashState()` (docs/ARCHITEKTUR.md "Welt in der Simulation").
 */
import { SEASON_IDS } from '../../content/balance';
import type { GameSession, SessionFocus } from '../../game/session';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { Layer } from '../../world/model/coords';
import { worldDimensions } from '../../world/model/worldSize';
import { cellAtTile } from '../../world/gen/plan/grid';
import { surfaceShowcase } from './showcase';
import type { GeneratedWorld } from '../../world/gen/world';
import { clipFrameAt } from '../anim/animation';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasManifest } from '../assets/atlas';
import type { AnimationClip } from '../anim/animation';
import { FIRE, MOONLIGHT, paletteLight, type Rgb } from '../light/lightColors';
import type { Renderer } from '../renderer';
import type { RenderEnvironment, RenderScene } from '../scene';
import { setAmbient } from '../scenes/kitTools';
import type { SceneSource } from '../scenes/sceneSource';
import { CHUNK_PX, CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { WorldObjectLayer, type ObjectView } from './objects';
import { WorldOverlays, type OverlayStats, type OverlayWorld } from './overlays';
import { ChunkSignatures } from './signature';
import { WorldRenderTables } from './tables';
import { WORLD_TERRAIN_ORDER, WorldTerrainRenderer, type TerrainStats, type TerrainView } from './terrainPass';
import type { WorldHost } from './worldHost';
import type { ChunkLookup } from './window';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { CANOPY_FADE } from './worldScene';
import { PlayerFigure, type FigureClipEventSink } from '../game/playerFigure';
import { createFigureFxFrame, FigureFx } from '../game/figureFx';
import { lidClosure } from '../game/conditionLook';
import { createLightFrame, LightBridge, type LightBridgeStats } from '../game/lights';
import { GatheringView, type GatheringFrame } from '../game/objects';
import { GraveSprites } from '../game/graves';
import { DeathSystem } from '../../game/death/system';
import type { Simulation } from '../../game/sim';
import type { Translate } from '../errorOverlay';

/** What the game view needs from the page: the session, the host streaming its world, the language of content names. */
export interface GameWorldBinding {
  readonly session: Pick<GameSession, 'sim' | 'sampleFocus' | 'samplePlayer' | 'onEvent' | 'command' | 'input' | 'reader'>;
  readonly host: WorldHost;
  /** Language of content names in world texts (the interaction hint); German when absent. */
  readonly lang?: () => 'de' | 'en';
  /** Receives the frame events of the player's body clips (the audio kernel's clip sounds, src/audio/clipEvents.ts). */
  readonly onClipEvent?: FigureClipEventSink;
  /** Whether the HUD shows the interaction hint now (the marker over the target then shows only the key cap); false when absent. */
  readonly hudShowsHint?: () => boolean;
}

/** Daylight: white ambient at full strength – the palette colours exactly as painted. */
const DAYLIGHT: Rgb = [1, 1, 1];
/** Ambient strength of a moonless night and what a full moon adds (cool, but the ground stays readable; the M1 dusk clearing uses 0.34). */
const NIGHT_AMBIENT = { base: 0.2, fullMoon: 0.16 } as const;
/** Caves: the earthy dark of the Wurzelhöhlen, almost no ambient light (as the cave debug scene). */
const CAVE_AMBIENT: Rgb = paletteLight('erde.0');
const CAVE_AMBIENT_INTENSITY = 0.04;
/** Largest wind of the view [sway scale] at full weather wind. */
const WIND_SCALE = 1.2;
/** Palette index shown where nothing is drawn (outside the world, before it streams in): the darkest night colour. */
const BACKGROUND_INDEX = 1;
/** The hand light of a debug mover (M2; the player carries real torches): height of the flame above the feet, radius [px], strength, flicker (ADR-0019). */
const HAND_LIGHT = { height: 14, radius: 120, intensity: 2.2, flicker: 0.25, lift: 2 } as const;
/** Ambient strength below which the figure's hand light burns (dusk, night, caves). */
const HAND_LIGHT_BELOW = 0.75;
/** Figure sprite and its idle clips by facing. */
const FIGURE_SPRITE = 'spieler_koerper';
const FIGURE_CLIPS = { down: 'idle_down', up: 'idle_up', left: 'idle_left', right: 'idle_right' } as const;
/** Movement per frame below which the figure keeps its facing [px]. */
const FACING_EPSILON = 0.05;
/** Camera centre above the figure's feet [px] (the body's middle is the centre of the picture). */
const CAMERA_LIFT = 8;
/** Width and height of the largest internal view (§4.2) plus the margin objects are pushed for [px]. */
const MAX_VIEW = { w: 640, h: 270, margin: TILE_PX * 2 } as const;
/** Tallest object sprite above its anchor [px] (trees up to 96 px, §4.4). */
const OBJECT_REACH_PX = 96;
/**
 * Composition of the title picture: from the beach centre (`GeneratedWorld.spawn`) the camera moves
 * towards the nearest open sea (searched on the world plan's cells in `TITLE_SEA.directions`
 * directions up to `maxTiles`) until the waterline lies `coastFromCentreTiles` from the picture's
 * centre – beach and sea on one side, the land behind on the other.
 */
const TITLE_SEA = { directions: 16, stepTiles: 2, maxTiles: 64, coastFromCentreTiles: 9 } as const;

/** What the debug extension `worldView` reports. */
export interface GameViewInfo {
  readonly scene: 'spiel';
  readonly state: string;
  readonly error: string | null;
  readonly seed: number | null;
  readonly layer: Layer;
  readonly camera: readonly [number, number];
  readonly follows: boolean;
  readonly figure: readonly [number, number] | null;
  readonly resident: number;
  readonly loading: number;
  readonly syncLoads: number;
  readonly terrain: Readonly<TerrainStats>;
  readonly objects: Readonly<WorldObjectLayer['stats']>;
  /** Gathering: focus, hint and aim of the interaction, drops and effects drawn (M3-10). */
  readonly gathering: {
    readonly focus: string;
    readonly subject: string;
    readonly working: boolean;
    readonly progress: number;
    readonly hint: string;
    readonly aim: { tx: number; ty: number } | null;
    readonly drops: number;
    readonly dropList: readonly { item: string; count: number; x: number; y: number; flying: boolean }[];
    readonly particles: number;
    readonly fallingTrees: number;
  };
  readonly overlays: Readonly<Record<string, boolean>>;
  readonly overlayStats: Readonly<OverlayStats>;
  /** Lights handed to the renderer and placed-light sprites drawn in the last frame (M3-22). */
  readonly lights: Readonly<LightBridgeStats>;
  /** Graves drawn in the last frame (M3-26). */
  readonly graves: number;
  readonly ambient: number;
  readonly generatedInMs: number;
  readonly mode: string;
  /** Why the world worker was given up during the session (chunk loads then run in this thread, M3-41), or null. */
  readonly workerFailure: string | null;
}

type Facing = keyof typeof FIGURE_CLIPS;

/** Where the free camera starts once the world is there: the title picture, or the showcase window of a biome (screenshots). */
export type GameCameraStart = { readonly kind: 'titel' } | { readonly kind: 'biom'; readonly biome: string };

/** Centre tile of a biome's showcase window (the spot of the world debug scenes, `showcase.ts`). */
function showcaseCamera(world: GeneratedWorld, biome: string): { x: number; y: number } {
  const spot = surfaceShowcase(world, biome);
  return { x: spot.tx, y: spot.ty };
}

/** Tile the title picture centres on (see `TITLE_SEA`); the beach centre when no sea is near. */
export function titleCamera(world: GeneratedWorld): { x: number; y: number } {
  const { grid, land } = world.plan;
  const { x, y } = world.spawn;
  for (let r = TITLE_SEA.stepTiles; r <= TITLE_SEA.maxTiles; r += TITLE_SEA.stepTiles) {
    for (let k = 0; k < TITLE_SEA.directions; k++) {
      const a = (k / TITLE_SEA.directions) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      if (land[cellAtTile(grid, x + dx * r + 0.5, y + dy * r + 0.5)] !== 0) continue;
      const shift = Math.max(0, r - TITLE_SEA.coastFromCentreTiles);
      return { x: Math.round(x + dx * shift), y: Math.round(y + dy * shift) };
    }
  }
  return { x, y };
}

export class GameWorldScene implements SceneSource {
  readonly id = 'spiel';
  readonly terrain = new WorldTerrainRenderer();
  readonly signatures = new ChunkSignatures();
  readonly overlays = new WorldOverlays();
  private tables: WorldRenderTables | null = null;
  private objects: WorldObjectLayer | null = null;
  private tableError: string | null = null;
  private layerValue: Layer = 0;
  private cameraX = 0;
  private cameraY = 0;
  private freeX = 0;
  private freeY = 0;
  private freeLayer: Layer = 0;
  private freePlaced = false;
  private start: GameCameraStart = { kind: 'titel' };
  private following = false;
  private readonly focus: SessionFocus = { x: 0, y: 0, layer: 0 };
  private figureX = 0;
  private figureY = 0;
  private hasFigure = false;
  private facing: Facing = 'down';
  /** The player's sprite (movement and action clips, items in the hands, hit flash, condition offsets). */
  readonly player = new PlayerFigure();
  /** Particles of the player's conditions and of light events (M3-20, M3-22). */
  readonly fx = new FigureFx();
  private readonly fxFrame = createFigureFxFrame();
  /** Interaction outline, aim, marker, drops and harvest effects (M3-10 … M3-15). */
  readonly gathering: GatheringView;
  /** The simulation's light sources → the renderer's lights, placed-light sprites, light map views (M3-21, M3-22). */
  readonly lights = new LightBridge();
  /** The player's graves (M3-26). */
  readonly graves = new GraveSprites();
  private deathSystem: { sim: Simulation; death: DeathSystem | null } | null = null;
  private readonly lightFrame = createLightFrame();
  private readonly gatherFrame: { -readonly [K in keyof GatheringFrame]: GatheringFrame[K] } = { layer: 0, cameraX: 0, cameraY: 0, viewW: 0, viewH: 0, lang: 'de', hudHint: false, figure: null };
  /** Opaque box of the figure drawn this frame [world px]: the interaction marker keeps clear of it. */
  private readonly figureBox = { left: 0, top: 0, right: 0, bottom: 0 };
  private lastFigureX = Number.NaN;
  private lastFigureY = Number.NaN;
  private ambientValue = 1;
  /** Whether the last frame showed the world (camera placed, terrain view set). */
  private shown = false;
  /** Internal view size of the last frame [px] (overlays cover exactly the visible part). */
  private viewW: number = MAX_VIEW.w;
  private viewH: number = MAX_VIEW.h;
  private scene: RenderScene | null = null;
  private savedEnv: RenderEnvironment | null = null;
  private readonly weather: WeatherSample = createWeatherSample();
  private readonly overlayView = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly view: { layer: Layer; readonly chunks: ChunkLookup; readonly signatures: ChunkSignatures; inWorld(cx: number, cy: number): boolean };
  private readonly objectView: ObjectView & { layer: Layer };
  private readonly overlayWorld: OverlayWorld & { layer: Layer; worldTiles: number; temperature: OverlayWorld['temperature'] };

  constructor(
    private readonly gameAtlas: () => AtlasData | null,
    private readonly binding: () => GameWorldBinding | null,
    t: Translate | null = null,
  ) {
    this.gathering = new GatheringView(t);
    const host = (): WorldHost | null => this.binding()?.host ?? null;
    const lookup: ChunkLookup = { get: (layer, cx, cy) => host()?.get(layer, cx, cy) };
    this.view = { layer: 0, chunks: lookup, signatures: this.signatures, inWorld: (cx, cy) => host()?.inWorld(cx, cy) ?? false };
    this.objectView = { layer: 0, chunks: lookup, signatures: this.signatures, left: 0, top: 0, right: 0, bottom: 0, fadeX: 0, fadeY: 0, fadeRadius: 0 };
    this.overlayWorld = {
      layer: 0,
      worldTiles: 0,
      temperature: null,
      get: (layer, cx, cy) => lookup.get(layer, cx, cy),
      isLoading: (layer, cx, cy) => host()?.manager?.isLoading(layer, cx, cy) ?? false,
      isActive: (layer, cx, cy) => {
        const sim = this.binding()?.session.sim;
        return sim !== undefined && sim.world.materialized && sim.world.zone.isActive(layer, cx, cy);
      },
    };
  }

  /** Layer the view shows. */
  get layer(): Layer {
    return this.layerValue;
  }

  /** Camera centre (world px). */
  /**
   * World point [px] and layer under internal render pixel (ix, iy) of the last drawn frame (the debug
   * inspector picks entities there).
   */
  worldPointAt(ix: number, iy: number): { x: number; y: number; layer: Layer } {
    return { x: this.cameraX - this.viewW / 2 + ix, y: this.cameraY - this.viewH / 2 + iy, layer: this.layerValue };
  }

  get camera(): readonly [number, number] {
    return [this.cameraX, this.cameraY];
  }

  /** Whether the camera follows the controlled figure (debug panning moves the free camera only). */
  get followsFigure(): boolean {
    return this.following;
  }

  /** Internal size of the picture (§4.2: 360–640 × 270) – the overlays cover the visible part. */
  setViewSize(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.viewW = width;
      this.viewH = height;
    }
  }

  /** Where the free camera starts (applied when the world is there; resets a placed camera). */
  startAt(start: GameCameraStart): void {
    this.start = start;
    this.freePlaced = false;
  }

  /** Moves the free camera by (dx, dy) world px. */
  pan(dx: number, dy: number): void {
    this.freeX += dx;
    this.freeY += dy;
    this.freePlaced = true;
  }

  /** Puts the free camera centre on world px (x, y) of `layer` (default: the current layer). */
  moveTo(x: number, y: number, layer: Layer = this.freeLayer): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Welt-Kamera: (${x}, ${y}) ist keine Position`);
    this.freeX = x;
    this.freeY = y;
    this.freeLayer = layer;
    this.freePlaced = true;
  }

  activate(renderer: Renderer): void {
    if (!renderer.passes.get(this.terrain.name)) renderer.passes.add(this.terrain, WORLD_TERRAIN_ORDER);
    this.lights.attach(renderer);
  }

  deactivate(renderer: Renderer): void {
    renderer.passes.remove(this.terrain.name);
    this.lights.detach(renderer);
    this.player.dispose();
    this.gathering.dispose();
    this.fx.dispose();
    const scene = this.scene;
    if (scene === null) return;
    scene.post.lid = 0;
    scene.post.frost = 0;
    const i = scene.ground.indexOf(this.terrain);
    if (i >= 0) scene.ground.splice(i, 1);
    if (this.savedEnv !== null) Object.assign(scene.env, this.savedEnv);
    scene.fadeRadius = 0;
    this.scene = null;
    this.savedEnv = null;
  }

  /** The world is there, the last frame showed it, and every visible chunk is drawn with its mesh. */
  ready(): boolean {
    return this.binding()?.host.state === 'bereit' && this.tables !== null && this.shown && this.terrain.complete;
  }

  info(): GameViewInfo {
    const host = this.binding()?.host ?? null;
    const m = host?.manager ?? null;
    return {
      scene: 'spiel',
      state: this.tableError !== null ? 'fehler' : (host?.state ?? 'leer'),
      error: this.tableError ?? host?.error ?? null,
      seed: host?.world?.seed ?? null,
      layer: this.layerValue,
      camera: [this.cameraX, this.cameraY],
      follows: this.following,
      figure: this.hasFigure ? [this.figureX, this.figureY] : null,
      resident: m?.residentCount ?? 0,
      loading: m?.loadingCount ?? 0,
      syncLoads: m?.syncLoads ?? 0,
      terrain: { ...this.terrain.stats },
      objects: { ...(this.objects?.stats ?? { pushed: 0, builds: 0, faded: 0, decor: 0 }) },
      gathering: {
        focus: this.gathering.lastFocus.kind,
        subject: this.gathering.lastFocus.subject,
        working: this.gathering.lastFocus.working,
        progress: this.gathering.lastFocus.progress,
        hint: this.gathering.lastHint,
        aim: this.gathering.aimedTile,
        drops: this.gathering.drops.drawn,
        dropList: this.gathering.dropList(),
        particles: this.gathering.effects.particles,
        fallingTrees: this.gathering.effects.fallingTrees,
      },
      overlays: { ...this.overlays.enabled },
      overlayStats: { ...this.overlays.stats },
      lights: { ...this.lights.stats },
      graves: this.graves.drawn,
      ambient: this.ambientValue,
      generatedInMs: host?.generatedInMs ?? 0,
      mode: host?.mode ?? 'inThread',
      workerFailure: host?.workerFailure ?? null,
    };
  }

  private tablesFor(atlas: AtlasData): WorldRenderTables | null {
    if (this.tables?.manifest === atlas.manifest) return this.tables;
    try {
      this.tables = new WorldRenderTables(atlas.manifest);
      this.objects = new WorldObjectLayer(this.tables);
      this.tableError = null;
    } catch (err) {
      this.tables = null;
      this.objects = null;
      this.tableError = err instanceof Error ? err.message : String(err);
    }
    return this.tables;
  }

  fill(scene: RenderScene, time: number): void {
    if (this.scene !== scene) {
      this.scene = scene;
      this.savedEnv = { ...scene.env };
    }
    if (!scene.ground.includes(this.terrain)) scene.ground.push(this.terrain);
    const binding = this.binding();
    const atlas = this.gameAtlas();
    scene.atlas = atlas;
    const tables = atlas === null ? null : this.tablesFor(atlas);
    const world = binding?.host.world ?? null;
    scene.post.lid = 0;
    scene.post.frost = 0;
    if (binding === null || atlas === null || tables === null || world === null || binding.host.state !== 'bereit') {
      this.darkEnvironment(scene.env);
      this.terrain.setWorld(null, null, null);
      this.shown = false;
      return;
    }
    this.shown = true;
    const sim = binding.session.sim;
    if (!this.freePlaced) {
      const spot = this.start.kind === 'biom' ? showcaseCamera(world, this.start.biome) : titleCamera(world);
      this.freeX = spot.x * TILE_PX + TILE_PX / 2;
      this.freeY = spot.y * TILE_PX + TILE_PX / 2;
      this.freeLayer = 0;
      this.freePlaced = true;
    }
    this.following = binding.session.sampleFocus(this.focus);
    this.hasFigure = this.following;
    if (this.following) {
      this.figureX = this.focus.x;
      this.figureY = this.focus.y;
      this.layerValue = this.focus.layer;
      this.cameraX = this.figureX;
      this.cameraY = this.figureY - CAMERA_LIFT;
      this.updateFacing();
    } else {
      this.layerValue = this.freeLayer;
      this.cameraX = this.freeX;
      this.cameraY = this.freeY;
      this.lastFigureX = Number.NaN;
    }
    const layer = this.layerValue;
    this.view.layer = layer;
    this.objectView.layer = layer;
    this.environment(scene.env, binding);
    binding.host.update(layer, Math.floor(this.cameraX / CHUNK_PX), Math.floor(this.cameraY / CHUNK_PX));
    this.signatures.beginFrame();
    this.terrain.setWorld(atlas, tables, this.view as TerrainView);
    scene.camera.set(this.cameraX, this.cameraY).unfollow();
    const v = this.objectView;
    v.left = this.cameraX - MAX_VIEW.w / 2 - MAX_VIEW.margin;
    v.right = this.cameraX + MAX_VIEW.w / 2 + MAX_VIEW.margin;
    v.top = this.cameraY - MAX_VIEW.h / 2 - MAX_VIEW.margin;
    v.bottom = this.cameraY + MAX_VIEW.h / 2 + MAX_VIEW.margin + OBJECT_REACH_PX;
    v.fadeX = this.hasFigure ? this.figureX : 0;
    v.fadeY = this.hasFigure ? this.figureY - CANOPY_FADE.lift : 0;
    v.fadeRadius = this.hasFigure ? CANOPY_FADE.radius : 0;
    scene.fadeX = v.fadeX;
    scene.fadeY = v.fadeY;
    scene.fadeRadius = v.fadeRadius;
    const objects = this.objects;
    const g = this.gatherFrame;
    g.layer = layer;
    g.cameraX = this.cameraX;
    g.cameraY = this.cameraY;
    g.viewW = this.viewW;
    g.viewH = this.viewH;
    g.lang = binding.lang?.() ?? 'de';
    g.hudHint = binding.hudShowsHint?.() ?? false;
    const season = SEASON_IDS.indexOf(sim.world.calendar.season);
    const gathering = objects !== null && this.gathering.prepare(binding.session, g, objects);
    if (objects !== null) {
      objects.season = season;
      objects.emit(scene, v);
    }
    this.fx.follow(binding.session);
    this.fx.beginFrame();
    this.player.onClipEvent(binding.onClipEvent ?? null);
    if (this.hasFigure) this.placeFigure(scene, atlas, time, binding.session);
    this.fx.drawBursts(scene, atlas.manifest, layer, time);
    g.figure = this.hasFigure ? this.figureBoxOf(atlas.manifest) : null;
    if (gathering) this.gathering.draw(scene, atlas, tables, binding.session, g, time, season);
    // The interaction's use target (a fire, a torch, a grave) carries the outline.
    const focus = this.gathering.lastFocus;
    const useTx = gathering && focus.kind === 'use' && focus.layer === layer ? focus.tx : -1;
    const useTy = gathering && focus.kind === 'use' && focus.layer === layer ? focus.ty : -1;
    const death = this.deathOf(sim);
    if (death !== null) this.graves.draw(scene, atlas, death, layer, time, useTx, useTy);
    const lf = this.lightFrame;
    lf.layer = layer;
    lf.time = time;
    lf.hasFigure = this.hasFigure;
    lf.figureX = this.figureX;
    lf.figureY = this.figureY;
    lf.left = v.left;
    lf.top = v.top;
    lf.right = v.right;
    lf.bottom = v.bottom;
    lf.focusTx = useTx;
    lf.focusTy = useTy;
    this.lights.fill(scene, atlas, sim, lf);
    if (this.overlays.any) {
      const ow = this.overlayWorld;
      ow.layer = layer;
      ow.worldTiles = worldDimensions(world.preset).tiles;
      // Reading the temperature field builds the plan stage from the handed-in world if the first world tick has not yet (state neutral).
      ow.temperature = sim.world.materialized ? sim.world.temperature : null;
      const ov = this.overlayView;
      ov.left = Math.floor(this.cameraX - this.viewW / 2);
      ov.right = ov.left + this.viewW;
      ov.top = Math.floor(this.cameraY - this.viewH / 2);
      ov.bottom = ov.top + this.viewH;
      this.overlays.fill(scene.debugOverlay, ov, ow);
    }
  }

  /** Before the world is there: the background colour only. */
  private darkEnvironment(env: RenderEnvironment): void {
    env.background = BACKGROUND_INDEX;
    env.fog = 0;
    env.wetness = 0;
    env.wind = 0;
    setAmbient(env, DAYLIGHT, 1);
    this.ambientValue = 1;
  }

  /** Ambient light, wind, wetness and fog from calendar and weather at the camera. */
  private environment(env: RenderEnvironment, binding: GameWorldBinding): void {
    const sim = binding.session.sim;
    const cal = sim.world.calendar;
    env.background = BACKGROUND_INDEX;
    env.dayFraction = sim.clock.dayFraction;
    if (this.layerValue !== 0) {
      setAmbient(env, CAVE_AMBIENT, CAVE_AMBIENT_INTENSITY);
      env.wind = 0;
      env.wetness = 0;
      env.fog = 0;
      this.ambientValue = CAVE_AMBIENT_INTENSITY;
      return;
    }
    const d = cal.daylight;
    const night = NIGHT_AMBIENT.base + NIGHT_AMBIENT.fullMoon * cal.moonIllumination;
    let light = 1;
    let wind = 0;
    let wet = 0;
    let fog = 0;
    if (sim.world.materialized) {
      const tx = Math.floor(this.cameraX / TILE_PX);
      const ty = Math.floor(this.cameraY / TILE_PX);
      const region = sim.world.regionAt(tx, ty);
      if (region !== NO_WEATHER_REGION) {
        const w = sim.world.weather.sample(region, this.weather);
        light = w.lightFactor;
        wind = w.wind;
        wet = w.precipitationKind === 'regen' ? w.precipitation : 0;
        fog = w.haze;
      }
    }
    const r = MOONLIGHT[0] + (DAYLIGHT[0] - MOONLIGHT[0]) * d;
    const g = MOONLIGHT[1] + (DAYLIGHT[1] - MOONLIGHT[1]) * d;
    const b = MOONLIGHT[2] + (DAYLIGHT[2] - MOONLIGHT[2]) * d;
    const intensity = (night + (1 - night) * d) * light;
    env.ambientR = r;
    env.ambientG = g;
    env.ambientB = b;
    env.ambientIntensity = intensity;
    env.wind = wind * WIND_SCALE;
    env.wetness = wet;
    env.fog = fog;
    this.ambientValue = intensity;
  }

  /** Facing of the figure from its movement since the last frame (kept while it stands). */
  private updateFacing(): void {
    const dx = this.figureX - this.lastFigureX;
    const dy = this.figureY - this.lastFigureY;
    this.lastFigureX = this.figureX;
    this.lastFigureY = this.figureY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < FACING_EPSILON && Math.abs(dy) < FACING_EPSILON)) return;
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  /** The death system of `sim` (looked up once per simulation), or null. */
  private deathOf(sim: Simulation): DeathSystem | null {
    let entry = this.deathSystem;
    if (entry === null || entry.sim !== sim) {
      const d = sim.systems.find((x) => x.id === 'death');
      entry = { sim, death: d instanceof DeathSystem ? d : null };
      this.deathSystem = entry;
    }
    return entry.death;
  }

  /** The figure's opaque box [world px] at its drawn place (the sprite's bounds around its anchor), or null without the sprite. */
  private figureBoxOf(m: AtlasManifest): { left: number; top: number; right: number; bottom: number } | null {
    const s = m.sprites[FIGURE_SPRITE];
    const f = s?.frames[0];
    if (s === undefined || f === undefined) return null;
    const bx = s.bounds?.x ?? 0;
    const by = s.bounds?.y ?? 0;
    const b = this.figureBox;
    b.left = this.figureX - f.ax + bx;
    b.top = this.figureY - f.ay + by;
    b.right = b.left + (s.bounds?.w ?? s.size[0]);
    b.bottom = b.top + (s.bounds?.h ?? s.size[1]);
    return b;
  }

  private placeFigure(scene: RenderScene, atlas: AtlasData, time: number, session: GameWorldBinding['session']): void {
    const m = atlas.manifest;
    if (m.sprites[FIGURE_SPRITE] === undefined) return;
    const isPlayer = this.player.place(scene, atlas, session, time, this.figureX, this.figureY);
    if (isPlayer) {
      // The player's conditions: particles at the figure, eyelids and frost over the picture (M3-20).
      const look = this.player.pose.look;
      const ff = this.fxFrame;
      ff.x = this.player.drawn.x;
      ff.y = this.player.drawn.y;
      ff.heightBase = this.player.drawn.heightBase;
      ff.facing = this.player.lastSample.facing;
      ff.layer = this.layerValue;
      ff.time = time;
      this.fx.drawFigure(scene, m, look, ff);
      scene.post.lid = lidClosure(look.lid, time);
      scene.post.frost = look.frost;
    } else {
      const sprite = atlasSprite(m, FIGURE_SPRITE);
      const clip: AnimationClip = spriteClip(sprite, FIGURE_CLIPS[this.facing]);
      const d = scene.sprite.reset();
      d.frame = spriteFrame(sprite, clipFrameAt(clip, time));
      d.x = this.figureX;
      d.y = this.figureY;
      d.heightBase = this.levelAt(this.figureX, this.figureY) * WAND_PX_JE_STUFE;
      scene.sprites.push(d);
    }
    // The player's light is the simulation's (its torch, `this.lights`); a debug mover of M2 carries the stand-in.
    if (isPlayer || this.ambientValue >= HAND_LIGHT_BELOW) return;
    const l = scene.light.reset();
    l.x = this.figureX + HAND_LIGHT.lift;
    l.y = this.figureY;
    l.height = HAND_LIGHT.height;
    l.radius = HAND_LIGHT.radius;
    l.r = FIRE[0];
    l.g = FIRE[1];
    l.b = FIRE[2];
    l.intensity = HAND_LIGHT.intensity;
    l.flicker = HAND_LIGHT.flicker;
    l.seed = 0;
    scene.lights.push(l);
  }

  /** Height level of the tile under world px (x, y) on the view's layer (surface only). */
  private levelAt(x: number, y: number): number {
    if (this.layerValue !== 0) return 0;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const c = this.view.chunks.get(0, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    return c === undefined ? 0 : (c.height[(ty - c.cy * CHUNK_TILES) * CHUNK_TILES + (tx - c.cx * CHUNK_TILES)] as number);
  }
}
