/**
 * M2-11 acceptance, roads (MASTERPROMPT §9.2.8): decayed Builder roads connect the beacon sites
 * (and the Nachtherz) "als Orientierung".
 * - 3 seeds × 3 sizes (`roads-groessen.ts`: Klein here, Mittel and Groß in tests/integration/roads-groessen.test.ts –
 *   M7-75): the network joins all seven sites; every route runs over walkable main-island
 *   cells (no sea, lake or lava), changes level only on a ramp or stairs between the two cells,
 *   steps diagonally only on one level away from rivers; the polyline starts and ends at the sites
 *   and its length is the reported length.
 * - Chunks (Klein): along the centre line of every road the paved tiles (`strasse` + road flag) form
 *   most of the road but not all of it (decay); paved tiles are dry and free of objects, tiles over
 *   river water are bridges, and no paved tile lies off the road's level range.
 */
import { describe, expect, it } from 'vitest';
import { TILE_FLAG_BRIDGE, TILE_FLAG_ROAD, WATER_RIVER, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { generateChunk } from '../../../src/world/gen/chunk';
import { ROADS } from '../../../src/world/gen/roads';
import { generateWorld } from '../../../src/world/gen/world';
import { TIMEOUT_MS, roadSizes } from './roads-groessen';
import { UNIT_SIZES } from './weltgroessen';

/** Paved share of the centre line: "zerfallen" (some pavement missing), still a road to follow [fraction]. */
const PAVED_MIN = 0.5;
const PAVED_MAX = 0.95;
/** Sample step along the polyline [tiles]. */
const STEP_TILES = 0.5;
/** Rounding slack of squared distances [tiles²]. */
const EPS = 1e-9;

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by) [tiles²]. */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  return (ax + vx * t - px) ** 2 + (ay + vy * t - py) ** 2;
}

describe('Erbauer-Straßen (3 Seeds × 3 Größen)', () => {
  roadSizes(UNIT_SIZES);
});

describe('Straßen in den Chunks (Klein)', () => {
  it('zerfallenes Pflaster entlang der Mittellinie, trocken und frei, Brücken über Flüssen', () => {
    const w = generateWorld(20260924, 'small');
    const ids = contentWorldIdTables();
    const strasse = ids.terrain.runtimeId('strasse');
    const n = w.plan.grid.tiles / CHUNK_SIZE;
    const cache = new Map<number, ChunkData>();
    const at = (x: number, y: number): { chunk: ChunkData; i: number } => {
      const key = Math.floor(y / CHUNK_SIZE) * n + Math.floor(x / CHUNK_SIZE);
      let chunk = cache.get(key);
      if (chunk === undefined) {
        chunk = generateChunk(w, 0, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
        cache.set(key, chunk);
      }
      return { chunk, i: (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE) };
    };
    let dry = 0;
    let paved = 0;
    let bridges = 0;
    const seen = new Set<number>();
    const bad: string[] = [];
    for (const road of w.roads.roads) {
      for (let k = 1; k < road.xs.length; k++) {
        const x0 = road.xs[k - 1] as number;
        const y0 = road.ys[k - 1] as number;
        const x1 = road.xs[k] as number;
        const y1 = road.ys[k] as number;
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP_TILES));
        for (let s = 0; s <= steps; s++) {
          const tx = Math.floor(x0 + ((x1 - x0) * s) / steps);
          const ty = Math.floor(y0 + ((y1 - y0) * s) / steps);
          const key = ty * w.plan.grid.tiles + tx;
          if (seen.has(key)) continue;
          seen.add(key);
          const { chunk, i } = at(tx, ty);
          const flags = chunk.flags[i] as number;
          const water = chunk.water[i] as number;
          const level = chunk.height[i] as number;
          const lmin = Math.min(road.levelMin[k - 1] as number, road.levelMin[k] as number);
          const lmax = Math.max(road.levelMax[k - 1] as number, road.levelMax[k] as number);
          if ((water & WATER_RIVER) !== 0) {
            if ((flags & TILE_FLAG_BRIDGE) === 0) bad.push(`${tx},${ty}: Fluss ohne Brücke`);
            bridges++;
            continue;
          }
          if (water !== 0 || level < lmin || level > lmax) continue;
          dry++;
          if ((flags & TILE_FLAG_ROAD) === 0) continue;
          paved++;
          if (chunk.ground[i] !== strasse) bad.push(`${tx},${ty}: Straßenflag ohne Pflaster`);
          if (chunk.object[i] !== 0) bad.push(`${tx},${ty}: Objekt auf der Straße`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(paved / dry).toBeGreaterThan(PAVED_MIN);
    expect(paved / dry).toBeLessThan(PAVED_MAX);
    // Every road tile of the chunks lies within the corridor of a road (tile centre within the half
    // width of a segment on its level) and carries pavement.
    const half2 = ROADS.halfWidthTiles * ROADS.halfWidthTiles + EPS;
    let flagged = 0;
    for (const chunk of cache.values()) {
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        if (((chunk.flags[i] as number) & TILE_FLAG_ROAD) === 0) continue;
        flagged++;
        const x = chunk.cx * CHUNK_SIZE + (i % CHUNK_SIZE) + 0.5;
        const y = chunk.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) + 0.5;
        const level = chunk.height[i] as number;
        const near = w.roads.roads.some((r) => {
          for (let k = 1; k < r.xs.length; k++) {
            const lmin = Math.min(r.levelMin[k - 1] as number, r.levelMin[k] as number);
            const lmax = Math.max(r.levelMax[k - 1] as number, r.levelMax[k] as number);
            if (level < lmin || level > lmax) continue;
            if (segmentDistance2(x, y, r.xs[k - 1] as number, r.ys[k - 1] as number, r.xs[k] as number, r.ys[k] as number) <= half2) return true;
          }
          return false;
        });
        if (!near || chunk.water[i] !== 0 || chunk.ground[i] !== strasse) bad.push(`${chunk.key}#${i}: Straßenkachel abseits oder nass`);
      }
    }
    expect(bad).toEqual([]);
    expect(flagged).toBeGreaterThan(paved);
    expect(bridges + paved).toBeGreaterThan(0);
  }, TIMEOUT_MS);
});
