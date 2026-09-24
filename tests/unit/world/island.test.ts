/**
 * M2-04 (world plan step 1, MASTERPROMPT §9.2.1): island mask from noise + falloff with bays,
 * peninsulas and offshore islets, over 20 seeds × 3 sizes.
 */
import { describe, expect, it } from 'vitest';
import { fnv1a64Hex } from '../../../src/engine/binary';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { ISLAND } from '../../../src/world/gen/plan/params';
import { MAIN_LANDMASS, generateIsland, neighbour4, type IslandMask } from '../../../src/world/gen/plan';

const SEEDS = Array.from({ length: 20 }, (_, i) => 7 + i * 7919);

/** Andrew's monotone chain: area of the convex hull of the land cell corners [cells²]. */
function hullArea(mask: IslandMask): number {
  const pts: [number, number][] = [];
  const { width } = mask.grid;
  for (let c = 0; c < mask.grid.count; c++) {
    if (mask.landmass[c] !== MAIN_LANDMASS) continue;
    const x = c % width;
    const y = Math.floor(c / width);
    pts.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const h: [number, number][] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2] as [number, number], h[h.length - 1] as [number, number], p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i] as [number, number];
    const b = hull[(i + 1) % hull.length] as [number, number];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

/** Coast length of the main island [cell edges]. */
function coastEdges(mask: IslandMask): number {
  let edges = 0;
  for (let c = 0; c < mask.grid.count; c++) {
    if (mask.landmass[c] !== MAIN_LANDMASS) continue;
    for (let d = 0; d < 4; d++) {
      const n = neighbour4(mask.grid, c, d);
      if (n < 0 || mask.land[n] === 0) edges++;
    }
  }
  return edges;
}

describe('island mask (M2-04)', () => {
  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const masks = SEEDS.map((seed) => generateIsland(seed, 0, preset));

      it('is deterministic per seed and differs between seeds', () => {
        const again = generateIsland(SEEDS[0] as number, 0, preset);
        expect(fnv1a64Hex(again.land, again.landmass)).toBe(fnv1a64Hex((masks[0] as IslandMask).land, (masks[0] as IslandMask).landmass));
        const hashes = new Set(masks.map((m) => fnv1a64Hex(m.land)));
        expect(hashes.size).toBe(SEEDS.length);
      });

      it('keeps a sea margin and has no enclosed sea', () => {
        for (const m of masks) {
          const { width, height, cellTiles } = m.grid;
          const margin = Math.ceil(ISLAND.edgeMarginTiles / cellTiles);
          let landInMargin = 0;
          for (let c = 0; c < m.grid.count; c++) {
            const x = c % width;
            const y = Math.floor(c / width);
            if ((x < margin || y < margin || x >= width - margin || y >= height - margin) && m.land[c] === 1) landInMargin++;
          }
          expect(landInMargin).toBe(0);
          // Every sea cell is connected to the world edge (lakes come from the hydrology step).
          const seen = new Uint8Array(m.grid.count);
          const queue = [0];
          seen[0] = 1;
          while (queue.length > 0) {
            const c = queue.pop() as number;
            for (let d = 0; d < 4; d++) {
              const n = neighbour4(m.grid, c, d);
              if (n >= 0 && seen[n] === 0 && m.land[n] === 0) {
                seen[n] = 1;
                queue.push(n);
              }
            }
          }
          let enclosed = 0;
          for (let c = 0; c < m.grid.count; c++) if (m.land[c] === 0 && seen[c] === 0) enclosed++;
          expect(enclosed).toBe(0);
        }
      });

      it('has one main island with a plausible share of land and offshore islets', () => {
        for (const m of masks) {
          const land = m.landmassSizes.reduce((a, b) => a + b, 0);
          const fraction = land / m.grid.count;
          expect(fraction).toBeGreaterThan(0.28);
          expect(fraction).toBeLessThan(0.6);
          expect((m.landmassSizes[MAIN_LANDMASS] as number) / land).toBeGreaterThan(0.9);
          expect(m.landmassSizes.length - 1).toBeGreaterThanOrEqual(ISLAND.minIslets[preset]);
          for (const size of m.landmassSizes) expect(size).toBeGreaterThanOrEqual(ISLAND.minIsletCells);
          // Landmass ids are sorted by size (0 = main island).
          for (let i = 1; i < m.landmassSizes.length; i++) expect(m.landmassSizes[i] as number).toBeLessThanOrEqual(m.landmassSizes[i - 1] as number);
        }
      });

      it('has a coast with bays and peninsulas (not a disc)', () => {
        for (const m of masks) {
          const area = m.landmassSizes[MAIN_LANDMASS] as number;
          // A disc has solidity ≈ 1; bays and peninsulas leave sea inside the convex hull.
          expect(area / hullArea(m)).toBeLessThan(0.9);
          // Cell staircases make a disc ≈ 4/π ≈ 1,27 × longer than its circle; a frayed coast is longer still.
          const circle = 2 * Math.sqrt(Math.PI * area);
          expect(coastEdges(m) / circle).toBeGreaterThan(1.6);
        }
      });
    });
  }
});
