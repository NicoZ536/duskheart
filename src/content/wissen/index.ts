/**
 * Knowledge entries of every strand (Wissen tab of the chronicle; docs/SPIEL.md §23, ADR-0175; collection `knowledge` in
 * src/content/index.ts, schema `KnowledgeDef` in src/content/chronik/schema.ts). An aggregation file: each strand writes its
 * entries into `src/content/wissen/<bereich>.ts` and adds one import and one spread here; G its own (`kern.ts`, `m3_m6.ts`).
 */
import type { KnowledgeInput } from '../chronik/schema';

/** Every knowledge entry. */
export const KNOWLEDGE: readonly KnowledgeInput[] = [];
