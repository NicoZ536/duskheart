/**
 * Worker bridge (MASTERPROMPT §3.1 "Worker: Weltgenerierung, Pfadfindung, Speicher-Kompression",
 * docs/ARCHITEKTUR.md "Welt": generation in a worker, the same functions synchronously in Node).
 *
 * Typed messages
 * - `createRpcServer(handlers, port)` answers requests by calling `handlers[method](...args)`;
 *   `server.emit(name, payload)` posts typed one-way events (progress, logs) to the client.
 * - `createRpcClient<Api, Events>(port)`: `client.call('method', ...args)` returns a typed promise,
 *   `client.on('event', listener)` receives the server's events.
 * - Every message carries a tag and the protocol version; foreign traffic on the port is ignored,
 *   a version mismatch is reported as `RpcError` (`RpcVersionError`) instead of being misread.
 * - Errors thrown by handlers reject the client promise with an `RpcError` carrying name, message
 *   and remote stack. `connectWorker(worker)` additionally fails all pending calls when the worker
 *   reports a script or deserialization error, so no caller waits forever on a dead worker.
 *
 * Transferables
 * - Clients pass them with `callTransfer`; handlers return `rpcTransfer(value, list)`; events take
 *   an optional transfer list. Transferred buffers are moved (the sender's view is detached).
 *
 * Job queue with per-frame budget
 * - `JobQueue` orders jobs by priority (lower first, ties in submission order), keeps at most
 *   `maxInFlight` jobs in a worker, and hands results to their `onDone` callbacks only inside
 *   `frame()`, until the frame budget [ms] of the injected clock is used up (at least one result
 *   or job per frame, so the queue always progresses). Jobs can be cancelled and re-prioritized
 *   while queued; results of cancelled running jobs are dropped.
 * - Two executors with identical results: `workerExecutor(client)` (browser) and
 *   `inThreadExecutor(handlers)` (Node tests and browsers without module workers), which runs the
 *   handlers synchronously inside `frame()` within the same budget and moves arguments and results
 *   through `structuredClone` exactly like a message port would. `createJobExecutor` picks the
 *   worker when one can be spawned and falls back to the in-thread executor otherwise.
 * - `createInProcessChannel()`: two connected in-memory ports with structured clone semantics
 *   (Node tests of the message protocol itself).
 */

/** Minimal message event shape used by the bridge. */
export interface RpcMessageEvent {
  readonly data: unknown;
}

/** Minimal `MessagePort`/`Worker`-like interface. */
export interface RpcPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void;
  /** `MessagePort` needs `start()` when listeners are attached with `addEventListener`. */
  start?(): void;
}

/** Error or failed-deserialization event of a worker (`ErrorEvent`, `MessageEvent`). */
export interface RpcErrorEventLike {
  readonly type: string;
  readonly message?: unknown;
}

/** A spawned worker: a port that reports script errors and can be terminated (DOM `Worker`). */
export type WorkerLike = RpcPort & {
  addEventListener(type: 'error' | 'messageerror', listener: (event: RpcErrorEventLike) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: (event: RpcErrorEventLike) => void): void;
  terminate(): void;
};

/** Any function usable as RPC method. */
export type RpcMethod = (...args: never[]) => unknown;
/** Shape constraint of an RPC API (works with interfaces and type aliases). */
export type RpcApiOf<Api> = { [K in keyof Api]: RpcMethod };
/** Shape constraint of an event map (event name → payload type). */
export type RpcEventsOf<Events> = { [K in keyof Events]: unknown };
/** Event map of a server without events. */
export type NoRpcEvents = Record<never, never>;

/** Tag that marks bridge messages (other traffic on the same port is ignored). */
const RPC_TAG = 'dh-rpc';
/** Protocol version; bumped when the message shape changes. */
export const RPC_VERSION = 1;

interface RpcRequest {
  readonly tag: typeof RPC_TAG;
  readonly v: number;
  readonly kind: 'req';
  readonly id: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

interface RpcErrorData {
  readonly name: string;
  readonly message: string;
  readonly stack: string;
}

interface RpcResponse {
  readonly tag: typeof RPC_TAG;
  readonly v: number;
  readonly kind: 'res';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: RpcErrorData;
}

interface RpcEventMessage {
  readonly tag: typeof RPC_TAG;
  readonly v: number;
  readonly kind: 'evt';
  readonly name: string;
  readonly payload: unknown;
}

/** A handler result that should be posted with a transfer list. */
export class RpcTransfer<T> {
  constructor(
    readonly value: T,
    readonly transfer: Transferable[],
  ) {}
}

/** Wraps a handler result so `transfer` (e.g. typed array buffers) is moved, not copied. */
export function rpcTransfer<T>(value: T, transfer: Transferable[]): RpcTransfer<T> {
  return new RpcTransfer(value, transfer);
}

/** Result type the client sees for a handler return type. */
export type RpcResult<R> = Awaited<R> extends RpcTransfer<infer V> ? V : Awaited<R>;

/** Error raised on the client when a remote handler fails (or the worker/protocol broke). */
export class RpcError extends Error {
  /** `name` of the remote error (`RpcMethodError`, `RpcVersionError`, `WorkerError` for bridge failures). */
  readonly remoteName: string;
  /** Stack of the remote error (may be empty). */
  readonly remoteStack: string;

  constructor(data: RpcErrorData) {
    super(data.message);
    this.name = 'RpcError';
    this.remoteName = data.name;
    this.remoteStack = data.stack;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequest(data: unknown): data is RpcRequest {
  return (
    isRecord(data) &&
    data['tag'] === RPC_TAG &&
    data['kind'] === 'req' &&
    typeof data['id'] === 'number' &&
    typeof data['method'] === 'string' &&
    Array.isArray(data['args'])
  );
}

function isResponse(data: unknown): data is RpcResponse {
  return isRecord(data) && data['tag'] === RPC_TAG && data['kind'] === 'res' && typeof data['id'] === 'number' && typeof data['ok'] === 'boolean';
}

function isEventMessage(data: unknown): data is RpcEventMessage {
  return isRecord(data) && data['tag'] === RPC_TAG && data['kind'] === 'evt' && typeof data['name'] === 'string';
}

function toErrorData(err: unknown): RpcErrorData {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? '' };
  return { name: 'Error', message: String(err), stack: '' };
}

function versionError(v: unknown): RpcErrorData {
  return { name: 'RpcVersionError', message: `RPC protocol version ${String(v)} does not match ${RPC_VERSION}`, stack: '' };
}

/** Handle of a running server. */
export interface RpcServer<Events extends RpcEventsOf<Events> = NoRpcEvents> {
  /** Posts a typed one-way event to the client (e.g. progress). Ignored after `dispose()`. */
  emit<K extends keyof Events & string>(name: K, payload: Events[K], transfer?: Transferable[]): void;
  /** Stops answering requests. */
  dispose(): void;
}

/**
 * Serves `handlers` on `port`. Handlers may be sync or async; returning `rpcTransfer(...)` moves
 * the listed transferables. Unknown methods, version mismatches and thrown errors are reported to
 * the caller.
 */
export function createRpcServer<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents>(handlers: Api, port: RpcPort): RpcServer<Events> {
  const table = handlers as Record<string, unknown>;
  let disposed = false;
  const reply = (msg: RpcResponse, transfer: Transferable[]): void => {
    // Requests still in flight when the server is disposed are not answered.
    if (disposed) return;
    try {
      port.postMessage(msg, transfer);
    } catch (err) {
      // The value was not cloneable: report that instead of leaving the caller hanging.
      try {
        port.postMessage({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: msg.id, ok: false, error: toErrorData(err) } satisfies RpcResponse, []);
      } catch {
        // The port itself is unusable (closed); nobody is left to notify.
      }
    }
  };
  const fail = (id: number, error: RpcErrorData): void => reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id, ok: false, error }, []);
  const listener = (event: RpcMessageEvent): void => {
    const req = event.data;
    if (disposed || !isRequest(req)) return;
    if (req.v !== RPC_VERSION) {
      fail(req.id, versionError(req.v));
      return;
    }
    const fn = Object.prototype.hasOwnProperty.call(table, req.method) ? table[req.method] : undefined;
    if (typeof fn !== 'function') {
      fail(req.id, { name: 'RpcMethodError', message: `Unknown RPC method "${req.method}"`, stack: '' });
      return;
    }
    Promise.resolve()
      .then(() => (fn as (...args: unknown[]) => unknown).apply(handlers, req.args as unknown[]))
      .then(
        (result) => {
          if (result instanceof RpcTransfer) reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: true, value: result.value }, result.transfer);
          else reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: true, value: result }, []);
        },
        (err: unknown) => fail(req.id, toErrorData(err)),
      );
  };
  port.addEventListener('message', listener);
  port.start?.();
  return {
    emit(name, payload, transfer = []) {
      if (disposed) return;
      port.postMessage({ tag: RPC_TAG, v: RPC_VERSION, kind: 'evt', name, payload } satisfies RpcEventMessage, transfer);
    },
    dispose() {
      disposed = true;
      port.removeEventListener('message', listener);
    },
  };
}

/** Client side of an RPC API. */
export interface RpcClient<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents> {
  /** Calls `method` remotely; arguments are structured-cloned. */
  call<K extends keyof Api & string>(method: K, ...args: Parameters<Api[K]>): Promise<RpcResult<ReturnType<Api[K]>>>;
  /** Like `call`, but moves `transfer` (e.g. `ArrayBuffer`s inside `args`) instead of copying. */
  callTransfer<K extends keyof Api & string>(
    method: K,
    transfer: Transferable[],
    ...args: Parameters<Api[K]>
  ): Promise<RpcResult<ReturnType<Api[K]>>>;
  /** Subscribes to a server event; returns the unsubscribe function. */
  on<K extends keyof Events & string>(name: K, listener: (payload: Events[K]) => void): () => void;
  /** Number of calls awaiting a response. */
  readonly pendingCount: number;
  /** Rejects every pending and future call with `reason` (the remote side is gone or broken). */
  abort(reason: Error): void;
  /** Detaches from the port and rejects all pending calls. */
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** Creates a typed client for the server on the other end of `port`. */
export function createRpcClient<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents>(port: RpcPort): RpcClient<Api, Events> {
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(payload: never) => void>>();
  let nextId = 1;
  let disposed = false;
  let broken: Error | null = null;
  const rejectAll = (err: Error): void => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const listener = (event: RpcMessageEvent): void => {
    const msg = event.data;
    if (isEventMessage(msg)) {
      if (msg.v !== RPC_VERSION) return;
      const set = listeners.get(msg.name);
      if (set !== undefined) for (const l of set) (l as (payload: unknown) => void)(msg.payload);
      return;
    }
    if (!isResponse(msg)) return;
    const p = pending.get(msg.id);
    if (p === undefined) return;
    pending.delete(msg.id);
    if (msg.v !== RPC_VERSION) p.reject(new RpcError(versionError(msg.v)));
    else if (msg.ok) p.resolve(msg.value);
    else p.reject(new RpcError(msg.error ?? { name: 'Error', message: 'Unknown RPC failure', stack: '' }));
  };
  port.addEventListener('message', listener);
  port.start?.();

  const send = (method: string, args: readonly unknown[], transfer: Transferable[]): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('RPC client is disposed'));
    if (broken !== null) return Promise.reject(broken);
    const id = nextId++;
    const req: RpcRequest = { tag: RPC_TAG, v: RPC_VERSION, kind: 'req', id, method, args };
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        port.postMessage(req, transfer);
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  };

  return {
    call(method, ...args) {
      return send(method, args, []) as Promise<never>;
    },
    callTransfer(method, transfer, ...args) {
      return send(method, args, transfer) as Promise<never>;
    },
    on(name, fn) {
      let set = listeners.get(name);
      if (set === undefined) {
        set = new Set();
        listeners.set(name, set);
      }
      const entry = fn as (payload: never) => void;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    get pendingCount() {
      return pending.size;
    },
    abort(reason) {
      if (disposed) return;
      broken = reason;
      rejectAll(reason);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      port.removeEventListener('message', listener);
      listeners.clear();
      rejectAll(new Error('RPC client disposed'));
    },
  };
}

/** A client bound to a spawned worker. */
export interface WorkerConnection<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents> {
  readonly client: RpcClient<Api, Events>;
  /** Disposes the client (pending calls reject) and terminates the worker. */
  terminate(): void;
}

/**
 * Connects to a spawned worker. A script error or an undeserializable message (`error`,
 * `messageerror`) aborts the client: all pending and later calls reject with an `RpcError`
 * (`WorkerError`), because the bridge cannot tell which call was lost.
 */
export function connectWorker<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents>(worker: WorkerLike): WorkerConnection<Api, Events> {
  const client = createRpcClient<Api, Events>(worker);
  const onError = (event: RpcErrorEventLike): void => {
    const detail = typeof event.message === 'string' && event.message !== '' ? event.message : `worker ${event.type}`;
    client.abort(new RpcError({ name: 'WorkerError', message: detail, stack: '' }));
  };
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);
  return {
    client,
    terminate() {
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      client.dispose();
      worker.terminate();
    },
  };
}

/** In-memory port pair endpoint (see `createInProcessChannel`). */
export class InProcessPort implements RpcPort {
  private readonly listeners = new Set<(event: RpcMessageEvent) => void>();
  private peer: InProcessPort | null = null;
  private closed = false;

  /** Connects two ports (used by `createInProcessChannel`). */
  static pair(a: InProcessPort, b: InProcessPort): void {
    a.peer = b;
    b.peer = a;
  }

  /** Delivers a structured clone of `message` to the peer asynchronously (microtask). */
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.closed) return;
    const peer = this.peer;
    if (peer === null) throw new Error('InProcessPort is not connected');
    // structuredClone detaches transferred buffers exactly like a real MessagePort.
    const data: unknown = structuredClone(message, { transfer });
    queueMicrotask(() => peer.dispatch(data));
  }

  private dispatch(data: unknown): void {
    if (this.closed) return;
    const event: RpcMessageEvent = { data };
    for (const l of [...this.listeners]) l(event);
  }

  addEventListener(_type: 'message', listener: (event: RpcMessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: RpcMessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  /** Stops delivery in both directions. */
  close(): void {
    this.closed = true;
    if (this.peer !== null && !this.peer.closed) this.peer.close();
    this.listeners.clear();
  }
}

/** Two connected in-memory ports: what one posts, the other receives. */
export function createInProcessChannel(): [InProcessPort, InProcessPort] {
  const a = new InProcessPort();
  const b = new InProcessPort();
  InProcessPort.pair(a, b);
  return [a, b];
}

// ---------------------------------------------------------------------------------------------
// Job queue with per-frame budget
// ---------------------------------------------------------------------------------------------

/** The part of an `RpcClient` the job queue uses (any event map). */
export type JobRpcClient<Api extends RpcApiOf<Api>> = Pick<RpcClient<Api>, 'callTransfer'>;

/** Where jobs run: in a worker through an RPC client, or in this thread. */
export type JobExecutor<Api extends RpcApiOf<Api>> = { readonly kind: 'worker'; readonly client: JobRpcClient<Api> } | { readonly kind: 'inThread'; readonly handlers: Api };

/** Runs jobs in the worker behind `client` (any event map). */
export function workerExecutor<Api extends RpcApiOf<Api>, Events extends RpcEventsOf<Events> = NoRpcEvents>(client: RpcClient<Api, Events>): JobExecutor<Api> {
  return { kind: 'worker', client };
}

/** Runs jobs synchronously in this thread (Node tests, no module workers) with message-port copy semantics. */
export function inThreadExecutor<Api extends RpcApiOf<Api>>(handlers: Api): JobExecutor<Api> {
  return { kind: 'inThread', handlers };
}

/** An executor chosen at runtime plus how to release it. */
export interface JobExecutorHandle<Api extends RpcApiOf<Api>> {
  readonly executor: JobExecutor<Api>;
  readonly mode: 'worker' | 'inThread';
  /** Terminates the worker (no-op in-thread). */
  dispose(): void;
}

/** Options of `createJobExecutor`. */
export interface JobExecutorOptions<Api extends RpcApiOf<Api>> {
  /** Spawns the worker (browser: `new Worker(new URL(…), { type: 'module' })`); absent in Node. */
  readonly spawn?: () => WorkerLike;
  /** The same handlers the worker serves, for the in-thread fallback (created only when needed). */
  readonly handlers: () => Api;
  /** Told why the worker could not be spawned before falling back to the in-thread executor. */
  readonly onFallback?: (error: unknown) => void;
}

/** Worker executor when a worker can be spawned, otherwise the in-thread executor (Node fallback). */
export function createJobExecutor<Api extends RpcApiOf<Api>>(options: JobExecutorOptions<Api>): JobExecutorHandle<Api> {
  if (options.spawn !== undefined) {
    let worker: WorkerLike | undefined;
    try {
      worker = options.spawn();
    } catch (err) {
      options.onFallback?.(err);
    }
    if (worker !== undefined) {
      const connection = connectWorker<Api>(worker);
      return { executor: workerExecutor(connection.client), mode: 'worker', dispose: () => connection.terminate() };
    }
  }
  return { executor: inThreadExecutor(options.handlers()), mode: 'inThread', dispose: () => undefined };
}

/** Lifecycle of a job. */
export type JobState = 'queued' | 'running' | 'ready' | 'done' | 'failed' | 'cancelled';

/** What `submit` returns: identity, state and priority of a job. */
export interface JobHandle {
  readonly id: number;
  readonly state: JobState;
  readonly priority: number;
}

/** Per-job options of `JobQueue.submit`. */
export interface JobOptions<R> {
  /** Lower runs first (e.g. squared distance to the camera); ties run in submission order. Default 0. */
  readonly priority?: number;
  /** Buffers inside the arguments to move instead of copy. */
  readonly transfer?: Transferable[];
  /** Receives the result inside `JobQueue.frame()`, within the frame budget. */
  readonly onDone: (result: R) => void;
  /** Receives the failure (an `RpcError` in both executors) inside `frame()`; without it the error is rethrown from `frame()`. */
  readonly onError?: (error: Error) => void;
}

/** Options of a `JobQueue`. */
export interface JobQueueOptions {
  /** Main-thread time per `frame()` for delivering results and in-thread jobs [ms]. */
  readonly frameBudgetMs: number;
  /** Clock in milliseconds (browser: `performance.now`; tests: a manual clock). */
  readonly now: () => number;
  /** Most jobs a worker holds at once (queued jobs stay reorderable and cancellable here). Default 4. */
  readonly maxInFlight?: number;
}

/** What one `frame()` did (the object is reused by the next call). */
export interface JobFrameStats {
  /** Jobs sent to the worker or executed in-thread. */
  started: number;
  /** Results handed to `onDone`. */
  delivered: number;
  /** Failures handed to `onError`. */
  failed: number;
  /** Time spent in `frame()` [ms]. */
  elapsedMs: number;
  /** Jobs still waiting after this frame. */
  queued: number;
  /** Jobs running in the worker (or async in-thread handlers). */
  inFlight: number;
  /** Results waiting for the next frame. */
  ready: number;
}

/** Default number of jobs a worker holds at once: keeps it busy without freezing the queue order. */
const DEFAULT_MAX_IN_FLIGHT = 4;

class QueuedJob implements JobHandle {
  state: JobState = 'queued';
  result: unknown = undefined;
  error: Error | null = null;

  constructor(
    readonly id: number,
    public priority: number,
    readonly method: string,
    readonly args: readonly unknown[],
    readonly transfer: Transferable[],
    readonly onDone: (result: never) => void,
    readonly onError: ((error: Error) => void) | undefined,
  ) {}
}

/** Queue order: sorted descending so `pop()` yields the lowest (priority, id). */
function byPriorityDescending(a: QueuedJob, b: QueuedJob): number {
  return b.priority - a.priority || b.id - a.id;
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return isRecord(v) && typeof (v as { then?: unknown }).then === 'function';
}

/** Copies a handler result like a message port: `rpcTransfer` values move their buffers. */
function unwrapInThread(result: unknown): unknown {
  return result instanceof RpcTransfer ? structuredClone(result.value, { transfer: result.transfer }) : structuredClone(result);
}

/**
 * Priority job queue over a `JobExecutor` with a per-frame main-thread budget (see the module
 * comment). `frame()` is meant to be called once per rendered frame and does not allocate when
 * nothing happens.
 */
export class JobQueue<Api extends RpcApiOf<Api>> {
  readonly maxInFlight: number;
  readonly frameBudgetMs: number;
  private readonly now: () => number;
  private readonly queue: QueuedJob[] = [];
  private sorted = true;
  private queuedCount = 0;
  private inFlightCount = 0;
  private readonly readyList: Array<QueuedJob | undefined> = [];
  private readyHead = 0;
  private nextId = 1;
  private disposed = false;
  private settleWaiters: Array<() => void> = [];
  private readonly stats: JobFrameStats = { started: 0, delivered: 0, failed: 0, elapsedMs: 0, queued: 0, inFlight: 0, ready: 0 };

  constructor(
    private readonly executor: JobExecutor<Api>,
    options: JobQueueOptions,
  ) {
    const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new RangeError(`JobQueue: maxInFlight must be an integer ≥ 1, got ${String(maxInFlight)}`);
    if (!(options.frameBudgetMs >= 0) || !Number.isFinite(options.frameBudgetMs)) throw new RangeError(`JobQueue: frameBudgetMs must be a finite number ≥ 0, got ${String(options.frameBudgetMs)}`);
    this.maxInFlight = maxInFlight;
    this.frameBudgetMs = options.frameBudgetMs;
    this.now = options.now;
  }

  /** Where the jobs run. */
  get mode(): 'worker' | 'inThread' {
    return this.executor.kind;
  }

  /** Jobs waiting to start. */
  get queued(): number {
    return this.queuedCount;
  }

  /** Jobs running (worker, or async in-thread handlers). */
  get inFlight(): number {
    return this.inFlightCount;
  }

  /** Results waiting for delivery in the next `frame()`. */
  get ready(): number {
    return this.readyList.length - this.readyHead;
  }

  /** Whether nothing is queued, running or waiting for delivery. */
  get idle(): boolean {
    return this.queuedCount === 0 && this.inFlightCount === 0 && this.ready === 0;
  }

  /** Queues a job; its result arrives in `options.onDone` during a later `frame()`. */
  submit<K extends keyof Api & string>(method: K, args: Parameters<Api[K]>, options: JobOptions<RpcResult<ReturnType<Api[K]>>>): JobHandle {
    if (this.disposed) throw new Error('JobQueue is disposed');
    const priority = options.priority ?? 0;
    if (Number.isNaN(priority)) throw new RangeError('JobQueue: priority must not be NaN');
    const job = new QueuedJob(this.nextId++, priority, method, args, options.transfer ?? [], options.onDone as (result: never) => void, options.onError);
    this.queue.push(job);
    this.queuedCount++;
    this.sorted = false;
    return job;
  }

  /** Changes the priority of a queued job (no effect once it started). Returns whether it applied. */
  setPriority(handle: JobHandle, priority: number): boolean {
    const job = handle as QueuedJob;
    if (job.state !== 'queued' || Number.isNaN(priority)) return false;
    if (job.priority !== priority) {
      job.priority = priority;
      this.sorted = false;
    }
    return true;
  }

  /**
   * Cancels a job: a queued job never starts, the result of a running or ready job is dropped.
   * Returns whether the job was still pending.
   */
  cancel(handle: JobHandle): boolean {
    const job = handle as QueuedJob;
    switch (job.state) {
      case 'queued':
        this.queuedCount--;
        job.state = 'cancelled';
        this.compactQueue();
        return true;
      case 'running':
      case 'ready':
        job.state = 'cancelled';
        return true;
      default:
        return false;
    }
  }

  /**
   * One frame of work: delivers finished results, then starts jobs (worker: up to `maxInFlight`;
   * in-thread: executes them) while the frame budget lasts. At least one result or job is handled
   * per frame. `onDone` callbacks run inside this call.
   */
  frame(): JobFrameStats {
    const s = this.stats;
    s.started = 0;
    s.delivered = 0;
    s.failed = 0;
    const start = this.now();
    const budget = this.frameBudgetMs;
    while (this.readyHead < this.readyList.length) {
      if (s.delivered + s.failed > 0 && this.now() - start >= budget) break;
      const job = this.readyList[this.readyHead] as QueuedJob;
      this.readyList[this.readyHead++] = undefined;
      if (job.state !== 'ready') continue;
      this.deliver(job, s);
    }
    if (this.readyHead === this.readyList.length) {
      this.readyList.length = 0;
      this.readyHead = 0;
    }
    if (this.executor.kind === 'worker') {
      while (this.inFlightCount < this.maxInFlight) {
        const job = this.popNext();
        if (job === undefined) break;
        this.startInWorker(job, this.executor.client);
        s.started++;
      }
    } else {
      const handlers = this.executor.handlers;
      for (;;) {
        if (s.started + s.delivered + s.failed > 0 && this.now() - start >= budget) break;
        const job = this.popNext();
        if (job === undefined) break;
        s.started++;
        this.runInThread(job, handlers, s);
      }
    }
    s.elapsedMs = this.now() - start;
    s.queued = this.queuedCount;
    s.inFlight = this.inFlightCount;
    s.ready = this.ready;
    return s;
  }

  /**
   * Runs frames until every job is finished (tests, loading screens). Waits for worker results
   * between frames without timers. Throws after `maxFrames` frames.
   */
  async drain(maxFrames = Number.POSITIVE_INFINITY): Promise<void> {
    for (let f = 0; f < maxFrames; f++) {
      this.frame();
      if (this.idle) return;
      const blocked = this.ready === 0 && (this.queuedCount === 0 || (this.executor.kind === 'worker' && this.inFlightCount >= this.maxInFlight));
      if (blocked && this.inFlightCount > 0) await new Promise<void>((resolve) => this.settleWaiters.push(resolve));
    }
    throw new Error(`JobQueue.drain: still busy after ${maxFrames} frames (${this.queuedCount} queued, ${this.inFlightCount} running, ${this.ready} ready)`);
  }

  /** Cancels everything and refuses new jobs. */
  dispose(): void {
    this.disposed = true;
    for (const job of this.queue) if (job.state === 'queued') job.state = 'cancelled';
    this.queue.length = 0;
    this.queuedCount = 0;
    for (let i = this.readyHead; i < this.readyList.length; i++) {
      const job = this.readyList[i];
      if (job !== undefined) job.state = 'cancelled';
    }
    this.readyList.length = 0;
    this.readyHead = 0;
  }

  private popNext(): QueuedJob | undefined {
    if (!this.sorted) {
      this.queue.sort(byPriorityDescending);
      this.sorted = true;
    }
    for (;;) {
      const job = this.queue.pop();
      if (job === undefined) return undefined;
      if (job.state === 'queued') {
        this.queuedCount--;
        return job;
      }
    }
  }

  /** Drops cancelled entries once they make up more than half of the queue array. */
  private compactQueue(): void {
    if (this.queue.length > 2 * this.queuedCount + DEFAULT_MAX_IN_FLIGHT) {
      let w = 0;
      for (let r = 0; r < this.queue.length; r++) {
        const job = this.queue[r] as QueuedJob;
        if (job.state === 'queued') this.queue[w++] = job;
      }
      this.queue.length = w;
    }
  }

  private startInWorker(job: QueuedJob, client: JobRpcClient<Api>): void {
    job.state = 'running';
    this.inFlightCount++;
    const call = client.callTransfer as (method: string, transfer: Transferable[], ...args: unknown[]) => Promise<unknown>;
    call(job.method, job.transfer, ...job.args).then(
      (value) => this.settle(job, value, null),
      (err: unknown) => this.settle(job, undefined, err instanceof Error ? err : new RpcError(toErrorData(err))),
    );
  }

  private runInThread(job: QueuedJob, handlers: Api, s: JobFrameStats): void {
    const table = handlers as Record<string, unknown>;
    const fn = Object.prototype.hasOwnProperty.call(table, job.method) ? table[job.method] : undefined;
    if (typeof fn !== 'function') {
      job.error = new RpcError({ name: 'RpcMethodError', message: `Unknown RPC method "${job.method}"`, stack: '' });
      this.deliver(job, s);
      return;
    }
    let out: unknown;
    try {
      const args = structuredClone(job.args, { transfer: job.transfer }) as unknown[];
      out = (fn as (...a: unknown[]) => unknown).apply(handlers, args);
      if (isPromiseLike(out)) {
        job.state = 'running';
        this.inFlightCount++;
        Promise.resolve(out).then(
          (value) => {
            let copied: unknown;
            try {
              copied = unwrapInThread(value);
            } catch (err) {
              this.settle(job, undefined, new RpcError(toErrorData(err)));
              return;
            }
            this.settle(job, copied, null);
          },
          (err: unknown) => this.settle(job, undefined, new RpcError(toErrorData(err))),
        );
        return;
      }
      job.result = unwrapInThread(out);
    } catch (err) {
      job.error = new RpcError(toErrorData(err));
    }
    this.deliver(job, s);
  }

  /** Records the outcome of a running job for delivery in the next frame. */
  private settle(job: QueuedJob, value: unknown, error: Error | null): void {
    this.inFlightCount--;
    if (job.state === 'running') {
      job.state = 'ready';
      job.result = value;
      job.error = error;
      this.readyList.push(job);
    }
    const waiters = this.settleWaiters;
    if (waiters.length > 0) {
      this.settleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private deliver(job: QueuedJob, s: JobFrameStats): void {
    const error = job.error;
    const result = job.result;
    job.result = undefined;
    if (error !== null) {
      job.state = 'failed';
      s.failed++;
      if (job.onError === undefined) throw error;
      job.onError(error);
      return;
    }
    job.state = 'done';
    s.delivered++;
    (job.onDone as (r: unknown) => void)(result);
  }
}
