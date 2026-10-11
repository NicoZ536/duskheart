/**
 * The trigger evaluator (docs/SPIEL.md §17 "Auslöser-Sprache", ADR-0207; strand G): event triggers count matching events
 * from the moment they are armed (a step active, an achievement open; saved as `counts` + `done`), state-like triggers read the
 * world through `TriggerWorld` on the world tick and after matching events. Used by stats, achievements, chronicle, quests
 * and guide – all observers (`observeStep`, src/game/observe.ts).
 */
import type { Trigger } from '../../content/schema/trigger';
import type { SimEventMap } from '../sim';

/** What state triggers read (filled by G from the systems; read-only). */
export interface TriggerWorld {
  /** Value of a statistic; `key` a key of a keyed one, `'*'` the number of distinct keys counted so far (src/game/stats). */
  statValue(stat: string, key?: string): number;
  carried(item: string): number;
  conditionActive(id: string): boolean;
  day(): number;
  hour(): number;
  playerLightLevel(): number;
  playerIndoors(): boolean;
  playerRoomType(): string | null;
  unlocked(id: string): boolean;
  questStatus(quest: string, step?: string): 'offen' | 'aktiv' | 'erledigt';
  placesDiscovered(type: string): number;
}
/**
 * An armed trigger: event counters start when it is armed (step active, achievement open). Saved as `counts` + `done`.
 * `counts` holds one counter per event leaf in depth-first order (a combination can wait for several events); `count` is the
 * first leaf's counter (the whole count of a plain event trigger).
 */
export interface ArmedTrigger {
  readonly trigger: Trigger;
  count: number;
  done: boolean;
  readonly counts: number[];
}
export interface TriggerEvaluator {
  /** Counts `payload` on every event leaf of `armed` it matches; true when a counter moved. */
  onEvent<K extends keyof SimEventMap>(armed: ArmedTrigger, type: K, payload: SimEventMap[K]): boolean;
  /** State-like parts (checked every world tick and after matching events). */
  check(armed: ArmedTrigger, world: TriggerWorld): boolean;
}
