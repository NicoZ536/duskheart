/**
 * World sizes (MASTERPROMPT §9.1, docs/WORLD.md §1): Klein 1024² · Mittel 1536² (default) · Groß
 * 2048² tiles. Preset ids are the ones of the simulation config (`small`, `medium`, `large`); the
 * edge lengths live in `BALANCE.world.sizeTiles` and must be whole chunks.
 */
import { BALANCE, type WorldSizePreset } from '../../content/balance';
import { CHUNK_SIZE, LAYER_COUNT, TILE_PX } from './coords';

/** Selectable world sizes, smallest first. */
export const WORLD_SIZE_PRESETS = ['small', 'medium', 'large'] as const satisfies readonly WorldSizePreset[];

/** Derived dimensions of one world size. */
export interface WorldDimensions {
  readonly preset: WorldSizePreset;
  /** Edge length [tiles]. */
  readonly tiles: number;
  /** Edge length [chunks]. */
  readonly chunks: number;
  /** Edge length [px]. */
  readonly pixels: number;
  /** Chunks of one layer. */
  readonly chunksPerLayer: number;
  /** Chunks of all four layers. */
  readonly chunksTotal: number;
}

function dimensionsOf(preset: WorldSizePreset): WorldDimensions {
  const tiles = BALANCE.world.sizeTiles[preset];
  if (!Number.isInteger(tiles) || tiles <= 0 || tiles % CHUNK_SIZE !== 0) {
    throw new RangeError(`World size "${preset}" must be a positive multiple of ${CHUNK_SIZE} tiles, got ${String(tiles)}`);
  }
  const chunks = tiles / CHUNK_SIZE;
  return Object.freeze({ preset, tiles, chunks, pixels: tiles * TILE_PX, chunksPerLayer: chunks * chunks, chunksTotal: chunks * chunks * LAYER_COUNT });
}

const DIMENSIONS: Readonly<Record<WorldSizePreset, WorldDimensions>> = Object.freeze({
  small: dimensionsOf('small'),
  medium: dimensionsOf('medium'),
  large: dimensionsOf('large'),
});

/** Whether `value` is a world size preset id. */
export function isWorldSizePreset(value: unknown): value is WorldSizePreset {
  return typeof value === 'string' && (WORLD_SIZE_PRESETS as readonly string[]).includes(value);
}

/** Dimensions of a world size (shared frozen object). */
export function worldDimensions(preset: WorldSizePreset): WorldDimensions {
  return DIMENSIONS[preset];
}

/** Whether a tile lies inside the world (all layers share the same extent). */
export function tileInWorld(dim: WorldDimensions, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < dim.tiles && ty < dim.tiles;
}

/** Whether a chunk lies inside the world. */
export function chunkInWorld(dim: WorldDimensions, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < dim.chunks && cy < dim.chunks;
}
