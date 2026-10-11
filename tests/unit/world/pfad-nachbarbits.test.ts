/**
 * M7-87 (MASTERPROMPT §19.4, §30 Simulation ≤ 3 ms je Tick; docs/SPIEL.md §12): a jump of the tile search stops on every
 * tile next to a special tile – a level link for walkers, a closed door for door openers. The window marks those tiles
 * once (`PATH_NEAR_LINK`, `PATH_NEAR_DOOR`), so a jump reads one bit per scanned tile where it checked eight neighbours
 * in every chunk near a special tile (65 % of the chunks of the `sim:pfad-200` zone).
 *
 * The bits must be exactly the old neighbour check: the eight neighbours inside the window, across chunk borders, not
 * beyond the window's edge – the tile cache's window (`PathTileCache.fill`) and a grid built by hand
 * (`PathGrid.markSpecials`, which also clears stale bits) alike.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import { BLOCK_SOLID, CollisionGrid, type CollisionOverlay } from '../../../src/world/collision/tiles';
import { ChunkData, TILE_FLAG_RAMP } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { PathTileCache } from '../../../src/world/path/cache';
import { PATH_CONNECTOR, PATH_DOOR, PATH_LINK, PATH_NEAR_BITS, PATH_NEAR_DOOR, PATH_NEAR_LINK, PathGrid, pathProfile } from '../../../src/world/path/grid';
import { randomGrid } from './pfadHilfen';

const GRAS = contentWorldIdTables().terrain.runtimeId('gras');

/** The near bits a window tile must carry: the special tiles among its eight neighbours inside the window. */
function expectedNear(grid: PathGrid, x: number, y: number): number {
  let bits = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox;
      const ny = y + oy;
      if ((ox === 0 && oy === 0) || nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const w = grid.words[ny * grid.width + nx] as number;
      if ((w & PATH_LINK) !== 0) bits |= PATH_NEAR_LINK;
      if ((w & PATH_DOOR) !== 0) bits |= PATH_NEAR_DOOR;
    }
  }
  return bits;
}

/** Window tiles whose near bits differ from the neighbour check (at most a few, for the message). */
function wrongNear(grid: PathGrid): string[] {
  const wrong: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const have = (grid.words[y * grid.width + x] as number) & PATH_NEAR_BITS;
      const want = expectedNear(grid, x, y);
      if (have !== want && wrong.length < 8) wrong.push(`(${x}, ${y}): ${have.toString(2)} statt ${want.toString(2)}`);
    }
  }
  return wrong;
}

/** Window tiles carrying `bit`. */
function marked(grid: PathGrid, bit: number): number {
  let n = 0;
  for (let i = 0; i < grid.width * grid.height; i++) if (((grid.words[i] as number) & bit) !== 0) n++;
  return n;
}

describe('Nachbarbits der Sonderkacheln (M7-87)', () => {
  it('das Fenster des Kachelcaches markiert genau die Nachbarn im Fenster – über Chunkgrenzen, nicht über den Fensterrand', () => {
    // 4 × 2 chunks of meadow; a plateau (level 1) over the rows 0–39 with ramps on its edge row 39: one at the east edge of
    // chunk 0 (x 30–31), one across the border of chunks 1 and 2 (x 63–64). Doors on that border at (63, 50) and (64, 20).
    const map = new Map<number, ChunkData>();
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        const c = new ChunkData(0, cx, cy);
        c.ground.fill(GRAS);
        map.set(packChunkId(0, cx, cy), c);
      }
    }
    const at = (tx: number, ty: number): { c: ChunkData; i: number } => ({ c: map.get(packChunkId(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT)) as ChunkData, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) });
    for (let ty = 0; ty < 40; ty++) {
      for (let tx = 0; tx < 4 * CHUNK_SIZE; tx++) {
        const { c, i } = at(tx, ty);
        c.height[i] = 1;
      }
    }
    for (const tx of [30, 31, 63, 64]) {
      const { c, i } = at(tx, 39);
      c.flags[i] = TILE_FLAG_RAMP;
    }
    const doorTiles = [
      [63, 50],
      [64, 20],
    ] as const;
    const isDoor = (tx: number, ty: number): boolean => doorTiles.some(([x, y]) => x === tx && y === ty);
    const overlay: CollisionOverlay = { overlayAt: (_l, tx, ty) => (isDoor(tx, ty) ? BLOCK_SOLID : 0) };
    const collision = new CollisionGrid({ chunks: { get: (layer: Layer, cx: number, cy: number) => map.get(packChunkId(layer, cx, cy)) }, worldTiles: 4 * CHUNK_SIZE, memo: true, overlay });
    const cache = new PathTileCache({ grid: () => collision, doors: { closedDoorAt: (_l: Layer, tx: number, ty: number) => isDoor(tx, ty), mayHaveDoors: () => true } });

    // The window of chunks 1–2 (x 32–95): the ramp at x 30–31 lies just outside its west edge.
    const grid = new PathGrid();
    grid.reset(0, 1, 0, 2, 2);
    cache.fill(grid, null, 1);
    const word = (tx: number, ty: number): number => grid.words[ty * grid.width + tx - grid.tx0] as number;
    expect(word(63, 39) & PATH_LINK).not.toBe(0);
    expect(word(64, 39) & PATH_LINK).not.toBe(0);
    expect(word(63, 50) & PATH_DOOR).not.toBe(0);
    expect(wrongNear(grid)).toEqual([]);
    // Links and doors are marked, across the chunk border (each door marks tiles of both chunks) …
    expect(word(62, 39) & PATH_NEAR_LINK).toBe(PATH_NEAR_LINK);
    expect(word(65, 39) & PATH_NEAR_LINK).toBe(PATH_NEAR_LINK);
    expect(marked(grid, PATH_NEAR_DOOR)).toBe(16);
    expect(word(64, 50) & PATH_NEAR_DOOR).toBe(PATH_NEAR_DOOR);
    expect(word(63, 20) & PATH_NEAR_DOOR).toBe(PATH_NEAR_DOOR);
    // … but not beyond the window: the links at x 31 lie outside it.
    for (let ty = 37; ty <= 42; ty++) expect(word(32, ty) & PATH_NEAR_BITS, `(32, ${ty})`).toBe(0);

    // A refill of the whole world over the same cached chunks: the bits follow that window (the cache holds none).
    grid.reset(0, 0, 0, 4, 2);
    cache.fill(grid, null, 2);
    expect(wrongNear(grid)).toEqual([]);
    expect(word(31, 39) & PATH_LINK).not.toBe(0);
    expect(word(32, 39) & PATH_NEAR_LINK).toBe(PATH_NEAR_LINK);
  });

  it('von Hand gebaute Raster: markSpecials setzt die Bits und löscht veraltete', () => {
    const grid = randomGrid(87, { chunks: 3, obstacles: 0.1, levels: true, doors: true, water: false, light: false });
    expect(marked(grid, PATH_NEAR_LINK)).toBeGreaterThan(0);
    expect(marked(grid, PATH_NEAR_DOOR)).toBeGreaterThan(0);
    expect(wrongNear(grid)).toEqual([]);
    // Every door and every connector gone: no tile is near a special one any more.
    for (let i = 0; i < grid.width * grid.height; i++) grid.words[i] = (grid.words[i] as number) & ~(PATH_DOOR | PATH_CONNECTOR);
    grid.markLinks();
    grid.markSpecials();
    expect(marked(grid, PATH_NEAR_BITS)).toBe(0);
    expect(Array.from(grid.special.subarray(0, grid.cw * grid.ch)).every((s) => s === 0)).toBe(true);
    // Random special tiles again, also on the window's edge.
    const rng = new Rng(870);
    for (let k = 0; k < 60; k++) {
      const x = k % 7 === 0 ? 0 : rng.int(0, grid.width);
      const y = k % 5 === 0 ? grid.height - 1 : rng.int(0, grid.height);
      grid.words[y * grid.width + x] = (grid.words[y * grid.width + x] as number) | (k % 2 === 0 ? PATH_DOOR : PATH_LINK);
    }
    grid.markSpecials();
    expect(wrongNear(grid)).toEqual([]);
  });

  it('jede Fortbewegung liest die Nachbarbits ihrer Sonderkacheln: Läufer die der Rampen, Türöffner die der Türen', () => {
    expect(pathProfile('land', false).near).toBe(PATH_NEAR_LINK);
    expect(pathProfile('land', true).near).toBe(PATH_NEAR_LINK | PATH_NEAR_DOOR);
    expect(pathProfile('schwimmer', false).near).toBe(PATH_NEAR_LINK);
    expect(pathProfile('flieger', false).near).toBe(0);
    expect(pathProfile('flieger', true).near).toBe(PATH_NEAR_DOOR);
    // The bits sit above every other word bit (a Uint16 word).
    expect(PATH_NEAR_BITS & (PATH_LINK | PATH_DOOR | PATH_CONNECTOR)).toBe(0);
    expect(PATH_NEAR_BITS >>> 16).toBe(0);
  });
});
