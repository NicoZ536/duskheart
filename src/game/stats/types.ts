/**
 * Statistics (docs/SPIEL.md §23 "Statistiken", ADR-0207; strand G, system `stats`, an observer): counters from the statistic
 * sources of every strand (src/content/stats/), play time, nights survived, distance, and the first tick of every milestone
 * for the pacing measurement. Saved (participant `stats`).
 */
export interface StatsApi {
  value(stat: string, key?: string): number;
  milestoneTick(id: string): number;
}
