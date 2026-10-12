/**
 * M2-04 (MASTERPROMPT §9.2.2): Poisson regions, Voronoi and region graph – the sweep cases of `tests/unit/world/regions.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { regionSizes } from '../unit/world/regions-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('Poisson regions, Voronoi and region graph (M2-04)', () => {
  regionSizes(INTEGRATION_SIZES);
});
