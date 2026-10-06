/**
 * Chronicle rules of every strand (docs/SPIEL.md §17, ADR-0207; collection `chronicleRules` in src/content/index.ts). An
 * aggregation file: each strand writes its rules into `src/content/chronik/<bereich>.ts` and adds one import and one spread
 * here; G its own (`kern.ts`, `m3_m6.ts`).
 */
import type { ChronicleRuleInput } from './schema';
import { CHRONICLE_RULES_B } from './orte';
import { CHRONICLE_RULES_A } from './klang';
import { CHRONICLE_RULES_F } from './leuchtfeuer';
import { CHRONICLE_RULES_D } from './feld';

/** Every chronicle rule. */
export const CHRONICLE_RULES: readonly ChronicleRuleInput[] = [...CHRONICLE_RULES_B, ...CHRONICLE_RULES_A, ...CHRONICLE_RULES_F, ...CHRONICLE_RULES_D];
