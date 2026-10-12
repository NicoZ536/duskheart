/**
 * M2-11 (MASTERPROMPT §9.2.8, §20.2, §21): location slots – the sweep cases of `tests/unit/world/locations.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { locationSizes } from '../unit/world/locations-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('Orts-Slots (3 Seeds × 3 Größen)', () => {
  locationSizes(INTEGRATION_SIZES);
});
