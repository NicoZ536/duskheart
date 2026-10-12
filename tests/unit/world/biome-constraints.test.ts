/**
 * M2-05 / M2-06 (world plan step 3, MASTERPROMPT §9.2.3): biome assignment by constraint solver.
 * Every rule is checked over 20 seeds × 3 sizes (`biome-constraints-groessen.ts`: Klein here, Mittel and Groß in
 * tests/integration/biome-constraints-groessen.test.ts – M7-75) with independent re-implementations (no solver code
 * is reused for the checks):
 * - Grundregeln (M2-05): Grünhain start on the south coast, tier grows with the graph distance
 *   (with jitter), every biome several times, no tier skipped.
 * - Klimaregeln (M2-06): Salzküste as coastal ring, Frostkamm north or high, Glutsand dry in the
 *   south/east and away from the Nebelmoor, Aschenschlund next to Frostkamm or Glutsand, Scherbenhain
 *   as ring around the Nachtherz in the farthest region.
 */
import { describe, expect, it } from 'vitest';
import { isolatedVolcanicAreas, regionGraph, unreachableByTier, missingTiers } from '../../../src/world/gen/plan/biomes';
import { biomeSizes } from './biome-constraints-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('biome constraint solver – rule helpers', () => {
  // Path graph 0 – 1 – 2 – 3.
  const path = [[1], [0, 2], [1, 3], [2]];
  it('counts regions only reachable through a harder tier', () => {
    expect(unreachableByTier(regionGraph(path), [0, 1, 2, 3], 0, 3)).toBe(0);
    // Region 2 (tier 1) hides behind region 1 (tier 3): cut off for k = 1 and k = 2.
    expect(unreachableByTier(regionGraph(path), [0, 3, 1, 3], 0, 3)).toBe(2);
  });
  it('counts missing tiers', () => {
    expect(missingTiers([0, 1, 2, 3], 3)).toBe(0);
    expect(missingTiers([0, 0, 3, 3], 3)).toBe(2);
  });
  it('counts Aschenschlund areas without Frostkamm or Glutsand neighbour', () => {
    const cluster = new Int32Array(4);
    const queue = new Int32Array(4);
    const noBand = [0, 0, 0, 0];
    // 5 – 5 – 3: one area, borders Frostkamm.
    expect(isolatedVolcanicAreas(regionGraph(path), [2, 5, 5, 3], noBand, cluster, queue)).toBe(0);
    // 5 – 2 – 5 – 1: two areas, neither borders tier 3 or 4.
    expect(isolatedVolcanicAreas(regionGraph(path), [5, 2, 5, 1], noBand, cluster, queue)).toBe(2);
  });
});

describe('biome assignment (M2-05, M2-06)', () => {
  biomeSizes(UNIT_SIZES);
});
