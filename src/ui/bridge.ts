/**
 * Signals bridge between the running game session and the Preact UI (docs/ARCHITEKTUR.md
 * "Datenfluss", MASTERPROMPT §3.2 "Präsentation hört auf Events und liest Zustand; sie verändert
 * die Simulation nur über Commands").
 *
 * - Reading: `frame()` runs once per rendered frame. It samples the session status into one reused
 *   record (`GameSession.sampleStatus`, no allocation) and publishes it to read-only signals in a
 *   single `batch`. Signals only notify when a value changed, so a component reading `minuteOfDay`
 *   re-renders once per game minute, not once per tick. Simulation events arrive through
 *   `GameSession.onEvent` after each tick; the bridge keeps only the latest one of interest and
 *   publishes it with the next frame.
 * - Writing: `actions` only queue game commands through `GameSession.command` (validated like a
 *   replay file, applied in the next tick, recorded for replays). The bridge never sees the
 *   simulation object: its session type offers reading, subscribing and queueing, nothing else.
 */
import { batch, signal, type ReadonlySignal } from '@preact/signals';
import { NULL_ENTITY, type Entity } from '../engine/ecs';
import { clamp } from '../engine/math';
import { createSessionStatus, type GameSession } from '../game/session';
import type { SimEventMap } from '../game/sim';

/** The part of a `GameSession` the UI may use: read the status, subscribe to events, queue commands. */
export type UiBridgeSession = Pick<GameSession, 'sampleStatus' | 'onEvent' | 'command'>;

/** Position of the entity steered by `move` commands [px]. */
export interface ControlledView {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
}

/** A command the simulation turned down (payload of the `commandRejected` event). */
export type CommandRejection = SimEventMap['commandRejected'];

/** Read-only view of the simulation for components; updated once per rendered frame. */
export interface UiState {
  /** Completed simulation ticks. */
  readonly tick: ReadonlySignal<number>;
  /** Day number (from 1, changes at midnight). */
  readonly day: ReadonlySignal<number>;
  /** Game minute of the day, 0–1439 (format with `formatGameTime`). */
  readonly minuteOfDay: ReadonlySignal<number>;
  /** Live entities. */
  readonly entities: ReadonlySignal<number>;
  /** The controlled entity and its position, or `null` when nothing is steered. */
  readonly controlled: ReadonlySignal<ControlledView | null>;
  /** The most recent rejected command (the UI explains failures from it), or `null`. */
  readonly lastRejection: ReadonlySignal<CommandRejection | null>;
}

/** Player intentions the UI can send. Every method queues exactly one game command for the next tick. */
export interface UiActions {
  /** Steer the controlled entity; `dx`/`dy` are clamped to −1…1, non-finite values count as 0. `(0, 0)` stops. */
  move(dx: number, dy: number): void;
  /** Remove an entity at the end of the next tick (rejected by the simulation if it no longer exists; `TypeError` for a non-handle). */
  despawn(entity: Entity): void;
}

export interface UiBridge {
  readonly state: UiState;
  readonly actions: UiActions;
  /** Publishes the latest simulation state to `state`; call once per rendered frame. */
  frame(): void;
  /** Stops listening to simulation events (signals keep their last values). */
  dispose(): void;
}

/** Input axis range of the `move` command. */
const AXIS_MIN = -1;
const AXIS_MAX = 1;

function axis(v: number): number {
  return Number.isFinite(v) ? clamp(v, AXIS_MIN, AXIS_MAX) : 0;
}

/** Creates the bridge for `session` and publishes its current state immediately. */
export function createUiBridge(session: UiBridgeSession): UiBridge {
  const status = createSessionStatus();
  const tick = signal(0);
  const day = signal(0);
  const minuteOfDay = signal(0);
  const entities = signal(0);
  const controlled = signal<ControlledView | null>(null);
  const lastRejection = signal<CommandRejection | null>(null);
  let pendingRejection: CommandRejection | null = null;

  const stopRejections = session.onEvent('commandRejected', (payload) => {
    pendingRejection = payload;
  });

  // Created once: `frame()` passes this to `batch` without allocating a closure per frame.
  const publish = (): void => {
    tick.value = status.tick;
    day.value = status.day;
    minuteOfDay.value = status.minuteOfDay;
    entities.value = status.entities;
    const shown = controlled.peek();
    if (status.controlled === NULL_ENTITY) {
      if (shown !== null) controlled.value = null;
    } else if (shown === null || shown.entity !== status.controlled || shown.x !== status.controlledX || shown.y !== status.controlledY) {
      controlled.value = { entity: status.controlled, x: status.controlledX, y: status.controlledY };
    }
    if (pendingRejection !== null) {
      lastRejection.value = pendingRejection;
      pendingRejection = null;
    }
  };

  const frame = (): void => {
    session.sampleStatus(status);
    batch(publish);
  };

  const actions: UiActions = {
    move(dx, dy) {
      session.command({ type: 'move', dx: axis(dx), dy: axis(dy) });
    },
    despawn(entity) {
      session.command({ type: 'despawn', entity });
    },
  };

  frame();
  return {
    state: { tick, day, minuteOfDay, entities, controlled, lastRejection },
    actions,
    frame,
    dispose: stopRejections,
  };
}
