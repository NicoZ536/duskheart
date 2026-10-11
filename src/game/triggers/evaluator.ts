/**
 * Evaluating armed triggers (docs/SPIEL.md §17 "Auslöser-Sprache"; ADR-0207; strand G).
 *
 * - **Event leaves** count matching events from the moment their trigger is armed (a quest step becomes active, an
 *   achievement is open, a hint waits); a leaf holds once its counter reached its `anzahl` and stays held (the counter does
 *   not grow beyond it).
 * - **State leaves** read the world (`TriggerWorld`) whenever the trigger is checked: on the world tick (1 Hz) and in the step
 *   in which one of its event leaves counted.
 * - `alle` holds when every part holds, `eines` when one does, `nicht` when its part does not (an event under `nicht`: until
 *   it happened).
 *
 * `TriggerBoard` is one observer's set of armed triggers with an index event type → listeners, so a step's events reach only
 * the triggers waiting for them. Nothing here allocates per event or per check (held arrays, no closures in the loops).
 */
import type { Trigger } from '../../content/schema/trigger';
import { compileTrigger, NODE, PLAYER_TOKEN, type CompiledTrigger, type EventLeaf, type TriggerNode } from './compile';
import type { ArmedTrigger, TriggerEvaluator, TriggerWorld } from './types';

/** An armed trigger of one owner (a quest step, an achievement, a hint, a milestone, a knowledge entry). */
export class Armed implements ArmedTrigger {
  readonly trigger: Trigger;
  readonly compiled: CompiledTrigger;
  readonly counts: number[];
  done = false;
  /** A counter moved in this step: check it at the end of the step. */
  dirty = false;
  /** Whether it is on a board (`TriggerBoard.arm`). */
  onBoard = false;

  constructor(
    trigger: Trigger,
    /** Who armed it (an id of the owner's content). */
    readonly owner: string,
    counts?: readonly number[],
  ) {
    this.trigger = trigger;
    this.compiled = compileTrigger(trigger);
    this.counts = this.compiled.leaves.map((l, i) => Math.min(l.need, Math.max(0, Math.floor(counts?.[i] ?? 0))));
  }

  get count(): number {
    return this.counts[0] ?? 0;
  }

  set count(v: number) {
    if (this.counts.length > 0) this.counts[0] = v;
  }

  /** Back to the moment of arming (counters 0, not done). */
  reset(): void {
    for (let i = 0; i < this.counts.length; i++) this.counts[i] = 0;
    this.done = false;
    this.dirty = false;
  }

  /** The counters as saved (`[]` for a trigger without event leaves). */
  savedCounts(): number[] {
    return this.counts.slice();
  }
}

/** Whether the payload field `field` of `payload` equals `value` (`PLAYER_TOKEN`: the player's entity). */
function fieldEquals(payload: object, field: string, value: string | number | boolean, player: number): boolean {
  const v = (payload as Record<string, unknown>)[field];
  return value === PLAYER_TOKEN ? v === player : v === value;
}

/** Whether `payload` passes the leaf's filter. */
export function leafMatches(leaf: EventLeaf, payload: object, player: number): boolean {
  const fields = leaf.fields;
  const values = leaf.values;
  for (let i = 0; i < fields.length; i++) if (!fieldEquals(payload, fields[i] as string, values[i] as string | number | boolean, player)) return false;
  return true;
}

/** Counts `payload` (of event `type`) on every matching leaf of `armed`; true when a counter moved. */
export function countEvent(armed: Armed, type: string, payload: object, player: number): boolean {
  const leaves = armed.compiled.leaves;
  let moved = false;
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i] as EventLeaf;
    if (leaf.type !== type) continue;
    const c = armed.counts[leaf.index] as number;
    if (c >= leaf.need || !leafMatches(leaf, payload, player)) continue;
    armed.counts[leaf.index] = c + 1;
    moved = true;
  }
  return moved;
}

function holdsNode(n: TriggerNode, counts: readonly number[], world: TriggerWorld): boolean {
  switch (n.kind) {
    case NODE.ereignis: {
      const leaf = n.leaf as EventLeaf;
      return (counts[leaf.index] as number) >= leaf.need;
    }
    case NODE.statistik:
      return world.statValue(n.id, n.sub === '' ? undefined : n.sub) >= n.a;
    case NODE.besitz:
      return world.carried(n.id) >= n.a;
    case NODE.zustand:
      return world.conditionActive(n.id);
    case NODE.uhr: {
      if (n.a !== 0 && world.day() !== n.a) return false;
      const h = world.hour();
      return h < n.b && h >= n.c;
    }
    case NODE.lichtstufe: {
      const level = world.playerLightLevel();
      return level <= n.b && level >= n.c;
    }
    case NODE.raum:
      if (n.b !== -1 && (world.playerIndoors() ? 1 : 0) !== n.b) return false;
      return n.sub === '' || world.playerRoomType() === n.sub;
    case NODE.freischaltung:
      return world.unlocked(n.id);
    case NODE.aufgabe:
      return world.questStatus(n.id, n.sub === '' ? undefined : n.sub) === (n.c === 1 ? 'erledigt' : 'aktiv');
    case NODE.ort:
      return world.placesDiscovered(n.id) >= n.a;
    case NODE.alle: {
      const ch = n.children;
      for (let i = 0; i < ch.length; i++) if (!holdsNode(ch[i] as TriggerNode, counts, world)) return false;
      return true;
    }
    case NODE.eines: {
      const ch = n.children;
      for (let i = 0; i < ch.length; i++) if (holdsNode(ch[i] as TriggerNode, counts, world)) return true;
      return false;
    }
    default:
      return !holdsNode(n.children[0] as TriggerNode, counts, world);
  }
}

/** Whether `armed` holds now (its event leaves as counted, its state leaves as the world reads). */
export function holds(armed: Armed, world: TriggerWorld): boolean {
  return holdsNode(armed.compiled.root, armed.counts, world);
}

/** The evaluator of the contract (`TriggerEvaluator`, src/game/triggers/types.ts) over `Armed` triggers. */
export function triggerEvaluator(player: () => number): TriggerEvaluator {
  return {
    onEvent: (armed, type, payload) => countEvent(armed as Armed, type, payload as object, player()),
    check: (armed, world) => holds(armed as Armed, world),
  };
}

/**
 * The armed triggers of one observer, indexed by the event types they wait for. `dispatch` counts a step's events,
 * `settle` checks the triggers whose counters moved (every one on a world tick) and hands those that hold to the owner.
 */
export class TriggerBoard {
  /** Every armed trigger on the board. */
  readonly armed: Armed[] = [];
  private readonly byType = new Map<string, Armed[]>();
  /** The triggers that hold at a `settle` (held, reused). */
  private readonly ready: Armed[] = [];

  /** Puts `a` on the board (its event types indexed). */
  arm(a: Armed): void {
    if (a.onBoard) return;
    a.onBoard = true;
    this.armed.push(a);
    for (const type of a.compiled.types) {
      let list = this.byType.get(type);
      if (list === undefined) {
        list = [];
        this.byType.set(type, list);
      }
      list.push(a);
    }
  }

  /** Takes `a` off the board. */
  disarm(a: Armed): void {
    if (!a.onBoard) return;
    a.onBoard = false;
    const i = this.armed.indexOf(a);
    if (i >= 0) this.armed.splice(i, 1);
    for (const type of a.compiled.types) {
      const list = this.byType.get(type);
      if (list === undefined) continue;
      const j = list.indexOf(a);
      if (j >= 0) list.splice(j, 1);
    }
  }

  /** Takes every trigger off the board. */
  clear(): void {
    for (const a of this.armed) a.onBoard = false;
    this.armed.length = 0;
    this.byType.clear();
  }

  /** Whether a trigger on the board waits for events of `type`. */
  listens(type: string): boolean {
    const list = this.byType.get(type);
    return list !== undefined && list.length > 0;
  }

  /** Counts one event on the triggers waiting for its type (marks those whose counters moved). */
  dispatch(type: string, payload: object, player: number): void {
    const list = this.byType.get(type);
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Armed;
      if (!a.done && countEvent(a, type, payload, player)) a.dirty = true;
    }
  }

  /**
   * Checks the marked triggers – every stateful one too when `worldTick` – and calls `onReady` for each that holds (marked
   * `done` before the call; the owner disarms, re-arms or keeps it). Returns how many held.
   */
  settle(world: TriggerWorld, worldTick: boolean, onReady: (a: Armed) => void): number {
    const ready = this.ready;
    ready.length = 0;
    const list = this.armed;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Armed;
      if (a.done || !(a.dirty || (worldTick && a.compiled.stateful))) continue;
      a.dirty = false;
      if (holds(a, world)) ready.push(a);
    }
    const n = ready.length;
    for (let i = 0; i < n; i++) {
      const a = ready[i] as Armed;
      a.done = true;
      onReady(a);
    }
    ready.length = 0;
    return n;
  }
}
