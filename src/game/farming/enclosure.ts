/**
 * Enclosures for the fields (docs/SPIEL.md §17 "RoomsSystem enclosedAt", §20 "Hasen (Beet nicht eingefriedet: rooms.enclosedAt
 * über Zäune, Wände, Tore ohne Dachbedingung)"; M7-20): whether a tile lies inside a ring of closing tiles – finished fences,
 * walls, doors, gates and windows of the build grid, and rock and cliff faces around them – that a flood fill over the four
 * neighbours cannot leave within `maxTiles` tiles. Unlike a room (src/game/rooms/detect.ts) a fence closes and no roof is
 * needed: hares do not climb. A fill that meets an unloaded tile counts as open. Pure over the `closes` query; the rooms
 * system answers `enclosedAt` with it.
 */
import type { Layer } from '../../world/model/coords';

/** Four neighbours. */
const DX: readonly number[] = [0, 1, 0, -1];
const DY: readonly number[] = [-1, 0, 1, 0];
/** Row stride of a tile key: wider than any world (at most 2048 tiles, docs/WORLD.md §1). */
const KEY_STRIDE = 4096;

/** What a fill reads of the world: whether a tile closes the enclosure, or is unknown (unloaded). */
export interface EnclosureWorld {
  /** 1: closes (fence, wall, gate, rock), 0: open, −1: unknown (not loaded). */
  closes(layer: Layer, tx: number, ty: number): number;
}

/** Whether tile (tx, ty) of `layer` lies in an enclosure of at most `maxTiles` open tiles (false when it closes itself). */
export function isEnclosed(world: EnclosureWorld, layer: Layer, tx: number, ty: number, maxTiles: number): boolean {
  if (world.closes(layer, tx, ty) !== 0) return false;
  const seen = new Set<number>([ty * KEY_STRIDE + tx]);
  const queue: number[] = [tx, ty];
  for (let head = 0; head < queue.length; head += 2) {
    const x = queue[head] as number;
    const y = queue[head + 1] as number;
    for (let d = 0; d < DX.length; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      const key = ny * KEY_STRIDE + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = world.closes(layer, nx, ny);
      if (c < 0) return false;
      if (c > 0) continue;
      if (queue.length / 2 >= maxTiles) return false;
      queue.push(nx, ny);
    }
  }
  return true;
}

/** Kinds of build parts that close an enclosure: walls, doors, gates, windows and fences (pillars and furniture do not). */
const CLOSING_KINDS: ReadonlySet<string> = new Set(['wand', 'tuer', 'tor', 'fenster', 'zaun']);

/** What the enclosure fill reads of the build grid and the terrain (the rooms system builds it). */
export interface EnclosureSources {
  /** The finished, closing structure part on tile (tx, ty), if any. */
  closingPart(layer: Layer, tx: number, ty: number): boolean;
  /** Collision info of the terrain (`BLOCK_*` bits of src/world/collision/tiles.ts). */
  terrain(layer: Layer, tx: number, ty: number): number;
  /** Bits of `terrain` that close (rock, cliff faces) and that mean "not loaded". */
  readonly solidBits: number;
  readonly unknownBits: number;
}

/** The enclosure world over `sources`. */
export function enclosureWorld(sources: EnclosureSources): EnclosureWorld {
  return {
    closes(layer, tx, ty) {
      const info = sources.terrain(layer, tx, ty);
      if ((info & sources.unknownBits) !== 0) return -1;
      if ((info & sources.solidBits) !== 0 || sources.closingPart(layer, tx, ty)) return 1;
      return 0;
    },
  };
}

/** Whether a structure part of `kind` closes an enclosure. */
export function closesEnclosure(kind: string): boolean {
  return CLOSING_KINDS.has(kind);
}
