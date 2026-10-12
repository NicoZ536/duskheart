/**
 * M2-11 (MASTERPROMPT §9.2.8): Builder roads – the sweep cases of `tests/unit/world/roads.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { roadSizes } from '../unit/world/roads-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('Erbauer-Straßen (3 Seeds × 3 Größen)', () => {
  roadSizes(INTEGRATION_SIZES);
});
