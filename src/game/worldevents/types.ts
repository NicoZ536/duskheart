/**
 * World events at runtime (docs/SPIEL.md §18, ADR-0207; strand B, system `world-events`): the phases of every registered
 * event (`ruhe` → `angekuendigt` → `aktiv` → `ruhe`), at most one big event at a time, the eclipse's daylight factor
 * (also a `Calendar` daylight modifier), lightning and forest fires. Saved per event (participant `world-events`).
 */
export const WORLD_EVENT_PHASES = ['ruhe', 'angekuendigt', 'aktiv'] as const;
export type WorldEventPhase = (typeof WORLD_EVENT_PHASES)[number];
export interface WorldEventState {
  readonly id: string;
  phase: WorldEventPhase;
  announceTick: number;
  startTick: number;
  endTick: number;
}
export interface WorldEventsApi {
  phase(id: string): WorldEventPhase;
  /** The running big event, or null. */
  activeBig(): string | null;
  /** Daylight factor 0–1 of the eclipse at `minute` (1 = no effect); also registered as `Calendar.addDaylightModifier`. */
  daylightFactor(minute: number): number;
}
// src/world/calendar.ts (B, additive): addDaylightModifier(fn: DaylightModifier): void – the product of all modifiers scales the daylight.
