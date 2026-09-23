/**
 * Typed events (docs/ARCHITEKTUR.md "Events & Commands").
 *
 * - `EventBus<M>`: immediate, synchronous dispatch to subscribers.
 * - `EventQueue<M>`: events buffered during a simulation tick and drained afterwards (the
 *   presentation reads them after the tick). Double buffered, no per-event allocation besides the
 *   payload the caller passes in.
 *
 * `M` maps event names to payload types, e.g. `{ hit: { target: number; amount: number } }`.
 */

/** Map of event name to payload type. */
export type EventMap = object;
/** Handler for one event type. */
export type EventHandler<P> = (payload: P) => void;
/** Tuple `[type, payload]` for every event in `M`; narrows on `type` inside callbacks. */
export type EventArgs<M extends EventMap> = { [K in keyof M]: [type: K, payload: M[K]] }[keyof M];

/**
 * Immediate typed publish/subscribe. Handler lists are copy-on-write, so subscribing or
 * unsubscribing inside a handler is safe and `emit` never allocates.
 */
export class EventBus<M extends EventMap> {
  private readonly handlers = new Map<keyof M, ReadonlyArray<EventHandler<never>>>();

  /** Subscribes to `type`. Returns a function that unsubscribes (idempotent). */
  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...list, handler as EventHandler<never>]);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.off(type, handler);
    };
  }

  /** Subscribes for exactly one emission. Returns an unsubscribe function. */
  once<K extends keyof M>(type: K, handler: EventHandler<M[K]>): () => void {
    const unsubscribe = this.on(type, (payload: M[K]) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /** Removes one registration of `handler` for `type`. Returns whether it was registered. */
  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): boolean {
    const list = this.handlers.get(type);
    if (list === undefined) return false;
    const idx = list.indexOf(handler as EventHandler<never>);
    if (idx < 0) return false;
    if (list.length === 1) this.handlers.delete(type);
    else this.handlers.set(type, [...list.slice(0, idx), ...list.slice(idx + 1)]);
    return true;
  }

  /** Calls every handler of `type` synchronously in subscription order. */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const list = this.handlers.get(type) as ReadonlyArray<EventHandler<M[K]>> | undefined;
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) (list[i] as EventHandler<M[K]>)(payload);
  }

  /** Number of handlers for `type`. */
  listenerCount(type: keyof M): number {
    return this.handlers.get(type)?.length ?? 0;
  }

  /** Removes all handlers of `type`, or of every type when omitted. */
  clear(type?: keyof M): void {
    if (type === undefined) this.handlers.clear();
    else this.handlers.delete(type);
  }
}

/**
 * Per-tick buffered events. `push` during the tick, `drain` afterwards. Events pushed while
 * draining land in the other buffer and are delivered by the next `drain`.
 */
export class EventQueue<M extends EventMap> {
  private types: Array<keyof M> = [];
  private payloads: unknown[] = [];
  private count = 0;
  private spareTypes: Array<keyof M> = [];
  private sparePayloads: unknown[] = [];
  private draining = false;

  /** Number of buffered events. */
  get size(): number {
    return this.count;
  }

  /** Buffers an event. */
  push<K extends keyof M>(type: K, payload: M[K]): void {
    this.types[this.count] = type;
    this.payloads[this.count] = payload;
    this.count++;
  }

  /**
   * Delivers all buffered events in push order and empties the queue. Returns the count.
   * Re-entrant calls (draining from inside `cb`) throw: they would swap the buffer that is being
   * delivered back in as the push target and overwrite undelivered events.
   */
  drain(cb: (...event: EventArgs<M>) => void): number {
    if (this.draining) throw new Error('EventQueue.drain is not re-entrant');
    const types = this.types;
    const payloads = this.payloads;
    const n = this.count;
    // Swap buffers first so pushes from inside `cb` go to the next drain.
    this.types = this.spareTypes;
    this.payloads = this.sparePayloads;
    this.count = 0;
    this.spareTypes = types;
    this.sparePayloads = payloads;
    const deliver = cb as (type: keyof M, payload: unknown) => void;
    this.draining = true;
    try {
      for (let i = 0; i < n; i++) deliver(types[i] as keyof M, payloads[i]);
    } finally {
      // Release payload references so drained events can be collected.
      for (let i = 0; i < n; i++) payloads[i] = undefined;
      this.draining = false;
    }
    return n;
  }

  /** Calls `cb` for every buffered event of `type` without removing anything. */
  forEachOfType<K extends keyof M>(type: K, cb: (payload: M[K]) => void): void {
    for (let i = 0; i < this.count; i++) if (this.types[i] === type) cb(this.payloads[i] as M[K]);
  }

  /** Drops all buffered events. */
  clear(): void {
    for (let i = 0; i < this.count; i++) this.payloads[i] = undefined;
    this.count = 0;
  }
}
