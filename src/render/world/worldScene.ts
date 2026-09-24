/**
 * World debug scenes (M2-28, §31.5): the generated world as the game will show it – streamed chunks
 * with autotiled ground, cliffs in height levels, water, y-sorted vegetation and objects – under a
 * free debug camera. Fixed seed (`WORLD_SCENE_SEED`), frozen presentation time, fixed season.
 *
 * - `gruenhain-tag`, `frostkamm-tag`, `glutsand-tag`: daylight (palette colours exactly as painted),
 *   a light wind; the camera starts on the biome's showcase window (`showcase.ts`).
 * - `ebene-1-roh`: layer −1 raw – ambient light ≈ 0 (§6.2 "Höhlen: Umgebungslicht ≈ 0"), only a few
 *   standing torches and the glowing mushrooms light the mushroom grove.
 *
 * The player figure stands on the first free tile at the camera's start; it is the focus of the
 * canopy fade (crowns in front of it dither out around it). The debug camera pans freely
 * (`pan`, `moveTo`; arrow keys through the render runtime); the figure stays where it stands.
 */
import type { SeasonId } from '../../content/balance';
import { TILE_FLAG_CLIFF_EDGE, WATER_DEPTH_MASK } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import type { AnimationClip } from '../anim/animation';
import { FIRE, paletteLight, type Rgb } from '../light/lightColors';
import type { Renderer } from '../renderer';
import type { RenderEnvironment, RenderScene } from '../scene';
import { placeSprite, setAmbient } from '../scenes/kitTools';
import type { SceneSource } from '../scenes/sceneSource';
import { CHUNK_PX, CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { WorldObjectLayer, type ObjectView } from './objects';
import { caveShowcase, surfaceShowcase, type TileSpot } from './showcase';
import { ChunkSignatures } from './signature';
import { seasonIndex, WorldRenderTables } from './tables';
import { WORLD_TERRAIN_ORDER, WorldTerrainRenderer, type TerrainView } from './terrainPass';
import type { WorldHost } from './worldHost';
import { WAND_PX_JE_STUFE } from '../../world/autotile';

/** The world debug scenes. */
export const WORLD_SCENE_IDS = ['gruenhain-tag', 'frostkamm-tag', 'glutsand-tag', 'ebene-1-roh'] as const;
export type WorldSceneId = (typeof WORLD_SCENE_IDS)[number];

export interface WorldScenePreset {
  readonly layer: Layer;
  /** Biome of the showcase window (surface); null = the showcase cavern of the layer. */
  readonly biome: string | null;
  readonly season: SeasonId;
  readonly light: 'tag' | 'hoehle';
}

export const WORLD_SCENE_PRESETS: Readonly<Record<WorldSceneId, WorldScenePreset>> = {
  'gruenhain-tag': { layer: 0, biome: 'gruenhain', season: 'sommer', light: 'tag' },
  'frostkamm-tag': { layer: 0, biome: 'frostkamm', season: 'winter', light: 'tag' },
  'glutsand-tag': { layer: 0, biome: 'glutsand', season: 'sommer', light: 'tag' },
  'ebene-1-roh': { layer: -1, biome: null, season: 'sommer', light: 'hoehle' },
};

export function isWorldSceneId(id: string): id is WorldSceneId {
  return (WORLD_SCENE_IDS as readonly string[]).includes(id);
}

/** Daylight: white ambient at full strength – the palette colours exactly as painted. */
const DAYLIGHT: Rgb = [1, 1, 1];
/** Light wind of the day scenes (sign = direction) [px sway scale]. */
const DAY_WIND = 0.8;
/** Caves: the earthy dark of the Wurzelhöhlen (docs/ART.md §5 night colour `erde.0`), almost no ambient light. */
const CAVE_AMBIENT: Rgb = paletteLight('erde.0');
const CAVE_AMBIENT_INTENSITY = 0.04;
/** Palette index shown where nothing is drawn (outside the world): the darkest night colour. */
const BACKGROUND_INDEX = 1;
/** Standing torches of the cave scene: radius [px], colour, intensity, flicker (as the Grünhain torches, ADR-0019). */
const CAVE_TORCH = { radius: 112, color: FIRE, intensity: 2.4, flicker: 0.28 } as const;
/**
 * Torches around the cave showcase: along each ray (tile steps) the last free tile before the rock,
 * within the distance range [tiles] – they stand towards the cavern's edge and light its rock faces;
 * the range keeps them inside the 30 × 17 tile view.
 */
const TORCH_RAYS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const TORCH_DISTANCE = { min: 3, max: 7 } as const;
/** Largest distance from the figure to the rock face the cave scene shows [tiles] (within the chunks placed around it). */
const ROCK_SEARCH_TILES = 16;
/** Tiles east of the figure where the cave scene puts its first torch. */
const TORCH_BESIDE_FIGURE = 2;
/** Largest spiral radius searched for the figure's tile [tiles]. */
const FIGURE_SEARCH_TILES = 12;
/** Canopy fade circle around the figure: radius [px] and height of its centre above the feet [px]. */
export const CANOPY_FADE = { radius: 18, lift: 12 } as const;
/** Sprites the scene needs besides the world objects. */
const FIGURE_SPRITE = 'spieler_koerper';
const FIGURE_CLIP = 'idle_down';
const TORCH_SPRITE = 'fackel_stand';
const TORCH_CLIP = 'idle';
const TORCH_SOCKET = 'licht';
/** Width and height of the largest internal view (§4.2) plus the margin objects are pushed for [px]. */
const MAX_VIEW = { w: 640, h: 270, margin: TILE_PX * 2 } as const;
/** Tallest object sprite above its anchor [px] (trees up to 96 px, §4.4): objects that far below the view can reach into it. */
const OBJECT_REACH_PX = 96;

/** A point of the scene (world px). */
interface Placed {
  readonly x: number;
  readonly y: number;
}

/** What the debug extension `worldInfo` reports about a world scene. */
export interface WorldSceneInfo {
  readonly scene: string;
  readonly state: string;
  readonly error: string | null;
  readonly seed: number | null;
  readonly layer: Layer;
  readonly camera: readonly [number, number];
  readonly figure: readonly [number, number] | null;
  readonly torches: readonly (readonly [number, number])[];
  readonly resident: number;
  readonly loading: number;
  readonly terrain: Readonly<WorldTerrainRenderer['stats']>;
  readonly objects: Readonly<WorldObjectLayer['stats']>;
  readonly signaturesHashed: number;
  readonly generatedInMs: number;
  readonly mode: string;
}

export class WorldScene implements SceneSource {
  readonly terrain = new WorldTerrainRenderer();
  readonly signatures = new ChunkSignatures();
  private readonly preset: WorldScenePreset;
  private tables: WorldRenderTables | null = null;
  private objects: WorldObjectLayer | null = null;
  private tableError: string | null = null;
  private spot: TileSpot | null = null;
  private cameraX = 0;
  private cameraY = 0;
  private figure: Placed | null = null;
  private torches: Placed[] = [];
  private placed = false;
  private scene: RenderScene | null = null;
  private savedEnv: RenderEnvironment | null = null;
  private readonly view: TerrainView;
  private readonly objectView: ObjectView;

  constructor(
    readonly id: WorldSceneId,
    private readonly gameAtlas: () => AtlasData | null,
    private readonly host: WorldHost,
  ) {
    this.preset = WORLD_SCENE_PRESETS[id];
    this.view = { layer: this.preset.layer, chunks: host, signatures: this.signatures, inWorld: (cx, cy) => host.inWorld(cx, cy) };
    this.objectView = { layer: this.preset.layer, chunks: host, signatures: this.signatures, left: 0, top: 0, right: 0, bottom: 0, fadeX: 0, fadeY: 0, fadeRadius: 0 };
  }

  get layer(): Layer {
    return this.preset.layer;
  }

  /** Camera centre (world px). */
  get camera(): readonly [number, number] {
    return [this.cameraX, this.cameraY];
  }

  /** Moves the camera by (dx, dy) world px (debug camera). */
  pan(dx: number, dy: number): void {
    this.cameraX += dx;
    this.cameraY += dy;
  }

  /** Puts the camera centre on world px (x, y) (debug camera). */
  moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Welt-Kamera: (${x}, ${y}) ist keine Position`);
    this.cameraX = x;
    this.cameraY = y;
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

  /** The world is there, the camera placed and every visible chunk drawn with its mesh. */
  ready(): boolean {
    return this.host.state === 'bereit' && this.placed && this.terrain.complete && this.tables !== null;
  }

  info(): WorldSceneInfo {
    const m = this.host.manager;
    return {
      scene: this.id,
      state: this.tableError !== null ? 'fehler' : this.host.state,
      error: this.tableError ?? this.host.error,
      seed: this.host.world?.seed ?? null,
      layer: this.preset.layer,
      camera: [this.cameraX, this.cameraY],
      figure: this.figure === null ? null : [this.figure.x, this.figure.y],
      torches: this.torches.map((t) => [t.x, t.y] as const),
      resident: m?.residentCount ?? 0,
      loading: m?.loadingCount ?? 0,
      terrain: { ...this.terrain.stats },
      objects: { ...(this.objects?.stats ?? { pushed: 0, builds: 0, faded: 0 }) },
      signaturesHashed: this.signatures.hashedThisFrame,
      generatedInMs: this.host.generatedInMs,
      mode: this.host.mode,
    };
  }

  private environment(env: RenderEnvironment): void {
    env.background = BACKGROUND_INDEX;
    env.fog = 0;
    env.wetness = 0;
    if (this.preset.light === 'tag') {
      setAmbient(env, DAYLIGHT, 1);
      env.wind = DAY_WIND;
      env.dayFraction = 0.5;
    } else {
      setAmbient(env, CAVE_AMBIENT, CAVE_AMBIENT_INTENSITY);
      env.wind = 0;
      env.dayFraction = 0;
    }
  }

  private tablesFor(atlas: AtlasData): WorldRenderTables | null {
    if (this.tables?.manifest === atlas.manifest) return this.tables;
    try {
      this.tables = new WorldRenderTables(atlas.manifest);
      this.objects = new WorldObjectLayer(this.tables);
      this.objects.season = seasonIndex(this.preset.season);
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
    this.environment(scene.env);
    if (!scene.ground.includes(this.terrain)) scene.ground.push(this.terrain);
    const atlas = this.gameAtlas();
    scene.atlas = atlas;
    const tables = atlas === null ? null : this.tablesFor(atlas);
    // The world is generated once an atlas can draw it (an atlas without the world sprites draws nothing).
    if (tables !== null) this.host.start();
    const world = this.host.world;
    if (atlas === null || tables === null || world === null || this.host.state !== 'bereit') {
      this.terrain.setWorld(null, null, null);
      return;
    }
    if (this.spot === null) {
      this.spot = this.preset.biome !== null ? surfaceShowcase(world, this.preset.biome) : caveShowcase(world, this.preset.layer);
      this.cameraX = this.spot.tx * TILE_PX + TILE_PX / 2;
      this.cameraY = this.spot.ty * TILE_PX + TILE_PX / 2;
    }
    this.host.update(this.preset.layer, Math.floor(this.cameraX / CHUNK_PX), Math.floor(this.cameraY / CHUNK_PX));
    this.signatures.beginFrame();
    this.terrain.setWorld(atlas, tables, this.view);
    scene.camera.set(this.cameraX, this.cameraY).unfollow();
    if (!this.placed) this.place(this.spot);
    const v = this.objectView;
    v.left = this.cameraX - MAX_VIEW.w / 2 - MAX_VIEW.margin;
    v.right = this.cameraX + MAX_VIEW.w / 2 + MAX_VIEW.margin;
    v.top = this.cameraY - MAX_VIEW.h / 2 - MAX_VIEW.margin;
    v.bottom = this.cameraY + MAX_VIEW.h / 2 + MAX_VIEW.margin + OBJECT_REACH_PX;
    const figure = this.figure;
    v.fadeX = figure?.x ?? 0;
    v.fadeY = figure === null ? 0 : figure.y - CANOPY_FADE.lift;
    v.fadeRadius = figure === null ? 0 : CANOPY_FADE.radius;
    scene.fadeX = v.fadeX;
    scene.fadeY = v.fadeY;
    scene.fadeRadius = v.fadeRadius;
    this.objects?.emit(scene, v);
    this.placeCharacters(scene, atlas, time);
  }

  /** Figure and torches (once the chunks around the showcase are resident). */
  private place(spot: TileSpot): void {
    const layer = this.preset.layer;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.host.get(layer, Math.floor(spot.tx / CHUNK_TILES) + dx, Math.floor(spot.ty / CHUNK_TILES) + dy) === undefined) return;
      }
    }
    const free = this.findFree(spot.tx, spot.ty, 0, FIGURE_SEARCH_TILES);
    this.figure = free === null ? null : { x: free.tx * TILE_PX + TILE_PX / 2, y: free.ty * TILE_PX + TILE_PX - 1 };
    this.torches = [];
    if (this.preset.light === 'hoehle' && free !== null) this.placeCaveTorches(free);
    this.placed = true;
  }

  /**
   * The cave scene's torches: one beside the figure (the player stands in light), one at the foot of
   * the nearest rock face (the camera then shows figure and face), and one at the end of each diagonal
   * ray from the figure (the last free tile before rock, within the view).
   */
  private placeCaveTorches(figure: TileSpot): void {
    const put = (t: TileSpot | null): void => {
      if (t !== null) this.torches.push({ x: t.tx * TILE_PX + TILE_PX / 2, y: t.ty * TILE_PX + TILE_PX - 2 });
    };
    put(this.findFree(figure.tx + TORCH_BESIDE_FIGURE, figure.ty, 0, 1));
    const face = this.findRockFace(figure.tx, figure.ty, ROCK_SEARCH_TILES);
    if (face !== null) {
      // The torch stands on the floor at the foot of the face; the camera shows figure and face.
      put({ tx: face.tx, ty: face.ty + 1 });
      this.cameraX = ((figure.tx + face.tx) / 2) * TILE_PX + TILE_PX / 2;
      this.cameraY = ((figure.ty + face.ty) / 2) * TILE_PX + TILE_PX / 2;
    }
    for (const [rx, ry] of TORCH_RAYS) {
      let last: TileSpot | null = null;
      for (let d = 1; d <= TORCH_DISTANCE.max; d++) {
        const tx = figure.tx + rx * d;
        const ty = figure.ty + ry * d;
        if (this.standable(tx, ty)) {
          if (d >= TORCH_DISTANCE.min) last = { tx, ty };
        } else if (this.solidAt(tx, ty)) break;
      }
      put(last);
    }
  }

  /** Nearest rock face (solid tile over a free, standable floor tile) on rings around (tx, ty); null within `to` tiles none. */
  private findRockFace(tx: number, ty: number, to: number): TileSpot | null {
    for (let r = 1; r <= to; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (this.solidAt(x, y) && this.standable(x, y + 1)) return { tx: x, ty: y };
        }
      }
    }
    return null;
  }



  /** First standable tile on rings of growing radius around (tx, ty), in ring order. */
  private findFree(tx: number, ty: number, from: number, to: number): TileSpot | null {
    for (let r = from; r <= to; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.standable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }

  /** A dry, free, open tile away from cliff edges whose 3×3 neighbourhood shares its level. */
  private standable(tx: number, ty: number): boolean {
    const layer = this.preset.layer;
    let level = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        const c = this.host.get(layer, Math.floor(x / CHUNK_TILES), Math.floor(y / CHUNK_TILES));
        if (c === undefined) return false;
        const i = (y - c.cy * CHUNK_TILES) * CHUNK_TILES + (x - c.cx * CHUNK_TILES);
        if ((c.water[i] as number) & WATER_DEPTH_MASK || (c.solid[i] as number) !== 0) return false;
        if (level < 0) level = c.height[i] as number;
        else if (c.height[i] !== level) return false;
        if (dx === 0 && dy === 0 && ((c.object[i] as number) !== 0 || ((c.flags[i] as number) & TILE_FLAG_CLIFF_EDGE) !== 0)) return false;
      }
    }
    return true;
  }

  /** Whether (tx, ty) is solid rock (or not resident). */
  private solidAt(tx: number, ty: number): boolean {
    const c = this.host.get(this.preset.layer, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    return c === undefined || (c.solid[(ty - c.cy * CHUNK_TILES) * CHUNK_TILES + (tx - c.cx * CHUNK_TILES)] as number) !== 0;
  }

  private placeCharacters(scene: RenderScene, atlas: AtlasData, time: number): void {
    const m = atlas.manifest;
    const figure = this.figure;
    const level = figure === null ? 0 : this.levelAt(figure);
    if (figure !== null && m.sprites[FIGURE_SPRITE] !== undefined) {
      const sprite = atlasSprite(m, FIGURE_SPRITE);
      const clip: AnimationClip = spriteClip(sprite, FIGURE_CLIP);
      const d = scene.sprite.reset();
      d.frame = spriteFrame(sprite, clipFrameAt(clip, time));
      d.x = figure.x;
      d.y = figure.y;
      d.heightBase = level * WAND_PX_JE_STUFE;
      scene.sprites.push(d);
    }
    if (this.torches.length === 0 || m.sprites[TORCH_SPRITE] === undefined) return;
    const torch: AtlasSprite = atlasSprite(m, TORCH_SPRITE);
    const clip = spriteClip(torch, TORCH_CLIP);
    const socket = torch.sockets[TORCH_SOCKET]?.[0];
    const flame = socket === undefined || socket === null ? 0 : spriteFrame(torch, 0).ay - socket[1];
    for (let i = 0; i < this.torches.length; i++) {
      const t = this.torches[i] as Placed;
      placeSprite(scene, torch, clipFrameAt(clip, time + i), t.x, t.y);
      const l = scene.light.reset();
      l.x = t.x;
      l.y = t.y;
      l.height = flame;
      l.radius = CAVE_TORCH.radius;
      l.r = CAVE_TORCH.color[0];
      l.g = CAVE_TORCH.color[1];
      l.b = CAVE_TORCH.color[2];
      l.intensity = CAVE_TORCH.intensity;
      l.flicker = CAVE_TORCH.flicker;
      l.seed = i;
      scene.lights.push(l);
    }
  }

  private levelAt(p: Placed): number {
    const tx = Math.floor(p.x / TILE_PX);
    const ty = Math.floor(p.y / TILE_PX);
    const c = this.host.get(this.preset.layer, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    return c === undefined ? 0 : (c.height[(ty - c.cy * CHUNK_TILES) * CHUNK_TILES + (tx - c.cx * CHUNK_TILES)] as number);
  }
}
