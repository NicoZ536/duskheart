/**
 * Commands: the only way presentation changes the simulation (docs/ARCHITEKTUR.md
 * "Events & Commands"). Concrete command types live in `src/game/commands.ts`.
 *
 * - `CommandQueue<C>`: commands pushed between ticks, drained at the start of a tick.
 * - `CommandRecorder<C>`: tick stamped recording of every drained command (replays, bug repros).
 * - `ReplayPlayer<C>`: feeds a recording back at exactly the recorded ticks.
 */

/** A command stamped with the tick it was executed in. */
export interface RecordedCommand<C> {
  readonly tick: number;
  readonly cmd: C;
}

/** Metadata stored alongside a recording (seed, build, scenario …). */
export type RecordingMeta = Readonly<Record<string, string | number | boolean>>;

/** Serialized recording (plain JSON data). */
export interface CommandRecording<C> {
  readonly version: number;
  readonly meta: RecordingMeta;
  readonly entries: ReadonlyArray<RecordedCommand<C>>;
}

/** Current recording format version. */
export const COMMAND_RECORDING_VERSION = 1;

/** Something that receives drained commands with their tick (e.g. a `CommandRecorder`). */
export interface CommandSink<C> {
  record(tick: number, cmd: C): void;
}

function isEntryArray<C>(
  value: CommandRecording<C> | ReadonlyArray<RecordedCommand<C>> | CommandRecorder<C>,
): value is ReadonlyArray<RecordedCommand<C>> {
  return Array.isArray(value);
}

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be an integer ≥ 0, got ${String(tick)}`);
}

/**
 * FIFO command queue. Commands pushed while a drain is running are delivered in the next tick.
 * An attached sink (recorder) sees every drained command.
 */
export class CommandQueue<C> {
  private pending: C[] = [];
  private spare: C[] = [];
  private sink: CommandSink<C> | null = null;
  private draining = false;

  /** Number of commands waiting for the next tick. */
  get size(): number {
    return this.pending.length;
  }

  /** Enqueues a command for the next tick. */
  push(cmd: C): void {
    this.pending.push(cmd);
  }

  /** Attaches (or detaches with `null`) a sink that records every drained command. */
  setSink(sink: CommandSink<C> | null): void {
    this.sink = sink;
  }

  /**
   * Delivers all pending commands for `tick` in FIFO order. Returns the number delivered.
   * Re-entrant calls (draining from inside `handler`) throw: the double buffer would otherwise
   * hand the batch that is being delivered back to `push` and lose commands.
   */
  drainForTick(tick: number, handler: (cmd: C, tick: number) => void): number {
    assertTick(tick);
    if (this.draining) throw new Error('CommandQueue.drainForTick is not re-entrant');
    const batch = this.pending;
    this.pending = this.spare;
    this.spare = batch;
    const n = batch.length;
    this.draining = true;
    try {
      for (let i = 0; i < n; i++) {
        const cmd = batch[i] as C;
        this.sink?.record(tick, cmd);
        handler(cmd, tick);
      }
    } finally {
      batch.length = 0;
      this.draining = false;
    }
    return n;
  }

  /** Drops all pending commands. */
  clear(): void {
    this.pending.length = 0;
  }
}

/** Records drained commands with their tick. Ticks must be non-decreasing. */
export class CommandRecorder<C> implements CommandSink<C> {
  private readonly list: Array<RecordedCommand<C>> = [];
  private metaData: Record<string, string | number | boolean> = {};

  constructor(meta: RecordingMeta = {}) {
    this.metaData = { ...meta };
  }

  /** Parses a serialized recording; `parseCmd` validates each command. Throws on malformed data. */
  static fromJSON<C>(json: unknown, parseCmd: (raw: unknown) => C): CommandRecorder<C> {
    if (typeof json !== 'object' || json === null) throw new TypeError('Recording must be an object');
    const { version, meta, entries } = json as { version?: unknown; meta?: unknown; entries?: unknown };
    if (version !== COMMAND_RECORDING_VERSION) throw new TypeError(`Unsupported recording version ${String(version)}`);
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) throw new TypeError('Recording meta must be an object');
    const cleanMeta: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new TypeError(`Recording meta "${k}" must be a primitive`);
      cleanMeta[k] = v;
    }
    if (!Array.isArray(entries)) throw new TypeError('Recording entries must be an array');
    const rec = new CommandRecorder<C>(cleanMeta);
    for (const entry of entries as unknown[]) {
      if (typeof entry !== 'object' || entry === null) throw new TypeError('Recording entry must be an object');
      const { tick, cmd } = entry as { tick?: unknown; cmd?: unknown };
      if (typeof tick !== 'number') throw new TypeError('Recording entry tick must be a number');
      rec.record(tick, parseCmd(cmd));
    }
    return rec;
  }

  /** Recording metadata. */
  get meta(): RecordingMeta {
    return this.metaData;
  }

  /** Sets one metadata field. */
  setMeta(key: string, value: string | number | boolean): void {
    this.metaData[key] = value;
  }

  /** Recorded entries in order. */
  get entries(): ReadonlyArray<RecordedCommand<C>> {
    return this.list;
  }

  /** Number of recorded commands. */
  get length(): number {
    return this.list.length;
  }

  /** Tick of the last recorded command, or -1 when empty. */
  get lastTick(): number {
    const last = this.list[this.list.length - 1];
    return last === undefined ? -1 : last.tick;
  }

  /** Appends a command. Throws if `tick` is lower than the previous one. */
  record(tick: number, cmd: C): void {
    assertTick(tick);
    if (tick < this.lastTick) throw new RangeError(`Recording ticks must not decrease (${tick} after ${this.lastTick})`);
    this.list.push({ tick, cmd });
  }

  /** Removes all entries (metadata stays). */
  clear(): void {
    this.list.length = 0;
  }

  /** Serializable form. Commands must themselves be JSON compatible. */
  toJSON(): CommandRecording<C> {
    return { version: COMMAND_RECORDING_VERSION, meta: { ...this.metaData }, entries: this.list.map((e) => ({ tick: e.tick, cmd: e.cmd })) };
  }
}

/**
 * Plays a recording back tick by tick. Call `play(tick, handler)` (or `feed(tick, queue)`) once per
 * simulation tick in ascending order; each recorded command is delivered in its recorded tick.
 * Skipping past a tick that still has commands is a desync and throws.
 */
export class ReplayPlayer<C> {
  private readonly list: ReadonlyArray<RecordedCommand<C>>;
  private cursor = 0;

  constructor(recording: CommandRecording<C> | ReadonlyArray<RecordedCommand<C>> | CommandRecorder<C>) {
    const entries: ReadonlyArray<RecordedCommand<C>> = isEntryArray(recording) ? recording : recording.entries;
    let prev = 0;
    for (const e of entries) {
      assertTick(e.tick);
      if (e.tick < prev) throw new RangeError('Replay entries must be sorted by tick');
      prev = e.tick;
    }
    this.list = entries.slice();
  }

  /** Whether every command has been delivered. */
  get done(): boolean {
    return this.cursor >= this.list.length;
  }

  /** Number of commands not yet delivered. */
  get remaining(): number {
    return this.list.length - this.cursor;
  }

  /** Tick of the next command to deliver, or -1 when done. */
  get nextTick(): number {
    return this.list[this.cursor]?.tick ?? -1;
  }

  /** Tick of the last recorded command, or -1 for an empty recording. */
  get lastTick(): number {
    return this.list[this.list.length - 1]?.tick ?? -1;
  }

  /** Delivers all commands recorded for `tick`. Returns the number delivered. */
  play(tick: number, handler: (cmd: C, tick: number) => void): number {
    assertTick(tick);
    let n = 0;
    for (let e = this.next(tick); e !== undefined; e = this.next(tick)) {
      n++;
      handler(e.cmd, tick);
    }
    return n;
  }

  /** Pushes the commands recorded for `tick` into `queue` (to be drained by the same tick). */
  feed(tick: number, queue: CommandQueue<C>): number {
    assertTick(tick);
    let n = 0;
    for (let e = this.next(tick); e !== undefined; e = this.next(tick)) {
      n++;
      queue.push(e.cmd);
    }
    return n;
  }

  /** Consumes the next entry if it belongs to `tick`; throws on a skipped tick (desync). */
  private next(tick: number): RecordedCommand<C> | undefined {
    const e = this.list[this.cursor];
    if (e === undefined || e.tick > tick) return undefined;
    if (e.tick < tick) throw new Error(`Replay desync: command for tick ${e.tick} not delivered before tick ${tick}`);
    this.cursor++;
    return e;
  }

  /** Moves the cursor to the first command at or after `tick`. */
  seek(tick: number): void {
    assertTick(tick);
    let lo = 0;
    let hi = this.list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.list[mid] as RecordedCommand<C>).tick < tick) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
  }

  /** Restarts from the beginning. */
  rewind(): void {
    this.cursor = 0;
  }
}
