/**
 * M2-04 (world plan step 2, MASTERPROMPT §9.2.2): Poisson regions (≈ 40 / 70 / 110) → Voronoi →
 * region graph, over 20 seeds × 3 sizes: region count within ±10 %, connected graph, contiguous
 * regions, every land cell in exactly one region. The cases live in `regions-groessen.ts`: Klein here, Mittel and Groß
 * in tests/integration/regions-groessen.test.ts (M7-75).
 */
import { describe } from 'vitest';
import { regionSizes } from './regions-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('Poisson regions, Voronoi and region graph (M2-04)', () => {
  regionSizes(UNIT_SIZES);
});
