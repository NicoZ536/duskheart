/**
 * M2-08 (MASTERPROMPT §9.2.5): rivers, lakes, fords, streams and springs – the sweep cases of `tests/unit/world/rivers.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { riverSizes } from '../unit/world/rivers-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('rivers, lakes, fords, streams and springs (M2-08)', () => {
  riverSizes(INTEGRATION_SIZES);
});
