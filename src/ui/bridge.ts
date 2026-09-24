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
import { batch, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { TemperatureStage } from '../content/balance/survival';
import { NULL_ENTITY, type Entity } from '../engine/ecs';
import type { ActionReader } from '../engine/input/reader';
import { clamp } from '../engine/math';
import type { GameCommand } from '../game/commands';
import type { EquipmentStats } from '../game/equipment/formulas';
import type { BagsState } from '../game/inventory/bags';
import type { SlotRef } from '../game/items/slots';
import { createBagsSample, createHudSample, createPlayerSample, createSessionStatus, type GameSession } from '../game/session';
import type { SimEventMap } from '../game/sim';
import { createHudSignals, type HudStateView } from './hud/signale';

/**
 * The part of a `GameSession` the UI may use: read the status, subscribe to events, queue commands –
 * and, where the session offers them, sample the player (survival values), the bags and the HUD values
 * (fear, conditions, interaction focus: `sampleHud`, published by src/ui/hud/signale.ts), and read the
 * menu input of the frame (`reader`: screens switch the input context to `ui` while they are open).
 */
export type UiBridgeSession = Pick<GameSession, 'sampleStatus' | 'onEvent' | 'command'> & Partial<Pick<GameSession, 'samplePlayer' | 'sampleBags' | 'sampleHud' | 'reader'>>;

/** Menu input of the frame (keyboard, gamepad and touch through the action bindings, `ActionReader`). */
export type UiInput = Pick<ActionReader, 'context' | 'setContext' | 'wasPressed' | 'wasPressedAnyContext' | 'isDown' | 'promptBinding' | 'gamepadFamily' | 'lastDevice'>;

/**
 * Survival values of the player for menus and the HUD (§11.1, §11.2), rounded to 0.1 so components
 * re-render only when a shown digit can change. `present` is false while there is no player (then the
 * values keep their last state).
 */
export interface PlayerVitalsView {
  readonly present: ReadonlySignal<boolean>;
  readonly health: ReadonlySignal<number>;
  readonly maxHealth: ReadonlySignal<number>;
  readonly stamina: ReadonlySignal<number>;
  readonly maxStamina: ReadonlySignal<number>;
  readonly satiety: ReadonlySignal<number>;
  readonly thirst: ReadonlySignal<number>;
  /** 0–100 %. */
  readonly wetness: ReadonlySignal<number>;
  readonly exhaustion: ReadonlySignal<number>;
  /** Core and felt temperature, comfort band [°C]. */
  readonly coreC: ReadonlySignal<number>;
  readonly feltC: ReadonlySignal<number>;
  readonly bandLowC: ReadonlySignal<number>;
  readonly bandHighC: ReadonlySignal<number>;
  readonly temperatureStage: ReadonlySignal<TemperatureStage>;
  /** Parts of the felt temperature [°C]: ambient air, heat of sources, room value (HUD thermometer tooltip, §11.2). */
  readonly ambientC: ReadonlySignal<number>;
  readonly heatC: ReadonlySignal<number>;
  readonly roomC: ReadonlySignal<number>;
  /** Change of the core temperature [°C/s], rounded to 0.001 (the HUD's trend arrow). */
  readonly coreRateCps: ReadonlySignal<number>;
}

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
  /** The player's bags (immutable, a new object after every change), or `null` when the session offers none. */
  readonly bags: ReadonlySignal<BagsState | null>;
  /** Aggregated stats of the worn equipment, or `null` like `bags`. */
  readonly equipmentStats: ReadonlySignal<EquipmentStats | null>;
  /** Survival values of the player. */
  readonly player: PlayerVitalsView;
  /** Fear, conditions and the interaction hint of the player (HUD, M3-27; empty while the session offers none). */
  readonly hud: HudStateView;
}

/** Bag commands of the inventory screen (docs/SPIEL.md §3, src/game/inventory/commands.ts). */
export interface UiInventoryActions {
  /** Drag and drop, number keys onto the hotbar, equip/unequip (`count` = part of the stack). */
  move(from: SlotRef, to: SlotRef, count?: number): void;
  /** Right click: the smaller half to `to` or the first free slot. */
  split(from: SlotRef, to?: SlotRef): void;
  /** Double click: gather matching items onto the stack at `at`. */
  collect(at: SlotRef): void;
  /** Sort inventory and backpack compartment. */
  sort(): void;
  /** Shift click: to the natural other place (hotbar ↔ inventory, equip, unequip). */
  quickMove(from: SlotRef): void;
  /** The bin: destroy the stack (or `count` of it). */
  discard(from: SlotRef, count?: number): void;
  /** Click on a HUD hotbar slot: select hotbar slot `index` (0–9, like the keys 1–0). */
  select(index: number): void;
}

/** Player intentions the UI can send. Every method queues exactly one game command for the next tick. */
export interface UiActions {
  /** Steer the controlled entity; `dx`/`dy` are clamped to −1…1, non-finite values count as 0. `(0, 0)` stops. */
  move(dx: number, dy: number): void;
  /** Remove an entity at the end of the next tick (rejected by the simulation if it no longer exists; `TypeError` for a non-handle). */
  despawn(entity: Entity): void;
  readonly inventory: UiInventoryActions;
}

export interface UiBridge {
  readonly state: UiState;
  readonly actions: UiActions;
  /** Menu input of the frame, or `null` when the session offers none (tests). */
  readonly input: UiInput | null;
  /** Publishes the latest simulation state to `state`; call once per rendered frame. */
  frame(): void;
  /** Runs `listener` after every `frame()` (screens poll their menu input there); returns an unsubscribe function. */
  onFrame(listener: () => void): () => void;
  /** Stops listening to simulation events (signals keep their last values). */
  dispose(): void;
}

/** Input axis range of the `move` command. */
const AXIS_MIN = -1;
const AXIS_MAX = 1;

function axis(v: number): number {
  return Number.isFinite(v) ? clamp(v, AXIS_MIN, AXIS_MAX) : 0;
}

/** Decimal places the vitals are rounded to (`PlayerVitalsView`). */
const VITALS_STEP = 10;

function tenth(v: number): number {
  return Math.round(v * VITALS_STEP) / VITALS_STEP;
}

type WritableVitals = { readonly [K in keyof PlayerVitalsView]: PlayerVitalsView[K] extends ReadonlySignal<infer T> ? Signal<T> : never };

function createVitals(): WritableVitals {
  return {
    present: signal(false),
    health: signal(0),
    maxHealth: signal(0),
    stamina: signal(0),
    maxStamina: signal(0),
    satiety: signal(0),
    thirst: signal(0),
    wetness: signal(0),
    exhaustion: signal(0),
    coreC: signal(0),
    feltC: signal(0),
    bandLowC: signal(0),
    bandHighC: signal(0),
    temperatureStage: signal<TemperatureStage>('normal'),
    ambientC: signal(0),
    heatC: signal(0),
    roomC: signal(0),
    coreRateCps: signal(0),
  };
}

/** Decimal places of the core trend (`PlayerVitalsView.coreRateCps`): §11.2 rates are 0.002 °C/s × stress. */
const RATE_STEP = 1000;

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
  // Bags and player: sampled only when the session offers them (reused records, no allocation per frame).
  const bagsSample = session.sampleBags === undefined ? null : createBagsSample();
  let bagsRevision = Number.NaN;
  const bags = signal<BagsState | null>(null);
  const equipmentStats = signal<EquipmentStats | null>(null);
  const playerSample = session.samplePlayer === undefined ? null : createPlayerSample();
  let hasPlayer = false;
  const vitals = createVitals();
  const hudSample = session.sampleHud === undefined ? null : createHudSample();
  let hasHud = false;
  const hud = createHudSignals();

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
    if (bagsSample !== null && bagsSample.revision !== bagsRevision) {
      bagsRevision = bagsSample.revision;
      bags.value = bagsSample.state;
      equipmentStats.value = bagsSample.stats;
    }
    if (playerSample !== null) {
      vitals.present.value = hasPlayer;
      if (hasPlayer) {
        const p = playerSample;
        vitals.health.value = tenth(p.health);
        vitals.maxHealth.value = tenth(p.maxHealth);
        vitals.stamina.value = tenth(p.stamina);
        vitals.maxStamina.value = tenth(p.maxStamina);
        vitals.satiety.value = tenth(p.satiety);
        vitals.thirst.value = tenth(p.thirst);
        vitals.wetness.value = tenth(p.wetness);
        vitals.exhaustion.value = tenth(p.exhaustion);
        vitals.coreC.value = tenth(p.coreC);
        vitals.feltC.value = tenth(p.feltC);
        vitals.bandLowC.value = tenth(p.bandLowC);
        vitals.bandHighC.value = tenth(p.bandHighC);
        vitals.temperatureStage.value = p.temperatureStage;
        vitals.ambientC.value = tenth(p.ambientC);
        vitals.heatC.value = tenth(p.heatC);
        vitals.roomC.value = tenth(p.roomC);
        vitals.coreRateCps.value = Math.round(p.coreRateCps * RATE_STEP) / RATE_STEP;
      }
    }
    if (hudSample !== null) hud.publish(hudSample, hasHud);
  };

  const frameListeners: Array<() => void> = [];
  const frame = (): void => {
    session.sampleStatus(status);
    if (bagsSample !== null) session.sampleBags?.(bagsSample);
    if (playerSample !== null) hasPlayer = session.samplePlayer?.(playerSample) ?? false;
    if (hudSample !== null) hasHud = session.sampleHud?.(hudSample) ?? false;
    batch(publish);
    for (let i = 0; i < frameListeners.length; i++) frameListeners[i]?.();
  };

  const command = (cmd: GameCommand): void => {
    session.command(cmd);
  };
  const inventory: UiInventoryActions = {
    move: (from, to, count) => command(count === undefined ? { type: 'inventory.move', from, to } : { type: 'inventory.move', from, to, count }),
    split: (from, to) => command(to === undefined ? { type: 'inventory.split', from } : { type: 'inventory.split', from, to }),
    collect: (at) => command({ type: 'inventory.collect', at }),
    sort: () => command({ type: 'inventory.sort' }),
    quickMove: (from) => command({ type: 'inventory.quickMove', from }),
    discard: (from, count) => command(count === undefined ? { type: 'inventory.discard', from } : { type: 'inventory.discard', from, count }),
    select: (index) => command({ type: 'player.selectHotbar', index }),
  };
  const actions: UiActions = {
    move(dx, dy) {
      session.command({ type: 'move', dx: axis(dx), dy: axis(dy) });
    },
    despawn(entity) {
      session.command({ type: 'despawn', entity });
    },
    inventory,
  };

  frame();
  return {
    state: { tick, day, minuteOfDay, entities, controlled, lastRejection, bags, equipmentStats, player: vitals, hud: hud.view },
    actions,
    input: session.reader ?? null,
    frame,
    onFrame(listener) {
      frameListeners.push(listener);
      return () => {
        const i = frameListeners.indexOf(listener);
        if (i >= 0) frameListeners.splice(i, 1);
      };
    },
    dispose: stopRejections,
  };
}
