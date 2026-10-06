/**
 * Observers of a simulation step (docs/SPIEL.md §17 "Beobachter", ADR-0207).
 *
 * Statistics, achievements, the chronicle, quests and the guide count what happens – deterministically and saved, headless
 * as in the browser, without relying on the presentation draining the event queue. A system that declares
 * `observeStep` is called once per step after `dailyTick` and `ecs.flushDestroyed()` (and after the dawns of
 * `skipTicks`), in registration order, with a read-only view of the events of the running step:
 *
 * - the view starts at the mark `Simulation.step` takes when the step begins (`EventQueue.size`): events of earlier steps
 *   that nobody drained (headless runs never drain) are never seen again;
 * - it includes the events earlier observers pushed in this pass (an achievement → its chronicle entry in the same step);
 *   one call of `forEach`/`forEachOfType` ends at the size of the queue when it begins, so an observer never receives
 *   the events it pushes itself in that call;
 * - after the pass the mark moves behind everything: a `skipTicks` inside a step (the debug time commands) runs the
 *   observers over what happened up to its dawns, the end of the step over the rest – no event is seen twice.
 *
 * Observers read and count, write only their own state and push their own events. `observeStep` is no time hook: it
 * needs no catch-up declaration (a system that also uses `worldTick` declares `timeScope: 'global'`). Allocation-free:
 * the view is one held object of the simulation, its callbacks are the observer's own held functions.
 */
import type { EventQueue } from '../engine/events';
import type { SimEventMap, Simulation } from './sim';

/** Read-only view of the events pushed during the running step, from the step's start mark on (no allocation). */
export interface StepEvents {
  /** Events of this step so far, including those earlier observers pushed in this step. */
  readonly count: number;
  forEach(cb: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void): void;
  forEachOfType<K extends keyof SimEventMap>(type: K, cb: (payload: SimEventMap[K]) => void): void;
}

/**
 * Added to `SimSystem` (`interface SimSystem extends StepObserver`): called once per step after `dailyTick` and `ecs.flushDestroyed()`,
 * and after the dawns of `skipTicks`, for every system in registration order. Not a time hook (no catch-up declaration needed).
 */
export interface StepObserver {
  observeStep?(sim: Simulation, events: StepEvents): void;
}

/**
 * The simulation's one view of the step's events (`StepEvents`): a window from `start` to the live end of the queue. The
 * simulation moves `start`; observers only read.
 */
export class StepEventWindow implements StepEvents {
  /** First index of the window (events since the last drain, in push order). */
  start = 0;

  constructor(private readonly queue: EventQueue<SimEventMap>) {}

  get count(): number {
    const n = this.queue.size - this.start;
    return n > 0 ? n : 0;
  }

  forEach(cb: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void): void {
    this.queue.forEachFrom(this.start, cb);
  }

  forEachOfType<K extends keyof SimEventMap>(type: K, cb: (payload: SimEventMap[K]) => void): void {
    this.queue.forEachOfTypeFrom(this.start, type, cb);
  }
}
