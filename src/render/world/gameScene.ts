/**
 * The game view (scene `spiel`, M2-29/M2-30): the session's own world – the world the simulation runs
 * on, generated in the world worker and streamed from the simulation's chunk store – drawn with the
 * same terrain meshes and y-sorted objects as the world debug scenes (`worldScene.ts`).
 *
 * - Camera: follows the controlled figure (the player until M3-08) on its layer; without a figure it
 *   rests on a free camera, which starts on the start beach (`GeneratedWorld.spawn`) – the picture
 *   behind the title – and is moved with `moveTo`/`pan` (debug camera: arrow keys in debug mode,
 *   `__dh.call('worldCamera', x, y)`).
 * - Light from the calendar: daylight blends the ambient from the moonlight of the night to the
 *   white of the day (the palette colours exactly as painted), the moon brightens the night, the
 *   weather at the camera dims it (`lightFactor`), sets wind, wetness and fog; caves stay dark
 *   (§6.2 "Höhlen: Umgebungslicht ≈ 0"). The figure carries a hand light that shows night and caves
 *   (until torches exist, M3).
 * - Season of the objects (foliage rows, bare winter trees) from the calendar.
 * - Debug overlays (chunks, collision, temperature field) on request (`overlays.ts`).
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
import { atlasSprite, spriteClip, spriteFrame, type AtlasData } from '../assets/atlas';
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

/** What the game view needs from the page: the session and the host streaming its world. */
export interface GameWorldBinding {
  readonly session: Pick<GameSession, 'sim' | 'sampleFocus'>;
  readonly host: WorldHost;
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
/** The figure's hand light: height of the flame above the feet, radius [px], strength, flicker (a torch, ADR-0019). */
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
  readonly overlays: Readonly<Record<string, boolean>>;
  readonly overlayStats: Readonly<OverlayStats>;
  readonly ambient: number;
  readonly generatedInMs: number;
  readonly mode: string;
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
  ) {
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
  }

  deactivate(renderer: Renderer): void {
    renderer.passes.remove(this.terrain.name);
    const scene = this.scene;
    if (scene === null) return;
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
      objects: { ...(this.objects?.stats ?? { pushed: 0, builds: 0, faded: 0 }) },
      overlays: { ...this.overlays.enabled },
      overlayStats: { ...this.overlays.stats },
      ambient: this.ambientValue,
      generatedInMs: host?.generatedInMs ?? 0,
      mode: host?.mode ?? 'inThread',
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
    if (objects !== null) {
      objects.season = SEASON_IDS.indexOf(sim.world.calendar.season);
      objects.emit(scene, v);
    }
    if (this.hasFigure) this.placeFigure(scene, atlas, time);
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

  private placeFigure(scene: RenderScene, atlas: AtlasData, time: number): void {
    const m = atlas.manifest;
    if (m.sprites[FIGURE_SPRITE] === undefined) return;
    const sprite = atlasSprite(m, FIGURE_SPRITE);
    const clip: AnimationClip = spriteClip(sprite, FIGURE_CLIPS[this.facing]);
    const d = scene.sprite.reset();
    d.frame = spriteFrame(sprite, clipFrameAt(clip, time));
    d.x = this.figureX;
    d.y = this.figureY;
    d.heightBase = this.levelAt(this.figureX, this.figureY) * WAND_PX_JE_STUFE;
    scene.sprites.push(d);
    if (this.ambientValue >= HAND_LIGHT_BELOW) return;
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
