/**
 * Sprites and ground tiles of the tile map and light debug scenes (`tilemap`, `normalmap-licht`,
 * `post-grundlage`). They use the game atlas of `npm run assets` – the real Grünhain tiles, rocks,
 * tree, torch and player with the normals of the asset pipeline – and fall back to the renderer's
 * in-memory scene atlas when no generated atlas exists (fresh checkout without assets, unit tests).
 * A profile lists the sprite ids of each role; the first profile the atlas satisfies wins.
 */
import { generatedAtlasModule } from '../assets/generated';
import { atlasSprite, spriteClip, type AtlasData, type AtlasSprite } from '../assets/atlas';
import { DIRECTIONS, type AnimationClip, type Direction } from '../anim/animation';
import { sceneAtlas } from '../assets/sceneSprites';
import { TileSet, type TileDef } from './tileSet';

/** Ground tile ids of the scene terrain. */
export const TERRAIN = {
  grass: 1,
  dirt: 2,
  /** Grass/dirt border with the grass on the north side (north edge of a road). */
  edgeGrassNorth: 3,
  /** Grass/dirt border with the grass on the south side (south edge of a road). */
  edgeGrassSouth: 4,
} as const;

interface Profile {
  readonly grass: string;
  /** Plain grass variants and their weights (tufts rarer than plain grass). */
  readonly grassFrames: readonly number[];
  readonly grassWeights: readonly number[];
  /** Dirt tile and grass/dirt edge (frame per grass side) – absent in the fallback atlas. */
  readonly road: { readonly dirt: string; readonly dirtWeights: readonly number[]; readonly edge: string; readonly edgeNorth: number; readonly edgeSouth: number } | null;
  readonly rockBig: string;
  readonly rockSmall: string;
  readonly tree: string;
  readonly torch: string;
  readonly torchClip: string;
  readonly figure: string;
  /** Metal things (glints under point light) and a glowing one (emission + its own light). */
  readonly metal: readonly string[];
  readonly glowing: string;
  /** A single textured tile frame for the seam probe (a pattern repeating every tile). */
  readonly probeTile: { readonly sprite: string; readonly frame: number };
}

/** The game atlas (assets-src/sprites/**). */
const GAME_PROFILE: Profile = {
  grass: 'boden_gras',
  grassFrames: [0, 1, 2, 3],
  grassWeights: [4, 4, 4, 2],
  road: { dirt: 'boden_erde', dirtWeights: [3, 3, 4, 1], edge: 'boden_gras_kante', edgeNorth: 0, edgeSouth: 1 },
  rockBig: 'fels_gross',
  rockSmall: 'fels_klein',
  tree: 'baum_laub',
  torch: 'fackel_wand',
  torchClip: 'idle',
  figure: 'spieler_koerper',
  metal: ['axt_eisen', 'axt_stahl'],
  glowing: 'axt_lumenit',
  probeTile: { sprite: 'boden_erde', frame: 1 },
};

/** The renderer's in-memory scene atlas (src/render/assets/sceneSprites.ts). */
const SCENE_PROFILE: Profile = {
  grass: 'gras_boden',
  grassFrames: [0, 1, 2, 4],
  grassWeights: [4, 2, 2, 4],
  road: null,
  rockBig: 'fels',
  rockSmall: 'fels',
  tree: 'laubbaum',
  torch: 'fackel',
  torchClip: 'brennen',
  figure: 'wanderer',
  metal: ['helm', 'schwert'],
  glowing: 'leuchtpilz',
  probeTile: { sprite: 'gras_boden', frame: 1 },
};

const PROFILES: readonly Profile[] = [GAME_PROFILE, SCENE_PROFILE];

/** Everything a scene draws, resolved against one atlas. */
export interface SceneKit {
  readonly atlas: AtlasData;
  readonly tiles: TileSet;
  /** Whether dirt and grass/dirt edges exist (roads). */
  readonly roads: boolean;
  readonly rockBig: AtlasSprite;
  readonly rockSmall: AtlasSprite;
  readonly tree: AtlasSprite;
  readonly torch: AtlasSprite;
  readonly torchClip: AnimationClip;
  readonly figure: AtlasSprite;
  readonly metal: readonly AtlasSprite[];
  readonly glowing: AtlasSprite;
  /** Tile set with one unmirrored tile (id `TERRAIN.grass`): a pattern that repeats every 16 px. */
  readonly probeTiles: TileSet;
  /** Idle clip of the figure per facing direction. */
  readonly idle: Readonly<Record<Direction, AnimationClip>>;
}

function satisfies(atlas: AtlasData, p: Profile): boolean {
  const s = atlas.manifest.sprites;
  const ids = [p.grass, p.rockBig, p.rockSmall, p.tree, p.torch, p.figure, p.glowing, ...p.metal, ...(p.road ? [p.road.dirt, p.road.edge] : [])];
  if (!ids.every((id) => s[id] !== undefined)) return false;
  const figure = s[p.figure];
  return s[p.torch]?.clips[p.torchClip] !== undefined && DIRECTIONS.every((d) => figure?.clips[`idle_${d}`] !== undefined);
}

function tileDefs(p: Profile): TileDef[] {
  const defs: TileDef[] = [{ id: TERRAIN.grass, sprite: p.grass, frames: p.grassFrames, weights: p.grassWeights, mirror: true }];
  if (p.road) {
    defs.push({ id: TERRAIN.dirt, sprite: p.road.dirt, weights: p.road.dirtWeights, mirror: true });
    defs.push({ id: TERRAIN.edgeGrassNorth, sprite: p.road.edge, frames: [p.road.edgeNorth], mirror: true });
    defs.push({ id: TERRAIN.edgeGrassSouth, sprite: p.road.edge, frames: [p.road.edgeSouth], mirror: true });
  }
  return defs;
}

/** Resolves the scene kit against `atlas`; null when no profile fits. */
export function sceneKitFor(atlas: AtlasData): SceneKit | null {
  const p = PROFILES.find((q) => satisfies(atlas, q));
  if (p === undefined) return null;
  const m = atlas.manifest;
  const figure = atlasSprite(m, p.figure);
  return {
    atlas,
    tiles: new TileSet(m, tileDefs(p)),
    roads: p.road !== null,
    rockBig: atlasSprite(m, p.rockBig),
    rockSmall: atlasSprite(m, p.rockSmall),
    tree: atlasSprite(m, p.tree),
    torch: atlasSprite(m, p.torch),
    torchClip: spriteClip(atlasSprite(m, p.torch), p.torchClip),
    figure,
    metal: p.metal.map((id) => atlasSprite(m, id)),
    glowing: atlasSprite(m, p.glowing),
    probeTiles: new TileSet(m, [{ id: TERRAIN.grass, sprite: p.probeTile.sprite, frames: [p.probeTile.frame] }]),
    idle: { down: spriteClip(figure, 'idle_down'), left: spriteClip(figure, 'idle_left'), up: spriteClip(figure, 'idle_up'), right: spriteClip(figure, 'idle_right') },
  };
}

/**
 * Tracks the atlas of a scene: the game atlas once it is loaded, the in-memory scene atlas when the
 * build has none at all or when the game atlas lacks a sprite of every profile. `current()` is null
 * while the game atlas is still loading.
 */
export class SceneKitSource {
  private kit: SceneKit | null = null;
  private resolvedFor: AtlasData | null = null;
  private readonly hasGameAtlas = generatedAtlasModule() !== null;

  constructor(private readonly gameAtlas: () => AtlasData | null) {}

  current(): SceneKit | null {
    const atlas = this.gameAtlas() ?? (this.hasGameAtlas ? null : sceneAtlas());
    if (atlas === null) return null;
    if (atlas !== this.resolvedFor) {
      this.resolvedFor = atlas;
      this.kit = sceneKitFor(atlas) ?? sceneKitFor(sceneAtlas());
    }
    return this.kit;
  }
}
