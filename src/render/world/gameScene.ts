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
import { FocusRecord, type GameSession } from '../../game/session';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import { WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_FROZEN } from '../../world/model/chunk';
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
import { CHUNK_PX, CHUNK_TILES, TILE_PX, TILE_SHIFT } from '../tilemap/chunk';
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
import { SkySceneFiller, type SkyView } from './skyScene';
import type { DirectionalLight } from '../light/sky';
import { OCCLUDER_RING } from '../light/params';
import { casterReach, type CasterReach } from '../light/shadowFrame';
import { GBUFFER_HEIGHT_RANGE_PX } from '../gbuffer';
import { GatheringView, type GatheringFrame } from '../game/objects';
import { GraveSprites } from '../game/graves';
import { createFarmFrame, FarmView, isFeldSession, type FeldSession } from '../game/farming';
import { createFishingFrame, FishingView } from '../game/fishing';
// Strand F (M7-32 … M7-35): the bosses and the beacons.
import { BossView, createBossFrame } from '../game/bosses';
import { BeaconView, createBeaconFrame } from '../game/beacons';
import { createCreatureFrame, CreatureSprites } from '../game/creatures';
import { CombatView, createCombatFrame, type CombatViewInfo } from '../game/combat';
import { DeathSystem } from '../../game/death/system';
import { BuildingView, createBuildingFrame } from '../game/building';
import { createStationFrame, StationView, type StationStats } from '../game/stations';
import { createFireFrame, FireView, type FireStats } from '../game/fire';
import { createGhostFrame, GhostView, type BuildGhost } from '../game/ghost';
import { createPlacementFrame, HandPlacementView, type PlacementStats } from '../game/placement';
import { BuildOverlays, createBuildOverlayFrame } from '../game/overlays';
import type { Simulation } from '../../game/sim';
import type { Translate } from '../errorOverlay';
import { SurfaceSceneFiller, SurfaceView } from './surfaceScene';
import { WaterSceneFiller } from './waterScene';
import { ParticleSceneFiller } from './particlesScene';
import { enterAtmosphere, fillAtmosphere } from './atmosphereScene';
import { WorldEventView } from './worldEventsScene';
import { FloatKey } from '../uniformBits';

/** What the game view needs from the page: the session, the host streaming its world, the language of content names. */
export interface GameWorldBinding {
  readonly session: Pick<GameSession, 'sim' | 'sampleFocus' | 'samplePlayer' | 'sampleSight' | 'onEvent' | 'command' | 'input' | 'reader' | 'renderAlpha'> & Partial<Pick<GameSession, 'sampleCombat' | 'sampleWorldEvents'>> & Partial<FeldSession>;
  readonly host: WorldHost;
  /** Language of content names in world texts (the interaction hint); German when absent. */
  readonly lang?: () => 'de' | 'en';
  /** Receives the frame events of the player's body clips (the audio kernel's clip sounds, src/audio/clipEvents.ts). */
  readonly onClipEvent?: FigureClipEventSink;
  /** Whether the HUD shows the interaction hint now (the marker over the target then shows only the key cap); false when absent. */
  readonly hudShowsHint?: () => boolean;
  /** The build mode's shared record (M4-22): the ghost, its verdicts and the build overlay; no build mode when absent. */
  readonly build?: BuildGhost;
  /** Reduced motion (§29): the roof of an interior lifts at once; false when absent. */
  readonly reducedMotion?: () => boolean;
  /** Screenshake of the fight, 0–1 (`accessibility.screenshake`, §29; M6-05); full when absent. */
  readonly screenshake?: () => number;
  /** Damage numbers of the fight on or off (`game.damageNumbers`, §29; M6-05); on when absent. */
  readonly damageNumbers?: () => boolean;
}

/** Not a number (a module constant: reading `Number.NaN` in the frame's baseline code makes a new heap number, §30). */
const NAN = Number.NaN;
/** Dither of the roofs while a build overlay is shown (M4-26): the fields on the ground read through them. */
const BUILD_OVERLAY_ROOF_VEIL = 0.6;
/** Daylight: white ambient at full strength – the palette colours exactly as painted. */
const DAYLIGHT: Rgb = [1, 1, 1];
/** Ambient strength of a moonless night and what a full moon adds (cool, but the ground stays readable; the M1 dusk clearing uses 0.34). */
export const NIGHT_AMBIENT = { base: 0.2, fullMoon: 0.16 } as const;
/** Caves: the earthy dark of the Wurzelhöhlen, almost no ambient light (as the cave debug scene). */
export const CAVE_AMBIENT: Rgb = paletteLight('erde.0');
export const CAVE_AMBIENT_INTENSITY = 0.04;
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
 * The view rectangle objects are pushed for, relative to the camera [px]; the ambient's day/night blend per channel.
 * Module constants: the frame (code that runs once per frame – V8's baseline tier makes every float result a new
 * heap number) computes no constant again (§30).
 */
const PUSH_LEFT = MAX_VIEW.w / 2 + MAX_VIEW.margin;
const PUSH_TOP = MAX_VIEW.h / 2 + MAX_VIEW.margin;
const PUSH_BOTTOM = MAX_VIEW.h / 2 + MAX_VIEW.margin + OBJECT_REACH_PX;
/** How far from the camera the sky's occluders are gathered on one side [whole px]: the occluder ring or the pushed rectangle. */
function skyReach(halfView: number, push: number): number {
  return Math.ceil(Math.max(halfView + OCCLUDER_RING.reachPx, push));
}
const NIGHT_BASE = NIGHT_AMBIENT.base;
const NIGHT_FULL_MOON = NIGHT_AMBIENT.fullMoon;
const MOON_R = MOONLIGHT[0];
const MOON_G = MOONLIGHT[1];
const MOON_B = MOONLIGHT[2];
const DAY_MINUS_MOON_R = DAYLIGHT[0] - MOONLIGHT[0];
const DAY_MINUS_MOON_G = DAYLIGHT[1] - MOONLIGHT[1];
const DAY_MINUS_MOON_B = DAYLIGHT[2] - MOONLIGHT[2];
/** Slots of the environment values the game view keeps between ticks (`environment`). */
const ENV_DAY_FRACTION = 0;
const ENV_AMBIENT_R = 1;
const ENV_AMBIENT_G = 2;
const ENV_AMBIENT_B = 3;
const ENV_INTENSITY = 4;
const ENV_WIND = 5;
const ENV_WETNESS = 6;
const ENV_WEATHER_LIGHT = 7;
const ENV_VALUES = 8;
/**
 * Chunk coordinates of whole tiles and pixels by shifting: in V8's baseline tier, where the frame's code runs, a division
 * of two whole numbers with a remainder is a new heap number (§30).
 */
const CHUNK_PX_SHIFT = TILE_SHIFT + CHUNK_SHIFT;
if (1 << CHUNK_SHIFT !== CHUNK_TILES || 1 << CHUNK_PX_SHIFT !== CHUNK_PX) throw new Error('Spielansicht: Chunkkante ist keine Zweierpotenz');
/** Slots of the frame key (`fill`): camera, figure, whether a figure is followed. */
const KEY_CAMERA_X = 0;
const KEY_CAMERA_Y = 1;
const KEY_FIGURE_X = 2;
const KEY_FIGURE_Y = 3;
const KEY_FOLLOWING = 4;
const KEY_SLOTS = 5;
/** Weather region key of a world not yet materialised (no region looked up: no weather). */
const ENV_UNMATERIALIZED = -2;
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
  /** The preview of the trap in the hand on its target tile (M6-30). */
  readonly placement: Readonly<PlacementStats>;
  /** Placed stations drawn, at work, without sprite (M4-05, M4-06). */
  readonly stations: Readonly<StationStats>;
  /** Burning tiles and their flames drawn (M4-28). */
  readonly fire: Readonly<FireStats>;
  /** The fight (M6-05, M6-15c, M6-38): its effects, telegraphs, projectiles and numbers; the player's combat clip, stage, aim and weapon angle. */
  readonly combat: CombatViewInfo & { readonly clip: string; readonly stage: string; readonly aimAngle: number; readonly handAngle: number; readonly creaturesInDark: number; readonly creaturesFinster: number; readonly creaturesImmersed: number };
  /**
   * The build grid (M4-13, M4-27): pieces drawn, the interior's roof fade (0 drawn … 1 gone) and the build mode's
   * ghost (M4-22: cursor, anchors, placeable ones, first refusal) and overlay (M4-26).
   */
  readonly building: {
    readonly pieces: number;
    readonly blueprints: number;
    readonly roofs: number;
    /** Roof tiles in the see-through circle around the player (M4-27). */
    readonly roofsInCircle: number;
    readonly cutWalls: number;
    readonly roofFade: number;
    readonly roofTiles: number;
    readonly inside: boolean;
    readonly missing: number;
    readonly ghost: { readonly active: boolean; readonly piece: string | null; readonly cursor: readonly [number, number] | null; readonly anchors: number; readonly ok: number; readonly reason: string | null; readonly drawn: number };
    readonly overlay: { readonly kind: string | null; readonly tiles: number; readonly rooms: number; readonly labels: number };
  };
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
  /** Where the figure is: a record the session fills without a heap number (M6-05e). */
  private readonly focus = new FocusRecord();
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
  /** Sun, moon, clouds and the terrain/building occluders of the frame (`scene.sky`, M5-01 … M5-04). */
  readonly sky = new SkySceneFiller();
  /** The player's graves (M3-26). */
  readonly graves = new GraveSprites();
  /** The fields and fishing (M7-19 … M7-24, strand D): plants, wet soil, pests; rod, line, float, fish traps, ice holes. */
  readonly farm = new FarmView();
  private readonly farmFrame = createFarmFrame();
  readonly fishing = new FishingView();
  private readonly fishingFrame = createFishingFrame();
  /** The bosses and the beacons (strand F, M7-32 … M7-35): body, knots, telegraphs, root bursts, arena fire, leaf storm; beacons and light wave. */
  readonly bosses = new BossView();
  private readonly bossFrame = createBossFrame();
  /** The camera's shift that frames a boss fight (strand F, M7-32; `BossView.framing`). */
  private readonly bossShift = { x: 0, y: 0 };
  readonly beacons = new BeaconView();
  private readonly beaconFrame = createBeaconFrame();
  /** Creatures, carcasses and traps (M6-13 … M6-32). */
  readonly creatures = new CreatureSprites();
  private readonly creatureFrame = createCreatureFrame();
  /** The fight: impact particles, trails, telegraphs, projectiles, damage numbers, screenshake (M6-05, M6-15c). */
  readonly combat = new CombatView();
  private readonly combatFrame = createCombatFrame();
  /** The build grid: structures, roofs, the interior view (M4-13, M4-27). */
  readonly building = new BuildingView();
  /** The build mode's ghost preview (M4-22, M4-23) and overlays (M4-26). */
  readonly ghost = new GhostView();
  /** The preview of a trap in the hand on the tile the primary button sets it up on (M6-30). */
  readonly placement = new HandPlacementView();
  private readonly placementFrame = createPlacementFrame();
  readonly buildOverlays = new BuildOverlays();
  private readonly buildingFrame = createBuildingFrame();
  /** The placed stations (M4-05, M4-06) and the burning tiles (M4-28). */
  readonly stations = new StationView();
  readonly fire = new FireView();
  private readonly stationFrame = createStationFrame();
  private readonly fireFrame = createFireFrame();
  /** Lightning, the Lumen rain's shooting stars, shards and meteorite (M7-38 … M7-40, strand B). */
  private readonly worldEvents = new WorldEventView();
  private readonly ghostFrame = createGhostFrame();
  private readonly buildOverlayFrame = createBuildOverlayFrame();
  private readonly t: Translate | null;
  /** The word a parry shows over the guard, looked up when a parry happens (M6-05). */
  private readonly parryWord = (): string => this.t?.('ui.combat.feedback.parade') ?? '';
  /** Short texts of the ghost's refusal reasons in the language of `reasonLang` (translated once). */
  private readonly reasonLabels = new Map<string, string>();
  private reasonLang = '';
  private deathSystem: { sim: Simulation; death: DeathSystem | null } | null = null;
  private readonly lightFrame = createLightFrame();
  /** Weather particles, lightning, sparks and smoke of the player's fires (particle strand, M5-12, M5-21). */
  readonly particles = new ParticleSceneFiller();
  /** Wind, wetness, snow, foliage blend, grass push, footprints and fireflies of the world surface (M5-17 … M5-23). */
  readonly surface = new SurfaceSceneFiller();
  /** Water tiles, sky, wave impulses and the player's immersion mask (M5-07 … M5-09). */
  readonly water = new WaterSceneFiller(this.signatures);
  private readonly surfaceView = new SurfaceView();
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
  /** Half the view's width and height [px] (kept with the view size). */
  private halfViewW = MAX_VIEW.w / 2;
  private halfViewH = MAX_VIEW.h / 2;
  /**
   * How far from the camera the sky's occluders are gathered [whole px]: the occluder ring's reach – half the view and
   * `OCCLUDER_RING.reachPx` sideways and north, the height range more south (M5 review M2) – and at least the pushed
   * rectangle. Kept with the view size (§30: whole numbers, no float computed again per frame).
   */
  private skyReachX = skyReach(MAX_VIEW.w / 2, PUSH_LEFT);
  private skyReachTop = skyReach(MAX_VIEW.h / 2, PUSH_TOP);
  private skyReachBottom = skyReach(MAX_VIEW.h / 2 + GBUFFER_HEIGHT_RANGE_PX, PUSH_BOTTOM);
  /**
   * How far from the camera objects are gathered on each side [whole px]: the pushed rectangle, widened by the sun's
   * or moon's casters beyond the view whose shadows fall into it (M5 review Minor 1). Computed again only when the
   * shadow vector (`castersFor`; the sky changes it at most once per game minute) or the view size changes.
   */
  private objectLeft = PUSH_LEFT;
  private objectRight = PUSH_LEFT;
  private objectTop = PUSH_TOP;
  private objectBottom = PUSH_BOTTOM;
  private readonly casters: CasterReach = { left: 0, top: 0, right: 0, bottom: 0 };
  /** The sky's directed light the object reach holds for (its record's version, −1: none shines; −2: none yet or the view changed). */
  private castersVersion = -2;
  private scene: RenderScene | null = null;
  private savedEnv: RenderEnvironment | null = null;
  private readonly weather: WeatherSample = createWeatherSample();
  /** The environment of the last computation (`environment`) and the simulation, tick, layer and weather region it holds for. */
  private readonly envValues = new Float64Array(ENV_VALUES);
  private envSim: Simulation | null = null;
  private envTick = -1;
  private envLayer = -1;
  private envRegion = NO_WEATHER_REGION;
  /**
   * Counts the environment's computations and the times the scene's record was written by someone else (the dark
   * environment, another scene, a scene switch); `envWritten` is the count the record holds (§30: a frame between two
   * ticks – and every frame of a still picture – writes nothing).
   */
  private envVersion = 0;
  private envWritten = -1;
  /** The ambient strength is below `HAND_LIGHT_BELOW` (a debug mover lights its hand light; kept with the environment). */
  private handLight = false;
  /**
   * Camera and figure of the last frame whose rectangles were computed (`fill`), and whether something else they depend
   * on changed since (the object reach, the view size, another scene record): a still frame computes none of them –
   * the records they went into keep them.
   */
  private readonly frameKey = new FloatKey(KEY_SLOTS);
  private rectsDirty = true;
  /** The sky filler's view: the tile rectangle of its occluders around the camera [whole world px]. */
  private readonly skyView: { layer: Layer; left: number; top: number; right: number; bottom: number; readonly chunks: ChunkLookup; readonly signatures: ChunkSignatures } & SkyView;
  /** The atlas the figure's box was measured in (`figureBoxOf`). */
  private figureBoxManifest: AtlasManifest | null = null;
  private readonly overlayView = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly view: { layer: Layer; readonly chunks: ChunkLookup; readonly signatures: ChunkSignatures; inWorld(cx: number, cy: number): boolean };
  private readonly objectView: ObjectView & { layer: Layer };
  private readonly overlayWorld: OverlayWorld & { layer: Layer; worldTiles: number; temperature: OverlayWorld['temperature']; sim: Simulation | null };

  constructor(
    private readonly gameAtlas: () => AtlasData | null,
    private readonly binding: () => GameWorldBinding | null,
    t: Translate | null = null,
  ) {
    this.gathering = new GatheringView(t);
    this.t = t;
    // Tiles as whole numbers all the way (a tile's centre as a float argument would be a new number per call, §30).
    const levelAt = (tx: number, ty: number): number => this.tileLevel(tx, ty);
    this.buildingFrame.levelAt = levelAt;
    this.ghostFrame.levelAt = levelAt;
    this.lightFrame.levelAt = levelAt;
    this.graves.levelAt = levelAt;
    this.farmFrame.levelAt = levelAt;
    this.fishingFrame.levelAt = levelAt;
    this.bossFrame.levelAt = levelAt;
    this.beaconFrame.levelAt = levelAt;
    this.gathering.drops.levelAt = levelAt;
    this.creatureFrame.levelAt = levelAt;
    this.creatureFrame.waterAt = (tx, ty) => this.waterAt(tx, ty);
    this.combatFrame.levelAt = levelAt;
    this.ghostFrame.reasonLabel = (reason) => this.reasonLabel(reason);
    this.placementFrame.levelAt = levelAt;
    this.placementFrame.reasonLabel = (reason) => this.reasonLabel(reason);
    this.buildOverlayFrame.t = (key, params) => this.t?.(key, params) ?? key;
    const host = (): WorldHost | null => this.binding()?.host ?? null;
    const lookup: ChunkLookup = { get: (layer, cx, cy) => host()?.get(layer, cx, cy) };
    this.view = { layer: 0, chunks: lookup, signatures: this.signatures, inWorld: (cx, cy) => host()?.inWorld(cx, cy) ?? false };
    this.skyView = { layer: 0, chunks: lookup, signatures: this.signatures, left: 0, top: 0, right: 0, bottom: 0 };
    this.objectView = { layer: 0, chunks: lookup, signatures: this.signatures, left: 0, top: 0, right: 0, bottom: 0, fadeX: 0, fadeY: 0, fadeRadius: 0 };
    // The field and fishing frames read the object rectangle, the figure and its hand by reference (strand D, M7-19 … M7-24).
    this.farmFrame.view = this.objectView;
    this.fishingFrame.view = this.objectView;
    this.fishingFrame.figure = this.player.drawn;
    this.fishingFrame.hand = this.player.lastCombat.weaponHead;
    this.overlayWorld = {
      layer: 0,
      worldTiles: 0,
      temperature: null,
      sim: null,
      t,
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
      this.halfViewW = width / 2;
      this.halfViewH = height / 2;
      this.skyReachX = skyReach(width / 2, PUSH_LEFT);
      this.skyReachTop = skyReach(height / 2, PUSH_TOP);
      this.skyReachBottom = skyReach(height / 2 + GBUFFER_HEIGHT_RANGE_PX, PUSH_BOTTOM);
      this.castersVersion = -2;
      this.rectsDirty = true;
    }
  }

  /**
   * The object reach for the sky's directed light `version` (≥ 0: the version of its record `d`, whose shadow vector
   * counts; −1: none, the pushed rectangle): casters pushed against the shadow direction by the drawn shadow of the tallest
   * object, counted from the view – not the pushed rectangle, sized for the widest view – so only what the view's width
   * leaves out is added.
   */
  private reachCasters(version: number, d: Readonly<DirectionalLight>): void {
    const c = this.casters;
    this.castersVersion = version;
    this.rectsDirty = true;
    if (version >= 0) casterReach(d.shadowX, d.shadowY, d.shadowLength, OBJECT_REACH_PX, c);
    else {
      c.left = 0;
      c.top = 0;
      c.right = 0;
      c.bottom = 0;
    }
    this.objectLeft = Math.max(PUSH_LEFT, Math.ceil(this.halfViewW + c.left));
    this.objectRight = Math.max(PUSH_LEFT, Math.ceil(this.halfViewW + c.right));
    this.objectTop = Math.max(PUSH_TOP, Math.ceil(this.halfViewH + c.top));
    this.objectBottom = Math.max(PUSH_BOTTOM, Math.ceil(this.halfViewH + c.bottom));
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
    this.surface.attach(renderer);
  }

  deactivate(renderer: Renderer): void {
    renderer.passes.remove(this.terrain.name);
    this.lights.detach(renderer);
    this.player.dispose();
    this.gathering.dispose();
    this.building.dispose();
    this.fx.dispose();
    this.creatures.dispose();
    this.combat.dispose();
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
    this.forgetFrame();
  }

  /** The scene's records were written by someone else: the next frame writes the environment and its rectangles afresh. */
  private forgetFrame(): void {
    this.envVersion++;
    this.rectsDirty = true;
    this.frameKey.reset();
  }

  /**
   * The world is there, the last frame showed it, every visible chunk is drawn with its mesh, and the see-through circle
   * around the figure stands (open under a crown or roof, shut otherwise: it irises open over several frames, M5-18).
   */
  ready(): boolean {
    return this.binding()?.host.state === 'bereit' && this.tables !== null && this.shown && this.terrain.complete && this.surface.irisAtRest(this.covering());
  }

  /** Crowns and roofs that covered the figure in the last frame (the see-through circle opens while > 0). */
  private covering(): number {
    return (this.objects?.stats.faded ?? 0) + this.building.stats.roofsInCircle;
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
      placement: { ...this.placement.stats },
      stations: { ...this.stations.stats },
      fire: { ...this.fire.stats },
      combat: { ...this.combat.info(), clip: this.player.clipAction, stage: this.player.combatPose.stage, aimAngle: this.player.lastCombat.aimAngle, handAngle: this.player.combatPose.handAngle, creaturesInDark: this.creatures.stats.inDark, creaturesFinster: this.creatures.stats.finster, creaturesImmersed: this.creatures.stats.immersed },
      building: this.buildingInfo(),
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
      this.savedEnv = scene.env.snapshot();
      this.forgetFrame();
      enterAtmosphere(scene);
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
    const hasFigure = this.following;
    this.hasFigure = hasFigure;
    // Camera and figure in locals: every field is read once per frame (§30).
    let cameraX: number;
    let cameraY: number;
    let figureX = 0;
    let figureY = 0;
    if (hasFigure) {
      const focus = this.focus;
      figureX = focus.position[0] as number;
      figureY = focus.position[1] as number;
      this.figureX = figureX;
      this.figureY = figureY;
      this.layerValue = focus.layer;
      cameraX = figureX;
      cameraY = figureY - CAMERA_LIFT;
      // Strand F (M7-32): a boss fight frames boss and figure together (the boss's crown and markers stay in view).
      if (this.bosses.framing(sim, atlas.manifest, focus.layer, figureX, figureY, sim.tick, binding.session, time, this.bossShift)) {
        cameraX += this.bossShift.x;
        cameraY += this.bossShift.y;
      }
    } else {
      this.layerValue = this.freeLayer;
      cameraX = this.freeX;
      cameraY = this.freeY;
      this.lastFigureX = NAN;
      figureX = this.figureX;
      figureY = this.figureY;
    }
    this.cameraX = cameraX;
    this.cameraY = cameraY;
    // Whether camera or figure moved (their bits): a still frame keeps every rectangle computed from them (§30).
    const key = this.frameKey;
    key.set(KEY_CAMERA_X, cameraX).set(KEY_CAMERA_Y, cameraY).set(KEY_FIGURE_X, figureX).set(KEY_FIGURE_Y, figureY).set(KEY_FOLLOWING, hasFigure ? 1 : 0);
    const moved = key.changed();
    if (moved && hasFigure) this.updateFacing(figureX, figureY);
    const layer = this.layerValue;
    this.view.layer = layer;
    this.objectView.layer = layer;
    this.environment(scene.env, binding, cameraX, cameraY);
    const surfaceView = this.surfaceView;
    if (moved || this.rectsDirty) surfaceView.set(layer, cameraX, cameraY, this.viewW, this.viewH, hasFigure, figureX, figureY, time, this.covering());
    else surfaceView.frame(layer, time, this.covering());
    this.surface.fill(scene, sim, atlas, surfaceView);
    // The camera's pixel (whole numbers from here: chunks and tiles by shifting, §30).
    const cameraPxX = Math.floor(cameraX);
    const cameraPxY = Math.floor(cameraY);
    binding.host.update(layer, cameraPxX >> CHUNK_PX_SHIFT, cameraPxY >> CHUNK_PX_SHIFT);
    this.signatures.beginFrame();
    this.terrain.setWorld(atlas, tables, this.view as TerrainView);
    // The fight's screenshake moves the picture by whole pixels (M6-05; the setting scales it, 0 = none).
    this.combat.follow(binding.session, this.parryWord);
    const alpha = binding.session.renderAlpha;
    const shake = this.combat.shakeOffset(sim, alpha, binding.screenshake?.() ?? 1);
    const shakeX = shake.x;
    const shakeY = shake.y;
    // No shake (almost every frame): the camera's own numbers, no sum is formed.
    if (shakeX === 0 && shakeY === 0) scene.camera.set(cameraX, cameraY).unfollow();
    else scene.camera.set(cameraX + shakeX, cameraY + shakeY).unfollow();
    const v = this.objectView;
    // The sky's occluders reach the occluder ring around the view: the walls and cliffs between the view and the lights
    // beside it (M5 review M2). Whole pixels: the camera's pixel and whole reaches give the same tiles as the float
    // rectangle around the camera.
    const sv = this.skyView;
    sv.layer = layer;
    sv.left = cameraPxX - this.skyReachX;
    sv.right = cameraPxX + this.skyReachX;
    sv.top = cameraPxY - this.skyReachTop;
    sv.bottom = cameraPxY + this.skyReachBottom;
    this.sky.fill(scene, sim, sv, cameraX, cameraY, time, worldDimensions(world.preset).tiles);
    this.sky.ambient(scene.env, this.envValues, ENV_AMBIENT_R, this.envVersion, layer, cameraPxX >> TILE_SHIFT, cameraPxY >> TILE_SHIFT);
    // Casters beside the view whose sun or moon shadow falls into it (M5 review Minor 1): the object reach follows the
    // sky's directed light, computed again only when it was written (its version; −1: none shines).
    const directional = scene.sky.directional;
    const direction = directional.shines ? directional.version : -1;
    if (direction !== this.castersVersion) this.reachCasters(direction, directional);
    const cf = this.creatureFrame;
    const lf = this.lightFrame;
    if (moved || this.rectsDirty) {
      // The canopy fade around the figure and the pushed rectangle into the scene, the object view and the frames of
      // creatures, lights, building, stations and fire (they keep them while camera and figure stand).
      const fadeX = hasFigure ? figureX : 0;
      const fadeY = hasFigure ? figureY - CANOPY_FADE.lift : 0;
      const fadeRadius = hasFigure ? CANOPY_FADE.radius : 0;
      v.fadeX = fadeX;
      v.fadeY = fadeY;
      v.fadeRadius = fadeRadius;
      scene.fadeX = fadeX;
      scene.fadeY = fadeY;
      scene.fadeRadius = fadeRadius;
      const left = cameraX - this.objectLeft;
      const right = cameraX + this.objectRight;
      const top = cameraY - this.objectTop;
      const bottom = cameraY + this.objectBottom;
      v.left = left;
      v.right = right;
      v.top = top;
      v.bottom = bottom;
      cf.left = left;
      cf.top = top;
      cf.right = right;
      cf.bottom = bottom;
      lf.left = left;
      lf.top = top;
      lf.right = right;
      lf.bottom = bottom;
      this.frameRects(left, top, right, bottom, fadeX, fadeY, fadeRadius);
      this.rectsDirty = false;
    }
    const objects = this.objects;
    const g = this.gatherFrame;
    g.layer = layer;
    g.cameraX = cameraX;
    g.cameraY = cameraY;
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
    this.building.follow(binding.session);
    this.fx.beginFrame();
    this.player.onClipEvent(binding.onClipEvent ?? null);
    if (hasFigure) this.placeFigure(scene, atlas, time, binding.session, figureX, figureY);
    this.fx.drawBursts(scene, atlas.manifest, layer, time);
    g.figure = hasFigure ? this.figureBoxOf(atlas.manifest, figureX, figureY, moved) : null;
    if (gathering) this.gathering.draw(scene, atlas, tables, binding.session, g, time, season);
    // The interaction's use target (a fire, a torch, a grave) carries the outline.
    const focus = this.gathering.lastFocus;
    const useTx = gathering && focus.kind === 'use' && focus.layer === layer ? focus.tx : -1;
    const useTy = gathering && focus.kind === 'use' && focus.layer === layer ? focus.ty : -1;
    const death = this.deathOf(sim);
    if (death !== null) this.graves.draw(scene, atlas, death, layer, time, useTx, useTy);
    this.drawFeld(scene, atlas, binding.session, layer, time, hasFigure);
    this.drawLeuchtfeuer(scene, atlas, binding.session, layer, time, alpha, useTx, useTy, cameraPxX, cameraPxY);
    cf.layer = layer;
    cf.time = time;
    cf.alpha = alpha;
    cf.focusTx = useTx;
    cf.focusTy = useTy;
    this.creatures.follow(binding.session);
    this.creatures.draw(scene, atlas, sim, cf);
    // A trap in the hand: its preview where the primary button would set it up (not in build mode, whose button that is).
    const pf = this.placementFrame;
    pf.layer = layer;
    pf.building = binding.build?.active === true;
    this.placement.draw(scene, atlas, sim, pf, scene.debugOverlay);
    const kf = this.combatFrame;
    kf.layer = layer;
    kf.alpha = alpha;
    kf.damageNumbers = binding.damageNumbers?.() ?? true;
    kf.combat = hasFigure && this.player.lastCombat.present ? this.player.lastCombat : null;
    const drawn = this.player.drawn;
    kf.figureX = drawn.x;
    kf.figureY = drawn.y;
    kf.figureHeight = drawn.heightBase;
    this.combat.draw(scene, atlas, sim, kf);
    this.buildingFrame.focusTx = useTx;
    this.buildingFrame.focusTy = useTy;
    this.frameLayers(layer);
    this.drawBuilding(scene, atlas, binding, time, cameraX, cameraY, figureX, figureY);
    lf.layer = layer;
    lf.time = time;
    lf.hasFigure = hasFigure;
    lf.figureX = figureX;
    lf.figureY = figureY;
    lf.focusTx = useTx;
    lf.focusTy = useTy;
    this.lights.fill(scene, atlas, sim, lf);
    // Graves, build grid, stations and placed lights are pushed: the marker over a use target stands on its top (M5-65).
    if (gathering) this.gathering.liftUseMarker(scene, atlas);
    this.water.fill(scene, binding, hasFigure ? this.player : null, layer, cameraX, cameraY, this.viewW, this.viewH, time);
    // Creatures swimming or wading take the immersion mask's places the player left (ADR-0168).
    this.creatures.immerse(scene.water);
    this.particles.fill(scene, sim, layer, cameraX, cameraY, hasFigure, figureX, figureY);
    fillAtmosphere(scene, binding, layer, cameraX, cameraY, this.viewW, this.viewH, time);
    this.worldEvents.follow(binding.session);
    this.worldEvents.draw(scene, atlas, binding.session, layer, time, sim.tick, sim.clock.tickHz, cameraX - this.viewW / 2, cameraY - this.viewH / 2, this.viewW, this.viewH);
    if (this.overlays.any) {
      const ow = this.overlayWorld;
      ow.layer = layer;
      ow.worldTiles = worldDimensions(world.preset).tiles;
      // Reading the temperature field builds the plan stage from the handed-in world if the first world tick has not yet (state neutral).
      ow.temperature = sim.world.materialized ? sim.world.temperature : null;
      ow.sim = sim;
      const ov = this.overlayView;
      ov.left = Math.floor(this.cameraX - this.viewW / 2);
      ov.right = ov.left + this.viewW;
      ov.top = Math.floor(this.cameraY - this.viewH / 2);
      ov.bottom = ov.top + this.viewH;
      this.overlays.fill(scene.debugOverlay, ov, ow);
    } else this.overlays.idle(sim);
  }

  /**
   * Writes the frame's pushed rectangle and canopy fade into the building, station and fire frames (`fill`'s locals: no
   * field is read; only when camera or figure moved – the frames keep them).
   */
  private frameRects(left: number, top: number, right: number, bottom: number, fadeX: number, fadeY: number, fadeRadius: number): void {
    const bf = this.buildingFrame;
    const sf = this.stationFrame;
    const ff = this.fireFrame;
    bf.left = left;
    bf.top = top;
    bf.right = right;
    bf.bottom = bottom;
    bf.fadeX = fadeX;
    bf.fadeY = fadeY;
    bf.fadeRadius = fadeRadius;
    sf.left = left;
    sf.top = top;
    sf.right = right;
    sf.bottom = bottom;
    ff.left = left;
    ff.top = top;
    ff.right = right;
    ff.bottom = bottom;
  }

  /** Writes the frame's layer into the building, station and fire frames. */
  private frameLayers(layer: Layer): void {
    this.buildingFrame.layer = layer;
    this.stationFrame.layer = layer;
    this.fireFrame.layer = layer;
  }

  /**
   * The build grid, and in build mode the ghost and the overlay (M4-13, M4-22 … M4-27). The frame's camera and figure
   * come as arguments; `frameRects` wrote the pushed rectangle and the fade (§30: no field is read back).
   */
  private drawBuilding(scene: RenderScene, atlas: AtlasData, binding: GameWorldBinding, time: number, cameraX: number, cameraY: number, figureX: number, figureY: number): void {
    const sim = binding.session.sim;
    const bf = this.buildingFrame;
    const layer = this.layerValue;
    bf.time = time;
    bf.hasFigure = this.hasFigure;
    bf.figureX = figureX;
    bf.figureY = figureY;
    bf.instant = binding.reducedMotion?.() ?? false;
    const ghost = binding.build;
    bf.roofVeil = ghost !== undefined && ghost.active && ghost.overlay !== null ? BUILD_OVERLAY_ROOF_VEIL : 0;
    this.building.draw(scene, atlas, sim, bf);
    this.drawStationsAndFire(scene, atlas, sim, time);
    if (ghost === undefined) return;
    const lang = binding.lang?.() ?? 'de';
    if (lang !== this.reasonLang) {
      this.reasonLabels.clear();
      this.reasonLang = lang;
    }
    const gf = this.ghostFrame;
    gf.layer = layer;
    gf.cameraX = cameraX;
    gf.cameraY = cameraY;
    gf.viewW = this.viewW;
    gf.viewH = this.viewH;
    gf.hasFigure = this.hasFigure;
    gf.figureX = figureX;
    gf.figureY = figureY;
    gf.time = time;
    this.ghost.update(sim, binding.session.input.mouse, gf, ghost);
    this.ghost.draw(scene, atlas, sim, gf, ghost, scene.debugOverlay);
    const kind = ghost.active ? ghost.overlay : null;
    if (kind === null) return;
    const of = this.buildOverlayFrame;
    of.layer = layer;
    of.left = Math.floor(cameraX - this.viewW / 2);
    of.right = of.left + this.viewW;
    of.top = Math.floor(cameraY - this.viewH / 2);
    of.bottom = of.top + this.viewH;
    of.lang = lang;
    this.buildOverlays.fill(scene.debugOverlay, sim, kind, of);
  }

  /**
   * The placed stations and the flames of burning tiles, in the pushed rectangle of the building view (M4-05 … M4-28;
   * `drawBuilding` wrote the rectangle and layer into both frames).
   */
  private drawStationsAndFire(scene: RenderScene, atlas: AtlasData, sim: Simulation, time: number): void {
    const bf = this.buildingFrame;
    const sf = this.stationFrame;
    sf.time = time;
    sf.focusTx = bf.focusTx;
    sf.focusTy = bf.focusTy;
    sf.levelAt = bf.levelAt;
    this.stations.draw(scene, atlas, sim, sf);
    const ff = this.fireFrame;
    ff.time = time;
    ff.levelAt = bf.levelAt;
    this.fire.draw(scene, atlas, sim, ff, this.tables, this.building.interior);
  }

  /** The short text of a refusal reason over the ghost (`ui.bau.grund.*`), or null without translations. */
  private reasonLabel(reason: string): string | null {
    if (this.t === null) return null;
    let label = this.reasonLabels.get(reason);
    if (label === undefined) {
      label = this.t(`ui.bau.grund.${reason}`);
      this.reasonLabels.set(reason, label);
    }
    return label;
  }

  /** What `info()` reports of the build grid. */
  private buildingInfo(): GameViewInfo['building'] {
    const b = this.building.stats;
    const ghost = this.binding()?.build ?? null;
    const o = this.buildOverlays.stats;
    return {
      pieces: b.pieces,
      blueprints: b.blueprints,
      roofs: b.roofs,
      roofsInCircle: b.roofsInCircle,
      cutWalls: b.cutWalls,
      roofFade: b.roofFade,
      roofTiles: b.roofTiles,
      inside: b.inside,
      missing: b.missing,
      ghost: {
        active: ghost?.active ?? false,
        piece: ghost?.piece ?? null,
        cursor: ghost !== null && ghost.cursorValid ? [ghost.cursorTx, ghost.cursorTy] : null,
        anchors: ghost === null ? 0 : ghost.plan.length / 2,
        ok: ghost?.okCount ?? 0,
        reason: ghost?.firstReason ?? null,
        drawn: this.ghost.drawn,
      },
      overlay: { kind: ghost?.active === true ? ghost.overlay : null, tiles: o.tiles, rooms: o.rooms, labels: o.labels },
    };
  }

  /** Before the world is there: the background colour only. */
  private darkEnvironment(env: RenderEnvironment): void {
    env.background = BACKGROUND_INDEX;
    env.fog = 0;
    env.wetness = 0;
    env.wind = 0;
    env.weatherLight = 1;
    setAmbient(env, DAYLIGHT, 1);
    this.ambientValue = 1;
    this.handLight = false;
    // The record now holds these: the world's environment is written afresh once it is there.
    this.envVersion++;
  }

  /**
   * Wind, wetness, daytime and the ambient's strength from calendar and weather at the camera (`cameraX`, `cameraY`) into
   * `env`; the ambient's colour goes in with the sky's night tint (`SkySceneFiller.ambient`, from `envValues`). Computed
   * again only when the simulation moved on a tick, the layer or the weather region at the camera changed, and written
   * only after a computation or when someone else wrote the record (§30: a frame in between – and every frame of a still
   * picture – writes nothing: the record keeps the values). The fog is the atmosphere's (`fillAtmosphere`, every frame).
   */
  private environment(env: RenderEnvironment, binding: GameWorldBinding, cameraX: number, cameraY: number): void {
    const sim = binding.session.sim;
    const layer = this.layerValue;
    const region = layer !== 0 ? NO_WEATHER_REGION : sim.world.materialized ? sim.world.regionAt(Math.floor(cameraX) >> TILE_SHIFT, Math.floor(cameraY) >> TILE_SHIFT) : ENV_UNMATERIALIZED;
    const v = this.envValues;
    if (sim !== this.envSim || sim.tick !== this.envTick || layer !== this.envLayer || region !== this.envRegion) {
      this.envSim = sim;
      this.envTick = sim.tick;
      this.envLayer = layer;
      this.envRegion = region;
      this.computeEnvironment(sim, layer, region, v);
      this.envVersion++;
    }
    if (this.envWritten === this.envVersion) return;
    this.envWritten = this.envVersion;
    env.background = BACKGROUND_INDEX;
    env.dayFraction = v[ENV_DAY_FRACTION] as number;
    const intensity = v[ENV_INTENSITY] as number;
    env.ambientIntensity = intensity;
    env.weatherLight = v[ENV_WEATHER_LIGHT] as number;
    env.wind = v[ENV_WIND] as number;
    env.wetness = v[ENV_WETNESS] as number;
    this.ambientValue = intensity;
    this.handLight = !(intensity >= HAND_LIGHT_BELOW);
    this.creatureFrame.ambient = intensity;
    this.buildingFrame.ambient = intensity;
  }

  /** The environment values (`ENV_*`) of `layer` under the weather of `region` into `out`. */
  private computeEnvironment(sim: Simulation, layer: Layer, region: number, out: Float64Array): void {
    const cal = sim.world.calendar;
    out[ENV_DAY_FRACTION] = sim.clock.dayFraction;
    if (layer !== 0) {
      out[ENV_AMBIENT_R] = CAVE_AMBIENT[0];
      out[ENV_AMBIENT_G] = CAVE_AMBIENT[1];
      out[ENV_AMBIENT_B] = CAVE_AMBIENT[2];
      out[ENV_INTENSITY] = CAVE_AMBIENT_INTENSITY;
      out[ENV_WIND] = 0;
      out[ENV_WETNESS] = 0;
      out[ENV_WEATHER_LIGHT] = 1;
      return;
    }
    const d = cal.daylight;
    const night = NIGHT_BASE + NIGHT_FULL_MOON * cal.moonIllumination;
    let light = 1;
    let wind = 0;
    let wet = 0;
    if (region >= 0) {
      const w = sim.world.weather.sample(region, this.weather);
      light = w.lightFactor;
      wind = w.wind;
      wet = w.precipitationKind === 'regen' ? w.precipitation : 0;
    }
    out[ENV_AMBIENT_R] = MOON_R + DAY_MINUS_MOON_R * d;
    out[ENV_AMBIENT_G] = MOON_G + DAY_MINUS_MOON_G * d;
    out[ENV_AMBIENT_B] = MOON_B + DAY_MINUS_MOON_B * d;
    out[ENV_INTENSITY] = (night + (1 - night) * d) * light;
    out[ENV_WIND] = wind * WIND_SCALE;
    out[ENV_WETNESS] = wet;
    out[ENV_WEATHER_LIGHT] = light;
  }

  /** Facing of the figure at (`x`, `y`) from its movement since the last frame (kept while it stands). */
  private updateFacing(x: number, y: number): void {
    const lastX = this.lastFigureX;
    const lastY = this.lastFigureY;
    this.lastFigureX = x;
    this.lastFigureY = y;
    // A figure standing where it stood (every frame of a still picture) changes nothing: no difference is formed.
    if (x === lastX && y === lastY) return;
    const dx = x - lastX;
    const dy = y - lastY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    if (ax < FACING_EPSILON && ay < FACING_EPSILON) return;
    this.facing = ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
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

  /**
   * The opaque box [world px] of the figure at (`x`, `y`) (the sprite's bounds around its anchor), or null without the
   * sprite; measured again only when the figure `moved` or the atlas changed (the record keeps it).
   */
  private figureBoxOf(m: AtlasManifest, x: number, y: number, moved: boolean): { left: number; top: number; right: number; bottom: number } | null {
    const s = m.sprites[FIGURE_SPRITE];
    const f = s?.frames[0];
    if (s === undefined || f === undefined) {
      this.figureBoxManifest = null;
      return null;
    }
    if (!moved && m === this.figureBoxManifest) return this.figureBox;
    this.figureBoxManifest = m;
    const bounds = s.bounds;
    const left = x + ((bounds?.x ?? 0) - f.ax);
    const top = y + ((bounds?.y ?? 0) - f.ay);
    const b = this.figureBox;
    // Whole world px, snapped like the sprite's anchor (`WorldUiBox`: the world-UI pass shifts it with integers only).
    b.left = Math.floor(left + 0.5);
    b.top = Math.floor(top + 0.5);
    b.right = Math.floor(left + (bounds?.w ?? s.size[0]) + 0.5);
    b.bottom = Math.floor(top + (bounds?.h ?? s.size[1]) + 0.5);
    return b;
  }

  private placeFigure(scene: RenderScene, atlas: AtlasData, time: number, session: GameWorldBinding['session'], figureX: number, figureY: number): void {
    const m = atlas.manifest;
    if (m.sprites[FIGURE_SPRITE] === undefined) return;
    const isPlayer = this.player.place(scene, atlas, session, time, figureX, figureY);
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
      d.x = figureX;
      d.y = figureY;
      d.heightBase = this.levelAt(figureX, figureY) * WAND_PX_JE_STUFE;
      scene.sprites.push(d);
    }
    // The player's light is the simulation's (its torch, `this.lights`); a debug mover of M2 carries the stand-in.
    if (isPlayer || !this.handLight) return;
    const l = scene.light.reset();
    l.x = figureX + HAND_LIGHT.lift;
    l.y = figureY;
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
    return this.tileLevel(Math.floor(x) >> TILE_SHIFT, Math.floor(y) >> TILE_SHIFT);
  }

  /** The fields and fishing of strand D (M7-19 … M7-24) in the frame's object rectangle; the figure holds the rod. */
  private drawFeld(scene: RenderScene, atlas: AtlasData, session: Partial<FeldSession>, layer: Layer, time: number, hasFigure: boolean): void {
    if (!isFeldSession(session)) return;
    // The object rectangle, the figure and its hand are read by reference (the frames hold them since construction).
    const ff = this.farmFrame;
    ff.layer = layer;
    ff.time = time;
    this.farm.draw(scene, atlas, session, ff);
    const fi = this.fishingFrame;
    fi.layer = layer;
    fi.time = time;
    fi.hasFigure = hasFigure;
    this.fishing.draw(scene, atlas, session, fi);
  }

  /** The bosses and the beacons of strand F (M7-32 … M7-35) in the frame's object rectangle. */
  private drawLeuchtfeuer(scene: RenderScene, atlas: AtlasData, session: GameWorldBinding['session'], layer: Layer, time: number, alpha: number, useTx: number, useTy: number, pxX: number, pxY: number): void {
    const sim = session.sim;
    // The pushed rectangle in whole px and tiles from the camera's pixel (integers: §30, a frame without a boss or beacon in
    // view forms no number); the views form tick + fraction themselves when they need it.
    const left = pxX - this.objectLeft;
    const right = pxX + this.objectRight;
    const top = pxY - this.objectTop;
    const bottom = pxY + this.objectBottom;
    const bf = this.bossFrame;
    bf.layer = layer;
    bf.left = left;
    bf.top = top;
    bf.right = right;
    bf.bottom = bottom;
    bf.tileLeft = left >> TILE_SHIFT;
    bf.tileTop = top >> TILE_SHIFT;
    bf.tileRight = right >> TILE_SHIFT;
    bf.tileBottom = bottom >> TILE_SHIFT;
    bf.time = time;
    bf.tick = sim.tick;
    bf.alpha = alpha;
    this.bosses.follow(session);
    this.bosses.draw(scene, atlas, sim, bf);
    const cf = this.beaconFrame;
    cf.layer = layer;
    cf.left = left;
    cf.top = top;
    cf.right = right;
    cf.bottom = bottom;
    cf.tileLeft = bf.tileLeft;
    cf.tileTop = bf.tileTop;
    cf.tileRight = bf.tileRight;
    cf.tileBottom = bf.tileBottom;
    cf.time = time;
    cf.tick = bf.tick;
    cf.alpha = alpha;
    cf.focusTx = useTx;
    cf.focusTy = useTy;
    this.beacons.draw(scene, atlas, sim, cf);
  }

  /** Height level of tile (tx, ty) on the view's layer (surface only). */
  private tileLevel(tx: number, ty: number): number {
    if (this.layerValue !== 0) return 0;
    const c = this.view.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return c === undefined ? 0 : (c.height[(ty - c.cy * CHUNK_TILES) * CHUNK_TILES + (tx - c.cx * CHUNK_TILES)] as number);
  }

  /** Open water on tile (tx, ty) of the view's layer: 0 none (land, frozen, not loaded), 1 shallow, 2 deep (like `waterScene.ts`). */
  private waterAt(tx: number, ty: number): number {
    const c = this.view.chunks.get(this.layerValue, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (c === undefined) return 0;
    const w = c.water[(ty - c.cy * CHUNK_TILES) * CHUNK_TILES + (tx - c.cx * CHUNK_TILES)] ?? 0;
    if ((w & WATER_FROZEN) !== 0) return 0;
    const depth = w & WATER_DEPTH_MASK;
    return depth === WATER_DEPTH_DEEP ? 2 : depth !== 0 ? 1 : 0;
  }
}
