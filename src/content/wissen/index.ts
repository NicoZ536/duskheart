/**
 * Knowledge entries of every strand (Wissen tab of the chronicle; docs/SPIEL.md §23, ADR-0207; collection `knowledge` in
 * src/content/index.ts, schema `KnowledgeDef` in src/content/chronik/schema.ts). An aggregation file: each strand writes its
 * entries into `src/content/wissen/<bereich>.ts` and adds one import and one spread here; G its own (`kern.ts`, `m3_m6.ts`).
 */
import type { KnowledgeInput } from '../chronik/schema';
import { KNOWLEDGE_B } from './orte';
import { KNOWLEDGE_A } from './klang';
import { KNOWLEDGE_F } from './leuchtfeuer';
import { KNOWLEDGE_D } from './feld';
import { KNOWLEDGE_E } from './kueche';
import { KNOWLEDGE_C } from './gewoelbe';
import { KNOWLEDGE_G_KERN } from './kern';
import { KNOWLEDGE_G_M3_M6 } from './m3_m6';
import { KNOWLEDGE_I } from './figur';

/** Every knowledge entry. */
export const KNOWLEDGE: readonly KnowledgeInput[] = [...KNOWLEDGE_B, ...KNOWLEDGE_A, ...KNOWLEDGE_F, ...KNOWLEDGE_D, ...KNOWLEDGE_E, ...KNOWLEDGE_C, ...KNOWLEDGE_G_KERN, ...KNOWLEDGE_G_M3_M6, ...KNOWLEDGE_I];
