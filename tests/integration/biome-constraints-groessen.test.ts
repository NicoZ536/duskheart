/**
 * M2-05 / M2-06 (MASTERPROMPT §9.2.3): biome assignment by constraint solver – the sweep cases of `tests/unit/world/biome-constraints.test.ts` for every size beyond the
 * Klein world (`INTEGRATION_SIZES`: Mittel, Groß), unchanged (M7-75, ADR-0036 rule 1 "Sweeps in die Integration"):
 * `npm run verify` runs them here, `npm run check` runs the Klein cases in the unit file.
 */
import { describe } from 'vitest';
import { biomeSizes } from '../unit/world/biome-constraints-groessen';
import { INTEGRATION_SIZES } from '../unit/world/weltgroessen';

describe('biome assignment (M2-05, M2-06)', () => {
  biomeSizes(INTEGRATION_SIZES);
});
