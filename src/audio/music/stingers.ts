/**
 * Stingers: short musical phrases over the music at the game's moments (M7-04; docs/SPIEL.md §24 "Stinger: Entdeckung,
 * Leuchtfeuer, Boss besiegt, Stufenaufstieg, Ereignis"). `STINGER_EVENTS` names the simulation event that plays each
 * (content `stingers`, src/content/music/stinger.ts: the piece and how far the music ducks under it). Events another strand
 * has not registered yet (`worldEventAnnounced` of the world events, M7-38) are subscribed once they appear in
 * `SIM_EVENT_TYPES` (`stingerEventTypes`).
 *
 * `StingerQueue`: one stinger sounds at a time; one more may wait for it (the more important one wins the place, by
 * `STINGER_PRIORITY`), and a stinger asked for while the player plays an instrument or lies dead is dropped – the moment
 * passed. A stinger waits at most `STINGER_WAIT_SECONDS` (still rendering, or behind another one).
 */
import { STINGERS } from '../../content/music/index';
import type { StingerInput } from '../../content/music/schema';
import type { StingerTable } from './types';

/** Simulation event → stinger id. */
export const STINGER_EVENTS: StingerTable = {
  placeDiscovered: 'entdeckung',
  beaconLit: 'leuchtfeuer',
  bossDefeated: 'boss_besiegt',
  skillLevelUp: 'stufenaufstieg',
  worldEventAnnounced: 'ereignis',
};

/** Importance of the stingers, highest first (the waiting place goes to the more important one). */
export const STINGER_PRIORITY: readonly string[] = ['boss_besiegt', 'leuchtfeuer', 'ereignis', 'entdeckung', 'stufenaufstieg'];

/** Longest wait of a stinger for its turn [s] (afterwards the moment has passed). */
export const STINGER_WAIT_SECONDS = 4;

/** The events of `STINGER_EVENTS` the simulation knows (`known`: `SIM_EVENT_TYPES`). */
export function stingerEventTypes(known: readonly string[]): string[] {
  return Object.keys(STINGER_EVENTS).filter((type) => known.includes(type));
}

/** The stinger definitions by id. */
export const STINGER_BY_ID: ReadonlyMap<string, StingerInput> = new Map(STINGERS.map((s) => [s.id, s]));

/** The waiting place in front of the stingers (see module comment). */
export class StingerQueue {
  private waiting: StingerInput | null = null;
  private since = 0;

  /** The stinger waiting for its turn, or null. */
  get pending(): StingerInput | null {
    return this.waiting;
  }

  /** Asks for stinger `id` at audio time `now`; returns whether it waits now. */
  request(id: string, now: number): boolean {
    const def = STINGER_BY_ID.get(id);
    if (def === undefined) return false;
    if (this.waiting !== null && now - this.since <= STINGER_WAIT_SECONDS && STINGER_PRIORITY.indexOf(this.waiting.id) <= STINGER_PRIORITY.indexOf(id)) return false;
    this.waiting = def;
    this.since = now;
    return true;
  }

  /**
   * The stinger to start now, or null: none waits, the previous still sounds (`busy`), or it waited too long (dropped).
   * `ready(def)` says whether its piece is loaded.
   */
  take(now: number, busy: boolean, ready: (def: StingerInput) => boolean): StingerInput | null {
    const w = this.waiting;
    if (w === null) return null;
    if (now - this.since > STINGER_WAIT_SECONDS) {
      this.waiting = null;
      return null;
    }
    if (busy || !ready(w)) return null;
    this.waiting = null;
    return w;
  }

  /** Drops the waiting stinger (the player makes music, or died). */
  clear(): void {
    this.waiting = null;
  }
}
