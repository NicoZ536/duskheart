/**
 * Where creatures live and move (docs/SPIEL.md §11 "Bestand und Spawn"; docs/ARCHITEKTUR.md "Aktive Zone"; M6-16e).
 *
 * Creatures tick only inside the active zone. The collision of a tile near a chunk border depends on its neighbour
 * chunk (cliff faces reach `MAX_LEVEL + 1` rows south of their plateau, footprints up to three tiles east and north),
 * and whether a *frozen* neighbour happens to be resident differs between the browser (the camera streams it) and a
 * headless run (the chunk store trims it). So that no creature ever reads such a tile:
 * - a body moves – and a new creature appears – only where it stands `BALANCE.creatures.movement.zoneMarginTiles`
 *   inside the active zone (`insideZone`): the chunk under it is active, and so is every neighbour chunk closer than
 *   the margin. 6 tiles cover the widest border band (5 rows of a cliff face) plus a body's radius; a body in the band
 *   of a frozen neighbour stands still until the zone grows back or its home chunk freezes;
 * - paths use only **core chunks** (`coreChunk`): an active chunk whose eight neighbours are active too, so the
 *   path cache's words of every chunk a search reads come from resident, active chunks in every run;
 * - populations are placed in the **interior** of their chunk (`interiorTile`), which needs no neighbour at all.
 * The game's zone is the world's `ActiveZone`; tests hand in their own (`CreatureZone`).
 */
import { BALANCE } from '../../content/balance';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, TILE_PX, type Layer } from '../../world/model/coords';
import type { SimWorld } from '../world';

/** Margin of movement and placement inside the active zone [tiles]. */
export const ZONE_MARGIN_TILES = BALANCE.creatures.movement.zoneMarginTiles;

/** The active zone as the creatures read it. */
export interface CreatureZone {
  /** Whether chunk (cx, cy) of `layer` is active. */
  isActive(layer: Layer, cx: number, cy: number): boolean;
  /** The active chunks in ascending chunk id order (the population's regrowth visits them). */
  chunks(): readonly ChunkData[];
}

/** No chunk. */
const NO_CHUNKS: readonly ChunkData[] = [];

/** The world's active zone (nothing is active before the world is materialised). */
export function worldCreatureZone(world: SimWorld): CreatureZone {
  return {
    isActive: (layer, cx, cy) => world.materialized && world.zone.isActive(layer, cx, cy),
    chunks: () => (world.materialized ? world.zone.chunks : NO_CHUNKS),
  };
}

/** Whether a body centred at (x, y) [px] stands at least `ZONE_MARGIN_TILES` inside the active zone (see module comment). */
export function insideZone(zone: CreatureZone, layer: Layer, x: number, y: number): boolean {
  return insideZoneTile(zone, layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX));
}

/**
 * `insideZone` for a body on tile (tx, ty) – for the creature's tick, which passes whole tiles (M6-16d: a fractional
 * coordinate passed to a call V8 does not inline is boxed).
 */
export function insideZoneTile(zone: CreatureZone, layer: Layer, tx: number, ty: number): boolean {
  const cx = tx >> CHUNK_SHIFT;
  const cy = ty >> CHUNK_SHIFT;
  if (!zone.isActive(layer, cx, cy)) return false;
  const lx = tx & CHUNK_MASK;
  const ly = ty & CHUNK_MASK;
  const dx = lx < ZONE_MARGIN_TILES ? -1 : lx >= CHUNK_SIZE - ZONE_MARGIN_TILES ? 1 : 0;
  const dy = ly < ZONE_MARGIN_TILES ? -1 : ly >= CHUNK_SIZE - ZONE_MARGIN_TILES ? 1 : 0;
  if (dx !== 0 && !zone.isActive(layer, cx + dx, cy)) return false;
  if (dy !== 0 && !zone.isActive(layer, cx, cy + dy)) return false;
  return dx === 0 || dy === 0 || zone.isActive(layer, cx + dx, cy + dy);
}

/** Whether chunk (cx, cy) and its eight neighbours are active (a path may read it). */
export function coreChunk(zone: CreatureZone, layer: Layer, cx: number, cy: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!zone.isActive(layer, cx + dx, cy + dy)) return false;
  return true;
}

/** Whether tile (tx, ty) lies at least `ZONE_MARGIN_TILES` from every edge of its chunk. */
export function interiorTile(tx: number, ty: number): boolean {
  const lx = tx & CHUNK_MASK;
  const ly = ty & CHUNK_MASK;
  return lx >= ZONE_MARGIN_TILES && ly >= ZONE_MARGIN_TILES && lx < CHUNK_SIZE - ZONE_MARGIN_TILES && ly < CHUNK_SIZE - ZONE_MARGIN_TILES;
}

/** Tiles per axis of a chunk's interior. */
export const INTERIOR_TILES = CHUNK_SIZE - 2 * ZONE_MARGIN_TILES;
