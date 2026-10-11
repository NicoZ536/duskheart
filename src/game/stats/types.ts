/**
 * Statistics (docs/SPIEL.md §23 "Statistiken", ADR-0207; strand G, system `stats`, an observer): counters from the statistic
 * sources of every strand (src/content/stats/), play time, nights survived, distance, and the play time each milestone was
 * reached at for the pacing measurement. Saved (participant `stats`).
 */
export interface StatsApi {
  value(stat: string, key?: string): number;
  milestoneTime(id: string): number;
}
