/**
 * Scenario `tilemap` (M1-13): four ground chunks of the chunk tile map meet in the middle of the
 * view – meadow tiles in their variants and a dirt road with grass edges crossing the vertical
 * chunk border, the horizontal border runs through the meadow. Daylight, so the tiles show exactly
 * their palette colours; any seam at a chunk border would show as a line or a jump in the pattern.
 * A tree, rocks and the player stand on the ground as sprites.
 */
import { spriteFrame, type AtlasData } from '../assets/atlas';
import { clipFrameAt } from '../anim/animation';
import type { RenderScene } from '../scene';
import { CHUNK_PX } from './chunk';
import { KitScene, meadowWithRoad } from './kitScene';
import { TERRAIN, type SceneKit } from './sceneKit';
import type { TileSet } from './tileSet';

/** Camera centre (world px): the corner of chunks (0, 0), (1, 0), (0, 1) and (1, 1) lies inside the view. */
export const TILEMAP_CAMERA: readonly [number, number] = [CHUNK_PX - 12, CHUNK_PX + 18];
/** World tile row of the road's north edge (road rows 35–37, below the horizontal chunk border). */
export const TILEMAP_ROAD_ROW = 35;
/** Objects on the ground: role, x, y (anchor, world px). */
const OBJECTS: readonly (readonly ['tree' | 'rockBig' | 'rockSmall', number, number])[] = [
  ['tree', 330, 470],
  ['rockBig', 700, 520],
  ['rockSmall', 614, 452],
  ['rockSmall', 404, 634],
  ['tree', 760, 430],
];
const PLAYER: readonly [number, number] = [560, 548];

export class TilemapScene extends KitScene {
  readonly id = 'tilemap';

  constructor(gameAtlas: () => AtlasData | null) {
    super(gameAtlas, { first: 0, last: 1 }, { first: 0, last: 1 });
  }

  protected terrain(kit: SceneKit): (wx: number, wy: number) => number {
    return meadowWithRoad(kit, TILEMAP_ROAD_ROW);
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.ambientR = 1;
    env.ambientG = 1;
    env.ambientB = 1;
    env.ambientIntensity = 1;
    env.wind = 0;
  }

  protected compose(scene: RenderScene, kit: SceneKit, time: number): void {
    scene.camera.set(TILEMAP_CAMERA[0], TILEMAP_CAMERA[1]).unfollow();
    const d = scene.sprite;
    for (const [role, x, y] of OBJECTS) {
      d.reset();
      d.frame = spriteFrame(kit[role], 0);
      d.x = x;
      d.y = y;
      scene.sprites.push(d);
    }
    d.reset();
    d.frame = spriteFrame(kit.figure, clipFrameAt(kit.idle.down, time));
    d.x = PLAYER[0];
    d.y = PLAYER[1];
    scene.sprites.push(d);
  }
}

/** Camera of the seam probe: exactly on the corner of four chunks (whole pixels, no subpixel offset). */
export const TILEMAP_PROBE_CAMERA: readonly [number, number] = [CHUNK_PX, CHUNK_PX];

/**
 * Scene `tilemap-probe` (E2E `render-light-tilemap`): four chunks of one textured tile without
 * variants, so the ground repeats every 16 px – across a chunk border as well, unless there is a seam.
 */
export class TilemapProbeScene extends KitScene {
  readonly id = 'tilemap-probe';

  constructor(gameAtlas: () => AtlasData | null) {
    super(gameAtlas, { first: 0, last: 1 }, { first: 0, last: 1 });
  }

  protected terrain(_kit: SceneKit): (wx: number, wy: number) => number {
    return () => TERRAIN.grass;
  }

  protected override tileSet(kit: SceneKit): TileSet {
    return kit.probeTiles;
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.ambientR = 1;
    env.ambientG = 1;
    env.ambientB = 1;
    env.ambientIntensity = 1;
    env.wind = 0;
  }

  protected compose(scene: RenderScene): void {
    scene.camera.set(TILEMAP_PROBE_CAMERA[0], TILEMAP_PROBE_CAMERA[1]).unfollow();
  }
}
