/**
 * M2-11 acceptance, roads (MASTERPROMPT §9.2.8): decayed Builder roads connect the beacon sites
 * (and the Nachtherz) "als Orientierung".
 * - 3 seeds × 3 sizes: the network joins all seven sites; every route runs over walkable main-island
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
import { cellCenterX, cellCenterY, neighbour4 } from '../../../src/world/gen/plan/grid';
import { MAIN_LANDMASS } from '../../../src/world/gen/plan/island';
import { generateChunk } from '../../../src/world/gen/chunk';
import { BEACON_BIOMES, createCellInfo, type LocationSlot } from '../../../src/world/gen/locations';
import { ROADS } from '../../../src/world/gen/roads';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';

const SEEDS = [101, 202, 303];
const PRESETS = ['small', 'medium', 'large'] as const;
const TIMEOUT_MS = 60_000;
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

/** Union-find over the roads: whether they join every terminal. */
function joinsAll(w: GeneratedWorld): boolean {
  const parent = new Map<number, number>(w.roads.terminals.map((t) => [t, t]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const r of w.roads.roads) parent.set(find(r.from), find(r.to));
  return new Set(w.roads.terminals.map(find)).size === 1;
}

describe('Erbauer-Straßen (3 Seeds × 3 Größen)', () => {
  for (const preset of PRESETS) {
    describe(preset, () => {
      const worlds = SEEDS.map((seed) => generateWorld(seed, preset));

      it('verbinden alle Leuchtfeuer-Stätten und das Nachtherz', () => {
        for (const w of worlds) {
          const sites = w.locations.filter((s) => s.type === 'leuchtfeuer' || s.type === 'nachtherz').map((s) => s.id);
          expect([...w.roads.terminals].sort((a, b) => a - b)).toEqual(sites.sort((a, b) => a - b));
          expect(sites).toHaveLength(BEACON_BIOMES.length + 1);
          expect(w.roads.connected).toBe(true);
          expect(joinsAll(w)).toBe(true);
          // A spanning tree: one road less than sites.
          expect(w.roads.roads).toHaveLength(sites.length - 1);
        }
      }, TIMEOUT_MS);

      it('führen über begehbares Land, wechseln die Höhe nur über Rampen und Treppen', () => {
        for (const w of worlds) {
          const { plan } = w;
          const { grid } = plan;
          const ctx = createSurfaceContext(plan);
          const cells = createCellInfo(ctx);
          const ramps = new Set(plan.ramps.flatMap((r) => [`${r.low}:${r.high}`, `${r.high}:${r.low}`]));
          let length = 0;
          for (const road of w.roads.roads) {
            const path = Array.from(road.cells);
            const from = w.locations[road.from] as LocationSlot;
            const to = w.locations[road.to] as LocationSlot;
            expect(path[0]).toBe(Math.floor(from.y / grid.cellTiles) * grid.width + Math.floor(from.x / grid.cellTiles));
            expect(path[path.length - 1]).toBe(Math.floor(to.y / grid.cellTiles) * grid.width + Math.floor(to.x / grid.cellTiles));
            for (let i = 0; i < path.length; i++) {
              const c = path[i] as number;
              expect(cells.walk[c], `Zelle ${c}`).toBe(1);
              expect(plan.landmass[c]).toBe(MAIN_LANDMASS);
              if (i === 0) continue;
              const p = path[i - 1] as number;
              const dx = (c % grid.width) - (p % grid.width);
              const dy = Math.floor(c / grid.width) - Math.floor(p / grid.width);
              expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
              const lp = plan.level[p] as number;
              const lc = plan.level[c] as number;
              if (dx !== 0 && dy !== 0) {
                expect(lc).toBe(lp);
                expect(plan.riverCell[c] === 1 || plan.riverCell[p] === 1).toBe(false);
              } else if (lc !== lp) {
                expect(Math.abs(lc - lp)).toBe(1);
                expect(ramps.has(`${p}:${c}`), `Stufe ${p} → ${c} ohne Rampe`).toBe(true);
                expect([0, 1, 2, 3].some((d) => neighbour4(grid, p, d) === c)).toBe(true);
              }
            }
            // Polyline: from site cell centre to site cell centre, level ranges ordered.
            expect(road.xs[0]).toBeCloseTo(cellCenterX(grid, path[0] as number), 3);
            expect(road.ys[road.ys.length - 1]).toBeCloseTo(cellCenterY(grid, path[path.length - 1] as number), 3);
            for (let i = 0; i < road.xs.length; i++) expect(road.levelMin[i] as number).toBeLessThanOrEqual(road.levelMax[i] as number);
            for (let i = 1; i < road.xs.length; i++) length += Math.hypot((road.xs[i] as number) - (road.xs[i - 1] as number), (road.ys[i] as number) - (road.ys[i - 1] as number));
          }
          expect(w.roads.lengthTiles).toBeCloseTo(length, 0);
          expect(w.report.roads.lengthTiles).toBe(w.roads.lengthTiles);
        }
      }, TIMEOUT_MS);
    });
  }
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
