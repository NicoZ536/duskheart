/**
 * M2-04 (MASTERPROMPT §9.2.1): island mask – the sweep cases of `tests/unit/world/island.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { islandSizes } from '../unit/world/island-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('island mask (M2-04)', () => {
  islandSizes(INTEGRATION_SIZES);
});
