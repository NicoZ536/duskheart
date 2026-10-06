/**
 * Funke comments and context hints of every strand (docs/SPIEL.md §17, §23, ADR-0207; collection `guideHints` in
 * src/content/index.ts). An aggregation file: each strand writes its hints into `src/content/guide/<bereich>.ts` and adds one
 * import and one spread here; G its own (`kern.ts`, `m3_m6.ts`).
 */
import type { GuideHintInput } from './schema';
import { GUIDE_HINTS_B } from './orte';
import { GUIDE_HINTS_A } from './klang';
import { GUIDE_HINTS_F } from './leuchtfeuer';
import { GUIDE_HINTS_D } from './feld';

/** Every hint. */
export const GUIDE_HINTS: readonly GuideHintInput[] = [...GUIDE_HINTS_B, ...GUIDE_HINTS_A, ...GUIDE_HINTS_F, ...GUIDE_HINTS_D];
