/**
 * The world the triggers read (docs/SPIEL.md §17; `TriggerWorld`, src/game/triggers/types.ts): one held object per simulation,
 * filled by `createSimulation` with read-only views of the systems (statistics, bags and equipment, conditions, light at the
 * player, the player's room, unlocks, quests, discovered places). Each observer binds it to the running simulation before it
 * checks its triggers. A view that is not wired (tests of single observers) reads as nothing: 0, false, `null`, `offen`.
 * Nothing here allocates.
 */
import type { Simulation } from '../sim';
import type { TriggerWorld } from './types';

/** Read-only views of the systems, each optional (a missing one reads as nothing). */
export interface TriggerWorldSources {
  stat?(stat: string, key?: string): number;
  carried?(sim: Simulation, item: string): number;
  conditionActive?(id: string): boolean;
  lightLevel?(sim: Simulation): number;
  indoors?(sim: Simulation): boolean;
  roomType?(sim: Simulation): string | null;
  unlocked?(id: string): boolean;
  questStatus?(quest: string, step?: string): 'offen' | 'aktiv' | 'erledigt';
  placesDiscovered?(type: string): number;
}

/** Minutes of an hour (the clock's minute of day → fractional hour). */
const MINUTES_PER_HOUR = 60;

/** The trigger world of one simulation (bind it to the simulation before a check). */
export class SimTriggerWorld implements TriggerWorld {
  /**
   * Counts every change of a statistic (the `stats` system bumps it): an observer that sees it moved since its last check
   * checks its state-like triggers in that step, not only on the world tick – an achievement that reads a statistic unlocks
   * in the step the statistic counted.
   */
  statRevision = 0;
  private sim: Simulation | null = null;
  private readonly src: TriggerWorldSources = {};

  /** Adds or replaces views (`createSimulation` wires them as the systems come). */
  use(sources: TriggerWorldSources): this {
    Object.assign(this.src, sources);
    return this;
  }

  /** The simulation the next checks read. */
  bind(sim: Simulation): this {
    this.sim = sim;
    return this;
  }

  statValue(stat: string, key?: string): number {
    return this.src.stat?.(stat, key) ?? 0;
  }

  carried(item: string): number {
    const sim = this.sim;
    return sim === null ? 0 : (this.src.carried?.(sim, item) ?? 0);
  }

  conditionActive(id: string): boolean {
    return this.src.conditionActive?.(id) ?? false;
  }

  day(): number {
    return this.sim?.clock.day ?? 1;
  }

  /** Hour of the day with its fraction (18.5 = 18:30). */
  hour(): number {
    const sim = this.sim;
    return sim === null ? 0 : sim.clock.minuteOfDay / MINUTES_PER_HOUR;
  }

  playerLightLevel(): number {
    const sim = this.sim;
    return sim === null ? 0 : (this.src.lightLevel?.(sim) ?? 0);
  }

  playerIndoors(): boolean {
    const sim = this.sim;
    return sim !== null && (this.src.indoors?.(sim) ?? false);
  }

  playerRoomType(): string | null {
    const sim = this.sim;
    return sim === null ? null : (this.src.roomType?.(sim) ?? null);
  }

  unlocked(id: string): boolean {
    return this.src.unlocked?.(id) ?? false;
  }

  questStatus(quest: string, step?: string): 'offen' | 'aktiv' | 'erledigt' {
    return this.src.questStatus?.(quest, step) ?? 'offen';
  }

  placesDiscovered(type: string): number {
    return this.src.placesDiscovered?.(type) ?? 0;
  }
}
