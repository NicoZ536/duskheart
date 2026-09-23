/** Shared helpers of the render debug scenes: deterministic scatter and a tiled grass ground. */
import { atlasSprite, spriteFrame, type AtlasData } from '../assets/atlas';
import type { RenderScene } from '../scene';

/** Tile size of the ground (§4.4). */
export const TILE = 16;
/** Half extent of the ground around the camera: covers 640×270 plus margin in every scene. */
export const GROUND_HALF_WIDTH = 22 * TILE;
export const GROUND_HALF_HEIGHT = 11 * TILE;
const HASH_A = 0x27d4eb2d;
const HASH_B = 0x165667b1;
const HASH_SHIFT = 15;
const UINT32 = 2 ** 32;

/** Deterministic hash of (a, b) in [0, 1) (scene layout only, not simulation randomness). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ HASH_A, HASH_B) ^ Math.imul(b + HASH_B, HASH_A);
  h ^= h >>> HASH_SHIFT;
  h = Math.imul(h, HASH_A);
  h ^= h >>> HASH_SHIFT;
  return (h >>> 0) / UINT32;
}

/** Cumulative share of the grass variants in frame order (plain A, tuft A, tuft B, flower, plain B, bare). */
const GRASS_WEIGHTS: readonly number[] = [0.18, 0.36, 0.54, 0.62, 0.8, 1];

function grassVariant(x: number, y: number): number {
  const h = hash01(x, y);
  for (let i = 0; i < GRASS_WEIGHTS.length; i++) if (h < (GRASS_WEIGHTS[i] ?? 1)) return i;
  return 0;
}

/** Grass tiles (variants chosen by position) around (`cx`, `cy`). */
export function fillGrass(scene: RenderScene, atlas: AtlasData, cx: number, cy: number): void {
  const grass = atlasSprite(atlas.manifest, 'gras_boden');
  const d = scene.sprite;
  for (let y = cy - GROUND_HALF_HEIGHT; y < cy + GROUND_HALF_HEIGHT; y += TILE) {
    for (let x = cx - GROUND_HALF_WIDTH; x < cx + GROUND_HALF_WIDTH; x += TILE) {
      d.reset();
      d.layer = 'ground';
      d.frame = spriteFrame(grass, grassVariant(x, y));
      d.x = x;
      d.y = y;
      scene.sprites.push(d);
    }
  }
}

/** Pushes one static sprite frame. */
export function place(scene: RenderScene, atlas: AtlasData, id: string, frame: number, x: number, y: number, layer: 'ground' | 'water' | 'objects' | 'canopy' = 'objects', paletteRow = 0): void {
  const d = scene.sprite;
  d.reset();
  d.frame = spriteFrame(atlasSprite(atlas.manifest, id), frame);
  d.x = x;
  d.y = y;
  d.layer = layer;
  d.paletteRow = paletteRow;
  scene.sprites.push(d);
}
