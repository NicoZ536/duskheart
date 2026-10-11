/**
 * Statistics, their sources and the milestones of every strand (docs/SPIEL.md §17, §23, ADR-0207; collections `stats`,
 * `statSources`, `milestones` in src/content/index.ts). An aggregation file: each strand writes its sources (and milestones)
 * into `src/content/stats/<bereich>.ts` and adds one import and one spread per list here; G defines the statistics of §29
 * (`kern.ts`).
 */
import type { MilestoneInput, StatInput, StatSourceInput } from './schema';
import { MILESTONES_G, STAT_SOURCES_G, STATS_G } from './kern';
import { STAT_SOURCES_C } from './gewoelbe';

/** Every statistic. */
export const STATS: readonly StatInput[] = [...STATS_G];
/** Every statistic source (event → counter). */
export const STAT_SOURCES: readonly StatSourceInput[] = [...STAT_SOURCES_G, ...STAT_SOURCES_C];
/** Every milestone (pacing). */
export const MILESTONES: readonly MilestoneInput[] = [...MILESTONES_G];
