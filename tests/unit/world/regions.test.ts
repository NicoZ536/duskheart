/**
 * M2-04 (world plan step 2, MASTERPROMPT §9.2.2): Poisson regions (≈ 40 / 70 / 110) → Voronoi →
 * region graph, over 20 seeds × 3 sizes: region count within ±10 %, connected graph, contiguous
 * regions, every land cell in exactly one region.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { CELL_BAND, CELL_INTERIOR, CELL_SEA, NO_REGION, cellAtTile, generateIsland, generateRegions, neighbour4, type IslandMask, type RegionMap } from '../../../src/world/gen/plan';

const SEEDS = Array.from({ length: 20 }, (_, i) => 11 + i * 104729);
/** Smallest region the generator may produce [cells]; ≈ 1 000 tiles², room for a camp and a resource cluster. */
const MIN_REGION_CELLS = 16;

function breadthFirst(n: number, neighbours: (u: number) => readonly number[], start: number): Uint8Array {
  const seen = new Uint8Array(n);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const u = queue.pop() as number;
    for (const v of neighbours(u)) {
      if (seen[v] === 0) {
        seen[v] = 1;
        queue.push(v);
      }
    }
  }
  return seen;
}

describe('Poisson regions, Voronoi and region graph (M2-04)', () => {
  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const stages = SEEDS.map((seed) => {
        const island = generateIsland(seed, 0, preset);
        return { island, map: generateRegions(seed, 0, preset, island) };
      });

      it(`has ${BALANCE.world.regionCount[preset]} ± 10 % regions`, () => {
        const target = BALANCE.world.regionCount[preset];
        for (const { map } of stages) {
          expect(map.target).toBe(target);
          expect(map.regions.length).toBeGreaterThanOrEqual(Math.ceil(target * 0.9));
          expect(map.regions.length).toBeLessThanOrEqual(Math.floor(target * 1.1));
        }
      });

      it('has a connected region graph whose edges match the cell borders', () => {
        for (const { map } of stages) {
          const seen = breadthFirst(map.regions.length, (u) => map.neighbours[u] as readonly number[], 0);
          expect(seen.every((v) => v === 1)).toBe(true);
          // Every land border between two regions is an edge; crossings only join regions of different landmasses.
          const border = new Set<string>();
          for (let c = 0; c < map.grid.count; c++) {
            const r = map.region[c] as number;
            if (r < 0) continue;
            for (let d = 0; d < 2; d++) {
              const n = neighbour4(map.grid, c, d);
              const q = n < 0 ? -1 : (map.region[n] as number);
              if (q >= 0 && q !== r) border.add(`${Math.min(r, q)}:${Math.max(r, q)}`);
            }
          }
          const landEdges = map.edges.filter((e) => !e.crossing).map((e) => `${e.a}:${e.b}`);
          expect(new Set(landEdges)).toEqual(border);
          for (const e of map.edges) {
            expect(e.a).toBeLessThan(e.b);
            const a = map.regions[e.a];
            const b = map.regions[e.b];
            // A sea crossing joins two landmasses (a detached region may own islet cells on the other side).
            if (e.crossing && a !== undefined && b !== undefined && !a.detached && !b.detached) expect(a.landmass).not.toBe(b.landmass);
            expect(map.neighbours[e.a]).toContain(e.b);
            expect(map.neighbours[e.b]).toContain(e.a);
          }
        }
      });

      it('assigns every land cell to exactly one region of its own kind, and no sea cell', () => {
        for (const { island, map } of stages) {
          let wrong = 0;
          for (let c = 0; c < map.grid.count; c++) {
            const r = map.region[c] as number;
            if (island.land[c] === 1) {
              if (r < 0 || r >= map.regions.length) wrong++;
              else if ((map.cellKind[c] === CELL_BAND) !== (map.regions[r]?.kind === 'band')) wrong++;
            } else if (r !== NO_REGION || map.cellKind[c] !== CELL_SEA) wrong++;
          }
          expect(wrong).toBe(0);
        }
      });

      it('builds contiguous regions around their seeds (islets without a seed are the only detached parts)', () => {
        for (const { island, map } of stages) {
          checkContiguous(island, map);
        }
      });

      it('has no degenerate regions and a ring of coastal segments', () => {
        for (const { island, map } of stages) {
          for (const r of map.regions) expect(r.cells).toBeGreaterThanOrEqual(MIN_REGION_CELLS);
          const ring = map.regions.filter((r) => r.kind === 'band').length;
          expect(ring).toBeGreaterThanOrEqual(Math.round(map.target * 0.2));
          // The coastal band covers the whole shore of the main island; the interior never touches the sea.
          let shoreInterior = 0;
          for (let c = 0; c < map.grid.count; c++) {
            if (island.landmass[c] !== 0 || map.cellKind[c] !== CELL_INTERIOR) continue;
            for (let d = 0; d < 4; d++) {
              const n = neighbour4(map.grid, c, d);
              if (n >= 0 && island.land[n] === 0) shoreInterior++;
            }
          }
          expect(shoreInterior).toBe(0);
        }
      });
    });
  }
});

function checkContiguous(island: IslandMask, map: RegionMap): void {
  const { grid } = map;
  for (const r of map.regions) {
    const seedCell = cellAtTile(grid, r.seedX, r.seedY);
    expect(map.region[seedCell]).toBe(r.id);
    // Flood fill from the seed inside the region.
    const seen = new Uint8Array(grid.count);
    const queue = [seedCell];
    seen[seedCell] = 1;
    let reached = 1;
    while (queue.length > 0) {
      const c = queue.pop() as number;
      for (let d = 0; d < 4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || seen[n] === 1 || map.region[n] !== r.id) continue;
        seen[n] = 1;
        reached++;
        queue.push(n);
      }
    }
    let onSeedLandmass = 0;
    let elsewhere = 0;
    for (let c = 0; c < grid.count; c++) {
      if (map.region[c] !== r.id) continue;
      if (island.landmass[c] === r.landmass) onSeedLandmass++;
      else elsewhere++;
    }
    expect(reached).toBe(onSeedLandmass);
    expect(elsewhere > 0).toBe(r.detached);
  }
}
