/**
 * M2-04 (world plan step 1, MASTERPROMPT §9.2.1): island mask from noise + falloff with bays,
 * peninsulas and offshore islets, over 20 seeds × 3 sizes. The cases live in `island-groessen.ts`: Klein here, Mittel and
 * Groß in tests/integration/island-groessen.test.ts (M7-75).
 */
import { describe } from 'vitest';
import { islandSizes } from './island-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('island mask (M2-04)', () => {
  islandSizes(UNIT_SIZES);
});
