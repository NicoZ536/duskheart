/**
 * Base of the debug scenes that stand on a chunk tile map (`tilemap`, `normalmap-licht`,
 * `post-grundlage`): owns the scene's `TileMapRenderer` (added as a pass while the scene is active),
 * builds the terrain chunks once the atlas is known, hangs the map into `scene.ground` and gives the
 * scene's environment back when it is switched away (other scenes expect the default daylight).
 */
import type { Renderer } from '../renderer';
import type { RenderEnvironment, RenderScene } from '../scene';
import type { SceneSource } from '../scenes/sceneSource';
import type { AtlasData } from '../assets/atlas';
import { CHUNK_TILES, TileChunk, tileIndex } from './chunk';
import { SceneKitSource, TERRAIN, type SceneKit } from './sceneKit';
import { TILEMAP_ORDER, TileMapRenderer } from './tileMap';
import type { TileSet } from './tileSet';

/** Chunk range [first, last] per axis the scene's terrain covers. */
export interface ChunkRange {
  readonly first: number;
  readonly last: number;
}

/**
 * Meadow terrain with an east–west road: grass everywhere, the road's rows `roadRow` (north edge),
 * `roadRow + 1` (dirt) and `roadRow + 2` (south edge) in world tiles. Atlases without dirt tiles get
 * the meadow alone.
 */
export function meadowWithRoad(kit: SceneKit, roadRow: number): (wx: number, wy: number) => number {
  return (_wx, wy) => {
    if (!kit.roads) return TERRAIN.grass;
    if (wy === roadRow) return TERRAIN.edgeGrassNorth;
    if (wy === roadRow + 1) return TERRAIN.dirt;
    if (wy === roadRow + 2) return TERRAIN.edgeGrassSouth;
    return TERRAIN.grass;
  };
}

export abstract class KitScene implements SceneSource {
  abstract readonly id: string;
  protected readonly map = new TileMapRenderer();
  private readonly kits: SceneKitSource;
  private readonly chunks: TileChunk[] = [];
  private builtFor: SceneKit | null = null;
  private scene: RenderScene | null = null;
  private savedEnv: RenderEnvironment | null = null;

  constructor(
    gameAtlas: () => AtlasData | null,
    private readonly chunksX: ChunkRange,
    private readonly chunksY: ChunkRange,
  ) {
    this.kits = new SceneKitSource(gameAtlas);
  }

  /** Ground tile id at world tile (wx, wy). */
  protected abstract terrain(kit: SceneKit): (wx: number, wy: number) => number;

  /** Palette row of the ground tile at world tile (wx, wy); null = master palette everywhere (default). */
  protected terrainRow(_kit: SceneKit): ((wx: number, wy: number) => number) | null {
    return null;
  }

  /** The tile set of the terrain (default: the kit's meadow and road tiles). */
  protected tileSet(kit: SceneKit): TileSet {
    return kit.tiles;
  }

  /** Fills camera, environment, sprites and lights (the ground is the tile map). */
  protected abstract compose(scene: RenderScene, kit: SceneKit, time: number): void;

  /** Environment while the atlas is still loading (the scene's own light mood without sprites). */
  protected abstract environment(scene: RenderScene): void;

  /** True once the atlas is there and the scene draws its full image. */
  ready(): boolean {
    return this.kits.current() !== null;
  }

  /** The terrain chunks (after the first frame with an atlas). */
  get terrainChunks(): readonly TileChunk[] {
    return this.chunks;
  }

  activate(renderer: Renderer): void {
    if (!renderer.passes.get(this.map.name)) renderer.passes.add(this.map, TILEMAP_ORDER);
  }

  deactivate(renderer: Renderer): void {
    renderer.passes.remove(this.map.name);
    const scene = this.scene;
    if (scene === null) return;
    const i = scene.ground.indexOf(this.map);
    if (i >= 0) scene.ground.splice(i, 1);
    if (this.savedEnv !== null) Object.assign(scene.env, this.savedEnv);
    this.scene = null;
    this.savedEnv = null;
  }

  fill(scene: RenderScene, time: number): void {
    if (this.scene !== scene) {
      this.scene = scene;
      this.savedEnv = { ...scene.env };
    }
    if (!scene.ground.includes(this.map)) scene.ground.push(this.map);
    this.environment(scene);
    const kit = this.kits.current();
    if (kit === null) {
      scene.atlas = null;
      return;
    }
    if (kit !== this.builtFor) this.build(kit);
    scene.atlas = kit.atlas;
    this.compose(scene, kit, time);
  }

  private build(kit: SceneKit): void {
    this.builtFor = kit;
    const tileAt = this.terrain(kit);
    if (this.chunks.length === 0) {
      for (let cy = this.chunksY.first; cy <= this.chunksY.last; cy++) for (let cx = this.chunksX.first; cx <= this.chunksX.last; cx++) this.chunks.push(new TileChunk(cx, cy));
    }
    const rowAt = this.terrainRow(kit);
    for (const c of this.chunks) {
      c.fill(tileAt);
      if (rowAt === null) continue;
      const x0 = c.cx * CHUNK_TILES;
      const y0 = c.cy * CHUNK_TILES;
      for (let ty = 0; ty < CHUNK_TILES; ty++) for (let tx = 0; tx < CHUNK_TILES; tx++) c.set(tx, ty, c.groundAt(tileIndex(tx, ty)), rowAt(x0 + tx, y0 + ty));
    }
    this.map.setTiles(kit.atlas, this.tileSet(kit));
    this.map.setChunks(this.chunks);
  }
}

