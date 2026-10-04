/**
 * The mechanics register of every strand (docs/SPIEL.md §23 "Vermittlungs-Register", M7-45, ADR-0175; collection `mechanics`
 * in src/content/index.ts). An aggregation file: each strand registers the mechanics it builds in
 * `src/content/vermittlung/<bereich>.ts` and adds one import and one spread here; G the mechanics up to M6 (`m3_m6.ts`).
 */
import type { MechanicInput } from './schema';

/** Every mechanic with its hint, knowledge entry and tooltip. */
export const MECHANICS: readonly MechanicInput[] = [];
