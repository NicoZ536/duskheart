/**
 * M2-07 (MASTERPROMPT §9.1/§9.2.4): height levels, cliffs, ramps and stairs – the sweep cases of `tests/unit/world/height.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { heightSizes } from '../unit/world/height-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('height field, cliffs, ramps and stairs (M2-07)', () => {
  heightSizes(INTEGRATION_SIZES);
});
